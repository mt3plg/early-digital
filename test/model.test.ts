import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorMatrix, crosstalkMatrix, invert3, mul3, IDENTITY3 } from '../src/pipeline/color';
import { sceneFromExif, simulateExposure } from '../src/pipeline/exposure';
import { PROFILES } from '../src/profiles';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('crosstalk and colour matrices keep neutrals neutral', () => {
  for (const p of PROFILES) {
    const xt = crosstalkMatrix(p.sensor.crosstalk);
    const ccm = colorMatrix(xt, p.isp.ccmStrength);
    const m = mul3(ccm, xt);
    for (let r = 0; r < 3; r++) {
      assert.ok(close(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2], 1), `${p.id} row ${r}`);
    }
  }
});

test('invert3 inverts', () => {
  const xt = crosstalkMatrix(0.3);
  const id = mul3(xt, invert3(xt));
  id.forEach((v, i) => assert.ok(close(v, IDENTITY3[i]), `entry ${i} = ${v}`));
});

test('scene EV comes from the exposure triangle', () => {
  // Sunny 16: f/16, 1/100 s, ISO 100 is EV ~14.6.
  const s = sceneFromExif({ fNumber: 16, exposureTime: 1 / 100, iso: 100 });
  assert.equal(s.source, 'exif');
  assert.ok(Math.abs(s.ev100 - 14.64) < 0.05);
  assert.equal(sceneFromExif(null).source, 'assumed');
  assert.equal(sceneFromExif({ brightnessValue: 3 }).ev100, 8);
});

test('auto-exposure degrades monotonically as light falls', () => {
  const rand = () => 0.5;
  for (const p of PROFILES) {
    let prev = simulateExposure(p, { ev100: 15, source: 'assumed' }, p.output.width, rand, false);
    assert.equal(prev.iso, p.exposure.baseIso, `${p.id} uses base ISO in sunlight`);
    for (let ev = 14; ev >= 0; ev--) {
      const e = simulateExposure(p, { ev100: ev, source: 'assumed' }, p.output.width, rand, false);
      assert.ok(e.shutter >= prev.shutter - 1e-12, `${p.id} shutter at EV ${ev}`);
      assert.ok(e.iso >= prev.iso, `${p.id} ISO at EV ${ev}`);
      assert.ok(e.underStops >= prev.underStops - 1e-9, `${p.id} underexposure at EV ${ev}`);
      assert.ok(e.iso <= p.exposure.maxIso);
      assert.ok(e.shutter <= p.exposure.slowestShutter + 1e-12);
      prev = e;
    }
    assert.ok(prev.underStops > 0, `${p.id} runs out of light at EV 0`);
  }
});

test('newer phones need less light', () => {
  const rand = () => 0.5;
  const at = (id: string) => simulateExposure(PROFILES.find((p) => p.id === id)!, { ev100: 4, source: 'assumed' }, 1000, rand, false);
  assert.ok(at('vga-2002').underStops > at('truetone-2013').underStops);
});
