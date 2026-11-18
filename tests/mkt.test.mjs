// 2.10 · Marketing: καθαρή λογική του mkt.js, του Marketing.js και έλεγχος των προτύπων.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const ctx = { Date, Math, JSON, console, Uint8Array, String, Array, Object, Number, Promise, encodeURI, encodeURIComponent, unescape };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('mkt.js', ROOT), 'utf8'), ctx, { filename: 'mkt.js' });
const M = ctx.kwMkt;

// Ψεύτικη μέτρηση: κάθε χαρακτήρας = 0,5 × μέγεθος.
const meas = (s, size, L) => s.length * size * 0.5 + (L && L.ls ? L.ls * size * Math.max(0, s.length - 1) : 0);

test('κεφαλαία χωρίς τόνους, με διαλυτικά', () => {
  assert.equal(M.upperGr('Ενοικιάζεται'), 'ΕΝΟΙΚΙΑΖΕΤΑΙ');
  assert.equal(M.upperGr('Πωλείται'), 'ΠΩΛΕΙΤΑΙ');
  assert.equal(M.upperGr('προϊόν'), 'ΠΡΟΪΟΝ');
  assert.equal(M.upperGr('Αγίου Μελετίου 12, Κυψέλη'), 'ΑΓΙΟΥ ΜΕΛΕΤΙΟΥ 12, ΚΥΨΕΛΗ');
});

test('συναλλαγή → ετικέτα', () => {
  assert.equal(M.dealLabel('Ενοικίαση'), 'ΕΝΟΙΚΙΑΖΕΤΑΙ');
  assert.equal(M.dealLabel('Μίσθωση'), 'ΕΝΟΙΚΙΑΖΕΤΑΙ');
  assert.equal(M.dealLabel('Πώληση'), 'ΠΩΛΕΙΤΑΙ');
  assert.equal(M.dealLabel('ΠΩΛΗΣΗ'), 'ΠΩΛΕΙΤΑΙ');
  assert.equal(M.dealLabel(''), '');
  assert.equal(M.dealLabel(undefined), '');
});

test('λινκ: προσθέτει https, απορρίπτει ό,τι δεν είναι λινκ, σέβεται τα επιτρεπτά domains', () => {
  assert.deepEqual({ ...M.checkLink('kwac.gr/akinito/123') }, { ok: true, url: 'https://kwac.gr/akinito/123' });
  assert.equal(M.checkLink('').url, '');
  assert.equal(M.checkLink('').ok, true);
  assert.equal(M.checkLink('γεια σου').ok, false);
  assert.equal(M.checkLink('http://localhost/x').ok, false);
  assert.equal(M.checkLink('javascript:alert(1)').ok, false);
  assert.equal(M.checkLink('https://www.kwac.gr/x', ['kwac.gr']).ok, true);
  assert.equal(M.checkLink('https://listings.kwac.gr/x', ['kwac.gr']).ok, true);
  assert.equal(M.checkLink('https://evilkwac.gr/x', ['kwac.gr']).ok, false);
  assert.equal(M.checkLink('https://spitogatos.gr/x', ['kwac.gr', 'zadeshome.com']).ok, false);
  assert.equal(M.checkLink('https://x.gr/' + 'a'.repeat(600)).ok, false);
});

test('Open House: ελληνική ημέρα και ώρες', () => {
  assert.equal(M.ohLine('2026-12-05', '13:00', '16:00'), '13:00 – 16:00 / ΣΑΒΒΑΤΟ 05.12.2026');
  assert.equal(M.ohLine('2026-12-06', '11:00', ''), '11:00 / ΚΥΡΙΑΚΗ 06.12.2026');
  assert.equal(M.ohLine('', '', ''), '');
});

test('placeholders και διεύθυνση', () => {
  assert.equal(M.fill('Κωδικός: {code} {nope}', { code: '2691190' }), 'Κωδικός: 2691190 ');
  assert.equal(M.address({ street: 'Ερατοσθένους 5', area: 'Παγκράτι' }), 'Ερατοσθένους 5, Παγκράτι');
  assert.equal(M.address({ area: 'Παγκράτι' }), 'Παγκράτι');
});

