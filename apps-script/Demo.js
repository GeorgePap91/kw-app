/**
 * KW App · Δοκιμαστικά στοιχεία (Demo.gs)
 * ─────────────────────────────────────────────────────────────
 * Νέο αρχείο ΔΙΠΛΑ στο Code.gs, στο ίδιο Apps Script project. Δεν αλλάζει τίποτα στο Code.gs.
 *
 *   demoFill()     γεμίζει τα φύλλα με ψεύτικους πελάτες, ακίνητα, εργασίες, επαφές.
 *                  Αν υπάρχουν ήδη δοκιμαστικά, τα σβήνει πρώτα (τρέχει όσες φορές θες).
 *   demoClear()    σβήνει ΜΟΝΟ τα δοκιμαστικά. Τα πραγματικά δεν τα αγγίζει.
 *   demoNewLead()  προσθέτει μία νέα δοκιμαστική κλήση «τώρα». Σε 1–2 λεπτά έρχεται
 *                  ειδοποίηση στο κινητό, όπως με μια πραγματική κλήση.
 *
 * Πώς ξεχωρίζουν: κάθε δοκιμαστική εγγραφή έχει «DEMO» στο ID ή στον κωδικό
 * (DEMO-L01, DEMO1…). Το demoClear σβήνει μόνο γραμμές με αυτό το σήμα.
 *
 * Ασφάλεια:
 *  · Δεν τρέχει όταν CONFIG.ENV = 'prod', ούτε πάνω στο παραγωγικό workbook.
 *  · Τα τηλέφωνα είναι ψεύτικα (69000001xx). ΜΗΝ πατάς «Κλήση» σε δοκιμαστικό πελάτη,
 *    εκτός αν βάλεις το δικό σου κινητό στο DEMO.MY_PHONE (μπαίνει στην πρώτη κλήση).
 *  · Δεν μπαίνει email πελάτη, άρα δεν φεύγει κανένα email υπενθύμισης σε ξένους.
 *  · Οι υποδείξεις δεν φτιάχνουν event στο ημερολόγιο. Αν όμως κλείσεις ή αλλάξεις
 *    υπόδειξη μέσα από την εφαρμογή, μπαίνει κανονικό event· το demoClear το σβήνει.
 */

const DEMO = {
  // Το όνομα του μεσίτη όπως στο Agents. Κενό = η γραμμή με το email του λογαριασμού
  // που τρέχει το script (στη δοκιμή: η γραμμή όπου έβαλες το δικό σου email).
  AGENT: '',
  // Δεύτερος μεσίτης για τα «Ακίνητα ομάδας». Κενό = ο επόμενος στο Agents.
  TEAM_AGENT: '',
  // Βάλε το κινητό σου (π.χ. '69XXXXXXXX') για να δοκιμάσεις «Κλήση» και SMS
  // στην πρώτη δοκιμαστική κλήση. Κενό = ψεύτικο νούμερο.
  MY_PHONE: '',
  // Τα παραγωγικά workbooks ΔΕΝ γράφονται εδώ: Ιδιότητα σεναρίου PROD_SPREADSHEET_IDS (βλ. demoGuard_).
  PROD_IDS: []
};

const DEMO_TOKEN = /(^|[\s,;:\/(])DEMO[-\d]/;

// ─────────────────────────────────────────────────────────────
//  ΣΥΝΑΡΤΗΣΕΙΣ ΠΟΥ ΤΡΕΧΕΙΣ
// ─────────────────────────────────────────────────────────────

function demoFill() {
  demoGuard_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const removed = demoClearAll_();
    const who = demoAgents_();
    const now = new Date();
    const log = [];

    const props = demoProps_(who);
    log.push('Ακίνητα: ' + demoAppendProps_(props));
    log.push('Συνολικές κλήσεις: ' + demoAppendTotals_(props));

    const leads = demoLeads_(who, now);
    log.push('Κλήσεις: ' + demoAppendLeads_(leads));
    log.push('Κατάσταση κλήσεων («' + CONFIG.SHEETS.APP + '»): ' + demoAppendApp_(leads, who, now));
    log.push('Χωρίς ειδοποιήσεις («' + CONFIG.SHEETS.NOTIFIED + '»): ' + demoMarkNotified_(leads.map(l => l.id), now));
    log.push('Εργασίες: ' + demoAppendTasks_(who, now));
    log.push('Επαφές CRM («' + CONFIG.SHEETS.CONTACTS + '»): ' + demoAppendCrm_(who, leads));
    log.push('Προφίλ πελατών: ' + demoAppendProfiles_(who, now));

    console.log('✓ Δοκιμαστικά στοιχεία για τον μεσίτη «' + who.me.name + '»' +
      (who.team ? ' (ομάδα: «' + who.team.name + '»)' : '') + '\n' +
      (removed ? '  Σβήστηκαν πρώτα ' + removed + ' παλιές δοκιμαστικές γραμμές.\n' : '') +
      log.map(x => '  ' + x).join('\n') +
      '\n\nΆνοιξε την εφαρμογή και τράβα για ανανέωση (ή κλείσε και ξανάνοιξέ την).' +
      '\nΓια να τα σβήσεις: demoClear.');
  } finally {
    lock.releaseLock();
  }
}

