// 2.5 · FEAT-11 · Νέο ακίνητο → πελάτες που ταιριάζουν: η λογική του apps-script/Match.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const store = {};
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
const ctx = {
  console: { ...console, log() {}, warn() {} }, Date, JSON, Math, Set,
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => ({ ...store }), getProperty: (k) => store[k] ?? null,
    setProperty: (k, v) => { store[k] = v; }, setProperties: (o) => Object.assign(store, o) }) },
  SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
  Utilities: noop, CacheService: noop, LockService: noop, ScriptApp: noop, Session: noop, ContentService: noop,
  HtmlService: noop, DocumentApp: noop, Logger: noop, ContactsApp: noop
};
vm.createContext(ctx);
for (const f of ['Code.js', 'Profile.js', 'Match.js', 'Drops.js', 'Report.js', 'Edit.js', 'Ops.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
const run = (s) => vm.runInContext(s, ctx);
const find = run('matchFind_');

const home = { code: 'A-1', deal: 'Πώληση', price: 240000, area: 'Παγκράτι', available: true };
const byCode = { A1: home };
const fresh = (o = {}) => ({ code: 'N-9', deal: 'Πώληση', price: 255000, area: 'Παγκράτι', street: 'Υμηττού 10', available: true, ...o });
const L = (id, o = {}) => ({ id, name: 'Πελάτης ' + id, phone: '69' + id.padStart(8, '0'), code: 'A-1', deal: '', price: '', ...o });
const st = () => 'Απαντημένη';

test('ταιριάζει με budget +10% και περιοχή του προφίλ', () => {
  const r = find([fresh({ area: 'Βύρωνας' })], [L('1')], { 1: { deal: 'buy', budgetBuy: 240000, areasBuy: 'Βύρωνας, Καισαριανή' } }, byCode, st, new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].why, 'budget 240.000 € · Βύρωνας');
});

test('πάνω από budget +10% → όχι', () => {
  const r = find([fresh({ price: 270000 })], [L('1')], { 1: { deal: 'buy', budgetBuy: 240000, areasBuy: 'Παγκράτι' } }, byCode, st, new Set());
  assert.equal(r.length, 0);
});

test('άλλη συναλλαγή (ενοικίαση) → όχι', () => {
  const r = find([fresh({ deal: 'Ενοικίαση', price: 900 })], [L('1')], {}, byCode, st, new Set());
  assert.equal(r.length, 0);
});

test('χωρίς προφίλ: ίδια περιοχή με το ακίνητο που κάλεσε, τιμή κοντά', () => {
  const r = find([fresh()], [L('1')], {}, byCode, st, new Set());
  assert.equal(r.length, 1);
  assert.match(r[0].why, /^ζήτησε 240\.000 € · Παγκράτι$/);
  assert.equal(find([fresh({ area: 'Γλυφάδα' })], [L('1')], {}, byCode, st, new Set()).length, 0, 'άλλη περιοχή');
  assert.equal(find([fresh({ price: 90000 })], [L('1')], {}, byCode, st, new Set()).length, 0, 'πολύ φθηνότερο');
});

test('AC5: δεν ξαναπροτείνεται ο ίδιος πελάτης για το ίδιο ακίνητο', () => {
  const l = L('1');
  const r = find([fresh()], [l], {}, byCode, st, new Set(['N9|' + run('matchH_')(l.phone)]));
  assert.equal(r.length, 0);
});

test('κλειστή κλήση και κλήση για το ίδιο ακίνητο → όχι· διπλός πελάτης → μία φορά', () => {
  assert.equal(find([fresh()], [L('1')], {}, byCode, () => 'Κλειστή', new Set()).length, 0);
  assert.equal(find([fresh({ code: 'A-1' })], [L('1')], {}, byCode, st, new Set()).length, 0);
  const twice = [L('1'), L('2', { phone: L('1').phone })];
  const r = find([fresh()], twice, { 2: { deal: 'buy', budgetBuy: 250000, areasBuy: 'Παγκράτι' } }, byCode, st, new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '2', 'κρατά την κλήση με προφίλ');
});

test('ειδοποίηση: ένα κείμενο ανά μεσίτη', () => {
  const t = run('matchPushText_');
  const one = t([{ code: 'N-9', key: 'a' }, { code: 'N-9', key: 'b' }], { N9: fresh() });
  assert.equal(one.title, 'Νέο ακίνητο στο Παγκράτι');
  assert.equal(one.body, 'Υμηττού 10 · ταιριάζει σε 2 πελάτες σου');
  const many = t([{ code: 'N-9', key: 'a' }, { code: 'X-1', key: 'a' }], {});
  assert.equal(many.title, '2 νέα ακίνητα');
  assert.equal(many.body, 'Ταιριάζει σε 1 πελάτη σου');
});

test('λίστα εφαρμογής: νέα πρώτα, χωρίς διπλά, σβήνονται μετά από 14 ημέρες', () => {
  const merge = run('matchMerge_');
  const now = Date.now();
  const r = merge([{ code: 'A', id: '1', at: now - 20 * 864e5 }, { code: 'B', id: '1', at: now - 864e5 }],
                  [{ code: 'B', id: '1', at: now }, { code: 'C', id: '2', at: now }], now);
  assert.equal(r.map((m) => m.code).join(), 'B,C');
});

test('MATCH_SEEN: σπάει σε κομμάτια και ξαναδιαβάζεται', () => {
  const codes = Array.from({ length: 2000 }, (_, i) => 'KW' + i);
  run('matchSeenSet_')(codes);
  assert.ok(Number(store.MATCH_SEEN_N) >= 2);
  Object.assign(run('PROPS_'), store);
  assert.equal(JSON.stringify(run('matchSeenGet_()')), JSON.stringify(codes));
});

test('αποτύπωμα πελάτη: σταθερό και χωρίς το τηλέφωνο', () => {
  const h = run('matchH_');
  assert.equal(h('6900000001'), h('6900000001'));
  assert.notEqual(h('6900000001'), h('6900000002'));
  assert.ok(!h('6900000001').includes('690'));
});

// ── 2.6 · FEAT-12 · Μείωση τιμής ──
test('FEAT-12: μείωση ≥2% βρίσκεται, μικρότερη ή αύξηση όχι', () => {
  const f = run('dropFind_');
  const props = { A1: { code: 'A-1', price: 230000, available: true }, B2: { code: 'B-2', price: 99000, available: true },
                  C3: { code: 'C-3', price: 310000, available: true }, D4: { code: 'D-4', price: 100000, available: false } };
  const r = f({ A1: 250000, B2: 100000, C3: 300000, D4: 150000 }, props);
  assert.equal(r.map((x) => x.key).join(), 'A1');
});

test('FEAT-12: πελάτες — όχι «Ενδιαφέρθηκε»/κλειστοί, πρώτα όσοι τους καλύπτει τώρα', () => {
  const c = run('dropClients_');
  const d = { key: 'A1', p: { deal: 'Πώληση' }, old: 250000, now: 230000 };
  const leads = [L('1'), L('2'), L('3'), L('4'), L('5', { code: 'X-9' })];
  const pf = { 2: { budgetBuy: 235000 } };
  const out = { 3: 'Ενδιαφέρθηκε' };
  const r = c(d, leads, pf, (id) => (id === '4' ? 'Κλειστή' : 'Απαντημένη'), (id) => out[id] || '');
  assert.equal(r.map((x) => x.id).join(), '2,1');
  assert.match(r[0].why, /τώρα το καλύπτει/);
});

test('FEAT-12: οι τιμές της χθες σώζονται σε κομμάτια και ξαναδιαβάζονται', () => {
  const props = {};
  for (let i = 0; i < 1500; i++) props['KW' + i] = { price: 100000 + i, available: true };
  run('dropLastSet_')(props);
  assert.ok(Number(store.PRICE_LAST_N) >= 2);
  Object.assign(run('PROPS_'), store);
  const back = run('dropLastGet_()');
  assert.equal(back.KW0, 100000);
  assert.equal(back.KW1499, 101499);
  assert.equal(Object.keys(back).length, 1500);
});

// ── 2.6 · FEAT-13 · Αναφορά ιδιοκτήτη ──
test('FEAT-13: αναφορά ανά πηγή, σύγκριση, υποδείξεις — χωρίς ονόματα', () => {
  const b = run('reportBuild_');
  const r = b({ code: 'A-1', street: 'Υμηττού 10', price: 250000 }, 'Οκτώβριος',
    [{ id: '1', source: 'Spitogatos' }, { id: '2', source: 'Spitogatos' }, { id: '3', source: 'XE' }], 1,
    [{ outcome: 'Ενδιαφέρθηκε' }, { outcome: '' }], 2);
  assert.equal(r.calls, 3);
  assert.equal(r.trend, '+2 από τον προηγούμενο μήνα');
  assert.equal(r.sources[0].name + r.sources[0].n, 'Spitogatos2');
  const t = run('reportText_')(r, 'Νίκος Παπάς', 'Γιώργος');
  assert.match(t, /^Καλησπέρα Νίκος,/);
  assert.match(t, /Τηλεφωνήματα: 3 \(\+2/);
  assert.match(t, /2 ενδιαφερόμενοι βρήκαν την τιμή/);
  const h = run('reportHtml_')(r, '<b>x</b>', 'Γ');
  assert.ok(!h.includes('<b>x</b>'), 'escape');
});

// ── 2.7 · Διόρθωση ακινήτου, μετρήσεις χρήσης, έτοιμα SMS ──
test('2.7: διόρθωση ακινήτου — καθαρίζει τιμές, απορρίπτει λάθος', () => {
  const c = run('editClean_');
  assert.equal(JSON.stringify(c({ price: '245.000 €', sqm: '85', street: '  Υμηττού   10 ', area: '' })),
    JSON.stringify({ price: 245000, sqm: 85, street: 'Υμηττού 10' }));
  assert.equal(JSON.stringify(c({ code: 'A-1' })), '{}');
  assert.throws(() => c({ price: 'abc' }), /τιμή/);
});

test('2.7: μετρήσεις — άθροιση, άγνωστες ενέργειες και υπερβολές κόβονται', () => {
  const add = run('usageAdd_');
  const t = add({ sms: [2, 20, 6] }, { sms: [1, 10, 3], showing: [1, 9999, 5], hack: [5, 5, 5], status: [0, 0, 0] });
  assert.equal(JSON.stringify(t), JSON.stringify({ sms: [3, 30, 9], showing: [1, 600, 5] }));
});

test('2.7: αναφορά — χρόνος που γλίτωσε = φορές × (με το χέρι − μέσος όρος), ποτέ αρνητικός', () => {
  const r = run('usageRows_')({ sms: [10, 100, 30], status: [2, 400, 4] }, { sms: 60, status: 60 });
  assert.equal(r.savedSec, 500);
  assert.equal(r.actions, 12);
  assert.equal(r.rows[0].key, 'sms');
  assert.equal(r.rows[0].avgSec, 10);
  assert.equal(r.rows[0].avgClicks, 3);
  assert.equal(r.rows[1].savedSec, 0);
});

test('2.7: νέα έτοιμα SMS υπάρχουν σε ΕΛ και EN, ίδια με το κινητό', () => {
  const T = run('DEFAULT_TEMPLATES');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  for (const k of ['noanswer', 'after', 'still']) {
    assert.ok(T[k].el && T[k].en, k);
    assert.ok(app.includes(T[k].el), 'TPL_FALLBACK ' + k + ' διαφέρει από τον server');
  }
});

// ── 2.8 · Απλή εμφάνιση, Κλείσιμο ημέρας, Εβδομαδιαίο email ──
test('2.8: προτίμηση εμφάνισης — προεπιλογή Πλήρης, ή ό,τι ορίζει το γραφείο', () => {
  const prefs = run('prefs_');
  assert.equal(prefs({ prefs: {} }).view, 'full');
  assert.equal(prefs({ prefs: { view: 'simple' } }).view, 'simple');
  run('PROPS_').DEFAULT_VIEW = 'simple';
  assert.equal(prefs({ prefs: {} }).view, 'simple');
  assert.equal(prefs({ prefs: { view: 'full' } }).view, 'full');
  delete run('PROPS_').DEFAULT_VIEW;
});

test('2.8: κλείσιμο ημέρας — μόνο εργάσιμες 18:30–19:30, μία φορά την ημέρα', () => {
  const due = run('dayCloseDue_');
  const at = (d, h, m) => new Date(2026, 10, d, h, m);            // 16/11/2026 = Δευτέρα
  assert.equal(due(at(16, 18, 30), '', '2026-11-16'), true);
  assert.equal(due(at(16, 18, 29), '', '2026-11-16'), false);
  assert.equal(due(at(16, 19, 45), '', '2026-11-16'), false);
  assert.equal(due(at(16, 18, 45), '2026-11-16', '2026-11-16'), false, 'ήδη στάλθηκε');
  assert.equal(due(at(14, 18, 45), '', '2026-11-14'), false, 'Σάββατο');
  assert.equal(due(at(15, 18, 45), '', '2026-11-15'), false, 'Κυριακή');
});

test('2.8: κλείσιμο ημέρας — μετράει υποδείξεις χωρίς αποτέλεσμα και νέες κλήσεις', () => {
  const now = Date.now(), A = run('ACOL'), ST = run('STATUS');
  const data = { 1: { at: new Date(now - 3600e3), oc: '' }, 2: { at: new Date(now - 3600e3), oc: 'Ενδιαφέρθηκε' },
                 3: { at: new Date(now + 3600e3), oc: '' }, 5: { at: new Date(now - 9 * 864e5), oc: '' } };
  const get = (id, col) => { const d = data[id] || {}; return col === A.SHOW_AT ? (d.at || '') : col === A.OUTCOME ? (d.oc || '') : ''; };
  const status = (id) => (id === '4' ? ST.PENDING : id === '6' ? ST.CLOSED : ST.SHOWING);
  const n = run('dayCloseCount_')(['1', '2', '3', '4', '5', '6'].map((id) => ({ id })), status, get, now);
  assert.equal(n, 2, 'η 1 (χωρίς αποτέλεσμα) και η 4 (νέα κλήση)');
});

test('2.8: εβδομαδιαίο email — εβδομάδα = τώρα − στιγμιότυπο, και στην αλλαγή μήνα', () => {
  const w = run('usageWeek_');
  assert.equal(JSON.stringify(w(null, '2026-11', { n: 5, s: 300 }, null)), JSON.stringify({ n: 5, s: 300, first: true }));
  assert.equal(JSON.stringify(w({ m: '2026-11', n: 5, s: 300 }, '2026-11', { n: 12, s: 900 }, null)), JSON.stringify({ n: 7, s: 600 }));
  assert.equal(JSON.stringify(w({ m: '2026-10', n: 40, s: 2000 }, '2026-11', { n: 3, s: 100 }, { n: 44, s: 2300 })), JSON.stringify({ n: 7, s: 400 }));
});

test('2.8: εβδομαδιαίο email — πίνακας ανά μεσίτη, μεταβολή, αχρησιμοποίητες λειτουργίες, χωρίς HTML από ονόματα', () => {
  const b = run('usageMailBody_')([{ name: 'Α <b>', n: 12, s: 3900, wn: 9 }, { name: 'Β', n: 2, s: 120, wn: null }], ['Αναφορά ιδιοκτήτη']);
  assert.match(b.text, /Σύνολο: 14 ενέργειες · γλίτωσε περίπου 1 ώρ\. 7′/);
  assert.match(b.text, /· Α <b>: 12 ενέργειες, 1 ώρ\. 5′ \(▲ \+3 από την προηγούμενη\)/);
  assert.match(b.text, /Δεν χρησιμοποιήθηκαν αυτόν τον μήνα: Αναφορά ιδιοκτήτη/);
  assert.ok(b.html.includes('Α &lt;b&gt;') && !b.html.includes('Α <b>'));
});
