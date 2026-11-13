// 2.3.2 · Κάθε σημείο που βάζει φρέσκα στοιχεία (S.boot = b) πρέπει να ενημερώνει και τα
// feature flags. Αλλιώς ένα feature που ανοίγει από τις ρυθμίσεις δεν εμφανίζεται ποτέ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('κάθε S.boot = b ενημερώνει και τα S.flags', () => {
  const lines = app.split('\n');
  lines.forEach((ln, i) => {
    if (!/\bS\.boot = b\b/.test(ln)) return;
    const near = lines.slice(i, i + 3).join('\n');
    assert.match(near, /S\.flags = b\.flags/, 'app.js γραμμή ' + (i + 1) + ': λείπει S.flags = b.flags');
  });
});
