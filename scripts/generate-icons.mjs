/**
 * Generates the shared app icon plus a Linux icon set from pure Node.js.
 * No extra npm packages needed.
 *
 * Outputs:
 * - assets/icon.png (1024x1024 RGBA)
 * - assets/icons/<size>x<size>.png for Linux packaging
 *
 * Run: node scripts/generate-icons.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MASTER_SIZE = 1024;
const LINUX_ICON_SIZES = [16, 32, 48, 64, 128, 256, 512];

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = (crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunkType = Buffer.from(type, 'ascii');
  return Buffer.concat([
    u32(data.length),
    chunkType,
    data,
    u32(crc32(Buffer.concat([chunkType, data]))),
  ]);
}

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function renderPixel(px, py, size) {
  const cx = (px / size - 0.5) * 2;
  const cy = (py / size - 0.5) * 2;
  const dist = Math.sqrt(cx * cx + cy * cy);

  const t = Math.min(1, dist / 1.1);
  let r = 76 + (59 - 76) * t;
  let g = 29 + (7 - 29) * t;
  let b = 149 + (100 - 149) * t;

  const outerR = 0.54;
  const innerFrac = 0.1;
  const angle = Math.atan2(cy, cx);
  const tip = Math.pow(Math.cos(2 * angle), 2);
  const starR = outerR * Math.sqrt(tip * (1 - innerFrac) + innerFrac);

  const edge = 0.022;
  const starAlpha = Math.max(0, Math.min(1, (starR - dist) / edge));
  const haloAlpha = dist > starR ? Math.max(0, 1 - (dist - starR) / 0.08) * 0.28 : 0;
  const glowAlpha = starAlpha * Math.max(0, 1 - dist / (outerR * 0.55)) * 0.5;
  const dotAlpha = Math.max(0, 1 - dist / 0.11);

  r += (196 - r) * haloAlpha;
  g += (181 - g) * haloAlpha;
  b += (253 - b) * haloAlpha;

  r += (255 - r) * starAlpha;
  g += (240 - g) * starAlpha;
  b += (210 - b) * starAlpha;

  r += (255 - r) * glowAlpha;
  g += (250 - g) * glowAlpha;
  b += (220 - b) * glowAlpha;

  r += (249 - r) * dotAlpha;
  g += (115 - g) * dotAlpha;
  b += (22 - b) * dotAlpha;

  return [clamp(r), clamp(g), clamp(b), 255];
}

function renderPng(size) {
  process.stdout.write(`Rendering ${size}x${size} icon`);
  const rows = [];

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const [rv, gv, bv, av] = renderPixel(x, y, size);
      const i = 1 + x * 4;
      row[i] = rv;
      row[i + 1] = gv;
      row[i + 2] = bv;
      row[i + 3] = av;
    }
    rows.push(row);
    if (size >= 256 && y % 256 === 0) {
      process.stdout.write('.');
    }
  }
  process.stdout.write('\n');

  const raw = Buffer.concat(rows);
  process.stdout.write('Compressing...');
  const compressed = zlib.deflateSync(raw, { level: 6 });
  process.stdout.write(' done\n');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const assetsDir = path.join(ROOT, 'assets');
const linuxIconsDir = path.join(assetsDir, 'icons');
if (!existsSync(assetsDir)) {
  mkdirSync(assetsDir, { recursive: true });
}
if (!existsSync(linuxIconsDir)) {
  mkdirSync(linuxIconsDir, { recursive: true });
}

const masterPng = renderPng(MASTER_SIZE);
writeFileSync(path.join(assetsDir, 'icon.png'), masterPng);
console.log(`Wrote assets/icon.png (${(masterPng.length / 1024).toFixed(0)} KB)`);

for (const size of LINUX_ICON_SIZES) {
  const png = renderPng(size);
  writeFileSync(path.join(linuxIconsDir, `${size}x${size}.png`), png);
  console.log(`Wrote assets/icons/${size}x${size}.png (${(png.length / 1024).toFixed(1)} KB)`);
}
