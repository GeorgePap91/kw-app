// KW App · E2E σε ΠΡΑΓΜΑΤΙΚΟ Chrome με προσομοίωση κινητού (Pixel 7, αφή).
// Φορτώνει την πραγματική εφαρμογή (index.html + όλα τα .js), με ψεύτικο backend.
// Πιάνει λάθη που τα tests ανά αρχείο δεν βλέπουν (π.χ. 2.3.4: τα πρόσθετα αρχεία δεν
// έβλεπαν τα flags του app.js). Τρέχει: npm run e2e  (χρειάζεται Chrome + playwright-core).
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
const lead = (id, name, status, code) => ({ id, name, status, property: 'Διαμέρισμα 80τμ', code, phone: '6900000000', date: '13/11/2026 07:00', dateTs: now - 3600e3, source: 'Spitogatos', history: [] });
function bootData(flags) {
  return {
    session: { device: 'Android · εφαρμογή', since: '' }, roles: { agent: true, admin: true }, env: 'test', version: '1.20',
    agent: { name: 'Test Agent', smsName: 'T', phone: '', link: '', calendar: {}, prefs: {} },
    defaults: { templates: {}, colors: {} }, placeholders: [], docSlots: [], billSlots: [], callLog: {}, docsRequires: '', maxUploadMb: 10,
    mapEnabled: false, outcomes: ['Ενδιαφέρθηκε', 'Θέλει δεύτερη υπόδειξη', 'Δεν ενδιαφέρθηκε', 'Δεν ήρθε'], mandateSoon: 30, tasks: [], drive: null,
    appAccount: '', push: { ready: false, devices: 0 }, smsMode: 'manual', office: {}, forms: [], bookingUrl: '',
    statuses: ['Αναπάντητη', 'Απαντημένη', 'Δεν απάντησε', 'Υπόδειξη', 'Κλειστή'],
    leads: [lead('L1', 'Μαρία Π.', 'Αναπάντητη', 'A-12'), lead('L2', 'Γιώργος Ν.', 'Αναπάντητη', 'B-7')],
    props: [{ code: 'A-12', street: 'Ερατοσθένους 5', area: 'Παγκράτι', price: 250000, sqm: 80, title: 'Διαμέρισμα', mine: true }],
    reviews: [], flags
  };
}

