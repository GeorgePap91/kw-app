// 2.19 · Reports: «Ροή του μήνα», «Πορεία» ακινήτου, νέα κατάσταση «Δεν ενδιαφέρθηκε», διόρθωση Εγγράφων.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../reports.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const CODE = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');

const ST = { PENDING: 'Αναπάντητη', ANSWERED: 'Απαντημένη', NO_ANSWER: 'Δεν απάντησε', SHOWING: 'Υπόδειξη', CLOSED: 'Κλειστή', NOT_INTERESTED: 'Δεν ενδιαφέρθηκε' };
const win = {};
vm.runInNewContext(SRC, { window: win });
const R = win.kwRep;

const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const L = (o) => Object.assign({ status: ST.PENDING, outcome: '', offer: '', showingTs: 0, ts: at(2026, 11, 10) }, o);

test('ταξινόμηση κλήσης: ενδιαφέρθηκε / δεν ενδιαφέρθηκε / σε αναμονή', () => {
  assert.equal(R.classify(L({ status: ST.ANSWERED }), ST), 'interested');
  assert.equal(R.classify(L({ status: ST.SHOWING }), ST), 'interested');
  assert.equal(R.classify(L({ status: ST.NOT_INTERESTED }), ST), 'notint');
  // δεν ενδιαφέρθηκε ΜΕΤΑ την υπόδειξη μετράει ως «δεν ενδιαφέρθηκε», όχι ως ενδιαφέρον
  assert.equal(R.classify(L({ status: ST.SHOWING, outcome: 'Δεν ενδιαφέρθηκε' }), ST), 'notint');
  assert.equal(R.classify(L({ status: ST.PENDING }), ST), 'waiting');
  assert.equal(R.classify(L({ status: ST.NO_ANSWER }), ST), 'waiting');
});

test('πορεία ακινήτου: ενδιαφέρθηκαν, όχι, υποδείξεις (έγιναν/έρχονται), προσφορές', () => {
  const now = at(2026, 11, 28);
  const leads = [
    L({ status: ST.ANSWERED }),
    L({ status: ST.SHOWING, showingTs: at(2026, 11, 20), outcome: 'Ενδιαφέρθηκε', offer: 'Υπογράφηκε' }),
    L({ status: ST.SHOWING, showingTs: at(2026, 12, 2) }),
    L({ status: ST.NOT_INTERESTED }),
    L({ status: ST.SHOWING, showingTs: at(2026, 11, 22), outcome: 'Δεν ενδιαφέρθηκε' }),
    L({ status: ST.NO_ANSWER }),
    L({ status: ST.ANSWERED, offer: 'Στάλθηκε' })
  ];
  const r = R.propProgress(leads, ST, now);
  assert.equal(r.calls, 7);
  assert.equal(r.interested, 4);
  assert.equal(r.notInterested, 2);
  assert.equal(r.waiting, 1);
  assert.equal(r.interested + r.notInterested + r.waiting, r.calls);
  assert.equal(r.showings, 3);
  assert.equal(r.showingsDone, 2);
  assert.equal(r.showingsUpcoming, 1);
  assert.equal(r.offers, 1);
  assert.equal(r.offersPending, 1);
});

test('πορεία ακινήτου χωρίς κλήσεις: όλα μηδέν, χωρίς σφάλμα', () => {
  const r = R.propProgress([], ST, Date.now());
  assert.deepEqual([r.calls, r.interested, r.notInterested, r.showings, r.offers], [0, 0, 0, 0, 0]);
});

test('κλήσεις του μήνα: μετράει μόνο τον ζητούμενο μήνα και τις ζητήσεις που συμπληρώθηκαν', () => {
  const leads = [
    L({ status: ST.ANSWERED, ts: at(2026, 11, 3) }),
    L({ status: ST.NOT_INTERESTED, ts: at(2026, 11, 5) }),
    L({ status: ST.PENDING, ts: at(2026, 11, 27) }),
    L({ status: ST.ANSWERED, ts: at(2026, 10, 30) })        // Οκτώβριος: δεν μπαίνει στον Νοέμβριο
  ];
  const demands = [
    { status: 'Συμπληρώθηκε', submittedTs: at(2026, 11, 8) },
    { status: 'Συμπληρώθηκε', submittedTs: at(2026, 10, 8) },   // άλλος μήνας
    { status: 'Στάλθηκε', submittedTs: 0 }                        // δεν έχει απαντηθεί ακόμα
  ];
  const r = R.monthCalls(leads, '2026-11', demands, ST);
  assert.deepEqual([r.calls, r.interested, r.notInterested, r.waiting, r.demands], [3, 1, 1, 1, 1]);
  assert.equal(R.monthCalls(leads, '2026-11', null, ST).demands, null);   // χωρίς φορτωμένες ζητήσεις: «—», όχι 0
});

