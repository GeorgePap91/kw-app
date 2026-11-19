// 1.23 / 2.13 · Απαραίτητα έγγραφα + Σημειώσεις ακινήτου: η λογική του apps-script/PropExtra.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
const ctx = {
  console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
  SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
  Utilities: noop, CacheService: noop, LockService: noop, ScriptApp: noop, Session: noop, ContentService: noop,
  HtmlService: noop, DocumentApp: noop, Logger: noop, ContactsApp: noop
};
vm.createContext(ctx);
for (const f of ['Code.js', 'PropExtra.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
const run = (s) => vm.runInContext(s, ctx);
const names = (base, list) => JSON.parse(run(`JSON.stringify(reqNames_(${JSON.stringify(base)}, ${JSON.stringify(list)}))`));

test('αρίθμηση: πρώτο σκέτο, με το δεύτερο γίνεται (1) και (2)', () => {
  assert.deepEqual(names('Ε9', []), { name: 'Ε9', first: false });
  assert.deepEqual(names('Ε9', ['Ε9.pdf']), { name: 'Ε9 (2)', first: true });
  assert.deepEqual(names('Ε9', ['Ε9 (1).pdf', 'Ε9 (2).jpg']), { name: 'Ε9 (3)', first: false });
});

test('αρίθμηση: μετονομασμένα στο Drive δεν αγγίζονται, ούτε διπλό όνομα', () => {
  assert.deepEqual(names('Κάτοψη', ['Ισόγειο.pdf']), { name: 'Κάτοψη (2)', first: false });
  assert.deepEqual(names('Κάτοψη', ['Κάτοψη (1).pdf', 'Όροφος.pdf', 'Κάτοψη (3).pdf']), { name: 'Κάτοψη (4)', first: false });
  assert.deepEqual(names('Κάτοψη', ['Κάτοψη.pdf', 'Κάτοψη (1).pdf']), { name: 'Κάτοψη (3)', first: false });
});

test('θέση αρχείου: από την ετικέτα, αλλιώς από το όνομα', () => {
  const slot = (d, n) => run(`(reqSlotOf_(${JSON.stringify(d)}, ${JSON.stringify(n)}) || {}).key || ''`);
  assert.equal(slot('[KW:e9] Πρόσφατο Ε9 · ανέβηκε…', 'Το Ε9 της μάνας μου.pdf'), 'e9');
  assert.equal(slot('', 'Τίτλος ιδιοκτησίας (2).pdf'), 'title');
  assert.equal(slot('', 'Κτηματολογικό φύλλο.pdf'), 'ktima');
  assert.equal(slot('', 'φωτογραφία.jpg'), '');
});

test('σημειώσεις: σβήνονται ΑΦΜ και ταυτότητα, μένει το τηλέφωνο', () => {
  const c = JSON.parse(run(`JSON.stringify(pnClean_('Ιδιοκτήτης ΑΦΜ 123456789, ΑΔΤ ΑΒ 123456, τηλ 6912345678'))`));
  assert.equal(c.masked, true);
  assert.ok(!/123456789/.test(c.text) && !/ΑΒ 123456/.test(c.text));
  assert.ok(/6912345678/.test(c.text));
  const ok = JSON.parse(run(`JSON.stringify(pnClean_('Κλειδιά στον θυρωρό'))`));
  assert.deepEqual(ok, { text: 'Κλειδιά στον θυρωρό', masked: false });
});

test('οι νέες ενέργειες είναι γραμμένες και το docs δέχεται set req', () => {
  assert.equal(run('typeof ACTIONS.pnotes + typeof ACTIONS.pnoteAdd + typeof ACTIONS.pnoteDel'), 'functionfunctionfunction');
  assert.equal(run("docSet_('req')"), 'req');
  assert.equal(run("docSet_('x')"), 'live');
  assert.equal(run("slotsOf_('req').length"), 4);
});