async function openApp(flags = { smartMemory: true, oneTapPush: true, swipeRows: true, peekProp: true }, statusReply, boot = {}) {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'], locale: 'el-GR', serviceWorkers: 'block' });
  const sent = [], errors = [];
  await ctx.route(/script\.google\.com/, async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    sent.push(b.action);
    const data = b.action === 'bootstrap' ? { ...bootData(flags), ...boot }
      : b.action === 'status' ? (statusReply ? statusReply(b.data) : { ...lead(b.data.id, 'x', b.data.status, 'A-12') }) : {};
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
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const row = async (i = 0) => page.locator('.row.lead:visible').nth(i).boundingBox();
  const swipe = async (dx, i = 0) => {
    const b = await row(i), y = b.y + b.height / 2, x0 = b.x + b.width / 2;
    await touch('touchStart', x0, y);
    for (let k = 1; k <= 10; k++) { await touch('touchMove', x0 + (dx * k) / 10, y); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(250);
  };
  const hold = async (ms, i = 0) => {
    const b = await row(i);
    await touch('touchStart', b.x + 60, b.y + b.height / 2);
    await page.waitForTimeout(ms);
    await touch('touchEnd');
    await page.waitForTimeout(250);
  };
  return { ctx, page, sent, errors, swipe, hold };
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

test('τα πρόσθετα αρχεία βλέπουν τα flags του app.js', { skip }, async () => {
  const a = await openApp();
  assert.equal(await a.page.evaluate(() => typeof feat === 'function' && feat('swipeRows')), true);
  assert.ok(await a.page.locator('.row.lead.gst').count() > 0, 'οι γραμμές δεν πήραν σύρσιμο');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('κλειστά flags: καμία αλλαγή στη λίστα', { skip }, async () => {
  const a = await openApp({});
  assert.equal(await a.page.locator('.row.lead.gst').count(), 0);
  await a.ctx.close();
});

test('← σύρσιμο: «Δεν απάντησε» με Αναίρεση, στέλνεται μετά από 4″', { skip }, async () => {
  const a = await openApp();
  await a.page.waitForTimeout(900);
  await a.swipe(-220);
  assert.match(await a.page.locator('#toast').innerText(), /Δεν απάντησε[\s\S]*Αναίρεση/);
  assert.ok(!a.sent.includes('status'), 'στάλθηκε πριν τα 4″');
  await a.page.waitForTimeout(4300);
  assert.ok(a.sent.includes('status'), 'δεν στάλθηκε');
  await a.ctx.close();
});

test('← σύρσιμο + Αναίρεση: δεν στέλνεται', { skip }, async () => {
  const a = await openApp();
  await a.page.waitForTimeout(900);
  await a.swipe(-220);
  await a.page.locator('#toast .gst-undo').click();
  await a.page.waitForTimeout(4500);
  assert.ok(!a.sent.includes('status'));
  await a.ctx.close();
});

test('→ σύρσιμο: ανοίγει η φόρμα υπόδειξης', { skip }, async () => {
  const a = await openApp();
  await a.swipe(220);
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#showing').isHidden(), false);
  await a.ctx.close();
});

test('παρατεταμένο πάτημα: καρτέλα ακινήτου', { skip }, async () => {
  const a = await openApp();
  await a.hold(800);
  assert.equal(await a.page.locator('#propdetail').isHidden(), false);
  assert.equal(await a.page.locator('#detail').isHidden(), true, 'άνοιξε και η κλήση');
  await a.ctx.close();
});

test('«Συχνά:» εμφανίζεται στο Προφίλ με ιστορικό', { skip }, async () => {
  const a = await openApp();
  await a.page.evaluate(() => localStorage.setItem('kw_mem', JSON.stringify({ areas: { 'ΠΑΓΚΡΑΤΙ': { t: 'Παγκράτι', n: 3, at: Date.now() } } })));
  await a.page.locator('.row.lead:visible').first().click();
  await a.page.locator('#tab-d-profile').click();
  await a.page.waitForTimeout(400);
  assert.ok(await a.page.locator('.pf-mem button[data-pf-memv="Παγκράτι"]').count() > 0, 'δεν εμφανίστηκε chip');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('«💡 Νέο» εμφανίζεται μία φορά', { skip }, async () => {
  const a = await openApp();
  await a.page.waitForTimeout(900);
  assert.match(await a.page.locator('#toast').innerText(), /Νέο: σύρε/);
  assert.equal(await a.page.evaluate(() => localStorage.getItem('kw_gst_tip')), '1');
  await a.ctx.close();
});

test('FEAT-14: σύρσιμο «Δεν απάντησε» με σκάλα → «2η προσπάθεια» και (2/4) στη λίστα', { skip }, async () => {
  const a = await openApp({ swipeRows: true, callLadder: true }, (d) => ({
    ...lead(d.id, 'Μαρία Π.', d.status, 'A-12'), tries: 2, followUp: '14/11/2026 18:00',
    ladder: { tries: 2, max: 4, sms: false, done: false }
  }));
  await a.page.waitForTimeout(900);
  await a.swipe(-220);
  await a.page.waitForTimeout(4400);
  assert.match(await a.page.locator('#toast').innerText(), /2η προσπάθεια/);
  await a.page.locator('#tabs-calls [data-tab="followup"]').click();
  await a.page.waitForTimeout(300);
  assert.match(await a.page.locator('#call-list').innerText(), /Δεν απάντησε \(2\/4\)/);
  await a.ctx.close();
});

// ── 2.5 · FEAT-11 · Νέο ακίνητο → πελάτες που ταιριάζουν ──
const MT = [
  { code: 'N-1', id: 'L1', name: 'Μαρία Π.', why: 'budget 260.000 € · Παγκράτι', at: now,
    p: { code: 'N-1', title: 'Νέο διαμέρισμα', street: 'Υμηττού 10', area: 'Παγκράτι', price: 255000, sqm: 85, deal: 'Πώληση' } },
  { code: 'N-1', id: 'L2', name: 'Γιώργος Ν.', why: 'ζήτησε 250.000 € · Παγκράτι', at: now,
    p: { code: 'N-1', title: 'Νέο διαμέρισμα', street: 'Υμηττού 10', area: 'Παγκράτι', price: 255000, sqm: 85, deal: 'Πώληση' } }
];

test('FEAT-11: Σήμερα δείχνει «Νέο ακίνητο για πελάτες σου» → λίστα → Στείλε παρουσίαση', { skip }, async () => {
  const a = await openApp({ newPropMatch: true }, null, { matches: MT });
  await a.page.locator('.tab[data-view="today"]').first().click();
  await a.page.waitForTimeout(300);
  const item = a.page.locator('#today-body [data-match]');
  assert.match(await item.innerText(), /Νέο ακίνητο για πελάτες σου[\s\S]*2 πελάτες ταιριάζουν/);
  await item.click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#matchbox').isVisible(), true);
  assert.equal(await a.page.locator('#matchbox .mt-row').count(), 2);
  assert.match(await a.page.locator('#matchbox').innerText(), /budget 260\.000 € · Παγκράτι/);
  await a.page.locator('#matchbox [data-mt-send]').first().click();
  await a.page.waitForTimeout(600);
  assert.equal(await a.page.locator('#present').isVisible(), true, 'ανοίγει η παρουσίαση');
  assert.match(await a.page.locator('#pr-card').innerText(), /Νέο διαμέρισμα/);
  assert.equal(await a.page.locator('#pr-name').inputValue(), 'Μαρία');
  assert.ok(a.sent.includes('presCreate') && a.sent.includes('matchDone'), a.sent.join(','));
  assert.equal(await a.page.locator('#matchbox .mt-row').count(), 1, 'βγήκε από τη λίστα');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('FEAT-11: με κλειστό flag δεν φαίνεται τίποτα', { skip }, async () => {
  const a = await openApp({}, null, { matches: MT });
  await a.page.locator('.tab[data-view="today"]').first().click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#today-body [data-match]').count(), 0);
  await a.page.evaluate(() => window.kwMatch.open());
  assert.equal(await a.page.locator('#matchbox').isVisible(), false);
  await a.ctx.close();
});
