// Prépare mobile/www pour Capacitor : la même interface que sur PC, plus le pont Android (mobile-api.js).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..'), www = path.join(root, 'mobile', 'www');
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(www, to || from), { recursive: true });

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
copy('renderer');
copy('logic.js');
copy('build/icon.png');
for (const pkg of ['@fontsource/atkinson-hyperlegible', '@fontsource-variable/bricolage-grotesque']) {
  for (const f of ['400.css', '700.css', 'index.css', 'files']) {
    if (fs.existsSync(path.join(root, 'node_modules', pkg, f))) copy(`node_modules/${pkg}/${f}`);
  }
}

// Page d'accueil de Capacitor → l'interface.
fs.writeFileSync(path.join(www, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=renderer/index.html">');

// Version mobile de l'interface : écran de téléphone, accès à ntfy, pont Android chargé avant app.js.
const page = path.join(www, 'renderer', 'index.html');
let html = fs.readFileSync(page, 'utf8');
html = html
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  .replace("img-src 'self' data:", "img-src 'self' data:; connect-src 'self' https:")
  .replace('<script src="../logic.js"></script>', '<script src="../logic.js"></script>\n  <script src="mobile-api.js"></script>');
fs.writeFileSync(page, html);
console.log('mobile/www prêt');