function demoClear() {
  demoGuard_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const n = demoClearAll_(true);
    console.log(n ? '✓ Σβήστηκαν ' + n + ' δοκιμαστικές γραμμές. Τα πραγματικά στοιχεία έμειναν όπως ήταν.'
                  : 'Δεν υπήρχαν δοκιμαστικά στοιχεία.');
  } finally {
    lock.releaseLock();
  }
}

/** Μία νέα κλήση «τώρα», χωρίς σήμανση «ειδοποιήθηκε»: το checkNewLeads στέλνει ειδοποίηση. */
function demoNewLead() {
  demoGuard_();
  const who = demoAgents_();
  if (!demoFindRows_(demoSheet_(CONFIG.SHEETS.PROPS), r => String(r[demoCol_('C') - 1]).trim() === 'DEMO1').length) {
    throw new Error('Τρέξε πρώτα το demoFill (χρειάζεται το δοκιμαστικό ακίνητο DEMO1).');
  }
  const now = new Date();
  const n = demoFindAllLeadIds_().length + 1;
  const id = 'DEMO-N' + ('0' + n).slice(-2) + '-' + Utilities.formatDate(now, TZ, 'HHmmss');
  const names = ['Στέλλα Καραγιάννη', 'Άρης Παπαδόπουλος', 'Λένα Χατζή', 'Μάνος Βλάχος', 'Ρένα Δούκα'];
  demoAppendLeads_([{ id: id, date: now, source: 'Spitogatos', name: names[n % names.length],
    phone: '69000001' + ('0' + (60 + n)).slice(-2), code: 'DEMO1', type: 'Διαμέρισμα', sqm: '78',
    deal: 'Ενοικίαση', location: 'Κουκάκι', price: 950, message: 'Είναι ακόμα διαθέσιμο; Θα ήθελα να το δω.' }]);
  console.log('✓ Νέα δοκιμαστική κλήση ' + id + ' για τον «' + who.me.name + '». ' +
    'Σε 1–2 λεπτά πρέπει να έρθει ειδοποίηση «Νέα κλήση» στο κινητό (αν έχεις ενεργές ειδοποιήσεις).');
}

// ─────────────────────────────────────────────────────────────
//  ΤΑ ΔΟΚΙΜΑΣΤΙΚΑ ΣΤΟΙΧΕΙΑ
// ─────────────────────────────────────────────────────────────

function demoProps_(who) {
  const team = who.team ? who.team.name : who.me.name;
  const plus = d => new Date(Date.now() + d * 86400000);
  return [
    { code: 'DEMO1', title: 'Διαμέρισμα 2Δ προς ενοικίαση στο Κουκάκι', type: 'Διαμέρισμα', area: 'Κουκάκι', street: 'Βεΐκου 10',
      price: 950, sqm: 78, deal: 'Ενοικίαση', mandate: 'Αποκλειστική', end: plus(21), partner: who.me.name, status: 'Διαθέσιμο', week: 2, month: 6, total: 14 },
    { code: 'DEMO2', title: 'Διαμέρισμα 3Δ προς πώληση στο Παγκράτι', type: 'Διαμέρισμα', area: 'Παγκράτι', street: 'Υμηττού 50',
      price: 245000, sqm: 105, deal: 'Πώληση', mandate: 'Απλή', end: plus(83), partner: who.me.name, status: 'Διαθέσιμο', week: 1, month: 4, total: 9 },
    { code: 'DEMO3', title: 'Μεζονέτα προς πώληση στον Νέο Κόσμο', type: 'Μεζονέτα', area: 'Νέος Κόσμος', street: 'Φρατζή 7',
      price: 380000, sqm: 124, deal: 'Πώληση', mandate: 'Αποκλειστική', end: plus(5), partner: who.me.name, status: 'Διαθέσιμο', week: 3, month: 9, total: 22 },
    { code: 'DEMO4', title: 'Γκαρσονιέρα προς ενοικίαση στα Πετράλωνα', type: 'Διαμέρισμα', area: 'Πετράλωνα', street: 'Τρώων 3',
      price: 650, sqm: 52, deal: 'Ενοικίαση', mandate: 'Απλή', end: '', partner: who.me.name, status: 'Ενοικιάστηκε', week: 0, month: 1, total: 11 },
    { code: 'DEMO5', title: 'Διαμέρισμα προς πώληση στη Γκύζη', type: 'Διαμέρισμα', area: 'Γκύζη', street: 'Λευκωσίας 12',
      price: 198000, sqm: 84, deal: 'Πώληση', mandate: 'Απλή', end: plus(60), partner: team, status: 'Διαθέσιμο', week: 1, month: 3, total: 5 },
    { code: 'DEMO6', title: 'Μονοκατοικία προς ενοικίαση στο Χαλάνδρι', type: 'Μονοκατοικία', area: 'Χαλάνδρι', street: 'Αγ. Παρασκευής 40',
      price: 2100, sqm: 210, deal: 'Ενοικίαση', mandate: 'Αποκλειστική', end: plus(120), partner: team, status: 'Διαθέσιμο', week: 0, month: 2, total: 2 }
  ];
}

