/* global L, api, D, S, esc, cap, fmtDay, uid, save, render, toast, $, head, inSphere, defaultSphere, reminderFields, spherePickHTML, FORM, doneTask, REPEATS, opt, conflictMessage */
// Agenda (jour / semaine / mois) et fiches modifiables avec notes datées.
// Chargé avant app.js : les fonctions ne touchent aux globales d'app.js qu'à l'exécution.

let agendaAnchor = new Date();
let agendaScrolled = false;
let sheet = null; // { type, id } pour un élément existant, { type, preset } pour un nouveau

const COLL = { task: 'tasks', event: 'events', reminder: 'reminders', idea: 'ideas' };
const KIND_LABEL = { task: 'Tâche', event: 'Événement', reminder: 'Rappel', idea: 'Idée' };
const HOUR_PX = 52;

const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = d => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const dayLong = d => L.frDate(d, { day: 'numeric', month: 'long' });

function agendaRange() {
  const v = S().agendaView, a = startOfDay(agendaAnchor);
  if (v === 'day') return [a, L.addDays(a, 1)];
  if (v === 'week') { const s = startOfWeek(a); return [s, L.addDays(s, 7)]; }
  const s = startOfWeek(new Date(a.getFullYear(), a.getMonth(), 1));
  return [s, L.addDays(s, 42)];
}

