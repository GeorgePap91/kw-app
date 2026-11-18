// FEAT-29 · «Διαδρομή ημέρας»: ο υπολογισμός των στάσεων, το link του Maps και το κουμπί.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../dayroute.js', import.meta.url), 'utf8');
const ST = { PENDING: 'Αναπάντητη', SHOWING: 'Υπόδειξη', CLOSED: 'Κλειστή' };
const MIN = 60000;

// «Σήμερα» = 12/11/2026 08:00 τοπική ώρα
const NOW = new Date(2026, 10, 12, 8, 0, 0).getTime();
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function setup(flags = { dayRoute: true }) {
  const toasts = [], store = {};
  const ctx = {
    S: { flags, props: [] }, ST, console,
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    ico: (n) => '<svg data-i="' + n + '"></svg>',
    plural: (n, a, b) => n + ' ' + (n === 1 ? a : b),
    normCode: (s) => String(s).toUpperCase().replace(/\s+/g, ''),
    hasShowing: (l) => !!(l && l.hasEvent && l.showingDate),
    isoDate: iso,
    store: (k, v) => (v === undefined ? store[k] || null : (store[k] = v)),
    toast: (m) => toasts.push(m),
    setTimeout: (f) => { f(); return 1; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, K: ctx.kwRoute, toasts, store };
}

// υπόδειξη σήμερα στις hh:mm
const show = (id, hh, mm, extra = {}) => {
  const ts = new Date(2026, 10, 12, hh, mm).getTime();
  return { id, name: 'Πελάτης ' + id, status: ST.SHOWING, hasEvent: true, showingDate: '2026-11-12', showingTs: ts,
    showingTime: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), address: 'Οδός ' + id + ' 1, Αθήνα', code: 'K-' + id, ...extra };
};

test('σειρά ώρας, μόνο όσες δεν πέρασαν, μόνο σημερινές με κατάσταση «Υπόδειξη»', () => {
  const { K } = setup();
  const leads = [show('C', 15, 0), show('A', 7, 0), show('B', 10, 0),
    { ...show('X', 12, 0), showingDate: '2026-11-13' }, { ...show('Y', 13, 0), status: ST.CLOSED }];
  const p = K.plan(leads, [], NOW);
  assert.equal(p.today, 3);                                  // A, B, C (οι X, Y δεν μετρούν)
  assert.deepEqual([...p.stops.map((s) => s.id)], ['B', 'C']);    // η A (07:00) πέρασε
});

test('συντεταγμένες από το ακίνητο όπου υπάρχουν, αλλιώς η διεύθυνση ως κείμενο', () => {
  const { K } = setup();
  const props = [{ code: 'k-b', lat: 37.9715, lng: 23.7257 }, { code: 'K-C', lat: 0, lng: 0 }];
  const p = K.plan([show('B', 10, 0), show('C', 15, 0)], props, NOW);
  assert.equal(p.stops[0].place, '37.9715,23.7257');
  assert.equal(p.stops[1].place, 'Οδός C 1, Αθήνα, Ελλάδα');
});

test('χωρίς διεύθυνση και χωρίς συντεταγμένες: δεν μπαίνει, μετριέται', () => {
  const { K } = setup();
  const p = K.plan([show('B', 10, 0), show('C', 11, 0, { address: '', code: '' }), show('D', 12, 0)], [], NOW);
  assert.deepEqual([...p.stops.map((s) => s.id)], ['B', 'D']);
  assert.equal(p.noAddr, 1);
});

test('το link: τελευταία στάση = προορισμός, οι άλλες waypoints με %7C, χωρίς origin', () => {
  const { K } = setup();
  const p = K.plan([show('B', 10, 0), show('C', 11, 0), show('D', 12, 0)], [{ code: 'K-C', lat: 37.9, lng: 23.7 }], NOW);
  const u = K.url(p.stops);
  assert.match(u, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&travelmode=driving&destination=/);
  const q = new URL(u).searchParams;
  assert.equal(q.get('destination'), 'Οδός D 1, Αθήνα, Ελλάδα');
  assert.equal(q.get('waypoints'), 'Οδός B 1, Αθήνα, Ελλάδα|37.9,23.7');
  assert.ok(!q.has('origin'));
  assert.ok(u.includes('%7C'), 'το | πρέπει να είναι κωδικοποιημένο');
  assert.ok(!/api[_-]?key|key=/i.test(u), 'κανένα API key');
});