function demoLeads_(who, now) {
  const H = 3600000, D = 86400000, t = now.getTime();
  const at = (days, h, m) => { const d = new Date(t + days * D); d.setHours(h, m || 0, 0, 0); return d; };
  const round = ms => { const d = new Date(ms); d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0); return d; };
  const phone = n => n === 1 && DEMO.MY_PHONE ? String(DEMO.MY_PHONE).replace(/\D/g, '') : '69000001' + ('0' + n).slice(-2);
  const P = {
    DEMO1: ['Διαμέρισμα', '78', 'Ενοικίαση', 'Κουκάκι', 950, 'Βεΐκου 10, Κουκάκι'],
    DEMO2: ['Διαμέρισμα', '105', 'Πώληση', 'Παγκράτι', 245000, 'Υμηττού 50, Παγκράτι'],
    DEMO3: ['Μεζονέτα', '124', 'Πώληση', 'Νέος Κόσμος', 380000, 'Φρατζή 7, Νέος Κόσμος'],
    DEMO4: ['Διαμέρισμα', '52', 'Ενοικίαση', 'Πετράλωνα', 650, 'Τρώων 3, Πετράλωνα']
  };
  const L = (n, name, code, date, source, app, message) => {
    const p = P[code];
    return { id: 'DEMO-L' + ('0' + n).slice(-2), n: n, name: name, code: code, date: date, source: source,
      phone: phone(n), type: p[0], sqm: p[1], deal: p[2], location: p[3], price: p[4], address: p[5],
      message: message || '', app: app || null };
  };
  return [
    L(1, 'Αλεξάνδρα Παππά', 'DEMO1', new Date(t - 20 * 60000), 'Spitogatos', null,
      'Καλησπέρα, ενδιαφέρομαι για το διαμέρισμα. Δέχεστε κατοικίδιο;'),
    L(2, 'Ιωάννα Κωστή', 'DEMO3', new Date(t - 2 * H), 'Χρυσή Ευκαιρία', null,
      'Θα ήθελα περισσότερες φωτογραφίες και αν έχει θέση στάθμευσης.'),
    L(3, 'Νίκος Σταύρου', 'DEMO2', at(-1, 10, 5), 'Spitogatos',
      { status: 'Δεν απάντησε', called: at(-1, 11, 0), followUp: round(t + 2 * H) }),
    L(4, 'Μαρία Αντωνίου', 'DEMO1', at(-6, 11, 20), 'Spitogatos',
      { status: 'Υπόδειξη', called: at(-6, 12, 0), showing: round(t + 1.5 * H), notes: 'Μετακόμιση από Ιανουάριο. Έχει σκυλάκι.' }),
    L(5, 'Ελένη Νικολάου', 'DEMO2', at(-9, 9, 40), 'Site γραφείου',
      { status: 'Υπόδειξη', called: at(-9, 10, 0), showing: round(t + 4 * H) }),
    L(6, 'Κώστας Δημητρίου', 'DEMO3', at(-12, 13, 10), 'Spitogatos',
      { status: 'Υπόδειξη', called: at(-12, 14, 0), showing: round(t - 3 * H) }),
    L(7, 'Γιάννης Μαρκόπουλος', 'DEMO3', at(-20, 18, 30), 'Χρυσή Ευκαιρία',
      { status: 'Υπόδειξη', called: at(-20, 19, 0), showing: at(-5, 18, 0), outcome: (CONFIG.OUTCOMES || ['Ενδιαφέρθηκε'])[0],
        outcomeNote: 'Του άρεσε πολύ. Θα φέρει τη σύζυγο για δεύτερη υπόδειξη.', notes: 'Budget έως 400.000 €, με δάνειο.' }),
    L(8, 'Σοφία Βασιλείου', 'DEMO4', at(-28, 10, 0), 'Site γραφείου',
      { status: 'Κλειστή', called: at(-28, 11, 0), notes: 'Ενοικίασε το ακίνητο. Υπογραφή μισθωτηρίου 1/11.' }),
    L(9, 'Θοδωρής Ραφαηλίδης', 'DEMO2', at(-3, 9, 15), 'Spitogatos',
      { status: 'Απαντημένη', called: at(-2, 13, 0), notes: 'Θα ξαναπάρει μετά τις γιορτές.' }),
    L(10, 'Δήμητρα Λαμπρινού', 'DEMO1', at(-4, 16, 45), 'Χρυσή Ευκαιρία',
      { status: 'Δεν απάντησε', called: at(-4, 17, 0), followUp: at(1, 10, 0) })
  ];
}

