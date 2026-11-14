/**
 * 2.6 · FEAT-12 · Μείωση τιμής → ειδοποίηση σε όσους ενδιαφέρθηκαν (flag priceDrop)
 *
 * Μία φορά το πρωί (μέσα στο morningBrief): συγκρίνει την τιμή κάθε διαθέσιμου ακινήτου
 * με τη χθεσινή. Μείωση ≥ 2% → μία ειδοποίηση στον μεσίτη του ακινήτου, με λίστα πελατών:
 * όσοι κάλεσαν για αυτό (τελευταίοι 2 μήνες) ή είδαν το ακίνητο χωρίς «Ενδιαφέρθηκε».
 * Πρώτα όσοι έχουν budget ≥ νέα τιμή. Το SMS το στέλνει ο μεσίτης (όχι αυτόματα).
 * Αύξηση τιμής: τίποτα.
 *
 * Κόστος: 0 επιπλέον αναγνώσεις φύλλων (κλήσεις, ακίνητα και προφίλ είναι ήδη στο cache).
 * Οι τιμές της χθες μένουν σε Ιδιότητα σεναρίου (PRICE_LAST_*), όχι σε νέο φύλλο.
 */

const DROP = {
  KEY: 'PRICE_LAST',
  LIST_KEY: 'DROP_LIST:',       // + email → JSON λίστα για την εφαρμογή
  MIN: 0.02,                    // AC2: τουλάχιστον 2%
  KEEP_DAYS: 14,
  LIST_MAX: 10
};

