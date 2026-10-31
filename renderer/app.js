/* global L, api, AGENDA_ACT, AGENDA_FORM, pageAgenda, renderSheet, afterAgendaRender, openSheet, sheet */
let D;                 // toutes les données, reçues du processus principal
let view = 'aujourdhui';
let draft = null;      // rappel en cours de saisie
let teteTab = 'tri';
let shortcutOk = true;
let pendingRender = false;
let lastTitlebar = '';
let sphereOverride = null; // choix manuel en mode auto, valable jusqu'au prochain changement d'horaire
let lastAuto = null;
let lastSphere = null;

const $ = (s, el = document) => el.querySelector(s);
const S = () => D.settings;
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDay = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const rel = d => (L.dayKey(d) === L.dayKey(new Date()) ? "aujourd'hui" : fmtDay(d)) + ', ' + L.clock(d);
const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const CATS = { facture: ['💶', 'Facture, paiement'], sante: ['🩺', 'Santé'], message: ['💬', 'Message à rendre'], rdv: ['📅', 'Rendez-vous'], autre: ['📌', 'Autre'] };
const WX = [[1, '⛈️', 'Orage'], [2, '🌧️', 'Pluie'], [3, '☁️', 'Nuages'], [4, '🌤️', 'Éclaircie'], [5, '☀️', 'Soleil']];
const ENERGY = ['Vide', 'Basse', 'Moyenne', 'Bonne', 'Pleine'];
const TENSION = ['Détendu', 'Calme', 'Un peu tendu', 'Tendu', 'Sous pression'];
const THEMES = {
  lagune: ['Lagune', 'Sarcelle apaisante : se concentrer sans tension.'],
  foret: ['Forêt', 'Verts doux : sécurité et progrès.'],
  aube: ['Aube', 'Prune et rosé : chaleureux, enveloppant.'],
  ardoise: ['Ardoise', 'Sombre et frais, peu de lumière.'],
  veilleuse: ['Veilleuse', 'Ambre chaud sans bleu : prépare au sommeil.'],
  braise: ['Braise', 'Très sombre et chaud, pour la nuit.'],
  contraste: ['Contraste', 'Lisibilité maximale.'],
};

