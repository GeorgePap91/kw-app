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

// ─────────────────────────────────────────────────────────────
//  ΡΥΘΜΙΣΕΙΣ & ΚΑΤΑΣΤΑΣΗ
// ─────────────────────────────────────────────────────────────

var API = (window.KW_CONFIG || {}).API_URL || '';
var params = new URLSearchParams(location.search);

if (params.get('k')) store('kw_key', params.get('k'));
var KEY = params.get('k') || store('kw_key');
var LEAD_PARAM = params.get('lead') || '';

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
  noteTimer: null, smsLang: 'el', wired: false
};

var $ = function (id) { return document.getElementById(id); };
var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k) || '';
    localStorage.setItem(k, v);
  } catch (e) { /* ιδιωτική περιήγηση: λειτουργεί από το URL */ }
  return '';
}

// ─────────────────────────────────────────────────────────────
//  ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ ΤΟ APPS SCRIPT
// ─────────────────────────────────────────────────────────────
// text/plain: δεν προκαλεί CORS preflight, που το Apps Script δεν δέχεται.

function body(action, data) {
  return JSON.stringify({ k: KEY, action: action, data: data || {} });
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
  if (!KEY) return bootFail('Άνοιξε την εφαρμογή από το προσωπικό σου link.', true);

  $('boot-msg').textContent = 'Φόρτωση…';
  $('boot-retry').hidden = true;

  api('bootstrap').then(onBoot).catch(function (e) {
    if (e.code === 'auth') return bootFail('Το link δεν είναι έγκυρο. Ζήτα νέο.', true);
    bootFail('Δεν φόρτωσε: ' + e.message, false);
  });
}

function bootFail(msg, final) {
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

  if (LEAD_PARAM) openLead(LEAD_PARAM);
}

function applyData(b) {
  S.leads = b.leads || [];
  S.props = b.props || [];
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
  $('propdetail-back').onclick = function () { $('propdetail').hidden = true; };

  $('d-tel').onclick = onTelClick;
  $('d-mail').onclick = function (e) { if (!S.lead || !S.lead.email) e.preventDefault(); };
  $('btn-noanswer').onclick = onNoAnswer;
  $('btn-showing').onclick = openShowingForm;
  $('btn-save-showing').onclick = onSaveShowing;
  $('btn-save-settings').onclick = onSaveSettings;
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
    var order = ['settings', 'showing', 'propdetail'];
    for (var i = 0; i < order.length; i++) {
      if (!$(order[i]).hidden) { $(order[i]).hidden = true; return; }
    }
    if (!$('detail').hidden) closeDetail();
  });
}

function goto(view) {
  $$('.tab').forEach(function (x) { x.classList.toggle('is-on', x.dataset.view === view); });
  ['calls', 'props', 'forms', 'rooms'].forEach(function (v) {
    $('view-' + v).hidden = (v !== view);
  });
  S.view = view;
  window.scrollTo(0, 0);
  if (view === 'props') renderProps();
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
  var mine = S.props.filter(function (p) { return p.mine; });
  var team = S.props.filter(function (p) { return !p.mine; });
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
        (p.mine ? '' : '<span class="row-partner">' + esc(p.partner) + '</span>') +
        (open ? '<span class="tag pending">' + open + ' αναπάντητες</span>' : '') +
      '</div></button>';
  };

  html += '<div class="section">Δικά μου · ' + mine.length + '</div>';
  html += mine.length ? mine.map(row).join('')
    : '<div class="empty small">Δεν έχεις διαθέσιμα ακίνητα στο φύλλο.</div>';

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

function openLead(id) {
  var l = findLead(id);
  if (!l) { toast('Η κλήση δεν βρέθηκε στους τελευταίους 2 μήνες.', true); return; }

  S.smsLang = 'el';
  fillDetail(l);
  $('detail').hidden = false;

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

/** Η διατύπωση του μηνύματος, σε ελληνικά και αγγλικά. Άλλαξέ τη εδώ. */
function buildSmsText(l, me, lang) {
  var first = String(l.name || '').trim().split(/\s+/)[0];
  var ref = l.code || '';
  var office = (S.boot.office && S.boot.office.name) || '';
  var name = me.smsName || me.name || '';

  if (lang === 'en') {
    first = latin(first); name = latin(name); office = latin(office);
    return [
      first ? 'Hello ' + first + ',' : 'Hello,',
      'thank you for your interest' + (ref ? ' in property ' + ref : '') + '.',
      name ? 'This is ' + name + (office ? ' from ' + office : '') + '.'
           : (office ? 'This is ' + office + '.' : ''),
      me.phone ? 'Tel. ' + me.phone + '.' : '',
      me.link || ''
    ].filter(String).join(' ');
  }

  return [
    first ? 'Γεια σας ' + first + ',' : 'Γεια σας,',
    'ευχαριστούμε για το ενδιαφέρον σας' + (ref ? ' για το ακίνητο ' + ref : '') + '.',
    name ? 'Είμαι ο/η ' + name + (office ? ' από ' + office : '') + '.'
         : (office ? 'Σας γράφουμε από ' + office + '.' : ''),
    me.phone ? 'Τηλ. ' + me.phone + '.' : '',
    me.link || ''
  ].filter(String).join(' ');
}

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

  link.classList.remove('muted');
  link.textContent = l.sms ? 'Άνοιγμα SMS ξανά' : 'Άνοιγμα SMS με έτοιμο μήνυμα';
  if (document.activeElement !== $('sms-text')) {
    $('sms-text').value = buildSmsText(l, S.me, S.smsLang);
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
  $('sms-text').value = buildSmsText(S.lead, S.me, S.smsLang);
  updateLangBtn();
  refreshSmsHref();
}

function updateLangBtn() {
  $('btn-lang').textContent = S.smsLang === 'en' ? 'Στα ελληνικά' : 'In English';
}

function onOpenSms() {
  if (!S.lead || !$('sms-link').getAttribute('href')) return;
  S.lead.sms = nowStamp();
  beacon('sms', { id: S.lead.id });
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
  $('showing').hidden = false;
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
    btn.classList.remove('spin');
    toast('Ανανεώθηκε');
  }).catch(function (e) {
    btn.classList.remove('spin');
    toast(e.message, true);
  });
}

var polling = false;
function poll() {
  if (polling || document.hidden || !S.boot) return;
  if (!$('detail').hidden || !$('showing').hidden) return;   // μην πειράξεις ανοιχτή κλήση
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