test('πρόταση περιγραφής: χρησιμοποιεί μόνο ό,τι υπάρχει', () => {
  assert.equal(M.draftDesc({ type: 'Διαμέρισμα', sqm: 118, area: 'Κορυδαλλός', price: 750, deal: 'Ενοικίαση' }),
    'Διαμέρισμα 118 τ.μ., Κορυδαλλός. Μίσθωμα 750 €/μήνα.');
  assert.equal(M.draftDesc({ type: 'Μονοκατοικία', sqm: 210, price: 450000 }, 'Πώληση'), 'Μονοκατοικία 210 τ.μ. Τιμή 450.000 €.');
  assert.ok(M.draftDesc({}).length > 0);
});

test('λεζάντα: στοιχεία, λινκ, hashtags και #περιοχή', () => {
  const c = M.caption({ code: 'A-12', type: 'Διαμέρισμα', sqm: 80, area: 'Νέα Σμύρνη' },
    { deal: 'ΠΩΛΕΙΤΑΙ', desc: 'Φωτεινό 2άρι.' }, 'https://kwac.gr/a12', '#kw');
  assert.match(c, /^Πωλειται · Διαμέρισμα · 80 τ\.μ\. · Νέα Σμύρνη/);
  assert.match(c, /Κωδικός: A-12\nhttps:\/\/kwac\.gr\/a12\n\n#kw #ΝέαΣμύρνη$/);
});

test('σπάσιμο γραμμών: λέξεις, παράγραφοι, πολύ μεγάλη λέξη', () => {
  const m = (s) => s.length * 10;
  assert.deepEqual([...M.wrap(m, 'ένα δύο τρία', 70)], ['ένα δύο', 'τρία']);
  assert.deepEqual([...M.wrap(m, 'α\nβ', 100)], ['α', 'β']);
  const long = M.wrap(m, 'αααααααααααα', 50);
  assert.ok(long.length >= 3 && long.every((l) => m(l) <= 50));
});

test('διάταξη κειμένου: μικραίνει ώσπου να χωρέσει, δεν πέφτει κάτω από το ελάχιστο', () => {
  const L = { text: '{desc}', w: 400, h: 120, size: 40, lh: 1.2, fit: true, minSize: 20 };
  const short = M.layoutText(meas, L, {}, { desc: 'Μικρό' });
  assert.equal(short.size, 40);
  assert.equal(short.overflow, false);
  const long = M.layoutText(meas, L, {}, { desc: 'Διαμπερές οροφοδιαμέρισμα 118 τ.μ. 1ου ορόφου στον Κορυδαλλό με τρία υπνοδωμάτια' });
  assert.ok(long.size < 40 && long.size >= 20);
  assert.equal(long.overflow, false);
  assert.ok(long.lines.length * long.size * 1.2 <= 120.5);
  const huge = M.layoutText(meas, L, {}, { desc: 'λέξη '.repeat(200) });
  assert.equal(huge.size, 20);
  assert.equal(huge.overflow, true, 'πρέπει να δείξει κόκκινο πλαίσιο');
});

test('διάταξη: το μέγεθος του μεσίτη υπερισχύει της αυτόματης σμίκρυνσης', () => {
  const L = { text: '{desc}', w: 200, h: 50, size: 40, fit: true };
  const r = M.layoutText(meas, L, { size: 60 }, { desc: 'πολύ μεγάλο κείμενο εδώ' });
  assert.equal(r.size, 60);
  assert.equal(r.overflow, true);
});

test('διάταξη: πρόθεμα, κενό κείμενο, κεφαλαία, μία γραμμή', () => {
  const L = { text: '{code}', prefix: 'Κωδικός ακινήτου: ', w: 2000, h: 60, size: 40, maxLines: 1 };
  assert.deepEqual([...M.layoutText(meas, L, {}, { code: '123' }).lines], ['Κωδικός ακινήτου: 123']);
  assert.equal(M.layoutText(meas, L, {}, { code: '' }).empty, true, 'χωρίς κωδικό δεν γράφεται ούτε το «Κωδικός:»');
  const U = { text: '{address}', w: 4000, h: 60, size: 30, upper: true, maxLines: 1 };
  assert.equal(M.layoutText(meas, U, {}, { address: 'Οδός Ηρώων 3,\nΚυψέλη' }).lines[0], 'ΟΔΟΣ ΗΡΩΩΝ 3, ΚΥΨΕΛΗ');
  assert.equal(M.layoutText(meas, U, { text: 'δικό μου' }, {}).lines[0], 'ΔΙΚΟ ΜΟΥ');
});

test('φωτογραφία cover: γεμίζει το πλαίσιο και μετακινείται με fx/fy', () => {
  const c = M.coverRect(1600, 1000, 500, 500, 0.5, 0.5);
  assert.equal(Math.round(c.sw), 1000); assert.equal(Math.round(c.sh), 1000);
  assert.equal(Math.round(c.sx), 300); assert.equal(c.sy, 0);
  assert.equal(M.coverRect(1600, 1000, 500, 500, 0, 0.5).sx, 0);
  assert.equal(Math.round(M.coverRect(1600, 1000, 500, 500, 1, 0.5).sx), 600);
  assert.equal(Math.round(c.exW), 300); assert.equal(c.exH, 0);
});

test('πάτημα: βρίσκει το πάνω-πάνω κείμενο ή φωτογραφία, με τη μετακίνηση του μεσίτη', () => {
  const tpl = { layers: [
    { id: 'ph', type: 'photo', x: 0, y: 0, w: 100, h: 100 }, { type: 'bg' },
    { id: 'tx', type: 'text', x: 10, y: 10, w: 50, h: 20, size: 10 }, { id: 'qr', type: 'qr', x: 70, y: 70, w: 20, h: 20 }] };
  assert.equal(M.hit(tpl, {}, 20, 20), 'tx');
  assert.equal(M.hit(tpl, {}, 50, 80), 'ph');
  assert.equal(M.hit(tpl, {}, 80, 80), 'ph', 'το QR δεν αλλάζει, πατιέται ό,τι είναι από κάτω');
  assert.equal(M.hit(tpl, {}, 300, 300), null);
  assert.equal(M.hit(tpl, { tx: { dx: 200, dy: 200 } }, 220, 220), 'tx');
});

test('φωτογραφίες: εξώφυλλο πρώτο, επανάληψη όταν είναι λίγες, επιλογή του μεσίτη', () => {
  const order = M.photoOrder({ photos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], cover: 'c' });
  assert.deepEqual([...order], ['c', 'a', 'b']);
  assert.equal(M.slotPhoto(order, 0, null), 'c');
  assert.equal(M.slotPhoto(order, 4, null), 'a');
  assert.equal(M.slotPhoto(order, 0, { pick: 'b' }), 'b');
  assert.equal(M.slotPhoto(order, 0, { pick: 'σβησμένη' }), 'c');
  assert.equal(M.slotPhoto([], 0, null), '');
});

