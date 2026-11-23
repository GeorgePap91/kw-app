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
    session: { device: 'Android · εφαρμογή', since: '' }, roles: { agent: true, admin: true }, env: 'test', version: '1.22',
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

async function openApp(flags = { smartMemory: true, oneTapPush: true, swipeRows: true, peekProp: true }, statusReply, boot = {}, replies = {}, opts = {}) {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'], locale: 'el-GR', serviceWorkers: 'block' });
  if (opts.time) await ctx.clock.setFixedTime(opts.time);   // σταθερή «τώρα» για tests που εξαρτώνται από την ώρα
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
  if (!opts.stay) await page.locator('.tab[data-view="calls"]').first().click();   // stay: μόνο Coach/Admin, χωρίς καρτέλα «Πελάτες»
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
  assert.equal(await a.page.locator('#btn-showing-text').innerText(), 'Υπόδειξη ακινήτου');
  assert.match(await a.page.locator('#d-showing-sub').innerText(), /νέα υπόδειξη|γράψε πώς πήγε/);
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

// ── 2.8 · Απλή εμφάνιση, Κλείσιμο ημέρας ──
const SIMPLE = { agent: { name: 'Test Agent', smsName: 'T', phone: '', link: '', calendar: {}, prefs: { view: 'simple' } } };

test('2.8 · FEAT-22: Απλή — ο πελάτης έχει ΕΝΑ κουμπί και «Περισσότερα»', { skip }, async () => {
  const a = await openApp({}, null, SIMPLE);
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#d-next .next-btns > *').count(), 1);
  assert.equal(await a.page.locator('#d-more').isVisible(), false);
  assert.equal(await a.page.locator('#d-mail').isVisible(), false);
  assert.equal(await a.page.locator('#d-tel').isVisible(), true);
  await a.page.locator('#d-more-btn').click();
  await a.page.waitForTimeout(200);
  assert.equal(await a.page.locator('#btn-lead-task').isVisible(), true, 'όλα είναι ακόμα εδώ');
  assert.equal(await a.page.locator('#d-status-select').isVisible(), true);
  assert.equal(await a.page.locator('#d-more-text').innerText(), 'Λιγότερα');
  // το θυμάται στον επόμενο πελάτη
  await a.page.evaluate(() => window.openLead('L2', {}));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#d-more').isVisible(), true);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.8: Πλήρης εμφάνιση — όπως πριν (δύο κουμπιά, όλες οι ενέργειες, χωρίς «Περισσότερα»)', { skip }, async () => {
  const a = await openApp({});
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#d-next .next-btns > *').count(), 2);
  assert.equal(await a.page.locator('#d-more').isVisible(), true);
  assert.equal(await a.page.locator('#d-more-btn').isVisible(), false);
  assert.equal(await a.page.locator('#d-mail').isVisible(), true);
  assert.equal(await a.page.locator('#todo-list').count(), 0);
  await a.ctx.close();
});

test('2.8 · FEAT-23: Απλή — Σήμερα με «Κάνε τώρα» (έως 3) και «Δες όλα»', { skip }, async () => {
  const many = ['N1', 'N2', 'N3', 'N4', 'N5'].map((id, i) => lead(id, 'Νέος ' + (i + 1), 'Αναπάντητη', 'A-12'));
  const a = await openApp({}, null, { ...SIMPLE, leads: many });
  await a.page.locator('.tab[data-view="today"]').first().click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#todo-list .mrow').count(), 3);
  assert.match(await a.page.locator('#todo-list .mrow').first().innerText(), /Νέα κλήση · Νέος 1/);
  assert.equal(await a.page.locator('#today-body .today-cols').count(), 0, 'η πλήρης λίστα είναι κλειστή');
  assert.match(await a.page.locator('#today-all').innerText(), /Δες όλα \(5\)/);
  await a.page.locator('#today-all').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#today-body .today-cols').count(), 1);
  await a.page.locator('#todo-list .mrow').first().click();
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#d-name').innerText(), 'Νέος 1');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.8 · FEAT-24: ο διακόπτης Απλή/Πλήρης αποθηκεύεται στις προτιμήσεις', { skip }, async () => {
  let got = null;
  const a = await openApp({}, null, {}, { settings: (d) => { got = d; return { ...SIMPLE.agent }; } });
  assert.equal(await a.page.evaluate(() => document.body.classList.contains('kw-simple')), false);
  await a.page.evaluate(() => document.querySelector('#view-pick [data-view-set="simple"]').click());
  await a.page.waitForTimeout(500);
  assert.equal(JSON.stringify(got), JSON.stringify({ view: 'simple' }));
  assert.equal(await a.page.evaluate(() => document.body.classList.contains('kw-simple')), true);
  assert.equal(await a.page.evaluate(() => document.querySelector('#view-pick [data-view-set="simple"]').classList.contains('is-on')), true);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.8 · FEAT-25: Κλείσιμο ημέρας — μία ερώτηση τη φορά, 1 πάτημα, «Η μέρα έκλεισε»', { skip }, async () => {
  const past = now - 3 * 3600e3;
  const shown = { ...lead('S1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), hasEvent: true, showingTs: past, showingDate: '2026-01-01', showingTime: '10:00', showingAt: '01/01/2026 10:00' };
  const fresh = lead('P1', 'Νίκος Κ.', 'Αναπάντητη', 'A-12');
  let out = null, stat = null;
  const a = await openApp({ dayClose: true }, null, { leads: [fresh, shown] }, {
    outcome: (d) => { out = d; return { ...shown, outcome: d.outcome }; },
    status: (d) => { stat = d; return { ...fresh, status: d.status }; }
  });
  assert.equal(await a.page.evaluate(() => window.kwClose.items().length), 2);
  await a.page.evaluate(() => window.kwClose.open());
  await a.page.waitForTimeout(300);
  assert.match(await a.page.locator('#closebox').innerText(), /1 από 2[\s\S]*Πώς πήγε η υπόδειξη;[\s\S]*Μαρία Π\./);
  await a.page.locator('#closebox [data-cl-out="2"]').click();
  await a.page.waitForTimeout(500);
  assert.equal(out && out.outcome, 'Δεν ενδιαφέρθηκε');
  assert.match(await a.page.locator('#closebox').innerText(), /2 από 2[\s\S]*Δεν έχεις καλέσει ακόμα[\s\S]*Νίκος Κ\./);
  await a.page.locator('#closebox [data-cl-na]').click();
  await a.page.waitForTimeout(500);
  assert.equal(stat && stat.status, 'Δεν απάντησε');
  assert.match(await a.page.locator('#closebox').innerText(), /Η μέρα έκλεισε ✓[\s\S]*Τακτοποίησες 2 εκκρεμότητες/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.8: με κλειστό flag dayClose ο οδηγός δεν ανοίγει', { skip }, async () => {
  const a = await openApp({});
  await a.page.evaluate(() => window.kwClose.open());
  assert.equal(await a.page.locator('#closebox').isVisible(), false);
  await a.ctx.close();
});

// ── 2.8.1 ──────────────────────────────────────────────────
test('2.8.1: ο διακόπτης στο Προφίλ δεν «αδειάζει» την οθόνη (το φύλλο δεν κυλάει)', { skip }, async () => {
  const a = await openApp();
  await a.page.evaluate(() => openLead('L1', { profile: true }));
  await a.page.waitForTimeout(500);
  await a.page.locator('#detail [data-pf-v]').filter({ hasText: 'δάνειο' }).first().click();   // εμφανίζει το «Έχει προέγκριση»
  await a.page.waitForTimeout(300);
  const sw = a.page.locator('#detail .pf-check:visible');
  assert.ok(await sw.count() >= 2, 'δεν φάνηκαν οι διακόπτες');
  for (let i = 0; i < 2; i++) {
    await sw.nth(i).click();
    await a.page.waitForTimeout(250);
    assert.equal(await a.page.evaluate(() => document.getElementById('detail').scrollTop), 0, 'το φύλλο κύλησε: κενή οθόνη');
    assert.equal(await sw.nth(i).locator('input').isChecked(), true);
    assert.equal(await a.page.locator('#detail .sheet-head').isVisible(), true);
  }
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.8.1: στον υπολογιστή, πάτημα εκτός της πλαϊνής μπάρας την κλείνει· μέσα της όχι', { skip }, async () => {
  const a = await openApp();
  await a.page.setViewportSize({ width: 1366, height: 800 });
  await a.page.evaluate(() => openLead('L1'));
  await a.page.waitForTimeout(500);
  await a.page.mouse.click(1100, 400);                       // μέσα στη μπάρα
  await a.page.waitForTimeout(350);
  assert.equal(await a.page.locator('#detail').isHidden(), false, 'έκλεισε με πάτημα μέσα');
  await a.page.mouse.click(520, 700);                        // κενός χώρος της λίστας
  await a.page.waitForTimeout(450);
  assert.equal(await a.page.locator('#detail').isHidden(), true, 'δεν έκλεισε με πάτημα εκτός');
  // Πάτημα σε άλλον πελάτη με ανοιχτή μπάρα: ανοίγει εκείνος, η μπάρα μένει.
  await a.page.evaluate(() => openLead('L1'));
  await a.page.waitForTimeout(400);
  await a.page.locator('.row.lead:visible').nth(1).click({ position: { x: 60, y: 20 } });   // το αριστερό μέρος της γραμμής, που δεν το σκεπάζει η μπάρα
  await a.page.waitForTimeout(450);
  assert.equal(await a.page.locator('#detail').isHidden(), false);
  assert.equal(await a.page.evaluate(() => S.lead && S.lead.id), 'L2');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.8.1: κλήση χωρίς επαφή δείχνει «Άνοιγμα επαφής» και τη φτιάχνει στον server', { skip }, async () => {
  let asked = null;
  const contact = { id: 'A9', name: 'Μαρία Π.', phones: ['6900000000'], emails: [], codes: [{ code: 'A-12' }], crm: false };
  const a = await openApp({}, null, {}, {
    leadContact: (d) => { asked = d; return { contactId: 'A9', otherCodes: [] }; },
    contacts: () => [contact]
  });
  await a.page.locator('[data-cmode="pipe"]').click();
  await a.page.waitForTimeout(300);
  await a.page.locator('.pk-open:visible').click();
  await a.page.waitForTimeout(500);
  const btn = a.page.locator('#d-open-contact');
  assert.equal(await btn.isVisible(), true, 'λείπει το «Άνοιγμα επαφής»');
  await btn.click();
  await a.page.waitForTimeout(700);
  assert.ok(asked && asked.id, 'δεν ζητήθηκε η επαφή από τον server');
  assert.equal(await a.page.locator('#contact').isHidden(), false, 'δεν άνοιξε η επαφή');
  assert.equal(await a.page.evaluate(() => S.leads.filter((l) => l.contactId === 'A9').length), 1);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// ── 2.9 · Πίνακας προόδου, στόχοι, οικονομικά, Coach ─────────────────
const ymNow = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
const mxData = () => ({
  configured: true, emails: ['t@example.com'], lastSent: '', formUrl: '', updated: '',
  metrics: [{ key: 'buyer', group: 'clients', label: '1ο Ραντεβού με αγοραστή', sub: 'δια ζώσης' },
            { key: 'showSale', group: 'showings', label: 'Υπόδειξη πώλησης', sub: 'υπογεγραμμένη' }],
  groups: [{ key: 'clients', label: 'Αγοραστές & μισθωτές' }, { key: 'showings', label: 'Υποδείξεις' }],
  months: [{ ym: ymNow, label: 'Τρέχων μήνας', values: { buyer: 3, showSale: 4 }, missing: [],
             weeks: [{ label: '01/01 – 07/01', start: ymNow + '-01', end: ymNow + '-07', values: { buyer: 3, showSale: 4 }, sent: '' }] }]
});
const dashData = () => ({
  goals: { showSale: { w: 2, m: 8, y: 96 }, rev: { w: 0, m: 0, y: 60000 } }, capStart: '01/09',
  finance: { configured: true, test: true, year: new Date().getFullYear(), yearTotal: 40800, yearDeals: 2, owner: 27200, buyer: 13600,
             months: [0, 30000, 0, 0, 0, 0, 0, 0, 0, 10800, 0, 0], cap: 50000, capTotal: 10800, capLeft: 39200, capped: false,
             capFrom: '2026-09-01', capTo: '2027-08-31',
             deals: [{ date: '2026-10-06', code: 'TEST-101', owner: 7200, buyer: 3600, total: 10800, cap: true, year: true },
                     { date: '2026-02-10', code: 'TEST-102', owner: 20000, buyer: 10000, total: 30000, cap: false, year: true }] }
});

test('2.9: «Η πορεία μου» δείχνει τζίρο, υπόλοιπο ως τον στόχο, cap και στόχους με ρυθμό', { skip }, async () => {
  const a = await openApp({ dashboard: true, finance: true }, null, {}, { metrics: mxData, dash: dashData });
  await a.page.evaluate(() => goto('more'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#more-dash').isVisible(), true, 'λείπει η γραμμή «Η πορεία μου»');
  await a.page.locator('#more-dash .mrow').click();
  await a.page.waitForTimeout(600);
  const text = await a.page.locator('#dash-body').innerText();
  assert.match(text, /40\.800 €/);                             // τζίρος έτους
  assert.match(text, /Απομένουν 19\.200 € για τον στόχο/);      // 60.000 − 40.800
  assert.match(text, /Απομένουν 39\.200 € μέχρι το cap/);
  assert.match(text, /Κύκλος 01\/09\/2026 – 31\/08\/2027/);
  assert.match(text, /TEST-101/);
  assert.match(text, /Δοκιμαστικά στοιχεία/);
  assert.match(text, /4 από 8/);                                // στόχος μήνα
  assert.match(text, /Με αυτόν τον ρυθμό κλείνεις τον μήνα στο/);
  await a.page.locator('[data-dz-period="w"]').click();
  await a.page.waitForTimeout(200);
  assert.match(await a.page.locator('#dash-body').innerText(), /4 από 2/);
  assert.ok(a.sent.includes('dash'));
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.9: χωρίς το flag dashboard η γραμμή δεν φαίνεται και δεν ζητιέται τίποτα', { skip }, async () => {
  const a = await openApp({}, null, {}, { metrics: mxData });
  await a.page.evaluate(() => goto('more'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#more-dash').isHidden(), true);
  assert.ok(!a.sent.includes('dash'));
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.9: ο Coach βλέπει την ομάδα, φιλτράρει ανά μεσίτη και ορίζει στόχους', { skip }, async () => {
  let saved = null;
  const team = () => ({
    agents: [{ name: 'Μαρία Δοκιμή', active: true, capStart: '01/09', goals: 2, monthPct: 0.5, revTarget: 60000, yearTotal: 40800, capTotal: 10800, capped: false },
             { name: 'Νίκος Δοκιμή', active: true, capStart: '', goals: 0, monthPct: null, revTarget: 0, yearTotal: 52000, capTotal: 52000, capped: true }],
    cap: 50000, finance: true, test: true, metricsOn: true, updated: '16/11 20:00', metrics: mxData().metrics, groups: mxData().groups
  });
  const a = await openApp({}, null, { roles: { agent: false, admin: false, coach: true }, leads: [], props: [] }, {
    coachBoot: team,
    coachDash: (d) => ({ agent: d.agent, mx: mxData(), dash: dashData() }),
    coachGoalSet: (d) => { saved = d; return { agent: d.agent, mx: mxData(), dash: dashData() }; }
  }, { stay: true });
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.evaluate(() => S.mode), 'coach');
  assert.equal(await a.page.locator('#nav-coach').isVisible(), true);
  assert.equal(await a.page.locator('#nav-agent').isHidden(), true);
  assert.equal(await a.page.locator('#fab').isHidden(), true);
  let text = await a.page.locator('#c-body').innerText();
  assert.match(text, /Μαρία Δοκιμή/); assert.match(text, /50% στόχων μήνα/); assert.match(text, /1\/2/);   // 1 από 2 έπιασε το cap
  await a.page.locator('#c-agent').selectOption('Μαρία Δοκιμή');
  await a.page.waitForTimeout(500);
  text = await a.page.locator('#c-body').innerText();
  assert.match(text, /40\.800 €/); assert.match(text, /4 από 8/);
  await a.page.locator('#c-goals').click();
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#goals').isHidden(), false);
  assert.equal(await a.page.locator('.g-row[data-g="showSale"] [data-p="m"]').inputValue(), '8');
  await a.page.locator('.g-row[data-g="buyer"] [data-p="w"]').fill('3');
  await a.page.locator('#g-auto').click();
  assert.equal(await a.page.locator('.g-row[data-g="buyer"] [data-p="m"]').inputValue(), '12');
  await a.page.locator('#g-rev').fill('75000');
  await a.page.locator('#g-cap').fill('15/05');
  await a.page.locator('#g-save').click();
  await a.page.waitForTimeout(600);
  assert.equal(saved.agent, 'Μαρία Δοκιμή');
  assert.deepEqual(saved.goals.buyer, { w: 3, m: 12, y: 144 });
  assert.deepEqual(saved.goals.rev, { y: 75000 });
  assert.equal(saved.capStart, '15/05');
  assert.equal(await a.page.locator('#goals').isHidden(), true);
  assert.ok(!a.sent.includes('leads') && !a.sent.includes('adminBoot'), 'ο Coach δεν ζητά κλήσεις ή στοιχεία Admin');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.9.1: Super Admin περνά και στους τρεις ρόλους από τα «Άλλα» και η επιλογή θυμάται', { skip }, async () => {
  const adminBoot = () => ({ agents: [], props: [], leads: [], review: { items: [], counts: {} }, reasons: [], drive: null, limits: {} });
  const coachBoot = () => ({ agents: [], cap: 50000, finance: false, test: false, metricsOn: false, updated: '', metrics: [], groups: [] });
  const a = await openApp({}, null, { roles: { agent: true, admin: true, coach: true, super: true } }, { adminBoot, coachBoot });
  assert.equal(await a.page.evaluate(() => S.mode), 'agent');
  await a.page.evaluate(() => goto('more'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#mode-coach').isVisible(), true);
  assert.equal(await a.page.locator('#mode-admin').isVisible(), true);
  assert.match(await a.page.locator('#more-sub').innerText(), /Super Admin/);
  await a.page.locator('#mode-coach').click();
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.evaluate(() => S.mode), 'coach');
  assert.equal(await a.page.locator('#nav-coach').isVisible(), true);
  await a.page.evaluate(() => goto('c-more'));
  await a.page.waitForTimeout(300);
  await a.page.locator('#c-to-admin').click();
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.evaluate(() => S.mode), 'admin');
  await a.page.evaluate(() => goto('a-more'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#a-to-coach').isVisible(), true, 'από το Admin λείπει η μετάβαση σε Coach');
  await a.page.locator('#a-to-coach').click();
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.evaluate(() => S.mode), 'coach');
  assert.equal(await a.page.evaluate(() => localStorage.getItem('kw_mode')), 'coach');
  await a.page.evaluate(() => goto('c-more'));
  await a.page.waitForTimeout(300);
  await a.page.locator('#c-to-agent').click();
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.evaluate(() => S.mode), 'agent');
  assert.equal(await a.page.locator('#nav-agent').isVisible(), true);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// 2.10 · Marketing: ενότητα στο ακίνητο, άνοιγμα προτύπου, αλλαγή μεγέθους, εξαγωγή.
test('Marketing: πρότυπα στο ακίνητο, επεξεργασία κειμένου, λήψη αρχείου', { skip }, async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const tdir = join(ROOT, 'marketing/templates');
  const tpls = readdirSync(tdir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(String(readFileSync(join(tdir, f)))));
  const png = (f) => 'data:image/png;base64,' + readFileSync(join(tdir, f)).toString('base64');
  // Συνθετική «φωτογραφία» (καμία πραγματική εικόνα στο repo): ένα PNG φόντου κάνει τη δουλειά.
  const photo = png(tpls[0].bg);
  const logged = [];
  const a = await openApp({ marketing: true }, null, {
    props: [{ code: 'A-12', street: 'Ερατοσθένους 5', area: 'Παγκράτι', price: 250000, sqm: 80, type: 'Διαμέρισμα', title: 'Διαμέρισμα', deal: 'Πώληση', partner: 'Test Agent', mine: true, available: true }]
  }, {
    mktGet: () => ({ code: 'A-12', mine: true, desc: 'Φωτεινό διαμέρισμα 80 τ.μ.', link: 'https://kwac.gr/a12', deal: '', rev: 1, stats: {}, templates: tpls, tags: '', hosts: [], descMax: 260 }),
    mktAsset: (d) => ({ src: d.kind === 'bg' ? png(tpls.find((t) => t.id === d.tpl).bg) : '' }),
    media: () => ({ photos: [{ id: 'p1' }, { id: 'p2' }], cover: 'p1', canEdit: true }),
    mediaImg: (d) => ({ id: d.id, src: photo }),
    mktLog: (d) => { logged.push(d); return { ok: true }; }
  });
  await a.page.evaluate(() => window.openProp('A-12'));
  await a.page.locator('#tab-pd-mkt').click();
  await a.page.waitForSelector('.mk-tpl');
  assert.equal(await a.page.locator('.mk-tpl').count(), tpls.length);
  await a.page.locator('.mk-tpl[data-id="brochure"]').click();
  await a.page.waitForFunction(() => document.getElementById('mk-canvas').width > 100, null, { timeout: 10000 });
  // Πάτημα στον τίτλο («ΠΩΛΕΙΤΑΙ») → εργαλεία κειμένου → A+ μεγαλώνει.
  const box = await a.page.locator('#mk-canvas').boundingBox();
  await a.page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.04);
  await a.page.waitForSelector('#mk-bigger');
  assert.equal(await a.page.locator('#mk-t').inputValue(), 'ΠΩΛΕΙΤΑΙ');
  const before = await a.page.locator('#mk-size').innerText();
  await a.page.locator('#mk-smaller').click();
  await a.page.waitForTimeout(100);
  assert.notEqual(await a.page.locator('#mk-size').innerText(), before);
  const dl = a.page.waitForEvent('download', { timeout: 10000 });
  await a.page.locator('#mk-dl').click();
  assert.equal((await dl).suggestedFilename(), 'A-12-brochure.pdf');
  await a.page.waitForTimeout(300);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].ev, 'dl');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// ── 2.11 · FEAT-29 · Διαδρομή ημέρας ─────────────────────────────
// Σταθερή ώρα: 12/11/2026 08:00. Υποδείξεις σήμερα στις 07:00 (πέρασε), 10:00 και 11:30.
const T0 = new Date(2026, 10, 12, 8, 0);
const showAt = (id, hh, mm, extra = {}) => ({
  ...lead(id, 'Πελάτης ' + id, 'Υπόδειξη', 'K-' + id), hasEvent: true, showingDate: '2026-11-12',
  showingTs: new Date(2026, 10, 12, hh, mm).getTime(), showingTime: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'),
  showingAt: '12/11/2026 ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), address: 'Οδός ' + id + ' 1, Αθήνα', ...extra
});
const dayLeads = [showAt('P', 7, 0), showAt('B', 10, 0), showAt('C', 11, 30)];

test('2.11: Διαδρομή ημέρας: κουμπί ≥48px, link με όλες τις υποδείξεις που δεν πέρασαν, χωρίς καμία επιπλέον κλήση', { skip }, async () => {
  const a = await openApp({ dayRoute: true }, null, { leads: dayLeads }, {}, { time: T0 });
  await a.page.locator('.tab[data-view="today"]').first().click();
  const btn = a.page.locator('#today-body a[data-dayroute]');
  await btn.waitFor();
  assert.match(await btn.innerText(), /Διαδρομή ημέρας[\s\S]*2 στάσεις · από 10:00 έως 11:30/);
  assert.ok((await btn.boundingBox()).height >= 48, 'το κουμπί είναι μικρότερο από 48px');
  const u = new URL(await btn.getAttribute('href'));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('waypoints'), 'Οδός B 1, Αθήνα, Ελλάδα');           // η P (07:00) πέρασε
  assert.equal(u.searchParams.get('destination'), 'Οδός C 1, Αθήνα, Ελλάδα');
  assert.equal(await btn.getAttribute('target'), '_blank');
  assert.match(await a.page.locator('#today-body').innerText(), /φύγε ~09:30/);        // 10:00 − 30′
  assert.match(await a.page.locator('#today-body').innerText(), /φύγε ~11:00/);        // 11:30 − 30′
  assert.deepEqual(a.sent.filter((x) => x !== 'bootstrap'), [], 'στάλθηκε κλήση στον server');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.11: Διαδρομή ημέρας: με κλειστό flag ή με 1 υπόδειξη δεν φαίνεται', { skip }, async () => {
  const off = await openApp({}, null, { leads: dayLeads }, {}, { time: T0 });
  await off.page.locator('.tab[data-view="today"]').first().click();
  await off.page.waitForTimeout(300);
  assert.equal(await off.page.locator('#today-body [data-dayroute]').count(), 0);
  assert.doesNotMatch(await off.page.locator('#today-body').innerText(), /φύγε ~/);
  await off.ctx.close();
  const one = await openApp({ dayRoute: true }, null, { leads: [showAt('B', 10, 0)] }, {}, { time: T0 });
  await one.page.locator('.tab[data-view="today"]').first().click();
  await one.page.waitForTimeout(300);
  assert.equal(await one.page.locator('#today-body [data-dayroute]').count(), 0);
  await one.ctx.close();
});

test('2.11: Διαδρομή ημέρας: συντεταγμένες όπου υπάρχουν, και «💡 Νέο» μόνο μία φορά', { skip }, async () => {
  const props = [{ code: 'K-B', street: 'Οδός B 1', area: 'Αθήνα', price: 1, sqm: 1, title: 'x', mine: true, lat: 37.9715, lng: 23.7257 }];
  const a = await openApp({ dayRoute: true }, null, { leads: dayLeads, props }, {}, { time: T0 });
  await a.page.locator('.tab[data-view="today"]').first().click();
  const btn = a.page.locator('#today-body a[data-dayroute]');
  await btn.waitFor();
  assert.equal(new URL(await btn.getAttribute('href')).searchParams.get('waypoints'), '37.9715,23.7257');
  await a.page.waitForTimeout(1000);
  assert.match(await a.page.locator('#toast').innerText(), /Νέο: «Διαδρομή ημέρας»/);
  assert.equal(await a.page.evaluate(() => localStorage.getItem('kw_route_tip')), '1');
  await a.ctx.close();
});

test('2.11: Διαδρομή ημέρας: χωρίς σύνδεση το κουμπί υπάρχει από την τοπική cache', { skip }, async () => {
  const a = await openApp({ dayRoute: true }, null, { leads: dayLeads }, {}, { time: T0 });
  await a.ctx.setOffline(true);
  await a.page.locator('.tab[data-view="today"]').first().click();
  const btn = a.page.locator('#today-body a[data-dayroute]');
  await btn.waitFor();
  assert.match(await btn.getAttribute('href'), /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// ── 2.11.1 / 2.12 ──────────────────────────────────────────────

test('2.11.1: σημείωση κλήσης — φεύγει αμέσως στο «Πίσω» και δεν σβήνεται από απάντηση server', { skip }, async () => {
  const a = await openApp({}, null, {}, { note: (d) => ({}) });
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  await a.page.locator('.subtab[data-tab="notes"]').click();
  await a.page.locator('#d-notes').fill('θέλει μπαλκόνι');
  assert.ok(!a.sent.includes('note'), 'στάλθηκε πριν το debounce');
  // απάντηση server (status) με παλιά σημείωση ΔΕΝ πρέπει να σβήσει το κείμενο
  await a.page.evaluate(() => document.activeElement.blur());
  await a.page.locator('#btn-noanswer-row').click();
  await a.page.waitForTimeout(400);
  assert.ok(a.sent.includes('status'));
  assert.equal(await a.page.locator('#d-notes').inputValue(), 'θέλει μπαλκόνι');
  await a.page.locator('#detail-back').click();
  await a.page.waitForTimeout(150);
  assert.ok(a.sent.includes('note'), 'δεν στάλθηκε στο «Πίσω»');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.12: «＋» είναι σκέτος κύκλος· tabs Κλήση / Υπόδειξη / Άλλο· μόνο οι τελευταίες 7 ημέρες', { skip }, async () => {
  const old = { ...lead('L9', 'Παλιός Π.', 'Αναπάντητη', 'B-7'), ts: now - 10 * 864e5 };
  const fresh = { ...lead('L1', 'Μαρία Π.', 'Αναπάντητη', 'A-12'), ts: now - 3600e3 };
  const a = await openApp({}, null, { leads: [fresh, old] });
  assert.equal((await a.page.locator('#fab').innerText()).trim(), '');
  await a.page.locator('#fab').click();
  assert.deepEqual(await a.page.locator('#quick-tabs .subtab').allInnerTexts(), ['Κλήση', 'Υπόδειξη', 'Άλλο']);
  const names = await a.page.locator('#quick-list .mrow b').allInnerTexts();
  assert.deepEqual(names, ['Μαρία Π.']);
  await a.page.locator('#quick-tabs [data-qtab="more"]').click();
  assert.equal(await a.page.locator('#quick-more').isVisible(), true);
  assert.equal(await a.page.locator('#quick-list').isVisible(), false);
  await a.page.locator('#quick-tabs [data-qtab="call"]').click();
  await a.page.locator('#quick-list .mrow').first().click();
  await a.page.waitForTimeout(200);
  assert.equal(await a.page.locator('#lp-write').isVisible(), true, 'δεν άνοιξε το πεδίο σημείωσης');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.12: επόμενο βήμα ανά αποτέλεσμα υπόδειξης + μία καρτέλα «Υπόδειξη ακινήτου»', { skip }, async () => {
  const past = now - 2 * 3600e3, d = new Date(past), p2 = (n) => String(n).padStart(2, '0');
  const mk = (outcome, extra = {}) => ({ ...lead('L1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), hasEvent: true, showingTs: past,
    showingDate: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), showingTime: p2(d.getHours()) + ':' + p2(d.getMinutes()),
    showingAt: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()),
    outcome, form: 'Υπογράφηκε', ...extra });
  const cases = [
    ['Ενδιαφέρθηκε', /Έντυπο προσφοράς/],
    ['Θέλει δεύτερη υπόδειξη', /Κλείσε 2η υπόδειξη/],
    ['Δεν ενδιαφέρθηκε', /Πάρε ζήτηση/],
    ['Δεν ήρθε', /Νέο ραντεβού/],
    ['', /Πώς πήγε;/]                         // υπόδειξη έγινε, έντυπο υπογεγραμμένο, χωρίς αποτέλεσμα
  ];
  for (const [outcome, re] of cases) {
    const a = await openApp({}, null, { leads: [mk(outcome)] });
    await a.page.evaluate(() => window.openLead('L1', {}));
    await a.page.waitForTimeout(350);
    const next = await a.page.locator('#d-next').innerText();
    assert.match(next, re, outcome + ' → ' + next);
    assert.doesNotMatch(next, /Κλείσε υπόδειξη\b(?! 2)/, 'δεν πρέπει να προτείνεται νέα υπόδειξη');
    assert.equal(await a.page.locator('#btn-showform').count(), 0, 'έμεινε το ξεχωριστό «Έντυπο υπόδειξης»');
    assert.equal(await a.page.locator('#btn-showing-text').innerText(), 'Υπόδειξη ακινήτου');
    assert.deepEqual(a.errors, []);
    await a.ctx.close();
  }
});

test('2.12: «Θέλει διόρθωση» στην αρχική → «Άνοιγμα PDF»', { skip }, async () => {
  const rv = { id: 'R1', kind: 'showform', title: 'Έντυπο υπόδειξης', note: 'Λείπει υπογραφή', lead: 'L1', url: 'https://drive.google.com/file/d/ABC/view', code: 'A-12' };
  const a = await openApp({}, null, { reviews: [rv] }, {}, { stay: true });
  await a.page.evaluate(() => goto('today'));
  await a.page.waitForTimeout(300);
  await a.page.locator('[data-fix="R1"]').first().click();
  await a.page.waitForTimeout(200);
  assert.match(await a.page.locator('#ask-btns').innerText(), /Άνοιγμα PDF/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

// ── 2.14 ─────────────────────────────────────────────────────

test('2.14: χωρίς σήμα → πορτοκαλί τελεία πάνω δεξιά, χωρίς μήνυμα «σήμα»· με σήμα → πράσινη και σβήνει', { skip }, async () => {
  const a = await openApp();
  assert.equal(await a.page.locator('#netdot').isHidden(), true, 'η τελεία φαίνεται με σήμα και χωρίς αλλαγές');
  assert.equal(await a.page.locator('#offbar').count(), 0, 'έμεινε η παλιά μπάρα');
  await a.ctx.setOffline(true);
  await a.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await a.page.waitForTimeout(900);
  await a.swipe(-220);                                  // «Δεν απάντησε» → μετά από 4″ πάει στην ουρά
  await a.page.waitForTimeout(4600 + 6500);
  const dot = a.page.locator('#netdot');
  assert.equal(await dot.isHidden(), false);
  assert.match(await dot.getAttribute('class'), /\bwait\b/);
  assert.match(await dot.getAttribute('aria-label'), /1 αλλαγή/);
  const box = await dot.boundingBox(), vw = a.page.viewportSize().width;
  assert.ok(box.x + box.width >= vw - 1 && box.y < 60, 'η τελεία δεν είναι πάνω δεξιά');
  assert.doesNotMatch(await a.page.locator('#toast').innerText(), /σήμα/);
  await a.ctx.setOffline(false);
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.page.waitForTimeout(1500);
  assert.match(await dot.getAttribute('class'), /\bok\b/, 'δεν πρασίνισε μετά την αποστολή');
  assert.ok(a.sent.includes('status'));
  await a.page.waitForTimeout(3800);
  assert.equal(await dot.isHidden(), true, 'η πράσινη τελεία δεν έσβησε');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.14: «Πάρε ζήτηση» → φόρμα → link για SMS · συμπληρωμένη → κριτήρια + iList', { skip }, async () => {
  const past = now - 2 * 3600e3, d = new Date(past), p2 = (n) => String(n).padStart(2, '0');
  const l = { ...lead('L1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), hasEvent: true, showingTs: past,
    showingDate: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), showingTime: '10:00',
    showingAt: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' 10:00', outcome: 'Δεν ενδιαφέρθηκε', form: 'Υπογράφηκε' };
  let state = { status: '', deal: 'Αγορά' }, created = null, ilist = null;
  const done = { status: 'Συμπληρώθηκε', submitted: '20/11/2026 10:00', deal: 'Αγορά', ilist: '',
    lines: [['Τιμή', '150.000 – 250.000 €'], ['Περιοχές', 'Παγκράτι']], summary: 'Αγορά · 150.000 – 250.000 € · Περιοχές: Παγκράτι', answers: { notes: '' } };
  const a = await openApp({ demandForm: true }, null, { leads: [l] }, {
    demandStatus: () => state,
    demandCreate: (x) => { created = x; return { form: { status: 'Στάλθηκε', expires: '20/12/2026 10:00', deal: x.deal },
      url: 'https://x/demand.html#' + 'a'.repeat(48), sms: 'Καλησπέρα Μαρία…', wa: '306900000000', email: { to: '', subject: '', body: '' } }; },
    demandIList: (x) => { ilist = x; return { ...done, ilist: '20/11/2026 11:00' }; }
  });
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(350);
  await a.page.locator('#d-next [data-next="demand"]').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#demand').isHidden(), false);
  await a.page.locator('[data-dmdeal="Ενοικίαση"]').click();
  await a.page.locator('#dm-create').click();
  await a.page.waitForTimeout(300);
  assert.equal(created.deal, 'Ενοικίαση');
  assert.match(await a.page.locator('#dm-body').innerText(), /Περιμένει τον πελάτη[\s\S]*SMS/);
  await a.page.locator('#demand [data-pop-close]').click();
  await a.page.waitForTimeout(300);
  state = done;
  await a.page.locator('#d-next [data-next="demand"]').click();
  await a.page.waitForTimeout(400);
  const txt = await a.page.locator('#dm-body').innerText();
  assert.match(txt, /150\.000 – 250\.000 €/);
  assert.match(txt, /Αντιγραφή για το iList/);
  await a.page.locator('#dm-done').click();
  await a.page.waitForTimeout(300);
  assert.deepEqual(ilist, { id: 'L1', on: true });
  assert.match(await a.page.locator('#dm-body').innerText(), /Περάστηκε στο iList/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.14.1: χωρίς flag demandForm δεν φαίνεται το «Πάρε ζήτηση»', { skip }, async () => {
  const past = now - 2 * 3600e3, d = new Date(past), p2 = (n) => String(n).padStart(2, '0');
  const l = { ...lead('L1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), hasEvent: true, showingTs: past,
    showingDate: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), showingTime: '10:00',
    showingAt: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' 10:00', outcome: 'Δεν ενδιαφέρθηκε', form: 'Υπογράφηκε' };
  const a = await openApp({}, null, { leads: [l] }, {});
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(350);
  assert.equal(await a.page.locator('#d-next [data-next="demand"]').count(), 0);
  assert.equal(await a.page.locator('#d-next [data-next="task"]').count(), 1, 'η «Εργασία» μένει');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.14: σελίδα πελάτη demand.html — συμπλήρωση και αποστολή', { skip }, async () => {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'], locale: 'el-GR' });
  let got = null; const errors = [];
  await ctx.route(/script\.google\.com/, async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    const data = b.action === 'demandOpen'
      ? { office: 'KW', agent: 'Ξενοφών', first: 'Μαρία', deal: 'Αγορά', area: 'Παγκράτι', expires: '20/12/2026',
          floors: ['Υπόγειο', 'Ισόγειο', '1ος', '2ος', '3ος', '4ος', '5ος+', 'Ρετιρέ'], beds: ['1', '2', '3', '4+'] }
      : (got = b.data, { ok: true });
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await ctx.addInitScript(() => { window.KW_CONFIG = { API_URL: 'https://script.google.com/macros/s/X/exec' }; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + 'demand.html#' + 'b'.repeat(48));
  await page.waitForSelector('#form:not([hidden])', { timeout: 10000 });
  assert.match(await page.locator('#lead-in').innerText(), /Μαρία/);
  await page.fill('#f-priceMin', '150000'); await page.fill('#f-priceMax', '250000');
  await page.fill('#f-sqmMin', '70'); await page.fill('#f-ppsMax', '2500');
  await page.locator('#beds .chip', { hasText: '2' }).click();
  await page.locator('#floors .chip', { hasText: '3ος' }).click();
  await page.fill('#f-yearMin', '1990');
  await page.check('#f-parking');
  await page.fill('#f-areas', 'Παγκράτι, Κουκάκι');
  await page.fill('#f-notes', 'ασανσέρ');
  // «από» > «έως»: σφάλμα στη συσκευή, τίποτα δεν στέλνεται
  await page.fill('#f-sqmMax', '50');
  await page.locator('#submit').click();
  assert.match(await page.locator('[data-f="sqm"] .err').innerText(), /μικρότερο/);
  assert.equal(got, null);
  await page.fill('#f-sqmMax', '100');
  await page.locator('#submit').click();
  await page.waitForSelector('#done:not([hidden])', { timeout: 5000 });
  assert.equal(got.c.priceMin, '150.000');
  assert.equal(got.c.beds, '2');
  assert.deepEqual(got.c.floors, ['3ος']);
  assert.equal(got.c.parking, true);
  assert.equal(got.c.furnished, false);
  assert.equal(got.f, 'b'.repeat(48));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('2.15.1: χωρίς flag demandForm δεν φαίνεται η επιλογή «Ζητήσεις» και δεν ζητείται η λίστα', { skip }, async () => {
  let asked = 0;
  const a = await openApp({}, null, {}, { demandList: () => { asked++; return { items: [], counts: {} }; } });
  await a.page.evaluate(() => window.go ? window.go('more') : document.querySelector('[data-goto="more"]').click());
  await a.page.waitForTimeout(350);
  assert.equal(await a.page.locator('#more-demands').isVisible(), false);
  assert.equal(asked, 0);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.15: Περισσότερα → Ζητήσεις: μετρητής, καρτέλες, πάτημα → iList με το id της ζήτησης', { skip }, async () => {
  const it = (id, status, ilist, extra = {}) => ({ id, lead: 'OLD-' + id, status, ilist, first: 'Πελάτης ' + id, code: 'A-1', deal: 'Αγορά',
    created: '01/11/2026 10:00', submitted: status === 'Συμπληρώθηκε' ? '02/11/2026 10:00' : '', expires: '01/12/2026 10:00', opens: 1,
    summary: 'Αγορά · έως 200.000 € · Περιοχές: Παγκράτι', lines: [['Περιοχές', 'Παγκράτι']], answers: { notes: '' }, ...extra });
  const list = { items: [it('A', 'Συμπληρώθηκε', ''), it('B', 'Συμπληρώθηκε', '03/11/2026 10:00'), it('C', 'Στάλθηκε', '')],
                 counts: { toPass: 1, passed: 1, waiting: 1, received: 2 } };
  let il = null;
  const a = await openApp({ demandForm: true }, null, {}, {
    demandList: () => list,
    demandIList: (x) => { il = x; return { ...it('A', 'Συμπληρώθηκε', '21/11/2026 18:00') }; }
  });
  await a.page.evaluate(() => goto('more'));
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.locator('#dm-badge').innerText(), '1');
  await a.page.locator('[data-goto="demands"]').click();
  await a.page.waitForTimeout(400);
  assert.match(await a.page.locator('.dm-tiles').innerText(), /1\s*Προς iList[\s\S]*1\s*Σε αναμονή[\s\S]*1\s*Περάστηκαν/);
  assert.match(await a.page.locator('#dm-list').innerText(), /50%/);
  assert.equal(await a.page.locator('[data-dm]').count(), 1);
  await a.page.locator('[data-dmtab="waiting"]').click();
  assert.match(await a.page.locator('#dm-list').innerText(), /Πελάτης C[\s\S]*Στάλθηκε/);
  await a.page.locator('[data-dmtab="toPass"]').click();
  await a.page.locator('[data-dm="A"]').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#demand').isHidden(), false);
  assert.equal(await a.page.locator('#dm-new').count(), 0, 'από τη λίστα δεν προτείνεται νέα φόρμα');
  await a.page.locator('#dm-done').click();
  await a.page.waitForTimeout(400);
  assert.deepEqual(il, { dm: 'A', on: true });
  assert.equal(await a.page.locator('#dm-badge').isHidden(), true, 'ο μετρητής δεν μηδένισε');
  await a.page.locator('#demand [data-pop-close]').click();
  await a.page.waitForTimeout(300);
  assert.match(await a.page.locator('.dm-tiles').innerText(), /0\s*Προς iList[\s\S]*2\s*Περάστηκαν/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.16: ζήτηση που πάρθηκε → όχι «Πάρε ζήτηση», φαίνεται στο ιστορικό, «Αλλαγή ζήτησης» γράφει στον server', { skip }, async () => {
  const past = now - 2 * 86400e3, d = new Date(past), p2 = (n) => String(n).padStart(2, '0');
  const st = (t) => p2(t.getDate()) + '/' + p2(t.getMonth() + 1) + '/' + t.getFullYear() + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes());
  const l = { ...lead('L1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), hasEvent: true, showingTs: past,
    showingDate: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), showingTime: p2(d.getHours()) + ':' + p2(d.getMinutes()),
    showingAt: st(d), outcome: 'Δεν ενδιαφέρθηκε', form: 'Υπογράφηκε' };
  const sent = st(new Date(past + 3600e3)), got = st(new Date(past + 7200e3)), ed = st(new Date(now - 60e3));
  const done = { id: 'DM-1', lead: 'L1', status: 'Συμπληρώθηκε', created: sent, submitted: got, ilist: '', opens: 1, deal: 'Αγορά', edited: '', self: false,
    summary: 'Αγορά · έως 250.000 € · Περιοχές: Παγκράτι', lines: [['Τιμή', 'έως 250.000 €'], ['Περιοχές', 'Παγκράτι']],
    answers: { priceMax: 250000, areas: 'Παγκράτι', floors: ['2ος'], beds: '2', parking: true } };
  let edit = null;
  const a = await openApp({ demandForm: true }, null, { leads: [l], demands: { L1: done } }, {
    demandStatus: () => done,
    demandEdit: (x) => { edit = x; return { ...done, edited: ed, summary: 'Αγορά · έως 250.000 € · Περιοχές: Κουκάκι', lines: [['Περιοχές', 'Κουκάκι']], answers: { areas: 'Κουκάκι' }, reset: false }; }
  });
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  let next = await a.page.locator('#d-next').innerText();
  assert.doesNotMatch(next, /Πάρε ζήτηση/);
  assert.match(next, /Πέρασε τη ζήτηση στο iList[\s\S]*Παγκράτι/);
  let hist = await a.page.locator('#d-hist').innerText();
  assert.match(hist, /Στάλθηκε φόρμα ζήτησης[\s\S]*Ο πελάτης έστειλε τη ζήτηση/);
  // Αλλαγή ζήτησης
  await a.page.locator('#d-next [data-next="demand"]').click();
  await a.page.waitForTimeout(400);
  await a.page.locator('#dm-edit').click();
  assert.equal(await a.page.locator('#de-priceMax').inputValue(), '250.000');                 // προσυμπληρωμένο
  assert.equal(await a.page.locator('#de-floors .chip.is-on').innerText(), '2ος');
  assert.equal(await a.page.locator('#de-parking').isChecked(), true);
  await a.page.fill('#de-areas', 'Κουκάκι');
  await a.page.locator('#de-save').click();
  await a.page.waitForTimeout(400);
  assert.equal(edit.id, 'L1');
  assert.equal(edit.c.areas, 'Κουκάκι');
  assert.equal(edit.c.priceMax, '250.000');
  assert.deepEqual(edit.c.floors, ['2ος']);
  assert.match(await a.page.locator('#dm-body').innerText(), /Την άλλαξες/);
  await a.page.locator('#demand [data-pop-close]').click();
  await a.page.waitForTimeout(300);
  hist = await a.page.locator('#d-hist').innerText();
  assert.match(hist, /Άλλαξες τη ζήτηση/);
  next = await a.page.locator('#d-next').innerText();
  assert.match(next, /Κουκάκι/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.16: η φόρμα περιμένει τον πελάτη → «Περιμένεις τη ζήτηση», όχι «Πάρε ζήτηση»', { skip }, async () => {
  const past = now - 2 * 3600e3, d = new Date(past), p2 = (n) => String(n).padStart(2, '0');
  const l = { ...lead('L1', 'Μαρία Π.', 'Υπόδειξη', 'A-12'), hasEvent: true, showingTs: past,
    showingDate: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), showingTime: '10:00',
    showingAt: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' 10:00', outcome: 'Δεν ενδιαφέρθηκε', form: 'Υπογράφηκε' };
  const a = await openApp({ demandForm: true }, null, { leads: [l], demands: { L1: { id: 'DM-2', status: 'Στάλθηκε', created: l.showingAt, opens: 0 } } });
  await a.page.evaluate(() => window.openLead('L1', {}));
  await a.page.waitForTimeout(400);
  const next = await a.page.locator('#d-next').innerText();
  assert.match(next, /Περιμένεις τη ζήτηση[\s\S]*Δεν την έχει ανοίξει/);
  assert.doesNotMatch(next, /Πάρε ζήτηση/);
  assert.match(await a.page.locator('#d-hist').innerText(), /Στάλθηκε φόρμα ζήτησης/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.17: Επαφές κινητού — CSV Google → έλεγχος διπλών → εισαγωγή · ενδιαφερόμενοι · κουμπί στην επαφή', { skip }, async () => {
  const contacts = [
    { id: 'K1', crm: true, name: 'Μαρία Παπαδάκη', phones: ['6971234567'], emails: ['maria@ex.gr'] },
    { id: 'C2', name: 'Γιώργος Λάμπρου', phones: ['6900000002'], codes: [{ code: 'A-12', street: 'Ερατοσθένους 5' }] }
  ];
  let imported = null;
  const status = { mode: 'off', linked: false, helper: true, pendingDup: 0, pendingPhone: 0 };
  const a = await openApp({ phoneContacts: true }, null, {}, {
    contacts: () => contacts,
    pcStatus: () => status,
    pcImport: (d) => { imported = d; return { added: 1, merged: 1, later: 1, skipped: 0 }; }
  });
  await a.page.evaluate(() => goto('contacts'));
  await a.page.waitForTimeout(500);
  assert.equal(await a.page.locator('#pc-card').isHidden(), false, 'δεν φαίνεται η κάρτα');
  await a.page.locator('#pc-card').click();
  await a.page.waitForTimeout(300);
  assert.match(await a.page.locator('#pc-body').innerText(), /Φέρε τις επαφές μου/);
  await a.page.locator('[data-pc="import"]').click();
  await a.page.locator('[data-dev="android"]').click();
  const csv = 'First Name,Last Name,Labels,E-mail 1 - Value,Phone 1 - Value\n' +
    'Maria,Papadaki,A-12 Ερατοσθένους 5 ::: * myContacts,,+30 697 123 4567\n' +     // ίδια με K1 → συγχώνευση
    'Σοφία,Άλλη,Ερατοσθένους 5,,6900000002\n' +                                       // ίδιο τηλέφωνο με C2, άλλο όνομα → απόφαση
    'Κώστας,Νέος,A-12,,6999999999\n' +                                                 // νέα
    'Μαμά,,* myContacts,,6911111111\n';                                                // χωρίς ακίνητο → δεν τσεκάρεται
  await a.page.locator('#pc-file').setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await a.page.waitForSelector('#pc-go');
  const txt = await a.page.locator('#pc-body').innerText();
  assert.match(txt, /Βρέθηκαν 4 επαφές/);
  assert.match(txt, /Υπάρχει ήδη · συγχώνευση/);
  assert.match(txt, /Μάλλον ίδια · διάλεξε/);
  assert.match(txt, /Νέα/);
  assert.doesNotMatch(txt, /Μαμά/, 'η επαφή χωρίς ακίνητο φαίνεται στο «Με ακίνητο»');
  assert.match(await a.page.locator('#pc-go').innerText(), /Πέρασε 3 επαφές/);
  await a.page.locator('[data-act="separate"]').click();
  await a.page.locator('#pc-go').click();
  await a.page.waitForTimeout(500);
  assert.equal(imported.src, 'Google');
  assert.equal(imported.items.length, 3, 'πήγε και η επαφή χωρίς ακίνητο');
  assert.deepEqual(imported.items.map((x) => x.action), ['merge', 'separate', 'auto']);
  assert.equal(imported.items[0].target, 'K1');
  assert.deepEqual(imported.items.map((x) => x.codes), [['A-12'], ['A-12'], ['A-12']]);
  assert.deepEqual(a.errors, []);
  assert.match(await a.page.locator('#pc-body').innerText(), /Νέες 1 · Συγχωνεύτηκαν 1 · Περιμένουν απόφαση 1/);
  await a.page.locator('#pcbox [data-pop-close]').click();
  await a.page.waitForTimeout(300);
  // Στην επαφή: «Αποθήκευση στο κινητό»
  await a.page.evaluate(() => openContact('C2'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#btn-ct-phone').isHidden(), false);
  assert.match(await a.page.locator('#btn-ct-phone').innerText(), /Αποθήκευση στο κινητό/);
  await a.page.evaluate(() => closeSheet('contact'));
  // Στο ακίνητο: «Ενδιαφερόμενοι (1)»
  await a.page.evaluate(() => openProp('A-12'));
  await a.page.waitForTimeout(400);
  assert.match(await a.page.locator('#pd-interest').innerText(), /Ενδιαφερόμενοι \(1\)/);
  await a.page.locator('#pd-interest').click();
  await a.page.waitForTimeout(300);
  assert.match(await a.page.locator('#pc-body').innerText(), /Γιώργος Λάμπρου/);
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});

test('2.17: χωρίς flag phoneContacts: καμία κάρτα, κανένα κουμπί, κανένα αίτημα', { skip }, async () => {
  const a = await openApp({}, null, {}, { contacts: () => [{ id: 'C2', name: 'Γ', phones: ['6900000002'], codes: [{ code: 'A-12' }] }] });
  await a.page.evaluate(() => goto('contacts'));
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.locator('#pc-card').isHidden(), true);
  await a.page.evaluate(() => openProp('A-12'));
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#pd-interest').isHidden(), true);
  assert.ok(!a.sent.some((x) => /^pc/.test(x)), 'στάλθηκε αίτημα pc* χωρίς flag');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
});
