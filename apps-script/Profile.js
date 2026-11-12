/**
 * KW App · Προφίλ πελάτη (Profile.gs) · 2.1
 * ─────────────────────────────────────────────────────────────
 * Νέο αρχείο ΚΑΤΩ από το Code.gs, στο ίδιο Apps Script project. Το Code.gs δεν αλλάζει.
 *
 * Τι κάνει: κρατά το «προφίλ» που συμπληρώνει ο μεσίτης ενώ μιλά με τον πελάτη
 * (Αγορά: χρηματοδότηση, πότε, ποιος αποφασίζει, budget… · Ενοικίαση: άτομα,
 * εργασία, κατοικίδιο, πότε μπαίνει…), σε ένα νέο φύλλο «Προφίλ πελατών».
 *
 * Ασφάλεια:
 *  · Κάθε μεσίτης διαβάζει και γράφει ΜΟΝΟ το προφίλ των δικών του κλήσεων (findMyLead_).
 *  · Δεκτά μόνο τα γνωστά πεδία, με όριο μήκους. Ό,τι άλλο στείλει η σελίδα αγνοείται.
 *  · ΑΦΜ / Α.Δ.Τ. δεν ζητούνται. Αν γραφτεί κατά λάθος αριθμός που μοιάζει με ΑΦΜ,
 *    ταυτότητα ή τηλέφωνο μέσα σε κείμενο, σβήνεται πριν γραφτεί.
 *  · Κείμενο που ξεκινά με = + - @ γράφεται ως κείμενο, όχι τύπος.
 */

const PROFILE = {
  SHEET: 'Προφίλ πελατών',
  HEADERS: ['ID κλήσης', 'Μεσίτης', 'Κωδικός', 'Τύπος', 'Αξιολόγηση', 'Σύνοψη', 'Δεδομένα', 'Δημιουργία', 'Ενημέρωση'],
  TEXT_MAX: 200
};

// Τα πεδία και οι επιτρεπτές τιμές. Ίδια με το PF του app.js.
const PROFILE_FIELDS = {
  deal: ['buy', 'rent'],
  name: 'text', email: 'email',
  // Αγορά
  fin: ['cash', 'loan', 'sale'], preapproval: 'bool', when: ['now', 'soon', 'explore'],
  decider: 'bool', companions: 'text', budgetBuy: 'money', costs: 'bool', areasBuy: 'text',
  // Ενοικίαση
  people: 'num', household: 'text', jobType: ['private', 'public', 'free', 'retired', 'student'],
  jobField: 'text', pet: ['yes', 'no'], petKind: 'text', moveIn: ['now', '30', '60'],
  budgetRent: 'money', areasRent: 'text'
};
const PROFILE_LEVELS = ['Θερμός', 'Χλιαρός', 'Κρύος'];

// Η εφαρμογή βρίσκει τις νέες ενέργειες εδώ. Αν το αρχείο είναι ΠΑΝΩ από το Code.gs,
// το ACTIONS δεν υπάρχει ακόμα: τότε η σελίδα γράφει «λείπει ο server του προφίλ».
(function () {
  try {
    ACTIONS.profileGet = actProfileGet_;
    ACTIONS.profileSave = actProfileSave_;
  } catch (e) {
    console.error('Profile.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs (⋮ → Μετακίνηση κάτω).');
  }
})();

function actProfileGet_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const rec = profileFind_(l.id);
  if (!rec) return { p: null };
  let p = null;
  try { p = JSON.parse(rec.v[6] || '{}'); } catch (e) { p = null; }
  return { p: p, level: String(rec.v[4] || ''), updated: profileStamp_(rec.v[8]) };
}

function actProfileSave_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const clean = profileClean_(d.p || {});
  const level = PROFILE_LEVELS.indexOf(d.level) !== -1 ? d.level : '';
  const now = new Date();
  const row = [l.id, agent.name, l.code, clean.p.deal === 'rent' ? 'Ενοικίαση' : clean.p.deal === 'buy' ? 'Αγορά' : '',
    level, profileSummary_(clean.p), JSON.stringify(clean.p), now, now];

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = profileSheet_();
    const rec = profileFind_(l.id, sh);
    const out = row.map(v => (typeof v === 'string' ? profileSafe_(v) : v));
    if (rec) {
      out[7] = rec.v[7] || now;                       // κρατάμε την αρχική «Δημιουργία»
      sh.getRange(rec.row, 1, 1, out.length).setValues([out]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, out.length).setValues([out]);
    }
  } finally {
    lock.releaseLock();
  }
  return { saved: profileStamp_(now), masked: clean.masked, summary: profileSummary_(clean.p) };
}

