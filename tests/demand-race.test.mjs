// QA w47 #1 · Φόρμα ζήτησης: άνοιγμα / ακύρωση την ίδια στιγμή με την υποβολή δεν σβήνουν τις απαντήσεις.
// Ψεύτικο φύλλο + ψεύτικο LockService που προσομοιώνει αμοιβαίο αποκλεισμό: ο «ταυτόχρονος πελάτης»
// (πραγματικό actDemandSubmit_) που φτάνει ενώ κρατιέται το κλείδωμα περιμένει μέχρι να ελευθερωθεί.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world() {
  const state = { held: false, pending: [], hook: null, reads: 0 };
  const store = new Map();
  const cache = { get: k => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, v) };

  // ── ψεύτικο φύλλο ──
  const rows = [[]];                       // rows[0] = κεφαλίδες (γραμμή 1)
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: (v) => { rows.push(v.slice()); },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) out.push(rows[r - 1 + i].slice(c - 1, c - 1 + nc));
          if (nc === 16 && nr === 1) { state.reads++; if (state.hook && state.reads === state.hook.at) state.hook.fn(); }
          return out;
        },
        setValues(v) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j]; },
        setValue(v) { rows[r - 1][c - 1] = v; },
        createTextFinder(s) {
          const f = { matchEntireCell: () => f, matchCase: () => f,
            findAll: () => { const o = []; for (let i = 0; i < nr; i++) if (String(rows[r - 1 + i][c - 1]) === s) o.push({ getRow: () => r + i }); return o; } };
          return f;
        }
      };
    }
  };

  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
    Utilities: noop, ScriptApp: noop, Session: noop, ContentService: noop, HtmlService: noop,
    DocumentApp: noop, Logger: noop, ContactsApp: noop,
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({
      waitLock() { state.held = true; },
      releaseLock() { state.held = false; const q = state.pending; state.pending = []; q.forEach(f => f()); },
      tryLock() { state.held = true; return true; }
    }) }
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Demand.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  const run = (s) => vm.runInContext(s, ctx);
  ctx.__sheet = sheet;
  run(`ensureSheet_ = function () { return __sheet; };
       sha256_ = function (s) { return 'h' + s; };
       log_ = function () {};
       pushToAgent_ = function () { return 1; };
       sfAgent_ = function () { return { name: 'Μεσίτης', email: '' }; };
       findMyLead_ = function (a, id) { return { id: String(id) }; };`);
  rows[0] = run('DEMAND.HEADERS');

  const TOKEN = 'a'.repeat(48);
  const addRow = (lead = 'L1') => rows.push(['DM-1', 'h' + TOKEN, lead, 'Μεσίτης', 'K1', 'Αγορά', new Date(), new Date(Date.now() + 864e5),
    'Στάλθηκε', 0, '', '', '', '', '{"first":"Νίκος"}', new Date()]);
  addRow();

  // «ταυτόχρονη υποβολή πελάτη»: πραγματικό actDemandSubmit_, με αμοιβαίο αποκλεισμό
  const submit = () => {
    const go = () => { try { run(`actDemandSubmit_({ f: '${TOKEN}', c: { areas: 'Κουκάκι', priceMax: 200000 } })`); state.submitOk = true; } catch (e) { /* π.χ. «δεν ισχύει πια» */ } };
    if (state.held) state.pending.push(go); else go();
  };
  const row = () => rows[1];
  const call = (s) => run(`(function(){ try { return JSON.stringify({ ok: ${s} }); } catch (e) { return JSON.stringify({ err: e.code || e.message }); } })()`);
  return { state, run, row, submit, call, TOKEN, rows, addRow };
}

const ST = 8, OPENS = 9, ANS = 11, SUM = 12;

for (const at of [1, 2]) {
  test(`ζήτηση race: υποβολή την ώρα που ο πελάτης ανανεώνει τη φόρμα (ανάγνωση #${at}) δεν χάνει τις απαντήσεις`, () => {
    const w = world();
    w.state.hook = { at, fn: w.submit };
    w.call(`actDemandOpen_({ f: '${w.TOKEN}' })`);
    assert.equal(w.row()[ST], 'Συμπληρώθηκε');
    assert.ok(/Κουκάκι/.test(w.row()[ANS]), 'τα κριτήρια πρέπει να έχουν μείνει');
    assert.ok(/Κουκάκι/.test(w.row()[SUM]), 'η σύνοψη πρέπει να έχει μείνει');
  });
}

test('ζήτηση race: υποβολή την ώρα της «Ακύρωσης link» δεν χάνει τις απαντήσεις', () => {
  const w = world();
  w.state.hook = { at: 1, fn: w.submit };
  w.call(`actDemandCancel_({ name: 'Μεσίτης' }, { id: 'L1' })`);
  // Ό,τι είπαμε στον πελάτη («ok») πρέπει να ισχύει στο φύλλο. Αν η υποβολή πέτυχε, τα κριτήρια μένουν.
  // Αν απορρίφθηκε (κέρδισε η ακύρωση), η φόρμα είναι «Ακυρώθηκε». ΠΟΤΕ «ok» στον πελάτη και χαμένα κριτήρια.
  const st = w.row()[ST], ans = w.row()[ANS];
  if (w.state.submitOk) { assert.equal(st, 'Συμπληρώθηκε'); assert.ok(/Κουκάκι/.test(ans), 'τα κριτήρια χάθηκαν'); }
  else { assert.equal(st, 'Ακυρώθηκε'); }
});

test('ζήτηση: η ακύρωση σε ήδη συμπληρωμένη φόρμα δεν αλλάζει τίποτα', () => {
  const w = world();
  w.submit();
  assert.equal(w.row()[ST], 'Συμπληρώθηκε');
  w.call(`actDemandCancel_({ name: 'Μεσίτης' }, { id: 'L1' })`);
  assert.equal(w.row()[ST], 'Συμπληρώθηκε');
  assert.ok(/Κουκάκι/.test(w.row()[ANS]));
});

test('ζήτηση: το άνοιγμα μετράει +1 και αλλάζει μόνο τη στήλη «Ανοίγματα»', () => {
  const w = world();
  const before = w.row().slice();
  w.call(`actDemandOpen_({ f: '${w.TOKEN}' })`);
  w.call(`actDemandOpen_({ f: '${w.TOKEN}' })`);
  const after = w.row();
  assert.equal(after[OPENS], 2);
  after.forEach((v, i) => { if (i !== OPENS && i !== 15) assert.deepEqual(v, before[i], 'στήλη ' + (i + 1)); });
});

test('ζήτηση: το «περάστηκε στο iList» δεν πειράζει τα κριτήρια', () => {
  const w = world();
  w.submit();
  const ans = w.row()[ANS];
  w.call(`actDemandIList_({ name: 'Μεσίτης' }, { id: 'L1', on: true })`);
  assert.ok(w.row()[13] instanceof Date);
  assert.equal(w.row()[ANS], ans);
  assert.equal(w.row()[ST], 'Συμπληρώθηκε');
});