(function () {
  try {
    ACTIONS.dropDone = actDropDone_;
  } catch (e) {
    console.error('Drops.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

// ── Καθαρή λογική ─────────────────────────────────────────────────────

/** "A1:250000,B7:900" ↔ { A1: 250000, B7: 900 } */
function dropParse_(s) {
  const out = {};
  String(s || '').split(',').forEach(x => {
    const i = x.lastIndexOf(':');
    if (i > 0) out[x.slice(0, i)] = Number(x.slice(i + 1)) || 0;
  });
  return out;
}

function dropFormat_(m) {
  return Object.keys(m).map(k => k + ':' + m[k]).join(',');
}

/** [{ key, p, old, now }] μόνο για μειώσεις ≥ 2%. */
function dropFind_(last, props) {
  const out = [];
  Object.keys(props).forEach(k => {
    const p = props[k];
    if (!p.available) return;
    const now = matchNum_(p.price), old = last[k];
    if (old && now && now <= old * (1 - DROP.MIN)) out.push({ key: k, p: p, old: old, now: now });
  });
  return out;
}

/** Πελάτες για ένα ακίνητο που έπεσε η τιμή. leads: οι κλήσεις του μεσίτη. */
function dropClients_(d, leads, profiles, status, outcome) {
  const seen = {}, out = [];
  leads.forEach(l => {
    if (normCode_(l.code) !== d.key) return;
    if (status(l.id) === STATUS.CLOSED || outcome(l.id) === 'Ενδιαφέρθηκε') return;
    const key = l.phone || l.id;
    if (seen[key]) return;
    seen[key] = 1;
    const pf = profiles[l.id] || {};
    const budget = matchNum_(d.p.deal === 'Ενοικίαση' ? pf.budgetRent : pf.budgetBuy);
    const fits = !!budget && budget >= d.now && budget < d.old;
    const why = fits ? 'budget ' + matchMoney_(budget) + ' · τώρα το καλύπτει'
      : budget ? 'budget ' + matchMoney_(budget)
      : outcome(l.id) ? 'υπόδειξη · ' + outcome(l.id) : 'κάλεσε για το ακίνητο';
    out.push({ id: l.id, name: l.name || 'Χωρίς όνομα', why: why, fits: fits });
  });
  return out.sort((a, b) => (b.fits ? 1 : 0) - (a.fits ? 1 : 0)).slice(0, 12);
}

// ── Αποθήκευση ───────────────────────────────────────────────────────

function dropLastGet_() {
  const n = Number(prop_(DROP.KEY + '_N', '0'));
  if (!n) return null;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(PROPS_[DROP.KEY + '_' + i] || '');
  return dropParse_(parts.join(','));
}

function dropLastSet_(props) {
  const m = {};
  Object.keys(props).forEach(k => { const n = matchNum_(props[k].price); if (props[k].available && n) m[k] = Math.round(n); });
  // Κομμάτια ≤ 8.000 χαρακτήρων (όριο Google 9KB ανά Ιδιότητα), χωρίς να σπάει «κωδικός:τιμή».
  const parts = [''];
  Object.keys(m).forEach(k => {
    const x = k + ':' + m[k];
    const cur = parts[parts.length - 1];
    if (cur && cur.length + x.length + 1 > MATCH.CHUNK) parts.push(x);
    else parts[parts.length - 1] = cur ? cur + ',' + x : x;
  });
  const out = {};
  parts.forEach((x, i) => { out[DROP.KEY + '_' + i] = x; });
  out[DROP.KEY + '_N'] = String(parts.length);
  PropertiesService.getScriptProperties().setProperties(out);
}

function dropListGet_(agent) {
  try { return JSON.parse(PROPS_[DROP.LIST_KEY + String(agent.email || '').toLowerCase()] || '[]'); }
  catch (e) { return []; }
}

function dropListSet_(agent, list) {
  const k = DROP.LIST_KEY + String(agent.email || '').toLowerCase();
  PROPS_[k] = JSON.stringify(list.slice(0, DROP.LIST_MAX));
  PropertiesService.getScriptProperties().setProperty(k, PROPS_[k]);
}

/** Για το bootstrap. Τα ονόματα έρχονται από τις κλήσεις του μεσίτη (δεν τα κρατάμε στις Ιδιότητες). */
function dropsFor_(agent) {
  if (!featureFlags_(agent).priceDrop) return [];
  const limit = Date.now() - DROP.KEEP_DAYS * 86400000;
  const props = readProps_();
  return dropListGet_(agent).filter(d => d.at >= limit && props[normCode_(d.code)]);
}

function actDropDone_(agent, d) {
  const list = dropListGet_(agent).filter(x => x.code !== String(d.code || ''));
  dropListSet_(agent, list);
  return { left: list.length };
}

// ── Το πρωινό πέρασμα ────────────────────────────────────────────────

function priceDropCheck() {
  const props = readProps_();
  const last = dropLastGet_();
  dropLastSet_(props);
  if (last === null) return console.log('Μείωση τιμής: πρώτο πέρασμα, κρατήθηκαν οι τιμές.');
  const drops = dropFind_(last, props);
  if (!drops.length) return console.log('Μείωση τιμής: καμία.');

  const agents = readAgents_().filter(isAgent_).filter(a => featureFlags_(a).priceDrop);
  const profiles = typeof matchProfiles_ === 'function' ? matchProfiles_() : {};
  const outcome = id => String(appGet_(id, ACOL.OUTCOME) || '');
  const now = Date.now();
  agents.forEach(agent => {
    const mine = drops.filter(d => norm_(d.p.partner) === norm_(agent.name));
    if (!mine.length) return;
    const leads = myLeads_(agent);
    const items = mine.map(d => ({
      code: d.p.code, title: d.p.street || d.p.title || d.p.code, area: d.p.area, deal: d.p.deal,
      old: d.old, now: d.now, at: now,
      clients: dropClients_(d, leads, profiles, statusOf_, outcome).map(c => ({ id: c.id, why: c.why, fits: c.fits }))
    }));
    dropListSet_(agent, items.concat(dropListGet_(agent).filter(x => !items.some(i => i.code === x.code))));
    const d0 = items[0], n = items.reduce((s, i) => s + i.clients.length, 0);
    const title = items.length === 1 ? 'Έπεσε η τιμή · ' + d0.title : items.length + ' ακίνητα έπεσαν σε τιμή';
    const body = items.length === 1
      ? matchMoney_(d0.old) + ' → ' + matchMoney_(d0.now) + (n ? ' · ' + n + (n === 1 ? ' πελάτης να ενημερώσεις' : ' πελάτες να ενημερώσεις') : '')
      : (n ? n + ' πελάτες να ενημερώσεις' : 'Δες τις νέες τιμές');
    const sent = pushToAgent_(agent, { type: 'drop', id: 'go:drop', tag: 'drop', url: '?lead=go%3Adrop', title: title, body: body });
    if (!sent && agent.email) MailApp.sendEmail({ to: agent.email, subject: title, name: 'KW App',
      body: body + '\n\nΆνοιξε την εφαρμογή → Σήμερα.' });
    console.log(agent.name + ': ' + title + ' · ' + body);
  });
}
