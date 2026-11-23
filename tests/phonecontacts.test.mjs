// 2.17 · Επαφές κινητού: αρχεία, έλεγχος διπλών, ταίριασμα ακινήτου, κανόνες server και Βοηθού
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const L = require('../phonecontacts.js');

// ── Κινητό ──
const PROPS = [{ code: '4411', street: 'Βαρίκα 13' }, { code: '2564590', street: 'Υμηττού 10' },
               { code: '7001', street: 'Υμηττού 12' }, { code: '7002', street: 'Βαρίκα 13' }];

test('ετικέτα με κωδικό και οδό → το σωστό ακίνητο, ακόμα κι αν η οδός είναι σε δύο', () => {
  assert.equal(L.propMatch('4411 Βαρίκα 13', PROPS).code, '4411');
  assert.equal(L.propMatch('7002 βαρικα 13', PROPS).code, '7002');
});

test('ετικέτα μόνο με οδό: μοναδική → ταιριάζει · σε δύο ακίνητα → ρωτάει', () => {
  assert.equal(L.propMatch('13 υμηττου', [PROPS[1], PROPS[2]]), null);
  assert.equal(L.propMatch('Υμηττού 10', PROPS).code, '2564590');
  assert.ok(L.propMatch('Βαρίκα 13', PROPS).ambig.length === 2);
  assert.equal(L.propMatch('Οικογένεια', PROPS), null);
});

test('CSV της Google: ονόματα, πολλά τηλέφωνα με :::, ετικέτες χωρίς τις συστημικές', () => {
  const csv = '﻿First Name,Middle Name,Last Name,Labels,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value\n' +
    'Μαρία,,Παπαδάκη,4411 Βαρίκα 13 ::: * myContacts,* ,Maria@Ex.gr,Mobile,+30 697 123 4567 ::: 210 1234567\n' +
    '"Νίκος ""Νικ""",,Γεωργίου,* myContacts,,,Mobile,0030 6981112222\n';
  const r = L.parseFile('contacts.csv', csv);
  assert.equal(r.src, 'Google');
  assert.equal(r.list.length, 2);
  assert.deepEqual(r.list[0], { name: 'Μαρία Παπαδάκη', phones: ['6971234567', '2101234567'], emails: ['maria@ex.gr'], labels: ['4411 Βαρίκα 13'] });
  assert.equal(r.list[1].name, 'Νίκος "Νικ" Γεωργίου');
  assert.deepEqual(r.list[1].labels, []);
});

test('vCard iPhone (item1., διπλωμένες γραμμές) και Android (quoted-printable)', () => {
  const ios = 'BEGIN:VCARD\r\nVERSION:3.0\r\nPRODID:-//Apple Inc.//iPhone OS 17//EN\r\nN:Παπαδάκη;Μαρία;;;\r\nFN:Μαρία Παπαδάκη\r\n' +
    'item1.TEL;type=CELL:+30 697 12\r\n 3 4567\r\nitem1.X-ABLabel:κινητό\r\nEMAIL;type=INTERNET:maria@ex.gr\r\nEND:VCARD\r\n';
  const r = L.parseFile('4411 Βαρίκα 13.vcf', ios);
  assert.equal(r.src, 'iPhone');
  assert.equal(r.hint, '4411 Βαρίκα 13');
  assert.deepEqual(r.list[0].phones, ['6971234567']);
  const qp = 'BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=CE=93=CE=B5=CF=89=CF=81=CE=B3=CE=AF=CE=BF=CF=85;=CE=9D=CE=AF=CE=BA=CE=BF=CF=82;;;\n' +
    'TEL;CELL:6981112222\nCATEGORIES:4411 Βαρίκα 13,myContacts\nEND:VCARD\n';
  const a = L.parseFile('x.vcf', qp).list[0];
  assert.equal(a.name, 'Νίκος Γεωργίου');
  assert.deepEqual(a.labels, ['4411 Βαρίκα 13']);
});

test('επαφή χωρίς τηλέφωνο και email δεν περνά', () => {
  assert.equal(L.parseFile('a.vcf', 'BEGIN:VCARD\nFN:Κανείς\nEND:VCARD').list.length, 0);
});

const MINE = [
  { id: 'K1', name: 'Μαρία Παπαδάκη', phones: ['6971234567'], emails: ['maria@ex.gr'] },
  { id: 'C2', name: 'Γιώργος Λάμπρου', phones: ['6900000002'], emails: [] },
  { id: 'C3', name: 'Ελένη Κ.', phones: [], emails: ['eleni@ex.gr'] },
  { id: 'C4', name: 'Πέτρος', phones: ['6900000004'], emails: [] }
];
const C = (o) => ({ name: '', phones: [], emails: [], labels: [], ...o });

