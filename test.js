// Vérifie le cœur des rappels : `npm test`.
const assert = require('assert');
const L = require('./logic');

const d = s => new Date(s); // heure locale
const S = { ...L.DEFAULT_SETTINGS, quietStart: '01:30', quietEnd: '09:30', nagEvery: 10 };

// Mensuel : le 31 tombe le dernier jour des mois courts.
const bill = { kind: 'monthly', monthDay: 31, time: '10:00' };
assert.deepStrictEqual(L.nextOccurrence(bill, d('2027-02-01T00:00')), d('2027-02-28T10:00'));
assert.deepStrictEqual(L.nextOccurrence(bill, d('2028-02-01T00:00')), d('2028-02-29T10:00'));

// Facture le 5 : créée le 30 → 5 du mois suivant ; faite en retard le 7 → 5 du mois d'après.
const orange = { kind: 'monthly', monthDay: 5, time: '10:00' };
const due = L.firstDue(orange, d('2026-10-30T16:00'));
assert.deepStrictEqual(due, d('2026-11-05T10:00'));
const done = L.complete({ ...orange, due: due.toISOString() }, d('2026-11-07T12:00'));
assert.strictEqual(done.due, d('2026-12-05T10:00').toISOString());
// Faite en avance → on saute ce cycle.
assert.strictEqual(L.complete({ ...orange, due: due.toISOString() }, d('2026-11-02T12:00')).due, d('2026-12-05T10:00').toISOString());

// Hebdo et jours ouvrés.
assert.deepStrictEqual(L.nextOccurrence({ kind: 'weekly', weekday: 1, time: '09:00' }, d('2026-10-30T12:00')), d('2026-11-02T09:00'));
assert.deepStrictEqual(L.nextOccurrence({ kind: 'weekdays', time: '11:00' }, d('2026-10-30T12:00')), d('2026-11-02T11:00'));
assert.deepStrictEqual(L.firstDue({ kind: 'daily', time: '18:00' }, d('2026-10-30T17:00')), d('2026-10-30T18:00'));

// Unique : se termine au lieu de se répéter.
assert.strictEqual(L.complete({ kind: 'once', date: '2026-11-03', time: '14:00' }, d('2026-11-03T15:00')).done, true);

// Relances : 1re fois, puis toutes les 10 min, jamais pendant les heures calmes, pas pendant un report.
const r = { kind: 'daily', time: '12:00', due: d('2026-10-30T12:00').toISOString() };
assert.strictEqual(L.shouldFire(r, d('2026-10-30T11:59'), S), false);
assert.strictEqual(L.shouldFire(r, d('2026-10-30T12:00'), S), true);
const fired = { ...r, lastFired: d('2026-10-30T12:00').toISOString() };
assert.strictEqual(L.shouldFire(fired, d('2026-10-30T12:05'), S), false);
assert.strictEqual(L.shouldFire(fired, d('2026-10-30T12:10'), S), true);
assert.strictEqual(L.shouldFire({ ...fired, nag: 0 }, d('2026-10-30T13:00'), S), false);
const snoozed = L.snooze(fired, 60, d('2026-10-30T12:01'));
assert.strictEqual(L.shouldFire(snoozed, d('2026-10-30T12:30'), S), false);
assert.strictEqual(L.shouldFire(snoozed, d('2026-10-30T13:01'), S), true);
assert.strictEqual(L.shouldFire({ ...r, due: d('2026-10-30T02:00').toISOString() }, d('2026-10-30T03:00'), S), false);

