/**
 * 2.7 · Επεξεργασία ακινήτου από τον μεσίτη του + Μετρήσεις χρήσης
 *
 * propSave: ο μεσίτης αλλάζει Τιμή, Εμβαδόν, Οδό, Περιοχή ΜΟΝΟ σε δικό του ακίνητο.
 *   Γράφεται στη γραμμή του «Διαθέσιμα ακίνητα» (1 ανάγνωση στήλης ID + έως 4 κελιά).
 *   Αν το φύλλο ξαναγεμίσει από το CRM, ισχύει ό,τι έχει το CRM.
 *
 * usage / usageReport: πόσες φορές, πόσα δευτερόλεπτα και πόσα πατήματα χρειάστηκε κάθε
 *   ενέργεια. Το κινητό τα μαζεύει και τα στέλνει ομαδικά (το πολύ κάθε 15′).
 *   Κρατιούνται ανά μεσίτη και μήνα σε Ιδιότητα σεναρίου: κανένα φύλλο, καμία ανάγνωση φύλλου.
 *   Χωρίς στοιχεία πελατών: μόνο αριθμοί.
 */

const EDIT = {
  FIELDS: { price: 'PRICE', sqm: 'SQM', street: 'STREET', area: 'AREA' },
  TEXT_MAX: 120
};

const USAGE = {
  KEY: 'USAGE:',               // + ΕΕΕΕ-ΜΜ + ':' + email
  KEEP_MONTHS: 6,
  MAX_SEC: 600,                // μία ενέργεια πάνω από 10′ = ο μεσίτης έκανε κάτι άλλο· δεν μετράει
  // Πόσα δευτερόλεπτα θέλει η ίδια δουλειά ΧΩΡΙΣ την εφαρμογή (εκτίμηση· αλλάζει με την Ιδιότητα USAGE_BASE).
  BASE: {
    called: 20,                // βρες τον αριθμό, πάρε τηλέφωνο
    status: 60,                // σημείωσε «δεν απάντησε» + υπενθύμιση στο ημερολόγιο
    sms: 60,                   // γράψε το SMS από την αρχή
    showing: 180,              // ραντεβού στο ημερολόγιο με στοιχεία πελάτη και διεύθυνση
    outcome: 30,               // σημείωσε πώς πήγε η υπόδειξη
    callNote: 30,              // σημείωση μετά την κλήση
    taskSave: 45,              // εργασία στο ημερολόγιο
    presCreate: 300,           // παρουσίαση ακινήτου στον πελάτη
    formCreate: 600,           // έντυπο υπόδειξης: εκτύπωση, συμπλήρωση, υπογραφή
    ownerReportSend: 1200,     // αναφορά στον ιδιοκτήτη με το χέρι
    propSave: 60,
    contactSave: 45
  },
  LABELS: {
    called: 'Κλήση πελάτη', status: 'Αλλαγή κατάστασης / follow-up', sms: 'SMS', showing: 'Υπόδειξη στο ημερολόγιο',
    outcome: 'Αποτέλεσμα υπόδειξης', callNote: 'Σημείωση κλήσης', taskSave: 'Εργασία', presCreate: 'Παρουσίαση ακινήτου',
    formCreate: 'Έντυπο υπόδειξης', ownerReportSend: 'Αναφορά ιδιοκτήτη', propSave: 'Διόρθωση ακινήτου', contactSave: 'Διόρθωση επαφής'
  }
};

