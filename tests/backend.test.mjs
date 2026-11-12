// Tests του backend (apps-script/). Τρέχουν χωρίς Google: φορτώνουν τον κώδικα
// σε απομονωμένο περιβάλλον με ψεύτικο PropertiesService.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import vm from 'node:vm';

const DIR = new URL('../apps-script/', import.meta.url).pathname;
const has = existsSync(join(DIR, 'appsscript.json'));
const files = has ? readdirSync(DIR).filter((f) => /\.(js|gs)$/.test(f)) : [];
const src = (f) => readFileSync(join(DIR, f), 'utf8');

test('backend: σωστή σύνταξη', { skip: !has }, () => {
  for (const f of files) execFileSync(process.execPath, ['--check', join(DIR, f)], { stdio: 'pipe' });
});

test('backend: appsscript.json έγκυρο, V8, ζώνη Αθήνας', { skip: !has }, () => {
  const m = JSON.parse(src('appsscript.json'));
  assert.equal(m.runtimeVersion, 'V8');
  assert.equal(m.timeZone, 'Europe/Athens');
});

test('backend: κανένα ID αρχείου Google ή προσωπικό email μέσα στον κώδικα (δημόσιο repo)', { skip: !has }, () => {
  for (const f of files) {
    const s = src(f);
    const ids = s.match(/['"]1[A-Za-z0-9_-]{30,}['"]/g) || [];
    assert.deepEqual(ids, [], `${f}: βάλε τα IDs σε Ιδιότητες σεναρίου (prop_)`);
    const mails = (s.match(/[A-Za-z0-9._%+-]+@(gmail\.com|kwgreece\.gr)/g) || [])
      .filter((m) => !/^nikos\.p@|^nixxxx@/.test(m));            // παράδειγμα σε σχόλιο maskMail_
    assert.deepEqual(mails, [], `${f}: email σε Ιδιότητα σεναρίου`);
  }
});

test('backend: το CONFIG διαβάζει τις Ιδιότητες σεναρίου', { skip: !has }, () => {
  const props = {
    ENV: 'test', SPREADSHEET_ID: 'SHEET_X', OFFICE_EMAIL: 'office@example.com',
    SHOWING_TEMPLATE_ID: 'TPL_X', METRICS_SPREADSHEET_ID: 'MET_X'
  };
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  const ctx = {
    console, Date, JSON, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: (k) => props[k] ?? null }) },
    SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
    Utilities: noop, CacheService: noop, LockService: noop, ScriptApp: noop, Session: noop, ContentService: noop,
    HtmlService: noop, DocumentApp: noop, Logger: noop, ContactsApp: noop
  };
  vm.createContext(ctx);
  const order = ['Code.js', ...files.filter((f) => f !== 'Code.js')];
  for (const f of order) vm.runInContext(src(f), ctx, { filename: f });
  const C = vm.runInContext('CONFIG', ctx);
  assert.equal(C.SPREADSHEET_ID, 'SHEET_X');
  assert.equal(C.OFFICE.email, 'office@example.com');
  assert.equal(C.SHOWING_FORM.TEMPLATE_ID, 'TPL_X');
  assert.equal(C.METRICS.SPREADSHEET_ID, 'MET_X');
  assert.equal(C.REFERRAL.SEND_TO, 'office@example.com');   // κενό REFERRAL_SEND_TO → OFFICE_EMAIL
  assert.equal(C.ENV, 'test');
});

test('backend: το Demo σταματά πάνω σε παραγωγικό workbook', { skip: !has }, () => {
  const s = src('Demo.js');
  assert.match(s, /PROD_SPREADSHEET_IDS/);
  assert.match(s, /CONFIG\.ENV === 'prod'/);
});

test('backend: feature flags (all / admin / off / λίστα email)', { skip: !has }, () => {
  const props = { FEATURES: JSON.stringify({ a: 'all', b: 'admin', c: 'off', d: 'me@x.gr, other@x.gr', e: 'other@x.gr' }) };
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  const ctx = { console, PropertiesService: { getScriptProperties: () => ({ getProperties: () => props }) } };
  for (const k of ['SpreadsheetApp', 'DriveApp', 'Utilities', 'CacheService', 'ScriptApp', 'Session', 'HtmlService', 'ContentService', 'MailApp', 'CalendarApp', 'LockService', 'UrlFetchApp']) ctx[k] = noop;
  vm.createContext(ctx);
  vm.runInContext(src('Code.js'), ctx);
  const agent = { email: 'me@x.gr', roles: { agent: true, admin: false } };
  const admin = { email: 'boss@x.gr', roles: { agent: true, admin: true } };
  ctx.A = agent; ctx.B = admin;
  assert.equal(vm.runInContext('JSON.stringify(featureFlags_(A))', ctx), JSON.stringify({ a: true, b: false, c: false, d: true, e: false }));
  assert.equal(vm.runInContext('JSON.stringify(featureFlags_(B))', ctx), JSON.stringify({ a: true, b: true, c: false, d: false, e: false }));
});
