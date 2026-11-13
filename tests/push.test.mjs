// FEAT-3 · Κουμπιά στις ειδοποιήσεις. Φορτώνει τον πραγματικό sw.js με ψεύτικο «self»
// και στέλνει ψεύτικα push / κλικ, για να ελέγξει ότι δεν σπάει καμία ειδοποίηση.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function boot(clients = []) {
  const h = {}, shown = [], opened = [], posted = [];
  const self = {
    registration: {
      scope: 'https://x.github.io/kw-app/',
      showNotification: (t, o) => { shown.push({ t, o }); return Promise.resolve(); }
    },
    clients: {
      matchAll: () => Promise.resolve(clients.map((c) => ({ url: c, focus() { return Promise.resolve(this); }, postMessage: (m) => posted.push(m) }))),
      openWindow: (u) => { opened.push(u); return Promise.resolve(); },
      claim: () => Promise.resolve()
    },
    addEventListener: (n, f) => { h[n] = f; },
    skipWaiting: () => Promise.resolve(), location: { origin: 'https://x.github.io' }
  };
  const ctx = { self, caches: { open: () => Promise.resolve({ addAll: () => Promise.resolve() }), keys: () => Promise.resolve([]) },
    fetch: () => Promise.reject(new Error('net')), URL, Promise, console, setTimeout, clearTimeout, Response: function () {} };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx, { filename: 'sw.js' });
  const wait = [];
  const ev = (o) => Object.assign({ waitUntil: (p) => wait.push(p) }, o);
  return { h, shown, opened, posted, ev, done: () => Promise.all(wait) };
}
const pushEv = (data) => ({ data: { json: () => ({ data }) } });
const clickEv = (n, action) => ({ action, notification: { data: n.o.data, close() {} } });

test('ειδοποίηση χωρίς κουμπιά: ίδια συμπεριφορά με πριν', async () => {
  const s = boot();
  s.h.push(s.ev(pushEv({ type: 'lead', id: 'L1', title: 'Νέα κλήση', url: '?lead=L1' })));
  await s.done();
  assert.equal(s.shown[0].t, 'Νέα κλήση');
  assert.equal(s.shown[0].o.actions.length, 0);
});

test('«Πώς πήγε;» με κουμπιά: εμφανίζει έως 2', async () => {
  const s = boot();
  const acts = JSON.stringify([{ action: 'o0', title: '👍 Ενδιαφέρθηκε' }, { action: 'o2', title: '👎 Δεν ενδιαφέρθηκε' }, { action: 'o3', title: 'x' }]);
  s.h.push(s.ev(pushEv({ type: 'outcome', id: 'go:outcome:7', url: '?lead=go%3Aoutcome%3A7', acts })));
  await s.done();
  assert.deepEqual(Array.from(s.shown[0].o.actions, (a) => a.action), ['o0', 'o2']);
});

test('χαλασμένα κουμπιά δεν ρίχνουν την ειδοποίηση', async () => {
  const s = boot();
  s.h.push(s.ev(pushEv({ type: 'outcome', id: 'x', acts: '{oops' })));
  await s.done();
  assert.equal(s.shown.length, 1);
  assert.equal(s.shown[0].o.actions.length, 0);
});

test('πάτημα κουμπιού με κλειστή εφαρμογή: ανοίγει με &do=o2', async () => {
  const s = boot();
  s.h.push(s.ev(pushEv({ type: 'outcome', id: 'go:outcome:7', url: '?lead=go%3Aoutcome%3A7', acts: '[]' })));
  await s.done();
  s.h.notificationclick(s.ev(clickEv(s.shown[0], 'o2')));
  await s.done();
  assert.match(s.opened[0], /\?lead=go%3Aoutcome%3A7&do=o2$/);
});

test('πάτημα κουμπιού με ανοιχτή εφαρμογή: στέλνει act στην εφαρμογή', async () => {
  const s = boot(['https://x.github.io/kw-app/']);
  s.h.push(s.ev(pushEv({ type: 'outcome', id: 'go:outcome:7', url: '?lead=go%3Aoutcome%3A7' })));
  await s.done();
  s.h.notificationclick(s.ev(clickEv(s.shown[0], 'o0')));
  await s.done();
  assert.equal(s.posted.filter((m) => m.type === 'open')[0].act, 'o0');
});

test('κλικ στο σώμα ή άγνωστο κουμπί: καμία ενέργεια (μόνο άνοιγμα)', async () => {
  const s = boot();
  s.h.push(s.ev(pushEv({ type: 'outcome', id: 'go:outcome:7', url: '?lead=go%3Aoutcome%3A7' })));
  await s.done();
  s.h.notificationclick(s.ev(clickEv(s.shown[0], '')));
  s.h.notificationclick(s.ev(clickEv(s.shown[0], 'evil&x=1')));
  await s.done();
  s.opened.forEach((u) => assert.doesNotMatch(u, /do=/));
});

test('η εφαρμογή δέχεται μόνο do=o<αριθμός>', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /var ACT_PARAM = \/\^o\\d\$\/\.test/);
  assert.match(app, /function quickOutcome\(id, act\)/);
});

test('2.3.3 · ο service worker ζητά πάντα φρέσκα αρχεία, και η σελίδα με σκέτη διεύθυνση', async () => {
  const calls = [];
  const ctx = {
    self: { registration: { scope: 'https://x.github.io/kw-app/' }, location: { origin: 'https://x.github.io' }, addEventListener: (n, f) => { ctx['on_' + n] = f; } },
    caches: { open: () => Promise.resolve({ put() {} }), match: () => Promise.resolve(null), keys: () => Promise.resolve([]) },
    fetch: (a, o) => { calls.push([typeof a === 'string' ? 'url' : 'request', o && o.cache]); return Promise.resolve({ ok: true, type: 'basic', clone() { return this; } }); },
    URL, Promise, setTimeout, clearTimeout, console, Response: function () {}
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  const ev = (mode, path) => ({ request: { method: 'GET', mode, url: 'https://x.github.io/kw-app/' + path }, respondWith: (p) => p });
  await ctx.on_fetch(ev('navigate', ''));
  await ctx.on_fetch(ev('no-cors', 'app.js'));
  assert.deepEqual(calls, [['url', 'no-cache'], ['request', 'no-cache']]);
});
