/**
 * 2.5 · FEAT-11 · Νέο ακίνητο → «Ποιοι πελάτες ταιριάζουν» (flag newPropMatch)
 *
 * Μία φορά το πρωί (μέσα στο morningBrief):
 *   1. Βρίσκει τα διαθέσιμα ακίνητα που δεν υπήρχαν στο χθεσινό πέρασμα.
 *   2. Για κάθε μεσίτη με το flag, ψάχνει στους δικούς του πελάτες (κλήσεις + Προφίλ):
 *      ίδια συναλλαγή, τιμή ≤ budget +10%, περιοχή στις «περιοχές» του προφίλ
 *      ή ίδια με το ακίνητο για το οποίο είχε καλέσει.
 *   3. Στέλνει ΜΙΑ ειδοποίηση ανά μεσίτη (μόνο αν υπάρχει ≥1 ταίριασμα).
 *
 * Κόστος: 1 ανάγνωση «Προφίλ πελατών» την ημέρα. ΚΑΝΕΝΑ νέο φύλλο: ιστορικό και λίστα
 * μένουν σε Ιδιότητες σεναρίου (χωρίς τηλέφωνα: μόνο ένα σύντομο hash).
 * Οι κλήσεις και τα ακίνητα διαβάζονται ήδη από το morningBrief (cache).
 * Η λίστα της εφαρμογής κρατιέται σε Ιδιότητα σεναρίου ανά μεσίτη, που φορτώνεται
 * μαζί με όλες τις άλλες: το άνοιγμα της εφαρμογής ΔΕΝ διαβάζει επιπλέον φύλλο.
 */

const MATCH = {
  HIST_KEY: 'MATCH_DONE:',      // + email → ποιοι προτάθηκαν ήδη (κωδικός|hash πελάτη), για να μην ξαναπροταθούν
  HIST_MAX: 300,
  SEEN_KEY: 'MATCH_SEEN',       // κωδικοί που έχουμε ήδη δει (σε κομμάτια των 8.000 χαρακτήρων)
  LIST_KEY: 'MATCH_LIST:',      // + email μεσίτη → JSON λίστα για την εφαρμογή
  CHUNK: 8000,
  BUDGET_PLUS: 0.10,            // AC2: τιμή ≤ budget +10%
  PER_PROP: 8,                  // το πολύ τόσοι πελάτες ανά ακίνητο (οι καλύτεροι)
  KEEP_DAYS: 14,                // πόσο μένουν στη λίστα της εφαρμογής
  LIST_MAX: 30
};

