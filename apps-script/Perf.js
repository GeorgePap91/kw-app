/**
 * 2.18 · OpEx Φάση 0 · Μέτρηση χρόνων (baseline πριν από κάθε βελτιστοποίηση)
 *
 * Τι μετρά: τη διάρκεια κάθε αιτήματος της εφαρμογής (ανά ενέργεια), του ελέγχου συνεδρίας,
 * και κάθε χρονοδιακόπτη (trigger). Ό,τι αλλάξουμε στη συνέχεια συγκρίνεται με αυτά τα νούμερα.
 *
 * Πώς, χωρίς να βαρύνει την εφαρμογή:
 *   1. Κάθε μέτρηση γράφει σε CacheService ένα μικρό ιστόγραμμα ανά ώρα και όνομα (2 κλήσεις cache, λίγα ms).
 *   2. Μία φορά την ώρα, μέσα στο checkNewLeads που ήδη τρέχει, οι ώρες που έκλεισαν συγχωνεύονται σε ένα
 *      ημερήσιο σύνολο στις Ιδιότητες σεναρίου (PERF_DAY:yyyyMMdd). Κρατιούνται PERF.KEEP_DAYS ημέρες.
 *   3. Κανένα φύλλο, κανένα νέο trigger, κανένα προσωπικό δεδομένο: μόνο ονόματα ενεργειών και χιλιοστά.
 *
 * Περιορισμοί (ειλικρινά):
 *   - Δύο ταυτόχρονα αιτήματα μπορεί να «χάσουν» ένα δείγμα (read-modify-write χωρίς κλείδωμα, σκόπιμα:
 *     ένα κλείδωμα θα καθυστερούσε κάθε αίτημα). Τα νούμερα είναι ενδεικτικά, όχι λογιστικά.
 *   - Μετράμε τον χρόνο ΜΕΣΑ στο script. Η εκκίνηση του Apps Script (cold start) και το δίκτυο του κινητού
 *     δεν φαίνονται εδώ. Για αυτά χρειάζεται μέτρηση στο κινητό (επόμενο βήμα του σχεδίου).
 *   - Τα εκατοστημόρια βγαίνουν από κάδους, άρα δίνουν «το πολύ Χ ms» (το άνω όριο του κάδου).
 *
 * Διακόπτης: Ιδιότητα σεναρίου PERF = off σταματά τη μέτρηση αμέσως, χωρίς νέα έκδοση.
 *
 * Ποιος βλέπει τα νούμερα: ΜΟΝΟ ο developer, από τον editor (▶ perfReport / ▶ perfNow).
 * Σκόπιμα δεν υπάρχει ενέργεια στο API ούτε οθόνη στην εφαρμογή: κανένας ρόλος (Admin, Super Admin,
 * Coach) του πελάτη δεν τα βλέπει. Η μελλοντική αποστολή στην κονσόλα του προϊόντος
 * (ARCHITECTURE §14.5) θα στέλνει μόνο αριθμούς προς τον λογαριασμό του developer.
 */

const PERF = {
  BUCKETS: [100, 250, 500, 1000, 2000, 4000, 8000, 15000, 30000],   // + ένας κάδος «≥ 30 s»
  CACHE_TTL: 21600,               // 6 ώρες, το μέγιστο του CacheService
  BACK_HOURS: 5,                  // πόσες κλεισμένες ώρες ελέγχει το flush (< CACHE_TTL)
  DAY_KEY: 'PERF_DAY:',
  FLUSH_KEY: 'PERF_FLUSHED',      // τελευταία ώρα που συγχωνεύτηκε (yyyyMMddHH)
  KEEP_DAYS: 14,
  MAX_DAY_CHARS: 8500,            // όριο τιμής Ιδιότητας ≈ 9 KB
  MAX_NAME: 60,
  OTHER: '(άλλα)',
  TRIGGER_BUDGET_MIN: { gmail: 90, workspace: 360 }   // συνολικός χρόνος triggers/ημέρα [να επαληθευτεί στα Quotas]
};

// ── Καθαρή λογική (χωρίς Google, δοκιμάζεται σε Node) ─────────────────

function perfEmpty_() {
  return { n: 0, s: 0, x: 0, e: 0, b: PERF.BUCKETS.map(() => 0).concat(0) };
}

