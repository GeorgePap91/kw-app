/**
 * Service worker του KW App (2.2).
 *  1. Κρατά ένα αντίγραφο της εφαρμογής (όχι δεδομένων πελατών) ώστε να ανοίγει και χωρίς σήμα.
 *     Με σήμα φέρνει πάντα την τελευταία έκδοση από το GitHub (network-first).
 *  2. Εμφανίζει την ειδοποίηση όταν το Apps Script στέλνει μία (μέσω Firebase).
 *  3. Όταν πατηθεί, ανοίγει την εφαρμογή απευθείας στη συγκεκριμένη κλήση.
 */

var SHELL = 'kw-shell-2.7.0';
var SHELL_FILES = ['./', 'index.html', 'app.js', 'app.css', 'config.js', 'push.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'vendor/firebase-app-compat.js', 'vendor/firebase-messaging-compat.js', 'memory.js', 'gestures.js', 'match.js', 'auto.js', 'usage.js'];
var NET_WAIT = 4000;                         // μετά από 4" χωρίς απάντηση ανοίγει από το αντίγραφο

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    // Ένα-ένα: αν λείπει κάποιο αρχείο, τα υπόλοιπα αποθηκεύονται κανονικά.
    return Promise.all(SHELL_FILES.map(function (f) {
      return fetch(f, { cache: 'reload' }).then(function (r) { if (r.ok) return c.put(f, r); }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return /^kw-shell-/.test(k) && k !== SHELL; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                              // το Apps Script (POST) δεν περνά ποτέ από εδώ
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // μόνο δικά μας αρχεία
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function fromCache() {
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : null);
      });
    }
    var timer = setTimeout(function () {
      fromCache().then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
    }, NET_WAIT);
    // 2.3.3: ρωτά πάντα το GitHub αν άλλαξε (304 αν όχι), αντί να κρατά παλιό αρχείο έως 10'
    // (Η σελίδα «navigate» δεν δέχεται ρυθμίσεις πάνω στο ίδιο αίτημα: ζητάμε τη διεύθυνσή της.)
    (req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
                             : fetch(req, { cache: 'no-cache' })).then(function (r) {
      if (r.ok && r.type === 'basic') {
        var copy = r.clone();
        caches.open(SHELL).then(function (c) { c.put(req.mode === 'navigate' ? 'index.html' : req, copy); });
      }
      clearTimeout(timer);
      if (!done) { done = true; resolve(r); }
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (hit) {
        if (done) return;
        done = true;
        resolve(hit || new Response('Χωρίς σύνδεση', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
      });
    });
  }));
});

self.addEventListener('push', function (e) {
  var payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { payload = {}; }
  var d = payload.data || payload;          // το Firebase βάζει τα δεδομένα μας κάτω από το «data»

  var url = new URL(d.url || './', self.registration.scope).href;
  var actions = [];                          // 2.3 · FEAT-3: κουμπιά (μόνο όπου υποστηρίζονται)
  try { actions = d.acts ? JSON.parse(d.acts).slice(0, 2) : []; } catch (err) { actions = []; }

  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'KW App', {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'badge-96.png',
      tag: d.tag || d.id || 'kw',
      renotify: true,
      actions: actions,
      data: { url: url, id: d.id || '', type: d.type || '' }
    }),
    // Αν η εφαρμογή είναι ανοιχτή, ανανεώνει τη λίστα αμέσως.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      list.forEach(function (c) { c.postMessage({ type: 'push', data: d }); });
    })
  ]));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var data = e.notification.data || {};
  var url = data.url || self.registration.scope;
  var act = /^o\d$/.test(e.action || '') ? e.action : '';   // 2.3 · FEAT-3: πατήθηκε κουμπί
  if (act) url += (url.indexOf('?') === -1 ? '?' : '&') + 'do=' + act;
  var remind = /[?&]remind=1/.test(url);
  var docs = /[?&]docs=1/.test(url);

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
          return c.focus().then(function (fc) {
            (fc || c).postMessage({ type: 'open', id: data.id, remind: remind, docs: docs, act: act });
          });
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
