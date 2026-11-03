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

/** Έκδοση σελίδας. Πρέπει να ταιριάζει με το VERSION του Code.gs. */
var APP_VERSION = '1.4';

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
  filter: 'pending', propFilter: null, view: 'calls',
  noteTimer: null, smsLang: 'el', smsKind: 'intro', cancelled: null, wired: false,
  tasks: [], task: null, docs: {}, prop: null, uploading: {}, tplDraft: null, tplLang: {},
  docsFilter: false
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
  fillSettings();

  $('boot').hidden = true;
  $('app').hidden = false;

  render();
  if (!S.wired) wire();

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

  $$('.seg').forEach(function (s) {
    s.onclick = function () {
      $$('.seg').forEach(function (x) { x.classList.remove('is-on'); });
      s.classList.add('is-on');
      S.filter = s.dataset.filter;
      renderCalls();
    };
  });

  $('refresh').onclick = refreshNow;
  $('filter-clear').onclick = function () { S.propFilter = null; renderCalls(); };
  $('btn-settings').onclick = openSettings;

  $('detail-back').onclick = closeDetail;
  $('showing-back').onclick = function () { $('showing').hidden = true; };
  $('settings-back').onclick = function () { $('settings').hidden = true; };
  $('propdetail-back').onclick = function () { $('propdetail').hidden = true; S.prop = null; };
  $('task-back').onclick = function () { $('task').hidden = true; };
  $('templates-back').onclick = function () { $('templates').hidden = true; };

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
  $('prop-filter-clear').onclick = function () { S.docsFilter = false; renderProps(); };
  $('btn-templates').onclick = openTemplates;
  $('btn-logout').onclick = onLogout;
  $('btn-save-templates').onclick = onSaveTemplates;

  $('d-tel').onclick = onTelClick;
  $('d-mail').onclick = function (e) { if (!S.lead || !S.lead.email) e.preventDefault(); };
  $('btn-noanswer').onclick = onNoAnswer;
  $('btn-showing').onclick = openShowingForm;
  $('btn-save-showing').onclick = onSaveShowing;
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
    var order = ['templates', 'task', 'settings', 'showing', 'propdetail'];
    for (var i = 0; i < order.length; i++) {
      if (!$(order[i]).hidden) { $(order[i]).hidden = true; return; }
    }
    if (!$('detail').hidden) closeDetail();
  });
}

function goto(view) {
  $$('.tab').forEach(function (x) { x.classList.toggle('is-on', x.dataset.view === view); });
  ['calls', 'tasks', 'props', 'forms', 'rooms'].forEach(function (v) {
    $('view-' + v).hidden = (v !== view);
  });
  S.view = view;
  window.scrollTo(0, 0);
  if (view === 'props') renderProps();
  if (view === 'tasks') renderTasks();
}

// ─────────────────────────────────────────────────────────────
//  ΛΙΣΤΑ ΚΛΗΣΕΩΝ
// ─────────────────────────────────────────────────────────────

/** «Αναπάντητες» = θέλουν ακόμη ενέργεια: νέες και όσες δεν σήκωσαν. */
function isOpen(l) { return l.status === ST.PENDING || l.status === ST.NO_ANSWER; }

function currentList() {
  var list = S.leads;
  if (S.propFilter) {
    list = list.filter(function (l) { return normCode(l.code) === S.propFilter.key; });
  }
  if (S.filter === 'pending') return list.filter(isOpen);
  if (S.filter === 'answered') return list.filter(function (l) { return !isOpen(l); });
  return list;
}

function render() {
  var open = S.leads.filter(isOpen).length;
  $('c-pending').textContent = open;
  $('c-answered').textContent = S.leads.length - open;
  setBadge(open);
  renderCalls();
  renderTasks();
  if (S.view === 'props') renderProps();
}