/** Προσθέτει ένα δείγμα σε ιστόγραμμα (αλλάζει και επιστρέφει το h). */
function perfAdd_(h, ms, ok) {
  h = h || perfEmpty_();
  ms = Math.max(0, Math.round(Number(ms) || 0));
  h.n += 1;
  h.s += ms;
  if (ms > h.x) h.x = ms;
  if (ok === false) h.e += 1;
  let i = PERF.BUCKETS.findIndex(lim => ms < lim);
  if (i < 0) i = PERF.BUCKETS.length;
  h.b[i] += 1;
  return h;
}

/** Συγχώνευση δύο ιστογραμμάτων (το a αλλάζει). */
function perfMerge_(a, b) {
  if (!b) return a || perfEmpty_();
  a = a || perfEmpty_();
  a.n += b.n || 0;
  a.s += b.s || 0;
  a.x = Math.max(a.x || 0, b.x || 0);
  a.e += b.e || 0;
  (b.b || []).forEach((v, i) => { a.b[i] = (a.b[i] || 0) + (v || 0); });
  return a;
}

/** Εκατοστημόριο q (0–1) ως άνω όριο κάδου σε ms. Ο τελευταίος κάδος επιστρέφει το μέγιστο που είδαμε. */
function perfPct_(h, q) {
  if (!h || !h.n) return 0;
  const target = Math.ceil(h.n * q);
  let acc = 0;
  for (let i = 0; i < h.b.length; i++) {
    acc += h.b[i];
    if (acc >= target) return i < PERF.BUCKETS.length ? Math.min(PERF.BUCKETS[i], h.x) : h.x;
  }
  return h.x;
}

/**
 * Κρατά το ημερήσιο σύνολο κάτω από το όριο μιας Ιδιότητας: τα ονόματα με τα λιγότερα δείγματα
 * συγχωνεύονται στο «(άλλα)». Τα triggers (t:) δεν συγχωνεύονται ποτέ, γιατί μετρούν στο όριο της Google.
 */
function perfCompact_(day) {
  const fits = () => JSON.stringify(day).length <= PERF.MAX_DAY_CHARS;
  if (fits()) return day;
  const names = Object.keys(day)
    .filter(k => k !== PERF.OTHER && k.indexOf('t:') !== 0)
    .sort((a, b) => day[a].n - day[b].n);
  for (const k of names) {
    day[PERF.OTHER] = perfMerge_(day[PERF.OTHER], day[k]);
    delete day[k];
    if (fits()) break;
  }
  return day;
}

/** Ασφαλές όνομα: μόνο γράμματα/αριθμοί/:_-, με όριο μήκους. Ποτέ περιεχόμενο από τον χρήστη. */
function perfName_(name) {
  return String(name || '?').replace(/[^\w:.\-]/g, '_').slice(0, PERF.MAX_NAME);
}

/**
 * Αναφορά από ημερήσια σύνολα. days: { yyyyMMdd: { name: hist } }.
 * Επιστρέφει γραμμές ταξινομημένες κατά συνολικό χρόνο, και τον μέσο ημερήσιο χρόνο των triggers.
 */
function perfSummary_(days) {
  const keys = Object.keys(days || {}).sort();
  const total = {};
  const trigPerDay = {};
  keys.forEach(d => {
    const day = days[d] || {};
    Object.keys(day).forEach(name => {
      total[name] = perfMerge_(total[name], day[name]);
      if (name.indexOf('t:') === 0) trigPerDay[d] = (trigPerDay[d] || 0) + (day[name].s || 0);
    });
  });
  const rows = Object.keys(total).map(name => {
    const h = total[name];
    return {
      name: name,
      n: h.n,
      perDay: keys.length ? Math.round(h.n / keys.length) : 0,
      avg: h.n ? Math.round(h.s / h.n) : 0,
      p50: perfPct_(h, 0.5),
      p90: perfPct_(h, 0.9),
      p95: perfPct_(h, 0.95),
      max: h.x,
      errors: h.e,
      totalSec: Math.round(h.s / 1000)
    };
  }).sort((a, b) => b.totalSec - a.totalSec || b.n - a.n);
  const trigDays = Object.keys(trigPerDay);
  const trigMinPerDay = trigDays.length
    ? Math.round(trigDays.reduce((s, d) => s + trigPerDay[d], 0) / trigDays.length / 6000) / 10
    : 0;
  return {
    days: keys.length,
    from: keys[0] || '',
    to: keys[keys.length - 1] || '',
    rows: rows,
    triggerMinPerDay: trigMinPerDay,
    triggerBudgetPct: {
      gmail: Math.round(trigMinPerDay / PERF.TRIGGER_BUDGET_MIN.gmail * 1000) / 10,
      workspace: Math.round(trigMinPerDay / PERF.TRIGGER_BUDGET_MIN.workspace * 1000) / 10
    }
  };
}