function agendaTitle() {
  const v = S().agendaView, a = agendaAnchor;
  if (v === 'day') return cap(L.frDate(a, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (v === 'week') { const [s, e] = agendaRange(); return `Du ${dayLong(s)} au ${dayLong(L.addDays(e, -1))}`; }
  return cap(a.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
}

const visibleItems = (from, to) => L.agendaItems(D, from, to).filter(inSphere);

function itemHTML(x, style = '') {
  const mark = x.kind === 'reminder' ? '🔔 ' : x.kind === 'task' ? (x.done ? '☑ ' : '☐ ') : '';
  const repeats = x.repeat && x.repeat !== 'none' && x.repeat !== 'once';
  const movable = !x.done && (x.kind !== 'reminder' || x.repeat === 'once');
  return `<button class="ag-item sph-${x.sphere} k-${x.kind} ${x.done ? 'done' : ''}" ${style ? `style="${style}"` : ''} ${movable ? 'draggable="true"' : ''}
    data-act="open" data-type="${x.kind}" data-id="${x.id}" data-occ="${x.occ}" title="${esc(x.title)}${movable ? ' (glisse pour déplacer)' : ''}">
    ${x.allDay ? '' : `<span class="ag-time">${L.clock(x.start)}</span>`}<span class="ag-title">${mark}${esc(x.title)}${repeats ? ' ↻' : ''}</span></button>`;
}

function timeGrid(days) {
  const s = S(), from = s.agendaFrom, to = Math.max(s.agendaTo, from + 1), total = (to - from) * HOUR_PX;
  const items = visibleItems(days[0], L.addDays(days[days.length - 1], 1));
  const now = new Date(), today = L.dayKey(now);
  const y = mins => Math.min(total - 22, Math.max(0, ((mins - from * 60) * HOUR_PX) / 60));

  const cols = days.map(day => {
    const next = L.addDays(day, 1), key = L.dayKey(day);
    const allDay = items.filter(x => x.allDay && x.start < next && (x.end || L.addDays(x.start, 1)) > day);
    const timed = L.layoutDay(items.filter(x => !x.allDay && x.start >= day && x.start < next));
    const blocks = timed.map(x => {
      const start = (x.start - day) / L.MIN;
      const end = x.end ? (x.end - day) / L.MIN : start + (x.kind === 'reminder' ? 20 : 30);
      const top = y(start), height = Math.max(22, Math.min(total, ((end - from * 60) * HOUR_PX) / 60) - top);
      const w = 100 / x.lanes;
      return itemHTML(x, `top:${top}px;height:${height}px;left:calc(${x.lane * w}% + 2px);width:calc(${w}% - 4px)`);
    }).join('');
    const work = s.workDays.includes(day.getDay())
      ? `<div class="ag-work" style="top:${y(L.hm(s.workStart))}px;height:${y(L.hm(s.workEnd)) - y(L.hm(s.workStart))}px"></div>` : '';
    const nowLine = key === today && now.getHours() >= from && now.getHours() < to
      ? `<div class="ag-now" style="top:${y(now.getHours() * 60 + now.getMinutes())}px"></div>` : '';
    return { day, key, allDay, html: `${work}${blocks}${nowLine}` };
  });

  const hours = Array.from({ length: to - from }, (_, i) => `<span>${(from + i) % 24} h</span>`).join('');
  return `<div class="ag-grid" style="--cols:${days.length};--hh:${HOUR_PX}px">
    <div class="ag-head"><div></div>${cols.map(c => `
      <button class="ag-dayname ${c.key === today ? 'is-today' : ''}" data-act="agDay" data-date="${c.key}">
        ${c.day.toLocaleDateString('fr-FR', { weekday: 'short' })} <b>${c.day.getDate()}</b></button>`).join('')}</div>
    <div class="ag-allday"><div class="ag-gutter">Journée</div>${cols.map(c => `
      <div data-act="slotDay" data-date="${c.key}">${c.allDay.map(x => itemHTML(x)).join('')}</div>`).join('')}</div>
    <div class="ag-body"><div class="ag-hours">${hours}</div>${cols.map(c => `
      <div class="ag-col" data-act="slot" data-date="${c.key}" style="height:${total}px">${c.html}</div>`).join('')}</div>
  </div>`;
}

function monthGrid() {
  const [start] = agendaRange(), month = agendaAnchor.getMonth(), today = L.dayKey(new Date());
  // Les rappels quotidiens noieraient le mois : ils restent visibles en vue Jour et Semaine.
  const items = visibleItems(start, L.addDays(start, 42)).filter(x => !(x.kind === 'reminder' && (x.repeat === 'daily' || x.repeat === 'weekdays')));
  const names = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const day = L.addDays(start, i), key = L.dayKey(day);
    const list = items.filter(x => L.dayKey(x.start) === key);
    cells += `<div class="ag-cell ${day.getMonth() !== month ? 'out' : ''} ${key === today ? 'is-today' : ''}" data-act="agDay" data-date="${key}">
      <span class="ag-num">${day.getDate()}</span>${list.slice(0, 3).map(x => itemHTML(x)).join('')}
      ${list.length > 3 ? `<span class="ag-more">+${list.length - 3} autre${list.length > 4 ? 's' : ''}</span>` : ''}</div>`;
  }
  return `<div class="ag-month">${names.map(n => `<div class="ag-wd">${n}</div>`).join('')}${cells}</div>`;
}

function pageAgenda() {
  const v = S().agendaView;
  const [s] = agendaRange();
  const days = v === 'day' ? [s] : v === 'week' ? Array.from({ length: 7 }, (_, i) => L.addDays(s, i)) : null;
  return head('Agenda', 'Tout ce qui est daté se range ici tout seul : rendez-vous, tâches datées et rappels.') + `
    <div class="ag-toolbar">
      <div class="row">
        <button class="btn small ghost" data-act="agMove" data-n="-1" aria-label="Période précédente">‹</button>
        <button class="btn small ghost" data-act="agToday">Aujourd'hui</button>
        <button class="btn small ghost" data-act="agMove" data-n="1" aria-label="Période suivante">›</button>
        <h2 class="ag-period">${agendaTitle()}</h2>
      </div>
      <div class="row">
        <div class="tabs seg" role="tablist">${[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']].map(([k, l]) =>
          `<button class="${v === k ? 'on' : ''}" data-act="agView" data-v="${k}" role="tab">${l}</button>`).join('')}</div>
        <button class="btn" data-act="newEvent">Nouvel événement</button>
      </div>
    </div>
    ${days ? timeGrid(days) : monthGrid()}
    <p class="ag-legend">
      <span><i class="dot sph-perso"></i>${esc(S().spheres.perso.icon)} ${esc(S().spheres.perso.name)}</span>
      <span><i class="dot sph-pro"></i>${esc(S().spheres.pro.icon)} ${esc(S().spheres.pro.name)}</span>
      <span>Bloc plein : événement</span><span>☐ tâche</span><span>🔔 rappel</span>
      ${days ? '<span>Clique dans une case vide pour créer un événement à cette heure.</span>' : '<span>Les rappels de chaque jour sont visibles en vue Jour et Semaine.</span>'}
    </p>`;
}

function afterAgendaRender() {
  if (agendaScrolled) return;
  agendaScrolled = true;
  $('.ag-now')?.scrollIntoView({ block: 'center' });
}

// ---------- Fiches ----------

function sheetItem() {
  if (!sheet) return null;
  return sheet.id ? D[COLL[sheet.type]].find(x => x.id === sheet.id) : sheet.preset;
}

function openSheet(type, id, preset) {
  sheet = { type, id, preset };
  render();
  $('#sheet [name=title], #sheet [name=text]')?.focus();
}

function sheetFields(type, x) {
  switch (type) {
    case 'task': return `
      <label class="f wide">La tâche<input name="title" required value="${esc(x.title)}" autocomplete="off"></label>
      <label class="f wide">Sa toute première étape<input name="firstStep" value="${esc(x.firstStep)}" placeholder="Ex. : ouvrir le site" autocomplete="off"></label>
      <label class="f">Jour (facultatif)<input type="date" name="date" value="${esc(x.date)}"></label>
      <label class="f">Heure (facultatif)<input type="time" name="time" value="${esc(x.time)}"></label>
      <label class="f">Durée prévue (min)<input type="number" name="duration" min="5" max="600" step="5" value="${esc(x.duration)}"></label>
      <label class="f">Répéter<select name="repeat">${REPEATS.map(([v, l]) => opt(v, l, x.repeat || 'none')).join('')}</select></label>`;
    case 'event': return `
      <label class="f wide">Quoi ?<input name="title" required value="${esc(x.title)}" placeholder="Réunion, dîner, médecin…" autocomplete="off"></label>
      <label class="f">Jour<input type="date" name="date" required value="${esc(x.date)}"></label>
      <label class="set-row" style="border:0;padding:0"><span><b>Toute la journée</b></span>
        <input type="checkbox" class="switch" name="allDay" data-allday-toggle ${x.allDay ? 'checked' : ''}></label>
      <label class="f only-timed">Début<input type="time" name="start" value="${esc(x.start || '10:00')}"></label>
      <label class="f only-timed">Fin<input type="time" name="end" value="${esc(x.end || '11:00')}"></label>
      <label class="f">Répéter<select name="repeat">${REPEATS.map(([v, l]) => opt(v, l, x.repeat || 'none')).join('')}</select></label>
      <label class="f wide">Lieu ou lien<input name="place" value="${esc(x.place)}" autocomplete="off"></label>
      <p class="hint wide">Un anniversaire : « Toute la journée » et « Chaque année ». Tu es prévenu le matin même.</p>`;
    case 'reminder': return reminderFields(x);
    case 'idea': return `
      <label class="f wide">L'idée<textarea name="text" rows="4" required>${esc(x.text)}</textarea></label>
      <label class="set-row wide" style="border:0;padding:0"><span><b>Au parking à idées</b><small>Pour plus tard, sans pression.</small></span>
        <input type="checkbox" class="switch" name="parked" ${x.parked ? 'checked' : ''}></label>`;
    default: return '';
  }
}

function sheetButtons(type, x) {
  if (!x.id) return '';
  const more = {
    task: x.done ? '' : `<button type="button" class="btn good" data-act="sheetTaskDone">C'est fait</button>`,
    reminder: x.done ? '' : `<button type="button" class="btn good" data-act="sheetRemDone">Fait</button>`,
    idea: `<button type="button" class="btn soft" data-act="ideaTask" data-id="${x.id}">En faire une tâche</button>`,
    event: '',
  }[type];
  return `${more}<button type="button" class="btn ghost" data-act="sheetDel">Supprimer</button>`;
}

function notesHTML(x) {
  const notes = [...(x.notes || [])].reverse();
  return `<section class="notes"><h3>Notes</h3>
    <form class="note-form" data-form="note">
      <textarea name="text" rows="2" data-enter placeholder="Ajouter une note… (Entrée pour l'ajouter)" aria-label="Nouvelle note"></textarea>
    </form>
    ${notes.length ? `<ul class="note-list">${notes.map(n => `
      <li><small>${cap(fmtDay(new Date(n.at)))}, ${L.clock(new Date(n.at))}</small><p>${esc(n.text)}</p>
        <button class="x" data-act="noteDel" data-at="${n.at}" aria-label="Supprimer la note">×</button></li>`).join('')}</ul>`
      : '<p class="hint" style="margin-top:8px">Un numéro de dossier, ce qui a été dit, la suite à donner : note-le ici, avec la date.</p>'}
  </section>`;
}

function renderSheet() {
  const el = $('#sheet'), x = sheetItem();
  if (!x) { sheet = null; el.className = ''; el.innerHTML = ''; return; }
  const type = sheet.type;
  el.className = 'open';
  el.innerHTML = `<div class="sheet-scrim" data-act="closeSheet"></div>
    <aside class="sheet-panel sph-${L.sphereOf(x)}" role="dialog" aria-label="${KIND_LABEL[type]}">
      <div class="sheet-head"><span class="sheet-kind">${x.id ? KIND_LABEL[type] : 'Nouvel ' + KIND_LABEL[type].toLowerCase()}</span>
        <button class="x" data-act="closeSheet" aria-label="Fermer">×</button></div>
      <form class="sheet-form" data-form="sheet" data-kind="${esc(x.kind || '')}" data-allday="${!!x.allDay}">
        <div class="wide">${spherePickHTML(x)}</div>${sheetFields(type, x)}
        <p class="form-error wide" role="alert" hidden></p>
        <div class="row"><button class="btn">Enregistrer</button>${sheetButtons(type, x)}</div>
      </form>
      ${x.id ? notesHTML(x) : ''}
    </aside>`;
}

// ---------- Anti-chevauchement ----------

// Premier élément qui occupe déjà le créneau de `x` (tâche avec heure ou événement), ou null.
// Pour un événement récurrent, on vérifie ses occurrences des deux prochains mois.
function slotClash(type, x) {
  if (type === 'task') {
    if (!x.date || !x.time || x.done) return null;
    const start = L.at(new Date(x.date + 'T00:00'), x.time);
    return L.findConflict(D, start, new Date(start.getTime() + (x.duration || 30) * L.MIN), { kind: 'task', id: x.id });
  }
  if (type === 'event' && !x.allDay && x.date) {
    const len = L.eventEnd(x) - L.eventStart(x), from = startOfDay(new Date());
    for (const occ of L.eventOccurrences(x, from, L.addDays(from, 62)).slice(0, 60)) {
      if (occ < from && x.repeat && x.repeat !== 'none') continue;
      const c = L.findConflict(D, occ, new Date(occ.getTime() + len), { kind: 'event', id: x.id });
      if (c) return c;
    }
  }
  return null;
}

// ---------- Glisser-déposer ----------

let drag = null;
const DROP_ZONES = '.ag-col, .ag-allday > div[data-date], .ag-cell';

// Déplace un élément vers `date` ; `time` = nouvelle heure, 'keep' = garder l'heure, null + allDay = journée entière.
function moveItem(d, date, time, allDay) {
  const list = D[COLL[d.kind]], x = list.find(y => y.id === d.id);
  if (!x) return;
  const next = { ...x, notified: null };
  if (d.kind === 'event') {
    const len = Math.round((L.eventEnd(x) - L.eventStart(x)) / L.MIN);
    const from = d.occ ? L.dayKey(new Date(d.occ)) : x.date;
    const shift = Math.round((new Date(date + 'T12:00') - new Date(from + 'T12:00')) / 864e5);
    next.date = L.dayKey(L.addDays(new Date(x.date + 'T12:00'), shift)); // une série récurrente glisse en entier
    if (allDay) next.allDay = true;
    else if (time && time !== 'keep') {
      const dur = x.allDay ? 60 : len;
      Object.assign(next, { allDay: false, start: time, end: L.toHM(L.hm(time) + dur) });
    }
  } else if (d.kind === 'task') {
    next.date = date;
    if (allDay) next.time = '';
    else if (time && time !== 'keep') next.time = time;
    if (x.repeat && x.repeat !== 'none') next.anchor = date;
  } else {
    next.date = date;
    if (time && time !== 'keep') next.time = time;
    Object.assign(next, { lastFired: null, snoozedUntil: null });
    next.due = L.firstDue(next, new Date()).toISOString();
  }
  // L'occurrence déplacée elle-même doit tomber sur un créneau libre.
  const probe = d.kind === 'event' && next.repeat && next.repeat !== 'none' ? { ...next, repeat: 'none', date } : next;
  const clash = d.kind === 'reminder' ? null : slotClash(d.kind, probe);
  if (clash) { toast(conflictMessage(clash), 6000); return; }
  Object.assign(x, next);
  save(); toast('Déplacé.');
}

document.addEventListener('dragstart', e => {
  const it = e.target.closest?.('.ag-item[draggable="true"]');
  if (!it) return;
  const r = it.getBoundingClientRect();
  drag = { kind: it.dataset.type, id: it.dataset.id, occ: it.dataset.occ, grab: it.closest('.ag-col') ? ((e.clientY - r.top) / HOUR_PX) * 60 : 0 };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.id);
  requestAnimationFrame(() => it.classList.add('dragging'));
});
document.addEventListener('dragend', () => {
  drag = null;
  document.querySelectorAll('.drop-target, .dragging').forEach(el => el.classList.remove('drop-target', 'dragging'));
});
document.addEventListener('dragover', e => {
  const zone = drag && e.target.closest(DROP_ZONES);
  if (!zone) return;
  e.preventDefault();
  if (!zone.classList.contains('drop-target')) {
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    zone.classList.add('drop-target');
  }
});
document.addEventListener('drop', e => {
  const zone = drag && e.target.closest(DROP_ZONES);
  if (!zone) return;
  e.preventDefault();
  const d = drag;
  if (zone.classList.contains('ag-col')) {
    const y = e.clientY - zone.getBoundingClientRect().top;
    const mins = Math.round((S().agendaFrom * 60 + (y / HOUR_PX) * 60 - d.grab) / 15) * 15;
    moveItem(d, zone.dataset.date, L.toHM(Math.max(0, Math.min(1425, mins))), false);
  } else if (zone.classList.contains('ag-cell')) moveItem(d, zone.dataset.date, 'keep', false);
  else moveItem(d, zone.dataset.date, null, true);
});

// ---------- Actions et formulaires ----------

const AGENDA_ACT = {
  agView: d => { S().agendaView = d.v; save(); },
  agMove: d => {
    const n = Number(d.n), v = S().agendaView, a = new Date(agendaAnchor);
    if (v === 'day') a.setDate(a.getDate() + n);
    else if (v === 'week') a.setDate(a.getDate() + 7 * n);
    else a.setMonth(a.getMonth() + n, 1);
    agendaAnchor = a; render();
  },
  agToday: () => { agendaAnchor = new Date(); agendaScrolled = false; render(); },
  agDay: d => { agendaAnchor = new Date(d.date + 'T12:00'); S().agendaView = 'day'; agendaScrolled = false; save(); },
  slot: (d, el, e) => {
    const s = S(), y = e.clientY - el.getBoundingClientRect().top;
    const mins = Math.max(0, Math.min(1410, Math.round((s.agendaFrom * 60 + (y / HOUR_PX) * 60) / 30) * 30));
    openSheet('event', null, { date: d.date, start: L.toHM(mins), end: L.toHM(Math.min(mins + 60, 1439)), sphere: defaultSphere() });
  },
  slotDay: d => openSheet('event', null, { date: d.date, allDay: true, sphere: defaultSphere() }),
  newEvent: () => {
    const t = new Date(), m = Math.ceil((t.getHours() * 60 + t.getMinutes()) / 30) * 30 + 30;
    openSheet('event', null, { date: L.dayKey(t), start: L.toHM(m), end: L.toHM(m + 60), sphere: defaultSphere() });
  },
  open: d => openSheet(d.type, d.id),
  closeSheet: () => { sheet = null; render(); },
  sheetDel: async () => {
    if (!confirm('Supprimer définitivement ?')) return;
    const { type, id } = sheet;
    sheet = null;
    if (type === 'reminder') { await api.reminder(id, 'delete'); render(); return; }
    D[COLL[type]] = D[COLL[type]].filter(x => x.id !== id);
    save(); toast('Supprimé.');
  },
  sheetTaskDone: () => { const id = sheet.id; sheet = null; doneTask(id); },
  sheetRemDone: async () => { const id = sheet.id; sheet = null; await api.reminder(id, 'done'); toast('Fait.'); },
  noteDel: d => { const x = sheetItem(); x.notes = (x.notes || []).filter(n => n.at !== d.at); save(); },
};

const AGENDA_FORM = {
  sheet: v => {
    const { type } = sheet, now = new Date();
    if (type === 'reminder') { FORM.reminder({ ...v, id: sheet.id || '' }); sheet = null; return; }
    const list = D[COLL[type]];
    const old = (sheet.id && list.find(y => y.id === sheet.id)) || null;
    const x = { ...(old || { id: uid(), at: now.toISOString(), notes: [], done: false }), sphere: v.sphere || defaultSphere() };
    if (type === 'task') {
      const repeat = v.repeat || 'none', date = v.date || (repeat !== 'none' ? L.dayKey(now) : '');
      if (date + (v.time || '') !== (x.date || '') + (x.time || '')) x.notified = null;
      if (repeat !== x.repeat || date !== x.date) x.anchor = date;
      Object.assign(x, { title: v.title.trim(), firstStep: (v.firstStep || '').trim(), date, time: v.time || '', duration: Number(v.duration) || null, repeat });
    } else if (type === 'event') {
      const allDay = v.allDay === 'on';
      if (v.date + (allDay ? '' : v.start) !== x.date + (x.allDay ? '' : x.start)) x.notified = null;
      Object.assign(x, { title: v.title.trim(), date: v.date, allDay, start: v.start || '10:00', end: v.end || '', place: (v.place || '').trim(), repeat: v.repeat || 'none' });
    } else if (type === 'idea') {
      Object.assign(x, { text: v.text.trim(), parked: v.parked === 'on' });
    }
    const clash = slotClash(type, x);
    if (clash) { const p = $('#sheet .form-error'); p.textContent = conflictMessage(clash); p.hidden = false; return; }
    if (old) Object.assign(old, x); else list.push(x);
    sheet = null;
    save(); toast('Enregistré.');
  },
  note: (v, f) => {
    const text = v.text.trim(), x = sheetItem();
    if (!text || !x) return;
    (x.notes ||= []).push({ at: new Date().toISOString(), text });
    f.reset();
    save().then(() => $('.note-form textarea')?.focus());
  },
};
