/**
 * Ειδοποιήσεις στη συσκευή (Firebase Cloud Messaging, δωρεάν).
 *
 * Ροή: ο μεσίτης πατά «Ενεργοποίηση» → το κινητό ζητά άδεια → το Firebase
 * δίνει ένα token για αυτή τη συσκευή → το στέλνουμε στο Apps Script, που το
 * γράφει στο φύλλο «Συσκευές». Από εκεί και πέρα το Apps Script στέλνει
 * ειδοποιήσεις σε αυτό το token, και το sw.js τις εμφανίζει.
 *
 * iPhone: δουλεύει ΜΟΝΟ όταν η εφαρμογή έχει προστεθεί στην αρχική οθόνη
 * (iOS 16.4+) και ανοίγει από εκεί. Android: παντού.
 */
(function () {
'use strict';

var cfg = window.KW_CONFIG || {};
// Firebase 10.12.2, αποθηκευμένο στο δικό μας repo (vendor/): η εφαρμογή δεν φορτώνει
// κώδικα από άλλον server, οπότε κανείς τρίτος δεν μπορεί να «πειράξει» τι τρέχει.
var FB = 'vendor/';
var TOKEN_KEY = 'kw_push_token';
var SENT_KEY = 'kw_push_sent';
var regPromise = null;

function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ιδιωτική περιήγηση */ } }

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function standalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
         navigator.standalone === true;
}

function configured() {
  var f = cfg.FIREBASE || {};
  return !!(f.apiKey && f.messagingSenderId && cfg.VAPID_KEY && String(f.apiKey).indexOf('ΒΑΛΕ') === -1);
}

/** 'unconfigured' | 'ios-install' | 'unsupported' | 'denied' | 'default' | 'granted' */
function state() {
  if (!configured()) return 'unconfigured';
  if (isIOS() && !standalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/** Το service worker χρειάζεται πάντα, για να ανοίγει την κλήση όταν πατάς την ειδοποίηση. */
/** Promise με χρονικό όριο: αν δεν απαντήσει σε ms, απορρίπτεται με το μήνυμα. */
function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error(msg)); }, ms);
  })]);
}

/** Περιμένει το service worker να γίνει ενεργό (όχι απλώς εγκατεστημένο). */
function untilActive(reg) {
  if (reg.active) return Promise.resolve(reg);
  var w = reg.installing || reg.waiting;
  if (!w) return Promise.resolve(reg);
  return new Promise(function (resolve, reject) {
    w.addEventListener('statechange', function () {
      if (w.state === 'activated') resolve(reg);
      if (w.state === 'redundant') reject(new Error('Το service worker απέτυχε να ενεργοποιηθεί.'));
    });
  });
}

/** Το service worker χρειάζεται πάντα, για να ανοίγει την κλήση όταν πατάς την ειδοποίηση. */
function register() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!regPromise) {
    regPromise = withTimeout(
      navigator.serviceWorker.register('sw.js').then(untilActive),
      15000, 'Το service worker (sw.js) δεν ενεργοποιήθηκε. Υπάρχει το sw.js στη ρίζα του GitHub;'
    ).catch(function (e) { regPromise = null; throw e; });
  }
  return regPromise;
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function () { reject(new Error('Δεν φορτώθηκε το ' + src)); };
    document.head.appendChild(s);
  });
}

/** Το Firebase φορτώνεται μόνο όταν χρειαστεί — δεν βαραίνει το άνοιγμα της εφαρμογής. */
function loadFirebase() {
  if (window.firebase && window.firebase.messaging) return Promise.resolve();
  return withTimeout(
    loadScript(FB + 'firebase-app-compat.js')
      .then(function () { return loadScript(FB + 'firebase-messaging-compat.js'); }),
    20000, 'Δεν φορτώθηκε το Firebase. Υπάρχει ο φάκελος vendor/ στο GitHub;');
}

/** Τα λάθη του Firebase σε κατανοητή μορφή, με τον κωδικό τους για διάγνωση. */
function firebaseError(e) {
  // Το Firebase δίνει κωδικό τύπου «messaging/…»· ο browser αριθμό (π.χ. 20) και περιγραφή.
  var code = e && typeof e.code === 'string' ? e.code + ': ' : '';
  var m = code + String((e && (e.message || e.name)) || e);
  var hint =
      /permission-blocked|permission-default/.test(m) ? 'Οι ειδοποιήσεις είναι μπλοκαρισμένες για την εφαρμογή στο κινητό.'
    : /installations|API key|api-key|403|PERMISSION_DENIED/i.test(m) ? 'Το Firebase αρνήθηκε τη σύνδεση. Έλεγξε τις τιμές FIREBASE στο config.js (apiKey, projectId, appId, messagingSenderId).'
    : /vapid|applicationServerKey|InvalidAccessError/i.test(m) ? 'Το VAPID_KEY στο config.js δεν είναι σωστό.'
    : /no active Service Worker|service worker/i.test(m) ? 'Το service worker δεν είναι ενεργό. Κλείσε και ξανάνοιξε την εφαρμογή.'
    : 'Σφάλμα Firebase.';
  return new Error(hint + ' (' + m.slice(0, 120) + ')');
}

