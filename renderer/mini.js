/* global L, api */
// Deux mini-fenêtres : le vide-tête rapide (raccourci global) et la carte de relance d'un rappel.
const q = new URLSearchParams(location.search);
const root = document.getElementById('root');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CAT = { facture: '💶', sante: '🩺', message: '💬', rdv: '📅', autre: '📌' };

function theme(s) {
  const night = L.isNight(s, new Date());
  document.documentElement.dataset.theme = s.theme === 'auto' ? (night ? s.nightTheme : s.dayTheme) : s.theme;
  if (s.accent) document.documentElement.style.setProperty('--primary', s.accent);
}

// Tab bascule la sphère avant de ranger.
async function capture(D) {
  let sphere = await api.captureSphere();
  const sp = k => D.settings.spheres[k];
  root.innerHTML = `<form class="mini-card capture">
    <div class="capture-row">
      <button type="button" class="sph-chip" id="sph" aria-label="Sphère (Tab pour changer)"></button>
      <input id="t" autocomplete="off" placeholder="Vide ta tête…" aria-label="Pensée à ranger">
    </div>
    <small class="hint">Entrée pour ranger, Tab pour changer de sphère, Échap pour fermer.</small></form>`;
  const input = document.getElementById('t'), chip = document.getElementById('sph');
  const paint = () => { chip.className = `sph-chip sph-${sphere}`; chip.textContent = `${sp(sphere).icon} ${sp(sphere).name}`; };
  const toggle = () => { sphere = sphere === 'pro' ? 'perso' : 'pro'; paint(); input.focus(); };
  paint();
  input.focus();
  chip.addEventListener('click', toggle);
  root.querySelector('form').addEventListener('submit', e => { e.preventDefault(); api.capture(input.value, sphere); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') api.closeMini();
    if (e.key === 'Tab') { e.preventDefault(); toggle(); }
  });
}

function nudge(D) {
  const r = D.reminders.find(x => x.id === q.get('id'));
  if (!r || r.done) return api.closeMini();
  const waited = (Date.now() - new Date(r.due)) / L.MIN;
  const sph = L.sphereOf(r), sp = D.settings.spheres[sph];
  root.innerHTML = `<div class="mini-card nudge sph-${sph}" role="alertdialog" aria-label="Rappel ${esc(sp.name)}">
    <div class="nudge-head"><span title="${esc(sp.name)}">${esc(sp.icon)}</span><span>${CAT[r.cat] || '📌'}</span>
      <span>${waited >= 1 ? 'En attente depuis ' + L.duration(waited) : 'Maintenant'}</span>
      <button class="x" data-a="close" aria-label="Masquer pour l'instant">×</button></div>
    <h2>${esc(r.title)}</h2>
    ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}
    <div class="row">
      <button class="btn small good" data-a="done">Fait</button>
      <button class="btn small soft" data-a="10">+10 min</button>
      <button class="btn small soft" data-a="60">+1 h</button>
      <button class="btn small ghost" data-a="tomorrow">Demain</button>
      <button class="link" data-a="open">Ouvrir</button>
    </div></div>`;
}

root.addEventListener('click', e => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (!a) return;
  if (a === 'close') api.closeMini();
  else if (a === 'open') api.open('rappels');
  else api.reminder(q.get('id'), a);
});

(async () => {
  const D = await api.get();
  theme(D.settings);
  if (q.get('mode') === 'capture') capture(D); else nudge(D);
})();
