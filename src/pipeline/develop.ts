import type { CameraProfile, Vec3 } from '../profiles/types';
import { readExif, type ExifData } from '../exif/read';
import { injectExif } from '../exif/write';
import { sceneFromExif, simulateExposure, type SceneLight, type SimulatedExposure } from './exposure';
import { buildFrameParams, drExpansion, type SceneStats } from './params';
import { mulberry32, randomSeed } from './random';
import { FINISH_SKSL, ISP_SKSL, NR_SKSL, OPTICS_SKSL, SENSOR_SKSL } from './shaders';
import {
  AlphaUnpremul,
  ColorTypeRGBA8888,
  FilterLinear,
  FilterNearest,
  FormatJPEG,
  MipmapLinear,
  MipmapNone,
  TileClamp,
  compile,
  packUniforms,
  type SkCanvas,
  type SkImage,
  type SkRuntimeEffect,
  type SkShader,
  type SkiaApi,
  type Uniforms,
} from './skia';

export type DevelopStage = 'decode' | 'optics' | 'sensor' | 'isp' | 'denoise' | 'sharpen' | 'jpeg';

export const DEVELOP_STAGES: DevelopStage[] = ['decode', 'optics', 'sensor', 'isp', 'denoise', 'sharpen', 'jpeg'];

export interface DevelopOptions {
  profile: CameraProfile;
  front?: boolean;
  flash?: boolean;
  seed?: number;
  /** Overrides the scene brightness read from EXIF. */
  scene?: SceneLight;
  /** Caps the output size, e.g. for quick previews in the lab. */
  maxOutputWidth?: number;
  captureDate?: Date;
  onStage?: (stage: DevelopStage) => void | Promise<void>;
}

export interface DevelopResult {
  jpeg: Uint8Array;
  width: number;
  height: number;
  seed: number;
  scene: SceneLight;
  exposure: SimulatedExposure;
  sourceExif: ExifData | null;
}

interface Effects {
  optics: SkRuntimeEffect;
  sensor: SkRuntimeEffect;
  isp: SkRuntimeEffect;
  nr: SkRuntimeEffect;
  finish: SkRuntimeEffect;
}

let cached: { skia: SkiaApi; effects: Effects } | null = null;

function effectsFor(Skia: SkiaApi): Effects {
  if (cached?.skia !== Skia) {
    cached = {
      skia: Skia,
      effects: {
        optics: compile(Skia, OPTICS_SKSL, 'optics'),
        sensor: compile(Skia, SENSOR_SKSL, 'sensor'),
        isp: compile(Skia, ISP_SKSL, 'isp'),
        nr: compile(Skia, NR_SKSL, 'denoise'),
        finish: compile(Skia, FINISH_SKSL, 'sharpen'),
      },
    };
  }
  return cached.effects;
}

function makeSurface(Skia: SkiaApi, w: number, h: number) {
  const surface = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
  if (!surface) throw new Error(`Could not allocate a ${w}x${h} surface`);
  return surface;
}

function runPass(
  Skia: SkiaApi,
  effect: SkRuntimeEffect,
  uniforms: Uniforms,
  children: SkShader[],
  w: number,
  h: number,
): SkImage {
  const surface = makeSurface(Skia, w, h);
  const paint = Skia.Paint();
  paint.setShader(effect.makeShaderWithChildren(packUniforms(effect, uniforms), children));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose?.();
  return image;
}

const linearShader = (img: SkImage) => img.makeShaderOptions(TileClamp, TileClamp, FilterLinear, MipmapNone);
const nearestShader = (img: SkImage) => img.makeShaderOptions(TileClamp, TileClamp, FilterNearest, MipmapNone);

/**
 * Maps raw decoded pixels to upright ones for an EXIF orientation. Applied as
 * canvas transforms so orientation, crop and downscale happen in one draw.
 */
function applyOrientation(canvas: SkCanvas, o: number, w: number, h: number) {
  switch (o) {
    case 2: canvas.translate(w, 0); canvas.scale(-1, 1); break;
    case 3: canvas.translate(w, h); canvas.rotate(180, 0, 0); break;
    case 4: canvas.translate(0, h); canvas.scale(1, -1); break;
    case 5: canvas.rotate(90, 0, 0); canvas.scale(1, -1); break;
    case 6: canvas.translate(h, 0); canvas.rotate(90, 0, 0); break;
    case 7: canvas.translate(h, w); canvas.scale(-1, -1); canvas.rotate(90, 0, 0); canvas.scale(1, -1); break;
    case 8: canvas.translate(0, w); canvas.rotate(-90, 0, 0); break;
    default: break;
  }
}

