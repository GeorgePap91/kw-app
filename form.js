/*
 * KW App 1.14 · Φόρμα πελάτη για την εντολή υπόδειξης.
 * ─────────────────────────────────────────────────────────────
 * Ανοίγει από link μίας χρήσης: form.html#<κλειδί>. Το κλειδί είναι στο # και δεν
 * στέλνεται ποτέ στον server του GitHub. Φεύγει από τη γραμμή διευθύνσεων αμέσως
 * και μένει μόνο σε αυτή την καρτέλα (sessionStorage), για την περίπτωση ανανέωσης.
 * Η σελίδα δεν αποθηκεύει τίποτα από όσα γράφει ο πελάτης.
 */
(function () {
  'use strict';

  if (window.top !== window.self) {               // όχι μέσα σε ξένη σελίδα
    document.body.innerHTML = '';
    try { window.top.location = window.self.location.href; } catch (e) { /* μπλοκαρισμένο */ }
    return;
  }

  var API = (window.KW_CONFIG || {}).API_URL || '';
  var $ = function (id) { return document.getElementById(id); };
  var form = $('f-form');
  var mode = 'sign';
  var token = takeToken();
  var info = null;

  // ── Κλειδί ──────────────────────────────────────────────

  function takeToken() {
    var t = (location.hash || '').replace(/^#/, '');
    try {
      if (/^[0-9a-f]{48}$/.test(t)) sessionStorage.setItem('kwf', t);
      else t = sessionStorage.getItem('kwf') || '';
    } catch (e) { /* ιδιωτική περιήγηση: μένει μόνο στη μνήμη */ }
    if (location.hash) history.replaceState(null, '', location.pathname);
    return /^[0-9a-f]{48}$/.test(t) ? t : '';
  }

  function forget() { try { sessionStorage.removeItem('kwf'); } catch (e) { /* τίποτα */ } }

  // ── Επικοινωνία ─────────────────────────────────────────

  function api(action, data) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, data: data })
    }).then(function (r) {
      if (!r.ok) throw new Error('Πρόβλημα σύνδεσης (' + r.status + '). Δοκιμάστε ξανά.');
      return r.json();
    }).then(function (res) {
      if (!res.ok) { var e = new Error(res.error || 'Κάτι πήγε στραβά.'); e.code = res.code || ''; throw e; }
      return res.data;
    });
  }

  function show(which) {
    ['f-load', 'f-closed', 'f-done', 'f-form'].forEach(function (id) { $(id).hidden = id !== which; });
    window.scrollTo(0, 0);
  }

  function closed(title, text) {
    $('f-closed-title').textContent = title;
    $('f-closed-text').textContent = text;
    show('f-closed');
  }

  // ── Άνοιγμα ─────────────────────────────────────────────

  function start() {
    if (!API) return closed('Η φόρμα δεν είναι διαθέσιμη', 'Λείπει η ρύθμιση της εφαρμογής.');
    if (!token) return closed('Το link δεν είναι πλήρες', 'Ανοίξτε το ξανά από το μήνυμα του μεσίτη σας, ολόκληρο.');
    api('formOpen', { f: token }).then(fill).catch(function (e) {
      if (e.code === 'done') { forget(); return closed('Το έντυπο έχει ήδη σταλεί', e.message); }
      if (e.code === 'closed') forget();
      closed('Το link δεν ισχύει', e.message);
    });
  }

  function fact(label, value) {
    if (!value) return '';
    var div = document.createElement('div');
    var dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value;
    div.appendChild(dt); div.appendChild(dd);
    return div.outerHTML;
  }

  function fill(d) {
    info = d;
    $('f-office').textContent = d.office;
    $('f-intro').textContent = (d.agent ? d.agent + ' από το ' : 'Το ') + d.office +
      ' σας έδειξε το παρακάτω ακίνητο. Συμπληρώστε τα στοιχεία σας για την εντολή υπόδειξης.';
    var rent = d.prop.deal === 'Ενοικίαση';
    $('f-prop').innerHTML =
      fact('Κωδικός', d.prop.code) + fact('Διεύθυνση', d.prop.address) + fact('Είδος', d.prop.type) +
      fact('Τ.μ.', d.prop.sqm) + fact(rent ? 'Μίσθωμα' : 'Τιμή πώλησης', d.prop.price) +
      fact('Μεσιτική αμοιβή', d.fee) + fact('Γνωστά ελαττώματα', d.defects || 'Κανένα');
    $('f-term2').textContent = rent
      ? 'για την περίπτωση μισθώσεως, το αντίστοιχο του μισθώματος, ήτοι ' + (d.prop.price || '—') +
        ' πλέον ΦΠΑ 24%, δηλαδή τελική αμοιβή ' + d.rentVat + ' ευρώ, με ημερομηνία πληρωμής την ημερομηνία κατάρτισης της μίσθωσης.'
      : 'για την περίπτωση αγοράς/ανταλλαγής/αντιπαροχής, ποσοστό ΔΥΟ (2%) πλέον ΦΠΑ επί της τιμής αγοραπωλησίας ' +
        '(με κατ’ ελάχιστη αμοιβή τις 2000€ πλέον ΦΠΑ, δηλαδή 2480€), καταβλητέο κατά την ημέρα υπογραφής του προσυμφώνου ή του οριστικού συμβολαίου, ό,τι υπογραφεί πρώτο.';
    $('f-term3').textContent = d.defects || 'Κανένα';
    $('f-foot').textContent = 'Το link ισχύει έως ' + d.expires + ' και χρησιμοποιείται μία φορά. ' +
      (d.copy ? 'Μετά την αποστολή θα λάβετε αντίγραφο στο email σας.' : '');
    show('f-form');
    pad.resize();
  }

  // ── Εταιρεία, τρόπος υπογραφής ──────────────────────────

  $('f-consent').addEventListener('change', function () {
    if (this.checked) { $('f-consent-box').classList.remove('is-bad'); if (/όρους/.test($('f-hint').textContent)) mark(null, ''); }
  });

  $('f-behalf').onchange = function () { $('f-company').hidden = !this.checked; };

  document.querySelectorAll('.f-opt').forEach(function (b) {
    b.onclick = function () {
      mode = b.dataset.mode;
      document.querySelectorAll('.f-opt').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      $('f-pad-wrap').hidden = mode !== 'sign';
      $('f-print-note').hidden = mode !== 'print';
      $('f-send').textContent = mode === 'sign' ? 'Υπογραφή και αποστολή' : 'Αποστολή στοιχείων';
      if (mode === 'sign') pad.resize();
    };
  });

  // ── Υπογραφή με το δάχτυλο ──────────────────────────────
  // Μετράμε πόση «μελάνη» έπεσε, για να μη γίνεται δεκτή μια τελεία ως υπογραφή.

  var pad = (function () {
    var c = $('f-pad'), ctx = c.getContext('2d');
    var drawing = false, last = null, ink = 0, strokes = [];

    function resize() {
      var r = c.getBoundingClientRect();
      if (!r.width) return;
      var k = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * k);
      c.height = Math.round(r.height * k);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10204a';
      strokes.forEach(function (s) { draw(s); });          // ξανά ό,τι είχε γραφτεί (περιστροφή οθόνης)
    }

    function draw(s) {
      ctx.beginPath();
      s.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y);
      ctx.stroke();
    }

    function pos(e) {
      var r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    c.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      strokes.push([last]);
      $('f-pad-hint').hidden = true;
    });
    c.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      ink += Math.hypot(p.x - last.x, p.y - last.y);
      strokes[strokes.length - 1].push(p);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      c.addEventListener(ev, function () { drawing = false; });
    });
    window.addEventListener('resize', resize);

    return {
      resize: resize,
      clear: function () { strokes = []; ink = 0; ctx.clearRect(0, 0, c.width, c.height); $('f-pad-hint').hidden = false; },
      ok: function () { return ink > 120; },
      png: function () {
        // Σε λευκό φόντο, ώστε να φαίνεται σωστά και στο PDF.
        var out = document.createElement('canvas');
        out.width = c.width; out.height = c.height;
        var o = out.getContext('2d');
        o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
        o.drawImage(c, 0, 0);
        return out.toDataURL('image/png');
      }
    };
  })();

  $('f-pad-clear').onclick = function () { pad.clear(); };

  // ── Έλεγχος ─────────────────────────────────────────────

  function validAfm(a) {
    if (!/^\d{9}$/.test(a) || /^0+$/.test(a)) return false;
    var sum = 0;
    for (var i = 0; i < 8; i++) sum += Number(a[i]) * Math.pow(2, 8 - i);
    return (sum % 11) % 10 === Number(a[8]);
  }

  /** «EL 801 085 328», «801.085.328» → «801085328». */
  function cleanAfm(a) { return String(a || '').trim().replace(/^(EL|GR|ΕΛ)\s*/i, '').replace(/\D/g, ''); }

  /** Μήνυμα για τον ΑΦΜ, ή '' αν είναι έγκυρος. */
  function afmProblem(a) {
    if (a.length !== 9) return 'Ο ΑΦΜ έχει 9 ψηφία. Γράψατε ' + a.length + '.';
    if (!validAfm(a)) return 'Ελέγξτε τα ψηφία: δεν περνά τον αυτόματο έλεγχο.';
    return '';
  }

  // Έλεγχος την ώρα που γράφει. Ο αυτόματος έλεγχος (ψηφίο ελέγχου) ΔΕΝ μπλοκάρει:
  // αν ο ΑΦΜ δεν τον περνά, ο πελάτης μπορεί να επιβεβαιώσει ότι είναι σωστός.
  function afmUi() {
    var el = form.elements.afm, a = cleanAfm(el.value), hint = $('f-afm-hint');
    var full = a.length === 9, ok = full && validAfm(a);
    hint.textContent = a.length < 9 ? '' : ok ? '✓ Έγκυρος ΑΦΜ' : afmProblem(a);
    hint.className = 'f-fieldhint' + (a.length < 9 ? '' : ok ? ' good' : ' bad');
    $('f-afm-okbox').hidden = !(full && !ok);
    if (ok || !full) $('f-afm-ok').checked = false;
    if (ok) el.classList.remove('is-bad');
  }
  form.elements.afm.addEventListener('input', afmUi);
  $('f-afm-ok').addEventListener('change', function () {
    if (this.checked) { form.elements.afm.classList.remove('is-bad'); $('f-afm-okbox').classList.remove('is-bad'); }
  });

  var LABEL = { name: 'Ονοματεπώνυμο', father: 'Πατρώνυμο', city: 'Κάτοικος', street: 'Οδός', number: 'Αριθμός',
                job: 'Επάγγελμα', adt: 'Α.Δ.Τ.', afm: 'ΑΦΜ', doy: 'ΔΟΥ', phone: 'Τηλέφωνο', email: 'Email' };

  function values() {
    var v = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.name === 'consent') return;
      v[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    v.afm = cleanAfm(v.afm);
    return v;
  }

  /** Πρώτο λάθος: [πεδίο, μήνυμα], ή null. Ίδιοι κανόνες με τον server. */
  function check(v) {
    var keys = Object.keys(LABEL);
    for (var i = 0; i < keys.length; i++) if (!v[keys[i]]) return [keys[i], 'Συμπληρώστε: ' + LABEL[keys[i]] + '.'];
    if (v.name.split(/\s+/).length < 2) return ['name', 'Γράψτε όνομα και επώνυμο.'];
    if (v.afm.length !== 9) return ['afm', afmProblem(v.afm)];
    if (!validAfm(v.afm) && !v.afmOk) return ['afmOk', 'Ο ΑΦΜ δεν περνά τον αυτόματο έλεγχο. Ελέγξτε τα ψηφία, ή τσεκάρετε «Ο ΑΦΜ μου είναι σωστός».'];
    var ph = v.phone.replace(/\D/g, '');
    if (ph.length < 10 || ph.length > 15) return ['phone', 'Το τηλέφωνο δεν φαίνεται σωστό.'];
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(v.email)) return ['email', 'Το email δεν φαίνεται σωστό.'];
    if (v.onBehalf && !v.company) return ['company', 'Γράψτε για λογαριασμό ποιου συμβάλλεστε.'];
    if (v.onBehalf && !v.capacity) return ['capacity', 'Γράψτε την ιδιότητά σας (π.χ. νόμιμος εκπρόσωπος).'];
    if (mode === 'sign' && !pad.ok()) return ['sig', 'Υπογράψτε στο πλαίσιο.'];
    if (!$('f-consent').checked) return ['consent', 'Για να σταλεί το έντυπο, τσεκάρετε ότι διαβάσατε τους όρους και αποδέχεστε τον όρο 8.'];
    return null;
  }

  function mark(field, msg) {
    form.querySelectorAll('.is-bad').forEach(function (x) { x.classList.remove('is-bad'); x.removeAttribute('aria-invalid'); });
    $('f-hint').className = 'save-hint' + (msg ? ' err' : '');
    $('f-hint').textContent = msg || '';
    if (!field) return;
    var el = field === 'sig' ? $('f-pad') : field === 'consent' ? $('f-consent') : form.elements[field];
    if (!el) return;
    if (field === 'afmOk') { $('f-afm-okbox').hidden = false; el = $('f-afm-ok'); }
    var box = field === 'sig' ? el.parentNode : field === 'consent' ? $('f-consent-box') : field === 'afmOk' ? $('f-afm-okbox') : el;
    box.classList.add('is-bad');
    if (el.setAttribute) el.setAttribute('aria-invalid', 'true');
    (field === 'sig' || field === 'consent' || field === 'afmOk' ? box : el).scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (field !== 'sig' && el.focus) el.focus({ preventScroll: true });
  }

  // ── Αποστολή ────────────────────────────────────────────

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = values();
    var bad = check(v);
    if (bad) return mark(bad[0], bad[1]);
    mark(null, '');

    var btn = $('f-send');
    btn.disabled = true;
    btn.textContent = 'Αποστολή…';
    api('formSubmit', {
      f: token, c: v, mode: mode, consent: true, ua: navigator.userAgent,
      sig: mode === 'sign' ? pad.png() : ''
    }).then(function (res) {
      forget();
      form.reset();                                   // τίποτα δεν μένει στη σελίδα
      pad.clear();
      $('f-done-title').textContent = mode === 'sign' ? 'Ευχαριστούμε! Η εντολή υπογράφηκε.' : 'Ευχαριστούμε! Τα στοιχεία στάλθηκαν.';
      $('f-done-text').textContent = 'Α/Α ' + res.aa + '. ' +
        (res.copied ? 'Θα λάβετε αντίγραφο στο email σας σε λίγα λεπτά. ' : '') +
        (mode === 'print' ? 'Ο μεσίτης θα σας φέρει το έντυπο να το υπογράψετε.' : 'Μπορείτε να κλείσετε τη σελίδα.');
      show('f-done');
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = mode === 'sign' ? 'Υπογραφή και αποστολή' : 'Αποστολή στοιχείων';
      if (err.code === 'done' || err.code === 'closed') { forget(); return closed('Το link δεν ισχύει', err.message); }
      var f = /^field:/.test(err.code || '') ? err.code.slice(6) : null;
      mark(f, err.message);
    });
  });

  start();
})();
