// 2.9 · Πίνακας προόδου: η καθαρή λογική του dash.js (περίοδοι, στόχοι, ρυθμός, ποσά).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { Date, Math, JSON, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../dash.js', import.meta.url), 'utf8'), ctx, { filename: 'dash.js' });
const D = ctx.kwDash;

const mx = {
  configured: true,
  metrics: [{ key: 'showSale', group: 'showings', label: 'Υπόδειξη πώλησης' }, { key: 'buyer', group: 'clients', label: 'Ραντεβού αγοραστή' }],
  groups: [{ key: 'clients', label: 'Αγοραστές' }, { key: 'showings', label: 'Υποδείξεις' }],
  months: [
    { ym: '2026-11', values: { showSale: 4, buyer: 2 }, weeks: [
      { label: '02/11 – 08/11', start: '2026-11-02', end: '2026-11-08', values: { showSale: 1, buyer: 2 } },
      { label: '09/11 – 15/11', start: '2026-11-09', end: '2026-11-15', values: { showSale: 3, buyer: 0 } }] },
    { ym: '2026-03', values: { showSale: 6, buyer: 1 }, weeks: [{ label: '02/03 – 08/03', start: '2026-03-02', end: '2026-03-08', values: { showSale: 6, buyer: 1 } }] },
    { ym: '2025-12', values: { showSale: 9, buyer: 9 }, weeks: [{ label: '01/12 – 07/12', start: '2025-12-01', end: '2025-12-07', values: { showSale: 9, buyer: 9 } }] }
  ]
};
const now = new Date(2026, 10, 16);

test('ποσά σε ελληνική μορφή', () => {
  assert.equal(D.money(23400), '23.400 €');
  assert.equal(D.money(1234.5), '1.234,50 €');
  assert.equal(D.money(0), '0 €');
  assert.equal(D.money(1000000), '1.000.000 €');
});

test('περίοδοι: τελευταία εβδομάδα, τρέχων μήνας, τρέχον έτος', () => {
  const w = D.periodData(mx, 'w', now);
  assert.equal(w.values.showSale, 3); assert.equal(w.label, 'Εβδομάδα 09/11 – 15/11'); assert.equal(w.frac, 1);
  const m = D.periodData(mx, 'm', now);
  assert.equal(m.values.showSale, 4); assert.equal(m.frac, 0.5);          // οι υποβολές φτάνουν ως τις 15 από 30
  const y = D.periodData(mx, 'y', now);
  assert.equal(y.values.showSale, 10); assert.equal(y.values.buyer, 3);   // χωρίς τον Δεκέμβριο του 2025
  assert.ok(y.frac > 0.87 && y.frac < 0.88);                              // 15/11 = μέρα 319 από 365
  const empty = D.periodData({ months: [] }, 'm', now);
  assert.equal(empty.has, false); assert.equal(empty.frac, 0);
});

test('στόχοι: ποσοστό και πρόβλεψη με τον ίδιο ρυθμό', () => {
  const goals = { showSale: { w: 2, m: 10, y: 96 }, rev: { y: 60000 } };
  const rows = D.goalRows(mx.metrics, goals, 'm', D.periodData(mx, 'm', now));
  assert.equal(rows.length, 1);                                           // μόνο όσοι έχουν στόχο· ποτέ ο τζίρος
  assert.equal(rows[0].pct, 0.4); assert.equal(rows[0].proj, 0.8);
  assert.equal(D.paceText('m', rows[0].proj), 'Με αυτόν τον ρυθμό κλείνεις τον μήνα στο 80%');
  const wk = D.goalRows(mx.metrics, goals, 'w', D.periodData(mx, 'w', now));
  assert.equal(wk[0].pct, 1.5); assert.equal(wk[0].proj, null);           // η εβδομάδα έχει κλείσει: χωρίς πρόβλεψη
  assert.equal(D.overall(wk), 1);                                         // κάθε δείκτης μετρά έως 100%
  assert.equal(D.overall([]), null);
});

test('σύνολα ανά ομάδα για το γράφημα', () => {
  const g = D.groupTotals(mx, D.periodData(mx, 'm', now).values);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), [{ key: 'clients', label: 'Αγοραστές', total: 2 }, { key: 'showings', label: 'Υποδείξεις', total: 4 }]);
});
