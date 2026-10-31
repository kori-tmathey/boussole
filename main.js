const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, powerMonitor, screen, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const L = require('./logic');
const { autoUpdater } = require('electron-updater');

app.setAppUserModelId('fr.theo.boussole');
if (process.env.BOUSSOLE_DATA) app.setPath('userData', process.env.BOUSSOLE_DATA); // essais sans toucher aux vraies données
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

const ICON = path.join(__dirname, 'build', 'icon.png');
const FILE = () => path.join(app.getPath('userData'), 'boussole.json');
const LOCAL_BACKUPS = () => path.join(app.getPath('userData'), 'sauvegardes');
let data, win, mini, miniFor = null, tray, quitting = false;
let lastChime = Date.now();
const toasts = []; // garde les notifications en vie, sinon le clic est perdu
const ops = [];    // modifications du processus principal, rejouées sur une écriture en retard de l'interface
const cloud = { timer: null, last: null, error: null };
const phoneStatus = { last: null, error: null };
const kellyStatus = { last: null, error: null, busy: false };
let update = { state: 'idle' }; // idle | checking | downloading | ready | none | error

// ---------- Stockage : écriture atomique, copie de secours, sauvegardes datées ----------

// Journal de diagnostic : ce que l'appli lit au démarrage et quand les liens téléphone / proche changent.
function journal(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'journal.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 200e3) fs.renameSync(f, f.replace('.log', '.ancien.log'));
    fs.appendFileSync(f, `${new Date().toISOString()} [${app.getVersion()} pid ${process.pid}] ${msg}\n`);
  } catch { /* le journal ne doit jamais gêner */ }
}
const links = d => `rev ${d.rev} téléphone=${d.settings.phone.enabled}/${d.settings.phone.topic ? 'sujet' : '-'} proche=${d.settings.kelly.enabled}/${d.settings.kelly.topic ? 'sujet' : '-'}`;

function load() {
  const f = FILE();
  for (const file of [f, f + '.bak']) {
    const exists = fs.existsSync(file);
    journal(`lecture ${path.basename(file)} : ${exists ? 'présent' : 'absent'}`);
    if (!exists) continue;
    try { const d = L.normalize(JSON.parse(fs.readFileSync(file, 'utf8'))); journal(`chargé ${path.basename(file)} : ${links(d)}`); return d; }
    catch (e) { journal(`illisible ${path.basename(file)} : ${e.message}`); fs.copyFileSync(file, `${file}.illisible-${Date.now()}`); } // on ne l'écrase jamais
  }
  journal('aucun fichier lisible : réglages par défaut');
  return L.normalize({});
}

// Un fichier par jour (réécrit à chaque sauvegarde du jour), on garde les `keep` derniers jours.
function backupTo(dir, keep) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `boussole-${L.dayKey(new Date())}.json`), JSON.stringify(data, null, 1));
  const old = fs.readdirSync(dir).filter(n => /^boussole-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(0, -keep);
  for (const n of old) fs.unlinkSync(path.join(dir, n));
}

function backupCloud() {
  clearTimeout(cloud.timer); cloud.timer = null;
  const dir = data.settings.backupDir;
  if (!dir) return;
  try { backupTo(path.join(dir, 'Boussole'), 30); cloud.last = new Date().toISOString(); cloud.error = null; }
  catch (e) { cloud.error = e.message; }
}

function save() {
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.renameSync(tmp, f);
  try { backupTo(LOCAL_BACKUPS(), 7); } catch { /* la sauvegarde principale a réussi */ }
  // Le cloud synchronise chaque écriture : on regroupe sur une minute.
  if (data.settings.backupDir && !cloud.timer) cloud.timer = setTimeout(backupCloud, 60000);
}

function commit(except) {
  save();
  for (const w of [win, mini]) if (w && !w.isDestroyed() && w.webContents !== except) w.webContents.send('data', data);
}

function mainOp(fn) {
  data.rev = (data.rev || 0) + 1;
  fn(data);
  ops.push({ rev: data.rev, fn });
  if (ops.length > 200) ops.shift();
}

// ---------- Fenêtres ----------

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 900, minHeight: 620, show: false, title: 'Boussole', icon: ICON,
    backgroundColor: '#E6EDEF', titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#E6EDEF', symbolColor: '#1D2C36', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.loadFile('renderer/index.html');
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  win.on('close', e => {
    if (!quitting && data.settings.closeToTray) { e.preventDefault(); win.hide(); }
  });
}

