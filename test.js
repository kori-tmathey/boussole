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

// Données abîmées ou vides → structure saine.
assert.strictEqual(L.normalize(null).settings.phone.server, 'https://ntfy.sh');
assert.strictEqual(L.normalize({ settings: { modules: { soir: false } } }).settings.modules.focus, true);

console.log('Tous les tests passent.');