function demoTasks_(who, now) {
  const D = 86400000, iso = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const inTwo = new Date(now.getTime() + 2 * 3600000);
  const hm = Utilities.formatDate(inTwo, TZ, 'HH') + ':30';
  const late = Number(Utilities.formatDate(now, TZ, 'H')) >= 21;
  return [
    ['DEMO-T1', 'Κλήση ιδιοκτήτη για νέα τιμή', 'Να του πω για τις 9 κλήσεις του μήνα.', iso(late ? new Date(now.getTime() + D) : now), late ? '10:30' : hm, '', 'DEMO-L09', 'DEMO2'],
    ['DEMO-T2', 'Φωτογράφιση ακινήτου', '', iso(now), '', '', '', 'DEMO3'],
    ['DEMO-T3', 'Ανανέωση εντολής', 'Λήγει σε 21 ημέρες.', iso(new Date(now.getTime() + 2 * D)), '10:00', '', '', 'DEMO1'],
    ['DEMO-T4', 'Στείλε ΠΕΑ στον ιδιοκτήτη', '', iso(new Date(now.getTime() - D)), '', new Date(now.getTime() - 3 * 3600000), '', 'DEMO2']
  ];
}

function demoCrm_(who, leads) {
  const me = who.me.name, other = who.team ? who.team.name : 'Άλλος Μεσίτης';
  const ph = n => leads[n - 1].phone;
  // [ID, Επαφή, Ιδιότητα, Τηλέφωνο, Email, Επάγγελμα, Οδός, Περιοχή, Πηγή, Συνεργάτης, ημέρες πριν]
  return [
    ['DEMO-C01', 'Αλεξάνδρα Παππά', 'Μισθωτής', ph(1), 'a.pappa@example.com', 'Γραφίστρια', '', 'Κουκάκι', 'Spitogatos', me, 1],
    ['DEMO-C02', 'Νίκος Σταύρου', 'Αγοραστής', ph(3), '', 'Μηχανικός', '', 'Βύρωνας', 'Spitogatos', me, 40],
    ['DEMO-C03', 'Μαρία Αντωνίου', 'Μισθωτής', ph(4), 'm.antoniou@example.com', 'Εκπαιδευτικός', 'Δράκου 4', 'Κουκάκι', 'Spitogatos', me, 6],
    ['DEMO-C04', 'Γιάννης Μαρκόπουλος', 'Αγοραστής, Επενδυτής', ph(7), 'g.markopoulos@example.com', 'Ιατρός', '', 'Νέα Σμύρνη', 'Χρυσή Ευκαιρία', me, 120],
    ['DEMO-C05', 'Παναγιώτης Λεοντίου', 'Πωλητής', '6900000205', 'p.leontiou@example.com', 'Συνταξιούχος', 'Υμηττού 50', 'Παγκράτι', 'Σύσταση', me, 200],
    ['DEMO-C06', 'Ευαγγελία Μητροπούλου', 'Εκμισθωτής', '6900000206', '', 'Δικηγόρος', 'Βεΐκου 10', 'Κουκάκι', 'Γνωριμία', me, 90],
    ['DEMO-C07', 'Χρήστος Αθανασίου', 'Αγοραστής', '6900000207', 'ch.athanasiou@example.com', 'Ιδιωτικός υπάλληλος', '', 'Γλυφάδα', 'Site γραφείου', me, 15],
    ['DEMO-C08', 'Κοινή Επαφή (δεν φαίνεται)', 'Αγοραστής', '6900000208', '', '', '', '', 'Spitogatos', me + ', ' + other, 10]
  ];
}

// ─────────────────────────────────────────────────────────────
//  ΓΡΑΨΙΜΟ ΣΤΑ ΦΥΛΛΑ
// ─────────────────────────────────────────────────────────────

function demoAppendProps_(props) {
  const sh = demoSheet_(CONFIG.SHEETS.PROPS, true);
  const width = Math.max(sh.getLastColumn(), demoCol_(PCOL.STATUS));
  const headers = sh.getRange(1, 1, 1, width).getValues()[0];
  const dealCol = propDealCol_(headers);
  const rows = props.map(p => {
    const r = new Array(width).fill('');
    const put = (letter, v) => { r[demoCol_(letter) - 1] = v; };
    put(PCOL.ID, p.code); put(PCOL.TITLE, p.title); put(PCOL.TYPE, p.type); put(PCOL.AREA, p.area);
    put(PCOL.STREET, p.street); put(PCOL.PRICE, p.price); put(PCOL.SQM, p.sqm); put(PCOL.MANDATE, p.mandate);
    put(PCOL.MANDATE_END, p.end); put(PCOL.PARTNER, p.partner); put(PCOL.STATUS, p.status);
    if (dealCol && dealCol <= width && !r[dealCol - 1]) r[dealCol - 1] = p.deal;
    return r;
  });
  demoAppend_(sh, rows);
  return rows.length + ' (DEMO1–DEMO6)';
}