test('PDF: έγκυρη δομή, πατήσιμο λινκ, σωστά offsets στο xref', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const b = M.pdfBytes(jpeg, 1742, 2458, 'https://kwac.gr/a(1)', { x: 90, y: 1715, w: 315, h: 315 });
  const s = Buffer.from(b).toString('latin1');
  assert.match(s, /^%PDF-1\.4/);
  assert.match(s, /\/Subtype \/Link/);
  assert.match(s, /\/URI \(https:\/\/kwac\.gr\/a\\\(1\\\)\)/);
  assert.match(s, /%%EOF\n$/);
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.equal(s.slice(o, o + String(i + 1).length + 6), (i + 1) + ' 0 obj'));
  assert.ok(!/\/Annots/.test(Buffer.from(M.pdfBytes(jpeg, 10, 10, '', null)).toString('latin1')), 'χωρίς λινκ, χωρίς annotation');
});

// ── Τα πρότυπα του repo (marketing/templates) ──

const TDIR = new URL('marketing/templates/', ROOT);
const tpls = readdirSync(TDIR).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, TDIR), 'utf8'))]);

test('πρότυπα: έγκυρα, με φόντο, μέσα στα όρια, ασφαλείς ζώνες στο story', () => {
  assert.ok(tpls.length >= 4);
  const files = readdirSync(TDIR);
  for (const [f, t] of tpls) {
    assert.equal(f, t.id + '.json', f);
    assert.ok(M.validTpl(t), f + ': δεν περνά τον έλεγχο του mkt.js');
    assert.ok(files.includes(t.bg), f + ': λείπει ' + t.bg);
    const ids = t.layers.filter((L) => L.id).map((L) => L.id);
    assert.equal(new Set(ids).size, ids.length, f + ': διπλό id');
    assert.equal(t.layers.filter((L) => L.type === 'bg').length, 1, f + ': ένα φόντο');
    for (const L of t.layers.filter((x) => x.type !== 'bg')) {
      assert.ok(L.x >= -1 && L.y >= -1 && L.x + L.w <= t.w + 20 && L.y + L.h <= t.h + 20, f + ': ' + L.id + ' έξω από τη σελίδα');
    }
    if (t.safe) {
      for (const L of t.layers.filter((x) => x.type === 'text' || x.type === 'qr')) {
        assert.ok(L.y >= t.safe.top && L.y + L.h <= t.h - t.safe.bottom, f + ': ' + L.id + ' μπαίνει κάτω από τα κουμπιά του Instagram');
      }
    }
  }
  const story = tpls.find(([, t]) => t.id === 'story')[1];
  assert.equal(story.w / story.h, 9 / 16);
});

