/**
 * 2.10 · Marketing: προωθητικά ανά ακίνητο (Marketing.gs, ΚΑΤΩ από το Code.gs)
 *
 * Η εικόνα φτιάχνεται στο κινητό (mkt.js). Εδώ μόνο:
 *   mktGet   { code }                       → περιγραφή, λινκ, μετρήσεις, λίστα προτύπων
 *   mktSave  { code, desc, link, deal, rev } → μόνο ο μεσίτης του ακινήτου
 *   mktAsset { kind:'bg', tpl } | { kind:'agent', code } → εικόνα ως data URI
 *   mktLog   { code, tpl, ev:'dl'|'sh' }     → +1 στις μετρήσεις
 *
 * Αποθήκευση: φύλλο «Marketing», ΜΙΑ γραμμή ανά ακίνητο (όχι γραμμή ανά ενέργεια), ώστε να μη
 *   μεγαλώνει με τη χρήση. Οι μετρήσεις είναι JSON σε ένα κελί. Ευρετήριο κωδικός → γραμμή στην cache,
 *   με έλεγχο ότι η γραμμή έχει ακόμα τον ίδιο κωδικό (αν κάποιος μετακινήσει γραμμές με το χέρι).
 *
 * Πρότυπα: φάκελος Drive (Ιδιότητα MKT_FOLDER_ID) με ζεύγη <id>.json + φόντο .png.
 *   Υποφάκελος «Μεσίτες»: φωτογραφία κάθε μεσίτη (PNG χωρίς φόντο) με όνομα όπως στη στήλη
 *   Συνεργάτης, π.χ. «Ξενοφών Ζαδές.png». Τόνοι και κεφαλαία δεν παίζουν ρόλο.
 * Ρυθμίσεις (Ιδιότητες σεναρίου, όλες προαιρετικές εκτός από τον φάκελο):
 *   MKT_FOLDER_ID   φάκελος προτύπων (τον φτιάχνει η setupMarketing)
 *   MKT_TAGS        hashtags στο τέλος της λεζάντας, π.χ. «#kwathenscenter #ακίνητα»
 *   MKT_LINK_HOSTS  επιτρεπτά domains για το λινκ (κόμμα), π.χ. «kwac.gr, zadeshome.com». Κενό = όλα.
 */

const MKT = {
  SHEET: 'Marketing',
  HEADERS: ['Κωδικός', 'Μεσίτης', 'Περιγραφή', 'Λινκ', 'Συναλλαγή', 'Μετρήσεις', 'Ενημέρωση', 'rev'],
  COL: { CODE: 1, AGENT: 2, DESC: 3, LINK: 4, DEAL: 5, STATS: 6, UPDATED: 7, REV: 8 },
  DESC_MAX: 260,
  LINK_MAX: 500,
  AGENTS_DIR: 'Μεσίτες',
  ASSET_MAX: 3 * 1024 * 1024,     // πάνω από αυτό το data URI βαραίνει την απάντηση· το λέμε στον Admin
  TPL_CACHE_SEC: 21600,
  DEALS: ['', 'Πώληση', 'Ενοικίαση'],
  EVENTS: { dl: 1, sh: 1 }
};

