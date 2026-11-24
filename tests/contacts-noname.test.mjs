// 2.17.1 · Η λίστα επαφών δεν σπάει από επαφή χωρίς όνομα (ή με όνομα-αριθμό) που ήρθε από το κινητό.
// Ρίζα: το contactPayload_ σβήνει τα κενά πεδία (και το name: ''), μετά το actContacts_ έκανε a.name.localeCompare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

function world() {
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
  return (s) => vm.runInContext(s, ctx);
}

test('επαφές: μία χωρίς όνομα και μία με αριθμό ως όνομα δεν ρίχνουν τη λίστα', () => {
  const run = world();
  run(`
    readProps_ = function () { return {}; };
    codesOf_ = function () { return []; };
    agentIndex_ = function () { return { list: [
      { id: 'c1', name: 'Ζωή', phones: ['6900000001'], emails: [], apps: [] },
      { id: 'c2', name: '',    phones: ['6900000002'], emails: [], apps: [] },
      { id: 'c3', name: 6912345678, phones: [], emails: ['x@example.com'], apps: [] },
      { id: 'c4', name: 'Άννα', phones: ['6900000004'], emails: [], apps: [] }
    ] }; };`);
  const list = run(`actContacts_({ name: 'Μ' })`);
  assert.equal(list.length, 4);
  assert.deepEqual(Array.from(list).map((c) => c.id), ['c3', 'c4', 'c1', 'c2'], 'ελληνική σειρά, χωρίς όνομα στο τέλος');
  assert.equal(list[0].name, '6912345678', 'όνομα-αριθμός γίνεται κείμενο');
});
