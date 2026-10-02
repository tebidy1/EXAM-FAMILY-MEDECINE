/* ============================================================
   Renders the app icons (PNG) with no dependencies:

     node tools/make-icons.js

   The mark is an ECG trace on the brand ink. It is the same drawing
   as icons/icon.svg and the inline logo in js/app.js — keep the three
   in step if the mark changes.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'icons');
const INK = [12, 42, 52];
const TRACE = [255, 255, 255];
const DOT = [111, 211, 227];

// the mark in a 100x100 box
const PTS = [[14, 56], [35, 56], [44, 28], [56, 78], [64, 56], [86, 56]];
const STROKE = 7.5;
const DOT_R = 6.5;

function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// scale = how much of the canvas the mark fills (maskable icons keep it inside the safe zone)
function render(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  const toMark = (v) => ((v / size - 0.5) / scale + 0.5) * 100;
  const end = PTS[PTS.length - 1];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let trace = 0, dot = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const mx = toMark(x + (sx + 0.5) / SS), my = toMark(y + (sy + 0.5) / SS);
          let d = Infinity;
          for (let i = 0; i < PTS.length - 1; i++) d = Math.min(d, distToSeg(mx, my, PTS[i], PTS[i + 1]));
          if (Math.hypot(mx - end[0], my - end[1]) <= DOT_R) dot++;
          else if (d <= STROKE / 2) trace++;
        }
      }
      const n = SS * SS, bg = n - trace - dot, o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round((INK[c] * bg + TRACE[c] * trace + DOT[c] * dot) / n);
      px[o + 3] = 255;
    }
  }
  return px;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6;                       // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, scale] of [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, 0.6],
  ['apple-touch-icon.png', 180, 0.8],
]) {
  fs.writeFileSync(path.join(OUT, name), png(size, render(size, scale)));
  console.log('icons/' + name);
}
