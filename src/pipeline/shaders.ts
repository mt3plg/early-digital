// SkSL sources for the developing pipeline. Each pass mirrors one block of a
// 2002-2013 phone camera: the lens, the Bayer sensor and its ADC, the ISP's
// demosaic/colour/tone stage, noise reduction, and the final sharpening.
// Intermediate images are stored gamma-encoded in 8-bit RGBA surfaces, so
// every pass decodes on entry and encodes on exit.

const COMMON = `
float3 toLin(float3 c) { return pow(max(c, float3(0.0)), float3(2.2)); }
float3 toGam(float3 c) { return pow(max(c, float3(0.0)), float3(1.0 / 2.2)); }
float luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

// Dave Hoskins' hash without sine: stable on mobile GPUs and in CPU raster.
float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float gauss(float2 p) {
  float u1 = max(hash12(p), 1e-6);
  float u2 = hash12(p + float2(17.17, 41.41));
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}

// Normalised radius: 0 at the optical centre, 1 in the corners.
float radius01(float2 xy, float2 size) {
  float aspect = size.x / size.y;
  float2 p = (xy / size - 0.5) * float2(aspect, 1.0);
  return length(p) / (0.5 * length(float2(aspect, 1.0)));
}
`;

/**
 * Lens: radial distortion, lateral CA, field-dependent softness with hand
 * shake folded into the same taps, veiling glare, vignetting and flash falloff.
 * Renders at sensor resolution from a 2x oversampled, pre-cropped source.
 */
export const OPTICS_SKSL = `
uniform shader src;
uniform shader glare;
uniform float2 outSize;
uniform float2 srcSize;
uniform float2 glareSize;
uniform float2 distortion;
uniform float ca;
uniform float2 softness;
uniform float vignette;
uniform float glareAmount;
uniform float2 shake;
uniform float flashHotspot;
uniform float3 flashTint;
${COMMON}

const int TAPS = 12;

half4 main(float2 xy) {
  float aspect = outSize.x / outSize.y;
  float2 halfDiag = 0.5 * float2(aspect, 1.0);
  float2 p = (xy / outSize - 0.5) * float2(aspect, 1.0);
  float r = length(p) / length(halfDiag);
  float r2 = r * r;

  // Barrel distortion, normalised so the corners stay put and nothing samples
  // outside the source.
  float dCorner = 1.0 + distortion.x + distortion.y;
  float d = (1.0 + distortion.x * r2 + distortion.y * r2 * r2) / (dCorner * (1.0 + abs(ca)));
  float2 qG = p * d;
  float2 qR = qG * (1.0 + ca);
  float2 qB = qG * (1.0 - ca);

  float2 toSrc = srcSize / float2(aspect, 1.0);
  float2 sR = qR * toSrc + srcSize * 0.5;
  float2 sG = qG * toSrc + srcSize * 0.5;
  float2 sB = qB * toSrc + srcSize * 0.5;

  float scale = srcSize.x / outSize.x;
  float blur = mix(softness.x, softness.y, r2) * scale;
  float2 shakeSrc = shake * scale;

  float3 acc = float3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float t = (float(i) + 0.5) / float(TAPS);
    float a = float(i) * 2.39996323;
    float2 off = float2(cos(a), sin(a)) * sqrt(t) * blur;
    off += shakeSrc * (fract(float(i) * 0.618034) - 0.5);
    acc.r += src.eval(sR + off).r;
    acc.g += src.eval(sG + off).g;
    acc.b += src.eval(sB + off).b;
  }
  float3 c = toLin(acc / float(TAPS));

  float3 veil = toLin(glare.eval(xy / outSize * glareSize).rgb);
  c = mix(c, veil, glareAmount);

  c *= exp2(-vignette * r2 * (0.5 + 0.5 * r2));

  if (flashHotspot > 0.0) {
    c *= flashTint * (1.0 + flashHotspot * (1.0 - r2) - flashHotspot * 0.5);
  }

  return half4(half3(toGam(c)), 1.0);
}
`;

