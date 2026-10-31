/* global L, Capacitor */
// Pont Android : le même window.api que preload.js (Electron), branché sur le stockage et les notifications
// d'Android. Les notifications sont programmées par le système : elles sonnent appli fermée et PC éteint.
(function () {
  if (window.api || !window.Capacitor) return;
  const { Filesystem, LocalNotifications, App } = Capacitor.Plugins;
  const DIR = 'DATA', FILE = 'boussole.json';
  const listeners = {};
  const emit = (ch, ...a) => (listeners[ch] || []).forEach(fn => fn(...a));
  const ops = []; // modifications faites ici (messages, actions de notification), rejouées sur une écriture en retard
  let data, planAt = null, writing = Promise.resolve();

  // ---------- Stockage : copie de secours + une sauvegarde par jour (7 jours) ----------

  const read = async p => { try { return (await Filesystem.readFile({ path: p, directory: DIR, encoding: 'utf8' })).data; } catch { return null; } };
  const write = (p, text) => Filesystem.writeFile({ path: p, directory: DIR, data: text, encoding: 'utf8', recursive: true });

  async function load() {
    for (const p of [FILE, FILE + '.bak']) {
      const text = await read(p);
      if (text == null) continue;
      try { return L.normalize(JSON.parse(text)); } catch { await write(`${p}.illisible-${Date.now()}`, text); } // jamais écrasé
    }
    return L.normalize({});
  }

  function save() {
    const text = JSON.stringify(data);
    writing = writing.then(async () => {
      const old = await read(FILE);
      if (old != null) await write(FILE + '.bak', old);
      await write(FILE, text);
      await write(`sauvegardes/boussole-${L.dayKey(new Date())}.json`, text);
      const files = (await Filesystem.readdir({ path: 'sauvegardes', directory: DIR })).files.map(f => f.name || f).sort();
      for (const f of files.slice(0, -7)) await Filesystem.deleteFile({ path: `sauvegardes/${f}`, directory: DIR });
    }).catch(e => console.error('Sauvegarde impossible', e));
    return writing;
  }

  function op(fn) {
    data.rev = (data.rev || 0) + 1;
    fn(data);
    ops.push({ rev: data.rev, fn });
    if (ops.length > 200) ops.shift();
  }

  async function commit(toRenderer = true) {
    await save();
    reschedule();
    if (toRenderer) emit('data', data);
  }

  // ---------- Notifications programmées ----------

  const SOUND_FILES = ['doux', 'net', 'cloche', 'grave', 'bulle'];

  async function setupChannels() {
    const s = data.settings;
    for (const sp of ['perso', 'pro']) {
      const snd = s.spheres[sp].sound;
      await LocalNotifications.createChannel({ id: `${sp}-${snd}`, name: s.spheres[sp].name, importance: 4, vibration: true, visibility: 1,
        ...(SOUND_FILES.includes(snd) ? { sound: `${snd}.wav` } : {}) });
      await LocalNotifications.createChannel({ id: `${sp}-silencieux`, name: `${s.spheres[sp].name} (silencieuses)`, importance: 2, vibration: false, visibility: 1 });
    }
    await LocalNotifications.createChannel({ id: 'general', name: 'Boussole', importance: 4, vibration: true, visibility: 1 });
  }

  const channelFor = p => {
    const s = data.settings;
    if (!p.sphere) return 'general';
    return p.mode === 'silent' || !s.sounds ? `${p.sphere}-silencieux` : `${p.sphere}-${s.spheres[p.sphere].sound}`;
  };

  // Ce qui a sonné depuis la dernière programmation est noté comme fait (relances, une fois par jour…).
  function markFired(d, since, now) {
    for (const p of L.planNotifications(d, since, Math.ceil((now - since) / 864e5) + 1, 500)) {
      if (p.at > now) continue;
      if (p.kind === 'reminder' || p.kind === 'nag') { const r = d.reminders.find(x => x.id === p.ref); if (r) r.lastFired = p.at.toISOString(); }
      else if (p.kind === 'task') { const t = d.tasks.find(x => x.id === p.ref); if (t) t.notified = p.at.toISOString(); }
      else if (p.kind === 'event') { const e = d.events.find(x => x.id === p.ref); if (e) e.notified = p.occ; }
      else if (p.kind === 'daily') d.fired[p.ref] = L.dayKey(p.at);
    }
  }

  let planTimer;
  function reschedule() {
    clearTimeout(planTimer);
    planTimer = setTimeout(async () => {
      try {
        const now = new Date(), since = planAt;
        if (since) op(d => markFired(d, since, now));
        planAt = now;
        data.planAt = now.toISOString();
        await setupChannels();
        const pending = (await LocalNotifications.getPending()).notifications.filter(n => n.id !== 424242); // sauf l'alarme de focus
        if (pending.length) await LocalNotifications.cancel({ notifications: pending.map(n => ({ id: n.id })) });
        const s = data.settings;
        const plan = L.planNotifications(data, now);
        if (plan.length) await LocalNotifications.schedule({ notifications: plan.map(p => ({
          id: p.id,
          title: p.sphere ? `${s.spheres[p.sphere].icon} ${p.title}` : p.title,
          body: p.body,
          largeBody: p.body,
          schedule: { at: p.at, allowWhileIdle: true },
          channelId: channelFor(p),
          smallIcon: 'ic_stat_boussole',
          iconColor: '#2B7A7E',
          actionTypeId: p.kind === 'reminder' || p.kind === 'nag' ? 'rappel' : '',
          extra: { kind: p.kind, ref: p.ref },
        })) });
        await save();
      } catch (e) { console.error('Programmation impossible', e); }
    }, 400);
  }

  async function notifyNow(title, body, sphere) {
    const s = data.settings;
    await LocalNotifications.schedule({ notifications: [{
      id: Math.floor(Math.random() * 1e9), title: sphere ? `${s.spheres[sphere].icon} ${title}` : title, body: body || '',
      schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true }, channelId: channelFor({ sphere, mode: 'normal' }), smallIcon: 'ic_stat_boussole',
    }] });
  }

  // ---------- Messages d'un proche (ntfy), quand l'appli est ouverte ----------

  let polling = false, kellyStatus = { last: null, error: null };
  const server = () => (data.settings.phone.server || 'https://ntfy.sh').replace(/\/+$/, '');

  async function pollMessages() {
    const k = data.settings.kelly;
    if (!k.enabled || !k.topic || polling) return;
    polling = true;
    try {
      const res = await fetch(`${server()}/${encodeURIComponent(k.topic)}/json?poll=1&since=${k.lastId || k.since || 'all'}`);
      if (!res.ok) throw new Error(`le serveur répond ${res.status}`);
      const msgs = (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.event === 'message');
      for (const m of msgs) {
        op(d => { d.settings.kelly.lastId = m.id; });
        if ((m.tags || []).includes('boussole')) continue; // nos propres accusés de réception
        const r = L.messageToItem(m, new Date(), k.name || 'Ton proche');
        const isNew = !data[r.coll].some(x => x.id === r.item.id);
        op(d => { if (!d[r.coll].some(x => x.id === r.item.id)) d[r.coll].push(JSON.parse(JSON.stringify(r.item))); });
        if (isNew) {
          notifyNow(r.title, r.body, 'perso');
          fetch(server(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: k.topic, title: '✓ Reçu par Boussole', message: r.ack, tags: ['boussole', 'white_check_mark'] }) }).catch(() => {});
        }
      }
      if (msgs.length) await commit();
      kellyStatus = { last: new Date().toISOString(), error: null };
    } catch (e) { kellyStatus = { last: kellyStatus.last, error: e.message }; }
    polling = false;
  }

  // ---------- window.api ----------

  const ready = (async () => {
    data = await load();
    planAt = data.planAt ? new Date(data.planAt) : null;
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
    } catch { /* l'utilisateur pourra autoriser depuis les Réglages */ }
    await LocalNotifications.registerActionTypes({ types: [{ id: 'rappel', actions: [{ id: 'done', title: 'Fait' }, { id: 'snooze', title: '+10 min' }] }] });
    LocalNotifications.addListener('localNotificationActionPerformed', async ev => {
      await ready;
      const { kind, ref } = ev.notification.extra || {};
      if ((kind === 'reminder' || kind === 'nag') && ev.actionId === 'done') await api.reminder(ref, 'done');
      else if ((kind === 'reminder' || kind === 'nag') && ev.actionId === 'snooze') await api.reminder(ref, '10');
      else emit('goto', { reminder: 'rappels', nag: 'rappels', task: 'aujourdhui', event: 'agenda', daily: 'soir' }[kind] || 'aujourdhui');
    });
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) { reschedule(); pollMessages(); emit('data', data); } });
    App.addListener('backButton', () => emit('back'));
    reschedule();
    pollMessages();
    setInterval(pollMessages, 30000);
    return data;
  })();

  const api = {
    platform: 'android',
    get: () => ready,
    set: async incoming => {
      await ready;
      const { next } = L.mergeIncoming(data, incoming, ops);
      next.fired = data.fired; next.planAt = data.planAt;
      data = next;
      await commit(false);
      return { rev: data.rev, shortcutOk: true };
    },
    reminder: async (id, action) => {
      await ready;
      const now = new Date();
      op(d => {
        const i = d.reminders.findIndex(r => r.id === id);
        if (i < 0) return;
        const r = d.reminders[i];
        if (action === 'done') { d.reminders[i] = L.complete(r, now); L.addWin(d, r.title, now); }
        else if (action === 'delete') d.reminders.splice(i, 1);
        else d.reminders[i] = L.snooze(r, action === 'tomorrow' ? L.untilTomorrow(d.settings, now) : Number(action), now);
      });
      await commit();
    },
    capture: async (text, sphere) => {
      await ready;
      text = String(text || '').trim();
      if (!text) return;
      const idea = { id: Math.random().toString(36).slice(2, 10), text, sphere: sphere || L.autoSphere(data.settings, new Date()), at: new Date().toISOString(), parked: false, notes: [] };
      op(d => d.ideas.unshift({ ...idea }));
      await commit();
    },
    captureSphere: async () => { await ready; return L.autoSphere(data.settings, new Date()); },
    notify: (title, body, _view, sphere) => { ready.then(() => notifyNow(title, body, sphere)); },
    open: view => emit('goto', view),
    on: (ch, fn) => { (listeners[ch] ||= []).push(fn); },
    hideMain: () => App.minimizeApp(),
    focusAlarm: async (at, title, label, sphere) => {
      await LocalNotifications.cancel({ notifications: [{ id: 424242 }] }).catch(() => {});
      if (!at) return;
      const s = data.settings;
      await LocalNotifications.schedule({ notifications: [{ id: 424242, title: `${s.spheres[sphere].icon} ${title}`, body: label || 'Bloc de focus terminé.',
        schedule: { at, allowWhileIdle: true }, channelId: channelFor({ sphere, mode: 'normal' }), smallIcon: 'ic_stat_boussole' }] });
    },
    askNotifications: async () => ((await LocalNotifications.requestPermissions()).display === 'granted'
      ? 'Notifications autorisées.' : 'Refusé : autorise Boussole dans les paramètres du téléphone.'),
    exactAlarms: () => LocalNotifications.changeExactNotificationSetting().catch(() => {}),
    kellyCheck: async () => { await ready; await pollMessages(); return kellyStatus; },
    linkInfo: async () => ({ phone: { last: null, error: null }, kelly: kellyStatus }),
    updateInfo: async () => ({ state: 'none', current: (await App.getInfo()).version, packaged: true, android: true }),
    updateCheck: async () => api.updateInfo(),
    // Propres au PC : rien à faire sur le téléphone.
    titlebar: () => {}, closeMini: () => {}, dataFolder: () => {}, updateInstall: () => {},
    backupInfo: async () => ({}), pickBackupDir: async () => null, phoneTest: async () => ({ last: null, error: 'Tu es déjà sur le téléphone.' }),
    exportData: async () => ({ ok: false }), importData: async () => ({ ok: false, error: 'L\'import se fait depuis le PC pour l\'instant.' }),
  };
  window.api = api;
})();
