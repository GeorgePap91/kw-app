/**
 * 2.6 · FEAT-13 · Μηνιαία αναφορά προς τον ιδιοκτήτη, με 1 πάτημα (flag ownerReport)
 *
 * Από την καρτέλα ακινήτου: «Αναφορά ιδιοκτήτη» → προεπισκόπηση → «Στείλε email».
 * Περιεχόμενο: κλήσεις του μήνα ανά πηγή, σύγκριση με τον προηγούμενο, υποδείξεις,
 * αποτελέσματα, πόσοι βρήκαν την τιμή πάνω από το budget τους.
 * ΚΑΝΕΝΑ όνομα ή τηλέφωνο πελάτη (GDPR). Τίποτα δεν φεύγει χωρίς το πάτημα του μεσίτη.
 *
 * Κόστος: 2 αναγνώσεις (τα δύο μηνιαία φύλλα) μόνο όταν πατηθεί. Κανένα νέο φύλλο.
 * Gmail: προειδοποίηση όταν το υπόλοιπο της ημέρας πέφτει κάτω από 20.
 */

const REPORT = { QUOTA_WARN: 20, MONTHS: ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'] };

(function () {
  try {
    ACTIONS.ownerReport = actOwnerReport_;
    ACTIONS.ownerReportSend = actOwnerReportSend_;
  } catch (e) {
    console.error('Report.gs: μετακίνησέ το ΚΑΤΩ από το Code.gs.');
  }
})();

// ── Καθαρή λογική ─────────────────────────────────────────────────────

/**
 * rows: [{ id, source }] κλήσεις του μήνα για το ακίνητο · prevCount: κλήσεις του προηγούμενου
 * shows: [{ outcome }] υποδείξεις του μήνα · over: πόσοι έχουν budget κάτω από την τιμή
 */
function reportBuild_(p, monthLabel, rows, prevCount, shows, over) {
  const bySource = {};
  rows.forEach(r => { const k = r.source || 'Άλλη πηγή'; bySource[k] = (bySource[k] || 0) + 1; });
  const sources = Object.keys(bySource).sort((a, b) => bySource[b] - bySource[a])
    .map(k => ({ name: k, n: bySource[k] }));
  const outcomes = {};
  shows.forEach(s => { const k = s.outcome || 'Χωρίς αποτέλεσμα ακόμα'; outcomes[k] = (outcomes[k] || 0) + 1; });
  const diff = rows.length - prevCount;
  const trend = prevCount === null ? '' : diff > 0 ? '+' + diff + ' από τον προηγούμενο μήνα'
    : diff < 0 ? diff + ' από τον προηγούμενο μήνα' : 'ίδιες με τον προηγούμενο μήνα';
  return {
    title: p.street || p.title || p.code, code: p.code, month: monthLabel,
    calls: rows.length, trend: trend, sources: sources,
    showings: shows.length,
    outcomes: Object.keys(outcomes).map(k => ({ name: k, n: outcomes[k] })),
    over: over,
    price: matchNum_(p.price)
  };
}

/** Απλό κείμενο (WhatsApp / Viber / αντιγραφή). */
function reportText_(r, ownerName, agentName) {
  const L = [];
  L.push((ownerName ? 'Καλησπέρα ' + ownerName.split(' ')[0] + ',' : 'Καλησπέρα,'), '');
  L.push('Η ενημέρωση για το ακίνητό σας «' + r.title + '» για τον ' + r.month + ':', '');
  L.push('📞 Τηλεφωνήματα: ' + r.calls + (r.trend ? ' (' + r.trend + ')' : ''));
  r.sources.forEach(s => L.push('   · ' + s.name + ': ' + s.n));
  L.push('🏠 Υποδείξεις: ' + r.showings);
  r.outcomes.forEach(o => L.push('   · ' + o.name + ': ' + o.n));
  if (r.over) L.push('💬 ' + r.over + (r.over === 1 ? ' ενδιαφερόμενος βρήκε' : ' ενδιαφερόμενοι βρήκαν') +
    ' την τιμή πάνω από το budget ' + (r.over === 1 ? 'του' : 'τους') + '.');
  L.push('', 'Είμαι στη διάθεσή σας για ό,τι χρειαστείτε.', agentName || '');
  return L.join('\n');
}

function reportHtml_(r, ownerName, agentName) {
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const row = (a, b) => '<tr><td style="padding:6px 16px 6px 0;color:#555">' + e(a) + '</td><td style="padding:6px 0;font-weight:bold">' + e(b) + '</td></tr>';
  return '<div style="font:16px Arial,sans-serif;color:#111;max-width:560px">' +
    '<p>' + (ownerName ? 'Καλησπέρα ' + e(ownerName.split(' ')[0]) + ',' : 'Καλησπέρα,') + '</p>' +
    '<p>η ενημέρωση για το ακίνητό σας <b>«' + e(r.title) + '»</b> για τον <b>' + e(r.month) + '</b>:</p>' +
    '<table style="border-collapse:collapse;margin:8px 0 16px">' +
      row('Τηλεφωνήματα', r.calls + (r.trend ? ' (' + r.trend + ')' : '')) +
      r.sources.map(s => row('· ' + s.name, s.n)).join('') +
      row('Υποδείξεις', r.showings) +
      r.outcomes.map(o => row('· ' + o.name, o.n)).join('') +
    '</table>' +
    (r.over ? '<p>' + r.over + (r.over === 1 ? ' ενδιαφερόμενος βρήκε' : ' ενδιαφερόμενοι βρήκαν') + ' την τιμή πάνω από το budget ' + (r.over === 1 ? 'του' : 'τους') + '.</p>' : '') +
    '<p>Είμαι στη διάθεσή σας για ό,τι χρειαστείτε.<br>' + e(agentName || '') + '</p></div>';
}

// ── Δεδομένα ──────────────────────────────────────────────────────────

function reportMonth_(which) {
  const now = new Date();
  const d = which === 'this' ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { name: Utilities.formatDate(d, TZ, 'yyyy-MM'), prevName: Utilities.formatDate(prev, TZ, 'yyyy-MM'),
           label: REPORT.MONTHS[d.getMonth()] + (which === 'this' ? ' (μέχρι σήμερα)' : ''),
           from: d.getTime(), to: which === 'this' ? now.getTime() : new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
}

/** [{ id, source }] από ένα μηνιαίο φύλλο, μόνο για τον κωδικό. null αν δεν υπάρχει το φύλλο. */
function reportCalls_(sheetName, key) {
  const sh = getSS().getSheetByName(sheetName);
  if (!sh) return null;
  if (sh.getLastRow() < 2) return [];
  const w = Math.max(sh.getLastColumn(), colIdx_(LCOL.CODE));
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues()
    .filter(v => cellText_(cell_(v, LCOL.ID)) && normCode_(cell_(v, LCOL.CODE)) === key)
    .map(v => ({ id: cellText_(cell_(v, LCOL.ID)), source: cellText_(cell_(v, LCOL.SOURCE)) }));
}

function reportFor_(agent, d) {
  const key = normCode_(d.code);
  const p = readProps_()[key];
  if (!p || norm_(p.partner) !== norm_(agent.name)) throw new Error('Το ακίνητο δεν είναι δικό σου.');
  const m = reportMonth_(d.month);
  const rows = reportCalls_(m.name, key) || [];
  const prev = reportCalls_(m.prevName, key);
  // Υποδείξεις του μήνα: από όλες τις κλήσεις του ακινήτου που φαίνονται (τρέχων + προηγούμενοι μήνες).
  const ids = {};
  rows.forEach(r => { ids[r.id] = 1; });
  readLeads_().forEach(l => { if (normCode_(l.code) === key) ids[l.id] = 1; });
  const shows = Object.keys(ids).map(id => ({ at: ts_(appGet_(id, ACOL.SHOW_AT)), outcome: String(appGet_(id, ACOL.OUTCOME) || '') }))
    .filter(s => s.at >= m.from && s.at < m.to);
  const pf = typeof matchProfiles_ === 'function' ? matchProfiles_() : {};
  const price = matchNum_(p.price);
  const over = Object.keys(ids).filter(id => {
    const x = pf[id];
    if (!x || !price) return false;
    const b = matchNum_(x.deal === 'rent' ? x.budgetRent : x.budgetBuy);
    return b && b < price;
  }).length;
  return { p: p, r: reportBuild_(p, m.label, rows, prev ? prev.length : null, shows, over) };
}

function actOwnerReport_(agent, d) {
  if (!featureFlags_(agent).ownerReport) throw new Error('Η αναφορά ιδιοκτήτη δεν είναι ανοιχτή.');
  const x = reportFor_(agent, d);
  let quota = null;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = null; }
  return {
    report: x.r,
    text: reportText_(x.r, x.p.owner, agent.smsName || agent.name),
    hasEmail: /@/.test(x.p.ownerEmail),
    emailHint: x.p.ownerEmail ? maskMail_(x.p.ownerEmail) : '',
    quota: quota, quotaLow: quota !== null && quota < REPORT.QUOTA_WARN
  };
}

function actOwnerReportSend_(agent, d) {
  if (!featureFlags_(agent).ownerReport) throw new Error('Η αναφορά ιδιοκτήτη δεν είναι ανοιχτή.');
  const x = reportFor_(agent, d);
  if (!/@/.test(x.p.ownerEmail)) throw new Error('Δεν υπάρχει email ιδιοκτήτη στα «Διαθέσιμα ακίνητα».');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Έφτασε το όριο email της ημέρας. Δοκίμασε αύριο.');
  const name = agent.smsName || agent.name;
  MailApp.sendEmail({
    to: x.p.ownerEmail, name: name, replyTo: agent.email || '',
    subject: 'Ενημέρωση για το ακίνητό σας · ' + x.r.month,
    body: reportText_(x.r, x.p.owner, name),
    htmlBody: reportHtml_(x.r, x.p.owner, name)
  });
  log_('Αναφορά ιδιοκτήτη', agent.name, x.p.code + ' · ' + x.r.month);
  return { sent: true, to: maskMail_(x.p.ownerEmail), quota: MailApp.getRemainingDailyQuota() };
}
