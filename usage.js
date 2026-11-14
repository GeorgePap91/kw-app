// 2.7 · Μετρήσεις χρήσης: πόσος χρόνος και πόσα πατήματα χρειάζεται κάθε ενέργεια.
//
// Η μέτρηση ξεκινά όταν ανοίγει πελάτης ή ακίνητο (mark) και κλείνει όταν γίνει η ενέργεια (track).
// Μαζεύονται στο κινητό και στέλνονται ομαδικά: το πολύ μία αποστολή κάθε 15′ ή όταν κλείνει η εφαρμογή.
// Μόνο αριθμοί: καμία πληροφορία πελάτη. Η αναφορά είναι στις Ρυθμίσεις → «Χρόνος που γλιτώνεις».
(function () {
  'use strict';
  var W = window;
  var KEY = 'kw_usage', MAX_SEC = 300, FLUSH_MS = 15 * 60000;
  // Ίδια λίστα με το USAGE.BASE του Edit.gs.
  var TRACK = { called: 1, status: 1, sms: 1, showing: 1, outcome: 1, callNote: 1, taskSave: 1,
                presCreate: 1, formCreate: 1, ownerReportSend: 1, propSave: 1, contactSave: 1 };

  var t0 = Date.now(), clicks = 0, last = { a: '', at: 0 };

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(m) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* ιδιωτική περιήγηση */ } }

  function mark() { t0 = Date.now(); clicks = 0; }

  function track(a) {
    if (!TRACK[a]) return;
    var now = Date.now();
    if (last.a === a && now - last.at < 1500) return;          // το ίδιο πάτημα από δύο δρόμους
    last = { a: a, at: now };
    var sec = Math.round((now - t0) / 1000);
    if (sec <= MAX_SEC) {                                       // πάνω από 5′: έκανε κάτι άλλο στο μεταξύ
      var m = load(), r = m[a] || [0, 0, 0];
      m[a] = [r[0] + 1, r[1] + sec, r[2] + clicks];
      save(m);
    }
    mark();
  }

  function flush() {
    var m = load();
    if (!Object.keys(m).length || navigator.onLine === false || !W.S || !W.S.boot || typeof W.beacon !== 'function') return;
    save({});
    W.beacon('usage', { rows: m });
  }

  document.addEventListener('click', function () { clicks++; }, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); else mark(); });
  setInterval(flush, FLUSH_MS);

  // ── Αναφορά ──

  var st = { month: 'this', team: false, data: null };

  function dur(sec) {
    if (sec < 60) return sec + '″';
    var m = Math.round(sec / 60);
    if (m < 60) return m + '′';
    return Math.floor(m / 60) + ' ώρ. ' + (m % 60 ? (m % 60) + '′' : '');
  }

  function render() {
    var box = W.$('us-body'), d = st.data, esc = W.esc;
    var chip = function (on, attr, text) { return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" ' + attr + '>' + text + '</button>'; };
    var tabs = '<div class="rp-tabs">' + chip(st.month === 'this', 'data-us-m="this"', 'Αυτός ο μήνας') + chip(st.month === 'last', 'data-us-m="last"', 'Προηγούμενος') +
      (d && d.canTeam ? chip(st.team, 'data-us-team="1"', 'Όλη η ομάδα') : '') + '</div>';
    var html;
    if (!d) html = '<p class="field-hint">Φόρτωση…</p>';
    else if (d.err) html = '<p class="field-hint err">' + esc(d.err) + '</p>';
    else if (!d.rows.length) html = '<div class="empty small"><b>Δεν υπάρχουν μετρήσεις ακόμα</b>Όσο χρησιμοποιείς την εφαρμογή, εδώ θα βλέπεις πόσο χρόνο γλιτώνεις.</div>';
    else html = '<div class="rp-card us-top"><span>Γλίτωσες περίπου</span><b>' + esc(dur(d.savedSec)) + '</b>' +
        '<span>' + d.actions + ' ενέργειες' + (d.team ? ' · ' + d.people + (d.people === 1 ? ' μεσίτης' : ' μεσίτες') : '') + '</span></div>' +
      '<ul class="us-list">' + d.rows.map(function (r) {
        return '<li><b>' + esc(r.label) + '</b><span>' + r.n + (r.n === 1 ? ' φορά' : ' φορές') + ' · ' + r.avgSec + '″ και ' + String(r.avgClicks).replace('.', ',') +
          ' πατήματα κατά μέσο όρο</span><span>Με το χέρι περίπου ' + esc(dur(r.baseSec)) + ' → κέρδος ' + esc(dur(r.savedSec)) + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="field-hint">Ο χρόνος «με το χέρι» είναι εκτίμηση για την ίδια δουλειά χωρίς την εφαρμογή. Μετράμε από τη στιγμή που ανοίγεις τον πελάτη ή το ακίνητο.</p>';
    box.innerHTML = tabs + html;
    box.querySelectorAll('[data-us-m]').forEach(function (b) { b.onclick = function () { st.month = b.dataset.usM; fetchReport(); }; });
    box.querySelectorAll('[data-us-team]').forEach(function (b) { b.onclick = function () { st.team = !st.team; fetchReport(); }; });
  }

  function fetchReport() {
    var want = st.month + st.team;
    st.data = null;
    render();
    W.api('usageReport', { month: st.month, team: st.team }).then(function (r) {
      if (st.month + st.team !== want) return;
      st.data = r; render();
    }).catch(function (e) {
      if (st.month + st.team !== want) return;
      st.data = { err: e.net ? 'Χρειάζεται σύνδεση για την αναφορά.' : e.message }; render();
    });
  }

  function open() {
    flush();                                                    // ό,τι μαζεύτηκε μέχρι τώρα, να φανεί
    st.month = 'this'; st.team = false;
    W.openPop('usagebox');
    setTimeout(fetchReport, 400);
  }

  var btn = document.getElementById('btn-usage');
  if (btn) btn.onclick = open;

  W.kwUsage = { mark: mark, track: track, flush: flush, open: open, _peek: load };
})();