function demoAppendTotals_(props) {
  const sh = sheetLike_(CONFIG.SHEETS.TOTALS);
  if (!sh) return 'δεν βρέθηκε το φύλλο, παραλείπεται';
  const width = Math.max(sh.getLastColumn(), demoCol_(TCOL.WEEK));
  const rows = props.map(p => {
    const r = new Array(width).fill('');
    r[demoCol_(TCOL.ID) - 1] = p.code;
    r[demoCol_(TCOL.TOTAL) - 1] = p.total;
    r[demoCol_(TCOL.MONTH) - 1] = p.month;
    r[demoCol_(TCOL.WEEK) - 1] = p.week;
    return r;
  });
  demoAppend_(sh, rows);
  return String(rows.length);
}

/** Στο μηνιαίο φύλλο της ημερομηνίας της (ΕΕΕΕ-ΜΜ). Αν λείπει το φύλλο, φτιάχνεται. */
function demoAppendLeads_(leads) {
  const ss = getSS();
  const width = demoCol_(LCOL.REPEAT);
  const byMonth = {};
  leads.forEach(l => {
    const m = Utilities.formatDate(l.date, TZ, 'yyyy-MM');
    (byMonth[m] = byMonth[m] || []).push(l);
  });
  const out = [];
  Object.keys(byMonth).sort().forEach(m => {
    let sh = ss.getSheetByName(m);
    if (!sh) {
      sh = ss.insertSheet(m);
      const src = ss.getSheets().find(s => /^\d{4}-\d{2}$/.test(s.getName()) && s.getName() !== m && s.getLastRow() >= 1);
      const head = src ? src.getRange(1, 1, 1, Math.max(src.getLastColumn(), width)).getValues()[0]
        : ['ID', 'Ημερομηνία', 'Πηγή', 'Υπόψη', 'Όνομα', 'Τηλέφωνο', 'Email', 'Κωδικός', 'Τύπος', 'Τ.μ.', 'Συναλλαγή',
           'Περιοχή', 'Τιμή', 'Μήνυμα', '', '', 'Επανάληψη'];
      sh.getRange(1, 1, 1, head.length).setValues([head]);
      out.push('νέο φύλλο «' + m + '»');
    }
    const w = Math.max(sh.getLastColumn(), width);
    const rows = byMonth[m].map(l => {
      const r = new Array(w).fill('');
      const put = (letter, v) => { r[demoCol_(letter) - 1] = v; };
      put(LCOL.ID, l.id); put(LCOL.DATE, l.date); put(LCOL.SOURCE, l.source); put(LCOL.NAME, l.name);
      put(LCOL.PHONE, l.phone); put(LCOL.EMAIL, ''); put(LCOL.CODE, l.code); put(LCOL.TYPE, l.type);
      put(LCOL.SQM, l.sqm); put(LCOL.DEAL, l.deal); put(LCOL.LOCATION, l.location); put(LCOL.PRICE, l.price);
      put(LCOL.MESSAGE, l.message);
      return r;
    });
    // Τηλέφωνα ως κείμενο, ώστε να μη χαθεί κανένα ψηφίο.
    demoAppend_(sh, rows, [demoCol_(LCOL.PHONE)]);
    out.push(rows.length + ' στο «' + m + '»');
  });
  return out.join(', ');
}

/** Η κατάσταση κάθε κλήσης, στις στήλες του «Εφαρμογή» (βρίσκονται από την επικεφαλίδα). */
function demoAppendApp_(leads, who, now) {
  const sh = demoSheet_(CONFIG.SHEETS.APP, true);
  const width = Math.max(sh.getLastColumn(), ACOL.WIDTH);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(norm_);
  const col = (name, fallback) => { const i = head.indexOf(norm_(name)); return i !== -1 ? i + 1 : fallback; };
  const C = {
    ID: col('ID', ACOL.ID), AGENT: col('Μεσίτης', ACOL.AGENT), STATUS: col('Κατάσταση', ACOL.STATUS),
    NOTES: col('Σημειώσεις', ACOL.NOTES), OPENED: col('Άνοιξε', ACOL.OPENED), CALLED: col('Κάλεσε', ACOL.CALLED),
    FU_AT: col('Follow-up', ACOL.FU_AT), SHOW_AT: col('Υπόδειξη', ACOL.SHOW_AT), SHOW_ID: col('Event ID', ACOL.SHOW_ID),
    ADDRESS: col('Διεύθυνση', ACOL.ADDRESS), CLIENT: col('Πελάτης', ACOL.CLIENT), PROPERTY: col('Ακίνητο', ACOL.PROPERTY),
    REMINDED: col('Υπενθύμιση', ACOL.REMINDED), UPDATED: col('Ενημέρωση', ACOL.UPDATED),
    PHONE: col('Τηλέφωνο πελάτη', ACOL.CLIENT_PHONE), OUTCOME: col('Αποτέλεσμα υπόδειξης', ACOL.OUTCOME),
    OUTCOME_NOTE: col('Σχόλιο αποτελέσματος', ACOL.OUTCOME_NOTE), OUTCOME_ASKED: col('Ρωτήθηκε αποτέλεσμα', ACOL.OUTCOME_ASKED)
  };
  const rows = leads.filter(l => l.app).map(l => {
    const a = l.app, r = new Array(width).fill('');
    const put = (k, v) => { if (C[k]) r[C[k] - 1] = v; };
    put('ID', l.id); put('AGENT', who.me.name); put('STATUS', a.status); put('NOTES', a.notes || '');
    put('OPENED', a.called || ''); put('CALLED', a.called || ''); put('FU_AT', a.followUp || '');
    put('CLIENT', l.name); put('PROPERTY', l.code); put('PHONE', l.phone); put('UPDATED', now);
    if (a.showing) {
      put('SHOW_AT', a.showing);
      put('SHOW_ID', 'demo::demo');          // «υπάρχει υπόδειξη», χωρίς πραγματικό event
      put('ADDRESS', l.address);
      put('REMINDED', now);                  // να μη σταλεί email υπενθύμισης
      if (a.showing < now) put('OUTCOME_ASKED', now);   // να μη ρωτηθεί με ειδοποίηση
    }
    put('OUTCOME', a.outcome || ''); put('OUTCOME_NOTE', a.outcomeNote || '');
    return r;
  });
  demoAppend_(sh, rows, [C.PHONE]);
  return String(rows.length);
}

