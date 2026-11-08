/* 1.20 · Έντυπο προσφοράς για τον πελάτη.
   Το κλειδί είναι μετά το # (δεν στέλνεται ποτέ στον server της σελίδας).
   Ό,τι γράφει ο πελάτης φεύγει μόνο στο Apps Script, που φτιάχνει το PDF.
   Τίποτα δεν κρατιέται στη συσκευή (ούτε στο localStorage). */
(function () {
  'use strict';

  var API = (window.KW_CONFIG || {}).API_URL || '';
  var KEY = String(location.hash || '').replace(/^#/, '').trim();
  var $ = function (id) { return document.getElementById(id); };
  var D = null;
  var pad = null;
  var rent = false;

  function api(action, data) {
    data = data || {};
    data.f = KEY;
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ action: action, data: data }) })
      .then(function (r) { if (!r.ok) throw new Error('Σφάλμα δικτύου. Δοκιμάστε ξανά.'); return r.json(); })
      .then(function (res) {
        if (!res.ok) { var e = new Error(res.error || 'Κάτι πήγε στραβά.'); e.code = res.code || ''; throw e; }
        return res.data;
      });
  }

  function logoFallback() {
    var l = $('logo');
    var bad = function () { l.hidden = true; $('wordmark').hidden = false; };
    if (l.complete && !l.naturalWidth) bad();
    l.addEventListener('error', bad);
  }

  function show(id) {
    ['loading', 'closed', 'done', 'form'].forEach(function (x) { $(x).hidden = x !== id; });
    $('main').setAttribute('aria-busy', id === 'loading' ? 'true' : 'false');
    window.scrollTo(0, 0);
  }

  function closed(title, text) {
    $('closed-title').textContent = title;
    $('closed-text').textContent = text;
    show('closed');
  }

  // ── Αριθμοί: «240.000» ↔ 240000 ───────────────────────────
  function num(v) {
    var s = String(v || '').replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/[.,]/g, '');
    var n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function moneyInput(el) {
    el.addEventListener('blur', function () { var n = num(el.value); el.value = n ? fmt(n) : (el.value.trim() === '0' ? '0' : ''); updateSum(); });
    el.addEventListener('input', updateSum);
  }

  function updateSum() {
    if (rent) return;
    var p = num($('f-price').value), c = num($('f-cash').value), l = num($('f-loan').value);
    var s = $('sum');
    if (!p || (!c && !l)) { s.textContent = ''; s.className = 'sum'; return; }
    var total = c + l;
    if (Math.abs(total - p) < 1) { s.textContent = 'Σύνολο ' + fmt(total) + ' € · ίσο με την προσφορά ✓'; s.className = 'sum ok'; }
    else { s.textContent = 'Σύνολο ' + fmt(total) + ' € · ' + (total < p ? 'λείπουν ' + fmt(p - total) : 'περισσεύουν ' + fmt(total - p)) + ' €'; s.className = 'sum warn'; }
  }

  // ── Κουμπιά «i» ──────────────────────────────────────────
  function wireInfo() {
    Array.prototype.forEach.call(document.querySelectorAll('.i'), function (b) {
      b.addEventListener('click', function () {
        var p = $(b.getAttribute('aria-controls'));
        var open = b.getAttribute('aria-expanded') !== 'true';
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        p.hidden = !open;
      });
    });
  }

  // ── Υπογραφή με το δάχτυλο ───────────────────────────────
  function makePad(canvas) {
    var ctx = canvas.getContext('2d'), strokes = [], cur = null, ink = 0;
    function size() {
      var r = canvas.getBoundingClientRect(), k = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * k));
      canvas.height = Math.max(1, Math.round(r.height * k));
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1d4f';
      strokes.forEach(draw);
    }
    function draw(st) {
      ctx.beginPath();
      st.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      if (st.length === 1) ctx.lineTo(st[0].x + 0.1, st[0].y);
      ctx.stroke();
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      cur = [pos(e)]; strokes.push(cur); draw(cur);
      $('pad-ph').hidden = true;
      field('sig').classList.remove('bad'); field('sig').querySelector('.err').textContent = '';
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!cur) return;
      var p = pos(e), last = cur[cur.length - 1];
      ink += Math.abs(p.x - last.x) + Math.abs(p.y - last.y);
      cur.push(p); draw(cur.slice(-2));
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { cur = null; }); });
    window.addEventListener('resize', size);
    size();
    return {
      clear: function () { strokes = []; ink = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); $('pad-ph').hidden = false; },
      empty: function () { return ink < 40; },
      png: function () {
        // Λευκό φόντο, σε σταθερό μέγεθος, για να φαίνεται καθαρά στο PDF.
        var out = document.createElement('canvas'), r = canvas.getBoundingClientRect();
        out.width = 600; out.height = Math.round(600 * r.height / Math.max(1, r.width));
        var o = out.getContext('2d');
        o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
        o.drawImage(canvas, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      }
    };
  }

  // ── Σφάλματα πεδίων ──────────────────────────────────────
  function field(name) { return document.querySelector('.field[data-f="' + name + '"]'); }
  function clearErrors() {
    Array.prototype.forEach.call(document.querySelectorAll('.field'), function (f) { f.classList.remove('bad'); f.querySelector('.err').textContent = ''; });
    $('form-err').hidden = true;
  }
  function fieldError(name, msg) {
    var f = field(name === 'afmOk' ? 'afm' : name);
    if (name === 'afmOk') $('afm-ok-wrap').hidden = false;
    if (!f) { $('form-err').textContent = msg; $('form-err').hidden = false; return; }
    f.classList.add('bad');
    f.querySelector('.err').textContent = msg;
    f.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var inp = f.querySelector('input');
    if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, 300);
  }

  /** Γρήγοροι έλεγχοι εδώ· ο server ξαναελέγχει τα πάντα. */
  function check(c) {
    if (c.name.split(/\s+/).length < 2) return ['name', 'Γράψτε όνομα και επώνυμο.'];
    if (c.address.length < 5) return ['address', 'Συμπληρώστε τη διεύθυνση κατοικίας σας.'];
    if (!num(c.price)) return ['price', rent ? 'Γράψτε το μίσθωμα που προτείνετε.' : 'Γράψτε την τιμή που προτείνετε.'];
    if (!rent) {
      var p = num(c.price), sum = num(c.cash) + num(c.loan);
      if (!sum) return ['cash', 'Γράψτε πόσα με μετρητά και πόσα με δάνειο (0 αν δεν χρειάζεται).'];
      if (Math.abs(sum - p) > 0.5) return ['cash', 'Μετρητά και δάνειο μαζί πρέπει να κάνουν ' + fmt(p) + ' €.'];
    }
    if (c.signName.split(/\s+/).length < 2) return ['signName', 'Γράψτε ονοματεπώνυμο για την υπογραφή.'];
    if (!/^\d{9}$/.test(c.afm.replace(/\D/g, ''))) return ['afm', 'Ο ΑΦΜ έχει 9 ψηφία.'];
    if (c.adt.replace(/\s/g, '').length < 5) return ['adt', 'Γράψτε τον αριθμό ταυτότητας ή διαβατηρίου.'];
    if (c.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email)) return ['email', 'Το email δεν φαίνεται σωστό.'];
    if (pad.empty()) return ['sig', 'Υπογράψτε μέσα στο πλαίσιο.'];
    if (!$('f-consent').checked) return ['consent', 'Χρειάζεται η αποδοχή για να σταλεί η προσφορά.'];
    return null;
  }

  function onSubmit(e) {
    e.preventDefault();
    clearErrors();
    var v = function (id) { return $(id).value.trim(); };
    var c = { name: v('f-name'), address: v('f-address'), price: v('f-price'), cash: v('f-cash'), loan: v('f-loan'),
              signName: v('f-signname') || v('f-name'), afm: v('f-afm'), adt: v('f-adt'), email: v('f-email'),
              afmOk: $('f-afmok').checked };
    var bad = check(c);
    if (bad) return fieldError(bad[0], bad[1]);

    var btn = $('submit');
    btn.disabled = true;
    btn.textContent = 'Αποστολή…';
    api('offerSubmit', { c: c, sig: pad.png(), consent: true, ua: navigator.userAgent }).then(function (r) {
      // Τα στοιχεία φεύγουν από τη σελίδα αμέσως.
      $('form').reset();
      pad.clear();
      $('done-text').textContent = 'Η προσφορά σας (Α/Α ' + r.aa + ') υποβλήθηκε και ενημερώθηκε ο μεσίτης σας' +
        (r.copied ? '. Θα λάβετε αντίγραφο στο email σας.' : '.') + ' Αν τη συμπληρώσατε στο κινητό του μεσίτη, μπορείτε να του το επιστρέψετε.';
      show('done');
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Υπογραφή και αποστολή';
      var m = /^field:(.+)$/.exec(err.code || '');
      if (m) return fieldError(m[1], err.message);
      if (err.code === 'done' || err.code === 'closed') return closed(err.code === 'done' ? 'Η προσφορά έχει υποβληθεί' : 'Το έντυπο δεν είναι διαθέσιμο', err.message);
      $('form-err').textContent = err.message;
      $('form-err').hidden = false;
    });
  }

  function render() {
    var p = D.prop;
    rent = p.deal === 'Ενοικίαση';
    document.title = 'Προσφορά · ' + (p.code || 'ακίνητο') + ' · ' + D.office;
    $('top-code').textContent = p.code ? 'Κωδ. ' + p.code : '';
    $('deal-word').textContent = rent ? 'μίσθωσης' : 'αγοράς';
    $('p-code').textContent = p.code || '—';
    $('p-address').textContent = p.address || '—';
    $('p-desc').textContent = p.description || '';
    $('p-desc-wrap').hidden = !p.description;
    $('p-asking-k').textContent = rent ? 'Ζητούμενο μίσθωμα' : 'Ζητούμενη τιμή';
    $('p-asking').textContent = p.asking ? p.asking + (rent ? ' / μήνα' : '') : '';
    $('p-asking-wrap').hidden = !p.asking;
    $('p-agent').textContent = D.agent ? 'Μεσίτης: ' + D.agent + ' · ' + D.office : D.office;
    $('l-price').textContent = rent ? 'Μηνιαίο μίσθωμα που προτείνετε (€)' : 'Τιμή αγοράς που προτείνετε (€)';
    $('i-price').textContent = rent
      ? 'Το μηνιαίο μίσθωμα που προτείνετε, σε ευρώ. Δεν σας δεσμεύει σε μίσθωση: ο ιδιοκτήτης μπορεί να δεχτεί, να αρνηθεί ή να κάνει αντιπρόταση.'
      : 'Το ποσό που προτείνετε για την αγορά, σε ευρώ. Δεν είναι αρραβώνας: ο ιδιοκτήτης μπορεί να δεχτεί, να αρνηθεί ή να κάνει αντιπρόταση.';
    $('pay').hidden = rent;
    $('today').textContent = D.today;
    $('expires').textContent = 'Το link ισχύει έως ' + D.expires + '.';
    show('form');
    pad = makePad($('pad'));
  }

  function wire() {
    wireInfo();
    $('form').addEventListener('submit', onSubmit);
    ['f-price', 'f-cash', 'f-loan'].forEach(function (id) { moneyInput($(id)); });
    $('all-cash').addEventListener('click', function () {
      var p = num($('f-price').value);
      if (!p) return fieldError('price', 'Γράψτε πρώτα την τιμή που προτείνετε.');
      $('f-cash').value = fmt(p); $('f-loan').value = '0'; updateSum();
    });
    $('f-name').addEventListener('input', function () {
      var s = $('f-signname');
      if (!s.dataset.touched) s.value = $('f-name').value;
    });
    $('f-signname').addEventListener('input', function () { this.dataset.touched = '1'; });
    $('pad-clear').addEventListener('click', function () { if (pad) pad.clear(); });
    Array.prototype.forEach.call(document.querySelectorAll('.field input'), function (inp) {
      inp.addEventListener('input', function () {
        var f = inp.closest('.field');
        if (f.classList.contains('bad')) { f.classList.remove('bad'); f.querySelector('.err').textContent = ''; }
      });
    });
  }

  function start() {
    logoFallback();
    if (!API) return closed('Η σελίδα δεν έχει ρυθμιστεί', 'Επικοινωνήστε με τον μεσίτη σας.');
    if (!/^[0-9a-f]{48}$/.test(KEY)) return closed('Το link δεν είναι πλήρες', 'Ανοίξτε ξανά το link όπως σας ήρθε, ή ζητήστε νέο από τον μεσίτη σας.');
    wire();
    api('offerOpen').then(function (d) { D = d; render(); }).catch(function (e) {
      closed(e.code === 'done' ? 'Η προσφορά έχει ήδη υποβληθεί' : 'Το έντυπο δεν είναι διαθέσιμο', e.message);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
