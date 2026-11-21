// 2.14.1 · QA W47 #5: τα ποσά δεν σβήνονται σαν αριθμός ταυτότητας (scrubIds_ στο Code.js, pnClean_ στο PropExtra.js)
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
const scrub = (s) => vm.runInContext(`scrubIds_(${JSON.stringify(s)})`, ctx);
const pn = (s) => vm.runInContext(`pnClean_(${JSON.stringify(s)}).text`, ctx);

test('scrubIds_: τα παραδείγματα του QA μένουν ως έχουν', () => {
  for (const s of ['έως 250000 ευρώ', 'μέχρι 300000', 'Τιμή 1.250.000', 'Πήρε σε 180000',
                   'Budget 2500000€', 'έως € 1250000', 'από 90.000 έως 1.200.000 €', 'έως 3.500.000 ευρώ']) {
    assert.equal(scrub(s), s, s);
  }
});

test('scrubIds_: ταυτότητες, ΑΦΜ, τηλέφωνα, IBAN σβήνονται ακόμα', () => {
  assert.equal(scrub('ΑΔΤ ΑΚ 123456'), 'ΑΔΤ •••');
  assert.equal(scrub('ταυτότητα Χ-123456 και'), 'ταυτότητα ••• και');
  assert.equal(scrub('ΑΦΜ 123456789'), 'ΑΦΜ •••');
  assert.equal(scrub('ΑΦΜ 123.456.789'), 'ΑΦΜ •••', 'ΑΦΜ με τελείες (9 ψηφία) δεν περνά για ποσό');
  assert.equal(scrub('τηλ 6912345678'), 'τηλ •••');
  assert.equal(scrub('τηλ 69 1234 5678'), 'τηλ •••');
  assert.doesNotMatch(scrub('IBAN GR16 0110 1250 0000 0001 2300 695'), /\d{3}/);
});

test('pnClean_: ποσά μένουν, ΑΔΤ/ΑΦΜ σβήνονται, τηλέφωνα μένουν', () => {
  assert.equal(pn('Πήρε σε 180000'), 'Πήρε σε 180000');
  assert.equal(pn('ζητά έως 250000 ευρώ'), 'ζητά έως 250000 ευρώ');
  assert.equal(pn('Τιμή 1.250.000'), 'Τιμή 1.250.000');
  assert.equal(pn('ΑΔΤ ΑΒ 123456, ΑΦΜ 123456789, τηλ 6912345678'), 'ΑΔΤ •••, ΑΦΜ •••, τηλ 6912345678');
});
