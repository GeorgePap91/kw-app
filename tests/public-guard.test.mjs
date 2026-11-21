// QA w47 #3 · Δημόσιες φόρμες: ένα κομμένο/λάθος link που ανανεώνεται δεν κλειδώνει ΟΛΕΣ τις φόρμες του γραφείου.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world() {
  const store = new Map();
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
    Utilities: noop, ScriptApp: noop, Session: noop, ContentService: noop, HtmlService: noop, DocumentApp: noop,
    Logger: noop, ContactsApp: noop, LockService: noop,
    CacheService: { getScriptCache: () => ({ get: k => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, v) }) }
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Demand.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  const run = (s) => vm.runInContext(s, ctx);
  run(`sha256_ = function (x) { return 'h' + x; };`);
  // ψεύτικο «φύλλο»: το έγκυρο κλειδί είναι το GOOD, όλα τα άλλα δεν βρίσκονται
  run(`dmSheet_ = function () { return {}; };
       dmByToken_ = function (sh, t) {
         return t === '${'b'.repeat(48)}' ? { row: 2, v: ['DM', 'h', 'L1', 'Α', 'K', 'Αγορά', new Date(), new Date(Date.now() + 864e5), 'Στάλθηκε', 0, '', '', '', '', '{}', new Date()] } : null; };
       sfAgent_ = function () { return { name: 'Α' }; };`);
  const opens = (t) => run(`(function () { try { dmOpenRow_({}, ${JSON.stringify(t)}); return 'ok'; } catch (e) { return e.code || e.message; } })()`);
  return { run, opens };
}

const GOOD = 'b'.repeat(48);

test('κομμένο link που ανανεώνεται συνέχεια: κλείνει ΜΟΝΟ αυτό, όχι οι άλλοι πελάτες', () => {
  const w = world();
  for (let i = 0; i < 60; i++) w.opens('a'.repeat(30));         // ο ίδιος κομμένος σύνδεσμος, 60 ανανεώσεις
  assert.match(w.opens('a'.repeat(30)), /Πολλές λάθος προσπάθειες/);   // αυτός πλέον κόβεται γρήγορα
  assert.equal(w.opens(GOOD), 'ok');                                    // ο άλλος πελάτης δουλεύει κανονικά
});

test('έγκυρα links δεν μετρούν ποτέ σαν λάθος προσπάθειες', () => {
  const w = world();
  for (let i = 0; i < 100; i++) assert.equal(w.opens(GOOD), 'ok');
});

test('διαφορετικά τυχαία κλειδιά: το γενικό δίχτυ ασφαλείας ισχύει αλλά είναι πολύ ψηλότερο από 40', () => {
  const w = world();
  for (let i = 0; i < 100; i++) w.opens('x' + i);                       // 100 διαφορετικά λάθος κλειδιά
  assert.equal(w.opens(GOOD), 'ok', '100 λάθος κλειδιά δεν πρέπει να κλειδώνουν τους πελάτες');
  for (let i = 100; i < 450; i++) w.opens('x' + i);
  assert.match(w.opens(GOOD), /Πολλές λάθος προσπάθειες/);              // κατακλυσμός = φρένο για όλους
});
