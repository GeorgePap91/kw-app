/**
 * KWAC Command Center · Αυτόματες ημερομηνίες · v1.1 (28/11/2026)
 *
 * Μπαίνει ΜΟΝΟ στο Apps Script του workbook «KWAC Command Center»
 * (Επεκτάσεις → Apps Script). ΔΕΝ ανήκει στο apps-script/ της KW App.
 *
 * Τι κάνει: όταν αλλάζεις ένα κελί κατάστασης, γράφει ή σβήνει μόνο του
 * την ημερομηνία δίπλα, ώστε να μετρά σωστά το ταμπλό «Πρόοδος».
 *   Στόχοι · τσεκάρεις «Έγινε»            → «Ολοκληρώθηκε» = σήμερα (ξετσεκάρεις → σβήνει)
 *   Ιδέες  · Κατάσταση «Έτοιμο»           → «Ολοκληρώθηκε» = σήμερα (αλλάζει αλλού → σβήνει)
 *   Ιδέες  · γράφεις νέα «Λειτουργία»     → «Καταχωρήθηκε» = σήμερα (μόνο αν είναι κενό)
 *   QA     · «✓ Πέρασε» ή «✗ Απέτυχε»     → «Ημ. ελέγχου» = σήμερα (κάθε νέος έλεγχος)
 *            «Εκκρεμεί» ή κενό           → σβήνει
 *
 * Simple trigger onEdit: δεν θέλει εξουσιοδότηση, δεν στέλνει τίποτα έξω,
 * αγγίζει μόνο τις γραμμές που άλλαξαν (μία ανάγνωση + μία εγγραφή ανά κανόνα).
 * Δεν τρέχει για αλλαγές που κάνει άλλο script ή το API: εκεί η ημερομηνία
 * γράφεται από όποιον κάνει την αλλαγή.
 *
 * v1.1: γραμμή 1 = slicers, γραμμή 2 = κεφαλίδα, τα δεδομένα από τη γραμμή 3.
 */

const AUTO_DATE_FIRST_ROW = 3;

const AUTO_DATE_RULES = [
  { sheet: 'Στόχοι', watchCol: 6,  dateCol: 7,  when: 'checked',     onFalse: 'clear' },
  { sheet: 'Ιδέες',  watchCol: 10, dateCol: 13, when: ['Έτοιμο'],    onFalse: 'clear' },
  { sheet: 'Ιδέες',  watchCol: 3,  dateCol: 12, when: 'filled',      onFalse: 'keep'  },
  { sheet: 'QA',     watchCol: 6,  dateCol: 7,  when: ['✓ Πέρασε', '✗ Απέτυχε'], onFalse: 'clear', restamp: true }
];

/** Ταιριάζει η τιμή του κελιού με τον κανόνα; */
function autoDateMatches_(rule, value) {
  if (rule.when === 'checked') return value === true;
  if (rule.when === 'filled') return value !== '' && value !== null && value !== undefined;
  return rule.when.indexOf(value) !== -1;
}

/**
 * Καθαρή λογική (χωρίς φύλλα): από τις τιμές που παρακολουθούμε και τις
 * τρέχουσες ημερομηνίες, βγάζει τις νέες ημερομηνίες. Επιστρέφει null αν δεν αλλάζει τίποτα.
 */
function autoDateCompute_(rule, watchValues, dateValues, today) {
  let changed = false;
  const out = dateValues.map(function (row, i) {
    const cur = row[0];
    const empty = cur === '' || cur === null || cur === undefined;
    if (autoDateMatches_(rule, watchValues[i][0])) {
      if (empty || rule.restamp) { changed = true; return [today]; }
    } else if (rule.onFalse === 'clear' && !empty) {
      changed = true; return [''];
    }
    return [cur];
  });
  return changed ? out : null;
}

/** Οι κανόνες που αφορούν μια αλλαγή σε φύλλο/στήλες. */
function autoDateRulesFor_(sheetName, firstCol, numCols) {
  return AUTO_DATE_RULES.filter(function (r) {
    return r.sheet === sheetName && r.watchCol >= firstCol && r.watchCol < firstCol + numCols;
  });
}

function onEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sh = range.getSheet();
  const rules = autoDateRulesFor_(sh.getName(), range.getColumn(), range.getNumColumns());
  if (!rules.length) return;

  const start = Math.max(range.getRow(), AUTO_DATE_FIRST_ROW); // γραμμές 1–2: slicers, κεφαλίδα
  const end = range.getRow() + range.getNumRows() - 1;
  if (end < start) return;
  const n = end - start + 1;
  // Ημερομηνία ως κείμενο yyyy-MM-dd: τη διαβάζει το Sheets σαν πληκτρολόγηση,
  // στη ζώνη ώρας του workbook, χωρίς ώρα (αλλιώς τα COUNTIF ανά ημέρα αποτυγχάνουν).
  const today = Utilities.formatDate(new Date(), e.source.getSpreadsheetTimeZone(), 'yyyy-MM-dd');

  rules.forEach(function (rule) {
    const watch = sh.getRange(start, rule.watchCol, n, 1).getValues();
    const dateRange = sh.getRange(start, rule.dateCol, n, 1);
    const next = autoDateCompute_(rule, watch, dateRange.getValues(), today);
    if (next) dateRange.setValues(next);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { AUTO_DATE_FIRST_ROW, AUTO_DATE_RULES, autoDateMatches_, autoDateCompute_, autoDateRulesFor_ };
}
