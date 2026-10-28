// Darkroom lab: runs the app's exact developing pipeline on desktop through
// CanvasKit (RN Skia's web backend) and writes a contact sheet, so profiles
// can be tuned and regression-checked without a phone.
//
//   npx tsx lab/develop.ts [--max 1024] [--ev 11] [--only n95,5s] [--flash] [files...]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../src/profiles';
import { develop } from '../src/pipeline/develop';
import { formatShutter } from '../src/pipeline/exposure';
import type { SkiaApi } from '../src/pipeline/skia';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadSkia(): Promise<SkiaApi> {
  const ckDir = join(root, 'node_modules/canvaskit-wasm/bin/full');
  const CanvasKitInit = require(join(ckDir, 'canvaskit.js'));
  const CK = await CanvasKitInit({ locateFile: (f: string) => join(ckDir, f) });
  const { JsiSkApi } = require(join(root, 'node_modules/@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia.js'));
  return JsiSkApi(CK) as SkiaApi;
}

async function main() {
  const Skia = await loadSkia();
  const max = Number(arg('max') ?? 1024);
  const ev = arg('ev');
  const only = arg('only')?.split(',').map((s) => s.toLowerCase());
  const flash = process.argv.includes('--flash');
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const samplesDir = join(here, 'samples');
  const files = positional.length
    ? positional.map((f) => resolve(f))
    : readdirSync(samplesDir)
        .filter((f) => /\.(jpe?g|png)$/i.test(f))
        .map((f) => join(samplesDir, f));
  const profiles = PROFILES.filter((p) => !only || only.includes(p.model.toLowerCase()) || only.includes(p.id));
  const outDir = join(here, 'out');
  mkdirSync(outDir, { recursive: true });

  const rows: string[] = [];
  for (const file of files) {
    const name = basename(file, extname(file));
    const bytes = new Uint8Array(readFileSync(file));
    const cells: string[] = [`<figure><img src="${file}"><figcaption>source</figcaption></figure>`];
    for (const profile of profiles) {
      const t0 = performance.now();
      const res = await develop(Skia, bytes, {
        profile,
        seed: 1234,
        flash,
        maxOutputWidth: max,
        scene: ev ? { ev100: Number(ev), source: 'assumed' } : undefined,
      });
      const ms = Math.round(performance.now() - t0);
      const out = join(outDir, `${name}__${profile.model.replace(/\W+/g, '')}.jpg`);
      writeFileSync(out, res.jpeg);
      const e = res.exposure;
      const caption = `${profile.inspiredBy} · ${res.width}×${res.height} · ${formatShutter(e.shutter)} ISO ${e.iso}` +
        `${e.underStops > 0.05 ? ` · −${e.underStops.toFixed(1)} EV` : ''} · ${(res.jpeg.length / 1024).toFixed(0)} KB · ${ms} ms`;
      console.log(`${name.padEnd(12)} ${caption}`);
      cells.push(`<figure><img src="${basename(out)}"><figcaption>${caption}</figcaption></figure>`);
    }
    rows.push(`<section><h2>${name}${ev ? ` @ EV ${ev}` : ''}</h2><div class="row">${cells.join('')}</div></section>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Darkroom lab</title>
<style>body{background:#111;color:#ddd;font:13px -apple-system,sans-serif;margin:16px}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
figure{margin:0}img{width:100%;image-rendering:pixelated;background:#000}figcaption{opacity:.7;margin-top:4px}</style>
${rows.join('\n')}`;
  writeFileSync(join(outDir, 'index.html'), html);
  console.log(`\nContact sheet: ${join(outDir, 'index.html')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