test('έλεγχος διπλών: νέα / ίδια / μάλλον ίδια / σύγκρουση', () => {
  const { rows } = L.classify([
    C({ name: 'Κώστας Νέος', phones: ['6999999999'] }),
    C({ name: 'Maria Papadaki', phones: ['6971234567'] }),            // ίδιο τηλέφωνο, όνομα με λατινικά → ίδια
    C({ name: 'Σοφία Άλλη', phones: ['6900000002'] }),                // ίδιο τηλέφωνο, άλλο όνομα → ρωτάμε
    C({ name: 'Χ', phones: ['6900000004'], emails: ['eleni@ex.gr'] }), // τηλέφωνο σε C4, email σε C3
    C({ phones: [], emails: ['MARIA@ex.gr'.toLowerCase()] })           // χωρίς όνομα → ίδια
  ], MINE);
  assert.deepEqual(rows.map(r => r.status), ['new', 'same', 'maybe', 'conflict', 'same']);
  assert.equal(rows[1].target.id, 'K1');
  assert.equal(rows[3].target2.id, 'C3');
});

test('ίδιος άνθρωπος δύο φορές στο αρχείο → μία γραμμή με όλα τα στοιχεία', () => {
  const r = L.classify([C({ name: 'Α', phones: ['6911111111'], labels: ['4411'] }),
                        C({ phones: ['6911111111'], emails: ['a@x.gr'], labels: ['7001'] })], []);
  assert.equal(r.rows.length, 1);
  assert.equal(r.dupFile, 1);
  assert.deepEqual(r.rows[0].emails, ['a@x.gr']);
  assert.deepEqual(r.rows[0].labels, ['4411', '7001']);
});

test('τι στέλνεται: «μάλλον ίδια» χωρίς απόφαση → για μετά', () => {
  assert.equal(L.toItem({ status: 'maybe', target: { id: 'C2' }, name: '', phones: [], emails: [] }).action, 'later');
  assert.deepEqual(L.toItem({ status: 'maybe', act: 'merge', target: { id: 'C2' }, name: '', phones: [], emails: [], codes: ['4411'] }),
    { name: '', phones: [], emails: [], codes: ['4411'], action: 'merge', target: 'C2' });
  assert.equal(L.toItem({ status: 'new', name: '', phones: [], emails: [] }).action, 'auto');
});

test('vCard προς το κινητό: ελληνικά τηλέφωνα με +30, ομάδες, escape', () => {
  const v = L.vcard([{ name: 'Μαρία Παπαδάκη', phones: ['6971234567'], emails: ['m@x.gr'], groups: ['KW Πελάτες', '4411 Βαρίκα 13'], note: 'a,b' }]);
  assert.match(v, /TEL;TYPE=CELL:\+306971234567\r\n/);
  assert.match(v, /N:Παπαδάκη;Μαρία;;;/);
  assert.match(v, /CATEGORIES:KW Πελάτες,4411 Βαρίκα 13/);
  assert.match(v, /NOTE:a\\,b/);
  // και ξαναδιαβάζεται από τον δικό μας parser
  assert.deepEqual(L.parseFile('x.vcf', v).list[0].labels, ['KW Πελάτες', '4411 Βαρίκα 13']);
});

