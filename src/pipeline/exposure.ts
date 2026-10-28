import type { CameraProfile } from '../profiles/types';
import type { ExifData } from '../exif/read';

export interface SceneLight {
  /** Scene brightness as EV at ISO 100. */
  ev100: number;
  source: 'exif' | 'brightness' | 'assumed';
}

/** Bright overcast/indoor-window light when the source carries no metadata. */
const ASSUMED_EV100 = 11;

export function sceneFromExif(exif: ExifData | null | undefined): SceneLight {
  if (exif?.exposureTime && exif.fNumber && exif.iso) {
    const ev = Math.log2((exif.fNumber * exif.fNumber) / exif.exposureTime) - Math.log2(exif.iso / 100);
    if (Number.isFinite(ev)) return { ev100: ev, source: 'exif' };
  }
  if (exif?.brightnessValue != null && Number.isFinite(exif.brightnessValue)) {
    // APEX: Ev = Bv + Sv, and Sv = 5 at ISO 100.
    return { ev100: exif.brightnessValue + 5, source: 'brightness' };
  }
  return { ev100: ASSUMED_EV100, source: 'assumed' };
}

export interface SimulatedExposure {
  shutter: number;
  iso: number;
  /** Analog gain over base ISO, in stops. Drives noise and NR strength. */
  gainStops: number;
  /** How far the old camera ran out of light, in stops. */
  underStops: number;
  /** Hand-shake blur vector in output pixels. */
  shake: [number, number];
}

/** Typical one-handed angular shake while pressing a phone's shutter. */
const SHAKE_DEG_PER_SEC = 2.5;

/**
 * Runs the old phone's auto-exposure against the real scene brightness:
 * open aperture at base ISO, then slow the shutter to the handheld limit,
 * then raise gain to max ISO, then slow down to the slowest shutter, and
 * whatever is still missing becomes underexposure.
 */
export function simulateExposure(
  profile: CameraProfile,
  scene: SceneLight,
  outWidth: number,
  rand: () => number,
  flashFired: boolean,
): SimulatedExposure {
  const { fNumber, focalLength35 } = profile.optics;
  const { baseIso, maxIso, handheldShutter, slowestShutter } = profile.exposure;
  // A flash lights the near subject roughly like a dim room lamp at close range.
  const ev = flashFired ? Math.max(scene.ev100, 8.5) : scene.ev100;
  const n2 = fNumber * fNumber;
  const shutterFor = (iso: number) => n2 / (Math.pow(2, ev) * (iso / 100));

  let iso = baseIso;
  let shutter = shutterFor(iso);
  if (shutter > handheldShutter) {
    shutter = handheldShutter;
    iso = (n2 / (shutter * Math.pow(2, ev))) * 100;
    if (iso > maxIso) {
      iso = maxIso;
      shutter = Math.min(shutterFor(iso), slowestShutter);
    }
  }
  iso = Math.max(baseIso, Math.min(iso, maxIso));
  if (flashFired) shutter = Math.min(shutter, 1 / 30);

  const needed = shutterFor(iso);
  const underStops = Math.max(0, Math.log2(needed / shutter));
  const gainStops = Math.max(0, Math.log2(iso / baseIso));

  const hfovDeg = (2 * Math.atan(36 / (2 * focalLength35)) * 180) / Math.PI;
  const shakeLen = Math.min(((SHAKE_DEG_PER_SEC * shutter) / hfovDeg) * outWidth, outWidth * 0.012);
  const angle = rand() * Math.PI * 2;
  const shake: [number, number] = shakeLen > 0.35 ? [Math.cos(angle) * shakeLen, Math.sin(angle) * shakeLen] : [0, 0];

  return { shutter, iso: Math.round(iso), gainStops, underStops, shake };
}

export function formatShutter(t: number): string {
  if (t >= 0.5) return `${t.toFixed(1)}s`;
  return `1/${Math.round(1 / t)}`;
}
