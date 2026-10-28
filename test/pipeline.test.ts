import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readExif } from '../src/exif/read';
import { injectExif } from '../src/exif/write';
import { develop, jpegStoredSize } from '../src/pipeline/develop';
import { PROFILES, getProfile } from '../src/profiles';
import { loadSkia, testChartJpeg } from './helpers';

test('every profile develops a valid, tagged JPEG', async () => {
  const Skia = await loadSkia();
  const src = testChartJpeg(Skia, 480, 360);
  for (const profile of PROFILES) {
    const res = await develop(Skia, src, { profile, seed: 7, maxOutputWidth: 160 });
    assert.equal(res.jpeg[0], 0xff);
    assert.equal(res.jpeg[1], 0xd8);
    const size = jpegStoredSize(res.jpeg);
    assert.deepEqual(size, { w: res.width, h: res.height }, profile.id);
    const aspect = profile.output.width / profile.output.height;
    assert.ok(Math.abs(res.width / res.height - aspect) < 0.02, `${profile.id} keeps its aspect`);
    const exif = readExif(res.jpeg);
    assert.equal(exif?.model, `${profile.model} (${profile.year})`);
    assert.equal(exif?.orientation, 1);
    const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(res.jpeg));
    assert.ok(decoded, `${profile.id} output decodes`);
  }
});

test('the same seed develops the same photo', async () => {
  const Skia = await loadSkia();
  const src = testChartJpeg(Skia, 320, 240);
  const profile = getProfile('vga-2002');
  const a = await develop(Skia, src, { profile, seed: 42, maxOutputWidth: 120, captureDate: new Date(0) });
  const b = await develop(Skia, src, { profile, seed: 42, maxOutputWidth: 120, captureDate: new Date(0) });
  assert.deepEqual(a.jpeg, b.jpeg);
});

test('EXIF orientation turns a landscape-stored frame into a portrait photo', async () => {
  const Skia = await loadSkia();
  const stored = testChartJpeg(Skia, 400, 300);
  const rotated = injectExif(stored, {
    make: 'x', model: 'y', software: 'z', dateTime: new Date(), width: 400, height: 300,
    exposureTime: 1 / 100, fNumber: 2, iso: 100, focalLength35: 30, orientation: 6,
  });
  const res = await develop(Skia, rotated, { profile: getProfile('phone-2007'), seed: 1, maxOutputWidth: 120 });
  assert.ok(res.height > res.width, `expected portrait, got ${res.width}x${res.height}`);
});

test('a dark scene is developed noisier than a bright one', async () => {
  const Skia = await loadSkia();
  const src = testChartJpeg(Skia, 320, 240);
  const profile = getProfile('uxga-2007');
  const bright = await develop(Skia, src, { profile, seed: 3, maxOutputWidth: 200, scene: { ev100: 14, source: 'assumed' } });
  const dark = await develop(Skia, src, { profile, seed: 3, maxOutputWidth: 200, scene: { ev100: 3, source: 'assumed' } });
  assert.ok(dark.exposure.iso > bright.exposure.iso);
  // Noise costs entropy: the dark frame compresses worse at the same quality.
  assert.ok(dark.jpeg.length > bright.jpeg.length, `${dark.jpeg.length} vs ${bright.jpeg.length}`);
});