// ── Server ──
const DIR = new URL('../apps-script/', import.meta.url).pathname;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
const ctx = {
  console: { ...console, log() {}, warn() {} }, Date, JSON, Math, Set,
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}), getProperty: () => null, setProperty() {}, setProperties() {} }) },
  SpreadsheetApp: noop, DriveApp: noop, CalendarApp: noop, MailApp: noop, GmailApp: noop, UrlFetchApp: noop,
  Utilities: noop, CacheService: noop, LockService: noop, ScriptApp: noop, Session: noop, ContentService: noop,
  HtmlService: noop, DocumentApp: noop, Logger: noop, ContactsApp: noop
};
vm.createContext(ctx);
for (const f of ['Code.js', 'PhoneContacts.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
const run = (s) => vm.runInContext(s, ctx);

test('server: οι ενέργειες μπήκαν, πίσω από το flag, και του Βοηθού χωρίς συσκευή', () => {
  assert.equal(run("typeof ACTIONS.pcImport"), 'function');
  assert.equal(run("FLAG_ACTIONS.pcImport"), 'phoneContacts');
  assert.equal(run("typeof PUBLIC_ACTIONS.pcPull"), 'function');
  assert.equal(run("typeof ACTIONS.pcPull"), 'undefined');
});

test('server: «νέα» με ίδιο τηλέφωνο ΚΑΙ email δεν γίνεται δεύτερη επαφή', () => {
  const r = run(`(() => {
    const m1 = { id: 'K1' }, m2 = { id: 'C2' };
    const x = { byPhone: { '6971234567': m1, '6900000002': m2 }, byEmail: { 'maria@ex.gr': m1, 'other@ex.gr': m2 } };
    const it = (p, e) => pcClean_({ phones: p, emails: e });
    return [
      pcDecide_(x, it(['+30 697 1234567'], ['MARIA@ex.gr']), 'separate', ''),
      pcDecide_(x, it(['6999999999'], []), 'auto', ''),
      pcDecide_(x, it(['6971234567'], []), 'auto', ''),
      pcDecide_(x, it(['6971234567'], ['other@ex.gr']), 'auto', ''),
      pcDecide_(x, it(['6971234567'], ['new@ex.gr']), 'separate', ''),
      pcDecide_(x, it([], []), 'merge', '')
    ];
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), [
    { op: 'merge', target: 'K1' }, { op: 'new' }, { op: 'merge', target: 'K1' },
    { op: 'later', why: 'Το τηλέφωνο είναι σε μία επαφή και το email σε άλλη' }, { op: 'new' },
    { op: 'later', why: 'Χωρίς επαφή για συγχώνευση' }
  ]);
});

test('server: συγχώνευση προσθέτει, δεν σβήνει · σε επαφή CRM δεν αγγίζει τα κύρια στοιχεία', () => {
  const r = run(`(() => {
    const it = pcClean_({ name: 'Νέο Όνομα', phones: ['6971234567', '6955555555'], emails: ['x@y.gr'], codes: ['4411', '4411'] });
    const app = { name: '', phone: '', email: '', xphones: [], xemails: [], codes: ['7001'] };
    const crm = { name: 'CRM', phone: '6971234567', email: 'old@y.gr', xphones: [], xemails: [], codes: [] };
    const c1 = pcMergeInto_(app, it, false), c2 = pcMergeInto_(crm, it, true), c3 = pcMergeInto_(crm, it, true);
    return { app, crm, c1, c2, c3 };
  })()`);
  const o = JSON.parse(JSON.stringify(r));
  assert.deepEqual(o.app, { name: 'Νέο Όνομα', phone: '6971234567', email: 'x@y.gr', xphones: ['6955555555'], xemails: [], codes: ['7001', '4411'] });
  assert.equal(o.crm.name, 'CRM');
  assert.equal(o.crm.phone, '6971234567');
  assert.deepEqual(o.crm.xphones, ['6955555555']);
  assert.deepEqual(o.crm.xemails, ['x@y.gr']);
  assert.equal(o.c3, false, 'δεύτερη φορά: καμία αλλαγή');
});

test('server: όνομα ομάδας και αποτύπωμα', () => {
  assert.equal(run("pcGroupName_('4411', 'Βαρίκα 13')"), '4411 Βαρίκα 13');
  assert.equal(run("pcGroupName_('4411', '')"), '4411');
  assert.equal(run("pcHashText_({ name: 'Α', phones: ['1'], emails: [], groups: ['g'] })"), 'Α|1||g');
});

// ── Βοηθός επαφών ──
const hctx = { console: { ...console, log() {}, warn() {} }, JSON, Date, Math };
vm.createContext(hctx);
vm.runInContext(readFileSync(new URL('../contacts-helper/Code.js', import.meta.url), 'utf8'), hctx, { filename: 'helper.js' });
const hrun = (s) => JSON.parse(JSON.stringify(vm.runInContext(s, hctx)));

test('Βοηθός: υπάρχουσα επαφή → ενημέρωση, ποτέ δεύτερη · σύγκρουση → τίποτα', () => {
  const r = hrun(`(() => {
    const idx = index_([
      { resourceName: 'people/1', phoneNumbers: [{ value: '+30 697 123 4567' }], emailAddresses: [] },
      { resourceName: 'people/2', phoneNumbers: [], emailAddresses: [{ value: 'Eleni@ex.gr' }] }
    ]);
    return [plan_(idx, { phones: ['6971234567'], emails: [] }).kind,
            plan_(idx, { phones: ['6999999999'], emails: ['eleni@ex.gr'] }).kind,
            plan_(idx, { phones: ['6971234567'], emails: ['eleni@ex.gr'] }).kind,
            plan_(idx, { phones: ['6999999999'], emails: [] }).kind];
  })()`);
  assert.deepEqual(r, ['upd', 'upd', 'conflict', 'new']);
});

test('Βοηθός: συμπληρώνει μόνο ό,τι λείπει, το όνομα δεν αλλάζει', () => {
  const f = hrun(`fill_({ phoneNumbers: [{ value: '1' }], emailAddresses: [] }, { phones: ['6971234567'], emails: ['a@b.gr'] })`);
  assert.deepEqual(f, { emailAddresses: [{ value: 'a@b.gr' }] });
  const p = hrun(`newPerson_({ name: 'Μαρία Παπαδάκη', phones: ['6971234567'], emails: [], note: 'KW App · 4411' }, ['contactGroups/a'])`);
  assert.deepEqual(p.names, [{ givenName: 'Μαρία', familyName: 'Παπαδάκη' }]);
  assert.equal(p.phoneNumbers[0].value, '+306971234567');
  assert.equal(p.memberships[0].contactGroupMembership.contactGroupResourceName, 'contactGroups/a');
});

test('κωδικός με παύλα («A-12») και κωδικός που είναι μέρος άλλου (4411 ≠ 44110)', () => {
  const P = [{ code: 'A-12', street: 'Ερατοσθένους 5' }, { code: '44110', street: 'Αλκμάνος 2' }];
  assert.equal(L.propMatch('A-12 Ερατοσθένους 5', P).code, 'A-12');
  assert.equal(L.propMatch('a12', P).code, 'A-12');
  assert.equal(L.propMatch('4411', P), null);
});