function show(view) {
  if (!win || win.isDestroyed()) createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (view) win.webContents.send('goto', view);
}

function openMini(query, w, h, corner) {
  if (!mini || mini.isDestroyed()) {
    mini = new BrowserWindow({
      width: w, height: h, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      transparent: true, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    mini.on('blur', () => { if (miniFor === 'capture') mini.hide(); });
  }
  const wa = screen.getPrimaryDisplay().workArea;
  mini.setBounds(corner
    ? { x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h }
    : { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + wa.height * 0.28), width: w, height: h });
  mini.setAlwaysOnTop(true, 'screen-saver');
  mini.loadFile('renderer/mini.html', { query });
  return mini;
}

function openCapture() {
  if (!data.settings.modules.tete) return show();
  miniFor = 'capture';
  openMini({ mode: 'capture' }, 560, 132, false).webContents.once('did-finish-load', () => { mini.show(); mini.focus(); });
}

function showNudge(id) {
  miniFor = id;
  openMini({ mode: 'nudge', id }, 420, 216, true).webContents.once('did-finish-load', () => mini.showInactive());
}

// ---------- Notifications et planificateur ----------

// ---------- ntfy : téléphone et messages d'un proche (gratuit, open source) ----------

const ntfyServer = () => (data.settings.phone.server || 'https://ntfy.sh').replace(/\/+$/, '');
// ntfy n'affiche qu'une icône accessible en ligne (et seulement sur Android) : celle du dépôt GitHub.
const NTFY_ICON = 'https://raw.githubusercontent.com/kori-tmathey/boussole/main/docs/icon.png';
const ntfyPost = body => fetch(ntfyServer(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: NTFY_ICON, ...body }) });

async function pushPhone(title, body, sphere, mode) {
  const p = data.settings.phone, sp = sphere && data.settings.spheres[sphere];
  if (!p.enabled || !p.topic) return;
  const discreet = p.detail === 'discret';
  try {
    const r = await ntfyPost({
      topic: p.topic,
      title: `${sp ? sp.icon + ' ' : ''}${discreet ? 'Boussole' : title}`,
      message: discreet ? 'Quelque chose t\'attend dans Boussole.' : (body || title),
      priority: mode === 'urgent' ? 5 : mode === 'silent' ? 2 : 3,
      tags: ['compass'],
    });
    if (!r.ok) throw new Error(`le serveur répond ${r.status}`);
    phoneStatus.last = new Date().toISOString(); phoneStatus.error = null;
  } catch (e) { phoneStatus.error = e.message; }
}

// Un message d'un proche devient une tâche ou un rappel (L.parseMessage), puis on lui répond « reçu ».
function receiveMessage(m) {
  const now = new Date(), k = data.settings.kelly, name = k.name || 'Ton proche';
  const p = L.parseMessage(m.message || m.title, now), id = 'k' + m.id;
  const notes = [{ at: now.toISOString(), text: `Envoyé par ${name}${m.title && m.message ? ' : ' + m.title : ''}` }];
  if (p.type === 'reminder') {
    const r = { id, title: p.title, cat: 'autre', kind: 'once', date: p.date, time: p.time, sphere: 'perso', nag: null, note: '', urgent: false, done: false, notes, from: 'kelly' };
    r.due = L.firstDue(r, now).toISOString();
    mainOp(d => { if (!d.reminders.some(x => x.id === id)) d.reminders.push({ ...r, notes: [...notes] }); });
  } else {
    const t = { id, title: p.title, firstStep: '', done: false, sphere: 'perso', date: p.date, time: p.time, notes, at: now.toISOString(), from: 'kelly' };
    mainOp(d => { if (!d.tasks.some(x => x.id === id)) d.tasks.push({ ...t, notes: [...notes] }); });
  }
  const when = p.date ? ` le ${new Date(p.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${p.time ? ' à ' + p.time : ''}` : '';
  const start = p.time ? L.at(new Date(p.date + 'T00:00:00'), p.time) : null;
  const clash = start && L.findConflict(data, start, new Date(start.getTime() + 30 * L.MIN), { kind: p.type, id });
  notify(`${name} t'envoie : ${p.title}`,
    `${p.type === 'reminder' ? 'Rappel' : 'Tâche'}${when}.${clash ? ` Attention : tu as déjà « ${clash.title} » à ce moment-là.` : ''}`,
    () => show(p.type === 'reminder' ? 'rappels' : 'aujourdhui'), 'perso', 'normal');
  ntfyPost({ topic: k.topic, title: '✓ Reçu par Boussole', message: `${p.title} (${p.type === 'reminder' ? 'rappel' : 'tâche'}${when})`, tags: ['boussole', 'white_check_mark'] }).catch(() => {});
}