function demoMarkNotified_(ids, now) {
  const sh = demoSheet_(CONFIG.SHEETS.NOTIFIED, true);
  demoAppend_(sh, ids.map(id => [id, now, 'δοκιμή · χωρίς ειδοποίηση']));
  return String(ids.length);
}

function demoAppendTasks_(who, now) {
  const sh = demoSheet_(CONFIG.SHEETS.TASKS, true);
  const rows = demoTasks_(who, now).map(t => {
    const r = new Array(KCOL.WIDTH).fill('');
    r[KCOL.ID - 1] = t[0]; r[KCOL.AGENT - 1] = who.me.name; r[KCOL.TITLE - 1] = t[1]; r[KCOL.NOTES - 1] = t[2];
    r[KCOL.DATE - 1] = t[3]; r[KCOL.TIME - 1] = t[4]; r[KCOL.DONE - 1] = t[5]; r[KCOL.LEAD - 1] = t[6];
    r[KCOL.CODE - 1] = t[7]; r[KCOL.CREATED - 1] = now; r[KCOL.UPDATED - 1] = now;
    return r;
  });
  // Ημερομηνία και ώρα ως κείμενο: αλλιώς το Sheets τις κάνει ημερομηνία με άλλη ζώνη ώρας.
  demoAppend_(sh, rows, [KCOL.DATE, KCOL.TIME]);
  return rows.length + ' (2 σήμερα, 1 επόμενη, 1 ολοκληρωμένη)';
}

/** Στο «Επαφές» (το CRM). Αν είναι άδειο, μπαίνουν επικεφαλίδες όπως του GridExport. */
function demoAppendCrm_(who, leads) {
  const ss = getSS();
  let sh = ss.getSheetByName(CONFIG.SHEETS.CONTACTS);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEETS.CONTACTS);
  const std = ['', 'ID', 'Επαφή', 'Καταχώρηση', 'Επάγγελμα', 'Ιδιότητα', 'Τηλέφωνο', 'Email', 'Οδός', 'Περιοχή', 'Πηγή', 'Συνεργάτης', 'Κατάσταση'];
  let hi = -1, head = null;
  if (sh.getLastRow() >= 1) {
    const top = sh.getRange(1, 1, Math.min(5, sh.getLastRow()), Math.max(1, sh.getLastColumn())).getValues();
    hi = top.findIndex(r => r.some(h => CRM_COLS.NAME.test(norm_(h))) && r.some(h => CRM_COLS.PARTNER.test(norm_(h))));
    if (hi !== -1) head = top[hi].map(norm_);
  }
  if (hi === -1) {
    if (sh.getLastRow() > 0) throw new Error('Το «' + CONFIG.SHEETS.CONTACTS + '» έχει στοιχεία χωρίς επικεφαλίδες CRM. Δεν γράφω τίποτα εκεί.');
    sh.getRange(1, 1, 1, std.length).setValues([std]);
    head = std.map(norm_);
  }
  const width = head.length;
  const idx = re => head.findIndex(h => re.test(h));
  const C = { ID: idx(CRM_COLS.ID), NAME: idx(CRM_COLS.NAME), ADDED: idx(CRM_COLS.ADDED), JOB: idx(CRM_COLS.JOB),
    ROLE: idx(CRM_COLS.ROLE), PHONE: idx(CRM_COLS.PHONE), EMAIL: idx(CRM_COLS.EMAIL), STREET: idx(CRM_COLS.STREET),
    AREA: idx(CRM_COLS.AREA), SOURCE: idx(CRM_COLS.SOURCE), PARTNER: idx(CRM_COLS.PARTNER), STATUS: idx(CRM_COLS.STATUS) };
  if (C.ID === -1) throw new Error('Στο «' + CONFIG.SHEETS.CONTACTS + '» δεν βρέθηκε στήλη «ID».');
  const rows = demoCrm_(who, leads).map(c => {
    const r = new Array(width).fill('');
    const put = (k, v) => { if (C[k] !== -1) r[C[k]] = v; };
    put('ID', c[0]); put('NAME', c[1]); put('ROLE', c[2]); put('PHONE', c[3]); put('EMAIL', c[4]); put('JOB', c[5]);
    put('STREET', c[6]); put('AREA', c[7]); put('SOURCE', c[8]); put('PARTNER', c[9]); put('STATUS', 'Ενεργή');
    put('ADDED', new Date(Date.now() - c[10] * 86400000));
    return r;
  });
  demoAppend_(sh, rows, C.PHONE !== -1 ? [C.PHONE + 1] : []);
  return rows.length + ' (η 8η είναι κοινή με άλλον μεσίτη, άρα σωστά ΔΕΝ φαίνεται)';
}

