/**
 * 2.8 · OpEx
 *
 * FEAT-25 · «Κλείσε τη μέρα σου» (flag dayClose)
 *   Εργάσιμες, 18:30: μία ειδοποίηση ανά μεσίτη, ΜΟΝΟ αν έχει εκκρεμότητες
 *   (υπόδειξη χωρίς αποτέλεσμα, νέα κλήση που δεν κλήθηκε). Ο οδηγός τρέχει στο κινητό.
 *   Καλείται από το sendShowingReminders (κάθε 15′): εκτός ώρας δεν διαβάζει τίποτα.
 *
 * FEAT-26 · Εβδομαδιαίο email στον Admin (flag usageMail)
 *   Δευτέρα πρωί, μέσα στο morningBrief: ενέργειες και χρόνος που γλίτωσε ανά μεσίτη την
 *   εβδομάδα που πέρασε, μεταβολή από την προηγούμενη, λειτουργίες με 0 χρήσεις.
 *   Μόνο αριθμοί από τις Ιδιότητες USAGE:* — καμία ανάγνωση φύλλου, κανένα στοιχείο πελάτη.
 */

const OPS = {
  CLOSE_FROM: [18, 30],          // από τις 18:30…
  CLOSE_UNTIL: [19, 30],         // …έως τις 19:30 (αν το 15λεπτο trigger καθυστερήσει)
  CLOSE_KEY: 'DAYCLOSE_AT',
  CLOSE_DAYS: 7,                 // υποδείξεις χωρίς αποτέλεσμα: μόνο των τελευταίων 7 ημερών
  SNAP_KEY: 'USAGE_SNAP:',       // + email → { m, n, s, wn, ws }
  MAIL_KEY: 'USAGE_MAIL_AT'
};

// ── FEAT-25 · Καθαρή λογική ───────────────────────────────────────────

/** Είναι ώρα για την ειδοποίηση; d: Date στη ζώνη του σεναρίου. */
function dayCloseDue_(d, lastSent, today) {
  if (lastSent === today) return false;
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= OPS.CLOSE_FROM[0] * 60 + OPS.CLOSE_FROM[1] && m <= OPS.CLOSE_UNTIL[0] * 60 + OPS.CLOSE_UNTIL[1];
}

/** Πόσες εκκρεμότητες έχει ο μεσίτης. get(id, col) = τιμή από το φύλλο «Εφαρμογή». */
function dayCloseCount_(leads, status, get, now) {
  let n = 0;
  leads.forEach(l => {
    const st = status(l.id);
    if (st === STATUS.CLOSED || st === STATUS.NOT_INTERESTED) return;
    const at = ts_(get(l.id, ACOL.SHOW_AT));
    if (at && at <= now && now - at < OPS.CLOSE_DAYS * 86400000 && !String(get(l.id, ACOL.OUTCOME) || '')) n++;
    else if (st === STATUS.PENDING) n++;
  });
  return n;
}

function dayClosePush() {
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const local = new Date(Utilities.formatDate(now, TZ, "yyyy-MM-dd'T'HH:mm:ss"));
  if (!dayCloseDue_(local, prop_(OPS.CLOSE_KEY, ''), today)) return;
  PropertiesService.getScriptProperties().setProperty(OPS.CLOSE_KEY, today);
  PROPS_[OPS.CLOSE_KEY] = today;

  readAgents_().filter(isAgent_).filter(a => featureFlags_(a).dayClose).forEach(agent => {
    const n = dayCloseCount_(myLeads_(agent), statusOf_, appGet_, now.getTime());
    if (!n) return;
    pushToAgent_(agent, { type: 'dayclose', id: 'go:dayclose', tag: 'dayclose', url: '?lead=go%3Adayclose',
      title: 'Κλείσε τη μέρα σου', body: (n === 1 ? '1 εκκρεμότητα' : n + ' εκκρεμότητες') + ' · θέλει 1 λεπτό' });
  });
}

// ── FEAT-26 · Καθαρή λογική ───────────────────────────────────────────

/** Σύνολο μήνα → { n: ενέργειες, s: δευτερόλεπτα που γλίτωσε }. */
function usageTotals_(total, base) {
  const r = usageRows_(total || {}, base);
  return { n: r.actions, s: r.savedSec };
}

/**
 * Η εβδομάδα που πέρασε = τώρα − στιγμιότυπο της προηγούμενης Δευτέρας.
 * snap: { m, n, s } ή null · cur: σύνολα του τρέχοντος μήνα · prevEnd: τελικά σύνολα του μήνα του snap.
 */
function usageWeek_(snap, month, cur, prevEnd) {
  if (!snap) return { n: cur.n, s: cur.s, first: true };
  if (snap.m === month) return { n: Math.max(0, cur.n - snap.n), s: Math.max(0, cur.s - snap.s) };
  return { n: Math.max(0, prevEnd.n - snap.n) + cur.n, s: Math.max(0, prevEnd.s - snap.s) + cur.s };
}

function usageDur_(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m + '′';
  return Math.floor(m / 60) + ' ώρ.' + (m % 60 ? ' ' + (m % 60) + '′' : '');
}

function usageDiff_(now, before) {
  if (before == null) return '';
  const d = now - before;
  return d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '=';
}