async function pollMessages() {
  const k = data.settings.kelly;
  if (!k.enabled || !k.topic || kellyStatus.busy) return;
  kellyStatus.busy = true;
  try {
    const res = await fetch(`${ntfyServer()}/${encodeURIComponent(k.topic)}/json?poll=1&since=${k.lastId || k.since || 'all'}`);
    if (!res.ok) throw new Error(`le serveur répond ${res.status}`);
    const msgs = (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.event === 'message');
    for (const m of msgs) {
      mainOp(d => { d.settings.kelly.lastId = m.id; });
      if (!(m.tags || []).includes('boussole')) receiveMessage(m); // nos propres accusés de réception
    }
    if (msgs.length) commit();
    kellyStatus.last = new Date().toISOString(); kellyStatus.error = null;
  } catch (e) { kellyStatus.error = e.message; }
  kellyStatus.busy = false;
}

// Avec une sphère : son icône en tête du titre et son propre son (joué par l'interface).
// Envoyé aussi au téléphone si c'est activé (sauf le carillon, propre à l'ordinateur).
function notify(title, body, onClick, sphere, mode = 'normal', phone = true) {
  if (phone) pushPhone(title, body, sphere, mode);
  if (!Notification.isSupported()) return;
  const s = data.settings, sp = sphere && s.spheres[sphere];
  const ownSound = s.sounds && mode !== 'silent' && sp && win && !win.isDestroyed();
  const n = new Notification({
    title: sp ? `${sp.icon} ${title}` : title, body: body || '', icon: ICON,
    silent: mode === 'silent' || !s.sounds || ownSound,
  });
  if (onClick) n.on('click', onClick);
  n.show();
  if (ownSound) win.webContents.send('sound', sphere);
  toasts.push(n); if (toasts.length > 20) toasts.shift();
}

function tick() {
  const now = new Date(), s = data.settings, at = now.toISOString();
  let changed = false;

  if (s.modules.rappels) {
    for (const r of data.reminders) {
      if (!L.shouldFire(r, now, s)) continue;
      const first = !r.lastFired || new Date(r.lastFired) < new Date(r.due);
      const id = r.id, sphere = L.sphereOf(r), mode = r.urgent ? 'urgent' : L.notifyMode(s, sphere, now, false);
      mainOp(d => { const x = d.reminders.find(y => y.id === id); if (x) x.lastFired = at; });
      changed = true;
      notify(L.msg(s.tone, first ? 'reminder' : 'nag', { t: r.title }), r.note, () => showNudge(id), sphere, mode);
      if (s.nudgeWindow && mode !== 'silent') showNudge(id);
    }
  }

  for (const t of data.tasks) {
    if (!L.taskShouldNotify(t, now, s)) continue;
    const id = t.id, sphere = L.sphereOf(t);
    mainOp(d => { const x = d.tasks.find(y => y.id === id); if (x) x.notified = at; });
    changed = true;
    notify(`C'est l'heure : ${t.title}`, t.firstStep ? `Première petite étape : ${t.firstStep}` : '',
      () => show('aujourdhui'), sphere, L.notifyMode(s, sphere, now, false));
  }

  if (s.modules.agenda) {
    for (const e of data.events) {
      const occ = L.eventShouldNotify(e, now, s);
      if (!occ) continue;
      const id = e.id, key = occ.toISOString(), sphere = L.sphereOf(e);
      mainOp(d => { const x = d.events.find(y => y.id === id); if (x) x.notified = key; });
      changed = true;
      const mins = Math.max(1, Math.round((occ - now) / L.MIN));
      notify(e.allDay ? `Aujourd'hui : ${e.title}` : `Dans ${mins} min : ${e.title}`,
        e.allDay ? (e.place || '') : `${e.start}${e.end ? ' – ' + e.end : ''}${e.place ? ', ' + e.place : ''}`,
        () => show('agenda'), sphere, L.notifyMode(s, sphere, now, false) === 'silent' ? 'silent' : 'normal');
    }
  }

  const quiet = L.inWindow(now, s.quietStart, s.quietEnd);
  const today = L.dayKey(now);
  // Un événement quotidien par clé, seulement dans l'heure qui suit son horaire.
  const daily = (key, time, fn) => {
    const late = now - L.at(now, time);
    if (quiet || data.fired[key] === today || late < 0 || late > 60 * L.MIN) return;
    mainOp(d => { d.fired[key] = today; });
    changed = true; fn();
  };

  if (s.modules.soir) {
    daily('winddown', L.toHM(L.hm(s.bedtime) - s.windDown), () =>
      notify(L.msg(s.tone, 'winddown', { m: s.windDown }), 'Ouvre « Ce soir » pour fermer la journée en douceur.', () => show('soir')));
    daily('bedtime', s.bedtime, () =>
      notify(L.msg(s.tone, 'bedtime', { n: L.winsOn(data, now).length }), '', () => show('soir')));
  }
  if (s.modules.meteo) {
    for (const t of String(s.checkins).split(',').map(x => x.trim()).filter(x => /^\d{1,2}:\d{2}$/.test(x)))
      daily('checkin-' + t, t, () => notify(L.msg(s.tone, 'checkin'), 'Un clic suffit.', () => show('meteo')));
  }

  // Carillon : rend le temps visible. On ne compte que le temps passé devant l'ordinateur.
  if (s.chimeEvery > 0 && !quiet) {
    if (s.chimeOnlyActive && powerMonitor.getSystemIdleTime() > 300) lastChime = Date.now();
    else if (Date.now() - lastChime >= s.chimeEvery * L.MIN) {
      lastChime = Date.now();
      notify(L.msg(s.tone, 'chime', { h: L.clock(now) }), '', null, null, 'normal', false);
    }
  }

  if (changed) commit();
}

