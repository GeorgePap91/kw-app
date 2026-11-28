// 2.19 · Reports: «Ροή του μήνα» (στις Μετρήσεις) και «Πορεία» (μέσα σε κάθε ακίνητο)
//
// Πώς δουλεύει (και γιατί δεν κοστίζει τίποτα στα όρια της Google):
//   · Όλοι οι υπολογισμοί γίνονται στο κινητό, από δεδομένα που ήδη έχει φορτώσει η εφαρμογή:
//     οι κλήσεις (S.leads), οι ζητήσεις (S.dmList) και η εβδομαδιαία φόρμα (S.mx).
//   · Καμία νέα κλήση στον server, κανένα νέο φύλλο, καμία ανάγνωση φύλλου.
//   · Οι κλήσεις υπάρχουν για τον τρέχοντα και τον προηγούμενο μήνα (απόφαση της εφαρμογής).
//     Για παλαιότερους μήνες η ενότητα «Κλήσεις» δεν εμφανίζεται, για να μη δείχνει λάθος μηδενικά.
//
// Ορισμοί (γράφονται και μέσα στην εφαρμογή, για να μην υπάρχει παρεξήγηση):
//   · Ενδιαφέρθηκε = η κλήση έχει απαντηθεί (Απαντημένη, Υπόδειξη, Κλειστή) και ο πελάτης
//     ΔΕΝ είπε «Δεν ενδιαφέρθηκε», ούτε στο τηλέφωνο ούτε μετά την υπόδειξη.
//   · Δεν ενδιαφέρθηκε = κατάσταση «Δεν ενδιαφέρθηκε» ή αποτέλεσμα υπόδειξης «Δεν ενδιαφέρθηκε».
//   · Σε αναμονή = Αναπάντητη ή «Δεν απάντησε»: δεν ξέρουμε ακόμα, άρα δεν μπαίνει σε καμία από τις δύο.
//
// Φορτώνεται μετά το app.js. Χρειάζεται από τη γέφυρα: S, ST, esc.
(function () {
  'use strict';
  var W = window;

  var NOT_INT = 'Δεν ενδιαφέρθηκε';

  /** 'interested' | 'notint' | 'waiting' */
  function classify(l, ST) {
    if (!l) return 'waiting';
    if (l.status === (ST.NOT_INTERESTED || NOT_INT) || l.outcome === NOT_INT) return 'notint';
    if (l.status === ST.ANSWERED || l.status === ST.SHOWING || l.status === ST.CLOSED) return 'interested';
    return 'waiting';
  }

  function hasShowing(l) { return !!(l.showingTs || l.outcome || l.status === 'Υπόδειξη'); }

  /** Πορεία ακινήτου από τις κλήσεις του: ενδιαφέρθηκαν, όχι, υποδείξεις, προσφορές. */
  function propProgress(leads, ST, now) {
    now = now || Date.now();
    var r = { calls: leads.length, interested: 0, notInterested: 0, waiting: 0,
              showings: 0, showingsDone: 0, showingsUpcoming: 0, offers: 0, offersPending: 0 };
    leads.forEach(function (l) {
      var k = classify(l, ST);
      if (k === 'interested') r.interested++;
      else if (k === 'notint') r.notInterested++;
      else r.waiting++;
      if (hasShowing(l)) {
        r.showings++;
        if (l.showingTs && l.showingTs > now) r.showingsUpcoming++; else r.showingsDone++;
      }
      if (l.offer === 'Υπογράφηκε') r.offers++;
      else if (l.offer === 'Στάλθηκε') r.offersPending++;
    });
    return r;
  }

  function ymOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
  }

  /** Οι μήνες για τους οποίους η εφαρμογή έχει κλήσεις: τρέχων και προηγούμενος. */
  function callMonths(now) {
    var d = new Date(now || Date.now());
    var cur = ymOf(d.getTime());
    var p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return [cur, ymOf(p.getTime())];
  }

  /** Κλήσεις του μήνα: πόσες ήρθαν, πόσοι ενδιαφέρθηκαν, πόσοι όχι, πόσες ζητήσεις πήραμε. */
  function monthCalls(leads, ym, demands, ST) {
    var r = { calls: 0, interested: 0, notInterested: 0, waiting: 0, demands: null };
    leads.forEach(function (l) {
      if (!l.ts || ymOf(l.ts) !== ym) return;
      r.calls++;
      var k = classify(l, ST);
      if (k === 'interested') r.interested++;
      else if (k === 'notint') r.notInterested++;
      else r.waiting++;
    });
    if (demands) {
      r.demands = demands.filter(function (x) {
        return x.status === 'Συμπληρώθηκε' && x.submittedTs && ymOf(x.submittedTs) === ym;
      }).length;
    }
    return r;
  }

  /** Ιδιοκτήτες: 1ο ραντεβού → 2ο ραντεβού (παρουσίαση αποκλειστικότητας) → αποκλειστικές. */
  function ownerFunnel(v) {
    v = v || {};
    var first = (v.seller1 || 0) + (v.landlord1 || 0);
    var second = (v.seller2 || 0) + (v.landlord2 || 0);
    var excl = (v.exclSale || 0) + (v.exclRentHi || 0) + (v.exclRentLo || 0);
    return { first: first, second: second, excl: excl, secondPct: pct(second, first), exclPct: pct(excl, first) };
  }

  function pct(a, b) { return b ? Math.round(a / b * 100) : null; }

  W.kwRep = { classify: classify, propProgress: propProgress, monthCalls: monthCalls, callMonths: callMonths,
              ownerFunnel: ownerFunnel, ymOf: ymOf, pct: pct };
  if (typeof module !== 'undefined' && module.exports) module.exports = W.kwRep;
})();
