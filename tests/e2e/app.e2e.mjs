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
const lead = (id, name, status, code) => ({ id, name, status, property: 'Διαμέρισμα 80τμ', code, phone: '6900000000', phoneIntl: '+306900000000', date: '13/11/2026 07:00', dateTs: now - 3600e3, source: 'Spitogatos', history: [] });
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

async function openApp(flags = { smartMemory: true, oneTapPush: true, swipeRows: true, peekProp: true }, statusReply, boot = {}, replies = {}) {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'], locale: 'el-GR', serviceWorkers: 'block' });
  const sent = [], errors = [];
  await ctx.route(/script\.google\.com/, async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    sent.push(b.action);
    const data = replies[b.action] ? replies[b.action](b.data) : b.action === 'bootstrap' ? { ...bootData(flags), ...boot }
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

// ── 2.6 · FEAT-15 · «Πάρε σήμερα αυτούς» ──
const cold = (id, name, level, days) => ({ ...lead(id, name, 'Απαντημένη', 'A-12'), phone: '69000000' + id.slice(-2).padStart(2, '0'),
  dateTs: now - days * 864e5, ts: now - days * 864e5, pfLevel: level, pfWant: 'Παγκράτι έως 250.000 €' });

test('FEAT-15: πελάτες που κρυώνουν — Θερμοί πρώτα, «Όχι τώρα» τον κρύβει', { skip }, async () => {
  const a = await openApp({ coolingClients: true }, null, { leads: [
    cold('C01', 'Χλιαρός Παλιός', 'Χλιαρός', 20), cold('C02', 'Θερμός Πελάτης', 'Θερμός', 9),
    cold('C03', 'Φρέσκος', 'Θερμός', 2), cold('C04', 'Κρύος', 'Κρύος', 30)] });
  await a.page.locator('.tab[data-view="today"]').first().click();
  await a.page.waitForTimeout(300);
  const rows = a.page.locator('#today-body .cool-list .mt-row');
  assert.equal(await rows.count(), 2);
  assert.match(await rows.first().innerText(), /Θερμός Πελάτης[\s\S]*Θερμός · 9 ημέρες χωρίς επαφή · ψάχνει Παγκράτι/);
  await a.page.locator('#today-body [data-cool-skip="C02"]').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#today-body .cool-list .mt-row').count(), 1);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// ── 2.6 · FEAT-12 · Μείωση τιμής ──
test('FEAT-12: «Έπεσε η τιμή» → λίστα → έτοιμο SMS με παλιά/νέα τιμή → Έγινε', { skip }, async () => {
  const drops = [{ code: 'A-12', title: 'Ερατοσθένους 5', area: 'Παγκράτι', deal: 'Πώληση', old: 250000, now: 230000, at: now,
    clients: [{ id: 'L1', why: 'budget 235.000 € · τώρα το καλύπτει', fits: true }] }];
  const a = await openApp({ priceDrop: true }, null, { drops });
  await a.page.locator('.tab[data-view="today"]').first().click();
  await a.page.waitForTimeout(300);
  const item = a.page.locator('#today-body [data-drop]');
  assert.match(await item.innerText(), /Έπεσε η τιμή · Ερατοσθένους 5[\s\S]*1 πελάτης να ενημερώσεις/);
  await item.click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#dropbox').isVisible(), true);
  const href = decodeURIComponent(await a.page.locator('#dropbox a[href^="sms:"]').getAttribute('href'));
  assert.match(href, /Καλησπέρα Μαρία, καλά νέα: η τιμή του ακινήτου «Ερατοσθένους 5» \(Παγκράτι\) έπεσε από 250\.000 € σε 230\.000 €/);
  await a.page.locator('#dropbox [data-dr-done]').click();
  await a.page.waitForTimeout(500);
  assert.ok(a.sent.includes('dropDone'));
  assert.equal(await a.page.locator('#today-body [data-drop]').count(), 0);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// ── 2.6 · FEAT-13 · Αναφορά ιδιοκτήτη ──
test('FEAT-13: καρτέλα ακινήτου → Αναφορά ιδιοκτήτη → προεπισκόπηση → αποστολή', { skip }, async () => {
  const report = { title: 'Ερατοσθένους 5', code: 'A-12', month: 'Οκτώβριος', calls: 7, trend: '+3 από τον προηγούμενο μήνα',
    sources: [{ name: 'Spitogatos', n: 5 }, { name: 'XE', n: 2 }], showings: 2, outcomes: [{ name: 'Δεν ενδιαφέρθηκε', n: 2 }], over: 3, price: 250000 };
  const a = await openApp({ ownerReport: true }, null, {}, {
    ownerReport: () => ({ report, text: 'Καλησπέρα…', hasEmail: true, emailHint: 'ni***@gmail.com', quota: 90, quotaLow: false }),
    ownerReportSend: () => ({ sent: true, to: 'ni***@gmail.com', quota: 89 })
  });
  await a.page.evaluate(() => window.openProp('A-12'));
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#pd-report').isVisible(), true);
  await a.page.locator('#pd-report').click();
  await a.page.waitForTimeout(500);
  const t = await a.page.locator('#reportbox').innerText();
  assert.match(t, /Τηλεφωνήματα[\s\S]*7 \(\+3 από τον προηγούμενο μήνα\)/);
  assert.match(t, /3 ενδιαφερόμενοι βρήκαν την τιμή/);
  await a.page.locator('#rp-send').click();
  await a.page.waitForTimeout(500);
  assert.ok(a.sent.includes('ownerReportSend'));
  assert.equal(await a.page.locator('#reportbox').isVisible(), false);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.6: με κλειστά flags δεν φαίνεται τίποτα από τα νέα', { skip }, async () => {
  const a = await openApp({}, null, { drops: [{ code: 'A-12', title: 'x', old: 2, now: 1, at: now, clients: [] }],
    leads: [cold('C02', 'Θερμός Πελάτης', 'Θερμός', 9)] });
  await a.page.locator('.tab[data-view="today"]').first().click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#today-body [data-drop], #today-body .cool-list').count(), 0);
  await a.page.evaluate(() => window.openProp('A-12'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#pd-report').isVisible(), false);
  await a.ctx.close();
});

// ── 2.7 ──
test('2.7: SMS — επιλογή από τα έτοιμα μηνύματα', { skip }, async () => {
  const a = await openApp({});
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  await a.page.locator('#d-sms-btn').click();
  await a.page.waitForTimeout(300);
  const chips = await a.page.locator('#sms-kinds .chip').allInnerTexts();
  assert.deepEqual(chips, ['Πρώτη επαφή', 'Δεν σας βρήκα', 'Ψάχνετε ακόμα;']);
  await a.page.locator('#sms-kinds .chip', { hasText: 'Δεν σας βρήκα' }).click();
  await a.page.waitForTimeout(200);
  assert.match(await a.page.locator('#sms-text').inputValue(), /Γεια σας Μαρία, σας κάλεσα για το ακίνητο A-12 αλλά δεν σας βρήκα/);
  assert.match(decodeURIComponent(await a.page.locator('#sms-link').getAttribute('href')), /δεν σας βρήκα/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.7: υπόδειξη που έγινε — ούτε αλλαγή ούτε ακύρωση, μόνο «Κλείσε νέα» (νέο event)', { skip }, async () => {
  const past = now - 2 * 3600e3, d = new Date(past), p2 = (n) => String(n).padStart(2, '0');
  const done = { ...lead('L1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), phoneIntl: '+306900000000', hasEvent: true, showingTs: past,
    showingDate: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), showingTime: p2(d.getHours()) + ':' + p2(d.getMinutes()),
    showingAt: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()), outcome: 'Ενδιαφέρθηκε' };
  let sentShowing = null;
  const a = await openApp({}, null, { leads: [done] }, {
    formStatus: () => ({ ready: true, status: '' }),
    showing: (dd) => { sentShowing = dd; return { lead: { ...done, showingTs: now + 864e5, outcome: '' }, updated: false, when: 'αύριο', invited: false }; }
  });
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#btn-showing-text').innerText(), 'Η υπόδειξη έγινε · κλείσε νέα');
  await a.page.locator('#btn-showing').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#s-when').isVisible(), false, 'όχι αλλαγή ώρας');
  assert.equal(await a.page.locator('#btn-cancel-showing').isVisible(), false, 'όχι ακύρωση');
  assert.equal(await a.page.locator('#s-outcome').isVisible(), true);
  await a.page.locator('#s-new').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#s-title').innerText(), 'Νέα υπόδειξη');
  assert.equal(await a.page.locator('#s-when').isVisible(), true);
  await a.page.locator('#btn-save-showing').click();
  await a.page.waitForTimeout(600);
  assert.equal(sentShowing && sentShowing.fresh, true);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.7: διόρθωση ακινήτου από τον μεσίτη του', { skip }, async () => {
  let got = null;
  const a = await openApp({}, null, {}, { propSave: (d) => { got = d; return { code: 'A-12', price: 240000, sqm: 80, street: 'Ερατοσθένους 5', area: 'Παγκράτι' }; } });
  await a.page.evaluate(() => window.openProp('A-12'));
  await a.page.waitForTimeout(400);
  await a.page.locator('#pd-edit').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#pe-price').inputValue(), '250000');
  await a.page.locator('#pe-price').fill('240000');
  await a.page.locator('#pe-save').click();
  await a.page.waitForTimeout(600);
  assert.equal(JSON.stringify(got), JSON.stringify({ code: 'A-12', price: '240000' }), 'στέλνει μόνο ό,τι άλλαξε');
  assert.match(await a.page.locator('#pd-facts').innerText(), /240\.000/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.7: μετρήσεις χρήσης — χρόνος και πατήματα ανά ενέργεια, αποστολή ομαδικά, αναφορά', { skip }, async () => {
  let rows = null;
  const a = await openApp({}, null, {}, {
    usage: (d) => { rows = d.rows; return { ok: true }; },
    usageReport: () => ({ month: '2026-11', team: false, people: 1, canTeam: true, actions: 12, savedSec: 500,
      rows: [{ key: 'sms', label: 'SMS', n: 10, avgSec: 10, avgClicks: 3, baseSec: 60, savedSec: 500 }] })
  });
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(1200);
  await a.page.locator('#d-sms-btn').click();
  await a.page.waitForTimeout(300);
  await a.page.evaluate(() => { window.kwUsage.track('sms'); window.kwUsage.track('sms'); window.kwUsage.track('bootstrap'); });
  const m = await a.page.evaluate(() => window.kwUsage._peek());
  assert.equal(m.sms[0], 1, 'διπλό πάτημα μετράει μία φορά');
  assert.ok(m.sms[1] >= 1 && m.sms[2] >= 1, JSON.stringify(m));
  assert.equal(m.bootstrap, undefined);
  await a.page.evaluate(() => { window.closePop('smsbox'); window.kwUsage.open(); });
  await a.page.waitForTimeout(1200);
  assert.ok(rows && rows.sms, 'στάλθηκαν στον server');
  assert.match(await a.page.locator('#usagebox').innerText(), /Γλίτωσες περίπου[\s\S]*8′[\s\S]*SMS[\s\S]*10 φορές · 10″ και 3 πατήματα/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});