/** rows: [{ name, n, s, wn }] · unused: [ετικέτες] → { text, html } */
function usageMailBody_(rows, unused) {
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, s: a.s + r.s }), { n: 0, s: 0 });
  const text = ['Η εβδομάδα της ομάδας στο KW App', '',
    'Σύνολο: ' + tot.n + ' ενέργειες · γλίτωσε περίπου ' + usageDur_(tot.s), '']
    .concat(rows.map(r => '· ' + r.name + ': ' + r.n + ' ενέργειες, ' + usageDur_(r.s) + (r.wn == null ? '' : ' (' + usageDiff_(r.n, r.wn) + ' από την προηγούμενη)')))
    .concat(unused.length ? ['', 'Δεν χρησιμοποιήθηκαν αυτόν τον μήνα: ' + unused.join(', ')] : [])
    .concat(['', 'Ο χρόνος είναι εκτίμηση: σύγκριση με την ίδια δουλειά χωρίς την εφαρμογή.']).join('\n');
  const td = 'padding:6px 14px 6px 0;border-top:1px solid #e5e5e5';
  const html = '<div style="font:15px Arial,sans-serif;color:#111;max-width:600px">' +
    '<h2 style="margin:0 0 4px">Η εβδομάδα της ομάδας</h2>' +
    '<p style="margin:0 0 14px;color:#555">' + tot.n + ' ενέργειες · γλίτωσε περίπου <b>' + e(usageDur_(tot.s)) + '</b></p>' +
    '<table style="border-collapse:collapse"><tr style="text-align:left;color:#555"><th style="padding:0 14px 6px 0">Μεσίτης</th><th style="padding:0 14px 6px 0">Ενέργειες</th><th style="padding:0 14px 6px 0">Γλίτωσε</th><th style="padding:0 0 6px">Από την προηγ.</th></tr>' +
    rows.map(r => '<tr><td style="' + td + '">' + e(r.name) + '</td><td style="' + td + '">' + r.n + '</td><td style="' + td + '">' + e(usageDur_(r.s)) +
      '</td><td style="' + td + '">' + e(r.wn == null ? '—' : usageDiff_(r.n, r.wn)) + '</td></tr>').join('') + '</table>' +
    (unused.length ? '<p style="margin:14px 0 0"><b>Δεν χρησιμοποιήθηκαν αυτόν τον μήνα:</b> ' + e(unused.join(', ')) + '</p>' : '') +
    '<p style="margin:14px 0 0;color:#777;font-size:13px">Ο χρόνος είναι εκτίμηση: σύγκριση με την ίδια δουλειά χωρίς την εφαρμογή. Χωρίς στοιχεία πελατών.</p></div>';
  return { text: text, html: html };
}

function usageWeeklyMail(force) {
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  if (force !== true) {
    if (Utilities.formatDate(now, TZ, 'u') !== '1') return;            // μόνο Δευτέρα
    if (prop_(OPS.MAIL_KEY, '') === today) return;
  }
  const agents = readAgents_().filter(a => a.email);
  const admins = agents.filter(a => a.active && isAdmin_(a) && featureFlags_(a).usageMail);   // 2.14.1
  if (!admins.length) return;

  const sp = PropertiesService.getScriptProperties();
  const base = usageBase_();
  const month = usageMonth_(0);
  const team = {};
  const rows = [];
  agents.filter(isAgent_).forEach(a => {
    const key = OPS.SNAP_KEY + String(a.email).toLowerCase();
    let snap = null;
    try { snap = JSON.parse(PROPS_[key] || 'null'); } catch (e) { snap = null; }
    const total = usageGet_(month, a.email);
    Object.keys(total).forEach(k => { team[k] = (team[k] || 0) + total[k][0]; });
    const cur = usageTotals_(total, base);
    const prevEnd = snap && snap.m !== month ? usageTotals_(usageGet_(snap.m, a.email), base) : cur;
    const w = usageWeek_(snap, month, cur, prevEnd);
    rows.push({ name: a.name, n: w.n, s: w.s, wn: snap && snap.wn != null ? snap.wn : null });
    if (force !== true) sp.setProperty(key, JSON.stringify({ m: month, n: cur.n, s: cur.s, wn: w.n, ws: w.s }));   // η δοκιμή δεν αλλάζει τη βάση σύγκρισης
  });
  if (force !== true) sp.setProperty(OPS.MAIL_KEY, today);
  rows.sort((a, b) => b.s - a.s);
  const unused = Object.keys(USAGE.BASE).filter(k => !team[k]).map(k => USAGE.LABELS[k] || k);
  const body = usageMailBody_(rows, unused);
  admins.forEach(a => {
    if (MailApp.getRemainingDailyQuota() < 1) return;
    MailApp.sendEmail({ to: a.email, name: 'KW App', subject: 'KW App · η εβδομάδα της ομάδας', body: body.text, htmlBody: body.html });
  });
  console.log('Εβδομαδιαίο email: ' + admins.length + ' admin, ' + rows.length + ' μεσίτες');
}

/** ▶ Δοκιμή: στέλνει το email τώρα (όποια μέρα κι αν είναι). */
function usageMailTest() {
  _agents = null;
  usageWeeklyMail(true);
}
