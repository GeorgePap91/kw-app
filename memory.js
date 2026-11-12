/**
 * KW App · FEAT-9 · Smart Form Memory (2.3)
 * ─────────────────────────────────────────────────────────────
 * Η εφαρμογή μαθαίνει τις περιοχές και τα budget που γράφει συχνά ο μεσίτης
 * στο Προφίλ πελάτη και τα δείχνει ως chips «Συχνά:» κάτω από το πεδίο.
 * Ένα πάτημα αντί για πληκτρολόγηση, την ώρα που μιλάει στο τηλέφωνο.
 *
 *  · Μένει ΜΟΝΟ στο κινητό (localStorage 'kw_mem'). Δεν πάει στον server,
 *    δεν περιέχει στοιχεία πελάτη (μόνο ονόματα περιοχών και ποσά).
 *  · Σβήνεται μαζί με τα υπόλοιπα (αποσύνδεση, ανάκληση, 14 ημέρες: offForget).
 *  · Δουλεύει offline. Μία ανάγνωση localStorage ανά άνοιγμα προφίλ.
 *  · Ενεργό μόνο με feature flag «smartMemory» (Ιδιότητα σεναρίου FEATURES).
 *  · Μαθαίνει μία φορά ανά πελάτη και τιμή, όταν φεύγεις από το πεδίο
 *    (όχι σε κάθε πλήκτρο), οπότε το «Παγ…» δεν γίνεται ποτέ chip.
 *
 * Φορτώνεται μετά το app.js. Χρησιμοποιεί τα S, store, fold, esc, fmtPrice, $.
 */

var MEM = {
  KEY: 'kw_mem',
  MAX: 30,              // πόσες τιμές κρατά ανά είδος (οι λιγότερο χρήσιμες φεύγουν)
  SEEN_MAX: 400,        // πόσα «ήδη μετρημένα» (πελάτης+τιμή) θυμάται
  HALF_LIFE_DAYS: 60,   // μετά από 2 μήνες χωρίς χρήση μια τιμή μετρά τη μισή
  SHOW: { areas: 5, money: 3 }
};

/** Feature flag από το backend (bootstrap.flags). */
function feat(name) { return !!(typeof S !== 'undefined' && S.flags && S.flags[name]); }

/** Ποιο «συρτάρι» μνήμης αφορά το πεδίο. Κενό = κανένα. */
function memKind(k) {
  if (k === 'areasBuy' || k === 'areasRent') return 'areas';
  if (k === 'budgetBuy' || k === 'budgetRent') return k;
  return '';
}

