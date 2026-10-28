export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export type Metering = 'average' | 'center' | 'spot';

/**
 * A physically-motivated description of an early digital camera module.
 * Every number here feeds a specific stage of the developing pipeline, so a
 * profile reads like a spec sheet rather than a filter preset.
 */
export interface CameraProfile {
  id: string;
  /** Short model name shown on the dial, e.g. "N95". */
  model: string;
  /** The phone line this profile is modelled on. Display-only. */
  inspiredBy: string;
  year: number;
  tagline: string;

  /** Landscape pixel size of the JPEG the phone saved. */
  output: { width: number; height: number };
  /** Selfie camera, or null when the phone had none (flip is then disabled). */
  front: { width: number; height: number; quality: number } | null;

  optics: {
    fNumber: number;
    /** 35mm-equivalent focal length, used for EXIF and hand-shake angles. */
    focalLength35: number;
    /** Radial distortion coefficients k1, k2 (positive = barrel). */
    distortion: [number, number];
    /** Lateral chromatic aberration as a fraction of the image radius. */
    lateralCA: number;
    /** Defocus/MTF blur radius in output pixels at centre and corner. */
    softness: [number, number];
    /** Light falloff at the corner, in stops. */
    vignetteStops: number;
    /** Veiling glare from cheap plastic covers and uncoated elements, 0..1. */
    glare: number;
    /** Uncorrected lens-shading colour cast at the centre of the frame. */
    colorShading: Vec3;
  };

  sensor: {
    /** Effective full-well capacity in electrons at base ISO. */
    fullWell: number;
    /** Read noise in electrons. */
    readNoise: number;
    /** Spectral crosstalk between neighbouring colour filters, 0..0.4. */
    crosstalk: number;
    adcBits: number;
    /** Photo response non-uniformity, fraction. */
    prnu: number;
    /** Row (temporal) and column (fixed) banding, in units of read noise. */
    banding: [number, number];
    /** Hot pixel probability at maximum gain. */
    hotPixels: number;
    /** Usable dynamic range in stops. */
    dynamicRange: number;
  };

  exposure: {
    baseIso: number;
    maxIso: number;
    /** Auto-exposure keeps shutter at or above this before raising gain. */
    handheldShutter: number;
    slowestShutter: number;
    metering: Metering;
    /** Exposure bias the firmware applied, in stops. */
    bias: number;
  };

  isp: {
    /** Fixed white-balance error the firmware baked in. */
    wbBias: Vec3;
    /** How hard the grey-world AWB pulls the average to neutral, 0..1. */
    awbStrength: number;
    /** Fraction of the crosstalk the colour matrix undoes, 0..1. */
    ccmStrength: number;
    contrast: number;
    blackPoint: number;
    blackLift: number;
    /** Highlight roll-off; 0 is a hard digital clip. */
    shoulder: number;
    saturation: number;
    highlightDesat: number;
    /** Extra desaturation per stop of gain, hiding chroma noise. */
    lowLightDesat: number;
    /** Display-space colour "look" matrix, row-major. */
    look: Mat3;
    lumaNR: number;
    chromaNR: number;
    /** How much stronger noise reduction becomes per stop of gain. */
    nrPerStop: number;
    sharpenAmount: number;
    sharpenRadius: number;
    sharpenThreshold: number;
    jpegQuality: number;
  };

  flash: null | { tint: Vec3; hotspot: number };

  /**
   * The phone's own screen and responsiveness, used by authentic mode: the
   * viewfinder drops to this resolution, colour depth and frame rate, and the
   * shutter fires only after the period-correct lag.
   */
  viewfinder: { width: number; height: number; fps: number; bitsPerChannel: number; shutterLagMs: number };
  /** Whether the lens could focus; fixed-focus phones ignore tap-to-focus. */
  autofocus: boolean;

  /** Naming scheme of the files the phone wrote. */
  fileName: (index: number) => string;
}
