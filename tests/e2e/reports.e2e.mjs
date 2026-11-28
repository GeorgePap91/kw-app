// 2.19 · E2E σε πραγματικό Chrome κινητού: Έγγραφα (διόρθωση), Πορεία ακινήτου, Ροή του μήνα, «Δεν ενδιαφέρθηκε».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
let pw;
try { pw = await import('playwright-core'); } catch (e) {
  try { pw = await import('/opt/npm-tools/node_modules/playwright/index.mjs'); } catch (x) { pw = null; }
}
const skip = !pw ? 'χωρίς playwright-core' : false;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };
let server, base, browser;

const now = Date.now();
const ST = ['Αναπάντητη', 'Απαντημένη', 'Δεν απάντησε', 'Υπόδειξη', 'Κλειστή', 'Δεν ενδιαφέρθηκε'];
const lead = (id, name, status, over = {}) => ({ id, name, status, property: 'Διαμέρισμα 80τμ', code: 'A-12', phone: '6900000000', phoneIntl: '+306900000000',
  date: '13/11/2026 07:00', ts: now - 3600e3, source: 'Spitogatos', history: [], outcome: '', offer: '', showingTs: 0, ...over });

function boot(flags) {
  return {
    session: { device: 'Android · εφαρμογή', since: '' }, roles: { agent: true }, env: 'test', version: '1.28',
    agent: { name: 'Test Agent', smsName: 'T', phone: '', link: '', calendar: {}, prefs: {} },
    defaults: { templates: {}, colors: {} }, placeholders: [], callLog: {}, docsRequires: '', maxUploadMb: 10,
    docSlots: [{ key: 'pea', label: 'ΠΕΑ' }, { key: 'mandate', label: 'Εντολή' }],
    reqSlots: [{ key: 'title', label: 'Τίτλος ιδιοκτησίας' }, { key: 'e9', label: 'Ε9' }], billSlots: [],
    mapEnabled: false, outcomes: ['Ενδιαφέρθηκε', 'Θέλει δεύτερη υπόδειξη', 'Δεν ενδιαφέρθηκε', 'Δεν ήρθε'], mandateSoon: 30, tasks: [], drive: null,
    appAccount: '', push: { ready: false, devices: 0 }, smsMode: 'manual', office: {}, forms: [], bookingUrl: '', statuses: ST,
    leads: [
      lead('L1', 'Α', 'Απαντημένη'),
      lead('L2', 'Β', 'Υπόδειξη', { showingTs: now - 86400e3, outcome: 'Ενδιαφέρθηκε', offer: 'Υπογράφηκε' }),
      lead('L3', 'Γ', 'Δεν ενδιαφέρθηκε'),
      lead('L4', 'Δ', 'Υπόδειξη', { showingTs: now + 86400e3 }),
      lead('L5', 'Ε', 'Αναπάντητη')
    ],
    props: [{ code: 'A-12', street: 'Ερατοσθένους 5', area: 'Παγκράτι', price: 250000, sqm: 80, title: 'Διαμέρισμα', mine: true }],
    reviews: [], flags
  };
}

const ymNow = (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1); })();
const METRICS = {
  configured: true, emails: ['t@x.gr'], lastSent: '', formUrl: '', updated: '', groups: [{ key: 'owners', label: 'Ραντεβού με ιδιοκτήτες' }],
  metrics: [['seller1', 'owners'], ['seller2', 'owners'], ['landlord1', 'owners'], ['landlord2', 'owners'], ['exclSale', 'mandates']].map(([key, group]) => ({ key, group, label: key, sub: '' })),
  months: [{ ym: ymNow, label: 'Τρέχων μήνας', weeks: [{ label: '01 – 07', values: {} }], missing: [], values: { seller1: 6, landlord1: 4, seller2: 3, landlord2: 2, exclSale: 4 } }]
};
const DEMANDS = { counts: {}, items: [{ id: 'D1', status: 'Συμπληρώθηκε', submittedTs: now - 3600e3, ilist: '' }, { id: 'D2', status: 'Στάλθηκε', submittedTs: 0 }] };