// ---------- Réglages système ----------

function applySystem() {
  const s = data.settings;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.autostart, args: ['--hidden'] });
  globalShortcut.unregisterAll();
  let ok = false;
  try { ok = globalShortcut.register(s.shortcut, openCapture); } catch { ok = false; }
  return ok;
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Boussole');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Boussole', click: () => show() },
    { label: 'Agenda', click: () => show('agenda') },
    { label: 'Vider ma tête', click: openCapture },
    { label: 'Lancer un focus', click: () => show('focus') },
    { label: 'Ce soir', click: () => show('soir') },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => show());
}

// ---------- IPC ----------

ipcMain.handle('get', () => data);

ipcMain.handle('set', (e, incoming) => {
  const prev = data.settings, before = links(data);
  const { next, replayed } = L.mergeIncoming(data, incoming, ops);
  if (links({ ...next, rev: data.rev }) !== before) journal(`liens modifiés par l'interface : ${before} → ${links(next)}`);
  data = next;
  // Si on a rejoué des opérations, l'interface doit recevoir la version fusionnée.
  commit(replayed ? null : e.sender);
  if (prev.backupDir !== data.settings.backupDir && data.settings.backupDir) backupCloud();
  const system = prev.shortcut !== data.settings.shortcut || prev.autostart !== data.settings.autostart;
  return { rev: data.rev, shortcutOk: system ? applySystem() : globalShortcut.isRegistered(data.settings.shortcut) };
});

ipcMain.handle('reminder', (_, id, action) => {
  const now = new Date();
  mainOp(d => {
    const i = d.reminders.findIndex(r => r.id === id);
    if (i < 0) return;
    const r = d.reminders[i];
    if (action === 'done') { d.reminders[i] = L.complete(r, now); L.addWin(d, r.title, now); }
    else if (action === 'delete') d.reminders.splice(i, 1);
    else d.reminders[i] = L.snooze(r, action === 'tomorrow' ? L.untilTomorrow(d.settings, now) : Number(action), now);
  });
  if (mini && !mini.isDestroyed() && miniFor === id) mini.hide();
  commit();
});

ipcMain.handle('capture', (_, text, chosen) => {
  text = String(text || '').trim();
  if (text) {
    const sphere = chosen === 'pro' || chosen === 'perso' ? chosen : captureSphere();
    const idea = { id: Math.random().toString(36).slice(2, 10), text, sphere, at: new Date().toISOString(), parked: false };
    mainOp(d => { if (!d.ideas.some(i => i.id === idea.id)) d.ideas.unshift({ ...idea }); });
    commit();
  }
  if (mini && !mini.isDestroyed()) mini.hide();
});

// Sphère proposée par défaut dans le vide-tête rapide.
function captureSphere() {
  const s = data.settings;
  return s.sphereMode === 'manuel' && s.sphereView !== 'tout' ? s.sphereView : L.autoSphere(s, new Date());
}
ipcMain.handle('capture-sphere', () => captureSphere());

