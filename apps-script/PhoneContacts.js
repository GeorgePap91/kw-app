/**
 * 2.17 · Επαφές κινητού (flag phoneContacts)
 *
 * Τρία κομμάτια:
 *   1. ΕΙΣΑΓΩΓΗ: ο μεσίτης ανεβάζει CSV (Google) ή vCard (iPhone / Android). Το αρχείο διαβάζεται
 *      ΜΕΣΑ στο κινητό (phonecontacts.js) και ο έλεγχος διπλών γίνεται εκεί. Στον server έρχονται
 *      ΜΟΝΟ οι επαφές που επέλεξε. Οι υπόλοιπες (οικογένεια, φίλοι) δεν φεύγουν ποτέ από το κινητό.
 *      Ο server ξαναελέγχει: «νέα» που έχει ήδη ίδιο τηλέφωνο ή email ΔΕΝ γίνεται δεύτερη επαφή.
 *   2. ΠΙΘΑΝΑ ΔΙΠΛΑ: όσα ο μεσίτης άφησε για μετά, στο φύλλο «Εκκρεμείς επαφές». Διαβάζεται
 *      μόνο όταν ανοίξει η λίστα.
 *   3. ΠΡΟΣ ΤΟ ΚΙΝΗΤΟ: οι πελάτες με ακίνητο μπαίνουν στις επαφές Google του μεσίτη, σε ομάδα
 *      «<κωδικός> <οδός>». Δύο τρόποι (ρύθμιση ανά μεσίτη):
 *        auto: ο «Βοηθός επαφών» (ξεχωριστό Apps Script που τρέχει ΩΣ ο μεσίτης, contacts-helper/)
 *              ζητά κάθε βράδυ ό,τι άλλαξε (pcPull) και επιβεβαιώνει (pcAck).
 *        tap:  το κινητό φτιάχνει αρχείο vCard με ένα πάτημα, και μια ειδοποίηση το βράδυ το θυμίζει.
 *      Το «τι έχει ήδη γραφτεί» = hash στη στήλη «Στο κινητό». Αλλάζει μόνο αν αλλάξουν τα στοιχεία
 *      ή τα ακίνητα της επαφής, οπότε κάθε βράδυ στέλνονται μόνο οι διαφορές.
 *
 * Κόστος: καμία πληρωμένη υπηρεσία. Η εισαγωγή γράφει με ένα setValues ανά στήλη (όχι κελί-κελί).
 * Το pcPull διαβάζει μόνο το «Επαφές εφαρμογής» (όχι το CRM).
 */

const PC = {
  FLAG: 'phoneContacts',
  MAX_IMPORT: 400,            // επαφές ανά αίτημα (το κινητό στέλνει σε κομμάτια)
  MAX_PULL: 300,              // ανά βράδυ ανά μεσίτη· τα υπόλοιπα την επόμενη
  PAIR_MIN: 15,               // λεπτά ισχύος του κωδικού σύνδεσης του Βοηθού
  KEY_PREFIX: 'PCKEY:',       // + sha256(κλειδί) → email μεσίτη
  LINK_PREFIX: 'PCLINK:',     // + email → { since, last, n }
  EVE_HOUR: 20,               // ώρα ειδοποίησης «Με ένα πάτημα»
  EVE_KEY: 'PC_EVE_DAY',
  PEND_SHEET: 'Εκκρεμείς επαφές',
  PEND_HEADERS: ['ID', 'Μεσίτης', 'Πότε', 'Λόγος', 'Στοιχεία'],
  MODES: ['auto', 'tap', 'off'],
  ALL_GROUP: 'KW Πελάτες'
};

