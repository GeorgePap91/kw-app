/**
 * KW App · Βοηθός επαφών (2.17)
 *
 * Ξεχωριστό Apps Script, που τρέχει ΩΣ Ο ΜΕΣΙΤΗΣ (Execute as: User accessing the web app).
 * Γι' αυτό μπορεί να γράψει στις δικές του επαφές Google, κάτι που ο κεντρικός λογαριασμός
 * της εφαρμογής δεν μπορεί.
 *
 * Ροή:
 *   1. Στην εφαρμογή: Επαφές κινητού → «Σύνδεση». Ανοίγει αυτή η σελίδα με κωδικό μίας χρήσης.
 *   2. Ο μεσίτης δίνει άδεια (οθόνη της Google) και πατά «Σύνδεση». Ο κωδικός γίνεται μόνιμο
 *      κλειδί, που μένει ΜΟΝΟ στις Ιδιότητες χρήστη του μεσίτη (UserProperties).
 *   3. Μπαίνει trigger κάθε βράδυ (20:00–21:00), στον λογαριασμό του μεσίτη.
 *   4. Κάθε βράδυ: ζητά από την εφαρμογή ό,τι άλλαξε (pcPull), το γράφει στις επαφές του
 *      (νέα επαφή ή προσθήκη στην ομάδα του ακινήτου) και επιβεβαιώνει (pcAck).
 *
 * Κανόνες:
 *   · Επαφή που υπάρχει ήδη (ίδιο τηλέφωνο ή email): ΔΕΝ φτιάχνεται δεύτερη. Μπαίνει στην ομάδα
 *     του ακινήτου και συμπληρώνεται ΜΟΝΟ ό,τι λείπει. Το όνομα δεν αλλάζει ποτέ.
 *   · Τηλέφωνο σε μία επαφή και email σε άλλη: δεν γίνεται τίποτα (σύγκρουση).
 *   · Τίποτα δεν σβήνεται.
 *
 * Ιδιότητα σεναρίου (μία φορά, από τον Admin): KW_API = το /exec URL της εφαρμογής.
 */

const H = {
  GROUP_ALL: 'KW Πελάτες',
  CREATE_CHUNK: 100,      // batchCreateContacts δέχεται έως 200
  MODIFY_CHUNK: 500,      // members.modify δέχεται έως 1000
  PAUSE_MS: 400,          // ανάσα ανάμεσα στις εγγραφές (όρια ανά λεπτό του People API)
  MAX_MS: 4.5 * 60000,    // σταματάμε πριν το όριο των 6 λεπτών· τα υπόλοιπα την επόμενη φορά
  HOUR: 20
};

// ── Σελίδα ────────────────────────────────────────────────────────

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Page');
  t.code = String((e && e.parameter && e.parameter.code) || '').replace(/[^a-f0-9]/gi, '');
  t.state = JSON.stringify(state_()).replace(/</g, '\\u003c');   // ασφαλές μέσα σε <script>
  return t.evaluate().setTitle('KW App · Επαφές κινητού')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function state_() {
  const up = PropertiesService.getUserProperties();
  let last = null;
  try { last = JSON.parse(up.getProperty('LAST') || 'null'); } catch (e) { last = null; }
  return { linked: !!up.getProperty('KEY'), name: up.getProperty('NAME') || '', email: me_(), last: last };
}

function me_() {
  try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/** Από τη σελίδα: σύνδεση με τον κωδικό μίας χρήσης, trigger, πρώτος συγχρονισμός. */
function pair(code) {
  const r = api_('pcPair', { code: code, email: me_() });
  const up = PropertiesService.getUserProperties();
  up.setProperties({ KEY: r.key, NAME: r.name || '' });
  installTrigger_();
  const res = syncSafe_();
  return { state: state_(), res: res };
}

function syncNow() { return { state: state_(), res: syncSafe_() }; }

function unlink() {
  const up = PropertiesService.getUserProperties();
  try { if (up.getProperty('KEY')) api_('pcBye', { key: up.getProperty('KEY') }); } catch (e) { /* συνεχίζουμε */ }
  removeTriggers_();
  up.deleteAllProperties();
  return { state: state_() };
}

// ── Trigger ───────────────────────────────────────────────────────

function installTrigger_() {
  removeTriggers_();
  ScriptApp.newTrigger('nightly').timeBased().everyDays(1).atHour(H.HOUR).create();
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'nightly').forEach(t => ScriptApp.deleteTrigger(t));
}

function nightly() { syncSafe_(); }

