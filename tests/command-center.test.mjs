// Command Center · AutoDates.js: η καθαρή λογική και το onEdit με ψεύτικο φύλλο.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../command-center/AutoDates.js', import.meta.url), 'utf8');
const ctx = { Utilities: { formatDate: () => '2026-11-27' }, Date };
vm.createContext(ctx);
vm.runInContext(SRC, ctx, { filename: 'AutoDates.js' });
const run = (s) => vm.runInContext(s, ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const rule = (sheet, col) => run(`AUTO_DATE_RULES.find(r => r.sheet === '${sheet}' && r.watchCol === ${col})`);
const T = '2026-11-27';

test('Στόχοι: τσεκάρισμα γράφει σήμερα, ξετσεκάρισμα σβήνει, υπάρχουσα ημερομηνία μένει', () => {
  const r = rule('Στόχοι', 6);
  const out = run('autoDateCompute_')(r, [[true], [false], [true]], [[''], ['2026-11-20'], ['2026-11-20']], T);
  assert.deepEqual(plain(out), [[T], [''], ['2026-11-20']]);
});

test('Ιδέες: «Έτοιμο» γράφει, άλλη κατάσταση σβήνει, χωρίς αλλαγή επιστρέφει null', () => {
  const r = rule('Ιδέες', 10);
  const c = run('autoDateCompute_');
  assert.deepEqual(plain(c(r, [['Έτοιμο'], ['In Development']], [[''], ['2026-11-01']], T)), [[T], ['']]);
  assert.equal(c(r, [['Ιδέα']], [['']], T), null);
});

test('Ιδέες: νέα λειτουργία γράφει «Καταχωρήθηκε» μία φορά, το σβήσιμο τίτλου δεν το αγγίζει', () => {
  const r = rule('Ιδέες', 3);
  const c = run('autoDateCompute_');
  assert.deepEqual(plain(c(r, [['Νέα ιδέα']], [['']], T)), [[T]]);
  assert.equal(c(r, [['Νέα ιδέα']], [['2026-11-02']], T), null);
  assert.equal(c(r, [['']], [['2026-11-02']], T), null);
});

test('QA: κάθε νέο αποτέλεσμα ξαναγράφει την ημερομηνία, «Εκκρεμεί» τη σβήνει', () => {
  const r = rule('QA', 6);
  const c = run('autoDateCompute_');
  assert.deepEqual(plain(c(r, [['✗ Απέτυχε'], ['Εκκρεμεί'], ['✓ Πέρασε']], [['2026-11-20'], ['2026-11-20'], ['']], T)), [[T], [''], [T]]);
});

test('κανόνες ανά φύλλο και στήλη', () => {
  const f = run('autoDateRulesFor_');
  assert.equal(f('Ιδέες', 1, 14).length, 2);   // επικόλληση σε όλη τη γραμμή
  assert.equal(f('Ιδέες', 4, 1).length, 0);
  assert.equal(f('Αρχική', 1, 8).length, 0);
});

function fakeSheet(name, grid) {
  const writes = [];
  const range = (row, col, n) => ({
    getValues: () => Array.from({ length: n }, (_, i) => [grid[row - 1 + i][col - 1]]),
    setValues: (v) => { writes.push({ row, col, v }); v.forEach((x, i) => { grid[row - 1 + i][col - 1] = x[0]; }); }
  });
  return { writes, sheet: { getName: () => name, getRange: range } };
}

test('onEdit: επικόλληση 2 γραμμών μαζί με την κεφαλίδα, μία εγγραφή ανά κανόνα', () => {
  const grid = [
    ['Εβδομάδα', 'Ρόλος', 'Ποιος', 'Στόχος', 'Project', 'Έγινε', 'Ολοκληρώθηκε'],
    ['2026-W48', '', '', 'α', '', true, ''],
    ['2026-W48', '', '', 'β', '', false, '2026-11-20']
  ];
  const { writes, sheet } = fakeSheet('Στόχοι', grid);
  const e = {
    source: { getSpreadsheetTimeZone: () => 'Europe/Athens' },
    range: { getSheet: () => sheet, getRow: () => 1, getColumn: () => 6, getNumRows: () => 3, getNumColumns: () => 1 }
  };
  run('onEdit')(e);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row, 2);
  assert.deepEqual(grid.map((r) => r[6]), ['Ολοκληρώθηκε', T, '']);
});

test('onEdit: αλλαγή σε στήλη χωρίς κανόνα δεν διαβάζει τίποτα', () => {
  let reads = 0;
  const sheet = { getName: () => 'Ιδέες', getRange: () => { reads++; return {}; } };
  run('onEdit')({ range: { getSheet: () => sheet, getRow: () => 5, getColumn: () => 4, getNumRows: () => 1, getNumColumns: () => 1 } });
  assert.equal(reads, 0);
});
