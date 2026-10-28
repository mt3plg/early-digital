export interface ExifData {
  orientation?: number;
  make?: string;
  model?: string;
  exposureTime?: number;
  fNumber?: number;
  iso?: number;
  brightnessValue?: number;
  focalLength35?: number;
  dateTimeOriginal?: string;
}

const TAG_ORIENTATION = 0x0112;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_FNUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_BRIGHTNESS = 0x9203;
const TAG_FOCAL_35 = 0xa405;

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Finds the TIFF block inside a JPEG's APP1 "Exif" segment. */
function findTiff(bytes: Uint8Array): DataView | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (
      marker === 0xe1 &&
      bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66
    ) {
      const start = i + 10;
      return new DataView(bytes.buffer, bytes.byteOffset + start, Math.max(0, len - 8));
    }
    i += 2 + len;
  }
  return null;
}

/** Reads the handful of EXIF tags the pipeline cares about. Never throws. */
export function readExif(bytes: Uint8Array): ExifData | null {
  try {
    const tiff = findTiff(bytes);
    if (!tiff || tiff.byteLength < 8) return null;
    const le = tiff.getUint16(0) === 0x4949;
    const u16 = (o: number) => tiff.getUint16(o, le);
    const u32 = (o: number) => tiff.getUint32(o, le);
    const i32 = (o: number) => tiff.getInt32(o, le);
    const out: ExifData = {};

    const readValue = (entry: number) => {
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      const size = (TYPE_SIZES[type] ?? 1) * count;
      const at = size <= 4 ? entry + 8 : u32(entry + 8);
      if (at + size > tiff.byteLength) return undefined;
      switch (type) {
        case 2: {
          let s = '';
          for (let k = 0; k < count - 1; k++) s += String.fromCharCode(tiff.getUint8(at + k));
          return s.trim();
        }
        case 3:
          return u16(at);
        case 4:
          return u32(at);
        case 5: {
          const den = u32(at + 4);
          return den ? u32(at) / den : undefined;
        }
        case 10: {
          const den = i32(at + 4);
          return den ? i32(at) / den : undefined;
        }
        default:
          return undefined;
      }
    };

    const walk = (ifd: number, visit: (tag: number, entry: number) => void) => {
      if (ifd + 2 > tiff.byteLength) return;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const entry = ifd + 2 + k * 12;
        if (entry + 12 > tiff.byteLength) return;
        visit(u16(entry), entry);
      }
    };

    let exifIfd = 0;
    walk(u32(4), (tag, entry) => {
      if (tag === TAG_ORIENTATION) out.orientation = readValue(entry) as number;
      else if (tag === TAG_MAKE) out.make = readValue(entry) as string;
      else if (tag === TAG_MODEL) out.model = readValue(entry) as string;
      else if (tag === TAG_EXIF_IFD) exifIfd = readValue(entry) as number;
    });
    if (exifIfd) {
      walk(exifIfd, (tag, entry) => {
        if (tag === TAG_EXPOSURE_TIME) out.exposureTime = readValue(entry) as number;
        else if (tag === TAG_FNUMBER) out.fNumber = readValue(entry) as number;
        else if (tag === TAG_ISO) out.iso = readValue(entry) as number;
        else if (tag === TAG_BRIGHTNESS) out.brightnessValue = readValue(entry) as number;
        else if (tag === TAG_FOCAL_35) out.focalLength35 = readValue(entry) as number;
        else if (tag === TAG_DATETIME_ORIGINAL) out.dateTimeOriginal = readValue(entry) as string;
      });
    }
    return out;
  } catch {
    return null;
  }
}
