/**
 * KW App — ό,τι τρέχει στο κινητό του μεσίτη.
 *
 *  · Μιλάει με το Apps Script (config.js → API_URL) με απλά POST.
 *  · Ταυτότητα = το κλειδί από το προσωπικό link (?k=…), κρατιέται στη συσκευή.
 *  · Μία κλήση στην εκκίνηση (bootstrap). Φίλτρα και ομαδοποιήσεις γίνονται εδώ.
 *  · Ό,τι συμβαίνει τη στιγμή που φεύγεις από τη σελίδα (Κλήση, SMS) στέλνεται
 *    με sendBeacon: ο browser το παραδίδει ακόμα κι αν ανοίξει η εφαρμογή
 *    τηλεφώνου. Αυτό έλυσε το «πάτησα Κλήση και δεν άλλαξε η κατάσταση».
 */
(function () {
'use strict';

// Η εφαρμογή δεν ανοίγει μέσα σε ξένη σελίδα (προστασία από «clickjacking»).
if (window.top !== window.self) {
  document.documentElement.innerHTML = '';
  try { window.top.location = window.self.location.href; } catch (e) { /* μπλοκαρισμένο */ }
  return;
}

// ─────────────────────────────────────────────────────────────
//  ΡΥΘΜΙΣΕΙΣ & ΚΑΤΑΣΤΑΣΗ
// ─────────────────────────────────────────────────────────────

/** Έκδοση σελίδας. */
var APP_VERSION = '2.3.3';

/** Έκδοση server που περιμένει η σελίδα. */
var API_VERSION = '1.20';

var API = (window.KW_CONFIG || {}).API_URL || '';
var params = new URLSearchParams(location.search);

// KEY: το προσωπικό link. Χρησιμεύει ΜΟΝΟ για να ζητηθεί κωδικός σύνδεσης.
// TOKEN: το κλειδί αυτής της συσκευής, μετά τον κωδικό. Με αυτό γίνονται όλα.
var KEY = params.get('k') || '';
var TOKEN = store('kw_token');
store('kw_key', null);                     // καθαρίζει ό,τι κρατούσαν παλιότερες εκδόσεις
var LEAD_PARAM = params.get('lead') || '';
var REMIND_PARAM = params.get('remind') === '1';
var DOCS_PARAM = params.get('docs') === '1';
var ACT_PARAM = /^o\d$/.test(params.get('do') || '') ? params.get('do') : '';   // 2.3 · FEAT-3
var Push = window.KWPush;

// Το ?lead / ?remind χρησιμοποιούνται μία φορά. Τα βγάζουμε από τη διεύθυνση,
// ώστε μια ανανέωση της σελίδας να μην ξανανοίγει την ίδια κλήση.
// Το link (?k=…) και τα ?lead / ?remind / ?docs φεύγουν από τη γραμμή διευθύνσεων
// μόλις διαβαστούν: δεν μένουν στο ιστορικό, σε screenshots ή σε κοινοποιήσεις.
if (location.search && history.replaceState) history.replaceState(null, '', location.pathname);

var ST = {
  PENDING:   'Αναπάντητη',
  ANSWERED:  'Απαντημένη',
  NO_ANSWER: 'Δεν απάντησε',
  SHOWING:   'Υπόδειξη',
  CLOSED:    'Κλειστή'
};

var STATUS_CLASS = {};
STATUS_CLASS[ST.PENDING]   = 'pending';
STATUS_CLASS[ST.ANSWERED]  = 'answered';
STATUS_CLASS[ST.NO_ANSWER] = 'noanswer';
STATUS_CLASS[ST.SHOWING]   = 'showing';
STATUS_CLASS[ST.CLOSED]    = 'closed';

var S = {
  boot: null, me: null, leads: [], props: [], lead: null,
  filter: 'new', propFilter: null, view: 'today',
  noteTimer: null, smsLang: 'el', smsKind: 'intro', cancelled: null, wired: false,
  tasks: [], task: null, docs: {}, prop: null, uploading: {}, tplDraft: null, tplLang: {},
  propTab: 'mine', taskTab: 'today', outcome: '',
  mx: null, mxMode: 'month', mxMonth: '', mxYear: '', mxOpen: '', mxLoading: false
};

var $ = function (id) { return document.getElementById(id); };
var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k) || '';
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (e) { /* ιδιωτική περιήγηση: η σύνδεση κρατά μόνο όσο είναι ανοιχτή η σελίδα */ }
  return '';
}

/** Εικονίδιο από τα σύμβολα της index.html. */
function ico(name, cls) {
  return '<svg class="' + (cls || 'ico') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

/** Κουμπί με εικονίδιο και κείμενο. */
function label(el, icon, text) { el.innerHTML = ico(icon) + '<span>' + esc(text) + '</span>'; }

// ── Μέγεθος γραμμάτων ─────────────────────────────────────
// Κρατιέται στη συσκευή. Όλο το CSS είναι σε rem, οπότε μεγαλώνουν όλα μαζί.

function applySize(size) {
  document.documentElement.setAttribute('data-size', size);
  $$('#size-pick button').forEach(function (b) {
    var on = b.dataset.size === size;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
applySize(store('kw_size') || 'm');

// ── 2.0 · Θέμα: Αυτόματο (όπως το κινητό), Φωτεινό, Σκούρο ──
// Κρατιέται στη συσκευή. Το σκούρο ισχύει μόνο μέσα στην εφαρμογή, όχι στις σελίδες του πελάτη.

var DARK_MQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme(pref) {
  pref = pref || 'auto';
  var dark = pref === 'dark' || (pref === 'auto' && !!(DARK_MQ && DARK_MQ.matches));
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', dark ? '#15181b' : '#ffffff');
  $$('#theme-pick [data-theme-set]').forEach(function (b) {
    var on = b.dataset.themeSet === pref;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
applyTheme(store('kw_theme'));
if (DARK_MQ) {
  var onScheme = function () { if ((store('kw_theme') || 'auto') === 'auto') applyTheme('auto'); };
  if (DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', onScheme);
  else if (DARK_MQ.addListener) DARK_MQ.addListener(onScheme);
}

// ── Κίνηση ────────────────────────────────────────────────

var CALM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Το περιεχόμενο μπαίνει από τα δεξιά (dir > 0) ή από τα αριστερά. */
function slide(el, dir) {
  if (CALM || !dir) return;
  el.classList.remove('slide-r', 'slide-l');
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'slide-r' : 'slide-l');
  clearTimeout(el._s);
  el._s = setTimeout(function () { el.classList.remove('slide-r', 'slide-l'); }, 300);
}

// ── Tabs μέσα στις ενότητες ───────────────────────────────

function setTab(id, value) {
  $$('#' + id + ' .subtab').forEach(function (b) {
    var on = (b.dataset.tab || b.dataset.mode) === value;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

/** Συνδέει μια σειρά tabs. onChange(τιμή) και κίνηση προς τη σωστή πλευρά στο pane. */
function wireTabs(id, pane, onChange) {
  var btns = $$('#' + id + ' .subtab');
  btns.forEach(function (b, i) {
    b.onclick = function () {
      var before = btns.map(function (x) { return x.classList.contains('is-on'); }).indexOf(true);
      if (before === i) return;
      setTab(id, b.dataset.tab || b.dataset.mode);
      onChange(b.dataset.tab || b.dataset.mode);
      slide($(pane), i - before);
    };
  });
}

/** Δείχνει ένα από τα [data-pane] μέσα στο container. */
function showPane(container, value) {
  $(container).querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== value; });
}

// ── Φύλλα (κλήση, ακίνητο, ρυθμίσεις…) και «πίσω» του κινητού ──
// Στο ιστορικό υπάρχει πάντα ένα βήμα-φύλακας. Το «πίσω» πέφτει πάνω του, οπότε
// αποφασίζουμε εμείς: κλείνει το ανοιχτό φύλλο, γυρίζει στο Σήμερα ή ρωτά για έξοδο.
// Το κλείσιμο από τις Πρόσφατες δεν φτάνει ποτέ στη σελίδα, και αυτό δεν αλλάζει.

var POPS = ['present', 'smsbox', 'quick', 'pick', 'callnote', 'offer', 'lpick'];
var SHEETS = ['review', 'alead', 'aprop', 'referral', 'contact-edit', 'templates', 'task', 'settings', 'showing', 'propdetail', 'contact', 'detail'];
var exiting = false;

function backGuard() { if (history.pushState) history.pushState({ kw: 1 }, ''); }

function openSheet(id) {
  var el = $(id);
  clearTimeout(el._t);
  el.classList.remove('leaving');
  el.hidden = false;
}

function closeSheet(id) {
  var el = $(id);
  if (el.hidden || el.classList.contains('leaving')) return;
  if (CALM) { el.hidden = true; return; }
  el.classList.add('leaving');
  clearTimeout(el._t);
  el._t = setTimeout(function () {
    el.hidden = true;
    el.classList.remove('leaving');
  }, 210);
}

function openSheets() {
  return SHEETS.filter(function (id) { return !$(id).hidden && !$(id).classList.contains('leaving'); });
}

/** Κλείνει ό,τι είναι πιο πάνω (Esc ή «πίσω» του κινητού). */
function closeTop() {
  if (!$('ask').hidden) { if (askCancel) askCancel(); return true; }
  if (!$('gallery').hidden) { closeGallery(); return true; }
  var pop = POPS.filter(function (id) { return !$(id).hidden; })[0];
  if (pop) { closePop(pop); return true; }
  var top = openSheets()[0];
  if (!top) return false;
  if (top === 'settings' && S.setSub) settingsMenu();
  else if (top === 'detail') closeDetail();
  else {
    if (top === 'propdetail') S.prop = null;
    if (top === 'aprop') S.aprop = null;
    if (top === 'review') clearPreview();
    closeSheet(top);
  }
  return true;
}

function askExit() {
  ask('Έξοδος από την εφαρμογή;', 'Οι ειδοποιήσεις για νέες κλήσεις θα συνεχίσουν να έρχονται.',
      'Ναι, έξοδος', 'Όχι, μένω').then(function (yes) {
    if (!yes) return;
    exiting = true;
    try { window.close(); } catch (e) { /* συνεχίζουμε με το ιστορικό */ }
    history.go(-2);                          // πριν από τον φύλακα: βγαίνει από την εφαρμογή
  });
}

window.addEventListener('popstate', function () {
  if (exiting || !S.boot) return;
  backGuard();
  if (closeTop()) return;
  if (isAdminMode()) { if (S.view !== 'a-review') goto('a-review'); else askExit(); return; }
  if (NAV_OF[S.view]) goto('more');
  else if (S.view !== 'today') goto('today');
  else askExit();
});

/**
 * Ερώτηση με μεγάλα κουμπιά, ένα κάτω από το άλλο. options: [{ key, label, cls }].
 * Το τελευταίο είναι πάντα η ακύρωση (key null). Επιστρέφει Promise<key>.
 */
var askCancel = null;

function choose(title, text, options) {
  return new Promise(function (resolve) {
    $('ask-title').textContent = title;
    $('ask-text').textContent = text;
    $('toast').hidden = true;
    var box = $('ask-btns');
    box.innerHTML = options.map(function (o, i) {
      return '<button class="btn wide ' + (o.cls || '') + '" data-i="' + i + '">' + esc(o.label) + '</button>';
    }).join('');
    $('ask').hidden = false;
    var done = function (v) { $('ask').hidden = true; askCancel = null; resolve(v); };
    askCancel = function () { done(null); };
    box.querySelectorAll('[data-i]').forEach(function (b) {
      b.onclick = function () { done(options[Number(b.dataset.i)].key); };
    });
    $('ask').onclick = function (e) { if (e.target === $('ask')) done(null); };
    box.lastChild.focus();
  });
}

/** Ερώτηση επιβεβαίωσης με δύο μεγάλα κουμπιά. Επιστρέφει Promise<boolean>. */
function ask(title, text, yes, no) {
  return choose(title, text, [{ key: 'yes', label: yes, cls: 'solid-red' }, { key: null, label: no || 'Όχι, πίσω' }])
    .then(function (k) { return k === 'yes'; });
}

// ── Αναδυόμενα φύλλα από κάτω (1.16): SMS, ＋ Νέο ─────────
// Ανοίγουν πάνω από ό,τι είναι ανοιχτό. Κλείνουν με ✕, πάτημα έξω, Esc ή «πίσω».

function openPop(id) {
  var el = $(id);
  el.classList.remove('leaving');
  el.hidden = false;
  var f = el.querySelector('[data-pop-close]');
  if (f) f.focus();
}

function closePop(id) {
  var el = $(id);
  if (el.hidden) return;
  if (CALM) { el.hidden = true; return; }
  el.classList.add('leaving');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.hidden = true; el.classList.remove('leaving'); }, 180);
}

function wirePops() {
  POPS.forEach(function (id) {
    var el = $(id);
    el.onclick = function (e) { if (e.target === el) closePop(id); };
    el.querySelectorAll('[data-pop-close]').forEach(function (b) { b.onclick = function () { closePop(id); }; });
  });
}

// ── Αρχικά ονόματος (avatar) ───────────────────────────────

/** «Γιώργος Παπαδάκης» → «ΓΠ». Χωρίς όνομα → «?». */
function initials(name) {
  var w = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-zΑ-Ωα-ωςΆ-ώ\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

function fillInitials() {
  var me = S.me || {};
  var txt = initials(me.name);
  $$('[data-initials]').forEach(function (el) { el.textContent = txt; });
}

/** Γκρι μπλοκ που «αναπνέουν» όσο φορτώνει μια λίστα (αντί για «Φόρτωση…»). */
function skel(n, tall) {
  var out = '<div class="skel-list" aria-busy="true" aria-label="Φόρτωση">';
  for (var i = 0; i < (n || 4); i++) out += '<div class="skel' + (tall ? ' tall' : '') + '"><i></i><i></i></div>';
  return out + '</div>';
}

// ─────────────────────────────────────────────────────────────
//  ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ ΤΟ APPS SCRIPT
// ─────────────────────────────────────────────────────────────
// text/plain: δεν προκαλεί CORS preflight, που το Apps Script δεν δέχεται.

function body(action, data) {
  return JSON.stringify({ t: TOKEN, action: action, data: data || {} });
}

function api(action, data, signal) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body(action, data),
    signal: signal
  }).catch(function (e) {
    var n = new Error(e && e.name === 'AbortError' ? 'Ο server αργεί να απαντήσει.' : 'Χωρίς σύνδεση στο internet.');
    n.net = true;
    throw n;
  }).then(function (r) {
    if (!r.ok) { var x = new Error('Σφάλμα δικτύου (' + r.status + ')'); x.net = true; throw x; }
    return r.json();
  }).then(function (res) {
    if (!res.ok) {
      var e = new Error(res.error || 'Άγνωστο σφάλμα');
      e.code = res.code;
      if (e.code === 'auth' && S.boot) authLost();   // ανακλήθηκε ενώ ήταν ανοιχτή
      throw e;
    }
    return res.data;
  });
}

/** Στέλνει χωρίς να περιμένει απάντηση· επιβιώνει όταν η σελίδα πάει στο παρασκήνιο. */
function beacon(action, data) {
  // 2.2: χωρίς σήμα, ή αν υπάρχει ήδη ουρά, η ενέργεια μπαίνει στην ουρά (με τη σειρά).
  if (OFF.QUEUED[action] && (S.queue.length || S.netBad || navigator.onLine === false)) { qPush(action, data); return; }
  var payload = body(action, data);
  try {
    if (navigator.sendBeacon &&
        navigator.sendBeacon(API, new Blob([payload], { type: 'text/plain;charset=utf-8' }))) return;
  } catch (e) { /* συνεχίζουμε με fetch */ }
  fetch(API, { method: 'POST', body: payload, keepalive: true, mode: 'no-cors',
               headers: { 'Content-Type': 'text/plain;charset=utf-8' } }).catch(function () {});
}

// ─────────────────────────────────────────────────────────────
//  ΕΚΚΙΝΗΣΗ
// ─────────────────────────────────────────────────────────────
// 2.2: η start() καλείται στο τέλος του αρχείου, αφού οριστούν όλα (και το offline κομμάτι).

function start() {
  if (!API || API.indexOf('ΒΑΛΕ') !== -1) return bootFail('Λείπει το API_URL στο config.js.', true);
  if (!TOKEN) return needPairing();

  $('boot-msg').textContent = 'Φόρτωση…';
  $('boot-retry').hidden = true;
  qLoad();
  offProfilesLoad();

  // 2.2: αν το κινητό έχει τα τελευταία στοιχεία, η εφαρμογή ανοίγει αμέσως, και με σήμα και χωρίς.
  // Τα φρέσκα έρχονται από πίσω.
  var cached = offCached();
  if (cached) {
    S.bootAt = cached.from;
    S.bootStale = true;
    onBoot(cached.b);
    apiTimed('bootstrap', {}, 20000).then(function (b) {
      S.bootStale = false;
      S.bootAt = Date.now();
      S.boot = b; S.me = b.agent; S.flags = b.flags || {};   // 2.3.2: και τα feature flags
      applyData(b);
      render();
      fillSettings();
      offSnapshot();
      offBar();
      offFlushSoon(500);
    }).catch(function (e) {
      if (e.code === 'auth') { forgetDevice(); needPairing(true); return; }
      offBar();
    });
    return;
  }

  api('bootstrap').then(function (b) {
    S.bootAt = Date.now();
    onBoot(b);
    offSnapshot();
  }).catch(function (e) {
    if (e.code === 'auth') { forgetDevice(); return needPairing(true); }
    bootFail(e.net ? 'Χωρίς σύνδεση. Την πρώτη φορά η εφαρμογή χρειάζεται internet για να φέρει τα στοιχεία σου.'
                   : 'Δεν φόρτωσε: ' + e.message, false);
  });
}

// ─────────────────────────────────────────────────────────────
//  ΣΥΝΔΕΣΗ ΣΥΣΚΕΥΗΣ
// ─────────────────────────────────────────────────────────────

var pairId = '';

function deviceName() {
  var ua = navigator.userAgent;
  var os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
         : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Συσκευή';
  var app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  return os + (app ? ' · εφαρμογή' : ' · browser');
}

function forgetDevice() {
  offForget();                                     // 2.2: σβήνουν και τα στοιχεία πελατών από το κινητό
  TOKEN = '';
  store('kw_token', null);
  store('kw_push_token', null);
  store('kw_push_sent', null);
}

/** Χωρίς κλειδί συσκευής: με link → οθόνη κωδικού, χωρίς link → οδηγία. */
function needPairing(expired) {
  $('boot').hidden = false;
  $('app').hidden = true;
  if (!KEY) {
    return bootFail(expired
      ? 'Η σύνδεση αυτής της συσκευής έληξε ή ανακλήθηκε. Άνοιξε ξανά το προσωπικό σου link.'
      : 'Άνοιξε την εφαρμογή από το προσωπικό σου link.', true);
  }
  $('boot-msg').textContent = expired ? 'Η σύνδεση αυτής της συσκευής έληξε ή ανακλήθηκε.' : '';
  $('boot-msg').hidden = !expired;
  $('boot-retry').hidden = true;
  $('pair').hidden = false;
  $('pair-send').onclick = sendPairCode;
  $('pair-resend').onclick = sendPairCode;
  $('pair-verify').onclick = verifyPairCode;
  $('pair-code').oninput = function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
    if (this.value.length === 6) verifyPairCode();
  };
}

function pairApi(action, data) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data })
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.ok) { var e = new Error(res.error); e.code = res.code; throw e; }
    return res.data;
  });
}

function pairHint(msg, err) {
  $('pair-hint').textContent = msg || '';
  $('pair-hint').className = 'save-hint' + (err ? ' err' : '');
}

function sendPairCode() {
  var btn = $('pair-send');
  btn.disabled = true;
  pairHint('Αποστολή…');
  pairApi('pairStart', { k: KEY, device: deviceName() }).then(function (r) {
    pairId = r.pairId;
    btn.hidden = true;
    $('pair-step2').hidden = false;
    $('pair-sent').textContent = 'Στείλαμε κωδικό 6 ψηφίων στο ' + r.email + '. Ισχύει ' + r.minutes + ' λεπτά.';
    $('pair-code').value = '';
    $('pair-code').focus();
    pairHint('');
  }).catch(function (e) {
    pairHint(e.message, true);
    if (e.code === 'badlink') { KEY = ''; btn.hidden = true; }
  }).then(function () { btn.disabled = false; });
}

function verifyPairCode() {
  var code = $('pair-code').value;
  if (code.length !== 6) return pairHint('Ο κωδικός έχει 6 ψηφία.', true);
  $('pair-verify').disabled = true;
  pairHint('Έλεγχος…');
  pairApi('pairVerify', { pairId: pairId, code: code, device: deviceName() }).then(function (r) {
    TOKEN = r.token;
    store('kw_token', TOKEN);
    store('kw_push_sent', null);             // ξανακαταχώρηση ειδοποιήσεων για αυτή τη σύνδεση
    pairHint('Συνδέθηκε ✓');
    location.replace(location.pathname);
  }).catch(function (e) {
    pairHint(e.message, true);
    $('pair-code').value = '';
    if (e.code === 'expired') {
      $('pair-step2').hidden = true;
      $('pair-send').hidden = false;
    }
  }).then(function () { $('pair-verify').disabled = false; });
}

/** Η συσκευή ανακλήθηκε ενώ η εφαρμογή ήταν ανοιχτή. */
function authLost() {
  forgetDevice();
  S.boot = null;
  S.mx = null;
  ['detail', 'showing', 'task', 'settings', 'templates', 'propdetail'].forEach(function (id) { $(id).hidden = true; });
  needPairing(true);
}

function bootFail(msg, final) {
  $('boot-msg').hidden = false;
  $('boot-msg').textContent = msg;
  $('boot-retry').hidden = !!final;
  $('boot-retry').onclick = start;
}

function onBoot(b) {
  S.boot = b;
  S.me = b.agent;
  S.flags = b.flags || {};                         // 2.3: feature flags (Ιδιότητα σεναρίου FEATURES)
  applyData(b);

  $('env').hidden = b.env === 'prod';
  document.body.classList.toggle('has-env', b.env !== 'prod');
  fillSelect($('d-status-select'), b.statuses);
  renderForms(b.forms || []);
  $('book-link').href = b.bookingUrl || '#';
  $('book-link').hidden = !b.bookingUrl;
  ['more-book', 'quick-book'].forEach(function (id) {
    $(id).href = b.bookingUrl || '#';
    $(id).hidden = !b.bookingUrl;
  });
  fillInitials();
  $('tabs-forms').hidden = !b.bookingUrl;   // με μία μόνο ενότητα δεν χρειάζονται tabs
  fillSettings();

  // Ο χάρτης ανάβει από το CONFIG.MAP.ENABLED του Code.gs.
  $('tab-map').hidden = !b.mapEnabled;
  $('tabs-props').classList.toggle('four', !!b.mapEnabled);

  $('boot').hidden = true;
  $('app').hidden = false;

  render();
  if (!S.wired) { wire(); backGuard(); }

  // 1.17: Μόνο Admin → κατευθείαν Admin. Και οι δύο ρόλοι → όπως την άφησες την τελευταία φορά.
  var r = roles();
  setMode(!r.agent || (r.admin && store('kw_mode') === 'admin') ? 'admin' : 'agent', true);

  setInterval(poll, 180000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { poll(); checkPendingCall(); }   // γύρισες από την κλήση → φρέσκια λίστα, σημείωση
  });

  setupPush();
  if (LEAD_PARAM) openLead(LEAD_PARAM, { remind: REMIND_PARAM, act: ACT_PARAM });
  else if (DOCS_PARAM) showMissingDocs();
  setTimeout(checkPendingCall, 800);       // 1.20: αν η εφαρμογή ξαναφόρτωσε μετά από κλήση
}

// ─────────────────────────────────────────────────────────────
//  ΕΙΔΟΠΟΙΗΣΕΙΣ
// ─────────────────────────────────────────────────────────────

function sendToken(token, device) {
  return api('pushRegister', { token: token, device: device }).then(function (res) {
    S.boot.push = res;
    renderPush();
    return res;
  });
}

function setupPush() {
  if (!Push) return;
  Push.register().catch(function () { /* χωρίς service worker: η εφαρμογή δουλεύει κανονικά */ });

  Push.onMessage(function (m) {
    if (m.type === 'open' && m.docs) showMissingDocs();
    else if (m.type === 'open' && m.id) openLead(m.id, { remind: m.remind, act: m.act });
    if (m.type === 'push' && m.data && m.data.type === 'lead') refreshLeads();
    if (m.type === 'push' && m.data && m.data.type === 'adminreview' && isAdminMode()) pollAdmin();
    if (m.type === 'push' && m.data && m.data.type === 'review') {
      api('bootstrap').then(function (b) { S.boot.reviews = b.reviews || []; if (S.view === 'today') renderToday(); }).catch(function () {});
    }
  });

  Push.refresh(sendToken).catch(function () { /* θα ξαναδοκιμάσει στο επόμενο άνοιγμα */ });
  renderPush();
}

/** Banner στις κλήσεις + ενότητα στις ρυθμίσεις, ανάλογα με την κατάσταση. */
function renderPush() {
  if (!Push) return;
  var st = Push.state();
  var server = (S.boot && S.boot.push) || {};
  var on = Push.active() && server.devices > 0;

  // Banner
  var banner = st === 'default' || st === 'ios-install' || (st === 'granted' && !Push.active());
  $('push-banner').hidden = !banner || !server.ready;
  $('push-banner-btn').hidden = st === 'ios-install';
  $('push-banner-text').textContent = st === 'ios-install'
    ? 'Για ειδοποιήσεις νέων κλήσεων: Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας», και άνοιξε την εφαρμογή από εκεί.'
    : 'Ενεργοποίησε ειδοποιήσεις για να μαθαίνεις αμέσως τις νέες κλήσεις.';

  // Ρυθμίσεις
  var status = $('push-status');
  var msg, cls = 'cal-status warn';
  if (!server.ready) msg = 'Δεν έχουν ρυθμιστεί ακόμα στο γραφείο.';
  else if (on) { msg = 'Ενεργές σε αυτή τη συσκευή ✓'; cls = 'cal-status ok'; }
  else if (st === 'default' || st === 'granted') msg = 'Ανενεργές σε αυτή τη συσκευή.';
  else if (st === 'denied') msg = 'Μπλοκαρισμένες. Άνοιξε τις ρυθμίσεις του κινητού → Εφαρμογές → KW App → Ειδοποιήσεις, και ενεργοποίησέ τες.';
  else msg = Push.explain(st);
  status.textContent = msg;
  status.className = cls;

  $('btn-push-enable').hidden = !server.ready || on || (st !== 'default' && st !== 'granted');
  $('btn-push-test').hidden = !on;
  $('push-diag').textContent = Push.diag();
}

function onEnablePush(e) {
  var btn = e.currentTarget;
  var label = btn.textContent;
  var hint = $('push-hint');
  btn.disabled = true;
  hint.className = 'save-hint';
  hint.textContent = '';

  // Το βήμα φαίνεται πάνω στο ίδιο το κουμπί (και στο banner και στις ρυθμίσεις).
  var step = function (t) { btn.textContent = t; hint.textContent = t; };

  Push.enable(sendToken, step).then(function () {
    toast('Οι ειδοποιήσεις ενεργοποιήθηκαν');
  }).catch(function (err) {
    hint.className = 'save-hint err';
    hint.textContent = err.message;
    toast(err.message, true);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = label;
    renderPush();
  });
}

function onTestPush() {
  var btn = $('btn-push-test');
  btn.disabled = true;
  api('pushTest').then(function (r) {
    toast(r.sent ? 'Στάλθηκε — θα έρθει σε λίγα δευτερόλεπτα' : 'Δεν βρέθηκε ενεργή συσκευή. Ενεργοποίησε ξανά.', !r.sent);
    if (!r.sent) { S.boot.push = r; renderPush(); }
  }).catch(function (e) { toast(e.message, true); })
    .then(function () { btn.disabled = false; });
}

function applyData(b) {
  S.leads = b.leads || [];
  S.props = b.props || [];
  S.tasks = b.tasks || [];
  offReapply();                                    // 2.2: ό,τι δεν έχει σταλεί ακόμα μένει στην οθόνη
}

// ─────────────────────────────────────────────────────────────
//  ΧΕΙΡΙΣΤΗΡΙΑ
// ─────────────────────────────────────────────────────────────

function wire() {
  S.wired = true;

  $$('.tab').forEach(function (t) {
    t.onclick = function () { goto(t.dataset.view); };
  });

  wireTabs('tabs-calls', 'call-list', function (v) { S.filter = v; resetPage('calls'); renderCalls(); window.scrollTo(0, 0); });
  wireTabs('tabs-tasks', 'task-list', function (v) { S.taskTab = v; renderTasks(); window.scrollTo(0, 0); });
  wireTabs('tabs-forms', 'forms-panes', function (v) { showPane('forms-panes', v); });
  wireTabs('tabs-detail', 'detail-panes', function (v) { showPane('detail-panes', v); });
  wireTabs('tabs-prop', 'prop-panes', function (v) {
    showPane('prop-panes', v);
    S.propPane = v;
    if (v === 'bill' && S.prop) loadDocs(S.prop, 'bill');
  });
  wireTabs('mx-mode', 'mx-body', function (v) { S.mxMode = v; S.mxOpen = ''; renderMetrics(); window.scrollTo(0, 0); });

  wireTabs('tabs-props', 'props-panes', function (v) { S.propTab = v; resetPage('props:' + v); renderProps(); window.scrollTo(0, 0); });
  // 2.0: ο κύκλος με τα αρχικά ανοίγει τα «Περισσότερα»· οι Ρυθμίσεις είναι μέσα εκεί.
  $$('[data-settings]').forEach(function (b) { b.onclick = function () { goto(isAdminMode() ? 'a-more' : 'more'); }; });
  $$('[data-open-settings]').forEach(function (b) { b.onclick = openSettings; });
  $$('[data-back]').forEach(function (b) { b.onclick = function () { goto(S.lastMain || 'today'); }; });
  $$('#theme-pick [data-theme-set]').forEach(function (b) {
    b.onclick = function () { store('kw_theme', b.dataset.themeSet); applyTheme(b.dataset.themeSet); };
  });
  $$('#calls-mode [data-cmode]').forEach(function (b) {
    b.onclick = function () { setCallsMode(b.dataset.cmode); };
  });
  wireTabs('tabs-alerts', 'alert-list', function (v) { S.alertTab = v; renderAlerts(); window.scrollTo(0, 0); });
  $('alerts-read').onclick = function () { markAlertsRead(currentAlerts()); renderAlerts(); };
  wireLeadPick();
  wireProfile();                                     // 2.1
  wireOffline();                                     // 2.2
  document.addEventListener('visibilitychange', function () { if (document.hidden) pfSaveNow(true); });
  $$('[data-goto]').forEach(function (b) { b.onclick = function () { goto(b.dataset.goto); }; });
  $$('[data-refresh]').forEach(function (b) { b.onclick = refreshNow; });
  $('map-deal').onchange = function () { MAP.deal = this.value; drawMap(true); };
  $('map-status').onchange = function () { MAP.status = this.value; drawMap(true); };
  $('map-mine').onclick = function () {
    MAP.mine = !MAP.mine;
    this.classList.toggle('is-on', MAP.mine);
    this.setAttribute('aria-pressed', MAP.mine ? 'true' : 'false');
    drawMap(true);
  };
  $$('#size-pick button').forEach(function (b) {
    b.onclick = function () { store('kw_size', b.dataset.size); applySize(b.dataset.size); };
  });

  $('mx-refresh').onclick = function () { loadMetrics(true); };
  $('mx-prev').onclick = function () { stepMetrics(1); };     // η λίστα είναι από τον νεότερο μήνα
  $('mx-next').onclick = function () { stepMetrics(-1); };
  $('filter-clear').onclick = function () { S.propFilter = null; renderCalls(); };

  $('detail-back').onclick = closeDetail;
  $('showing-back').onclick = function () { closeSheet('showing'); };
  $('settings-back').onclick = function () { if (S.setSub) settingsMenu(); else closeSheet('settings'); };
  $$('#settings-menu [data-sub]').forEach(function (b) { b.onclick = function () { settingsSub(b.dataset.sub); }; });
  $('propdetail-back').onclick = function () { closeSheet('propdetail'); S.prop = null; };
  $('task-back').onclick = function () { closeSheet('task'); };
  $('templates-back').onclick = function () { closeSheet('templates'); };
  $('referral-back').onclick = function () { closeSheet('referral'); };
  $('btn-referral-more').onclick = function () { openReferral(null); };
  $('btn-new-referral').onclick = function () { openReferral(null); };
  wirePops();
  $('fab').onclick = function () { openPop('quick'); };
  $$('[data-quick]').forEach(function (b) {
    b.onclick = function () {
      closePop('quick');
      var q = b.dataset.quick;
      if (q === 'note') openLeadPick('note');
      else if (q === 'outcome') openLeadPick('outcome');
      else if (q === 'task') openTask(null);
      else if (q === 'contact') editContact(null);
      else if (q === 'referral') openReferral(null);
    };
  });
  $('quick-book').onclick = function () { closePop('quick'); };
  $('today-search-btn').onclick = toggleTodaySearch;
  $('d-sms-btn').onclick = function () { openSmsBox(); };
  $('d-map').onclick = function (e) { if (!this.getAttribute('href')) e.preventDefault(); };
  wirePullToRefresh();
  wireAdmin();
  wireMedia();
  wirePresent();
  $('btn-lead-referral').onclick = function () { openReferral(S.lead); };
  wireReferral();

  $('btn-new-task').onclick = function () { openTask(null); };
  $('btn-lead-task').onclick = onLeadTask;
  $('btn-save-task').onclick = onSaveTask;
  $('btn-delete-task').onclick = onDeleteTask;
  $$('#t-quick .chip').forEach(function (c) {
    c.onclick = function () {
      $('t-date').value = c.dataset.when === '' ? '' : isoDate(new Date(Date.now() + Number(c.dataset.when) * 86400000));
      if (!$('t-date').value) $('t-time').value = '';
      taskNote();
    };
  });
  $('t-date').onchange = taskNote;
  $('t-time').onchange = taskNote;

  $('doc-input').onchange = onDocFile;
  $('btn-templates').onclick = openTemplates;
  $('btn-logout').onclick = onLogout;
  $('btn-save-templates').onclick = onSaveTemplates;

  $('d-tel').onclick = onTelClick;
  $('d-mail').onclick = function (e) { if (!S.lead || !S.lead.email) e.preventDefault(); };
  $('btn-noanswer-row').onclick = onNoAnswer;
  $('btn-showing').onclick = openShowingForm;
  $('btn-showform').onclick = function () {
    openShowingForm();
    // Το έντυπο είναι πάνω-πάνω στο φύλλο της υπόδειξης.
    $('showing').querySelector('.sheet-body').scrollTop = 0;
  };
  $('btn-save-showing').onclick = onSaveShowing;
  $('btn-offer').onclick = function () { if (S.lead) openOffer(S.lead); };   // 1.20
  wireCallNote();
  $('btn-save-outcome').onclick = onSaveOutcome;
  wireTabs('tabs-contact', 'contact-panes', function (v) {
    showPane('contact-panes', v);
    if (v === 'mail') loadContactMail();
  });
  wireSearch('contact-search', function () { resetPage('contacts'); renderContacts(); });
  wireSearch('prop-search', function () { resetPage('props'); renderProps(); });
  wireFilters('prop', clearPropFilters);
  wireFilters('contact', function () { S.cRole = ''; resetPage('contacts'); renderContacts(); });
  [['f-p-status', 'status'], ['f-p-mandate', 'mandate'], ['f-p-active', 'active']].forEach(function (f) {
    $(f[0]).onchange = function () { S.pf[f[1]] = this.value; resetPage('props'); renderProps(); };
  });
  $('f-c-role').onchange = function () { S.cRole = this.value; resetPage('contacts'); renderContacts(); };
  wireSearch('global-search', renderGlobal);
  $('global-search').onfocus = function () { if (!S.contacts) loadContacts().then(function () { renderGlobal($('global-search').value); }, function () {}); };
  $('btn-new-contact').onclick = function () { editContact(null); };
  $('btn-edit-contact').onclick = function () { editContact(S.contact); };
  $('btn-save-contact').onclick = onSaveContact;
  $('contact-back').onclick = function () { closeSheet('contact'); };
  $('contact-edit-back').onclick = function () { closeSheet('contact-edit'); };
  $('btn-save-settings').onclick = onSaveSettings;
  $('btn-cancel-showing').onclick = onCancelShowing;
  $('push-banner-btn').onclick = onEnablePush;
  $('btn-push-enable').onclick = onEnablePush;
  $('btn-push-test').onclick = onTestPush;
  $('d-notes').oninput = onNoteInput;
  $('d-status-select').onchange = function () {
    applyStatus($('d-status-select').value).catch(function () {});
  };

  $('sms-link').onclick = onOpenSms;
  $('sms-text').oninput = refreshSmsHref;
  $('btn-copy').onclick = onCopy;
  $('btn-lang').onclick = onLang;

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeTop();
  });
}

var VIEWS = ['today', 'calls', 'props', 'alerts', 'more', 'tasks', 'contacts', 'referrals', 'metrics', 'forms',
             'a-review', 'a-calls', 'a-props', 'a-more'];
// Ποιο κουμπί του μενού φωτίζεται. Τα «Περισσότερα» φαίνονται ως κουμπί μόνο στον υπολογιστή.
var NAV_OF = { metrics: 'more', forms: 'more', contacts: 'more', referrals: 'more', tasks: 'more' };
// Οι 4 καρτέλες: σε αυτές γυρίζει το «Πίσω» των υπόλοιπων οθονών.
var MAIN_VIEWS = { today: 1, calls: 1, props: 1, alerts: 1 };

function goto(view) {
  var dir = VIEWS.indexOf(view) - VIEWS.indexOf(S.view);
  $$('.tab').forEach(function (x) {
    var on = x.dataset.view === (NAV_OF[view] || view);
    x.classList.toggle('is-on', on);
    if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
  });
  VIEWS.forEach(function (v) {
    $('view-' + v).hidden = (v !== view);
  });
  S.view = view;
  if (MAIN_VIEWS[view]) S.lastMain = view;
  slide($('view-' + view), dir);
  window.scrollTo(0, 0);
  if (view === 'props') renderProps();
  if (view === 'tasks') renderTasks();
  if (view === 'today') renderToday();
  if (view === 'contacts') loadContacts();
  if (view === 'metrics') loadMetrics(false);
  if (view === 'more') renderMore();
  if (view === 'alerts') renderAlerts();
  if (view === 'calls') renderCalls();
  if (view === 'referrals') loadReferrals();
  if (view === 'a-review') renderReviews();
  if (view === 'a-calls') renderACalls();
  if (view === 'a-props') renderAProps();
  if (view === 'a-more') renderAMore();
  $('fab').hidden = view === 'metrics' || isAdminMode();
}

// ─────────────────────────────────────────────────────────────
//  ΛΙΣΤΑ ΚΛΗΣΕΩΝ
// ─────────────────────────────────────────────────────────────

/** Θέλουν ακόμη ενέργεια: νέες και όσες δεν σήκωσαν. Αυτές μετράει το badge. */
function isOpen(l) { return l.status === ST.PENDING || l.status === ST.NO_ANSWER; }

/** Οι κλήσεις πριν το tab (με το φίλτρο ακινήτου, αν υπάρχει). */
function baseList() {
  if (!S.propFilter) return S.leads;
  return S.leads.filter(function (l) { return normCode(l.code) === S.propFilter.key; });
}

function tabList(list, tab) {
  if (tab === 'new') return list.filter(function (l) { return l.status === ST.PENDING; });
  if (tab === 'followup') return list.filter(function (l) { return l.status === ST.NO_ANSWER; });
  if (tab === 'showing') {
    return list.filter(function (l) { return l.status === ST.SHOWING; }).sort(function (a, b) {
      var now = Date.now(), af = (a.showingTs || 0) > now, bf = (b.showingTs || 0) > now;
      if (af !== bf) return af ? -1 : 1;                       // οι επόμενες πρώτα
      return af ? a.showingTs - b.showingTs : (b.showingTs || 0) - (a.showingTs || 0);
    });
  }
  return list;
}

function render() {
  offSnapshotSoon();                               // 2.2: κρατά τα τελευταία στο κινητό
  setBadge(S.leads.filter(isOpen).length);
  renderCalls();
  renderTasks();
  if (S.view === 'props') renderProps();
  renderAlerts();
}

/** «01/11/2026 09:45» → «Σήμερα 09:45». Ό,τι δεν αναγνωρίζει μένει όπως είναι. */
function niceDate(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}:\d{2})/.exec(String(s || ''));
  if (!m) return s || '';
  var iso = m[3] + '-' + m[2] + '-' + m[1];
  if (iso === isoDate(new Date())) return 'Σήμερα ' + m[4];
  if (iso === isoDate(new Date(Date.now() - 86400000))) return 'Χθες ' + m[4];
  if (iso === isoDate(new Date(Date.now() + 86400000))) return 'Αύριο ' + m[4];
  if (+m[3] !== new Date().getFullYear()) return m[1] + '/' + m[2] + '/' + m[3];
  return WEEKDAYS[new Date(+m[3], +m[2] - 1, +m[1]).getDay()] + ' ' + m[1] + '/' + m[2] + ', ' + m[4];
}

function renderCalls() {
  var base = baseList();
  ['new', 'followup', 'showing', 'all'].forEach(function (t) { $('c-' + t).textContent = tabList(base, t).length; });
  setTab('tabs-calls', S.filter);

  // 2.0: Κλήσεις ή Pipeline στην ίδια καρτέλα.
  var pipe = S.cmode === 'pipe';
  $('tabs-calls').hidden = pipe;
  $('call-list').hidden = pipe;
  $('pipe').hidden = !pipe;
  $('view-calls').classList.toggle('is-pipe', pipe);
  if (pipe) {
    $('filter-bar').hidden = !S.propFilter;
    if (S.propFilter) $('filter-label').textContent = S.propFilter.label;
    renderPipe();
    return;
  }

  var leads = tabList(base, S.filter);
  var el = $('call-list');

  $('filter-bar').hidden = !S.propFilter;
  if (S.propFilter) $('filter-label').textContent = S.propFilter.label;

  if (!leads.length) {
    var follow = tabList(base, 'followup').length;
    var msg = {
      'new': ['Καμία νέα κλήση', 'Όλες οι νέες κλήσεις σου έχουν απαντηθεί.'],
      followup: ['Κανένα follow-up', 'Εδώ μπαίνουν όσοι πελάτες δεν απάντησαν.'],
      showing: ['Καμία υπόδειξη', 'Κλείσε υπόδειξη μέσα από μια κλήση.'],
      all: ['Καμία κλήση', 'Δεν έχουν έρθει κλήσεις τους τελευταίους 2 μήνες.']
    }[S.filter];
    el.innerHTML = '<div class="empty"><b>' + msg[0] + '</b>' + msg[1] +
      (S.filter === 'new' && follow ? '<button class="btn primary wide" id="go-follow">Δες ' + follow + ' για follow-up</button>' : '') +
      '</div>';
    if ($('go-follow')) $('go-follow').onclick = function () { S.filter = 'followup'; renderCalls(); slide(el, 1); };
    return;
  }

  var key = 'calls:' + S.filter;
  el.innerHTML = listMeta(leads.length, key, 'κλήση', 'κλήσεις') + groupLeads(pageOf(leads, key), S.filter === 'showing') +
    pagerHtml(leads.length, key);
  wireLeadRows(el);
  wirePager(el, key, renderCalls);
}

// ─────────────────────────────────────────────────────────────
//  ΣΕΛΙΔΕΣ (1.13)
//  50 ανά σελίδα, αριθμοί σε κύκλους: 1 … 4 5 6 … 20. Η σελίδα κρατιέται
//  ανά λίστα (S.page[key]) και γυρίζει στην 1 με κάθε αναζήτηση ή φίλτρο.
// ─────────────────────────────────────────────────────────────

var PAGE_SIZE = 50;
S.page = {};

function pageCount(total) { return Math.max(1, Math.ceil(total / PAGE_SIZE)); }

/** Η τρέχουσα σελίδα, πάντα μέσα στα όρια (μια λίστα μπορεί να μίκρυνε). */
function curPage(key, total) {
  var p = Math.min(Math.max(1, S.page[key] || 1), pageCount(total));
  S.page[key] = p;
  return p;
}

function pageOf(list, key) {
  var p = curPage(key, list.length);
  return list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
}

function resetPage(key) {
  Object.keys(S.page).forEach(function (k) { if (k === key || k.indexOf(key + ':') === 0) delete S.page[k]; });
}

/** «51–100 από 128». Μόνο όταν υπάρχουν πάνω από μία σελίδα. */
function listMeta(total, key, one, many) {
  if (total <= PAGE_SIZE) return '';
  var p = curPage(key, total);
  var from = (p - 1) * PAGE_SIZE + 1, to = Math.min(p * PAGE_SIZE, total);
  return '<p class="list-meta">' + from + '–' + to + ' από ' + total.toLocaleString('el-GR') + ' ' + (total === 1 ? one : many) + '</p>';
}

/** Ποιοι αριθμοί φαίνονται: πρώτη, τελευταία, η τρέχουσα και οι δίπλα της. 0 = «…». */
function pageNumbers(p, n) {
  if (n <= 5) return Array.apply(null, Array(n)).map(function (_, i) { return i + 1; });
  var want = [1, p - 1, p, p + 1, n].filter(function (x, i, a) { return x >= 1 && x <= n && a.indexOf(x) === i; })
    .sort(function (a, b) { return a - b; });
  var out = [];
  want.forEach(function (x, i) {
    if (i && x - want[i - 1] > 1) out.push(0);
    out.push(x);
  });
  return out;
}

function pagerHtml(total, key) {
  var n = pageCount(total);
  if (n < 2) return '';
  var p = curPage(key, total);
  return '<nav class="pager" aria-label="Σελίδες">' + pageNumbers(p, n).map(function (x) {
    return x ? '<button class="page' + (x === p ? ' is-on' : '') + '" data-page="' + x + '"' +
      (x === p ? ' aria-current="page"' : '') + ' aria-label="Σελίδα ' + x + '">' + x + '</button>'
      : '<span class="page-gap" aria-hidden="true">…</span>';
  }).join('') + '</nav>';
}

/** Πάτημα σε αριθμό: νέα σελίδα, πάνω-πάνω, με κίνηση προς τη σωστή πλευρά. */
function wirePager(el, key, rerender) {
  el.querySelectorAll('[data-page]').forEach(function (b) {
    b.onclick = function () {
      var to = Number(b.dataset.page), from = S.page[key] || 1;
      if (to === from) return;
      S.page[key] = to;
      rerender();
      window.scrollTo(0, 0);
      slide(el, to - from);
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  ΦΙΛΤΡΑ (1.13)
//  Κουμπί «Φίλτρα» δίπλα στην αναζήτηση, που ανοίγει λίστες επιλογών.
//  Ο αριθμός πάνω στο κουμπί = πόσα φίλτρα δεν είναι στην προεπιλογή.
// ─────────────────────────────────────────────────────────────

function fillOptions(el, opts, cur) {
  el.innerHTML = opts.map(function (o) {
    return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
  }).join('');
  if (opts.every(function (o) { return o[0] !== cur; })) el.value = opts.length ? opts[0][0] : '';
  return el.value;
}

/** Σύνδεση κουμπιού και πάνελ φίλτρων. */
function wireFilters(name, onClear) {
  var btn = $(name + '-ftoggle'), panel = $(name + '-fpanel');
  btn.onclick = function () {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    btn.classList.toggle('is-on', !panel.hidden);
  };
  $(name + '-fclear').onclick = onClear;
}

function filterBadge(name, n) {
  var b = $(name + '-fcount');
  b.hidden = !n;
  b.textContent = n;
  $(name + '-fclear').hidden = !n;
}

/**
 * 1.16 · Γραμμή κλήσης: αρχικά με το χρώμα της κατάστασης, όνομα, ακίνητο και
 * μία γραμμή «τι ισχύει τώρα» («Δεν απάντησε · ξανά σήμερα 11:00»). Δεξιά η ώρα.
 */
function leadRow(l, when) {
  var k = STATUS_CLASS[l.status] || 'answered';
  var line = statusLine(l);
  return '<button class="row lead is-' + k + '" data-id="' + esc(l.id) + '">' +
    '<span class="avatar ' + k + '" aria-hidden="true">' + esc(initials(l.name)) + '</span>' +
    '<span class="row-body"><span class="row-top"><span class="row-name">' + esc(l.name || 'Χωρίς όνομα') + '</span>' +
      (when ? '<span class="row-when">' + esc(when) + '</span>' : '') + '</span>' +
    '<span class="row-prop">' + esc(l.property) + (l.code ? ', ' + esc(l.code) : '') + '</span>' +
    '<span class="row-status ' + k + '">' + esc(line) +
      (l.sms ? ' <i class="tag sms">SMS</i>' : '') +
      (l.repeat && /επαν/i.test(l.repeat) ? ' <i class="tag">Επανάληψη</i>' : '') + '</span>' +
    '</span></button>';
}

/** «Σήμερα 11:00» → «σήμερα 11:00», για να μπει μέσα σε πρόταση. */
function lowerDay(t) { return String(t || '').replace(/^(Σήμερα|Χθες|Αύριο)/, function (m) { return m.toLowerCase(); }); }

/** Τι ισχύει τώρα για την κλήση, σε μία σύντομη φράση. */
function statusLine(l) {
  if (l.status === ST.PENDING) return 'Νέα κλήση' + (l.source ? ' · ' + l.source : '');
  if (l.status === ST.NO_ANSWER) return 'Δεν απάντησε' + (l.followUp ? ' · ξανά ' + lowerDay(niceDate(l.followUp)) : '');
  if (l.status === ST.SHOWING) {
    if (upcoming(l)) return 'Υπόδειξη ' + lowerDay(niceDate(l.showingAt));
    if (needsOutcome(l)) return 'Η υπόδειξη έγινε · πώς πήγε;';
    return l.outcome ? 'Υπόδειξη · ' + l.outcome : 'Υπόδειξη';
  }
  if (l.status === ST.CLOSED) return 'Κλειστή' + (l.outcome ? ' · ' + l.outcome : '');
  return (l.status || 'Απαντημένη') + (l.called ? ' · μίλησες ' + lowerDay(niceDate(l.called)) : '');
}

/** «01/11/2026 09:45» → Date. Ό,τι δεν αναγνωρίζει → null. */
function parseStamp(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(s || ''));
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : null;
}

function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

/**
 * Κλήσεις σε ομάδες ανά ημέρα: Σήμερα, Χθες, Νωρίτερα. Στις υποδείξεις:
 * Επόμενες και Έγιναν. Μέσα στη Σήμερα/Χθες φαίνεται μόνο η ώρα.
 */
function groupLeads(list, showings, rowFn) {
  rowFn = rowFn || leadRow;
  var today = isoDate(new Date()), yest = isoDate(new Date(Date.now() - 86400000));
  var groups = [], cur = null;
  list.forEach(function (l) {
    var g, when;
    if (showings) {
      g = upcoming(l) ? 'Επόμενες' : 'Έγιναν';
      when = l.showingAt ? niceDate(l.showingAt) : '';
    } else {
      var d = l.ts ? new Date(l.ts) : parseStamp(l.date);
      var iso = d ? isoDate(d) : '';
      g = iso === today ? 'Σήμερα' : iso === yest ? 'Χθες' : 'Νωρίτερα';
      when = !d ? '' : g === 'Νωρίτερα' ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) : hhmm(d);
    }
    cur = groups.filter(function (x) { return x.title === g; })[0];
    if (!cur) { cur = { title: g, html: '' }; groups.push(cur); }
    cur.html += rowFn(l, when);
  });
  return groups.map(function (x) { return '<div class="section">' + x.title + '</div>' + x.html; }).join('');
}

/** Σήμανση λήξης εντολής. Κενό αν δεν λήγει σύντομα. */
function mandateTag(p) {
  var d = p.mandateDays;
  if (d == null || d > ((S.boot && S.boot.mandateSoon) || 30)) return '';
  return '<span class="tag ' + (d <= 7 ? 'pending' : 'noanswer') + '">' + esc(mandateText(d)) + '</span>';
}

function mandateText(d) {
  if (d < 0) return 'Η εντολή έληξε';
  if (d === 0) return 'Η εντολή λήγει σήμερα';
  return 'Η εντολή λήγει σε ' + d + (d === 1 ? ' ημέρα' : ' ημέρες');
}

function wireLeadRows(el) {
  el.querySelectorAll('[data-id]:not(.pc)').forEach(function (r) {
    r.onclick = function () { openLead(r.dataset.id); };
  });
  if (typeof wireGestures === 'function') wireGestures(el);   // 2.3 · FEAT-2 σύρσιμο · FEAT-6 παρατεταμένο πάτημα
}

// ─────────────────────────────────────────────────────────────
//  ΕΠΑΦΕΣ (1.10)
// ─────────────────────────────────────────────────────────────

/** Πάνω στην κλήση: ο πελάτης είχε καλέσει και για άλλα ακίνητά μου. */
function renderKnown(l) {
  var el = $('d-known');
  var others = l.otherCodes || [];
  el.hidden = !l.contactId;
  if (!l.contactId) return;
  var names = others.map(function (c) {
    var p = S.props.filter(function (x) { return normCode(x.code) === normCode(c); })[0];
    return (p && p.street ? p.street + ', ' : '') + c;
  });
  el.innerHTML = (others.length ? '<b>Έχει καλέσει και για:</b> ' + esc(names.join(' · ')) : '') +
    '<button class="link" id="d-open-contact">Άνοιγμα επαφής</button>';
  $('d-open-contact').onclick = function () { openContact(l.contactId); };
}

function loadContacts() {
  if (!S.contacts) $('contact-list').innerHTML = skel(6);
  return apiRead('contacts').then(function (list) {
    S.contacts = list;
    renderContacts();
    return list;
  }).catch(function (e) {
    if (!S.contacts) $('contact-list').innerHTML = '<div class="empty"><b>Δεν φορτώθηκαν</b>' + esc(e.message) + '</div>';
    throw e;
  });
}

/** Οι ιδιότητες μιας επαφής. Το CRM μπορεί να γράφει πολλές μαζί: «Αγοραστής, Πωλητής». */
function rolesOf(c) {
  return String(c.role || '').split(/[,;\/]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

var NO_ROLE = '__none';

/** Φίλτρο Ιδιότητα: οι επιλογές βγαίνουν από τις ίδιες τις επαφές, με το πλήθος τους. */
function fillContactFilters() {
  var count = {}, none = 0;
  (S.contacts || []).forEach(function (c) {
    var r = rolesOf(c);
    if (!r.length) none++;
    r.forEach(function (x) { count[x] = (count[x] || 0) + 1; });
  });
  var opts = [['', 'Όλες']].concat(Object.keys(count).sort(function (a, b) { return a.localeCompare(b, 'el'); })
    .map(function (x) { return [x, x + ' (' + count[x].toLocaleString('el-GR') + ')']; }));
  if (none) opts.push([NO_ROLE, 'Χωρίς ιδιότητα (' + none.toLocaleString('el-GR') + ')']);
  S.cRole = fillOptions($('f-c-role'), opts, S.cRole || '');
  filterBadge('contact', S.cRole ? 1 : 0);
}

function contactPasses(c) {
  if (!S.cRole) return true;
  var r = rolesOf(c);
  return S.cRole === NO_ROLE ? !r.length : r.indexOf(S.cRole) !== -1;
}

/** Αναζήτηση σε όνομα, τηλέφωνο, email, κωδικό. Χωρίς τόνους, ελληνικά ή λατινικά. */

function renderContacts() {
  var list = S.contacts;
  if (!list) return;
  fillContactFilters();
  var words = searchWords($('contact-search').value), q = words.length;
  var shown = list.filter(function (c) { return contactPasses(c) && (!q || matches(words, contactFields(c))); });

  var el = $('contact-list');
  if (!shown.length) {
    var filtered = q || S.cRole;
    el.innerHTML = '<div class="empty"><b>' + (filtered ? 'Δεν βρέθηκε επαφή' : 'Καμία επαφή ακόμα') + '</b>' +
      (S.cRole ? 'Δοκίμασε άλλη ιδιότητα ή «Καθαρισμός φίλτρων».' : q ? 'Δοκίμασε όνομα, τηλέφωνο ή κωδικό.'
        : 'Επικόλλησε το Excel του CRM στο φύλλο «Επαφές».') + '</div>';
    return;
  }
  el.innerHTML = listMeta(shown.length, 'contacts', 'επαφή', 'επαφές') + pageOf(shown, 'contacts').map(function (c) {
    var sub = [(c.phones || [])[0], c.role].filter(Boolean).join(' · ');
    return '<button class="row" data-contact="' + esc(c.id) + '"><span class="row-body">' +
      '<span class="row-name">' + esc(c.name || (c.phones || [])[0] || (c.emails || [])[0]) + '</span>' +
      (sub ? '<span class="row-prop">' + esc(sub) + '</span>' : '') +
      (c.codes || !c.crm ? '<span class="row-meta">' +
        (c.codes ? '<span>Κάλεσε για ' + plural(c.codes.length, 'ακίνητο', 'ακίνητα') + '</span>' : '') +
        (!c.crm ? '<span class="tag noanswer">Από κλήση</span>' : '') + '</span>' : '') +
      '</span>' + ico('next', 'ico chev') + '</button>';
  }).join('') + pagerHtml(shown.length, 'contacts');

  el.querySelectorAll('[data-contact]').forEach(function (b) {
    b.onclick = function () { openContact(b.dataset.contact); };
  });
  wirePager(el, 'contacts', renderContacts);
}

function findContact(id) {
  return (S.contacts || []).filter(function (c) { return c.id === id; })[0] || null;
}

function openContact(id) {
  var c = findContact(id);
  if (c) return showContact(c);
  loadContacts().then(function () {
    var f = findContact(id);
    if (f) showContact(f); else toast('Δεν βρέθηκε η επαφή.', true);
  }).catch(function (e) { toast(e.message, true); });
}

function intlPhone(d) { return !d ? '' : d.length === 10 ? '+30' + d : '+' + d; }

/** Λίγες γραμμές, μόνο όσες έχουν τιμή. Τηλέφωνα, email και διεύθυνση πατιούνται. */
function showContact(c) {
  S.contact = c;
  S.contactMail = null;
  var phones = c.phones || [], emails = c.emails || [];
  $('ct-name').textContent = c.name || phones[0] || emails[0];
  $('ct-sub').innerHTML = [c.role, c.tags].filter(Boolean).map(esc).join(' · ') +
    (!c.crm ? ' <span class="tag noanswer">Από κλήση</span>' : '') +
    (c.inactive ? ' <span class="tag">Μη ενεργή στο CRM</span>' : '');

  var codes = c.codes || [];
  $('ct-codes-wrap').hidden = !codes.length;
  $('ct-codes').innerHTML = codes.map(function (x) {
    var known = S.props.some(function (p) { return p.code === x.code; });
    var text = (x.street ? x.street + ', ' : '') + 'κωδικός ' + x.code;
    return known ? '<button class="code-row" data-code="' + esc(x.code) + '"><span>' + esc(text) + '</span>' + ico('next', 'ico chev') + '</button>'
      : '<div class="code-row"><span>' + esc(text) + '</span>' + (x.status ? '<i class="tag">' + esc(x.status) + '</i>' : '') + '</div>';
  }).join('');
  $('ct-codes').querySelectorAll('[data-code]').forEach(function (b) {
    b.onclick = function () { openProp(b.dataset.code); };
  });

  var link = function (href, text, out) {
    return '<a href="' + esc(href) + '"' + (out ? ' target="_blank" rel="noopener"' : '') + '>' + esc(text) + '</a>';
  };
  var addr = [c.street, c.area].filter(Boolean).join(', ');
  var rows = [
    ['Τηλέφωνο', phones.map(function (p) { return link('tel:' + intlPhone(p), p); }).join('<br>')],
    ['Email', emails.map(function (e) { return link('mailto:' + e, e); }).join('<br>')],
    ['Διεύθυνση', addr && c.street ? link(placeUrl(c.street, c.area), addr, true) : esc(addr)],
    ['Επάγγελμα', esc(c.job || '')],
    ['Πηγή', esc(c.source || '')],
    ['Τελευταία κλήση', esc(c.last ? niceDate(c.last) : '')],
    ['Στο CRM από', esc(c.added || '')],
    ['Σημειώσεις', esc(c.notes || '')]
  ];
  $('ct-facts').innerHTML = rows.filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>';
  }).join('');
  label($('btn-edit-contact'), 'form', c.crm ? (c.notes ? 'Αλλαγή σημειώσεων' : 'Προσθήκη σημείωσης') : 'Επεξεργασία επαφής');

  var tel = intlPhone(phones[0]);
  $('ct-tel').href = tel ? 'tel:' + tel : '#';
  $('ct-tel').classList.toggle('muted', !tel);
  $('ct-sms').href = tel ? smsHref(tel, '') : '#';
  $('ct-sms').classList.toggle('muted', !tel);

  setTab('tabs-contact', 'info');
  showPane('contact-panes', 'info');
  $('contact').querySelector('.sheet-body').scrollTop = 0;
  openSheet('contact');
}

function loadContactMail() {
  var c = S.contact, el = $('ct-mail');
  if (!c) return;
  if (!(c.emails || []).length) {
    el.innerHTML = '<div class="empty small"><b>Χωρίς email</b>' + (c.crm ? 'Πρόσθεσε το email στο CRM.' : 'Πρόσθεσε το email στα Στοιχεία.') + '</div>';
    return;
  }
  if (S.contactMail && S.contactMail.id === c.id) return;
  el.innerHTML = '<div class="empty small">Φόρτωση email…</div>';
  api('contactMail', { id: c.id }).then(function (r) {
    if (!S.contact || S.contact.id !== c.id) return;
    S.contactMail = { id: c.id };
    renderContactMail(r);
  }).catch(function (e) {
    el.innerHTML = '<div class="empty small"><b>Δεν φορτώθηκαν</b>' + esc(e.message) + '</div>';
  });
}

/** Το κείμενο ενός email είναι ξένο: μπαίνει πάντα ως κείμενο, ποτέ ως HTML. */
function renderContactMail(r) {
  var el = $('ct-mail');
  if (!r.available) {
    el.innerHTML = '<div class="empty small"><b>Όχι ακόμα</b>Τα email φαίνονται προς το παρόν μόνο στον λογαριασμό της εφαρμογής.</div>';
    return;
  }
  if (!r.items.length) {
    el.innerHTML = '<div class="empty small"><b>Κανένα email</b>Δεν βρέθηκε αλληλογραφία με αυτή την επαφή.</div>';
    return;
  }
  el.innerHTML = r.items.map(function (m) {
    return '<article class="mail"><h4>' + esc(m.subject) + '</h4>' +
      '<div class="row-meta"><span class="tag ' + (m.inbound ? 'closed' : 'answered') + '">' + (m.inbound ? 'Από την επαφή' : 'Από εμένα') + '</span>' +
      '<span>' + esc(niceDate(m.date)) + '</span></div><p>' + esc(m.text) + '</p>' +
      '<button class="link" data-more-mail>Δες όλο το κείμενο</button>' +
      (/^https:\/\/mail\.google\.com\//.test(m.url) ? '<a class="link" href="' + esc(m.url) + '" target="_blank" rel="noopener">Άνοιγμα στο Gmail</a>' : '') +
      '</article>';
  }).join('');
  el.querySelectorAll('[data-more-mail]').forEach(function (b) {
    var card = b.parentNode, p = card.querySelector('p');
    if (p.scrollHeight <= p.clientHeight + 2) { b.hidden = true; return; }
    b.onclick = function () { card.classList.add('open'); b.hidden = true; };
  });
}

/** Επαφή του CRM: μόνο σημειώσεις. Επαφή από κλήση ή νέα: όλα. */
function editContact(c) {
  var crm = !!(c && c.crm);
  S.contactEdit = c ? c.id : '';
  $('ce-head').textContent = crm ? 'Σημειώσεις' : c ? 'Αλλαγή επαφής' : 'Νέα επαφή';
  $('ce-fields').hidden = crm;
  $('ce-crm-note').hidden = !crm;
  $('ce-name').value = c ? c.name || '' : '';
  $('ce-phone').value = c ? (c.phones || [])[0] || '' : '';
  $('ce-email').value = c ? (c.emails || [])[0] || '' : '';
  $('ce-notes').value = c ? c.notes || '' : '';
  $('ce-hint').textContent = '';
  $('ce-hint').className = 'save-hint';
  openSheet('contact-edit');
}

function onSaveContact() {
  var btn = $('btn-save-contact'), hint = $('ce-hint');
  btn.disabled = true;
  api('contactSave', {
    id: S.contactEdit, name: $('ce-name').value, phone: $('ce-phone').value,
    email: $('ce-email').value, notes: $('ce-notes').value
  }).then(function (c) {
    var list = S.contacts || (S.contacts = []);
    var i = list.map(function (x) { return x.id; }).indexOf(c.id);
    if (i === -1) list.push(c); else list[i] = c;
    list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'el'); });
    renderContacts();
    closeSheet('contact-edit');
    showContact(c);
    toast('Αποθηκεύτηκε');
  }).catch(function (e) {
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  }).then(function () { btn.disabled = false; });
}

// ─────────────────────────────────────────────────────────────
//  ΣΗΜΕΡΑ
//  Τα ίδια δεδομένα με τις άλλες καρτέλες, με τη σειρά που θα δουλευτούν:
//  ό,τι έχει ώρα πρώτα, μετά οι κλήσεις, οι εργασίες και τα έγγραφα.
// ─────────────────────────────────────────────────────────────

var TODAY_MAX = 3;

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/**
 * 1.16 · Σήμερα ως πίνακας ημέρας:
 *  1. Τέσσερις κάρτες με αριθμούς (πατιούνται και ανοίγουν τη λίστα τους).
 *  2. «Το πρόγραμμά σου»: υποδείξεις και εργασίες της ημέρας με τη σειρά της ώρας.
 *  3. «Θέλουν προσοχή»: ό,τι ξεχνιέται εύκολα (αποτέλεσμα, έντυπο, εντολή, έγγραφα).
 *  4. Οι νέες κλήσεις, οι πρώτες τρεις.
 */
function renderToday() {
  if (!S.boot) return;
  var now = Date.now();
  var today = isoDate(new Date());
  var showToday = S.leads.filter(function (l) { return hasShowing(l) && l.showingDate === today && l.status === ST.SHOWING; })
    .sort(function (a, b) { return a.showingTs - b.showingTs; });
  var showings = showToday.filter(function (l) { return l.showingTs > now; });
  var fresh = S.leads.filter(function (l) { return l.status === ST.PENDING; });
  var follow = S.leads.filter(function (l) { return l.status === ST.NO_ANSWER; });
  var open = S.tasks.filter(function (t) { return !t.done && t.date && t.date <= today; }).sort(taskOrder);
  var lack = S.props.filter(function (p) { return p.mine && p.available !== false && missingDocs(p).length; });
  var past = S.leads.filter(function (l) { return needsOutcome(l) && now - l.showingTs < 7 * 86400000; });
  var ending = S.props.filter(function (p) { return p.mine && p.available !== false && mandateTag(p); })
    .sort(function (a, b) { return a.mandateDays - b.mandateDays; });
  // Υποδείξεις των επόμενων 3 ημερών χωρίς υπογεγραμμένο έντυπο.
  var forms = S.leads.filter(function (l) {
    return upcoming(l) && l.showingTs - now < 3 * 86400000 && !SF_DONE[l.form];
  });

  var h = new Date().getHours();
  var first = String((S.me && (S.me.smsName || S.me.name)) || '').trim().split(/\s+/)[0];
  $('today-date').textContent = new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('today-hello').textContent = (h < 12 ? 'Καλημέρα' : h < 20 ? 'Καλησπέρα' : 'Καλό βράδυ') + (first ? ', ' + first : '');

  var parts = [];
  if (showings.length) parts.push(plural(showings.length, 'υπόδειξη', 'υποδείξεις'));
  if (fresh.length) parts.push(plural(fresh.length, 'νέα κλήση', 'νέες κλήσεις'));
  if (follow.length) parts.push(plural(follow.length, 'κλήση για follow-up', 'κλήσεις για follow-up'));
  if (open.length) parts.push(plural(open.length, 'εργασία', 'εργασίες'));
  var fixes = (S.boot.reviews || []).length;
  if (fixes) parts.push(plural(fixes, 'έντυπο για διόρθωση', 'έντυπα για διόρθωση'));
  var last = parts.pop();
  $('today-sum').textContent = last ? 'Έχεις ' + (parts.length ? parts.join(', ') + ' και ' : '') + last + '.'
                                    : 'Δεν έχεις κάτι εκκρεμές για σήμερα.';

  // 2.0 · 1. Η επόμενη υπόδειξη, μεγάλη, με Κλήση / Οδηγίες / SMS.
  var nextShow = S.leads.filter(function (l) { return upcoming(l) && l.status === ST.SHOWING && l.showingTs - now < 36 * 3600000; })
    .sort(function (a, b) { return a.showingTs - b.showingTs; })[0];
  var main = nextShow ? heroHtml(nextShow) : '';

  // 2. Κάρτες με αριθμούς
  var stat = function (go, n, text, cls) {
    return '<button class="stat-card' + (cls && n ? ' ' + cls : '') + '" data-more="' + go + '"><b>' + n + '</b><span>' + text + '</span></button>';
  };
  var html = '<div class="stat-grid">' +
    stat('new', fresh.length, fresh.length === 1 ? 'Νέα κλήση' : 'Νέες κλήσεις', 'hot') +
    stat('showing', showings.length, 'Υποδείξεις σήμερα') +
    stat('followup', follow.length, 'Follow-up') +
    stat('tasks', open.length, open.length === 1 ? 'Εργασία' : 'Εργασίες') + '</div>';

  // 3. Πρόγραμμα: υποδείξεις + εργασίες της ημέρας, κατά ώρα, ως κάρτες με swipe.
  var plan = showToday.map(function (l) {
    var done = l.showingTs <= now;
    var oc = l.outcome;
    return { t: l.showingTime || '', html: planCard({
      time: l.showingTime, done: done && !!oc, kind: 'Υπόδειξη',
      tone: oc ? 'answered' : done ? 'noanswer' : 'showing',
      badge: oc ? '<span class="tag answered">' + esc(oc) + '</span>' : done ? '<span class="tag noanswer">Πώς πήγε;</span>' : '',
      title: l.name || 'Χωρίς όνομα', sub: [l.address || l.property, l.code ? 'Κωδ. ' + l.code : ''].filter(Boolean).join(' · '),
      attrs: 'data-id="' + esc(l.id) + '"', nav: l.address && !done ? placeUrlNav(l.address) : '',
      okText: 'Έγινε · πώς πήγε', noteText: 'Σημείωση' }) };
  }).concat(S.tasks.filter(function (t) { return t.date === today; }).map(function (t) {
    return { t: t.time || '99', html: planCard({
      time: t.time, done: !!t.done, kind: 'Εργασία', tone: t.done ? 'answered' : 'closed',
      badge: t.done ? '<span class="tag answered">✓ Έγινε</span>' : '',
      title: t.title, sub: t.leadName || '', attrs: 'data-task="' + esc(t.id) + '"', nav: '',
      okText: 'Έγινε', noteText: 'Αλλαγή' }) };
  })).sort(function (a, b) { return a.t.localeCompare(b.t); });
  main += '<div class="group-head"><h2 class="group-title">Το πρόγραμμά σου</h2>' +
    (plan.length ? '<span class="swipe-tip">' + ico('next') + 'σύρε δεξιά: έγινε · αριστερά: σημείωση</span>' : '') + '</div>' +
    (plan.length ? '<ol class="plan2">' + plan.map(function (x) { return x.html; }).join('') + '</ol>'
      : '<p class="card-note">Τίποτα προγραμματισμένο για σήμερα. Οι υποδείξεις και οι εργασίες με ώρα μπαίνουν εδώ.</p>');

  // 4. Θέλουν προσοχή. 1.17: πρώτα ό,τι έστειλε πίσω ο Admin.
  var side = '';
  var att = [];
  (S.boot.reviews || []).slice(0, TODAY_MAX + 2).forEach(function (r) {
    att.push(attItem('data-fix="' + esc(r.id) + '"', 'alert', 'Θέλει διόρθωση · ' + r.title,
      '«' + r.note + '»' + (r.street || r.code ? ' · ' + (r.street || r.code) : ''), 'bad'));
  });
  past.slice(0, TODAY_MAX).forEach(function (l) {
    att.push(attItem('data-outcome="' + esc(l.id) + '"', 'calendar', 'Πώς πήγε η υπόδειξη;', (l.name || 'Χωρίς όνομα') + ' · ' + l.showingAt, 'warn'));
  });
  forms.slice(0, TODAY_MAX).forEach(function (l) {
    var st = l.form === 'Στάλθηκε' ? 'Στάλθηκε, δεν έχει υπογραφεί ακόμα' : l.form === 'Έληξε' ? 'Το link έληξε' : 'Δεν έχει σταλεί ακόμα';
    att.push(attItem('data-form="' + esc(l.id) + '"', 'form', 'Έντυπο υπόδειξης · ' + (l.name || 'Χωρίς όνομα'), st + ' · ' + lowerDay(niceDate(l.showingAt)), ''));
  });
  ending.slice(0, TODAY_MAX).forEach(function (p) {
    att.push(attItem('data-prop="' + esc(p.code) + '"', 'home', mandateText(p.mandateDays), p.street || p.code, p.mandateDays <= 7 ? 'bad' : 'warn'));
  });
  if (lack.length) {
    att.push(attItem('data-more="docs"', 'upload', plural(lack.length, 'ακίνητο θέλει έγγραφα', 'ακίνητα θέλουν έγγραφα'),
      'ΠΕΑ, ταυτότητα και ό,τι άλλο λείπει', 'warn'));
  }
  if (att.length) side += '<h2 class="group-title">Θέλουν προσοχή</h2><div class="mlist">' + att.join('') + '</div>';

  // 5. Νέες κλήσεις
  if (fresh.length) {
    side += '<h2 class="group-title">Νέες κλήσεις</h2><div class="card-list">' +
      fresh.slice(0, TODAY_MAX).map(function (l) { return leadRow(l, niceDate(l.date)); }).join('') + '</div>' +
      (fresh.length > TODAY_MAX ? '<button class="link more-link" data-more="new">Δες και τις ' + fresh.length + '</button>' : '');
  }
  if (!plan.length && !att.length && !fresh.length && !follow.length) {
    side += '<div class="empty small"><b>Όλα εντάξει</b>Μόλις έρθει νέα κλήση, θα τη δεις εδώ.</div>';
  }
  // Κινητό: όλα σε μία στήλη. Υπολογιστής: πρόγραμμα αριστερά, εκκρεμότητες δεξιά.
  html += '<div class="today-cols"><div class="t-col">' + main + '</div><div class="t-col">' + side + '</div></div>';

  var el = $('today-body');
  el.innerHTML = html;
  wireLeadRows(el);
  wirePlan(el);
  el.querySelectorAll('[data-hn-call]').forEach(function (b) { b.onclick = function () { callLead(b.dataset.hnCall); }; });
  el.querySelectorAll('[data-hn-sms]').forEach(function (b) { b.onclick = function () { openLead(b.dataset.hnSms, { remind: true }); }; });
  el.querySelectorAll('[data-outcome]').forEach(function (b) {
    b.onclick = function () { openLead(b.dataset.outcome, { outcome: true }); };
  });
  el.querySelectorAll('[data-form]').forEach(function (b) {
    b.onclick = function () { openLead(b.dataset.form, { form: true }); };
  });
  el.querySelectorAll('[data-prop]').forEach(function (b) {
    b.onclick = function () { openProp(b.dataset.prop); };
  });
  el.querySelectorAll('[data-fix]').forEach(function (b) {
    b.onclick = function () { openFix(b.dataset.fix); };
  });
  el.querySelectorAll('[data-more]').forEach(function (b) {
    b.onclick = function () {
      var go = b.dataset.more;
      if (go === 'tasks') { S.taskTab = 'today'; setTab('tabs-tasks', 'today'); goto('tasks'); }
      else if (go === 'docs') { S.propTab = 'docs'; goto('props'); }
      else { S.filter = go; S.propFilter = null; resetPage('calls'); renderCalls(); goto('calls'); }
    };
  });
}

/** Οδηγίες προς μια διεύθυνση (από τη θέση του μεσίτη). */
function placeUrlNav(addr) {
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(mapsText(addr, ''));
}

/** Γραμμή του προγράμματος: ώρα, τίτλος, υπότιτλος, προαιρετικά κουμπί οδηγιών. */
function planItem(time, done, title, sub, attrs, nav) {
  return '<li class="plan-item' + (done ? ' done' : '') + '">' +
    '<span class="plan-time">' + esc(time || '—') + '</span>' +
    '<button class="plan-main" ' + attrs + '><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>' +
    (nav ? '<a class="plan-nav" href="' + esc(nav) + '" target="_blank" rel="noopener" aria-label="Οδηγίες στο Google Maps">' + ico('nav') + '</a>' : '') +
    '</li>';
}

/** Γραμμή «Θέλουν προσοχή». tone: '' · 'warn' (πορτοκαλί) · 'bad' (κόκκινο). */
function attItem(attrs, icon, title, sub, tone) {
  return '<button class="mrow" ' + attrs + '><span class="mrow-ico ' + (tone || '') + '">' + ico(icon) + '</span>' +
    '<span class="mrow-body"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' +
    ico('next', 'ico chev') + '</button>';
}

/** Ο φακός του Σήμερα ανοίγει και κλείνει την αναζήτηση. */
function toggleTodaySearch() {
  var box = $('today-search-box'), btn = $('today-search-btn');
  var show = box.hidden;
  box.hidden = !show;
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
  btn.classList.toggle('is-on', show);
  if (show) $('global-search').focus();
  else { setSearch('global-search', ''); renderGlobal(''); }
}

// ─────────────────────────────────────────────────────────────
//  ΑΚΙΝΗΤΑ
// ─────────────────────────────────────────────────────────────

/** Ίδια λογική με το normCode_() του Code.gs. */
// ── Αναζήτηση ────────────────────────────────────────────
// Κεφαλαία ή πεζά, με ή χωρίς τόνους, λέξεις με οποιαδήποτε σειρά:
// «βαρικα 13», «13 ΒΑΡΙΚΑ» και «Βαρίκα» βρίσκουν το ίδιο ακίνητο.

function fold(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^0-9A-ZΑ-Ω@.]+/g, ' ');
}

/** Οι λέξεις της αναζήτησης. Κενή λίστα = καμία αναζήτηση. */
function searchWords(q) { return fold(q).split(' ').filter(Boolean); }

/** Βρίσκεται κάθε λέξη κάπου στα πεδία; Τα τηλέφωνα συγκρίνονται και χωρίς κενά. */
function matches(words, fields) {
  var hay = ' ' + fold(fields.join(' ')) + ' ' + fields.join(' ').replace(/\D/g, '');
  return words.every(function (w) { return hay.indexOf(w) !== -1; });
}

function propFields(p) {
  return [p.street, p.title, p.code, p.type, p.area, p.partner, p.deal, p.status, p.price];
}

function contactFields(c) {
  return [c.name, c.role, c.tags, c.job, c.street, c.area].concat(c.phones || [], c.emails || [],
    (c.codes || []).map(function (x) { return x.code + ' ' + x.street; }));
}

/** Συνδέει πεδίο αναζήτησης με το ✕ του και καλεί onInput σε κάθε αλλαγή. */
function wireSearch(id, onInput) {
  var input = $(id), x = document.querySelector('[data-clear="' + id + '"]');
  var update = function () { x.hidden = !input.value; onInput(input.value); };
  input.oninput = update;
  input.onkeydown = function (e) { if (e.key === 'Enter') input.blur(); };    // κλείνει το πληκτρολόγιο
  x.onclick = function () { input.value = ''; update(); input.focus(); };
}

function setSearch(id, value) {
  $(id).value = value || '';
  document.querySelector('[data-clear="' + id + '"]').hidden = !value;
}

function normCode(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^0-9A-ZΑ-Ω]/g, '');
}

function myLeadsFor(code) {
  var k = normCode(code);
  return k ? S.leads.filter(function (l) { return normCode(l.code) === k; }) : [];
}

/**
 * 2.0 · Κάρτα ακινήτου: φωτογραφία, τιμή μεγάλη, εικονίδια (τ.μ., τύπος, περιοχή)
 * και από κάτω εντολή, έγγραφα, κλήσεις. Ίδια κάρτα σε κινητό και υπολογιστή.
 */
function propRow(p, lacking) {
  var open = myLeadsFor(p.code).filter(isOpen).length;
  var avail = p.available !== false;
  var deal = p.deal ? '<span class="pcard-deal">' + esc(p.deal) + '</span>' : '';
  var icons = [
    p.sqm ? '<span>' + ico('sqm') + '<span class="sr">Εμβαδόν </span>' + esc(p.sqm) + ' τ.μ.</span>' : '',
    p.type ? '<span>' + ico('home') + '<span class="sr">Τύπος </span>' + esc(p.type) + '</span>' : '',
    p.area ? '<span>' + ico('pin') + '<span class="sr">Περιοχή </span>' + esc(p.area) + '</span>' : ''
  ].join('');
  var chips = [
    avail ? '' : '<span class="tag">' + esc(p.status || 'Μη διαθέσιμο') + '</span>',
    p.mine ? docsTag(p) + (avail ? mandateTag(p) : '') : '<span class="tag">' + esc(p.partner || 'Ομάδα') + '</span>',
    open ? '<span class="tag pending">' + open + (open === 1 ? ' ανοιχτή κλήση' : ' ανοιχτές κλήσεις') + '</span>' : '',
    lacking && lacking.length ? '<span class="tag noanswer">Λείπουν: ' + esc(lacking.join(', ')) + '</span>' : ''
  ].join('');
  return '<button class="row pcard' + (avail ? '' : ' off') + '" data-code="' + esc(p.code) + '">' +
    '<span class="row-thumb pcard-img" data-thumb="' + esc(p.code) + '" aria-hidden="true">' + ico('home') + '</span>' +
    '<span class="pcard-body">' +
      '<span class="pcard-top"><b class="pcard-price">' + esc(fmtPrice(p.price) || '—') + '</b>' + deal + '</span>' +
      '<span class="pcard-title">' + esc(p.street || p.title || p.code) + '</span>' +
      (icons ? '<span class="pcard-icons">' + icons + '</span>' : '') +
    '</span>' +
    '<span class="pcard-foot">' + chips +
      '<span class="pcard-calls">' + ico('phone') + p.month + ' τον μήνα · Κωδ. ' + esc(p.code) + '</span></span>' +
    '</button>';
}

function wirePropRows(el) {
  el.querySelectorAll('[data-code]').forEach(function (r) {
    r.onclick = function () { openProp(r.dataset.code); };
  });
  wireThumbs(el);     // 1.18: μικρή φωτογραφία
}

// ── Φίλτρα ακινήτων: Κατάσταση, Εντολή, Ισχύς εντολής ─────
// Κατάσταση: προεπιλογή «Διαθέσιμα», όπως ήταν πάντα η λίστα.
// Εντολή: οι τιμές της στήλης U όπως είναι γραμμένες.
// Ισχύς: από την ημερομηνία λήξης (στήλη W).

var PF_DEFAULT = { status: 'available', mandate: '', active: '' };
S.pf = { status: 'available', mandate: '', active: '' };

function fillPropFilters() {
  var statuses = {}, mandates = {}, noMandate = false;
  S.props.forEach(function (p) {
    if (p.available === false && p.status) statuses[p.status] = true;
    if (p.mandate) mandates[p.mandate] = true; else noMandate = true;
  });
  var sorted = function (o) { return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'el'); }); };
  S.pf.status = fillOptions($('f-p-status'), [['available', 'Διαθέσιμα'], ['', 'Όλες']]
    .concat(sorted(statuses).map(function (x) { return [x, x]; })), S.pf.status);
  S.pf.mandate = fillOptions($('f-p-mandate'), [['', 'Όλες']]
    .concat(sorted(mandates).map(function (x) { return [x, x]; }), noMandate ? [['__none', 'Χωρίς εντολή']] : []), S.pf.mandate);
  S.pf.active = fillOptions($('f-p-active'), [['', 'Όλες'], ['active', 'Ενεργή'], ['expired', 'Έληξε'],
    ['nodate', 'Χωρίς ημερομηνία λήξης']], S.pf.active);
  filterBadge('prop', Object.keys(PF_DEFAULT).filter(function (k) { return S.pf[k] !== PF_DEFAULT[k]; }).length);
}

function propPasses(p) {
  var f = S.pf, avail = p.available !== false;
  if (f.status === 'available' && !avail) return false;
  if (f.status && f.status !== 'available' && p.status !== f.status) return false;
  if (f.mandate === '__none' && p.mandate) return false;
  if (f.mandate && f.mandate !== '__none' && p.mandate !== f.mandate) return false;
  if (f.active === 'active' && !(p.mandateDays != null && p.mandateDays >= 0)) return false;
  if (f.active === 'expired' && !(p.mandateDays != null && p.mandateDays < 0)) return false;
  if (f.active === 'nodate' && p.mandateDays != null) return false;
  return true;
}

function clearPropFilters() {
  S.pf = { status: PF_DEFAULT.status, mandate: '', active: '' };
  resetPage('props');
  renderProps();
}

function renderProps() {
  fillPropFilters();
  var shown = S.props.filter(propPasses);
  var mine = shown.filter(function (p) { return p.mine; });
  var team = shown.filter(function (p) { return !p.mine; });
  var lack = mine.filter(function (p) { return missingDocs(p).length; });
  $('c-p-mine').textContent = mine.length;
  $('c-p-team').textContent = team.length;
  $('c-p-docs').textContent = lack.length;
  setTab('tabs-props', S.propTab);

  var onMap = S.propTab === 'map';
  $('prop-list').hidden = onMap;
  $('map-pane').hidden = !onMap;
  $('prop-search-row').hidden = onMap;
  if (onMap) { $('prop-fpanel').hidden = true; showMap(); return; }

  var el = $('prop-list');
  var words = searchWords($('prop-search').value);
  var filtered = Object.keys(PF_DEFAULT).some(function (k) { return S.pf[k] !== PF_DEFAULT[k]; });

  // Με αναζήτηση: ψάχνει σε όλα, δικά μου και ομάδας, όποιο tab κι αν είναι ανοιχτό.
  if (words.length) {
    var hit = function (p) { return matches(words, propFields(p)); };
    var all = mine.filter(hit).concat(team.filter(hit));
    var nMine = mine.filter(hit).length;
    if (!all.length) {
      el.innerHTML = '<div class="empty"><b>Δεν βρέθηκε ακίνητο</b>Δοκίμασε οδό, κωδικό ή περιοχή' +
        (filtered ? ', ή «Καθαρισμός φίλτρων».' : '.') + '</div>';
      return;
    }
    var p0 = (curPage('props:search', all.length) - 1) * PAGE_SIZE;
    var html = listMeta(all.length, 'props:search', 'ακίνητο', 'ακίνητα');
    pageOf(all, 'props:search').forEach(function (p, i) {
      var at = p0 + i;
      if (i === 0 && at < nMine) html += '<div class="section">Δικά μου (' + nMine + ')</div>';
      if (at === nMine || (i === 0 && at > nMine)) html += '<div class="section">Ομάδας (' + (all.length - nMine) + ')</div>';
      html += propRow(p);
    });
    el.innerHTML = html + pagerHtml(all.length, 'props:search');
    wirePropRows(el);
    wirePager(el, 'props:search', renderProps);
    return;
  }

  var list = S.propTab === 'team' ? team : S.propTab === 'docs' ? lack : mine;
  var empty = filtered ? ['Κανένα ακίνητο με αυτά τα φίλτρα', 'Άλλαξε τα φίλτρα ή πάτα «Καθαρισμός φίλτρων».'] : {
    mine: ['Κανένα δικό σου ακίνητο', 'Δεν έχεις διαθέσιμα ακίνητα στο φύλλο.'],
    team: ['Κανένα ακίνητο', 'Δεν υπάρχουν ακίνητα άλλων μελών της ομάδας.'],
    docs: ['Όλα τα έγγραφα είναι εντάξει', 'Εδώ φαίνονται τα ακίνητα με εντολή που τους λείπουν έγγραφα.']
  }[S.propTab];

  var key = 'props:' + S.propTab;
  el.innerHTML = list.length ? listMeta(list.length, key, 'ακίνητο', 'ακίνητα') + pageOf(list, key).map(function (p) {
    return propRow(p, S.propTab === 'docs' ? missingDocs(p) : null);
  }).join('') + pagerHtml(list.length, key) : '<div class="empty"><b>' + empty[0] + '</b>' + empty[1] + '</div>';
  wirePropRows(el);
  wirePager(el, key, renderProps);
}

// ─────────────────────────────────────────────────────────────
//  ΚΕΝΤΡΙΚΗ ΑΝΑΖΗΤΗΣΗ (Σήμερα)
//  Ακίνητα και επαφές μαζί, λίγα από το καθένα. «Δες όλα» ανοίγει την καρτέλα
//  με την ίδια αναζήτηση ήδη γραμμένη.
// ─────────────────────────────────────────────────────────────

var GLOBAL_MAX = 5;

function renderGlobal(q) {
  var words = searchWords(q);
  $('today-main').hidden = !!words.length;
  $('global-results').hidden = !words.length;
  if (!words.length) return;

  var props = S.props.filter(function (p) { return matches(words, propFields(p)); });
  var contacts = (S.contacts || []).filter(function (c) { return matches(words, contactFields(c)); });
  var all = function (go, n, text) {
    return n > GLOBAL_MAX ? '<button class="today-more" data-all="' + go + '"><span>' + text + ' (' + n.toLocaleString('el-GR') + ')</span>' +
      ico('next', 'ico chev') + '</button>' : '';
  };

  var html = '<div class="section">Ακίνητα</div>' + (props.length
    ? props.slice(0, GLOBAL_MAX).map(function (p) { return propRow(p); }).join('') + all('props', props.length, 'Δες όλα τα ακίνητα')
    : '<p class="none">Κανένα ακίνητο.</p>');

  html += '<div class="section">Επαφές</div>' + (!S.contacts ? '<p class="none">Φόρτωση επαφών…</p>' : contacts.length
    ? contacts.slice(0, GLOBAL_MAX).map(function (c) {
        var sub = [(c.phones || [])[0], c.role].filter(Boolean).join(' · ');
        return '<button class="row" data-contact="' + esc(c.id) + '"><span class="row-body"><span class="row-name">' +
          esc(c.name || (c.phones || [])[0]) + '</span>' + (sub ? '<span class="row-prop">' + esc(sub) + '</span>' : '') +
          '</span>' + ico('next', 'ico chev') + '</button>';
      }).join('') + all('contacts', contacts.length, 'Δες όλες τις επαφές')
    : '<p class="none">Καμία επαφή.</p>');

  var el = $('global-results');
  el.innerHTML = html;
  wirePropRows(el);
  el.querySelectorAll('[data-contact]').forEach(function (b) {
    b.onclick = function () { openContact(b.dataset.contact); };
  });
  el.querySelectorAll('[data-all]').forEach(function (b) {
    b.onclick = function () {
      var text = $('global-search').value;
      if (b.dataset.all === 'props') { setSearch('prop-search', text); goto('props'); }
      else { setSearch('contact-search', text); resetPage('contacts'); goto('contacts'); }
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  ΧΑΡΤΗΣ (1.7)
//  Ο χάρτης (Leaflet, στο vendor/) φορτώνει μόνο όταν ανοίξει το tab,
//  για να μην επιβαρύνει το άνοιγμα της εφαρμογής.
// ─────────────────────────────────────────────────────────────

var MAP = { lib: null, map: null, layer: null, data: null, at: 0, deal: '', status: 'available', mine: false, sel: null };
var MAP_MAX_AGE = 600000;

function addAsset(tag, attrs) {
  return new Promise(function (ok, no) {
    var el = document.createElement(tag);
    Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; });
    el.onload = ok;
    el.onerror = function () { no(new Error('Δεν φορτώθηκε ο χάρτης. Υπάρχει ο φάκελος vendor;')); };
    document.head.appendChild(el);
  });
}

function loadMapLib() {
  if (MAP.lib) return MAP.lib;
  MAP.lib = Promise.all([
    addAsset('link', { rel: 'stylesheet', href: 'vendor/leaflet.css' }),
    addAsset('link', { rel: 'stylesheet', href: 'vendor/MarkerCluster.css' }),
    addAsset('script', { src: 'vendor/leaflet.js' })
  ]).then(function () { return addAsset('script', { src: 'vendor/leaflet.markercluster.js' }); });
  MAP.lib.catch(function () { MAP.lib = null; });
  return MAP.lib;
}

function mapMsg(title, text, retry) {
  var m = $('map-msg');
  m.hidden = !title;
  if (!title) return;
  m.innerHTML = '<b>' + esc(title) + '</b>' + esc(text || '') + (retry ? '<button class="btn wide" id="map-retry">Δοκίμασε ξανά</button>' : '');
  if (retry) $('map-retry').onclick = showMap;
}

/** Το ύψος που περισσεύει ανάμεσα στα φίλτρα και το κάτω μενού. */
function sizeMap() {
  var wrap = $('map').parentNode;
  var bottom = document.querySelector('.tabs').getBoundingClientRect().top;
  var h = Math.round(bottom - wrap.getBoundingClientRect().top - 4);
  wrap.style.height = Math.max(h, 260) + 'px';
  if (MAP.map) MAP.map.invalidateSize();
}

function showMap() {
  window.scrollTo(0, 0);
  sizeMap();
  var fresh = MAP.data && Date.now() - MAP.at < MAP_MAX_AGE;
  if (fresh) return;
  if (!MAP.data) mapMsg('Φόρτωση χάρτη…');

  Promise.all([loadMapLib(), api('map')]).then(function (r) {
    MAP.data = r[1];
    MAP.at = Date.now();
    if (!MAP.map) createMap();
    fillMapFilters();
    mapMsg('');
    sizeMap();
    drawMap(true);
  }).catch(function (e) {
    if (!MAP.data) mapMsg('Ο χάρτης δεν φόρτωσε', e.message, true);
  });
}

function createMap() {
  var L = window.L;
  MAP.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([37.98, 23.73], 12);
  MAP.map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    referrerPolicy: 'strict-origin-when-cross-origin',    // το OSM απαιτεί Referer, η σελίδα γενικά δεν στέλνει
    attribution: '© OpenStreetMap'
  }).addTo(MAP.map);
  MAP.layer = L.markerClusterGroup({
    maxClusterRadius: 44, showCoverageOnHover: false, spiderfyDistanceMultiplier: 1.6,
    iconCreateFunction: function (c) {
      return L.divIcon({ className: '', iconSize: [44, 44], html: '<span class="pin-group">' + c.getChildCount() + '</span>' });
    }
  }).addTo(MAP.map);
  MAP.map.on('click', function () { closeMapCard(); });
  window.addEventListener('resize', function () { if (S.view === 'props' && S.propTab === 'map') sizeMap(); });
}

function fillMapFilters() {
  var items = MAP.data.items;
  var uniq = function (key) {
    var seen = {};
    items.forEach(function (i) { if (i[key]) seen[i[key]] = true; });
    return Object.keys(seen).sort();
  };
  var opts = function (el, list, cur) {
    el.innerHTML = list.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  };
  var deals = uniq('deal');
  if (deals.indexOf(MAP.deal) === -1) MAP.deal = '';
  opts($('map-deal'), [['', 'Όλες']].concat(deals.map(function (d) { return [d, d]; })), MAP.deal);

  // Ό,τι γράφει το φύλλο, όπως το γράφει. Έτσι ένα νέο «Ενοικιάστηκε» μπαίνει μόνο του.
  var others = {};
  items.forEach(function (i) { if (!i.available) others[i.status] = true; });
  var statuses = Object.keys(others).sort();
  if (MAP.status !== '' && MAP.status !== 'available' && statuses.indexOf(MAP.status) === -1) MAP.status = 'available';
  opts($('map-status'), [['available', 'Διαθέσιμα'], ['', 'Όλα']].concat(statuses.map(function (x) { return [x, x]; })), MAP.status);
}

function mapList() {
  return MAP.data.items.filter(function (i) {
    if (MAP.deal && i.deal !== MAP.deal) return false;
    if (MAP.mine && !i.mine) return false;
    if (MAP.status === 'available') return i.available;
    return !MAP.status || i.status === MAP.status;
  });
}

function drawMap(fit) {
  if (!MAP.map || !MAP.data) return;
  var L = window.L, list = mapList();
  closeMapCard();
  // Πρώτα η θέση, χωρίς κίνηση, και μετά οι πινέζες: αν αλλάξουν γρήγορα τα φίλτρα
  // ενώ ο χάρτης ζουμάρει, το cluster δεν προλαβαίνει και οι πινέζες χάνονται.
  MAP.map.stop();
  if (fit && list.length) {
    MAP.map.fitBounds(L.latLngBounds(list.map(function (i) { return [i.lat, i.lng]; })),
                      { padding: [36, 36], maxZoom: 15, animate: false });
  }
  MAP.layer.clearLayers();
  MAP.layer.addLayers(list.map(function (i) {
    var m = L.marker([i.lat, i.lng], {
      title: i.street || i.code, alt: i.street || i.code,
      icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 34], html: '<span class="pin' + (i.available ? '' : ' off') + '"></span>' })
    });
    m.on('click', function () { showMapCard(i); });
    return m;
  }));

  $('map-count').textContent = plural(list.length, 'ακίνητο', 'ακίνητα');
  if (!MAP.data.items.length) {
    mapMsg('Ο χάρτης ετοιμάζεται', 'Οι διευθύνσεις μπαίνουν στον χάρτη σταδιακά. Ξανακοίτα σε λίγη ώρα.');
  } else if (!list.length) {
    mapMsg('Κανένα ακίνητο με αυτά τα φίλτρα', 'Άλλαξε Συναλλαγή ή Κατάσταση.');
  } else mapMsg('');
}

function closeMapCard() { $('map-card').hidden = true; }

/** Κάρτα κάτω από τον χάρτη: τι είναι, Οδηγίες, και Στοιχεία όπου έχει νόημα. */
function showMapCard(i) {
  var known = S.props.filter(function (p) { return p.code === i.code; })[0];
  var nav = navUrl(i);
  var c = $('map-card');
  c.innerHTML = '<button class="x" id="map-card-x" aria-label="Κλείσιμο">✕</button>' +
    '<h3>' + esc(i.street || i.title || i.code) + '</h3>' +
    '<p>' + esc([i.type, fmtPrice(i.price), i.area].filter(Boolean).join(', ')) + '</p>' +
    '<div class="row-meta"><span class="tag ' + (i.available ? 'showing' : 'answered') + '">' + esc(i.status) + '</span>' +
      (i.deal ? '<span class="tag closed">' + esc(i.deal) + '</span>' : '') +
      '<span>' + esc(i.mine ? 'Δικό μου' : i.partner) + '</span>' +
      (i.approx ? '<span>Θέση κατά προσέγγιση</span>' : '') + '</div>' +
    '<div class="actions">' +
      (nav ? '<a class="btn primary" href="' + esc(nav) + '" target="_blank" rel="noopener">' + ico('nav') + 'Οδηγίες</a>' : '') +
      (known ? '<button class="btn" id="map-card-open">Στοιχεία</button>' : '') +
    '</div>';
  c.hidden = false;
  $('map-card-x').onclick = closeMapCard;
  if (known) $('map-card-open').onclick = function () { openProp(i.code); };
}

/** Η διεύθυνση όπως τη δίνουμε στο Google Maps. */
function mapsText(street, area) {
  return [street, area, 'Ελλάδα'].filter(Boolean).join(', ');
}

/** Οδηγίες: προορισμός το ακίνητο, αφετηρία η θέση του μεσίτη. */
function navUrl(p) {
  if (!p.street) return '';
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' +
    encodeURIComponent(mapsText(p.street, p.area));
}

/** Το Google Maps ανοίγει με τη διεύθυνση πάνω στον χάρτη. */
function placeUrl(street, area) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapsText(street, area));
}

/** Πατήσιμη διεύθυνση με εικονίδιο. Χωρίς διεύθυνση κρύβεται. */
function addrLink(el, street, area) {
  el.hidden = !street;
  if (!street) return;
  el.href = placeUrl(street, area);
  el.setAttribute('aria-label', street + ', άνοιγμα στο Google Maps');
  label(el, 'map', [street, area].filter(Boolean).join(', '));
}

function openProp(code) {
  var p = S.props.filter(function (x) { return x.code === code; })[0];
  if (!p) return;

  $('pd-name').textContent = p.street || p.title || p.code;
  $('pd-sub').textContent = p.title || '';
  addrLink($('pd-addr'), p.street, p.area);

  $('pd-stats').innerHTML = [
    [p.week, 'εβδομάδα'], [p.month, 'μήνας'], [p.total, 'σύνολο']
  ].map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>κλήσεις ' + s[1] + '</span></div>'; }).join('');

  // 1.16: κατάσταση, εντολή και λήξη με μια ματιά.
  var chips = [];
  chips.push('<span class="tag ' + (p.available === false ? 'answered' : 'showing') + '">' + esc(p.status || (p.available === false ? 'Μη διαθέσιμο' : 'Διαθέσιμο')) + '</span>');
  if (p.mandate) chips.push('<span class="tag">' + esc(p.mandate) + '</span>');
  if (p.mine && p.available !== false) chips.push(mandateTag(p));
  if (!p.mine && p.partner) chips.push('<span class="tag">' + esc(p.partner) + '</span>');
  $('pd-chips').innerHTML = chips.filter(Boolean).join('');

  $('pd-facts').innerHTML = [
    ['Κωδικός', p.code], ['Κατάσταση', p.status], ['Τύπος', p.type], ['Περιοχή', p.area], ['Οδός', p.street],
    ['Τιμή', fmtPrice(p.price)], ['Εμβαδόν', p.sqm ? p.sqm + ' τ.μ.' : ''],
    ['Εντολή', p.mandate], ['Λήξη εντολής', p.mandateDays == null ? '' : mandateText(p.mandateDays)],
    ['Συνεργάτης', p.partner]
  ].filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
  }).join('');

  S.prop = p;
  loadMedia('pd', p);
  $('pd-present').hidden = p.available === false;     // 1.19                // 1.18: εξώφυλλο και φωτογραφίες
  // Το ακίνητο άλλου μέλους δεν έχει έγγραφα εδώ: μόνο Στοιχεία και Κλήσεις.
  $('tab-pd-docs').hidden = !p.mine;
  $('tab-pd-bill').hidden = !p.mine;
  $('tabs-prop').classList.toggle('four', !!p.mine);
  var pane = S.propPane && (p.mine || S.propPane === 'leads' || S.propPane === 'facts') && S.propPane !== 'bill' ? S.propPane : 'facts';
  setTab('tabs-prop', pane);
  showPane('prop-panes', pane);
  if (p.mine) loadDocs(p);
  $('pd-bill-count').textContent = '';

  var nav = navUrl(p);
  $('pd-nav').hidden = !nav;
  if (nav) $('pd-nav').href = nav;

  var mineLeads = myLeadsFor(p.code);
  var n = mineLeads.length;
  $('pd-leads-count').textContent = n || '';
  var ll = $('pd-leads-list');
  ll.innerHTML = n ? groupLeads(mineLeads, false)
    : '<p class="card-note">Καμία κλήση σου για αυτό το ακίνητο τους τελευταίους 2 μήνες.</p>';
  wireLeadRows(ll);
  var b = $('pd-leads');
  b.hidden = !n;
  b.onclick = function () {
    closeSheet('propdetail');
    closeSheet('contact');
    S.propFilter = { key: normCode(p.code), label: (p.street || p.code) + ' · ' + n + (n === 1 ? ' κλήση' : ' κλήσεις') };
    S.filter = 'all';
    goto('calls');
    renderCalls();
  };

  $('propdetail').querySelector('.sheet-body').scrollTop = 0;
  openSheet('propdetail');
}

// ─────────────────────────────────────────────────────────────
//  ΛΕΠΤΟΜΕΡΕΙΑ ΚΛΗΣΗΣ
// ─────────────────────────────────────────────────────────────

function findLead(id) {
  return S.leads.filter(function (x) { return x.id === String(id); })[0];
}

/**
 * Ανοίγει μια κλήση. Αν ήρθε μόλις με ειδοποίηση και δεν είναι ακόμα στη
 * λίστα, φέρνει πρώτα φρέσκια λίστα. opts.remind → SMS υπενθύμισης έτοιμο.
 */
function openLead(id, opts) {
  var go = /^go:(.*)$/.exec(String(id));
  if (go) return routeTo(go[1], opts || {});
  if (isAdminMode() && roles().agent) setMode('agent', true);   // ειδοποίηση μεσίτη ενώ ήσουν στο Admin
  var l = findLead(id);
  if (l) return showLead(l, opts || {});

  apiTimed('leads', {}, 20000).then(function (leads) {
    S.leads = leads;
    offReapply();
    render();
    var fresh = findLead(id);
    if (fresh) showLead(fresh, opts || {});
    else toast('Η κλήση δεν βρέθηκε στους τελευταίους 2 μήνες.', true);
  }).catch(function (e) { toast(e.message, true); });
}

/** Ειδοποιήσεις που δεν ανοίγουν κλήση, αλλά μια οθόνη: go:today, go:form, go:prop:…, go:outcome:… */
function routeTo(where, opts) {
  while (closeTop()) { /* κλείνουμε ό,τι είναι ανοιχτό */ }
  if (where === 'today') return goto('today');
  if (where === 'form') return goto('metrics');
  if (where.indexOf('prop:') === 0) {
    S.propTab = 'mine';
    goto('props');
    return openProp(where.slice(5));
  }
  if (where.indexOf('outcome:') === 0) {
    if (opts && opts.act) return quickOutcome(where.slice(8), opts.act);   // 2.3 · FEAT-3: 1 πάτημα από την ειδοποίηση
    openLead(where.slice(8), { outcome: true });
  }
  if (where.indexOf('review:') === 0) routeReview(where.slice(7));
  if (where === 'adminreview' && roles().admin) {           // 1.18: «νέα έντυπα για έλεγχο»
    S.rvTab = 'pending';
    if (isAdminMode()) { goto('a-review'); loadAdmin(true).catch(function () {}); }
    else setMode('admin', true);
  }
}

function showLead(l, opts) {
  closeSheet('showing');
  closeSheet('settings');
  closeSheet('propdetail');
  closeSheet('contact');

  S.smsLang = 'el';
  S.smsKind = opts.remind && upcoming(l) ? 'reminder' : 'intro';
  fillDetail(l);
  loadProfile(l);                                    // 2.1
  setTab('tabs-detail', opts.profile ? 'profile' : 'hist');
  showPane('detail-panes', opts.profile ? 'profile' : 'hist');
  openSheet('detail');
  $('detail').querySelector('.sheet-body').scrollTop = 0;
  if (opts.outcome) openShowingForm();
  else if (opts.offer && l.code) openOffer(l);
  else if (opts.form && hasShowing(l)) $('btn-showform').onclick();
  else if (S.smsKind === 'reminder') openSmsBox('reminder');

  if (!l.opened) {
    l.opened = nowStamp();
    beacon('open', { id: l.id });
  }
}

function closeDetail() {
  pfSaveNow();
  closeSheet('detail');
  S.lead = null;
  render();
}

function hasShowing(l) { return !!(l && l.hasEvent && l.showingDate); }

/** Υπόδειξη που δεν έχει περάσει ακόμα. */
function upcoming(l) { return hasShowing(l) && l.showingTs > Date.now(); }

/** Η υπόδειξη έγινε και δεν έχει γραφτεί ακόμα πώς πήγε. */
function needsOutcome(l) {
  return hasShowing(l) && l.status === ST.SHOWING && !l.outcome && l.showingTs <= Date.now();
}

function fillDetail(l) {
  S.lead = l;
  $('btn-lead-present').hidden = !S.props.some(function (x) { return x.available !== false && normCode(x.code) === normCode(l.code); });
  $('d-name').textContent = l.name || 'Χωρίς όνομα';
  $('d-prop').textContent = l.property + (l.code ? ' · ' + l.code : '');
  $('d-deal').textContent = [l.deal, fmtPrice(l.price)].filter(Boolean).join(' · ');
  var lp = S.props.filter(function (x) { return normCode(x.code) === normCode(l.code); })[0];
  addrLink($('d-addr'), l.address, lp ? lp.area : '');
  $('d-status').textContent = l.status;
  $('d-status').className = 'tag ' + (STATUS_CLASS[l.status] || 'answered');
  $('d-avatar').textContent = initials(l.name);
  $('d-avatar').className = 'avatar big ' + (STATUS_CLASS[l.status] || 'answered');
  renderKnown(l);
  $('d-phone').textContent = l.phoneIntl || '—';
  $('d-email').textContent = l.email || '—';
  $('d-date').textContent = niceDate(l.date);
  $('d-source').textContent = l.source || '—';
  $('d-status-select').value = l.status;
  $('save-hint').textContent = '';
  $('save-hint').className = 'save-hint';

  $('d-message-wrap').hidden = !l.message;
  $('d-message').textContent = l.message || '';

  if (document.activeElement !== $('d-notes')) $('d-notes').value = l.notes || '';

  var tel = l.phoneIntl || '';
  $('d-tel').href = tel ? 'tel:' + tel : '#';
  $('d-tel').classList.toggle('muted', !tel);
  $('d-mail').href = l.email ? 'mailto:' + l.email : '#';
  $('d-mail').classList.toggle('muted', !l.email);
  $('d-sms-btn').classList.toggle('muted', !tel);
  $('d-sms-btn').disabled = !tel;
  var where = l.address || (lp && lp.street) || '';
  if (where) $('d-map').href = placeUrl(where, lp ? lp.area : ''); else $('d-map').removeAttribute('href');
  $('d-map').classList.toggle('muted', !where);

  fact('d-repeat-wrap', 'd-repeat', /επαν/i.test(l.repeat || '') ? l.repeat : '');
  fact('d-called-wrap', 'd-called', l.called);
  fact('d-followup-wrap', 'd-followup', l.status === ST.NO_ANSWER ? l.followUp : '');
  fact('d-showing-wrap', 'd-showing', l.showingAt);
  fact('d-outcome-wrap', 'd-outcome', l.outcome ? l.outcome + (l.outcomeNote ? '. ' + l.outcomeNote : '') : '');
  fact('d-sms-wrap', 'd-sms', l.sms);
  fact('d-smsremind-wrap', 'd-smsremind', upcoming(l) ? l.smsRemind : '');

  $('btn-noanswer').textContent = l.status === ST.NO_ANSWER ? 'Δεν απάντησε ξανά' : 'Δεν απάντησε';
  $('btn-showing-text').textContent = needsOutcome(l) ? 'Πώς πήγε η υπόδειξη;' : hasShowing(l) ? 'Αλλαγή υπόδειξης' : 'Κλείσε υπόδειξη';
  // 1.14.1: το έντυπο υπόδειξης έχει δικό του κουμπί, μόλις υπάρχει υπόδειξη.
  $('btn-showform').hidden = !hasShowing(l);
  $('d-form-sub').textContent = l.form ? 'Κατάσταση: ' + l.form + '.' : 'Link για τον πελάτη, υπογραφή, PDF.';
  // 1.20: έντυπο προσφοράς, για κάθε κλήση με κωδικό ακινήτου.
  $('btn-offer').hidden = !l.code;
  $('d-offer-sub').textContent = l.offer === 'Υπογράφηκε' ? 'Υπογράφηκε · άνοιξε το PDF.' :
    l.offer === 'Στάλθηκε' ? 'Περιμένει τον πελάτη.' : 'Ο πελάτης γράφει τιμή, τρόπο πληρωμής και υπογράφει.';

  renderNext(l);
  renderHist(l);
  prepareSms(l);
  pfLine(l);                                         // 2.1
}

// ── Επόμενο βήμα (1.16) ───────────────────────────────────
// Μία σκούρα κάρτα που λέει τι κάνεις τώρα, με το πολύ δύο κουμπιά.
// Τα κουμπιά καλούν τις ίδιες ενέργειες με τη λίστα «Άλλες ενέργειες».

function renderNext(l) {
  var tel = l.phoneIntl || '';
  var callBtn = function (text) {
    return tel ? '<a class="btn solid-red" data-next="call" href="tel:' + esc(tel) + '">' + ico('phone') + esc(text) + '</a>'
               : '<button class="btn solid-red" disabled>' + ico('phone') + 'Χωρίς τηλέφωνο</button>';
  };
  var b = function (act, text, icon, main) {
    return '<button class="btn ' + (main ? 'solid-red' : 'ghost-light') + '" data-next="' + act + '">' + (icon ? ico(icon) : '') + esc(text) + '</button>';
  };
  var title, text, btns;
  var formLine = l.form ? ' · Έντυπο: ' + l.form.toLowerCase() : '';

  if (needsOutcome(l)) {
    title = 'Πώς πήγε η υπόδειξη;';
    text = 'Έγινε ' + lowerDay(niceDate(l.showingAt)) + '. Γράψε το αποτέλεσμα όσο το θυμάσαι' + formLine + '.';
    btns = b('showing', 'Πώς πήγε;', 'check', true) + b('form', 'Έντυπο υπόδειξης', 'form');
  } else if (upcoming(l)) {
    title = 'Υπόδειξη ' + lowerDay(niceDate(l.showingAt));
    text = (l.address ? l.address + '. ' : '') + (l.smsRemind ? 'Υπενθύμιση στάλθηκε ' + lowerDay(niceDate(l.smsRemind)) + '.' : 'Στείλε υπενθύμιση στον πελάτη.') + formLine;
    btns = (tel ? b('remind', 'SMS υπενθύμισης', 'sms', true) : '') + b('showing', 'Αλλαγή', 'calendar', !tel);
  } else if (hasShowing(l) && l.outcome) {
    title = 'Αποτέλεσμα: ' + l.outcome;
    text = (l.outcomeNote ? l.outcomeNote + ' ' : '') + 'Η υπόδειξη έγινε ' + lowerDay(niceDate(l.showingAt)) + formLine + '.';
    // 1.20: ενδιαφέρθηκε → η προσφορά είναι το επόμενο βήμα.
    var keen = l.code && (S.boot.outcomes || [])[0] === l.outcome;
    btns = keen ? b('offer', l.offer === 'Υπογράφηκε' ? 'Η προσφορά' : 'Έντυπο προσφοράς', 'receipt', true) + b('form', 'Έντυπο υπόδειξης', 'form')
                : b('form', 'Έντυπο υπόδειξης', 'form', true) + b('showing', 'Υπόδειξη', 'calendar');
  } else if (l.status === ST.PENDING) {
    title = 'Κάλεσε τον πελάτη';
    text = 'Νέα κλήση, ήρθε ' + lowerDay(niceDate(l.date)) + (l.source ? ' από ' + l.source : '') + '.';
    btns = callBtn('Κλήση') + b('noanswer', 'Δεν απάντησε', '');
  } else if (l.status === ST.NO_ANSWER) {
    title = 'Κάλεσε ξανά';
    text = 'Δεν απάντησε' + (l.called ? ' ' + lowerDay(niceDate(l.called)) : '') + '.' + (l.followUp ? ' Follow-up ' + lowerDay(niceDate(l.followUp)) + '.' : '');
    btns = callBtn('Κλήση ξανά') + b('noanswer', 'Δεν απάντησε ξανά', '');
  } else if (l.status === ST.CLOSED) {
    title = 'Η κλήση έκλεισε';
    text = 'Αν ο πελάτης ξαναβγεί, άλλαξε την κατάσταση από κάτω ή φτιάξε εργασία.';
    btns = b('task', 'Εργασία', 'tasks');
  } else {
    title = 'Κλείσε υπόδειξη';
    text = (l.called ? 'Μίλησες ' + lowerDay(niceDate(l.called)) + '. ' : '') + 'Επόμενο βήμα: ραντεβού στο ακίνητο.';
    btns = b('showing', 'Κλείσε υπόδειξη', 'calendar', true) + b('task', 'Εργασία', 'tasks');
  }

  var el = $('d-next');
  el.innerHTML = '<span class="next-kicker">Επόμενο βήμα</span><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
    '<div class="next-btns">' + btns + '</div>';
  el.querySelectorAll('[data-next]').forEach(function (x) {
    var act = x.dataset.next;
    x.onclick = act === 'call' ? onTelClick
      : act === 'noanswer' ? onNoAnswer
      : act === 'showing' ? openShowingForm
      : act === 'form' ? function () { $('btn-showform').onclick(); }
      : act === 'offer' ? function () { openOffer(S.lead); }
      : act === 'remind' ? function () { openSmsBox('reminder'); }
      : act === 'task' ? onLeadTask : null;
  });
}

// ── Ιστορικό (1.16) ───────────────────────────────────────
// Χρονολόγιο από τα πεδία της κλήσης: ήρθε, άνοιξε, SMS, κλήση, υπόδειξη…
// Τα μελλοντικά (follow-up, υπόδειξη που έρχεται) φαίνονται αχνά, στο τέλος.

function renderHist(l) {
  var ev = [];
  var add = function (stamp, title, sub, tone, call) {
    var d = typeof stamp === 'number' ? new Date(stamp) : parseStamp(stamp);
    if (d) ev.push({ d: d, title: title, sub: sub || '', tone: tone || '', call: call || null });
  };
  add(l.ts || l.date, 'Ήρθε η κλήση', [l.source, l.repeat && /επαν/i.test(l.repeat) ? 'επανάληψη' : ''].filter(Boolean).join(' · '));
  add(l.opened, 'Την άνοιξες');
  add(l.sms, 'SMS πρώτης επαφής');
  addCalls(l, add, 'Κάλεσες τον πελάτη');
  if (l.status === ST.NO_ANSWER) add(l.followUp, 'Follow-up', 'Μπήκε στο ημερολόγιο');
  if (hasShowing(l)) add(l.showingTs, 'Υπόδειξη', l.address || '', 'show');
  add(l.smsRemind, 'SMS υπενθύμισης');
  if (l.outcome) add(l.showingTs ? l.showingTs + 60000 : null, 'Αποτέλεσμα: ' + l.outcome, l.outcomeNote, 'done');
  ev.sort(function (a, b) { return a.d - b.d; });

  var now = Date.now();
  $('d-hist').innerHTML = histHtml(ev, true);
  $('d-hist').querySelectorAll('[data-cn]').forEach(function (x) {
    x.onclick = function () {
      var c = (l.calls || []).filter(function (k) { return k.id === x.dataset.cn; })[0];
      if (c) openCallNote({ lead: l.id, cid: c.id, at: c.ts, name: l.name }, c);
    };
  });
}

/**
 * 1.20 · Κάθε κλήση με τη σημείωσή της. Χωρίς ιστορικό κλήσεων (παλιές κλήσεις, πριν την 1.20):
 * η τελευταία κλήση, όπως πριν.
 */
function addCalls(l, add, word) {
  var calls = l.calls || [];
  if (!calls.length) { add(l.called, word, l.status === ST.NO_ANSWER ? 'Δεν απάντησε' : ''); return; }
  calls.forEach(function (c) {
    add(c.ts, c.result === 'Δεν απάντησε' ? 'Κλήση · δεν απάντησε' : 'Κλήση' + (c.result ? ' · ' + c.result.toLowerCase() : ''), '', 'call', c);
  });
}

function histHtml(ev, canEdit) {
  var now = Date.now();
  return ev.map(function (e) {
    var future = e.d.getTime() > now;
    var when = niceDate(pad(e.d.getDate()) + '/' + pad(e.d.getMonth() + 1) + '/' + e.d.getFullYear() + ' ' + hhmm(e.d));
    var c = e.call;
    return '<li class="tl' + (future ? ' future' : '') + (e.tone ? ' ' + e.tone : '') + '"><i aria-hidden="true"></i>' +
      '<b>' + esc(e.title) + '</b><span>' + esc(when + (future ? ' · προγραμματισμένο' : '') + (e.sub ? ' · ' + e.sub : '')) + '</span>' +
      (c && c.note ? '<p class="tl-note">' + esc(c.note) + '</p>' : '') +
      (c && canEdit ? '<button class="link tl-add" data-cn="' + esc(c.id) + '">' + (c.note ? 'Αλλαγή σημείωσης' : '＋ Σημείωση για την κλήση') + '</button>' : '') +
      '</li>';
  }).join('') || '<li class="tl"><i></i><b>Χωρίς ιστορικό</b></li>';
}

/** Το SMS ανοίγει σε φύλλο από κάτω. kind: intro · reminder · cancel. */
function openSmsBox(kind, preview) {
  if (!S.lead || !S.lead.phoneIntl) return;
  if (kind) S.smsKind = kind;
  prepareSms(S.lead);
  $('smsbox').querySelector('.sms-preview').open = !!preview;
  openPop('smsbox');
}

function fact(wrapId, valId, value) {
  $(wrapId).hidden = !value;
  if (value) $(valId).textContent = value;
}

function merge(fresh) {
  for (var i = 0; i < S.leads.length; i++) {
    if (S.leads[i].id === fresh.id) { S.leads[i] = fresh; return; }
  }
  S.leads.unshift(fresh);
}

/**
 * «Κλήση»: ανοίγει το τηλέφωνο και ταυτόχρονα γράφει Απαντημένη (sendBeacon,
 * οπότε φτάνει ακόμα κι αν η σελίδα πάει στο παρασκήνιο). Αν τελικά δεν
 * σήκωσε, πατάς «Δεν απάντησε» όταν γυρίσεις.
 */
function onTelClick(e) {
  var l = S.lead;
  if (!l || !l.phoneIntl) { e.preventDefault(); return; }

  l.called = nowStamp();
  if (isOpen(l)) {
    l.status = ST.ANSWERED;
    l.followUp = '';
  }
  // 1.20: κάθε κλήση με δικό της κλειδί· όταν γυρίσεις, γράφεις σημείωση για ΑΥΤΗ την κλήση.
  var cid = callId();
  var at = Date.now();
  l.calls = (l.calls || []).concat([{ id: cid, at: l.called, ts: at, result: '', note: '' }]);
  S.pendingCall = { lead: l.id, cid: cid, at: at, name: l.name || '' };
  store('kw_call', JSON.stringify(S.pendingCall));
  beacon('called', { id: l.id, cid: cid });
  // Το κουμπί μπορεί να είναι μέσα στην κάρτα «Επόμενο βήμα», που ξαναζωγραφίζεται.
  // Αν σβηστεί πριν ανοίξει το τηλέφωνο, ο browser ακυρώνει την κλήση: περιμένουμε λίγο.
  setTimeout(function () { if (S.lead === l) { fillDetail(l); showProfileTab(); } }, 350);   // 2.1: όταν γυρίσεις, είσαι στο Προφίλ
}

function onNoAnswer() {
  var btn = $('btn-noanswer-row');
  btn.disabled = true;
  applyStatus(ST.NO_ANSWER)
    .catch(function () { /* το μήνυμα το έδειξε η applyStatus */ })
    .then(function () { btn.disabled = false; });
}

function applyStatus(value) {
  var sel = $('d-status-select');
  var previous = S.lead.status;
  sel.value = value;
  sel.disabled = true;

  return send('status', { id: S.lead.id, status: value }).then(function (r) {
    var l = r.data;
    merge(l);
    if (S.lead && S.lead.id === l.id) fillDetail(l);
    sel.disabled = false;

    if (r.queued) toast(value === ST.NO_ANSWER ? 'Δεν απάντησε · το follow-up θα μπει στο ημερολόγιο μόλις έρθει σήμα' : 'Κατάσταση: ' + value + ' · θα σταλεί μόλις έρθει σήμα');
    else if (l.warning) toast(l.warning, true);
    else if (value === ST.NO_ANSWER && l.followUp) {
      toast('Follow-up ' + l.followUp + (l.invited ? ' · ήρθε ως πρόσκληση' : ''));
    }
    else toast('Κατάσταση: ' + value);
  }).catch(function (e) {
    sel.disabled = false;
    sel.value = previous;
    toast(e.message, true);
    throw e;
  });
}

function onNoteInput() {
  clearTimeout(S.noteTimer);
  var hint = $('save-hint');
  hint.className = 'save-hint';
  hint.textContent = 'Αποθήκευση…';

  var id = S.lead.id, text = $('d-notes').value;

  S.noteTimer = setTimeout(function () {
    send('note', { id: id, text: text }).then(function (r) {
      hint.textContent = r.queued ? 'Αποθηκεύτηκε στο κινητό · θα σταλεί μόλις έρθει σήμα' : 'Αποθηκεύτηκε';
      var l = findLead(id);
      if (l) l.notes = text;
    }).catch(function (e) {
      hint.className = 'save-hint err';
      hint.textContent = 'Δεν αποθηκεύτηκε: ' + e.message;
    });
  }, 1200);
}

// ─────────────────────────────────────────────────────────────
//  ΕΤΟΙΜΟ SMS
// ─────────────────────────────────────────────────────────────

var SMS_KINDS = {
  intro:    { label: 'Πρώτη επαφή', button: 'Άνοιγμα SMS με έτοιμο μήνυμα' },
  reminder: { label: 'Υπενθύμιση',  button: 'Άνοιγμα SMS υπενθύμισης' },
  cancel:   { label: 'Ακύρωση',     button: 'Άνοιγμα SMS ακύρωσης' }
};

/** Ποια SMS έχουν νόημα για αυτή την κλήση τώρα. */
function smsKinds(l) {
  var k = ['intro'];
  if (upcoming(l)) k.push('reminder');
  if (S.cancelled && S.cancelled.id === l.id) k.push('cancel');
  return k;
}

/**
 * Το SMS από το μήνυμα του μεσίτη (⚙ → Μηνύματα SMS) ή την προεπιλογή.
 * Στα αγγλικά, ονόματα και διευθύνσεις γράφονται με λατινικούς.
 */
function buildSmsText(l, me, lang, kind) {
  return renderTpl(templateOf(kind, lang), smsVars(l, me, lang, kind));
}

function templateOf(kind, lang) {
  var mine = ((S.me.prefs || {}).templates || {})[kind] || {};
  return mine[lang] || S.boot.defaults.templates[kind][lang];
}

function smsVars(l, me, lang, kind) {
  var en = lang === 'en';
  var L = function (x) { return en ? latin(x) : x; };
  var when = kind === 'cancel' ? (S.cancelled || {}) : { date: l.showingDate, time: l.showingTime };
  return {
    'πελάτης':    L(String(l.name || '').trim().split(/\s+/)[0]),
    'κωδικός':    l.code || '',
    'διεύθυνση':  L(l.address || ''),
    'ημέρα':      when.date ? dayWord(when.date, lang) : '',
    'ώρα':        when.time || '',
    'όνομά μου':  L(me.smsName || me.name || ''),
    'κινητό μου': me.phone || '',
    'γραφείο':    L((S.boot.office && S.boot.office.name) || ''),
    'link':       me.link || ''
  };
}

/**
 * {στοιχείο} → τιμή. [ … ] → σβήνεται ολόκληρο αν κάποιο στοιχείο μέσα του
 * είναι κενό. Ίδια λογική με το renderTpl_() του Code.gs.
 */
function renderTpl(tpl, vars) {
  var val = function (k) { return String(vars[k] == null ? '' : vars[k]).trim(); };
  return String(tpl || '')
    .replace(/\[([^\[\]]*)\]/g, function (m, inner) {
      var keys = (inner.match(/\{([^{}]+)\}/g) || []).map(function (x) { return x.slice(1, -1); });
      return keys.some(function (k) { return !val(k); }) ? '' : inner;
    })
    .replace(/\{([^{}]+)\}/g, function (m, k) { return val(k); })
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;!?])/g, '$1')
    .replace(/([,.])\1+/g, '$1')
    .trim();
}

/** «σήμερα» / «αύριο» / «την 05/11». Ελληνικά ή αγγλικά. */
function dayWord(iso, lang) {
  var d = new Date(), t = new Date(Date.now() + 86400000);
  var short = iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  if (iso === isoDate(d)) return lang === 'en' ? 'today' : 'σήμερα';
  if (iso === isoDate(t)) return lang === 'en' ? 'tomorrow' : 'αύριο';
  return lang === 'en' ? 'on ' + short : 'την ' + short;
}

function isoDate(x) { return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); }

/** iOS θέλει & για την πρώτη παράμετρο, Android ?. Λάθος = άδειο κείμενο, σιωπηλά. */
function smsHref(phoneIntl, text) {
  if (!phoneIntl) return '';
  var sep = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
  return 'sms:' + phoneIntl + sep + 'body=' + encodeURIComponent(text);
}

/** Τα ελληνικά στέλνονται σε UCS-2: 70 χαρακτήρες το SMS αντί για 160. */
function countSms(text) {
  var unicode = /[^\u0000-\u007F]/.test(text);
  var len = text.length;
  if (unicode) return { chars: len, parts: len <= 70 ? 1 : Math.ceil(len / 67) };
  return { chars: len, parts: len <= 160 ? 1 : Math.ceil(len / 153) };
}

function prepareSms(l) {
  var link = $('sms-link');

  if (!l.phoneIntl) {
    link.removeAttribute('href');
    link.classList.add('muted');
    label(link, 'sms', 'Χωρίς τηλέφωνο δεν ετοιμάζεται SMS');
    $('sms-text').value = '';
    $('sms-count').textContent = '';
    return;
  }

  var kinds = smsKinds(l);
  if (kinds.indexOf(S.smsKind) === -1) S.smsKind = 'intro';

  var chips = $('sms-kinds');
  chips.hidden = kinds.length < 2;
  chips.innerHTML = kinds.map(function (k) {
    return '<button class="chip' + (k === S.smsKind ? ' is-on' : '') + '" data-kind="' + k + '" role="tab">' +
      SMS_KINDS[k].label + '</button>';
  }).join('');
  chips.querySelectorAll('.chip').forEach(function (c) {
    c.onclick = function () {
      S.smsKind = c.dataset.kind;
      $('sms-text').blur();
      prepareSms(S.lead);
    };
  });

  link.classList.remove('muted');
  label(link, 'sms', S.smsKind === 'intro' && l.sms ? 'Άνοιγμα SMS ξανά' : SMS_KINDS[S.smsKind].button);
  if (document.activeElement !== $('sms-text')) {
    $('sms-text').value = buildSmsText(l, S.me, S.smsLang, S.smsKind);
  }
  updateLangBtn();
  refreshSmsHref();
}

function refreshSmsHref() {
  var text = $('sms-text').value;
  var href = smsHref(S.lead && S.lead.phoneIntl, text);
  var link = $('sms-link');

  if (href) link.href = href; else link.removeAttribute('href');

  var c = countSms(text);
  var el = $('sms-count');
  el.textContent = c.chars + ' χαρ. · ' + c.parts + ' SMS';
  el.classList.toggle('over', c.parts > 1);
}

function onLang() {
  if (!S.lead) return;
  S.smsLang = S.smsLang === 'en' ? 'el' : 'en';
  $('sms-text').value = buildSmsText(S.lead, S.me, S.smsLang, S.smsKind);
  updateLangBtn();
  refreshSmsHref();
}

function updateLangBtn() {
  $('btn-lang').textContent = S.smsLang === 'en' ? 'Στα ελληνικά' : 'In English';
}

function onOpenSms() {
  if (!S.lead || !$('sms-link').getAttribute('href')) return;
  if (S.smsKind === 'reminder') S.lead.smsRemind = nowStamp();
  else S.lead.sms = nowStamp();
  beacon('sms', { id: S.lead.id, kind: S.smsKind });
  setTimeout(function () { closePop('smsbox'); if (S.lead) fillDetail(S.lead); }, 300);
}

function onCopy() {
  var text = $('sms-text').value;
  var done = function () { toast('Αντιγράφηκε'); };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { copyFallback(text, done); });
  } else {
    copyFallback(text, done);
  }
}

function copyFallback(text, done) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch (e) {
    toast('Δεν έγινε αντιγραφή. Κράτα πατημένο το κείμενο.', true);
  }
  document.body.removeChild(ta);
}

var LATIN = {
  'α':'a','β':'v','γ':'g','δ':'d','ε':'e','ζ':'z','η':'i','θ':'th','ι':'i','κ':'k',
  'λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p','ρ':'r','σ':'s','ς':'s','τ':'t',
  'υ':'y','φ':'f','χ':'ch','ψ':'ps','ω':'o','ά':'a','έ':'e','ή':'i','ί':'i','ό':'o',
  'ύ':'y','ώ':'o','ϊ':'i','ϋ':'y','ΐ':'i','ΰ':'y'
};

/** Ελληνικά σε λατινικούς (Μαρία → Maria), για το αγγλικό SMS. */
function latin(s) {
  var chars = String(s || '').split('');
  return chars.map(function (ch, i) {
    var low = ch.toLowerCase();
    var m = LATIN[low];
    if (!m) return ch;
    if (ch === low) return m;
    var nb = chars[i + 1] || chars[i - 1] || '';
    var allCaps = nb && nb !== nb.toLowerCase();
    return allCaps ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1);
  }).join('');
}

// ─────────────────────────────────────────────────────────────
//  ΥΠΟΔΕΙΞΗ (νέα ή αλλαγή)
// ─────────────────────────────────────────────────────────────

function openShowingForm() {
  var l = S.lead;
  var edit = hasShowing(l);
  var cal = S.me.calendar || {};

  var done = edit && l.showingTs <= Date.now();
  $('s-title').textContent = done ? 'Υπόδειξη ' + l.showingAt : edit ? 'Αλλαγή υπόδειξης' : 'Νέα υπόδειξη';
  $('s-outcome').hidden = !done;
  if (done) {
    S.outcome = l.outcome || '';
    $('s-outcome-note').value = l.outcomeNote || '';
    $('s-outcome-hint').textContent = '';
    renderOutcomes();
  }
  $('s-name').textContent = l.name || 'Χωρίς όνομα';
  $('s-prop').textContent = l.property + (l.code ? ' · ' + l.code : '');
  $('s-hint').textContent = '';
  $('s-hint').className = 'save-hint';

  if (edit) {
    $('s-date').value = l.showingDate;
    $('s-time').value = l.showingTime;
  } else {
    var t = new Date(Date.now() + 86400000);
    $('s-date').value = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    $('s-time').value = '12:00';
  }

  $('s-addr').value = l.address || '';
  $('s-addr-note').textContent = l.address
    ? 'Από το φύλλο «Διαθέσιμα ακίνητα». Άλλαξέ τη αν χρειάζεται.'
    : 'Δεν βρέθηκε διεύθυνση για αυτό το ακίνητο. Συμπλήρωσέ τη.';

  var where = cal.shared ? 'στο ημερολόγιό σου' : 'ως πρόσκληση στο ημερολόγιό σου';
  $('s-note').textContent = (edit
      ? 'Μετακινείται το ίδιο event ' + where + '.'
      : 'Μπαίνει ' + where + ' με τα στοιχεία του πελάτη.') +
    (l.email ? ' Ο πελάτης παίρνει email υπενθύμισης τρεις ώρες πριν.'
             : ' Ο πελάτης δεν έχει email, οπότε δεν θα πάρει υπενθύμιση.');

  $('btn-save-showing').textContent = edit ? 'Αποθήκευση αλλαγών' : 'Καταχώρηση υπόδειξης';
  $('s-form').hidden = !edit;
  if (edit) loadShowingForm(l);
  resetCancelBtn();
  $('btn-cancel-showing').hidden = !edit;
  openSheet('showing');
}

// ─────────────────────────────────────────────────────────────
//  ΕΝΤΥΠΟ ΥΠΟΔΕΙΞΗΣ (1.14)
//  Ο μεσίτης ετοιμάζει link μίας χρήσης, ο πελάτης συμπληρώνει και υπογράφει.
//  Η εφαρμογή ΔΕΝ βλέπει ποτέ τα στοιχεία του πελάτη: μόνο την κατάσταση και το PDF.
//  Το link υπάρχει μόνο στη μνήμη (S.sfLink), για όσο είναι ανοιχτή η υπόδειξη.
// ─────────────────────────────────────────────────────────────

var SF_DONE = { 'Υπογράφηκε': 1, 'Για εκτύπωση': 1 };

function loadShowingForm(l) {
  var id = l.id;
  if (!S.sfLink || S.sfLink.id !== id) S.sfLink = null;
  $('sf-body').innerHTML = '<p class="cal-status muted">Φόρτωση…</p>';
  api('formStatus', { id: id }).then(function (st) {
    if (S.lead && S.lead.id === id) renderShowingForm(st);
  }).catch(function (e) {
    $('sf-body').innerHTML = '<p class="save-hint err">' + esc(e.message) + '</p>';
  });
}

function sfFact(label, value) {
  return value ? '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
}

function renderShowingForm(st) {
  S.sfState = st;
  var el = $('sf-body'), l = S.lead, link = S.sfLink;
  var status = st.status;

  if (!st.ready && !SF_DONE[status]) {
    el.innerHTML = '<p class="note">Το έντυπο δεν έχει ρυθμιστεί ακόμα. Χρειάζεται το πρότυπο στο Apps Script (README, 1.14).</p>';
    return;
  }

  // Υποβλήθηκε: PDF
  if (SF_DONE[status]) {
    var signed = status === 'Υπογράφηκε';
    el.innerHTML = '<div class="sf-box ok"><p class="sf-state"><span class="tag showing">' + esc(status) + '</span><b>Α/Α ' + esc(st.aa) + '</b></p>' +
      '<p class="cal-status muted">' + esc((signed ? 'Υπογράφηκε στην οθόνη ' : 'Συμπληρώθηκε, για υπογραφή σε χαρτί · ') + st.submitted) + '</p>' +
      '<a class="btn primary wide" href="' + esc(st.fileUrl) + '" target="_blank" rel="noopener">' + ico('out') +
        (signed ? 'Άνοιγμα PDF' : 'Άνοιγμα PDF για εκτύπωση') + '</a>' +
      '<button class="link" id="sf-new">Νέο έντυπο για τον ίδιο πελάτη</button></div>';
    $('sf-new').onclick = function () {
      ask('Νέο έντυπο;', 'Το προηγούμενο PDF μένει στον φάκελο του ακινήτου. Θα φτιαχτεί νέο link για τον πελάτη.', 'Ναι, νέο έντυπο')
        .then(function (yes) { if (yes) { st.status = ''; renderShowingForm(st); } });
    };
    return;
  }

  // Link έτοιμο σε αυτή τη συσκευή: αποστολή
  if (link && status === 'Στάλθηκε') {
    var phone = l.phoneIntl || '';
    el.innerHTML = '<div class="sf-box wait"><p class="sf-state"><span class="tag noanswer">Περιμένει τον πελάτη</span>' +
        '<span>λήγει ' + esc(st.expires) + '</span></p>' +
      '<p class="cal-status muted">Στείλε το link στον πελάτη, ή δώσε του το κινητό σου να το συμπληρώσει τώρα.</p>' +
      '<div class="sf-actions">' +
        (phone ? '<a class="btn primary" id="sf-sms" href="' + esc(smsHref(phone, link.sms)) + '">' + ico('sms') + 'SMS</a>' : '') +
        (link.email.to ? '<a class="btn' + (phone ? '' : ' primary') + '" href="mailto:' + esc(link.email.to) + '?subject=' +
          encodeURIComponent(link.email.subject) + '&body=' + encodeURIComponent(link.email.body) + '">' + ico('mail') + 'Email</a>' : '') +
        '<button class="btn" id="sf-copy">Αντιγραφή link</button>' +
        '<a class="btn" href="' + esc(link.url) + '" target="_blank" rel="noopener">' + ico('out') + 'Άνοιγμα εδώ</a>' +
      '</div>' +
      '<button class="link" id="sf-cancel">Ακύρωση link</button></div>';
    $('sf-copy').onclick = function () {
      var done = function () { toast('Το link αντιγράφηκε'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link.url).then(done).catch(function () { copyFallback(link.url, done); });
      else copyFallback(link.url, done);
    };
    $('sf-cancel').onclick = onSfCancel;
    return;
  }

  // Στάλθηκε από πριν (το link δεν υπάρχει πια εδώ): κατάσταση, νέο link
  if (status === 'Στάλθηκε') {
    el.innerHTML = '<div class="sf-box wait"><p class="sf-state"><span class="tag noanswer">Στάλθηκε ' + esc(st.created) + '</span></p>' +
      '<p class="cal-status muted">Λήγει ' + esc(st.expires) + (st.opens ? ' · ο πελάτης το άνοιξε ' + st.opens + (st.opens === 1 ? ' φορά' : ' φορές') : ' · δεν έχει ανοιχτεί ακόμα') + '.</p>' +
      '<div class="sf-actions"><button class="btn" id="sf-again">Νέο link</button><button class="btn" id="sf-cancel">Ακύρωση link</button></div></div>';
    $('sf-again').onclick = function () {
      ask('Νέο link;', 'Το παλιό link σταματά να ισχύει. Θα πρέπει να στείλεις το νέο στον πελάτη.', 'Ναι, νέο link')
        .then(function (yes) { if (yes) onSfCreate(st.defects, st.deal); });
    };
    $('sf-cancel').onclick = onSfCancel;
    return;
  }

  // Καμία φόρμα, ή έληξε / ακυρώθηκε: προετοιμασία
  var p = st.prop || {};
  var rent = p.deal === 'Ενοικίαση';
  el.innerHTML = (status === 'Έληξε' || status === 'Ακυρώθηκε'
      ? '<p class="cal-status warn">Το προηγούμενο link ' + (status === 'Έληξε' ? 'έληξε' : 'ακυρώθηκε') + '.</p>' : '') +
    '<p class="cal-status muted">Ο πελάτης παίρνει link, συμπληρώνει τα στοιχεία του και υπογράφει στην οθόνη ή σε χαρτί. Τα στοιχεία του ακινήτου μπαίνουν από το φύλλο.</p>' +
    '<dl class="facts sf-facts">' + sfFact('Κωδικός', p.code) + sfFact('Διεύθυνση', p.address) + sfFact('Είδος', p.type) +
      sfFact('Τ.μ.', p.sqm) + sfFact(rent ? 'Μίσθωμα' : 'Τιμή', fmtPrice(p.price)) + '</dl>' +
    (p.deal ? '' : '<label class="field"><span>Συναλλαγή</span><select id="sf-deal"><option value="">Διάλεξε…</option>' +
      '<option>Πώληση</option><option>Ενοικίαση</option></select></label>') +
    '<label class="field"><span>Πραγματικά ελαττώματα (όρος 3)</span>' +
      '<textarea id="sf-defects" rows="3" maxlength="600" placeholder="Άφησέ το κενό αν δεν έχει. Θα γραφτεί «Κανένα».">' + esc(st.defects || '') + '</textarea></label>' +
    '<button class="btn primary wide" id="sf-create">Ετοίμασε φόρμα για τον πελάτη</button>' +
    '<p class="save-hint" id="sf-hint"></p>';
  $('sf-create').onclick = function () {
    var deal = $('sf-deal') ? $('sf-deal').value : '';
    if ($('sf-deal') && !deal) {
      $('sf-hint').className = 'save-hint err';
      $('sf-hint').textContent = 'Διάλεξε αν είναι Πώληση ή Ενοικίαση.';
      return;
    }
    onSfCreate($('sf-defects').value.trim(), deal);
  };
}

function onSfCreate(defects, deal) {
  var id = S.lead.id;
  var b = $('sf-create') || $('sf-again');
  if (b) { b.disabled = true; b.textContent = 'Ετοιμάζεται…'; }
  api('formCreate', { id: id, defects: defects || '', deal: deal || '' }).then(function (res) {
    S.sfLink = { id: id, url: res.url, sms: res.sms, email: res.email };
    var st = res.form;
    st.ready = true;
    st.prop = (S.sfState || {}).prop;
    if (S.lead && S.lead.id === id) renderShowingForm(st);
    toast('Η φόρμα είναι έτοιμη. Στείλε τη στον πελάτη.');
  }).catch(function (e) {
    if (b) { b.disabled = false; b.textContent = 'Ετοίμασε φόρμα για τον πελάτη'; }
    toast(e.message, true);
  });
}

function onSfCancel() {
  ask('Ακύρωση link;', 'Ο πελάτης δεν θα μπορεί πια να συμπληρώσει τη φόρμα από αυτό το link.', 'Ναι, ακύρωση').then(function (yes) {
    if (!yes) return;
    var id = S.lead.id;
    api('formCancel', { id: id }).then(function (st) {
      S.sfLink = null;
      st.ready = true;
      st.prop = (S.sfState || {}).prop;
      if (S.lead && S.lead.id === id) renderShowingForm(st);
      toast('Το link ακυρώθηκε');
    }).catch(function (e) { toast(e.message, true); });
  });
}


// ─────────────────────────────────────────────────────────────
//  ΣΥΣΤΑΣΗ / ΣΥΝΕΡΓΑΣΙΑ (1.15)
//  Ο μεσίτης συμπληρώνει, υπογράφει στην οθόνη, και ο server φτιάχνει το PDF
//  και το στέλνει με email. Τα γραφεία έρχονται από το φύλλο «Συνεργάτες KW».
// ─────────────────────────────────────────────────────────────

var RF_NOTE = {
  systasi: 'Συστήνεις πελάτη σε άλλο γραφείο. Αμοιβή του γραφείου μας: 25% επί της προμήθειας του πελάτη.',
  synergasia: 'Δουλεύετε μαζί τη συναλλαγή. Στο έντυπο το τηλέφωνο και το email του πελάτη φαίνονται κρυμμένα, π.χ. 694xxxx567 και nixxxx@gmail.com.'
};

/** Υπογραφή με το δάχτυλο σε καμβά. Ίδια λογική με τη φόρμα του πελάτη. */
function makePad(canvas, hint) {
  var ctx = canvas.getContext('2d'), drawing = false, last = null, ink = 0, strokes = [];
  function draw(st) {
    ctx.beginPath();
    st.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    if (st.length === 1) ctx.lineTo(st[0].x + 0.1, st[0].y);
    ctx.stroke();
  }
  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    var k = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * k); canvas.height = Math.round(r.height * k);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10204a';
    strokes.forEach(draw);
  }
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    drawing = true; last = pos(e); strokes.push([last]); hint.hidden = true;
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var p = pos(e);
    ink += Math.hypot(p.x - last.x, p.y - last.y);
    strokes[strokes.length - 1].push(p);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { drawing = false; }); });
  window.addEventListener('resize', resize);
  return {
    resize: resize,
    clear: function () { strokes = []; ink = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); hint.hidden = false; },
    ok: function () { return ink > 120; },
    png: function () {
      var out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      var o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    }
  };
}

function chipPick(id, value) {
  $(id).querySelectorAll('.chip').forEach(function (c) {
    var on = c.dataset.v === value;
    c.classList.toggle('is-on', on);
    c.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function chipValue(id) {
  var on = $(id).querySelector('.chip.is-on');
  return on ? on.dataset.v : '';
}

function wireReferral() {
  S.rfPad = makePad($('rf-pad'), $('rf-pad-hint'));
  $('rf-pad-clear').onclick = function () { S.rfPad.clear(); };
  $('rf-kind').querySelectorAll('[data-kind]').forEach(function (b) {
    b.onclick = function () { setReferralKind(b.dataset.kind); };
  });
  ['rf-interest', 'rf-prev'].forEach(function (id) {
    $(id).querySelectorAll('.chip').forEach(function (c) {
      c.setAttribute('role', 'radio');
      c.onclick = function () {
        chipPick(id, c.dataset.v === chipValue(id) && id === 'rf-prev' ? '' : c.dataset.v);
        if (id === 'rf-interest') $('rf-interest-other-wrap').hidden = chipValue(id) !== 'Άλλο';
      };
    });
  });
  $('rf-type').onchange = function () { $('rf-type-other-wrap').hidden = this.value !== 'Άλλο'; };
  $('rf-office').onchange = fillReferralPartners;
  $('rf-partner').onchange = showReferralPartner;
  $('rf-c-phone').oninput = maskNote;
  $('rf-c-email').oninput = maskNote;
  $('rf-c-name').oninput = function () { if (this.value.trim()) this.classList.remove('is-bad'); };
  $('btn-send-referral').onclick = onSendReferral;
}

function setReferralKind(kind) {
  S.rfKind = kind;
  $('rf-kind').querySelectorAll('[data-kind]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.kind === kind); });
  $('rf-kind-note').textContent = RF_NOTE[kind];
  $('rf-prev-wrap').hidden = kind !== 'systasi';
  $('btn-send-referral').textContent = (kind === 'systasi' ? 'Δημιουργία σύστασης' : 'Δημιουργία συνεργασίας') + ' και αποστολή';
  maskNote();
}

/** Στη Συνεργασία: προεπισκόπηση του κρυμμένου τηλεφώνου και email (ίδιος κανόνας με τον server). */
function maskNote() {
  var co = S.rfKind === 'synergasia';
  var d = $('rf-c-phone').value.replace(/\D/g, '');
  var m = $('rf-c-email').value.trim().match(/^([^@]+)@(.+)$/);
  $('rf-mask-note').textContent = co && d.length >= 7
    ? 'Στο έντυπο: ' + d.slice(0, 3) + new Array(d.length - 5).join('x') + d.slice(-3) : '';
  $('rf-mask-mail').textContent = co && m
    ? 'Στο έντυπο: ' + m[1].slice(0, Math.min(2, m[1].length - 1)) + 'xxxx@' + m[2] : '';
}

function openReferral(lead) {
  // Νέα φόρμα κάθε φορά. Από κλήση: τα στοιχεία του πελάτη και η περιοχή μπαίνουν από πριν.
  $('referral').querySelectorAll('input, textarea').forEach(function (el) { el.value = ''; el.classList.remove('is-bad'); });
  $('referral').querySelectorAll('select').forEach(function (el) { if (el.id !== 'rf-office' && el.id !== 'rf-partner') el.value = ''; });
  chipPick('rf-interest', ''); chipPick('rf-prev', '');
  $('rf-interest-other-wrap').hidden = true; $('rf-type-other-wrap').hidden = true;
  $('rf-hint').textContent = ''; $('rf-hint').className = 'save-hint'; $('rf-done').innerHTML = '';
  $('btn-send-referral').disabled = false;
  $('btn-send-referral').hidden = false;
  S.rfLead = lead ? lead.id : '';
  if (lead) {
    $('rf-c-name').value = lead.name || '';
    $('rf-c-phone').value = lead.phone || '';
    $('rf-c-email').value = lead.email || '';
    $('rf-area').value = lead.location || '';
  }
  setReferralKind(S.rfKind || 'systasi');
  var me = S.me || {};
  $('rf-me').innerHTML = esc(me.smsName || me.name || '') + (me.phone ? ' · ' + esc(me.phone)
    : ' · <b class="warn-text">λείπει το κινητό σου</b> <button class="link" id="rf-go-settings">Συμπλήρωσέ το</button>');
  if ($('rf-go-settings')) $('rf-go-settings').onclick = function () { closeSheet('referral'); openSettings(); };
  openSheet('referral');
  $('referral').querySelector('.sheet-body').scrollTop = 0;
  setTimeout(function () { S.rfPad.resize(); S.rfPad.clear(); }, 300);
  loadKwPartners();
}

function loadKwPartners() {
  if (S.kwp) { fillReferralOffices(); return; }
  api('kwPartners').then(function (res) {
    S.kwp = res;
    fillReferralOffices();
  }).catch(function (e) {
    $('rf-office').innerHTML = '<option value="">Δεν φορτώθηκαν</option>';
    $('rf-hint').className = 'save-hint err';
    $('rf-hint').textContent = e.message;
  });
}

function fillReferralOffices() {
  var cur = $('rf-office').value;
  $('rf-office').innerHTML = '<option value="">Διάλεξε γραφείο…</option>' + S.kwp.offices.map(function (o) {
    return '<option value="' + esc(o.name) + '">' + esc(o.name) + ' (' + o.people.length + ')</option>';
  }).join('');
  $('rf-office').value = cur;
  fillReferralPartners();
}

function referralOffice() {
  var v = $('rf-office').value;
  return (S.kwp ? S.kwp.offices : []).filter(function (o) { return o.name === v; })[0] || null;
}

/** Μόνο οι συνεργάτες του γραφείου που διάλεξε. */
function fillReferralPartners() {
  var o = referralOffice(), sel = $('rf-partner');
  sel.disabled = !o;
  sel.innerHTML = o ? '<option value="">Διάλεξε συνεργάτη…</option>' + o.people.map(function (p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.team ? ' · ' + esc(p.team) : '') + '</option>';
  }).join('') : '<option value="">Διάλεξε πρώτα γραφείο</option>';
  if (o && o.people.length === 1) sel.value = o.people[0].id;
  showReferralPartner();
}

function referralPartner() {
  var o = referralOffice(), id = $('rf-partner').value;
  return o ? o.people.filter(function (p) { return p.id === id; })[0] || null : null;
}

function showReferralPartner() {
  var p = referralPartner();
  $('rf-partner-info').textContent = p ? [p.phone, p.email, [p.area, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : '';
}

function onSendReferral() {
  var hint = $('rf-hint'), btn = $('btn-send-referral');
  var bad = function (msg, el) {
    hint.className = 'save-hint err'; hint.textContent = msg;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  var interest = chipValue('rf-interest');
  if (!interest) return bad('Διάλεξε για τι ενδιαφέρεται ο πελάτης.', $('rf-interest'));
  if (!referralPartner()) return bad('Διάλεξε γραφείο και συνεργάτη.', $('rf-office'));
  if (!$('rf-c-name').value.trim()) {
    $('rf-c-name').classList.add('is-bad');
    return bad('Το ονοματεπώνυμο του πελάτη είναι υποχρεωτικό.', $('rf-c-name'));
  }
  if (!S.me.phone) return bad('Συμπλήρωσε πρώτα το κινητό σου στις Ρυθμίσεις.', $('rf-me'));
  if (!S.rfPad.ok()) return bad('Υπόγραψε στο πλαίσιο.', $('rf-pad-box'));

  var type = $('rf-type').value;
  var data = {
    kind: S.rfKind, interest: interest, interestOther: $('rf-interest-other').value.trim(), prevCall: chipValue('rf-prev'),
    office: $('rf-office').value, partnerId: $('rf-partner').value, mandate: $('rf-mandate').value, leadId: S.rfLead,
    client: { name: $('rf-c-name').value.trim(), phone: $('rf-c-phone').value.trim(), email: $('rf-c-email').value.trim() },
    prop: {
      deal: $('rf-deal').value, price: $('rf-price').value, down: $('rf-down').value, loan: $('rf-loan').value,
      settle: $('rf-settle').value, area: $('rf-area').value, age: $('rf-age').value, sqm: $('rf-sqm').value,
      type: /^Οικόπεδο/.test(type) ? 'Οικόπεδο' : type, typeOther: $('rf-type-other').value,
      rooms: $('rf-rooms').value, baths: $('rf-baths').value, basement: $('rf-basement').value, parking: $('rf-parking').value,
      living: $('rf-living').value, dining: $('rf-dining').value, balconies: $('rf-balconies').value,
      heating: $('rf-heating').value, other: $('rf-other').value
    },
    sig: S.rfPad.png()
  };
  btn.disabled = true;
  btn.textContent = 'Δημιουργία…';
  hint.className = 'save-hint'; hint.textContent = 'Φτιάχνεται το PDF. Παίρνει λίγα δευτερόλεπτα.';
  api('referral', data).then(function (res) {
    hint.textContent = '';
    btn.hidden = true;
    $('rf-done').innerHTML = '<div class="rf-done"><p class="sf-state"><span class="tag showing">Στάλθηκε</span><b>' + esc(res.kind + ' ' + res.aa) + '</b></p>' +
      '<p class="cal-status muted">Το PDF στάλθηκε στο ' + esc(res.sentTo) + ' και κρατήθηκε στον φάκελό σου.</p>' +
      '<a class="btn primary wide" href="' + esc(res.fileUrl) + '" target="_blank" rel="noopener">' + ico('out') + 'Άνοιγμα PDF</a>' +
      '<button class="link" id="rf-again">Νέο έντυπο</button></div>';
    $('rf-again').onclick = function () { openReferral(null); };
    S.refs = null;
    if (S.view === 'referrals') loadReferrals(true);
    toast(res.kind + ' ' + res.aa + ' στάλθηκε');
  }).catch(function (e) {
    btn.disabled = false;
    setReferralKind(S.rfKind);
    bad(e.message);
  });
}


// ── Αποτέλεσμα υπόδειξης ──────────────────────────────────

function renderOutcomes() {
  var el = $('s-outcome-list');
  el.innerHTML = (S.boot.outcomes || []).map(function (o) {
    return '<button class="' + (o === S.outcome ? 'is-on' : '') + '" data-o="' + esc(o) + '" aria-pressed="' +
      (o === S.outcome ? 'true' : 'false') + '">' + esc(o) + '</button>';
  }).join('');
  el.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { S.outcome = b.dataset.o; renderOutcomes(); };
  });
}

function onSaveOutcome() {
  var hint = $('s-outcome-hint'), btn = $('btn-save-outcome');
  hint.className = 'save-hint';
  if (!S.outcome) {
    hint.className = 'save-hint err';
    hint.textContent = 'Διάλεξε πώς πήγε η υπόδειξη.';
    return;
  }
  btn.disabled = true;
  send('outcome', { id: S.lead.id, outcome: S.outcome, note: $('s-outcome-note').value.trim() }).then(function (r) {
    var l = r.data;
    merge(l);
    fillDetail(l);
    closeSheet('showing');
    render();
    toast('Καταχωρήθηκε: ' + l.outcome + (r.queued ? ' · θα σταλεί μόλις έρθει σήμα' : ''));
  }).catch(function (e) {
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  }).then(function () { btn.disabled = false; });
}

/**
 * 2.3 · FEAT-3 · Αποτέλεσμα υπόδειξης κατευθείαν από το κουμπί της ειδοποίησης.
 * act 'o0' = 1η επιλογή των OUTCOMES. Δουλεύει και χωρίς σήμα (μπαίνει στην ουρά).
 * Ανοίγει μετά την κλήση, ώστε να προσθέσει σημείωση αν θέλει.
 */
function quickOutcome(id, act) {
  var outcomes = (S.boot && S.boot.outcomes) || [];
  var outcome = outcomes[Number(String(act).slice(1))];
  var l = findLead(id);
  if (!outcome || !l) return openLead(id, { outcome: true });            // άγνωστο → η κανονική φόρμα
  if (l.outcome === outcome) { showLead(l, {}); return toast('Ήταν ήδη καταχωρημένο: ' + outcome); }
  send('outcome', { id: l.id, outcome: outcome, note: '' }).then(function (r) {
    var x = r.data || l;
    merge(x);
    render();
    showLead(findLead(id) || x, {});
    toast('Καταχωρήθηκε: ' + outcome + (r.queued ? ' · θα σταλεί μόλις έρθει σήμα' : '') + ' · γράψε σημείωση αν θες');
  }).catch(function (e) {
    toast(e.message, true);
    openLead(id, { outcome: true });                                   // αποτυχία → η κανονική φόρμα
  });
}

// ── Ακύρωση υπόδειξης ─────────────────────────────────────

function resetCancelBtn() {
  var b = $('btn-cancel-showing');
  b.disabled = false;
  b.textContent = 'Ακύρωση υπόδειξης';
}

function onCancelShowing() {
  var l = S.lead;
  ask('Να ακυρωθεί η υπόδειξη;',
      (l.showingAt ? l.showingAt + '. ' : '') + 'Θα σβηστεί από το ημερολόγιο και θα ετοιμαστεί SMS ακύρωσης για τον πελάτη.',
      'Ναι, ακύρωση υπόδειξης').then(function (yes) {
    if (yes) doCancelShowing();
  });
}

function doCancelShowing() {
  var b = $('btn-cancel-showing');
  b.disabled = true;
  b.textContent = 'Ακύρωση…';
  var id = S.lead.id;

  send('cancelShowing', { id: id }).then(function (rr) {
    var res = rr.data;
    if (rr.queued) res.queued = true;
    merge(res.lead);
    S.cancelled = { id: id, date: res.date, time: res.time };
    closeSheet('showing');
    resetCancelBtn();

    S.smsKind = res.lead.phoneIntl && res.date ? 'cancel' : 'intro';
    fillDetail(res.lead);
    setTab('tabs-detail', 'hist');
    showPane('detail-panes', 'hist');
    $('detail').querySelector('.sheet-body').scrollTop = 0;
    if (S.smsKind === 'cancel') openSmsBox('cancel', true);

    toast('Η υπόδειξη ακυρώθηκε' + (res.queued ? ' · θα σβηστεί από το ημερολόγιο μόλις έρθει σήμα' : res.eventDeleted ? ' και σβήστηκε από το ημερολόγιο' : '') +
          (S.smsKind === 'cancel' ? '. Το SMS ακύρωσης είναι έτοιμο.' : '.'));
  }).catch(function (e) {
    resetCancelBtn();
    $('s-hint').className = 'save-hint err';
    $('s-hint').textContent = e.message;
  });
}

function onSaveShowing() {
  var btn = $('btn-save-showing');
  var hint = $('s-hint');
  var label = btn.textContent;

  if (!$('s-date').value || !$('s-time').value) {
    hint.className = 'save-hint err';
    hint.textContent = 'Συμπλήρωσε ημερομηνία και ώρα.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Αποθήκευση…';

  send('showing', {
    id: S.lead.id,
    date: $('s-date').value,
    time: $('s-time').value,
    address: $('s-addr').value.trim()
  }).then(function (rr) {
    var res = rr.data;
    merge(res.lead);
    if (S.cancelled && S.cancelled.id === res.lead.id) S.cancelled = null;
    btn.disabled = false;
    btn.textContent = label;
    closeSheet('showing');
    closeDetail();
    toast((res.updated ? 'Η υπόδειξη άλλαξε: ' : 'Υπόδειξη ') + res.when +
          (rr.queued ? ' · θα μπει στο ημερολόγιο μόλις έρθει σήμα' : res.invited ? ' · ήρθε ως πρόσκληση' : ''));
  }).catch(function (e) {
    btn.disabled = false;
    btn.textContent = label;
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  });
}

// ─────────────────────────────────────────────────────────────
//  ΤΑ ΣΤΟΙΧΕΙΑ ΜΟΥ
// ─────────────────────────────────────────────────────────────

function fillSettings() {
  var me = S.me, cal = me.calendar || {};
  $('p-title').textContent = me.name;
  $('p-name').value = me.smsName || '';
  $('p-phone').value = me.phone || '';
  $('p-link').value = me.link || '';

  var st = $('cal-status');
  if (cal.shared) {
    st.textContent = cal.own ? 'Τα events μπαίνουν στο ημερολόγιό σου.'
                             : 'Το ημερολόγιό σου είναι συνδεδεμένο ✓';
    st.className = 'cal-status ok';
  } else {
    st.textContent = 'Δεν έχει συνδεθεί ακόμα το ημερολόγιό σου.';
    st.className = 'cal-status warn';
  }
  $('cal-howto').hidden = !!cal.shared;
  $('cal-account').textContent = S.boot.appAccount || '';
  renderPush();
  renderColors();
  fillInitials();
  $('p-sub').textContent = [me.phone, S.boot.office && S.boot.office.name].filter(Boolean).join(' · ');
  $('sub-push').textContent = $('push-status').textContent || 'Νέες κλήσεις, υπενθυμίσεις.';
  $('sub-cal').textContent = st.textContent;

  var drive = S.boot.drive || {};
  $('drive-link').hidden = !drive.ready;
  if (drive.url) $('drive-link').href = drive.url;
  $('drive-status').hidden = !!drive.ready;
  $('drive-status').textContent = drive.ready ? '' : 'Ο φάκελος Drive δεν είναι διαθέσιμος ακόμα' + (drive.error ? ': ' + drive.error : '.');

  var sess = S.boot.session || {};
  $('sec-device').textContent = 'Αυτή η συσκευή: ' + (sess.device || '—') +
    (sess.since ? ' · συνδέθηκε ' + sess.since : '') +
    '. Αν χάσεις το κινητό, πες στο γραφείο να την ανακαλέσει.';

  var server = S.boot.version || '1.0';
  var v = $('version');
  v.textContent = 'Εφαρμογή ' + APP_VERSION + ' · Server ' + server +
    (server !== API_VERSION ? ' — δεν ταιριάζουν, ολοκλήρωσε την εγκατάσταση' : '');
  v.className = 'version' + (server !== API_VERSION ? ' warn' : '');
  // 2.3.3: ποια νέα features είναι ανοιχτά σε αυτό το κινητό (για έλεγχο μετά από κάθε εγκατάσταση)
  var FEAT_NAMES = { smartMemory: '«Συχνά:» στο Προφίλ', oneTapPush: 'Κουμπιά ειδοποίησης', swipeRows: 'Σύρσιμο', peekProp: 'Παρατεταμένο πάτημα' };
  var on = Object.keys(S.flags || {}).filter(function (k) { return S.flags[k]; })
    .map(function (k) { return FEAT_NAMES[k] || k; });
  v.textContent += ' · Νέα: ' + (on.length ? on.join(', ') : 'κανένα ανοιχτό');
}

function openSettings() {
  $('p-hint').textContent = '';
  fillSettings();
  settingsMenu();
  openSheet('settings');
}

// 1.16 · Ρυθμίσεις ως λίστα με υποσελίδες. Το «Πίσω» από υποσελίδα γυρίζει στη λίστα.
var SETTINGS_SUB = { me: 'Στοιχεία και γράμματα', push: 'Ειδοποιήσεις', cal: 'Ημερολόγιο', sec: 'Ασφάλεια' };

function settingsMenu() {
  var back = !!S.setSub;
  S.setSub = '';
  $('settings-menu').hidden = false;
  $('settings-panes').hidden = true;
  $('settings').querySelector('.sheet-title').textContent = 'Ρυθμίσεις';
  $('settings').querySelector('.sheet-body').scrollTop = 0;
  if (back) slide($('settings-menu'), -1);
}

function settingsSub(name) {
  S.setSub = name;
  $('settings-sub-title').textContent = SETTINGS_SUB[name] || '';
  $('settings').querySelector('.sheet-title').textContent = 'Ρυθμίσεις';
  $('settings-menu').hidden = true;
  $('settings-panes').hidden = false;
  showPane('settings-panes', name);
  $('settings').querySelector('.sheet-body').scrollTop = 0;
  slide($('settings-panes'), 1);
}

function onSaveSettings() {
  var btn = $('btn-save-settings');
  var hint = $('p-hint');
  hint.className = 'save-hint';
  btn.disabled = true;

  api('settings', {
    smsName: $('p-name').value.trim(),
    phone: $('p-phone').value.trim(),
    link: $('p-link').value.trim()
  }).then(function (me) {
    S.me = me;
    fillSettings();
    btn.disabled = false;
    hint.textContent = 'Αποθηκεύτηκε';
    toast('Τα στοιχεία σου ενημερώθηκαν');
  }).catch(function (e) {
    btn.disabled = false;
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  });
}

// ─────────────────────────────────────────────────────────────
//  ΕΡΓΑΣΙΕΣ
// ─────────────────────────────────────────────────────────────

var WEEKDAYS = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];

function taskWhen(t) {
  if (!t.date) return '';
  var today = isoDate(new Date());
  var tomorrow = isoDate(new Date(Date.now() + 86400000));
  var yesterday = isoDate(new Date(Date.now() - 86400000));
  var p = t.date.split('-').map(Number);
  var label = t.date === today ? 'Σήμερα' : t.date === tomorrow ? 'Αύριο' : t.date === yesterday ? 'Χθες'
    : WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()] + ' ' + pad(p[2]) + '/' + pad(p[1]);
  return label + (t.time ? ' · ' + t.time : '');
}

function taskOrder(a, b) {
  return ((a.date || '9999') + (a.time || '99')).localeCompare((b.date || '9999') + (b.time || '99'));
}

/** Tabs: Σήμερα (μαζί οι καθυστερημένες) · Επόμενες (μαζί όσες δεν έχουν ημερομηνία) · Έγιναν. */
function renderTasks() {
  var today = isoDate(new Date());
  var open = S.tasks.filter(function (t) { return !t.done; }).sort(taskOrder);
  var done = S.tasks.filter(function (t) { return t.done; })
    .sort(function (a, b) { return b.doneTs - a.doneTs; });

  var late = open.filter(function (t) { return t.date && t.date < today; });
  var now = open.filter(function (t) { return t.date === today; });
  var next = open.filter(function (t) { return t.date > today; });
  var free = open.filter(function (t) { return !t.date; });

  var due = late.length + now.length;
  var badge = $('task-badge');
  badge.hidden = !due;
  badge.textContent = due;
  $('c-t-today').textContent = due;
  $('c-t-next').textContent = next.length + free.length;
  $('c-t-done').textContent = done.length;

  var groups = S.taskTab === 'today' ? [['Καθυστερημένες', late, 'late'], ['Σήμερα', now, '']]
    : S.taskTab === 'next' ? [['Επόμενες', next, ''], ['Χωρίς ημερομηνία', free, '']]
    : [['', done, '']];

  var withItems = groups.filter(function (g) { return g[1].length; });
  // Τίτλος ομάδας μόνο όταν υπάρχουν δύο: με μία, το λέει ήδη το tab.
  var html = withItems.map(function (g) {
    return (withItems.length > 1 || g[2] ? '<div class="section' + (g[2] ? ' ' + g[2] : '') + '">' + g[0] + '</div>' : '') +
      g[1].map(function (t) { return taskRow(t, g[2]); }).join('');
  }).join('');

  if (!html) {
    var empty = {
      today: ['Τίποτα για σήμερα', 'Πάτα «Νέα» για νέα εργασία.'],
      next: ['Καμία επόμενη εργασία', 'Πάτα «Νέα» για νέα εργασία, ή «Εργασία» μέσα σε μια κλήση.'],
      done: ['Καμία εργασία ακόμα', 'Πάτα τον κύκλο δίπλα σε μια εργασία όταν την ολοκληρώσεις.']
    }[S.taskTab];
    html = '<div class="empty"><b>' + empty[0] + '</b>' + empty[1] + '</div>';
  }

  var el = $('task-list');
  el.innerHTML = html;
  wireTaskRows(el);
  renderToday();
}

function taskRow(t, cls) {
  return '<div class="task-row ' + (cls || '') + (t.done ? ' done' : '') + '">' +
    '<button class="check" data-check="' + esc(t.id) + '" aria-label="' + (t.done ? 'Αναίρεση' : 'Ολοκλήρωση') + ': ' + esc(t.title) + '">' +
      '<i>' + (t.done ? ico('check') : '') + '</i></button>' +
    '<button class="task-main" data-task="' + esc(t.id) + '">' +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      '<span class="task-meta">' + [esc(taskWhen(t)), t.leadName ? esc(t.leadName) : '']
        .filter(Boolean).join(', ') + '</span>' +
    '</button></div>';
}

function wireTaskRows(el) {
  el.querySelectorAll('[data-task]').forEach(function (b) {
    b.onclick = function () { openTask(findTask(b.dataset.task)); };
  });
  el.querySelectorAll('[data-check]').forEach(function (b) {
    b.onclick = function () { toggleTask(b.dataset.check); };
  });
}

function findTask(id) { return S.tasks.filter(function (t) { return t.id === id; })[0] || null; }

function mergeTask(t) {
  for (var i = 0; i < S.tasks.length; i++) {
    if (S.tasks[i].id === t.id) { S.tasks[i] = t; return; }
  }
  S.tasks.push(t);
}

/** Αμέσως στην οθόνη, μετά στον server. Αν αποτύχει, γυρίζει πίσω. */
function toggleTask(id) {
  var t = findTask(id);
  if (!t) return;
  var before = { done: t.done, doneTs: t.doneTs };
  var done = !t.done;
  t.done = done ? nowStamp() : '';
  t.doneTs = done ? Date.now() : 0;
  renderTasks();

  send('taskDone', { id: id, done: done }).then(function (r) {
    var fresh = r.data;
    mergeTask(fresh);
    renderTasks();
    if (done) toast('Ολοκληρώθηκε' + (r.queued ? ' · θα σταλεί μόλις έρθει σήμα' : fresh.date ? ' · βγήκε από το ημερολόγιο' : ''));
  }).catch(function (e) {
    t.done = before.done;
    t.doneTs = before.doneTs;
    renderTasks();
    toast(e.message, true);
  });
}

/** Νέα (t = null) ή επεξεργασία. preset: { lead, leadName, title, date }. */
function openTask(t, preset) {
  preset = preset || {};
  S.task = { id: t ? t.id : '', lead: t ? t.lead : (preset.lead || ''), presetLead: !t && !!preset.lead };

  $('t-head').textContent = t ? 'Εργασία' : 'Νέα εργασία';
  $('t-title').value = t ? t.title : (preset.title || '');
  $('t-date').value = t ? t.date : (preset.date === undefined ? isoDate(new Date()) : preset.date);
  $('t-time').value = t ? t.time : '';
  $('t-notes').value = t ? t.notes : '';
  $('t-hint').textContent = '';
  $('t-hint').className = 'save-hint';

  var leadName = t ? t.leadName : preset.leadName;
  $('t-lead').hidden = !leadName;
  $('t-lead').innerHTML = leadName ? 'Κλήση: <button class="link" id="t-lead-open">' + esc(leadName) + '</button>' : '';
  if (leadName) {
    $('t-lead-open').onclick = function () { closeSheet('task'); openLead(S.task.lead); };
  }

  resetDeleteTask();
  $('btn-delete-task').hidden = !t;
  taskNote();
  openSheet('task');
  if (!t) setTimeout(function () { $('t-title').focus(); }, 50);
}

function taskNote() {
  var cal = (S.me && S.me.calendar) || {};
  var d = $('t-date').value, tm = $('t-time').value;
  $('t-note').textContent = !d ? 'Χωρίς ημερομηνία: μένει μόνο στην εφαρμογή.'
    : (tm ? 'Μπαίνει στο ημερολόγιό σου στις ' + tm + ', με υπενθύμιση 10 λεπτά πριν.'
          : 'Μπαίνει στο ημερολόγιό σου ως ολοήμερη.') +
      (cal.shared ? '' : ' (Ως πρόσκληση, μέχρι να συνδέσεις το ημερολόγιό σου.)');
}

function onLeadTask() {
  var l = S.lead;
  if (!l) return;
  var first = String(l.name || '').trim().split(/\s+/)[0];
  openTask(null, {
    lead: l.id, leadName: l.name || 'Χωρίς όνομα',
    title: 'Επικοινωνία με ' + (first || 'πελάτη') + (l.code ? ' (' + l.code + ')' : '')
  });
}

function onSaveTask() {
  var btn = $('btn-save-task'), hint = $('t-hint');
  var data = {
    id: S.task.id,
    title: $('t-title').value.trim(),
    date: $('t-date').value,
    time: $('t-date').value ? $('t-time').value : '',
    notes: $('t-notes').value.trim()
  };
  if (S.task.presetLead) data.lead = S.task.lead;

  if (!data.title) {
    hint.className = 'save-hint err';
    hint.textContent = 'Γράψε τι πρέπει να γίνει.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Αποθήκευση…';
  send('taskSave', data).then(function (r) {
    var t = r.data;
    mergeTask(t);
    renderTasks();
    closeSheet('task');
    toast((data.id ? 'Η εργασία άλλαξε' : 'Η εργασία καταχωρήθηκε') +
          (r.queued ? ' · θα σταλεί μόλις έρθει σήμα' : t.hasEvent ? (t.invited ? ' · ήρθε ως πρόσκληση' : ' · στο ημερολόγιο') : ''));
  }).catch(function (e) {
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  }).then(function () {
    btn.disabled = false;
    btn.textContent = 'Αποθήκευση';
  });
}

function resetDeleteTask() {
  var b = $('btn-delete-task');
  b.disabled = false;
  b.textContent = 'Διαγραφή εργασίας';
}

function onDeleteTask() {
  ask('Να διαγραφεί η εργασία;', 'Θα φύγει και από το ημερολόγιό σου.', 'Ναι, διαγραφή').then(function (yes) {
    if (!yes) return;
    var b = $('btn-delete-task');
    b.disabled = true;
    var id = S.task.id;
    // Εργασία που δεν έχει σταλεί ακόμα: βγαίνει απλώς από την ουρά.
    var tmp = /^tmp-/.test(id) ? S.queue.filter(function (o) { return o.tmp === id || (o.d && o.d.id === id); }) : null;
    (tmp ? Promise.resolve((S.queue = S.queue.filter(function (o) { return tmp.indexOf(o) === -1; }), qSave(), { queued: false }))
         : send('taskDelete', { id: id })).then(function (r) {
      S.tasks = S.tasks.filter(function (t) { return t.id !== id; });
      renderTasks();
      closeSheet('task');
      toast('Η εργασία διαγράφηκε' + (r.queued ? ' · θα σταλεί μόλις έρθει σήμα' : ''));
    }).catch(function (e) {
      resetDeleteTask();
      toast(e.message, true);
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  ΕΓΓΡΑΦΑ ΑΚΙΝΗΤΟΥ
// ─────────────────────────────────────────────────────────────
// Κάθε έγγραφο (ΠΕΑ, Εντολή, Ταυτότητα) έχει δικό του κουμπί. Το αρχείο
// πάει στο «Έγγραφα KWAC» του ακινήτου και μετονομάζεται από τον server.
// Οι φωτογραφίες μικραίνουν πριν φύγουν (≈10x λιγότερα δεδομένα, ίδια ευκρίνεια
// για ανάγνωση εγγράφου), γιατί στο κινητό το ανέβασμα είναι το αργό σημείο.

function slotsDone(counts) {
  var slots = S.boot.docSlots || [];
  return {
    done: slots.filter(function (s) { return (counts || {})[s.key] > 0; }).length,
    total: slots.length
  };
}

/** Ό,τι λείπει, ΜΟΝΟ αν υπάρχει εντολή (ίδια λογική με το missingDocs_() του Code.gs). */
function missingDocs(p) {
  var req = S.boot.docsRequires, c = p.docs || {};
  if (!(c[req] > 0)) return [];
  return (S.boot.docSlots || []).filter(function (s) { return s.key !== req && !(c[s.key] > 0); })
    .map(function (s) { return s.label; });
}

/** Πράσινο: όλα. Πορτοκαλί: έχει εντολή, λείπουν. Γκρι: δεν έχει μπει εντολή ακόμα. */
function docsTag(p) {
  if (!p.docs) return '';
  var c = slotsDone(p.docs);
  var cls = c.done === c.total ? 'showing' : missingDocs(p).length ? 'noanswer' : 'answered';
  var label = cls === 'answered' ? 'Χωρίς εντολή' : 'Έγγραφα ' + c.done + '/' + c.total;
  return '<span class="tag ' + cls + '">' + label + '</span>';
}

function showMissingDocs() {
  closeSheet('detail');
  closeSheet('propdetail');
  S.propTab = 'docs';
  goto('props');
}

// Δύο ομάδες εγγράφων με την ίδια λογική:
//  live: «Έγγραφα KWAC» (ΠΕΑ, Εντολή, Ταυτότητα), για να βγει live το ακίνητο.
//  bill: «Τιμολόγηση» (1.13), τα έντυπα που χρειάζεται το λογιστήριο για την απόδειξη.
var DOC_SETS = {
  live: { list: 'pd-docs-list', count: 'pd-docs-count', folder: 'pd-docs-folder', slots: function () { return S.boot.docSlots || []; } },
  bill: { list: 'pd-bill-list', count: 'pd-bill-count', folder: 'pd-bill-folder', slots: function () { return S.boot.billSlots || []; } }
};

function docKey(set, code) { return set + ':' + code; }

function loadDocs(p, set) {
  set = set || 'live';
  var cached = S.docs[docKey(set, p.code)] || null;
  renderDocs(p, cached, !cached, set);
  api('docs', { code: p.code, set: set }).then(function (res) {
    S.docs[docKey(set, p.code)] = res;
    if (set === 'live') p.docs = res.counts;
    if (S.prop && S.prop.code === p.code) renderDocs(p, res, false, set);
  }).catch(function (e) {
    if (S.prop && S.prop.code === p.code) {
      $(DOC_SETS[set].list).innerHTML = '<p class="save-hint err">Δεν φορτώθηκαν τα έγγραφα: ' + esc(e.message) + '</p>';
    }
  });
}

/** Η Τιμολόγηση μετράει μόνο τα υποχρεωτικά: «4/5». */
function billDone(counts) {
  var req = (S.boot.billSlots || []).filter(function (s) { return !s.optional; });
  return { done: req.filter(function (s) { return (counts || {})[s.key] > 0; }).length, total: req.length };
}

function renderDocs(p, res, loading, set) {
  set = set || 'live';
  var cfg = DOC_SETS[set], slots = cfg.slots();
  var counts = res ? res.counts : set === 'live' ? (p.docs || {}) : {};
  var c = set === 'live' ? slotsDone(counts) : billDone(counts);
  $(cfg.count).textContent = loading && set === 'bill' ? '' : c.done + '/' + c.total;
  var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
  var bar = loading && !res && set === 'bill' ? '' :
    '<div class="progress-wrap"><div class="progress' + (pct === 100 ? ' full' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + c.total +
    '" aria-valuenow="' + c.done + '" aria-label="Έγγραφα"><i style="width:' + pct + '%"></i></div>' +
    '<span>' + (pct === 100 ? 'Όλα έτοιμα ✓' : c.done + ' από ' + c.total + (set === 'bill' ? ' υποχρεωτικά' : '')) + '</span></div>';

  $(cfg.list).innerHTML = bar + slots.map(function (s) {
    var files = res ? res.docs[s.key] || [] : [];
    var has = (counts[s.key] || 0) > 0;
    // 1.20: Υπόδειξη / Προσφορά → διάλεξε από τα έντυπα του ακινήτου.
    var picks = set === 'bill' && s.pick && res && !loading ? (res.picks || {})[s.key] || [] : null;
    var busy = S.uploading[docKey(set, p.code) + ':' + s.key];
    var action = busy ? 'Ανέβασμα…' : has ? 'Νέο αρχείο' : 'Ανέβασμα';

    // Εντολή στην Τιμολόγηση: αντίγραφο της τελευταίας από το «Έγγραφα KWAC».
    var copy = '';
    if (s.from && res && !loading) {
      var m = res.source || {};
      if (!m.available) copy = '<p class="doc-note">Δεν υπάρχει ακόμα Εντολή στο «Έγγραφα». Ανέβασέ τη εκεί ή εδώ.</p>';
      else if (!has || !m.current) {
        copy = '<button class="btn wide' + (has ? '' : ' primary') + ' gap-top" data-copy="' + s.key + '">' + ico('upload') +
          (has ? 'Υπάρχει νεότερη Εντολή · αντιγραφή' : 'Αντιγραφή της τελευταίας Εντολής') + '</button>';
      }
    }

    return '<div class="doc-slot' + (has ? ' ok' : s.optional ? ' opt' : '') + '">' +
      '<div class="doc-head">' +
        '<span class="doc-ico">' + (has ? '✓' : s.optional ? '–' : '!') + '</span>' +
        '<b>' + esc(s.label) + (s.optional ? ' <small>αν υπάρχει</small>' : '') + '</b>' +
        '<button class="btn small' + (has || s.from || s.optional || (picks && picks.length) ? '' : ' primary') + '" data-up="' + s.key + '"' + (busy ? ' disabled' : '') + '>' + action + '</button>' +
      '</div>' +
      (loading ? '<div class="skel line"><i></i></div>' : files.map(function (f, i) {
        var latest = files.length > 1 && i === files.length - 1 && !s.multi;
        var rv = f.review;    // 1.17: τι είπε ο Admin
        return '<div class="doc-file">' +
          '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
          (latest ? '<i class="tag showing">Τελευταίο</i>' : '') +
          '<span>' + esc(f.date.slice(0, 10)) + '</span>' +
          '<button class="x" data-del="' + esc(f.id) + '" data-name="' + esc(f.name) + '" aria-label="Διαγραφή ' + esc(f.name) + '">' + ico('trash') + '</button>' +
        '</div>' +
        (rv && rv.status === RV_ST.FIX && rv.note ? '<p class="doc-fix">' + ico('alert') + '<span><b>Θέλει διόρθωση:</b> ' + esc(rv.note) + '</span></p>'
          : rv ? '<p class="doc-rv ' + (rv.status === RV_ST.OK ? 'ok' : '') + '">' + esc(rv.status === RV_ST.OK ? '✓ Εγκρίθηκε από το γραφείο' : 'Σε έλεγχο από το γραφείο') + '</p>' : '');
      }).join('')) + copy + (picks ? pickButton(s, picks, has) : '') +
    '</div>';
  }).join('');

  var folder = $(cfg.folder);
  folder.hidden = !res || !res.docsUrl;
  if (res && res.docsUrl) folder.href = res.docsUrl;

  var list = $(cfg.list);
  list.querySelectorAll('[data-up]').forEach(function (b) {
    b.onclick = function () {
      S.upSlot = b.dataset.up;
      S.upSet = set;
      $('doc-input').value = '';
      $('doc-input').click();
    };
  });
  list.querySelectorAll('[data-del]').forEach(function (b) {
    b.onclick = function () { onDocDelete(p, b, set); };
  });
  list.querySelectorAll('[data-copy]').forEach(function (b) {
    b.onclick = function () { onCopyMandate(p, b); };
  });
  list.querySelectorAll('[data-pick]').forEach(function (b) {
    b.onclick = function () { openPick(p, b.dataset.pick); };
  });
}

/** Αντίγραφο της τελευταίας Εντολής μέσα στον φάκελο «Τιμολόγηση». */
function onCopyMandate(p, b) {
  b.disabled = true;
  b.textContent = 'Αντιγραφή…';
  api('billMandate', { code: p.code }).then(function (res) {
    S.docs[docKey('bill', p.code)] = res;
    if (S.prop && S.prop.code === p.code) renderDocs(p, res, false, 'bill');
    toast('Η Εντολή αντιγράφηκε στην Τιμολόγηση');
  }).catch(function (e) {
    b.disabled = false;
    toast(e.message, true);
  });
}

/**
 * Αρχείο επιλέχθηκε. Αν η θέση έχει ήδη αρχείο, ρωτάμε τι γίνεται με το παλιό:
 *  replace → το παλιό πάει στον κάδο, το νέο παίρνει τη θέση του
 *  keep    → μένουν και τα δύο, το νέο γίνεται «Τελευταίο» (π.χ. «Εντολή 2»)
 * Η ερώτηση έρχεται ΜΕΤΑ την επιλογή αρχείου: έτσι το παράθυρο αρχείων ανοίγει
 * πάντα με το πάτημα, όπως θέλει το iPhone.
 */
function onDocFile(e) {
  var file = e.target.files && e.target.files[0];
  var p = S.prop, slot = S.upSlot, set = S.upSet || 'live';
  if (!file || !p || !slot) return;

  var cfg = DOC_SETS[set];
  var info = cfg.slots().filter(function (s) { return s.key === slot; })[0] || {};
  var label = info.label || slot;
  var res = S.docs[docKey(set, p.code)];
  var old = res && res.docs[slot] || [];

  var decide = !old.length ? Promise.resolve('keep') : choose(
    'Υπάρχει ήδη ' + label,
    (old.length === 1 ? 'Στον φάκελο υπάρχει το «' + old[0].name + '».' : 'Στον φάκελο υπάρχουν ' + old.length + ' αρχεία.') +
      ' Τι να γίνει με ' + (old.length === 1 ? 'το παλιό' : 'τα παλιά') + ';',
    [{ key: 'replace', label: 'Αντικατάσταση (σβήνεται το παλιό)', cls: 'solid-red' },
     { key: 'keep', label: 'Κράτα και το παλιό', cls: 'primary' },
     { key: null, label: 'Άκυρο' }]);

  decide.then(function (mode) {
    if (!mode) return;
    var key = docKey(set, p.code) + ':' + slot;
    S.uploading[key] = true;
    renderDocs(p, res, false, set);

    return shrink(file).then(function (f) {
      if (f.size > (S.boot.maxUploadMb || 20) * 1048576) {
        throw new Error('Το αρχείο είναι πάνω από ' + S.boot.maxUploadMb + ' MB.');
      }
      return toBase64(f.blob).then(function (data) {
        return api('upload', { code: p.code, set: set, slot: slot, mode: mode, name: f.name, mime: f.type, data: data });
      });
    }).then(function (r) {
      S.docs[docKey(set, p.code)] = r;
      if (set === 'live') {
        p.docs = r.counts;
        var lack = missingDocs(p);
        toast('Ανέβηκε: ' + label + (lack.length ? '. Λείπουν ακόμα: ' + lack.join(', ') : ''));
      } else {
        var bd = billDone(r.counts);
        toast('Ανέβηκε: ' + label + (bd.done < bd.total ? ' · ' + bd.done + '/' + bd.total + ' για τιμολόγηση' : ' · όλα έτοιμα για τιμολόγηση ✓'));
      }
    }).catch(function (err) {
      toast('Δεν ανέβηκε: ' + err.message, true);
    }).then(function () {
      delete S.uploading[key];
      if (S.prop && S.prop.code === p.code) renderDocs(p, S.docs[docKey(set, p.code)], false, set);
      if (S.view === 'props') renderProps();
    });
  });
}

/** Φωτογραφίες → JPEG έως 2400px. PDF και ό,τι δεν διαβάζεται → όπως είναι. */
function shrink(file) {
  var keep = { blob: file, name: file.name, type: file.type || 'application/octet-stream', size: file.size };
  if (!/^image\//.test(file.type) || file.size < 400 * 1024) return Promise.resolve(keep);

  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 2400, w = img.naturalWidth, h = img.naturalHeight;
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) {
        if (!b || b.size >= file.size) return resolve(keep);
        resolve({ blob: b, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', size: b.size });
      }, 'image/jpeg', 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(keep); };   // π.χ. HEIC σε Android
    img.src = url;
  });
}

function toBase64(blob) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
    r.onerror = function () { reject(new Error('Δεν διαβάστηκε το αρχείο.')); };
    r.readAsDataURL(blob);
  });
}

/**
 * Διαγραφή με επιβεβαίωση. Το αρχείο φεύγει από τον φάκελο του ακινήτου στο Drive
 * και πάει στον κάδο, όπου μένει 30 ημέρες για την περίπτωση λάθους.
 */
function onDocDelete(p, b, set) {
  set = set || 'live';
  ask('Να διαγραφεί το αρχείο;', '«' + b.dataset.name + '» θα σβηστεί από τον φάκελο του ακινήτου στο Drive. ' +
      'Αν ήταν λάθος, ανακτάται από τον κάδο του Drive για 30 ημέρες.', 'Ναι, διαγραφή').then(function (yes) {
    if (!yes) return;
    b.disabled = true;
    api('docDelete', { code: p.code, set: set, fileId: b.dataset.del }).then(function (res) {
      S.docs[docKey(set, p.code)] = res;
      if (set === 'live') p.docs = res.counts;
      renderDocs(p, res, false, set);
      toast('Το αρχείο διαγράφηκε από το Drive');
    }).catch(function (e) {
      b.disabled = false;
      toast(e.message, true);
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  ΜΗΝΥΜΑΤΑ SMS (ρυθμίσεις)
// ─────────────────────────────────────────────────────────────

var TPL_PLACEHOLDERS = {
  intro:    ['πελάτης', 'κωδικός', 'όνομά μου', 'κινητό μου', 'γραφείο', 'link'],
  reminder: ['ημέρα', 'ώρα', 'διεύθυνση', 'πελάτης', 'όνομά μου', 'κινητό μου'],
  cancel:   ['ημέρα', 'ώρα', 'διεύθυνση', 'πελάτης', 'όνομά μου', 'κινητό μου']
};

function sampleVars(lang) {
  var me = S.me, en = lang === 'en';
  var L = function (x) { return en ? latin(x) : x; };
  return {
    'πελάτης': L('Μαρία'), 'κωδικός': '2564590', 'διεύθυνση': L('Βαρίκα 13'),
    'ημέρα': en ? 'tomorrow' : 'αύριο', 'ώρα': '18:00',
    'όνομά μου': L(me.smsName || me.name || ''), 'κινητό μου': me.phone || '',
    'γραφείο': L((S.boot.office && S.boot.office.name) || ''), 'link': me.link || ''
  };
}

function openTemplates() {
  S.tplDraft = {};
  Object.keys(SMS_KINDS).forEach(function (k) {
    S.tplDraft[k] = { el: templateOf(k, 'el'), en: templateOf(k, 'en') };
    S.tplLang[k] = S.tplLang[k] || 'el';
  });
  $('tpl-hint').textContent = '';
  renderTemplates();
  openSheet('templates');
}

function renderTemplates() {
  $('tpl-list').innerHTML = Object.keys(SMS_KINDS).map(function (k) {
    var lang = S.tplLang[k];
    return '<div class="tpl-card" data-kind="' + k + '">' +
      '<div class="tpl-head"><b>' + SMS_KINDS[k].label + '</b>' +
        '<div class="mini-seg">' +
          '<button data-lang="el"' + (lang === 'el' ? ' class="is-on"' : '') + '>ΕΛ</button>' +
          '<button data-lang="en"' + (lang === 'en' ? ' class="is-on"' : '') + '>EN</button>' +
        '</div></div>' +
      '<textarea class="tpl-text" rows="4">' + esc(S.tplDraft[k][lang]) + '</textarea>' +
      '<div class="chips tight">' + TPL_PLACEHOLDERS[k].map(function (ph) {
        return '<button class="chip small" data-ph="' + esc(ph) + '">{' + esc(ph) + '}</button>';
      }).join('') + '</div>' +
      '<div class="tpl-preview"><span>Προεπισκόπηση</span><p></p><small></small></div>' +
      '<button class="link tpl-reset">Επαναφορά προεπιλογής</button>' +
    '</div>';
  }).join('');

  $$('#tpl-list .tpl-card').forEach(function (card) {
    var k = card.dataset.kind;
    var ta = card.querySelector('.tpl-text');

    ta.oninput = function () { S.tplDraft[k][S.tplLang[k]] = ta.value; tplPreview(card); };
    card.querySelectorAll('[data-lang]').forEach(function (b) {
      b.onclick = function () { S.tplLang[k] = b.dataset.lang; renderTemplates(); };
    });
    card.querySelectorAll('[data-ph]').forEach(function (b) {
      b.onclick = function () {
        var ins = '{' + b.dataset.ph + '}';
        var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
        var z = ta.selectionEnd == null ? a : ta.selectionEnd;
        ta.value = ta.value.slice(0, a) + ins + ta.value.slice(z);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = a + ins.length;
        ta.oninput();
      };
    });
    card.querySelector('.tpl-reset').onclick = function () {
      S.tplDraft[k][S.tplLang[k]] = S.boot.defaults.templates[k][S.tplLang[k]];
      renderTemplates();
    };
    tplPreview(card);
  });
}

function tplPreview(card) {
  var k = card.dataset.kind, lang = S.tplLang[k];
  var text = renderTpl(S.tplDraft[k][lang], sampleVars(lang));
  var c = countSms(text);
  card.querySelector('.tpl-preview p').textContent = text || '—';
  var sm = card.querySelector('.tpl-preview small');
  sm.textContent = c.chars + ' χαρ. · ' + c.parts + ' SMS';
  sm.className = c.parts > 1 ? 'over' : '';
}

function onSaveTemplates() {
  var btn = $('btn-save-templates'), hint = $('tpl-hint');
  btn.disabled = true;
  hint.className = 'save-hint';
  hint.textContent = 'Αποθήκευση…';
  api('settings', { templates: S.tplDraft }).then(function (me) {
    S.me = me;
    closeSheet('templates');
    toast('Τα μηνύματα αποθηκεύτηκαν');
    if (S.lead && !$('detail').hidden) prepareSms(S.lead);
  }).catch(function (e) {
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  }).then(function () { btn.disabled = false; });
}

// ─────────────────────────────────────────────────────────────
//  ΧΡΩΜΑΤΑ ΗΜΕΡΟΛΟΓΙΟΥ (ρυθμίσεις)
// ─────────────────────────────────────────────────────────────

/** Τα 11 χρώματα του Google Calendar, με τα ονόματα που δείχνει στα ελληνικά. */
var CAL_COLORS = [
  ['1', 'Λεβάντα', '#7986cb'], ['2', 'Φασκόμηλο', '#33b679'], ['3', 'Σταφύλι', '#8e24aa'],
  ['4', 'Φλαμίνγκο', '#e67c73'], ['5', 'Μπανάνα', '#f6bf26'], ['6', 'Μανταρίνι', '#f4511e'],
  ['7', 'Παγώνι', '#039be5'], ['8', 'Γραφίτης', '#616161'], ['9', 'Βατόμουρο', '#3f51b5'],
  ['10', 'Βασιλικός', '#0b8043'], ['11', 'Ντομάτα', '#d50000']
];
var COLOR_ROWS = [['showing', 'Υποδείξεις'], ['followup', 'Follow-up'], ['task', 'Εργασίες']];
var colorTimer = null;

function renderColors() {
  var colors = ((S.me && S.me.prefs) || {}).colors || {};
  $('color-rows').innerHTML = COLOR_ROWS.map(function (r) {
    var cur = colors[r[0]];
    var name = (CAL_COLORS.filter(function (c) { return c[0] === cur; })[0] || [])[1] || '';
    return '<div class="color-row"><div class="color-label">' + r[1] + ' <span>' + name + '</span></div>' +
      '<div class="swatches">' + CAL_COLORS.map(function (c) {
        return '<button class="swatch' + (c[0] === cur ? ' is-on' : '') + '" style="background:' + c[2] + '"' +
          ' data-kind="' + r[0] + '" data-color="' + c[0] + '" aria-label="' + c[1] + '" title="' + c[1] + '"></button>';
      }).join('') + '</div></div>';
  }).join('');

  $$('#color-rows .swatch').forEach(function (b) {
    b.onclick = function () {
      S.me.prefs.colors[b.dataset.kind] = b.dataset.color;
      renderColors();
      clearTimeout(colorTimer);
      $('color-hint').className = 'save-hint';
      $('color-hint').textContent = 'Αποθήκευση…';
      colorTimer = setTimeout(saveColors, 700);
    };
  });
}

function saveColors() {
  api('settings', { colors: S.me.prefs.colors }).then(function (me) {
    S.me = me;
    $('color-hint').textContent = 'Αποθηκεύτηκε · ισχύει για νέα events και όσα αλλάζεις';
  }).catch(function (e) {
    $('color-hint').className = 'save-hint err';
    $('color-hint').textContent = e.message;
  });
}

/** Αποσυνδέει ΜΟΝΟ αυτή τη συσκευή (σβήνει και τις ειδοποιήσεις της). */
function onLogout() {
  ask('Αποσύνδεση αυτής της συσκευής;', 'Για να ξαναμπείς θα χρειαστείς το προσωπικό σου link και κωδικό από το email.', 'Ναι, αποσύνδεση').then(function (yes) {
    if (!yes) return;
    var b = $('btn-logout');
    b.disabled = true;
    api('logout').catch(function () { /* αποσυνδέεται τοπικά ούτως ή άλλως */ }).then(function () {
      forgetDevice();
      location.replace(location.pathname);
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  ΑΝΑΝΕΩΣΗ
// ─────────────────────────────────────────────────────────────

/** ↻: ξαναφέρνει κλήσεις, ακίνητα και ρυθμίσεις. */
function refreshNow() {
  var btns = $$('[data-refresh]');
  var spin = function (on) { btns.forEach(function (x) { x.classList.toggle('spin', on); }); };
  spin(true);
  if (isAdminMode()) {
    S.afiles = {};
    return loadAdmin(true).then(function () { spin(false); toast('Ανανεώθηκε'); },
                                function (e) { spin(false); toast(e.message, true); });
  }
  if (S.queue.length) offFlush(true);
  apiTimed('bootstrap', {}, 20000).then(function (b) {
    S.boot = b;
    S.me = b.agent;
    S.flags = b.flags || {};                         // 2.3.2: και τα feature flags
    S.bootStale = false;
    S.bootAt = Date.now();
    applyData(b);
    render();
    fillSettings();
    offBar();
    spin(false);
    toast('Ανανεώθηκε');
  }).catch(function (e) {
    spin(false);
    offBar();
    toast(e.net ? 'Χωρίς σύνδεση. Βλέπεις τα τελευταία στοιχεία· οι αλλαγές σου θα σταλούν μόλις έρθει σήμα.' : e.message, !e.net);
  });
}

var polling = false;
function poll() {
  if (isAdminMode()) return pollAdmin();
  if (!$('detail').hidden || !$('showing').hidden) return;   // μην πειράξεις ανοιχτή κλήση
  refreshLeads();
}

/** 1.17 · Admin: μόνο η λίστα ελέγχου (ελαφριά), για να φαίνεται ό,τι ανέβηκε στο μεταξύ. */
function pollAdmin() {
  if (polling || document.hidden || !S.adm || !$('review').hidden) return;
  polling = true;
  api('reviewList').then(function (r) { S.adm.review = r; renderAdmin(); })
    .catch(function () { /* σιωπηλά */ }).then(function () { polling = false; });
}

/** Φρέσκια λίστα κλήσεων. Δεν αγγίζει ανοιχτή λεπτομέρεια, μόνο τη λίστα και τα badge. */
function refreshLeads() {
  if (polling || document.hidden || !S.boot) return;
  polling = true;
  apiTimed('leads', {}, 20000).then(function (leads) {
    S.leads = leads;
    offReapply();
    render();
  }).catch(function () { /* σιωπηλά */ }).then(function () { polling = false; });
}

// ─────────────────────────────────────────────────────────────
//  ΑΛΛΑ (1.16): προφίλ, ομάδες, σύνοψη μετρήσεων
// ─────────────────────────────────────────────────────────────

function renderMore() {
  var me = S.me || {};
  fillInitials();
  $('more-name').textContent = me.name || '';
  $('more-sub').textContent = [S.boot && S.boot.office && S.boot.office.name, 'Προφίλ και ρυθμίσεις'].filter(Boolean).join(' · ');
  if (S.mx) renderMoreMx();
  else {
    $('more-mx').innerHTML = '<span class="mx-mini">' + [1, 2, 3].map(function () { return '<span class="skel tile"><i></i><i></i></span>'; }).join('') + '</span>';
    loadMetrics(false);
  }
}

/** Τα τρία σύνολα του τελευταίου μήνα με υποβολές, με ▲▼ από τον προηγούμενο. */
function renderMoreMx() {
  var d = S.mx, el = $('more-mx');
  if (!d || !el) return;
  if (!d.configured || !d.months.length) {
    $('more-mx-title').textContent = 'Μετρήσεις';
    el.innerHTML = '<span class="card-note">' + (d.configured ? 'Δεν βρέθηκαν ακόμα υποβολές της φόρμας εβδομάδας.' : 'Δεν έχει ρυθμιστεί ακόμα από το γραφείο.') + '</span>';
    return;
  }
  var m = monthOf(S.mxMonth) || d.months[0];
  var prev = monthOf(prevYm(m.ym));
  var live = isLiveYm(m.ym);
  $('more-mx-title').textContent = m.label + (live ? ' · σε εξέλιξη' : '');
  el.innerHTML = '<span class="mx-mini">' + mxTiles(m.values, prev ? prev.values : null).map(function (t) {
    return '<span class="mx-mini-tile"><b>' + fmtNum(t.v) + '</b><span>' + t.label + '</span>' + deltaHtml(t.v, t.p, live) + '</span>';
  }).join('') + '</span>';
}

// ─────────────────────────────────────────────────────────────
//  ΟΙ ΣΥΣΤΑΣΕΙΣ ΜΟΥ (1.16)
//  Από το φύλλο «Συστάσεις»: Α/Α, γραφείο, συνεργάτης, PDF. Τα στοιχεία του
//  πελάτη δεν έρχονται εδώ· είναι μόνο μέσα στο PDF.
// ─────────────────────────────────────────────────────────────

function loadReferrals(force) {
  if (S.refs && !force) return renderReferrals();
  if (!S.refs) $('ref-list').innerHTML = skel(4);
  apiRead('referrals').then(function (list) {
    S.refs = list || [];
    renderReferrals();
  }).catch(function (e) {
    if (!S.refs) $('ref-list').innerHTML = '<div class="empty"><b>Δεν φορτώθηκαν</b>' + esc(e.message) + '</div>';
    else toast(e.message, true);
  });
}

function renderReferrals() {
  var list = S.refs || [], el = $('ref-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><b>Καμία σύσταση ακόμα</b>Όταν στείλεις έντυπο σύστασης ή συνεργασίας, θα το βρίσκεις εδώ με το PDF του.' +
      '<button class="btn primary wide" id="ref-first">Νέα σύσταση ή συνεργασία</button></div>';
    $('ref-first').onclick = function () { openReferral(null); };
    return;
  }
  var key = 'refs';
  el.innerHTML = listMeta(list.length, key, 'έντυπο', 'έντυπα') + pageOf(list, key).map(function (r) {
    var syn = /συνεργ/i.test(r.kind);
    var tag = '<span class="tag ' + (syn ? 'closed' : 'showing') + '">' + esc(r.kind || 'Έντυπο') + '</span>' +
      (r.review ? ' <span class="tag ' + rvTagClass(r.review.status) + '">' + esc(rvShort(r.review.status)) + '</span>' : '');
    var inner = '<span class="mrow-ico">' + ico('receipt') + '</span><span class="mrow-body"><b>' + esc(r.aa || '—') + ' ' + tag + '</b>' +
      '<span>' + esc([r.partner, r.office].filter(Boolean).join(', ')) + '</span>' +
      (r.review && r.review.status === RV_ST.FIX && r.review.note ? '<span class="rv-note-line">«' + esc(r.review.note) + '»</span>' : '') +
      '<span class="muted">' + esc(r.date) + '</span></span>';
    return r.fileUrl
      ? '<a class="mrow" href="' + esc(r.fileUrl) + '" target="_blank" rel="noopener" aria-label="' + esc((r.kind || '') + ' ' + r.aa) + ', άνοιγμα PDF">' + inner + ico('out', 'ico chev') + '</a>'
      : '<div class="mrow">' + inner + '</div>';
  }).join('') + pagerHtml(list.length, key);
  wirePager(el, key, renderReferrals);
}

// ─────────────────────────────────────────────────────────────
//  ΤΡΑΒΑ ΓΙΑ ΑΝΑΝΕΩΣΗ (1.16)
//  Στην κορυφή μιας λίστας, τράβα προς τα κάτω και άφησε: ίδιο με το ↻.
// ─────────────────────────────────────────────────────────────

var PTR_VIEWS = { today: 1, calls: 1, tasks: 1, props: 1, more: 1, alerts: 1, referrals: 1, 'a-review': 1, 'a-calls': 1, 'a-props': 1 };
var PTR_MAX = 72;

function wirePullToRefresh() {
  var start = null, dy = 0, ind = $('ptr');
  var reset = function () {
    start = null; dy = 0;
    ind.classList.remove('on', 'ready');
    ind.style.transform = '';
  };
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0 || !PTR_VIEWS[S.view] || openSheets().length || !$('ask').hidden ||
        POPS.some(function (id) { return !$(id).hidden; }) || e.target.closest('#map-pane') || e.touches.length !== 1) return;
    start = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (start == null) return;
    dy = e.touches[0].clientY - start;
    if (dy <= 0 || window.scrollY > 0) { if (dy < 0) reset(); return; }
    var y = Math.min(PTR_MAX, dy * 0.5);
    ind.classList.add('on');
    ind.classList.toggle('ready', y >= PTR_MAX * 0.85);
    ind.style.transform = 'translate(-50%,' + y + 'px) rotate(' + Math.round(y * 4) + 'deg)';
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (start == null) return;
    var go = ind.classList.contains('ready');
    reset();
    if (go) {
      if (S.view === 'more' || S.view === 'referrals') { S.mx = null; if (S.view === 'more') renderMore(); else loadReferrals(true); }
      else refreshNow();
    }
  }, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
}

// ─────────────────────────────────────────────────────────────
//  ADMIN (1.17)
//  Ο Admin βλέπει τα πάντα και εγκρίνει τα έντυπα. Δεν έχει ενέργειες
//  πάνω στις κλήσεις (κλήση, SMS, κατάσταση). Ο ρόλος ελέγχεται και στον server.
//  Όποιος έχει και τους δύο ρόλους αλλάζει λειτουργία από τα «Άλλα».
// ─────────────────────────────────────────────────────────────

var RV_ST = { PENDING: 'Σε έλεγχο', OK: 'Εγκρίθηκε', FIX: 'Θέλει διόρθωση' };
var RV_TAB = { pending: RV_ST.PENDING, fix: RV_ST.FIX, ok: RV_ST.OK };
var RV_KIND_LABEL = { live: 'Έγγραφα', bill: 'Τιμολόγηση', showform: 'Υπόδειξη', offerform: 'Προσφορά', referral: 'Σύσταση', other: 'Άλλο αρχείο' };

S.mode = 'agent';
S.adm = null;
S.rvTab = 'pending';
S.rvf = { agent: '', kind: '' };
S.acTab = 'all';
S.acf = { agent: '', prop: '' };
S.apf = { agent: '', status: 'available' };
S.afiles = {};

function roles() { return (S.boot && S.boot.roles) || { agent: true, admin: false }; }
function isAdminMode() { return S.mode === 'admin'; }

/** Αλλαγή λειτουργίας. Μένει στη συσκευή για το επόμενο άνοιγμα. */
function setMode(mode, quiet) {
  var r = roles();
  if (mode === 'admin' && !r.admin) mode = 'agent';
  if (mode === 'agent' && !r.agent) mode = 'admin';
  var changed = S.mode !== mode;
  S.mode = mode;
  store('kw_mode', mode);
  var admin = mode === 'admin';
  document.body.classList.toggle('mode-admin', admin);
  $('nav-agent').hidden = admin;
  $('nav-admin').hidden = !admin;
  $('mode-wrap').hidden = !(r.admin && r.agent);
  $('a-mode-wrap').hidden = !r.agent;
  $('set-cal').hidden = !r.agent;
  $('btn-templates').hidden = !r.agent;
  if (changed || quiet) {
    while (closeTop()) { /* κλείνουν τα ανοιχτά φύλλα */ }
    goto(admin ? 'a-review' : 'today');
  }
  if (admin) loadAdmin(false).catch(function () {});
  if (!quiet && changed) toast(admin ? 'Λειτουργία Admin' : 'Λειτουργία μεσίτη');
}

function loadAdmin(force) {
  if (S.adm && !force) { renderAdmin(); return Promise.resolve(S.adm); }
  if (S.admLoading) return S.admLoading;
  if (!S.adm) ['rv-list', 'ac-list', 'ap-list'].forEach(function (id) { $(id).innerHTML = skel(5); });
  S.admLoading = api('adminBoot').then(function (d) {
    S.adm = d;
    S.admLoading = null;
    renderAdmin();
    return d;
  }, function (e) {
    S.admLoading = null;
    if (!S.adm) {
      ['rv-list', 'ac-list', 'ap-list'].forEach(function (id) {
        $(id).innerHTML = '<div class="empty"><b>Δεν φόρτωσαν τα στοιχεία</b>' + esc(e.message) +
          '<button class="btn primary wide" data-adm-retry>Δοκίμασε ξανά</button></div>';
      });
      $$('[data-adm-retry]').forEach(function (b) { b.onclick = function () { loadAdmin(true).catch(function () {}); }; });
    }
    throw e;
  });
  return S.admLoading;
}

function renderAdmin() {
  if (!S.adm) return;
  var n = S.adm.review.counts.pending || 0;
  var b = $('a-badge');
  b.hidden = !n;
  b.textContent = n;
  renderReviews();
  renderACalls();
  renderAProps();
  renderAMore();
}

function agentNames() { return ((S.adm && S.adm.agents) || []).map(function (a) { return a.name; }); }

function agentOptions(cur, none) {
  return [['', 'Όλοι']].concat(agentNames().map(function (n) { return [n, n]; }), none ? [['__none', 'Χωρίς μεσίτη']] : []);
}

function rvTagClass(st) { return st === RV_ST.OK ? 'showing' : st === RV_ST.FIX ? 'pending' : 'answered'; }
function rvShort(st) { return st === RV_ST.OK ? '✓ Εγκρίθηκε' : st || 'Χωρίς έλεγχο'; }

// ── Έλεγχος εντύπων: λίστα ─────────────────────────────────

function rvFiltered() {
  var f = S.rvf, words = searchWords($('rv-search').value);
  return S.adm.review.items.filter(function (i) {
    if (f.agent && i.agent !== f.agent) return false;
    if (f.kind && i.kind !== f.kind) return false;
    return !words.length || matches(words, [i.title, i.street, i.code, i.agent, i.kindLabel]);
  });
}

function fillRvFilters() {
  S.rvf.agent = fillOptions($('f-rv-agent'), agentOptions(S.rvf.agent), S.rvf.agent);
  S.rvf.kind = fillOptions($('f-rv-kind'), [['', 'Όλα']].concat(Object.keys(RV_KIND_LABEL).map(function (k) {
    return [k, RV_KIND_LABEL[k]];
  })), S.rvf.kind);
  filterBadge('rv', (S.rvf.agent ? 1 : 0) + (S.rvf.kind ? 1 : 0));
}

function rvRow(i) {
  var tone = i.status === RV_ST.FIX ? 'bad' : i.status === RV_ST.OK ? 'ok' : 'warn';
  var icon = i.kind === 'showform' || i.kind === 'offerform' || i.kind === 'referral' ? 'form' : i.kind === 'bill' ? 'receipt' : 'upload';
  var where = [i.street || (i.code ? 'Κωδικός ' + i.code : ''), i.agent].filter(Boolean).join(' · ');
  var when = i.status === RV_ST.PENDING ? 'Ανέβηκε ' + lowerDay(niceDate(i.date))
    : (i.status === RV_ST.OK ? 'Εγκρίθηκε ' : 'Στάλθηκε πίσω ') + lowerDay(niceDate(i.at)) + (i.by ? ' · ' + i.by : '');
  return '<button class="mrow" data-rv="' + esc(i.id) + '"><span class="mrow-ico ' + tone + '">' + ico(icon) + '</span>' +
    '<span class="mrow-body"><b>' + esc(i.title) + ' <span class="tag">' + esc(i.kindLabel) + '</span></b>' +
    '<span>' + esc(where) + '</span>' +
    (i.status === RV_ST.FIX && i.note ? '<span class="rv-note-line">«' + esc(i.note) + '»</span>' : '') +
    '<span class="muted">' + esc(when) + '</span></span>' + ico('next', 'ico chev') + '</button>';
}

function renderReviews() {
  if (!S.adm) return;
  fillRvFilters();
  var base = rvFiltered();
  Object.keys(RV_TAB).forEach(function (t) {
    $('c-rv-' + t).textContent = base.filter(function (i) { return i.status === RV_TAB[t]; }).length;
  });
  setTab('tabs-a-review', S.rvTab);
  var list = base.filter(function (i) { return i.status === RV_TAB[S.rvTab]; });
  // Σε έλεγχο: τα παλαιότερα πρώτα (σειρά προτεραιότητας). Τα άλλα: τα νεότερα πρώτα.
  if (S.rvTab === 'pending') list = list.slice().sort(function (a, b) { return a.ts - b.ts; });
  var el = $('rv-list');
  if (!list.length) {
    var filtered = S.rvf.agent || S.rvf.kind || $('rv-search').value;
    var msg = filtered ? ['Τίποτα με αυτά τα φίλτρα', 'Άλλαξε την αναζήτηση ή πάτα «Καθαρισμός φίλτρων».'] : {
      pending: ['Όλα ελέγχθηκαν ✓', 'Μόλις ένας μεσίτης ανεβάσει έγγραφο ή υπογραφεί έντυπο, θα έρθει εδώ.'],
      fix: ['Κανένα έντυπο σε διόρθωση', 'Εδώ μένουν όσα έστειλες πίσω, μέχρι ο μεσίτης να ανεβάσει το σωστό.'],
      ok: ['Κανένα εγκεκριμένο ακόμα', 'Εδώ φαίνονται τα εγκεκριμένα των τελευταίων 90 ημερών.']
    }[S.rvTab];
    el.innerHTML = '<div class="empty"><b>' + msg[0] + '</b>' + msg[1] + '</div>';
    return;
  }
  var key = 'rv:' + S.rvTab;
  el.innerHTML = listMeta(list.length, key, 'έντυπο', 'έντυπα') + pageOf(list, key).map(rvRow).join('') + pagerHtml(list.length, key);
  el.querySelectorAll('[data-rv]').forEach(function (b) {
    b.onclick = function () { openReview(findReview(b.dataset.rv)); };
  });
  wirePager(el, key, renderReviews);
}

function findReview(id) {
  return ((S.adm && S.adm.review.items) || []).filter(function (i) { return i.id === id; })[0] || null;
}

function mergeReview(item) {
  var items = S.adm.review.items;
  var at = -1;
  items.forEach(function (x, i) { if (x.id === item.id) at = i; });
  if (at === -1) items.unshift(item); else items[at] = item;
}

// ── Έλεγχος ενός εντύπου ───────────────────────────────────

function openReview(it) {
  if (!it) return;
  S.rvItem = it;
  clearPreview();
  $('rv-kind').textContent = it.kindLabel || RV_KIND_LABEL[it.kind] || '';
  $('rv-title').textContent = it.title || it.name || 'Έντυπο';
  $('rv-sub').textContent = [it.street || (it.code ? 'Κωδικός ' + it.code : ''), it.agent].filter(Boolean).join(' · ');
  var tag = $('rv-status');
  tag.textContent = rvShort(it.status);
  tag.className = 'tag ' + rvTagClass(it.status);

  $('rv-facts').innerHTML = [
    ['Ανέβηκε', it.date ? niceDate(it.date) : ''], ['Μεσίτης', it.agent], ['Κωδικός ακινήτου', it.code],
    ['Αρχείο', it.name], ['Μέγεθος', it.size ? fmtSize(it.size) : '']
  ].filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
  }).join('');

  $('rv-open').hidden = !it.url;
  if (it.url) $('rv-open').href = it.url;
  $('rv-download').hidden = !it.fileId;
  $('rv-download').disabled = false;
  label($('rv-download'), 'download', 'Κατέβασμα');

  var last = $('rv-last');
  var decided = it.status === RV_ST.OK || it.status === RV_ST.FIX;
  last.hidden = !decided;
  if (decided) {
    last.className = 'rv-last ' + (it.status === RV_ST.OK ? 'ok' : 'fix');
    last.innerHTML = '<b>' + esc(it.status) + '</b><span>' + esc([it.at ? niceDate(it.at) : '', it.by].filter(Boolean).join(' · ')) + '</span>' +
      (it.note ? '<p>' + esc(it.note) + '</p>' : '');
  }

  $('rv-ok').hidden = it.status === RV_ST.OK;
  label($('rv-fix-open'), 'alert', it.status === RV_ST.FIX ? 'Αλλαγή σχολίου' : 'Θέλει διόρθωση');
  showFixBox(false);
  $('rv-note').value = it.status === RV_ST.FIX ? it.note || '' : '';
  $('rv-reasons').innerHTML = ((S.adm && S.adm.reasons) || []).map(function (r) {
    return '<button class="chip small" data-reason="' + esc(r) + '">' + esc(r) + '</button>';
  }).join('');
  $('rv-reasons').querySelectorAll('[data-reason]').forEach(function (b) {
    b.onclick = function () {
      var t = $('rv-note'), v = t.value.trim();
      t.value = (v ? v.replace(/[.\s]*$/, '. ') : '') + b.dataset.reason + '.';
      t.focus();
    };
  });
  $('review').querySelector('.sheet-body').scrollTop = 0;
  openSheet('review');
}

/** Το κουτί του σχολίου. Όταν είναι ανοιχτό, η «Έγκριση» κρύβεται: μία κύρια ενέργεια τη φορά. */
function showFixBox(on) {
  $('rv-fix').hidden = !on;
  $('rv-fix-open').hidden = on;
  $('rv-ok').hidden = on || (S.rvItem && S.rvItem.status === RV_ST.OK);
  $('rv-hint').textContent = '';
  $('rv-hint').className = 'save-hint';
  if (on) setTimeout(function () { $('rv-note').focus(); }, 50);
}

function rvDecide(decision) {
  var it = S.rvItem;
  if (!it) return;
  var note = $('rv-note').value.trim();
  if (decision === 'fix' && !note) {
    $('rv-hint').textContent = 'Γράψε τι πρέπει να διορθωθεί.';
    $('rv-hint').className = 'save-hint err';
    $('rv-note').focus();
    return;
  }
  var btn = decision === 'ok' ? $('rv-ok') : $('rv-fix-send');
  btn.disabled = true;
  api('reviewSet', { id: it.id || '', fileId: it.fileId || '', code: it.code || '', decision: decision,
                     note: decision === 'fix' ? note : '' }).then(function (r) {
    mergeReview(r.item);
    S.adm.review.counts = r.counts;
    var cache = S.afiles[r.item.code];
    if (cache) cache.groups.forEach(function (g) {
      g.files.forEach(function (f) {
        if (f.id === r.item.fileId) f.review = { id: r.item.id, status: r.item.status, note: r.item.note, at: r.item.at };
      });
    });
    closeSheet('review');
    renderAdmin();
    if (S.aprop && S.aprop.code === r.item.code && cache) renderAFiles(S.aprop, cache, false);
    var msg = decision === 'ok' ? 'Εγκρίθηκε ✓'
      : r.notified === 'push' ? 'Στάλθηκε στον μεσίτη με ειδοποίηση'
      : r.notified === 'email' ? 'Στάλθηκε στον μεσίτη με email'
      : 'Αποθηκεύτηκε. Ο μεσίτης θα το δει στην εφαρμογή.';
    toast(msg + (r.masked ? ' Αφαιρέθηκαν αριθμοί που έμοιαζαν με Α.Δ.Τ. ή ΑΦΜ.' : ''));
  }).catch(function (e) {
    $('rv-hint').textContent = e.message;
    $('rv-hint').className = 'save-hint err';
    toast(e.message, true);
  }).then(function () { btn.disabled = false; });
}

// ── Κατέβασμα ──────────────────────────────────────────────

function b64Blob(b64, mime) {
  var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
  for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime || 'application/octet-stream' });
}

function saveBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name || 'αρχείο';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

function fmtSize(n) {
  if (!n) return '';
  if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (Math.round(n / 104857.6) / 10).toString().replace('.', ',') + ' MB';
}

function clearPreview() {
  var p = $('rv-preview');
  if (p._url) URL.revokeObjectURL(p._url);
  p._url = null;
  p.innerHTML = '';
  p.hidden = true;
}

/** Το αρχείο έρχεται μέσα από την εφαρμογή: δουλεύει και χωρίς πρόσβαση στο Drive. Οι φωτογραφίες φαίνονται κι εδώ. */
function onRvDownload() {
  var it = S.rvItem, btn = $('rv-download');
  if (!it || !it.fileId) return;
  btn.disabled = true;
  label(btn, 'download', 'Κατέβασμα…');
  api('adminFile', { fileId: it.fileId }).then(function (f) {
    var blob = b64Blob(f.data, f.mime);
    if (/^image\//.test(f.mime)) {
      clearPreview();
      var p = $('rv-preview');
      p._url = URL.createObjectURL(blob);
      p.innerHTML = '<img alt="' + esc(it.title || 'Προεπισκόπηση') + '" src="' + p._url + '">';
      p.hidden = false;
    }
    saveBlob(blob, f.name);
    label(btn, 'download', 'Ξανά κατέβασμα');
  }).catch(function (e) {
    toast(e.message, true);
    label(btn, 'download', 'Κατέβασμα');
  }).then(function () { btn.disabled = false; });
}

// ── Όλες οι κλήσεις ────────────────────────────────────────

function acBase() {
  var f = S.acf, words = searchWords($('ac-search').value);
  return S.adm.leads.filter(function (l) {
    if (f.agent === '__none' && l.owner) return false;
    if (f.agent && f.agent !== '__none' && l.owner !== f.agent) return false;
    if (f.prop && normCode(l.code) !== f.prop) return false;
    return !words.length || matches(words, [l.name, l.phone, l.email, l.code, l.street, l.property, l.owner, l.source]);
  });
}

function fillAcFilters() {
  S.acf.agent = fillOptions($('f-ac-agent'), agentOptions(S.acf.agent, true), S.acf.agent);
  // Ακίνητα με κλήσεις (του μεσίτη που διαλέχτηκε), με τις περισσότερες πρώτα.
  var by = {};
  S.adm.leads.forEach(function (l) {
    var k = normCode(l.code);
    if (!k) return;
    if (S.acf.agent === '__none' ? l.owner : S.acf.agent && l.owner !== S.acf.agent) return;
    if (!by[k]) by[k] = { k: k, n: 0, label: (l.street || l.property || '') + ' · ' + l.code };
    by[k].n++;
  });
  var opts = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label, 'el'); });
  S.acf.prop = fillOptions($('f-ac-prop'), [['', 'Όλα']].concat(opts.map(function (o) { return [o.k, o.label + ' (' + o.n + ')']; })), S.acf.prop);
  filterBadge('ac', (S.acf.agent ? 1 : 0) + (S.acf.prop ? 1 : 0));
}

function aStatusLine(l) {
  if (l.status === ST.PENDING) return 'Νέα κλήση · ' + (l.opened ? 'την άνοιξε' : 'δεν την έχει ανοίξει');
  if (l.status === ST.NO_ANSWER) return 'Δεν απάντησε' + (l.followUp ? ' · ξανά ' + lowerDay(niceDate(l.followUp)) : '');
  if (l.status === ST.SHOWING) {
    if (upcoming(l)) return 'Υπόδειξη ' + lowerDay(niceDate(l.showingAt));
    if (needsOutcome(l)) return 'Η υπόδειξη έγινε · χωρίς αποτέλεσμα';
    return l.outcome ? 'Υπόδειξη · ' + l.outcome : 'Υπόδειξη';
  }
  if (l.status === ST.CLOSED) return 'Κλειστή' + (l.outcome ? ' · ' + l.outcome : '');
  return (l.status || 'Απαντημένη') + (l.called ? ' · μίλησε ' + lowerDay(niceDate(l.called)) : '');
}

function aLeadRow(l, when) {
  var k = STATUS_CLASS[l.status] || 'answered';
  return '<button class="row lead is-' + k + '" data-alead="' + esc(l.id) + '">' +
    '<span class="avatar ' + k + '" aria-hidden="true">' + esc(initials(l.name)) + '</span>' +
    '<span class="row-body"><span class="row-top"><span class="row-name">' + esc(l.name || 'Χωρίς όνομα') + '</span>' +
      (when ? '<span class="row-when">' + esc(when) + '</span>' : '') + '</span>' +
    '<span class="row-prop">' + esc(l.street || l.property) + (l.code ? ', ' + esc(l.code) : '') + '</span>' +
    '<span class="row-status ' + k + '">' + esc(aStatusLine(l)) + '</span>' +
    '<span class="row-owner">' + ico('people') + '<span>' + esc(l.owner || 'Χωρίς μεσίτη') + '</span></span>' +
    '</span></button>';
}

function wireALeadRows(el) {
  el.querySelectorAll('[data-alead]').forEach(function (r) {
    r.onclick = function () { openALead(r.dataset.alead); };
  });
}

function renderACalls() {
  if (!S.adm) return;
  fillAcFilters();
  var base = acBase();
  ['all', 'new', 'followup', 'showing'].forEach(function (t) { $('c-a-' + t).textContent = tabList(base, t).length; });
  setTab('tabs-a-calls', S.acTab);
  var list = tabList(base, S.acTab), el = $('ac-list');
  if (!list.length) {
    var filtered = S.acf.agent || S.acf.prop || $('ac-search').value;
    el.innerHTML = '<div class="empty"><b>Καμία κλήση</b>' + (filtered ? 'Άλλαξε την αναζήτηση ή πάτα «Καθαρισμός φίλτρων».'
      : 'Δεν υπάρχουν κλήσεις εδώ τους τελευταίους 2 μήνες.') + '</div>';
    return;
  }
  var key = 'ac:' + S.acTab;
  el.innerHTML = listMeta(list.length, key, 'κλήση', 'κλήσεις') + groupLeads(pageOf(list, key), S.acTab === 'showing', aLeadRow) +
    pagerHtml(list.length, key);
  wireALeadRows(el);
  wirePager(el, key, renderACalls);
}

function openALead(id) {
  var l = S.adm.leads.filter(function (x) { return x.id === id; })[0];
  if (!l) return;
  S.alead = l;
  $('al-name').textContent = l.name || 'Χωρίς όνομα';
  $('al-sub').textContent = (l.street || l.property) + (l.code ? ' · ' + l.code : '');
  var tag = $('al-status');
  tag.textContent = l.status;
  tag.className = 'tag ' + (STATUS_CLASS[l.status] || 'answered');

  $('al-facts').innerHTML = [
    ['Μεσίτης', l.owner || 'Χωρίς μεσίτη'], ['Τηλέφωνο', l.phone], ['Email', l.email], ['Πηγή', l.source],
    ['Ήρθε', niceDate(l.date)], ['Κωδικός', l.code], ['Συναλλαγή', l.deal], ['Τιμή', fmtPrice(l.price)],
    ['Αποτέλεσμα', l.outcome], ['Έντυπο υπόδειξης', l.form]
  ].filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
  }).join('');

  var ev = [];
  var add = function (stamp, title, sub, tone) {
    var d = typeof stamp === 'number' ? new Date(stamp) : parseStamp(stamp);
    if (d && stamp) ev.push({ d: d, title: title, sub: sub || '', tone: tone || '' });
  };
  add(l.ts || l.date, 'Ήρθε η κλήση', l.source);
  add(l.opened, 'Ο μεσίτης την άνοιξε');
  add(l.sms, 'SMS πρώτης επαφής');
  addCalls(l, function (stamp, title, sub, tone, call) {
    var d = typeof stamp === 'number' ? new Date(stamp) : parseStamp(stamp);
    if (d && stamp) ev.push({ d: d, title: title, sub: sub || '', tone: tone || '', call: call || null });
  }, 'Κάλεσε τον πελάτη');
  if (l.status === ST.NO_ANSWER) add(l.followUp, 'Follow-up');
  if (hasShowing(l)) add(l.showingTs, 'Υπόδειξη', '', 'show');
  if (l.outcome) add(l.showingTs ? l.showingTs + 60000 : null, 'Αποτέλεσμα: ' + l.outcome, l.outcomeNote, 'done');
  ev.sort(function (a, b) { return a.d - b.d; });
  $('al-hist').innerHTML = histHtml(ev, false);

  $('al-msg-wrap').hidden = !l.message;
  $('al-msg').textContent = l.message || '';
  $('al-notes-wrap').hidden = !l.notes;
  $('al-notes').textContent = l.notes || '';
  var p = adminProp(l.code);
  $('al-prop').hidden = !p;
  $('alead').querySelector('.sheet-body').scrollTop = 0;
  openSheet('alead');
}

// ── Ακίνητα όλων, με τα αρχεία τους ────────────────────────

function adminProp(code) {
  var k = normCode(code);
  return k ? ((S.adm && S.adm.props) || []).filter(function (p) { return normCode(p.code) === k; })[0] || null : null;
}

function apList() {
  var f = S.apf, words = searchWords($('ap-search').value);
  return S.adm.props.filter(function (p) {
    if (f.agent && p.partner !== f.agent) return false;
    if (f.status === 'available' && p.available === false) return false;
    if (f.status && f.status !== 'available' && p.status !== f.status) return false;
    return !words.length || matches(words, propFields(p).concat([p.partner]));
  });
}

function fillApFilters() {
  var statuses = {};
  S.adm.props.forEach(function (p) { if (p.available === false && p.status) statuses[p.status] = true; });
  S.apf.agent = fillOptions($('f-ap-agent'), agentOptions(S.apf.agent), S.apf.agent);
  S.apf.status = fillOptions($('f-ap-status'), [['available', 'Διαθέσιμα'], ['', 'Όλες']].concat(Object.keys(statuses).sort(function (a, b) {
    return a.localeCompare(b, 'el');
  }).map(function (x) { return [x, x]; })), S.apf.status);
  filterBadge('ap', (S.apf.agent ? 1 : 0) + (S.apf.status !== 'available' ? 1 : 0));
}

function apRow(p) {
  var sub = [p.type, fmtPrice(p.price), p.code ? 'Κωδικός ' + p.code : ''].filter(Boolean).join(', ');
  return '<button class="row with-thumb' + (p.pending ? ' is-noanswer' : '') + '" data-acode="' + esc(p.code) + '">' + thumbHtml(p.code) +
    '<span class="row-body"><span class="row-name">' + esc(p.street || p.title || p.code) + '</span>' +
    (sub ? '<span class="row-prop">' + esc(sub) + '</span>' : '') +
    '<span class="row-meta">' +
      (p.available === false ? '<span class="tag">' + esc(p.status || 'Μη διαθέσιμο') + '</span>' : '') +
      docsTag(p) +
      (p.pending ? '<span class="tag noanswer">' + p.pending + ' σε έλεγχο</span>' : '') +
      (p.available === false ? '' : mandateTag(p)) +
    '</span>' +
    '<span class="row-owner">' + ico('people') + '<span>' + esc(p.partner) + '</span></span>' +
    '</span><span class="count">' + p.month + '<small>τον μήνα</small></span></button>';
}

function renderAProps() {
  if (!S.adm) return;
  fillApFilters();
  var list = apList(), el = $('ap-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><b>Κανένα ακίνητο</b>Άλλαξε την αναζήτηση ή τα φίλτρα.</div>';
    return;
  }
  var key = 'ap';
  el.innerHTML = listMeta(list.length, key, 'ακίνητο', 'ακίνητα') + pageOf(list, key).map(apRow).join('') + pagerHtml(list.length, key);
  el.querySelectorAll('[data-acode]').forEach(function (r) { r.onclick = function () { openAProp(r.dataset.acode); }; });
  wirePager(el, key, renderAProps);
  wireThumbs(el);
}

function openAProp(code) {
  var p = adminProp(code);
  if (!p) return;
  S.aprop = p;
  $('ap-name').textContent = p.street || p.title || p.code;
  $('ap-sub').textContent = p.title || '';
  var chips = ['<span class="tag ' + (p.available === false ? 'answered' : 'showing') + '">' + esc(p.status || (p.available === false ? 'Μη διαθέσιμο' : 'Διαθέσιμο')) + '</span>'];
  if (p.mandate) chips.push('<span class="tag">' + esc(p.mandate) + '</span>');
  if (p.available !== false) chips.push(mandateTag(p));
  chips.push('<span class="tag closed">' + esc(p.partner) + '</span>');
  $('ap-chips').innerHTML = chips.filter(Boolean).join('');
  $('ap-stats').innerHTML = [[p.week, 'εβδομάδα'], [p.month, 'μήνας'], [p.total, 'σύνολο']].map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>κλήσεις ' + s[1] + '</span></div>';
  }).join('');
  $('ap-facts').innerHTML = [
    ['Κωδικός', p.code], ['Κατάσταση', p.status], ['Τύπος', p.type], ['Περιοχή', p.area], ['Οδός', p.street],
    ['Τιμή', fmtPrice(p.price)], ['Εμβαδόν', p.sqm ? p.sqm + ' τ.μ.' : ''], ['Εντολή', p.mandate],
    ['Λήξη εντολής', p.mandateDays == null ? '' : mandateText(p.mandateDays)], ['Συνεργάτης', p.partner]
  ].filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
  }).join('');

  var leads = S.adm.leads.filter(function (l) { return normCode(l.code) === normCode(p.code); });
  $('ap-leads-count').textContent = leads.length || '';
  $('ap-leads').innerHTML = leads.length ? groupLeads(leads, false, aLeadRow)
    : '<p class="card-note">Καμία κλήση για αυτό το ακίνητο τους τελευταίους 2 μήνες.</p>';
  wireALeadRows($('ap-leads'));
  $('ap-leads-all').hidden = !leads.length;

  setTab('tabs-aprop', 'files');
  showPane('aprop-panes', 'files');
  loadAFiles(p);
  loadMedia('ap', p);
  $('aprop').querySelector('.sheet-body').scrollTop = 0;
  openSheet('aprop');
}

function loadAFiles(p) {
  var cached = S.afiles[p.code];
  renderAFiles(p, cached || null, !cached);
  api('adminFiles', { code: p.code }).then(function (res) {
    S.afiles[p.code] = res;
    if (S.aprop && S.aprop.code === p.code) renderAFiles(p, res, false);
  }).catch(function (e) {
    if (S.aprop && S.aprop.code === p.code && !cached) {
      $('ap-files').innerHTML = '<p class="save-hint err">Δεν φορτώθηκαν τα αρχεία: ' + esc(e.message) + '</p>';
    }
  });
}

function fileRow(f) {
  var rv = f.review;
  var tone = !rv ? '' : rv.status === RV_ST.OK ? 'ok' : rv.status === RV_ST.FIX ? 'bad' : 'warn';
  var img = /^image\//.test(f.mime);
  return '<button class="mrow" data-file="' + esc(f.id) + '"><span class="mrow-ico ' + tone + '">' + ico(img ? 'upload' : 'form') + '</span>' +
    '<span class="mrow-body"><b>' + esc(f.name) + '</b>' +
    '<span>' + esc([niceDate(f.date), fmtSize(f.size)].filter(Boolean).join(' · ')) + '</span>' +
    '<span class="file-st"><i class="tag ' + (rv ? rvTagClass(rv.status) : 'answered') + '">' + esc(rv ? rvShort(rv.status) : 'Χωρίς έλεγχο') + '</i></span>' +
    '</span>' + ico('next', 'ico chev') + '</button>';
}

function renderAFiles(p, res, loading) {
  var el = $('ap-files');
  $('ap-files-count').textContent = res ? res.total || '' : '';
  $('ap-zip').hidden = !res || !res.total;
  $('ap-folder').hidden = !res || !res.folderUrl;
  if (res && res.folderUrl) $('ap-folder').href = res.folderUrl;
  if (loading || !res) { el.innerHTML = skel(3); return; }
  if (!res.groups.length) {
    el.innerHTML = '<div class="empty small"><b>Χωρίς αρχεία</b>' + (res.folderUrl
      ? 'Ο φάκελος του ακινήτου στο Drive είναι άδειος.' : 'Δεν έχει φτιαχτεί ακόμα φάκελος στο Drive για αυτό το ακίνητο.') + '</div>';
    return;
  }
  el.innerHTML = res.groups.map(function (g) {
    return '<h3 class="sub-head files-head">' + esc(g.name) + ' <small>' + g.files.length + '</small></h3>' +
      '<div class="mlist">' + g.files.map(fileRow).join('') + '</div>';
  }).join('');
  el.querySelectorAll('[data-file]').forEach(function (b) {
    b.onclick = function () {
      var f = null;
      res.groups.forEach(function (g) { g.files.forEach(function (x) { if (x.id === b.dataset.file) f = x; }); });
      if (!f) return;
      var known = f.review ? findReview(f.review.id) : null;
      openReview({
        id: f.review ? f.review.id : '', fileId: f.id, url: f.url, title: f.title, name: f.name,
        kind: f.kind, kindLabel: RV_KIND_LABEL[f.kind], code: p.code, street: p.street, agent: res.agent || p.partner,
        date: f.date, size: f.size, mime: f.mime,
        status: f.review ? f.review.status : '', note: f.review ? f.review.note : '',
        at: f.review ? f.review.at : '', by: known ? known.by : ''
      });
    };
  });
}

function onZip() {
  var p = S.aprop, btn = $('ap-zip');
  if (!p) return;
  btn.disabled = true;
  label(btn, 'download', 'Ετοιμάζεται το zip…');
  api('adminZip', { code: p.code }).then(function (z) {
    saveBlob(b64Blob(z.data, z.mime), z.name);
    toast(plural(z.count, 'αρχείο', 'αρχεία') + ' στο zip' + (z.skipped ? '. ' + plural(z.skipped, 'έμεινε έξω', 'έμειναν έξω') + ' λόγω μεγέθους.' : ''));
  }).catch(function (e) { toast(e.message, true); }).then(function () {
    btn.disabled = false;
    label(btn, 'download', 'Κατέβασμα όλων (zip)');
  });
}

// ── Άλλα (Admin) ───────────────────────────────────────────

function renderAMore() {
  var me = S.me || {};
  fillInitials();
  $('a-more-name').textContent = me.name || '';
  $('a-more-sub').textContent = ['Admin', S.boot && S.boot.office && S.boot.office.name].filter(Boolean).join(' · ');
  if (!S.adm) return;
  var el = $('a-team');
  el.innerHTML = S.adm.agents.map(function (a) {
    var props = S.adm.props.filter(function (p) { return p.partner === a.name && p.available !== false; }).length;
    var leads = S.adm.leads.filter(function (l) { return l.owner === a.name; });
    var open = leads.filter(isOpen).length;
    return '<button class="mrow" data-agent="' + esc(a.name) + '"><span class="avatar" aria-hidden="true">' + esc(initials(a.name)) + '</span>' +
      '<span class="mrow-body"><b>' + esc(a.name) + (a.active === false ? ' <span class="tag">Ανενεργός</span>' : '') + '</b>' +
      '<span>' + esc(plural(props, 'διαθέσιμο ακίνητο', 'διαθέσιμα ακίνητα') + ' · ' + plural(leads.length, 'κλήση', 'κλήσεις')) +
      (open ? ' · <em class="hot">' + open + ' ανοιχτές</em>' : '') + '</span></span>' + ico('next', 'ico chev') + '</button>';
  }).join('') || '<p class="card-note">Δεν υπάρχουν μεσίτες στο φύλλο Agents.</p>';
  el.querySelectorAll('[data-agent]').forEach(function (b) {
    b.onclick = function () {
      S.acf = { agent: b.dataset.agent, prop: '' };
      S.acTab = 'all';
      resetPage('ac');
      goto('a-calls');
    };
  });
}

function wireAdmin() {
  $$('[data-mode-to]').forEach(function (b) { b.onclick = function () { setMode(b.dataset.modeTo); }; });
  wireTabs('tabs-a-review', 'rv-list', function (v) { S.rvTab = v; resetPage('rv'); renderReviews(); window.scrollTo(0, 0); });
  wireTabs('tabs-a-calls', 'ac-list', function (v) { S.acTab = v; resetPage('ac'); renderACalls(); window.scrollTo(0, 0); });
  wireTabs('tabs-aprop', 'aprop-panes', function (v) { showPane('aprop-panes', v); });
  wireSearch('rv-search', function () { resetPage('rv'); renderReviews(); });
  wireSearch('ac-search', function () { resetPage('ac'); renderACalls(); });
  wireSearch('ap-search', function () { resetPage('ap'); renderAProps(); });
  wireFilters('rv', function () { S.rvf = { agent: '', kind: '' }; resetPage('rv'); renderReviews(); });
  wireFilters('ac', function () { S.acf = { agent: '', prop: '' }; resetPage('ac'); renderACalls(); });
  wireFilters('ap', function () { S.apf = { agent: '', status: 'available' }; resetPage('ap'); renderAProps(); });
  $('f-rv-agent').onchange = function () { S.rvf.agent = this.value; resetPage('rv'); renderReviews(); };
  $('f-rv-kind').onchange = function () { S.rvf.kind = this.value; resetPage('rv'); renderReviews(); };
  $('f-ac-agent').onchange = function () { S.acf.agent = this.value; S.acf.prop = ''; resetPage('ac'); renderACalls(); };
  $('f-ac-prop').onchange = function () { S.acf.prop = this.value; resetPage('ac'); renderACalls(); };
  $('f-ap-agent').onchange = function () { S.apf.agent = this.value; resetPage('ap'); renderAProps(); };
  $('f-ap-status').onchange = function () { S.apf.status = this.value; resetPage('ap'); renderAProps(); };

  $('review-back').onclick = function () { closeSheet('review'); clearPreview(); };
  $('aprop-back').onclick = function () { closeSheet('aprop'); S.aprop = null; };
  $('alead-back').onclick = function () { closeSheet('alead'); };
  $('rv-ok').onclick = function () { rvDecide('ok'); };
  $('rv-fix-open').onclick = function () { showFixBox(true); };
  $('rv-fix-send').onclick = function () { rvDecide('fix'); };
  $('rv-download').onclick = onRvDownload;
  $('ap-zip').onclick = onZip;
  $('ap-leads-all').onclick = function () {
    var p = S.aprop;
    closeSheet('aprop');
    S.aprop = null;
    S.acf = { agent: '', prop: normCode(p.code) };
    S.acTab = 'all';
    resetPage('ac');
    goto('a-calls');
  };
  $('al-prop').onclick = function () {
    var l = S.alead;
    closeSheet('alead');
    if (l) openAProp((adminProp(l.code) || {}).code);
  };
}

// ── Για τον μεσίτη: «Θέλει διόρθωση» ───────────────────────

function fixGoLabel(r) {
  if (r.kind === 'live' || r.kind === 'bill') return 'Ανέβασε το σωστό αρχείο';
  if (r.kind === 'showform' || r.kind === 'offerform') return 'Άνοιγμα της κλήσης';
  if (r.kind === 'referral') return 'Οι συστάσεις μου';
  return 'Άνοιγμα';
}

function openFix(id) {
  var r = ((S.boot && S.boot.reviews) || []).filter(function (x) { return x.id === id; })[0];
  if (!r) { toast('Το έντυπο έχει ήδη διορθωθεί.'); return; }
  var where = r.street || (r.code ? 'Κωδικός ' + r.code : '');
  choose('Θέλει διόρθωση · ' + r.title,
    (where ? where + '\n' : '') + 'Σχόλιο' + (r.by ? ' από ' + r.by : '') + ':\n«' + r.note + '»', [
      { key: 'go', label: fixGoLabel(r), cls: 'solid-red' },
      { key: 'seen', label: 'Το είδα, θα το κάνω μετά' },
      { key: null, label: 'Πίσω' }
    ]).then(function (k) {
    if (k === 'go') goFix(r);
    if (k === 'seen') {
      S.boot.reviews = S.boot.reviews.filter(function (x) { return x.id !== r.id; });
      renderToday();
      api('reviewSeen', { id: r.id }).then(function (list) { S.boot.reviews = list || []; renderToday(); })
        .catch(function (e) { toast(e.message, true); });
    }
  });
}

function goFix(r) {
  if (r.kind === 'live' || r.kind === 'bill') {
    var p = S.props.filter(function (x) { return x.mine && normCode(x.code) === normCode(r.code); })[0];
    if (!p) { toast('Το ακίνητο δεν είναι πια στα δικά σου.', true); return; }
    S.propPane = 'docs';
    openProp(p.code);
    if (r.kind === 'bill') {
      setTab('tabs-prop', 'bill');
      showPane('prop-panes', 'bill');
      S.propPane = 'bill';
      loadDocs(p, 'bill');
    }
    return;
  }
  if (r.kind === 'showform' && r.lead) return openLead(r.lead, { form: true });
  if (r.kind === 'offerform' && r.lead) return openLead(r.lead, { offer: true });
  if (r.kind === 'referral') return goto('referrals');
}

/** Από ειδοποίηση: go:review:ID. Φρέσκια λίστα, γιατί μπορεί να ήρθε μόλις. */
function routeReview(id) {
  if (isAdminMode() && roles().agent) setMode('agent', true);
  var known = ((S.boot && S.boot.reviews) || []).some(function (x) { return x.id === id; });
  if (known) return openFix(id);
  api('bootstrap').then(function (b) {
    S.boot.reviews = b.reviews || [];
    if (S.view === 'today') renderToday();
    openFix(id);
  }).catch(function (e) { toast(e.message, true); });
}

// ─────────────────────────────────────────────────────────────
//  ΦΩΤΟΓΡΑΦΙΕΣ ΑΚΙΝΗΤΟΥ (1.18)
//  Φάκελος MEDIA στο Drive. Εξώφυλλο πάνω στο ακίνητο, μικρή εικόνα στη λίστα,
//  carousel με όλες. Οι εικόνες έρχονται μέσα από την εφαρμογή (data: URI),
//  σε μέγεθος s (λίστα), m (εξώφυλλο), l (carousel), και κρατιούνται στη μνήμη.
// ─────────────────────────────────────────────────────────────

S.media = {};        // κωδικός → { photos, cover, canEdit, … }
S.imgs = {};         // 'id:s|m|l' → data URI
S.covers = {};       // κωδικός → data URI ή '' (χωρίς φωτογραφία)
S.coverReq = {};
S.gal = null;

function cssq(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'); }

// ── Μικρή εικόνα στη λίστα ακινήτων ────────────────────────

function thumbHtml(code) {
  return '<span class="row-thumb" data-thumb="' + esc(code) + '" aria-hidden="true">' + ico('home') + '</span>';
}

function paintThumb(el, src) {
  if (!src) { el.classList.remove('has-img'); return; }
  if (el.classList.contains('has-img')) return;
  el.classList.add('has-img');
  el.innerHTML = '<img alt="" src="' + src + '">';
}

function wireThumbs(root) {
  var need = [];
  root.querySelectorAll('[data-thumb]').forEach(function (t) {
    var c = t.dataset.thumb;
    if (S.covers[c] !== undefined) paintThumb(t, S.covers[c]);
    else if (need.indexOf(c) === -1) need.push(c);
  });
  fetchCovers(need);
}

/** Σε ομάδες των 8, μία-μία, για να μη βαραίνει ο server. Ό,τι δεν πρόλαβε ξαναζητιέται. */
function fetchCovers(codes) {
  codes = codes.filter(function (c) { return !S.coverReq[c]; });
  if (!codes.length) return;
  codes.forEach(function (c) { S.coverReq[c] = true; });
  var chunks = [];
  for (var i = 0; i < codes.length; i += 8) chunks.push(codes.slice(i, i + 8));
  chunks.reduce(function (pr, chunk) {
    return pr.then(function () {
      return api('covers', { codes: chunk }).then(function (r) {
        Object.keys(r.covers || {}).forEach(function (c) {
          S.covers[c] = r.covers[c] || '';
          $$('[data-thumb="' + cssq(c) + '"]').forEach(function (t) { paintThumb(t, S.covers[c]); });
        });
        (r.pending || []).forEach(function (c) { S.coverReq[c] = false; });
        chunk.forEach(function (c) { if (S.covers[c] === undefined) S.covers[c] = ''; });
      }).catch(function () { chunk.forEach(function (c) { S.coverReq[c] = false; }); });
    });
  }, Promise.resolve());
}

function forgetCover(code) {
  delete S.covers[code];
  S.coverReq[code] = false;
}

// ── Εξώφυλλο μέσα στο ακίνητο ──────────────────────────────

/** prefix: 'pd' (μεσίτης) ή 'ap' (Admin). */
function resetHero(prefix, code) {
  var hero = $(prefix + '-hero');
  var low = S.covers[code];
  hero.hidden = !low;
  $(prefix + '-hero-img').src = low || '';
  $(prefix + '-hero-count').textContent = '';
  if (prefix === 'pd') { $('pd-photo-empty').hidden = true; $('pd-photo-add').hidden = true; $('pd-photo-progress').hidden = true; }
}

function loadMedia(prefix, p) {
  var code = p.code;
  resetHero(prefix, code);
  if (S.media[code]) renderHero(prefix, code);
  api('media', { code: code }).then(function (r) {
    if (!r || !r.photos) return;     // παλιός server
    S.media[code] = r;
    if (r.cover && r.coverData) S.imgs[r.cover + ':m'] = r.coverData;
    if (heroCode(prefix) === code) renderHero(prefix, code);
  }).catch(function () { /* χωρίς φωτογραφίες, η οθόνη μένει όπως ήταν */ });
}

function heroCode(prefix) {
  var p = prefix === 'pd' ? S.prop : S.aprop;
  return p ? p.code : null;
}

function renderHero(prefix, code) {
  var r = S.media[code];
  if (!r || !r.photos) return;
  var n = r.photos.length;
  var hero = $(prefix + '-hero');
  hero.hidden = !n;
  if (prefix === 'pd') {
    $('pd-photo-empty').hidden = !!n || !r.canEdit || !!S.mediaBusy;
    $('pd-photo-add').hidden = !n || !r.canEdit;
  }
  if (!n) return;
  $(prefix + '-hero-count').innerHTML = ico('camera') + '<span>' + plural(n, 'φωτογραφία', 'φωτογραφίες') + '</span>';
  var src = S.imgs[r.cover + ':m'] || S.covers[code] || '';
  $(prefix + '-hero-img').src = src;
  if (!S.imgs[r.cover + ':m']) {
    api('mediaImg', { code: code, id: r.cover, size: 'm' }).then(function (x) {
      S.imgs[r.cover + ':m'] = x.src;
      if (heroCode(prefix) === code && S.media[code].cover === r.cover) $(prefix + '-hero-img').src = x.src;
    }).catch(function () {});
  }
}

// ── Ανέβασμα από το κινητό ─────────────────────────────────

function pickPhotos() {
  $('media-input').value = '';
  $('media-input').click();
}

/** Σμίκρυνση στο κινητό (έως 2000px), μετά ανέβασμα μία-μία. Η πρόοδος φαίνεται πάνω στην οθόνη. */
function onMediaFiles(e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  var p = S.prop;
  if (!files.length || !p) return;
  var code = p.code, total = files.length, done = 0, failed = [];
  var prog = $('pd-photo-progress');
  S.mediaBusy = true;
  $('pd-photo-empty').hidden = true;
  var show = function () {
    prog.hidden = false;
    prog.innerHTML = '<span class="spin-dot" aria-hidden="true"></span>Ανεβαίνει ' + (done + failed.length + 1) + ' από ' + total + '…';
  };
  files.reduce(function (pr, file) {
    return pr.then(function () {
      show();
      return shrinkPhoto(file).then(function (f) {
        if (f.size > (S.media[code] && S.media[code].max || 15) * 1048576) throw new Error('πολύ μεγάλη');
        return toBase64(f.blob).then(function (data) {
          return api('mediaUpload', { code: code, name: f.name, mime: f.type, data: data });
        });
      }).then(function (r) {
        done++;
        S.media[code] = r;
        if (r.cover && r.coverData) S.imgs[r.cover + ':m'] = r.coverData;
        if (heroCode('pd') === code) renderHero('pd', code);
      }).catch(function () { failed.push(file.name); });
    });
  }, Promise.resolve()).then(function () {
    S.mediaBusy = false;
    prog.hidden = true;
    forgetCover(code);
    if (heroCode('pd') === code) renderHero('pd', code);
    if (S.view === 'props') renderProps();
    toast(done ? 'Ανέβηκ' + (done === 1 ? 'ε 1 φωτογραφία' : 'αν ' + done + ' φωτογραφίες') + (failed.length ? '. Δεν ανέβηκαν ' + failed.length + '.' : '')
               : 'Δεν ανέβηκε καμία φωτογραφία.', !done);
  });
}

/** Όπως το shrink των εγγράφων, αλλά πάντα σε JPEG έως 2000px (και τις μικρές). */
function shrinkPhoto(file) {
  var keep = { blob: file, name: file.name, type: file.type || 'image/jpeg', size: file.size };
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 2000, w = img.naturalWidth, h = img.naturalHeight;
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) {
        if (!b || (b.size >= file.size && /jpe?g$/i.test(file.type))) return resolve(keep);
        resolve({ blob: b, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', size: b.size });
      }, 'image/jpeg', 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(keep); };   // π.χ. HEIC σε Android: πάει όπως είναι
    img.src = url;
  });
}

// ── Carousel ───────────────────────────────────────────────

function openGallery(code) {
  var r = S.media[code];
  if (!r || !r.photos.length) return;
  var start = Math.max(0, r.photos.map(function (x) { return x.id; }).indexOf(r.cover));
  S.gal = { code: code, i: -1 };
  buildGallery(start);
  $('gallery').hidden = false;
  document.body.classList.add('gal-open');
  $('gal-close').focus();
}

function buildGallery(start) {
  var r = S.media[S.gal.code];
  $('gal-track').innerHTML = r.photos.map(function (ph, i) {
    var src = S.imgs[ph.id + ':l'] || S.imgs[ph.id + ':m'] || S.imgs[ph.id + ':s'] || '';
    return '<div class="gal-slide" data-i="' + i + '"><img alt="Φωτογραφία ' + (i + 1) + ' από ' + r.photos.length + '"' +
      (src ? ' src="' + src + '"' : '') + '><span class="gal-load" aria-hidden="true"></span></div>';
  }).join('');
  $('gal-thumbs').innerHTML = r.photos.map(function (ph, i) {
    var src = S.imgs[ph.id + ':s'] || '';
    return '<button class="gal-thumb" data-i="' + i + '" aria-label="Φωτογραφία ' + (i + 1) + '">' +
      (src ? '<img alt="" src="' + src + '">' : '') + (ph.id === r.cover ? '<i class="gal-star" aria-hidden="true">★</i>' : '') + '</button>';
  }).join('');
  $('gal-thumbs').querySelectorAll('[data-i]').forEach(function (b) {
    b.onclick = function () { galGo(+b.dataset.i, true); };
  });
  $('gal-actions').hidden = !r.canEdit || isAdminMode();     // στο Admin μόνο προβολή
  $('gal-prev').hidden = $('gal-next').hidden = r.photos.length < 2;
  S.gal.i = -1;
  requestAnimationFrame(function () {
    var t = $('gal-track');
    t.scrollLeft = start * t.clientWidth;
    galSet(start);
  });
  galThumbs();
}

function galSet(i) {
  var r = S.media[S.gal.code];
  if (!r) return;
  i = Math.max(0, Math.min(r.photos.length - 1, i));
  if (S.gal.i === i) return;
  S.gal.i = i;
  $('gal-count').textContent = (i + 1) + ' / ' + r.photos.length;
  $('gal-prev').disabled = i === 0;
  $('gal-next').disabled = i === r.photos.length - 1;
  $$('#gal-thumbs .gal-thumb').forEach(function (b, k) {
    b.classList.toggle('is-on', k === i);
    if (k === i && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  var isCover = r.photos[i].id === r.cover;
  $('gal-cover').disabled = isCover;
  label($('gal-cover'), 'star', isCover ? 'Εξώφυλλο' : 'Κάνε εξώφυλλο');
  [i, i + 1, i - 1].forEach(galLoad);
}

function galLoad(i) {
  var r = S.media[S.gal.code];
  var ph = r && r.photos[i];
  if (!ph) return;
  var key = ph.id + ':l';
  var slide = $('gal-track').querySelector('[data-i="' + i + '"]');
  if (S.imgs[key]) { slide.querySelector('img').src = S.imgs[key]; slide.classList.add('is-ready'); return; }
  if (S.gal['l' + i]) return;
  S.gal['l' + i] = true;
  var code = S.gal.code;
  api('mediaImg', { code: code, id: ph.id, size: 'l' }).then(function (x) {
    S.imgs[key] = x.src;
    if (!S.gal || S.gal.code !== code) return;
    var s = $('gal-track').querySelector('[data-i="' + i + '"]');
    if (s) { s.querySelector('img').src = x.src; s.classList.add('is-ready'); }
  }).catch(function () {
    if (S.gal) S.gal['l' + i] = false;
    if (slide) slide.classList.add('is-error');
  });
}

/** Οι μικρές εικόνες της λωρίδας, όλες μαζί σε ένα αίτημα. */
function galThumbs() {
  var code = S.gal.code, r = S.media[code];
  var ids = r.photos.map(function (x) { return x.id; }).filter(function (id) { return !S.imgs[id + ':s']; });
  if (!ids.length) return;
  api('mediaImg', { code: code, ids: ids, size: 's' }).then(function (x) {
    (x.items || []).forEach(function (it) {
      if (!it.src) return;
      S.imgs[it.id + ':s'] = it.src;
      if (!S.gal || S.gal.code !== code) return;
      var k = r.photos.map(function (p) { return p.id; }).indexOf(it.id);
      var b = $('gal-thumbs').querySelector('[data-i="' + k + '"]');
      if (b && !b.querySelector('img')) b.insertAdjacentHTML('afterbegin', '<img alt="" src="' + it.src + '">');
      var sl = $('gal-track').querySelector('[data-i="' + k + '"] img');
      if (sl && !sl.getAttribute('src')) sl.src = it.src;
    });
    if (x.pending && x.pending.length && S.gal && S.gal.code === code) galThumbs();
  }).catch(function () {});
}

function galGo(i, jump) {
  var t = $('gal-track');
  t.scrollTo({ left: i * t.clientWidth, behavior: jump && reduceMotion() ? 'auto' : 'smooth' });
  galSet(i);
}

function reduceMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

function closeGallery() {
  $('gallery').hidden = true;
  document.body.classList.remove('gal-open');
  $('gal-track').innerHTML = '';
  S.gal = null;
}

function galCover() {
  var g = S.gal, r = g && S.media[g.code];
  if (!r) return;
  var at = g.i, id = r.photos[at].id;
  $('gal-cover').disabled = true;
  api('mediaCover', { code: g.code, id: id }).then(function (x) {
    S.media[g.code] = x;
    if (x.cover && x.coverData) S.imgs[x.cover + ':m'] = x.coverData;
    forgetCover(g.code);
    if (heroCode('pd') === g.code) renderHero('pd', g.code);
    if (S.gal) buildGallery(S.gal.i >= 0 ? S.gal.i : at);   // όπου βρίσκεται τώρα ο μεσίτης
    toast('Έγινε εξώφυλλο ✓');
  }).catch(function (e) { toast(e.message, true); $('gal-cover').disabled = false; });
}

function galDelete() {
  var g = S.gal, r = g && S.media[g.code];
  if (!r) return;
  var at = g.i, ph = r.photos[at];
  ask('Να διαγραφεί η φωτογραφία;', 'Θα σβηστεί από τον φάκελο MEDIA του ακινήτου. Αν ήταν λάθος, ανακτάται από τον κάδο του Drive για 30 ημέρες.',
      'Ναι, διαγραφή').then(function (yes) {
    if (!yes) return;
    api('mediaDelete', { code: g.code, id: ph.id }).then(function (x) {
      S.media[g.code] = x;
      if (x.cover && x.coverData) S.imgs[x.cover + ':m'] = x.coverData;
      forgetCover(g.code);
      if (heroCode('pd') === g.code) renderHero('pd', g.code);
      if (!x.photos.length) closeGallery();
      else if (S.gal) buildGallery(Math.min(at, x.photos.length - 1));
      toast('Διαγράφηκε');
    }).catch(function (e) { toast(e.message, true); });
  });
}

function wireMedia() {
  $('media-input').onchange = onMediaFiles;
  $('pd-photo-empty').onclick = pickPhotos;
  $('pd-photo-add').onclick = pickPhotos;
  $('pd-hero-open').onclick = function () { if (S.prop) openGallery(S.prop.code); };
  $('ap-hero-open').onclick = function () { if (S.aprop) openGallery(S.aprop.code); };
  $('gal-close').onclick = closeGallery;
  $('gal-prev').onclick = function () { galGo(S.gal.i - 1); };
  $('gal-next').onclick = function () { galGo(S.gal.i + 1); };
  $('gal-cover').onclick = galCover;
  $('gal-del').onclick = galDelete;
  var t = $('gal-track'), timer = null;
  t.addEventListener('scroll', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (S.gal) galSet(Math.round(t.scrollLeft / Math.max(1, t.clientWidth))); }, 60);
  }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (!S.gal) return;
    if (e.key === 'ArrowRight') galGo(S.gal.i + 1);
    if (e.key === 'ArrowLeft') galGo(S.gal.i - 1);
    if (e.key === 'Escape') closeGallery();
  });
}

// ─────────────────────────────────────────────────────────────
//  ΠΑΡΟΥΣΙΑΣΗ ΣΤΟΝ ΠΕΛΑΤΗ (1.19)
//  Το link φτιάχνεται μόλις ανοίξει το παράθυρο, ώστε το WhatsApp να είναι
//  κανονικός σύνδεσμος (το iPhone μπλοκάρει ό,τι ανοίγει μετά από αναμονή).
//  Κινητό και email του πελάτη ΔΕΝ αποθηκεύονται: χρησιμοποιούνται μόνο για την αποστολή.
// ─────────────────────────────────────────────────────────────

S.pres = null;

function intlPhone(v) {
  var d = String(v || '').replace(/[^\d+]/g, '');
  if (d.indexOf('+') === 0) return d.slice(1);
  if (d.indexOf('00') === 0) return d.slice(2);
  if (/^(69|2)\d{8}$/.test(d)) return '30' + d;
  return d;
}

function presText() {
  var pr = S.pres, p = pr && pr.p;
  if (!pr || !pr.link) return '';
  var me = S.me || {}, name = $('pr-name').value.trim();
  return (name ? 'Καλησπέρα ' + name + ', σ' : 'Σ') + 'ας στέλνω την παρουσίαση του ακινήτου «' + (p.title || p.street || p.code) + '»' +
    (p.price ? ' (' + fmtPrice(p.price) + ')' : '') + ' με όλες τις φωτογραφίες:\n' + pr.link.url + '\n\n' +
    (me.smsName || me.name || '') + (me.phone ? ' · ' + me.phone : '') + '\n' + ((S.boot && S.boot.office && S.boot.office.name) || 'KW Athens Center');
}

function presRefresh() {
  var pr = S.pres, ready = !!(pr && pr.link);
  ['pr-wa', 'pr-copy', 'pr-preview'].forEach(function (id) { $(id).classList.toggle('is-wait', !ready); });
  if (!ready) return;
  var phone = intlPhone($('pr-phone').value);
  $('pr-wa').href = 'https://wa.me/' + (phone.length >= 10 ? phone : '') + '?text=' + encodeURIComponent(presText());
  $('pr-preview').href = pr.link.url;
}

/** p: ακίνητο της λίστας. lead (προαιρετικά): στοιχεία από την κλήση, μόνο για να γεμίσουν τα πεδία. */
function openPresent(p, lead) {
  if (!p) return;
  S.pres = { p: p, leadId: lead ? lead.id : '', link: null };
  var cover = S.covers[p.code] || (S.media[p.code] && S.imgs[S.media[p.code].cover + ':m']) || '';
  $('pr-card').innerHTML = (cover ? '<img alt="" src="' + cover + '">' : '<span class="pr-noimg">' + ico('home') + '</span>') +
    '<span class="pr-card-body"><b>' + esc(p.title || p.street || p.code) + '</b><span>' +
    esc([fmtPrice(p.price), p.sqm ? p.sqm + ' τ.μ.' : '', p.area].filter(Boolean).join(' · ')) + '</span></span>';
  $('pr-name').value = lead && lead.name ? String(lead.name).split(' ')[0] : '';
  $('pr-phone').value = lead && lead.phone || '';
  $('pr-email').value = lead && lead.email || '';
  $('pr-hint').textContent = 'Ετοιμάζεται το link…';
  $('pr-hint').className = 'field-hint';
  presRefresh();
  openPop('present');
  api('presCreate', { code: p.code, leadId: S.pres.leadId }).then(function (r) {
    if (!S.pres || S.pres.p.code !== p.code) return;
    S.pres.link = r;
    $('pr-hint').textContent = 'Ισχύει ' + r.days + ' ημέρες. Θα πάρεις ειδοποίηση μόλις το ανοίξει ο πελάτης.';
    presRefresh();
  }).catch(function (e) {
    $('pr-hint').textContent = 'Δεν φτιάχτηκε το link: ' + e.message;
    $('pr-hint').className = 'field-hint err';
  });
}

function presMark(channel) {
  if (S.pres && S.pres.link) api('presMark', { id: S.pres.link.id, channel: channel }).catch(function () {});
}

function presEmail() {
  var pr = S.pres, btn = $('pr-mail');
  var email = $('pr-email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('pr-email').classList.add('is-bad');
    $('pr-email').focus();
    toast('Γράψε το email του πελάτη.', true);
    return;
  }
  $('pr-email').classList.remove('is-bad');
  btn.disabled = true;
  label(btn, 'mail', 'Αποστέλλεται…');
  api('presCreate', { code: pr.p.code, leadId: pr.leadId, channel: 'email', email: email, name: $('pr-name').value.trim() })
    .then(function () {
      toast('Στάλθηκε στο ' + email);
      closePop('present');
    }).catch(function (e) { toast(e.message, true); })
    .then(function () { btn.disabled = false; label(btn, 'mail', 'Αποστολή με email'); });
}

function wirePresent() {
  $('pr-phone').oninput = presRefresh;
  $('pr-name').oninput = presRefresh;
  $('pr-wa').onclick = function (e) {
    if (!S.pres || !S.pres.link) { e.preventDefault(); return; }
    presMark('whatsapp');
  };
  $('pr-copy').onclick = function () {
    if (!S.pres || !S.pres.link) return;
    var t = presText();
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
      toast('Αντιγράφηκε. Επικόλλησέ το σε Viber, Messenger ή όπου θέλεις.');
      presMark('copy');
    }).catch(function () { toast(S.pres.link.url); });
  };
  $('pr-preview').onclick = function (e) { if (!S.pres || !S.pres.link) e.preventDefault(); };
  $('pr-mail').onclick = presEmail;
  $('pd-present').onclick = function () { openPresent(S.prop); };
  $('btn-lead-present').onclick = function () {
    var l = S.lead;
    var p = l && S.props.filter(function (x) { return normCode(x.code) === normCode(l.code); })[0];
    if (!p) return toast('Το ακίνητο της κλήσης δεν είναι στη λίστα.', true);
    openPresent(p, l);
  };
}

// ─────────────────────────────────────────────────────────────
//  ΒΟΗΘΗΤΙΚΑ
// ─────────────────────────────────────────────────────────────

function pad(n) { return ('0' + n).slice(-2); }

function nowStamp() {
  var d = new Date();
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 440000 → «440.000 €». Κείμενο μένει όπως είναι. */
function fmtPrice(v) {
  if (v === '' || v == null) return '';
  var n = Number(String(v).replace(/[^\d.]/g, ''));
  if (!n) return String(v);
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
}

// ─────────────────────────────────────────────────────────────
//  ΜΕΤΡΗΣΙΜΟΤΗΤΑ (1.5)
//  Τα νούμερα έρχονται έτοιμα ανά μήνα από τον server (action 'metrics').
//  Εδώ γίνεται μόνο η εμφάνιση: μήνας ή έτος, σύγκριση με τον προηγούμενο.
// ─────────────────────────────────────────────────────────────

function loadMetrics(force) {
  if (S.mxLoading || (S.mx && !force)) { if (S.mx) renderMetrics(); return; }
  S.mxLoading = true;
  if (!S.mx) $('mx-body').innerHTML = skel(5);
  $('mx-refresh').disabled = true;
  api('metrics', force ? { refresh: 1 } : {}).then(function (d) {
    S.mx = d;
    var withData = (d.months || []).filter(function (m) { return m.weeks.length; });
    if (!S.mxMonth || !monthOf(S.mxMonth)) S.mxMonth = withData.length ? withData[0].ym : '';
    if (!S.mxYear) S.mxYear = S.mxMonth.slice(0, 4);
    renderMetrics();
    if (force) toast('Ενημερώθηκε');
  }).catch(function (e) {
    if (!S.mx) {
      $('mx-body').innerHTML = '<div class="empty"><b>Δεν φορτώθηκε</b>' + esc(e.message) + '</div>';
      $('more-mx').innerHTML = '<span class="card-note">Δεν φορτώθηκαν οι μετρήσεις.</span>';
    }
    else toast(e.message, true);
  }).then(function () { S.mxLoading = false; $('mx-refresh').disabled = false; });
}

function monthOf(ym) {
  return ((S.mx && S.mx.months) || []).filter(function (m) { return m.ym === ym; })[0] || null;
}

function prevYm(ym) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
  if (m === 0) { y--; m = 12; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function mxYears() {
  var seen = {};
  (S.mx.months || []).forEach(function (m) { seen[m.ym.slice(0, 4)] = true; });
  return Object.keys(seen).sort().reverse();
}

/** dir = +1 → παλαιότερο, -1 → νεότερο. */
function stepMetrics(dir) {
  if (!S.mx) return;
  if (S.mxMode === 'year') {
    var ys = mxYears(), i = ys.indexOf(S.mxYear) + dir;
    if (i >= 0 && i < ys.length) S.mxYear = ys[i];
  } else {
    var ms = S.mx.months, j = ms.indexOf(monthOf(S.mxMonth)) + dir;
    if (j >= 0 && j < ms.length) S.mxMonth = ms[j].ym;
  }
  S.mxOpen = '';
  renderMetrics();
}

function deltaHtml(now, before, neutral) {
  if (before == null) return '<span class="delta"></span>';
  var d = now - before;
  if (!d) return '<span class="delta" title="Ίδιο με τον προηγούμενο μήνα">=</span>';
  return '<span class="delta ' + (neutral ? '' : d > 0 ? 'up' : 'down') + '" title="Σε σχέση με τον προηγούμενο μήνα">' +
         (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + '</span>';
}

function fmtNum(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }

function sumGroup(values, group) {
  return S.mx.metrics.filter(function (m) { return m.group === group; })
    .reduce(function (a, m) { return a + (values[m.key] || 0); }, 0);
}

/** Ραντεβού, Υποδείξεις, Αναθέσεις & εντολές: τιμή μήνα και προηγούμενου (ή null). */
function mxTiles(v, pv) {
  var appts = function (x) { return sumGroup(x, 'owners') + sumGroup(x, 'clients') - (x.ilist || 0); };
  return [
    { label: 'Ραντεβού', v: appts(v), p: pv ? appts(pv) : null },
    { label: 'Υποδείξεις', v: sumGroup(v, 'showings'), p: pv ? sumGroup(pv, 'showings') : null },
    { label: 'Αναθέσεις & εντολές', v: sumGroup(v, 'mandates'), p: pv ? sumGroup(pv, 'mandates') : null }
  ];
}

function isLiveYm(ym) {
  var now = new Date();
  return ym === now.getFullYear() + '-' + (now.getMonth() < 9 ? '0' : '') + (now.getMonth() + 1);
}

function renderMetrics() {
  renderMoreMx();
  var d = S.mx, body = $('mx-body');
  if (!d) return;
  $('mx-nav').hidden = true;

  if (!d.configured) {
    body.innerHTML = '<div class="empty"><b>Δεν έχει ρυθμιστεί ακόμα</b>' +
      'Το γραφείο πρέπει να συνδέσει το φύλλο της φόρμας με την εφαρμογή.</div>';
    return;
  }
  if (!d.months.length) {
    body.innerHTML = '<div class="empty"><b>Δεν βρέθηκαν υποβολές</b>' +
      'Ψάξαμε για: ' + esc(d.emails.join(', ')) + '.<br>Αν συμπληρώνεις τη φόρμα με άλλο email, ' +
      'ζήτα να μπει στη στήλη «Email φόρμας» του φύλλου Agents.</div>' + formLink(d);
    return;
  }

  $('mx-nav').hidden = false;
  if (S.mxMode === 'year') return renderMetricsYear(d, body);

  var ms = d.months, m = monthOf(S.mxMonth) || ms[0];
  S.mxMonth = m.ym;
  var i = ms.indexOf(m);
  $('mx-title').textContent = m.label;
  $('mx-prev').disabled = i >= ms.length - 1;
  $('mx-next').disabled = i <= 0;
  var prev = monthOf(prevYm(m.ym));
  var pv = prev ? prev.values : null;
  // Ο τρέχων μήνας δεν έχει τελειώσει: η διαφορά φαίνεται, αλλά χωρίς κόκκινο/πράσινο.
  var now = new Date(), live = m.ym === now.getFullYear() + '-' + (now.getMonth() < 9 ? '0' : '') + (now.getMonth() + 1);

  var html = '';
  var weeks = m.weeks.length + (m.weeks.length === 1 ? ' εβδομάδα' : ' εβδομάδες');
  var done = m.weeks.length === 1 ? ' συμπληρωμένη' : ' συμπληρωμένες';
  if (m.missing.length) {
    html += '<div class="mx-status warn"><span>' + weeks + ' · <b>δεν βρέθηκε υποβολή για ' +
      esc(m.missing.join(', ')) + '</b></span>' +
      (d.formUrl ? '<a class="link" href="' + esc(d.formUrl) + '" target="_blank" rel="noopener">Άνοιγμα φόρμας</a>' : '') + '</div>';
  } else {
    html += '<div class="mx-status"><span>' + (m.weeks.length ? weeks + done + ' ✓' : 'Καμία υποβολή ακόμα') + (live ? ' · ο μήνας είναι σε εξέλιξη' : '') + '</span></div>';
  }

  // Τρία σύνολα με μια ματιά
  html += '<div class="mx-tiles">' + mxTiles(m.values, pv).map(function (t) {
    return '<div class="mx-tile"><b>' + fmtNum(t.v) + '</b><span>' + t.label + '</span>' + deltaHtml(t.v, t.p, live) + '</div>';
  }).join('') + '</div>';

  d.groups.forEach(function (g) {
    html += '<div class="section">' + esc(g.label) + '</div>';
    d.metrics.filter(function (x) { return x.group === g.key; }).forEach(function (x) {
      var v = m.values[x.key] || 0;
      html += '<button class="mx-row' + (v ? '' : ' zero') + '" data-k="' + x.key + '">' +
        '<span class="mx-label"><b>' + esc(x.label) + '</b>' + (x.sub ? '<span>' + esc(x.sub) + '</span>' : '') + '</span>' +
        deltaHtml(v, pv ? pv[x.key] || 0 : null, live) +
        '<span class="mx-val">' + fmtNum(v) + '</span></button>';
      if (S.mxOpen === x.key) {
        html += '<div class="mx-weeks">' + (m.weeks.length ? m.weeks.map(function (w) {
          return '<span>' + esc(w.label) + ': <b>' + fmtNum(w.values[x.key] || 0) + '</b></span>';
        }).join('') : '<span>Καμία εβδομάδα</span>') + '</div>';
      }
    });
  });

  html += '<div class="mx-foot">' + (pv ? '▲▼ σε σχέση με ' + esc(prev.label.split(' ')[0]) + ' · ' : '') +
          'Πάτα έναν δείκτη για ανάλυση ανά εβδομάδα.<br>Τελευταία υποβολή ' + esc(d.lastSent || '—') +
          ' · ενημέρωση ' + esc(d.updated) + '</div>' + formLink(d);
  body.innerHTML = html;
  wireMetricRows(body);
}

function renderMetricsYear(d, body) {
  var ys = mxYears();
  if (ys.indexOf(S.mxYear) === -1) S.mxYear = ys[0];
  var y = S.mxYear, i = ys.indexOf(y);
  $('mx-title').textContent = 'Έτος ' + y;
  $('mx-prev').disabled = i >= ys.length - 1;
  $('mx-next').disabled = i <= 0;

  // 12 θέσεις, Ιανουάριος → Δεκέμβριος
  var months = [];
  for (var k = 1; k <= 12; k++) months.push(monthOf(y + '-' + (k < 10 ? '0' : '') + k));
  var active = months.filter(function (m) { return m && m.weeks.length; }).length;
  var cur = new Date();
  var curIdx = String(cur.getFullYear()) === y ? cur.getMonth() : -1;
  var total = function (key) { return months.reduce(function (a, m) { return a + (m ? m.values[key] || 0 : 0); }, 0); };

  var html = '<div class="mx-status"><span>' + active + (active === 1 ? ' μήνας' : ' μήνες') +
    ' με υποβολές</span></div>';

  d.groups.forEach(function (g) {
    html += '<div class="section">' + esc(g.label) + '</div>';
    d.metrics.filter(function (x) { return x.group === g.key; }).forEach(function (x) {
      var t = total(x.key);
      var max = Math.max.apply(null, months.map(function (m) { return m ? m.values[x.key] || 0 : 0; }).concat([1]));
      var bars = months.map(function (m, j) {
        var v = m ? m.values[x.key] || 0 : 0;
        return '<i class="' + (v ? 'on' : '') + (j === curIdx ? ' cur' : '') + '" style="height:' +
               Math.max(7, Math.round(v / max * 100)) + '%" title="' + (j + 1) + ': ' + fmtNum(v) + '"></i>';
      }).join('');
      html += '<button class="mx-row year' + (t ? '' : ' zero') + '" data-k="' + x.key + '">' +
        '<span class="mx-label"><b>' + esc(x.label) + '</b>' +
        '<span>' + (x.sub ? esc(x.sub) + ' · ' : '') + 'μ.ο. ' + fmtNum(active ? t / active : 0) + '</span></span>' +
        '<span class="bars" aria-hidden="true">' + bars + '</span>' +
        '<span class="mx-val">' + fmtNum(t) + '</span></button>';
      if (S.mxOpen === x.key) {
        html += '<div class="mx-weeks">' + months.map(function (m, j) {
          return m && m.weeks.length ? '<span>' + esc(m.label.split(' ')[0].slice(0, 3)) + ': <b>' + fmtNum(m.values[x.key] || 0) + '</b></span>' : '';
        }).join('') + '</div>';
      }
    });
  });
  html += '<div class="mx-foot">Πάτα έναν δείκτη για ανάλυση ανά μήνα · ενημέρωση ' + esc(d.updated) + '</div>';
  body.innerHTML = html;
  wireMetricRows(body);
}

function wireMetricRows(body) {
  body.querySelectorAll('.mx-row').forEach(function (r) {
    r.onclick = function () {
      S.mxOpen = S.mxOpen === r.dataset.k ? '' : r.dataset.k;
      var y = window.scrollY;
      renderMetrics();
      window.scrollTo(0, y);
    };
  });
}

function formLink(d) {
  return d.formUrl ? '<div class="pad"><a class="btn wide" href="' + esc(d.formUrl) +
    '" target="_blank" rel="noopener">' + ico('out') + 'Συμπλήρωση φόρμας εβδομάδας</a></div>' : '';
}

function fillSelect(el, items) {
  el.innerHTML = (items || []).map(function (s) {
    return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
  }).join('');
}

function renderForms(forms) {
  $('form-list').innerHTML = forms.length ? forms.map(function (f) {
    return '<a class="row" href="' + esc(f.url) + '" target="_blank" rel="noopener">' +
      '<span class="row-ico">' + ico('form') + '</span>' +
      '<span class="row-body"><span class="row-name">' + esc(f.title) + '</span>' +
      (f.note ? '<span class="row-prop">' + esc(f.note) + '</span>' : '') + '</span>' +
      ico('out', 'ico chev') + '</a>';
  }).join('') : '<div class="empty"><b>Καμία φόρμα</b>Το γραφείο δεν έχει ορίσει ακόμα φόρμες.</div>';
}

function setBadge(n) {
  var b = $('tab-badge');
  b.hidden = !n;
  b.textContent = n;
}

function toast(msg, isError) {
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = true;
  void t.offsetWidth;
  t.hidden = false;
  clearTimeout(t._x);
  t._x = setTimeout(function () { t.hidden = true; }, isError ? 6500 : 4000);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}



// ─────────────────────────────────────────────────────────────
//  1.20 · ΣΗΜΕΙΩΣΗ ΓΙΑ ΚΑΘΕ ΚΛΗΣΗ
//  Πατάς «Κλήση» → η εφαρμογή γράφει την κλήση (beacon με κλειδί cid).
//  Γυρνάς στην εφαρμογή → ανοίγει «Πώς πήγε η κλήση;» για ΑΥΤΗ την κλήση.
//  Η εκκρεμότητα κρατιέται και στη συσκευή (kw_call), αν η σελίδα ξαναφορτώσει.
// ─────────────────────────────────────────────────────────────

function callId() {
  var a = new Uint8Array(6);
  try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function checkPendingCall() {
  var cfg = (S.boot && S.boot.callLog) || {};
  if (cfg.ask === false || isAdminMode()) return;
  var pc = S.pendingCall;
  if (!pc) { try { pc = JSON.parse(store('kw_call') || 'null'); } catch (e) { pc = null; } }
  if (!pc || !pc.cid || !pc.lead) return;
  var age = Date.now() - pc.at;
  if (age > (cfg.within || 120) * 60000) { S.pendingCall = null; store('kw_call', null); return; }
  if (age < 2500 || !$('callnote').hidden) return;     // δεν πρόλαβε να γίνει κλήση, ή είναι ήδη ανοιχτό
  openCallNote(pc, null);
}

function cnResult(v) {
  $$('#cn-result .chip').forEach(function (c) {
    var on = c.dataset.res === v;
    c.classList.toggle('is-on', on);
    c.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  $('cn-noanswer-hint').hidden = v !== 'Δεν απάντησε' || !S.cn || !S.cn.fresh;
}

/** pc = { lead, cid, at, name }· c = η κλήση από το ιστορικό, όταν αλλάζεις παλιά σημείωση. */
function openCallNote(pc, c) {
  S.cn = { lead: pc.lead, cid: pc.cid, at: pc.at, fresh: !c };
  var d = new Date(pc.at || Date.now());
  $('cn-who').textContent = (pc.name || 'Πελάτης') + ' · κλήση ' + lowerDay(niceDate(pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hhmm(d)));
  $('callnote-title').textContent = c ? 'Σημείωση κλήσης' : 'Πώς πήγε η κλήση;';
  $('cn-note').value = c ? c.note || '' : '';
  cnResult(c ? c.result || 'Μιλήσαμε' : 'Μιλήσαμε');
  $('cn-hint').textContent = '';
  $('cn-hint').className = 'save-hint';
  $('cn-save').disabled = false;
  $('cn-later').textContent = c ? 'Άκυρο' : 'Αργότερα';
  openPop('callnote');
}

function clearPendingCall() {
  if (S.cn && S.cn.fresh) { S.pendingCall = null; store('kw_call', null); }
}

function wireCallNote() {
  $$('#cn-result .chip').forEach(function (c) { c.onclick = function () { cnResult(c.dataset.res); }; });
  $('cn-later').onclick = function () { clearPendingCall(); closePop('callnote'); };
  $('callnote').querySelector('[data-pop-close]').addEventListener('click', clearPendingCall);
  $('cn-save').onclick = onSaveCallNote;
}

function onSaveCallNote() {
  var cn = S.cn;
  if (!cn) return;
  var on = $$('#cn-result .chip.is-on')[0];
  var result = on ? on.dataset.res : '';
  var note = $('cn-note').value.trim();
  var btn = $('cn-save');
  btn.disabled = true;
  $('cn-hint').className = 'save-hint';
  $('cn-hint').textContent = 'Αποθήκευση…';
  send('callNote', { id: cn.lead, cid: cn.cid, result: result, note: note, at: cn.at }).then(function (rr) {
    var res = rr.data;
    merge(res.lead);
    var noAnswer = cn.fresh && result === 'Δεν απάντησε' && res.lead.status !== ST.NO_ANSWER;
    clearPendingCall();
    closePop('callnote');
    if (S.lead && S.lead.id === res.lead.id) fillDetail(res.lead);
    if (S.view === 'calls' || S.view === 'today') render();
    toast(rr.queued ? 'Η σημείωση αποθηκεύτηκε στο κινητό · θα σταλεί μόλις έρθει σήμα'
      : res.masked ? 'Αποθηκεύτηκε. Αριθμοί ταυτότητας/ΑΦΜ σβήστηκαν.' : 'Η σημείωση αποθηκεύτηκε', res.masked);
    // «Δεν απάντησε» → όπως το κουμπί: κατάσταση και follow-up στο ημερολόγιο.
    if (noAnswer) {
      return send('status', { id: res.lead.id, status: ST.NO_ANSWER }).then(function (r2) {
        var l = r2.data;
        merge(l);
        if (S.lead && S.lead.id === l.id) fillDetail(l);
        if (l.followUp) toast('Σημείωση αποθηκεύτηκε · follow-up ' + l.followUp);
      });
    }
  }).catch(function (e) {
    btn.disabled = false;
    $('cn-hint').className = 'save-hint err';
    $('cn-hint').textContent = 'Δεν αποθηκεύτηκε: ' + e.message;
  });
}


// ─────────────────────────────────────────────────────────────
//  1.20 · ΤΙΜΟΛΟΓΗΣΗ: ΔΙΑΛΕΞΕ ΑΠΟ ΤΑ ΕΝΤΥΠΑ ΤΟΥ ΑΚΙΝΗΤΟΥ
// ─────────────────────────────────────────────────────────────

var PICK_TXT = {
  showform: { btn: 'Από τα έντυπα υπόδειξης', title: 'Έντυπα υπόδειξης', none: 'έντυπα υπόδειξης', one: 'Υπόδειξη' },
  offerform: { btn: 'Από τα έντυπα προσφοράς', title: 'Έντυπα προσφοράς', none: 'έντυπα προσφοράς', one: 'Προσφορά' }
};

function pickButton(s, picks, has) {
  var t = PICK_TXT[s.pick];
  if (!t) return '';
  if (!picks.length) return '<p class="doc-note">Δεν υπάρχουν ακόμα ' + t.none + ' στον φάκελο του ακινήτου.</p>';
  var fresh = picks.filter(function (x) { return !x.used; }).length;
  return '<button class="btn wide gap-top' + (has ? '' : ' primary') + '" data-pick="' + esc(s.key) + '">' + ico('form') +
    '<span>' + t.btn + ' (' + picks.length + ')' + (has && fresh ? ' · ' + fresh + (fresh === 1 ? ' νέο' : ' νέα') : '') + '</span></button>';
}

function openPick(p, key) {
  var res = S.docs[docKey('bill', p.code)] || {};
  var slot = (S.boot.billSlots || []).filter(function (s) { return s.key === key; })[0];
  if (!slot) return;
  var t = PICK_TXT[slot.pick];
  var list = (res.picks || {})[key] || [];
  $('pick-title').textContent = t.title;
  $('pick-hint').textContent = 'Διάλεξε ποιο μπαίνει στην Τιμολόγηση ως «' + slot.label + '». Το πρωτότυπο μένει στον φάκελο του ακινήτου.';
  $('pick-list').innerHTML = list.map(function (x, i) {
    var st = x.signed === 'yes' ? '<i class="tag showing">Υπογράφηκε στην οθόνη</i>'
      : x.signed === 'no' ? '<i class="tag noanswer">Για εκτύπωση · χωρίς υπογραφή</i>' : '';
    return '<div class="pick-row">' +
      '<button class="mrow" data-pi="' + i + '"><span class="mrow-ico">' + ico('form') + '</span>' +
        '<span class="mrow-body"><b>' + esc(x.aa ? t.one + ' ' + x.aa : x.name) + '</b>' +
        '<span>' + esc(x.date.slice(0, 10)) + '</span>' +
        (st || x.used ? '<span class="pick-tags">' + st + (x.used ? '<i class="tag closed">✓ Μπήκε ως «' + esc(x.used) + '»</i>' : '') + '</span>' : '') +
        '</span>' + ico('next', 'ico chev') + '</button>' +
      '<a class="btn small pick-open" href="' + esc(x.url) + '" target="_blank" rel="noopener" aria-label="Άνοιγμα ' + esc(x.name) + '">' + ico('out') + '<span>Άνοιγμα</span></a>' +
    '</div>';
  }).join('');
  $('pick-list').querySelectorAll('[data-pi]').forEach(function (b) {
    b.onclick = function () { onPick(p, slot, list[Number(b.dataset.pi)], b); };
  });
  openPop('pick');
}

function onPick(p, slot, x, btn) {
  var res = S.docs[docKey('bill', p.code)];
  var old = res && res.docs[slot.key] || [];

  var step = x.signed === 'no'
    ? choose('Έντυπο χωρίς υπογραφή', 'Αυτό είναι το έντυπο για εκτύπωση. Για την Τιμολόγηση χρειάζεται υπογεγραμμένο: ανέβασε φωτογραφία ή σκαναρισμένο το υπογεγραμμένο χαρτί.',
        [{ key: 'upload', label: 'Ανέβασμα υπογεγραμμένου', cls: 'solid-red' }, { key: 'go', label: 'Βάλ’ το όπως είναι' }, { key: null, label: 'Άκυρο' }])
    : x.used ? choose('Έχει μπει ήδη', 'Το έντυπο είναι ήδη στην Τιμολόγηση ως «' + x.used + '». Να μπει ξανά;',
        [{ key: 'go', label: 'Ναι, ξανά', cls: 'primary' }, { key: null, label: 'Όχι, πίσω' }])
    : Promise.resolve('go');

  step.then(function (k) {
    if (k === 'upload') {
      closePop('pick');
      S.upSlot = slot.key;
      S.upSet = 'bill';
      $('doc-input').value = '';
      $('doc-input').click();
      return;
    }
    if (k !== 'go') return;
    var mode = !old.length || slot.multi ? Promise.resolve('keep') : choose(
      'Υπάρχει ήδη ' + slot.label,
      'Στην Τιμολόγηση υπάρχει το «' + old[old.length - 1].name + '». Τι να γίνει με το παλιό;',
      [{ key: 'replace', label: 'Αντικατάσταση (σβήνεται το παλιό)', cls: 'solid-red' },
       { key: 'keep', label: 'Κράτα και το παλιό', cls: 'primary' }, { key: null, label: 'Άκυρο' }]);
    return mode.then(function (m) {
      if (!m) return;
      btn.disabled = true;
      btn.querySelector('.mrow-body b').textContent = 'Μπαίνει στην Τιμολόγηση…';
      return api('billPick', { code: p.code, slot: slot.key, fileId: x.id, mode: m }).then(function (r) {
        S.docs[docKey('bill', p.code)] = r;
        if (S.prop && S.prop.code === p.code) renderDocs(p, r, false, 'bill');
        closePop('pick');
        var bd = billDone(r.counts);
        toast('Μπήκε στην Τιμολόγηση: ' + slot.label + (bd.done < bd.total ? ' · ' + bd.done + '/' + bd.total : ' · όλα έτοιμα ✓'));
      });
    });
  }).catch(function (e) {
    btn.disabled = false;
    toast(e.message, true);
    openPick(p, slot.key);
  });
}


// ─────────────────────────────────────────────────────────────
//  1.20 · ΕΝΤΥΠΟ ΠΡΟΣΦΟΡΑΣ
//  Ίδια λογική με το έντυπο υπόδειξης: link μίας χρήσης, συμπλήρωση στο κινητό του πελάτη
//  ή εδώ, στην οθόνη του μεσίτη. Η εφαρμογή δεν βλέπει ποτέ ΑΦΜ/Α.Δ.Τ.: μόνο κατάσταση, ποσό, PDF.
//  Το link μένει μόνο στη μνήμη (S.ofLink).
// ─────────────────────────────────────────────────────────────

function openOffer(l) {
  if (!l) return;
  if (!S.ofLink || S.ofLink.id !== l.id) S.ofLink = null;
  S.ofLead = l.id;
  $('of-body').innerHTML = '<p class="cal-status muted">Φόρτωση…</p>';
  openPop('offer');
  api('offerStatus', { id: l.id }).then(function (st) {
    if (S.ofLead === l.id) renderOffer(st);
  }).catch(function (e) {
    $('of-body').innerHTML = '<p class="save-hint err">' + esc(e.message) + '</p>';
  });
}

function ofSetLead(status) {
  var l = findLead(S.ofLead);
  if (l) { l.offer = status; if (S.lead && S.lead.id === l.id) fillDetail(l); }
}

function renderOffer(st) {
  S.ofState = st;
  var el = $('of-body'), l = findLead(S.ofLead) || S.lead || {}, link = S.ofLink;
  var p = st.prop || {};
  var rent = (st.deal || p.deal) === 'Ενοικίαση';

  if (!st.ready && st.status !== 'Υπογράφηκε') {
    el.innerHTML = '<p class="note">Το έντυπο δεν έχει ρυθμιστεί ακόμα: χρειάζεται το Google Doc «Έντυπο προσφοράς - πρότυπο KW App» στο Drive (README, 1.20).</p>';
    return;
  }

  if (st.status === 'Υπογράφηκε') {
    el.innerHTML = '<div class="sf-box ok"><p class="sf-state"><span class="tag showing">Υπογράφηκε</span><b>Α/Α ' + esc(st.aa) + '</b></p>' +
      '<p class="of-amount">' + esc(st.amount) + (rent ? ' / μήνα' : '') + '</p>' +
      '<p class="cal-status muted">Υπογράφηκε ' + esc(st.submitted) + '. Το PDF είναι στο «Προσφορές» του ακινήτου και πήγε για έλεγχο στο γραφείο.</p>' +
      '<a class="btn solid-red wide" href="' + esc(st.fileUrl) + '" target="_blank" rel="noopener">' + ico('out') + '<span>Άνοιγμα PDF</span></a>' +
      '<button class="btn wide gap-top" id="of-new">Νέα προσφορά από τον ίδιο πελάτη</button></div>';
    $('of-new').onclick = function () {
      ask('Νέα προσφορά;', 'Η προηγούμενη μένει στον φάκελο. Θα φτιαχτεί νέο link για τον πελάτη.', 'Ναι, νέα προσφορά')
        .then(function (yes) { if (yes) { st.status = ''; renderOffer(st); } });
    };
    return;
  }

  if (link && st.status === 'Στάλθηκε') {
    var phone = l.phoneIntl || '';
    el.innerHTML = '<div class="sf-box wait"><p class="sf-state"><span class="tag noanswer">Περιμένει τον πελάτη</span><span>λήγει ' + esc(st.expires) + '</span></p>' +
      '<a class="btn solid-red wide" href="' + esc(link.url) + '" target="_blank" rel="noopener">' + ico('form') + '<span>Συμπλήρωση εδώ, στο κινητό μου</span></a>' +
      '<p class="cal-status muted of-or">ή στείλε το link στον πελάτη:</p>' +
      '<div class="sf-actions">' +
        (link.wa ? '<a class="btn" href="https://wa.me/' + esc(link.wa) + '?text=' + encodeURIComponent(link.sms) + '" target="_blank" rel="noopener">' + ico('sms') + '<span>WhatsApp</span></a>' : '') +
        (phone ? '<a class="btn" href="' + esc(smsHref(phone, link.sms)) + '">' + ico('sms') + '<span>SMS</span></a>' : '') +
        (link.email.to ? '<a class="btn" href="mailto:' + esc(link.email.to) + '?subject=' + encodeURIComponent(link.email.subject) +
          '&body=' + encodeURIComponent(link.email.body) + '">' + ico('mail') + '<span>Email</span></a>' : '') +
        '<button class="btn" id="of-copy">Αντιγραφή link</button>' +
      '</div>' +
      '<button class="link" id="of-cancel">Ακύρωση link</button></div>';
    $('of-copy').onclick = function () {
      var done = function () { toast('Το link αντιγράφηκε'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link.url).then(done).catch(function () { copyFallback(link.url, done); });
      else copyFallback(link.url, done);
    };
    $('of-cancel').onclick = onOfCancel;
    return;
  }

  if (st.status === 'Στάλθηκε') {
    el.innerHTML = '<div class="sf-box wait"><p class="sf-state"><span class="tag noanswer">Στάλθηκε ' + esc(st.created) + '</span></p>' +
      '<p class="cal-status muted">Λήγει ' + esc(st.expires) + (st.opens ? ' · ο πελάτης το άνοιξε ' + st.opens + (st.opens === 1 ? ' φορά' : ' φορές') : ' · δεν έχει ανοιχτεί ακόμα') + '.</p>' +
      '<div class="sf-actions"><button class="btn" id="of-again">Νέο link</button><button class="btn" id="of-cancel">Ακύρωση link</button></div></div>';
    $('of-again').onclick = function () {
      ask('Νέο link;', 'Το παλιό link σταματά να ισχύει.', 'Ναι, νέο link').then(function (yes) { if (yes) onOfCreate(st.deal); });
    };
    $('of-cancel').onclick = onOfCancel;
    return;
  }

  el.innerHTML = (st.status === 'Έληξε' || st.status === 'Ακυρώθηκε'
      ? '<p class="cal-status warn">Το προηγούμενο link ' + (st.status === 'Έληξε' ? 'έληξε' : 'ακυρώθηκε') + '.</p>' : '') +
    '<p class="cal-status muted">Ο πελάτης γράφει ονοματεπώνυμο, διεύθυνση, την τιμή που προτείνει, τρόπο πληρωμής, ΑΦΜ και Α.Δ.Τ., και υπογράφει. Τα στοιχεία του ακινήτου μπαίνουν μόνα τους.</p>' +
    '<dl class="facts sf-facts">' + sfFact('Κωδικός', p.code) + sfFact('Διεύθυνση', p.address) + sfFact('Περιγραφή', p.description) +
      sfFact(rent ? 'Ζητούμενο μίσθωμα' : 'Ζητούμενη τιμή', fmtPrice(p.price)) + '</dl>' +
    (p.deal ? '' : '<label class="field"><span>Συναλλαγή</span><select id="of-deal"><option value="">Διάλεξε…</option>' +
      '<option>Πώληση</option><option>Ενοικίαση</option></select></label>') +
    '<button class="btn solid-red wide" id="of-create">' + ico('form') + '<span>Ετοίμασε το έντυπο</span></button>' +
    '<p class="cal-status muted of-note">ΑΦΜ και Α.Δ.Τ. υπάρχουν μόνο μέσα στο PDF. Δεν τα βλέπει η εφαρμογή.</p>' +
    '<p class="save-hint" id="of-hint"></p>';
  $('of-create').onclick = function () {
    var deal = $('of-deal') ? $('of-deal').value : '';
    if ($('of-deal') && !deal) {
      $('of-hint').className = 'save-hint err';
      $('of-hint').textContent = 'Διάλεξε αν είναι Πώληση ή Ενοικίαση.';
      return;
    }
    onOfCreate(deal);
  };
}

function onOfCreate(deal) {
  var id = S.ofLead;
  var b = $('of-create') || $('of-again');
  if (b) { b.disabled = true; b.textContent = 'Ετοιμάζεται…'; }
  api('offerCreate', { id: id, deal: deal || '' }).then(function (res) {
    S.ofLink = { id: id, url: res.url, sms: res.sms, wa: res.wa, email: res.email };
    var st = res.form;
    st.ready = true;
    st.prop = (S.ofState || {}).prop;
    ofSetLead('Στάλθηκε');
    if (S.ofLead === id) renderOffer(st);
    toast('Το έντυπο είναι έτοιμο');
  }).catch(function (e) {
    if (b) { b.disabled = false; b.textContent = 'Ετοίμασε το έντυπο'; }
    toast(e.message, true);
  });
}

function onOfCancel() {
  ask('Ακύρωση link;', 'Ο πελάτης δεν θα μπορεί πια να συμπληρώσει την προσφορά από αυτό το link.', 'Ναι, ακύρωση').then(function (yes) {
    if (!yes) return;
    var id = S.ofLead;
    api('offerCancel', { id: id }).then(function (st) {
      S.ofLink = null;
      st.ready = true;
      st.prop = (S.ofState || {}).prop;
      ofSetLead(st.status);
      if (S.ofLead === id) renderOffer(st);
      toast('Το link ακυρώθηκε');
    }).catch(function (e) { toast(e.message, true); });
  });
}


// ═════════════════════════════════════════════════════════════
//  2.0 · ΝΕΟ INTERFACE
//  Swipe, Pipeline, Ειδοποιήσεις, Γρήγορη καταγραφή. Χωρίς αλλαγές στον server:
//  όλα βγαίνουν από τα δεδομένα που ήδη φέρνει το bootstrap.
// ═════════════════════════════════════════════════════════════

// ── Swipe ─────────────────────────────────────────────────
// Σύρε δεξιά = «Έγινε», αριστερά = «Σημείωση». Κάθε swipe έχει και κουμπί
// (WCAG 2.5.1: κάθε κίνηση γίνεται και με ένα απλό πάτημα).

var SWIPE_AT = 88;

/** el: το στοιχείο που κινείται. Η κίνηση ξεκινά μόνο όταν το δάχτυλο πάει πλάγια. */
function wireSwipe(el, opts) {
  var st = null;
  var wrap = el.parentNode;
  var set = function (dx, anim) {
    el.style.transition = anim ? 'transform .22s var(--move)' : 'none';
    el.style.transform = dx ? 'translateX(' + dx + 'px)' : '';
    wrap.classList.toggle('sw-right', dx > 8);
    wrap.classList.toggle('sw-left', dx < -8);
    wrap.classList.toggle('sw-ready', Math.abs(dx) >= SWIPE_AT);
  };
  el.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    st = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, dx: 0 };
  });
  el.addEventListener('pointermove', function (e) {
    if (!st || e.pointerId !== st.id) return;
    var dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }   // κύλιση, όχι swipe
      if (Math.abs(dx) < 12) return;
      st.on = true;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* παλιός browser */ }
    }
    if (dx > 0 && !opts.right) dx = dx / 4;
    if (dx < 0 && !opts.left) dx = dx / 4;
    st.dx = Math.max(-140, Math.min(140, dx));
    set(st.dx, false);
  });
  var end = function () {
    if (!st) return;
    var dx = st.dx, was = st.on;
    st = null;
    set(0, true);
    if (!was) return;
    el._swiped = true;                         // να μην ανοίξει και το «πάτημα» της κάρτας
    setTimeout(function () { el._swiped = false; }, 60);
    if (dx >= SWIPE_AT && opts.right) opts.right();
    else if (dx <= -SWIPE_AT && opts.left) opts.left();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', function (e) { if (el._swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// ── Σήμερα: η επόμενη υπόδειξη ────────────────────────────

/** «σε 25 λεπτά», «σε 2 ώρες», «αύριο 18:00». */
function inWords(ts) {
  var m = Math.round((ts - Date.now()) / 60000);
  if (m < 1) return 'τώρα';
  if (m < 60) return 'σε ' + plural(m, 'λεπτό', 'λεπτά');
  var d = new Date(ts);
  if (isoDate(d) === isoDate(new Date())) {
    var h = Math.round(m / 60);
    return 'σε ' + plural(h, 'ώρα', 'ώρες');
  }
  return lowerDay(niceDate(pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hhmm(d)));
}

function heroHtml(l) {
  var nav = l.address ? placeUrlNav(l.address) : '';
  return '<section class="hero-next" aria-label="Επόμενη υπόδειξη">' +
    '<button class="hn-main" data-id="' + esc(l.id) + '">' +
      '<span class="hn-kicker">Επόμενη υπόδειξη · ' + esc(inWords(l.showingTs)) + '</span>' +
      '<span class="hn-time">' + esc(l.showingTime || hhmm(new Date(l.showingTs))) + '</span>' +
      '<span class="hn-name">' + esc(l.name || 'Χωρίς όνομα') + '</span>' +
      '<span class="hn-prop">' + esc(l.address || l.property || '') + (l.code ? ' · ' + esc(l.code) : '') + '</span>' +
      (l.form && SF_DONE[l.form] ? '' : '<span class="hn-warn">' + ico('form') + 'Έντυπο υπόδειξης: ' + esc(l.form || 'δεν έχει σταλεί') + '</span>') +
    '</button>' +
    '<div class="hn-btns">' +
      '<button class="hn-btn red" data-hn-call="' + esc(l.id) + '">' + ico('phone') + '<span>Κλήση</span></button>' +
      (nav ? '<a class="hn-btn" href="' + esc(nav) + '" target="_blank" rel="noopener">' + ico('pin') + '<span>Οδηγίες</span></a>' : '') +
      '<button class="hn-btn" data-hn-sms="' + esc(l.id) + '">' + ico('sms') + '<span>SMS υπενθύμισης</span></button>' +
    '</div></section>';
}

/** Κλήση από έξω από την οθόνη της κλήσης: ανοίγει την κλήση και πατά το «Κλήση» της,
 *  ώστε να γραφτεί κανονικά στο ιστορικό και να ρωτήσει «Πώς πήγε;». */
function callLead(id) {
  var l = findLead(id);
  if (!l) return;
  showLead(l, {});
  if (l.phone || l.phoneIntl) $('d-tel').click();
}

// ── Σήμερα: κάρτες προγράμματος με swipe ──────────────────

function planCard(x) {
  var done = x.done;
  return '<li class="pc-wrap' + (done ? ' done' : '') + '">' +
    '<span class="pc-under pc-ok" aria-hidden="true">' + ico('check') + 'Έγινε</span>' +
    '<span class="pc-under pc-note" aria-hidden="true">Σημείωση' + ico('note') + '</span>' +
    '<div class="pc" ' + x.attrs + '>' +
      '<span class="pc-time">' + esc(x.time || '—') + '</span>' +
      '<span class="pc-body">' +
        '<span class="pc-tags"><span class="tag ' + x.tone + '">' + esc(x.kind) + '</span>' + (x.badge || '') + '</span>' +
        '<b class="pc-title">' + esc(x.title) + '</b>' +
        (x.sub ? '<span class="pc-sub">' + esc(x.sub) + '</span>' : '') +
      '</span>' +
      (x.nav ? '<a class="pc-nav" href="' + esc(x.nav) + '" target="_blank" rel="noopener" aria-label="Οδηγίες στο Google Maps">' + ico('nav') + '</a>' : '') +
    '</div>' +
    (done ? '' : '<div class="pc-acts">' +
      '<button class="pc-act pa-ok" data-pc-ok>' + ico('check') + '<span>' + esc(x.okText) + '</span></button>' +
      '<button class="pc-act pa-note" data-pc-note>' + ico('note') + '<span>' + esc(x.noteText) + '</span></button></div>') +
    '</li>';
}

function wirePlan(root) {
  root.querySelectorAll('.pc-wrap').forEach(function (w) {
    var card = w.querySelector('.pc');
    var lid = card.dataset.id, tid = card.dataset.task;
    var ok = function () {
      if (tid) { var t = findTask(tid); if (t && !t.done) toggleTask(tid); }
      else if (lid) openLead(lid, { outcome: true });
    };
    var note = function () {
      if (tid) openTask(findTask(tid));
      else if (lid) openLeadPick('note', lid);
    };
    card.onclick = function (e) {
      if (e.target.closest('a')) return;
      if (tid) openTask(findTask(tid)); else openLead(lid);
    };
    if (!w.classList.contains('done')) wireSwipe(card, { right: ok, left: note });
    var b1 = w.querySelector('[data-pc-ok]'), b2 = w.querySelector('[data-pc-note]');
    if (b1) b1.onclick = ok;
    if (b2) b2.onclick = note;
  });
}

// ── Πελάτες: Pipeline ─────────────────────────────────────
// Τα στάδια βγαίνουν από ό,τι ήδη ξέρει η εφαρμογή για κάθε κλήση:
// κατάσταση, υπόδειξη, έντυπο προσφοράς. Τίποτα δεν γράφεται στον server.

var PIPE = [
  { key: 'new', label: 'Νέα επαφή', hint: 'Νέες, χωρίς απάντηση, απαντημένες' },
  { key: 'show', label: 'Υπόδειξη', hint: 'Με υπόδειξη, χωρίς προσφορά' },
  { key: 'deal', label: 'Υπό συμφωνία', hint: 'Με έντυπο προσφοράς' },
  { key: 'closed', label: 'Κλειστές', hint: 'Ολοκληρώθηκαν ή έκλεισαν' }
];

function pipeStage(l) {
  if (l.status === ST.CLOSED) return 'closed';
  if (l.offer === 'Στάλθηκε' || l.offer === 'Υπογράφηκε') return 'deal';
  if (l.status === ST.SHOWING) return 'show';
  return 'new';
}

function setCallsMode(m) {
  S.cmode = m;
  $$('#calls-mode [data-cmode]').forEach(function (b) {
    var on = b.dataset.cmode === m;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  renderCalls();
  slide($(m === 'pipe' ? 'pipe' : 'call-list'), m === 'pipe' ? 1 : -1);
  window.scrollTo(0, 0);
}

function pipeTone(l) {
  return l.status === ST.PENDING ? 'pending' : l.status === ST.NO_ANSWER ? 'noanswer'
    : l.status === ST.CLOSED ? 'answered' : pipeStage(l) === 'deal' ? 'closed' : 'showing';
}

function pipeCard(l) {
  var k = STATUS_CLASS[l.status] || 'answered';
  return '<span class="pk-top"><span class="avatar ' + k + '" aria-hidden="true">' + esc(initials(l.name)) + '</span>' +
    '<span class="pk-who"><b>' + esc(l.name || 'Χωρίς όνομα') + '</b><span>' + esc([l.source, niceDate(l.date)].filter(Boolean).join(' · ')) + '</span></span></span>' +
    '<span class="pk-prop"><small>' + (l.code ? 'Κωδ. ' + esc(l.code) : 'Χωρίς κωδικό') + '</small>' + esc(l.property || '') + '</span>' +
    '<span class="pk-line tag ' + pipeTone(l) + '">' + esc(statusLine(l)) + '</span>';
}

function renderPipe() {
  var base = baseList();
  var by = {};
  PIPE.forEach(function (s) { by[s.key] = []; });
  base.forEach(function (l) { by[pipeStage(l)].push(l); });
  Object.keys(by).forEach(function (k) {
    by[k].sort(function (a, b) { return (b.showingTs || b.ts || 0) - (a.showingTs || a.ts || 0); });
  });
  if (!S.pipeStage) S.pipeStage = by.new.length ? 'new' : by.show.length ? 'show' : 'new';
  var list = by[S.pipeStage];
  S.pipeIdx = Math.max(0, Math.min(S.pipeIdx || 0, list.length - 1));
  var cur = list[S.pipeIdx];

  // Κινητό: chips σταδίων + στοίβα καρτών, μία τη φορά.
  var html = '<div class="pipe-mobile"><div class="subtabs chipbar pipe-chips" role="tablist" aria-label="Στάδια">' +
    PIPE.map(function (s) {
      var on = s.key === S.pipeStage;
      return '<button class="subtab' + (on ? ' is-on' : '') + '" role="tab" aria-selected="' + on + '" data-stage="' + s.key + '"><span>' +
        esc(s.label) + '</span><b>' + by[s.key].length + '</b></button>';
    }).join('') + '</div>';
  if (cur) {
    html += '<div class="stack">' +
      (list.length > 2 ? '<span class="stack-back b2" aria-hidden="true"></span>' : '') +
      (list.length > 1 ? '<span class="stack-back b1" aria-hidden="true"></span>' : '') +
      '<article class="stack-card" data-id="' + esc(cur.id) + '" aria-label="' + esc(cur.name || 'Πελάτης') + '">' + pipeCard(cur) +
        '<span class="pk-next"><small>Τώρα</small>' + esc(nextHint(cur)) + '</span>' +
        '<span class="pk-btns">' +
          (cur.phone || cur.phoneIntl ? '<button class="round-mini red" data-pk-call="' + esc(cur.id) + '" aria-label="Κλήση">' + ico('phone') + '</button>' : '') +
          '<button class="btn primary pk-open" data-pk-open="' + esc(cur.id) + '">Άνοιγμα πελάτη' + ico('next') + '</button>' +
        '</span>' +
      '</article></div>' +
      '<div class="stack-nav">' +
        '<button class="icon-btn ring" data-pk-step="-1" aria-label="Προηγούμενος πελάτης"' + (list.length < 2 ? ' disabled' : '') + '>' + ico('back') + '</button>' +
        '<span aria-live="polite">' + (S.pipeIdx + 1) + ' από ' + list.length + '</span>' +
        '<button class="icon-btn ring" data-pk-step="1" aria-label="Επόμενος πελάτης"' + (list.length < 2 ? ' disabled' : '') + '>' + ico('next') + '</button>' +
      '</div><p class="field-hint stack-tip">Σύρε την κάρτα για τον επόμενο πελάτη.</p>';
  } else {
    html += '<div class="empty small"><b>Κανείς σε αυτό το στάδιο</b>' + esc(PIPE.filter(function (s) { return s.key === S.pipeStage; })[0].hint) + '.</div>';
  }
  html += '</div>';

  // Υπολογιστής: Kanban με όλα τα στάδια.
  html += '<div class="kanban">' + PIPE.map(function (s) {
    return '<section class="kb-col" aria-label="' + esc(s.label) + '"><header><b>' + esc(s.label) + '</b><span class="kb-n">' + by[s.key].length + '</span></header>' +
      (by[s.key].length ? by[s.key].slice(0, 60).map(function (l) {
        return '<button class="kb-card" data-id="' + esc(l.id) + '">' + pipeCard(l) + '</button>';
      }).join('') + (by[s.key].length > 60 ? '<p class="field-hint">και άλλοι ' + (by[s.key].length - 60) + '</p>' : '')
        : '<p class="kb-empty">' + esc(s.hint) + '</p>') + '</section>';
  }).join('') + '</div>';

  var el = $('pipe');
  el.innerHTML = html;
  el.querySelectorAll('[data-stage]').forEach(function (b) {
    b.onclick = function () { S.pipeStage = b.dataset.stage; S.pipeIdx = 0; renderPipe(); };
  });
  el.querySelectorAll('.kb-card').forEach(function (b) { b.onclick = function () { openLead(b.dataset.id); }; });
  el.querySelectorAll('[data-pk-open]').forEach(function (b) { b.onclick = function () { openLead(b.dataset.pkOpen); }; });
  el.querySelectorAll('[data-pk-call]').forEach(function (b) { b.onclick = function () { callLead(b.dataset.pkCall); }; });
  var step = function (d) {
    if (list.length < 2) return;
    S.pipeIdx = (S.pipeIdx + d + list.length) % list.length;
    renderPipe();
    slide(el.querySelector('.stack-card'), d);
  };
  el.querySelectorAll('[data-pk-step]').forEach(function (b) { b.onclick = function () { step(+b.dataset.pkStep); }; });
  var card = el.querySelector('.stack-card');
  if (card && list.length > 1) wireSwipe(card, { left: function () { step(1); }, right: function () { step(-1); } });
}

/** Τι να κάνει τώρα ο μεσίτης, σε μία φράση (ίδια λογική με το «Επόμενο βήμα» της κλήσης). */
function nextHint(l) {
  if (l.status === ST.PENDING) return 'Πάρε τηλέφωνο';
  if (l.status === ST.NO_ANSWER) return l.followUp ? 'Ξανά ' + lowerDay(niceDate(l.followUp)) : 'Ξαναπάρε τηλέφωνο';
  if (l.status === ST.SHOWING) {
    if (upcoming(l)) return 'Υπόδειξη ' + lowerDay(niceDate(l.showingAt));
    if (needsOutcome(l)) return 'Γράψε πώς πήγε η υπόδειξη';
    if (l.offer === 'Στάλθηκε') return 'Περιμένουμε την προσφορά του πελάτη';
    if (l.offer === 'Υπογράφηκε') return 'Η προσφορά υπογράφηκε · ενημέρωσε τον ιδιοκτήτη';
    return 'Επόμενη υπόδειξη ή έντυπο προσφοράς';
  }
  if (l.status === ST.CLOSED) return l.outcome || 'Κλειστή';
  return 'Κλείσε υπόδειξη';
}

// ── Ειδοποιήσεις ──────────────────────────────────────────
// Συγκεντρώνει ό,τι θέλει προσοχή. «Διαβασμένο» κρατιέται στη συσκευή.

S.alertTab = 'all';

function seenSet() {
  if (!S.seen) {
    try { S.seen = JSON.parse(store('kw_seen') || '[]'); } catch (e) { S.seen = []; }
  }
  return S.seen;
}

function markAlertsRead(items) {
  var seen = seenSet();
  items.forEach(function (a) { if (seen.indexOf(a.id) === -1) seen.push(a.id); });
  S.seen = seen.slice(-400);
  store('kw_seen', JSON.stringify(S.seen));
  updateAlertBadge();
}

function alertItems() {
  if (!S.boot) return [];
  var out = [], now = Date.now();
  var add = function (o) { out.push(o); };
  (S.boot.reviews || []).forEach(function (r) {
    add({ id: 'fix:' + r.id, kind: 'todo', icon: 'alert', tone: 'bad', title: 'Θέλει διόρθωση · ' + r.title,
      sub: '«' + r.note + '»' + (r.street || r.code ? ' · ' + (r.street || r.code) : ''), go: function () { openFix(r.id); } });
  });
  S.leads.filter(function (l) { return l.status === ST.PENDING; })
    .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).forEach(function (l) {
      add({ id: 'new:' + l.id, kind: 'calls', icon: 'phone', tone: 'red', title: 'Νέα κλήση · ' + (l.name || 'Χωρίς όνομα'),
        sub: [l.code ? 'Κωδ. ' + l.code : '', l.property, l.source].filter(Boolean).join(' · '), when: niceDate(l.date),
        go: function () { openLead(l.id); } });
    });
  S.leads.filter(function (l) {
    var d = l.status === ST.NO_ANSWER && parseStamp(l.followUp);
    return d && d.getTime() - now < 12 * 3600000;
  }).forEach(function (l) {
    add({ id: 'fu:' + l.id + ':' + l.followUp, kind: 'calls', icon: 'refresh', tone: 'warn', title: 'Follow-up · ' + (l.name || 'Χωρίς όνομα'),
      sub: 'Ξανά ' + lowerDay(niceDate(l.followUp)) + (l.code ? ' · Κωδ. ' + l.code : ''), go: function () { openLead(l.id); } });
  });
  S.leads.filter(function (l) { return l.offer === 'Υπογράφηκε' && l.status !== ST.CLOSED; }).forEach(function (l) {
    add({ id: 'of:' + l.id, kind: 'calls', icon: 'receipt', tone: 'blue', title: 'Υπογράφηκε προσφορά · ' + (l.name || 'Χωρίς όνομα'),
      sub: (l.code ? 'Κωδ. ' + l.code + ' · ' : '') + 'Άνοιξε το PDF μέσα στην κλήση', go: function () { openLead(l.id); } });
  });
  S.leads.filter(function (l) { return needsOutcome(l) && now - l.showingTs < 7 * 86400000; }).forEach(function (l) {
    add({ id: 'oc:' + l.id, kind: 'todo', icon: 'calendar', tone: 'warn', title: 'Πώς πήγε η υπόδειξη;',
      sub: (l.name || 'Χωρίς όνομα') + ' · ' + lowerDay(niceDate(l.showingAt)), go: function () { openLead(l.id, { outcome: true }); } });
  });
  S.leads.filter(function (l) { return upcoming(l) && l.showingTs - now < 3 * 86400000 && !SF_DONE[l.form]; }).forEach(function (l) {
    add({ id: 'sf:' + l.id + ':' + (l.form || ''), kind: 'todo', icon: 'form', tone: '', title: 'Έντυπο υπόδειξης · ' + (l.name || 'Χωρίς όνομα'),
      sub: (l.form === 'Στάλθηκε' ? 'Στάλθηκε, δεν έχει υπογραφεί' : 'Δεν έχει σταλεί') + ' · ' + lowerDay(niceDate(l.showingAt)),
      go: function () { openLead(l.id, { form: true }); } });
  });
  S.props.filter(function (p) { return p.mine && p.available !== false && mandateTag(p); }).forEach(function (p) {
    add({ id: 'md:' + p.code + ':' + (p.mandateDays <= 7 ? 7 : p.mandateDays <= 15 ? 15 : 30), kind: 'todo', icon: 'home',
      tone: p.mandateDays <= 7 ? 'bad' : 'warn', title: mandateText(p.mandateDays), sub: (p.street || p.code) + ' · Κωδ. ' + p.code,
      go: function () { openProp(p.code); } });
  });
  S.props.filter(function (p) { return p.mine && p.available !== false && missingDocs(p).length; }).forEach(function (p) {
    var miss = missingDocs(p);
    add({ id: 'doc:' + p.code + ':' + miss.join(','), kind: 'todo', icon: 'upload', tone: 'warn', title: 'Λείπει ' + miss.join(', '),
      sub: (p.street || p.code) + ' · Κωδ. ' + p.code, go: function () { S.propPane = 'docs'; openProp(p.code); } });
  });
  var seen = seenSet();
  out.forEach(function (a) { a.unread = seen.indexOf(a.id) === -1; });
  return out;
}

function currentAlerts() {
  return alertItems().filter(function (a) { return S.alertTab === 'all' || a.kind === S.alertTab; });
}

function updateAlertBadge(items) {
  var n = (items || alertItems()).filter(function (a) { return a.unread; }).length;
  var b = $('alert-badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n;
}

function renderAlerts() {
  if (!S.boot || !$('alert-list')) return;
  var all = alertItems();
  updateAlertBadge(all);
  $('c-al-all').textContent = all.length;
  $('c-al-calls').textContent = all.filter(function (a) { return a.kind === 'calls'; }).length;
  $('c-al-todo').textContent = all.filter(function (a) { return a.kind === 'todo'; }).length;
  setTab('tabs-alerts', S.alertTab);
  if (S.view !== 'alerts') return;
  var list = currentAlerts();
  $('alerts-read').hidden = !list.some(function (a) { return a.unread; });
  var el = $('alert-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><b>Όλα εντάξει</b>Εδώ θα δεις νέες κλήσεις, follow-up, έντυπα και ό,τι λείπει από τα ακίνητά σου.</div>';
    return;
  }
  el.innerHTML = list.map(function (a, i) {
    return '<button class="al-row' + (a.unread ? ' unread' : '') + '" data-al="' + i + '">' +
      '<span class="mrow-ico ' + a.tone + '">' + ico(a.icon) + '</span>' +
      '<span class="mrow-body"><b>' + esc(a.title) + '</b>' + (a.sub ? '<span>' + esc(a.sub) + '</span>' : '') +
      (a.when ? '<span class="al-when">' + esc(a.when) + '</span>' : '') + '</span>' +
      (a.unread ? '<i class="al-dot" aria-label="Αδιάβαστο"></i>' : '') + '</button>';
  }).join('');
  el.querySelectorAll('[data-al]').forEach(function (b) {
    b.onclick = function () {
      var a = list[+b.dataset.al];
      markAlertsRead([a]);
      b.classList.remove('unread');
      var dot = b.querySelector('.al-dot');
      if (dot) dot.remove();
      a.go();
    };
  });
}

// ── Γρήγορη καταγραφή: σημείωση σε πελάτη / αποτέλεσμα υπόδειξης ──

function lpLeads(mode) {
  if (mode === 'outcome') {
    return S.leads.filter(function (l) { return hasShowing(l) && !upcoming(l); })
      .sort(function (a, b) { return (needsOutcome(b) ? 1 : 0) - (needsOutcome(a) ? 1 : 0) || b.showingTs - a.showingTs; });
  }
  // Πρώτα όσοι έχουν υπόδειξη σήμερα, μετά οι πιο πρόσφατοι.
  var today = isoDate(new Date());
  return S.leads.slice().sort(function (a, b) {
    var at = a.showingDate === today ? 1 : 0, bt = b.showingDate === today ? 1 : 0;
    return bt - at || (b.ts || 0) - (a.ts || 0);
  });
}

function openLeadPick(mode, leadId) {
  S.lp = { mode: mode, lead: null };
  $('lpick-title').textContent = mode === 'outcome' ? 'Πώς πήγε μια υπόδειξη' : 'Σημείωση σε πελάτη';
  $('lp-search').value = '';
  $('lp-msg').textContent = '';
  $('lp-msg').className = 'save-hint';
  if (leadId && findLead(leadId)) lpChoose(findLead(leadId));
  else { $('lp-choose').hidden = false; $('lp-write').hidden = true; renderLeadPick(); }
  openPop('lpick');
}

function renderLeadPick() {
  var mode = S.lp.mode;
  var words = searchWords($('lp-search').value);
  var list = lpLeads(mode).filter(function (l) {
    return !words.length || matches(words, [l.name, l.phone, l.code, l.property, l.email]);
  });
  $('lp-hint').textContent = mode === 'outcome'
    ? (list.length ? 'Υποδείξεις που έγιναν, πρώτα όσες δεν έχουν αποτέλεσμα.' : '')
    : 'Διάλεξε πελάτη. Πρώτα όσοι έχουν υπόδειξη σήμερα.';
  $('lp-list').innerHTML = list.length ? list.slice(0, 8).map(function (l) {
    var k = STATUS_CLASS[l.status] || 'answered';
    return '<button class="mrow" data-lp="' + esc(l.id) + '"><span class="avatar ' + k + '" aria-hidden="true">' + esc(initials(l.name)) + '</span>' +
      '<span class="mrow-body"><b>' + esc(l.name || 'Χωρίς όνομα') + '</b><span>' +
      esc(mode === 'outcome' ? (l.outcome ? l.outcome + ' · ' : 'Χωρίς αποτέλεσμα · ') + lowerDay(niceDate(l.showingAt)) : statusLine(l) + (l.code ? ' · ' + l.code : '')) +
      '</span></span>' + ico('next', 'ico chev') + '</button>';
  }).join('') : '<p class="card-note">' + (mode === 'outcome' ? 'Δεν υπάρχουν υποδείξεις που έγιναν τους τελευταίους 2 μήνες.' : 'Δεν βρέθηκε πελάτης.') + '</p>';
  $('lp-list').querySelectorAll('[data-lp]').forEach(function (b) {
    b.onclick = function () { lpChoose(findLead(b.dataset.lp)); };
  });
}

function lpChoose(l) {
  if (!l) return;
  if (S.lp.mode === 'outcome') { closePop('lpick'); openLead(l.id, { outcome: true }); return; }
  S.lp.lead = l;
  $('lp-who').innerHTML = '<span class="avatar ' + (STATUS_CLASS[l.status] || 'answered') + '" aria-hidden="true">' + esc(initials(l.name)) + '</span>' +
    '<span class="mrow-body"><b>' + esc(l.name || 'Χωρίς όνομα') + '</b><span>' + esc(statusLine(l)) + ' · άλλαξε πελάτη</span></span>';
  $('lp-note').value = '';
  $('lp-save').disabled = false;
  $('lp-choose').hidden = true;
  $('lp-write').hidden = false;
  setTimeout(function () { $('lp-note').focus(); }, 50);
}

function wireLeadPick() {
  $('lp-search').oninput = renderLeadPick;
  $('lp-who').onclick = function () { $('lp-write').hidden = true; $('lp-choose').hidden = false; renderLeadPick(); };
  $('lp-save').onclick = function () {
    var l = S.lp && S.lp.lead, text = $('lp-note').value.trim(), msg = $('lp-msg');
    if (!l) return;
    if (!text) { msg.className = 'save-hint err'; msg.textContent = 'Γράψε πρώτα τη σημείωση.'; return; }
    var d = new Date();
    var line = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + hhmm(d) + ' · ' + text;
    var all = (l.notes ? String(l.notes).replace(/\s+$/, '') + '\n' : '') + line;
    $('lp-save').disabled = true;
    msg.className = 'save-hint';
    msg.textContent = 'Αποθήκευση…';
    send('note', { id: l.id, text: all }).then(function (r) {
      l.notes = all;
      if (S.lead && S.lead.id === l.id) $('d-notes').value = all;
      closePop('lpick');
      toast('Η σημείωση μπήκε στον πελάτη · ' + (l.name || '') + (r.queued ? ' · θα σταλεί μόλις έρθει σήμα' : ''));
    }).catch(function (e) {
      $('lp-save').disabled = false;
      msg.className = 'save-hint err';
      msg.textContent = 'Δεν αποθηκεύτηκε: ' + e.message;
    });
  };
}


// ═════════════════════════════════════════════════════════════
//  2.1 · ΠΡΟΦΙΛ ΠΕΛΑΤΗ
//  Συμπληρώνεται την ώρα της κλήσης. Οι ερωτήσεις αλλάζουν με Αγορά / Ενοικίαση.
//  Κάθε αλλαγή αποθηκεύεται μόνη της (server: Profile.gs → φύλλο «Προφίλ πελατών»).
//  ΑΦΜ / Α.Δ.Τ. δεν ζητούνται εδώ: υπάρχουν μόνο μέσα στο PDF του εντύπου υπόδειξης.
// ═════════════════════════════════════════════════════════════

var PF = {
  buy: [
    { k: 'fin', label: 'Πώς θα πληρώσει', type: 'chips',
      opts: [['cash', 'Ιδία κεφάλαια / μετρητά'], ['loan', 'Στεγαστικό δάνειο'], ['sale', 'Πώληση άλλου ακινήτου']],
      ask: 'Έχετε εξασφαλίσει το κεφάλαιο ή θα προχωρήσετε με στεγαστικό δάνειο;' },
    { k: 'preapproval', label: 'Έχει προέγκριση από τράπεζα', type: 'check', show: { fin: 'loan' } },
    { k: 'when', label: 'Πότε θέλει να αγοράσει', type: 'chips',
      opts: [['now', 'Άμεσα · 0–1 μήνας'], ['soon', 'Σύντομα · 1–3 μήνες'], ['explore', 'Ψάχνει · πάνω από 3 μήνες']],
      ask: 'Πότε υπολογίζετε να ολοκληρώσετε την αγορά; Υπάρχει κάποια διορία που σας πιέζει;' },
    { k: 'decider', label: 'Αποφασίζει ο ίδιος', type: 'check',
      ask: 'Θα είστε εσείς ο τελικός αγοραστής ή θα έρθει και κάποιο άλλο μέλος της οικογένειας στο ραντεβού;' },
    { k: 'companions', label: 'Ποιοι θα έρθουν στο ραντεβού', type: 'text', ph: 'π.χ. σύζυγος, μηχανικός' },
    { k: 'budgetBuy', label: 'Ανώτατο budget', type: 'money',
      ask: 'Το ακίνητο είναι στα {τιμή}. Είναι αυτό το ανώτατο όριό σας ή έχετε υπολογίσει και τα έξοδα μεταβίβασης;' },
    { k: 'costs', label: 'Ξέρει τα έξοδα μεταβίβασης (~8–10%)', type: 'check', hint: 'Συμβολαιογράφος, φόρος, μεσιτικά.' },
    { k: 'areasBuy', label: 'Άλλες περιοχές που τον ενδιαφέρουν', type: 'text', ph: 'π.χ. Παγκράτι, Βύρωνας',
      ask: 'Αν δεν σας κάνει αυτό, σε ποιες άλλες περιοχές θα κοιτάζατε;' }
  ],
  rent: [
    { k: 'people', label: 'Πόσα άτομα θα μείνουν', type: 'num', ask: 'Για πόσα άτομα προορίζεται το σπίτι;' },
    { k: 'household', label: 'Ποιοι θα μείνουν', type: 'text', ph: 'π.χ. ζευγάρι, 3μελής οικογένεια, φοιτητής' },
    { k: 'jobType', label: 'Εργασία', type: 'chips',
      opts: [['private', 'Ιδιωτικός υπάλληλος'], ['public', 'Δημόσιος'], ['free', 'Ελεύθερος επαγγελματίας'], ['retired', 'Συνταξιούχος'], ['student', 'Φοιτητής']],
      ask: 'Για να ενημερώσω τον ιδιοκτήτη, σε τι τομέα εργάζεστε;' },
    { k: 'jobField', label: 'Τομέας εργασίας', type: 'text', ph: 'π.χ. τράπεζα, πληροφορική' },
    { k: 'pet', label: 'Κατοικίδιο', type: 'chips', opts: [['yes', 'Ναι'], ['no', 'Όχι']],
      ask: 'Έχετε κάποιο ζωάκι συντροφιάς που θα μείνει μαζί σας;' },
    { k: 'petKind', label: 'Είδος και μέγεθος', type: 'text', ph: 'π.χ. μικρός σκύλος', show: { pet: 'yes' } },
    { k: 'moveIn', label: 'Πότε θέλει να μπει', type: 'chips',
      opts: [['now', 'Άμεσα'], ['30', 'Μέσα σε 30 ημέρες'], ['60', 'Σε 1–2 μήνες']], ask: 'Πότε θέλετε να μπείτε στο σπίτι;' },
    { k: 'budgetRent', label: 'Ανώτατο ενοίκιο τον μήνα', type: 'money', ask: 'Μέχρι πόσο ενοίκιο σας βολεύει;' },
    { k: 'areasRent', label: 'Άλλες περιοχές που τον ενδιαφέρουν', type: 'text', ph: 'π.χ. Κουκάκι, Πετράλωνα',
      ask: 'Αν δεν σας κάνει αυτό, σε ποιες άλλες περιοχές θα κοιτάζατε;' }
  ]
};
S.profiles = {};

function pfPropOf(l) {
  return S.props.filter(function (x) { return normCode(x.code) === normCode(l.code); })[0] || null;
}

/** Αγορά ή Ενοικίαση από το ακίνητο. Κενό αν δεν φαίνεται. */
function pfDealOf(l) {
  var p = pfPropOf(l);
  var t = fold((p && p.deal) || l.deal || '');
  return /ΕΝΟΙΚ|ΜΙΣΘ/.test(t) ? 'rent' : /ΠΩΛ|ΑΓΟΡ/.test(t) ? 'buy' : '';
}

function pfPrice(l) {
  var p = pfPropOf(l);
  var n = Number(String((p && p.price) || l.price || '').replace(/[^\d.]/g, ''));
  return n || 0;
}

/** Αξιολόγηση: πόσο έτοιμος είναι. Ίδιοι κανόνες για όλους, γραμμένοι σε απλά λόγια. */
function pfScore(d, l) {
  var why = [], pts = 0, max = 0, asked = 0;
  var add = function (n, of, text) { pts += n; max += of; if (text) why.push([n >= of ? 'ok' : n > 0 ? 'mid' : 'no', text]); };
  var price = pfPrice(l);
  if (d.deal === 'buy') {
    if (d.fin) { asked++; add(d.fin === 'cash' || (d.fin === 'loan' && d.preapproval) ? 2 : 1, 2,
      d.fin === 'cash' ? 'Έχει τα χρήματα' : d.fin === 'loan' ? (d.preapproval ? 'Δάνειο με προέγκριση' : 'Δάνειο χωρίς προέγκριση ακόμα') : 'Πρέπει πρώτα να πουλήσει'); }
    if (d.when) { asked++; add(d.when === 'now' ? 2 : d.when === 'soon' ? 1 : 0, 2,
      d.when === 'now' ? 'Θέλει να αγοράσει άμεσα' : d.when === 'soon' ? 'Αγοράζει σε 1–3 μήνες' : 'Ακόμα ψάχνει'); }
    if (d.decider !== undefined) { asked++; add(d.decider ? 1 : 0, 1, d.decider ? 'Αποφασίζει ο ίδιος' : 'Αποφασίζει και άλλος'); }
    if (d.costs !== undefined) { asked++; add(d.costs ? 1 : 0, 1, d.costs ? 'Ξέρει τα έξοδα μεταβίβασης' : 'Δεν ξέρει τα έξοδα μεταβίβασης'); }
    if (d.budgetBuy && price) { asked++; add(d.budgetBuy >= price ? 1 : 0, 1,
      d.budgetBuy >= price ? 'Το budget καλύπτει την τιμή' : 'Budget κάτω από την τιμή (' + fmtPrice(d.budgetBuy) + ')'); }
  } else if (d.deal === 'rent') {
    if (d.moveIn) { asked++; add(d.moveIn === 'now' ? 2 : d.moveIn === '30' ? 1 : 0, 2,
      d.moveIn === 'now' ? 'Θέλει να μπει άμεσα' : d.moveIn === '30' ? 'Μπαίνει σε 30 ημέρες' : 'Μπαίνει σε 1–2 μήνες'); }
    if (d.jobType) { asked++; add(d.jobType === 'student' ? 0 : 1, 1, d.jobType === 'student' ? 'Φοιτητής: ρώτα για εγγυητή' : 'Σταθερό εισόδημα'); }
    if (d.people) { asked++; add(1, 1, d.people + (d.people == 1 ? ' άτομο' : ' άτομα')); }
    if (d.pet) { asked++; add(1, 1, d.pet === 'yes' ? 'Έχει κατοικίδιο: έλεγξε με τον ιδιοκτήτη' : 'Χωρίς κατοικίδιο'); }
    if (d.budgetRent && price) { asked++; add(d.budgetRent >= price ? 1 : 0, 1,
      d.budgetRent >= price ? 'Το ενοίκιο τον καλύπτει' : 'Budget κάτω από το ενοίκιο (' + fmtPrice(d.budgetRent) + ')'); }
  }
  if (asked < 2) return { level: '', why: why, need: 2 - asked };
  var r = pts / max;
  return { level: r >= 0.75 ? 'Θερμός' : r >= 0.45 ? 'Χλιαρός' : 'Κρύος', why: why, pct: Math.round(r * 100) };
}

var PF_TONE = { 'Θερμός': 'showing', 'Χλιαρός': 'noanswer', 'Κρύος': 'closed' };

/** Αντιπρόταση: άλλα διαθέσιμα ακίνητα, ίδια συναλλαγή, μέσα στο budget (ή κοντά στην τιμή). */
function pfMatches(d, l) {
  var deal = d.deal === 'rent' ? 'Ενοικίαση' : 'Πώληση';
  var budget = d.deal === 'rent' ? d.budgetRent : d.budgetBuy;
  var price = pfPrice(l);
  var areas = searchWords(d.deal === 'rent' ? d.areasRent : d.areasBuy);
  var home = pfPropOf(l);
  return S.props.filter(function (p) {
    if (p.available === false || normCode(p.code) === normCode(l.code) || (p.deal && p.deal !== deal)) return false;
    var n = Number(String(p.price || '').replace(/[^\d.]/g, ''));
    if (budget) return n && n <= budget * 1.05;
    return price && n && Math.abs(n - price) <= price * 0.2;
  }).map(function (p) {
    var area = fold(p.area);
    var near = (home && home.area && fold(home.area) === area ? 2 : 0) +
      (areas.some(function (w) { return area.indexOf(w) !== -1; }) ? 3 : 0) + (p.mine ? 1 : 0);
    return { p: p, near: near };
  }).sort(function (a, b) { return b.near - a.near; }).slice(0, 3).map(function (x) { return x.p; });
}

// ── Φόρτωση / αποθήκευση ──

function loadProfile(l) {
  if (S.pf && S.pf.id !== l.id) pfSaveNow();
  var id = l.id;
  var have = S.profiles[id];
  S.pf = { id: id, data: have && have.p ? JSON.parse(JSON.stringify(have.p)) : {}, loaded: !!have, err: '' };
  if (!S.pf.data.deal) S.pf.data.deal = pfDealOf(l) || 'buy';
  renderProfile(l);
  // 2.2: με αλλαγή που δεν έχει σταλεί ακόμα, ισχύει αυτή του κινητού.
  var pending = S.queue.some(function (o) { return o.a === 'profileSave' && o.d.id === id; });
  if (pending) return;
  apiTimed('profileGet', { id: id }, 8000).then(function (r) {
    if (S.queue.some(function (o) { return o.a === 'profileSave' && o.d.id === id; })) return;
    S.profiles[id] = { p: r.p || null, level: r.level || '', updated: r.updated || '' };
    offProfilesSave();
    if (S.lead && S.lead.id === id) pfLine(S.lead);
    if (!S.pf || S.pf.id !== id || S.pf.dirty) return;
    S.pf.data = r.p ? JSON.parse(JSON.stringify(r.p)) : {};
    if (!S.pf.data.deal) S.pf.data.deal = pfDealOf(l) || 'buy';
    S.pf.loaded = true;
    S.pf.updated = r.updated || '';
    renderProfile(l);
  }).catch(function (e) {
    if (!S.pf || S.pf.id !== id) return;
    S.pf.loaded = true;
    if (e.net) {                                    // 2.2: χωρίς σήμα συμπληρώνεται κανονικά
      renderProfile(l);
      pfHint(have ? 'Χωρίς σύνδεση · βλέπεις ό,τι είχε το κινητό. Οι αλλαγές θα σταλούν μετά.' : 'Χωρίς σύνδεση · συμπλήρωσε κανονικά, θα σταλεί μόλις έρθει σήμα.');
      return;
    }
    S.pf.err = /Άγνωστη ενέργεια/.test(e.message)
      ? 'Ο server δεν έχει ακόμα το Προφίλ: πρόσθεσε το Profile.gs στο Apps Script και κάνε Νέα έκδοση.'
      : 'Δεν φόρτωσε το προφίλ: ' + e.message;
    renderProfile(l);
  });
}

function pfSaveSoon() {
  var pf = S.pf;
  if (!pf) return;
  pf.dirty = true;
  pfHint('Αποθήκευση…');
  clearTimeout(pf.timer);
  pf.timer = setTimeout(pfSaveNow, 900);
}

/** quiet: η εφαρμογή πάει στο παρασκήνιο (π.χ. πάτησες Κλήση) → sendBeacon, που φτάνει ακόμα κι αν «παγώσει». */
function pfSaveNow(quiet) {
  var pf = S.pf;
  if (!pf || !pf.dirty) return;
  clearTimeout(pf.timer);
  pf.dirty = false;
  var l = findLead(pf.id);
  var sc = l ? pfScore(pf.data, l) : { level: '' };
  var data = JSON.parse(JSON.stringify(pf.data));
  S.profiles[pf.id] = { p: data, level: sc.level, updated: '' };
  offProfilesSave();
  if (quiet === true) { beacon('profileSave', { id: pf.id, p: data, level: sc.level }); pfHint('Αποθηκεύτηκε'); return; }
  send('profileSave', { id: pf.id, p: data, level: sc.level }).then(function (rr) {
    var r = rr.data;
    S.profiles[pf.id].updated = r.saved;
    if (S.pf === pf) pfHint(rr.queued ? 'Αποθηκεύτηκε στο κινητό · θα σταλεί μόλις έρθει σήμα'
      : r.masked ? 'Αποθηκεύτηκε. Αριθμοί ταυτότητας/ΑΦΜ σβήστηκαν.' : 'Αποθηκεύτηκε ' + lowerDay(niceDate(r.saved)), r.masked);
    if (S.lead && S.lead.id === pf.id) pfLine(S.lead);
  }).catch(function (e) {
    pf.dirty = true;
    if (S.pf === pf) pfHint(/Άγνωστη ενέργεια/.test(e.message)
      ? 'Δεν αποθηκεύτηκε: λείπει το Profile.gs στον server.' : 'Δεν αποθηκεύτηκε: ' + e.message + ' · ξαναδοκιμάζω με την επόμενη αλλαγή.', true);
  });
}

function pfHint(text, bad) {
  var h = $('pf-hint');
  if (!h) return;
  h.textContent = text;
  h.className = 'save-hint pf-hint' + (bad ? ' err' : '');
}

// ── Εμφάνιση ──

function pfAskOn() { return store('kw_pf_ask') !== 'off'; }

function pfField(f, d, l) {
  var v = d[f.k];
  var ask = f.ask && pfAskOn() ? '<p class="pf-ask">' + ico('sms') + '<span>«' + esc(f.ask.replace('{τιμή}', fmtPrice(pfPrice(l)) || 'Χ €')) + '»</span></p>' : '';
  var body = '';
  if (f.type === 'chips') {
    body = '<div class="pf-chips" role="radiogroup" aria-label="' + esc(f.label) + '">' + f.opts.map(function (o) {
      var on = v === o[0];
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-pf-k="' + f.k + '" data-pf-v="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  } else if (f.type === 'check') {
    return '<label class="pf-check" data-pf-row="' + f.k + '"><input type="checkbox" data-pf-k="' + f.k + '"' + (v ? ' checked' : '') + '>' +
      '<span class="pf-switch" aria-hidden="true"></span><span class="pf-check-text"><b>' + esc(f.label) + '</b>' +
      (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</span></label>' + ask;
  } else if (f.type === 'num') {
    body = '<div class="pf-stepper"><button type="button" class="icon-btn ring" data-pf-step="' + f.k + '" data-d="-1" aria-label="Λιγότερα">−</button>' +
      '<input type="text" inputmode="numeric" data-pf-k="' + f.k + '" value="' + esc(v || '') + '" aria-label="' + esc(f.label) + '" placeholder="—">' +
      '<button type="button" class="icon-btn ring" data-pf-step="' + f.k + '" data-d="1" aria-label="Περισσότερα">+</button></div>';
  } else if (f.type === 'money') {
    body = '<div class="pf-money"><input type="text" inputmode="numeric" data-pf-k="' + f.k + '" value="' + esc(v ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '') +
      '" aria-label="' + esc(f.label) + '" placeholder="π.χ. ' + (f.k === 'budgetRent' ? '900' : '250.000') + '"><span>€</span></div>';
  } else {
    body = '<input type="text" data-pf-k="' + f.k + '" value="' + esc(v || '') + '" maxlength="200" placeholder="' + esc(f.ph || '') + '" aria-label="' + esc(f.label) + '">';
  }
  var mem = typeof memChips === 'function' ? memChips(f.k, d) : '';    // 2.3 · FEAT-9 Smart Form Memory
  return '<div class="pf-field" data-pf-row="' + f.k + '"><span class="pf-label">' + esc(f.label) + '</span>' + ask + body + mem + '</div>';
}

function renderProfile(l) {
  var el = $('pf-body');
  if (!el || !S.pf) return;
  var d = S.pf.data;
  if (S.pf.err) {
    el.innerHTML = '<p class="card-note pf-err">' + esc(S.pf.err) + '</p>';
    return;
  }
  var deal = d.deal || 'buy';
  var html = '<div class="pf-top">' +
    '<div class="seg pf-deal" role="radiogroup" aria-label="Τι ψάχνει">' +
      '<button type="button" class="seg-btn' + (deal === 'buy' ? ' is-on' : '') + '" role="radio" aria-checked="' + (deal === 'buy') + '" data-pf-deal="buy">' + ico('home') + 'Αγορά</button>' +
      '<button type="button" class="seg-btn' + (deal === 'rent' ? ' is-on' : '') + '" role="radio" aria-checked="' + (deal === 'rent') + '" data-pf-deal="rent">' + ico('key') + 'Ενοικίαση</button>' +
    '</div>' +
    '<div class="pf-meter" id="pf-meter"></div>' +
  '</div>' +
  '<label class="pf-asktoggle"><input type="checkbox" id="pf-ask-on"' + (pfAskOn() ? ' checked' : '') + '> Δείξε τι να ρωτήσω</label>' +
  (S.pf.loaded ? '' : '<p class="field-hint">Φόρτωση προφίλ…</p>') +
  '<section class="pf-sec"><h4>Πελάτης</h4>' +
    '<div class="pf-field"><span class="pf-label">Ονοματεπώνυμο</span><input type="text" data-pf-k="name" value="' + esc(d.name || l.name || '') + '" maxlength="80" autocomplete="off"></div>' +
    '<div class="pf-field"><span class="pf-label">Email <small>(προαιρετικό)</small></span><input type="email" inputmode="email" data-pf-k="email" value="' + esc(d.email || l.email || '') + '" autocomplete="off"></div>' +
    '<p class="field-hint pf-note">ΑΦΜ και ταυτότητα δεν χρειάζονται τώρα. Τα γράφει ο πελάτης μόνος του στο έντυπο υπόδειξης.</p>' +
  '</section>' +
  '<section class="pf-sec"><h4>' + (deal === 'rent' ? 'Ενοικίαση' : 'Αγορά') + '</h4>' +
    PF[deal].map(function (f) { return pfField(f, d, l); }).join('') + '</section>' +
  '<section class="pf-sec pf-result" id="pf-result"></section>' +
  '<p class="save-hint pf-hint" id="pf-hint" aria-live="polite">' + (S.pf.updated ? 'Τελευταία αλλαγή ' + esc(lowerDay(niceDate(S.pf.updated))) : '') + '</p>';
  el.innerHTML = html;
  pfConditional();
  pfRefresh(l);
}

/** Πεδία που φαίνονται μόνο με κάποια απάντηση (π.χ. «προέγκριση» μόνο με δάνειο). */
function pfConditional() {
  var d = S.pf.data, deal = d.deal || 'buy';
  PF[deal].forEach(function (f) {
    if (!f.show) return;
    var k = Object.keys(f.show)[0];
    var row = $('pf-body').querySelector('[data-pf-row="' + f.k + '"]');
    if (row) row.hidden = d[k] !== f.show[k];
  });
}

/** Ξαναγράφει μόνο την αξιολόγηση και το «τι κάνω τώρα», χωρίς να χάνεται το πεδίο που γράφεις. */
function pfRefresh(l) {
  var d = S.pf.data, sc = pfScore(d, l);
  var meter = $('pf-meter'), res = $('pf-result');
  if (!meter || !res) return;
  meter.innerHTML = sc.level
    ? '<span class="tag ' + PF_TONE[sc.level] + ' pf-level">' + esc(sc.level) + '</span><span class="pf-bar"><i style="width:' + sc.pct + '%"></i></span>'
    : '<span class="pf-wait">Απάντησε ' + sc.need + (sc.need === 1 ? ' ακόμα ερώτηση' : ' ερωτήσεις') + ' για αξιολόγηση</span>';
  $('pf-tab-dot').hidden = !sc.level;
  $('pf-tab-dot').className = 'pf-dot ' + (sc.level ? PF_TONE[sc.level] : '');

  if (!sc.level) { res.innerHTML = ''; return; }
  var budget = d.deal === 'rent' ? d.budgetRent : d.budgetBuy, price = pfPrice(l);
  var low = budget && price && budget < price;
  var matches = (sc.level === 'Κρύος' || low) ? pfMatches(d, l) : [];
  var advice = sc.level === 'Θερμός' ? ['Κλείσε υπόδειξη τώρα, όσο είναι στο τηλέφωνο.', 'showing']
    : sc.level === 'Χλιαρός' ? ['Πρότεινε υπόδειξη. Αν διστάζει, στείλε του την παρουσίαση.', 'showing']
    : ['Μάλλον όχι αυτό το ακίνητο. Δες αν του ταιριάζει κάποιο άλλο.', ''];
  res.innerHTML = '<h4>Τι κάνω τώρα</h4>' +
    '<div class="pf-advice ' + PF_TONE[sc.level] + '"><b>' + esc(sc.level) + '</b><span>' + esc(advice[0]) + '</span></div>' +
    '<ul class="pf-why">' + sc.why.map(function (w) {
      return '<li class="' + w[0] + '">' + ico(w[0] === 'ok' ? 'check' : w[0] === 'mid' ? 'next' : 'alert') + '<span>' + esc(w[1]) + '</span></li>';
    }).join('') + '</ul>' +
    '<div class="pf-acts">' +
      (advice[1] && !hasShowing(l) ? '<button type="button" class="btn solid-red" data-pf-act="showing">' + ico('calendar') + '<span>Κλείσε υπόδειξη</span></button>' : '') +
      (pfPropOf(l) && pfPropOf(l).available !== false ? '<button type="button" class="btn" data-pf-act="present">' + ico('out') + '<span>Στείλε παρουσίαση</span></button>' : '') +
    '</div>' +
    (low ? '<p class="pf-low">' + ico('alert') + 'Το budget είναι κάτω από την τιμή του ακινήτου (' + esc(fmtPrice(price)) + ').</p>' : '') +
    (matches.length ? '<h4>Αντιπρόταση · ταιριάζουν στο budget</h4><div class="pf-matches">' + matches.map(function (p) {
      return '<div class="pf-match"><button type="button" class="pf-m-main" data-pf-open="' + esc(p.code) + '">' +
        thumbHtml(p.code) + '<span><b>' + esc(fmtPrice(p.price)) + '</b>' + esc(p.street || p.title || p.code) +
        '<small>' + esc([p.sqm ? p.sqm + ' τ.μ.' : '', p.area, p.mine ? 'δικό σου' : p.partner].filter(Boolean).join(' · ')) + '</small></span></button>' +
        '<button type="button" class="btn small" data-pf-send="' + esc(p.code) + '">Στείλε</button></div>';
    }).join('') + '</div>' : (sc.level === 'Κρύος' || low ? '<p class="field-hint">Κανένα άλλο διαθέσιμο ακίνητο της ομάδας δεν ταιριάζει. Γράψε περιοχές για να ψάξω πιο ευρύτερα.</p>' : ''));
  wireThumbs(res);
}

/** Η γραμμή κάτω από το όνομα στην κάρτα πελάτη: «Θερμός · Αγορά · Δάνειο με προέγκριση · έως 250.000 €». */
function pfLine(l) {
  var b = $('d-pf-line'), rec = S.profiles[l.id];
  if (!rec || !rec.p) { b.hidden = true; return; }
  var d = rec.p, sc = pfScore(d, l), parts = [];
  if (d.deal === 'buy') {
    parts.push('Αγορά');
    if (d.fin) parts.push({ cash: 'Μετρητά', loan: d.preapproval ? 'Δάνειο με προέγκριση' : 'Δάνειο', sale: 'Με πώληση ακινήτου' }[d.fin]);
    if (d.when) parts.push({ now: 'Άμεσα', soon: '1–3 μήνες', explore: 'Ψάχνει' }[d.when]);
    if (d.budgetBuy) parts.push('έως ' + fmtPrice(d.budgetBuy));
  } else {
    parts.push('Ενοικίαση');
    if (d.people) parts.push(d.people + (d.people == 1 ? ' άτομο' : ' άτομα'));
    if (d.pet) parts.push(d.pet === 'yes' ? 'κατοικίδιο' : 'χωρίς κατοικίδιο');
    if (d.moveIn) parts.push({ now: 'άμεσα', '30': 'σε 30 ημέρες', '60': 'σε 1–2 μήνες' }[d.moveIn]);
  }
  b.innerHTML = (sc.level ? '<span class="tag ' + PF_TONE[sc.level] + '">' + esc(sc.level) + '</span>' : '') +
    '<span>' + esc(parts.join(' · ')) + '</span>' + ico('next', 'ico chev');
  b.hidden = false;
}

function showProfileTab() {
  setTab('tabs-detail', 'profile');
  showPane('detail-panes', 'profile');
}

function wireProfile() {
  var root = $('pf-body');
  var val = function (k, v) {
    if (v === '' || v == null) delete S.pf.data[k]; else S.pf.data[k] = v;
    pfConditional();
    pfRefresh(findLead(S.pf.id));
    pfSaveSoon();
  };
  root.addEventListener('click', function (e) {
    var t = e.target.closest('button, input');
    if (!t || !S.pf) return;
    var l = findLead(S.pf.id);
    if (t.dataset.pfDeal) {
      if (S.pf.data.deal === t.dataset.pfDeal) return;
      S.pf.data.deal = t.dataset.pfDeal;
      renderProfile(l);
      pfSaveSoon();
    } else if (t.dataset.pfV) {
      var k = t.dataset.pfK, on = S.pf.data[k] !== t.dataset.pfV;      // ξανά πάτημα = ακύρωση
      t.parentNode.querySelectorAll('.chip').forEach(function (c) {
        var me = c === t && on;
        c.classList.toggle('is-on', me);
        c.setAttribute('aria-checked', me ? 'true' : 'false');
      });
      val(k, on ? t.dataset.pfV : '');
    } else if (t.dataset.pfMemk) {                                  // 2.3 · chip «Συχνά:»
      memPick(t, val);
    } else if (t.dataset.pfStep) {
      var key = t.dataset.pfStep, n = Math.max(0, Math.min(20, (Number(S.pf.data[key]) || 0) + Number(t.dataset.d)));
      root.querySelector('input[data-pf-k="' + key + '"]').value = n || '';
      val(key, n || '');
    } else if (t.dataset.pfAct === 'showing') {
      pfSaveNow();
      openShowingForm();
    } else if (t.dataset.pfAct === 'present') {
      pfSaveNow();
      openPresent(pfPropOf(l), l);
    } else if (t.dataset.pfOpen) {
      pfSaveNow();
      openProp(t.dataset.pfOpen);
    } else if (t.dataset.pfSend) {
      pfSaveNow();
      openPresent(S.props.filter(function (p) { return p.code === t.dataset.pfSend; })[0], l);
    } else if (t.id === 'pf-ask-on') {
      store('kw_pf_ask', t.checked ? null : 'off');
      renderProfile(l);
    }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.type === 'checkbox' && t.dataset.pfK) val(t.dataset.pfK, t.checked ? true : false);
    // 2.3 · μαθαίνει όταν φεύγεις από το πεδίο, όχι σε κάθε πλήκτρο
    if (t.dataset.pfK && typeof memLearn === 'function' && memKind(t.dataset.pfK)) memLearn(S.pf.id, t.dataset.pfK, S.pf.data[t.dataset.pfK]);
  });
  root.addEventListener('input', function (e) {
    var t = e.target, k = t.dataset.pfK;
    if (!k || t.type === 'checkbox') return;
    var f = PF.buy.concat(PF.rent).filter(function (x) { return x.k === k; })[0];
    if (f && f.type === 'money') {
      var digits = t.value.replace(/\D/g, '').slice(0, 9);
      t.value = digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
      val(k, digits ? Number(digits) : '');
    } else if (f && f.type === 'num') {
      var nn = t.value.replace(/\D/g, '').slice(0, 2);
      t.value = nn;
      val(k, nn ? Number(nn) : '');
    } else {
      val(k, t.value.trim() ? t.value : '');
    }
  });
  $('d-pf-line').onclick = showProfileTab;
}


// ═════════════════════════════════════════════════════════════
//  2.2 · ΧΩΡΙΣ INTERNET (offline-first)
//
//  Στην κλήση, χωρίς VoLTE, τα data κόβονται. Γι' αυτό:
//   1. Τα στοιχεία (κλήσεις, ακίνητα, εργασίες, προφίλ) μένουν στο κινητό,
//      ώστε η εφαρμογή να ανοίγει και χωρίς σήμα. Σβήνονται με αποσύνδεση,
//      ανάκληση, ή αν η εφαρμογή δεν ανοίξει 14 ημέρες. Ποτέ ΑΦΜ / Α.Δ.Τ.
//   2. Κάθε αλλαγή γίνεται αμέσως στην οθόνη και μπαίνει σε ΟΥΡΑ. Η ουρά
//      στέλνεται μόνη της, με τη σειρά, μόλις έρθει σήμα.
//   3. Ό,τι θέλει οπωσδήποτε τον server (ανέβασμα αρχείων, link εντύπου,
//      παρουσίαση) λέει καθαρά «Χρειάζεται σύνδεση».
// ═════════════════════════════════════════════════════════════

var OFF = {
  KEEP_DAYS: 14,
  QUIET: { open: 1, called: 1, sms: 1 },   // καταγραφές στο παρασκήνιο: στέλνονται, δεν μετράνε στη μπάρα
  TRY_MS: 6000,          // πόσο περιμένουμε τον server πριν πάει η αλλαγή στην ουρά
  FLUSH_MS: 20000,       // κάθε πόσο ξαναδοκιμάζει όσο υπάρχει ουρά
  // Οι αλλαγές που δουλεύουν χωρίς σήμα. Όλες είναι «ασφαλείς να ξανασταλούν»:
  // το ίδιο αίτημα δύο φορές δίνει το ίδιο αποτέλεσμα (π.χ. η υπόδειξη μετακινεί το ίδιο event).
  QUEUED: { status: 1, note: 1, showing: 1, cancelShowing: 1, outcome: 1, taskDone: 1, taskSave: 1, taskDelete: 1,
            callNote: 1, profileSave: 1, open: 1, called: 1, sms: 1 }
};
S.queue = [];
S.netBad = false;        // η τελευταία προσπάθεια απέτυχε → οι επόμενες αλλαγές πάνε κατευθείαν στην ουρά
S.flushing = false;

/** Σφάλμα δικτύου (όχι «λάθος στοιχεία» από τον server): αυτό σημαίνει «δοκίμασε αργότερα». */
function isNetErr(e) { return !!(e && (e.net || e.name === 'AbortError' || e.name === 'TypeError')); }

/** fetch με όριο χρόνου. Στο 2G ένα αίτημα μπορεί να «κρέμεται» για λεπτά. */
function apiTimed(action, data, ms) {
  var ctl = window.AbortController ? new AbortController() : null;
  var t = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
  return api(action, data, ctl ? ctl.signal : undefined).then(function (d) {
    clearTimeout(t);
    S.netBad = false;
    return d;
  }, function (e) {
    clearTimeout(t);
    if (isNetErr(e)) { e.net = true; S.netBad = true; }
    throw e;
  });
}

// ── Η ουρά ───────────────────────────────────────────────

function qLoad() {
  try { S.queue = JSON.parse(store('kw_queue') || '[]') || []; } catch (e) { S.queue = []; }
}
function qSave() { store('kw_queue', S.queue.length ? JSON.stringify(S.queue) : null); offBar(); }

function qId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/**
 * Στέλνει μια αλλαγή. Με σήμα: όπως πριν. Χωρίς σήμα (ή αν υπάρχει ήδη ουρά, για να
 * μείνει η σειρά): μπαίνει στην ουρά και επιστρέφει ό,τι θα έδινε ο server, από το κινητό.
 * Απάντηση: { data, queued }.
 */
function send(action, data) {
  if (!OFF.QUEUED[action]) return api(action, data).then(function (d) { return { data: d, queued: false }; });
  if (S.queue.length || S.netBad || navigator.onLine === false) return Promise.resolve(qPush(action, data));
  return apiTimed(action, data, OFF.TRY_MS).then(function (d) {
    return { data: d, queued: false };
  }, function (e) {
    if (!e.net) throw e;
    return qPush(action, data);
  });
}

function qPush(action, data) {
  var op = { id: qId(), a: action, d: data, at: Date.now() };
  var local = offLocal(op);
  S.queue.push(op);
  qSave();
  offSnapshotSoon();
  offFlushSoon();
  return { data: local, queued: true };
}

/** Στέλνει την ουρά με τη σειρά. Σταματά στο πρώτο σφάλμα δικτύου· ξαναπροσπαθεί αργότερα. */
function offFlush(manual) {
  if (S.flushing || !S.queue.length || !S.boot) return Promise.resolve();
  S.flushing = true;
  offBar();
  var sent = 0, failed = [];
  var step = function () {
    var op = S.queue[0];
    if (!op) return Promise.resolve();
    return apiTimed(op.a, op.d, 15000).then(function (res) {
      S.queue.shift();
      if (!OFF.QUIET[op.a]) sent++;
      offApplyServer(op, res);
      qSave();
      return step();
    }, function (e) {
      if (e.net) return null;                            // ακόμα χωρίς σήμα
      if (e.code === 'auth') return null;
      // Ο server αρνήθηκε (π.χ. η κλήση δεν υπάρχει πια): βγαίνει από την ουρά, το λέμε.
      S.queue.shift();
      failed.push(op);
      qSave();
      return step();
    });
  };
  return step().then(function () {
    S.flushing = false;
    offBar();
    if (failed.length) toast('Δεν πέρασαν ' + plural(failed.length, 'αλλαγή', 'αλλαγές') + ': ' + failed.map(offLabel).join(', '), true);
    if (sent && !S.queue.length) {
      if (!failed.length) toast('✓ ' + (sent === 1 ? 'Στάλθηκε 1 αλλαγή' : 'Στάλθηκαν ' + sent + ' αλλαγές') + ' που έκανες χωρίς σήμα');
      if (!isAdminMode() && $('detail').hidden && $('showing').hidden) offRefresh();
    }
    if (S.queue.length) offFlushSoon();
  }, function () { S.flushing = false; offBar(); });
}

var offTimer = null;
function offFlushSoon(ms) {
  clearTimeout(offTimer);
  if (S.queue.length) offTimer = setTimeout(function () { offFlush(); }, ms == null ? OFF.FLUSH_MS : ms);
}

/** Μετά το στείλσιμο: η απάντηση του server αντικαθιστά την τοπική εκδοχή. */
function offApplyServer(op, res) {
  var a = op.a;
  if (a === 'status' || a === 'outcome') { if (res && res.id) merge(res); }
  else if ((a === 'showing' || a === 'cancelShowing' || a === 'callNote') && res && res.lead) merge(res.lead);
  else if (a === 'taskDone' && res && res.id) mergeTask(res);
  else if (a === 'taskSave' && res && res.id) {
    // Νέα εργασία: ο server της έδωσε κανονικό ID. Το περνάμε και στις επόμενες αλλαγές της ουράς.
    var tmp = op.tmp;
    if (tmp) {
      S.tasks = S.tasks.filter(function (t) { return t.id !== tmp; });
      S.queue.forEach(function (o) { if (o.d && o.d.id === tmp) o.d.id = res.id; });
    }
    mergeTask(res);
  }
  else if (a === 'profileSave' && S.profiles[op.d.id]) S.profiles[op.d.id].updated = (res && res.saved) || '';
  if (a === 'status' && op.d.status === ST.NO_ANSWER && res && res.followUp) {
    toast('Follow-up ' + res.followUp + ' · μπήκε στο ημερολόγιο');
  }
  if (a === 'showing' && res && res.when) toast('Η υπόδειξη ' + res.when + ' μπήκε στο ημερολόγιο');
  if (S.lead && $('detail').hidden === false) { var l = findLead(S.lead.id); if (l) fillDetail(l); }
  render();
  if (S.view === 'today') renderToday();
}

function offLabel(op) {
  var l = op.d && op.d.id ? findLead(op.d.id) : null;
  var who = l ? ' · ' + (l.name || 'πελάτης') : '';
  return ({ status: 'Κατάσταση', note: 'Σημείωση', showing: 'Υπόδειξη', cancelShowing: 'Ακύρωση υπόδειξης', outcome: 'Αποτέλεσμα υπόδειξης',
    taskDone: 'Εργασία', taskSave: 'Εργασία', taskDelete: 'Διαγραφή εργασίας', callNote: 'Σημείωση κλήσης', profileSave: 'Προφίλ',
    open: 'Άνοιγμα', called: 'Κλήση', sms: 'SMS' }[op.a] || op.a) + who;
}

// ── Η αλλαγή στο κινητό, ίδια με ό,τι θα έκανε ο server ──

function cloneOf(o) { return JSON.parse(JSON.stringify(o)); }
function stampOf(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hhmm(d); }

/** Εφαρμόζει την αλλαγή στα τοπικά στοιχεία και επιστρέφει ό,τι θα επέστρεφε ο server. */
function offLocal(op) {
  var a = op.a, d = op.d || {};
  var l0 = d.id ? findLead(d.id) : null;
  var l = l0 ? cloneOf(l0) : null;
  if (a === 'status' && l) {
    l.status = d.status;
    if (d.status === ST.NO_ANSWER) {
      var fu = new Date(op.at + ((S.boot && S.boot.followupHours) || 2) * 3600000);
      l.followUp = stampOf(fu);
    } else l.followUp = '';
    if (d.status === ST.ANSWERED && !l.called) l.called = stampOf(new Date(op.at));
    merge(l);
    return l;
  }
  if (a === 'note' && l) { l.notes = d.text; merge(l); return {}; }
  if (a === 'outcome' && l) { l.outcome = d.outcome; l.outcomeNote = d.note || ''; merge(l); return l; }
  if (a === 'showing' && l) {
    var p = d.date.split('-').map(Number), hm = String(d.time).split(':').map(Number);
    var when = new Date(p[0], p[1] - 1, p[2], hm[0], hm[1]);
    var updated = hasShowing(l);
    l.status = ST.SHOWING;
    l.showingAt = stampOf(when); l.showingDate = d.date; l.showingTime = d.time; l.showingTs = when.getTime();
    l.hasEvent = true; l.followUp = '';
    if (d.address) l.address = d.address;
    merge(l);
    return { lead: l, updated: updated, when: niceDate(l.showingAt), invited: false };
  }
  if (a === 'cancelShowing' && l) {
    var date = l.showingDate, time = l.showingTime;
    l.status = ST.ANSWERED; l.showingAt = ''; l.showingDate = ''; l.showingTime = ''; l.showingTs = 0; l.hasEvent = false;
    merge(l);
    return { lead: l, date: date, time: time, eventDeleted: false };
  }
  if (a === 'callNote' && l) {
    var found = false;
    l.calls = (l.calls || []).map(function (c) {
      if (c.id !== d.cid) return c;
      found = true;
      return Object.assign({}, c, { result: d.result, note: d.note });
    });
    if (!found) l.calls.push({ id: d.cid, at: stampOf(new Date(d.at || op.at)), ts: d.at || op.at, result: d.result, note: d.note });
    merge(l);
    return { lead: l, masked: false };
  }
  if (a === 'taskDone') {
    var t = findTask(d.id);
    if (!t) return {};
    t = cloneOf(t);
    t.done = d.done ? nowStamp() : ''; t.doneTs = d.done ? op.at : 0;
    mergeTask(t);
    return t;
  }
  if (a === 'taskSave') {
    var base = d.id ? findTask(d.id) : null;
    var nt = Object.assign(base ? cloneOf(base) : { done: '', doneTs: 0 }, {
      id: d.id || (op.tmp = op.tmp || 'tmp-' + op.id), title: d.title, date: d.date, time: d.time, notes: d.notes });
    if (d.lead) { nt.lead = d.lead; var ll = findLead(d.lead); nt.leadName = ll ? ll.name : nt.leadName; }
    nt.pending = true;
    mergeTask(nt);
    return nt;
  }
  if (a === 'taskDelete') { S.tasks = S.tasks.filter(function (x) { return x.id !== d.id; }); return {}; }
  if (a === 'profileSave') {
    S.profiles[d.id] = { p: cloneOf(d.p || {}), level: d.level || '', updated: '' };
    offProfilesSave();
    return { saved: '', masked: false };
  }
  if (a === 'open' && l) { l.opened = l.opened || nowStamp(); merge(l); return {}; }
  return {};
}

/** Μετά από κάθε φρέσκια λήψη από τον server, ξαναβάζουμε από πάνω ό,τι δεν έχει σταλεί ακόμα. */
function offReapply() {
  S.queue.forEach(function (op) { try { offLocal(op); } catch (e) { /* η κλήση μπορεί να μην υπάρχει πια */ } });
}

function offRefresh() {
  apiTimed('bootstrap', {}, 15000).then(function (b) {
    S.boot = b; S.me = b.agent; S.flags = b.flags || {};   // 2.3.2: και τα feature flags
    S.bootStale = false; S.bootAt = Date.now(); S.netBad = false;
    applyData(b);
    offSnapshot();
    render();
    fillSettings();
    offBar();
  }).catch(function () {});
}

// ── Τα στοιχεία στο κινητό (για άνοιγμα χωρίς σήμα) ──

function offSnapshot() {
  if (!S.boot || !TOKEN) return;
  var b = Object.assign({}, S.boot, { leads: S.leads, props: S.props, tasks: S.tasks });
  try { localStorage.setItem('kw_boot', JSON.stringify({ at: Date.now(), from: S.bootAt || Date.now(), b: b })); }
  catch (e) { /* γεμάτος χώρος: απλώς δεν κρατάμε */ }
}
var snapTimer = null;
function offSnapshotSoon() { clearTimeout(snapTimer); snapTimer = setTimeout(offSnapshot, 800); }

function offCached() {
  try {
    var c = JSON.parse(localStorage.getItem('kw_boot') || 'null');
    if (!c || !c.b) return null;
    if (Date.now() - c.at > OFF.KEEP_DAYS * 86400000) { offForget(); return null; }   // 14 ημέρες χωρίς άνοιγμα
    return c;
  } catch (e) { return null; }
}

function offProfilesSave() {
  try { localStorage.setItem('kw_prof', JSON.stringify(S.profiles)); } catch (e) { /* χωρίς χώρο */ }
}
function offProfilesLoad() {
  try { S.profiles = JSON.parse(localStorage.getItem('kw_prof') || '{}') || {}; } catch (e) { S.profiles = {}; }
}

/** Σβήνει ό,τι κρατά το κινητό για τους πελάτες. Αποσύνδεση, ανάκληση, 14 ημέρες. */
function offForget() {
  ['kw_boot', 'kw_prof', 'kw_queue', 'kw_cache_contacts', 'kw_cache_referrals', 'kw_cache_metrics', 'kw_call', 'kw_mem'].forEach(function (k) {
    try { localStorage.removeItem(k); } catch (e) { /* ιδιωτική περιήγηση */ }
  });
  S.queue = [];
}

/** Ανάγνωση με αντίγραφο: με σήμα φέρνει φρέσκα, χωρίς σήμα δίνει τα τελευταία. */
function apiRead(action, data) {
  var key = 'kw_cache_' + action;
  return apiTimed(action, data, 15000).then(function (d) {
    try { var s = JSON.stringify({ at: Date.now(), d: d }); if (s.length < 1500000) localStorage.setItem(key, s); } catch (e) { /* χώρος */ }
    return d;
  }, function (e) {
    if (!e.net) throw e;
    try { var c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) { toast('Χωρίς σύνδεση · δείχνω ό,τι είχε φορτώσει'); return c.d; } } catch (x) { /* τίποτα */ }
    throw new Error('Χρειάζεται σύνδεση. Θα φορτώσει μόλις έρθει σήμα.');
  });
}

// ── Η μπάρα κατάστασης ───────────────────────────────────

function offBar() {
  var bar = $('offbar');
  if (!bar || !S.boot) return;
  var n = S.queue.filter(function (o) { return !OFF.QUIET[o.a]; }).length;
  var off = S.netBad || navigator.onLine === false;
  bar.hidden = !n && !off && !S.bootStale;
  var queued = S.queue.length;
  if (bar.hidden) { document.body.classList.remove('has-offbar'); return; }
  document.body.classList.add('has-offbar');
  bar.className = 'offbar' + (off ? ' off' : '') + (S.flushing ? ' busy' : '');
  var text = off ? 'Χωρίς σύνδεση' : S.flushing ? 'Αποστολή…' : n ? 'Περιμένουν αποστολή' : 'Ενημέρωση…';
  if (n) text += ' · ' + plural(n, 'αλλαγή', 'αλλαγές');
  else if (S.bootStale && S.bootAt) text += ' · στοιχεία από ' + lowerDay(niceDate(stampOf(new Date(S.bootAt))));
  $('offbar-text').textContent = text;
  $('offbar-btn').hidden = !queued || S.flushing;
}

function wireOffline() {
  $('offbar-btn').onclick = function () { S.netBad = false; offFlush(true); };
  window.addEventListener('online', function () { S.netBad = false; offBar(); offFlushSoon(300); if (S.bootStale) offRefresh(); });
  window.addEventListener('offline', function () { S.netBad = true; offBar(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) offFlushSoon(800); });
  setInterval(function () { if (S.queue.length && !S.flushing) offFlush(); }, OFF.FLUSH_MS);
  // Ο service worker κρατά την εφαρμογή στο κινητό: γράφεται πάντα, όχι μόνο με ειδοποιήσεις.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  offBar();
}

// ── Εκκίνηση (τελευταία, αφού έχουν οριστεί όλα) ──
start();

})();