(function () {
  try {
    Object.assign(ACTIONS, {
      pcImport: actPcImport_, pcPending: actPcPending_, pcResolve: actPcResolve_,
      pcStatus: actPcStatus_, pcMode: actPcMode_, pcLinkStart: actPcLinkStart_, pcUnlink: actPcUnlinkApp_,
      pcMarked: actPcMarked_, pcBatch: actPcBatch_
    });
    ['pcImport', 'pcPending', 'pcResolve', 'pcStatus', 'pcMode', 'pcLinkStart', 'pcUnlink', 'pcMarked', 'pcBatch']
      .forEach(a => { FLAG_ACTIONS[a] = PC.FLAG; });
    // Ο Βοηθός δεν έχει συσκευή: αυθεντικοποιείται με δικό του κλειδί (pcAgentByKey_).
    Object.assign(PUBLIC_ACTIONS, { pcPair: actPcPair_, pcPull: actPcPull_, pcAck: actPcAck_, pcBye: actPcBye_ });
  } catch (e) {
    console.error('PhoneContacts.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

// ── Καθαρή λογική (χωρίς Google: τη δοκιμάζουν τα tests) ──────────────

/** Ετικέτα ομάδας για ένα ακίνητο: «4411 Βαρίκα 13» (ή μόνο ο κωδικός). */
function pcGroupName_(code, street) {
  return [String(code || '').trim(), String(street || '').trim()].filter(Boolean).join(' ').slice(0, 120);
}

function pcUniq_(arr) {
  const out = [];
  (arr || []).forEach(x => { if (x && out.indexOf(x) === -1) out.push(x); });
  return out;
}

/** Καθαρά τηλέφωνα και email από ό,τι έστειλε το κινητό. */
function pcClean_(it) {
  const okMail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  return {
    name: String(it.name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    phones: pcUniq_((it.phones || []).slice(0, 6).map(phoneDigits_).filter(p => p.length >= 8 && p.length <= 15)),
    emails: pcUniq_((it.emails || []).slice(0, 6).map(emailKey_).filter(okMail)),
    codes: pcUniq_((it.codes || []).slice(0, 20).map(c => String(c || '').trim()).filter(Boolean))
  };
}

/**
 * Πού ταιριάζει μια επαφή (it = καθαρή) στο ευρετήριο x = { byPhone, byEmail }.
 * Επιστρέφει { pm, em }: η επαφή με ίδιο τηλέφωνο / ίδιο email (ή null).
 */
function pcFind_(x, it) {
  const pm = it.phones.map(p => x.byPhone[p]).filter(Boolean)[0] || null;
  const em = it.emails.map(e => x.byEmail[e]).filter(Boolean)[0] || null;
  return { pm: pm, em: em };
}

/**
 * Τι θα γίνει με μια επαφή που ζήτησε ο μεσίτης.
 *   action: 'auto' | 'merge' | 'separate' | 'later' | 'skip', target: id επαφής για 'merge'.
 * Κανόνας ασφαλείας: «νέα» (auto/separate) με ΙΔΙΟ τηλέφωνο ΚΑΙ email με υπάρχουσα → συγχώνευση.
 * auto: καμία ταύτιση → νέα · ίδιο τηλέφωνο ή email → συγχώνευση · τηλέφωνο σε μία και email σε άλλη → για μετά.
 */
function pcDecide_(x, it, action, target) {
  const f = pcFind_(x, it);
  if (action === 'skip') return { op: 'skip' };
  if (action === 'later') return { op: 'later', why: 'Ο μεσίτης θα αποφασίσει' };
  if (action === 'merge') return target ? { op: 'merge', target: target } : { op: 'later', why: 'Χωρίς επαφή για συγχώνευση' };
  if (f.pm && f.em && f.pm !== f.em) return { op: 'later', why: 'Το τηλέφωνο είναι σε μία επαφή και το email σε άλλη' };
  if (action === 'separate') {
    if (f.pm && f.pm === f.em) return { op: 'merge', target: f.pm.id };
    if (f.pm && !it.emails.length) return { op: 'merge', target: f.pm.id };   // μόνο τηλέφωνο, και αυτό υπάρχει
    if (f.em && !it.phones.length) return { op: 'merge', target: f.em.id };
    return { op: 'new' };
  }
  const m = f.pm || f.em;
  return m ? { op: 'merge', target: m.id } : { op: 'new' };
}

/** Τι αλλάζει σε μια υπάρχουσα επαφή: προσθέτουμε, ΔΕΝ σβήνουμε. crm = τα κύρια στοιχεία δεν αγγίζονται. */
function pcMergeInto_(a, it, crm) {
  let changed = false;
  if (!crm) {
    if (!a.name && it.name) { a.name = it.name; changed = true; }
    if (!a.phone && it.phones[0]) { a.phone = it.phones[0]; changed = true; }
    if (!a.email && it.emails[0]) { a.email = it.emails[0]; changed = true; }
  }
  const havePh = [a.phone].concat(a.xphones || [], a._known ? a._known.phones : []);
  const haveEm = [emailKey_(a.email)].concat(a.xemails || [], a._known ? a._known.emails : []);
  it.phones.forEach(p => { if (havePh.indexOf(p) === -1) { a.xphones = (a.xphones || []).concat(p); havePh.push(p); changed = true; } });
  it.emails.forEach(e => { if (haveEm.indexOf(e) === -1) { a.xemails = (a.xemails || []).concat(e); haveEm.push(e); changed = true; } });
  it.codes.forEach(c => {
    if (!a.codes.some(x => normCode_(x) === normCode_(c))) { a.codes.push(c); changed = true; }
  });
  return changed;
}

/** Το σύντομο αποτύπωμα αυτού που γράφτηκε στο κινητό. */
function pcHashText_(p) {
  return [p.name, p.phones.join(','), p.emails.join(','), p.groups.join(',')].join('|');
}

// ── Βοηθητικά με Google ──────────────────────────────────────────

function pcHash_(p) { return sha256_(pcHashText_(p)).slice(0, 12); }

/** Τα ακίνητα που ο μεσίτης μπορεί να βάλει σε επαφή: μόνο τα δικά του. */
function pcMyCodes_(agent) {
  const props = readProps_(), out = {};
  Object.keys(props).forEach(k => { if (norm_(props[k].partner) === norm_(agent.name)) out[k] = props[k]; });
  return out;
}

function pcWrite_(sh, cols, rows) {
  if (!rows.length) return;
  const last = rows.reduce((m, c) => Math.max(m, c.row), 1);
  if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows());
  const put = {
    ID: c => c.id, CRM: c => c.crmId, AGENT: c => c.agent, NAME: c => c.name, PHONE: c => c.phone,
    EMAIL: c => c.email, CODES: c => c.codes.join(', '), XPHONES: c => (c.xphones || []).join(', '),
    XEMAILS: c => (c.xemails || []).join(', '), SRC: c => c.src || '', PSYNC: c => c.psync || ''
  };
  Object.keys(put).forEach(k => {
    if (!cols[k]) return;
    const r = sh.getRange(2, cols[k], last - 1, 1);
    const v = r.getValues();
    rows.forEach(c => { v[c.row - 2][0] = safe_(put[k](c)); });
    r.setValues(v);
  });
}

/** Η γραμμή της εφαρμογής μιας επαφής του ευρετηρίου (τη φτιάχνει αν λείπει, π.χ. επαφή μόνο του CRM). */
function pcAppRow_(m, agent, nextRow) {
  if (m.apps.length) return m.apps[0];
  const a = { row: nextRow(), id: newContactId_(), crmId: m.crmId || '', agent: agent.name, name: m.name || '',
              phone: m.phones[0] || '', email: m.emails[0] || '', codes: [], notes: '', first: '', last: '',
              xphones: [], xemails: [], src: '', psync: '', dirty: true };
  _contacts.push(a);
  m.apps.push(a);
  return a;
}

function pcPendSheet_() {
  const ss = getSS();
  let sh = ss.getSheetByName(PC.PEND_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PC.PEND_SHEET);
    sh.getRange(1, 1, 1, PC.PEND_HEADERS.length).setValues([PC.PEND_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── Ενέργειες της εφαρμογής ─────────────────────────────────────

/**
 * Εισαγωγή: { src: 'Google'|'iPhone'|'Αρχείο', items: [{ name, phones, emails, codes, action, target }] }.
 * Επιστρέφει { added, merged, later, skipped }.
 */
function actPcImport_(agent, d) {
  const items = (d.items || []).slice(0, PC.MAX_IMPORT);
  const src = ['Google', 'iPhone', 'Αρχείο'].indexOf(d.src) !== -1 ? d.src : 'Αρχείο';
  const mine = pcMyCodes_(agent);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureAppContactSheet_();
    const cols = contactCols_(sh);
    _contacts = null; _cidx = {};
    readContacts_();
    const x = agentIndex_(agent.name);
    const byId = {};
    x.list.forEach(m => { byId[m.id] = m; });
    let next = sh.getLastRow() + 1;
    const nextRow = () => next++;
    const later = [];
    const out = { added: 0, merged: 0, later: 0, skipped: 0 };

    items.forEach(raw => {
      const it = pcClean_(raw);
      it.codes = it.codes.filter(c => mine[normCode_(c)]);          // μόνο δικά του ακίνητα
      if (!it.phones.length && !it.emails.length) { out.skipped++; return; }
      const dec = pcDecide_(x, it, String(raw.action || 'auto'), byId[raw.target] ? raw.target : '');
      if (dec.op === 'skip') { out.skipped++; return; }
      if (dec.op === 'later') { later.push({ it: it, why: dec.why }); out.later++; return; }

      if (dec.op === 'merge') {
        const m = byId[dec.target];
        const a = pcAppRow_(m, agent, nextRow);
        a._known = { phones: m.phones, emails: m.emails.map(emailKey_) };
        if (pcMergeInto_(a, it, !!m.crm)) a.dirty = true;
        delete a._known;
        it.phones.forEach(p => { if (m.phones.indexOf(p) === -1) m.phones.push(p); if (!x.byPhone[p]) x.byPhone[p] = m; });
        it.emails.forEach(e => { if (m.emails.indexOf(e) === -1) m.emails.push(e); if (!x.byEmail[e]) x.byEmail[e] = m; });
        out.merged++;
        return;
      }

      const a = { row: nextRow(), id: newContactId_(), crmId: '', agent: agent.name, name: it.name,
                  phone: it.phones[0] || '', email: it.emails[0] || '', codes: it.codes.slice(), notes: '', first: '', last: '',
                  xphones: it.phones.slice(1), xemails: it.emails.slice(1), src: src, psync: '', dirty: true };
      _contacts.push(a);
      const m = { id: a.id, crm: false, crmId: '', name: a.name, phones: it.phones.slice(), emails: it.emails.slice(), apps: [a] };
      x.list.push(m);
      byId[m.id] = m;
      it.phones.forEach(p => { if (!x.byPhone[p]) x.byPhone[p] = m; });
      it.emails.forEach(e => { if (!x.byEmail[e]) x.byEmail[e] = m; });
      out.added++;
    });

    const dirty = _contacts.filter(c => c.dirty);
    pcWrite_(sh, cols, dirty);
    dirty.forEach(c => { delete c.dirty; });

    if (later.length) {
      const ps = pcPendSheet_();
      ps.getRange(ps.getLastRow() + 1, 1, later.length, PC.PEND_HEADERS.length).setValues(later.map(l =>
        safeRow_(['P' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), agent.name, new Date(), l.why, JSON.stringify(l.it)])));
    }
    _cidx = {};
    log_('Εισαγωγή επαφών', agent.name, src + ': +' + out.added + ' / συγχ. ' + out.merged + ' / μετά ' + out.later);
    return out;
  } finally {
    lock.releaseLock();
  }
}

function pcPendRows_(agent) {
  const sh = getSS().getSheetByName(PC.PEND_SHEET);
  if (!sh || sh.getLastRow() < 2) return { sh: sh, rows: [] };
  const key = norm_(agent.name);
  const rows = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, PC.PEND_HEADERS.length).getValues().forEach((r, i) => {
    if (norm_(r[1]) !== key || !r[0]) return;
    let it = null;
    try { it = JSON.parse(r[4]); } catch (e) { return; }
    rows.push({ row: i + 2, id: String(r[0]), at: r[2], why: String(r[3] || ''), it: it });
  });
  return { sh: sh, rows: rows };
}

/** Τα «Πιθανά διπλά»: κάθε εκκρεμής επαφή με τις υποψήφιες υπάρχουσες. */
function actPcPending_(agent) {
  const p = pcPendRows_(agent);
  if (!p.rows.length) return [];
  const x = agentIndex_(agent.name);
  const brief = m => m ? { id: m.id, name: m.name || '', phone: m.phones[0] || '', email: m.emails[0] || '', crm: !!m.crm } : null;
  return p.rows.map(r => {
    const it = pcClean_(r.it);
    const f = pcFind_(x, it);
    return { id: r.id, why: r.why, date: stamp_(r.at), name: it.name, phones: it.phones, emails: it.emails, codes: it.codes,
             byPhone: brief(f.pm), byEmail: f.em && f.em !== f.pm ? brief(f.em) : null };
  });
}

/** Απόφαση για μία εκκρεμή: { id, action: 'merge'|'separate'|'skip', target }. */
function actPcResolve_(agent, d) {
  const p = pcPendRows_(agent);
  const r = p.rows.find(x => x.id === String(d.id || ''));
  if (!r) throw new Error('Η εκκρεμότητα δεν βρέθηκε (ίσως λύθηκε ήδη).');
  const action = ['merge', 'separate', 'skip'].indexOf(d.action) !== -1 ? d.action : 'skip';
  const res = action === 'skip' ? { added: 0, merged: 0, later: 0, skipped: 1 }
    : actPcImport_(agent, { src: 'Αρχείο', items: [Object.assign({}, r.it, { action: action, target: d.target || '' })] });
  // Αν ξαναβγήκε «για μετά» (σύγκρουση), μένει μία φορά: σβήνουμε την παλιά γραμμή.
  p.sh.deleteRow(r.row);
  return res;
}

function pcLink_(agent) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(PC.LINK_PREFIX + emailKey_(agent.email)) || 'null'); }
  catch (e) { return null; }
}

/** Οι επαφές με ακίνητο, όπως θα γραφτούν στο κινητό. Μόνο από το «Επαφές εφαρμογής». */
function pcPhoneList_(agent) {
  const key = norm_(agent.name), props = readProps_();
  const rows = readContacts_().filter(a => norm_(a.agent) === key && a.codes.length && (a.phone || a.email));
  // Ίδιος άνθρωπος σε δύο γραμμές (π.χ. από CRM και από κλήση) → μία επαφή.
  const byPh = {}, byEm = {}, groups = [];
  rows.forEach(a => {
    const phones = pcUniq_([a.phone].concat(a.xphones || []));
    const emails = pcUniq_([emailKey_(a.email)].concat(a.xemails || []));
    let g = phones.map(p => byPh[p]).filter(Boolean)[0] || emails.map(e => byEm[e]).filter(Boolean)[0];
    if (!g) { g = { rows: [], name: '', phones: [], emails: [], codes: [] }; groups.push(g); }
    g.rows.push(a);
    if (!g.name && a.name) g.name = a.name;
    phones.forEach(p => { if (g.phones.indexOf(p) === -1) g.phones.push(p); byPh[p] = g; });
    emails.forEach(e => { if (g.emails.indexOf(e) === -1) g.emails.push(e); byEm[e] = g; });
    a.codes.forEach(c => { if (!g.codes.some(x => normCode_(x) === normCode_(c))) g.codes.push(c); });
  });
  return groups.map(g => {
    const p = {
      id: g.rows[0].id, name: g.name || ('Πελάτης ' + g.codes[0]), phones: g.phones, emails: g.emails,
      groups: g.codes.map(c => { const pr = props[normCode_(c)]; return pcGroupName_(c, pr ? pr.street : ''); })
    };
    p.h = pcHash_(p);
    p.synced = String(g.rows[0].psync || '').replace(/^x:/, '') === p.h;
    p.row = g.rows[0];
    return p;
  });
}

function actPcStatus_(agent) {
  const link = pcLink_(agent);
  const pend = pcPendRows_(agent).rows.length;
  const list = pcPhoneList_(agent);
  return {
    mode: (agent.prefs && agent.prefs.phoneSync) || 'off',
    linked: !!link, last: link && link.last ? stamp_(new Date(link.last)) : '', lastN: link ? link.n || 0 : 0,
    helper: !!prop_('CONTACTS_HELPER_URL'),
    pendingDup: pend,
    pendingPhone: list.filter(p => !p.synced).length
  };
}

function actPcMode_(agent, d) {
  const mode = PC.MODES.indexOf(d.mode) !== -1 ? d.mode : 'off';
  readAgents_();
  const c = _agentCols;
  if (!c.PREFS) throw new Error('Λείπει η στήλη «Ρυθμίσεις» στο Agents. Τρέξε setup().');
  const p = agent.prefs || {};
  p.phoneSync = mode;
  agent.prefs = p;
  sheet_(CONFIG.SHEETS.AGENTS).getRange(agent.row, c.PREFS).setValue(JSON.stringify(p));
  return actPcStatus_(agent);
}

function pcItem_(p) {
  return { id: p.id, h: p.h, name: p.name, phones: p.phones, emails: p.emails, groups: p.groups,
           note: 'KW App · ' + p.groups.join(' · ') };
}

/** «Με ένα πάτημα»: ό,τι λείπει από το κινητό, για να φτιάξει το κινητό το αρχείο vCard. */
function actPcBatch_(agent) {
  const todo = pcPhoneList_(agent).filter(p => !p.synced);
  return { items: todo.slice(0, PC.MAX_PULL).map(pcItem_), more: Math.max(0, todo.length - PC.MAX_PULL) };
}

/** «Με ένα πάτημα»: ο μεσίτης πρόσθεσε το αρχείο vCard στο κινητό → σημειώνουμε ως γραμμένες. */
function actPcMarked_(agent, d) {
  const ids = {};
  (d.ids || []).slice(0, 1000).forEach(id => { ids[String(id)] = 1; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureAppContactSheet_();
    _contacts = null;
    const done = pcPhoneList_(agent).filter(p => ids[p.id] && !p.synced);
    done.forEach(p => { p.row.psync = p.h; });
    pcWrite_(sh, contactCols_(sh), done.map(p => p.row));
    return { marked: done.length };
  } finally {
    lock.releaseLock();
  }
}

/** Κωδικός μίας χρήσης για να συνδεθεί ο Βοηθός επαφών. Το link ανοίγει στο κινητό του μεσίτη. */
function actPcLinkStart_(agent) {
  const url = prop_('CONTACTS_HELPER_URL');
  if (!url) throw new Error('Ο Βοηθός επαφών δεν έχει εγκατασταθεί ακόμα. Ενημέρωσε τον Admin.');
  if (!agent.email) throw new Error('Λείπει το email σου στο Agents.');
  const code = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  CacheService.getScriptCache().put('PCPAIR:' + code, emailKey_(agent.email), PC.PAIR_MIN * 60);
  return { url: url + (url.indexOf('?') === -1 ? '?' : '&') + 'code=' + code };
}

function pcDropKeys_(email) {
  const sp = PropertiesService.getScriptProperties();
  const all = sp.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf(PC.KEY_PREFIX) === 0 && all[k] === email) sp.deleteProperty(k);
  });
  sp.deleteProperty(PC.LINK_PREFIX + email);
}