/** 2.1: τρία έτοιμα προφίλ (θερμός αγοραστής, κρύος αγοραστής, ενοικιαστής με σκύλο). Θέλει το Profile.gs. */
function demoAppendProfiles_(who, now) {
  if (typeof PROFILE === 'undefined' || typeof profileSummary_ !== 'function') return 'παραλείπεται (δεν υπάρχει το Profile.gs)';
  const list = [
    ['DEMO-L07', 'DEMO3', 'Θερμός', { deal: 'buy', fin: 'loan', preapproval: true, when: 'now', decider: false, companions: 'σύζυγος',
      budgetBuy: 400000, costs: true }],
    ['DEMO-L05', 'DEMO2', 'Κρύος', { deal: 'buy', fin: 'sale', when: 'explore', decider: true, budgetBuy: 200000, areasBuy: 'Γκύζη, Ζωγράφου' }],
    ['DEMO-L04', 'DEMO1', 'Θερμός', { deal: 'rent', people: 2, household: 'ζευγάρι', jobType: 'private', jobField: 'τράπεζα',
      pet: 'yes', petKind: 'μικρός σκύλος', moveIn: 'now', budgetRent: 1000 }]
  ];
  const sh = profileSheet_();
  demoAppend_(sh, list.map(x => [x[0], who.me.name, x[1], x[3].deal === 'rent' ? 'Ενοικίαση' : 'Αγορά', x[2],
    profileSummary_(x[3]), JSON.stringify(x[3]), now, now]));
  return list.length + ' (Μαρία Αντωνίου, Ελένη Νικολάου, Γιάννης Μαρκόπουλος)';
}

// ─────────────────────────────────────────────────────────────
//  ΑΔΕΙΑΣΜΑ
// ─────────────────────────────────────────────────────────────

/** Σβήνει από ΚΑΘΕ φύλλο τις γραμμές με σήμα DEMO, τα events τους και τους φακέλους DEMO στο Drive. */
function demoClearAll_(verbose) {
  const books = [getSS()];
  const appId = CONFIG.APP_SPREADSHEET_ID;
  if (appId && appId !== CONFIG.SPREADSHEET_ID) books.push(SpreadsheetApp.openById(appId));

  demoDeleteEvents_(books);

  let total = 0;
  const log = [];
  books.forEach(ss => ss.getSheets().forEach(sh => {
    const rows = demoFindRows_(sh, r => r.some(v => DEMO_TOKEN.test(String(v))));
    if (!rows.length) return;
    demoDeleteRows_(sh, rows);
    total += rows.length;
    log.push('  ' + sh.getName() + ': ' + rows.length);
  }));

  // Φάκελοι DEMO που έφτιαξε η εφαρμογή (π.χ. άνοιξες τα Έγγραφα δοκιμαστικού ακινήτου).
  let folders = 0;
  try {
    const it = DriveApp.searchFolders("title contains 'DEMO' and trashed = false");
    while (it.hasNext()) {
      const f = it.next();
      if (/(^|[^A-Za-z0-9])DEMO\d+([^0-9]|$)/.test(f.getName())) { f.setTrashed(true); folders++; }
    }
  } catch (e) { console.log('Drive: ' + e.message); }

  // Εξώφυλλα που διάλεξες σε δοκιμαστικά ακίνητα.
  const sp = PropertiesService.getScriptProperties();
  Object.keys(sp.getProperties()).filter(k => /^COVER_DEMO/.test(k)).forEach(k => sp.deleteProperty(k));

  if (verbose && log.length) console.log('Ανά φύλλο:\n' + log.join('\n') + (folders ? '\n  Φάκελοι Drive στον κάδο: ' + folders : ''));
  return total;
}

/** Events που έφτιαξε η εφαρμογή για δοκιμαστικές κλήσεις/εργασίες (μορφή «calendarId::eventId»). */
function demoDeleteEvents_(books) {
  const ids = [];
  books.forEach(ss => [CONFIG.SHEETS.APP, CONFIG.SHEETS.TASKS].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(r => {
      if (!r.some(v => DEMO_TOKEN.test(String(v)))) return;
      r.forEach(v => { const s = String(v); if (/^[^:\s]+::[^:\s]+$/.test(s) && s !== 'demo::demo') ids.push(s); });
    });
  }));
  ids.forEach(s => {
    try {
      const parts = s.split('::');
      const cal = CalendarApp.getCalendarById(parts[0]);
      const ev = cal && cal.getEventById(parts[1]);
      if (ev) ev.deleteEvent();
    } catch (e) { /* ήδη σβησμένο */ }
  });
}

