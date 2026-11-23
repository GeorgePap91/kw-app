/**
 * 1.24 · Φόρμα ζήτησης (Demand.gs, ΚΑΤΩ από το Code.gs)
 * ─────────────────────────────────────────────────────────────
 * Ροή (ίδια λογική με το έντυπο προσφοράς):
 *   1. Ο πελάτης δεν ενδιαφέρθηκε. Ο μεσίτης, από την κλήση, πατά «Πάρε ζήτηση» →
 *      «Στείλε φόρμα». Φτιάχνεται link: APP_URL + 'demand.html#' + κλειδί.
 *      Στο φύλλο γράφεται ΜΟΝΟ το SHA-256 του κλειδιού.
 *   2. Ο πελάτης συμπληρώνει: τιμή, τ.μ., τιμή/τ.μ. (από–έως), όροφο, υπνοδωμάτια,
 *      περιοχές (ελεύθερο κείμενο), έτος κατασκευής (από–έως), πάρκινγκ, επιπλωμένο, σημειώσεις.
 *      Χωρίς σύνδεση, χωρίς ΑΦΜ / ταυτότητα / τηλέφωνο.
 *   3. Ο μεσίτης παίρνει ειδοποίηση με τα κριτήρια. Στην εφαρμογή: «Αντιγραφή για το iList»
 *      και «Η ζήτηση περάστηκε στο iList».
 *
 * Οικονομία: το φύλλο ΔΕΝ διαβάζεται ποτέ ολόκληρο. Η γραμμή βρίσκεται με TextFinder
 * (στη στήλη του hash ή της κλήσης) και διαβάζεται/γράφεται μόνο αυτή, με ένα setValues.
 *
 * GDPR: στο φύλλο μένουν κριτήρια ακινήτου και μόνο το μικρό όνομα του πελάτη (για την
 * ειδοποίηση). Αριθμοί που μοιάζουν με ΑΦΜ / ταυτότητα / τηλέφωνο σβήνονται από τις σημειώσεις.
 *
 * Ενέργειες μεσίτη:  demandStatus { id } · demandCreate { id } · demandCancel { id } · demandIList { id | dm, on }
 *                    demandList (1.25: οθόνη «Ζητήσεις», με cache ανά μεσίτη)
 * Ενέργειες πελάτη:  demandOpen { f } · demandSubmit { f, c }
 */

const DEMAND = {
  SHEET: 'Φόρμες ζήτησης',
  HEADERS: ['ID', 'Κλειδί (hash)', 'Κλήση', 'Μεσίτης', 'Κωδικός', 'Συναλλαγή', 'Δημιουργία', 'Λήξη',
            'Κατάσταση', 'Ανοίγματα', 'Υποβολή', 'Κριτήρια (JSON)', 'Σύνοψη', 'iList', 'Πλαίσιο (JSON)', 'Ενημέρωση'],
  EXPIRE_DAYS: 30,
  MAX_OPENS: 40,
  NOTES_MAX: 1000,
  AREAS_MAX: 300,
  FLOORS: ['Υπόγειο', 'Ισόγειο', '1ος', '2ος', '3ος', '4ος', '5ος+', 'Ρετιρέ'],
  BEDS: ['1', '2', '3', '4+'],
  ARCHIVE_SHEET: 'Αρχείο φορμών ζήτησης',
  ARCHIVE_DONE_DAYS: 60,     // περασμένες στο iList πριν από 60 ημέρες → αρχείο
  ARCHIVE_DEAD_DAYS: 30,     // ακυρωμένες / ληγμένες πριν από 30 ημέρες → αρχείο
  LIST_CACHE_SEC: 21600,     // 6 ώρες· κάθε αλλαγή του μεσίτη τη σβήνει
  LIST_MAX: 300
};
const DMC = { ID: 1, HASH: 2, LEAD: 3, AGENT: 4, CODE: 5, DEAL: 6, CREATED: 7, EXPIRES: 8, STATUS: 9, OPENS: 10,
              SUBMITTED: 11, ANSWERS: 12, SUMMARY: 13, ILIST: 14, CTX: 15, UPDATED: 16 };
const DM = { SENT: 'Στάλθηκε', DONE: 'Συμπληρώθηκε', CANCELLED: 'Ακυρώθηκε', EXPIRED: 'Έληξε' };