(function () {
  try {
    ACTIONS.propSave = actPropSave_;
    ACTIONS.usage = actUsage_;
    ACTIONS.usageReport = actUsageReport_;
  } catch (e) {
    console.error('Edit.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

// ── Επεξεργασία ακινήτου ──────────────────────────────────────────────

/** Καθαρίζει ό,τι έστειλε η εφαρμογή. Επιστρέφει μόνο τα πεδία που δόθηκαν. */
function editClean_(d) {
  const out = {};
  if (d.price != null && String(d.price).trim() !== '') {
    const n = matchNum_(d.price);
    if (!n || n < 0 || n > 1e9) throw new Error('Η τιμή δεν είναι σωστή.');
    out.price = Math.round(n);
  }
  if (d.sqm != null && String(d.sqm).trim() !== '') {
    const n = matchNum_(d.sqm);
    if (!n || n < 0 || n > 1e6) throw new Error('Το εμβαδόν δεν είναι σωστό.');
    out.sqm = n;
  }
  ['street', 'area'].forEach(k => {
    if (d[k] == null) return;
    const t = String(d[k]).replace(/\s+/g, ' ').trim().slice(0, EDIT.TEXT_MAX);
    if (t) out[k] = t;
  });
  return out;
}

function actPropSave_(agent, d) {
  const key = normCode_(d.code);
  const p = readProps_()[key];
  if (!p || norm_(p.partner) !== norm_(agent.name)) throw new Error('Το ακίνητο δεν είναι δικό σου.');
  const v = editClean_(d);
  if (!Object.keys(v).length) throw new Error('Δεν άλλαξε κάτι.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSS().getSheetByName(CONFIG.SHEETS.PROPS);
    const ids = sh.getRange(2, colIdx_(PCOL.ID), sh.getLastRow() - 1, 1).getValues();
    const stat = sh.getRange(2, colIdx_(PCOL.STATUS), sh.getLastRow() - 1, 1).getValues();
    const avail = norm_(CONFIG.AVAILABLE);
    let row = 0;
    ids.forEach((r, i) => {
      if (normCode_(r[0]) !== key) return;
      // Διπλό ID: η διαθέσιμη γραμμή (ίδιος κανόνας με το readProps_).
      if (!row || norm_(stat[i][0]).indexOf(avail) === 0) row = i + 2;
    });
    if (!row) throw new Error('Δεν βρέθηκε το ακίνητο στο φύλλο.');
    Object.keys(v).forEach(k => {
      sh.getRange(row, colIdx_(PCOL[EDIT.FIELDS[k]])).setValue(typeof v[k] === 'number' ? v[k] : safe_(v[k]));
    });
  } finally {
    lock.releaseLock();
  }
  log_('Διόρθωση ακινήτου', agent.name, p.code + ' · ' + Object.keys(v).join(', '));
  _props = null;
  const fresh = readProps_()[key];
  return { code: fresh.code, price: fresh.price, sqm: fresh.sqm, street: fresh.street, area: fresh.area };
}

// ── Μετρήσεις χρήσης ──────────────────────────────────────────────────

function usageMonth_(back) {
  const now = new Date();
  return Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - (back || 0), 1), TZ, 'yyyy-MM');
}

/** Προσθέτει rows ({ ενέργεια: [φορές, δευτ., κλικ] }) στο σύνολο του μήνα. Καθαρή συνάρτηση. */
function usageAdd_(total, rows) {
  const out = Object.assign({}, total);
  Object.keys(rows || {}).forEach(k => {
    if (!USAGE.BASE[k]) return;                           // μόνο γνωστές ενέργειες
    const r = rows[k] || [];
    const n = Math.max(0, Math.min(500, Math.round(Number(r[0]) || 0)));
    if (!n) return;
    const sec = Math.max(0, Math.min(n * USAGE.MAX_SEC, Math.round(Number(r[1]) || 0)));
    const clicks = Math.max(0, Math.min(n * 200, Math.round(Number(r[2]) || 0)));
    const cur = out[k] || [0, 0, 0];
    out[k] = [cur[0] + n, cur[1] + sec, cur[2] + clicks];
  });
  return out;
}

function usageBase_() {
  let custom = {};
  try { custom = JSON.parse(prop_('USAGE_BASE', '{}')) || {}; } catch (e) { custom = {}; }
  const out = {};
  Object.keys(USAGE.BASE).forEach(k => { out[k] = Number(custom[k]) > 0 ? Number(custom[k]) : USAGE.BASE[k]; });
  return out;
}

/** Σύνολο → γραμμές αναφοράς + χρόνος που γλίτωσε. Καθαρή συνάρτηση. */
function usageRows_(total, base) {
  let saved = 0, n = 0;
  const rows = Object.keys(total).filter(k => base[k]).map(k => {
    const t = total[k], avg = t[0] ? t[1] / t[0] : 0;
    const gain = Math.max(0, Math.round(t[0] * (base[k] - avg)));
    saved += gain; n += t[0];
    return { key: k, label: USAGE.LABELS[k] || k, n: t[0], avgSec: Math.round(avg), avgClicks: t[0] ? Math.round(t[2] / t[0] * 10) / 10 : 0,
             baseSec: base[k], savedSec: gain };
  }).sort((a, b) => b.savedSec - a.savedSec);
  return { rows: rows, actions: n, savedSec: saved };
}

function usageGet_(month, email) {
  try { return JSON.parse(PROPS_[USAGE.KEY + month + ':' + String(email || '').toLowerCase()] || '{}') || {}; }
  catch (e) { return {}; }
}

function actUsage_(agent, d) {
  if (!agent.email) return { ok: false };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sp = PropertiesService.getScriptProperties();
    const key = USAGE.KEY + usageMonth_(0) + ':' + String(agent.email).toLowerCase();
    let cur = {};
    try { cur = JSON.parse(sp.getProperty(key) || '{}') || {}; } catch (e) { cur = {}; }
    sp.setProperty(key, JSON.stringify(usageAdd_(cur, d.rows)));
    // Μία φορά τον μήνα περίπου: σβήνουμε ό,τι είναι παλιότερο από 6 μήνες.
    if (new Date().getDate() === 1) {
      const limit = usageMonth_(USAGE.KEEP_MONTHS);
      Object.keys(PROPS_).filter(k => k.indexOf(USAGE.KEY) === 0 && k.slice(USAGE.KEY.length, USAGE.KEY.length + 7) < limit)
        .forEach(k => sp.deleteProperty(k));
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** { month: 'this' | 'last', team: true (μόνο Admin) } */
function actUsageReport_(agent, d) {
  const month = usageMonth_(d.month === 'last' ? 1 : 0);
  const base = usageBase_();
  let total = usageGet_(month, agent.email);
  let people = 1;
  if (d.team && isAdmin_(agent)) {
    total = {};
    people = 0;
    const pre = USAGE.KEY + month + ':';
    Object.keys(PROPS_).filter(k => k.indexOf(pre) === 0).forEach(k => {
      let t = {};
      try { t = JSON.parse(PROPS_[k] || '{}') || {}; } catch (e) { t = {}; }
      Object.keys(t).forEach(a => { const c = total[a] || [0, 0, 0]; total[a] = [c[0] + t[a][0], c[1] + t[a][1], c[2] + t[a][2]]; });
      people++;
    });
  }
  const r = usageRows_(total, base);
  return { month: month, team: !!(d.team && isAdmin_(agent)), people: people, canTeam: isAdmin_(agent),
           rows: r.rows, actions: r.actions, savedSec: r.savedSec };
}