/** Κρατά μόνο τα γνωστά πεδία, με σωστό τύπο. masked = σβήστηκε κάποιος αριθμός ταυτότητας/ΑΦΜ. */
function profileClean_(input) {
  const p = {};
  let masked = false;
  Object.keys(PROFILE_FIELDS).forEach(k => {
    const rule = PROFILE_FIELDS[k], v = input[k];
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(rule)) { if (rule.indexOf(String(v)) !== -1) p[k] = String(v); return; }
    if (rule === 'bool') { p[k] = v === true || v === 'true'; return; }
    if (rule === 'num') { const n = Math.round(Number(v)); if (n > 0 && n < 100) p[k] = n; return; }
    if (rule === 'money') { const n = Math.round(Number(String(v).replace(/[^\d]/g, ''))); if (n > 0 && n < 100000000) p[k] = n; return; }
    if (rule === 'email') { const e = String(v).trim().slice(0, 120); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) p[k] = e; return; }
    // Κείμενο: σβήνουμε αριθμούς που μοιάζουν με ΑΦΜ (9 ψηφία), τηλέφωνο, Α.Δ.Τ. (ΑΒ 123456).
    let t = String(v).replace(/\s+/g, ' ').trim().slice(0, PROFILE.TEXT_MAX);
    const before = t;
    t = t.replace(/(^|[^A-Za-zΑ-Ωα-ωΆ-Ώά-ώ0-9])[A-Za-zΑ-Ωα-ω]{1,2}[\s-]?\d{6}(?!\d)/g, '$1•••')   // Α.Δ.Τ.
         .replace(/\d(?:[\s.-]?\d){7,}/g, '•••');                                                  // ΑΦΜ, τηλέφωνο
    if (t !== before) masked = true;
    if (t) p[k] = t;
  });
  return { p: p, masked: masked };
}

/** Μία γραμμή για όποιον ανοίξει το φύλλο: «Αγορά · Δάνειο με προέγκριση · Άμεσα · έως 250.000 €». */
function profileSummary_(p) {
  const L = {
    fin: { cash: 'Μετρητά', loan: 'Δάνειο', sale: 'Με πώληση άλλου ακινήτου' },
    when: { now: 'Άμεσα', soon: 'Σε 1–3 μήνες', explore: 'Ψάχνει (>3 μήνες)' },
    jobType: { private: 'Ιδιωτικός υπάλληλος', public: 'Δημόσιος', free: 'Ελεύθερος επαγγελματίας', retired: 'Συνταξιούχος', student: 'Φοιτητής' },
    moveIn: { now: 'Μπαίνει άμεσα', '30': 'Μπαίνει σε 30 ημέρες', '60': 'Μπαίνει σε 1–2 μήνες' }
  };
  const eur = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
  const out = [];
  if (p.deal === 'buy') {
    out.push('Αγορά');
    if (p.fin) out.push(L.fin[p.fin] + (p.fin === 'loan' ? (p.preapproval ? ' με προέγκριση' : ' χωρίς προέγκριση') : ''));
    if (p.when) out.push(L.when[p.when]);
    if (p.budgetBuy) out.push('έως ' + eur(p.budgetBuy));
    if (p.decider === true) out.push('αποφασίζει ο ίδιος');
    if (p.companions) out.push('έρχεται με: ' + p.companions);
    if (p.costs === true) out.push('ξέρει τα έξοδα');
    if (p.areasBuy) out.push('περιοχές: ' + p.areasBuy);
  } else if (p.deal === 'rent') {
    out.push('Ενοικίαση');
    if (p.people) out.push(p.people + (p.people === 1 ? ' άτομο' : ' άτομα') + (p.household ? ' (' + p.household + ')' : ''));
    else if (p.household) out.push(p.household);
    if (p.jobType) out.push(L.jobType[p.jobType] + (p.jobField ? ', ' + p.jobField : ''));
    if (p.pet) out.push(p.pet === 'yes' ? 'με κατοικίδιο' + (p.petKind ? ' (' + p.petKind + ')' : '') : 'χωρίς κατοικίδιο');
    if (p.moveIn) out.push(L.moveIn[p.moveIn]);
    if (p.budgetRent) out.push('έως ' + eur(p.budgetRent) + '/μήνα');
    if (p.areasRent) out.push('περιοχές: ' + p.areasRent);
  }
  return out.join(' · ');
}

function profileSheet_() {
  const ss = getSS();
  let sh = ss.getSheetByName(PROFILE.SHEET);
  if (!sh) {
    sh = ss.insertSheet(PROFILE.SHEET);
    sh.getRange(1, 1, 1, PROFILE.HEADERS.length).setValues([PROFILE.HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function profileFind_(id, sh) {
  sh = sh || getSS().getSheetByName(PROFILE.SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, PROFILE.HEADERS.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(id)) return { row: i + 2, v: vals[i] };
  }
  return null;
}

function profileStamp_(d) {
  return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm') : '';
}

/** Ό,τι ξεκινά με = + - @ γράφεται ως κείμενο (όπως το safe_ του Code.gs). */
function profileSafe_(s) {
  if (typeof safe_ === 'function') return safe_(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** Τρέξ' το μία φορά για να δεις ότι όλα είναι στη θέση τους. */
function profileCheck() {
  const ok = typeof ACTIONS !== 'undefined' && ACTIONS.profileSave === actProfileSave_;
  const sh = getSS().getSheetByName(PROFILE.SHEET);
  console.log((ok ? '✓ Η εφαρμογή βρίσκει το Προφίλ.' : '✗ Το Profile.gs πρέπει να είναι ΚΑΤΩ από το Code.gs (⋮ δίπλα στο όνομα → Μετακίνηση κάτω).') +
    '\nΦύλλο «' + PROFILE.SHEET + '»: ' + (sh ? (sh.getLastRow() - 1) + ' προφίλ' : 'θα φτιαχτεί με το πρώτο προφίλ') +
    '\nΜετά από κάθε αλλαγή στο Apps Script: Διαχείριση αναπτύξεων → ✏ → Νέα έκδοση.');
}