function syncSafe_() {
  const up = PropertiesService.getUserProperties();
  let res;
  try {
    res = sync_();
  } catch (e) {
    res = { error: e.message };
    if (e.code === 'auth') { removeTriggers_(); up.deleteAllProperties(); }
    console.warn('Βοηθός επαφών: ' + e.message);
  }
  res.at = Date.now();
  if (up.getProperty('KEY')) up.setProperty('LAST', JSON.stringify(res));
  return res;
}

// ── Επικοινωνία με την εφαρμογή ──────────────────────────────────

function api_(action, data) {
  const url = PropertiesService.getScriptProperties().getProperty('KW_API');
  if (!url) throw new Error('Λείπει η Ιδιότητα σεναρίου KW_API (το /exec URL της εφαρμογής).');
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify({ action: action, data: data })
  });
  let j;
  try { j = JSON.parse(res.getContentText()); } catch (e) { throw new Error('Η εφαρμογή δεν απάντησε σωστά (' + res.getResponseCode() + ').'); }
  if (!j.ok) { const e = new Error(j.error || 'Σφάλμα εφαρμογής'); e.code = j.code || ''; throw e; }
  return j.data;
}

// ── Καθαρή λογική (τη δοκιμάζουν τα tests) ────────────────────────

/** Ίδια λογική με το phoneDigits_ της εφαρμογής: ελληνικά → 10 ψηφία, ξένα → με κωδικό χώρας. */
function digits_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('0030') === 0) d = d.slice(4);
  else if (d.length === 12 && d.indexOf('30') === 0) d = d.slice(2);
  else if (d.indexOf('00') === 0) d = d.slice(2);
  return d;
}

function intl_(d) { return d.length === 10 ? '+30' + d : '+' + d; }

function mail_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

/** Ευρετήριο των επαφών του κινητού: τηλέφωνο → επαφή, email → επαφή. */
function index_(people) {
  const byPhone = {}, byEmail = {};
  people.forEach(p => {
    (p.phoneNumbers || []).forEach(n => { const d = digits_(n.canonicalForm || n.value); if (d.length >= 8 && !byPhone[d]) byPhone[d] = p; });
    (p.emailAddresses || []).forEach(m => { const e = mail_(m.value); if (e && !byEmail[e]) byEmail[e] = p; });
  });
  return { byPhone: byPhone, byEmail: byEmail };
}

/**
 * Τι γίνεται με κάθε επαφή της εφαρμογής: { kind: 'new' } · { kind: 'upd', person } · { kind: 'conflict' }.
 */
function plan_(idx, it) {
  const pm = (it.phones || []).map(p => idx.byPhone[p]).filter(Boolean)[0] || null;
  const em = (it.emails || []).map(e => idx.byEmail[mail_(e)]).filter(Boolean)[0] || null;
  if (pm && em && pm.resourceName !== em.resourceName) return { kind: 'conflict' };
  const p = pm || em;
  return p ? { kind: 'upd', person: p } : { kind: 'new' };
}

/** Ό,τι λείπει από μια υπάρχουσα επαφή: email αν δεν έχει κανένα, τηλέφωνο αν δεν έχει κανένα. */
function fill_(person, it) {
  const out = {};
  if (!(person.emailAddresses || []).length && (it.emails || []).length) out.emailAddresses = it.emails.map(e => ({ value: e }));
  if (!(person.phoneNumbers || []).length && (it.phones || []).length) out.phoneNumbers = it.phones.map(d => ({ value: intl_(d), type: 'mobile' }));
  return out;
}

function newPerson_(it, groupRns) {
  const parts = String(it.name || '').trim().split(/\s+/);
  return {
    names: [{ givenName: parts[0] || it.name, familyName: parts.slice(1).join(' ') }],
    phoneNumbers: (it.phones || []).map(d => ({ value: intl_(d), type: 'mobile' })),
    emailAddresses: (it.emails || []).map(e => ({ value: e })),
    biographies: it.note ? [{ value: it.note, contentType: 'TEXT_PLAIN' }] : [],
    memberships: groupRns.map(rn => ({ contactGroupMembership: { contactGroupResourceName: rn } }))
  };
}

// ── Συγχρονισμός ──────────────────────────────────────────────────

