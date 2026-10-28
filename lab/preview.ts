// Renders the live-viewfinder shader over a still, for every profile, in
// normal and authentic (phone LCD) mode, so the preview can be checked
// without a camera.   npx tsx lab/preview.ts path/to/photo.jpg
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { buildPreviewUniforms } from '../src/pipeline/params';
import { PREVIEW_SKSL } from '../src/pipeline/shaders';
import { FilterLinear, MipmapNone, TileClamp, packUniforms } from '../src/pipeline/skia';
import { PROFILES } from '../src/profiles';
import { loadSkia } from '../test/helpers';

async function main() {
  const Skia = await loadSkia();
  const file = resolve(process.argv[2] ?? join(__dirname, 'samples', 'IMG_0001.JPG'));
  const src = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(new Uint8Array(readFileSync(file))))!;
  // Camera frames arrive landscape at roughly preview size.
  const fw = 1280;
  const fh = 960;
  const frameSurface = Skia.Surface.Make(fw, fh)!;
  frameSurface.getCanvas().drawImageRectOptions(
    src,
    { x: 0, y: 0, width: src.width(), height: src.height() },
    { x: 0, y: 0, width: fw, height: fh },
    FilterLinear,
    2,
  );
  frameSurface.flush();
  const frame = frameSurface.makeImageSnapshot();

  const effect = Skia.RuntimeEffect.Make(PREVIEW_SKSL)!;
  const outDir = join(__dirname, 'out');
  mkdirSync(outDir, { recursive: true });
  for (const profile of PROFILES) {
    for (const lcd of [false, true]) {
      const uniforms = packUniforms(effect, { ...buildPreviewUniforms(profile, lcd), frameSize: [fw, fh], time: 1.23 });
      const surface = Skia.Surface.Make(fw, fh)!;
      const paint = Skia.Paint();
      paint.setShader(effect.makeShaderWithChildren(uniforms, [frame.makeShaderOptions(TileClamp, TileClamp, FilterLinear, MipmapNone)]));
      surface.getCanvas().drawPaint(paint);
      surface.flush();
      const name = `${basename(file, extname(file))}__preview_${profile.model.replace(/\W+/g, '')}${lcd ? '_lcd' : ''}.jpg`;
      writeFileSync(join(outDir, name), surface.makeImageSnapshot().encodeToBytes(3, 90));
      console.log('wrote', name);
    }
  }
}

main();
