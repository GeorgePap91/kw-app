// 2.18 · OpEx Φάση 0: μέτρηση χρόνων (Perf.js) και σύνδεση με doPost / triggers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

/** yyyyMMdd / yyyyMMddHH σε UTC: αρκεί για τα tests. */
function fmt(d, _tz, pattern) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  const day = x.getUTCFullYear() + p(x.getUTCMonth() + 1) + p(x.getUTCDate());
  if (pattern === 'yyyyMMddHH') return day + p(x.getUTCHours());
  if (pattern === 'yyyyMMdd') return day;
  return x.toISOString();
}

function world(props = {}) {
  const cache = new Map();
  const sp = { ...props };
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in sp ? sp[k] : null),
        getProperties: () => ({ ...sp }),
        setProperty: (k, v) => { sp[k] = String(v); },
        setProperties: (o) => { Object.assign(sp, o); },
        deleteProperty: (k) => { delete sp[k]; },
        getKeys: () => Object.keys(sp)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); },
        getAll: (keys) => Object.fromEntries(keys.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)]))
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock: () => true }) },
    Utilities: { formatDate: fmt, getUuid: () => 'x-y', computeDigest: () => [1, 2, 3] },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, GmailApp: noop, UrlFetchApp: noop,
    ScriptApp: noop, Session: noop, HtmlService: noop, DocumentApp: noop, Logger: noop,
    ContactsApp: noop, MailApp: noop,
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) })
    }
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Demand.js', 'Perf.js']) {
    vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  }
  const run = (s) => vm.runInContext(s, ctx);
  return { run, cache, sp, ctx };
}

const hourNow = () => fmt(Date.now(), '', 'yyyyMMddHH');
const hist = (w, name, hour = hourNow()) => {
  const raw = w.cache.get('perf:' + hour + ':' + name);
  return raw ? JSON.parse(raw) : null;
};

// ── Καθαρή λογική ────────────────────────────────────────────────────

test('ιστόγραμμα: κάδοι, μέσος, μέγιστο, λάθη', () => {
  const w = world();
  const h = w.run(`(function () {
    var h = null;
    [50, 120, 120, 900, 3500, 45000].forEach(function (ms, i) { h = perfAdd_(h, ms, i !== 5); });
    return h;
  })()`);
  assert.equal(h.n, 6);
  assert.equal(h.x, 45000);
  assert.equal(h.e, 1);
  assert.equal(h.s, 50 + 120 + 120 + 900 + 3500 + 45000);
  assert.deepEqual(Array.from(h.b), [1, 2, 0, 1, 0, 1, 0, 0, 0, 1]);
});

test('εκατοστημόρια: άνω όριο κάδου, όχι πάνω από το μέγιστο', () => {
  const w = world();
  const r = w.run(`(function () {
    var h = null;
    for (var i = 0; i < 90; i++) h = perfAdd_(h, 80, true);
    for (var j = 0; j < 10; j++) h = perfAdd_(h, 1500, true);
    return { p50: perfPct_(h, 0.5), p90: perfPct_(h, 0.9), p95: perfPct_(h, 0.95), empty: perfPct_(null, 0.5) };
  })()`);
  assert.equal(r.p50, 100);     // κάδος «< 100 ms»: η αναφορά λέει «το πολύ 100»
  assert.equal(r.p90, 100);
  assert.equal(r.p95, 1500);
  assert.equal(r.empty, 0);
});

test('συμπίεση: μένει κάτω από το όριο και κρατά πάντα τα triggers', () => {
  const w = world();
  const r = w.run(`(function () {
    var day = {};
    for (var i = 0; i < 200; i++) day['a:action' + i] = perfAdd_(null, 300, true);
    day['t:checkNewLeads'] = perfAdd_(null, 200, true);
    day['a:bootstrap'] = perfAdd_(perfAdd_(perfAdd_(null, 1000, true), 1000, true), 1000, true);
    var before = 0; Object.keys(day).forEach(function (k) { before += day[k].n; });
    perfCompact_(day);
    var after = 0; Object.keys(day).forEach(function (k) { after += day[k].n; });
    return { len: JSON.stringify(day).length, trig: !!day['t:checkNewLeads'], boot: !!day['a:bootstrap'],
             other: !!day['(άλλα)'], before: before, after: after };
  })()`);
  assert.ok(r.len <= 8500, 'μήκος ' + r.len);
  assert.ok(r.trig);
  assert.ok(r.boot, 'η πιο συχνή ενέργεια μένει');
  assert.ok(r.other);
  assert.equal(r.after, r.before, 'κανένα δείγμα δεν χάνεται, απλώς συγχωνεύεται');
});