test('πρότυπα: ο έλεγχος απορρίπτει σπασμένα', () => {
  assert.equal(M.validTpl(null), false);
  assert.equal(M.validTpl({ id: 'x', w: 10, h: 10, bg: 'a.png', layers: [{ id: 't', type: 'text', x: 0, y: 0, w: 1, h: 1 }] }), false, 'κείμενο χωρίς μέγεθος');
  assert.equal(M.validTpl({ id: 'x', w: 10, h: 10, bg: 'a.png', layers: [{ id: 'v', type: 'video', x: 0, y: 0, w: 1, h: 1 }] }), false);
  assert.equal(M.validTpl({ id: 'x', w: 10, h: 10, bg: 'a.png', layers: [{ type: 'bg' }] }), true);
});

// ── Server (apps-script/Marketing.js) ──

function server(props = {}) {
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  const sctx = {
    console, Date, JSON, Math, ACTIONS: {}, TZ: 'Europe/Athens',
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 16) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    CacheService: noop, LockService: noop, DriveApp: noop
  };
  vm.createContext(sctx);
  vm.runInContext(readFileSync(new URL('apps-script/Marketing.js', ROOT), 'utf8'), sctx, { filename: 'Marketing.js' });
  return sctx;
}

test('server: οι 4 ενέργειες γράφονται στο ACTIONS', () => {
  const s = server();
  assert.deepEqual(Object.keys(s.ACTIONS).sort(), ['mktAsset', 'mktGet', 'mktLog', 'mktSave']);
});

test('server: καθαρισμός περιγραφής', () => {
  const s = server();
  assert.equal(s.mktCleanText_('  α\r\nβ\u0007\n\n\n\nγ  ', 260), 'α\nβ\n\nγ');
  assert.equal(s.mktCleanText_('x'.repeat(400), 260).length, 260);
  assert.equal(s.mktCleanText_(null, 10), '');
});

test('server: λινκ με τους ίδιους κανόνες με το κινητό', () => {
  const s = server({ MKT_LINK_HOSTS: 'kwac.gr, www.zadeshome.com' });
  assert.equal(s.mktCleanLink_('kwac.gr/a'), 'https://kwac.gr/a');
  assert.equal(s.mktCleanLink_('https://www.zadeshome.com/x'), 'https://www.zadeshome.com/x');
  assert.equal(s.mktCleanLink_(''), '');
  assert.throws(() => s.mktCleanLink_('https://spitogatos.gr/x'), /kwac\.gr/);
  assert.throws(() => s.mktCleanLink_('javascript:alert(1)'), /λινκ/);
  assert.equal(server().mktCleanLink_('https://spitogatos.gr/x'), 'https://spitogatos.gr/x', 'χωρίς ρύθμιση: όλα');
});

test('server: μετρήσεις +1 ανά πρότυπο, χωρίς να αλλάζει το παλιό αντικείμενο', () => {
  const s = server();
  const a = { dl: { story: 2 } };
  const b = s.mktBump_(a, 'dl', 'story', new Date('2026-11-18T10:00:00Z'));
  const c = s.mktBump_(b, 'sh', 'brochure', new Date('2026-11-18T10:05:00Z'));
  assert.equal(a.dl.story, 2);
  assert.equal(c.dl.story, 3);
  assert.equal(c.sh.brochure, 1);
  assert.equal(c.last, '2026-11-18T10:05');
  assert.equal(s.mktBump_(null, 'dl', 'x', new Date()).dl.x, 1);
});
