#!/usr/bin/env node
// Generate placeholder PNG icons for the Chrome extension.
//
// We don't have a designer yet, so this generates valid PNGs in the firefly
// brand orange (#FF8C42) with a darker inner square hinting at an "F" mark.
// Once we have proper art, replace public/icon/*.png and delete this script.
//
// Usage: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// WXT resolves publicDir relative to srcDir (which we set to 'src'),
// so static assets must live at src/public/, not the repo-root public/.
const outDir = join(__dirname, '..', 'src', 'public', 'icon');
mkdirSync(outDir, { recursive: true });

// --- PNG encoding (zero deps, RGBA) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makeIconPNG(size) {
  // RGBA pixel buffer.
  const stride = size * 4 + 1; // +1 filter byte per row
  const raw = Buffer.alloc(size * stride);
  // Outer firefly orange #FF8C42, inner darker #C25E1F square in the middle 60%.
  const outer = [0xff, 0x8c, 0x42, 0xff];
  const inner = [0xc2, 0x5e, 0x1f, 0xff];
  const innerLo = Math.floor(size * 0.2);
  const innerHi = Math.floor(size * 0.8);
  // Cut a vertical bar on the left of the inner square to hint at letter "F".
  const barLo = Math.floor(size * 0.28);
  const barHi = Math.floor(size * 0.4);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = y * stride + 1 + x * 4;
      const inSquare = x >= innerLo && x < innerHi && y >= innerLo && y < innerHi;
      const inBar = x >= barLo && x < barHi && y >= innerLo && y < innerHi;
      const px = inSquare && !inBar ? inner : outer;
      raw[i] = px[0]; raw[i + 1] = px[1]; raw[i + 2] = px[2]; raw[i + 3] = px[3];
    }
  }
  // IHDR: width, height, bit depth, color type, compression, filter, interlace
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 96, 128]) {
  const png = makeIconPNG(size);
  const target = join(outDir, `${size}.png`);
  writeFileSync(target, png);
  console.log(`  ✓ icon/${size}.png  (${png.length} bytes)`);
}
console.log('Done. Icons regenerated.');
