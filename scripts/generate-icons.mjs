/**
 * Generates the PWA icon set as PNGs, with no image dependencies.
 *
 * Why hand-rolled: `sharp`/`satori` are heavy native or wasm dependencies to add for four static
 * files that never change, and Cloudflare Workers cannot rasterise at request time cheaply. The
 * icons are drawn geometrically (a barbell) and committed as build artefacts.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const LIME = [0xc6, 0xff, 0x00];
const BLACK = [0x00, 0x00, 0x00];

// --- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode RGBA pixel data (Uint8Array, size*size*4) as a PNG buffer. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression, filter, interlace — all zero.

  // Each scanline is prefixed with filter byte 0 (None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing ----------------------------------------------------------------

function createCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function setPixel({ size, data }, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

function fillRect(canvas, x0, y0, w, h, colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(canvas, x, y, colour);
  }
}

/** Filled rounded rectangle, used for both the plate shapes and the icon backdrop. */
function fillRoundedRect(canvas, x0, y0, w, h, radius, colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      // Distance into the nearest corner box; outside the corner circle -> skip.
      const dx = Math.max(x0 + radius - x, 0, x - (x0 + w - 1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y0 + h - 1 - radius));
      if (dx * dx + dy * dy <= radius * radius) setPixel(canvas, x, y, colour);
    }
  }
}

/**
 * Draws the barbell mark.
 *
 * @param inset fraction of the canvas kept clear on every side. Maskable icons need the mark
 *   inside the safe zone (the outer ~10% can be cropped to a circle by the launcher), so they
 *   are drawn with a larger inset.
 */
function drawBarbell(canvas, inset) {
  const s = canvas.size;
  const pad = Math.round(s * inset);
  const cy = Math.round(s / 2);

  const barHeight = Math.max(2, Math.round(s * 0.075));
  const plateOuterH = Math.round(s * 0.42);
  const plateInnerH = Math.round(s * 0.28);
  const plateW = Math.max(2, Math.round(s * 0.085));
  const gap = Math.max(1, Math.round(s * 0.035));
  const radius = Math.max(1, Math.round(plateW * 0.35));

  // Bar spans the full usable width.
  fillRect(canvas, pad, cy - Math.floor(barHeight / 2), s - pad * 2, barHeight, LIME);

  // Two plates per side: a tall outer plate and a shorter inner one, mirrored.
  for (const side of [-1, 1]) {
    const centre = side === -1 ? pad : s - pad - plateW;
    const innerX = side === -1 ? pad + plateW + gap : s - pad - plateW * 2 - gap;
    fillRoundedRect(canvas, centre, cy - plateOuterH / 2, plateW, plateOuterH, radius, LIME);
    fillRoundedRect(canvas, innerX, cy - plateInnerH / 2, plateW, plateInnerH, radius, LIME);
  }
}

function buildIcon(size, { maskable }) {
  const canvas = createCanvas(size);
  if (maskable) {
    // Maskable icons must be fully opaque edge to edge; the launcher crops them.
    fillRect(canvas, 0, 0, size, size, BLACK);
    drawBarbell(canvas, 0.26);
  } else {
    // Rounded black tile so the mark reads on any home-screen wallpaper.
    fillRoundedRect(canvas, 0, 0, size, size, Math.round(size * 0.22), BLACK);
    drawBarbell(canvas, 0.16);
  }
  return encodePng(size, canvas.data);
}

const targets = [
  ["public/icons/icon-192.png", 192, { maskable: false }],
  ["public/icons/icon-512.png", 512, { maskable: false }],
  ["public/icons/icon-maskable-512.png", 512, { maskable: true }],
  // iOS ignores the manifest and uses this; it must not be transparent.
  ["public/icons/apple-touch-icon.png", 180, { maskable: true }],
];

mkdirSync("public/icons", { recursive: true });
for (const [path, size, options] of targets) {
  const png = buildIcon(size, options);
  writeFileSync(path, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
}
