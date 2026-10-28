import type { CameraProfile, Vec3 } from '../profiles/types';
import { colorMatrix, crosstalkMatrix, diag, mul3, rows } from './color';
import type { SimulatedExposure } from './exposure';

/** Dynamic range a modern multi-frame HDR pipeline squeezes into a JPEG. */
const MODERN_DR_STOPS = 11;

export function drExpansion(profile: CameraProfile): number {
  const k = MODERN_DR_STOPS / profile.sensor.dynamicRange;
  return Math.min(1.4, Math.max(1, 1 + (k - 1) * 0.35));
}

export interface SceneStats {
  /** Metering-weighted geometric mean luminance; the DR expansion pivots here. */
  pivot: number;
  /** Exposure correction from the old meter being fooled by the expanded scene. */
  meterGain: number;
  /** Grey-world channel means (linear). */
  mean: Vec3;
}

export interface FrameParams {
  width: number;
  height: number;
  jpegQuality: number;
  optics: Record<string, number | number[]>;
  sensor: Record<string, number | number[]>;
  isp: Record<string, number | number[]>;
  nr: Record<string, number | number[]>;
  finish: Record<string, number | number[]>;
}

export interface FrameContext {
  profile: CameraProfile;
  front: boolean;
  flash: boolean;
  exposure: SimulatedExposure;
  stats: SceneStats;
  seed: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function whiteBalance(profile: CameraProfile, stats: SceneStats): Vec3 {
  const [r, g, b] = stats.mean;
  const grey: Vec3 = [
    clamp(g / Math.max(r, 1e-4), 0.75, 1.35),
    1,
    clamp(g / Math.max(b, 1e-4), 0.75, 1.35),
  ];
  const k = profile.isp.awbStrength;
  return grey.map((v, i) => (1 + (v - 1) * k) * profile.isp.wbBias[i]) as Vec3;
}

export function meteringGain(profile: CameraProfile, stats: SceneStats): number {
  return clamp(stats.meterGain * Math.pow(2, profile.exposure.bias), Math.pow(2, -1.5), Math.pow(2, 1.5));
}

/** Turns a profile plus this shot's exposure and statistics into shader uniforms. */
export function buildFrameParams(ctx: FrameContext): FrameParams {
  const { profile, exposure, stats, front, flash, width, height } = ctx;
  const { optics, sensor, isp } = profile;
  const gs = exposure.gainStops;

  const frontSoft = front ? 1.4 : 1;
  const fullWell = sensor.fullWell * (front ? 0.6 : 1);
  const readNoise = sensor.readNoise * (front ? 1.3 : 1);

  const xt = crosstalkMatrix(sensor.crosstalk);
  const ccm = colorMatrix(xt, isp.ccmStrength);
  const [xtR, xtG, xtB] = rows(xt);
  const [ccmR, ccmG, ccmB] = rows(ccm);
  const [lookR, lookG, lookB] = rows(isp.look);

  const flashOn = flash && profile.flash != null && !front;
  const totalExposure = meteringGain(profile, stats) * Math.pow(2, -exposure.underStops);

  const lumaAmount = clamp(isp.lumaNR + isp.nrPerStop * gs, 0, 0.9);
  const chromaAmount = clamp(isp.chromaNR + isp.nrPerStop * gs, 0, 0.95);

  return {
    width,
    height,
    jpegQuality: front && profile.front ? profile.front.quality : isp.jpegQuality,
    optics: {
      distortion: optics.distortion,
      ca: optics.lateralCA,
      softness: [optics.softness[0] * frontSoft, optics.softness[1] * frontSoft],
      vignette: optics.vignetteStops,
      glareAmount: optics.glare,
      shake: exposure.shake,
      flashHotspot: flashOn ? profile.flash!.hotspot : 0,
      flashTint: flashOn ? profile.flash!.tint : [1, 1, 1],
    },
    sensor: {
      drExpand: drExpansion(profile),
      drPivot: stats.pivot,
      exposure: totalExposure,
      xtR,
      xtG,
      xtB,
      gain: Math.pow(2, gs),
      fullWell,
      readNoise,
      banding: sensor.banding,
      prnu: sensor.prnu,
      // Defect maps hide hot pixels at base ISO; they surface as gain rises.
      hotPixels: sensor.hotPixels * clamp((gs - 1) / 3, 0, 1),
      adcLevels: Math.pow(2, sensor.adcBits) - 1,
      seed: (ctx.seed % 10007) + 0.5,
    },
    isp: {
      wb: whiteBalance(profile, stats),
      ccmR,
      ccmG,
      ccmB,
      shading: optics.colorShading,
      shoulder: isp.shoulder,
      contrast: isp.contrast,
      blackPoint: isp.blackPoint,
      blackLift: isp.blackLift,
      saturation: Math.max(0.5, isp.saturation * (1 - isp.lowLightDesat * gs)),
      highlightDesat: isp.highlightDesat,
    },
    nr: {
      lumaSigma: 0.02 + 0.07 * lumaAmount,
      lumaAmount,
      chromaStep: 1 + 1.5 * chromaAmount,
      chromaAmount,
    },
    finish: {
      sharpAmount: isp.sharpenAmount / (1 + 0.25 * gs),
      sharpRadius: isp.sharpenRadius,
      sharpThreshold: isp.sharpenThreshold * (1 + 0.5 * gs),
      lookR,
      lookG,
      lookB,
    },
  };
}

/**
 * Uniforms for the single-pass live viewfinder. Everything except the frame
 * size and time is fixed per profile, so it's computed once on the JS thread.
 */
export function buildPreviewUniforms(profile: CameraProfile, lcd: boolean) {
  const xt = crosstalkMatrix(profile.sensor.crosstalk);
  const ccm = colorMatrix(xt, profile.isp.ccmStrength);
  const neutralWb = whiteBalance(profile, { pivot: 0.12, meterGain: 1, mean: [1, 1, 1] });
  const col = mul3(profile.isp.look, mul3(ccm, mul3(diag(neutralWb), xt)));
  const [colR, colG, colB] = rows(col);
  const { width: sw, height: sh } = profile.output;
  const { width: lw, height: lh } = profile.viewfinder;
  return {
    // (long, short) edges; the shader orients them to the frame.
    sensorSize: [Math.max(sw, sh), Math.min(sw, sh)],
    lcdSize: [Math.max(lw, lh), Math.min(lw, lh)],
    lcdMix: lcd ? 1 : 0,
    lcdLevels: Math.pow(2, profile.viewfinder.bitsPerChannel) - 1,
    ca: profile.optics.lateralCA * 1.5,
    softness: profile.optics.softness[0],
    vignette: profile.optics.vignetteStops,
    drExpand: drExpansion(profile),
    drPivot: 0.12,
    colR,
    colG,
    colB,
    contrast: profile.isp.contrast,
    blackLift: profile.isp.blackLift,
    saturation: profile.isp.saturation,
    noise: Math.sqrt(1 / profile.sensor.fullWell) * 0.9,
  };
}
