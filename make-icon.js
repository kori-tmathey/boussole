// Dessine l'icône (une boussole) en PNG 256 px, sans dépendance : `npm run icon`.
const fs = require('fs');
const zlib = require('zlib');

const N = 256, SS = 4, C = N / 2;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const TEAL = hex('#2B7A7E'), RING = hex('#CFE5E3'), AMBER = hex('#F2B544'), CREAM = hex('#F4EFE6'), DARK = hex('#1D4E52');
const ANGLE = (35 * Math.PI) / 180;

function sample(x, y) {
  const dx = x - C, dy = y - C, r = Math.hypot(dx, dy);
  if (r > 120) return null;
  // Repère tourné pour l'aiguille : u le long de l'aiguille, v en travers.
  const u = dx * Math.sin(ANGLE) - dy * Math.cos(ANGLE);
  const v = dx * Math.cos(ANGLE) + dy * Math.sin(ANGLE);
  if (r < 10) return DARK;
  if (Math.abs(u) < 88 && Math.abs(v) < 22 * (1 - Math.abs(u) / 88)) return u > 0 ? AMBER : CREAM;
  if (r > 100 && r < 106) return RING;
  return TEAL;
}

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let rr = 0, gg = 0, bb = 0, aa = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
      if (c) { rr += c[0]; gg += c[1]; bb += c[2]; aa++; }
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    if (aa) { raw[o] = rr / aa; raw[o + 1] = gg / aa; raw[o + 2] = bb / aa; }
    raw[o + 3] = Math.round((aa / (SS * SS)) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type), body]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
  return Buffer.concat([len, tb, c]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log('build/icon.png écrit');