/**
 * Skia's codecs may or may not have applied EXIF orientation already; if the
 * decoded size matches the stored (unrotated) size for a rotating tag, we
 * still need to rotate.
 */
function orientationToApply(img: SkImage, exif: ExifData | null, rawSize?: { w: number; h: number }): number {
  const o = exif?.orientation ?? 1;
  if (o <= 1 || o > 8) return 1;
  if (!rawSize) return o;
  const swaps = o >= 5;
  const decodedSwapped = img.width() === rawSize.h && img.height() === rawSize.w && rawSize.w !== rawSize.h;
  if (swaps && decodedSwapped) return 1;
  return o;
}

/** Reads SOF0/SOF2 to learn the stored pixel size of a JPEG. */
export function jpegStoredSize(bytes: Uint8Array): { w: number; h: number } | undefined {
  let i = 2;
  while (i + 9 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return undefined;
}

function computeStats(Skia: SkiaApi, prep: SkImage, profile: CameraProfile): SceneStats {
  const W = 64;
  const H = Math.max(8, Math.round((64 * prep.height()) / prep.width()));
  const surface = makeSurface(Skia, W, H);
  surface
    .getCanvas()
    .drawImageRectOptions(prep, { x: 0, y: 0, width: prep.width(), height: prep.height() }, { x: 0, y: 0, width: W, height: H }, FilterLinear, MipmapLinear);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const px = snap.readPixels(0, 0, { width: W, height: H, colorType: ColorTypeRGBA8888, alphaType: AlphaUnpremul }) as Uint8Array | null;
  snap.dispose?.();
  surface.dispose?.();
  if (!px) return { pivot: 0.12, meterGain: 1, mean: [1, 1, 1] };

  const k = drExpansion(profile);
  const mode = profile.exposure.metering;
  const sigma = mode === 'spot' ? 0.12 : 0.35;
  // Old meters averaged linear light, so bright skies and windows pulled
  // exposure down; how strongly depends on the metering pattern.
  const linearBias = mode === 'average' ? 0.6 : mode === 'center' ? 0.4 : 0.2;

  const lum: number[] = [];
  const weight: number[] = [];
  let wSum = 0;
  let logSum = 0;
  const cSum: Vec3 = [0, 0, 0];
  let cCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const r = Math.pow(px[o] / 255, 2.2);
      const g = Math.pow(px[o + 1] / 255, 2.2);
      const b = Math.pow(px[o + 2] / 255, 2.2);
      const L = Math.max(1e-4, 0.2126 * r + 0.7152 * g + 0.0722 * b);
      const dx = (x + 0.5) / W - 0.5;
      const dy = (y + 0.5) / H - 0.5;
      const d2 = dx * dx + dy * dy;
      const w = mode === 'average' ? 1 : Math.exp(-d2 / (2 * sigma * sigma)) + (mode === 'center' ? 0.25 : 0.02);
      lum.push(L);
      weight.push(w);
      wSum += w;
      logSum += w * Math.log(L);
      if (L > 0.02 && Math.max(r, g, b) < 0.92) {
        cSum[0] += r;
        cSum[1] += g;
        cSum[2] += b;
        cCount++;
      }
    }
  }
  const pivot = Math.exp(logSum / wSum);
  let linSrc = 0;
  let linExp = 0;
  for (let i = 0; i < lum.length; i++) {
    linSrc += weight[i] * Math.min(1, lum[i]);
    linExp += weight[i] * Math.min(1, pivot * Math.pow(lum[i] / pivot, k));
  }
  const meterGain = Math.pow(linSrc / Math.max(linExp, 1e-6), linearBias);
  const mean: Vec3 = cCount > 8 ? [cSum[0] / cCount, cSum[1] / cCount, cSum[2] / cCount] : [1, 1, 1];
  return { pivot, meterGain, mean };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Develops a modern photo as if it had been taken with `options.profile`.
 * Runs entirely on Skia (GPU on device), returning an EXIF-tagged JPEG.
 */
