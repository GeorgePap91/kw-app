// KW App · Φτιάχνει τον φάκελο με ΜΟΝΟ τα αρχεία της εφαρμογής (PWA).
// Χρήση: node scripts/build-site.mjs <φάκελος>   (π.χ. dist ή _site)
// Το χρησιμοποιούν ΚΑΙ το GitHub Pages (παραγωγή) ΚΑΙ το Cloudflare (preview),
// ώστε να υπάρχει ένας κανόνας για το τι ανεβαίνει. Ποτέ: tests, backend, οδηγίες, .git.
import { readdirSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, process.argv[2] || 'dist');
const SKIP_DIRS = new Set(['.git', '.github', '.wrangler', 'node_modules', 'tests', 'apps-script', 'docs', 'scripts', 'dist', '_site']);
const SKIP_FILES = new Set(['package.json', 'package-lock.json', 'wrangler.jsonc', 'wrangler.toml', '.gitignore', '.assetsignore', '.DS_Store']);

rmSync(OUT, { recursive: true, force: true });
let n = 0;
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
    if (!e.isFile() || SKIP_FILES.has(e.name)) continue;
    const to = join(OUT, relative(ROOT, p));
    mkdirSync(join(to, '..'), { recursive: true });
    copyFileSync(p, to);
    n++;
  }
})(ROOT);
copyFileSync(join(ROOT, 'index.html'), join(OUT, 'index.html'));   // πάντα υπάρχει σελίδα εκκίνησης
console.log('build-site: ' + n + ' αρχεία → ' + relative(ROOT, OUT) + '/');