function sync_() {
  const t0 = Date.now();
  const key = PropertiesService.getUserProperties().getProperty('KEY');
  if (!key) throw new Error('Δεν είσαι συνδεδεμένος. Άνοιξε τη σύνδεση από την εφαρμογή.');
  const pull = api_('pcPull', { key: key });
  if (pull.off) return { off: true, added: 0, updated: 0, conflicts: 0 };
  const items = pull.items || [];
  if (!items.length) return { added: 0, updated: 0, conflicts: 0 };

  // 1. Οι επαφές του κινητού (μόνο όσα χρειάζονται για την ταύτιση).
  const people = [];
  let token = null;
  do {
    const o = { personFields: 'names,phoneNumbers,emailAddresses,memberships', pageSize: 1000 };
    if (token) o.pageToken = token;
    const r = People.People.Connections.list('people/me', o);
    (r.connections || []).forEach(p => people.push(p));
    token = r.nextPageToken;
  } while (token);
  const idx = index_(people);

  // 2. Οι ομάδες: «KW Πελάτες» + μία ανά ακίνητο. Όσες λείπουν φτιάχνονται.
  const groups = {};
  token = null;
  do {
    const o = { pageSize: 1000, groupFields: 'name,groupType' };
    if (token) o.pageToken = token;
    const r = People.ContactGroups.list(o);
    (r.contactGroups || []).forEach(g => { if (g.groupType === 'USER_CONTACT_GROUP') groups[g.name] = g.resourceName; });
    token = r.nextPageToken;
  } while (token);
  const groupRn = name => {
    if (!groups[name]) {
      groups[name] = People.ContactGroups.create({ contactGroup: { name: name } }).resourceName;
      Utilities.sleep(H.PAUSE_MS);
    }
    return groups[name];
  };

  const ack = [], updAck = [], toAdd = {}, creates = [];
  let added = 0, updated = 0, conflicts = 0;
  items.forEach(it => {
    const names = [pull.group || H.GROUP_ALL].concat(it.groups || []);
    const p = plan_(idx, it);
    if (p.kind === 'conflict') { conflicts++; ack.push({ id: it.id, h: it.h, st: 'conflict' }); return; }
    const rns = names.map(groupRn);
    if (p.kind === 'upd') {
      const have = (p.person.memberships || []).map(m => m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName);
      rns.filter(rn => have.indexOf(rn) === -1).forEach(rn => { (toAdd[rn] = toAdd[rn] || []).push(p.person.resourceName); });
      const f = fill_(p.person, it);
      if (Object.keys(f).length && Date.now() - t0 < H.MAX_MS) {
        try {
          People.People.updateContact(Object.assign({ etag: p.person.etag }, f), p.person.resourceName,
            { updatePersonFields: Object.keys(f).join(',') });
          Utilities.sleep(H.PAUSE_MS);
        } catch (e) { console.warn('Ενημέρωση επαφής: ' + e.message); }
      }
      updated++;
      updAck.push({ id: it.id, h: it.h, st: 'upd' });
      return;
    }
    creates.push({ it: it, person: newPerson_(it, rns) });
    // Δεύτερη εμφάνιση του ίδιου ανθρώπου στο ίδιο πέρασμα → όχι δεύτερη επαφή.
    const ghost = { resourceName: 'new:' + it.id, phoneNumbers: [], emailAddresses: [] };
    (it.phones || []).forEach(d => { if (!idx.byPhone[d]) idx.byPhone[d] = ghost; });
    (it.emails || []).forEach(e => { if (!idx.byEmail[mail_(e)]) idx.byEmail[mail_(e)] = ghost; });
  });

  // 3. Νέες επαφές, σε δέσμες.
  for (let i = 0; i < creates.length && Date.now() - t0 < H.MAX_MS; i += H.CREATE_CHUNK) {
    const part = creates.slice(i, i + H.CREATE_CHUNK);
    People.People.batchCreateContacts({ contacts: part.map(c => ({ contactPerson: c.person })), readMask: 'names' });
    part.forEach(c => { added++; ack.push({ id: c.it.id, h: c.it.h, st: 'new' }); });
    Utilities.sleep(H.PAUSE_MS);
  }

  // 4. Υπάρχουσες επαφές στις ομάδες των ακινήτων. Επιβεβαιώνονται μόνο αν μπήκαν όλες.
  let all = true;
  Object.keys(toAdd).forEach(rn => {
    const list = toAdd[rn].filter((x, i, a) => a.indexOf(x) === i);
    for (let i = 0; i < list.length; i += H.MODIFY_CHUNK) {
      if (Date.now() - t0 >= H.MAX_MS) { all = false; break; }
      People.ContactGroups.Members.modify({ resourceNamesToAdd: list.slice(i, i + H.MODIFY_CHUNK) }, rn);
      Utilities.sleep(H.PAUSE_MS);
    }
  });
  if (all) updAck.forEach(a => ack.push(a)); else updated = 0;

  api_('pcAck', { key: key, items: ack });
  return { added: added, updated: updated, conflicts: conflicts, more: (pull.more || 0) + (items.length - ack.length) };
}
