// 2.11 · FEAT-29 · «Η διαδρομή της μέρας» (flag dayRoute)
//
// Στο «Σήμερα», όταν ο μεσίτης έχει 2+ υποδείξεις, εμφανίζεται το κουμπί «Διαδρομή ημέρας».
// Ανοίγει το Google Maps του κινητού με όλες τις υποδείξεις που ΔΕΝ έχουν περάσει, με σειρά ώρας.
//
// Πώς δουλεύει (και γιατί είναι δωρεάν και γρήγορο):
//   · Είναι απλό link (https://www.google.com/maps/dir/?api=1&…). Καμία κλήση σε Maps API,
//     καμία κλήση UrlFetch, κανένα νέο φύλλο, κανένα API key, καμία quota.
//   · Υπολογίζεται εξ ολοκλήρου στο κινητό από τα δεδομένα που ήδη έχει (S.leads, S.props).
//     Άρα δουλεύει και από την τοπική cache· το link ανοίγει όταν υπάρχει σύνδεση.
//   · Στάση = συντεταγμένες (lat,lng) αν υπάρχουν στο ακίνητο, αλλιώς η διεύθυνση ως κείμενο.
//   · Έως 9 στάσεις (όριο του Maps URL). Αφετηρία = η θέση του μεσίτη (το Maps τη βάζει μόνο του).
//
// «φύγε ~10:35»: ΕΚΤΙΜΗΣΗ = ώρα υπόδειξης − 30′. Δεν ξέρουμε κίνηση/απόσταση (θα χρειαζόταν Maps API),
// γι' αυτό γράφεται με «~». Αν δύο υποδείξεις απέχουν λιγότερο από 30′, γράφει «σφιχτό πρόγραμμα»
// αντί για ώρα που δεν βγαίνει.
//
// Φορτώνεται μετά το app.js. Χρειάζεται από τη γέφυρα: S, ST, esc, ico, normCode, hasShowing, isoDate, store, toast.
(function () {
  'use strict';
  var W = window;
  var MAX_STOPS = 9;             // όριο του Maps URL
  var LEAD_MS = 30 * 60000;      // πόση ώρα πριν την υπόδειξη προτείνουμε να φύγει

  function on() { return !!(W.S && W.S.flags && W.S.flags.dayRoute); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ts) { var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function num(v) { var n = Number(v); return isFinite(n) && n !== 0 ? n : null; }

  /** Η στάση ως κείμενο για το Maps: «lat,lng» αν υπάρχει, αλλιώς «οδός, περιοχή, Ελλάδα». '' = δεν μπορεί να μπει. */
  function placeOf(l, props) {
    var lat = num(l.lat), lng = num(l.lng);
    if (!(lat && lng) && l.code) {
      var k = W.normCode(l.code);
      var p = (props || []).filter(function (x) { return W.normCode(x.code) === k; })[0];
      if (p) { lat = num(p.lat); lng = num(p.lng); }
    }
    if (lat && lng) return lat + ',' + lng;
    var a = String(l.address || '').trim();
    if (!a) return '';
    return /Ελλάδα\s*$/i.test(a) ? a : a + ', Ελλάδα';
  }

  /**
   * Το πλάνο της ημέρας.
   *  today   πόσες υποδείξεις έχει σήμερα συνολικά
   *  stops   οι υποδείξεις που δεν πέρασαν και έχουν διεύθυνση, κατά ώρα, έως 9: { id, name, time, ts, place, leave, tight }
   *  noAddr  πόσες upcoming δεν μπήκαν γιατί δεν έχουν διεύθυνση
   *  extra   πόσες upcoming έμειναν έξω λόγω του ορίου των 9
   *  leave   { leadId: «φύγε ~10:35» } για κάθε στάση
   */
  function plan(leads, props, now) {
    now = now || Date.now();
    var today = W.isoDate(new Date(now));
    var all = (leads || []).filter(function (l) { return W.hasShowing(l) && l.showingDate === today && l.status === W.ST.SHOWING; })
      .sort(function (a, b) { return a.showingTs - b.showingTs; });
    var up = all.filter(function (l) { return l.showingTs > now; });
    var withPlace = [], noAddr = 0;
    up.forEach(function (l) {
      var place = placeOf(l, props);
      if (place) withPlace.push({ l: l, place: place }); else noAddr++;
    });
    var extra = Math.max(0, withPlace.length - MAX_STOPS);
    var stops = withPlace.slice(0, MAX_STOPS).map(function (x, i, arr) {
      var l = x.l, at = l.showingTs - LEAD_MS;
      var prev = i ? arr[i - 1].l.showingTs : 0;
      var tight = !!prev && at < prev;                       // θα έπρεπε να φύγει πριν τελειώσει η προηγούμενη
      var leave = tight ? 'σφιχτό πρόγραμμα' : at <= now ? 'φύγε τώρα' : 'φύγε ~' + clock(at);
      return { id: l.id, name: l.name || '', time: l.showingTime || clock(l.showingTs), ts: l.showingTs, place: x.place, leave: leave, tight: tight };
    });
    var leaveBy = {};
    stops.forEach(function (s) { leaveBy[s.id] = s.leave; });
    return { today: all.length, stops: stops, noAddr: noAddr, extra: extra, leave: leaveBy };
  }

  /** Το link Google Maps: τελευταία στάση = προορισμός, οι προηγούμενες = ενδιάμεσες. Χωρίς origin: ξεκινά από τη θέση του μεσίτη. */
  function url(stops) {
    if (!stops || !stops.length) return '';
    var dest = stops[stops.length - 1].place;
    var via = stops.slice(0, -1).map(function (s) { return encodeURIComponent(s.place); });
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest) +
      (via.length ? '&waypoints=' + via.join('%7C') : '');       // %7C = «|» που ζητά το Maps
  }

  /** Το κουμπί για το «Σήμερα». '' αν το flag είναι κλειστό ή δεν υπάρχουν 2+ υποδείξεις σήμερα / καμία που να μην έχει περάσει. */
  function html(p) {
    if (!on() || !p || p.today < 2 || !p.stops.length) return '';
    var esc = W.esc;
    var sub = W.plural(p.stops.length, 'στάση', 'στάσεις') + ' · από ' + p.stops[0].time +
      (p.stops.length > 1 ? ' έως ' + p.stops[p.stops.length - 1].time : '');
    var warn = [];
    if (p.noAddr) warn.push(W.plural(p.noAddr, 'υπόδειξη', 'υποδείξεις') + ' χωρίς διεύθυνση δεν μπήκε');
    if (p.extra) warn.push('μπήκαν οι πρώτες ' + MAX_STOPS);
    return '<div class="route-box"><a class="btn wide solid-red route-btn" data-dayroute="1" href="' + esc(url(p.stops)) +
      '" target="_blank" rel="noopener">' + W.ico('map') + '<span><b>Διαδρομή ημέρας</b><small>' + esc(sub) + '</small></span></a>' +
      (warn.length ? '<p class="card-note route-warn">' + esc(warn.join(' · ')) + '</p>' : '') + '</div>';
  }

  /** Δείχνει μία φορά «💡 Νέο» την πρώτη φορά που εμφανίζεται το κουμπί. */
  function wire(root) {
    var b = root && root.querySelector('[data-dayroute]');
    if (!b) return;
    if (W.store('kw_route_tip') === '1') return;
    W.store('kw_route_tip', '1');
    setTimeout(function () { W.toast('💡 Νέο: «Διαδρομή ημέρας» ανοίγει όλες τις υποδείξεις σου στον χάρτη'); }, 700);
  }

  W.kwRoute = { plan: plan, url: url, html: html, wire: wire, placeOf: placeOf, MAX_STOPS: MAX_STOPS, LEAD_MS: LEAD_MS };
})();
