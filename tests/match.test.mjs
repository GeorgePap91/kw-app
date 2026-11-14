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
for (const f of ['Code.js', 'Profile.js', 'Match.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
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
  const r = find([fresh()], [l], {}, byCode, st, new Set(['N9|' + l.phone]));
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
