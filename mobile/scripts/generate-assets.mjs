/**
 * CoreGrid Mobile — deterministic asset generator (placeholders to spec).
 *
 * Produces the icon/splash assets referenced by app.json as valid PNGs,
 * rendered from the CoreGrid brand tokens (dark navy field, light "grid
 * cell" motif). Run `npm run generate-assets` in mobile/ to (re)generate.
 * These are placeholder marks: final brand artwork is pending design
 * authority and must be replaced before public release.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/* ── PNG encoding (RGBA, 8-bit, no interlace) ─────────────────────────── */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── Rendering ────────────────────────────────────────────────────────── */

const hex = (value) => {
  const v = value.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

const NAVY = hex("#0B1F3A");
const SURFACE = hex("#122B4E");
const LIGHT = hex("#9DB2CE");

function render({ size, background, cells }) {
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], alpha = 255) => {
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = alpha;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      put(x, y, background);
    }
  }
  // Grid motif: cells.length × cells.length squares, centered.
  const gap = Math.round(size * 0.02);
  const cell = Math.round((size * 0.5 - gap) / cells.length - gap);
  const total = cells.length * cell + (cells.length - 1) * gap;
  const originX = Math.round((size - total) / 2);
  const originY = Math.round((size - total) / 2);
  for (let row = 0; row < cells.length; row += 1) {
    for (let col = 0; col < cells.length; col += 1) {
      if (!cells[row]?.[col]) continue;
      const x0 = originX + col * (cell + gap);
      const y0 = originY + row * (cell + gap);
      for (let y = y0; y < y0 + cell && y < size; y += 1) {
        for (let x = x0; x < x0 + cell && x < size; x += 1) {
          put(x, y, (row + col) % 2 === 0 ? LIGHT : SURFACE);
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

const grid3 = [
  [1, 0, 1],
  [0, 1, 0],
  [1, 0, 1],
];

const assets = {
  "icon.png": render({ size: 1024, background: NAVY, cells: grid3 }),
  "adaptive-icon.png": render({ size: 1024, background: NAVY, cells: grid3 }),
  "splash-icon.png": render({ size: 512, background: NAVY, cells: grid3 }),
  "favicon.png": render({ size: 48, background: NAVY, cells: grid3 }),
};

const outDir = join(root, "..", "assets");
mkdirSync(outDir, { recursive: true });
for (const [name, bytes] of Object.entries(assets)) {
  writeFileSync(join(outDir, name), bytes);
  console.log(`wrote assets/${name} (${bytes.length} bytes)`);
}