// Fenêtres qui passent minuit, soir, coucher.
assert.strictEqual(L.inWindow(d('2026-10-30T23:00'), '22:00', '08:00'), true);
assert.strictEqual(L.inWindow(d('2026-10-30T12:00'), '22:00', '08:00'), false);
assert.strictEqual(L.isNight({ ...S, bedtime: '00:30', windDown: 45, wake: '10:30' }, d('2026-10-30T23:50')), true);
assert.strictEqual(L.isNight({ ...S, bedtime: '00:30', windDown: 45, wake: '10:30' }, d('2026-10-30T23:30')), false);
assert.deepStrictEqual(L.bedtimeFor({ bedtime: '00:30', wake: '10:30' }, d('2026-10-30T16:00')), d('2026-10-31T00:30'));
assert.deepStrictEqual(L.bedtimeFor({ bedtime: '00:30', wake: '10:30' }, d('2026-10-31T02:00')), d('2026-10-31T00:30'));
assert.deepStrictEqual(L.bedtimeFor({ bedtime: '23:00', wake: '07:00' }, d('2026-10-31T02:00')), d('2026-10-30T23:00'));

// Rappel urgent : sonne même pendant les heures calmes.
assert.strictEqual(L.shouldFire({ ...r, urgent: true, due: d('2026-10-30T02:00').toISOString() }, d('2026-10-30T03:00'), S), true);

// Écriture en retard de l'interface : les opérations du processus principal sont rejouées, pas perdues.
const ops = [
  { rev: 3, fn: x => x.ideas.push({ id: 'deja-vue' }) },
  { rev: 4, fn: x => x.ideas.push({ id: 'capturee' }) },
];
const m = L.mergeIncoming({ rev: 4 }, { rev: 3, ideas: [{ id: 'ecrite' }] }, ops);
assert.deepStrictEqual(m.next.ideas.map(i => i.id), ['ecrite', 'capturee']);
assert.strictEqual(m.next.rev, 5);
assert.strictEqual(m.replayed, true);
assert.strictEqual(L.mergeIncoming({ rev: 4 }, { rev: 4 }, ops).replayed, false);