(function () {
  try {
    ACTIONS.mktGet = actMktGet_;
    ACTIONS.mktSave = actMktSave_;
    ACTIONS.mktAsset = actMktAsset_;
    ACTIONS.mktLog = actMktLog_;
    FLAG_ACTIONS.mktGet = FLAG_ACTIONS.mktSave = FLAG_ACTIONS.mktAsset = FLAG_ACTIONS.mktLog = 'marketing';   // 2.14.1
  } catch (e) {
    console.error('Marketing.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

function mktProp_(k) { return String(PropertiesService.getScriptProperties().getProperty(k) || '').trim(); }

// ── Ενέργειες ────────────────────────────────────────────────────────

function actMktGet_(agent, d) {
  const p = canSeeProp_(agent, d.code);
  const r = mktRead_(p.code);
  return {
    code: p.code,
    mine: norm_(p.partner) === norm_(agent.name),
    desc: r ? r.desc : '',
    link: r ? r.link : '',
    deal: r ? r.deal : '',
    rev: r ? r.rev : 0,
    stats: r ? r.stats : {},
    templates: mktTemplates_(),
    tags: mktProp_('MKT_TAGS'),
    hosts: mktHosts_(),
    descMax: MKT.DESC_MAX
  };
}

function actMktSave_(agent, d) {
  const p = myProp_(agent, d.code);
  const desc = mktCleanText_(d.desc, MKT.DESC_MAX);
  const link = mktCleanLink_(d.link);
  const deal = d.deal === undefined ? null : String(d.deal || '');
  if (deal !== null && MKT.DEALS.indexOf(deal) === -1) throw new Error('Άγνωστη συναλλαγή.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = mktRead_(p.code);
    // Έλεγχος rev: δύο συσκευές του ίδιου μεσίτη δεν σβήνουν σιωπηλά η μία την άλλη.
    if (cur && d.rev != null && Number(d.rev) !== cur.rev) {
      const e = new Error('Η περιγραφή άλλαξε από άλλη συσκευή. Κλείσε και ξανάνοιξε το ακίνητο.');
      e.code = 'rev';
      throw e;
    }
    const row = {
      code: p.code, agent: agent.name, desc: desc, link: link,
      deal: deal === null ? (cur ? cur.deal : '') : deal,
      stats: cur ? cur.stats : {}, rev: (cur ? cur.rev : 0) + 1
    };
    mktWrite_(row, cur ? cur.row : 0);
    log_('Marketing', agent.name, p.code + ' · περιγραφή/λινκ');
    return { desc: row.desc, link: row.link, deal: row.deal, rev: row.rev };
  } finally {
    lock.releaseLock();
  }
}

function actMktAsset_(agent, d) {
  const folder = mktFolder_();
  if (d.kind === 'bg') {
    const t = mktTemplates_().filter(x => x.id === String(d.tpl || ''))[0];
    if (!t) throw new Error('Το πρότυπο δεν βρέθηκε.');
    const f = mktFile_(folder, t.bg);
    if (!f) throw new Error('Λείπει το φόντο «' + t.bg + '» στον φάκελο Marketing.');
    return { src: mktDataUri_(f), v: t.v || 1 };
  }
  if (d.kind === 'agent') {
    const p = canSeeProp_(agent, d.code);
    const f = mktAgentPhoto_(folder, p.partner);
    return { src: f ? mktDataUri_(f) : '' };
  }
  throw new Error('Άγνωστο αίτημα.');
}

function actMktLog_(agent, d) {
  const p = canSeeProp_(agent, d.code);
  const ev = String(d.ev || '');
  const tpl = String(d.tpl || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!MKT.EVENTS[ev] || !tpl) throw new Error('Μη έγκυρη μέτρηση.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = mktRead_(p.code);
    const row = cur || { code: p.code, agent: p.partner || '', desc: '', link: '', deal: '', stats: {}, rev: 0 };
    row.stats = mktBump_(row.stats, ev, tpl, new Date());
    mktWrite_(row, cur ? cur.row : 0);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// ── Καθαρή λογική (ελέγχεται στα tests) ──────────────────────────────

/** Κείμενο από τον μεσίτη: χωρίς χαρακτήρες ελέγχου, μέχρι max, με το πολύ 2 κενές γραμμές στη σειρά. */
function mktCleanText_(s, max) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** Ίδιοι κανόνες με το checkLink του mkt.js. Κενό επιτρέπεται (= χωρίς QR). */
function mktCleanLink_(s) {
  let url = String(s == null ? '' : s).trim();
  if (!url) return '';
  if (url.length > MKT.LINK_MAX) throw new Error('Το λινκ είναι πολύ μεγάλο.');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const m = /^https?:\/\/([^\/?#\s:@]+)(:\d+)?([\/?#][^\s]*)?$/i.exec(url);
  if (!m || m[1].indexOf('.') === -1) throw new Error('Δεν μοιάζει με λινκ.');
  const host = m[1].toLowerCase().replace(/^www\./, '');
  const hosts = mktHosts_();
  if (hosts.length && !hosts.some(h => host === h || host.slice(-h.length - 1) === '.' + h)) {
    throw new Error('Επιτρέπονται λινκ μόνο από: ' + hosts.join(', ') + '.');
  }
  return url;
}

function mktHosts_() {
  return mktProp_('MKT_LINK_HOSTS').split(',').map(h => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
}

/** { dl: { story: 3 }, sh: {...}, last } + 1. */
function mktBump_(stats, ev, tpl, when) {
  const s = stats && typeof stats === 'object' ? JSON.parse(JSON.stringify(stats)) : {};
  s[ev] = s[ev] || {};
  s[ev][tpl] = (Number(s[ev][tpl]) || 0) + 1;
  s.last = Utilities.formatDate(when, TZ, "yyyy-MM-dd'T'HH:mm");
  return s;
}

// ── Φύλλο «Marketing» ────────────────────────────────────────────────

function mktSheet_() { return ensureSheet_(MKT.SHEET, MKT.HEADERS); }

/** Ευρετήριο κωδικός → γραμμή. Μία ανάγνωση της στήλης Α, μετά από την cache. */
function mktIndex_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const c = cache.get('mkt:idx');
    if (c) return JSON.parse(c);
  }
  const sh = mktSheet_();
  const n = sh.getLastRow() - 1;
  const idx = {};
  if (n > 0) sh.getRange(2, MKT.COL.CODE, n, 1).getValues().forEach((r, i) => { const k = normCode_(r[0]); if (k) idx[k] = i + 2; });
  const s = JSON.stringify(idx);
  if (s.length < 90000) cache.put('mkt:idx', s, 21600);
  return idx;
}

function mktRead_(code) {
  const key = normCode_(code);
  const sh = mktSheet_();
  const get = idx => {
    const row = idx[key];
    if (!row || row > sh.getLastRow()) return null;
    const v = sh.getRange(row, 1, 1, MKT.HEADERS.length).getValues()[0];
    if (normCode_(v[0]) !== key) return undefined;            // μετακινήθηκε: ξαναχτίζουμε το ευρετήριο
    let stats = {};
    try { stats = JSON.parse(v[MKT.COL.STATS - 1] || '{}') || {}; } catch (e) { stats = {}; }
    return { row: row, code: String(v[0]), agent: String(v[1] || ''), desc: String(v[2] || ''), link: String(v[3] || ''),
      deal: String(v[4] || ''), stats: stats, rev: Number(v[MKT.COL.REV - 1]) || 0 };
  };
  const idx = mktIndex_(false);
  let r = get(idx);
  if (r === undefined || (r === null && idx[key])) r = get(mktIndex_(true));
  return r || null;
}

/** Μία εγγραφή = ένα setValues. row 0 = νέα γραμμή στο τέλος. */
function mktWrite_(r, row) {
  const sh = mktSheet_();
  const vals = [safe_(String(r.code)), safe_(r.agent || ''), safe_(r.desc || ''), safe_(r.link || ''), r.deal || '',
    JSON.stringify(r.stats || {}), new Date(), r.rev || 0];
  if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  else {
    sh.appendRow(vals);
    CacheService.getScriptCache().remove('mkt:idx');
  }
}

// ── Drive: πρότυπα και φωτογραφίες μεσιτών ───────────────────────────

function mktFolder_() {
  const id = mktProp_('MKT_FOLDER_ID');
  if (!id) throw new Error('Το Marketing δεν έχει ρυθμιστεί ακόμα (MKT_FOLDER_ID).');
  return DriveApp.getFolderById(id);
}

function mktFile_(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

/** Όλα τα <id>.json του φακέλου, μία φορά ανά 6 ώρες (ή όταν τρέξει η mktCheck). */
function mktTemplates_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('mkt:tpl');
  if (c) return JSON.parse(c);
  const out = [];
  let folder;
  try { folder = mktFolder_(); } catch (e) { return []; }
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/\.json$/i.test(f.getName())) continue;
    try {
      const t = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      if (t && t.id && t.bg && Array.isArray(t.layers) && t.off !== true) out.push(t);
    } catch (e) {
      console.error('Marketing: το ' + f.getName() + ' δεν είναι έγκυρο JSON: ' + e.message);
    }
  }
  out.sort((a, b) => (a.order || 99) - (b.order || 99) || String(a.name).localeCompare(String(b.name)));
  const s = JSON.stringify(out);
  if (s.length < 90000) cache.put('mkt:tpl', s, MKT.TPL_CACHE_SEC);
  return out;
}

function mktAgentPhoto_(folder, name) {
  const key = norm_(name);
  if (!key) return null;
  const dirs = folder.getFoldersByName(MKT.AGENTS_DIR);
  if (!dirs.hasNext()) return null;
  const it = dirs.next().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/^image\//.test(f.getMimeType())) continue;
    if (norm_(f.getName().replace(/\.[^.]+$/, '')) === key) return f;
  }
  return null;
}

function mktDataUri_(f) {
  if (f.getSize() > MKT.ASSET_MAX) throw new Error('Η εικόνα «' + f.getName() + '» είναι πάνω από 3MB. Μίκρυνέ την.');
  const b = f.getBlob();
  return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}

// ── Εγκατάσταση και έλεγχος (τρέχουν από τον επεξεργαστή) ────────────

/** Μία φορά: φτιάχνει τον φάκελο «KW App · Marketing» με τον υποφάκελο «Μεσίτες» και το φύλλο. */
function setupMarketing() {
  const props = PropertiesService.getScriptProperties();
  let folder = null;
  const id = mktProp_('MKT_FOLDER_ID');
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('KW App · Marketing');
    props.setProperty('MKT_FOLDER_ID', folder.getId());
  }
  if (!folder.getFoldersByName(MKT.AGENTS_DIR).hasNext()) folder.createFolder(MKT.AGENTS_DIR);
  mktSheet_();
  console.log('Φάκελος Marketing: ' + folder.getUrl());
  console.log('Ανέβασε εκεί τα <id>.json και τα φόντα .png. Στον υποφάκελο «' + MKT.AGENTS_DIR + '» τις φωτογραφίες των μεσιτών.');
  mktCheck();
}

/** Τι βρέθηκε και τι λείπει. Αδειάζει και την cache των προτύπων, οπότε αλλαγές φαίνονται αμέσως. */
function mktCheck() {
  CacheService.getScriptCache().remove('mkt:tpl');
  const folder = mktFolder_();
  const tpls = mktTemplates_();
  console.log('Πρότυπα: ' + (tpls.length ? tpls.map(t => t.id + ' (v' + (t.v || 1) + ')').join(', ') : 'ΚΑΝΕΝΑ'));
  tpls.forEach(t => {
    const f = mktFile_(folder, t.bg);
    console.log('  ' + t.id + ': φόντο ' + (f ? 'OK (' + Math.round(f.getSize() / 1024) + ' KB)' : 'ΛΕΙΠΕΙ «' + t.bg + '»'));
  });
  const props = readProps_();
  const team = Object.keys(props).map(k => props[k].partner).filter(Boolean)
    .filter((n, i, a) => a.findIndex(x => norm_(x) === norm_(n)) === i);
  const missing = team.filter(n => !mktAgentPhoto_(folder, n));
  console.log('Φωτογραφίες μεσιτών: ' + (team.length - missing.length) + ' από ' + team.length +
    (missing.length ? '. Λείπουν: ' + missing.slice(0, 20).join(', ') + (missing.length > 20 ? '…' : '') : ''));
}