function actPcUnlinkApp_(agent) {
  pcDropKeys_(emailKey_(agent.email));
  log_('Επαφές κινητού: αποσύνδεση', agent.name, '');
  return actPcStatus_(agent);
}

// ── Ενέργειες του Βοηθού επαφών (χωρίς συσκευή, με κλειδί) ──────────

function pcAgentByKey_(key) {
  const email = key ? PropertiesService.getScriptProperties().getProperty(PC.KEY_PREFIX + sha256_(String(key))) : '';
  const agent = email ? readAgents_().find(a => emailKey_(a.email) === email && a.active) : null;
  if (!agent) throw err_('Ο Βοηθός επαφών δεν είναι συνδεδεμένος. Σύνδεσέ τον ξανά από την εφαρμογή.', 'auth');
  if (!featureFlags_(agent)[PC.FLAG]) throw err_('Η λειτουργία δεν είναι ακόμα ενεργή για τον λογαριασμό σου.', 'flag');
  return agent;
}

/** { code, email }: ο Βοηθός (ως ο μεσίτης) ανταλλάσσει τον κωδικό μίας χρήσης με μόνιμο κλειδί. */
function actPcPair_(d) {
  const cache = CacheService.getScriptCache();
  const code = String(d.code || '').replace(/[^a-f0-9]/gi, '');
  const want = code ? cache.get('PCPAIR:' + code) : '';
  if (!want) throw err_('Ο σύνδεσμος έληξε. Πάτα ξανά «Σύνδεση» μέσα στην εφαρμογή.', 'auth');
  const email = emailKey_(d.email);
  if (email !== want) {
    throw err_('Άνοιξες τον σύνδεσμο με λογαριασμό ' + (email || '(άγνωστο)') + '. Χρειάζεται ο ' + want + '.', 'auth');
  }
  cache.remove('PCPAIR:' + code);
  const agent = readAgents_().find(a => emailKey_(a.email) === email);
  if (!agent) throw err_('Ο λογαριασμός δεν είναι μεσίτης της εφαρμογής.', 'auth');
  pcDropKeys_(email);                                     // ένας Βοηθός ανά μεσίτη
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const sp = PropertiesService.getScriptProperties();
  sp.setProperty(PC.KEY_PREFIX + sha256_(key), email);
  sp.setProperty(PC.LINK_PREFIX + email, JSON.stringify({ since: Date.now(), last: 0, n: 0 }));
  // Όποιος συνδέει τον Βοηθό θέλει «Αυτόματα».
  const p = agent.prefs || {};
  if (p.phoneSync !== 'auto') { try { actPcMode_(agent, { mode: 'auto' }); } catch (e) { /* όχι κρίσιμο */ } }
  log_('Επαφές κινητού: σύνδεση', agent.name, '');
  return { key: key, name: agent.name, group: PC.ALL_GROUP };
}

