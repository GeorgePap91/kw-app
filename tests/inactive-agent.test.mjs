// QA w47 #2 · Ανενεργός μεσίτης δεν παίρνει email από τα πρωινά triggers ούτε από τη φόρμα ζήτησης.
// Ρίζα: pushToAgent_ γυρνά 0 για ανενεργό (δεν έχει συσκευές) και οι callers διάβαζαν το 0 ως «στείλε email».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world() {
  const mails = [];
  const pushes = [];
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, GmailApp: noop, UrlFetchApp: noop,
    Utilities: { formatDate: (d) => new Date(d).toISOString().slice(0, 10), getUuid: () => 'x-y', computeDigest: () => [1, 2, 3] },
    ScriptApp: noop, Session: noop, ContentService: noop, HtmlService: noop,
    DocumentApp: noop, Logger: noop, ContactsApp: noop,
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock: () => true }) },
    MailApp: { sendEmail: (o) => mails.push(o) },
    __pushes: pushes
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Demand.js', 'Match.js', 'Drops.js']) {
    vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  }
  const run = (s) => vm.runInContext(s, ctx);
  // Δύο μεσίτες χωρίς καμία συσκευή (άρα push = 0) και ένας Admin.
  run(`
    var __agents = [
      { name: 'Ενεργός Μεσίτης',   email: 'on@example.com',    active: true,  roles: { agent: true } },
      { name: 'Ανενεργός Μεσίτης', email: 'off@example.com',   active: false, roles: { agent: true } },
      { name: 'Διαχειριστής',      email: 'admin@example.com', active: true,  roles: { admin: true, agent: false } }
    ];
    readAgents_ = function () { return __agents; };
    sfAgent_ = function (n) { return __agents.find(function (a) { return a.name === n; }); };
    pushToAgent_ = function (a, d) { __pushes.push(a.name + ':' + d.type); return 0; };
    featureFlags_ = function () { return { newPropMatch: true, priceDrop: true }; };
    log_ = function () {};
    sha256_ = function (x) { return 'h' + x; };
    myLeads_ = function () { return []; };
    statusOf_ = function () { return ''; };
  `);
  return { run, mails, pushes };
}

const to = (w) => w.mails.map(m => m.to).sort();

test('λήξη εντολής: ο ανενεργός μεσίτης δεν παίρνει email', () => {
  const w = world();
  w.run(`readProps_ = function () { return {
    K1: { available: true, partner: 'Ενεργός Μεσίτης',   code: 'K1', street: 'Α', mandateDays: 7 },
    K2: { available: true, partner: 'Ανενεργός Μεσίτης', code: 'K2', street: 'Β', mandateDays: 7 } }; };`);
  w.run('mandateReminder()');
  assert.deepEqual(to(w), ['on@example.com']);
});

test('πρωινό πέρασμα: ο ανενεργός μεσίτης δεν μπαίνει καν στον βρόχο της σύνοψης', () => {
  const w = world();
  w.run(`readProps_ = function () { return {}; };
         newPropMatch = undefined; usageWeeklyMail = undefined; priceDropCheck = undefined;
         CONFIG.MORNING.DAYS = [0,1,2,3,4,5,6];
         readTasks_ = function () { return []; };
         myLeads_ = function () { return [{ id: 'L' }]; };
         statusOf_ = function () { return STATUS.PENDING; };
         appGet_ = function () { return ''; };`);
  w.run('morningBrief()');
  assert.deepEqual(w.pushes.sort(), ['Ενεργός Μεσίτης:today']);
});

test('νέα ακίνητα → ταίριασμα: ο ανενεργός μεσίτης δεν παίρνει email', () => {
  const w = world();
  w.run(`readProps_ = function () { return { K9: { available: true, code: 'K9' } }; };
         matchSeenGet_ = function () { return []; }; matchSeenSet_ = function () {};
         matchProfiles_ = function () { return {}; };
         matchHistGet_ = function () { return []; }; matchHistSet_ = function () {};
         matchListGet_ = function () { return []; }; matchListSet_ = function () {};
         matchMerge_ = function () { return []; };
         matchFind_ = function () { return [{ code: 'K9', key: 'k', id: 'L1', name: 'Ν', why: 'w' }]; };
         matchPushText_ = function () { return { title: 'Τ', body: 'Β' }; };`);
  w.run('newPropMatch()');
  assert.deepEqual(to(w), ['on@example.com']);
});