const ICON = {
  aujourdhui: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  rappels: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 13V9M9 2h6"/>',
  tete: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  soir: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  meteo: '<path d="M12 3v1.5M5.6 5.6l1 1M3 12h1.5"/><path d="M8.5 11a4 4 0 0 1 7.6-1.2"/><path d="M9 20a3.5 3.5 0 0 1 0-7h.3a5 5 0 0 1 9.4 1.6A3 3 0 0 1 18 20z"/>',
  reglages: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  retrouver: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const NAV = [
  ['aujourdhui', "Aujourd'hui", null],
  ['agenda', 'Agenda', 'agenda'],
  ['rappels', 'Rappels', 'rappels'],
  ['focus', 'Focus', 'focus'],
  ['tete', 'Vide-tête', 'tete'],
  ['soir', 'Ce soir', 'soir'],
  ['meteo', 'Météo intérieure', 'meteo'],
  ['retrouver', 'Retrouver', null],
];

const REPEATS = [['none', 'Jamais'], ['daily', 'Chaque jour'], ['weekdays', 'En semaine'], ['weekly', 'Chaque semaine'], ['monthly', 'Chaque mois'], ['yearly', 'Chaque année']];
const repeatLabel = r => (REPEATS.find(x => x[0] === r) || [])[1] || '';
const repeatMark = x => (x.repeat && x.repeat !== 'none' ? ` <span class="repeat" title="${repeatLabel(x.repeat)}">↻</span>` : '');
let searchQuery = '';

// Message quand un créneau est déjà pris (tâche ou événement, Perso comme Pro).
function conflictMessage(c) {
  const sp = S().spheres[c.sphere];
  const end = c.end || new Date(c.start.getTime() + 30 * L.MIN);
  return `Tu as déjà « ${c.title} » (${sp.icon} ${sp.name}) de ${L.clock(c.start)} à ${L.clock(end)}. Choisis un autre moment : une chose à la fois.`;
}

// ---------- Sphères Perso / Pro ----------

function currentSphere() {
  const s = S();
  if (s.sphereMode !== 'auto') return s.sphereView;
  const auto = L.autoSphere(s, new Date());
  if (auto !== lastAuto) { lastAuto = auto; sphereOverride = null; }
  return sphereOverride || auto;
}
const inSphere = x => { const c = currentSphere(); return c === 'tout' || L.sphereOf(x) === c; };
const defaultSphere = () => { const c = currentSphere(); return c === 'tout' ? L.autoSphere(S(), new Date()) : c; };
const sphTag = x => (currentSphere() === 'tout'
  ? `<span class="sph-tag sph-${L.sphereOf(x)}" title="${esc(S().spheres[L.sphereOf(x)].name)}">${esc(S().spheres[L.sphereOf(x)].icon)}</span>` : '');
const noteCount = x => (x.notes && x.notes.length ? `<span class="note-count" title="Notes">📝 ${x.notes.length}</span>` : '');

// ---------- Rendu ----------

async function save(rerender = true) {
  const r = await api.set(D);
  D.rev = r.rev;
  shortcutOk = r.shortcutOk;
  if (rerender) render();
}

const isTyping = () => !!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea, select');
const isBusy = () => isTyping() || (B.on && view === 'soir');

function applyTheme() {
  const s = S(), night = L.isNight(s, new Date());
  const theme = s.theme === 'auto' ? (night ? s.nightTheme : s.dayTheme) : s.theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.motion = s.reduceMotion ? 'reduce' : 'ok';
  root.dataset.sphere = currentSphere();
  root.style.fontSize = (16 * s.textScale) / 100 + 'px';
  for (const [prop, val] of [['--primary', s.accent], ['--perso', s.persoColor], ['--pro', s.proColor]]) {
    if (val) root.style.setProperty(prop, val); else root.style.removeProperty(prop);
  }
  const key = theme + s.accent;
  if (key !== lastTitlebar) {
    lastTitlebar = key;
    const cs = getComputedStyle(root);
    api.titlebar(cs.getPropertyValue('--bg').trim(), cs.getPropertyValue('--ink').trim());
  }
}

function render() {
  applyTheme();
  lastSphere = currentSphere();
  if (!enabled(view)) view = 'aujourdhui';
  $('#nav').innerHTML = navHTML();
  const v = $('#view');
  v.dataset.sec = view;
  v.innerHTML = `<div class="wrap ${view === 'agenda' ? 'wide' : ''}">${PAGES[view]()}</div>`;
  renderSheet();
  updateFocusUI();
  if (view === 'reglages') { fillBackupStatus(); fillLinkStatus(); fillUpdateStatus(); }
  if (view === 'agenda') afterAgendaRender();
}

const enabled = v => { const m = (NAV.find(n => n[0] === v) || [])[2]; return !m || S().modules[m]; };

function sphereSwitch() {
  const s = S(), cur = currentSphere();
  const label = k => (k === 'tout' ? 'Tout' : `${esc(s.spheres[k].icon)} ${esc(s.spheres[k].name)}`);
  const hint = s.sphereMode !== 'auto' ? 'Choix manuel'
    : sphereOverride ? 'Choisi à la main jusqu\'au prochain changement d\'horaire'
    : L.isWork(s, new Date()) ? `Auto : travail jusqu'à ${s.workEnd}` : 'Auto : hors travail';
  return `<div class="sphere-switch" role="group" aria-label="Sphère affichée">${['perso', 'pro', 'tout'].map(k =>
    `<button class="sw-${k} ${cur === k ? 'on' : ''}" data-act="sphere" data-k="${k}" aria-pressed="${cur === k}">${label(k)}</button>`).join('')}</div>
    <p class="sphere-hint">${hint}</p>`;
}

function navHTML() {
  const t = new Date();
  const due = D.reminders.filter(r => !r.done && r.due && effective(r) <= t && inSphere(r)).length;
  const tri = D.ideas.filter(i => !i.parked && inSphere(i)).length;
  const badge = { rappels: due, tete: tri };
  const item = ([k, label]) => `
    <button class="nav-item ${view === k ? 'on' : ''}" data-sec="${k}" data-act="go" data-view="${k}" ${view === k ? 'aria-current="page"' : ''}>
      ${svg(k)}<span>${label}</span>
      ${k === 'focus' ? '<span class="badge timer" id="nav-timer"></span>' : badge[k] ? `<span class="badge">${badge[k]}</span>` : ''}
    </button>`;
  return `<div class="brand"><img src="../build/icon.png" alt="">Boussole</div>
    ${sphereSwitch()}
    ${NAV.filter(n => enabled(n[0])).map(item).join('')}
    <div class="nav-spacer"></div>
    ${item(['reglages', 'Réglages'])}`;
}

function head(title, sub) {
  return `<header class="page-head"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</header>`;
}

// ---------- Aujourd'hui ----------

const effective = r => new Date(Math.max(new Date(r.due), r.snoozedUntil ? new Date(r.snoozedUntil) : 0));

function taskForm(placeholder) {
  return `<form class="task-form" data-form="task">
    <label class="f">La tâche<input name="title" required placeholder="${placeholder}" autocomplete="off"></label>
    <label class="f">Sa toute première étape<input name="firstStep" placeholder="Ex. : ouvrir le site" autocomplete="off"></label>
    <button class="btn">Ajouter</button>
  </form>`;
}

function rail() {
  const s = S(), t = new Date(), bed = L.bedtimeFor(s, t);
  if (t >= bed) {
    const late = (t - bed) / L.MIN;
    return `<section class="rail past"><p>${late > 180
      ? `Tu es debout tôt. Ta journée commence officiellement à ${s.wake}.`
      : `L'heure du coucher (${s.bedtime}) est passée depuis ${L.duration(late)}. <button class="link" data-act="go" data-view="soir">Fermer la journée</button>`}</p></section>`;
  }
  const len = ((L.hm(s.bedtime) - L.hm(s.wake) + 1440) % 1440 || 1440) * L.MIN;
  const start = new Date(bed - len);
  const pct = d => Math.min(100, Math.max(0, ((d - start) / len) * 100));
  const nowP = pct(t);
  let ticks = '';
  const h = new Date(start); h.setMinutes(0, 0, 0);
  for (let x = h.getTime() + 3600e3; x < bed; x += 2 * 3600e3) {
    const p = pct(new Date(x));
    if (Math.abs(p - nowP) > 5) ticks += `<span class="tick" style="left:${p}%">${new Date(x).getHours()} h</span>`;
  }
  const pins = L.agendaItems(D, start, bed).filter(x => !x.allDay && !x.done && inSphere(x))
    .map(x => `<span class="pin sph-${x.sphere} k-${x.kind}" tabindex="0" style="left:${pct(x.start)}%"><b>${esc(x.title)}, ${L.clock(x.start)}</b></span>`)
    .join('');
  return `<section class="rail" aria-label="Temps restant avant le coucher">
    <p class="rail-text">Il te reste <strong>${L.duration((bed - t) / L.MIN)}</strong> avant le coucher, à ${s.bedtime}.</p>
    <div class="track">
      <div class="elapsed" style="width:${nowP}%"></div>
      ${ticks}${pins}
      <div class="now-mark" style="left:${nowP}%"><span>${L.clock(t)}</span></div>
    </div>
  </section>`;
}

function pageToday() {
  const s = S(), t = new Date(), hr = t.getHours(), today = L.dayKey(t);
  const greet = hr < 5 ? 'Encore debout' : hr < 12 ? 'Bonjour' : hr < 18 ? 'Bon après-midi' : 'Bonsoir';
  const mine = D.tasks.filter(x => !x.done && inSphere(x));
  const tasks = mine.filter(x => !x.date || x.date <= today);
  const later = mine.length - tasks.length;
  const cur = tasks[0];
  const date = cap(t.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const when = x => (x.date ? `<small>${x.date === today ? "Aujourd'hui" : cap(fmtDay(new Date(x.date + 'T12:00')))}${x.time ? ', ' + x.time : ''}</small>` : '');

  const now = cur ? `
    <p class="kicker">${sphTag(cur)}Maintenant, une seule chose</p>
    <h2 class="now-title">${esc(cur.title)}${repeatMark(cur)}</h2>
    ${cur.firstStep
      ? `<p class="now-step"><span>Première petite étape</span>${esc(cur.firstStep)}</p>`
      : `<form class="now-step row" data-form="step" data-id="${cur.id}">
           <label class="f" style="flex:1">Première petite étape, même ridicule
             <input name="firstStep" required placeholder="Ex. : ouvrir le document" autocomplete="off"></label>
           <button class="btn soft">OK</button></form>`}
    <div class="row">
      <button class="btn" data-act="two" data-id="${cur.id}">Juste 2 minutes</button>
      ${s.modules.focus ? `<button class="btn soft" data-act="focusTask" data-id="${cur.id}">Focus ${s.focusDefault} min</button>` : ''}
      <button class="btn good" data-act="taskDone" data-id="${cur.id}">C'est fait</button>
      <button class="btn ghost" data-act="taskLater" data-id="${cur.id}">Pas maintenant</button>
      <button class="btn ghost" data-act="open" data-type="task" data-id="${cur.id}">Modifier, notes${noteCount(cur)}</button>
    </div>`
    : `<p class="kicker">Maintenant</p>
       <h2 class="now-title quiet">Qu'est-ce qui compte, là, tout de suite ?</h2>
       ${taskForm('Ex. : payer la facture Orange')}`;

  const rest = tasks.slice(1);
  const next = `<section class="next">
    <h3>Ensuite</h3>
    ${rest.length ? `<ul class="list">${rest.map(x => `
      <li><button class="check" data-act="taskDone" data-id="${x.id}" aria-label="Marquer « ${esc(x.title)} » comme fait"></button>
        <div><button class="row-open" data-act="open" data-type="task" data-id="${x.id}">${sphTag(x)}${esc(x.title)}${repeatMark(x)}${noteCount(x)}</button>
          ${x.firstStep ? `<small>${esc(x.firstStep)}</small>` : ''}${when(x)}</div>
        <button class="btn small soft" data-act="taskNow" data-id="${x.id}">Maintenant</button>
        <button class="x" data-act="taskDel" data-id="${x.id}" aria-label="Supprimer">×</button></li>`).join('')}</ul>`
      : `<p class="empty">Rien d'autre. Une chose à la fois, c'est parfait.</p>`}
    ${later ? `<p class="hint" style="margin-top:10px">${later} tâche${later > 1 ? 's' : ''} prévue${later > 1 ? 's' : ''} plus tard. <button class="link" data-act="go" data-view="agenda">Voir l'agenda</button></p>` : ''}
    ${cur ? taskForm('Une autre chose à faire') : ''}
  </section>`;

  const due = s.modules.rappels ? D.reminders.filter(r => !r.done && r.due && effective(r) <= t && inSphere(r)) : [];
  const wins = L.winsOn(D, t);
  const todayMood = D.moods.filter(m => L.dayKey(new Date(m.at)) === today).pop();
  const agendaToday = s.modules.agenda
    ? L.agendaItems(D, t, L.addDays(new Date(today + 'T00:00'), 1)).filter(x => x.kind !== 'reminder' && !x.done && inSphere(x)).slice(0, 4) : [];
  const upcoming = D.reminders.filter(r => !r.done && r.due && effective(r) > t && inSphere(r)).sort((a, b) => effective(a) - effective(b))[0];

  const side = `<aside class="side">
    ${due.length ? `<div class="due-box"><h3>À faire maintenant</h3>${due.map(r => `
      <div class="due-item"><b>${sphTag(r)}${CATS[r.cat]?.[0] || '📌'} ${esc(r.title)}</b>
        <div class="row" style="margin-top:6px">
          <button class="btn small good" data-act="remDone" data-id="${r.id}">Fait</button>
          <button class="btn small ghost" data-act="remSnooze" data-id="${r.id}" data-m="60">Dans 1 h</button>
        </div></div>`).join('')}</div>` : ''}
    ${agendaToday.length ? `<div><h3>Encore aujourd'hui</h3><ul class="mini-agenda">${agendaToday.map(x => `
      <li><button class="row-open sph-${x.sphere}" data-act="open" data-type="${x.kind}" data-id="${x.id}">
        <span class="ag-time">${x.allDay ? 'Journée' : L.clock(x.start)}</span>${esc(x.title)}</button></li>`).join('')}</ul></div>` : ''}
    <div>
      <div class="wins-head"><span class="wins-count">${wins.length}</span><h3>Victoire${wins.length > 1 ? 's' : ''} du jour</h3></div>
      ${wins.length ? `<ul class="wins-list">${wins.slice(0, 6).map(w => `<li>${esc(w.text)}</li>`).join('')}</ul>`
        : `<p class="hint" style="margin-top:10px">La première peut être minuscule. Boire un verre d'eau, ça compte.</p>`}
    </div>
    ${s.modules.meteo ? `<div><h3>Météo intérieure</h3>${todayMood
      ? `<p>${WX[todayMood.mood - 1][1]} ${WX[todayMood.mood - 1][2]}, à ${L.clock(new Date(todayMood.at))}. <button class="link" data-act="go" data-view="meteo">Mettre à jour</button></p>`
      : `<div class="wx-quick">${WX.map(([v, e, l]) => `<button data-act="moodQuick" data-v="${v}" title="${l}" aria-label="${l}">${e}</button>`).join('')}</div>`}</div>` : ''}
    ${s.modules.rappels && upcoming ? `<div><h3>Prochain rappel</h3><p>${esc(upcoming.title)}<br><span class="hint">${cap(rel(effective(upcoming)))}</span></p></div>` : ''}
  </aside>`;

  return head(`${greet}${s.prenom ? ', ' + esc(s.prenom) : ''}.`, `${date}, ${L.clock(t)}`) +
    `<div class="today"><div><section class="now">${now}</section>${rail()}${next}</div>${side}</div>`;
}

// ---------- Rappels ----------

function whenLabel(r) {
  switch (r.kind) {
    case 'once': return 'Le ' + fmtDay(new Date(r.date + 'T00:00')) + ' à ' + r.time;
    case 'daily': return 'Chaque jour à ' + r.time;
    case 'weekdays': return 'En semaine à ' + r.time;
    case 'weekly': return 'Chaque ' + WD[r.weekday] + ' à ' + r.time;
    case 'monthly': return `Le ${r.monthDay} de chaque mois à ${r.time}`;
    case 'yearly': return `Chaque année le ${new Date(r.date + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${r.time}`;
    default: return '';
  }
}

function stateLabel(r, t) {
  if (r.done) return 'Fait le ' + fmtDay(new Date(r.doneAt));
  if (r.snoozedUntil && new Date(r.snoozedUntil) > t) return 'Reporté à ' + rel(new Date(r.snoozedUntil));
  const due = new Date(r.due);
  if (due <= t) return 'En attente depuis ' + L.duration((t - due) / L.MIN);
  return 'Prochain : ' + rel(due);
}

function defaultDraft() {
  const t = new Date(), m = Math.ceil((t.getHours() * 60 + t.getMinutes() + 60) / 5) * 5;
  return { kind: 'once', date: L.dayKey(t), time: L.toHM(m), cat: 'autre', nag: '', weekday: 1, monthDay: t.getDate(), title: '', note: '', sphere: defaultSphere() };
}

const TEMPLATES = [
  { label: 'Facture Orange', title: 'Payer la facture Orange', cat: 'facture', kind: 'monthly', monthDay: 5, time: '11:00', sphere: 'perso' },
  { label: 'Répondre à un message', title: 'Répondre à ', cat: 'message', kind: 'once' },
  { label: 'Prendre mon traitement', title: 'Prendre mon traitement', cat: 'sante', kind: 'daily', time: '11:00', nag: 5, sphere: 'perso' },
  { label: 'Prendre un rendez-vous médical', title: 'Appeler pour prendre rendez-vous', cat: 'sante', kind: 'once', sphere: 'perso' },
  { label: 'Donner des nouvelles', title: 'Appeler ou écrire à quelqu\'un que j\'aime', cat: 'message', kind: 'weekly', weekday: 0, time: '18:00', sphere: 'perso' },
  { label: 'Point de fin de semaine (Pro)', title: 'Faire le point sur ma semaine de travail', cat: 'autre', kind: 'weekly', weekday: 5, time: '16:30', sphere: 'pro' },
];

const opt = (v, l, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`;

// Champs d'un rappel, partagés par le formulaire de création et la fiche.
function reminderFields(f) {
  const t = new Date();
  return `
    <input type="hidden" name="id" value="${esc(f.id || '')}">
    <label class="f wide">Quoi ?<input name="title" required value="${esc(f.title)}" placeholder="Payer la facture Orange" autocomplete="off"></label>
    <label class="f">Catégorie<select name="cat">${Object.entries(CATS).map(([k, [e, l]]) => opt(k, `${e} ${l}`, f.cat)).join('')}</select></label>
    <label class="f">Répétition<select name="kind" data-kind-select>
      ${opt('once', 'Une seule fois', f.kind)}${opt('daily', 'Chaque jour', f.kind)}${opt('weekdays', 'En semaine', f.kind)}${opt('weekly', 'Chaque semaine', f.kind)}${opt('monthly', 'Chaque mois', f.kind)}${opt('yearly', 'Chaque année (anniversaire…)', f.kind)}
    </select></label>
    <label class="f only only-once only-yearly">Date<input type="date" name="date" value="${esc(f.date || L.dayKey(t))}"></label>
    <label class="f only only-weekly">Jour<select name="weekday">${[1, 2, 3, 4, 5, 6, 0].map(d => opt(d, cap(WD[d]), f.weekday)).join('')}</select></label>
    <label class="f only only-monthly">Jour du mois<input type="number" name="monthDay" min="1" max="31" value="${esc(f.monthDay || t.getDate())}"></label>
    <label class="f">Heure<input type="time" name="time" required value="${esc(f.time)}"></label>
    <label class="f">Relancer<select name="nag">
      ${opt('', `Par défaut (${S().nagEvery ? S().nagEvery + ' min' : 'jamais'})`, f.nag ?? '')}
      ${[5, 10, 15, 30, 60].map(m => opt(m, `Toutes les ${m} min`, f.nag ?? '')).join('')}${opt(0, 'Jamais', f.nag ?? '')}
    </select></label>
    <label class="f wide">Note utile<input name="note" value="${esc(f.note)}" placeholder="Lien, numéro, détail…" autocomplete="off"></label>
    <label class="set-row wide" style="padding:4px 0;border:0"><span><b>Urgent</b><small>Sonne même pendant les heures calmes et hors horaires.</small></span>
      <input type="checkbox" class="switch" name="urgent" ${f.urgent ? 'checked' : ''}></label>`;
}

function remRow(r, t) {
  return `<li class="rem"><span class="cat" aria-hidden="true">${CATS[r.cat]?.[0] || '📌'}</span>
    <div><button class="row-open" data-act="open" data-type="reminder" data-id="${r.id}">${sphTag(r)}<b>${esc(r.title)}</b></button>${r.urgent ? ' <span class="tag">Urgent</span>' : ''}${noteCount(r)}
      <small>${whenLabel(r)}. ${stateLabel(r, t)}${r.note ? `<br>${esc(r.note)}` : ''}</small>
      ${r.done ? '' : `<div class="row" style="margin-top:10px">
        <button class="btn small good" data-act="remDone" data-id="${r.id}">Fait</button>
        <button class="btn small ghost" data-act="remSnooze" data-id="${r.id}" data-m="60">+1 h</button>
        <button class="btn small ghost" data-act="open" data-type="reminder" data-id="${r.id}">Modifier, notes</button></div>`}</div>
    <button class="x" data-act="remDel" data-id="${r.id}" aria-label="Supprimer">×</button></li>`;
}

function pageReminders() {
  const t = new Date(), today = L.dayKey(t);
  const active = D.reminders.filter(r => !r.done && r.due && inSphere(r)).sort((a, b) => effective(a) - effective(b));
  const groups = [
    ['overdue', 'Maintenant', active.filter(r => effective(r) <= t)],
    ['', "Aujourd'hui", active.filter(r => effective(r) > t && L.dayKey(effective(r)) === today)],
    ['', 'Plus tard', active.filter(r => L.dayKey(effective(r)) > today)],
    ['finished', 'Terminés', D.reminders.filter(r => r.done && inSphere(r)).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 8)],
  ].filter(g => g[2].length);

  const f = draft || defaultDraft();
  const form = `<form class="panel rem-form" data-form="reminder" data-kind="${f.kind}">
    <h2 class="sec-title">Nouveau rappel</h2>
    <div class="wide">${spherePickHTML(f)}</div>
    ${reminderFields(f)}
    <div class="row"><button class="btn">Créer le rappel</button>
      ${draft ? '<button type="button" class="btn ghost" data-act="remCancel">Annuler</button>' : ''}</div>
  </form>`;

  return head('Rappels', 'Ce que ta mémoire n\'a pas à porter. Ils reviennent jusqu\'à ce que tu cliques « Fait », sans reproche.') +
    `<div class="chips" style="margin-bottom:28px">${TEMPLATES.map((x, i) => `<button class="chip" data-act="tpl" data-i="${i}">${esc(x.label)}</button>`).join('')}</div>
    <div class="rem-layout"><div>${groups.length ? groups.map(([cls, title, list]) => `
      <section class="group ${cls}"><h3>${title} <span>${list.length}</span></h3><ul class="list">${list.map(r => remRow(r, t)).join('')}</ul></section>`).join('')
      : '<p class="empty">Aucun rappel ici. Commence par la chose que tu oublies le plus souvent, avec un modèle ci-dessus.</p>'}
    </div>${form}</div>`;
}

function spherePickHTML(x) {
  const cur = L.sphereOf(x);
  return `<div class="sph-pick" role="radiogroup" aria-label="Sphère">${['perso', 'pro'].map(k => `
    <label class="sph-${k}"><input type="radio" name="sphere" value="${k}" ${cur === k ? 'checked' : ''}>
      <span>${esc(S().spheres[k].icon)} ${esc(S().spheres[k].name)}</span></label>`).join('')}</div>`;
}

// ---------- Focus ----------

const F = { total: 0, left: 0, endAt: 0, running: false, label: '' };

function sectorPath(f) {
  if (f >= 0.9999) return 'M100 6 A94 94 0 1 1 99.99 6 Z';
  if (f <= 0) return '';
  const a = f * 2 * Math.PI, x = 100 + 94 * Math.sin(a), y = 100 - 94 * Math.cos(a);
  return `M100 100 L100 6 A94 94 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

const mmss = ms => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${L.pad(s % 60)}`; };

function updateFocusUI() {
  const total = F.total || S().focusDefault * L.MIN, left = F.total ? F.left : total;
  const f = left / total;
  const sec = $('#sector');
  if (sec) {
    sec.setAttribute('d', sectorPath(f));
    sec.classList.toggle('ending', F.running && f < 0.2);
    $('#ftime').textContent = F.total && !F.running && F.left <= 0 ? 'Terminé' : mmss(left);
  }
  const nt = $('#nav-timer');
  if (nt) nt.textContent = F.running ? mmss(F.left) : '';
}

function pageFocus() {
  const total = F.total || S().focusDefault * L.MIN;
  const m = Math.round(total / L.MIN);
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    ticks += `<line class="disc-tick" x1="${100 + 84 * Math.sin(a)}" y1="${100 - 84 * Math.cos(a)}" x2="${100 + 94 * Math.sin(a)}" y2="${100 - 94 * Math.cos(a)}"/>`;
  }
  const state = F.running ? 'running' : F.total && F.left > 0 && F.left < F.total ? 'paused' : 'idle';
  return head('Focus', 'Tu n\'as pas besoin de sentir le temps. Regarde-le partir.') + `
    <div class="focus">
      <div class="disc-wrap">
        <svg class="disc" viewBox="0 0 200 200" role="img" aria-label="Temps restant">
          <circle class="disc-bg" cx="100" cy="100" r="96"/>
          <path id="sector" class="disc-sector"/>
          ${ticks}
          <circle class="disc-center" cx="100" cy="100" r="46"/>
        </svg>
        <div class="disc-time" id="ftime" aria-live="off"></div>
      </div>
      <div class="focus-side">
        <label class="f">Sur quoi ?<input id="flabel" value="${esc(F.label)}" placeholder="Ex. : trier mes mails" autocomplete="off"></label>
        <div><p class="f" style="margin-bottom:8px">Durée</p>
          <div class="chips">${[2, 5, 15, 25, 45, 60].map(x => `<button class="chip ${x === m ? 'on' : ''}" data-act="fset" data-m="${x}" ${F.running ? 'disabled' : ''}>${x} min</button>`).join('')}
            <input id="fcustom" type="number" min="1" max="240" placeholder="Autre" style="width:90px" ${F.running ? 'disabled' : ''} aria-label="Autre durée en minutes"></div></div>
        <div class="row">
          ${state === 'running' ? '<button class="btn" data-act="fpause">Pause</button>'
            : state === 'paused' ? '<button class="btn" data-act="fresume">Reprendre</button>'
            : '<button class="btn" data-act="fstart">Démarrer</button>'}
          ${state !== 'idle' ? '<button class="btn ghost" data-act="fstop">Arrêter</button>' : ''}
        </div>
        <p class="hint">Commencer, c'est le plus dur : 2 minutes suffisent souvent à lancer la machine. À la fin, tu as une notification, un petit son et une victoire.</p>
      </div>
    </div>`;
}

function fStart(min, label) {
  if (label !== undefined) F.label = label;
  F.total = min * L.MIN; F.left = F.total; F.endAt = Date.now() + F.total; F.running = true;
  view = 'focus'; render();
}

function fFinish() {
  F.running = false; F.left = 0;
  const m = Math.round(F.total / L.MIN);
  const what = `${m} min de focus${F.label ? ' : ' + F.label : ''}`;
  api.notify(L.msg(S().tone, 'focusEnd'), what, 'focus', defaultSphere());
  L.addWin(D, what, new Date());
  save();
  celebrate();
}

setInterval(() => {
  if (F.running) { F.left = F.endAt - Date.now(); if (F.left <= 0) fFinish(); }
  updateFocusUI();
}, 250);

// ---------- Vide-tête ----------

function fmtShortcut(sc) {
  const names = { Control: 'Ctrl', CommandOrControl: 'Ctrl', Space: 'Espace', Shift: 'Maj' };
  return sc.split('+').map(k => `<kbd>${esc(names[k] || k)}</kbd>`).join(' ');
}

function ago(iso) {
  const m = (Date.now() - new Date(iso)) / L.MIN;
  if (m < 1) return "à l'instant";
  if (m < 60 * 24) return 'il y a ' + L.duration(m);
  return 'le ' + fmtDay(new Date(iso));
}

function pageTete() {
  const mine = D.ideas.filter(inSphere);
  const tri = mine.filter(i => !i.parked), park = mine.filter(i => i.parked);
  const list = teteTab === 'tri' ? tri : park;
  return head('Vide-tête', `Sors-le de ta tête, il est en sécurité ici. Partout dans Windows : ${fmtShortcut(S().shortcut)}.`) + `
    <form class="dump" data-form="idea">
      <textarea name="text" rows="3" data-enter placeholder="Ce qui te traverse l'esprit… (Entrée pour ranger, Maj+Entrée pour une nouvelle ligne)" aria-label="Nouvelle pensée"></textarea>
      <button class="btn">Ranger</button>
    </form>
    <div class="tabs" role="tablist">
      <button class="${teteTab === 'tri' ? 'on' : ''}" data-act="tab" data-t="tri" role="tab">À trier (${tri.length})</button>
      <button class="${teteTab === 'parking' ? 'on' : ''}" data-act="tab" data-t="parking" role="tab">Parking à idées (${park.length})</button>
    </div>
    ${teteTab === 'parking' ? '<p class="sub" style="margin:0 0 12px">Les idées garées ici ne sont pas des promesses. Elles attendent, sans pression, le jour où l\'envie revient.</p>' : ''}
    ${list.length ? `<ul class="list">${list.map(i => `
      <li><div><button class="row-open idea-text" data-act="open" data-type="idea" data-id="${i.id}">${sphTag(i)}${esc(i.text)}${noteCount(i)}</button><small>${ago(i.at)}</small></div>
        <button class="btn small soft" data-act="ideaTask" data-id="${i.id}">En faire une tâche</button>
        <button class="btn small ghost" data-act="ideaPark" data-id="${i.id}">${i.parked ? 'Ressortir' : 'Au parking'}</button>
        <button class="x" data-act="ideaDel" data-id="${i.id}" aria-label="Supprimer">×</button></li>`).join('')}</ul>`
      : `<p class="empty">${teteTab === 'tri' ? 'Tête vide, ou presque. Bien joué.' : 'Aucune idée garée pour l\'instant.'}</p>`}`;
}

// ---------- Ce soir ----------

const B = { on: false, start: 0, until: 0 };

setInterval(() => {
  if (!B.on) return;
  const el = $('#breathText');
  if (Date.now() > B.until) { B.on = false; toast('Tu peux continuer si ça te fait du bien.'); if (view === 'soir') render(); return; }
  if (el) el.textContent = Math.floor((Date.now() - B.start) / (S().breathSeconds * 1000)) % 2 ? 'Expire' : 'Inspire';
}, 200);

function pageSoir() {
  const t = new Date(), wins = L.winsOn(D, t);
  return head('Ce soir', 'Fermer la journée, sans rien régler. Juste poser les choses.') + `
    <ol class="steps">
      <li><h3>Regarde ce que tu as fait</h3>
        ${wins.length ? `<ul class="wins-list" style="padding-left:18px">${wins.map(w => `<li>${esc(w.text)}</li>`).join('')}</ul>
          <p class="hint" style="margin-top:8px">${wins.length} victoire${wins.length > 1 ? 's' : ''}. Ta journée n'a pas été inutile.</p>`
        : `<p>Rien de noté aujourd'hui, et ce n'est pas grave. Tenir une journée avec un cerveau qui tourne à 1 000 pensées par seconde, c'est déjà quelque chose.</p>`}
      </li>
      <li><h3>Pose ce qui tourne encore</h3>
        <form class="dump" data-form="idea">
          <textarea name="text" rows="3" data-enter placeholder="Ce qui reste à faire, ce qui t'inquiète, une idée pour demain…"></textarea>
          <button class="btn">Poser</button>
        </form>
        <p class="hint" style="margin-top:8px">Tout part dans le vide-tête. Demain, ce sera encore là.</p>
      </li>
      <li><h3>Respire</h3>
        <div class="breath-zone">
          <div class="breath-box"><div class="breath ${B.on ? 'on' : ''}" style="--bs:${S().breathSeconds}s"><span id="breathText">${B.on ? 'Inspire' : ''}</span></div></div>
          <div><p>Cohérence cardiaque : ${S().breathSeconds} s pour inspirer, ${S().breathSeconds} s pour expirer, pendant 3 minutes. Suis le cercle.</p>
            <div class="row" style="margin-top:14px">${B.on ? '<button class="btn ghost" data-act="breath">Arrêter</button>' : '<button class="btn" data-act="breath">Commencer</button>'}</div></div>
        </div>
      </li>
      <li><h3>Éteins</h3>
        <p>Si un podcast ou un documentaire t'aide à t'endormir, lance-le maintenant, luminosité au minimum ou écran retourné.</p>
        <div class="row" style="margin-top:14px"><button class="btn" data-act="goodnight">Bonne nuit</button></div>
      </li>
    </ol>`;
}

// ---------- Météo intérieure ----------

function dayAvg(day, key) {
  const v = D.moods.filter(m => L.dayKey(new Date(m.at)) === day && m[key] != null).map(m => Number(m[key]));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function spark(label, key, color) {
  const t = new Date();
  let bars = '';
  for (let i = 0; i < 30; i++) {
    const d = L.addDays(t, i - 29), v = dayAvg(L.dayKey(d), key), x = i * 10 + 1.5;
    if (v == null) bars += `<circle cx="${x + 3.5}" cy="54" r="1.3" fill="var(--line)"/>`;
    else {
      const h = (v / 5) * 50;
      bars += `<rect x="${x}" y="${54 - h}" width="7" height="${h}" rx="2" fill="var(--${color})"><title>${fmtDay(d)} : ${v.toFixed(1).replace('.', ',')} / 5</title></rect>`;
    }
  }
  return `<div class="spark"><span class="spark-label">${label}</span>
    <svg viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="${label} sur 30 jours"><line class="base" x1="0" y1="54.5" x2="300" y2="54.5"/>${bars}</svg></div>`;
}

function doctorSummary() {
  const t = new Date(), from = L.addDays(t, -30);
  const ms = D.moods.filter(m => new Date(m.at) >= from).sort((a, b) => a.at.localeCompare(b.at));
  const avg = k => { const v = ms.filter(m => m[k] != null).map(m => Number(m[k])); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).replace('.', ',') + ' / 5' : 'non renseigné'; };
  const drops = [];
  for (let i = 1; i < ms.length; i++) {
    const a = ms[i - 1], b = ms[i];
    if (a.mood - b.mood >= 2 && new Date(b.at) - new Date(a.at) < 36 * 3600e3) drops.push(`${fmtDay(new Date(b.at))} (${WX[a.mood - 1][2]} → ${WX[b.mood - 1][2]})`);
  }
  const nights = D.nights.filter(n => new Date(n.at) >= from).map(n => { const d = new Date(n.at); let m = d.getHours() * 60 + d.getMinutes(); if (m < 720) m += 1440; return m; });
  const bed = nights.length ? `moyenne ${L.toHM(Math.round(nights.reduce((a, b) => a + b, 0) / nights.length))}, de ${L.toHM(Math.min(...nights))} à ${L.toHM(Math.max(...nights))} (${nights.length} soirs)` : 'non renseigné';
  const notes = ms.filter(m => m.note).slice(-10).map(m => `- ${fmtDay(new Date(m.at))} ${L.clock(new Date(m.at))} (${WX[m.mood - 1][2]}) : ${m.note}`);
  return [
    `Météo intérieure, du ${from.toLocaleDateString('fr-FR')} au ${t.toLocaleDateString('fr-FR')}`,
    `Check-ins : ${ms.length}`,
    `Humeur moyenne : ${avg('mood')} (1 = orage, 5 = soleil)`,
    `Énergie moyenne : ${avg('energy')}`,
    `Tension moyenne : ${avg('tension')} (5 = sous pression)`,
    `Jours difficiles (orage ou pluie) : ${new Set(ms.filter(m => m.mood <= 2).map(m => L.dayKey(new Date(m.at)))).size}`,
    `Chutes brutales d'humeur (2 crans ou plus d'un jour à l'autre) : ${drops.length ? drops.join(', ') : 'aucune'}`,
    `Heure du coucher (bouton « Bonne nuit ») : ${bed}`,
    ...(notes.length ? ['Notes :', ...notes] : []),
  ].join('\n');
}

function pageMeteo() {
  const choice = (name, items, req) => `<div class="choices">${items.map(([v, e, l]) => `
    <label><input type="radio" name="${name}" value="${v}" ${req ? 'required' : ''}><span>${e ? `<i>${e}</i>` : `<i>${v}</i>`}${l}</span></label>`).join('')}</div>`;
  const history = [...D.moods].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  return head('Météo intérieure', 'Ce que tu ne montres pas a le droit d\'exister ici. Un clic suffit, les mots sont en option.') + `
    <form class="panel mood-form" data-form="mood">
      <fieldset><legend>Le temps qu'il fait dedans</legend>${choice('mood', WX, true)}</fieldset>
      <fieldset><legend>Énergie</legend>${choice('energy', ENERGY.map((l, i) => [i + 1, '', l]))}</fieldset>
      <fieldset><legend>Tension</legend>${choice('tension', TENSION.map((l, i) => [i + 1, '', l]))}</fieldset>
      <label class="f">Un mot ? (facultatif)<textarea name="note" rows="2" placeholder="Ce qui se passe, ce qui a déclenché…"></textarea></label>
      <div class="row"><button class="btn">Enregistrer</button></div>
    </form>
    <section><h2 class="sec-title">30 derniers jours</h2>
      ${spark('Humeur', 'mood', 'empathy')}${spark('Énergie', 'energy', 'reward')}${spark('Tension', 'tension', 'attention')}
      <div class="spark-axis"><span></span><div><span>${fmtDay(L.addDays(new Date(), -29))}</span><span>aujourd'hui</span></div></div>
    </section>
    <section><h2 class="sec-title">Pour ton médecin</h2>
      <p class="sub" style="margin:0 0 14px">Ton document le note : les « down » sans déclencheur et le retour au calme qui prend des jours sont à signaler. Ce résumé t'aide à en parler, sans avoir à t'en souvenir.</p>
      <div class="row"><button class="btn soft" data-act="copyDoctor">Copier le résumé</button></div>
      <pre class="doctor" id="doctor" hidden></pre>
    </section>
    ${history.length ? `<section><h2 class="sec-title">Derniers check-ins</h2><ul class="list">${history.map(m => `
      <li><span class="cat" style="background:color-mix(in oklab, var(--empathy) 14%, var(--surface))">${WX[m.mood - 1][1]}</span>
        <div><b>${WX[m.mood - 1][2]}</b>${m.energy ? `, énergie ${ENERGY[m.energy - 1].toLowerCase()}` : ''}${m.tension ? `, ${TENSION[m.tension - 1].toLowerCase()}` : ''}
          <small>${cap(rel(new Date(m.at)))}${m.note ? ` : ${esc(m.note)}` : ''}</small></div>
        <button class="x" data-act="moodDel" data-at="${m.at}" aria-label="Supprimer">×</button></li>`).join('')}</ul></section>` : ''}`;
}

// ---------- Retrouver : recherche et archive ----------

const KIND_NAME = { task: 'Tâche', reminder: 'Rappel', event: 'Événement', idea: 'Idée', mood: 'Météo' };

function resultRow(kind, x, snippet) {
  const title = kind === 'idea' ? x.text : kind === 'mood' ? `${WX[x.mood - 1][1]} ${WX[x.mood - 1][2]}` : x.title;
  const hour = kind === 'event' ? (x.allDay ? ', toute la journée' : ', ' + x.start) : x.time ? ', ' + x.time : '';
  const when = kind === 'event' || (kind === 'task' && x.date) ? cap(fmtDay(new Date(x.date + 'T12:00'))) + hour + (x.repeat && x.repeat !== 'none' ? ` (${repeatLabel(x.repeat).toLowerCase()})` : '')
    : kind === 'mood' ? cap(rel(new Date(x.at))) : x.done && x.doneAt ? 'Fait le ' + fmtDay(new Date(x.doneAt)) : '';
  const open = kind === 'mood' ? 'data-act="go" data-view="meteo"' : `data-act="open" data-type="${kind}" data-id="${x.id}"`;
  return `<li><span class="kind-tag">${KIND_NAME[kind]}</span>
    <div><button class="row-open" ${open}><span class="sph-tag sph-${L.sphereOf(x)}">${esc(S().spheres[L.sphereOf(x)].icon)}</span>${esc(title)}${noteCount(x)}</button>
      ${snippet ? `<small class="snippet">${esc(snippet)}</small>` : ''}${when ? `<small>${when}${x.done ? ' (fait)' : ''}</small>` : ''}</div>
    ${kind === 'task' && x.done ? `<button class="btn small ghost" data-act="taskUndo" data-id="${x.id}">Remettre à faire</button>` : ''}</li>`;
}

function resultsHTML() {
  if (searchQuery.trim()) {
    const found = L.search(D, searchQuery);
    const words = searchQuery.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
    const inNote = x => (x.notes || []).map(n => n.text).find(t => words.some(w => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(w)));
    return found.length
      ? `<p class="hint">${found.length} résultat${found.length > 1 ? 's' : ''}</p><ul class="list results">${found.map(r =>
        resultRow(r.kind, r.item, r.kind === 'mood' ? r.item.note : inNote(r.item) || r.item.firstStep || r.item.note || r.item.place)).join('')}</ul>`
      : '<p class="empty">Rien trouvé. Essaie un seul mot, ou un morceau de mot.</p>';
  }
  const done = D.tasks.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const doneRem = D.reminders.filter(r => r.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  if (!done.length && !doneRem.length) return '<p class="empty">L\'archive est vide pour l\'instant. Tout ce que tu termines viendra ici, avec ses notes.</p>';
  const months = {};
  for (const t of done) {
    const k = cap(new Date(t.doneAt || t.at || Date.now()).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
    (months[k] ||= []).push(t);
  }
  return `${Object.entries(months).map(([m, list]) => `<section class="group"><h3>${m} <span>${list.length}</span></h3>
      <ul class="list results">${list.map(t => resultRow('task', t, t.notes?.length ? t.notes[t.notes.length - 1].text : '')).join('')}</ul></section>`).join('')}
    ${doneRem.length ? `<section class="group"><h3>Rappels terminés <span>${doneRem.length}</span></h3>
      <ul class="list results">${doneRem.map(r => resultRow('reminder', r, r.notes?.length ? r.notes[r.notes.length - 1].text : '')).join('')}</ul></section>` : ''}`;
}

function pageRetrouver() {
  return head('Retrouver', 'Cherche dans tout : tâches, rappels, événements, idées et toutes leurs notes. Sans recherche, tu vois l\'archive de ce que tu as terminé.') + `
    <input id="search" class="search-input" type="search" value="${esc(searchQuery)}" placeholder="Un mot, un nom, un numéro de dossier…" aria-label="Rechercher" autocomplete="off">
    <div id="results">${resultsHTML()}</div>`;
}

// ---------- Réglages ----------

function getSetting(path) { return path.split('.').reduce((o, k) => o[k], S()); }
// <label> seulement s'il y a un champ : sinon un clic sur le texte déclencherait le bouton de la ligne.
const row = (label, ctrl, hint = '') => {
  const tag = /<(input|select|textarea)/.test(ctrl) ? 'label' : 'div';
  return `<${tag} class="set-row"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>${ctrl}</${tag}>`;
};
const sel = (key, opts, num) => `<select data-set="${key}" ${num ? 'data-num' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(getSetting(key)) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const chk = key => `<input type="checkbox" class="switch" data-set="${key}" ${getSetting(key) ? 'checked' : ''}>`;
const inp = (key, type = 'text', extra = '') => `<input type="${type}" data-set="${key}" value="${esc(getSetting(key))}" ${extra}>`;
const mins = list => list.map(m => [m, m ? `${m} min` : 'Jamais']);

const SOUNDS = {
  doux: ['Doux', [523, 659], 'sine', 0.32],
  net: ['Net', [988, 1319], 'triangle', 0.1],
  cloche: ['Cloche', [784, 988, 1175], 'sine', 0.22],
  grave: ['Grave', [392, 294], 'sine', 0.3],
  bulle: ['Bulles', [660, 880, 990, 1320], 'sine', 0.07],
  aucun: ['Aucun son', [], 'sine', 0],
};

function themeCards(key) {
  return `<div class="themes">${Object.entries(THEMES).map(([k, [name, desc]]) => `
    <button class="theme-card ${S()[key] === k ? 'on' : ''}" data-theme="${k}" data-act="setTheme" data-k="${key}" data-v="${k}" title="${esc(desc)}">
      <b>${name}</b><span class="dots">${['primary', 'attention', 'progress', 'create', 'empathy', 'reward'].map(c => `<i style="background:var(--${c})"></i>`).join('')}</span>
    </button>`).join('')}</div>`;
}

function sphereSettings(k) {
  const sp = S().spheres[k], colorKey = k + 'Color';
  return `<div class="sphere-card sph-${k}">
    <h3>${esc(sp.icon)} ${esc(sp.name)}</h3>
    ${row('Nom', inp(`spheres.${k}.name`))}
    ${row('Icône', inp(`spheres.${k}.icon`, 'text', 'maxlength="4" style="width:80px"'), 'Un emoji : elle apparaît dans les notifications.')}
    ${row('Couleur', `<span class="row"><input type="color" data-set="${colorKey}" value="${S()[colorKey] || (k === 'pro' ? '#3E6DB5' : '#C2588A')}">${S()[colorKey] ? `<button class="link" data-act="colorReset" data-k="${colorKey}">Couleur du thème</button>` : ''}</span>`)}
    ${row('Son des notifications', `<span class="row">${sel(`spheres.${k}.sound`, Object.entries(SOUNDS).map(([v, [l]]) => [v, l]))}<button type="button" class="btn small ghost" data-act="testSound" data-sph="${k}">Écouter</button></span>`)}
    ${row('Tester', `<button type="button" class="btn small soft" data-act="testNotif" data-sph="${k}">Notification ${esc(sp.name)}</button>`)}
  </div>`;
}

function kellyGuide(s) {
  const server = s.phone.server.replace(/\/+$/, '');
  return `Coucou ! Pour m'envoyer des tâches ou des rappels directement dans mon appli Boussole :

1. Installe l'appli gratuite « ntfy » (Play Store, F-Droid ou App Store).
2. Touche « + » et abonne-toi au sujet : ${s.kelly.topic}
   (serveur : ${server.replace(/^https?:\/\//, '')})
3. Ouvre ce sujet, écris ton message et envoie-le. Exemples :
   • « Acheter du pain » → une tâche
   • « Dentiste lundi à 17h30 » → une tâche avec date et heure
   • « rappel Appeler le garage demain 10h » → un rappel
   • « rappel Anniversaire de maman le 12/11 » → un rappel ce jour-là

Ça marche aussi depuis un navigateur : ${server}/${s.kelly.topic}
Boussole te répond « ✓ Reçu » dès que c'est arrivé.`;
}

function pageSettings() {
  const s = S();
  const legend = [
    ['primary', 'Sarcelle', 'calme et concentration. Couleur de base et du focus.'],
    ['pro', 'Bleu cobalt', `${esc(s.spheres.pro.name)} : cadre, fiabilité, concentration.`],
    ['perso', 'Rose orchidée', `${esc(s.spheres.perso.name)} : chaleur, affection, ce qui compte pour toi.`],
    ['attention', 'Ambre', 'attire l\'attention sans alarmer. Pour les rappels, à la place du rouge qui stresse.'],
    ['progress', 'Sauge', 'progrès et sécurité. Ce qui est fait.'],
    ['create', 'Lavande', 'créativité et imagination. Le vide-tête, les idées et les notes.'],
    ['empathy', 'Rose doux', 'douceur et empathie. La météo intérieure.'],
    ['reward', 'Miel', 'joie et récompense. Les victoires.'],
    ['night', 'Indigo, puis ambre le soir', 'ralentir. Le soir, le bleu disparaît pour aider l\'endormissement.'],
  ];
  const days = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
  return head('Réglages', 'Tout s\'adapte à toi, rien n\'est figé.') + `<div class="settings">
    <section><h2 class="sec-title">Toi</h2>
      ${row('Ton prénom', inp('prenom'))}
      ${row('Ton des messages', sel('tone', [['doux', 'Doux'], ['direct', 'Direct'], ['humour', 'Avec humour']]), `Exemple : « ${esc(L.msg(s.tone, 'nag', { t: 'payer la facture Orange' }))} »`)}
    </section>

    <section><h2 class="sec-title">Perso et Pro</h2>
      ${row('Choix de la sphère affichée', sel('sphereMode', [['auto', 'Automatique selon mes horaires'], ['manuel', 'Manuel']]), 'En automatique : Pro pendant le travail, Perso le reste du temps. Tu peux toujours changer à la main.')}
      ${row('Jours de travail', `<span class="chips">${days.map(([d, l]) => `<button type="button" class="chip ${s.workDays.includes(d) ? 'on' : ''}" data-act="workDay" data-d="${d}" aria-pressed="${s.workDays.includes(d)}" title="${cap(WD[d])}">${l}</button>`).join('')}</span>`)}
      ${row('Horaires de travail, de', inp('workStart', 'time'))}
      ${row('à', inp('workEnd', 'time'))}
      ${row(`Notifications ${esc(s.spheres.pro.name)} hors horaires`, sel('proOff', [['defer', 'Reportées'], ['silent', 'Silencieuses'], ['normal', 'Normales']]), 'Reportées : elles arrivent au début de ta prochaine journée de travail. Le soir et le week-end, le travail attend.')}
      ${row(`Notifications ${esc(s.spheres.perso.name)} pendant le travail`, sel('persoAtWork', [['silent', 'Silencieuses'], ['defer', 'Reportées'], ['normal', 'Normales']]), 'Silencieuses : visibles, sans son ni carte de relance. Reportées : elles arrivent après le travail.')}
      <p class="hint" style="margin-top:10px">Un rappel marqué Urgent passe toujours. Un événement placé à une heure précise prévient toujours.</p>
      <div class="sphere-cards">${sphereSettings('perso')}${sphereSettings('pro')}</div>
    </section>

    <section><h2 class="sec-title">Agenda</h2>
      ${row('Vue par défaut', sel('agendaView', [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']]))}
      ${row('Heures affichées, de', sel('agendaFrom', Array.from({ length: 13 }, (_, h) => [h, `${h} h`]), true))}
      ${row('à', sel('agendaTo', Array.from({ length: 13 }, (_, i) => [i + 12, `${i + 12} h`]), true))}
      ${row('Prévenir avant un événement', sel('eventLead', [0, 5, 10, 15, 30, 60].map(m => [m, m ? `${m} min avant` : 'Au début']), true))}
    </section>

    <section><h2 class="sec-title">Couleurs et apparence</h2>
      ${row('Changer de thème automatiquement le soir', `<input type="checkbox" class="switch" data-act="autoTheme" ${s.theme === 'auto' ? 'checked' : ''}>`, `Le soir commence ${s.windDown} min avant ton coucher et dure jusqu'à ton lever.`)}
      <p class="f" style="margin-top:16px">${s.theme === 'auto' ? 'Thème de journée' : 'Thème'}</p>${themeCards('dayTheme')}
      ${s.theme === 'auto' ? `<p class="f" style="margin-top:16px">Thème du soir</p>${themeCards('nightTheme')}` : ''}
      ${row('Couleur principale personnalisée', `<span class="row"><input type="color" data-set="accent" value="${s.accent || '#2B7A7E'}">${s.accent ? '<button class="link" data-act="colorReset" data-k="accent">Revenir au thème</button>' : ''}</span>`, 'Remplace la sarcelle partout.')}
      ${row('Taille du texte', `<span class="row"><input type="range" min="85" max="140" step="5" data-set="textScale" data-num value="${s.textScale}"><span>${s.textScale} %</span></span>`)}
      ${row('Réduire les animations', chk('reduceMotion'))}
      ${row('Célébrer les victoires', chk('celebrate'), 'Confettis et petit son quand tu finis quelque chose.')}
      <h3 style="margin-top:24px">Pourquoi ces couleurs</h3>
      <ul class="legend">${legend.map(([c, n, d]) => `<li><i style="background:var(--${c})"></i><span><b>${n}</b> : ${d}</span></li>`).join('')}</ul>
    </section>

    <section><h2 class="sec-title">Rappels et notifications</h2>
      ${row('Sons', chk('sounds'))}
      ${row('Carte de relance à l\'écran', chk('nudgeWindow'), 'Une petite carte reste dans le coin de l\'écran jusqu\'à ce que tu répondes.')}
      ${row('Relancer par défaut toutes les', sel('nagEvery', mins([0, 5, 10, 15, 20, 30, 60]), true))}
      ${row('Heures calmes, de', inp('quietStart', 'time'), 'Aucune notification pendant cette plage, sauf les rappels urgents.')}
      ${row('à', inp('quietEnd', 'time'))}
    </section>

    <section><h2 class="sec-title">Temps</h2>
      ${row('Carillon du temps qui passe', sel('chimeEvery', mins([0, 15, 20, 30, 45, 60, 90]).map(([v, l]) => [v, v ? 'Toutes les ' + l : 'Désactivé']), true), 'Une notification discrète qui donne l\'heure, pour ne pas perdre 2 heures sans t\'en rendre compte.')}
      ${row('Seulement quand j\'utilise l\'ordinateur', chk('chimeOnlyActive'))}
      ${row('Durée de focus par défaut', sel('focusDefault', [5, 10, 15, 20, 25, 30, 45, 60, 90].map(m => [m, m + ' min']), true))}
    </section>

    <section><h2 class="sec-title">Rythme</h2>
      ${row('Heure de lever', inp('wake', 'time'))}
      ${row('Heure du coucher visée', inp('bedtime', 'time'), 'Sert au rail du temps et à l\'alerte du soir.')}
      ${row('Commencer à décrocher', sel('windDown', [15, 30, 45, 60, 90].map(m => [m, m + ' min avant']), true))}
      ${row('Check-ins météo', inp('checkins', 'text', 'placeholder="13:00, 20:00"'), 'Heures séparées par des virgules. Vide pour aucun.')}
      ${row('Respiration', sel('breathSeconds', [4, 5, 6].map(x => [x, `${x} s / ${x} s`]), true))}
    </section>

    <section><h2 class="sec-title">Modules</h2>
      ${row('Agenda', chk('modules.agenda'), 'Avec les notifications avant les événements.')}
      ${row('Rappels', chk('modules.rappels'))}
      ${row('Focus', chk('modules.focus'))}
      ${row('Vide-tête', chk('modules.tete'))}
      ${row('Ce soir', chk('modules.soir'), 'Avec les notifications de décrochage et de coucher.')}
      ${row('Météo intérieure', chk('modules.meteo'), 'Avec les notifications de check-in.')}
    </section>

    <section><h2 class="sec-title">Windows</h2>
      ${row('Lancer au démarrage de Windows', chk('autostart'), 'Actif une fois l\'appli installée.')}
      ${row('Démarrer réduit dans la barre des tâches', chk('startHidden'))}
      ${row('Fermer la fenêtre = la garder près de l\'horloge', chk('closeToTray'), 'Sinon, les rappels s\'arrêtent quand tu fermes.')}
      ${row('Raccourci du vide-tête', inp('shortcut'), shortcutOk ? '<span class="ok">Raccourci actif.</span>' : '<span class="warn">Ce raccourci est déjà pris. Essaie Alt+Shift+Space ou Control+Alt+N.</span>')}
    </section>

    <section><h2 class="sec-title">Sur ton téléphone</h2>
      ${row('Recevoir aussi les notifications sur mon téléphone', `<input type="checkbox" class="switch" data-act="phoneToggle" ${s.phone.enabled ? 'checked' : ''}>`,
        'Avec ntfy : gratuit, open source, sans compte. Le carillon reste sur l\'ordinateur.')}
      ${s.phone.enabled ? `
        <ol class="howto">
          <li>Installe l'appli gratuite <b>ntfy</b> (Android : Play Store ou F-Droid ; iPhone : App Store).</li>
          <li>Dans ntfy, touche <b>+</b> et abonne-toi à ce sujet (serveur ${esc(s.phone.server.replace(/^https?:\/\//, ''))}) :
            <span class="row" style="margin-top:6px"><code id="phone-topic">${esc(s.phone.topic)}</code>
            <button type="button" class="btn small ghost" data-act="copyText" data-target="phone-topic">Copier</button></span></li>
          <li>Envoie un test : <button type="button" class="btn small soft" data-act="phoneTest">Envoyer un test</button> <span id="phone-status"></span></li>
        </ol>
        ${row('Contenu des notifications', sel('phone.detail', [['full', 'Titre complet'], ['discret', 'Discret']]), 'Discret : « Quelque chose t\'attend dans Boussole », rien de personnel ne sort de ton PC.')}
        ${row('Serveur ntfy', inp('phone.server'), 'ntfy.sh est gratuit. Tu peux aussi installer ton propre serveur ntfy, il est open source.')}
        ${row('Garde ce sujet secret', '<button type="button" class="btn small ghost" data-act="phoneNewTopic">Nouveau sujet</button>', 'Celui qui connaît le sujet peut lire les notifications. Change-le si besoin.')}` : ''}
    </section>

    <section><h2 class="sec-title">Messages d'un proche</h2>
      ${row(`Laisser ${esc(s.kelly.name || 'un proche')} m'envoyer des tâches et des rappels`, `<input type="checkbox" class="switch" data-act="kellyToggle" ${s.kelly.enabled ? 'checked' : ''}>`,
        'Depuis son téléphone, avec l\'appli gratuite ntfy. Ses messages arrivent en Perso, avec une note « Envoyé par… ».')}
      ${row('Son prénom', inp('kelly.name', 'text', 'placeholder="Prénom"'))}
      ${s.kelly.enabled ? `
        <p class="f" style="margin-top:14px">Message à lui envoyer pour l'installer</p>
        <textarea id="kelly-guide" class="guide" rows="12" readonly>${esc(kellyGuide(s))}</textarea>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn small soft" data-act="copyText" data-target="kelly-guide">Copier le message</button>
          <button type="button" class="btn small ghost" data-act="kellyCheck">Vérifier maintenant</button>
          <span id="kelly-status"></span>
        </div>
        <p class="hint" style="margin-top:8px">Boussole regarde toutes les 30 secondes et répond « ✓ Reçu » à chaque message.</p>` : ''}
    </section>

    <section><h2 class="sec-title">Mises à jour</h2>
      ${row('Mises à jour automatiques', '<button type="button" class="btn small ghost" data-act="updateCheck">Vérifier maintenant</button>',
        '<span id="update-status"></span> Les nouvelles versions se téléchargent toutes seules et s\'installent à la fermeture.')}
    </section>

    <section><h2 class="sec-title">Sauvegardes et données</h2>
      ${row('Sauvegarde automatique', '<button type="button" class="btn small ghost" data-act="dataFolder">Ouvrir le dossier</button>', 'Une copie par jour sur cet ordinateur, les 7 derniers jours. Rien n\'est envoyé sur Internet.')}
      ${row('Copie dans ton cloud', s.backupDir
        ? '<span class="row"><button type="button" class="btn small ghost" data-act="pickBackup">Changer</button><button type="button" class="link" data-act="backupOff">Retirer</button></span>'
        : '<button type="button" class="btn small soft" data-act="pickBackup">Choisir un dossier</button>',
        s.backupDir ? `${esc(s.backupDir)}\\Boussole. <span id="backup-status"></span>`
          : 'Choisis un dossier synchronisé (pCloud, Proton Drive…) : 30 jours de copies, à l\'abri si ton PC lâche.')}
      ${row('Exporter', '<button type="button" class="btn small ghost" data-act="exportData">Exporter en fichier</button>', 'Un fichier à garder où tu veux.')}
      ${row('Importer ou restaurer', '<button type="button" class="btn small ghost" data-act="importData">Choisir un fichier</button>', 'Remplace tes données actuelles. Une copie de sécurité est faite juste avant.')}
    </section>
  </div>`;
}

const PAGES = { aujourdhui: pageToday, agenda: pageAgenda, rappels: pageReminders, focus: pageFocus, tete: pageTete, soir: pageSoir, meteo: pageMeteo, retrouver: pageRetrouver, reglages: pageSettings };

// ---------- Retours : sons, confettis, message ----------

let audio;
function playNotes(notes, type, gap, vol = 0.14) {
  audio ||= new AudioContext();
  notes.forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * gap;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    o.connect(g).connect(audio.destination);
    o.start(t0); o.stop(t0 + 1);
  });
}

function playSound(name) {
  if (!S().sounds) return;
  const [, notes, type, gap] = SOUNDS[name] || SOUNDS.doux;
  playNotes(notes, type, gap);
}

function chime() { if (S().sounds) playNotes([660, 880, 1046], 'sine', 0.11); }

function celebrate() {
  chime();
  if (!S().celebrate || S().reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti'), x = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const cs = getComputedStyle(document.documentElement);
  const cols = ['--reward', '--progress', '--primary', '--create', '--empathy'].map(v => cs.getPropertyValue(v).trim());
  const P = Array.from({ length: 90 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
    s: Math.random() * 6 + 5, c: cols[(Math.random() * cols.length) | 0], r: Math.random() * 6,
  }));
  let frame = 0;
  (function step() {
    x.clearRect(0, 0, c.width, c.height);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.45; p.vx *= 0.99; p.r += 0.12;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
    }
    if (++frame < 110) requestAnimationFrame(step); else x.clearRect(0, 0, c.width, c.height);
  })();
}

let toastTimer;
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Actions ----------

const task = id => D.tasks.find(x => x.id === id);

// Une tâche terminée part dans l'archive (Retrouver), avec ses notes ; une tâche répétée revient à sa prochaine date.
function doneTask(id) {
  const i = D.tasks.findIndex(x => x.id === id), x = D.tasks[i], now = new Date();
  D.tasks[i] = L.completeTask(x, now);
  L.addWin(D, x.title, now);
  save(); celebrate();
  toast(D.tasks[i].done ? L.msg(S().tone, 'done') : `Fait. Elle revient ${fmtDay(new Date(D.tasks[i].date + 'T12:00'))}.`);
}

const randomTopic = () => 'boussole-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');

const ACT = {
  ...AGENDA_ACT,
  go: d => { view = d.view; render(); $('#view').scrollTop = 0; },
  sphere: d => {
    if (S().sphereMode === 'auto') { sphereOverride = d.k === L.autoSphere(S(), new Date()) ? null : d.k; render(); }
    else { S().sphereView = d.k; save(); }
  },
  taskDone: d => doneTask(d.id),
  taskLater: d => { const x = task(d.id); D.tasks = D.tasks.filter(t => t !== x).concat(x); save(); },
  taskNow: d => { const x = task(d.id); D.tasks = [x, ...D.tasks.filter(t => t !== x)]; save(); },
  taskDel: d => { D.tasks = D.tasks.filter(t => t.id !== d.id); save(); },
  taskUndo: d => { const x = task(d.id); x.done = false; x.doneAt = null; save(); toast('C\'est de nouveau à faire.'); },
  phoneToggle: (_, el) => {
    const p = S().phone;
    p.enabled = el.checked;
    if (p.enabled && !p.topic) p.topic = randomTopic();
    save();
  },
  phoneNewTopic: () => { if (confirm('Créer un nouveau sujet ? Il faudra t\'y réabonner dans ntfy.')) { S().phone.topic = randomTopic(); save(); } },
  phoneTest: async () => {
    const r = await api.phoneTest();
    toast(r.error ? 'Échec de l\'envoi : ' + r.error : 'Envoyé. Regarde ton téléphone.');
    fillLinkStatus();
  },
  kellyToggle: async (_, el) => {
    const k = S().kelly;
    k.enabled = el.checked;
    if (k.enabled && !k.topic) { k.topic = randomTopic(); k.since = Math.floor(Date.now() / 1000); k.lastId = ''; }
    await save();
    if (k.enabled) fillLinkStatus(await api.kellyCheck());
  },
  kellyCheck: async () => { const r = await api.kellyCheck(); toast(r.error ? 'Échec : ' + r.error : 'Vérifié, tout est à jour.'); fillLinkStatus(); },
  copyText: async d => {
    const el = document.getElementById(d.target);
    try { await navigator.clipboard.writeText(el.value || el.textContent); toast('Copié.'); } catch { el.select?.(); toast('Sélectionne le texte et copie-le.'); }
  },
  updateCheck: async () => { toast('Je regarde s\'il y a une nouvelle version…'); fillUpdateStatus(await api.updateCheck()); },
  updateInstall: () => api.updateInstall(),
  two: d => { const x = task(d.id); fStart(2, x.firstStep || x.title); },
  focusTask: d => { const x = task(d.id); fStart(S().focusDefault, x.title); },

  remDone: async d => { await api.reminder(d.id, 'done'); celebrate(); toast(L.msg(S().tone, 'done')); },
  remSnooze: async d => { await api.reminder(d.id, d.m); toast('C\'est noté, je reviens dans ' + L.duration(Number(d.m)) + '.'); },
  remDel: async d => { if (confirm('Supprimer ce rappel ?')) await api.reminder(d.id, 'delete'); },
  remCancel: () => { draft = null; render(); },
  tpl: d => {
    const { label, ...tpl } = TEMPLATES[d.i];
    draft = { ...defaultDraft(), ...tpl };
    render();
    const t = $('.rem-form [name=title]'); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
  },

  fset: d => { F.total = Number(d.m) * L.MIN; F.left = F.total; render(); },
  fstart: () => fStart(Math.round((F.total || S().focusDefault * L.MIN) / L.MIN)),
  fpause: () => { F.left = F.endAt - Date.now(); F.running = false; render(); },
  fresume: () => { F.endAt = Date.now() + F.left; F.running = true; render(); },
  fstop: () => { F.running = false; F.left = F.total; render(); },

  tab: d => { teteTab = d.t; render(); },
  ideaTask: d => {
    const i = D.ideas.find(x => x.id === d.id);
    D.tasks.push({ id: uid(), title: i.text.split('\n')[0].slice(0, 120), firstStep: '', done: false, sphere: L.sphereOf(i), notes: i.notes || [], at: new Date().toISOString() });
    D.ideas = D.ideas.filter(x => x !== i);
    if (sheet && sheet.id === i.id) openSheet('task', D.tasks[D.tasks.length - 1].id);
    save(); toast('C\'est une tâche. Il lui faudra une première petite étape.');
  },
  ideaPark: d => { const i = D.ideas.find(x => x.id === d.id); i.parked = !i.parked; save(); },
  ideaDel: d => { D.ideas = D.ideas.filter(x => x.id !== d.id); save(); },

  breath: () => { Object.assign(B, B.on ? { on: false } : { on: true, start: Date.now(), until: Date.now() + 3 * L.MIN }); render(); },
  goodnight: () => {
    D.nights.push({ at: new Date().toISOString() });
    save(false);
    const o = document.createElement('div');
    o.className = 'goodnight';
    o.innerHTML = `<div><h1>Bonne nuit, ${esc(S().prenom)}.</h1><p class="sub" style="margin-inline:auto">Tout est noté. Rien ne se perdra pendant que tu dors.</p></div>`;
    document.body.append(o);
    setTimeout(() => { o.remove(); api.hideMain(); }, 3500);
  },

  moodQuick: d => { D.moods.push({ at: new Date().toISOString(), mood: Number(d.v), energy: null, tension: null, note: '' }); save(); toast('Merci. C\'est noté.'); },
  moodDel: d => { D.moods = D.moods.filter(m => m.at !== d.at); save(); },
  copyDoctor: async () => {
    const text = doctorSummary(), pre = $('#doctor');
    pre.textContent = text; pre.hidden = false;
    try { await navigator.clipboard.writeText(text); toast('Résumé copié. Tu peux le coller dans un mail ou une note.'); }
    catch { toast('Copie impossible : sélectionne le texte affiché.'); }
  },

  setTheme: d => { S()[d.k] = d.v; if (S().theme !== 'auto') S().theme = d.v; save(); },
  autoTheme: () => { S().theme = S().theme === 'auto' ? S().dayTheme : 'auto'; save(); },
  colorReset: d => { S()[d.k] = ''; save(); },
  workDay: d => {
    const n = Number(d.d), w = S().workDays;
    S().workDays = w.includes(n) ? w.filter(x => x !== n) : [...w, n];
    save();
  },
  testSound: d => playSound(S().spheres[d.sph].sound),
  testNotif: d => api.notify(L.msg(S().tone, 'reminder', { t: 'ceci est un test' }), 'Si tu vois ceci, les notifications marchent.', null, d.sph),
  dataFolder: () => api.dataFolder(),
  pickBackup: async () => {
    const dir = await api.pickBackupDir();
    if (!dir) return;
    S().backupDir = dir;
    await save();
    toast('Copie dans le cloud activée.');
  },
  backupOff: () => { S().backupDir = ''; save(); },
  exportData: async () => { if ((await api.exportData()).ok) toast('Données exportées.'); },
  importData: async () => {
    if (!confirm('Remplacer tes données actuelles par celles du fichier ? Une copie de sécurité est faite juste avant.')) return;
    const r = await api.importData();
    if (r.ok) toast('Données restaurées.'); else if (r.error) toast(r.error);
  },
};

async function fillLinkStatus() {
  const info = await api.linkInfo();
  const say = (id, st, okText) => {
    const el = $(id);
    if (el) el.innerHTML = st.error ? `<span class="warn">Problème : ${esc(st.error)}</span>` : st.last ? `<span class="ok">${okText} ${L.clock(new Date(st.last))}.</span>` : '';
  };
  say('#phone-status', info.phone, 'Dernier envoi à');
  say('#kelly-status', info.kelly, 'Dernière vérification à');
}

async function fillUpdateStatus(u) {
  u ||= await api.updateInfo();
  const el = $('#update-status');
  if (!el) return;
  const text = !u.packaged ? 'Version de développement : les mises à jour fonctionnent dans l\'appli installée.'
    : { checking: 'Recherche en cours…', downloading: `Téléchargement de la version ${u.version}…`, ready: `La version ${u.version} est prête.`,
      none: 'Tu as la dernière version.', error: `Impossible de vérifier pour l'instant (${esc(u.error || '')}).`, idle: '' }[u.state] || '';
  el.innerHTML = `Version ${esc(u.current)}. ${text}${u.state === 'ready' ? ' <button type="button" class="btn small" data-act="updateInstall">Redémarrer et mettre à jour</button>' : ''}`;
}

async function fillBackupStatus() {
  const el = $('#backup-status');
  if (!el) return;
  const b = await api.backupInfo();
  el.innerHTML = b.error ? '<span class="warn">La dernière copie a échoué : le dossier est-il accessible ?</span>'
    : b.last ? `<span class="ok">Dernière copie à ${L.clock(new Date(b.last))}.</span>` : 'Première copie dans une minute.';
}

const FORM = {
  ...AGENDA_FORM,
  task: (v, f) => {
    D.tasks.push({ id: uid(), title: v.title.trim(), firstStep: v.firstStep.trim(), done: false, sphere: defaultSphere(), notes: [], at: new Date().toISOString() });
    save(); f.reset();
  },
  step: (v, f) => { task(f.dataset.id).firstStep = v.firstStep.trim(); save(); },
  reminder: v => {
    const t = new Date();
    const r = {
      id: v.id || uid(), title: v.title.trim(), cat: v.cat, kind: v.kind, date: v.date || L.dayKey(t), time: v.time,
      weekday: Number(v.weekday), monthDay: Math.min(31, Math.max(1, Number(v.monthDay) || 1)),
      nag: v.nag === '' ? null : Number(v.nag), note: v.note.trim(), urgent: v.urgent === 'on', done: false,
      sphere: v.sphere || defaultSphere(),
    };
    r.due = L.firstDue(r, t).toISOString();
    const i = D.reminders.findIndex(x => x.id === r.id);
    if (i >= 0) D.reminders[i] = { ...D.reminders[i], ...r, lastFired: null, snoozedUntil: null };
    else D.reminders.push({ ...r, notes: [] });
    draft = null;
    save(); toast('Rappel enregistré. Ta mémoire peut le lâcher.');
  },
  idea: (v, f) => {
    const text = v.text.trim();
    if (!text) return;
    D.ideas.unshift({ id: uid(), text, sphere: defaultSphere(), notes: [], at: new Date().toISOString(), parked: false });
    save(); f.reset(); toast('Rangé.');
    $('textarea[name=text]')?.focus();
  },
  mood: (v, f) => {
    D.moods.push({ at: new Date().toISOString(), mood: Number(v.mood), energy: v.energy ? Number(v.energy) : null, tension: v.tension ? Number(v.tension) : null, note: (v.note || '').trim() });
    save(); f.reset(); toast('Merci. Ce que tu ressens compte.');
  },
};

function setSetting(el) {
  const keys = el.dataset.set.split('.');
  let o = S();
  while (keys.length > 1) o = o[keys.shift()];
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if ('num' in el.dataset) v = Number(v);
  o[keys[0]] = v;
  save();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.type !== 'checkbox') e.preventDefault();
  ACT[el.dataset.act]?.(el.dataset, el, e);
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  FORM[f.dataset.form]?.(Object.fromEntries(new FormData(f)), f);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.set) setSetting(el);
  if ('kindSelect' in el.dataset) el.form.dataset.kind = el.value;
  if ('alldayToggle' in el.dataset) el.form.dataset.allday = el.checked;
  if (el.name === 'sphere' && el.closest('.sheet-panel')) el.closest('.sheet-panel').className = `sheet-panel sph-${el.value}`;
  if (el.id === 'fcustom' && Number(el.value) > 0) { F.total = Number(el.value) * L.MIN; F.left = F.total; updateFocusUI(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'flabel') F.label = e.target.value;
  if (e.target.id === 'search') { searchQuery = e.target.value; $('#results').innerHTML = resultsHTML(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheet) { ACT.closeSheet(); return; }
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea[data-enter]')) { e.preventDefault(); e.target.form.requestSubmit(); }
});
document.addEventListener('focusout', () => setTimeout(() => {
  if (pendingRender && !isBusy()) { pendingRender = false; render(); }
}, 0));

api.on('data', d => { D = d; if (isBusy()) pendingRender = true; else render(); });
api.on('goto', v => { view = v; render(); });
api.on('sound', sphere => playSound(S().spheres[sphere]?.sound));

// Rafraîchit l'horloge, le rail, l'agenda, la sphère automatique et le thème du soir.
setInterval(() => {
  if (isBusy()) return;
  if (view === 'aujourdhui' || view === 'agenda' || currentSphere() !== lastSphere) render(); else applyTheme();
}, 30000);

(async () => { D = await api.get(); render(); })();
