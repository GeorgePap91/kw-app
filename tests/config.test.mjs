// 2.4 · Το preview (*.pages.dev) ΠΟΤΕ δεν μιλάει με την παραγωγή.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const SRC = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const run = (host) => { const w = {}; vm.runInNewContext(SRC, { window: w, location: { hostname: host } }); return w; };
const PROD = /AKfycbzvR5o/;

test('παραγωγή (github.io): PROD backend', () => {
  const w = run('georgepap91.github.io');
  assert.equal(w.KW_PREVIEW, false);
  assert.match(w.KW_CONFIG.API_URL, PROD);
});
test('preview Cloudflare Workers (*.workers.dev): ποτέ PROD', () => {
  const w = run('feat-feat-14-kw-app.georgepap91.workers.dev');
  assert.equal(w.KW_PREVIEW, true);
  assert.doesNotMatch(w.KW_CONFIG.API_URL, PROD);
});
test('οποιοσδήποτε άλλος host (π.χ. αντίγραφο σε άλλο site): ποτέ PROD', () => {
  assert.doesNotMatch(run('kw-app.example.com').KW_CONFIG.API_URL, PROD);
});
test('preview (*.pages.dev): ποτέ PROD', () => {
  const w = run('feat-feat-14.kw-app.pages.dev');
  assert.equal(w.KW_PREVIEW, true);
  assert.doesNotMatch(w.KW_CONFIG.API_URL, PROD);
});

test('DEV και PROD είναι διαφορετικές αναπτύξεις', () => {
  const prod = /PROD_API_URL = '([^']+)'/.exec(SRC)[1];
  const dev = /DEV_API_URL = '([^']*)'/.exec(SRC)[1];
  assert.ok(dev, 'λείπει το DEV_API_URL');
  assert.notEqual(dev, prod);
  assert.equal(run('x.workers.dev').KW_CONFIG.API_URL, dev);
  assert.equal(run('georgepap91.github.io').KW_CONFIG.API_URL, prod);
});
