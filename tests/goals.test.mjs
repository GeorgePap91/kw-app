// 2.9 · Coach, στόχοι, οικονομικά: η καθαρή λογική του apps-script/Goals.js και οι ρόλοι.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
const ctx = {
  console: { ...console, log() {}, warn() {} }, Date, JSON, Math, Set,
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
  SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
  Utilities: noop, CacheService: noop, LockService: noop, ScriptApp: noop, Session: noop, ContentService: noop,
  HtmlService: noop, DocumentApp: noop, Logger: noop, ContactsApp: noop
};
vm.createContext(ctx);
const files = readdirSync(DIR).filter((f) => /\.js$/.test(f) && f !== 'Code.js');
for (const f of ['Code.js', ...files]) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
const run = (s) => vm.runInContext(s, ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));

test('ρόλοι: ο Coach είναι μόνο Coach· οι παλιές τιμές δεν αλλάζουν', () => {
  const pr = run('parseRoles_');
  assert.deepEqual(plain(pr('Coach')), { agent: false, admin: false, coach: true });
  assert.deepEqual(plain(pr('')), { agent: true, admin: false, coach: false });
  assert.deepEqual(plain(pr('Μεσίτης')), { agent: true, admin: false, coach: false });
  assert.deepEqual(plain(pr('Admin')), { agent: false, admin: true, coach: false });
  assert.deepEqual(plain(pr('Μεσίτης + Admin')), { agent: true, admin: true, coach: false });
  assert.ok(run('ROLE_VALUES').includes('Coach'));
});

test('ενέργειες Coach: υπάρχουν μόνο στο COACH_ACTIONS, όχι στις ενέργειες του μεσίτη', () => {
  for (const a of ['coachBoot', 'coachDash', 'coachGoalSet']) {
    assert.equal(typeof run('COACH_ACTIONS')[a], 'function', a);
    assert.equal(run('ACTIONS')[a], undefined, a + ' δεν πρέπει να είναι στο ACTIONS');
  }
  assert.equal(typeof run('ACTIONS').dash, 'function');
  const code = readFileSync(DIR + 'Code.js', 'utf8');
  assert.match(code, /COACH_ACTIONS\[req\.action\]\) \{\s*if \(!isCoach_\(sess\.agent\)\)/, 'ο έλεγχος ρόλου γίνεται στο doPost');
});

test('cap: ο κύκλος ξεκινά στην «Έναρξη cap» κάθε μεσίτη και μηδενίζει κάθε χρόνο', () => {
  const cp = run('capPeriod_');
  const iso = run('gIso_');
  let p = cp('01/09', new Date(2026, 10, 16));
  assert.equal(iso(p.start), '2026-09-01'); assert.equal(iso(p.next), '2027-09-01');
  p = cp('01/09', new Date(2026, 4, 3));                       // πριν την επέτειο → ο κύκλος της προηγούμενης χρονιάς
  assert.equal(iso(p.start), '2025-09-01'); assert.equal(iso(p.next), '2026-09-01');
  p = cp(new Date(2023, 4, 15), new Date(2026, 4, 15));        // Date από το φύλλο· η ίδια η μέρα ανήκει στον νέο κύκλο
  assert.equal(iso(p.start), '2026-05-15');
  p = cp('', new Date(2026, 10, 16));                          // κενό = ημερολογιακό έτος
  assert.equal(iso(p.start), '2026-01-01');
  p = cp('45/45', new Date(2026, 10, 16));
  assert.equal(iso(p.start), '2026-01-01');
});

test('οικονομικά: ποσά και ημερομηνίες σε κάθε μορφή', () => {
  const n = run('finNum_');
  assert.equal(n(7200), 7200);
  assert.equal(n('7.200 €'), 7200);
  assert.equal(n('1.234,50'), 1234.5);
  assert.equal(n('1234.5'), 1234.5);
  assert.equal(n('-'), 0);
  assert.equal(n(-5), 0);
  assert.equal(run('gIso_')(new Date(run('finTs_')('05/03/2026'))), '2026-03-05');
});