(function () {
  try {
    ACTIONS.demandStatus = actDemandStatus_;
    ACTIONS.demandCreate = actDemandCreate_;
    ACTIONS.demandCancel = actDemandCancel_;
    ACTIONS.demandIList = actDemandIList_;
    ACTIONS.demandList = actDemandList_;
    // 2.15.1: flag demandForm (προεπιλογή admin). ΕΞΑΙΡΕΣΗ: η ακύρωση μένει πάντα ελεύθερη, ώστε να κλείνει
    // ένα link που έχει ήδη φύγει σε πελάτη ακόμα κι αν κλείσει το flag. Ο πελάτης (demandOpen/Submit) δεν έχει μεσίτη/flag.
    ACTIONS.demandEdit = actDemandEdit_;            // 1.26: ο μεσίτης γράφει / αλλάζει τη ζήτηση
    FLAG_ACTIONS.demandStatus = FLAG_ACTIONS.demandCreate = FLAG_ACTIONS.demandIList = FLAG_ACTIONS.demandList =
      FLAG_ACTIONS.demandEdit = 'demandForm';
    PUBLIC_ACTIONS.demandOpen = actDemandOpen_;
    PUBLIC_ACTIONS.demandSubmit = actDemandSubmit_;
  } catch (e) {
    console.error('Demand.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs (⋮ → Μετακίνηση κάτω).');
  }
})();

// ═══ Φύλλο: μία γραμμή τη φορά ═══════════════════════════════

function dmSheet_() { return ensureSheet_(DEMAND.SHEET, DEMAND.HEADERS); }

/** Αριθμοί γραμμών όπου η στήλη col είναι ακριβώς value. Χωρίς να διαβαστεί το φύλλο. */
function dmFind_(sh, col, value) {
  const last = sh.getLastRow();
  if (last < 2 || !value) return [];
  return sh.getRange(2, col, last - 1, 1).createTextFinder(String(value))
    .matchEntireCell(true).matchCase(true).findAll().map(c => c.getRow());
}

function dmRead_(sh, row) {
  return { row: row, v: sh.getRange(row, 1, 1, DEMAND.HEADERS.length).getValues()[0] };
}

/**
 * Μία εγγραφή = ένα setValues (όλη η γραμμή).
 * ⚠ ΜΟΝΟ μέσα σε κλείδωμα και με ανάγνωση της γραμμής ΜΕΣΑ στο ίδιο κλείδωμα: γράφει και τις στήλες
 * που δεν άλλαξαν, άρα με παλιά ανάγνωση θα έσβηνε μια ταυτόχρονη υποβολή. Αλλού χρησιμοποίησε το dmSet_.
 */
function dmWrite_(sh, r, changes) {
  Object.keys(changes).forEach(col => { r.v[Number(col) - 1] = changes[col]; });
  r.v[DMC.UPDATED - 1] = new Date();
  sh.getRange(r.row, 1, 1, DEMAND.HEADERS.length).setValues([safeRow_(r.v)]);
  dmDropCache_(r.v[DMC.AGENT - 1]);
}

/** Γράφει ΜΟΝΟ τα κελιά που αλλάζουν (+ «Ενημέρωση»): δεν πατά ποτέ τις υπόλοιπες στήλες (όπως το sfSet_). */
function dmSet_(sh, r, changes) {
  Object.keys(changes).forEach(col => {
    r.v[Number(col) - 1] = changes[col];
    sh.getRange(r.row, Number(col)).setValue(safe_(changes[col]));
  });
  r.v[DMC.UPDATED - 1] = new Date();
  sh.getRange(r.row, DMC.UPDATED).setValue(r.v[DMC.UPDATED - 1]);
  dmDropCache_(r.v[DMC.AGENT - 1]);   // η οθόνη «Ζητήσεις» (1.25) να μη δείχνει παλιά κατάσταση
}

/** Τρέχει το fn μέσα στο γενικό κλείδωμα. Ό,τι διαβάζεται και αποφασίζεται, γίνεται ΜΕΣΑ εδώ. */
function dmLocked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function dmGet_(r, col) { return r.v[col - 1]; }

function dmLatest_(sh, leadId) {
  const rows = dmFind_(sh, DMC.LEAD, leadId);
  return rows.length ? dmRead_(sh, Math.max.apply(null, rows)) : null;
}

function dmByToken_(sh, token) {
  const t = String(token || '');
  if (!/^[0-9a-f]{48}$/.test(t)) return null;
  const rows = dmFind_(sh, DMC.HASH, sha256_(t));
  return rows.length ? dmRead_(sh, rows[0]) : null;
}

function dmStatus_(r) {
  const st = String(dmGet_(r, DMC.STATUS) || '');
  if (st === DM.SENT && ts_(dmGet_(r, DMC.EXPIRES)) < Date.now()) return DM.EXPIRED;
  return st;
}

function dmJson_(r, col) {
  try { return JSON.parse(String(dmGet_(r, col) || '{}')) || {}; } catch (e) { return {}; }
}

