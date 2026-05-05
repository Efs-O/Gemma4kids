/**
 * Generates assets/icon.png (1024×1024 RGBA) from pure Node.js —
 * no extra npm packages needed. electron-builder converts it to
 * .ico (Windows) and .icns (macOS) automatically.
 *
 * Run: node scripts/generate-icons.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SIZE = 1024;

// ── PNG helpers ─────────────────────────────────────────────────────────────

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

const _crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  _crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = (_crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))]);
}

// ── Icon renderer ─────────────────────────────────────────────────────────
// Design: deep-purple radial bg + white 4-pointed sparkle + coral centre dot

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function renderPixel(px, py) {
  // Normalised coords: -1..1
  const cx = (px / SIZE - 0.5) * 2;
  const cy = (py / SIZE - 0.5) * 2;
  const dist = Math.sqrt(cx * cx + cy * cy);

  // Background: dark purple radial gradient (#3b0764 → #4c1d95)
  const t = Math.min(1, dist / 1.1);
  let r = 76  + (59  - 76)  * t;  // #4c1d95 → #3b0764
  let g = 29  + (7   - 29)  * t;
  let b = 149 + (100 - 149) * t;

  // ── 4-pointed sparkle ──
  // starR(angle) = outerR * sqrt(cos²(2θ) * (1-f) + f), tips at 0/90/180/270°
  const outerR    = 0.54;
  const innerFrac = 0.10;
  const angle     = Math.atan2(cy, cx);
  const tip       = Math.pow(Math.cos(2 * angle), 2);
  const starR     = outerR * Math.sqrt(tip * (1 - innerFrac) + innerFrac);

  // Anti-aliased fill
  const edge      = 0.022;
  const starAlpha = Math.max(0, Math.min(1, (starR - dist) / edge));

  // Soft lavender halo around star
  const haloAlpha = dist > starR
    ? Math.max(0, 1 - (dist - starR) / 0.08) * 0.28
    : 0;

  // Inner warm glow
  const glowAlpha = starAlpha * Math.max(0, 1 - dist / (outerR * 0.55)) * 0.5;

  // Coral centre dot (#f97316)
  const dotAlpha = Math.max(0, 1 - dist / 0.11);

  // Composite (back to front)
  r += (196 - r) * haloAlpha;  // lavender halo
  g += (181 - g) * haloAlpha;
  b += (253 - b) * haloAlpha;

  r += (255 - r) * starAlpha;  // white sparkle
  g += (240 - g) * starAlpha;
  b += (210 - b) * starAlpha;

  r += (255 - r) * glowAlpha;  // inner warm glow
  g += (250 - g) * glowAlpha;
  b += (220 - b) * glowAlpha;

  r += (249 - r) * dotAlpha;   // coral dot
  g += (115 - g) * dotAlpha;
  b += (22  - b) * dotAlpha;

  return [clamp(r), clamp(g), clamp(b), 255];
}

// ── Build raw pixel data ─────────────────────────────────────────────────

process.stdout.write(`Rendering ${SIZE}×${SIZE} icon`);
const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  row[0] = 0; // filter: None
  for (let x = 0; x < SIZE; x++) {
    const [rv, gv, bv, av] = renderPixel(x, y);
    const i = 1 + x * 4;
    row[i] = rv; row[i + 1] = gv; row[i + 2] = bv; row[i + 3] = av;
  }
  rows.push(row);
  if (y % 256 === 0) process.stdout.write('.');
}
process.stdout.write('\n');

const raw = Buffer.concat(rows);
process.stdout.write('Compressing...');
const compressed = zlib.deflateSync(raw, { level: 6 });
process.stdout.write(' done\n');

// ── Assemble PNG ─────────────────────────────────────────────────────────

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(ROOT, 'assets');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'icon.png');
writeFileSync(outPath, png);
console.log(`✓ assets/icon.png  (${(png.length / 1024).toFixed(0)} KB)`);
