/**
 * Service worker του KW App.
 * Δεν κρατάει cache — η εφαρμογή φορτώνει πάντα την τελευταία έκδοση από το GitHub.
 * Κάνει δύο πράγματα:
 *  1. Εμφανίζει την ειδοποίηση όταν το Apps Script στέλνει μία (μέσω Firebase).
 *  2. Όταν πατηθεί, ανοίγει την εφαρμογή απευθείας στη συγκεκριμένη κλήση.
 */

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { payload = {}; }
  var d = payload.data || payload;          // το Firebase βάζει τα δεδομένα μας κάτω από το «data»

  var url = new URL(d.url || './', self.registration.scope).href;

  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'KW App', {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'badge-96.png',
      tag: d.tag || d.id || 'kw',
      renotify: true,
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
  var remind = /[?&]remind=1/.test(url);
  var docs = /[?&]docs=1/.test(url);

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
          return c.focus().then(function (fc) {
            (fc || c).postMessage({ type: 'open', id: data.id, remind: remind, docs: docs });
          });
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