test('ώρες για συγχώνευση: μόνο κλεισμένες και μετά την τελευταία', () => {
  const w = world();
  const now = Date.UTC(2026, 10, 23, 12, 30);
  const due = w.run(`perfDueHours_(${now}, '2026112309', function (ms) {
    var d = new Date(ms), p = function (n) { return ('0' + n).slice(-2); };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours());
  })`);
  assert.deepEqual(Array.from(due), ['2026112310', '2026112311']);
});

test('αναφορά: σειρά κατά συνολικό χρόνο, χρόνος triggers/ημέρα και % ορίου', () => {
  const w = world();
  const r = w.run(`(function () {
    var t = null; for (var i = 0; i < 1440; i++) t = perfAdd_(t, 1000, true);   // 24 λεπτά
    var a = null; for (var j = 0; j < 100; j++) a = perfAdd_(a, 600, true);
    return perfSummary_({ '20261121': { 't:checkNewLeads': t, 'a:bootstrap': a },
                          '20261122': { 't:checkNewLeads': JSON.parse(JSON.stringify(t)) } });
  })()`);
  assert.equal(r.days, 2);
  assert.equal(r.rows[0].name, 't:checkNewLeads');
  assert.equal(r.rows[0].perDay, 1440);
  assert.equal(r.triggerMinPerDay, 24);
  assert.equal(r.triggerBudgetPct.gmail, 26.7);
  assert.equal(r.triggerBudgetPct.workspace, 6.7);
});

test('όνομα μέτρησης: μόνο ασφαλείς χαρακτήρες, με όριο μήκους', () => {
  const w = world();
  const n = w.run(`perfName_('a:<script>Γιώργος 69')`);
  assert.match(n, /^[\w:.\-]+$/);
  assert.ok(n.startsWith('a:_script_') && n.endsWith('69'));
  assert.equal(w.run(`perfName_('x'.repeat(200))`).length, 60);
});

// ── Με (ψεύτικες) υπηρεσίες Google ─────────────────────────────────

test('doPost: μετρά γνωστή ενέργεια και τον έλεγχο συνεδρίας', () => {
  const w = world();
  w.run(`session_ = function () { return null; };`);
  w.run(`doPost({ postData: { contents: JSON.stringify({ action: 'bootstrap', t: 'x' }) } })`);
  assert.equal(hist(w, 'a:bootstrap').n, 1);
  assert.equal(hist(w, 's:session').n, 1);
});

test('doPost: άγνωστο όνομα ενέργειας γράφεται ως unknown (δεν γεμίζει η cache με ό,τι στείλει κάποιος)', () => {
  const w = world();
  w.run(`session_ = function () { return null; };`);
  w.run(`doPost({ postData: { contents: JSON.stringify({ action: 'drop_table_${'x'.repeat(30)}', t: 'x' }) } })`);
  w.run(`doPost({ postData: { contents: 'όχι json' } })`);
  assert.equal(hist(w, 'a:unknown').n, 2);
  assert.equal(hist(w, 'a:unknown').e, 1, 'το χαλασμένο αίτημα μετράει ως λάθος');
  const idx = JSON.parse(w.cache.get('perf:' + hourNow() + ':idx'));
  assert.ok(!idx.some((n) => n.includes('drop_table')));
});

