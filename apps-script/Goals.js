/**
 * 2.9 · Coach, στόχοι, πίνακας προόδου και οικονομικά
 *
 *  • Ρόλος «Coach» (στήλη «Ρόλος» του Agents): βλέπει όλους τους μεσίτες, τις μετρήσεις
 *    και τα οικονομικά τους, και ορίζει στόχους. Δεν έχει δικές του κλήσεις ή ακίνητα.
 *  • Στόχοι ανά μεσίτη και δείκτη της εβδομαδιαίας φόρμας: εβδομάδα · μήνας · έτος,
 *    και ετήσιος στόχος τζίρου. Φύλλο «Στόχοι» (το γράφει μόνο η εφαρμογή).
 *  • Οικονομικά: διαβάζει το αρχείο κλεισιμάτων του γραφείου (μόνο ανάγνωση).
 *    Τζίρος = αμοιβή ιδιοκτήτη + αμοιβή αγοραστή/μισθωτή. Cap 50.000 € ανά μεσίτη,
 *    με ετήσιο κύκλο που ξεκινά στην «Έναρξη cap» του καθενός (στήλη στο Agents).
 *
 * Flags (FEATURES): dashboard = ο πίνακας προόδου του μεσίτη · finance = τα οικονομικά του.
 * Ο Coach τα βλέπει πάντα (ο έλεγχος είναι ο ρόλος του).
 *
 * Ιδιότητες σεναρίου (όλες προαιρετικές):
 *   FINANCE_SPREADSHEET_ID  το αρχείο κλεισιμάτων (ID ή link). Κενό = το φύλλο της εφαρμογής
 *   FINANCE_SHEET           όνομα καρτέλας. Κενό = «Κλεισίματα (τεστ)»
 *   CAP_AMOUNT              κενό = 50000
 *
 * Κόστος: 1 ανάγνωση της καρτέλας κλεισιμάτων ανά 10' για ΟΛΟΥΣ τους μεσίτες (cache),
 * 1 ανάγνωση του μικρού φύλλου «Στόχοι» ανά αίτημα. Καμία νέα εγγραφή ανά άνοιγμα.
 */

const GOAL = {
  SHEET: 'Στόχοι',
  HEADERS: ['Email μεσίτη', 'Μεσίτης', 'Δείκτης', 'Εβδομάδα', 'Μήνας', 'Έτος', 'Ενημέρωση', 'Από'],
  REV: 'rev',                    // ετήσιος στόχος τζίρου (μόνο «Έτος»)
  MAX: 10000000
};

const FIN = {
  TEST_SHEET: 'Κλεισίματα (τεστ)',
  CAP: 50000,
  CACHE_KEY: 'fin:rows:1',
  BOOT_KEY: 'coach:boot:1',
  CACHE_MIN: 10,
  DEALS_MAX: 80
};

