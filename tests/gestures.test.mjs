// FEAT-2 / FEAT-6 · Κινήσεις δαχτύλου: προσομοίωση αφής πάνω σε ψεύτικη γραμμή κλήσης.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../gestures.js', import.meta.url), 'utf8');
const ST = { PENDING: 'Αναπάντητη', ANSWERED: 'Απαντημένη', NO_ANSWER: 'Δεν απάντησε', SHOWING: 'Υπόδειξη', CLOSED: 'Κλειστή' };

function el(tag) {
  const e = { tag, children: [], h: {}, dataset: {}, style: {}, className: '', textContent: '', hidden: false, innerHTML: '',
    classList: { add(c) { e.className += ' ' + c; } },
    addEventListener(n, f) { (e.h[n] = e.h[n] || []).push(f); },
    appendChild(c) { e.children.push(c); c.parent = e; return c; },
    querySelector(s) { return s === '.gst-hint' ? e.children.find((c) => /gst-hint/.test(c.className) && !c.gone) || null : null; },
    setAttribute() {}, remove() { e.gone = true; } };
  return e;
}

function setup({ flags = { swipeRows: true, peekProp: true }, lead = { id: 'L1', name: 'Μαρία', status: ST.PENDING, code: 'A-12' } } = {}) {
  const calls = [];
  let now = 0; const timers = [];
  const row = el('button'); row.dataset.id = lead.id; row.offsetWidth = 300;
  row.onclick = () => calls.push(['open', lead.id]);
  const list = { querySelectorAll: () => [row] };
  const toastEl = el('div');
  const ctx = {
    S: { flags, props: [{ code: 'a-12' }] }, ST, console,
    feat: (n) => !!flags[n], findLead: (id) => (id === lead.id ? lead : null), hasShowing: (l) => l.status === ST.SHOWING,
    normCode: (s) => String(s).toUpperCase(),
    showLead: (l) => calls.push(['showLead', l.id]), openShowingForm: () => calls.push(['showingForm']),
    openProp: (c) => calls.push(['prop', c]), merge() {}, render() {},
    toast: (m, err) => calls.push(['toast', m, !!err]),
    send: (a, d) => { calls.push(['send', a, d.status]); return Promise.resolve({ data: { id: d.id }, queued: false }); },
    $: (id) => (id === 'toast' ? toastEl : null),
    document: { createElement: el, createTextNode: (t) => ({ text: t }) },
    navigator: {}, store: () => '1',          // «💡 Νέο» ήδη εμφανίστηκε
    setTimeout: (f, ms) => { timers.push({ at: now + ms, f }); return timers.length; },
    clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].f = null; }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.wireGestures(list);
  const fire = (n, x, y) => (row.h[n] || []).forEach((f) => f({ touches: [{ clientX: x, clientY: y }], preventDefault() {} }));
  const tick = (ms) => { now += ms; timers.filter((t) => t.f && t.at <= now).forEach((t) => { const f = t.f; t.f = null; f(); }); };
  const swipe = (dx, dy = 0) => { fire('touchstart', 150, 100); [0.3, 0.6, 1].forEach((k) => fire('touchmove', 150 + dx * k, 100 + dy * k)); fire('touchend'); };
  return { row, calls, fire, tick, swipe, toastEl, ctx };
}

test('κλειστά flags: η γραμμή μένει όπως πριν', () => {
  const s = setup({ flags: {} });
  assert.equal(s.row.h.touchstart, undefined);
  s.row.onclick({});
  assert.deepEqual(s.calls, [['open', 'L1']]);
});

test('απλό πάτημα ανοίγει την κλήση όπως πάντα', () => {
  const s = setup();
  s.fire('touchstart', 10, 10); s.fire('touchend'); s.row.onclick({ preventDefault() {} });
  assert.deepEqual(s.calls, [['open', 'L1']]);
});

test('→ δεξιά πάνω από το όριο: φόρμα υπόδειξης, χωρίς να ανοίξει και η κλήση από το click', () => {
  const s = setup();
  s.swipe(140);
  s.row.onclick({ preventDefault() {} });
  assert.deepEqual(s.calls, [['showLead', 'L1'], ['showingForm']]);
});

test('κοντό σύρσιμο: τίποτα', () => {
  const s = setup();
  s.swipe(60);
  assert.deepEqual(s.calls.filter((c) => c[0] !== 'open'), []);
});

test('κάθετη κίνηση = scroll: τίποτα', () => {
  const s = setup();
  s.swipe(40, 200);
  s.tick(5000);
  assert.deepEqual(s.calls, []);
});

test('← αριστερά: «Δεν απάντησε» στέλνεται μόνο μετά από 4″', async () => {
  const s = setup();
  s.swipe(-140);
  assert.equal(s.calls.filter((c) => c[0] === 'send').length, 0);
  assert.ok(s.toastEl.children.some((c) => c.textContent === 'Αναίρεση'));
  s.tick(4000);
  await Promise.resolve();
  assert.deepEqual(s.calls.filter((c) => c[0] === 'send'), [['send', 'status', ST.NO_ANSWER]]);
});

test('← αριστερά + «Αναίρεση»: δεν στέλνεται ποτέ', () => {
  const s = setup();
  s.swipe(-140);
  s.toastEl.children.find((c) => c.className === 'gst-undo').onclick();
  s.tick(10000);
  assert.equal(s.calls.filter((c) => c[0] === 'send').length, 0);
  assert.ok(s.calls.some((c) => c[0] === 'toast' && c[1] === 'Ακυρώθηκε'));
});

test('← αριστερά σε κλήση με υπόδειξη ή κλειστή: τίποτα', () => {
  for (const status of [ST.SHOWING, ST.CLOSED]) {
    const s = setup({ lead: { id: 'L1', status, code: 'A-12' } });
    s.swipe(-140); s.tick(5000);
    assert.equal(s.calls.filter((c) => c[0] === 'send').length, 0, status);
  }
});

test('παρατεταμένο πάτημα: καρτέλα ακινήτου, χωρίς να ανοίξει η κλήση', () => {
  const s = setup();
  s.fire('touchstart', 50, 50);
  s.tick(600);
  s.fire('touchend');
  s.row.onclick({ preventDefault() {} });
  assert.deepEqual(s.calls, [['prop', 'a-12']]);
});

test('παρατεταμένο πάτημα σε κλήση χωρίς γνωστό ακίνητο: καθαρό μήνυμα', () => {
  const s = setup({ lead: { id: 'L1', status: ST.PENDING, code: 'ZZZ' } });
  s.fire('touchstart', 50, 50); s.tick(600);
  assert.ok(s.calls.some((c) => c[0] === 'toast' && /δεν είναι στη λίστα/.test(c[1])));
});

test('κίνηση πριν το παρατεταμένο πάτημα το ακυρώνει', () => {
  const s = setup();
  s.fire('touchstart', 50, 50); s.fire('touchmove', 50, 90); s.tick(600);
  assert.equal(s.calls.filter((c) => c[0] === 'prop').length, 0);
});
