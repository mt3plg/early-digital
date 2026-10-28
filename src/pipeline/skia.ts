// The pipeline only needs the imperative Skia API. It is injected (rather than
// imported) so the exact same code runs on device and in the Node darkroom lab
// (`lab/`), where RN Skia's API is backed by CanvasKit.
import type {
  Skia as SkiaApiValue,
  SkCanvas,
  SkImage,
  SkRuntimeEffect,
  SkShader,
} from '@shopify/react-native-skia';

export type SkiaApi = typeof SkiaApiValue;
export type { SkCanvas, SkImage, SkRuntimeEffect, SkShader };

// Mirrors of RN Skia enums, so this module never pulls react-native at runtime.
export const TileClamp = 0;
export const FilterNearest = 0;
export const FilterLinear = 1;
export const MipmapNone = 0;
export const MipmapLinear = 2;
export const FormatJPEG = 3;
export const ColorTypeRGBA8888 = 4;
export const AlphaUnpremul = 3;

export type Uniforms = Record<string, number | readonly number[]>;

/** Packs named uniform values into the flat array Skia expects, by slot. */
export function packUniforms(effect: SkRuntimeEffect, values: Uniforms): number[] {
  const out = new Array<number>(effect.getUniformFloatCount()).fill(0);
  const count = effect.getUniformCount();
  for (let i = 0; i < count; i++) {
    const name = effect.getUniformName(i);
    const info = effect.getUniform(i);
    const size = info.columns * info.rows;
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing uniform "${name}"`);
    }
    if (typeof value === 'number') {
      out[info.slot] = value;
    } else {
      if (value.length !== size) {
        throw new Error(`Uniform "${name}" expects ${size} floats, got ${value.length}`);
      }
      for (let j = 0; j < size; j++) out[info.slot + j] = value[j];
    }
  }
  return out;
}

export function compile(Skia: SkiaApi, source: string, label: string): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(source);
  if (!effect) {
    throw new Error(`Failed to compile ${label} shader`);
  }
  return effect;
}
