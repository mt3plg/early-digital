export interface ExifFields {
  make: string;
  model: string;
  software: string;
  dateTime: Date;
  width: number;
  height: number;
  exposureTime: number;
  fNumber: number;
  iso: number;
  focalLength35: number;
  /** Defaults to 1 (upright); developed photos are always written upright. */
  orientation?: number;
}

type Entry = { tag: number; type: 2 | 3 | 4 | 5; values: number[] | string };

function exifDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function rational(x: number): [number, number] {
  if (x <= 0) return [0, 1];
  if (x < 1) return [1, Math.round(1 / x)];
  return [Math.round(x * 10), 10];
}

/** Serialises one IFD (little-endian) starting at `base` within the TIFF block. */
function writeIfd(entries: Entry[], base: number, next: number): Uint8Array {
  entries.sort((a, b) => a.tag - b.tag);
  const dirSize = 2 + entries.length * 12 + 4;
  const extra: number[] = [];
  const dir = new DataView(new ArrayBuffer(dirSize));
  dir.setUint16(0, entries.length, true);
  entries.forEach((e, k) => {
    const at = 2 + k * 12;
    let payload: number[];
    let count: number;
    if (e.type === 2) {
      const s = `${e.values as string}\0`;
      payload = Array.from(s, (ch) => ch.charCodeAt(0) & 0x7f);
      count = payload.length;
    } else if (e.type === 3) {
      const v = e.values as number[];
      payload = v.flatMap((x) => [x & 0xff, (x >> 8) & 0xff]);
      count = v.length;
    } else if (e.type === 4) {
      const v = e.values as number[];
      payload = v.flatMap((x) => [x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >>> 24) & 0xff]);
      count = v.length;
    } else {
      const v = e.values as number[];
      payload = v.flatMap((x) => [x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >>> 24) & 0xff]);
      count = v.length / 2;
    }
    dir.setUint16(at, e.tag, true);
    dir.setUint16(at + 2, e.type, true);
    dir.setUint32(at + 4, count, true);
    if (payload.length <= 4) {
      payload.forEach((b, j) => dir.setUint8(at + 8 + j, b));
    } else {
      dir.setUint32(at + 8, base + dirSize + extra.length, true);
      extra.push(...payload);
      if (extra.length % 2) extra.push(0);
    }
  });
  dir.setUint32(dirSize - 4, next, true);
  const out = new Uint8Array(dirSize + extra.length);
  out.set(new Uint8Array(dir.buffer), 0);
  out.set(extra, dirSize);
  return out;
}

function buildApp1(f: ExifFields): Uint8Array {
  const date = exifDate(f.dateTime);
  const ifd0Entries = (exifOffset: number): Entry[] => [
    { tag: 0x010f, type: 2, values: f.make },
    { tag: 0x0110, type: 2, values: f.model },
    { tag: 0x0112, type: 3, values: [f.orientation ?? 1] },
    { tag: 0x0131, type: 2, values: f.software },
    { tag: 0x0132, type: 2, values: date },
    { tag: 0x8769, type: 4, values: [exifOffset] },
  ];
  const exifEntries: Entry[] = [
    { tag: 0x829a, type: 5, values: rational(f.exposureTime) },
    { tag: 0x829d, type: 5, values: rational(f.fNumber) },
    { tag: 0x8827, type: 3, values: [Math.min(65535, Math.round(f.iso))] },
    { tag: 0x9003, type: 2, values: date },
    { tag: 0xa001, type: 3, values: [1] },
    { tag: 0xa002, type: 4, values: [f.width] },
    { tag: 0xa003, type: 4, values: [f.height] },
    { tag: 0xa405, type: 3, values: [Math.round(f.focalLength35)] },
  ];
  // IFD0 size doesn't depend on the pointer value, so lay it out once to measure.
  const ifd0Size = writeIfd(ifd0Entries(0), 8, 0).length;
  const ifd0 = writeIfd(ifd0Entries(8 + ifd0Size), 8, 0);
  const exif = writeIfd(exifEntries, 8 + ifd0.length, 0);

  const tiffHeader = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];
  const body = new Uint8Array(6 + 8 + ifd0.length + exif.length);
  body.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  body.set(tiffHeader, 6);
  body.set(ifd0, 14);
  body.set(exif, 14 + ifd0.length);

  const seg = new Uint8Array(4 + body.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  const len = body.length + 2;
  seg[2] = (len >> 8) & 0xff;
  seg[3] = len & 0xff;
  seg.set(body, 4);
  return seg;
}

/** Inserts an EXIF APP1 segment right after SOI, dropping any JFIF APP0. */
export function injectExif(jpeg: Uint8Array, fields: ExifFields): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  let rest = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    rest = 4 + ((jpeg[4] << 8) | jpeg[5]);
  }
  const app1 = buildApp1(fields);
  const out = new Uint8Array(2 + app1.length + (jpeg.length - rest));
  out[0] = 0xff;
  out[1] = 0xd8;
  out.set(app1, 2);
  out.set(jpeg.subarray(rest), 2 + app1.length);
  return out;
}
