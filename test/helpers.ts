import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { SkiaApi } from '../src/pipeline/skia';

const require = createRequire(import.meta.url);
const root = resolve(__dirname, '..');

let skia: Promise<SkiaApi> | null = null;

/** RN Skia's JS API backed by CanvasKit, the same one the darkroom lab uses. */
export function loadSkia(): Promise<SkiaApi> {
  if (!skia) {
    const ckDir = join(root, 'node_modules/canvaskit-wasm/bin/full');
    const CanvasKitInit = require(join(ckDir, 'canvaskit.js'));
    skia = CanvasKitInit({ locateFile: (f: string) => join(ckDir, f) }).then((CK: unknown) => {
      const { JsiSkApi } = require(join(root, 'node_modules/@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia.js'));
      return JsiSkApi(CK) as SkiaApi;
    });
  }
  return skia!;
}

/** A synthetic test chart: gradients, a grey ramp and saturated patches. */
export function testChartJpeg(Skia: SkiaApi, w: number, h: number): Uint8Array {
  const effect = Skia.RuntimeEffect.Make(`
    uniform float2 size;
    half4 main(float2 xy) {
      float2 uv = xy / size;
      if (uv.y < 0.25) return half4(half3(uv.x), 1.0);
      if (uv.y < 0.5) {
        float i = floor(uv.x * 6.0);
        half3 c = i < 1.0 ? half3(1,0,0) : i < 2.0 ? half3(0,1,0) : i < 3.0 ? half3(0,0,1)
                : i < 4.0 ? half3(1,1,0) : i < 5.0 ? half3(0,1,1) : half3(1,0,1);
        return half4(c * 0.8, 1.0);
      }
      float checker = mod(floor(xy.x / 6.0) + floor(xy.y / 6.0), 2.0);
      return half4(half3(mix(0.1, 0.9, checker) * uv.x), 1.0);
    }`)!;
  const surface = Skia.Surface.Make(w, h)!;
  const paint = Skia.Paint();
  paint.setShader(effect.makeShader([w, h]));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes(3, 95);
}