(function () {
  try {
    ACTIONS.matchDone = actMatchDone_;
  } catch (e) {
    console.error('Match.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

// ── Καθαρή λογική (χωρίς Google: τη δοκιμάζουν τα tests) ──────────────

function matchNum_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function matchDeal_(s) {
  const t = norm_(s);
  if (t === 'rent' || /ενοικ|μισθ|rent/.test(t)) return 'Ενοικίαση';
  if (t === 'buy' || /πωλ|αγορ|sale|buy/.test(t)) return 'Πώληση';
  return '';
}

function matchWords_(s) {
  return norm_(s).split(/[\s,;\/·]+/).filter(w => w.length >= 3);
}

function matchMoney_(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
}

/**
 * newProps: [{code, deal, price, area, …}]  · leads: οι κλήσεις του μεσίτη
 * profiles: { leadId: data }  · byCode: κωδικός → ακίνητο  · status: id → κατάσταση
 * done: Set από «κωδικός|τηλ-ή-id» που έχουν ήδη προταθεί (AC5)
 * → [{ code, id, name, why, score }]
 */
function matchFind_(newProps, leads, profiles, byCode, status, done) {
  // Ένας πελάτης = ένα τηλέφωνο. Κρατάμε την κλήση με προφίλ, αλλιώς την πιο πρόσφατη.
  const people = {};
  leads.forEach(l => {
    if (status(l.id) === STATUS.CLOSED) return;
    const key = l.phone || l.id;
    const cur = people[key];
    if (!cur || (!cur.pf && profiles[l.id])) people[key] = { l: l, pf: profiles[l.id] || null, key: key };
  });

  const out = [];
  newProps.forEach(p => {
    const price = matchNum_(p.price);
    const area = norm_(p.area);
    if (!price || !area) return;
    const hits = [];
    Object.keys(people).forEach(k => {
      const c = people[k], l = c.l, pf = c.pf || {};
      if (normCode_(l.code) === normCode_(p.code)) return;
      if (done.has(normCode_(p.code) + '|' + matchH_(c.key))) return;
      const home = byCode[normCode_(l.code)] || null;

      const deal = matchDeal_(pf.deal) || (home && home.deal) || matchDeal_(l.deal);
      if (!deal || (p.deal && p.deal !== deal)) return;

      const budget = matchNum_(deal === 'Ενοικίαση' ? pf.budgetRent : pf.budgetBuy);
      const ref = budget || matchNum_(home && home.price) || matchNum_(l.price);
      if (!ref || price > ref * (1 + MATCH.BUDGET_PLUS)) return;
      // Χωρίς budget: όχι κάτι πολύ φθηνότερο από αυτό που ζήτησε (άλλη κατηγορία ακινήτου).
      if (!budget && price < ref * 0.6) return;

      const wanted = matchWords_(deal === 'Ενοικίαση' ? pf.areasRent : pf.areasBuy);
      const inWanted = wanted.some(w => area.indexOf(w) !== -1);
      const sameArea = !!home && norm_(home.area) === area;
      if (!inWanted && !sameArea) return;

      const why = [(budget ? 'budget ' : 'ζήτησε ') + matchMoney_(ref), p.area].join(' · ');
      hits.push({ code: p.code, id: l.id, name: l.name || 'Χωρίς όνομα', key: c.key, why: why,
                  score: (c.pf ? 4 : 0) + (inWanted ? 2 : 0) + (sameArea ? 1 : 0) });
    });
    hits.sort((a, b) => b.score - a.score).slice(0, MATCH.PER_PROP).forEach(h => out.push(h));
  });
  return out;
}

/** Η λίστα της εφαρμογής: νέα πρώτα, χωρίς διπλά, χωρίς όσα έληξαν. */
function matchMerge_(old, add, nowMs) {
  const limit = nowMs - MATCH.KEEP_DAYS * 86400000;
  const seen = {};
  return add.concat(old || []).filter(m => {
    const k = m.code + '|' + m.id;
    if (seen[k] || (m.at && m.at < limit)) return false;
    seen[k] = 1;
    return true;
  }).slice(0, MATCH.LIST_MAX);
}

/** «Νέο ακίνητο στο Παγκράτι · ταιριάζει σε 4 πελάτες» */
function matchPushText_(list, props) {
  const codes = [];
  list.forEach(m => { if (codes.indexOf(m.code) === -1) codes.push(m.code); });
  const people = {};
  list.forEach(m => { people[m.key || m.id] = 1; });
  const n = Object.keys(people).length;
  const who = n === 1 ? 'ταιριάζει σε 1 πελάτη σου' : 'ταιριάζουν σε ' + n + ' πελάτες σου';
  if (codes.length === 1) {
    const p = props[normCode_(codes[0])] || {};
    return { title: 'Νέο ακίνητο' + (p.area ? ' στο ' + p.area : ''),
             body: (p.street || p.title || codes[0]) + ' · ' + who.replace('ταιριάζουν', 'ταιριάζει') };
  }
  return { title: codes.length + ' νέα ακίνητα', body: who.charAt(0).toUpperCase() + who.slice(1) };
}

// ── Αποθήκευση (Ιδιότητες σεναρίου) ──────────────────────────────────

/** Σύντομο, μη αναστρέψιμο αποτύπωμα (για να μη μένουν τηλέφωνα στις Ιδιότητες). */
function matchH_(s) {
  let h = 5381;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function matchHistGet_(agent) {
  const v = PROPS_[MATCH.HIST_KEY + String(agent.email || '').toLowerCase()];
  return v ? String(v).split(',') : [];
}

function matchHistSet_(agent, list) {
  const k = MATCH.HIST_KEY + String(agent.email || '').toLowerCase();
  PROPS_[k] = list.slice(-MATCH.HIST_MAX).join(',');
  PropertiesService.getScriptProperties().setProperty(k, PROPS_[k]);
}

/** Προφίλ πελατών: { ID κλήσης: δεδομένα }. Μία ανάγνωση ανά εκτέλεση (cache). */
let _pfAll = null;
function matchProfiles_() {
  if (_pfAll) return _pfAll;
  _pfAll = {};
  const sh = getSS().getSheetByName(PROFILE.SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(r => {
      let d = null;
      try { d = JSON.parse(r[6] || '{}'); } catch (e) { d = null; }
      if (d) { d._level = String(r[4] || ''); d._sum = String(r[5] || ''); _pfAll[String(r[0])] = d; }
    });
  }
  return _pfAll;
}

function matchSeenGet_() {
  const n = Number(prop_(MATCH.SEEN_KEY + '_N', '0'));
  if (!n) return null;                                  // πρώτη φορά
  let s = '';
  for (let i = 0; i < n; i++) s += PROPS_[MATCH.SEEN_KEY + '_' + i] || '';
  return s ? s.split(',') : [];
}

function matchSeenSet_(codes) {
  const s = codes.join(','), out = {}, chunks = Math.max(1, Math.ceil(s.length / MATCH.CHUNK));
  for (let i = 0; i < chunks; i++) out[MATCH.SEEN_KEY + '_' + i] = s.slice(i * MATCH.CHUNK, (i + 1) * MATCH.CHUNK);
  out[MATCH.SEEN_KEY + '_N'] = String(chunks);
  PropertiesService.getScriptProperties().setProperties(out);
}

function matchListGet_(agent) {
  try { return JSON.parse(PROPS_[MATCH.LIST_KEY + String(agent.email || '').toLowerCase()] || '[]'); }
  catch (e) { return []; }
}

function matchListSet_(agent, list) {
  const k = MATCH.LIST_KEY + String(agent.email || '').toLowerCase();
  PROPS_[k] = JSON.stringify(list);
  PropertiesService.getScriptProperties().setProperty(k, PROPS_[k]);
}

/** Για το bootstrap: μόνο ό,τι χρειάζεται η οθόνη, και μόνο για ακίνητα που είναι ακόμα διαθέσιμα. */
function matchesFor_(agent) {
  if (!featureFlags_(agent).newPropMatch) return [];
  const props = readProps_();
  const limit = Date.now() - MATCH.KEEP_DAYS * 86400000;
  return matchListGet_(agent).filter(m => {
    const p = props[normCode_(m.code)];
    return p && p.available && (!m.at || m.at >= limit);
  }).map(m => {
    const p = props[normCode_(m.code)];
    return { code: m.code, id: m.id, name: m.name, why: m.why, at: m.at,
             p: { code: p.code, title: p.title, street: p.street, area: p.area, price: p.price, sqm: p.sqm, deal: p.deal } };
  });
}

/** «Στάλθηκε» ή «✕»: βγαίνει από τη λίστα. Το ιστορικό (φύλλο) μένει, ώστε να μην ξαναπροταθεί. */
function actMatchDone_(agent, d) {
  const code = String(d.code || ''), id = String(d.id || '');
  const list = matchListGet_(agent).filter(m => !(m.code === code && m.id === id));
  matchListSet_(agent, list);
  return { left: list.length };
}

// ── Το πρωινό πέρασμα ────────────────────────────────────────────────

function newPropMatch() {
  const agents = readAgents_().filter(isAgent_).filter(a => featureFlags_(a).newPropMatch);
  const props = readProps_();
  const avail = Object.keys(props).filter(k => props[k].available);
  const seen = matchSeenGet_();
  matchSeenSet_(avail);
  if (seen === null) return console.log('Ταιριάσματα: πρώτο πέρασμα, κρατήθηκαν ' + avail.length + ' ακίνητα.');
  const seenSet = new Set(seen);
  const fresh = avail.filter(k => !seenSet.has(k)).map(k => props[k]);
  if (!fresh.length || !agents.length) return console.log('Ταιριάσματα: ' + fresh.length + ' νέα ακίνητα.');

  const profiles = matchProfiles_();
  const done = new Set();
  const now = new Date();
  agents.forEach(agent => {
    const hist = matchHistGet_(agent);
    hist.forEach(h => done.add(h));
    const found = matchFind_(fresh, myLeads_(agent), profiles, props, statusOf_, done)
      .map(m => Object.assign(m, { at: now.getTime() }));
    if (!found.length) return console.log(agent.name + ': κανένα ταίριασμα');
    found.forEach(m => hist.push(normCode_(m.code) + '|' + matchH_(m.key)));
    matchHistSet_(agent, hist);
    matchListSet_(agent, matchMerge_(matchListGet_(agent), found.map(m => ({
      code: m.code, id: m.id, name: m.name, why: m.why, at: m.at })), now.getTime()));
    const t = matchPushText_(found, props);
    const sent = pushToAgent_(agent, { type: 'match', id: 'go:match', tag: 'match', url: '?lead=go%3Amatch',
                                       title: t.title, body: t.body });
    if (!sent && agent.email) MailApp.sendEmail({ to: agent.email, subject: t.title, name: 'KW App',
      body: t.body + '\n\nΆνοιξε την εφαρμογή → Σήμερα → «Νέα ακίνητα για πελάτες σου».' });
    console.log(agent.name + ': ' + t.body + ' → ' + sent + ' συσκευή/ές');
  });
}

/** ▶ Δοκιμή χωρίς να περιμένεις το πρωί: τρέχει μόνο το πέρασμα ταιριάσματος. */
function matchCheck() {
  _agents = null;
  newPropMatch();
}
