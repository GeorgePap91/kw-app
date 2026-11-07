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
var APP_VERSION = '1.14.1';

/** Έκδοση server που περιμένει η σελίδα. */
var API_VERSION = '1.14';

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

var SHEETS = ['contact-edit', 'templates', 'task', 'settings', 'showing', 'propdetail', 'contact', 'detail'];
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
  var top = openSheets()[0];
  if (!top) return false;
  if (top === 'detail') closeDetail();
  else {
    if (top === 'propdetail') S.prop = null;
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

// ─────────────────────────────────────────────────────────────
//  ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ ΤΟ APPS SCRIPT
// ─────────────────────────────────────────────────────────────
// text/plain: δεν προκαλεί CORS preflight, που το Apps Script δεν δέχεται.

function body(action, data) {
  return JSON.stringify({ t: TOKEN, action: action, data: data || {} });
}

function api(action, data) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body(action, data)
  }).then(function (r) {
    if (!r.ok) throw new Error('Σφάλμα δικτύου (' + r.status + ')');
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

start();

function start() {
  if (!API || API.indexOf('ΒΑΛΕ') !== -1) return bootFail('Λείπει το API_URL στο config.js.', true);
  if (!TOKEN) return needPairing();

  $('boot-msg').textContent = 'Φόρτωση…';
  $('boot-retry').hidden = true;

  api('bootstrap').then(onBoot).catch(function (e) {
    if (e.code === 'auth') { forgetDevice(); return needPairing(true); }
    bootFail('Δεν φόρτωσε: ' + e.message, false);
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
  applyData(b);

  $('env').hidden = b.env === 'prod';
  document.body.classList.toggle('has-env', b.env !== 'prod');
  fillSelect($('d-status-select'), b.statuses);
  renderForms(b.forms || []);
  $('book-link').href = b.bookingUrl || '#';
  $('book-link').hidden = !b.bookingUrl;
  $('tabs-forms').hidden = !b.bookingUrl;   // με μία μόνο ενότητα δεν χρειάζονται tabs
  fillSettings();

  // Ο χάρτης ανάβει από το CONFIG.MAP.ENABLED του Code.gs.
  $('tab-map').hidden = !b.mapEnabled;
  $('tabs-props').classList.toggle('four', !!b.mapEnabled);

  $('boot').hidden = true;
  $('app').hidden = false;

  render();
  if (!S.wired) { wire(); backGuard(); }

  setInterval(poll, 180000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) poll();          // γύρισες από την κλήση → φρέσκια λίστα
  });

  setupPush();
  if (LEAD_PARAM) openLead(LEAD_PARAM, { remind: REMIND_PARAM });
  else if (DOCS_PARAM) showMissingDocs();
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
    else if (m.type === 'open' && m.id) openLead(m.id, { remind: m.remind });
    if (m.type === 'push' && m.data && m.data.type === 'lead') refreshLeads();
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
    if (v === 'bill' && S.prop) loadDocs(S.prop, 'bill');
  });
  wireTabs('tabs-settings', 'settings-panes', function (v) { showPane('settings-panes', v); });
  wireTabs('mx-mode', 'mx-body', function (v) { S.mxMode = v; S.mxOpen = ''; renderMetrics(); window.scrollTo(0, 0); });

  wireTabs('tabs-props', 'props-panes', function (v) { S.propTab = v; resetPage('props:' + v); renderProps(); window.scrollTo(0, 0); });
  $$('[data-settings]').forEach(function (b) { b.onclick = openSettings; });
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
  $('settings-back').onclick = function () { closeSheet('settings'); };
  $('propdetail-back').onclick = function () { closeSheet('propdetail'); S.prop = null; };
  $('task-back').onclick = function () { closeSheet('task'); };
  $('templates-back').onclick = function () { closeSheet('templates'); };

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
  $('btn-noanswer').onclick = onNoAnswer;
  $('btn-showing').onclick = openShowingForm;
  $('btn-showform').onclick = function () {
    openShowingForm();
    // Το έντυπο είναι πάνω-πάνω στο φύλλο της υπόδειξης.
    $('showing').querySelector('.sheet-body').scrollTop = 0;
  };
  $('btn-save-showing').onclick = onSaveShowing;
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

var VIEWS = ['today', 'calls', 'tasks', 'props', 'more', 'contacts', 'metrics', 'forms'];
var NAV_OF = { metrics: 'more', forms: 'more', contacts: 'more' };   // ποιο κουμπί του μενού φωτίζεται

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
  slide($('view-' + view), dir);
  window.scrollTo(0, 0);
  if (view === 'props') renderProps();
  if (view === 'tasks') renderTasks();
  if (view === 'today') renderToday();
  if (view === 'contacts') loadContacts();
  if (view === 'metrics') loadMetrics(false);
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
  setBadge(S.leads.filter(isOpen).length);
  renderCalls();
  renderTasks();
  if (S.view === 'props') renderProps();
}