// Sphères : horaires de travail (lun-ven 09:00-18:00 par défaut) et règles de notification.
const W = { ...S, quietStart: '', workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00', proOff: 'defer', persoAtWork: 'silent' };
const friday10 = d('2026-10-30T10:00'), friday20 = d('2026-10-30T20:00'), saturday10 = d('2026-10-31T10:00');
assert.strictEqual(L.autoSphere(W, friday10), 'pro');
assert.strictEqual(L.autoSphere(W, friday20), 'perso');
assert.strictEqual(L.autoSphere(W, saturday10), 'perso');
assert.strictEqual(L.notifyMode(W, 'perso', friday10), 'silent');
assert.strictEqual(L.notifyMode(W, 'pro', saturday10), 'defer');
assert.strictEqual(L.notifyMode(W, 'pro', saturday10, true), 'normal');
const proRem = { kind: 'once', sphere: 'pro', due: d('2026-10-30T19:00').toISOString() };
assert.strictEqual(L.shouldFire(proRem, friday20, W), false); // reporté au lundi
assert.strictEqual(L.shouldFire(proRem, d('2026-11-02T09:00'), W), true);

// Tâche avec heure : prévient une fois à l'heure dite.
const tk = { sphere: 'perso', date: '2026-10-31', time: '15:00' };
assert.strictEqual(L.taskShouldNotify(tk, d('2026-10-31T14:59'), W), false);
assert.strictEqual(L.taskShouldNotify(tk, d('2026-10-31T15:00'), W), true);
assert.strictEqual(L.taskShouldNotify({ ...tk, notified: 'x' }, d('2026-10-31T15:00'), W), false);

// Événement : prévient `eventLead` minutes avant ; un événement après minuit finit le lendemain.
const ev = { id: 'e', sphere: 'pro', title: 'Réunion', date: '2026-11-02', start: '14:00', end: '15:30' };
assert.strictEqual(!!L.eventShouldNotify(ev, d('2026-11-02T13:40'), { ...W, eventLead: 15 }), false);
assert.strictEqual(!!L.eventShouldNotify(ev, d('2026-11-02T13:45'), { ...W, eventLead: 15 }), true);
assert.deepStrictEqual(L.eventEnd({ date: '2026-11-02', start: '23:00', end: '01:00' }), d('2026-11-03T01:00'));

// Agenda : rappels récurrents dépliés, tâches datées, événements, dans la plage demandée.
const data = L.normalize({
  events: [ev],
  tasks: [{ id: 't1', title: 'Devis', sphere: 'pro', date: '2026-11-03' }, { id: 't2', title: 'Sans date' }],
  reminders: [{ id: 'r1', title: 'Traitement', kind: 'daily', time: '11:00', due: d('2026-11-02T11:00').toISOString() }],
});
const week = L.agendaItems(data, d('2026-11-02T00:00'), d('2026-11-09T00:00'));
assert.strictEqual(week.filter(x => x.kind === 'reminder').length, 7);
assert.strictEqual(week.find(x => x.kind === 'task').allDay, true);
assert.strictEqual(week.find(x => x.kind === 'event').sphere, 'pro');
assert.ok(!week.some(x => x.id === 't2'));
assert.strictEqual(week[0].allDay, true); // la journée d'abord
// Pas d'occurrences récurrentes avant aujourd'hui.
const past = L.agendaItems(data, d('2026-11-02T00:00'), d('2026-11-09T00:00'), d('2026-11-05T09:00'));
assert.strictEqual(past.filter(x => x.kind === 'reminder').length, 4);

// Chevauchements : deux colonnes, puis on revient à une seule.
const lay = L.layoutDay([
  { id: 'a', start: d('2026-11-02T10:00'), end: d('2026-11-02T11:00') },
  { id: 'b', start: d('2026-11-02T10:30'), end: d('2026-11-02T11:30') },
  { id: 'c', start: d('2026-11-02T12:00'), end: d('2026-11-02T13:00') },
]);
assert.deepStrictEqual(lay.map(x => [x.id, x.lane, x.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);

// Récurrences : anniversaire annuel (29 février → 28 les années non bissextiles), hebdo, mensuel le 31.
const bday = { id: 'b', title: 'Anniversaire de Sam', date: '2024-02-29', allDay: true, repeat: 'yearly' };
assert.deepStrictEqual(L.eventOccurrences(bday, d('2027-01-01T00:00'), d('2027-12-31T00:00')), [d('2027-02-28T00:00')]);
assert.strictEqual(L.repeatMatches('monthly', d('2026-01-31T00:00'), d('2026-04-30T00:00')), true);
assert.strictEqual(L.repeatMatches('weekly', d('2026-11-02T00:00'), d('2026-10-26T00:00')), false); // pas avant le départ
const weeklyMeeting = { id: 'w', title: 'Réunion', sphere: 'pro', date: '2026-11-02', start: '10:00', end: '11:00', repeat: 'weekly' };
assert.strictEqual(L.eventOccurrences(weeklyMeeting, d('2026-11-01T00:00'), d('2026-11-30T00:00')).length, 4);
// Une journée entière (anniversaire) prévient le matin, une fois par occurrence.
const morning = L.eventShouldNotify(bday, d('2027-02-28T10:31'), { ...W, wake: '10:30' });
assert.deepStrictEqual(morning, d('2027-02-28T00:00'));
assert.strictEqual(L.eventShouldNotify({ ...bday, notified: morning.toISOString() }, d('2027-02-28T11:00'), { ...W, wake: '10:30' }), null);

// Tâche répétée : « fait » la fait revenir à sa prochaine date.
const daily = L.completeTask({ id: 'v', title: 'Vaisselle', date: '2026-10-30', repeat: 'daily' }, d('2026-10-31T20:00'));
assert.strictEqual(daily.date, '2026-11-01'); assert.ok(!daily.done);
assert.strictEqual(L.completeTask({ id: 'm', date: '2026-01-31', repeat: 'monthly' }, d('2026-01-31T09:00')).date, '2026-02-28');
assert.strictEqual(L.completeTask({ id: 'o', date: '2026-10-31' }, d('2026-10-31T09:00')).done, true);

// Anti-chevauchement : même créneau interdit, Perso comme Pro ; un rappel ou une journée entière ne bloque pas.
const busy = L.normalize({ events: [weeklyMeeting, bday], tasks: [{ id: 'k', title: 'Devis', date: '2026-11-03', time: '15:00', duration: 60 }],
  reminders: [{ id: 'rr', title: 'Rappel', kind: 'once', date: '2026-11-09', time: '10:15' }] });
assert.strictEqual(L.findConflict(busy, d('2026-11-09T10:30'), d('2026-11-09T11:30')).title, 'Réunion'); // occurrence récurrente
assert.strictEqual(L.findConflict(busy, d('2026-11-09T11:00'), d('2026-11-09T12:00')), null); // juste après
assert.strictEqual(L.findConflict(busy, d('2026-11-03T15:30'), d('2026-11-03T16:00')).title, 'Devis');
assert.strictEqual(L.findConflict(busy, d('2026-11-03T15:30'), d('2026-11-03T16:00'), { kind: 'task', id: 'k' }), null); // elle-même

// Recherche : sans accents ni majuscules, dans les notes aussi.
const sd = L.normalize({ tasks: [{ id: 'a', title: 'Mutuelle', notes: [{ at: 'x', text: 'Dossier 48213, demander Mme Durand' }] }], ideas: [{ id: 'i', text: 'Été au bord de la mer' }] });
assert.strictEqual(L.search(sd, 'durand dossier')[0].item.id, 'a');
assert.strictEqual(L.search(sd, 'ete')[0].kind, 'idea');
assert.strictEqual(L.search(sd, '').length, 0);

// Messages d'un proche (samedi 31 octobre 2026, 10:00).
const sat = d('2026-10-31T10:00');
assert.deepStrictEqual(L.parseMessage('Acheter du pain', sat), { type: 'task', title: 'Acheter du pain', date: '', time: '' });
assert.deepStrictEqual(L.parseMessage('rappel Appeler le garage demain 10h', sat), { type: 'reminder', title: 'Appeler le garage', date: '2026-11-01', time: '10:00' });
assert.deepStrictEqual(L.parseMessage('Rappelle-moi de sortir les poubelles ce soir', sat), { type: 'reminder', title: 'Sortir les poubelles', date: '2026-10-31', time: '19:00' });
assert.deepStrictEqual(L.parseMessage('Dentiste lundi à 17h30', sat), { type: 'task', title: 'Dentiste', date: '2026-11-02', time: '17:30' });
assert.deepStrictEqual(L.parseMessage('rappel Anniversaire de maman le 12/11', sat), { type: 'reminder', title: 'Anniversaire de maman', date: '2026-11-12', time: '10:00' });
assert.deepStrictEqual(L.parseMessage('rappel Prendre les clés', sat), { type: 'reminder', title: 'Prendre les clés', date: '2026-10-31', time: '11:00' });

// Message d'un proche → élément prêt à ajouter, id stable (pas de doublon PC / téléphone).
const mi = L.messageToItem({ id: 'abc', message: 'rappel Appeler le garage demain 10h' }, sat, 'Sam');
assert.strictEqual(mi.coll, 'reminders'); assert.strictEqual(mi.item.id, 'kabc');
assert.strictEqual(mi.item.due, d('2026-11-01T10:00').toISOString());
assert.strictEqual(mi.item.notes[0].text, 'Envoyé par Sam');
assert.strictEqual(L.messageToItem({ id: 'x', message: 'Pain' }, sat, 'Sam').coll, 'tasks');

// Notifications programmées à l'avance (Android), vendredi 30 octobre 2026 à 10:00.
const P = { ...L.DEFAULT_SETTINGS, quietStart: '01:30', quietEnd: '09:30', checkins: '', modules: { ...L.DEFAULT_SETTINGS.modules, soir: false } };
const fri = d('2026-10-30T10:00');
const planOf = (o, now = fri) => L.planNotifications(L.normalize({ settings: P, ...o }), now);
// Un rappel à 11:00 relancé toutes les 10 min : la 1re fois + 5 relances.
let plan = planOf({ reminders: [{ id: 'r', title: 'Facture', kind: 'once', date: '2026-10-30', time: '11:00', due: d('2026-10-30T11:00').toISOString(), nag: 10 }] });
assert.deepStrictEqual(plan.map(p => [p.kind, L.clock(p.at)]), [['reminder', '11:00'], ['nag', '11:10'], ['nag', '11:20'], ['nag', '11:30'], ['nag', '11:40'], ['nag', '11:50']]);
assert.ok(plan.every(p => Number.isInteger(p.id)) && new Set(plan.map(p => p.id)).size === 6);
// Pendant les heures calmes : décalé à la fin (09:30), sauf s'il est urgent.
plan = planOf({ reminders: [{ id: 'q', title: 'Q', kind: 'once', date: '2026-10-31', time: '03:00', due: d('2026-10-31T03:00').toISOString(), nag: 0 }] });
assert.deepStrictEqual(plan.map(p => p.at), [d('2026-10-31T09:30')]);
plan = planOf({ reminders: [{ id: 'u', title: 'U', kind: 'once', date: '2026-10-31', time: '03:00', due: d('2026-10-31T03:00').toISOString(), nag: 0, urgent: true }] });
assert.deepStrictEqual(plan.map(p => [p.at, p.mode]), [[d('2026-10-31T03:00'), 'urgent']]);
// Pro un samedi : reporté au lundi 09:00 (début du travail).
plan = planOf({ reminders: [{ id: 'p', title: 'P', sphere: 'pro', kind: 'once', date: '2026-10-31', time: '15:00', due: d('2026-10-31T15:00').toISOString(), nag: 0 }] });
assert.deepStrictEqual(plan.map(p => p.at), [d('2026-11-02T09:30')]); // 09:00 est encore dans les heures calmes
// Déjà notifié : seulement les relances suivantes.
plan = planOf({ reminders: [{ id: 'f', title: 'F', kind: 'once', date: '2026-10-30', time: '09:45', due: d('2026-10-30T09:45').toISOString(), lastFired: d('2026-10-30T09:55').toISOString(), nag: 10 }] });
assert.strictEqual(plan[0].kind, 'nag'); assert.deepStrictEqual(plan[0].at, d('2026-10-30T10:05'));
// Événement 15 min avant, anniversaire le matin au lever, tâche à l'heure.
plan = planOf({ events: [weeklyMeeting, { id: 'a', title: 'Anniv', date: '2026-11-01', allDay: true, repeat: 'yearly' }],
  tasks: [{ id: 't', title: 'Devis', date: '2026-10-30', time: '14:00' }] }, d('2026-11-01T09:00'));
assert.deepStrictEqual(plan.map(p => [p.kind, p.at]).slice(0, 2), [['event', d('2026-11-01T10:30')], ['event', d('2026-11-02T09:45')]]);
// Check-ins quotidiens, pas pendant les heures calmes, pas deux fois le même jour.
plan = planOf({ settings: { ...P, checkins: '13:00' }, fired: { 'checkin-13:00': '2026-10-30' } });
assert.deepStrictEqual(plan.slice(0, 2).map(p => p.at), [d('2026-10-31T13:00'), d('2026-11-01T13:00')]);

// Synchro : horodatage local, suppression, fusion « le plus récent gagne », adoption des réglages.
const t0 = d('2026-11-01T10:00'), t1 = d('2026-11-01T11:00'), t2 = d('2026-11-01T12:00');
const pc0 = L.normalize({ settings: { prenom: 'A' }, tasks: [{ id: 'a', title: 'Pain' }, { id: 'b', title: 'Lait' }] });
const pc1 = L.stamp(L.normalize({}), JSON.parse(JSON.stringify(pc0)), t0);
assert.ok(pc1.tasks.every(t => t.updatedAt === t0.toISOString()));
assert.strictEqual(pc1.settingsU.prenom, t0.toISOString());
const pc2 = JSON.parse(JSON.stringify(pc1)); pc2.tasks = pc2.tasks.filter(t => t.id !== 'b'); pc2.tasks[0].title = 'Pain complet';
L.stamp(pc1, pc2, t1);
assert.strictEqual(pc2.tasks[0].updatedAt, t1.toISOString()); assert.strictEqual(pc2.deleted['tasks:b'], t1.toISOString());
// Le téléphone avait encore « Lait » (ancien) et « Pain » modifié plus tôt ; il ajoute « Œufs ».
const ph = L.normalize({ tasks: [{ id: 'a', title: 'Pain bio', updatedAt: t0.toISOString() }, { id: 'b', title: 'Lait', updatedAt: t0.toISOString() }, { id: 'c', title: 'Œufs', updatedAt: t2.toISOString() }] });
const m1 = L.mergeRemote(ph, L.syncView(pc2));
assert.deepStrictEqual(m1.data.tasks.map(t => t.title).sort(), ['Pain complet', 'Œufs']);
assert.strictEqual(m1.changed, true); assert.strictEqual(m1.behind, true); // le PC n'a pas « Œufs »
const m2 = L.mergeRemote(pc2, L.syncView(m1.data));
assert.deepStrictEqual(m2.data.tasks.map(t => t.title).sort(), ['Pain complet', 'Œufs']); assert.strictEqual(m2.behind, false);
assert.strictEqual(L.mergeRemote(m2.data, L.syncView(m1.data)).changed, false); // plus rien à échanger
// Un élément venu de l'autre appareil garde sa date ; les réglages propres à l'appareil ne voyagent pas.
const recv = JSON.parse(JSON.stringify(m1.data)); L.stamp(ph, recv, t2);
assert.strictEqual(recv.tasks.find(t => t.id === 'a').updatedAt, t1.toISOString());
assert.ok(!('shortcut' in L.syncView(pc2).settings) && !('sync' in L.syncView(pc2).settings));
// Une copie ancienne renvoyée par l'interface (même contenu, ancienne date) ne fait pas reculer la date.
const stale = JSON.parse(JSON.stringify(pc2)); stale.tasks[0].updatedAt = t0.toISOString();
L.stamp(pc2, stale, t2);
assert.strictEqual(stale.tasks[0].updatedAt, t1.toISOString());
// Premier appairage : le téléphone adopte les réglages du PC, mais garde sa propre position de lecture des messages.
const phone = L.normalize({ settings: { kelly: { lastId: 'tel', since: 5 } } });
const ad = L.mergeRemote(phone, L.syncView(L.normalize({ settings: { prenom: 'A', kelly: { enabled: true, topic: 'k', lastId: 'pc' } } })), true);
assert.strictEqual(ad.data.settings.prenom, 'A'); assert.strictEqual(ad.data.settings.kelly.topic, 'k'); assert.strictEqual(ad.data.settings.kelly.lastId, 'tel');

// Données abîmées ou vides → structure saine.
assert.strictEqual(L.normalize(null).settings.phone.server, 'https://ntfy.sh');
assert.strictEqual(L.normalize({ settings: { modules: { soir: false } } }).settings.modules.focus, true);

// Français : « 1er novembre », et « victoire » accordé.
assert.strictEqual(L.frDate(new Date(2026, 10, 1), { day: 'numeric', month: 'long' }), '1er novembre');
assert.strictEqual(L.frDate(new Date(2026, 10, 11), { day: 'numeric', month: 'long' }), '11 novembre');
assert.match(L.frDate(new Date(2026, 10, 1), { weekday: 'short', day: 'numeric', month: 'short' }), /^dim\. 1er nov\.$/);
assert.strictEqual(L.msg('direct', 'bedtime', { n: 1 }), 'Heure du coucher. 1 victoire aujourd\'hui.');
assert.strictEqual(L.msg('direct', 'bedtime', { n: 3 }), 'Heure du coucher. 3 victoires aujourd\'hui.');

// Chiffrement : aller-retour, et une mauvaise clé échoue.
(async () => {
  const key = L.newKey(), box = await L.encrypt(key, { a: 'Été' });
  assert.deepStrictEqual(await L.decrypt(key, box), { a: 'Été' });
  await assert.rejects(L.decrypt(L.newKey(), box));
  console.log('Tous les tests passent.');
})().catch(e => { console.error(e); process.exit(1); });