test('μείωση τιμής: ο ανενεργός μεσίτης δεν παίρνει email', () => {
  const w = world();
  w.run(`readProps_ = function () { return {}; };
         dropLastGet_ = function () { return {}; }; dropLastSet_ = function () {};
         dropFind_ = function () { return [
           { p: { partner: 'Ενεργός Μεσίτης',   code: 'K1' }, old: 2, now: 1 },
           { p: { partner: 'Ανενεργός Μεσίτης', code: 'K2' }, old: 2, now: 1 } ]; };
         dropClients_ = function () { return []; };
         dropListGet_ = function () { return []; }; dropListSet_ = function () {};
         matchProfiles_ = function () { return {}; };
         matchMoney_ = function (x) { return String(x); };
         appGet_ = function () { return ''; };`);
  w.run('priceDropCheck()');
  assert.deepEqual(to(w), ['on@example.com']);
});

// ── Φόρμα ζήτησης ──
function submitFor(agentName) {
  const w = world();
  const sheetRow = { v: [] };
  w.run(`
    var __row = ['DM-1', 'h', 'L1', ${JSON.stringify(agentName)}, 'K1', 'Αγορά', new Date(), new Date(Date.now() + 864e5),
                 'Στάλθηκε', 0, '', '', '', '', '{"first":"Νίκος"}', new Date()];
    dmSheet_ = function () { return {}; };
    dmOpenRow_ = function () { return { row: 2, v: __row }; };
    dmWrite_ = function (sh, r, ch) { Object.keys(ch).forEach(function (c) { r.v[c - 1] = ch[c]; }); };
  `);
  w.run(`actDemandSubmit_({ f: 'x', c: { areas: 'Κουκάκι', notes: 'μυστικό-κριτήριο', priceMax: 200000 } })`);
  return w;
}

test('ζήτηση: ενεργός μεσίτης → push (ή email αν δεν έχει συσκευή) ΜΟΝΟ σε αυτόν', () => {
  const w = submitFor('Ενεργός Μεσίτης');
  assert.deepEqual(to(w), ['on@example.com']);
});

test('ζήτηση: ανενεργός μεσίτης δεν παίρνει τίποτα· ενημερώνεται ο Admin χωρίς κριτήρια πελάτη', () => {
  const w = submitFor('Ανενεργός Μεσίτης');
  assert.ok(!to(w).includes('off@example.com'), 'ο ανενεργός πήρε email');
  assert.deepEqual(to(w), ['admin@example.com']);
  const body = w.mails[0].subject + '\n' + w.mails[0].body;
  assert.ok(/Ανενεργός Μεσίτης/.test(body), 'ο Admin πρέπει να δει για ποιον μεσίτη είναι');
  assert.ok(!/Νίκος|Κουκάκι|μυστικό|200/.test(body), 'τα στοιχεία του πελάτη δεν πρέπει να φεύγουν στο email');
});

test('2.14.1 · ελλείποντα έγγραφα: ο ανενεργός μεσίτης δεν παίρνει email', () => {
  const w = world();
  w.run(`readProps_ = function () { return {
    K1: { available: true, partner: 'Ενεργός Μεσίτης',   code: 'K1', street: 'Α' },
    K2: { available: true, partner: 'Ανενεργός Μεσίτης', code: 'K2', street: 'Β' } }; };
    readDocs_ = function () { return { K1: { docsFolder: 'f1', counts: {} }, K2: { docsFolder: 'f2', counts: {} } }; };
    normCode_ = function (c) { return c; };
    missingDocs_ = function () { return ['ΠΕΑ']; };
    fcmConfig_ = function () { return null; };
    listDocs_ = function () { throw new Error('χωρίς Drive στο τεστ'); };`);
  w.run('docsReminder()');
  assert.deepEqual(to(w), ['on@example.com']);
});
