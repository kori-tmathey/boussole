// Fonctions pures partagées : processus principal (require), interface (<script>) et test.js.
(function () {
  const MIN = 60000;

  const DEFAULT_SETTINGS = {
    prenom: '',
    tone: 'doux', // doux | direct | humour
    theme: 'auto', // auto = jour/soir selon l'heure, sinon nom d'un thème
    dayTheme: 'lagune',
    nightTheme: 'veilleuse',
    accent: '',
    textScale: 100,
    reduceMotion: false,
    celebrate: true,
    sounds: true,
    nudgeWindow: true,
    nagEvery: 10,
    quietStart: '01:30',
    quietEnd: '09:30',
    chimeEvery: 45,
    chimeOnlyActive: true,
    wake: '10:30',
    bedtime: '00:30',
    windDown: 45,
    checkins: '13:00, 20:00',
    focusDefault: 25,
    breathSeconds: 5,
    modules: { agenda: true, rappels: true, focus: true, tete: true, soir: true, meteo: true },
    autostart: true,
    startHidden: false,
    closeToTray: true,
    shortcut: 'Control+Shift+Space',
    backupDir: '', // dossier de sauvegarde supplémentaire (cloud)
    // Sphères Perso / Pro
    spheres: {
      perso: { name: 'Perso', icon: '🏠', sound: 'doux' },
      pro: { name: 'Pro', icon: '💼', sound: 'net' },
    },
    persoColor: '',
    proColor: '',
    sphereMode: 'auto', // auto = Pro pendant les horaires de travail, Perso sinon | manuel
    sphereView: 'tout', // choix en mode manuel : tout | perso | pro
    workDays: [1, 2, 3, 4, 5],
    workStart: '09:00',
    workEnd: '18:00',
    proOff: 'defer', // Pro hors horaires : defer | silent | normal
    persoAtWork: 'silent', // Perso pendant le travail : silent | defer | normal
    // Agenda
    agendaView: 'week', // day | week | month
    agendaFrom: 8,
    agendaTo: 24,
    eventLead: 15, // minutes avant un événement
    // Téléphone et messages d'un proche, via ntfy (gratuit, open source)
    phone: { enabled: false, server: 'https://ntfy.sh', topic: '', detail: 'full' },
    kelly: { enabled: false, name: '', topic: '', since: 0, lastId: '' },
  };

  const pad = n => String(n).padStart(2, '0');
  const hm = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const toHM = mins => { const m = ((mins % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minutesOfDay = d => d.getHours() * 60 + d.getMinutes();
  const clock = d => pad(d.getHours()) + ':' + pad(d.getMinutes());

  // Début inclus, fin exclue ; gère le passage de minuit (ex. 23:00 → 08:00).
  function inWindow(d, start, end) {
    const m = minutesOfDay(d), s = hm(start), e = hm(end);
    if (s === e) return false;
    return s < e ? m >= s && m < e : m >= s || m < e;
  }

  function at(day, time) {
    const d = new Date(day), t = hm(time);
    d.setHours(Math.floor(t / 60), t % 60, 0, 0);
    return d;
  }

  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const daysInMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

  function matchesDay(r, day) {
    switch (r.kind) {
      case 'daily': return true;
      case 'weekdays': return day.getDay() >= 1 && day.getDay() <= 5;
      case 'weekly': return day.getDay() === Number(r.weekday);
      case 'monthly': return day.getDate() === Math.min(Number(r.monthDay), daysInMonth(day));
      case 'yearly': return repeatMatches('yearly', dateOf(r.date), day);
      default: return false;
    }
  }

  // Récurrence ancrée sur un jour de départ (événements, tâches, rappels annuels).
  const dateOf = s => new Date(s + 'T00:00:00');
  function repeatMatches(repeat, anchor, day) {
    if (dayKey(day) < dayKey(anchor)) return false;
    const sameMonthDay = () => day.getDate() === Math.min(anchor.getDate(), daysInMonth(day));
    switch (repeat) {
      case 'daily': return true;
      case 'weekdays': return day.getDay() >= 1 && day.getDay() <= 5;
      case 'weekly': return day.getDay() === anchor.getDay();
      case 'monthly': return sameMonthDay();
      case 'yearly': return day.getMonth() === anchor.getMonth() && sameMonthDay();
      default: return dayKey(day) === dayKey(anchor);
    }
  }

  // Prochaine échéance strictement après `after` (null pour un rappel unique déjà passé).
  function nextOccurrence(r, after) {
    if (r.kind === 'once') {
      const d = at(new Date(r.date + 'T00:00:00'), r.time);
      return d > after ? d : null;
    }
    for (let i = 0; i < 400; i++) {
      const day = addDays(after, i);
      const cand = at(day, r.time);
      if (cand > after && matchesDay(r, day)) return cand;
    }
    return null;
  }

  // Échéance à la création : un rappel unique garde sa date même passée (il sonnera tout de suite).
  function firstDue(r, now) {
    if (r.kind === 'once') return at(new Date(r.date + 'T00:00:00'), r.time);
    return nextOccurrence(r, new Date(now.getTime() - 1));
  }

  // ---------- Sphères Perso / Pro ----------

  const sphereOf = x => (x && x.sphere === 'pro' ? 'pro' : 'perso');
  const isWork = (s, now) => (s.workDays || []).includes(now.getDay()) && inWindow(now, s.workStart, s.workEnd);
  const autoSphere = (s, now) => (isWork(s, now) ? 'pro' : 'perso');

  // Comment notifier un élément de cette sphère maintenant : normal | silent | defer (attendre).
  function notifyMode(s, sphere, now, urgent) {
    if (urgent) return 'normal';
    const work = isWork(s, now);
    if (sphere === 'pro' && !work) return s.proOff || 'normal';
    if (sphere === 'perso' && work) return s.persoAtWork || 'normal';
    return 'normal';
  }

  function shouldFire(r, now, s) {
    if (r.done || !r.due) return false;
    const due = new Date(r.due);
    if (now < due) return false;
    if (r.snoozedUntil && now < new Date(r.snoozedUntil)) return false;
    if (!r.urgent && s.quietStart && inWindow(now, s.quietStart, s.quietEnd)) return false;
    if (notifyMode(s, sphereOf(r), now, r.urgent) === 'defer') return false;
    const last = r.lastFired ? new Date(r.lastFired) : null;
    const snooze = r.snoozedUntil ? new Date(r.snoozedUntil) : null;
    if (!last || last < due || (snooze && last < snooze)) return true;
    const nag = r.nag ?? s.nagEvery;
    return nag > 0 && now - last >= nag * MIN;
  }

  // « Fait » : un rappel unique se termine, un rappel récurrent passe au cycle suivant.
  function complete(r, now) {
    if (r.kind === 'once') return { ...r, done: true, doneAt: now.toISOString(), snoozedUntil: null };
    const from = new Date(Math.max(new Date(r.due).getTime(), now.getTime()));
    const next = nextOccurrence(r, from);
    return { ...r, due: next && next.toISOString(), lastFired: null, snoozedUntil: null, lastDone: now.toISOString() };
  }

  const snooze = (r, minutes, now) => ({ ...r, snoozedUntil: new Date(now.getTime() + minutes * MIN).toISOString() });

  // « Demain » = demain, une heure après le lever.
  const untilTomorrow = (s, now) => Math.round((at(addDays(now, 1), toHM(hm(s.wake) + 60)) - now) / MIN);

  // Le soir commence `windDown` minutes avant le coucher et dure jusqu'au lever.
  const isNight = (s, now) => inWindow(now, toHM(hm(s.bedtime) - s.windDown), s.wake);

  // Prochain coucher ; s'il est passé (on est en pleine nuit), renvoie celui qui vient de passer.
  function bedtimeFor(s, now) {
    let b = at(now, s.bedtime);
    const afterMidnight = hm(s.bedtime) < hm(s.wake);
    if (afterMidnight && minutesOfDay(now) >= hm(s.wake)) b = addDays(b, 1);
    if (!afterMidnight && minutesOfDay(now) < hm(s.wake)) b = addDays(b, -1);
    return b;
  }

  function duration(mins) {
    mins = Math.max(0, Math.round(mins));
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h} h ${pad(m)}` : `${h} h`;
  }

  function addWin(data, text, now) {
    data.wins.unshift({ at: now.toISOString(), text });
    const limit = addDays(now, -60).toISOString();
    data.wins = data.wins.filter(w => w.at >= limit);
  }

  const winsOn = (data, now) => data.wins.filter(w => dayKey(new Date(w.at)) === dayKey(now));

  const MSG = {
    doux: {
      reminder: ['Petit rappel : {t}', 'Je te garde ça en tête : {t}', 'Quand tu peux : {t}'],
      nag: ['Toujours là : {t}. Une minute suffit peut-être.', 'Je repasse, tranquillement : {t}', 'Pas de reproche, juste un rappel : {t}'],
      chime: ['Il est {h}. Où en es-tu ?', 'Point temps : il est {h}.', '{h}. Le temps passe, toi tu respires.'],
      winddown: ['Le coucher est dans {m} min. On commence à ralentir ?', 'Dans {m} min, au lit. Tu peux déjà poser ce qui tourne dans ta tête.'],
      bedtime: ['C\'est l\'heure. Aujourd\'hui : {n} victoire(s). Ta journée a compté.', 'Il est l\'heure de dormir. Le reste peut attendre demain.'],
      checkin: ['Quelle météo à l\'intérieur ?', 'Comment ça va, vraiment ? Un clic suffit.'],
      focusEnd: ['Bloc terminé. Bravo d\'avoir commencé.', 'Fini ! Le plus dur, c\'était de lancer.'],
      done: ['Fait. Un poids en moins.', 'Bien joué.', 'C\'est rangé.'],
    },
    direct: {
      reminder: ['À faire : {t}', 'Maintenant : {t}'],
      nag: ['Encore en attente : {t}', 'Relance : {t}'],
      chime: ['Il est {h}.', '{h}.'],
      winddown: ['Coucher dans {m} min.'],
      bedtime: ['Heure du coucher. {n} victoire(s) aujourd\'hui.'],
      checkin: ['Check-in météo.'],
      focusEnd: ['Bloc terminé.'],
      done: ['Fait.', 'Validé.'],
    },
    humour: {
      reminder: ['Ton cerveau m\'a confié un truc : {t}', 'Ding ! {t}', 'Mission du moment : {t}'],
      nag: ['Je suis têtu, comme toi : {t}', 'Toc toc. C\'est encore moi : {t}', 'Version polie de « tu as oublié » : {t}'],
      chime: ['Il est {h}. Oui, déjà.', '{h}. Le temps file, je te le dis en ami.', 'Flash info : il est {h}.'],
      winddown: ['Dans {m} min, le lit t\'attend. Il est patient, mais quand même.'],
      bedtime: ['{n} victoire(s) au compteur. Le jeu se sauvegarde, tu peux dormir.', 'Fin de partie pour aujourd\'hui. Sauvegarde automatique activée.'],
      checkin: ['Bulletin météo intérieur ?', 'Soleil, nuages ou tempête là-dedans ?'],
      focusEnd: ['Boss vaincu. +1 victoire.', 'Bloc terminé. Applaudissements du public.'],
      done: ['Et un de moins !', 'Achievement débloqué.', 'Pouf, disparu.'],
    },
  };

  function msg(tone, key, vars = {}) {
    const list = (MSG[tone] || MSG.doux)[key] || MSG.doux[key];
    const s = list[Math.floor(Math.random() * list.length)];
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }

  // ---------- Tâches datées et événements ----------

  const taskStart = t => (t.date ? at(new Date(t.date + 'T00:00:00'), t.time || '00:00') : null);
  const eventStart = e => at(new Date(e.date + 'T00:00:00'), e.allDay ? '00:00' : e.start);
  function eventEnd(e) {
    if (e.allDay) return addDays(eventStart(e), 1);
    const end = at(new Date(e.date + 'T00:00:00'), e.end || toHM(hm(e.start) + 60));
    return end > eventStart(e) ? end : addDays(end, 1); // finit après minuit
  }

  // Une tâche avec une heure prévient une fois, à l'heure dite (jusqu'à 6 h de retard).
  function taskShouldNotify(t, now, s) {
    if (t.done || t.notified || !t.date || !t.time) return false;
    const start = taskStart(t), late = now - start;
    if (late < 0 || late > 6 * 60 * MIN) return false;
    if (s.quietStart && inWindow(now, s.quietStart, s.quietEnd)) return false;
    return notifyMode(s, sphereOf(t), now, false) !== 'defer';
  }

  // Débuts des occurrences d'un événement (récurrent ou non) qui touchent [from, to).
  function eventOccurrences(e, from, to) {
    if (!e.repeat || e.repeat === 'none') return [eventStart(e)];
    const len = eventEnd(e) - eventStart(e), anchor = dateOf(e.date), out = [];
    let day = new Date(Math.max(anchor, from - len)); day.setHours(0, 0, 0, 0);
    for (let i = 0; day < to && i < 800; i++, day = addDays(day, 1))
      if (repeatMatches(e.repeat, anchor, day)) out.push(at(day, e.allDay ? '00:00' : e.start));
    return out;
  }

  // Occurrence à annoncer maintenant, ou null. Un événement prévient une fois par occurrence :
  // `eventLead` minutes avant, ou le matin (heure du lever) pour une journée entière (anniversaire…).
  // Placé exprès à cette heure : jamais reporté.
  function eventShouldNotify(e, now, s) {
    if (!e.date) return null;
    const single = !e.repeat || e.repeat === 'none';
    for (const occ of eventOccurrences(e, addDays(now, -1), addDays(now, 2))) {
      if (single ? e.notified : e.notified === occ.toISOString()) continue;
      const from = e.allDay ? at(occ, s.wake) : new Date(occ - (s.eventLead || 0) * MIN);
      if (now >= from && now < (e.allDay ? addDays(occ, 1) : occ)) return occ;
    }
    return null;
  }

  // « C'est fait » : une tâche répétée revient à sa prochaine date au lieu de se terminer.
  function completeTask(t, now) {
    if (!t.repeat || t.repeat === 'none' || !t.date) return { ...t, done: true, doneAt: now.toISOString() };
    const anchor = dateOf(t.anchor || t.date), today = dateOf(dayKey(now));
    let day = addDays(new Date(Math.max(dateOf(t.date), today)), 1);
    for (let i = 0; i < 800 && !repeatMatches(t.repeat, anchor, day); i++) day = addDays(day, 1);
    return { ...t, date: dayKey(day), anchor: t.anchor || t.date, notified: null, lastDone: now.toISOString() };
  }

  // Tout ce qui tombe entre `from` et `to`, pour l'agenda.
  // Les rappels récurrents ne sont dépliés qu'à partir d'aujourd'hui : avant, ils n'ont pas d'historique.
  function agendaItems(data, from, to, now = new Date()) {
    const out = [];
    const push = (kind, x, start, end, allDay, done, repeat) => {
      if (start < to && (end || start) >= from)
        out.push({ kind, id: x.id, title: x.title, sphere: sphereOf(x), start, end, allDay, done: !!done, repeat, occ: start.toISOString() });
    };
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    for (const e of data.events || []) {
      if (!e.date) continue;
      const len = eventEnd(e) - eventStart(e);
      for (const start of eventOccurrences(e, from, to)) push('event', e, start, new Date(start.getTime() + len), !!e.allDay, false, e.repeat);
    }
    for (const t of data.tasks) {
      if (!t.date) continue;
      const start = taskStart(t);
      push('task', t, start, t.time && t.duration ? new Date(start.getTime() + t.duration * MIN) : null, !t.time, t.done, t.repeat);
    }
    for (const r of data.reminders) {
      if (r.kind === 'once') { if (r.date) push('reminder', r, at(new Date(r.date + 'T00:00:00'), r.time), null, false, r.done, 'once'); continue; }
      const due = r.due ? new Date(r.due) : null;
      let occ = nextOccurrence(r, new Date(Math.max(from, today) - 1));
      for (let i = 0; occ && occ < to && i < 100; i++) {
        push('reminder', r, occ, null, false, due && occ < due, r.kind);
        occ = nextOccurrence(r, occ);
      }
    }
    return out.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  }

  // Colonnes côte à côte pour les éléments qui se chevauchent dans une journée.
  function layoutDay(items, minMinutes = 30) {
    const end = x => Math.max((x.end || x.start).getTime(), x.start.getTime() + minMinutes * MIN);
    const sorted = [...items].sort((a, b) => a.start - b.start);
    const out = [];
    let group = [], groupEnd = 0, lanes = [];
    const flush = () => { for (const g of group) g.lanes = lanes.length; group = []; lanes = []; };
    for (const x of sorted) {
      if (group.length && x.start.getTime() >= groupEnd) flush();
      let lane = lanes.findIndex(e => e <= x.start.getTime());
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = end(x);
      const placed = { ...x, lane };
      group.push(placed); out.push(placed);
      groupEnd = Math.max(groupEnd, end(x));
    }
    flush();
    return out;
  }

  // ---------- Notifications programmées à l'avance (Android) ----------

  // Identifiant numérique stable (Android exige un entier 32 bits).
  const hashId = str => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 2147483647; };

  // Les prochaines notifications des `days` jours, avec les mêmes règles que le planificateur du PC :
  // heures calmes, sphères (reporté / silencieux), urgent, relances, une fois par jour pour le soir et la météo.
  function planNotifications(data, now, days = 7, max = 60) {
    const s = data.settings, end = addDays(now, days), out = [];
    const quiet = d => !!s.quietStart && inWindow(d, s.quietStart, s.quietEnd);
    // Premier instant ≥ t (par pas de 5 min) où l'on a le droit de notifier.
    const allowed = (t, sphere, urgent) => {
      let x = new Date(Math.max(t, now));
      for (let i = 0; i < 7 * 288 && x < end; i++) {
        if ((urgent || !quiet(x)) && (!sphere || notifyMode(s, sphere, x, urgent) !== 'defer')) return x;
        x = new Date(Math.floor(x.getTime() / (5 * MIN)) * 5 * MIN + 5 * MIN);
      }
      return null;
    };
    const add = (at, kind, ref, title, body, sphere, urgent = false, occ = null) => {
      if (!at || at < now || at >= end) return;
      const mode = urgent ? 'urgent' : sphere ? notifyMode(s, sphere, at, false) : 'normal';
      out.push({ id: hashId(`${kind}:${ref}:${at.toISOString()}`), at, kind, ref, title, body: body || '', sphere: sphere || null, mode, occ });
    };

    if (s.modules.rappels) {
      for (const r of data.reminders) {
        if (r.done || !r.due) continue;
        const sphere = sphereOf(r), start = new Date(Math.max(new Date(r.due), r.snoozedUntil ? new Date(r.snoozedUntil) : 0));
        const fired = r.lastFired && new Date(r.lastFired) >= start;
        const nag = r.nag ?? s.nagEvery;
        let t = allowed(fired ? new Date(new Date(r.lastFired).getTime() + nag * MIN) : start, sphere, r.urgent);
        if (fired && !(nag > 0)) t = null;
        for (let k = 0; t && k < 6; k++) {
          add(t, k || fired ? 'nag' : 'reminder', r.id, msg(s.tone, k || fired ? 'nag' : 'reminder', { t: r.title }), r.note, sphere, r.urgent);
          t = nag > 0 ? allowed(new Date(t.getTime() + nag * MIN), sphere, r.urgent) : null;
        }
      }
    }
    for (const t of data.tasks) {
      if (t.done || t.notified || !t.date || !t.time) continue;
      const start = taskStart(t), at = allowed(start, sphereOf(t), false);
      if (at && at - start <= 6 * 60 * MIN) add(at, 'task', t.id, `C'est l'heure : ${t.title}`, t.firstStep ? `Première petite étape : ${t.firstStep}` : '', sphereOf(t));
    }
    if (s.modules.agenda) {
      for (const e of data.events || []) {
        if (!e.date) continue;
        const single = !e.repeat || e.repeat === 'none';
        for (const occ of eventOccurrences(e, now, end)) {
          if (single ? e.notified : e.notified === occ.toISOString()) continue;
          const at = e.allDay ? at_(occ, s.wake) : new Date(occ - (s.eventLead || 0) * MIN);
          add(at, 'event', e.id, e.allDay ? `Aujourd'hui : ${e.title}` : `Dans ${s.eventLead || 0} min : ${e.title}`,
            e.allDay ? e.place : `${e.start}${e.end ? ' – ' + e.end : ''}${e.place ? ', ' + e.place : ''}`, sphereOf(e), false, occ.toISOString());
        }
      }
    }
    // Une fois par jour : décrocher, coucher, check-ins météo (jamais pendant les heures calmes).
    const daily = (key, time, title, body) => {
      for (let i = 0; i <= days; i++) {
        const at = at_(addDays(now, i), time);
        if (data.fired[key] === dayKey(at) || quiet(at)) continue;
        add(at, 'daily', key, title, body, null);
      }
    };
    if (s.modules.soir) {
      daily('winddown', toHM(hm(s.bedtime) - s.windDown), msg(s.tone, 'winddown', { m: s.windDown }), 'Ouvre « Ce soir » pour fermer la journée en douceur.');
      daily('bedtime', s.bedtime, 'C\'est l\'heure de dormir.', 'Le reste peut attendre demain. Ouvre « Ce soir » pour voir tes victoires.');
    }
    if (s.modules.meteo) {
      for (const t of String(s.checkins).split(',').map(x => x.trim()).filter(x => /^\d{1,2}:\d{2}$/.test(x)))
        daily('checkin-' + t, t, msg(s.tone, 'checkin'), 'Un clic suffit.');
    }
    return out.sort((a, b) => a.at - b.at).slice(0, max);
  }
  const at_ = (day, time) => at(day, time);

  // Créneau déjà pris par une tâche avec heure ou un événement, quelle que soit la sphère.
  function findConflict(data, start, end, ignore = {}) {
    const items = agendaItems(data, addDays(start, -1), addDays(end, 1), start);
    return items.find(x => !x.allDay && x.kind !== 'reminder' && !x.done && !(x.kind === ignore.kind && x.id === ignore.id)
      && x.start < end && start < (x.end || new Date(x.start.getTime() + 30 * MIN))) || null;
  }

  // ---------- Recherche ----------

  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Tous les mots doivent apparaître, sans tenir compte des accents ni des majuscules. Notes comprises.
  function search(data, query) {
    const words = fold(query).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const hit = (...parts) => { const hay = fold(parts.join(' ')); return words.every(w => hay.includes(w)); };
    const notes = x => (x.notes || []).map(n => n.text).join(' ');
    const out = [];
    for (const t of data.tasks) if (hit(t.title, t.firstStep, notes(t))) out.push({ kind: 'task', item: t });
    for (const r of data.reminders) if (hit(r.title, r.note, notes(r))) out.push({ kind: 'reminder', item: r });
    for (const e of data.events || []) if (hit(e.title, e.place, notes(e))) out.push({ kind: 'event', item: e });
    for (const i of data.ideas) if (hit(i.text, notes(i))) out.push({ kind: 'idea', item: i });
    for (const m of data.moods) if (m.note && hit(m.note)) out.push({ kind: 'mood', item: m });
    return out;
  }

  // ---------- Messages envoyés par un proche ----------

  const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const L_ = '(?<!\\p{L})', _L = '(?!\\p{L})';

  // « Acheter du pain » → tâche ; « rappel Appeler le garage demain 10h » → rappel daté.
  function parseMessage(text, now) {
    let t = ' ' + String(text || '').trim() + ' ';
    let type = 'task', date = null, time = null, m;
    const take = re => { const x = t.match(re); if (x) t = t.slice(0, x.index) + ' ' + t.slice(x.index + x[0].length); return x; };
    if (take(new RegExp(`^\\s*(rappelle[- ]moi( de| d')?|rappel(le)?)${_L}\\s*[:\\-–]?`, 'iu'))) type = 'reminder';
    if ((m = take(new RegExp(`${L_}(?:à|a|vers)?\\s*([01]?\\d|2[0-3])\\s*(?:h|:)\\s*([0-5]\\d)?(?!\\d)`, 'iu')))) time = pad(+m[1]) + ':' + pad(+(m[2] || 0));
    if (take(new RegExp(`${L_}apr[eè]s-demain${_L}`, 'iu'))) date = addDays(now, 2);
    else if (take(new RegExp(`${L_}demain${_L}`, 'iu'))) date = addDays(now, 1);
    else if ((m = take(new RegExp(`${L_}(aujourd['’]hui|ce soir|ce matin|cet apr[eè]s-midi)${_L}`, 'iu')))) {
      date = new Date(now);
      if (!time && /soir/i.test(m[1])) time = '19:00';
      if (!time && /matin/i.test(m[1])) time = '09:00';
    } else if ((m = take(/(?:le\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      date = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && dayKey(date) < dayKey(now)) date.setFullYear(y + 1);
    } else if ((m = take(new RegExp(`${L_}(?:ce\\s+|le\\s+)?(${WEEKDAYS.join('|')})${_L}`, 'iu')))) {
      date = addDays(now, (WEEKDAYS.indexOf(m[1].toLowerCase()) - now.getDay() + 7) % 7);
    }
    let title = t.replace(/\s+/g, ' ').replace(/\s+(à|a|le|pour|de)\s*$/i, '').replace(/^[\s,.:;–-]+|[\s,.:;–-]+$/g, '').trim();
    title = title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Sans titre';
    if (type === 'reminder') {
      if (!date) date = new Date(now);
      if (!time) time = dayKey(date) === dayKey(now) ? toHM(Math.ceil((minutesOfDay(now) + 60) / 15) * 15) : '10:00';
    }
    return { type, title, date: date ? dayKey(date) : '', time: time || '' };
  }

  // Un message ntfy d'un proche → l'élément à ajouter (id stable `k<id>` : PC et téléphone ne le dupliquent pas),
  // le texte de la notification et celui de l'accusé de réception.
  function messageToItem(m, now, name) {
    const p = parseMessage(m.message || m.title, now), id = 'k' + m.id;
    const notes = [{ at: now.toISOString(), text: `Envoyé par ${name}${m.title && m.message ? ' : ' + m.title : ''}` }];
    const base = { id, title: p.title, sphere: 'perso', notes, from: 'kelly' };
    const item = p.type === 'reminder'
      ? { ...base, cat: 'autre', kind: 'once', date: p.date, time: p.time, nag: null, note: '', urgent: false, done: false }
      : { ...base, firstStep: '', done: false, date: p.date, time: p.time, at: now.toISOString() };
    if (p.type === 'reminder') item.due = firstDue(item, now).toISOString();
    const when = p.date ? ` le ${new Date(p.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${p.time ? ' à ' + p.time : ''}` : '';
    return {
      coll: p.type === 'reminder' ? 'reminders' : 'tasks', item, type: p.type,
      title: `${name} t'envoie : ${p.title}`, body: `${p.type === 'reminder' ? 'Rappel' : 'Tâche'}${when}.`,
      ack: `${p.title} (${p.type === 'reminder' ? 'rappel' : 'tâche'}${when})`,
    };
  }

  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const given = d.settings || {};
    const s = { ...DEFAULT_SETTINGS, ...given };
    s.modules = { ...DEFAULT_SETTINGS.modules, ...(given.modules || {}) };
    s.spheres = {
      perso: { ...DEFAULT_SETTINGS.spheres.perso, ...((given.spheres || {}).perso || {}) },
      pro: { ...DEFAULT_SETTINGS.spheres.pro, ...((given.spheres || {}).pro || {}) },
    };
    if (!Array.isArray(s.workDays)) s.workDays = [...DEFAULT_SETTINGS.workDays];
    s.phone = { ...DEFAULT_SETTINGS.phone, ...(given.phone || {}) };
    s.kelly = { ...DEFAULT_SETTINGS.kelly, ...(given.kelly || {}) };
    const arr = k => (Array.isArray(d[k]) ? d[k] : []);
    return {
      rev: Number(d.rev) || 0,
      settings: s, tasks: arr('tasks'), reminders: arr('reminders'), events: arr('events'), ideas: arr('ideas'),
      moods: arr('moods'), wins: arr('wins'), nights: arr('nights'), fired: d.fired || {},
    };
  }

  // Une écriture de l'interface part de la version `incoming.rev`. Les opérations faites entre-temps
  // par le processus principal (relances, carte de relance, vide-tête rapide) sont rejouées dessus
  // au lieu d'être écrasées.
  function mergeIncoming(current, incoming, ops) {
    const next = normalize(incoming);
    const base = next.rev;
    let replayed = false;
    for (const op of ops) if (op.rev > base) { op.fn(next); replayed = true; }
    next.rev = (current.rev || 0) + 1;
    return { next, replayed };
  }

  const L = {
    MIN, DEFAULT_SETTINGS, pad, hm, toHM, dayKey, clock, inWindow, at, addDays, nextOccurrence, firstDue,
    shouldFire, complete, snooze, untilTomorrow, isNight, bedtimeFor, duration, addWin, winsOn, msg, normalize,
    mergeIncoming, sphereOf, isWork, autoSphere, notifyMode, taskStart, eventStart, eventEnd,
    taskShouldNotify, eventShouldNotify, agendaItems, layoutDay,
    repeatMatches, eventOccurrences, completeTask, findConflict, search, parseMessage, planNotifications, messageToItem,
  };
  if (typeof module !== 'undefined') module.exports = L; else window.L = L;
})();
