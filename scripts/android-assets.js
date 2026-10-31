// Ressources Android générées sans dépendance : icônes de l'appli, icône de notification, sons des sphères.
// Lancé après `npx cap add android` (et à chaque `npm run mobile`).
const fs = require('fs');
const path = require('path');
const { png } = require('../make-icon');

const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const put = (rel, buf) => { const f = path.join(res, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };

// Icônes de l'appli (classique, ronde, adaptative) et icône blanche de la barre de notifications.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  put(`mipmap-${d}/ic_launcher.png`, png(Math.round(48 * k)));
  put(`mipmap-${d}/ic_launcher_round.png`, png(Math.round(48 * k)));
  put(`mipmap-${d}/ic_launcher_foreground.png`, png(Math.round(108 * k), { scale: 0.62 }));
  put(`drawable-${d}/ic_stat_boussole.png`, png(Math.round(24 * k), { mono: true }));
}
put('values/ic_launcher_background.xml', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2B7A7E</color>\n</resources>\n'));

// Sons des notifications : les mêmes notes que dans l'appli (SOUNDS dans renderer/app.js).
const SOUNDS = {
  doux: [[523, 659], 'sine', 0.32], net: [[988, 1319], 'triangle', 0.1], cloche: [[784, 988, 1175], 'sine', 0.22],
  grave: [[392, 294], 'sine', 0.3], bulle: [[660, 880, 990, 1320], 'sine', 0.07],
};
const RATE = 44100;
function wav([notes, type, gap]) {
  const len = Math.ceil((gap * (notes.length - 1) + 1) * RATE), pcm = new Float32Array(len);
  notes.forEach((f, i) => {
    const start = Math.round(i * gap * RATE);
    for (let n = 0; n < RATE && start + n < len; n++) {
      const t = n / RATE, ph = (f * t) % 1;
      const wave = type === 'triangle' ? 4 * Math.abs(ph - 0.5) - 1 : Math.sin(2 * Math.PI * ph);
      const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 7.6); // attaque douce, extinction en ~0,9 s
      pcm[start + n] += 0.45 * wave * env;
    }
  });
  const buf = Buffer.alloc(44 + len * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, pcm[i])) * 32767, 44 + i * 2);
  return buf;
}
for (const [name, def] of Object.entries(SOUNDS)) put(`raw/${name}.wav`, wav(def));
console.log('ressources Android écrites');