/** Τι βλέπει ο μεσίτης. */
function dmView_(r) {
  if (!r) return { status: '' };
  const il = dmGet_(r, DMC.ILIST);
  return {
    id: String(dmGet_(r, DMC.ID) || ''),
    lead: String(dmGet_(r, DMC.LEAD) || ''),
    status: dmStatus_(r),
    created: stamp_(dmGet_(r, DMC.CREATED)),
    expires: stamp_(dmGet_(r, DMC.EXPIRES)),
    submitted: stamp_(dmGet_(r, DMC.SUBMITTED)),
    opens: Number(dmGet_(r, DMC.OPENS)) || 0,
    deal: String(dmGet_(r, DMC.DEAL) || ''),
    answers: dmStatus_(r) === DM.DONE ? dmJson_(r, DMC.ANSWERS) : null,
    lines: dmStatus_(r) === DM.DONE ? dmLines_(dmJson_(r, DMC.ANSWERS), String(dmGet_(r, DMC.DEAL) || '')) : [],
    summary: String(dmGet_(r, DMC.SUMMARY) || ''),
    ilist: il ? stamp_(il) : '',
    edited: dmJson_(r, DMC.CTX).edited || '',          // 1.26: πότε την άλλαξε ο μεσίτης
    self: !!dmJson_(r, DMC.CTX).self                   // 1.26: τη γράφει ο μεσίτης, χωρίς φόρμα στον πελάτη
  };
}

// ═══ Κείμενα κριτηρίων ═══════════════════════════════════════

function dmRange_(a, b, unit) {
  const f = n => fmtNum_(n, 0) + (unit ? ' ' + unit : '');
  if (a && b) return fmtNum_(a, 0) + ' – ' + f(b);
  if (a) return 'από ' + f(a);
  if (b) return 'έως ' + f(b);
  return '';
}
function dmYears_(a, b) {
  if (a && b) return a + ' – ' + b;
  if (a) return 'από ' + a;
  if (b) return 'έως ' + b;
  return '';
}

/** [[ετικέτα, τιμή], …] μόνο για ό,τι συμπλήρωσε ο πελάτης. */
function dmLines_(c, deal) {
  const rent = deal === 'Ενοικίαση';
  const out = [];
  const add = (k, v) => { if (v) out.push([k, v]); };
  add(rent ? 'Ενοίκιο' : 'Τιμή', dmRange_(c.priceMin, c.priceMax, '€'));
  add('Τετραγωνικά', dmRange_(c.sqmMin, c.sqmMax, 'τ.μ.'));
  add('Τιμή / τ.μ.', dmRange_(c.ppsMin, c.ppsMax, '€/τ.μ.'));
  add('Όροφος', (c.floors || []).join(', '));
  add('Υπνοδωμάτια', c.beds ? (c.beds === '4+' ? '4 και πάνω' : 'τουλάχιστον ' + c.beds) : '');
  add('Περιοχές', c.areas);
  add('Έτος κατασκευής', dmYears_(c.yearMin, c.yearMax));
  add('Πάρκινγκ', c.parking ? 'Ναι' : '');
  add('Επιπλωμένο', c.furnished ? 'Ναι' : '');
  add('Σημειώσεις', c.notes);
  return out;
}

/** Μία γραμμή για ειδοποίηση / iList: «Αγορά · 150.000 – 250.000 € · 70 – 100 τ.μ. · …». */
function dmSummary_(c, deal) {
  const parts = [deal === 'Ενοικίαση' ? 'Ενοικίαση' : 'Αγορά'];
  dmLines_(c, deal).forEach(([k, v]) => {
    if (k === 'Σημειώσεις') return;
    if (k === 'Πάρκινγκ' || k === 'Επιπλωμένο') parts.push(k);
    else if (k === 'Τιμή' || k === 'Ενοίκιο' || k === 'Τετραγωνικά' || k === 'Τιμή / τ.μ.') parts.push(v);
    else parts.push(k + ': ' + v);
  });
  return parts.join(' · ');
}

// ═══ Μεσίτης ═════════════════════════════════════════════════

function dmDeal_(l) { return /ενοικ|μισθ/i.test(String(l.deal || '')) ? 'Ενοικίαση' : 'Αγορά'; }

function actDemandStatus_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const view = dmView_(dmLatest_(dmSheet_(), l.id));
  if (!view.deal) view.deal = dmDeal_(l);
  return view;
}

