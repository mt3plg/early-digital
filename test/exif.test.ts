import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readExif } from '../src/exif/read';
import { injectExif } from '../src/exif/write';

const BARE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]);

test('EXIF written by the darkroom reads back', () => {
  const out = injectExif(BARE_JPEG, {
    make: 'Early Digital',
    model: 'N95 (2007)',
    software: 'Early Digital',
    dateTime: new Date(2007, 5, 15, 12, 30, 0),
    width: 2592,
    height: 1944,
    exposureTime: 1 / 15,
    fNumber: 2.8,
    iso: 400,
    focalLength35: 35,
    orientation: 6,
  });
  const exif = readExif(out);
  assert.ok(exif);
  assert.equal(exif.make, 'Early Digital');
  assert.equal(exif.model, 'N95 (2007)');
  assert.equal(exif.orientation, 6);
  assert.equal(exif.iso, 400);
  assert.equal(exif.fNumber, 2.8);
  assert.ok(Math.abs(exif.exposureTime! - 1 / 15) < 1e-9);
  assert.equal(exif.focalLength35, 35);
  assert.equal(exif.dateTimeOriginal, '2007:06:15 12:30:00');
});

test('injectExif drops JFIF APP0 and keeps the image data', () => {
  const out = injectExif(BARE_JPEG, {
    make: 'a', model: 'b', software: 'c', dateTime: new Date(), width: 1, height: 1,
    exposureTime: 1, fNumber: 2, iso: 100, focalLength35: 30,
  });
  assert.equal(out[2], 0xff);
  assert.equal(out[3], 0xe1);
  assert.deepEqual([...out.slice(-2)], [0xff, 0xd9]);
});

test('readExif tolerates garbage', () => {
  assert.equal(readExif(new Uint8Array([1, 2, 3])), null);
  assert.equal(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), null);
});
