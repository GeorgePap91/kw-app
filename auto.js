// 2.6 · Αυτοματισμοί μεσίτη (όλοι πίσω από feature flag):
//   FEAT-15 coolingClients · «Πάρε σήμερα αυτούς»: πελάτες που κρυώνουν (υπολογίζεται στο κινητό, 0 κλήσεις στον server)
//   FEAT-12 priceDrop      · Μείωση τιμής → λίστα πελατών με έτοιμο SMS (ο μεσίτης το στέλνει)
//   FEAT-13 ownerReport    · Αναφορά ιδιοκτήτη από την καρτέλα ακινήτου, αποστολή μόνο με πάτημα
(function () {
  'use strict';
  var W = window;
  var DAY = 86400000;
  var COOL = { DAYS: 7, MAX: 5, SKIP_DAYS: 7, KEY: 'kw_cool_skip' };

  function flag(k) { return !!(W.S && W.S.flags && W.S.flags[k]); }
  function esc(s) { return W.esc(s); }
  function tsOf(s) { var d = W.parseStamp(s); return d ? d.getTime() : 0; }
  function money(n) { return W.fmtPrice(n); }

  // ─────────────────────────── FEAT-15 ───────────────────────────

  function skipped() {
    try { return JSON.parse(localStorage.getItem(COOL.KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function skip(id) {
    var m = skipped(), now = Date.now();
    Object.keys(m).forEach(function (k) { if (m[k] < now) delete m[k]; });
    m[id] = now + COOL.SKIP_DAYS * DAY;
    try { localStorage.setItem(COOL.KEY, JSON.stringify(m)); } catch (e) { /* ιδιωτική περιήγηση */ }
  }

  /** Τελευταία ενέργεια: κλήση, SMS, άνοιγμα, αλλαγή στην εφαρμογή ή η ίδια η κλήση. */
  function lastTouch(l) {
    return Math.max(l.ts || l.dateTs || 0, tsOf(l.called), tsOf(l.sms), tsOf(l.opened), tsOf(l.updated));
  }

  function cooling(leads, now) {
    now = now || Date.now();
    var sk = skipped();
    var seen = {};
    return (leads || []).filter(function (l) {
      if (l.status !== (W.ST_ANSWERED || 'Απαντημένη')) return false;
      if (l.pfLevel !== 'Θερμός' && l.pfLevel !== 'Χλιαρός') return false;
      if (l.hasEvent || l.showingTs) return false;
      if (sk[l.id] && sk[l.id] > now) return false;
      var key = l.phone || l.id;
      if (seen[key]) return false;
      seen[key] = 1;
      return now - lastTouch(l) >= COOL.DAYS * DAY;
    }).map(function (l) {
      return { l: l, days: Math.floor((now - lastTouch(l)) / DAY), hot: l.pfLevel === 'Θερμός' };
    }).sort(function (a, b) { return (b.hot - a.hot) || (b.days - a.days); }).slice(0, COOL.MAX);
  }

  function coolHtml() {
    if (!flag('coolingClients')) return '';
    var list = cooling(W.S.leads);
    if (!list.length) return '';
    return '<h2 class="group-title">Πάρε σήμερα ' + (list.length === 1 ? 'αυτόν' : 'αυτούς τους ' + list.length) + '</h2>' +
      '<p class="card-note cool-note">Απάντησαν, ενδιαφέρονται, αλλά δεν έχει γίνει τίποτα εδώ και μέρες.</p>' +
      '<ul class="mt-list cool-list">' + list.map(function (x) {
        var l = x.l;
        var why = [l.pfLevel, x.days + ' ημέρες χωρίς επαφή', l.pfWant ? 'ψάχνει ' + l.pfWant : ''].filter(Boolean).join(' · ');
        return '<li class="mt-row" data-cool="' + esc(l.id) + '">' +
          '<button type="button" class="mt-who" data-cool-open="' + esc(l.id) + '"><b>' + esc(l.name || 'Χωρίς όνομα') + '</b><span>' + esc(why) + '</span></button>' +
          '<div class="mt-acts">' +
            '<button type="button" class="btn solid-red" data-cool-call="' + esc(l.id) + '">' + W.ico('phone') + '<span>Κλήση</span></button>' +
            '<button type="button" class="btn" data-cool-props="' + esc(l.id) + '"><span>Στείλε ακίνητα</span></button>' +
            '<button type="button" class="btn mt-x" data-cool-skip="' + esc(l.id) + '" aria-label="Όχι τώρα" title="Όχι τώρα (7 ημέρες)">✕</button>' +
          '</div></li>';
      }).join('') + '</ul>';
  }

  function wireCool(el) {
    el.querySelectorAll('[data-cool-call]').forEach(function (b) { b.onclick = function () { W.callLead(b.dataset.coolCall); }; });
    el.querySelectorAll('[data-cool-open]').forEach(function (b) { b.onclick = function () { W.openLead(b.dataset.coolOpen, {}); }; });
    el.querySelectorAll('[data-cool-props]').forEach(function (b) { b.onclick = function () { W.openLead(b.dataset.coolProps, { profile: true }); }; });
    el.querySelectorAll('[data-cool-skip]').forEach(function (b) {
      b.onclick = function () { skip(b.dataset.coolSkip); W.toast('Θα σου τον ξαναθυμίσω σε 7 ημέρες.'); W.render(); };
    });
  }

  // ─────────────────────────── FEAT-12 ───────────────────────────

  function dropText(d, l) {
    var first = String((l && l.name) || '').trim().split(/\s+/)[0];
    var me = W.S.me || {};
    return (first ? 'Καλησπέρα ' + first + ', ' : 'Καλησπέρα, ') + 'καλά νέα: η τιμή του ακινήτου «' + d.title + '»' +
      (d.area ? ' (' + d.area + ')' : '') + ' έπεσε από ' + money(d.old) + ' σε ' + money(d.now) + '. ' +
      'Θέλετε να το ξαναδούμε; ' + (me.smsName || me.name || '');
  }

  function dropHtml(d) {
    var rows = (d.clients || []).map(function (c) {
      var l = W.findLead(c.id) || { id: c.id, name: 'Πελάτης' };
      var intl = l.phoneIntl || (/^\d{10}$/.test(l.phone || '') ? '+30' + l.phone : '');
      var href = W.smsHref(intl, dropText(d, l));
      return '<li class="mt-row"><button type="button" class="mt-who" data-dr-open="' + esc(c.id) + '"><b>' + esc(l.name || 'Χωρίς όνομα') + '</b>' +
        '<span>' + esc(c.why) + '</span></button><div class="mt-acts">' +
        (href ? '<a class="btn solid-red" href="' + esc(href) + '">' + W.ico('sms') + '<span>Στείλε SMS</span></a>' : '') +
        (l.phone ? '<button type="button" class="btn" data-dr-call="' + esc(c.id) + '">' + W.ico('phone') + '<span>Κλήση</span></button>' : '') +
        '</div></li>';
    }).join('');
    return '<section class="mt-group"><div class="pr-card"><span class="pr-noimg">' + W.ico('home') + '</span>' +
      '<span class="pr-card-body"><b>' + esc(d.title) + '</b><span><s>' + esc(money(d.old)) + '</s> → <b>' + esc(money(d.now)) + '</b></span>' +
      '<span>Κωδ. ' + esc(d.code) + '</span></span></div>' +
      (rows ? '<ul class="mt-list">' + rows + '</ul>' : '<p class="field-hint">Δεν βρέθηκαν πελάτες για αυτό το ακίνητο τους τελευταίους 2 μήνες.</p>') +
      '<button type="button" class="btn wide gap-top" data-dr-done="' + esc(d.code) + '">✓ Έγινε, βγάλε το από τη λίστα</button></section>';
  }

  function drop(code) {
    if (!flag('priceDrop')) return;
    var list = (W.S.drops || []).filter(function (d) { return !code || d.code === code; });
    var box = W.$('dr-body');
    box.innerHTML = list.length ? '<p class="field-hint">Το μήνυμα είναι έτοιμο· ανοίγει στα SMS του κινητού σου και το στέλνεις εσύ.</p>' + list.map(dropHtml).join('')
      : '<div class="empty small"><b>Όλα έγιναν ✓</b>Όταν πέσει η τιμή σε ακίνητό σου, θα σου έρθει ειδοποίηση.</div>';
    box.querySelectorAll('[data-dr-open]').forEach(function (b) { b.onclick = function () { W.closePop('dropbox'); W.openLead(b.dataset.drOpen, {}); }; });
    box.querySelectorAll('[data-dr-call]').forEach(function (b) { b.onclick = function () { W.closePop('dropbox'); W.callLead(b.dataset.drCall); }; });
    box.querySelectorAll('[data-dr-done]').forEach(function (b) {
      b.onclick = function () {
        var c = b.dataset.drDone;
        W.S.drops = (W.S.drops || []).filter(function (x) { return x.code !== c; });
        if (W.S.boot) W.S.boot.drops = W.S.drops;
        var p = W.send('dropDone', { code: c });
        if (p && p.catch) p.catch(function () {});
        drop(code && code === c ? '' : code);
        W.render();
      };
    });
    W.openPop('dropbox');
  }

  // ─────────────────────────── FEAT-13 ───────────────────────────

  var rp = { code: '', month: 'last', data: null };

  function reportHtml(r) {
    var line = function (a, b, sub) { return '<tr' + (sub ? ' class="rp-sub"' : '') + '><td>' + esc(a) + '</td><td>' + esc(b) + '</td></tr>'; };
    return '<div class="rp-card"><b>' + esc(r.title) + '</b><span>' + esc(r.month) + '</span>' +
      '<table class="rp-table">' +
        line('Τηλεφωνήματα', r.calls + (r.trend ? ' (' + r.trend + ')' : '')) +
        r.sources.map(function (s) { return line('· ' + s.name, s.n, 1); }).join('') +
        line('Υποδείξεις', r.showings) +
        r.outcomes.map(function (o) { return line('· ' + o.name, o.n, 1); }).join('') +
      '</table>' +
      (r.over ? '<p>' + r.over + (r.over === 1 ? ' ενδιαφερόμενος βρήκε' : ' ενδιαφερόμενοι βρήκαν') + ' την τιμή πάνω από το budget.</p>' : '') +
      '</div>';
  }

  function renderReport() {
    var box = W.$('rp-body'), x = rp.data;
    var tabs = '<div class="rp-tabs"><button type="button" class="chip' + (rp.month === 'last' ? ' is-on' : '') + '" data-rp-m="last">Προηγούμενος μήνας</button>' +
      '<button type="button" class="chip' + (rp.month === 'this' ? ' is-on' : '') + '" data-rp-m="this">Αυτός ο μήνας</button></div>';
    if (!x) { box.innerHTML = tabs + '<p class="field-hint">Ετοιμάζεται η αναφορά…</p>'; wireReport(box); return; }
    if (x.err) { box.innerHTML = tabs + '<p class="field-hint err">' + esc(x.err) + '</p>'; wireReport(box); return; }
    box.innerHTML = tabs + reportHtml(x.report) +
      '<p class="field-hint">Χωρίς ονόματα και τηλέφωνα πελατών. Φεύγει μόνο αν πατήσεις αποστολή.</p>' +
      (x.quotaLow ? '<p class="field-hint err">Προσοχή: απομένουν ' + x.quota + ' email για σήμερα στον λογαριασμό της εφαρμογής.</p>' : '') +
      (x.hasEmail ? '<button type="button" class="btn solid-red wide" id="rp-send">' + W.ico('mail') + '<span>Στείλε email στον ιδιοκτήτη (' + esc(x.emailHint) + ')</span></button>'
                  : '<p class="field-hint">Δεν υπάρχει email ιδιοκτήτη στα «Διαθέσιμα ακίνητα». Στείλε τη με WhatsApp ή Viber:</p>') +
      '<div class="actions gap-top">' +
        '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(x.text) + '">WhatsApp</a>' +
        '<button type="button" class="btn" id="rp-copy">Αντιγραφή κειμένου</button>' +
      '</div>';
    wireReport(box);
  }

  function wireReport(box) {
    box.querySelectorAll('[data-rp-m]').forEach(function (b) {
      b.onclick = function () { if (rp.month !== b.dataset.rpM) { rp.month = b.dataset.rpM; load(); } };
    });
    var send = box.querySelector('#rp-send');
    if (send) send.onclick = function () {
      send.disabled = true;
      W.api('ownerReportSend', { code: rp.code, month: rp.month }).then(function (r) {
        W.toast('Στάλθηκε στον ιδιοκτήτη (' + r.to + ').');
        W.closePop('reportbox');
      }).catch(function (e) { send.disabled = false; W.toast(e.message, true); });
    };
    var copy = box.querySelector('#rp-copy');
    if (copy) copy.onclick = function () {
      var t = rp.data && rp.data.text;
      if (t && navigator.clipboard) navigator.clipboard.writeText(t).then(function () { W.toast('Αντιγράφηκε.'); }, function () {});
    };
  }

  function load() {
    rp.data = null;
    renderReport();
    var want = rp.code + rp.month;
    W.api('ownerReport', { code: rp.code, month: rp.month }).then(function (r) {
      if (rp.code + rp.month !== want) return;
      rp.data = r;
      renderReport();
    }).catch(function (e) {
      if (rp.code + rp.month !== want) return;
      rp.data = { err: e.net ? 'Χρειάζεται σύνδεση για την αναφορά.' : e.message };
      renderReport();
    });
  }

  function report(code) {
    if (!flag('ownerReport')) return;
    rp.code = code;
    rp.month = 'last';
    W.openPop('reportbox');
    load();
  }

  W.kwAuto = { coolHtml: coolHtml, wireCool: wireCool, cooling: cooling, drop: drop, dropText: dropText, report: report };
  // Αν το bootstrap ήρθε πριν φορτωθεί αυτό το αρχείο (αργό δίκτυο), ξαναζωγραφίζουμε το «Σήμερα».
  if (W.S && W.S.boot && typeof W.render === 'function') W.render();
})();