/** Νέο link. Το προηγούμενο ανοιχτό link της ίδιας κλήσης ακυρώνεται. */
function actDemandCreate_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const deal = d.deal === 'Ενοικίαση' || d.deal === 'Αγορά' ? d.deal : dmDeal_(l);
  const token = randomHex_(48);
  const now = new Date();
  const expires = new Date(now.getTime() + DEMAND.EXPIRE_DAYS * 86400000);
  const first = String(l.name || '').trim().split(/\s+/)[0] || '';
  const ctx = { first: first.slice(0, 40), code: l.code || '', area: String(l.location || '').slice(0, 80) };
  const sh = dmSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    dmFind_(sh, DMC.LEAD, l.id).forEach(row => {
      const r = dmRead_(sh, row);
      if (dmStatus_(r) === DM.SENT) dmWrite_(sh, r, { [DMC.STATUS]: DM.CANCELLED });
    });
    sh.appendRow(safeRow_(['DM-' + randomHex_(10), sha256_(token), l.id, agent.name, l.code || '', deal,
                           now, expires, DM.SENT, 0, '', '', '', '', JSON.stringify(ctx), now]));
    dmDropCache_(agent.name);
  } finally {
    lock.releaseLock();
  }
  log_('Φόρμα ζήτησης: link', agent.name, 'κλήση ' + l.id);

  const url = CONFIG.APP_URL + 'demand.html#' + token;
  const me = agent.smsName || agent.name;
  const what = deal === 'Ενοικίαση' ? 'το ακίνητο που ψάχνετε να νοικιάσετε' : 'το ακίνητο που ψάχνετε';
  const sms = 'Καλησπέρα' + (first ? ' ' + first : '') + ', για να σας στέλνω μόνο ό,τι σας ταιριάζει, ' +
              'πείτε μου σε 1 λεπτό τι ψάχνετε: ' + url + ' ' + me;
  return {
    form: dmView_(dmLatest_(sh, l.id)),
    url: url,
    sms: sms,
    wa: phoneIntl_(l.phone) ? String(phoneIntl_(l.phone)).replace(/^\+/, '') : '',
    email: { to: l.email || '', subject: 'Τι ακίνητο ψάχνετε; · ' + CONFIG.OFFICE.name,
             body: 'Καλησπέρα' + (l.name ? ' ' + l.name : '') + ',\n\nγια να σας προτείνω μόνο ό,τι σας ταιριάζει, ' +
                   'συμπληρώστε σε ένα λεπτό ' + what + ':\n' + url +
                   '\n\nΤο link ισχύει έως ' + stamp_(expires) + '.\n\n' + me + '\n' + CONFIG.OFFICE.name }
  };
}

function actDemandCancel_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const sh = dmSheet_();
  dmLocked_(() => {
    const r = dmLatest_(sh, l.id);                    // φρέσκια ανάγνωση ΜΕΣΑ στο κλείδωμα
    if (r && dmStatus_(r) === DM.SENT) dmSet_(sh, r, { [DMC.STATUS]: DM.CANCELLED });
  });
  return dmView_(dmLatest_(sh, l.id));
}

/** «Η ζήτηση περάστηκε στο iList» (on) ή αναίρεση (on = false).
 *  Από την κλήση: { id }. Από την οθόνη «Ζητήσεις»: { dm } (δουλεύει και για κλήσεις
 *  παλαιότερες από 2 μήνες· ο έλεγχος ιδιοκτησίας γίνεται στη στήλη Μεσίτης). */
function actDemandIList_(agent, d) {
  const sh = dmSheet_();
  return dmLocked_(() => {                          // 2.15.1: φρέσκια ανάγνωση ΜΕΣΑ στο κλείδωμα, γράφει μόνο το κελί του
    let r;
    if (d.dm) {
      const rows = dmFind_(sh, DMC.ID, String(d.dm));
      r = rows.length ? dmRead_(sh, rows[0]) : null;
      if (!r || norm_(dmGet_(r, DMC.AGENT)) !== norm_(agent.name)) throw new Error('Δεν βρέθηκε η ζήτηση.');
    } else {
      r = dmLatest_(sh, findMyLead_(agent, d.id).id);
    }
    if (!r || dmStatus_(r) !== DM.DONE) throw new Error('Ο πελάτης δεν έχει συμπληρώσει ακόμα τη φόρμα.');
    dmSet_(sh, r, { [DMC.ILIST]: d.on === false ? '' : new Date() });
    return dmView_(r);
  });
}