const sheet = [
  ['Ημερομηνία', 'Μεσίτης', 'Κωδικός ακινήτου', 'Αμοιβή ιδιοκτήτη', 'Αμοιβή αγοραστή/μισθωτή', 'Σύνολο συμβολαίου', '', 'Σύνολα ανά μεσίτη', 'Συνολικός τζίρος'],
  [new Date(2026, 9, 6), 'Μαρία Δοκιμή', 'TEST-101', 7200, 3600, 10800, '', 'Μαρία Δοκιμή', 99999],
  [new Date(2026, 1, 10), 'Μαρία Δοκιμή', 'TEST-102', 20000, 10000, 30000, '', '', ''],
  [new Date(2025, 9, 20), 'Μαρία Δοκιμή', 'TEST-103', 12000, 6000, 18000, '', '', ''],
  [new Date(2026, 9, 7), 'Άλλος Δοκιμή', 'TEST-201', 900, 900, 1800, '', '', ''],
  ['', 'Μαρία Δοκιμή', 'TEST-104', 500, 500, 1000, '', '', ''],       // χωρίς ημερομηνία: αγνοείται
  ['', '', '', '', '', '', '', '', '']
];

test('οικονομικά: οι στήλες βρίσκονται από την επικεφαλίδα· το σύνολο υπολογίζεται εδώ', () => {
  const p = run('finParse_')(sheet);
  assert.equal(p.ok, true);
  assert.equal(p.rows.length, 4);
  assert.deepEqual(plain(p.rows[0]).slice(1), ['μαρια δοκιμη', 'TEST-101', 7200, 3600]);
  assert.equal(run('finParse_')([['Α', 'Β'], [1, 2]]).ok, false);
});

test('οικονομικά: τζίρος έτους, cap με δικό του κύκλο, υπόλοιπο', () => {
  const rows = run('finParse_')(sheet).rows;
  const f = plain(run('finFor_')(['μαρια δοκιμη'], rows, '01/09', 50000, new Date(2026, 10, 16)));
  assert.equal(f.yearTotal, 40800);            // 2026: 10.800 + 30.000
  assert.equal(f.owner, 27200); assert.equal(f.buyer, 13600);
  assert.equal(f.capTotal, 10800);             // κύκλος 01/09/2026 – 31/08/2027: μόνο του Οκτωβρίου
  assert.equal(f.capLeft, 39200);
  assert.equal(f.capFrom, '2026-09-01'); assert.equal(f.capTo, '2027-08-31');
  assert.equal(f.capped, false);
  assert.equal(f.months[9], 10800); assert.equal(f.months[1], 30000);
  assert.equal(f.deals.length, 2);             // του 2025 είναι πριν από έτος ΚΑΙ κύκλο
  assert.ok(f.deals.every((d) => d.code !== 'TEST-201'), 'ποτέ κλεισίματα άλλου μεσίτη');
  const g = plain(run('finFor_')(['μαρια δοκιμη'], rows, '', 30000, new Date(2026, 10, 16)));
  assert.equal(g.capped, true); assert.equal(g.capLeft, 0);
});

test('στόχοι: καθάρισμα και ποσοστό επίτευξης', () => {
  const c = plain(run('goalClean_')({ showSale: { w: '2', m: 8, y: '96' }, rev: { w: 5, y: 60000 }, hack: { m: 1 }, buyer: { m: -3 }, exclSale: { m: '1,5' } },
    ['showSale', 'buyer', 'exclSale', 'rev']));
  assert.deepEqual(c, { showSale: { w: 2, m: 8, y: 96 }, rev: { w: 0, m: 0, y: 60000 }, exclSale: { w: 0, m: 1.5, y: 0 } });
  const pct = run('goalPct_');
  assert.equal(pct({ showSale: { m: 8 }, buyer: { m: 4 }, rev: { y: 1 } }, { showSale: 4, buyer: 10 }, 'm'), 0.75);
  assert.equal(pct({ rev: { y: 1 } }, {}, 'm'), null);
});