export async function develop(Skia: SkiaApi, source: Uint8Array, options: DevelopOptions): Promise<DevelopResult> {
  const { profile, front = false, flash = false } = options;
  const seed = options.seed ?? randomSeed();
  const rand = mulberry32(seed);
  const stage = async (s: DevelopStage) => {
    await options.onStage?.(s);
    await tick();
  };

  await stage('decode');
  const fx = effectsFor(Skia);
  const exif = readExif(source);
  const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(source));
  if (!decoded) throw new Error('Could not decode the photo');
  const orientation = orientationToApply(decoded, exif, jpegStoredSize(source));
  const swap = orientation >= 5;
  const uprightW = swap ? decoded.height() : decoded.width();
  const uprightH = swap ? decoded.width() : decoded.height();

  // Output frame follows the shot's orientation.
  const spec = front && profile.front ? profile.front : profile.output;
  const portrait = uprightH > uprightW;
  let outW = portrait ? Math.min(spec.width, spec.height) : Math.max(spec.width, spec.height);
  let outH = portrait ? Math.max(spec.width, spec.height) : Math.min(spec.width, spec.height);
  if (options.maxOutputWidth && outW > options.maxOutputWidth) {
    const s = options.maxOutputWidth / outW;
    outW = Math.round(outW * s);
    outH = Math.round(outH * s);
  }

  // Centre-crop the upright source to the sensor's aspect ratio.
  const targetAspect = outW / outH;
  let cropW = uprightW;
  let cropH = uprightW / targetAspect;
  if (cropH > uprightH) {
    cropH = uprightH;
    cropW = uprightH * targetAspect;
  }
  const cropX = (uprightW - cropW) / 2;
  const cropY = (uprightH - cropH) / 2;

  // 2x oversampled working copy so the lens pass has real detail to blur.
  const prepW = Math.min(Math.round(cropW), outW * 2);
  const prepH = Math.round(prepW / targetAspect);
  const prepSurface = makeSurface(Skia, prepW, prepH);
  const pc = prepSurface.getCanvas();
  pc.save();
  pc.scale(prepW / cropW, prepH / cropH);
  pc.translate(-cropX, -cropY);
  applyOrientation(pc, orientation, decoded.width(), decoded.height());
  const full = { x: 0, y: 0, width: decoded.width(), height: decoded.height() };
  pc.drawImageRectOptions(decoded, full, full, FilterLinear, MipmapLinear);
  pc.restore();
  prepSurface.flush();
  const prep = prepSurface.makeImageSnapshot();
  prepSurface.dispose?.();
  decoded.dispose?.();

  const glareW = Math.max(4, Math.round(outW / 24));
  const glareH = Math.max(3, Math.round(outH / 24));
  const glareSurface = makeSurface(Skia, glareW, glareH);
  glareSurface
    .getCanvas()
    .drawImageRectOptions(prep, { x: 0, y: 0, width: prepW, height: prepH }, { x: 0, y: 0, width: glareW, height: glareH }, FilterLinear, MipmapLinear);
  glareSurface.flush();
  const glare = glareSurface.makeImageSnapshot();
  glareSurface.dispose?.();

  const stats = computeStats(Skia, prep, profile);
  const scene = options.scene ?? sceneFromExif(exif);
  const flashFired = flash && profile.flash != null && !front;
  const exposure = simulateExposure(profile, scene, outW, rand, flashFired);
  const params = buildFrameParams({ profile, front, flash: flashFired, exposure, stats, seed, width: outW, height: outH });

  await stage('optics');
  const optics = runPass(
    Skia,
    fx.optics,
    { ...params.optics, outSize: [outW, outH], srcSize: [prepW, prepH], glareSize: [glareW, glareH] },
    [linearShader(prep), linearShader(glare)],
    outW,
    outH,
  );
  prep.dispose?.();
  glare.dispose?.();

  await stage('sensor');
  const raw = runPass(Skia, fx.sensor, params.sensor, [nearestShader(optics)], outW, outH);
  optics.dispose?.();

  await stage('isp');
  const rgb = runPass(Skia, fx.isp, { ...params.isp, outSize: [outW, outH] }, [nearestShader(raw)], outW, outH);
  raw.dispose?.();

  await stage('denoise');
  const clean = runPass(Skia, fx.nr, params.nr, [linearShader(rgb)], outW, outH);
  rgb.dispose?.();

  await stage('sharpen');
  const finished = runPass(Skia, fx.finish, params.finish, [linearShader(clean)], outW, outH);
  clean.dispose?.();

  await stage('jpeg');
  const encoded = finished.encodeToBytes(FormatJPEG, params.jpegQuality);
  finished.dispose?.();
  const jpeg = injectExif(encoded, {
    make: 'Early Digital',
    model: `${profile.model} (${profile.year})`,
    software: 'Early Digital',
    dateTime: options.captureDate ?? new Date(),
    width: outW,
    height: outH,
    exposureTime: exposure.shutter,
    fNumber: profile.optics.fNumber,
    iso: exposure.iso,
    focalLength35: profile.optics.focalLength35,
  });

  return { jpeg, width: outW, height: outH, seed, scene, exposure, sourceExif: exif };
}
