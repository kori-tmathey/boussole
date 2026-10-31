// Dessine l'icône (une boussole) en PNG, sans dépendance : `npm run icon` écrit build/icon.png (256 px).
// `png(size, { scale, mono })` sert aussi aux icônes Android (scripts/android-assets.js).
const fs = require('fs');
const zlib = require('zlib');

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const TEAL = hex('#2B7A7E'), RING = hex('#CFE5E3'), AMBER = hex('#F2B544'), CREAM = hex('#F4EFE6'), DARK = hex('#1D4E52');
const WHITE = [255, 255, 255];
const ANGLE = (35 * Math.PI) / 180;

// Point (x, y) dans un repère de 256 px. mono : silhouette blanche (icône de la barre de notifications).
function sample(x, y, mono) {
  const dx = x - 128, dy = y - 128, r = Math.hypot(dx, dy);
  if (r > 120) return null;
  // Repère tourné pour l'aiguille : u le long de l'aiguille, v en travers.
  const u = dx * Math.sin(ANGLE) - dy * Math.cos(ANGLE);
  const v = dx * Math.cos(ANGLE) + dy * Math.sin(ANGLE);
  const needle = Math.abs(u) < 88 && Math.abs(v) < 22 * (1 - Math.abs(u) / 88);
  if (mono) return needle || (r > 100 && r < 112) ? WHITE : null;
  if (r < 10) return DARK;
  if (needle) return u > 0 ? AMBER : CREAM;
  if (r > 100 && r < 106) return RING;
  return TEAL;
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

// scale < 1 : icône réduite au centre (zone sûre des icônes adaptatives Android).
function png(size, { scale = 1, mono = false } = {}) {
  const SS = 4, raw = Buffer.alloc((size * 4 + 1) * size), k = 256 / (size * scale), off = (size - size * scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = sample((x + (sx + 0.5) / SS - off) * k, (y + (sy + 0.5) / SS - off) * k, mono);
        if (c) { rr += c[0]; gg += c[1]; bb += c[2]; aa++; }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (aa) { raw[o] = rr / aa; raw[o + 1] = gg / aa; raw[o + 2] = bb / aa; }
      raw[o + 3] = Math.round((aa / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { png };

if (require.main === module) {
  fs.mkdirSync('build', { recursive: true });
  fs.writeFileSync('build/icon.png', png(256));
  console.log('build/icon.png écrit');
}