test('μία μόνο στάση: μόνο destination, χωρίς waypoints', () => {
  const { K } = setup();
  const u = K.url(K.plan([show('B', 10, 0)], [], NOW).stops);
  assert.ok(!u.includes('waypoints'));
  assert.equal(K.url([]), '');
});

test('όριο 9 στάσεις: οι πρώτες 9 κατά ώρα, οι υπόλοιπες μετριούνται', () => {
  const { K } = setup();
  const leads = Array.from({ length: 12 }, (_, i) => show('S' + i, 9 + Math.floor(i / 2), (i % 2) * 30));
  const p = K.plan(leads, [], NOW);
  assert.equal(p.stops.length, 9);
  assert.equal(p.extra, 3);
  assert.equal(p.stops[0].id, 'S0');
  assert.equal(new URL(K.url(p.stops)).searchParams.get('waypoints').split('|').length, 8);
});

test('«φύγε ~ώρα»: ώρα υπόδειξης − 30′· «φύγε τώρα» αν πέρασε η ώρα· «σφιχτό» αν δεν προλαβαίνει', () => {
  const { K } = setup();
  let p = K.plan([show('B', 10, 35), show('C', 12, 0)], [], NOW);
  assert.equal(p.leave.B, 'φύγε ~10:05');
  assert.equal(p.leave.C, 'φύγε ~11:30');
  p = K.plan([show('B', 8, 10), show('C', 8, 25)], [], NOW);          // 08:10 σε 10′ · η 08:25 απέχει 15′ από την πρώτη
  assert.equal(p.leave.B, 'φύγε τώρα');
  assert.equal(p.leave.C, 'σφιχτό πρόγραμμα');
});

test('κουμπί: ΜΟΝΟ με flag ανοιχτό και 2+ υποδείξεις σήμερα', () => {
  const two = [show('B', 10, 0), show('C', 11, 0)];
  const on = setup(); const off = setup({});
  const html = on.K.html(on.K.plan(two, [], NOW));
  assert.match(html, /Διαδρομή ημέρας/);
  assert.match(html, /data-dayroute/);
  assert.match(html, /target="_blank" rel="noopener"/);
  assert.match(html, /2 στάσεις · από 10:00 έως 11:00/);
  assert.equal(off.K.html(off.K.plan(two, [], NOW)), '', 'με κλειστό flag δεν φαίνεται');
  assert.equal(on.K.html(on.K.plan([show('B', 10, 0)], [], NOW)), '', 'με 1 υπόδειξη δεν φαίνεται');
  assert.equal(on.K.html(on.K.plan([show('A', 7, 0), show('B', 7, 30)], [], NOW)), '', 'αν πέρασαν όλες, δεν υπάρχει τι να δρομολογηθεί');
});

test('το κουμπί προειδοποιεί όταν μένουν έξω υποδείξεις', () => {
  const { K } = setup();
  const html = K.html(K.plan([show('B', 10, 0), show('C', 11, 0, { address: '', code: '' })], [], NOW));
  assert.match(html, /1 υπόδειξη χωρίς διεύθυνση δεν μπήκε/);
});

test('XSS: η διεύθυνση δεν σπάει το HTML του κουμπιού', () => {
  const { K } = setup();
  const html = K.html(K.plan([show('B', 10, 0, { address: '"><script>alert(1)</script>' }), show('C', 11, 0)], [], NOW));
  assert.ok(!html.includes('<script>'));
});

test('«💡 Νέο» εμφανίζεται μία φορά', () => {
  const { K, toasts, ctx } = setup();
  const root = { querySelector: () => ({}) };
  K.wire(root); K.wire(root);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /Διαδρομή ημέρας/);
  assert.equal(ctx.kwRoute !== undefined, true);
});

test('καμία δικτυακή κλήση: ο κώδικας δεν χρησιμοποιεί fetch/XHR/UrlFetch/beacon', () => {
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|UrlFetch|sendBeacon|W\.api\b|W\.send\b/.test(SRC.replace(/\/\/.*$/gm, '')));
});