function renderCalls() {
  var leads = currentList();
  var el = $('call-list');

  $('filter-bar').hidden = !S.propFilter;
  if (S.propFilter) $('filter-label').textContent = S.propFilter.label;

  if (!leads.length) {
    el.innerHTML = '<div class="empty"><b>Καμία κλήση εδώ</b>' +
      (S.filter === 'pending' ? 'Όλες οι κλήσεις σου έχουν απαντηθεί.'
                              : 'Δοκίμασε άλλο φίλτρο.') + '</div>';
    return;
  }

  el.innerHTML = leads.map(function (l) {
    var k = STATUS_CLASS[l.status] || 'answered';
    return '<button class="row is-' + k + '" data-id="' + esc(l.id) + '">' +
      '<div class="row-top"><span class="row-name">' + esc(l.name || 'Χωρίς όνομα') + '</span>' +
      '<span class="row-time">' + esc(l.date) + '</span></div>' +
      '<div class="row-prop">' + esc(l.property) + (l.code ? ' · ' + esc(l.code) : '') + '</div>' +
      '<div class="row-meta"><span class="tag ' + k + '">' + esc(l.status) + '</span>' +
      (l.source ? '<span>' + esc(l.source) + '</span>' : '') +
      (l.repeat && /επαν/i.test(l.repeat) ? '<span>Επανάληψη</span>' : '') +
      (l.sms ? '<span class="tag sms">SMS</span>' : '') +
      '</div></button>';
  }).join('');

  el.querySelectorAll('.row').forEach(function (r) {
    r.onclick = function () { openLead(r.dataset.id); };
  });
}

// ─────────────────────────────────────────────────────────────
//  ΑΚΙΝΗΤΑ
// ─────────────────────────────────────────────────────────────

/** Ίδια λογική με το normCode_() του Code.gs. */
function normCode(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^0-9A-ZΑ-Ω]/g, '');
}

function myLeadsFor(code) {
  var k = normCode(code);
  return k ? S.leads.filter(function (l) { return normCode(l.code) === k; }) : [];
}

function renderProps() {
  var mine = S.props.filter(function (p) { return p.mine && (!S.docsFilter || missingDocs(p).length); });
  var team = S.docsFilter ? [] : S.props.filter(function (p) { return !p.mine; });
  $('prop-filter-bar').hidden = !S.docsFilter;
  var html = '';

  var row = function (p) {
    var open = myLeadsFor(p.code).filter(isOpen).length;
    var sub = [p.code ? 'Κωδικός ' + p.code : '', p.type, fmtPrice(p.price)].filter(Boolean).join(' · ');
    return '<button class="row' + (open ? ' is-pending' : '') + '" data-code="' + esc(p.code) + '">' +
      '<div class="row-top"><span class="row-name">' + esc(p.street || p.title || p.code) + '</span>' +
      '<span class="count">' + p.month + '<small>τον μήνα</small></span></div>' +
      (sub ? '<div class="row-prop">' + esc(sub) + '</div>' : '') +
      '<div class="row-meta">' +
        '<span>' + p.week + ' την εβδομάδα · ' + p.total + ' συνολικά</span>' +
        (p.mine ? docsTag(p) : '<span class="row-partner">' + esc(p.partner) + '</span>') +
        (open ? '<span class="tag pending">' + open + ' αναπάντητες</span>' : '') +
      '</div></button>';
  };

  html += '<div class="section">Δικά μου · ' + mine.length + '</div>';
  html += mine.length ? mine.map(row).join('')
    : '<div class="empty small">' + (S.docsFilter ? 'Όλα τα ακίνητα με εντολή έχουν τα έγγραφά τους ✓'
                                                   : 'Δεν έχεις διαθέσιμα ακίνητα στο φύλλο.') + '</div>';

  if (team.length) {
    html += '<div class="section">Της ομάδας · ' + team.length + '</div>';
    html += team.map(row).join('');
  }

  var el = $('prop-list');
  el.innerHTML = html;
  el.querySelectorAll('[data-code]').forEach(function (r) {
    r.onclick = function () { openProp(r.dataset.code); };
  });
}

