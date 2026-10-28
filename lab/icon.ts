// Renders the app icon with Skia: a lens whose glass resolves into big
// VGA-era pixels.  npx tsx lab/icon.ts
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSkia } from '../test/helpers';

const root = resolve(__dirname, '..');

const ICON_SKSL = `
uniform float size;
uniform float inset;
uniform float cutout;

half3 bg = half3(0.043, 0.043, 0.047);

half4 main(float2 xy) {
  float s = size;
  float2 c = float2(s * 0.5);
  float2 p = xy - c;
  float r = length(p) / (s * 0.5 - inset);

  // Pixelated glass: quantise to a 12x12 grid inside the lens.
  float cells = 12.0;
  float2 cell = floor((xy - inset) / ((s - 2.0 * inset) / cells));
  float2 uv = cell / (cells - 1.0);
  half3 warm = half3(1.0, 0.62, 0.18);
  half3 cool = half3(0.16, 0.42, 0.55);
  half3 glass = mix(cool, warm, half(clamp(uv.x * 0.55 + (1.0 - uv.y) * 0.65 - 0.2, 0.0, 1.0)));
  glass *= half(0.85 + 0.15 * fract(sin(dot(cell, float2(12.9898, 78.233))) * 43758.5453));

  half3 col = bg;
  if (r < 0.60) {
    col = glass;
    float hl = length((xy - c) / (s * 0.5 - inset) - float2(-0.22, -0.24));
    col += half3(0.9) * half(smoothstep(0.16, 0.0, hl)) * 0.55;
  } else if (r < 0.64) {
    col = half3(0.02);
  } else if (r < 0.80) {
    float ring = (r - 0.64) / 0.16;
    col = mix(half3(0.24), half3(0.10), half(ring));
    col *= half(0.9 + 0.1 * cos(atan(p.y, p.x) * 48.0));
  } else if (r < 0.84) {
    col = half3(1.0, 0.62, 0.18);
  } else if (cutout > 0.5) {
    return half4(0.0);
  }
  return half4(col, 1.0);
}`;

async function main() {
  const Skia = await loadSkia();
  const effect = Skia.RuntimeEffect.Make(ICON_SKSL)!;
  const render = (size: number, inset: number, file: string, transparent = false) => {
    const surface = Skia.Surface.Make(size, size)!;
    const paint = Skia.Paint();
    paint.setShader(effect.makeShader([size, inset, transparent ? 1 : 0]));
    surface.getCanvas().drawPaint(paint);
    surface.flush();
    writeFileSync(join(root, 'assets', file), surface.makeImageSnapshot().encodeToBytes(4, 100));
    console.log('wrote', file);
  };
  render(1024, 50, 'icon.png');
  render(1024, 120, 'splash-icon.png');
  render(1024, 260, 'android-icon-foreground.png', true);
  render(48, 4, 'favicon.png');
}

main();
