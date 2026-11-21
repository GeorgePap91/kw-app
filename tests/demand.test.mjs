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

// ── 1.25 · Λίστα «Ζητήσεις» με ψεύτικο φύλλο ────────────────
test('λίστα: μόνο του μεσίτη, χωρίς ακυρωμένες, σωστοί μετρητές, cache που σβήνει στην αλλαγή', () => {
  run(`
    var __rows = [], __cache = {};
    function __row(id, agent, st, ilist, sub) {
      var v = new Array(DEMAND.HEADERS.length).fill('');
      v[DMC.ID-1] = id; v[DMC.LEAD-1] = 'L-' + id; v[DMC.AGENT-1] = agent; v[DMC.STATUS-1] = st; v[DMC.DEAL-1] = 'Αγορά';
      v[DMC.CREATED-1] = new Date(2026, 10, 1); v[DMC.EXPIRES-1] = new Date(2099, 0, 1);
      v[DMC.SUBMITTED-1] = sub ? new Date(2026, 10, sub) : ''; v[DMC.ILIST-1] = ilist ? new Date(2026, 10, 20) : '';
      v[DMC.ANSWERS-1] = st === DM.DONE ? JSON.stringify({ areas: 'Παγκράτι' }) : '';
      v[DMC.CTX-1] = JSON.stringify({ first: 'Μαρία' });
      return v;
    }
    __rows = [__row('A', 'Γιώργος', DM.DONE, false, 5), __row('B', 'Άλλος', DM.DONE, false, 6),
              __row('C', 'Γιώργος', DM.DONE, true, 7), __row('D', 'Γιώργος', DM.SENT), __row('E', 'Γιώργος', DM.CANCELLED)];
    var __sheet = {
      getLastRow: function () { return __rows.length + 1; },
      getRange: function (r, c, nr, nc) {
        return {
          getValues: function () { return __rows.slice(r - 2, r - 2 + nr).map(function (v) { return v.slice(c - 1, c - 1 + nc); }); },
          setValues: function (vals) { vals.forEach(function (v, i) { __rows[r - 2 + i] = v; }); },
          setValue: function (x) { __rows[r - 2][c - 1] = x; },   // 2.15.1: dmSet_ γράφει μόνο το κελί του
          createTextFinder: function (q) { return { matchEntireCell: function () { return this; }, matchCase: function () { return this; },
            findAll: function () { var out = []; __rows.forEach(function (v, i) { if (String(v[c - 1]) === q) out.push({ getRow: function () { return i + 2; } }); }); return out; } }; }
        };
      }
    };
    dmSheet_ = function () { return __sheet; };
    CacheService = { getScriptCache: function () { return { get: function (k) { return __cache[k] || null; },
      put: function (k, v) { __cache[k] = v; }, remove: function (k) { delete __cache[k]; } }; } };
    sha256_ = function (s) { return 'h' + String(s).length + String(s).slice(0, 30).replace(/\\W/g, 'x'); };
    safeRow_ = function (v) { return v; };
    stamp_ = function (d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''); };
  `);
  const L = JSON.parse(run(`JSON.stringify(actDemandList_({ name: 'Γιώργος' }))`));
  assert.deepEqual(L.items.map((x) => x.id), ['C', 'A', 'D']);   // νεότερη υποβολή πρώτα, χωρίς Β (άλλου) και Ε (ακυρωμένη)
  assert.deepEqual(L.counts, { toPass: 1, passed: 1, waiting: 1, received: 2 });
  assert.equal(L.items[1].first, 'Μαρία');
  assert.deepEqual(L.items[1].lines, [['Περιοχές', 'Παγκράτι']]);
  assert.ok(run(`Object.keys(__cache).length`) === 1, 'δεν μπήκε στο cache');
  // iList από την οθόνη (με dm id): σβήνει το cache, ξένη ζήτηση απορρίπτεται
  const v = JSON.parse(run(`JSON.stringify(actDemandIList_({ name: 'Γιώργος' }, { dm: 'A', on: true }))`));
  assert.ok(v.ilist);
  assert.equal(run(`Object.keys(__cache).length`), 0);
  assert.equal(run(`(function(){ try { actDemandIList_({ name: 'Γιώργος' }, { dm: 'B', on: true }); return ''; } catch (e) { return e.message; } })()`), 'Δεν βρέθηκε η ζήτηση.');
  const L2 = JSON.parse(run(`JSON.stringify(actDemandList_({ name: 'Γιώργος' }))`));
  assert.deepEqual(L2.counts, { toPass: 0, passed: 2, waiting: 1, received: 2 });
});