/** «01/11/2026 09:45» → «Σήμερα 09:45». Ό,τι δεν αναγνωρίζει μένει όπως είναι. */
function niceDate(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}:\d{2})/.exec(String(s || ''));
  if (!m) return s || '';
  var iso = m[3] + '-' + m[2] + '-' + m[1];
  if (iso === isoDate(new Date())) return 'Σήμερα ' + m[4];
  if (iso === isoDate(new Date(Date.now() - 86400000))) return 'Χθες ' + m[4];
  if (+m[3] !== new Date().getFullYear()) return m[1] + '/' + m[2] + '/' + m[3];
  return WEEKDAYS[new Date(+m[3], +m[2] - 1, +m[1]).getDay()] + ' ' + m[1] + '/' + m[2] + ', ' + m[4];
}

function renderCalls() {
  var base = baseList();
  ['new', 'followup', 'showing', 'all'].forEach(function (t) { $('c-' + t).textContent = tabList(base, t).length; });
  setTab('tabs-calls', S.filter);

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
  el.innerHTML = listMeta(leads.length, key, 'κλήση', 'κλήσεις') + pageOf(leads, key).map(function (l) {
    return leadRow(l, S.filter === 'showing' && l.showingAt ? l.showingAt : niceDate(l.date));
  }).join('') + pagerHtml(leads.length, key);
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

function leadRow(l, when) {
  var k = STATUS_CLASS[l.status] || 'answered';
  return '<button class="row is-' + k + '" data-id="' + esc(l.id) + '">' +
    '<span class="row-body"><span class="row-name">' + esc(l.name || 'Χωρίς όνομα') + '</span>' +
    '<span class="row-prop">' + esc(l.property) + (l.code ? ', ' + esc(l.code) : '') + '</span>' +
    '<span class="row-meta"><span class="tag ' + k + '">' + esc(l.status) + '</span>' +
    '<span>' + esc(when) + '</span>' +
    (l.source ? '<span>' + esc(l.source) + '</span>' : '') +
    (l.repeat && /επαν/i.test(l.repeat) ? '<span>Επανάληψη</span>' : '') +
    (l.sms ? '<span class="tag sms">SMS</span>' : '') +
    (l.outcome ? '<span class="tag closed">' + esc(l.outcome) + '</span>' : '') +
    '</span></span>' + ico('next', 'ico chev') + '</button>';
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
  el.querySelectorAll('[data-id]').forEach(function (r) {
    r.onclick = function () { openLead(r.dataset.id); };
  });
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
  if (!S.contacts) $('contact-list').innerHTML = '<div class="empty">Φόρτωση…</div>';
  return api('contacts').then(function (list) {
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

function renderToday() {
  if (!S.boot) return;
  var today = isoDate(new Date());
  var showings = S.leads.filter(function (l) { return upcoming(l) && l.showingDate === today; })
    .sort(function (a, b) { return a.showingTs - b.showingTs; });
  var fresh = S.leads.filter(function (l) { return l.status === ST.PENDING; });
  var follow = S.leads.filter(function (l) { return l.status === ST.NO_ANSWER; });
  var open = S.tasks.filter(function (t) { return !t.done && t.date && t.date <= today; }).sort(taskOrder);
  var lack = S.props.filter(function (p) { return p.mine && p.available !== false && missingDocs(p).length; });
  var past = S.leads.filter(function (l) { return needsOutcome(l) && Date.now() - l.showingTs < 7 * 86400000; });
  var ending = S.props.filter(function (p) { return p.mine && p.available !== false && mandateTag(p); })
    .sort(function (a, b) { return a.mandateDays - b.mandateDays; });

  var h = new Date().getHours();
  var first = String((S.me && (S.me.smsName || S.me.name)) || '').trim().split(/\s+/)[0];
  $('today-date').textContent = new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('today-hello').textContent = (h < 12 ? 'Καλημέρα' : h < 20 ? 'Καλησπέρα' : 'Καλό βράδυ') + (first ? ', ' + first : '');

  var parts = [];
  if (showings.length) parts.push(plural(showings.length, 'υπόδειξη', 'υποδείξεις'));
  if (fresh.length) parts.push(plural(fresh.length, 'νέα κλήση', 'νέες κλήσεις'));
  if (follow.length) parts.push(plural(follow.length, 'κλήση για follow-up', 'κλήσεις για follow-up'));
  if (open.length) parts.push(plural(open.length, 'εργασία', 'εργασίες'));
  var last = parts.pop();
  $('today-sum').textContent = last ? 'Έχεις ' + (parts.length ? parts.join(', ') + ' και ' : '') + last + '.'
                                    : 'Δεν έχεις κάτι εκκρεμές για σήμερα.';

  var more = function (go, text) {
    return '<button class="today-more" data-more="' + go + '"><span>' + esc(text) + '</span>' + ico('next', 'ico chev') + '</button>';
  };
  var html = '';
  var leads = function (title, list, go, when) {
    if (!list.length) return;
    html += '<div class="section">' + title + '</div>' +
      list.slice(0, TODAY_MAX).map(function (l) { return leadRow(l, when(l)); }).join('');
    if (list.length > TODAY_MAX) html += more(go, 'Δες και τις ' + list.length);
  };
  leads('Υποδείξεις σήμερα', showings, 'showing', function (l) { return 'Στις ' + l.showingTime; });
  if (past.length) {
    html += '<div class="section">Πώς πήγε η υπόδειξη;</div>' + past.slice(0, TODAY_MAX).map(function (l) {
      return leadRow(l, l.showingAt).replace('data-id="', 'data-outcome="');
    }).join('');
  }
  leads('Νέες κλήσεις', fresh, 'new', function (l) { return niceDate(l.date); });
  leads('Για follow-up', follow, 'followup', function (l) { return l.followUp || niceDate(l.date); });

  if (open.length) {
    html += '<div class="section">Εργασίες για σήμερα</div>' + open.slice(0, TODAY_MAX).map(function (t) {
      return taskRow(t, t.date < today ? 'late' : '');
    }).join('');
    if (open.length > TODAY_MAX) html += more('tasks', 'Δες και τις ' + open.length);
  }
  if (ending.length) {
    html += '<div class="section">Εντολές που λήγουν</div>' + ending.slice(0, TODAY_MAX).map(function (p) {
      return '<button class="today-more" data-prop="' + esc(p.code) + '"><span>' + esc(p.street || p.code) + ': ' +
        esc(mandateText(p.mandateDays)) + '</span>' + ico('next', 'ico chev') + '</button>';
    }).join('');
  }
  if (lack.length) {
    html += '<div class="section">Έγγραφα</div>' + more('docs', plural(lack.length, 'ακίνητο θέλει έγγραφα', 'ακίνητα θέλουν έγγραφα'));
  }
  if (!html) {
    html = '<div class="empty"><b>Όλα εντάξει</b>Μόλις έρθει νέα κλήση, θα τη δεις εδώ.</div>';
  }

  var el = $('today-body');
  el.innerHTML = html;
  wireLeadRows(el);
  wireTaskRows(el);
  el.querySelectorAll('[data-outcome]').forEach(function (b) {
    b.onclick = function () { openLead(b.dataset.outcome, { outcome: true }); };
  });
  el.querySelectorAll('[data-prop]').forEach(function (b) {
    b.onclick = function () { openProp(b.dataset.prop); };
  });
  el.querySelectorAll('[data-more]').forEach(function (b) {
    b.onclick = function () {
      var go = b.dataset.more;
      if (go === 'tasks') { S.taskTab = 'today'; setTab('tabs-tasks', 'today'); goto('tasks'); }
      else if (go === 'docs') { S.propTab = 'docs'; goto('props'); }
      else { S.filter = go; S.propFilter = null; renderCalls(); goto('calls'); }
    };
  });
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

function propRow(p, lacking) {
  var open = myLeadsFor(p.code).filter(isOpen).length;
  var sub = [p.type, fmtPrice(p.price), p.code ? 'Κωδικός ' + p.code : ''].filter(Boolean).join(', ');
  return '<button class="row' + (open ? ' is-pending' : '') + '" data-code="' + esc(p.code) + '">' +
    '<span class="row-body"><span class="row-name">' + esc(p.street || p.title || p.code) + '</span>' +
    (sub ? '<span class="row-prop">' + esc(sub) + '</span>' : '') +
    '<span class="row-meta">' +
      (p.available === false ? '<span class="tag">' + esc(p.status || 'Μη διαθέσιμο') + '</span>' : '') +
      (lacking && lacking.length ? '<span>Λείπουν: ' + esc(lacking.join(', ')) + '</span>' : '<span>' + p.total + ' κλήσεις συνολικά</span>') +
      (p.mine ? docsTag(p) + (p.available === false ? '' : mandateTag(p)) : '<span>' + esc(p.partner) + '</span>') +
      (open ? '<span class="tag pending">' + open + ' ανοιχτές</span>' : '') +
    '</span></span>' +
    '<span class="count">' + p.month + '<small>τον μήνα</small></span></button>';
}

function wirePropRows(el) {
  el.querySelectorAll('[data-code]').forEach(function (r) {
    r.onclick = function () { openProp(r.dataset.code); };
  });
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

  $('pd-facts').innerHTML = [
    ['Κωδικός', p.code], ['Κατάσταση', p.status], ['Τύπος', p.type], ['Περιοχή', p.area], ['Οδός', p.street],
    ['Τιμή', fmtPrice(p.price)], ['Εμβαδόν', p.sqm ? p.sqm + ' τ.μ.' : ''],
    ['Εντολή', p.mandate], ['Λήξη εντολής', p.mandateDays == null ? '' : mandateText(p.mandateDays)],
    ['Συνεργάτης', p.partner]
  ].filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
  }).join('');

  S.prop = p;
  // Το ακίνητο άλλου μέλους δεν έχει έγγραφα εδώ, άρα ούτε tabs.
  $('tabs-prop').hidden = !p.mine;
  var pane = p.mine ? 'docs' : 'facts';
  setTab('tabs-prop', pane);
  showPane('prop-panes', pane);
  if (p.mine) loadDocs(p);
  $('pd-bill-count').textContent = '';

  var nav = navUrl(p);
  $('pd-nav').hidden = !nav;
  if (nav) $('pd-nav').href = nav;

  var n = myLeadsFor(p.code).length;
  var b = $('pd-leads');
  b.hidden = !p.mine && !n;
  b.textContent = n ? 'Οι κλήσεις μου για αυτό (' + n + ')' : 'Καμία κλήση σου τους τελευταίους 2 μήνες';
  b.disabled = !n;
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
  if (go) return routeTo(go[1]);
  var l = findLead(id);
  if (l) return showLead(l, opts || {});

  api('leads').then(function (leads) {
    S.leads = leads;
    render();
    var fresh = findLead(id);
    if (fresh) showLead(fresh, opts || {});
    else toast('Η κλήση δεν βρέθηκε στους τελευταίους 2 μήνες.', true);
  }).catch(function (e) { toast(e.message, true); });
}

/** Ειδοποιήσεις που δεν ανοίγουν κλήση, αλλά μια οθόνη: go:today, go:form, go:prop:…, go:outcome:… */
function routeTo(where) {
  while (closeTop()) { /* κλείνουμε ό,τι είναι ανοιχτό */ }
  if (where === 'today') return goto('today');
  if (where === 'form') return goto('metrics');
  if (where.indexOf('prop:') === 0) {
    S.propTab = 'mine';
    goto('props');
    return openProp(where.slice(5));
  }
  if (where.indexOf('outcome:') === 0) openLead(where.slice(8), { outcome: true });
}

function showLead(l, opts) {
  closeSheet('showing');
  closeSheet('settings');
  closeSheet('propdetail');
  closeSheet('contact');

  S.smsLang = 'el';
  S.smsKind = opts.remind && upcoming(l) ? 'reminder' : 'intro';
  fillDetail(l);
  setTab('tabs-detail', 'act');
  showPane('detail-panes', 'act');
  openSheet('detail');
  $('detail').querySelector('.sheet-body').scrollTop = 0;
  if (opts.outcome) openShowingForm();
  if (S.smsKind === 'reminder') toast('Το SMS υπενθύμισης είναι έτοιμο — πάτα το μαύρο κουμπί');

  if (!l.opened) {
    l.opened = nowStamp();
    beacon('open', { id: l.id });
  }
}

function closeDetail() {
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
  $('d-name').textContent = l.name || 'Χωρίς όνομα';
  $('d-prop').textContent = l.property + (l.code ? ' · ' + l.code : '');
  $('d-deal').textContent = [l.deal, fmtPrice(l.price)].filter(Boolean).join(' · ');
  var lp = S.props.filter(function (x) { return normCode(x.code) === normCode(l.code); })[0];
  addrLink($('d-addr'), l.address, lp ? lp.area : '');
  $('d-status').textContent = l.status;
  $('d-status').className = 'tag ' + (STATUS_CLASS[l.status] || 'answered');
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

  fact('d-repeat-wrap', 'd-repeat', /επαν/i.test(l.repeat || '') ? l.repeat : '');
  fact('d-called-wrap', 'd-called', l.called);
  fact('d-followup-wrap', 'd-followup', l.status === ST.NO_ANSWER ? l.followUp : '');
  fact('d-showing-wrap', 'd-showing', l.showingAt);
  fact('d-outcome-wrap', 'd-outcome', l.outcome ? l.outcome + (l.outcomeNote ? '. ' + l.outcomeNote : '') : '');
  fact('d-sms-wrap', 'd-sms', l.sms);
  fact('d-smsremind-wrap', 'd-smsremind', upcoming(l) ? l.smsRemind : '');

  $('btn-noanswer').textContent = l.status === ST.NO_ANSWER ? 'Δεν απάντησε ξανά' : 'Δεν απάντησε';
  label($('btn-showing'), 'calendar', needsOutcome(l) ? 'Πώς πήγε;' : hasShowing(l) ? 'Αλλαγή υπόδειξης' : 'Υπόδειξη');
  // 1.14.1: το έντυπο υπόδειξης έχει δικό του κουμπί, μόλις υπάρχει υπόδειξη.
  $('btn-showform').hidden = !hasShowing(l);

  prepareSms(l);
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
  fillDetail(l);
  beacon('called', { id: l.id });
}

function onNoAnswer() {
  var btn = $('btn-noanswer');
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

  return api('status', { id: S.lead.id, status: value }).then(function (l) {
    merge(l);
    if (S.lead && S.lead.id === l.id) fillDetail(l);
    sel.disabled = false;

    if (l.warning) toast(l.warning, true);
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
    api('note', { id: id, text: text }).then(function () {
      hint.textContent = 'Αποθηκεύτηκε';
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
  setTimeout(function () { if (S.lead) fillDetail(S.lead); }, 300);
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
  api('outcome', { id: S.lead.id, outcome: S.outcome, note: $('s-outcome-note').value.trim() }).then(function (l) {
    merge(l);
    fillDetail(l);
    closeSheet('showing');
    render();
    toast('Καταχωρήθηκε: ' + l.outcome);
  }).catch(function (e) {
    hint.className = 'save-hint err';
    hint.textContent = e.message;
  }).then(function () { btn.disabled = false; });
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

  api('cancelShowing', { id: id }).then(function (res) {
    merge(res.lead);
    S.cancelled = { id: id, date: res.date, time: res.time };
    closeSheet('showing');
    resetCancelBtn();

    S.smsKind = res.lead.phoneIntl && res.date ? 'cancel' : 'intro';
    fillDetail(res.lead);
    setTab('tabs-detail', 'act');
    showPane('detail-panes', 'act');
    if (S.smsKind === 'cancel') $('detail').querySelector('.sms-preview').open = true;
    $('detail').querySelector('.sheet-body').scrollTop = 0;

    toast('Η υπόδειξη ακυρώθηκε' + (res.eventDeleted ? ' και σβήστηκε από το ημερολόγιο' : '') +
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

  api('showing', {
    id: S.lead.id,
    date: $('s-date').value,
    time: $('s-time').value,
    address: $('s-addr').value.trim()
  }).then(function (res) {
    merge(res.lead);
    if (S.cancelled && S.cancelled.id === res.lead.id) S.cancelled = null;
    btn.disabled = false;
    btn.textContent = label;
    closeSheet('showing');
    closeDetail();
    toast((res.updated ? 'Η υπόδειξη άλλαξε: ' : 'Υπόδειξη ') + res.when +
          (res.invited ? ' · ήρθε ως πρόσκληση' : ''));
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
}

function openSettings() {
  $('p-hint').textContent = '';
  fillSettings();
  setTab('tabs-settings', 'me');
  showPane('settings-panes', 'me');
  $('settings').querySelector('.sheet-body').scrollTop = 0;
  openSheet('settings');
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

  api('taskDone', { id: id, done: done }).then(function (fresh) {
    mergeTask(fresh);
    renderTasks();
    if (done) toast('Ολοκληρώθηκε' + (fresh.date ? ' · βγήκε από το ημερολόγιο' : ''));
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
  api('taskSave', data).then(function (t) {
    mergeTask(t);
    renderTasks();
    closeSheet('task');
    toast((data.id ? 'Η εργασία άλλαξε' : 'Η εργασία καταχωρήθηκε') +
          (t.hasEvent ? (t.invited ? ' · ήρθε ως πρόσκληση' : ' · στο ημερολόγιο') : ''));
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
    api('taskDelete', { id: id }).then(function () {
      S.tasks = S.tasks.filter(function (t) { return t.id !== id; });
      renderTasks();
      closeSheet('task');
      toast('Η εργασία διαγράφηκε');
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

  $(cfg.list).innerHTML = slots.map(function (s) {
    var files = res ? res.docs[s.key] || [] : [];
    var has = (counts[s.key] || 0) > 0;
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
        '<button class="btn small' + (has || s.from || s.optional ? '' : ' primary') + '" data-up="' + s.key + '"' + (busy ? ' disabled' : '') + '>' + action + '</button>' +
      '</div>' +
      (loading ? '<div class="doc-file muted">Φόρτωση…</div>' : files.map(function (f, i) {
        var latest = files.length > 1 && i === files.length - 1 && !s.multi;
        return '<div class="doc-file">' +
          '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
          (latest ? '<i class="tag showing">Τελευταίο</i>' : '') +
          '<span>' + esc(f.date.slice(0, 10)) + '</span>' +
          '<button class="x" data-del="' + esc(f.id) + '" data-name="' + esc(f.name) + '" aria-label="Διαγραφή ' + esc(f.name) + '">' + ico('trash') + '</button>' +
        '</div>';
      }).join('')) + copy +
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
  api('bootstrap').then(function (b) {
    S.boot = b;
    S.me = b.agent;
    applyData(b);
    render();
    fillSettings();
    spin(false);
    toast('Ανανεώθηκε');
  }).catch(function (e) {
    spin(false);
    toast(e.message, true);
  });
}

var polling = false;
function poll() {
  if (!$('detail').hidden || !$('showing').hidden) return;   // μην πειράξεις ανοιχτή κλήση
  refreshLeads();
}

/** Φρέσκια λίστα κλήσεων. Δεν αγγίζει ανοιχτή λεπτομέρεια, μόνο τη λίστα και τα badge. */
function refreshLeads() {
  if (polling || document.hidden || !S.boot) return;
  polling = true;
  api('leads').then(function (leads) {
    S.leads = leads;
    render();
  }).catch(function () { /* σιωπηλά */ }).then(function () { polling = false; });
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
  if (!S.mx) $('mx-body').innerHTML = '<div class="empty">Φόρτωση…</div>';
  $('mx-refresh').disabled = true;
  api('metrics', force ? { refresh: 1 } : {}).then(function (d) {
    S.mx = d;
    var withData = (d.months || []).filter(function (m) { return m.weeks.length; });
    if (!S.mxMonth || !monthOf(S.mxMonth)) S.mxMonth = withData.length ? withData[0].ym : '';
    if (!S.mxYear) S.mxYear = S.mxMonth.slice(0, 4);
    renderMetrics();
    if (force) toast('Ενημερώθηκε');
  }).catch(function (e) {
    if (!S.mx) $('mx-body').innerHTML = '<div class="empty"><b>Δεν φορτώθηκε</b>' + esc(e.message) + '</div>';
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

function renderMetrics() {
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
  var tiles = [
    { label: 'Ραντεβού', v: sumGroup(m.values, 'owners') + sumGroup(m.values, 'clients') - (m.values.ilist || 0),
      p: pv ? sumGroup(pv, 'owners') + sumGroup(pv, 'clients') - (pv.ilist || 0) : null },
    { label: 'Υποδείξεις', v: sumGroup(m.values, 'showings'), p: pv ? sumGroup(pv, 'showings') : null },
    { label: 'Αναθέσεις & εντολές', v: sumGroup(m.values, 'mandates'), p: pv ? sumGroup(pv, 'mandates') : null }
  ];
  html += '<div class="mx-tiles">' + tiles.map(function (t) {
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

})();
