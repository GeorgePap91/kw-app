// 2.14.1 · Παλιά ευρήματα QA: πρωινό πέρασμα (try/catch, μία ανάγνωση εργασιών) και «για τον Νοέμβριο»
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world() {
  const pushes = [];
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, GmailApp: noop, UrlFetchApp: noop, MailApp: noop,
    Utilities: { formatDate: (d) => new Date(d).toISOString().slice(0, 10) },
    ScriptApp: noop, Session: noop, ContentService: noop, HtmlService: noop, DocumentApp: noop, Logger: noop,
    ContactsApp: noop, CacheService: noop, LockService: noop, __pushes: pushes
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Report.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  const run = (s) => vm.runInContext(s, ctx);
  run(`
    var __reads = 0;
    readAgents_ = function () { return [
      { name: 'Α Μεσίτης', active: true, roles: { agent: true } },
      { name: 'Β Μεσίτης', active: true, roles: { agent: true } } ]; };
    pushToAgent_ = function (a, d) { __pushes.push(a.name + ': ' + d.body); return 1; };
    newPropMatch = undefined; usageWeeklyMail = undefined; priceDropCheck = undefined;
    CONFIG.MORNING.DAYS = [0,1,2,3,4,5,6];
    myLeads_ = function () { return []; };
    statusOf_ = function () { return ''; };
    appGet_ = function () { return ''; };
    readTasks_ = function () { __reads++; return [
      { agent: 'Α Μεσίτης', done: '', date: '2000-01-01' },
      { agent: 'Α Μεσίτης', done: '', date: '2000-01-02' },
      { agent: 'Α Μεσίτης', done: new Date(), date: '2000-01-01' },
      { agent: 'Β Μεσίτης', done: '', date: '2999-01-01' } ]; };
  `);
  return { run, pushes };
}

test('πρωινό: σφάλμα στις λήξεις εντολών δεν σταματά τη σύνοψη', () => {
  const w = world();
  w.run(`mandateReminder = function () { throw new Error('χαλασμένο φύλλο'); };`);
  w.run('morningBrief()');
  assert.deepEqual(w.pushes, ['Α Μεσίτης: 2 εργασίες']);
});

test('πρωινό: το φύλλο «Εργασίες» διαβάζεται μία φορά, όχι ανά μεσίτη', () => {
  const w = world();
  w.run(`mandateReminder = function () {};`);
  w.run('morningBrief()');
  assert.equal(w.run('__reads'), 1);
});

test('αναφορά ιδιοκτήτη: «για τον Νοέμβριο», το θέμα μένει «Νοέμβριος»', () => {
  const w = world();
  const r = `({ title: 'Οδός 1', month: 'Νοέμβριος', calls: 3, trend: '', sources: [], showings: 0, outcomes: [], over: 0 })`;
  assert.match(w.run(`reportText_(${r}, 'Γιώργος Π.', 'Μ')`), /για τον Νοέμβριο:/);
  assert.match(w.run(`reportHtml_(${r}, '', 'Μ')`), /για τον <b>Νοέμβριο<\/b>/);
  assert.equal(w.run(`reportMonthAcc_('Μάιος (μέχρι σήμερα)')`), 'Μάιο (μέχρι σήμερα)');
  assert.equal(w.run(`reportMonthAcc_('Αύγουστος')`), 'Αύγουστο');
});