/**
 * Sensor: undo the modern tone mapping (expand DR around mid-grey), expose,
 * mix through the colour-filter crosstalk, sample one channel per RGGB site,
 * add shot/read/banding/hot-pixel noise at the simulated gain, clip at full
 * well and quantise with the ADC. The mosaic is stored sqrt-encoded.
 */
export const SENSOR_SKSL = `
uniform shader optics;
uniform float drExpand;
uniform float drPivot;
uniform float exposure;
uniform float3 xtR;
uniform float3 xtG;
uniform float3 xtB;
uniform float gain;
uniform float fullWell;
uniform float readNoise;
uniform float2 banding;
uniform float prnu;
uniform float hotPixels;
uniform float adcLevels;
uniform float seed;
${COMMON}

half4 main(float2 xy) {
  float2 px = floor(xy);
  float3 c = toLin(optics.eval(xy).rgb);

  float L = max(luma(c), 1e-5);
  c *= drPivot * pow(L / drPivot, drExpand) / L;
  c *= exposure;

  float3 s = float3(dot(xtR, c), dot(xtG, c), dot(xtB, c));
  float2 m = mod(px, 2.0);
  float v = (m.x < 0.5 && m.y < 0.5) ? s.r : ((m.x > 0.5 && m.y > 0.5) ? s.b : s.g);

  // Fixed per-pixel sensitivity: a property of the silicon, not the shot.
  v *= 1.0 + prnu * (hash12(px * 1.37 + 11.0) - 0.5);

  float sig = max(v, 0.0);
  float readN = gain * readNoise / fullWell;
  float sigma = sqrt(sig * gain / fullWell + readN * readN);
  v = sig + sigma * gauss(px + seed);

  float rowN = hash12(float2(seed * 0.37 + 5.0, px.y)) - 0.5;
  float colN = hash12(float2(px.x, 7.31)) - 0.5;
  v += (rowN * banding.x + colN * banding.y) * readN;

  if (hash12(px * 0.731 + 3.1) < hotPixels) {
    v += 0.25 + 0.75 * hash12(px + 9.1);
  }

  v = clamp(v, 0.0, 1.0);
  v = floor(v * adcLevels + 0.5) / adcLevels;
  float e = sqrt(v);
  return half4(half(e), half(e), half(e), 1.0);
}
`;

/**
 * ISP: bilinear demosaic (with the zipper and false colour cheap ISPs had),
 * lens-shading error, white balance, colour matrix, highlight shoulder,
 * gamma, S-curve, black point/lift and saturation.
 */
