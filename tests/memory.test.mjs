// FEAT-9 · Smart Form Memory: tests του memory.js σε απομονωμένο περιβάλλον
// (ψεύτικο localStorage, ίδιο fold() με το app.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../memory.js', import.meta.url), 'utf8');

function load(flags = { smartMemory: true }) {
  const mem = new Map();
  const ctx = {
    S: { flags, pf: { id: 'L1', data: {} } },
    store: (k, v) => { if (v === undefined) return mem.get(k) || ''; if (v === null) mem.delete(k); else mem.set(k, v); return ''; },
    fold: (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^0-9A-ZΑ-Ω@.]+/g, ' '),
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    fmtPrice: (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €',
    $: () => null, Date, Math, JSON, Number, String, Object
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'memory.js' });
  return ctx;
}
const top = (c, kind) => Array.from(c.memTop(kind, [], 10), (e) => e.t);

test('κλειστό flag: δεν μαθαίνει και δεν δείχνει τίποτα (καμία αλλαγή για τον χρήστη)', () => {
  const c = load({});
  c.memLearn('L1', 'areasBuy', 'Παγκράτι');
  assert.equal(c.store('kw_mem'), '');
  assert.equal(c.memChips('areasBuy', {}), '');
});

test('χωρίς ιστορικό δεν εμφανίζεται γραμμή chips', () => {
  assert.equal(load().memChips('areasBuy', {}), '');
});

test('χωρίζει περιοχές με κόμμα, /, «και» και αγνοεί αριθμούς-τηλέφωνα', () => {
  const c = load();
  assert.deepEqual(Array.from(c.memSplitAreas('Παγκράτι, Βύρωνας / Ν. Σμύρνη και Καλλιθέα, 6941234567')),
    ['Παγκράτι', 'Βύρωνας', 'Ν. Σμύρνη', 'Καλλιθέα']);
});

test('ίδιος πελάτης + ίδια περιοχή μετράει μία φορά· διαφορετικοί πελάτες αθροίζονται', () => {
  const c = load();
  c.memLearn('L1', 'areasBuy', 'Γλυφάδα');
  c.memLearn('L1', 'areasBuy', 'Γλυφάδα, Βούλα');
  c.memLearn('L2', 'areasRent', 'γλυφάδα');           // χωρίς τόνο/κεφαλαία = ίδια περιοχή
  const b = JSON.parse(c.store('kw_mem')).areas;
  assert.equal(b['ΓΛΥΦΑΔΑ'].n, 2);
  assert.equal(b['ΒΟΥΛΑ'].n, 1);
  assert.equal(top(c, 'areas')[0], 'γλυφάδα');          // κρατά την τελευταία γραφή
});

test('ταξινόμηση: πιο συχνή πρώτη, και οι παλιές «ξεθωριάζουν»', () => {
  const c = load();
  const now = Date.now(), old = now - 365 * 864e5;
  ['A', 'B', 'C'].forEach((l) => c.memLearn(l, 'areasBuy', 'Κηφισιά', old));   // 3 φορές πριν 1 χρόνο
  ['D', 'E'].forEach((l) => c.memLearn(l, 'areasBuy', 'Μαρούσι', now));        // 2 φορές τώρα
  assert.deepEqual(Array.from(c.memTop('areas', [], 5, now), (e) => e.t), ['Μαρούσι', 'Κηφισιά']);
});

test('chips περιοχών: έως 5, χωρίς όσες είναι ήδη γραμμένες στο πεδίο', () => {
  const c = load();
  ['Α1', 'Α2', 'Α3', 'Α4', 'Α5', 'Α6', 'Α7'].forEach((a, i) => c.memLearn('L' + i, 'areasBuy', a));
  const html = c.memChips('areasBuy', { areasBuy: 'Α1, α2' });
  assert.equal((html.match(/data-pf-memv=/g) || []).length, 5);
  assert.doesNotMatch(html, /data-pf-memv="Α1"/);
  assert.doesNotMatch(html, /data-pf-memv="Α2"/);
  assert.match(html, /Συχνά:/);
});

test('budget: έως 3 chips, ξεχωριστά για αγορά και ενοίκιο, με μορφή τιμής', () => {
  const c = load();
  [250000, 250000, 300000, 180000, 400000].forEach((v, i) => c.memLearn('L' + i, 'budgetBuy', v));
  c.memLearn('R1', 'budgetRent', 900);
  const html = c.memChips('budgetBuy', {});
  assert.equal((html.match(/data-pf-memv=/g) || []).length, 3);
  assert.match(html, /250\.000 €/);
  assert.doesNotMatch(html, /900/);
  assert.match(c.memChips('budgetRent', {}), /900 €/);
});

test('αγνοεί άκυρα ποσά και άγνωστα πεδία', () => {
  const c = load();
  c.memLearn('L1', 'budgetBuy', 0);
  c.memLearn('L1', 'budgetBuy', 'abc');
  c.memLearn('L1', 'name', 'Γιώργος');                 // όνομα πελάτη: ΠΟΤΕ στη μνήμη
  assert.equal(c.store('kw_mem'), '');
});

test('όριο μεγέθους: κρατά έως 30 τιμές ανά είδος', () => {
  const c = load();
  for (let i = 0; i < 45; i++) c.memLearn('L' + i, 'areasBuy', 'Περιοχή ' + String.fromCharCode(0x391 + (i % 24)) + Math.floor(i / 24));
  assert.ok(Object.keys(JSON.parse(c.store('kw_mem')).areas).length <= 30);
});

test('ασφάλεια HTML: όνομα περιοχής με < > δεν σπάει τη σελίδα', () => {
  const c = load();
  c.memLearn('L1', 'areasBuy', '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(c.memChips('areasBuy', {}), /<img/);
});