/** Οι κλεισμένες ώρες που πρέπει να συγχωνευτούν, από την παλαιότερη στη νεότερη. hourOf(ms) → yyyyMMddHH. */
function perfDueHours_(nowMs, lastFlushed, hourOf) {
  const out = [];
  for (let k = PERF.BACK_HOURS; k >= 1; k--) {
    const h = hourOf(nowMs - k * 3600000);
    if ((!lastFlushed || h > lastFlushed) && out.indexOf(h) < 0) out.push(h);
  }
  return out;
}

// ── Με Google (CacheService / PropertiesService) ─────────────────────

let _perfOn = null;   // μία ανάγνωση της Ιδιότητας ανά εκτέλεση, όχι ανά μέτρηση
function perfOn_() {
  if (_perfOn === null) {
    try { _perfOn = String(PropertiesService.getScriptProperties().getProperty('PERF') || '').toLowerCase() !== 'off'; }
    catch (e) { _perfOn = false; }
  }
  return _perfOn;
}

function perfHour_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, 'yyyyMMddHH');
}

/** Καταγράφει ένα δείγμα. Δεν πετά ποτέ σφάλμα: η μέτρηση δεν πρέπει να ρίξει αίτημα ή trigger. */
function perfRecord_(name, ms, ok) {
  try {
    if (!perfOn_()) return;
    const cache = CacheService.getScriptCache();
    const hour = perfHour_(Date.now());
    const n = perfName_(name);
    const key = 'perf:' + hour + ':' + n;
    const raw = cache.get(key);
    const h = perfAdd_(raw ? JSON.parse(raw) : null, ms, ok);
    cache.put(key, JSON.stringify(h), PERF.CACHE_TTL);
    if (!raw) {
      const ik = 'perf:' + hour + ':idx';
      const idx = JSON.parse(cache.get(ik) || '[]');
      if (idx.indexOf(n) < 0) { idx.push(n); cache.put(ik, JSON.stringify(idx), PERF.CACHE_TTL); }
    }
  } catch (e) { /* σιωπηλά, σκόπιμα */ }
}

/** Τρέχει fn, μετρά τη διάρκεια και επιστρέφει ό,τι επέστρεψε. Τα σφάλματα περνούν ανέπαφα προς τα πάνω. */
function perfRun_(name, fn) {
  const t0 = Date.now();
  let ok = false;
  let res;
  try {
    res = fn();
    ok = true;
    return res;
  } finally {
    // Το checkNewLeads επιστρέφει 'skip' όταν δεν άλλαξε τίποτα: το μετράμε χωριστά, είναι η συνηθισμένη διαδρομή.
    perfRecord_(name + (res === 'skip' ? ':skip' : ''), Date.now() - t0, ok);
  }
}

/**
 * Συγχωνεύει τις ώρες που έκλεισαν στο ημερήσιο σύνολο. Καλείται κάθε λεπτό από το checkNewLeads,
 * αλλά στις περισσότερες κλήσεις κάνει μόνο μία ανάγνωση cache και επιστρέφει.
 */