export const ISP_SKSL = `
uniform shader raw;
uniform float2 outSize;
uniform float3 wb;
uniform float3 ccmR;
uniform float3 ccmG;
uniform float3 ccmB;
uniform float3 shading;
uniform float shoulder;
uniform float contrast;
uniform float blackPoint;
uniform float blackLift;
uniform float saturation;
uniform float highlightDesat;
${COMMON}

float rawAt(float2 p) {
  float e = raw.eval(p).r;
  return e * e;
}

half4 main(float2 xy) {
  float2 m = mod(floor(xy), 2.0);
  float c = rawAt(xy);
  float n = rawAt(xy + float2(0.0, -1.0));
  float s = rawAt(xy + float2(0.0, 1.0));
  float w = rawAt(xy + float2(-1.0, 0.0));
  float e = rawAt(xy + float2(1.0, 0.0));
  float cross = (n + s + w + e) * 0.25;
  float diag = (rawAt(xy + float2(-1.0, -1.0)) + rawAt(xy + float2(1.0, -1.0)) +
                rawAt(xy + float2(-1.0, 1.0)) + rawAt(xy + float2(1.0, 1.0))) * 0.25;

  float3 rgb;
  if (m.x < 0.5 && m.y < 0.5) {
    rgb = float3(c, cross, diag);
  } else if (m.x > 0.5 && m.y > 0.5) {
    rgb = float3(diag, cross, c);
  } else if (m.y < 0.5) {
    rgb = float3((w + e) * 0.5, c, (n + s) * 0.5);
  } else {
    rgb = float3((n + s) * 0.5, c, (w + e) * 0.5);
  }

  float r = radius01(xy, outSize);
  rgb *= mix(shading, float3(1.0), smoothstep(0.0, 0.85, r));
  rgb *= wb;
  rgb = float3(dot(ccmR, rgb), dot(ccmG, rgb), dot(ccmB, rgb));
  rgb = max(rgb, float3(0.0));

  rgb = rgb * (1.0 + shoulder) / (1.0 + shoulder * rgb);
  float3 y = clamp(toGam(rgb), 0.0, 1.0);
  y = mix(y, y * y * (3.0 - 2.0 * y), contrast);
  y = clamp((y - blackPoint) / (1.0 - blackPoint), 0.0, 1.0);
  y = blackLift + (1.0 - blackLift) * y;

  float Y = luma(y);
  float sat = saturation * (1.0 - highlightDesat * smoothstep(0.75, 1.0, Y));
  y = mix(float3(Y), y, sat);
  return half4(half3(clamp(y, 0.0, 1.0)), 1.0);
}
`;

/**
 * Noise reduction in YCbCr: a 5x5 bilateral on luma (the "watercolour" smear
 * of 2009-2013 phones in low light) and a wide box on chroma.
 */
export const NR_SKSL = `
uniform shader img;
uniform float lumaSigma;
uniform float lumaAmount;
uniform float chromaStep;
uniform float chromaAmount;
${COMMON}

float2 chroma(float3 c) {
  float Y = luma(c);
  return float2(c.b - Y, c.r - Y);
}

half4 main(float2 xy) {
  float3 c0 = img.eval(xy).rgb;
  float y0 = luma(c0);
  float sig = max(lumaSigma, 1e-3);

  float wSum = 0.0;
  float ySum = 0.0;
  float2 cSum = float2(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      float2 o = float2(float(i), float(j));
      float yn = luma(img.eval(xy + o).rgb);
      float dr = (yn - y0) / sig;
      float wgt = exp(-0.5 * dr * dr - dot(o, o) / 4.5);
      wSum += wgt;
      ySum += wgt * yn;
      cSum += chroma(img.eval(xy + o * chromaStep).rgb);
    }
  }
  float Y = mix(y0, ySum / wSum, lumaAmount);
  float2 cc = mix(chroma(c0), cSum / 25.0, chromaAmount);
  // Back from (B-Y, R-Y) to RGB with Rec.709 luma weights.
  float r = cc.y + Y;
  float b = cc.x + Y;
  float g = (Y - 0.2126 * r - 0.0722 * b) / 0.7152;
  return half4(half3(clamp(float3(r, g, b), 0.0, 1.0)), 1.0);
}
`;

/**
 * Unsharp mask on luma with coring but no halo clamp (that's where the
 * crunchy outlines come from), then the profile's display-space look matrix.
 */
export const FINISH_SKSL = `
uniform shader img;
uniform float sharpAmount;
uniform float sharpRadius;
uniform float sharpThreshold;
uniform float3 lookR;
uniform float3 lookG;
uniform float3 lookB;
${COMMON}

half4 main(float2 xy) {
  float3 c = img.eval(xy).rgb;
  float rr = sharpRadius;
  float3 b = c * 4.0;
  b += (img.eval(xy + float2(rr, 0.0)).rgb + img.eval(xy - float2(rr, 0.0)).rgb +
        img.eval(xy + float2(0.0, rr)).rgb + img.eval(xy - float2(0.0, rr)).rgb) * 2.0;
  b += img.eval(xy + float2(rr, rr)).rgb + img.eval(xy + float2(-rr, rr)).rgb +
       img.eval(xy + float2(rr, -rr)).rgb + img.eval(xy - float2(rr, rr)).rgb;
  b /= 16.0;
  float d = luma(c) - luma(b);
  d = sign(d) * max(abs(d) - sharpThreshold, 0.0);
  c += d * sharpAmount;
  c = float3(dot(lookR, c), dot(lookG, c), dot(lookB, c));
  return half4(half3(clamp(c, 0.0, 1.0)), 1.0);
}
`;

