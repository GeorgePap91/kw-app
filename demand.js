/* 2.14 · Φόρμα ζήτησης για τον πελάτη.
   Το κλειδί είναι μετά το # (δεν στέλνεται ποτέ στον server της σελίδας).
   Ό,τι γράφει ο πελάτης φεύγει μόνο στο Apps Script. Τίποτα δεν κρατιέται στη συσκευή. */
(function () {
  'use strict';

  var API = (window.KW_CONFIG || {}).API_URL || '';
  var KEY = String(location.hash || '').replace(/^#/, '').trim();
  var $ = function (id) { return document.getElementById(id); };
  var beds = '';
  var floors = [];

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
    el.addEventListener('blur', function () { var n = num(el.value); el.value = n ? fmt(n) : ''; });
  }

  function field(name) { return document.querySelector('[data-f="' + name + '"]'); }
  function clearErr(name) {
    var f = field(name);
    if (!f) return;
    f.classList.remove('bad');
    var e = f.querySelector('.err'); if (e) e.textContent = '';
  }
  function setErr(name, msg) {
    var f = field(name);
    if (!f) { $('form-err').textContent = msg; $('form-err').hidden = false; return; }
    f.classList.add('bad');
    var e = f.querySelector('.err'); if (e) e.textContent = msg;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

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

  // ── Επιλογές με κουμπιά (μεγάλα, για τον αντίχειρα) ──────
  function chip(label, attr, on) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute(attr, on ? 'true' : 'false');
    return b;
  }

  function buildBeds(list) {
    var box = $('beds');
    list.forEach(function (v) {
      var b = chip(v, 'aria-checked', false);
      b.setAttribute('role', 'radio');
      b.addEventListener('click', function () {
        beds = beds === v ? '' : v;                         // ξανά πάτημα = ακύρωση
        Array.prototype.forEach.call(box.children, function (x) { x.setAttribute('aria-checked', x.textContent === beds ? 'true' : 'false'); });
      });
      box.appendChild(b);
    });
  }

  function buildFloors(list) {
    var box = $('floors');
    list.forEach(function (v) {
      var b = chip(v, 'aria-pressed', false);
      b.addEventListener('click', function () {
        var i = floors.indexOf(v);
        if (i === -1) floors.push(v); else floors.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
      });
      box.appendChild(b);
    });
  }

  // ── Άνοιγμα ──────────────────────────────────────────────
  function start() {
    logoFallback();
    if (!/^[0-9a-f]{48}$/.test(KEY)) { closed('Το link δεν είναι σωστό', 'Ανοίξτε ξανά το link όπως σας ήρθε, ή ζητήστε νέο από τον μεσίτη σας.'); return; }
    if (!API) { closed('Η φόρμα δεν είναι διαθέσιμη', 'Δοκιμάστε ξανά αργότερα.'); return; }
    api('demandOpen').then(function (d) {
      var rent = d.deal === 'Ενοικίαση';
      $('title').textContent = rent ? 'Τι σπίτι ψάχνετε να νοικιάσετε;' : 'Τι ακίνητο ψάχνετε;';
      $('lead-in').textContent = (d.first ? d.first + ', ' : '') + 'συμπληρώστε όσα ξέρετε, για να σας στέλνει ' +
        (d.agent ? 'ο/η ' + d.agent : 'ο μεσίτης σας') + ' μόνο ό,τι σας ταιριάζει. Όλα τα πεδία είναι προαιρετικά.';
      $('l-price').textContent = rent ? 'Ενοίκιο τον μήνα (€)' : 'Τιμή (€)';
      if (d.area) $('f-areas').placeholder = 'π.χ. ' + d.area + ', …';
      buildBeds(d.beds || ['1', '2', '3', '4+']);
      buildFloors(d.floors || []);
      $('expires').textContent = d.expires ? 'Το link ισχύει έως ' + d.expires + '.' : '';
      show('form');
    }).catch(function (e) {
      if (e.code === 'done') { $('done-text').textContent = e.message; show('done'); return; }
      closed('Η φόρμα δεν είναι διαθέσιμη', e.message);
    });
  }

  function collect() {
    var v = function (id) { return $(id).value; };
    return {
      priceMin: v('f-priceMin'), priceMax: v('f-priceMax'),
      sqmMin: v('f-sqmMin'), sqmMax: v('f-sqmMax'),
      ppsMin: v('f-ppsMin'), ppsMax: v('f-ppsMax'),
      yearMin: v('f-yearMin'), yearMax: v('f-yearMax'),
      beds: beds, floors: floors.slice(),
      areas: v('f-areas'), notes: v('f-notes'),
      parking: $('f-parking').checked, furnished: $('f-furnished').checked
    };
  }

  /** Γρήγορος έλεγχος στη συσκευή (ο σωστός γίνεται στον server). */
  function check(c) {
    var pair = function (a, b, f) {
      var x = num(c[a]), y = num(c[b]);
      if (x && y && x > y) { setErr(f, 'Το «από» πρέπει να είναι μικρότερο από το «έως».'); return false; }
      return true;
    };
    return pair('priceMin', 'priceMax', 'price') && pair('sqmMin', 'sqmMax', 'sqm') &&
           pair('ppsMin', 'ppsMax', 'pps') && pair('yearMin', 'yearMax', 'year');
  }

  function submit(ev) {
    ev.preventDefault();
    ['price', 'sqm', 'pps', 'year', 'areas', 'notes'].forEach(clearErr);
    $('form-err').hidden = true;
    var c = collect();
    if (!check(c)) return;
    var btn = $('submit');
    btn.disabled = true;
    btn.textContent = 'Αποστολή…';
    api('demandSubmit', { c: c }).then(function () {
      $('done-text').textContent = 'Ο μεσίτης σας πήρε τις απαντήσεις και θα σας στείλει ακίνητα που σας ταιριάζουν.';
      show('done');
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Αποστολή';
      if (e.code === 'done') { $('done-text').textContent = e.message; show('done'); return; }
      if (e.code === 'closed') { closed('Η φόρμα δεν είναι διαθέσιμη', e.message); return; }
      var m = /^field:(\w+)$/.exec(e.code || '');
      if (m) setErr(m[1], e.message);
      else { $('form-err').textContent = e.message; $('form-err').hidden = false; }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    ['f-priceMin', 'f-priceMax', 'f-sqmMin', 'f-sqmMax', 'f-ppsMin', 'f-ppsMax'].forEach(function (id) { moneyInput($(id)); });
    ['f-yearMin', 'f-yearMax'].forEach(function (id) {
      $(id).addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); });
    });
    wireInfo();
    $('form').addEventListener('submit', submit);
    start();
  });
})();
