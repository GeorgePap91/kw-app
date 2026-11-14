# Dev Pipeline — Notion → GitHub → Apps Script → Drive

## Ροή
| Status (Notion) | Ποιος | Τι γίνεται |
|---|---|---|
| Accepted → **In Development** | εσύ | Γράφεις spec (template «Feature Spec») και μου λες «ξεκίνα» |
| In Development | Claude | Branch `feat/FEAT-<id>`, κώδικας + tests, Pull Request |
| (αυτόματα) | GitHub Actions | `CI — Tests` · `Deploy — Apps Script` → **DEV** |
| **In Review** | εσύ | Δοκιμάζεις στο DEV |
| **Approved** | εσύ | Μου λες «ξεκίνα» → merge στο `main` |
| (αυτόματα) | GitHub Actions | Tests + **E2E σε πραγματικό Chrome** → μόνο αν περάσουν: Deploy **PROD** (νέα έκδοση, ίδιο /exec URL) και Deploy εφαρμογής στο GitHub Pages |
| **Released** | Claude | Φάκελος Drive, Release Notes, ενημέρωση κάρτας |
| **Blocked** | Claude | Λείπει πληροφορία ή απέτυχαν tests — δες το σχόλιο στην κάρτα |

## Ρυθμίσεις που κάνεις μία φορά
1. **Claude GitHub App** στο repo (για να κάνει push ο Claude): https://github.com/apps/claude/installations/select_target
2. **Apps Script API = On**: https://script.google.com/home/usersettings (στον λογαριασμό που κατέχει το script)
3. **DEV Apps Script project**: «Δημιουργία αντιγράφου» του τρέχοντος script, συνδεδεμένο σε workbook με test δεδομένα.
4. **clasp** στον υπολογιστή σου: `npm i -g @google/clasp@2.4.2` → `clasp login`
5. **GitHub → Settings → Secrets and variables → Actions → New repository secret**:
   - `CLASPRC_JSON` — όλο το περιεχόμενο του `~/.clasprc.json`
   - `SCRIPT_ID_DEV`, `SCRIPT_ID_PROD` — Apps Script → ⚙ Ρυθμίσεις έργου → Αναγνωριστικό σεναρίου
   - `DEPLOYMENT_ID_PROD` — Ανάπτυξη → Διαχείριση αναπτύξεων → Αναγνωριστικό ανάπτυξης της τρέχουσας web app
6. **Κώδικας backend στο repo**: οδηγίες στο `apps-script/README.md`.

## Φράγμα πριν από κάθε deploy (2.3.5)
Τίποτα δεν φτάνει στα κινητά αν δεν περάσουν όλα τα tests:
- `npm test`: γρήγορα tests ανά αρχείο
- `npm run e2e`: ολόκληρη η εφαρμογή σε πραγματικό Chrome με αφή κινητού
Ρύθμιση μίας φοράς: **Settings → Pages → Build and deployment → Source = GitHub Actions**.

## Rollback
- Apps Script: Ανάπτυξη → Διαχείριση αναπτύξεων → επιλογή προηγούμενης έκδοσης.
- PWA: `git revert` του merge commit → το GitHub Pages γυρνά πίσω σε ~1 λεπτό.

## Κόστος
GitHub Actions (public repo): δωρεάν απεριόριστα. clasp / Apps Script API: δωρεάν, δεν τρώνε από τα quotas της εφαρμογής.

## DEV + Preview links (2.4 · FEAT-21, FEAT-16)
- **DEV workbook:** «Κλήσεις DEV (KW App — δοκιμές)» στο Drive. Το DEV Apps Script δείχνει εκεί (SPREADSHEET_ID).
- **DEV ανάπτυξη:** μία web app ανάπτυξη στο DEV project. Το /exec της μπαίνει στο `config.js` → `DEV_API_URL`. Κάθε push σε `feat/**` την ανανεώνει.
- **Preview:** Cloudflare Pages συνδεδεμένο με το repo. Κάθε branch → `https://<branch>.kw-app.pages.dev`. Εκεί η εφαρμογή μιλάει ΜΟΝΟ με το DEV (έλεγχος στο `config.js`, test στο `tests/config.test.mjs`).
- **Flags στο DEV:** Script property `FEATURES` με `"all"` σε όλα, ώστε στο preview να φαίνονται όλα.
- **Cloudflare (Workers):** Production → Deploy command `npx wrangler deploy`. Previews Base → Build command `node scripts/build-site.mjs dist` (η εντολή preview δεν τρέχει μόνη της το build). Preview link: `https://<branch-με-παύλες>-kw-app.georgepapadakis532.workers.dev`.