function openProp(code) {
  var p = S.props.filter(function (x) { return x.code === code; })[0];
  if (!p) return;

  $('pd-name').textContent = p.street || p.title || p.code;
  $('pd-sub').textContent = p.title || '';

  $('pd-stats').innerHTML = [
    [p.week, 'εβδομάδα'], [p.month, 'μήνας'], [p.total, 'σύνολο']
  ].map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>κλήσεις ' + s[1] + '</span></div>'; }).join('');

  $('pd-facts').innerHTML = [
    ['Κωδικός', p.code], ['Τύπος', p.type], ['Περιοχή', p.area], ['Οδός', p.street],
    ['Τιμή', fmtPrice(p.price)], ['Εμβαδόν', p.sqm ? p.sqm + ' τ.μ.' : ''],
    ['Εντολή', p.mandate], ['Συνεργάτης', p.partner]
  ].filter(function (f) { return f[1]; }).map(function (f) {
    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
  }).join('');

  S.prop = p;
  $('pd-docs').hidden = !p.mine;
  if (p.mine) loadDocs(p);

  var n = myLeadsFor(p.code).length;
  var b = $('pd-leads');
  b.hidden = !p.mine && !n;
  b.textContent = n ? 'Οι κλήσεις μου για αυτό (' + n + ')' : 'Καμία κλήση σου τους τελευταίους 2 μήνες';
  b.disabled = !n;
  b.onclick = function () {
    $('propdetail').hidden = true;
    S.propFilter = { key: normCode(p.code), label: (p.street || p.code) + ' · ' + n + (n === 1 ? ' κλήση' : ' κλήσεις') };
    S.filter = 'all';
    $$('.seg').forEach(function (x) { x.classList.toggle('is-on', x.dataset.filter === 'all'); });
    goto('calls');
    renderCalls();
  };

  $('propdetail').hidden = false;
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

function showLead(l, opts) {
  $('showing').hidden = true;
  $('settings').hidden = true;
  $('propdetail').hidden = true;

  S.smsLang = 'el';
  S.smsKind = opts.remind && upcoming(l) ? 'reminder' : 'intro';
  fillDetail(l);
  $('detail').hidden = false;
  $('detail').querySelector('.sheet-body').scrollTop = 0;
  if (S.smsKind === 'reminder') toast('Το SMS υπενθύμισης είναι έτοιμο — πάτα το μαύρο κουμπί');

  if (!l.opened) {
    l.opened = nowStamp();
    beacon('open', { id: l.id });
  }
}

function closeDetail() {
  $('detail').hidden = true;
  S.lead = null;
  render();
}

function hasShowing(l) { return !!(l && l.hasEvent && l.showingDate); }

/** Υπόδειξη που δεν έχει περάσει ακόμα. */
function upcoming(l) { return hasShowing(l) && l.showingTs > Date.now(); }

function fillDetail(l) {
  S.lead = l;
  $('d-name').textContent = l.name || 'Χωρίς όνομα';
  $('d-prop').textContent = l.property + (l.code ? ' · ' + l.code : '');
  $('d-deal').textContent = [l.deal, fmtPrice(l.price)].filter(Boolean).join(' · ');
  $('d-status').textContent = l.status;
  $('d-phone').textContent = l.phoneIntl || '—';
  $('d-email').textContent = l.email || '—';
  $('d-date').textContent = l.date;
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
  fact('d-sms-wrap', 'd-sms', l.sms);
  fact('d-smsremind-wrap', 'd-smsremind', upcoming(l) ? l.smsRemind : '');

  $('btn-noanswer').textContent = l.status === ST.NO_ANSWER ? 'Δεν απάντησε ξανά' : 'Δεν απάντησε';
  $('btn-showing').textContent = hasShowing(l) ? 'Αλλαγή υπόδειξης' : 'Υπόδειξη';

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
    link.textContent = 'Χωρίς τηλέφωνο — δεν ετοιμάζεται SMS';
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
  link.textContent = S.smsKind === 'intro' && l.sms ? 'Άνοιγμα SMS ξανά' : SMS_KINDS[S.smsKind].button;
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

  $('s-title').textContent = edit ? 'Αλλαγή υπόδειξης' : 'Νέα υπόδειξη';
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
  resetCancelBtn();
  $('btn-cancel-showing').hidden = !edit;
  $('showing').hidden = false;
}

// ── Ακύρωση υπόδειξης ─────────────────────────────────────
// Πρώτο πάτημα: «Πάτα ξανά για επιβεβαίωση». Δεύτερο, μέσα σε 4'': ακύρωση.
// Χωρίς αναδυόμενα παράθυρα του browser, που στο iPhone φαίνονται άσχημα.

var cancelTimer = null;

function resetCancelBtn() {
  clearTimeout(cancelTimer);
  var b = $('btn-cancel-showing');
  b.disabled = false;
  b.classList.remove('confirming');
  b.textContent = 'Ακύρωση υπόδειξης';
}

function onCancelShowing() {
  var b = $('btn-cancel-showing');
  if (!b.classList.contains('confirming')) {
    b.classList.add('confirming');
    b.textContent = 'Πάτα ξανά για επιβεβαίωση';
    cancelTimer = setTimeout(resetCancelBtn, 4000);
    return;
  }

  clearTimeout(cancelTimer);
  b.disabled = true;
  b.textContent = 'Ακύρωση…';
  var id = S.lead.id;

  api('cancelShowing', { id: id }).then(function (res) {
    merge(res.lead);
    S.cancelled = { id: id, date: res.date, time: res.time };
    $('showing').hidden = true;
    resetCancelBtn();

    S.smsKind = res.lead.phoneIntl && res.date ? 'cancel' : 'intro';
    fillDetail(res.lead);
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
    $('showing').hidden = true;
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
    (server !== APP_VERSION ? ' — δεν ταιριάζουν, ολοκλήρωσε την εγκατάσταση' : '');
  v.className = 'version' + (server !== APP_VERSION ? ' warn' : '');
}

function openSettings() {
  $('p-hint').textContent = '';
  fillSettings();
  $('settings').hidden = false;
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

/** Ομάδες: Καθυστερημένες · Σήμερα · Επόμενες · Χωρίς ημερομηνία · Ολοκληρωμένες. */
function renderTasks() {
  var today = isoDate(new Date());
  var open = S.tasks.filter(function (t) { return !t.done; }).sort(taskOrder);
  var done = S.tasks.filter(function (t) { return t.done; })
    .sort(function (a, b) { return b.doneTs - a.doneTs; });

  var groups = [
    ['Καθυστερημένες', open.filter(function (t) { return t.date && t.date < today; }), 'late'],
    ['Σήμερα', open.filter(function (t) { return t.date === today; }), ''],
    ['Επόμενες', open.filter(function (t) { return t.date > today; }), ''],
    ['Χωρίς ημερομηνία', open.filter(function (t) { return !t.date; }), '']
  ];

  var due = groups[0][1].length + groups[1][1].length;
  var badge = $('task-badge');
  badge.hidden = !due;
  badge.textContent = due;

  var row = function (t, cls) {
    return '<div class="task-row ' + (cls || '') + (t.done ? ' done' : '') + '">' +
      '<button class="check" data-check="' + esc(t.id) + '" aria-label="' + (t.done ? 'Αναίρεση' : 'Ολοκλήρωση') + '">' +
        (t.done ? '✓' : '') + '</button>' +
      '<button class="task-main" data-task="' + esc(t.id) + '">' +
        '<span class="task-title">' + esc(t.title) + '</span>' +
        '<span class="task-meta">' + [taskWhen(t), t.leadName ? '👤 ' + esc(t.leadName) : '', t.notes ? '✎' : '']
          .filter(Boolean).join(' · ') + '</span>' +
      '</button></div>';
  };

  var html = groups.filter(function (g) { return g[1].length; }).map(function (g) {
    return '<div class="section' + (g[2] ? ' ' + g[2] : '') + '">' + g[0] + ' · ' + g[1].length + '</div>' +
      g[1].map(function (t) { return row(t, g[2]); }).join('');
  }).join('');

  if (!open.length) {
    html = '<div class="empty"><b>Καμία ανοιχτή εργασία</b>Πάτα ＋ για νέα, ή «＋ Εργασία» μέσα σε μια κλήση.</div>';
  }
  if (done.length) {
    html += '<details class="done-group"><summary>Ολοκληρωμένες · ' + done.length + '</summary>' +
      done.map(function (t) { return row(t, ''); }).join('') + '</details>';
  }

  var el = $('task-list');
  el.innerHTML = html;
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
    $('t-lead-open').onclick = function () { $('task').hidden = true; openLead(S.task.lead); };
  }

  resetDeleteTask();
  $('btn-delete-task').hidden = !t;
  taskNote();
  $('task').hidden = false;
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
    $('task').hidden = true;
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

var deleteTaskTimer = null;

function resetDeleteTask() {
  clearTimeout(deleteTaskTimer);
  var b = $('btn-delete-task');
  b.disabled = false;
  b.classList.remove('confirming');
  b.textContent = 'Διαγραφή εργασίας';
}

function onDeleteTask() {
  var b = $('btn-delete-task');
  if (!b.classList.contains('confirming')) {
    b.classList.add('confirming');
    b.textContent = 'Πάτα ξανά για διαγραφή';
    deleteTaskTimer = setTimeout(resetDeleteTask, 4000);
    return;
  }
  clearTimeout(deleteTaskTimer);
  b.disabled = true;
  var id = S.task.id;
  api('taskDelete', { id: id }).then(function () {
    S.tasks = S.tasks.filter(function (t) { return t.id !== id; });
    renderTasks();
    $('task').hidden = true;
    toast('Η εργασία διαγράφηκε');
  }).catch(function (e) {
    resetDeleteTask();
    toast(e.message, true);
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
  $('detail').hidden = true;
  $('propdetail').hidden = true;
  S.docsFilter = true;
  goto('props');
}

function loadDocs(p) {
  renderDocs(p, S.docs[p.code] || null, !S.docs[p.code]);
  api('docs', { code: p.code }).then(function (res) {
    S.docs[p.code] = res;
    p.docs = res.counts;
    if (S.prop && S.prop.code === p.code) renderDocs(p, res, false);
  }).catch(function (e) {
    if (S.prop && S.prop.code === p.code) {
      $('pd-docs-list').innerHTML = '<p class="save-hint err">Δεν φορτώθηκαν τα έγγραφα: ' + esc(e.message) + '</p>';
    }
  });
}

function renderDocs(p, res, loading) {
  var counts = res ? res.counts : (p.docs || {});
  var c = slotsDone(counts);
  $('pd-docs-count').textContent = c.done + '/' + c.total;
  $('pd-docs-count').className = 'docs-count' + (c.done === c.total ? ' ok' : '');

  $('pd-docs-list').innerHTML = (S.boot.docSlots || []).map(function (s) {
    var files = res ? res.docs[s.key] : [];
    var has = (counts[s.key] || 0) > 0;
    var busy = S.uploading[p.code + ':' + s.key];
    var action = busy ? 'Ανέβασμα…' : !has ? 'Ανέβασμα' : s.multi ? 'Προσθήκη' : 'Αντικατάσταση';

    return '<div class="doc-slot' + (has ? ' ok' : '') + '">' +
      '<div class="doc-head">' +
        '<span class="doc-ico">' + (has ? '✓' : '!') + '</span>' +
        '<b>' + esc(s.label) + '</b>' +
        '<button class="btn small' + (has ? '' : ' primary') + '" data-up="' + s.key + '"' + (busy ? ' disabled' : '') + '>' + action + '</button>' +
      '</div>' +
      (loading ? '<div class="doc-file muted">Φόρτωση…</div>' : files.map(function (f) {
        return '<div class="doc-file">' +
          '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
          '<span>' + esc(f.date.slice(0, 10)) + '</span>' +
          '<button class="x" data-del="' + esc(f.id) + '" aria-label="Διαγραφή ' + esc(f.name) + '">✕</button>' +
        '</div>';
      }).join('')) +
    '</div>';
  }).join('');

  var folder = $('pd-docs-folder');
  folder.hidden = !res;
  if (res) folder.href = res.docsUrl;

  $('pd-docs-list').querySelectorAll('[data-up]').forEach(function (b) {
    b.onclick = function () {
      S.upSlot = b.dataset.up;
      $('doc-input').value = '';
      $('doc-input').click();
    };
  });
  $('pd-docs-list').querySelectorAll('[data-del]').forEach(function (b) {
    b.onclick = function () { onDocDelete(p, b); };
  });
}

function onDocFile(e) {
  var file = e.target.files && e.target.files[0];
  var p = S.prop, slot = S.upSlot;
  if (!file || !p || !slot) return;

  var key = p.code + ':' + slot;
  var label = ((S.boot.docSlots || []).filter(function (s) { return s.key === slot; })[0] || {}).label || slot;
  S.uploading[key] = true;
  renderDocs(p, S.docs[p.code], false);

  shrink(file).then(function (f) {
    if (f.size > (S.boot.maxUploadMb || 20) * 1048576) {
      throw new Error('Το αρχείο είναι πάνω από ' + S.boot.maxUploadMb + ' MB.');
    }
    return toBase64(f.blob).then(function (data) {
      return api('upload', { code: p.code, slot: slot, name: f.name, mime: f.type, data: data });
    });
  }).then(function (res) {
    S.docs[p.code] = res;
    p.docs = res.counts;
    var lack = missingDocs(p);
    toast('Ανέβηκε: ' + label + (lack.length ? '. Λείπουν ακόμα: ' + lack.join(', ') : ''));
  }).catch(function (err) {
    toast('Δεν ανέβηκε: ' + err.message, true);
  }).then(function () {
    delete S.uploading[key];
    if (S.prop && S.prop.code === p.code) renderDocs(p, S.docs[p.code], false);
    if (S.view === 'props') renderProps();
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

/** ✕ → «Σίγουρα;» → δεύτερο πάτημα: στον κάδο του Drive (ανακτάται για 30 ημέρες). */
function onDocDelete(p, b) {
  if (!b.classList.contains('confirming')) {
    b.classList.add('confirming');
    b.textContent = 'Σίγουρα;';
    setTimeout(function () { b.classList.remove('confirming'); b.textContent = '✕'; }, 4000);
    return;
  }
  b.disabled = true;
  api('docDelete', { code: p.code, fileId: b.dataset.del }).then(function (res) {
    S.docs[p.code] = res;
    p.docs = res.counts;
    renderDocs(p, res, false);
    toast('Το αρχείο πήγε στον κάδο του Drive');
  }).catch(function (e) {
    b.disabled = false;
    toast(e.message, true);
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
  $('templates').hidden = false;
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
    $('templates').hidden = true;
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

var logoutTimer = null;

/** Δύο πατήματα: αποσυνδέει ΜΟΝΟ αυτή τη συσκευή (σβήνει και τις ειδοποιήσεις της). */
function onLogout() {
  var b = $('btn-logout');
  if (!b.classList.contains('confirming')) {
    b.classList.add('confirming');
    b.textContent = 'Πάτα ξανά για αποσύνδεση';
    logoutTimer = setTimeout(function () {
      b.classList.remove('confirming');
      b.textContent = 'Αποσύνδεση αυτής της συσκευής';
    }, 4000);
    return;
  }
  clearTimeout(logoutTimer);
  b.disabled = true;
  api('logout').catch(function () { /* αποσυνδέεται τοπικά ούτως ή άλλως */ }).then(function () {
    forgetDevice();
    location.replace(location.pathname);
  });
}

// ─────────────────────────────────────────────────────────────
//  ΑΝΑΝΕΩΣΗ
// ─────────────────────────────────────────────────────────────

/** ↻: ξαναφέρνει κλήσεις, ακίνητα και ρυθμίσεις. */
function refreshNow() {
  var btn = $('refresh');
  btn.classList.add('spin');
  api('bootstrap').then(function (b) {
    S.boot = b;
    S.me = b.agent;
    applyData(b);
    render();
    fillSettings();
    btn.classList.remove('spin');
    toast('Ανανεώθηκε');
  }).catch(function (e) {
    btn.classList.remove('spin');
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

function fillSelect(el, items) {
  el.innerHTML = (items || []).map(function (s) {
    return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
  }).join('');
}

function renderForms(forms) {
  $('form-list').innerHTML = forms.map(function (f) {
    return '<a class="row" href="' + esc(f.url) + '" target="_blank" rel="noopener">' +
      '<div class="row-top"><span class="row-name">' + esc(f.title) + '</span>' +
      '<span class="row-time">Άνοιγμα ↗</span></div>' +
      '<div class="row-prop">' + esc(f.note || '') + '</div></a>';
  }).join('');
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
  t.hidden = false;
  clearTimeout(t._x);
  t._x = setTimeout(function () { t.hidden = true; }, isError ? 4200 : 2800);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

})();
