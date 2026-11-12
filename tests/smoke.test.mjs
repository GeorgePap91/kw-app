// Smoke tests του KW App — τρέχουν με τον ενσωματωμένο test runner του Node
// (χωρίς npm install, άρα γρήγορα και δωρεάν στο GitHub Actions).
// Ελέγχουν ότι κάθε αλλαγή δεν «σπάει» την εφαρμογή πριν φτάσει στους agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

test('όλα τα .js της PWA έχουν σωστή σύνταξη', () => {
  const files = readdirSync(ROOT).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const f of files) {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
  }
});

test('ο service worker προ-αποθηκεύει μόνο αρχεία που υπάρχουν (αλλιώς χαλάει το offline)', () => {
  const sw = read('sw.js');
  const m = /SHELL_FILES\s*=\s*\[([\s\S]*?)\]/.exec(sw);
  assert.ok(m, 'δεν βρέθηκε SHELL_FILES στο sw.js');
  const files = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((f) => f !== './');
  for (const f of files) assert.ok(existsSync(join(ROOT, f)), `λείπει το ${f}`);
});

test('η έκδοση cache του service worker έχει μορφή kw-shell-X.Y', () => {
  assert.match(read('sw.js'), /var SHELL = 'kw-shell-\d+\.\d+(\.\d+)?'/);
});

test('το manifest είναι έγκυρο JSON με εικονίδια που υπάρχουν', () => {
  const man = JSON.parse(read('manifest.webmanifest'));
  assert.equal(man.display, 'standalone');
  for (const i of man.icons) assert.ok(existsSync(join(ROOT, i.src)), `λείπει το ${i.src}`);
});

// Γνωστά αρχεία που λείπουν — να ανέβουν στο repo και να βγουν από εδώ.
const KNOWN_MISSING = new Set(['logo-kw.png']); // offer.html: λογότυπο σελίδας προσφοράς

test('τα τοπικά scripts/styles που φορτώνουν οι σελίδες υπάρχουν', () => {
  for (const page of ['index.html', 'form.html', 'offer.html', 'p.html']) {
    if (!existsSync(join(ROOT, page))) continue;
    const html = read(page);
    const refs = [...html.matchAll(/(?:src|href)="([^"#:?]+\.(?:js|css|png|webmanifest))"/g)].map((x) => x[1]);
    for (const r of refs.filter((r) => !KNOWN_MISSING.has(r))) assert.ok(existsSync(join(ROOT, r.replace(/^\.\//, ''))), `${page}: λείπει το ${r}`);
  }
});

test('το config.js δείχνει σε Apps Script /exec και δεν περιέχει μυστικά', () => {
  const cfg = read('config.js');
  assert.match(cfg, /API_URL:\s*'https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec'/);
  assert.doesNotMatch(cfg, /private_key|client_secret|refresh_token/i);
});

test('κανένα αρχείο δεν περιέχει ιδιωτικά κλειδιά ή tokens', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    ['.git', 'node_modules', 'vendor', 'tests'].includes(d.name) ? [] :
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
  for (const f of walk(ROOT).filter((f) => /\.(js|gs|html|json|md)$/.test(f))) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /-----BEGIN (RSA )?PRIVATE KEY-----/, f);
    assert.doesNotMatch(s, /"refresh_token"\s*:/, f);
  }
});