function memLoad() {
  try { var m = JSON.parse(store(MEM.KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
}
function memSave(m) {
  try { store(MEM.KEY, JSON.stringify(m)); } catch (e) { /* χωρίς χώρο: απλώς δεν μαθαίνει */ }
}

/** «Παγκράτι, Βύρωνας / Ν. Σμύρνη και Καλλιθέα» → 4 περιοχές. Αγνοεί αριθμούς-τηλέφωνα. */
function memSplitAreas(s) {
  return String(s || '').split(/[,;\/\n·]+|\s+και\s+/i)
    .map(function (x) { return x.replace(/\s+/g, ' ').trim(); })
    .filter(function (x) { return x.length >= 2 && x.length <= 40 && !/\d{4,}/.test(x); });
}

function memKey(kind, t) { return kind === 'areas' ? fold(t).trim() : String(Math.round(Number(t))); }

/** Βαθμός: πόσες φορές × πόσο πρόσφατα. */
function memScore(e, now) {
  var days = Math.max(0, (now - (e.at || 0)) / 864e5);
  return (e.n || 0) * Math.pow(0.5, days / MEM.HALF_LIFE_DAYS);
}

/** Καταγραφή τιμής για έναν πελάτη. Ίδιος πελάτης + ίδια τιμή = μετράει μία φορά. */
function memLearn(leadId, k, value, now) {
  var kind = memKind(k);
  if (!kind || !feat('smartMemory') || value === '' || value == null) return;
  now = now || Date.now();
  var m = memLoad(), b = m[kind] || (m[kind] = {}), seen = m._seen || (m._seen = {});
  var items = kind === 'areas' ? memSplitAreas(value)
    : (Number(value) > 0 && Number(value) < 1e8 ? [Math.round(Number(value))] : []);
  var changed = false;
  items.forEach(function (t) {
    var key = memKey(kind, t);
    if (!key) return;
    var sk = String(leadId) + '|' + kind + '|' + key;
    if (seen[sk]) return;
    seen[sk] = now;
    var e = b[key] || (b[key] = { t: String(t), n: 0 });
    e.n++; e.at = now; e.t = String(t);
    changed = true;
  });
  if (!changed) return;
  memPrune(b, MEM.MAX, now);
  memPruneSeen(seen);
  memSave(m);
}

function memPrune(b, max, now) {
  var keys = Object.keys(b);
  if (keys.length <= max) return;
  keys.sort(function (x, y) { return memScore(b[y], now) - memScore(b[x], now); })
    .slice(max).forEach(function (k) { delete b[k]; });
}

function memPruneSeen(seen) {
  var keys = Object.keys(seen);
  if (keys.length <= MEM.SEEN_MAX) return;
  keys.sort(function (x, y) { return seen[y] - seen[x]; }).slice(MEM.SEEN_MAX).forEach(function (k) { delete seen[k]; });
}

/** Οι πιο χρήσιμες τιμές, εκτός από όσες υπάρχουν ήδη στο πεδίο. */
function memTop(kind, exclude, limit, now) {
  now = now || Date.now();
  var b = memLoad()[kind] || {};
  return Object.keys(b).filter(function (k) { return (exclude || []).indexOf(k) === -1; })
    .sort(function (x, y) { return memScore(b[y], now) - memScore(b[x], now); })
    .slice(0, limit).map(function (k) { return { key: k, t: b[k].t }; });
}

/** HTML των chips κάτω από το πεδίο. Κενό αν δεν υπάρχει ιστορικό ή είναι κλειστό το flag. */
function memChips(k, d) {
  var kind = memKind(k);
  if (!kind || !feat('smartMemory')) return '';
  var v = d && d[k];
  var cur = kind === 'areas' ? memSplitAreas(v).map(function (t) { return memKey('areas', t); }) : (v ? [memKey(kind, v)] : []);
  var top = memTop(kind, cur, kind === 'areas' ? MEM.SHOW.areas : MEM.SHOW.money);
  if (!top.length) return '';
  return '<div class="pf-mem" data-pf-mem="' + k + '"><span class="pf-mem-l">Συχνά:</span>' + top.map(function (e) {
    var label = kind === 'areas' ? e.t : fmtPrice(Number(e.t));
    return '<button type="button" class="chip small" data-pf-memk="' + k + '" data-pf-memv="' + esc(e.t) + '">' + esc(label) + '</button>';
  }).join('') + '</div>';
}

/** Πάτημα σε chip: γεμίζει το πεδίο, μετρά τη χρήση, ανανεώνει μόνο τη γραμμή των chips. */
function memPick(btn, val) {
  var k = btn.dataset.pfMemk, v = btn.dataset.pfMemv, root = $('pf-body');
  var inp = root && root.querySelector('input[data-pf-k="' + k + '"]');
  if (!inp || !S.pf) return;
  if (memKind(k) === 'areas') {
    var cur = inp.value.replace(/[\s,;]+$/, '');
    inp.value = cur ? cur + ', ' + v : v;
    val(k, inp.value);
  } else {
    var n = Math.round(Number(v));
    inp.value = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    val(k, n);
  }
  memLearn(S.pf.id, k, v);
  memRefreshRow(k);
}

function memRefreshRow(k) {
  var row = $('pf-body') && $('pf-body').querySelector('[data-pf-row="' + k + '"]');
  if (!row) return;
  var old = row.querySelector('.pf-mem');
  if (old) old.remove();
  row.insertAdjacentHTML('beforeend', memChips(k, S.pf ? S.pf.data : {}));
}
