import type { Mat3, Vec3 } from '../profiles/types';

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return IDENTITY3;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

export function lerp3(a: Mat3, b: Mat3, t: number): Mat3 {
  return a.map((v, i) => v + (b[i] - v) * t) as Mat3;
}

/** Scales each row so it sums to one, keeping neutrals neutral. */
export function normalizeRows(m: Mat3): Mat3 {
  const o = [...m] as Mat3;
  for (let r = 0; r < 3; r++) {
    const s = o[r * 3] + o[r * 3 + 1] + o[r * 3 + 2];
    if (Math.abs(s) > 1e-6) {
      for (let c = 0; c < 3; c++) o[r * 3 + c] /= s;
    }
  }
  return o;
}

/**
 * Spectral overlap of cheap colour filters: each channel picks up some of its
 * spectral neighbours (R<->G<->B), which desaturates the raw signal.
 */
export function crosstalkMatrix(k: number): Mat3 {
  return [
    1 - k, k * 0.75, k * 0.25,
    k * 0.5, 1 - k, k * 0.5,
    k * 0.25, k * 0.75, 1 - k,
  ];
}

/**
 * The ISP's colour matrix only partially inverts the crosstalk. Where it does
 * invert, the large off-diagonals amplify noise into coloured blotches, which
 * is exactly the chroma noise these phones are remembered for.
 */
export function colorMatrix(crosstalk: Mat3, strength: number): Mat3 {
  return normalizeRows(lerp3(IDENTITY3, invert3(crosstalk), strength));
}

export function rows(m: Mat3): [Vec3, Vec3, Vec3] {
  return [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
}

export function diag(v: Vec3): Mat3 {
  return [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];
}