(function () {
  try {
    ACTIONS.dash = actDash_;
    COACH_ACTIONS.coachBoot = actCoachBoot_;
    COACH_ACTIONS.coachDash = actCoachDash_;
    COACH_ACTIONS.coachGoalSet = actCoachGoalSet_;
  } catch (e) {
    console.error('Goals.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

// ── Καθαρή λογική (χωρίς Google· ελέγχεται στα tests) ─────────────────

function gIso_(d) {
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function gRound_(n) { return Math.round(n * 100) / 100; }

/** «Έναρξη cap»: Date, «01/09», «1/9/2024» ή «2024-09-01» → { m (0-11), d }. Κενό/άκυρο = 1 Ιανουαρίου. */
function capStartMD_(val) {
  if (val instanceof Date && !isNaN(val)) return { m: val.getMonth(), d: val.getDate() };
  const s = String(val == null ? '' : val).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return { m: +m[2] - 1, d: +m[3] };
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return { m: +m[2] - 1, d: +m[1] };
  return { m: 0, d: 1 };
}

/** Ο τρέχων κύκλος του cap: από την τελευταία επέτειο μέχρι (όχι και) την επόμενη. */
function capPeriod_(val, now) {
  const md = capStartMD_(val);
  let y = now.getFullYear();
  let start = new Date(y, md.m, md.d);
  if (start > now) start = new Date(--y, md.m, md.d);
  return { start: start, next: new Date(y + 1, md.m, md.d) };
}

/** «1.234,50 €», «1234.5», 1234.5 → αριθμός. Άκυρο ή αρνητικό → 0. */
function finNum_(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
  let s = String(v == null ? '' : v).replace(/[^\d,.]/g, '');
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isFinite(n) && n > 0 ? n : 0;
}

function finTs_(v) {
  if (v instanceof Date && !isNaN(v)) return v.getTime();
  const m = String(v == null ? '' : v).match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!m || +m[2] > 12) return 0;
  return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]).getTime();
}

/**
 * Τιμές καρτέλας → [[ts, μεσίτης (norm), κωδικός, αμοιβή ιδιοκτήτη, αμοιβή αγοραστή/μισθωτή]].
 * Οι στήλες βρίσκονται από την επικεφαλίδα (μία από τις 5 πρώτες γραμμές), όχι από τη θέση.
 * Το «Σύνολο» της καρτέλας δεν διαβάζεται: υπολογίζεται εδώ (ιδιοκτήτης + αγοραστής/μισθωτής).
 */
function finParse_(values) {
  const want = {
    date:  t => t.indexOf('ημερομ') === 0 || t === 'date',
    agent: t => /^(μεσιτ|agent|συνεργατ)/.test(t),
    code:  t => t.indexOf('κωδικ') !== -1,
    owner: t => t.indexOf('ιδιοκτ') !== -1 || t.indexOf('πωλητ') !== -1,
    buyer: t => t.indexOf('αγοραστ') !== -1 || t.indexOf('μισθωτ') !== -1
  };
  let head = -1, cols = null;
  for (let r = 0; r < Math.min(values.length, 5) && head === -1; r++) {
    const h = values[r].map(norm_), c = {};
    Object.keys(want).forEach(k => { c[k] = h.findIndex(want[k]); });
    if (c.agent !== -1 && c.owner !== -1 && c.buyer !== -1) { head = r; cols = c; }
  }
  if (head === -1) return { ok: false, rows: [] };
  const rows = [];
  for (let r = head + 1; r < values.length; r++) {
    const v = values[r];
    const who = norm_(v[cols.agent]);
    const owner = finNum_(v[cols.owner]), buyer = finNum_(v[cols.buyer]);
    const ts = cols.date === -1 ? 0 : finTs_(v[cols.date]);
    if (!who || !ts || !(owner + buyer)) continue;
    rows.push([ts, who, cols.code === -1 ? '' : String(v[cols.code] == null ? '' : v[cols.code]).trim().slice(0, 40),
               gRound_(owner), gRound_(buyer)]);
  }
  return { ok: true, rows: rows };
}

/**
 * Τα οικονομικά ενός μεσίτη. keys: το όνομα (norm) και τα email του. rows: από finParse_.
 * year = ημερολογιακό έτος (για τον στόχο τζίρου) · cap = ο δικός του κύκλος.
 */
function finFor_(keys, rows, capStart, capAmount, now) {
  const mine = rows.filter(r => keys.indexOf(r[1]) !== -1).sort((a, b) => b[0] - a[0]);
  const per = capPeriod_(capStart, now);
  const y0 = new Date(now.getFullYear(), 0, 1).getTime(), y1 = new Date(now.getFullYear() + 1, 0, 1).getTime();
  const months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let capTotal = 0, yearTotal = 0, owner = 0, buyer = 0, yearDeals = 0;
  const from = Math.min(per.start.getTime(), y0), deals = [];
  mine.forEach(r => {
    const total = r[3] + r[4];
    const inCap = r[0] >= per.start.getTime() && r[0] < per.next.getTime();
    const inYear = r[0] >= y0 && r[0] < y1;
    if (inCap) capTotal += total;
    if (inYear) { yearTotal += total; owner += r[3]; buyer += r[4]; yearDeals++; months[new Date(r[0]).getMonth()] += total; }
    if (r[0] >= from && deals.length < FIN.DEALS_MAX) {
      deals.push({ date: gIso_(new Date(r[0])), code: r[2], owner: r[3], buyer: r[4], total: gRound_(total), cap: inCap, year: inYear });
    }
  });
  const last = new Date(per.next.getTime()); last.setDate(last.getDate() - 1);
  return {
    year: now.getFullYear(), yearTotal: gRound_(yearTotal), yearDeals: yearDeals,
    owner: gRound_(owner), buyer: gRound_(buyer), months: months.map(gRound_),
    cap: capAmount, capTotal: gRound_(capTotal), capLeft: gRound_(Math.max(0, capAmount - capTotal)),
    capped: capTotal >= capAmount, capFrom: gIso_(per.start), capTo: gIso_(last),
    deals: deals
  };
}

/** Τι έστειλε ο Coach → { key: { w, m, y } } μόνο με γνωστούς δείκτες και θετικούς αριθμούς. */
function goalClean_(goals, allowed) {
  const out = {};
  const num = v => { const n = Math.round(Number(String(v == null ? '' : v).replace(',', '.')) * 10) / 10; return isFinite(n) && n > 0 ? Math.min(n, GOAL.MAX) : 0; };
  Object.keys(goals || {}).forEach(k => {
    if (allowed.indexOf(k) === -1) return;
    const g = goals[k] || {};
    const c = k === GOAL.REV ? { w: 0, m: 0, y: num(g.y) } : { w: num(g.w), m: num(g.m), y: num(g.y) };
    if (c.w || c.m || c.y) out[k] = c;
  });
  return out;
}

/** Μέσος όρος επίτευξης (0–1, κάθε δείκτης έως 1) για την περίοδο p ('w'|'m'|'y'). null = κανένας στόχος. */
function goalPct_(goals, values, p) {
  let n = 0, sum = 0;
  Object.keys(goals || {}).forEach(k => {
    const g = k === GOAL.REV ? 0 : (goals[k] || {})[p];
    if (!g) return;
    n++;
    sum += Math.min(1, ((values || {})[k] || 0) / g);
  });
  return n ? Math.round(sum / n * 100) / 100 : null;
}

// ── Ανάγνωση: κλεισίματα ─────────────────────────────────────────────

function capAmount_() { return finNum_(prop_('CAP_AMOUNT')) || FIN.CAP; }
function finSheetName_() { return prop_('FINANCE_SHEET', FIN.TEST_SHEET); }

function finSheet_() {
  const raw = prop_('FINANCE_SPREADSHEET_ID');
  try {
    const m = raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    const ss = raw ? SpreadsheetApp.openById(m ? m[1] : raw) : getSS();
    return ss.getSheetByName(finSheetName_());
  } catch (e) {
    console.error('Οικονομικά: δεν ανοίγει το αρχείο κλεισιμάτων (' + e.message + ')');
    return null;
  }
}

/** { configured, test, rows }. Μία ανάγνωση για όλους, 10' στο cache. */
function finRows_(refresh) {
  const cache = CacheService.getScriptCache();
  if (!refresh) {
    try { const hit = cache.get(FIN.CACHE_KEY); if (hit) return JSON.parse(hit); } catch (e) { /* διαβάζεται ξανά */ }
  }
  const sh = finSheet_();
  const test = finSheetName_() === FIN.TEST_SHEET;
  if (!sh || sh.getLastRow() < 2) return { configured: !!sh, test: test, rows: [] };
  const parsed = finParse_(sh.getDataRange().getValues());
  const res = { configured: parsed.ok, test: test, rows: parsed.rows };
  try {
    const s = JSON.stringify(res);
    if (s.length < 90000) cache.put(FIN.CACHE_KEY, s, 60 * FIN.CACHE_MIN);
  } catch (e) { /* μεγάλο για cache: απλώς δεν κρατιέται */ }
  return res;
}

function finKeys_(agent) { return [norm_(agent.name)].concat(formEmails_(agent).map(norm_)); }

function capStartText_(agent) {
  if (agent.capStart === '' || agent.capStart == null) return '';
  const md = capStartMD_(agent.capStart), p = n => (n < 10 ? '0' : '') + n;
  return p(md.d) + '/' + p(md.m + 1);
}

// ── Ανάγνωση και εγγραφή: στόχοι ─────────────────────────────────────

function goalSheet_(create) {
  const ss = getSS();
  let sh = ss.getSheetByName(GOAL.SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(GOAL.SHEET);
    sh.getRange(1, 1, 1, GOAL.HEADERS.length).setValues([GOAL.HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function goalId_(agent) { return agent.email || 'name:' + norm_(agent.name); }

let _goals = null;
function goalsAll_() {
  if (_goals) return _goals;
  _goals = {};
  const sh = goalSheet_(false);
  if (!sh || sh.getLastRow() < 2) return _goals;
  sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(r => {
    const id = String(r[0] || '').trim().toLowerCase(), key = String(r[2] || '').trim();
    if (!id || !key) return;
    (_goals[id] = _goals[id] || {})[key] = { w: finNum_(r[3]), m: finNum_(r[4]), y: finNum_(r[5]) };
  });
  return _goals;
}
function goalsFor_(agent) { return goalsAll_()[goalId_(agent)] || {}; }

function dashData_(agent, withFinance, refresh) {
  const out = { goals: goalsFor_(agent), capStart: capStartText_(agent), finance: null };
  if (withFinance) {
    const fin = finRows_(refresh);
    out.finance = fin.configured
      ? Object.assign(finFor_(finKeys_(agent), fin.rows, agent.capStart, capAmount_(), new Date()), { configured: true, test: fin.test })
      : { configured: false };
  }
  return out;
}

// ── Ενέργειες ────────────────────────────────────────────────────────

/** Ο μεσίτης: οι στόχοι του και (με flag finance) τα οικονομικά του. Οι μετρήσεις έρχονται από το 'metrics'. */
function actDash_(agent, d) {
  const f = featureFlags_(agent);
  if (!f.dashboard) return { off: true };
  return dashData_(agent, !!f.finance, !!d.refresh);
}

function coachTarget_(name) {
  const a = readAgents_().find(x => isAgent_(x) && x.name === String(name || ''));
  if (!a) throw new Error('Δεν βρέθηκε ο μεσίτης.');
  return a;
}

function metricPublic_() {
  return { metrics: METRIC_LIST.map(m => ({ key: m.key, group: m.group, label: m.label, sub: m.sub })), groups: METRIC_GROUPS };
}

/** Η ομάδα με μια ματιά: στόχοι μήνα, τζίρος έτους, cap. 10' στο cache. */
function actCoachBoot_(coach, d) {
  const cache = CacheService.getScriptCache();
  if (!d.refresh) {
    try { const hit = cache.get(FIN.BOOT_KEY); if (hit) return JSON.parse(hit); } catch (e) { /* ξαναϋπολογίζεται */ }
  }
  const now = new Date();
  const fin = finRows_(!!d.refresh);
  const recs = metricsSpreadsheet_() ? readMetricRecords_().records : null;
  const cap = capAmount_();
  const agents = readAgents_().filter(isAgent_).map(a => {
    const goals = goalsFor_(a);
    const values = {};
    if (recs) {
      const emails = formEmails_(a);
      recs.forEach(r => {
        if (emails.indexOf(r.email) === -1) return;
        if (r.start.getFullYear() !== now.getFullYear() || r.start.getMonth() !== now.getMonth()) return;
        Object.keys(r.values).forEach(k => { values[k] = (values[k] || 0) + (r.values[k] || 0); });
      });
    }
    const f = fin.configured ? finFor_(finKeys_(a), fin.rows, a.capStart, cap, now) : null;
    return {
      name: a.name, active: a.active, capStart: capStartText_(a),
      goals: Object.keys(goals).length, monthPct: goalPct_(goals, values, 'm'),
      revTarget: (goals[GOAL.REV] || {}).y || 0,
      yearTotal: f ? f.yearTotal : 0, capTotal: f ? f.capTotal : 0, capped: f ? f.capped : false
    };
  });
  const res = Object.assign({ agents: agents, cap: cap, finance: fin.configured, test: fin.test,
                              metricsOn: !!recs, updated: stamp_(now) }, metricPublic_());
  try { cache.put(FIN.BOOT_KEY, JSON.stringify(res), 60 * FIN.CACHE_MIN); } catch (e) { /* όχι κρίσιμο */ }
  return res;
}

/** Ένας μεσίτης, όπως τον βλέπει ο ίδιος: μετρήσεις, στόχοι, οικονομικά. */
function actCoachDash_(coach, d) {
  const a = coachTarget_(d.agent);
  return { agent: a.name, mx: actMetrics_(a, { refresh: d.refresh }), dash: dashData_(a, true, !!d.refresh) };
}

/** Ο Coach ορίζει τους στόχους ενός μεσίτη (αντικαθιστά τους προηγούμενους) και, προαιρετικά, την «Έναρξη cap». */
function actCoachGoalSet_(coach, d) {
  const a = coachTarget_(d.agent);
  const clean = goalClean_(d.goals, METRIC_LIST.map(m => m.key).concat([GOAL.REV]));
  const hasCap = Object.prototype.hasOwnProperty.call(d, 'capStart');
  const capText = String(d.capStart == null ? '' : d.capStart).trim();
  if (hasCap && capText && !/^\d{1,2}\/\d{1,2}$/.test(capText)) throw new Error('Έναρξη cap: γράψε ημέρα/μήνα, π.χ. 01/09.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = goalSheet_(true), n = GOAL.HEADERS.length;
    const last = sh.getLastRow();
    const rows = last >= 2 ? sh.getRange(2, 1, last - 1, n).getValues() : [];
    const id = goalId_(a), now = new Date();
    const keep = rows.filter(r => String(r[0] || '').trim() && String(r[0]).trim().toLowerCase() !== id);
    Object.keys(clean).forEach(k => {
      keep.push(safeRow_([id, a.name, k, clean[k].w || '', clean[k].m || '', clean[k].y || '', now, coach.name]));
    });
    if (last >= 2) sh.getRange(2, 1, last - 1, n).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, n).setValues(keep);

    if (hasCap) {
      const ag = sheet_(CONFIG.SHEETS.AGENTS), col = agentCols_(ag).CAP_START;
      if (!col) throw new Error('Λείπει η στήλη «' + AGENT_HEADERS.CAP_START + '». Τρέξε μία φορά τη setupCoach.');
      const md = capText ? capStartMD_(capText) : null, p = x => (x < 10 ? '0' : '') + x;
      // Κείμενο «ΗΗ/ΜΜ»: ως ημερομηνία θα εξαρτιόταν από τη γλώσσα του φύλλου (01/09 → 9 Ιανουαρίου).
      ag.getRange(a.row, col).setNumberFormat('@').setValue(md ? p(md.d) + '/' + p(md.m + 1) : '');
      a.capStart = md ? p(md.d) + '/' + p(md.m + 1) : '';
    }
  } finally {
    lock.releaseLock();
  }
  _goals = null;
  try { CacheService.getScriptCache().remove(FIN.BOOT_KEY); } catch (e) { /* όχι κρίσιμο */ }
  return actCoachDash_(coach, { agent: a.name });
}

// ── Από τον editor (μία φορά) ────────────────────────────────────────

/** ▶ Στήλη «Έναρξη cap» και τιμή «Coach» στη στήλη «Ρόλος» του Agents, φύλλο «Στόχοι». Δεν πειράζει τίποτα άλλο. */
function setupCoach() {
  const ag = sheet_(CONFIG.SHEETS.AGENTS);
  let cols = agentCols_(ag);
  if (!cols.ROLE) throw new Error('Τρέξε πρώτα τη setupAdmin (λείπει η στήλη «Ρόλος»).');
  if (!cols.CAP_START) {
    const c = ag.getLastColumn() + 1;
    ag.getRange(1, c).setValue(AGENT_HEADERS.CAP_START).setFontWeight('bold');
    ag.getRange(2, c, Math.max(ag.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    cols = agentCols_(ag);
  }
  try {
    ag.getRange(2, cols.ROLE, Math.max(ag.getMaxRows() - 1, 1), 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(ROLE_VALUES, true).setAllowInvalid(false).build());
  } catch (e) { /* όχι κρίσιμο */ }
  goalSheet_(true);
  console.log('Έτοιμο. Στο φύλλο Agents: βάλε «Coach» στη στήλη «' + AGENT_HEADERS.ROLE + '» του Coach και, αν θέλεις, ' +
              'ημέρα/μήνα (π.χ. 01/09) στη στήλη «' + AGENT_HEADERS.CAP_START + '» κάθε μεσίτη. Φύλλο «' + GOAL.SHEET + '» έτοιμο.');
}

/**
 * ▶ Δοκιμαστική καρτέλα «Κλεισίματα (τεστ)» με ΨΕΥΤΙΚΑ ποσά για τους πρώτους μεσίτες του Agents:
 * κωδικός ακινήτου, αμοιβή ιδιοκτήτη, αμοιβή αγοραστή/μισθωτή, σύνολο συμβολαίου (τύπος)
 * και δεξιά ο συνολικός τζίρος κάθε μεσίτη (τύπος). Αν υπάρχει ήδη, δεν την αγγίζει.
 */
function setupFinanceTest() {
  const ss = getSS();
  if (ss.getSheetByName(FIN.TEST_SHEET)) return console.log('Η καρτέλα «' + FIN.TEST_SHEET + '» υπάρχει ήδη. Σβήσε την για να ξαναφτιαχτεί.');
  const agents = readAgents_().filter(a => isAgent_(a) && a.active).slice(0, 4);
  if (!agents.length) return console.log('Δεν βρέθηκαν ενεργοί μεσίτες στο Agents.');

  // [μήνες πριν, ημέρα, αμοιβή ιδιοκτήτη, αμοιβή αγοραστή/μισθωτή]
  const plan = [[0, 6, 7200, 3600], [1, 14, 900, 900], [2, 21, 9600, 4800], [4, 9, 1200, 600],
                [6, 17, 6400, 3200], [8, 3, 11200, 5600], [10, 25, 800, 800], [13, 12, 8000, 4000]];
  const now = new Date(), rows = [];
  agents.forEach((a, i) => {
    plan.forEach((p, j) => {
      if ((i + j) % 4 === 3) return;                       // δεν έχουν όλοι τα ίδια
      const k = 1 + (i * 3 + j) % 4 * 0.25;                // διαφορετικά ποσά ανά μεσίτη
      rows.push([new Date(now.getFullYear(), now.getMonth() - p[0], p[1]), a.name,
                 'TEST-' + (101 + i * 10 + j), Math.round(p[2] * k), Math.round(p[3] * k)]);
    });
  });
  rows.sort((x, y) => y[0] - x[0]);

  const sh = ss.insertSheet(FIN.TEST_SHEET);
  const head = ['Ημερομηνία', 'Μεσίτης', 'Κωδικός ακινήτου', 'Αμοιβή ιδιοκτήτη', 'Αμοιβή αγοραστή/μισθωτή', 'Σύνολο συμβολαίου',
                '', 'Σύνολα ανά μεσίτη', 'Συνολικός τζίρος'];
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.getRange(2, 1, rows.length, 5).setValues(rows.map(safeRow_));
  sh.getRange(2, 6, rows.length, 1).setFormulas(rows.map((r, i) => ['=D' + (i + 2) + '+E' + (i + 2)]));
  sh.getRange(2, 8, agents.length, 1).setValues(agents.map(a => [safe_(a.name)]));
  sh.getRange(2, 9, agents.length, 1).setFormulas(agents.map((a, i) => ['=SUMIF($B$2:$B,H' + (i + 2) + ',$F$2:$F)']));
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(2, 4, rows.length, 3).setNumberFormat('#,##0 "€"');
  sh.getRange(2, 9, agents.length, 1).setNumberFormat('#,##0 "€"');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, head.length);
  try { CacheService.getScriptCache().removeAll([FIN.CACHE_KEY, FIN.BOOT_KEY]); } catch (e) { /* όχι κρίσιμο */ }
  console.log('Έτοιμο: «' + FIN.TEST_SHEET + '» με ' + rows.length + ' ψεύτικα κλεισίματα για ' + agents.map(a => a.name).join(', ') + '.');
}