// ═══ 1.26 · Ο μεσίτης γράφει / αλλάζει τη ζήτηση ════════════
// { id | dm, deal, c }. Ίδιος έλεγχος πεδίων με τη φόρμα του πελάτη (dmClean_).
//   · συμπληρωμένη → αλλάζουν τα κριτήρια· αν είχε περαστεί στο iList, το σημάδι φεύγει
//     (θέλει ξανά πέρασμα με τα νέα κριτήρια)
//   · σε αναμονή → τη συμπληρώνει ο μεσίτης· το link του πελάτη κλείνει («έχει ήδη σταλεί»)
//   · καμία / ακυρωμένη / ληγμένη → νέα γραμμή χωρίς link (self)
function actDemandEdit_(agent, d) {
  const clean = dmClean_(d.c);                       // λάθος πεδίο = γρήγορη απάντηση, πριν το κλείδωμα
  const sh = dmSheet_();
  const lead = d.dm ? null : findMyLead_(agent, d.id);
  const res = dmLocked_(() => {
    let r = null;
    if (d.dm) {
      const rows = dmFind_(sh, DMC.ID, String(d.dm));
      r = rows.length ? dmRead_(sh, rows[0]) : null;
      if (!r || norm_(dmGet_(r, DMC.AGENT)) !== norm_(agent.name)) throw new Error('Δεν βρέθηκε η ζήτηση.');
    } else {
      r = dmLatest_(sh, lead.id);
    }
    const st = r ? dmStatus_(r) : '';
    const now = new Date();
    const deal = d.deal === 'Ενοικίαση' || d.deal === 'Αγορά' ? d.deal
      : (r && dmGet_(r, DMC.DEAL)) || (lead ? dmDeal_(lead) : 'Αγορά');
    const summary = dmSummary_(clean, deal);
    if (r && (st === DM.DONE || st === DM.SENT)) {
      const ctx = dmJson_(r, DMC.CTX);
      const hadIList = !!dmGet_(r, DMC.ILIST);
      ctx.edited = stamp_(now);
      if (st === DM.SENT) ctx.self = true;
      const ch = { [DMC.STATUS]: DM.DONE, [DMC.DEAL]: deal, [DMC.ANSWERS]: JSON.stringify(clean),
                   [DMC.SUMMARY]: summary, [DMC.CTX]: JSON.stringify(ctx) };
      if (!dmGet_(r, DMC.SUBMITTED)) ch[DMC.SUBMITTED] = now;
      if (hadIList) ch[DMC.ILIST] = '';
      dmSet_(sh, r, ch);
      return { r: r, reset: hadIList };
    }
    if (!lead) throw new Error('Η ζήτηση έχει κλείσει. Άνοιξε τον πελάτη για νέα.');
    const first = String(lead.name || '').trim().split(/\s+/)[0] || '';
    const ctx = { first: first.slice(0, 40), code: lead.code || '', area: String(lead.location || '').slice(0, 80),
                  self: true, edited: stamp_(now) };
    sh.appendRow(safeRow_(['DM-' + randomHex_(10), '', lead.id, agent.name, lead.code || '', deal, now, '', DM.DONE, 0,
                           now, JSON.stringify(clean), summary, '', JSON.stringify(ctx), now]));
    dmDropCache_(agent.name);
    return { r: dmLatest_(sh, lead.id), reset: false };
  });
  log_('Φόρμα ζήτησης: αλλαγή από μεσίτη', agent.name, 'κλήση ' + String(dmGet_(res.r, DMC.LEAD)));
  const view = dmView_(res.r);
  view.reset = res.reset;
  return view;
}

/** 1.26 · Για το bootstrap: κλήση → η πιο πρόσφατη ζήτηση (από τη λίστα σε cache, χωρίς νέα ανάγνωση).
 *  Μόνο ό,τι χρειάζεται η κάρτα και το ιστορικό, χωρίς απαντήσεις. */
function dmLeadMap_(agent) {
  if (!featureFlags_(agent).demandForm) return {};
  const out = {};
  try {
    actDemandList_(agent).items.forEach(x => {
      const cur = out[x.lead];
      if (cur && (cur.createdTs || 0) >= (x.createdTs || 0)) return;
      out[x.lead] = { id: x.id, status: x.status, created: x.created, submitted: x.submitted, ilist: x.ilist,
                      opens: x.opens, edited: x.edited, self: x.self, summary: x.summary, createdTs: x.createdTs || 0 };
    });
  } catch (e) { console.error('dmLeadMap_: ' + e.message); }
  return out;
}

// ═══ 1.25 · Οθόνη «Ζητήσεις» ════════════════════════════════
// Οι γραμμές του μεσίτη βρίσκονται με TextFinder στη στήλη Μεσίτης και διαβάζεται μόνο
// το κομμάτι ανάμεσα στην πρώτη και την τελευταία. Το αποτέλεσμα μένει σε cache 6 ωρών,
// που σβήνει σε κάθε αλλαγή (νέο link, άνοιγμα, υποβολή, iList, ακύρωση).

function dmCacheKey_(name) { return 'dm:list:' + sha256_(norm_(name || '')).slice(0, 24); }
function dmDropCache_(name) {
  try { CacheService.getScriptCache().remove(dmCacheKey_(name)); } catch (e) { /* τίποτα */ }
}

