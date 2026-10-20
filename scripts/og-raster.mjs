/**
 * Rasterizes Pulso cover SVGs for social cards.
 *
 * resvg does not honour fontconfig aliases. On the site-publisher Lambda, asking for
 * Georgia / Times New Roman / serif with no matching family paints a black rectangle
 * (background + grain + the wordmark dot) and drops every <text>. Bundled Playfair and
 * IBM Plex, mapped onto the CSS generic families, make that render host-independent.
 *
 * The share PNG also drops the feTurbulence grain: it inflates a 1200×675 card to ~1.3MB
 * of unique pixels and does nothing at thumbnail size. The on-page SVG keeps it.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = path.join(here, "fonts");

/** Must match frontend/src/lib/siteBase.ts COVER_OG_IMAGE_SUFFIX. */
export const COVER_OG_IMAGE_SUFFIX = ".og.png";

const REQUIRED_FONTS = ["PlayfairDisplay-Bold.ttf", "IBMPlexMono-Medium.ttf"];

/** Headline/label ink on the dark cover; the orange wordmark dot alone must not pass. */
export const MIN_LIGHT_FRACTION = 0.002;

export function coverOgPath(svgPath) {
  return svgPath.replace(/\.svg$/i, COVER_OG_IMAGE_SUFFIX);
}

export function bundledFontFiles() {
  if (!existsSync(FONTS_DIR)) {
    throw new Error(`missing ${FONTS_DIR} — cover rasterization needs bundled TTF files`);
  }
  const present = new Set(readdirSync(FONTS_DIR));
  const missing = REQUIRED_FONTS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`scripts/fonts missing ${missing.join(", ")}`);
  }
  return readdirSync(FONTS_DIR)
    .filter((name) => name.endsWith(".ttf") || name.endsWith(".otf"))
    .map((name) => path.join(FONTS_DIR, name));
}

export function resvgFontOptions() {
  return {
    fontFiles: bundledFontFiles(),
    // System fonts on a Mac hide Lambda failures (Georgia is installed there).
    loadSystemFonts: false,
    defaultFontFamily: "Playfair Display",
    serifFamily: "Playfair Display",
    sansSerifFamily: "IBM Plex Mono",
    monospaceFamily: "IBM Plex Mono",
  };
}

export function stripCoverGrain(svg) {
  return svg
    .replace(/<filter\b[^>]*\bid="grainFilter"[^>]*>[\s\S]*?<\/filter>\s*/gi, "")
    .replace(/<rect\b[^>]*filter="url\(#grainFilter\)"[^>]*\/?>(\s*)/gi, "");
}

export function rasterizeCoverSvg(svg) {
  const png = new Resvg(stripCoverGrain(svg), {
    fitTo: { mode: "original" },
    font: resvgFontOptions(),
  })
    .render()
    .asPng();
  assertCoverHasText(png);
  return toPalettePng(png);
}

/**
 * Re-encodes an opaque PNG with a palette of at most 256 colours.
 *
 * Without the grain a cover is flat ink, flat paper and the anti-aliased edges of its type: about
 * a thousand distinct colours, of which the 256 most frequent cover 99.9% of the pixels. One byte
 * a pixel instead of four (resvg writes RGBA) and nearest-colour for the rare edge pixel keeps the
 * card visually identical at a fraction of the size. Alpha is dropped; a cover has none.
 */
export function toPalettePng(png) {
  const { width, height, channels, data } = decodePng(png);
  const pixels = width * height;
  const counts = new Map();
  for (let i = 0; i < pixels; i += 1) {
    const o = i * channels;
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([key]) => key);
  const indexOf = new Map(palette.map((key, index) => [key, index]));

  const nearest = (key) => {
    const r = key >> 16;
    const g = (key >> 8) & 255;
    const b = key & 255;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < palette.length; index += 1) {
      const p = palette[index];
      const dr = r - (p >> 16);
      const dg = g - ((p >> 8) & 255);
      const db = b - (p & 255);
      const distance = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    indexOf.set(key, best);
    return best;
  };

  // Filter type 0 on every row: the recommended filter for indexed images.
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * channels;
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      raw[row + 1 + x] = indexOf.get(key) ?? nearest(key);
    }
  }

  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((key, index) => {
    plte[index * 3] = key >> 16;
    plte[index * 3 + 1] = (key >> 8) & 255;
    plte[index * 3 + 2] = key & 255;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", plte),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function assertCoverHasText(png, label = "cover PNG") {
  const stats = pngLightStats(png);
  if (stats.lightFraction < MIN_LIGHT_FRACTION) {
    throw new Error(
      `${label} has no painted type (light fraction ${stats.lightFraction.toFixed(5)} < ${MIN_LIGHT_FRACTION}). ` +
        "resvg dropped the <text> nodes — usually a missing font match."
    );
  }
}

export function pngLightStats(png) {
  const { width, height, data, channels } = decodePng(png);
  const pixels = width * height;
  let light = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    // Parchment / cream / amber glyphs. The ember wordmark dot (g≈122) stays out.
    if (r > 180 && g > 140) light += 1;
  }
  return { width, height, light, lightFraction: light / pixels };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 8-bit RGB or RGBA PNG (what resvg emits), or 8-bit indexed (what `toPalettePng` writes), as RGB(A). */
export function decodePng(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let plte = null;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + len;
    if (end + 4 > bytes.length) throw new Error("truncated PNG chunk");
    if (type === "IHDR") {
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
    } else if (type === "PLTE") {
      plte = bytes.subarray(start, end);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 3 && colorType !== 6)) {
    throw new Error(`unsupported PNG ihdr depth=${bitDepth} colorType=${colorType}`);
  }
  if (colorType === 3 && !plte) throw new Error("indexed PNG without a palette");
  const channels = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src];
    src += 1;
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const out = data.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      const x = row[i];
      if (filter === 0) out[i] = x;
      else if (filter === 1) out[i] = (x + left) & 255;
      else if (filter === 2) out[i] = (x + up) & 255;
      else if (filter === 3) out[i] = (x + ((left + up) >> 1)) & 255;
      else if (filter === 4) out[i] = (x + paeth(left, up, upLeft)) & 255;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    prev = Buffer.from(out);
  }
  if (colorType !== 3) return { width, height, channels, data };
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const entry = data[i] * 3;
    if (entry + 2 >= plte.length) throw new Error("PNG palette index out of range");
    rgb[i * 3] = plte[entry];
    rgb[i * 3 + 1] = plte[entry + 1];
    rgb[i * 3 + 2] = plte[entry + 2];
  }
  return { width, height, channels: 3, data: rgb };
}
