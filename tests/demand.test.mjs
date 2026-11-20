// 1.24 / 2.14 · Φόρμα ζήτησης: η λογική του apps-script/Demand.js (καθαρισμός, έλεγχοι, σύνοψη)
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
for (const f of ['Code.js', 'Demand.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
const run = (s) => vm.runInContext(s, ctx);
const clean = (c) => JSON.parse(run(`JSON.stringify(dmClean_(${JSON.stringify(c)}))`));
const fails = (c) => run(`(function(){ try { dmClean_(${JSON.stringify(c)}); return ''; } catch (e) { return e.code; } })()`);

test('ζήτηση: οι ενέργειες γράφτηκαν (μεσίτη και πελάτη)', () => {
  assert.equal(run('typeof ACTIONS.demandCreate'), 'function');
  assert.equal(run('typeof ACTIONS.demandIList'), 'function');
  assert.equal(run('typeof PUBLIC_ACTIONS.demandSubmit'), 'function');
  assert.equal(run('typeof PUBLIC_ACTIONS.demandOpen'), 'function');
  assert.equal(run('typeof ACTIONS.demandSubmit'), 'undefined');   // ο πελάτης δεν έχει ενέργειες μεσίτη
});

test('ζήτηση: αριθμοί με τελείες, άγνωστοι όροφοι πετιούνται', () => {
  const c = clean({ priceMin: '150.000', priceMax: '250.000 €', sqmMin: '70', floors: ['1ος', 'Ρετιρέ', '99ος', '1ος'],
                    beds: '2', areas: 'Κουκάκι, Παγκράτι', parking: true, furnished: 'ναι' });
  assert.equal(c.priceMin, 150000);
  assert.equal(c.priceMax, 250000);
  assert.deepEqual(c.floors, ['1ος', 'Ρετιρέ']);
  assert.equal(c.beds, '2');
  assert.equal(c.parking, true);
  assert.equal(c.furnished, false);              // μόνο true μετράει
});

test('ζήτηση: «από» μεγαλύτερο από «έως» και λάθος έτος → σφάλμα στο σωστό πεδίο', () => {
  assert.equal(fails({ priceMin: 300000, priceMax: 200000 }), 'field:price');
  assert.equal(fails({ sqmMin: 120, sqmMax: 80 }), 'field:sqm');
  assert.equal(fails({ ppsMin: 3000, ppsMax: 2000 }), 'field:pps');
  assert.equal(fails({ yearMin: 75 }), 'field:year');
  assert.equal(fails({ yearMin: 2010, yearMax: 1990 }), 'field:year');
  assert.equal(fails({}), 'field:areas');       // εντελώς κενή φόρμα
  assert.equal(fails({ parking: true }), '');    // ένα πεδίο αρκεί
});

test('ζήτηση: ΑΦΜ / ταυτότητα σβήνονται από σημειώσεις και περιοχές', () => {
  const c = clean({ areas: 'Κυψέλη ΑΚ 123456', notes: 'ΑΦΜ 123456789, θέλω φως' });
  assert.ok(!/123456/.test(c.areas));
  assert.ok(!/123456789/.test(c.notes));
  assert.ok(/θέλω φως/.test(c.notes));
});

test('ζήτηση: σύνοψη για ειδοποίηση / iList', () => {
  const c = clean({ priceMin: 150000, priceMax: 250000, sqmMin: 70, sqmMax: 100, ppsMax: 2500, floors: ['2ος', '3ος'],
                    beds: '2', areas: 'Παγκράτι', yearMin: 1990, parking: true, furnished: true, notes: 'ασανσέρ' });
  const s = run(`dmSummary_(${JSON.stringify(c)}, 'Αγορά')`);
  assert.equal(s, 'Αγορά · 150.000 – 250.000 € · 70 – 100 τ.μ. · έως 2.500 €/τ.μ. · Όροφος: 2ος, 3ος · ' +
                  'Υπνοδωμάτια: τουλάχιστον 2 · Περιοχές: Παγκράτι · Έτος κατασκευής: από 1990 · Πάρκινγκ · Επιπλωμένο');
  const r = run(`dmSummary_(${JSON.stringify(clean({ priceMax: 900 }))}, 'Ενοικίαση')`);
  assert.equal(r, 'Ενοικίαση · έως 900 €');
  const lines = JSON.parse(run(`JSON.stringify(dmLines_(${JSON.stringify(c)}, 'Αγορά'))`));
  assert.deepEqual(lines[lines.length - 1], ['Σημειώσεις', 'ασανσέρ']);
});