/** Το στοιχείο της λίστας: ό,τι χρειάζεται η οθόνη και το παράθυρο, χωρίς τηλέφωνο / email. */
function dmItem_(v) {
  const r = { v: v };
  const ctx = dmJson_(r, DMC.CTX);
  const view = dmView_(r);
  view.first = ctx.first || '';
  view.code = String(dmGet_(r, DMC.CODE) || '');
  view.submittedTs = ts_(dmGet_(r, DMC.SUBMITTED)) || 0;
  view.createdTs = ts_(dmGet_(r, DMC.CREATED)) || 0;
  return view;
}

function actDemandList_(agent) {
  const cache = CacheService.getScriptCache();
  const key = dmCacheKey_(agent.name);
  const hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* ξαναχτίζεται */ } }

  const sh = dmSheet_();
  const rows = dmFind_(sh, DMC.AGENT, agent.name);
  let items = [];
  if (rows.length) {
    const lo = Math.min.apply(null, rows), hi = Math.max.apply(null, rows);
    const block = sh.getRange(lo, 1, hi - lo + 1, DEMAND.HEADERS.length).getValues();
    const want = {};
    rows.forEach(n => { want[n] = 1; });
    block.forEach((v, i) => { if (want[lo + i]) items.push(dmItem_(v)); });
  }
  items = items.filter(x => x.status !== DM.CANCELLED)
    .sort((a, b) => (b.submittedTs || b.createdTs) - (a.submittedTs || a.createdTs))
    .slice(0, DEMAND.LIST_MAX);
  const out = {
    items: items,
    counts: {
      toPass: items.filter(x => x.status === DM.DONE && !x.ilist).length,
      passed: items.filter(x => x.status === DM.DONE && x.ilist).length,
      waiting: items.filter(x => x.status === DM.SENT).length,
      received: items.filter(x => x.status === DM.DONE).length
    },
    at: stamp_(new Date())
  };
  try { cache.put(key, JSON.stringify(out), DEMAND.LIST_CACHE_SEC); } catch (e) { /* πάνω από 100 KB: χωρίς cache */ }
  return out;
}

/** ▶ Κάθε νύχτα (setup125): ό,τι τελείωσε φεύγει στο «Αρχείο φορμών ζήτησης».
 *  Τίποτα δεν σβήνεται· απλώς βγαίνει από το φύλλο που ψάχνει η εφαρμογή. */
/** 2.18 · Trigger: μετρά τη διάρκεια (Perf.js) και τρέχει το dmArchiveRun_. */
function dmArchive() {
  return perf_('t:dmArchive', () => dmArchiveRun_());
}

function dmArchiveRun_() {
  const sh = dmSheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = Date.now(), day = 86400000;
    const all = sh.getRange(2, 1, last - 1, DEMAND.HEADERS.length).getValues();
    const keep = [], move = [], touched = {};
    all.forEach(v => {
      const r = { v: v }, st = dmStatus_(r);
      const old = (col, days) => { const t = ts_(dmGet_(r, col)); return t && now - t > days * day; };
      const go = (st === DM.DONE && dmGet_(r, DMC.ILIST) && old(DMC.ILIST, DEMAND.ARCHIVE_DONE_DAYS)) ||
                 ((st === DM.CANCELLED || st === DM.EXPIRED) && old(DMC.UPDATED, DEMAND.ARCHIVE_DEAD_DAYS));
      (go ? move : keep).push(v);
      if (go) touched[v[DMC.AGENT - 1]] = 1;
    });
    if (!move.length) return 0;
    const ar = ensureSheet_(DEMAND.ARCHIVE_SHEET, DEMAND.HEADERS);
    ar.getRange(ar.getLastRow() + 1, 1, move.length, DEMAND.HEADERS.length).setValues(move.map(safeRow_));
    sh.getRange(2, 1, last - 1, DEMAND.HEADERS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, DEMAND.HEADERS.length).setValues(keep);
    Object.keys(touched).forEach(dmDropCache_);
    log_('Φόρμες ζήτησης: αρχείο', 'σύστημα', move.length + ' γραμμές');
    return move.length;
  } finally {
    lock.releaseLock();
  }
}

/** ▶ Μία φορά μετά την 1.25: νυχτερινή αρχειοθέτηση στις 03:00. */
function setup125() {
  dmSheet_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dmArchive').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dmArchive').timeBased().everyDays(1).atHour(3).create();
  console.log('1.25 έτοιμη: οθόνη «Ζητήσεις» και νυχτερινή αρχειοθέτηση (03:00).');
}

// ═══ Πελάτης (χωρίς σύνδεση, μόνο με το κλειδί του link) ═════

