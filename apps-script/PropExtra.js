/**
 * 1.23 · Ακίνητο: «Απαραίτητα έγγραφα» + «Σημειώσεις» (PropExtra.gs, ΚΑΤΩ από το Code.gs)
 * ─────────────────────────────────────────────────────────────
 * 1) Απαραίτητα έγγραφα (set 'req' στις ενέργειες docs / upload / docDelete του Code.gs)
 *    Τίτλος ιδιοκτησίας, Πρόσφατο Ε9, Κτηματολογικό φύλλο, Κατόψεις. Πολλά αρχεία σε κάθε θέση.
 *    Φάκελος: «Απαραίτητα έγγραφα» μέσα στον φάκελο του ακινήτου (δίπλα στο «Έγγραφα KWAC»),
 *    φτιάχνεται με το πρώτο αρχείο.
 *    Ονόματα: «Τίτλος ιδιοκτησίας» → με το 2ο αρχείο το πρώτο γίνεται «… (1)» και το νέο «… (2)».
 *    Ο μεσίτης μπορεί μετά να τα μετονομάσει στο Drive: η θέση του αρχείου κρατιέται στην
 *    ΠΕΡΙΓΡΑΦΗ του αρχείου ([KW:title]), όχι στο όνομα. Αρχεία χωρίς ετικέτα (μπήκαν με το χέρι)
 *    αναγνωρίζονται από το όνομα, αλλιώς εμφανίζονται στο «Άλλα αρχεία».
 *    Δεν πάνε για έλεγχο στον Admin (δεν χρειάζονται για να βγει live το ακίνητο).
 *
 * 2) Σημειώσεις ακινήτου: pnotes { code } · pnoteAdd { code, text, reqId } · pnoteDel { code, id }
 *    Φύλλο «Σημειώσεις ακινήτων»: ΜΙΑ γραμμή ανά ακίνητο, οι σημειώσεις ως JSON σε ένα κελί
 *    (ίδιο σχήμα με το Marketing): το φύλλο μεγαλώνει με τα ακίνητα, όχι με τη χρήση.
 *    Ευρετήριο κωδικός → γραμμή στην cache, με έλεγχο ότι η γραμμή έχει ακόμα τον ίδιο κωδικό.
 *    Βλέπουν/γράφουν: ο μεσίτης, η ομάδα του και ο Admin (canSeeProp_). Σβήνει: ο συντάκτης ή ο Admin.
 *    reqId: αν το ίδιο αίτημα φτάσει δύο φορές (κακό σήμα), γράφεται μία.
 *    GDPR: ΑΦΜ (9 ψηφία) και αριθμοί ταυτότητας σβήνονται πριν γραφτούν. Τηλέφωνα μένουν.
 */

const REQ = {
  FOLDER: 'Απαραίτητα έγγραφα',
  DOCS: [
    { key: 'title', label: 'Τίτλος ιδιοκτησίας',  file: 'Τίτλος ιδιοκτησίας',  multi: true },
    { key: 'e9',    label: 'Πρόσφατο Ε9',         file: 'Ε9',                 multi: true },
    { key: 'ktima', label: 'Κτηματολογικό φύλλο', file: 'Κτηματολογικό φύλλο', multi: true },
    { key: 'plans', label: 'Κατόψεις',            file: 'Κάτοψη',             multi: true }
  ],
  TAG_RE: /\[KW:([a-z0-9]+)\]/i
};

const PNOTE = {
  SHEET: 'Σημειώσεις ακινήτων',
  HEADERS: ['Κωδικός', 'Σημειώσεις', 'Πλήθος', 'Ενημέρωση', 'rev'],
  TEXT_MAX: 1000,
  CELL_MAX: 45000          // όριο κελιού Google Sheets: 50.000 χαρακτήρες
};

(function () {
  try {
    ACTIONS.pnotes = actPnotes_;
    ACTIONS.pnoteAdd = actPnoteAdd_;
    ACTIONS.pnoteDel = actPnoteDel_;
    FLAG_ACTIONS.pnotes = FLAG_ACTIONS.pnoteAdd = FLAG_ACTIONS.pnoteDel = 'propNotes';   // 2.14.1: έλεγχος και στον server
  } catch (e) {
    console.error('PropExtra.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs (⋮ → Μετακίνηση κάτω).');
  }
})();