// ─────────────────────────────────────────────────────────────
//  ΒΟΗΘΗΤΙΚΑ
// ─────────────────────────────────────────────────────────────

function demoGuard_() {
  if (CONFIG.ENV === 'prod') throw new Error('Τα δοκιμαστικά στοιχεία δεν μπαίνουν στο παραγωγικό (CONFIG.ENV = prod).');
  const prodIds = DEMO.PROD_IDS.concat(prop_('PROD_SPREADSHEET_IDS').split(',').map(function (x) { return x.trim(); }).filter(String));
  if (!CONFIG.SPREADSHEET_ID) throw new Error('Δεν έχει οριστεί η Ιδιότητα σεναρίου SPREADSHEET_ID. Σταματώ.');
  if (prodIds.indexOf(CONFIG.SPREADSHEET_ID) !== -1) throw new Error('Το SPREADSHEET_ID είναι το παραγωγικό workbook. Σταματώ.');
}

/** Ο μεσίτης «μου» και ένας δεύτερος για την ομάδα, από το Agents. */
function demoAgents_() {
  const sh = sheet_(CONFIG.SHEETS.AGENTS);
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(norm_);
  const cn = head.indexOf(norm_(AGENT_HEADERS.NAME)), ce = head.indexOf(norm_(AGENT_HEADERS.EMAIL));
  if (cn === -1) throw new Error('Στο Agents λείπει η στήλη «' + AGENT_HEADERS.NAME + '».');
  const list = vals.slice(1).map(r => ({ name: String(r[cn] || '').trim(), email: ce === -1 ? '' : String(r[ce] || '').trim().toLowerCase() }))
    .filter(a => a.name);
  if (!list.length) throw new Error('Το Agents δεν έχει μεσίτες.');
  const mine = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const me = (DEMO.AGENT && list.find(a => norm_(a.name) === norm_(DEMO.AGENT))) ||
             list.find(a => a.email && a.email === mine) || list[0];
  const team = (DEMO.TEAM_AGENT && list.find(a => norm_(a.name) === norm_(DEMO.TEAM_AGENT))) ||
               list.find(a => a.name !== me.name) || null;
  return { me: me, team: team };
}

function demoSheet_(name, must) {
  const sh = getSS().getSheetByName(name) ||
    (CONFIG.APP_SPREADSHEET_ID ? SpreadsheetApp.openById(CONFIG.APP_SPREADSHEET_ID).getSheetByName(name) : null);
  if (!sh && must) throw new Error('Λείπει το φύλλο «' + name + '». Τρέξε πρώτα τη setup.');
  return sh;
}

function demoCol_(letter) { return colIdx_(letter); }

/** Προσθέτει γραμμές στο τέλος. textCols: στήλες (1, 2…) που γράφονται ως κείμενο. */
function demoAppend_(sh, rows, textCols) {
  if (!rows.length) return;
  const start = sh.getLastRow() + 1, width = rows[0].length;
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  (textCols || []).filter(Boolean).forEach(c => sh.getRange(start, c, rows.length, 1).setNumberFormat('@'));
  sh.getRange(start, 1, rows.length, width).setValues(rows.map(r => r.map((v, i) =>
    (textCols || []).indexOf(i + 1) !== -1 && v !== '' ? String(v) : v)));
}

/** Οι γραμμές (1, 2…) που περνούν τον έλεγχο, από τη 2η και κάτω. */
function demoFindRows_(sh, test) {
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const out = [];
  vals.forEach((r, i) => { if (test(r)) out.push(i + 2); });
  return out;
}

/** Σβήνει γραμμές από κάτω προς τα πάνω, σε συνεχόμενα κομμάτια. */
function demoDeleteRows_(sh, rows) {
  rows = rows.slice().sort((a, b) => b - a);
  let i = 0;
  while (i < rows.length) {
    let end = rows[i], start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { start = rows[++i]; }
    // Το Sheets δεν σβήνει όλες τις γραμμές κάτω από τις «παγωμένες»· τότε αδειάζουμε.
    if (start <= sh.getFrozenRows() + 1 && end === sh.getMaxRows()) sh.getRange(start, 1, end - start + 1, sh.getMaxColumns()).clearContent();
    else sh.deleteRows(start, end - start + 1);
    i++;
  }
}

function demoFindAllLeadIds_() {
  const ss = getSS(), out = [];
  monthNames_().forEach(m => {
    const sh = ss.getSheetByName(m);
    demoFindRows_(sh, r => /^DEMO-/.test(String(r[0]))).forEach(x => out.push(x));
  });
  return out;
}