function dmOpenRow_(sh, token) {
  sfGuard_(token);
  const r = dmByToken_(sh, token);
  if (!r) { sfBad_(token); throw err_('Το link δεν είναι έγκυρο. Ζητήστε νέο από τον μεσίτη σας.', 'closed'); }
  const st = dmStatus_(r);
  if (st === DM.DONE) throw err_('Η φόρμα έχει ήδη σταλεί. Ευχαριστούμε!', 'done');
  if (st === DM.EXPIRED) throw err_('Το link έληξε. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  if (st !== DM.SENT) throw err_('Το link δεν ισχύει πια. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  if ((Number(dmGet_(r, DMC.OPENS)) || 0) >= DEMAND.MAX_OPENS) {
    throw err_('Το link άνοιξε πάρα πολλές φορές και κλείδωσε. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  }
  return r;
}

/** Ο πελάτης ανοίγει τη φόρμα: μόνο όνομα μεσίτη / γραφείου και αν είναι αγορά ή ενοικίαση. */
function actDemandOpen_(d) {
  const sh = dmSheet_();
  dmOpenRow_(sh, d.f);                      // γρήγορος έλεγχος ΕΞΩ από το κλείδωμα: άκυρα links δεν το απασχολούν
  const r = dmLocked_(() => {
    const row = dmOpenRow_(sh, d.f);        // ξανά, μέσα στο κλείδωμα: μπορεί να μπήκε υποβολή στο μεταξύ
    dmSet_(sh, row, { [DMC.OPENS]: (Number(dmGet_(row, DMC.OPENS)) || 0) + 1 });
    return row;
  });
  const ctx = dmJson_(r, DMC.CTX);
  let agentName = String(dmGet_(r, DMC.AGENT) || '');
  try { const a = sfAgent_(agentName); agentName = a.smsName || a.name; } catch (e) { /* όνομα από το φύλλο */ }
  return {
    office: CONFIG.OFFICE.name,
    agent: agentName,
    first: ctx.first || '',
    deal: String(dmGet_(r, DMC.DEAL) || 'Αγορά'),
    area: ctx.area || '',
    floors: DEMAND.FLOORS,
    beds: DEMAND.BEDS,
    expires: stamp_(dmGet_(r, DMC.EXPIRES))
  };
}

/** Έλεγχος. Σφάλμα = ποιο πεδίο, ποτέ η τιμή. Όλα προαιρετικά, αλλά όχι εντελώς κενή φόρμα. */
function dmClean_(c) {
  c = c || {};
  const n = k => { const v = parseNum_(c[k]); return v > 0 && v < 1e9 ? Math.round(v) : 0; };
  const yr = k => { const v = Math.round(parseNum_(c[k])); return v ? v : 0; };
  const out = {
    priceMin: n('priceMin'), priceMax: n('priceMax'),
    sqmMin: n('sqmMin'), sqmMax: n('sqmMax'),
    ppsMin: n('ppsMin'), ppsMax: n('ppsMax'),
    yearMin: yr('yearMin'), yearMax: yr('yearMax'),
    floors: (Array.isArray(c.floors) ? c.floors : []).map(String).filter(f => DEMAND.FLOORS.indexOf(f) !== -1)
      .filter((f, i, a) => a.indexOf(f) === i),
    beds: DEMAND.BEDS.indexOf(String(c.beds || '')) !== -1 ? String(c.beds) : '',
    areas: scrubIds_(sfText_(c.areas, DEMAND.AREAS_MAX)),
    parking: c.parking === true,
    furnished: c.furnished === true,
    notes: ''
  };
  const raw = String(c.notes == null ? '' : c.notes).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\{\{|\}\}/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, DEMAND.NOTES_MAX);
  out.notes = scrubIds_(raw);

  const pair = (a, b, field, msg) => { if (out[a] && out[b] && out[a] > out[b]) throw sfFail_(field, msg); };
  pair('priceMin', 'priceMax', 'price', 'Το «από» πρέπει να είναι μικρότερο από το «έως».');
  pair('sqmMin', 'sqmMax', 'sqm', 'Το «από» πρέπει να είναι μικρότερο από το «έως».');
  pair('ppsMin', 'ppsMax', 'pps', 'Το «από» πρέπει να είναι μικρότερο από το «έως».');
  const thisYear = new Date().getFullYear();
  ['yearMin', 'yearMax'].forEach(k => {
    if (out[k] && (out[k] < 1800 || out[k] > thisYear + 5)) throw sfFail_('year', 'Γράψτε έτος με 4 ψηφία, π.χ. 1990.');
  });
  pair('yearMin', 'yearMax', 'year', 'Το «από» πρέπει να είναι μικρότερο από το «έως».');

  const filled = out.priceMin || out.priceMax || out.sqmMin || out.sqmMax || out.ppsMin || out.ppsMax ||
    out.yearMin || out.yearMax || out.floors.length || out.beds || out.areas || out.parking || out.furnished || out.notes;
  if (!filled) throw sfFail_('areas', 'Συμπληρώστε τουλάχιστον ένα πεδίο, π.χ. τις περιοχές που σας ενδιαφέρουν.');
  return out;
}

/** Ο πελάτης στέλνει: { f, c }. Λάθος σε πεδίο δεν καίει το link. */
function actDemandSubmit_(d) {
  sfGuard_(d.f);
  const tries = CacheService.getScriptCache();
  const key = 'dm:try:' + sha256_(String(d.f || '')).slice(0, 20);
  const n = Number(tries.get(key) || 0);
  if (n >= 15) throw new Error('Πολλές προσπάθειες. Δοκιμάστε ξανά σε μία ώρα.');
  tries.put(key, String(n + 1), 3600);

  const clean = dmClean_(d.c);                // πριν το κλείδωμα: λάθος πεδίο = γρήγορη απάντηση
  const sh = dmSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let r, deal, summary;
  try {
    r = dmOpenRow_(sh, d.f);                  // ξανά, μέσα στο κλείδωμα: όχι διπλή υποβολή
    deal = String(dmGet_(r, DMC.DEAL) || 'Αγορά');
    summary = dmSummary_(clean, deal);
    dmWrite_(sh, r, { [DMC.STATUS]: DM.DONE, [DMC.SUBMITTED]: new Date(),
                      [DMC.ANSWERS]: JSON.stringify(clean), [DMC.SUMMARY]: summary });
  } finally {
    lock.releaseLock();
  }
  const leadId = String(dmGet_(r, DMC.LEAD));
  const ctx = dmJson_(r, DMC.CTX);
  log_('Φόρμα ζήτησης: συμπληρώθηκε', String(dmGet_(r, DMC.AGENT)), 'κλήση ' + leadId);

  try {
    const agent = sfAgent_(dmGet_(r, DMC.AGENT));
    if (!agent.active) { dmNotifyAdmins_(agent, leadId); return { ok: true }; }   // ο μεσίτης έφυγε: ούτε push ούτε email
    const title = 'Νέα ζήτηση' + (ctx.first ? ' · ' + ctx.first : '');
    const sent = pushToAgent_(agent, { type: 'demand', id: leadId, tag: 'dm-' + leadId,
      url: '?lead=' + encodeURIComponent(leadId), title: title, body: summary.slice(0, 180) });
    if (!sent && agent.email) {
      MailApp.sendEmail({ to: agent.email, subject: title, name: 'KW App',
        body: summary + (clean.notes ? '\n\nΣημειώσεις: ' + clean.notes : '') +
              '\n\nΆνοιξε την κλήση στην εφαρμογή για «Αντιγραφή για το iList».' });
    }
  } catch (e) { console.error('Φόρμα ζήτησης: ειδοποίηση μεσίτη (' + e.message + ')'); }

  return { ok: true };
}

/**
 * Η φόρμα στάλθηκε για μεσίτη που δεν είναι πια ενεργός. Ειδοποιούνται οι ενεργοί Admin, ΧΩΡΙΣ
 * τα κριτήρια ή το όνομα του πελάτη (αυτά μένουν στο φύλλο και στην κλήση): μόνο «ποιος μεσίτης, ποια κλήση».
 */
function dmNotifyAdmins_(agent, leadId) {
  const title = 'Ζήτηση για ανενεργό μεσίτη';
  const body = 'Ο πελάτης συμπλήρωσε τη φόρμα ζήτησης για την κλήση ' + leadId + ' του ανενεργού μεσίτη ' + agent.name +
               '. Χρειάζεται να την αναλάβει κάποιος άλλος.';
  readAgents_().filter(a => a.active && isAdmin_(a)).forEach(admin => {
    const sent = pushToAgent_(admin, { type: 'demand', id: leadId, tag: 'dm-admin-' + leadId, title: title, body: body });
    if (!sent && admin.email) MailApp.sendEmail({ to: admin.email, subject: title, name: 'KW App', body: body });
  });
}

/** ▶ Μία φορά μετά την 1.24: φτιάχνει το φύλλο και ελέγχει ότι οι ενέργειες γράφτηκαν. */
function setup124() {
  dmSheet_();
  const ok = typeof ACTIONS !== 'undefined' && ACTIONS.demandCreate === actDemandCreate_ &&
             PUBLIC_ACTIONS.demandSubmit === actDemandSubmit_;
  console.log(ok ? '1.24 έτοιμη: φύλλο «' + DEMAND.SHEET + '» και ενέργειες φόρμας ζήτησης.'
                 : '⚠ Το Demand.gs πρέπει να είναι ΚΑΤΩ από το Code.gs.');
}