ipcMain.handle('backup-info', () => ({ dir: data.settings.backupDir, last: cloud.last, error: cloud.error }));
ipcMain.handle('link-info', () => ({ phone: { ...phoneStatus }, kelly: { last: kellyStatus.last, error: kellyStatus.error } }));
ipcMain.handle('phone-test', async () => {
  await pushPhone('Test de Boussole', 'Si tu lis ceci sur ton téléphone, tout marche.', L.autoSphere(data.settings, new Date()), 'normal');
  return { ...phoneStatus };
});
ipcMain.handle('kelly-check', async () => { await pollMessages(); return { last: kellyStatus.last, error: kellyStatus.error }; });
ipcMain.handle('update-info', () => ({ ...update, current: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return { ...update, current: app.getVersion(), packaged: false };
  try { await autoUpdater.checkForUpdates(); } catch (e) { update = { state: 'error', error: e.message }; }
  return { ...update, current: app.getVersion(), packaged: true };
});
ipcMain.on('update-install', () => { quitting = true; autoUpdater.quitAndInstall(true, true); });

ipcMain.handle('pick-backup-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier de sauvegarde (ton cloud, par exemple)', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('export', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter mes données', defaultPath: `Boussole-${L.dayKey(new Date())}.json`, filters: [{ name: 'Données Boussole', extensions: ['json'] }],
  });
  if (r.canceled) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1));
  return { ok: true, file: r.filePath };
});

ipcMain.handle('import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importer ou restaurer des données', defaultPath: LOCAL_BACKUPS(), properties: ['openFile'], filters: [{ name: 'Données Boussole', extensions: ['json'] }],
  });
  if (r.canceled) return { ok: false };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); }
  catch { return { ok: false, error: 'Ce fichier n\'est pas lisible.' }; }
  if (!parsed || typeof parsed !== 'object' || !(parsed.settings || Array.isArray(parsed.reminders) || Array.isArray(parsed.tasks)))
    return { ok: false, error: 'Ce fichier ne contient pas de données Boussole.' };
  fs.mkdirSync(LOCAL_BACKUPS(), { recursive: true });
  fs.writeFileSync(path.join(LOCAL_BACKUPS(), `avant-import-${Date.now()}.json`), JSON.stringify(data, null, 1));
  const rev = (data.rev || 0) + 1;
  data = L.normalize(parsed);
  data.rev = rev;
  ops.length = 0;
  commit();
  applySystem();
  return { ok: true };
});

ipcMain.on('notify', (_, title, body, view, sphere) => notify(title, body, view ? () => show(view) : null, sphere));
ipcMain.on('open', (_, view) => { if (mini && !mini.isDestroyed()) mini.hide(); show(view); });
ipcMain.on('close-mini', () => mini && !mini.isDestroyed() && mini.hide());
ipcMain.on('hide-main', () => win && win.hide());
ipcMain.on('data-folder', () => shell.openPath(app.getPath('userData')));
ipcMain.on('titlebar', (_, color, symbolColor) => {
  try { win && win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch { /* non supporté */ }
});

// ---------- Démarrage ----------

app.on('second-instance', () => show());
app.on('before-quit', () => { quitting = true; journal('fermeture'); if (cloud.timer) backupCloud(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* reste dans la barre des tâches */ });

app.whenReady().then(() => {
  journal(`démarrage ${primary ? 'principal' : 'SECONDAIRE (une autre copie tourne déjà)'} argv=${JSON.stringify(process.argv.slice(1))}`);
  // app.quit() n'arrête pas tout de suite : une deuxième copie ne doit ni lire ni écrire les données.
  if (!primary) return;
  data = load();
  createWindow(process.argv.includes('--hidden') || data.settings.startHidden);
  buildTray();
  applySystem();
  backupCloud();
  tick();
  setInterval(tick, 20000);
  pollMessages();
  setInterval(pollMessages, 30000);
  setupUpdates();
});

// Mises à jour automatiques depuis GitHub (seulement dans l'appli installée).
function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => { update = { state: 'checking' }; });
  autoUpdater.on('update-available', i => { update = { state: 'downloading', version: i.version }; });
  autoUpdater.on('update-not-available', () => { update = { state: 'none' }; });
  autoUpdater.on('error', e => { update = { state: 'error', error: e.message }; });
  autoUpdater.on('update-downloaded', i => {
    update = { state: 'ready', version: i.version };
    notify(`Boussole ${i.version} est prête`, 'Elle s\'installera à la prochaine fermeture, ou tout de suite depuis les Réglages.', () => show('reglages'), null, 'normal', false);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 3600e3);
}
