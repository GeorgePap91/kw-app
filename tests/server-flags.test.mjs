// QA w47 #4 · Οι νέες λειτουργίες (Φόρμα ζήτησης, Σημειώσεις ακινήτου, Απαραίτητα έγγραφα, Marketing)
// ελέγχονται από τα feature flags ΚΑΙ στον server, όχι μόνο στο κινητό. Σειρά κυκλοφορίας: admin → 3 μεσίτες → όλοι.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world(features) {
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => (features ? { FEATURES: JSON.stringify(features) } : {}),
      getProperty: (k) => (k === 'FEATURES' && features ? JSON.stringify(features) : null) }) },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
    Utilities: noop, CacheService: noop, LockService: noop, ScriptApp: noop, Session: noop, ContentService: noop,
    HtmlService: noop, DocumentApp: noop, Logger: noop, ContactsApp: noop
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Demand.js', 'PropExtra.js', 'Marketing.js']) {
    vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  }
  const run = (s) => vm.runInContext(s, ctx);
  run(`json_ = function (o) { return o; };
       var __agents = {
         admin: { name: 'Α', email: 'admin@example.com', active: true, roles: { admin: true, agent: true } },
         plain: { name: 'Μ', email: 'plain@example.com', active: true, roles: { agent: true } },
         third: { name: 'Τ', email: 'third@example.com', active: true, roles: { agent: true } } };
       session_ = function (t) { return { agent: __agents[t] }; };
       var __ran = [];
       ['demandStatus','demandCreate','demandCancel','demandIList','pnotes','pnoteAdd','pnoteDel','mktGet','mktSave','mktAsset','mktLog']
         .forEach(function (n) { ACTIONS[n] = function () { __ran.push(n); return 'ran'; }; });`);
  const call = (who, action) => run(`(function () { __ran.length = 0;
      var r = doPost({ postData: { contents: JSON.stringify({ t: '${who}', action: '${action}', data: {} }) } });
      return JSON.stringify({ r: r, ran: __ran.slice() }); })()`);
  return { run, call: (who, action) => JSON.parse(call(who, action)) };
}

const GATED = {
  demandForm: ['demandStatus', 'demandCreate', 'demandIList'],
  propNotes: ['pnotes', 'pnoteAdd', 'pnoteDel'],
  marketing: ['mktGet', 'mktSave', 'mktAsset', 'mktLog']
};

test('η Φόρμα ζήτησης έχει προεπιλογή «admin» (όχι ανοιχτή σε όλους)', () => {
  const w = world(null);
  assert.equal(w.run('FEATURE_DEFAULTS.demandForm'), 'admin');
  assert.equal(w.run(`featureFlags_(__agents.admin).demandForm`), true);
  assert.equal(w.run(`featureFlags_(__agents.plain).demandForm`), false);
});

for (const [flag, actions] of Object.entries(GATED)) {
  for (const action of actions) {
    test(`flag «${flag}» · ${action}: ο απλός μεσίτης μπλοκάρεται στον server, ο Admin περνά`, () => {
      const w = world({ marketing: 'admin' });          // στο Marketing δεν υπάρχει προεπιλογή: το δίνει η ιδιότητα FEATURES
      const plain = w.call('plain', action);
      assert.equal(plain.r.ok, false);
      assert.equal(plain.r.code, 'flag');
      assert.deepEqual(plain.ran, [], 'η ενέργεια δεν έπρεπε να τρέξει');
      const admin = w.call('admin', action);
      assert.equal(admin.r.ok, true);
      assert.deepEqual(admin.ran, [action]);
    });
  }
}

test('flag σε λίστα email: περνά ο 3ος μεσίτης, όχι ο απλός', () => {
  const w = world({ demandForm: 'third@example.com', marketing: 'third@example.com', propNotes: 'third@example.com' });
  for (const a of ['demandCreate', 'pnoteAdd', 'mktGet']) {
    assert.equal(w.call('third', a).r.ok, true, a);
    assert.equal(w.call('plain', a).r.code, 'flag', a);
  }
});

test('flag «all»: όλοι οι μεσίτες περνούν', () => {
  const w = world({ demandForm: 'all' });
  assert.equal(w.call('plain', 'demandCreate').r.ok, true);
});

test('η ακύρωση link ζήτησης δεν κλειδώνει ποτέ πίσω από flag (πρέπει να κλείνει link που έφυγε σε πελάτη)', () => {
  const w = world(null);
  const r = w.call('plain', 'demandCancel');
  assert.equal(r.r.ok, true);
  assert.deepEqual(r.ran, ['demandCancel']);
});

test('Απαραίτητα έγγραφα (set req): μπλοκάρεται στον server χωρίς flag· τα απλά έγγραφα δεν επηρεάζονται', () => {
  const w = world(null);                                // προεπιλογή reqDocs: admin
  w.run(`myProp_ = function () { return { code: 'K1' }; };
         propFolders_ = function () { return {}; };
         docsResult_ = function (a, p, f, set) { return { set: set }; };`);
  const code = (who, set) => w.run(`(function () { try { return JSON.stringify(actDocs_(__agents.${who}, { code: 'K1', set: '${set}' })); } catch (e) { return e.code; } })()`);
  assert.equal(code('plain', 'req'), 'flag');
  assert.equal(code('admin', 'req'), '{"set":"req"}');
  assert.equal(code('plain', 'live'), '{"set":"live"}');
  assert.equal(code('plain', 'bill'), '{"set":"bill"}');
  // ανέβασμα / σβήσιμο του ίδιου set: πρώτο πράγμα που ελέγχεται είναι το flag
  const up = (fn, who) => w.run(`(function () { try { ${fn}(__agents.${who}, { code: 'K1', set: 'req' }); return 'ran'; } catch (e) { return e.code || 'other'; } })()`);
  assert.equal(up('actUpload_', 'plain'), 'flag');
  assert.equal(up('actDocDelete_', 'plain'), 'flag');
});