// ═══ 1. Απαραίτητα έγγραφα ═══════════════════════════════════

function reqSlot_(key) { return REQ.DOCS.find(s => s.key === key) || null; }

function reqFolder_(propF, create) {
  return childByName_(propF, REQ.FOLDER) || (create ? propF.createFolder(REQ.FOLDER) : null);
}

/** Θέση ενός αρχείου: από την ετικέτα της περιγραφής, αλλιώς από το όνομα. */
function reqSlotOf_(description, name) {
  const m = String(description || '').match(REQ.TAG_RE);
  return (m && reqSlot_(m[1].toLowerCase())) || slotOfName_(REQ.DOCS, name) || null;
}

/**
 * Το όνομα του νέου αρχείου, από τα ονόματα που υπάρχουν ήδη στη θέση.
 *  []                         → { name: 'Ε9', first: false }
 *  ['Ε9.pdf']                 → { name: 'Ε9 (2)', first: true }   (το πρώτο γίνεται «Ε9 (1)»)
 *  ['Ε9 (1).pdf','Ε9 (2).pdf']→ { name: 'Ε9 (3)', first: false }
 *  ['Δικό μου.pdf']           → { name: 'Ε9 (2)', first: false }  (μετονομασμένο στο Drive: δεν το αγγίζουμε)
 */
function reqNames_(base, names) {
  const stem = names.map(n => String(n).replace(/\.[^.]+$/, ''));
  if (!stem.length) return { name: base, first: false };
  const first = stem.indexOf(base) !== -1 && stem.indexOf(base + ' (1)') === -1;
  const used = stem.map(s => (first && s === base ? base + ' (1)' : s));
  let n = stem.length + 1;
  while (used.indexOf(base + ' (' + n + ')') !== -1) n++;
  return { name: base + ' (' + n + ')', first: first };
}

/** { docs: { title: [...], ... }, other: [...] } ζωντανά από το Drive. */
function reqList_(folder) {
  const docs = {};
  REQ.DOCS.forEach(s => { docs[s.key] = []; });
  const other = [];
  if (!folder) return { docs: docs, other: other };
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (String(f.getName()).indexOf(REQ_TMP) === 0) continue;   // ανεβαίνει ακόμα (ή κόπηκε): δεν μετρά
    let desc = '';
    try { desc = f.getDescription(); } catch (e) { /* χωρίς περιγραφή */ }
    const slot = reqSlotOf_(desc, f.getName());
    const created = f.getDateCreated();
    const item = { id: f.getId(), name: f.getName(), url: f.getUrl(), ts: created.getTime(),
                   date: stamp_(created), size: f.getSize(), mime: f.getMimeType() };
    (slot ? docs[slot.key] : other).push(item);
  }
  const by = (a, b) => (a.ts - b.ts) || a.name.localeCompare(b.name);
  Object.keys(docs).forEach(k => docs[k].sort(by));
  other.sort(by);
  return { docs: docs, other: other };
}

function reqResult_(p, f) {
  const folder = reqFolder_(f.folder, false);
  const l = reqList_(folder);
  const counts = {};
  REQ.DOCS.forEach(s => { counts[s.key] = l.docs[s.key].length; });
  return { code: p.code, set: 'req', folderUrl: f.folder.getUrl(), docsUrl: folder ? folder.getUrl() : '',
           docs: l.docs, other: l.other, counts: counts };
}

/** 2.14.1 · Προσωρινό όνομα αρχείου που ανεβαίνει ακόμα. Το reqList_ το αγνοεί, άρα δεν μετρά στην αρίθμηση. */
const REQ_TMP = '~ανεβαίνει-';

/**
 * Από το actUpload_ του Code.gs, αφού έχουν ελεγχθεί δικαίωμα, μέγεθος και τύπος.
 * 2.14.1 · QA W47 #6: το αργό κομμάτι (createFile έως 20MB) γίνεται ΕΞΩ από το γενικό κλείδωμα, με προσωρινό
 * όνομα. Μέσα στο κλείδωμα μόνο τα γρήγορα: λίστα του φακέλου, αρίθμηση, μετονομασία. Έτσι οι εγγραφές των
 * άλλων μεσιτών δεν περιμένουν το ανέβασμα και δύο ανεβάσματα μαζί δεν παίρνουν ποτέ τον ίδιο αριθμό.
 */