/** { key }: ό,τι πρέπει να γραφτεί ή να ενημερωθεί στις επαφές του κινητού. */
function actPcPull_(d) {
  const agent = pcAgentByKey_(d.key);
  const mode = (agent.prefs && agent.prefs.phoneSync) || 'off';
  if (mode !== 'auto') return { off: true, items: [] };
  const todo = pcPhoneList_(agent).filter(p => !p.synced);
  return {
    off: false, group: PC.ALL_GROUP, more: Math.max(0, todo.length - PC.MAX_PULL),
    items: todo.slice(0, PC.MAX_PULL).map(pcItem_)
  };
}

/** { key, items: [{ id, h, st: 'new'|'upd'|'same'|'conflict' }] } → γράφει το hash, ώστε να μη σταλούν ξανά. */
function actPcAck_(d) {
  const agent = pcAgentByKey_(d.key);
  const got = {};
  (d.items || []).slice(0, PC.MAX_PULL).forEach(i => { got[String(i.id)] = i; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let added = 0;
  try {
    const sh = ensureAppContactSheet_();
    _contacts = null;
    const done = [];
    pcPhoneList_(agent).forEach(p => {
      const i = got[p.id];
      if (!i || i.h !== p.h) return;                       // άλλαξε στο μεταξύ: θα ξανασταλεί
      p.row.psync = (i.st === 'conflict' ? 'x:' : '') + p.h;
      if (i.st === 'new') added++;
      done.push(p.row);
    });
    pcWrite_(sh, contactCols_(sh), done);
  } finally {
    lock.releaseLock();
  }
  const key = PC.LINK_PREFIX + emailKey_(agent.email);
  const sp = PropertiesService.getScriptProperties();
  let link = {};
  try { link = JSON.parse(sp.getProperty(key) || '{}') || {}; } catch (e) { link = {}; }
  link.last = Date.now();
  link.n = added;
  sp.setProperty(key, JSON.stringify(link));
  if (added) {
    try {
      pushToAgent_(agent, { title: 'Επαφές κινητού', body: 'Μπήκαν ' + added + (added === 1 ? ' νέος πελάτης' : ' νέοι πελάτες') +
                            ' στις επαφές σου, στην ομάδα του ακινήτου.',
                            type: 'pc', id: 'go:phonecontacts', tag: 'phonecontacts', url: '?lead=go%3Aphonecontacts' });
    } catch (e) { /* η ειδοποίηση δεν είναι κρίσιμη */ }
  }
  return { ok: true, added: added };
}

function actPcBye_(d) {
  const agent = pcAgentByKey_(d.key);
  pcDropKeys_(emailKey_(agent.email));
  return { ok: true };
}

/** Μία φορά την ημέρα (από τις 20:00): υπενθύμιση σε όσους διάλεξαν «Με ένα πάτημα». */
function pcEveningPush() {
  const now = new Date();
  if (now.getHours() < PC.EVE_HOUR) return;
  const sp = PropertiesService.getScriptProperties();
  const today = fmtIso_(now);
  if (sp.getProperty(PC.EVE_KEY) === today) return;
  sp.setProperty(PC.EVE_KEY, today);
  readAgents_().filter(a => a.active && isAgent_(a) && a.prefs && a.prefs.phoneSync === 'tap' && featureFlags_(a)[PC.FLAG])
    .forEach(agent => {
      try {
        const n = pcPhoneList_(agent).filter(p => !p.synced).length;
        if (!n) return;
        pushToAgent_(agent, { title: 'Επαφές κινητού', type: 'pc', id: 'go:phonecontacts', tag: 'phonecontacts',
          url: '?lead=go%3Aphonecontacts',
          body: n + (n === 1 ? ' νέος πελάτης περιμένει' : ' νέοι πελάτες περιμένουν') + ' να μπουν στο κινητό σου. Ένα πάτημα.' });
      } catch (e) { console.warn('Επαφές κινητού (' + agent.name + '): ' + e.message); }
    });
}

/** Διάγνωση: τρέξε το από τον editor. */
function phoneContactsCheck() {
  const out = ['Βοηθός επαφών: ' + (prop_('CONTACTS_HELPER_URL') ? 'ρυθμισμένος ✓' : '⚠ λείπει η Ιδιότητα CONTACTS_HELPER_URL')];
  readAgents_().filter(a => a.active && isAgent_(a)).forEach(a => {
    const list = pcPhoneList_(a);
    out.push('  ' + a.name + ': λειτουργία ' + ((a.prefs && a.prefs.phoneSync) || 'off') + (pcLink_(a) ? ' · συνδεδεμένος' : '') +
             ' · με ακίνητο ' + list.length + ' · για το κινητό ' + list.filter(p => !p.synced).length +
             (featureFlags_(a)[PC.FLAG] ? '' : ' · (flag κλειστό)'));
  });
  console.log(out.join('\n'));
}
