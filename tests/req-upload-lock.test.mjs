// 2.14.1 · QA W47 #6: το ανέβασμα δεν κρατά το γενικό κλείδωμα όσο γράφεται το αρχείο (reqUpload_ στο PropExtra.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world({ secondLockFails = false } = {}) {
  const lock = { held: false, calls: 0 };
  const files = [];
  const log = [];
  let uuid = 0;
  const mkFile = (name, desc) => {
    const f = { id: 'id' + files.length, name, desc: desc || '', trashed: false,
      getName: () => f.name, setName: (n) => { f.name = n; }, getDescription: () => f.desc,
      setDescription: (d) => { f.desc = d; }, isTrashed: () => f.trashed, setTrashed: (t) => { f.trashed = t; },
      getId: () => f.id, getUrl: () => 'u', getDateCreated: () => new Date(1000 + files.length), getSize: () => 1,
      getMimeType: () => 'application/pdf' };
    files.push(f);
    return f;
  };
  const folder = {
    getFiles: () => { const live = files.slice(); let i = 0; return { hasNext: () => i < live.length, next: () => live[i++] }; },
    createFile: (blob) => { log.push('createFile, κλείδωμα ' + (lock.held ? 'ΚΡΑΤΙΕΤΑΙ' : 'ελεύθερο')); return mkFile(blob.name); },
    getUrl: () => 'folder'
  };
  const ctx = {
    console: { ...console, log() {}, warn() {}, error() {} }, Date, JSON, Math, Set,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null }) },
    SpreadsheetApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
    CacheService: noop, ScriptApp: noop, Session: noop, ContentService: noop, HtmlService: noop,
    DocumentApp: noop, Logger: noop, ContactsApp: noop,
    DriveApp: { getFileById: (id) => files.find(f => f.id === id) },
    Utilities: { newBlob: (b, m, name) => ({ name }), getUuid: () => 'u' + (++uuid), formatDate: () => 'x' },
    LockService: { getScriptLock: () => ({
      waitLock() { lock.calls++; if (secondLockFails && lock.calls === 2) throw new Error('timeout'); lock.held = true; },
      releaseLock() { lock.held = false; } }) }
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'PropExtra.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  ctx.__folder = folder;
  vm.runInContext(`reqFolder_ = function () { return __folder; }; reqResult_ = function () { return 'ok'; };
                   stamp_ = function () { return 'τώρα'; };`, ctx);
  const up = () => vm.runInContext(`reqUpload_({ name: 'Μ' }, {}, {}, REQ.DOCS[0], [1], 'application/pdf', {})`, ctx);
  const base = vm.runInContext('REQ.DOCS[0].file', ctx);
  return { up, files, log, lock, base };
}

test('το createFile τρέχει ΕΞΩ από το κλείδωμα, και η αρίθμηση μένει σωστή', () => {
  const w = world();
  w.up(); w.up();
  assert.deepEqual(w.log, ['createFile, κλείδωμα ελεύθερο', 'createFile, κλείδωμα ελεύθερο']);
  assert.equal(w.lock.held, false);
  assert.deepEqual(w.files.map(f => f.name).sort(), [w.base + ' (1).pdf', w.base + ' (2).pdf']);
});

test('προσωρινό αρχείο που ανεβαίνει δεν μετρά στην αρίθμηση ενός ταυτόχρονου ανεβάσματος', () => {
  const w = world();
  w.files.length = 0;
  w.up();                                                       // «Χ.pdf»
  w.files.push({ ...w.files[0] });                              // θέση για ψεύτικο προσωρινό
  const tmp = w.files[1]; tmp.name = '~ανεβαίνει-zzz.pdf'; tmp.getName = () => tmp.name; tmp.isTrashed = () => false;
  tmp.getDescription = () => ''; tmp.id = 'tmp';
  w.up();
  const names = w.files.filter(f => f.id !== 'tmp').map(f => f.name).sort();
  assert.deepEqual(names, [w.base + ' (1).pdf', w.base + ' (2).pdf']);
});

test('αν δεν πάρει το κλείδωμα μετά το ανέβασμα: σφάλμα και το προσωρινό πάει στον κάδο', () => {
  const w = world({ secondLockFails: true });
  assert.throws(() => w.up(), /timeout/);
  assert.equal(w.files.length, 1);
  assert.equal(w.files[0].trashed, true);
});