function reqUpload_(agent, p, f, slot, bytes, mime, d) {
  const ext = EXT_BY_MIME[mime];
  const lock = LockService.getScriptLock();

  lock.waitLock(20000);        // σύντομο: μόνο για να μη φτιαχτούν δύο φάκελοι «Απαραίτητα» μαζί
  let folder;
  try { folder = reqFolder_(f.folder, true); } finally { lock.releaseLock(); }

  const file = folder.createFile(Utilities.newBlob(bytes, mime, REQ_TMP + Utilities.getUuid() + ext));   // χωρίς κλείδωμα

  try {
    lock.waitLock(20000);
  } catch (e) {
    try { file.setTrashed(true); } catch (x) { /* θα το αγνοεί η λίστα */ }
    throw e;
  }
  let named = false;
  try {
    const existing = reqList_(folder).docs[slot.key];
    const nm = reqNames_(slot.file, existing.map(x => x.name));

    if (nm.first) {
      const old = existing.find(x => x.name.replace(/\.[^.]+$/, '') === slot.file);
      try {
        const oext = (old.name.match(/\.[^.]+$/) || [''])[0];
        DriveApp.getFileById(old.id).setName(slot.file + ' (1)' + oext);
      } catch (e) { console.warn('Μετονομασία «(1)»: ' + e.message); }
    }

    file.setName(nm.name + ext);
    named = true;
    try {
      file.setDescription('[KW:' + slot.key + '] ' + slot.label + ' · ανέβηκε από ' + agent.name + ' στις ' +
                          stamp_(new Date()) + (d.name ? ' · αρχικό όνομα: ' + String(d.name).slice(0, 120) : ''));
    } catch (e) { /* όχι κρίσιμο: θα αναγνωριστεί από το όνομα */ }
  } finally {
    lock.releaseLock();
    if (!named) { try { file.setTrashed(true); } catch (x) { /* η λίστα το αγνοεί ούτως ή άλλως */ } }
  }
  return reqResult_(p, f);
}

// ═══ 2. Σημειώσεις ακινήτου ══════════════════════════════════

function pnSheet_() { return ensureSheet_(PNOTE.SHEET, PNOTE.HEADERS); }

function pnIndex_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const c = cache.get('pn:idx');
    if (c) return JSON.parse(c);
  }
  const sh = pnSheet_();
  const n = sh.getLastRow() - 1;
  const idx = {};
  if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach((r, i) => { const k = normCode_(r[0]); if (k) idx[k] = i + 2; });
  const s = JSON.stringify(idx);
  if (s.length < 90000) cache.put('pn:idx', s, 21600);
  return idx;
}

/** Η γραμμή του ακινήτου, ή null. Διαβάζει ΜΙΑ γραμμή. */
function pnRead_(code) {
  const key = normCode_(code);
  const sh = pnSheet_();
  const get = idx => {
    const row = idx[key];
    if (!row || row > sh.getLastRow()) return null;
    const v = sh.getRange(row, 1, 1, PNOTE.HEADERS.length).getValues()[0];
    if (normCode_(v[0]) !== key) return undefined;             // μετακινήθηκε με το χέρι
    let notes = [];
    try { notes = JSON.parse(v[1] || '[]') || []; } catch (e) { notes = []; }
    return { row: row, notes: Array.isArray(notes) ? notes : [], rev: Number(v[4]) || 0 };
  };
  const idx = pnIndex_(false);
  let r = get(idx);
  if (r === undefined || (r === null && idx[key])) r = get(pnIndex_(true));
  return r || null;
}

/** Μία εγγραφή = ένα setValues. */
function pnWrite_(code, cur, notes) {
  const json = JSON.stringify(notes);
  if (json.length > PNOTE.CELL_MAX) throw new Error('Πολλές σημειώσεις σε αυτό το ακίνητο. Σβήσε μερικές παλιές.');
  const sh = pnSheet_();
  const vals = [safe_(String(code)), json, notes.length, new Date(), (cur ? cur.rev : 0) + 1];
  if (cur) sh.getRange(cur.row, 1, 1, vals.length).setValues([vals]);
  else {
    sh.appendRow(vals);
    CacheService.getScriptCache().remove('pn:idx');
  }
  return vals[4];
}