test('οι μήνες των κλήσεων είναι ο τρέχων και ο προηγούμενος (και στην αλλαγή έτους)', () => {
  assert.deepEqual(Array.from(R.callMonths(at(2026, 11, 28))), ['2026-11', '2026-10']);
  assert.deepEqual(Array.from(R.callMonths(at(2027, 1, 5))), ['2027-01', '2026-12']);
});

test('ιδιοκτήτες: 1ο ραντεβού → 2ο ραντεβού → αποκλειστικές, με ποσοστά', () => {
  const f = R.ownerFunnel({ seller1: 6, landlord1: 4, seller2: 3, landlord2: 2, exclSale: 2, exclRentHi: 1, exclRentLo: 1, simpleSale: 5 });
  assert.deepEqual([f.first, f.second, f.excl], [10, 5, 4]);
  assert.equal(f.secondPct, 50);
  assert.equal(f.exclPct, 40);                       // οι απλές αναθέσεις ΔΕΝ μετρούν ως αποκλειστικές
  const z = R.ownerFunnel({});
  assert.deepEqual([z.first, z.second, z.excl, z.secondPct], [0, 0, 0, null]);   // χωρίς διαίρεση με το 0
});

test('νέα κατάσταση «Δεν ενδιαφέρθηκε»: υπάρχει στον server και στη σελίδα, και οι εκδόσεις ταιριάζουν', () => {
  assert.match(CODE, /NOT_INTERESTED: 'Δεν ενδιαφέρθηκε'/);
  assert.match(CODE, /STATUS_LIST = \[[^\]]*STATUS\.NOT_INTERESTED\]/);
  assert.match(APP, /NOT_INTERESTED: 'Δεν ενδιαφέρθηκε'/);
  const server = CODE.match(/const VERSION = '([\d.]+)'/)[1];
  const client = APP.match(/var API_VERSION = '([\d.]+)'/)[1];
  assert.equal(server, client);
});

test('Έγγραφα: το showPane δεν κρύβει τα εσωτερικά panes (Για live / Απαραίτητα)', () => {
  // Κόβουμε την πραγματική showPane από το app.js και τη δοκιμάζουμε πάνω σε μικρό «DOM».
  const src = APP.match(/function showPane\(container, value\) \{[\s\S]*?\n\}/)[0];
  // το closest μετράει και τον ίδιο τον κόμβο, όπως στον πραγματικό browser
  const mk = (pane, parent) => ({ dataset: { pane }, hidden: false, parentElement: parent, closest(sel) { let n = this; while (n) { if (n.dataset && n.dataset.pane) return n; n = n.parentElement; } return null; } });
  const root = { contains: (n) => n.inRoot !== false, closest: () => null };
  const docs = mk('docs', root); const bill = mk('bill', root); const facts = mk('facts', root);
  const live = mk('live', docs); const req = mk('req', docs);
  const all = [docs, bill, facts, live, req];
  root.querySelectorAll = () => all;
  const ctx = { $: () => root };
  vm.runInNewContext(src + '; this.showPane = showPane;', ctx);
  ctx.showPane('prop-panes', 'docs');
  assert.equal(docs.hidden, false);
  assert.equal(bill.hidden, true);
  assert.equal(facts.hidden, true);
  assert.equal(live.hidden, false, 'το «Για live» πρέπει να μένει ορατό όταν ανοίγει το tab Έγγραφα');
  assert.equal(req.hidden, false);
  // και όταν φεύγουμε από τα Έγγραφα, το εσωτερικό pane δεν αλλάζει (απλώς κρύβεται μαζί με τον γονιό)
  ctx.showPane('prop-panes', 'facts');
  assert.equal(docs.hidden, true);
  assert.equal(facts.hidden, false);
});

test('οι Drops και Ops αντιμετωπίζουν «Δεν ενδιαφέρθηκε» σαν κλειστή κλήση', () => {
  const drops = readFileSync(new URL('../apps-script/Drops.js', import.meta.url), 'utf8');
  const ops = readFileSync(new URL('../apps-script/Ops.js', import.meta.url), 'utf8');
  assert.match(drops, /STATUS\.NOT_INTERESTED/);
  assert.match(ops, /STATUS\.NOT_INTERESTED/);
});

test('το reports.js είναι στο index.html και στο shell του sw.js', () => {
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /<script src="reports\.js"><\/script>/);
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /'reports\.js'/);
});