function getToken(reg) {
  return loadFirebase().then(function () {
    var fb = window.firebase;
    if (!fb.apps.length) fb.initializeApp(cfg.FIREBASE);
    return withTimeout(
      fb.messaging().getToken({ vapidKey: cfg.VAPID_KEY, serviceWorkerRegistration: reg }),
      25000, 'Το Firebase δεν απάντησε (token). Έλεγξε το VAPID_KEY και τις τιμές FIREBASE στο config.js.');
  }).catch(function (e) {
    throw /δεν απάντησε|Δεν φορτώθηκε/.test(e.message) ? e : firebaseError(e);
  }).then(function (token) {
    if (!token) throw new Error('Το Firebase δεν έδωσε token ειδοποιήσεων.');
    return token;
  });
}

function deviceLabel() {
  var ua = navigator.userAgent;
  var os = isIOS() ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Άλλη';
  return os + (standalone() ? ' · εφαρμογή' : ' · browser');
}

function explain(st) {
  return {
    unconfigured: 'Οι ειδοποιήσεις δεν έχουν ρυθμιστεί ακόμα.',
    'ios-install': 'Στο iPhone χρειάζεται πρώτα «Προσθήκη στην οθόνη Αφετηρίας» και άνοιγμα από εκεί.',
    unsupported: 'Αυτός ο browser δεν υποστηρίζει ειδοποιήσεις.',
    denied: 'Οι ειδοποιήσεις είναι μπλοκαρισμένες στις ρυθμίσεις του κινητού.'
  }[st] || '';
}

/**
 * Πατήθηκε «Ενεργοποίηση». Το requestPermission καλείται ΠΡΩΤΟ, μέσα στο
 * πάτημα — αλλιώς το iPhone το αρνείται σιωπηλά.
 * send(token, device) → Promise: το στέλνει στο backend.
 * step(text): ενημερώνει την οθόνη σε ποιο βήμα βρίσκεται.
 * Κάθε βήμα έχει χρονικό όριο: αν κολλήσει, βγαίνει μήνυμα που λέει ποιο και γιατί.
 */
function enable(send, step) {
  step = step || function () {};
  var st = state();
  if (st !== 'default' && st !== 'granted') return Promise.reject(new Error(explain(st)));

  step('1/4 · Άδεια ειδοποιήσεων…');
  var ask = Notification.requestPermission();

  return withTimeout(Promise.resolve(ask), 60000,
    'Δεν απαντήθηκε το αίτημα άδειας. Άνοιξε Ρυθμίσεις κινητού → Εφαρμογές → KW App → Ειδοποιήσεις → Να επιτρέπονται, και ξαναδοκίμασε.')
  .then(function (perm) {
    if (perm !== 'granted') {
      throw new Error(perm === 'denied'
        ? 'Οι ειδοποιήσεις είναι μπλοκαρισμένες. Ρυθμίσεις κινητού → Εφαρμογές → KW App → Ειδοποιήσεις → Να επιτρέπονται.'
        : 'Δεν δόθηκε άδεια για ειδοποιήσεις.');
    }
    step('2/4 · Service worker…');
    return register();
  }).then(function (reg) {
    if (!reg) throw new Error('Αυτός ο browser δεν υποστηρίζει service worker.');
    step('3/4 · Σύνδεση με Firebase…');
    return getToken(reg);
  }).then(function (token) {
    step('4/4 · Καταχώρηση συσκευής…');
    return withTimeout(Promise.resolve(send(token, deviceLabel())), 25000,
      'Ο server δεν απάντησε στην καταχώρηση της συσκευής.').then(function (res) {
      set(TOKEN_KEY, token);
      set(SENT_KEY, String(Date.now()));
      return res;
    });
  });
}

/**
 * Σε κάθε άνοιγμα: αν έχει δοθεί άδεια, ελέγχει ότι το token δεν άλλαξε
 * (το Firebase το ανανεώνει πού και πού) και το ξαναστέλνει μία φορά την εβδομάδα.
 */
function refresh(send) {
  if (state() !== 'granted') return Promise.resolve(false);
  return register().then(getToken).then(function (token) {
    var stale = Date.now() - Number(get(SENT_KEY) || 0) > 7 * 86400000;
    if (token === get(TOKEN_KEY) && !stale) return false;
    return Promise.resolve(send(token, deviceLabel())).then(function () {
      set(TOKEN_KEY, token);
      set(SENT_KEY, String(Date.now()));
      return true;
    });
  });
}

/** Ενεργές σε αυτή τη συσκευή = άδεια + token που έχει σταλεί. */
function active() {
  return state() === 'granted' && !!get(TOKEN_KEY);
}

/** Μηνύματα από το sw.js: {type:'push', data} όταν έρχεται ειδοποίηση,
 *  {type:'open', id, remind} όταν πατιέται. */
function onMessage(handler) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type) handler(e.data);
  });
}

/** Μια γραμμή κατάστασης για τις ρυθμίσεις: τι βλέπει η συσκευή. */
function diag() {
  var perm = 'Notification' in window ? Notification.permission : 'χωρίς υποστήριξη';
  var sw = !('serviceWorker' in navigator) ? 'χωρίς υποστήριξη'
         : navigator.serviceWorker.controller ? 'ενεργό' : 'όχι ακόμα';
  return 'Άδεια: ' + perm + ' · Service worker: ' + sw + ' · Token: ' + (get(TOKEN_KEY) ? 'ναι' : 'όχι') +
         ' · ' + deviceLabel();
}

window.KWPush = {
  state: state, explain: explain, register: register, enable: enable,
  refresh: refresh, active: active, onMessage: onMessage, diag: diag
};

})();