async function openApp(flags = { reqDocs: true, demandForm: true, propNotes: true }) {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'], locale: 'el-GR', serviceWorkers: 'block' });
  const errors = [], sent = [];
  await ctx.route(/script\.google\.com/, async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    sent.push(b.action);
    const data = b.action === 'bootstrap' ? boot(flags)
      : b.action === 'metrics' ? METRICS
      : b.action === 'demandList' ? DEMANDS
      : b.action === 'docs' ? { counts: {}, docs: {}, source: {}, picks: {} }
      : b.action === 'status' ? lead(b.data.id, 'x', b.data.status) : {};
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await ctx.route(/gstatic|googleapis|firebase/, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('kw_token', 'TEST'); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.S && window.S.boot, null, { timeout: 15000 });
  await page.locator('.tab[data-view="calls"]').first().click();
  await page.waitForTimeout(300);
  return { ctx, page, errors, sent };
}

before(async () => {
  if (skip) return;
  server = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    try { const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body); }
    catch (e) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await pw.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

test('Έγγραφα: οι λίστες φαίνονται αμέσως με το πάτημα «Έγγραφα», χωρίς «Απαραίτητα»', { skip }, async () => {
  const a = await openApp();
  await a.page.evaluate(() => window.openProp('A-12'));
  await a.page.locator('#tabs-prop [data-tab="docs"]').click();
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#pd-docs-list .doc-slot').first().isVisible(), true, 'η λίστα «Για live» δεν φαίνεται');
  assert.equal(await a.page.locator('#pd-docs-list .doc-slot').count(), 2);
  // «Απαραίτητα» και πίσω, και μετά ξανά από άλλο tab
  await a.page.locator('#tabs-docs [data-tab="req"]').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#pd-req-list .doc-slot').first().isVisible(), true);
  await a.page.locator('#tabs-prop [data-tab="facts"]').click();
  await a.page.locator('#tabs-prop [data-tab="docs"]').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#pd-req-list .doc-slot').first().isVisible(), true, 'μετά από αλλαγή tab χάθηκε η λίστα');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('Πορεία ακινήτου: δίπλα στις Σημειώσεις, με ενδιαφέρθηκαν / όχι / υποδείξεις / προσφορές', { skip }, async () => {
  const a = await openApp();
  await a.page.evaluate(() => window.openProp('A-12'));
  const tabs = await a.page.locator('#tabs-prop .subtab:visible').allInnerTexts();
  const clean = tabs.map((t) => t.replace(/\s+/g, ' ').trim());
  assert.ok(clean.findIndex((t) => t.startsWith('Πορεία')) === clean.findIndex((t) => t.startsWith('Σημειώσεις')) + 1, 'η Πορεία δεν είναι δίπλα στις Σημειώσεις: ' + clean.join(' | '));
  await a.page.locator('#tabs-prop [data-tab="prog"]').click();
  await a.page.waitForTimeout(300);
  const tiles = await a.page.locator('#pd-prog-body .rp-tile').allInnerTexts();
  assert.equal(tiles.length, 4);
  const num = (i) => tiles[i].split('\n')[0].trim();
  assert.equal(num(0), '3');   // ενδιαφέρθηκαν: Απαντημένη + Υπόδειξη με «Ενδιαφέρθηκε» + Υπόδειξη που έρχεται
  assert.equal(num(1), '1');   // δεν ενδιαφέρθηκαν
  assert.equal(num(2), '2');   // υποδείξεις
  assert.equal(num(3), '1');   // προσφορές (υπογεγραμμένες)
  assert.match(await a.page.locator('#pd-prog-body .rp-sum').innerText(), /5 κλήσεις/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('Μετρήσεις: «Ροή του μήνα» με ιδιοκτήτες, κλήσεις και ζητήσεις', { skip }, async () => {
  const a = await openApp();
  await a.page.evaluate(() => window.goto('metrics'));
  await a.page.waitForSelector('#mx-body .rp-card', { timeout: 5000 });
  await a.page.waitForTimeout(500);   // οι ζητήσεις φορτώνουν αθόρυβα και ξαναζωγραφίζουν
  const cards = await a.page.locator('#mx-body .rp-card').allInnerTexts();
  assert.equal(cards.length, 2);
  const t = (c) => c.replace(/\s+/g, ' ');
  assert.match(t(cards[0]), /1ο ραντεβού[^\d]*10/);      // 6 + 4
  assert.match(t(cards[0]), /2ο ραντεβού[^\d]*(από τα 10 πρώτα)?[^\d]*5/);
  assert.match(t(cards[0]), /Αποκλειστικές[^\d]*(από τα 10 πρώτα)?[^\d]*4/);
  assert.match(t(cards[1]), /Κλήσεις[^\d]*5/);
  assert.match(t(cards[1]), /Ενδιαφέρθηκαν/);
  assert.match(t(cards[1]), /Ζητήσεις[^\d]*(που πήραμε από πελάτες)?[^\d]*1/);   // μόνο η συμπληρωμένη
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('«Δεν ενδιαφέρθηκε»: υπάρχει στις καταστάσεις της κλήσης και στέλνεται στον server', { skip }, async () => {
  const a = await openApp();
  await a.page.evaluate(() => window.showLead(window.S.leads.filter(function (l) { return l.id === 'L1'; })[0], {}));
  await a.page.waitForTimeout(400);
  const opts = await a.page.locator('#d-status-select option').allInnerTexts();
  assert.ok(opts.includes('Δεν ενδιαφέρθηκε'), 'λείπει η επιλογή: ' + opts.join(', '));
  await a.page.selectOption('#d-status-select', 'Δεν ενδιαφέρθηκε');
  await a.page.waitForTimeout(500);
  assert.ok(a.sent.includes('status'));
  assert.match(await a.page.locator('#toast').innerText(), /Δεν ενδιαφέρθηκε/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});
