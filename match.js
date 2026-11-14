// 2.5 · FEAT-11 · Νέο ακίνητο → «Ποιοι πελάτες ταιριάζουν» (flag newPropMatch)
//
// Η λίστα έρχεται έτοιμη με το bootstrap (S.matches): ο server την υπολογίζει μία φορά
// το πρωί. Εδώ ΔΕΝ γίνεται καμία κλήση στον server για να ανοίξει η οθόνη.
// Ανά ακίνητο: κάρτα + οι πελάτες με τον λόγο («budget 250.000 € · Παγκράτι»)
// και κουμπί «Στείλε παρουσίαση» (το ίδιο παράθυρο 1.19, με τα στοιχεία της κλήσης).
// «Στάλθηκε» ή «✕» → βγαίνει από τη λίστα (matchDone). Δεν ξαναπροτείνεται ποτέ.
(function () {
  'use strict';
  var W = window;

  function on() { return !!(W.S && W.S.flags && W.S.flags.newPropMatch); }
  function list() { return (W.S && W.S.matches) || []; }

  function propOf(m) {
    var c = W.normCode(m.code);
    return ((W.S && W.S.props) || []).filter(function (p) { return W.normCode(p.code) === c; })[0] || m.p || { code: m.code };
  }

  /** Ομαδοποίηση ανά ακίνητο, με τη σειρά που ήρθαν (νέα πρώτα). */
  function groups(items) {
    var by = {}, order = [];
    items.forEach(function (m) {
      if (!by[m.code]) { by[m.code] = []; order.push(m.code); }
      by[m.code].push(m);
    });
    return order.map(function (code) { return { code: code, items: by[code] }; });
  }

  function cardHtml(p) {
    var esc = W.esc;
    var line = [W.fmtPrice(p.price), p.sqm ? p.sqm + ' τ.μ.' : '', p.area].filter(Boolean).join(' · ');
    return '<button type="button" class="pr-card mt-card" data-mt-prop="' + esc(p.code) + '">' +
      '<span class="pr-noimg">' + W.ico('home') + '</span>' +
      '<span class="pr-card-body"><b>' + esc(p.title || p.street || p.code) + '</b><span>' + esc(line) + '</span>' +
      '<span>Κωδ. ' + esc(p.code) + '</span></span></button>';
  }

  function rowHtml(m) {
    var esc = W.esc, k = esc(m.code) + '|' + esc(m.id);
    return '<li class="mt-row" data-mt="' + k + '">' +
      '<button type="button" class="mt-who" data-mt-open="' + esc(m.id) + '"><b>' + esc(m.name) + '</b><span>' + esc(m.why) + '</span></button>' +
      '<div class="mt-acts">' +
        '<button type="button" class="btn solid-red" data-mt-send="' + k + '">' + W.ico('out') + '<span>Στείλε παρουσίαση</span></button>' +
        '<button type="button" class="btn mt-x" data-mt-skip="' + k + '" aria-label="Δεν ενδιαφέρει">✕</button>' +
      '</div></li>';
  }

  function render() {
    var box = W.$('mt-body');
    if (!box) return;
    var g = groups(list());
    if (!g.length) {
      box.innerHTML = '<div class="empty small"><b>Όλα έγιναν ✓</b>Μόλις μπει νέο ακίνητο που ταιριάζει σε πελάτη σου, θα σου έρθει ειδοποίηση.</div>';
      return;
    }
    box.innerHTML = '<p class="field-hint">Κάθε πρωί η εφαρμογή ψάχνει στα νέα ακίνητα τους πελάτες σου με ίδια συναλλαγή, budget και περιοχή.</p>' +
      g.map(function (x) {
        return '<section class="mt-group">' + cardHtml(propOf(x.items[0])) +
          '<ul class="mt-list">' + x.items.map(rowHtml).join('') + '</ul></section>';
      }).join('');
    wire(box);
  }

  function find(k) {
    var i = k.indexOf('|'), code = k.slice(0, i), id = k.slice(i + 1);
    return list().filter(function (m) { return m.code === code && m.id === id; })[0];
  }

  /** Βγαίνει από τη λίστα αμέσως· ο server ενημερώνεται στο παρασκήνιο (και χωρίς σήμα, μέσω send). */
  function done(m) {
    W.S.matches = list().filter(function (x) { return !(x.code === m.code && x.id === m.id); });
    if (W.S.boot) W.S.boot.matches = W.S.matches;          // και στο αποθηκευμένο bootstrap (άνοιγμα χωρίς σήμα)
    var d = { code: m.code, id: m.id };
    var p = typeof W.send === 'function' ? W.send('matchDone', d) : W.api('matchDone', d);
    if (p && p.catch) p.catch(function () {});
    render();
    if (typeof W.render === 'function') W.render();
  }

  function wire(box) {
    box.querySelectorAll('[data-mt-send]').forEach(function (b) {
      b.onclick = function () {
        var m = find(b.dataset.mtSend);
        if (!m) return;
        var lead = W.findLead(m.id) || { id: m.id, name: m.name };
        W.openPresent(propOf(m), lead);
        done(m);
      };
    });
    box.querySelectorAll('[data-mt-skip]').forEach(function (b) {
      b.onclick = function () {
        var m = find(b.dataset.mtSkip);
        if (m) { done(m); W.toast('Δεν θα ξαναπροταθεί για αυτό το ακίνητο.'); }
      };
    });
    box.querySelectorAll('[data-mt-open]').forEach(function (b) {
      b.onclick = function () { W.closePop('matchbox'); W.openLead(b.dataset.mtOpen, {}); };
    });
    box.querySelectorAll('[data-mt-prop]').forEach(function (b) {
      b.onclick = function () { W.closePop('matchbox'); W.openProp(b.dataset.mtProp); };
    });
  }

  function open() {
    if (!on()) return;
    render();
    W.openPop('matchbox');
  }

  W.kwMatch = { open: open, render: render, groups: groups };
})();