/** ΑΦΜ και Α.Δ.Τ. σβήνονται (δεν χρειάζονται σε σημείωση ακινήτου). Τα τηλέφωνα (10 ψηφία) μένουν. */
function pnClean_(s) {
  let t = String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, PNOTE.TEXT_MAX);
  const before = t;
  // 2.14.1: ίδιος κανόνας Α.Δ.Τ. με το scrubIds_ (ΚΕΦΑΛΑΙΑ, αρχή λέξης, όχι δίπλα σε €), ώστε «σε 180000» να μένει
  t = t.replace(ID_ADT_RX, (m, pre, at, all) => idIsMoney_(all, at, m.length) ? m : pre + '•••')       // Α.Δ.Τ.
       .replace(/(^|[^\d])\d{9}(?!\d)/g, (m, pre, at, all) =>                                          // ΑΦΜ
         idIsMoney_(all, at + pre.length, m.length - pre.length) ? m : pre + '•••');
  return { text: t, masked: t !== before };
}

function pnPublic_(n, user) {
  const admin = isAdmin_(user);
  return { id: n.id, text: n.t, by: n.by, at: n.at,
           mine: String(n.em || '').toLowerCase() === String(user.email || '').toLowerCase(),
           canDel: admin || String(n.em || '').toLowerCase() === String(user.email || '').toLowerCase() };
}

function pnOut_(cur, user, extra) {
  const notes = (cur ? cur.notes : []).slice().sort((a, b) => b.at - a.at).map(n => pnPublic_(n, user));
  return Object.assign({ notes: notes, rev: cur ? cur.rev : 0 }, extra || {});
}

function actPnotes_(agent, d) {
  const p = canSeeProp_(agent, d.code);
  return pnOut_(pnRead_(p.code), agent);
}

function actPnoteAdd_(agent, d) {
  const p = canSeeProp_(agent, d.code);
  const c = pnClean_(d.text);
  if (!c.text) throw new Error('Η σημείωση είναι κενή.');
  const id = /^[A-Za-z0-9_-]{6,40}$/.test(String(d.reqId || '')) ? String(d.reqId) : Utilities.getUuid();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = pnRead_(p.code);
    const notes = cur ? cur.notes.slice() : [];
    if (!notes.some(n => n.id === id)) {                     // ίδιο reqId = ήδη γραμμένη
      notes.push({ id: id, t: c.text, by: agent.name, em: String(agent.email || ''), at: Date.now() });
      pnWrite_(p.code, cur, notes);
    }
    return pnOut_(pnRead_(p.code), agent, { masked: c.masked });
  } finally {
    lock.releaseLock();
  }
}

function actPnoteDel_(agent, d) {
  const p = canSeeProp_(agent, d.code);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = pnRead_(p.code);
    const n = cur && cur.notes.find(x => x.id === String(d.id || ''));
    if (!n) return pnOut_(cur, agent);                     // ήδη σβησμένη
    const own = String(n.em || '').toLowerCase() === String(agent.email || '').toLowerCase();
    if (!own && !isAdmin_(agent)) throw new Error('Σβήνει μόνο όποιος την έγραψε ή ο Admin.');
    pnWrite_(p.code, cur, cur.notes.filter(x => x.id !== n.id));
    return pnOut_(pnRead_(p.code), agent);
  } finally {
    lock.releaseLock();
  }
}

/** Τρέξ' το μία φορά μετά την εγκατάσταση. */
function propExtraCheck() {
  const ok = typeof ACTIONS !== 'undefined' && ACTIONS.pnoteAdd === actPnoteAdd_;
  console.log((ok ? '✓ Η εφαρμογή βρίσκει Σημειώσεις και Απαραίτητα έγγραφα.'
                  : '✗ Το PropExtra.gs πρέπει να είναι ΚΑΤΩ από το Code.gs (⋮ → Μετακίνηση κάτω).') +
    '\nΦύλλο «' + PNOTE.SHEET + '»: φτιάχνεται μόνο του με την πρώτη σημείωση.' +
    '\nΦάκελος «' + REQ.FOLDER + '»: φτιάχνεται σε κάθε ακίνητο με το πρώτο αρχείο.');
}