function perfFlush_() {
  try {
    if (!perfOn_()) return 'off';
    const cache = CacheService.getScriptCache();
    const nowHour = perfHour_(Date.now());
    if (cache.get('perf:checked') === nowHour) return 'done';

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return 'busy';
    try {
      const sp = PropertiesService.getScriptProperties();
      const due = perfDueHours_(Date.now(), sp.getProperty(PERF.FLUSH_KEY), perfHour_);
      const touched = {};
      due.forEach(hour => {
        const idx = JSON.parse(cache.get('perf:' + hour + ':idx') || '[]');
        if (!idx.length) return;
        const got = cache.getAll(idx.map(n => 'perf:' + hour + ':' + n));
        const dayKey = PERF.DAY_KEY + hour.slice(0, 8);
        const day = touched[dayKey] || JSON.parse(sp.getProperty(dayKey) || '{}');
        idx.forEach(n => {
          const raw = got['perf:' + hour + ':' + n];
          if (raw) day[n] = perfMerge_(day[n], JSON.parse(raw));
        });
        touched[dayKey] = day;
      });
      const out = {};
      Object.keys(touched).forEach(k => { out[k] = JSON.stringify(perfCompact_(touched[k])); });
      if (due.length) out[PERF.FLUSH_KEY] = due[due.length - 1];
      if (Object.keys(out).length) sp.setProperties(out);

      // Καθαρισμός ημερών εκτός διατήρησης.
      const keep = Utilities.formatDate(new Date(Date.now() - PERF.KEEP_DAYS * 86400000), TZ, 'yyyyMMdd');
      sp.getKeys().filter(k => k.indexOf(PERF.DAY_KEY) === 0 && k.slice(PERF.DAY_KEY.length) < keep)
        .forEach(k => sp.deleteProperty(k));

      cache.put('perf:checked', nowHour, 3600);
      return 'flushed:' + due.length;
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    console.warn('Perf flush: ' + e.message);
    return 'error';
  }
}

/** Τα ημερήσια σύνολα των τελευταίων n ημερών (χωρίς τη σημερινή, που είναι μισή). */
function perfDays_(n) {
  const sp = PropertiesService.getScriptProperties();
  const all = sp.getProperties();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  const keys = Object.keys(all)
    .filter(k => k.indexOf(PERF.DAY_KEY) === 0 && k.slice(PERF.DAY_KEY.length) < today)
    .sort().slice(-(n || 7));
  const days = {};
  keys.forEach(k => {
    try { days[k.slice(PERF.DAY_KEY.length)] = JSON.parse(all[k]); } catch (e) { /* χαλασμένη τιμή: παράλειψη */ }
  });
  return days;
}

/**
 * ▶ Τρέξε από τον editor: γράφει στο αρχείο καταγραφής την αναφορά των τελευταίων 7 ημερών.
 * Η σημερινή ημέρα δεν μπαίνει (είναι μισή). Για την τρέχουσα ώρα: ▶ perfNow.
 */
function perfReport() {
  const r = perfSummary_(perfDays_(7));
  const line = (c) => c.map((v, i) => String(v).padStart(i ? 8 : 28)).join('');
  console.log('Μέτρηση χρόνων · ' + r.days + ' ημέρες (' + r.from + '–' + r.to + ')');
  console.log('Triggers: ' + r.triggerMinPerDay + ' λεπτά/ημέρα · ' + r.triggerBudgetPct.gmail + '% του ορίου Gmail (90′) · ' +
              r.triggerBudgetPct.workspace + '% του ορίου Workspace (6 ώρες)');
  console.log(line(['όνομα', '/ημέρα', 'μέσος', 'p50≤', 'p90≤', 'p95≤', 'max', 'λάθη', 'σύν.s']));
  r.rows.forEach(x => console.log(line([x.name, x.perDay, x.avg, x.p50, x.p90, x.p95, x.max, x.errors, x.totalSec])));
  return r;
}

/** ▶ Για γρήγορο έλεγχο: δείχνει την τρέχουσα ώρα από την cache, χωρίς να γράψει τίποτα. */
function perfNow() {
  const cache = CacheService.getScriptCache();
  const hour = perfHour_(Date.now());
  const idx = JSON.parse(cache.get('perf:' + hour + ':idx') || '[]');
  const got = idx.length ? cache.getAll(idx.map(n => 'perf:' + hour + ':' + n)) : {};
  const day = {};
  idx.forEach(n => { const raw = got['perf:' + hour + ':' + n]; if (raw) day[n] = JSON.parse(raw); });
  const r = perfSummary_({ [hour.slice(0, 8)]: day });
  console.log('Τρέχουσα ώρα ' + hour.slice(8) + ':00 · ' + r.rows.length + ' ονόματα');
  r.rows.forEach(x => console.log(x.name + ' · ' + x.n + ' φορές · μέσος ' + x.avg + ' ms · max ' + x.max + ' ms'));
  return r;
}