test('doPost: σφάλμα ενέργειας μετράει ως λάθος και η απάντηση μένει ίδια', () => {
  const w = world();
  w.run(`session_ = function () { return { agent: { name: 'Μ', active: true, roles: { agent: true } } }; };
         ACTIONS.boom = function () { throw new Error('κάτι'); };`);
  const res = w.run(`doPost({ postData: { contents: JSON.stringify({ action: 'boom', t: 'x' }) } })`);
  assert.deepEqual(JSON.parse(res.text), { ok: false, error: 'κάτι', code: '' });
  assert.equal(hist(w, 'a:boom').e, 1);
});

test('checkNewLeads: η διαδρομή «τίποτα νέο» μετριέται χωριστά', () => {
  const w = world();
  w.run(`checkNewLeadsRun_ = function () { return 'skip'; };`);
  w.run(`checkNewLeads(); checkNewLeads();`);
  assert.equal(hist(w, 't:checkNewLeads:skip').n, 2);
  assert.equal(hist(w, 't:checkNewLeads'), null);
});

test('trigger με σφάλμα: καταγράφεται ως λάθος και το σφάλμα περνά προς τα πάνω (για το email αποτυχίας της Google)', () => {
  const w = world();
  w.run(`morningBriefRun_ = function () { throw new Error('πρωινό'); };`);
  assert.throws(() => w.run('morningBrief()'), /πρωινό/);
  assert.equal(hist(w, 't:morningBrief').e, 1);
});

test('PERF=off: καμία μέτρηση', () => {
  const w = world({ PERF: 'off' });
  w.run(`perfRecord_('a:bootstrap', 100, true)`);
  assert.equal(w.cache.size, 0);
});

test('flush: οι κλεισμένες ώρες περνούν στο ημερήσιο σύνολο, μία φορά', () => {
  const w = world();
  const prev = fmt(Date.now() - 3600000, '', 'yyyyMMddHH');
  w.cache.set('perf:' + prev + ':idx', JSON.stringify(['a:bootstrap']));
  w.cache.set('perf:' + prev + ':a:bootstrap', JSON.stringify(w.run('perfAdd_(null, 700, true)')));
  assert.match(w.run('perfFlush_()'), /^flushed:/);
  const day = JSON.parse(w.sp['PERF_DAY:' + prev.slice(0, 8)]);
  assert.equal(day['a:bootstrap'].n, 1);
  assert.equal(w.sp.PERF_FLUSHED, prev);

  // Δεύτερη κλήση την ίδια ώρα: δεν ξαναδιαβάζει, δεν διπλομετρά.
  assert.equal(w.run('perfFlush_()'), 'done');
  w.cache.delete('perf:checked');
  w.run('perfFlush_()');
  assert.equal(JSON.parse(w.sp['PERF_DAY:' + prev.slice(0, 8)])['a:bootstrap'].n, 1);
});

test('flush: σβήνει ημέρες εκτός διατήρησης', () => {
  const w = world({ 'PERF_DAY:20200101': '{}', 'PERF_DAY:29991231': '{}' });
  w.run('perfFlush_()');
  assert.ok(!('PERF_DAY:20200101' in w.sp));
  assert.ok('PERF_DAY:29991231' in w.sp);
});

test('τα νούμερα απόδοσης δεν εκτίθενται σε κανέναν ρόλο του πελάτη (ούτε Admin)', () => {
  const w = world();
  const exposed = w.run(`[ACTIONS, ADMIN_ACTIONS, COACH_ACTIONS, PUBLIC_ACTIONS, SHARED_ACTIONS]
    .some(function (m) { return Object.keys(m).some(function (k) { return /perf/i.test(k); }); })`);
  assert.equal(exposed, false);
});

test('χωρίς το Perf.js (μόνο Code.js) όλα τρέχουν κανονικά', () => {
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}) }) },
    CacheService: noop, LockService: noop, Utilities: noop,
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, GmailApp: noop, UrlFetchApp: noop,
    ScriptApp: noop, Session: noop, HtmlService: noop, DocumentApp: noop, Logger: noop,
    ContactsApp: noop, MailApp: noop, ContentService: noop
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(DIR + 'Code.js', 'utf8'), ctx);
  vm.runInContext(`formReminderRun_ = function () { return 42; };`, ctx);
  assert.equal(vm.runInContext('formReminder()', ctx), 42);
});