/**
 * Single-pass approximation of the whole chain for the live viewfinder.
 * `frameSize` and `time` are declared last so the worklet can append them to
 * a uniform array prepared once per profile on the JS thread.
 */
export const PREVIEW_SKSL = `
uniform shader frame;
uniform float2 sensorSize;
uniform float2 lcdSize;
uniform float lcdMix;
uniform float lcdLevels;
uniform float ca;
uniform float softness;
uniform float vignette;
uniform float drExpand;
uniform float drPivot;
uniform float3 colR;
uniform float3 colG;
uniform float3 colB;
uniform float contrast;
uniform float blackLift;
uniform float saturation;
uniform float noise;
uniform float2 frameSize;
uniform float time;
${COMMON}

half4 main(float2 xy) {
  // Sizes arrive as (long, short) edges; match them to the frame's layout.
  bool wide = frameSize.x >= frameSize.y;
  float2 sensor = wide ? sensorSize : sensorSize.yx;
  float2 lcd = wide ? lcdSize : lcdSize.yx;
  // Snap to the sensor grid (or, in LCD mode, the phone's screen grid).
  float2 grid = mix(sensor, lcd, lcdMix);
  float2 cell = frameSize / grid;
  float2 snapped = (floor(xy / cell) + 0.5) * cell;
  float2 sxy = mix(xy, snapped, step(1.0, max(cell.x, cell.y)));

  float aspect = frameSize.x / frameSize.y;
  float2 p = (sxy / frameSize - 0.5) * float2(aspect, 1.0);
  float r = length(p) / length(0.5 * float2(aspect, 1.0));
  float2 dir = (sxy - frameSize * 0.5) * ca;
  float blur = softness * frameSize.x / sensor.x;

  float3 c = float3(0.0);
  c.r = frame.eval(sxy + dir).r;
  c.g = frame.eval(sxy).g;
  c.b = frame.eval(sxy - dir).b;
  float3 bl = frame.eval(sxy + float2(blur, 0.0)).rgb + frame.eval(sxy - float2(blur, 0.0)).rgb +
              frame.eval(sxy + float2(0.0, blur)).rgb + frame.eval(sxy - float2(0.0, blur)).rgb;
  c = mix(c, bl * 0.25, 0.5);
  c = toLin(c);

  float L = max(luma(c), 1e-5);
  c *= drPivot * pow(L / drPivot, drExpand) / L;
  c *= exp2(-vignette * r * r * (0.5 + 0.5 * r * r));
  c = float3(dot(colR, c), dot(colG, c), dot(colB, c));

  float2 cellId = floor(sxy / cell);
  c += noise * sqrt(max(c, float3(0.0)) + 0.002) *
       float3(gauss(cellId + time), gauss(cellId + time + 3.7), gauss(cellId + time + 7.3));

  float3 y = clamp(toGam(max(c, float3(0.0))), 0.0, 1.0);
  y = mix(y, y * y * (3.0 - 2.0 * y), contrast);
  y = blackLift + (1.0 - blackLift) * y;
  float Y = luma(y);
  y = clamp(mix(float3(Y), y, saturation), 0.0, 1.0);

  float3 q = floor(y * lcdLevels + 0.5) / lcdLevels;
  y = mix(y, q, lcdMix);
  return half4(half3(y), 1.0);
}
`;
