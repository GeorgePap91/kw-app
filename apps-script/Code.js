/**
 * KW App — backend
 * ─────────────────────────────────────────────────────────────
 * Apps Script που δουλεύει ως API για τη σελίδα στο GitHub Pages.
 *
 *  · Διαβάζει το workbook «Κλήσεις»: μηνιαία φύλλα (ΕΕΕΕ-ΜΜ), Διαθέσιμα
 *    ακίνητα, Agents, Συνολικές κλήσεις διαθέσιμων ακινήτων.
 *  · ΔΕΝ γράφει στα μηνιαία φύλλα. Ό,τι καταγράφει η εφαρμογή πάει στο
 *    φύλλο «Εφαρμογή» (μία γραμμή ανά κλήση, με το ID της).
 *  · Ταυτότητα μεσίτη = προσωπικό κλειδί (στήλη «Κλειδί» στο Agents),
 *    που μπαίνει στο link του: https://…/kw-app/?k=<κλειδί>
 *  · Υποδείξεις και follow-up γράφονται στο ημερολόγιο του μεσίτη, αν το
 *    έχει μοιραστεί με τον λογαριασμό που τρέχει το script. Αλλιώς του
 *    στέλνεται πρόσκληση.
 *
 * Ανάπτυξη: Εκτέλεση ως «Εγώ», Πρόσβαση «Οποιοσδήποτε».
 * Κάθε αλλαγή κώδικα: Ανάπτυξη > Διαχείριση αναπτύξεων > ✏ > Νέα έκδοση
 * (έτσι το URL μένει ίδιο και δεν αλλάζεις το config.js).
 *
 * ΜΕΤΑΦΟΡΑ ΣΤΟ ΠΑΡΑΓΩΓΙΚΟ: αλλάζει ΜΟΝΟ το CONFIG παρακάτω (βλ. README).
 */

/** Έκδοση backend. Πρέπει να ταιριάζει με το APP_VERSION του app.js. */
const VERSION = '1.20';

/**
 * Ρυθμίσεις που διαφέρουν ανά περιβάλλον (DEV / PROD) ή είναι ιδιωτικές.
 * Διαβάζονται από τις Ιδιότητες σεναρίου (⚙ Ρυθμίσεις έργου → Script properties),
 * ΟΧΙ από τον κώδικα, γιατί ο κώδικας ζει σε δημόσιο repo στο GitHub.
 *   ENV                     'test' ή 'prod'
 *   SPREADSHEET_ID          workbook «Κλήσεις»
 *   OFFICE_EMAIL            reply-to στα email
 *   REFERRAL_SEND_TO        παραλήπτης εντύπων σύστασης/συνεργασίας (κενό = OFFICE_EMAIL)
 *   SHOWING_TEMPLATE_ID     Google Doc «Εντολή υπόδειξης»
 *   METRICS_SPREADSHEET_ID  workbook απαντήσεων «Μετρησιμότητα»
 *   PROD_SPREADSHEET_IDS    παραγωγικά workbooks (κόμμα) — το Demo δεν τα αγγίζει ποτέ
 * Διαβάζονται μία φορά ανά εκτέλεση (μία κλήση στο PropertiesService).
 */
const PROPS_ = (function () {
  try { return PropertiesService.getScriptProperties().getProperties(); } catch (e) { return {}; }
})();
function prop_(key, def) {
  const v = PROPS_[key];
  return v == null || String(v).trim() === '' ? (def || '') : String(v).trim();
}

const CONFIG = {
  // 'test' δείχνει μπάρα «ΔΟΚΙΜΑΣΤΙΚΟ» στην εφαρμογή. 'prod' την κρύβει.
  ENV: prop_('ENV', 'test'),

  // Το workbook «Κλήσεις». Στη δοκιμή: το αντίγραφό σου.
  SPREADSHEET_ID: prop_('SPREADSHEET_ID'),           // Ιδιότητα σεναρίου

  // Η διεύθυνση της σελίδας στο GitHub Pages (με / στο τέλος).
  // Χρησιμοποιείται για τα προσωπικά links και για το link μέσα στα events.
  APP_URL: 'https://georgepap91.github.io/kw-app/',

  OFFICE: {
    name:  'KW Athens Center',
    phone: '210 0000000',
    email: prop_('OFFICE_EMAIL')            // reply-to στα email υπενθύμισης (Ιδιότητα σεναρίου)
  },

  MONTHS_BACK: 2,               // τρέχων + προηγούμενος μήνας

  // ── Ειδοποιήσεις (1.9) ──────────────────────────────────
  // Πρωινή σύνοψη: DAYS = 0 Κυριακή … 6 Σάββατο. Η Google τρέχει τον trigger μέσα στην ώρα HOUR.
  MORNING: { HOUR: 9, DAYS: [1, 2, 3, 4, 5, 6] },
  FORM_REMINDER_HOUR: 10,       // κάθε Δευτέρα, μόνο σε όσους δεν έστειλαν τη φόρμα
  MANDATE_ALERT_DAYS: [30, 15, 7, 0],   // πόσες μέρες πριν τη λήξη της εντολής
  MANDATE_SOON_DAYS: 30,        // από πότε φαίνεται η σήμανση μέσα στην εφαρμογή
  OUTCOME_AFTER_HOURS: 1,       // πότε ρωτά «Πώς πήγε η υπόδειξη;»
  OUTCOMES: ['Ενδιαφέρθηκε', 'Θέλει δεύτερη υπόδειξη', 'Δεν ενδιαφέρθηκε', 'Δεν ήρθε'],

  // ── Επαφές (1.10) ───────────────────────────────────────
  CONTACTS: { MAIL_THREADS: 15, MAIL_MESSAGES: 20, MAIL_CHARS: 1500 },

  // ── Χάρτης ακινήτων (1.7) ───────────────────────────────
  // Στήλη «Ενοικίαση / Πώληση» του φύλλου ακινήτων, π.χ. 'K'. Κενό = βρίσκεται από
  // την επικεφαλίδα, μετά από τον τίτλο και τις κλήσεις του ακινήτου.
  PROP_DEAL_COL: '',
  MAP: {
    ENABLED: false,             // true = εμφανίζεται το tab Χάρτης και τρέχει ο εντοπισμός διευθύνσεων
    CITY: 'Αθήνα',              // μπαίνει στην αναζήτηση αν το ακίνητο δεν έχει περιοχή
    COUNTRY: 'Ελλάδα',
    BATCH: 40                   // διευθύνσεις ανά εκτέλεση (1 ανά δευτερόλεπτο)
  },
  REMINDER_HOURS_BEFORE: 3,     // email στον πελάτη πριν την υπόδειξη
  SHOWING_DURATION_MIN: 45,
  FOLLOWUP_HOURS: 2,            // «Δεν απάντησε» → follow-up σε τόσες ώρες
  FOLLOWUP_DURATION_MIN: 15,
  // 2.4 · FEAT-14 · Σκάλα follow-up (flag callLadder). Προσπάθεια → πότε ξανά.
  //  1η: +FOLLOWUP_HOURS · 2η: αύριο στο «άλλο» μέρος της μέρας · 3η: αύριο + έτοιμο SMS · 4η: σταματά.
  LADDER: { MAX: 4, MORNING: [10, 30], EVENING: [18, 0], SWITCH_HOUR: 14 },

  // Ειδοποίηση νέας κλήσης: κάθε πόσα λεπτά ελέγχει τα μηνιαία φύλλα (1, 5, 10).
  NEW_LEAD_CHECK_MIN: 1,
  NEW_LEAD_MAX_AGE_HOURS: 72,   // παλαιότερες κλήσεις δεν ειδοποιούνται

  // SMS υπενθύμισης στον πελάτη, REMINDER_HOURS_BEFORE πριν την υπόδειξη.
  //  'agent'  = δωρεάν: ο μεσίτης παίρνει ειδοποίηση, πατάει, και το SMS είναι
  //             έτοιμο να φύγει από το κινητό του (ένα πάτημα «Αποστολή»).
  //  'twilio' = αυτόματη αποστολή από πάροχο (χρέωση ανά SMS). Θέλει
  //             TWILIO_SID / TWILIO_FROM εδώ και TWILIO_TOKEN στα Script properties.
  //  'off'    = καθόλου.
  SMS_MODE: 'agent',
  TWILIO_SID: '',
  TWILIO_FROM: '',              // αριθμός Twilio (+1…) ή alphanumeric sender, π.χ. 'KWAthens'

  // ── Έγγραφα ακινήτου στο Drive ──────────────────────────
  // Ο φάκελος «Συνεργάτες» (το ID από το URL του). Μέσα του, ένας φάκελος ανά
  // μεσίτη. Το ακίνητο βρίσκεται με τον κωδικό του όπου κι αν είναι μέσα στον
  // φάκελο του μεσίτη (π.χ. Διαθέσιμα / Δεσμευμένα). Αν δεν υπάρχει, φτιάχνεται.
  // Κενό = η setup() φτιάχνει δοκιμαστικό φάκελο στο Drive σου.
  DRIVE_ROOT_ID: '',
  // Όνομα νέου φακέλου ακινήτου. ΠΡΕΠΕΙ να είναι ίδιο με αυτό που φτιάχνει το
  // script συγχρονισμού των Συνεργατών, αλλιώς εκείνο θα φτιάξει δεύτερο φάκελο.
  DRIVE_FOLDER_NAME: '{κωδικός} - {διεύθυνση}',
  DRIVE_STATUS_FOLDER: 'Διαθέσιμα', // αν υπάρχει μέσα στον φάκελο μεσίτη, τα νέα μπαίνουν εκεί
  DOCS_FOLDER: 'Έγγραφα KWAC',
  // Τα έγγραφα που χρειάζεται ένα ακίνητο για να βγει live. multi: δέχεται πολλά
  // αρχεία (π.χ. ταυτότητα μπρος-πίσω). Για νέο έγγραφο, πρόσθεσε μια γραμμή.
  DOCS: [
    { key: 'pea',     label: 'ΠΕΑ',                  file: 'ΠΕΑ',        multi: false },
    { key: 'mandate', label: 'Εντολή',               file: 'Εντολή',     multi: false },
    { key: 'id',      label: 'Ταυτότητα ιδιοκτήτη',  file: 'Ταυτότητα',  multi: true  }
  ],
  MAX_UPLOAD_MB: 20,

  // Υπενθύμιση «λείπουν έγγραφα». Ξεκινά ΜΟΝΟ όταν το ακίνητο έχει το έγγραφο
  // REQUIRES (την εντολή) και συνεχίζει μέχρι να ανέβουν όλα τα υπόλοιπα.
  //  EVERY: 'week' (κάθε Δευτέρα) ή 'day' (κάθε μέρα), στις HOUR.
  DOCS_REMINDER: { REQUIRES: 'mandate', EVERY: 'week', HOUR: 9 },

  // ── Έντυπο υπόδειξης (1.14) ─────────────────────────────
  // Ο μεσίτης στέλνει στον πελάτη link μίας χρήσης. Ο πελάτης συμπληρώνει τα στοιχεία
  // του και υπογράφει στην οθόνη ή διαλέγει εκτύπωση. Η εφαρμογή γεμίζει το πρότυπο
  // (Google Doc με πεδία {{…}}) και βάζει το PDF στον φάκελο FOLDER του ακινήτου.
  // Τα στοιχεία του πελάτη ΔΕΝ γράφονται σε κανένα φύλλο: μόνο μέσα στο PDF.
  SHOWING_FORM: {
    TEMPLATE_ID: prop_('SHOWING_TEMPLATE_ID'),   // Google Doc «Εντολή υπόδειξης - πρότυπο KW App» (Ιδιότητα σεναρίου)
    FOLDER: 'Υποδείξεις',       // μέσα στον φάκελο του ακινήτου
    EXPIRE_HOURS: 72,           // πόσο ισχύει το link
    MAX_OPENS: 30,              // πόσες φορές ανοίγει πριν κλειδώσει
    SEND_COPY: true,            // αντίγραφο PDF στο email του πελάτη (όρος: «λαβόντος από ένα όμοιο αντίτυπο»)
    CITY: 'Αθήνα',
    VAT: 24,
    SALE_PCT: 2, SALE_PCT_WORD: 'ΔΥΟ',
    FEE_SALE: '2% + Φ.Π.Α. 24%',
    FEE_RENT: '1 ΜΙΣΘΩΜΑ + Φ.Π.Α. 24%'
  },

  // ── Σύσταση / Συνεργασία (1.15) ─────────────────────────
  // Ο μεσίτης συμπληρώνει το έντυπο στην εφαρμογή, υπογράφει στην οθόνη, και το PDF
  // φεύγει με email στο SEND_TO. Τα πρότυπα βρίσκονται από το όνομά τους στο Drive
  // (ή από το ID, αν το γράψεις εδώ).
  REFERRAL: {
    TEMPLATE_SYSTASI: '', TEMPLATE_SYNERGASIA: '',
    NAME_SYSTASI: 'Έντυπο σύστασης - πρότυπο KW App',
    NAME_SYNERGASIA: 'Έντυπο συνεργασίας - πρότυπο KW App',
    SEND_TO: prop_('REFERRAL_SEND_TO', prop_('OFFICE_EMAIL')),   // Ιδιότητα σεναρίου· κενό = OFFICE_EMAIL
    CC_AGENT: false,                           // αντίγραφο και στον μεσίτη
    FOLDER: 'Συστάσεις - Συνεργασίες'          // μέσα στον φάκελο του μεσίτη στο Drive
  },

  // ── Τιμολόγηση (1.13) ───────────────────────────────────
  // Τα έντυπα που ζητά το λογιστήριο για την απόδειξη. Μπαίνουν στον φάκελο FOLDER,
  // μέσα στον φάκελο του ακινήτου (δίπλα στο «Έγγραφα KWAC»).
  //  optional: «αν υπάρχει», δεν μετράει στο «4/5».
  //  multi:    δέχεται πολλά αρχεία μαζί (π.χ. πολλές υποδείξεις).
  //  from:     η Εντολή αντιγράφεται από την τελευταία του «Έγγραφα KWAC».
  //  alt:      εναλλακτικό όνομα αρχείου (σε ενοικίαση: «Μισθωτήριο»).
  //  pick:     1.20 · διαλέγεις από τα έντυπα του ακινήτου («Υποδείξεις», «Προσφορές») αντί να ψάχνεις.
  BILLING: {
    FOLDER: 'Τιμολόγηση',
    DOCS: [
      { key: 'mandate',   label: 'Εντολή',                  file: 'Εντολή', from: 'mandate' },
      { key: 'showing',   label: 'Υπόδειξη',                file: 'Υπόδειξη', multi: true, pick: 'showform' },
      { key: 'offer',     label: 'Προσφορά',                file: 'Προσφορά', optional: true, pick: 'offerform' },
      { key: 'depBuyer',  label: 'Καταθετήριο αγοραστή',    file: 'Καταθετήριο αγοραστή' },
      { key: 'depSeller', label: 'Καταθετήριο πωλητή',      file: 'Καταθετήριο πωλητή' },
      { key: 'referral',  label: 'Έντυπο σύστασης',         file: 'Έντυπο σύστασης', optional: true },
      { key: 'contract',  label: 'Συμβόλαιο ή μισθωτήριο',  file: 'Συμβόλαιο', alt: 'Μισθωτήριο' }
    ]
  },

  // ── Εργασίες ────────────────────────────────────────────
  TASK_DURATION_MIN: 30,
  TASK_DONE_DAYS: 30,           // ολοκληρωμένες που εμφανίζονται ακόμα

  // Προεπιλεγμένα χρώματα ημερολογίου (1–11, όπως στο Google Calendar).
  // Ο κάθε μεσίτης τα αλλάζει από το ⚙.
  COLORS: { showing: '10', followup: '6', task: '7' },

  // ── Ασφάλεια ───────────────────────────────────────────
  SECURITY: {
    PAIR_CODE_MIN: 10,          // λεπτά που ισχύει ο κωδικός σύνδεσης νέας συσκευής
    PAIR_MAX_TRIES: 5,          // λάθος προσπάθειες πριν ακυρωθεί ο κωδικός
    PAIR_MAX_PER_HOUR: 5,       // κωδικοί ανά μεσίτη ανά ώρα (προστασία από spam)
    IDLE_DAYS: 90               // συσκευή αχρησιμοποίητη τόσες μέρες → ξανά σύνδεση
  },
  // Όνομα πελάτη στις ειδοποιήσεις; false = δεν φαίνεται στην κλειδωμένη οθόνη.
  PUSH_SHOW_CLIENT: false,

  SHEETS: {
    ACCESS:   'Πρόσβαση',
    LOG:      'Ιστορικό ασφαλείας',
    AGENTS:   'Agents',
    PROPS:    'Διαθέσιμα ακίνητα',
    TOTALS:   'Συνολικές κλήσεις διαθέσιμων ακινήτων',
    APP:      'Εφαρμογή',
    DEVICES:  'Συσκευές',
    NOTIFIED: 'Ειδοποιήσεις',
    DOCS:     'Έγγραφα',
    TASKS:    'Εργασίες',
    MAP:      'Χάρτης',
    CONTACTS: 'Επαφές',              // το Excel του CRM, μόνο ανάγνωση
    CONTACTS_APP: 'Επαφές εφαρμογής', // γράφει η εφαρμογή
    SHOWFORM: 'Έντυπα υπόδειξης',     // 1.14: ΜΟΝΟ κατάσταση, ποτέ στοιχεία πελάτη
    KW_PARTNERS: 'Συνεργάτες KW',     // 1.15: συνεργάτες άλλων γραφείων KW (μόνο ανάγνωση)
    REFERRALS: 'Συστάσεις',           // 1.15: ιστορικό συστάσεων/συνεργασιών, χωρίς στοιχεία πελάτη
    REVIEW:   'Έλεγχος εντύπων',      // 1.17: έγκριση εντύπων από τον Admin, χωρίς στοιχεία πελάτη
    PRESENT:  'Παρουσιάσεις',         // 1.19: links παρουσίασης ακινήτου, χωρίς στοιχεία πελάτη
    CALLS:    'Ιστορικό κλήσεων',     // 1.20: κάθε κλήση από την εφαρμογή, με τη σημείωσή της
    OFFERS:   'Έντυπα προσφοράς'      // 1.20: ΜΟΝΟ κατάσταση και ποσό, ποτέ στοιχεία πελάτη
  },

  // ── Ιστορικό κλήσεων (1.20) ─────────────────────────────
  // Κάθε «Κλήση» από την εφαρμογή γράφεται με ώρα. Όταν ο μεσίτης γυρίσει στην εφαρμογή,
  // του ζητείται σημείωση για τη συγκεκριμένη κλήση (ASK_NOTE). Αριθμοί ταυτότητας/ΑΦΜ σβήνονται.
  CALL_LOG: { ASK_NOTE: true, NOTE_MAX: 1000, MAX_SHOWN: 30, ASK_WITHIN_MIN: 120 },

  // ── Έντυπο προσφοράς (1.20) ─────────────────────────────
  // Ίδια λογική με το έντυπο υπόδειξης: link μίας χρήσης, ο πελάτης συμπληρώνει και υπογράφει
  // (στο κινητό του ή στην οθόνη του μεσίτη). Το PDF μπαίνει στο «<ακίνητο>/Προσφορές».
  // ΑΦΜ και Α.Δ.Τ. υπάρχουν ΜΟΝΟ μέσα στο PDF. Το πρότυπο βρίσκεται από το NAME στο Drive
  // (Google Doc), ή από το TEMPLATE_ID αν το γράψεις.
  // DESC_COLS: ποιες στήλες του «Διαθέσιμα ακίνητα» μπαίνουν στην «Περιγραφή» (με το όνομα της στήλης).
  OFFER: {
    TEMPLATE_ID: '',
    NAME: 'Έντυπο προσφοράς - πρότυπο KW App',
    FOLDER: 'Προσφορές',
    EXPIRE_HOURS: 72,
    MAX_OPENS: 30,
    SEND_COPY: true,            // αντίγραφο PDF στον πελάτη, αν γράψει email
    DESC_COLS: { floor: 'οροφ|floor', year: 'ετος κατασκευ|κατασκευ|year', bedrooms: 'υπνοδωμ|bedroom' }
  },

  // ── Admin (1.17) ────────────────────────────────────────
  // Ο ρόλος μπαίνει στη στήλη «Ρόλος» του Agents: «Μεσίτης» (ή κενό), «Admin»,
  // ή «Μεσίτης + Admin» (και τα δύο, με εναλλαγή μέσα στην εφαρμογή).
  //  SHARE_DRIVE: ο Admin παίρνει δικαίωμα ΑΝΑΓΝΩΣΗΣ στον φάκελο «Συνεργάτες»,
  //               ώστε τα αρχεία να ανοίγουν και στο Drive. false = μόνο μέσα από την εφαρμογή.
  //  MAX_DOWNLOAD_MB / MAX_ZIP_MB: όρια για το κατέβασμα μέσα από την εφαρμογή.
  ADMIN: {
    SHARE_DRIVE: true,
    MAX_DOWNLOAD_MB: 25,
    MAX_ZIP_MB: 30,
    REASONS: ['Δεν διαβάζεται καθαρά', 'Λείπει υπογραφή', 'Λείπει σελίδα', 'Λάθος έγγραφο', 'Έχει λήξει'],
    // 1.18: ειδοποίηση στον Admin για νέα έντυπα. Μία το πολύ κάθε EVERY_MIN λεπτά,
    // μόνο FROM_HOUR έως TO_HOUR (ό,τι έρθει βράδυ φεύγει το πρωί).
    NOTIFY: { ENABLED: true, EVERY_MIN: 60, FROM_HOUR: 8, TO_HOUR: 21 }
  },

  // ── Φωτογραφίες (1.18) ──────────────────────────────────
  // Υποφάκελος μέσα στον φάκελο κάθε ακινήτου. Εξώφυλλο = η πρώτη με σειρά ονόματος.
  // ── Παρουσίαση ακινήτου για τον πελάτη (1.19) ──────────
  //  DAYS: πόσες μέρες ισχύει το link. SHOW_ADDRESS: false = μόνο η περιοχή, όχι η οδός.
  //  INCLUDE: επικεφαλίδες του «Διαθέσιμα ακίνητα» που φαίνονται στον πελάτη.
  //           Κενό = αυτόματα, ό,τι μοιάζει με χαρακτηριστικό (όροφος, υπνοδωμάτια…) και
  //           ποτέ ό,τι μοιάζει με προσωπικό (ιδιοκτήτης, τηλέφωνο, εντολή…). Δες presentationCheck().
  //  LOGO: αρχείο στο GitHub, δίπλα στο index.html (το βάζεις εσύ, το επίσημο του γραφείου).
  PRESENTATION: {
    DAYS: 14,
    SHOW_ADDRESS: false,
    INCLUDE: [],
    MAX_PHOTOS: 40,
    CITY: 'Αθήνα',
    LOGO: 'logo-kw.png',
    OFFICE_ADDRESS: '',
    OFFICE_SITE: ''
  },

  MEDIA: {
    FOLDER: 'MEDIA',
    MAX_MB: 15                     // ανά φωτογραφία, μετά τη σμίκρυνση στο κινητό
  },

  AVAILABLE: 'Διαθέσιμ',        // αρχή λέξης στη στήλη Κατάσταση (χωρίς τόνους/κεφαλαία)

  FORMS: [
    {
      title: 'Μετρησιμότητα εβδομάδας',
      note: 'Συμπληρώνεται κάθε Δευτέρα για την προηγούμενη εβδομάδα.',
      url: 'https://docs.google.com/forms/d/e/1FAIpQLScfLToJzxSR9E4gsmMO6bCQaEorS0fZ6G3jW7juGHkseXIimg/viewform'
    },
    {
      title: 'Στοιχεία κλεισίματος ακινήτου',
      note: 'Για τιμολόγηση. Όλα τα πεδία με κεφαλαία, εκτός από το email.',
      url: 'https://docs.google.com/forms/d/e/1FAIpQLSe5X2CFkh3HMaAhrpcZFy3cvT0TO4oZ2ds0eXG-dMQVOxk3qQ/viewform'
    }
  ],

  BOOKING_URL: 'https://calendar.google.com/calendar/u/0/appointments/schedules/' +
               'AcZssZ10mvQ0oXsB-uSkMbu2PjfooqTQOCqAzrxmW7nh0yZXAdi5VLQn_DO7D-_FiRrG4nh21-hWEm0T',

  // Μετρησιμότητα: το workbook με τις απαντήσεις της εβδομαδιαίας φόρμας.
  // Βάλε το ID του (ή ολόκληρο το link). Ο λογαριασμός της εφαρμογής χρειάζεται
  // πρόσβαση ανάγνωσης. Κενό = το μενού γράφει «δεν έχει ρυθμιστεί».
  METRICS: {
    // ⚠ Πρέπει να είναι Google Sheet, όχι .xlsx. Αν το αρχείο είναι .xlsx:
    //   άνοιξέ το → Αρχείο → Αποθήκευση ως Φύλλα Google → βάλε εδώ το ID του νέου αρχείου.
    SPREADSHEET_ID: prop_('METRICS_SPREADSHEET_ID'),   // Ιδιότητα σεναρίου
    SHEETS: [],          // κενό = όλα τα φύλλα που μοιάζουν με απαντήσεις· ή π.χ. ['Form Responses 1']
    CACHE_MIN: 10        // λεπτά που κρατιούνται τα νούμερα πριν ξαναδιαβαστούν
  }
};

const TZ = 'Europe/Athens';

/** Μηνιαία φύλλα (ΕΕΕΕ-ΜΜ), όπως τα γράφει το script καταγραφής. Μόνο ανάγνωση. */
const LCOL = {
  ID: 'A', DATE: 'B', SOURCE: 'C', ATTN: 'D', NAME: 'E', PHONE: 'F', EMAIL: 'G',
  CODE: 'H', TYPE: 'I', SQM: 'J', DEAL: 'K', LOCATION: 'L', PRICE: 'M',
  MESSAGE: 'N', REPEAT: 'Q'
};

/** «Διαθέσιμα ακίνητα». Μόνο ανάγνωση. */
const PCOL = {
  ID: 'C', TITLE: 'F', TYPE: 'H', AREA: 'I', STREET: 'L', PRICE: 'O',
  SQM: 'P', MANDATE: 'U', MANDATE_END: 'W', PARTNER: 'Y', STATUS: 'AA'
};

/** «Συνολικές κλήσεις διαθέσιμων ακινήτων». Μόνο ανάγνωση. */
const TCOL = { ID: 'A', TOTAL: 'G', MONTH: 'H', WEEK: 'I' };

/** «Agents»: βρίσκονται με το όνομα της επικεφαλίδας. Οι στήλες από «Κλειδί» και μετά
 *  προστίθενται από τη setup(), αν λείπουν. */
const AGENT_HEADERS = {
  NAME: 'Agent', EMAIL: 'Email Μεσίτη',
  KEY: 'Κλειδί', SMS_NAME: 'Όνομα SMS', PHONE: 'Κινητό', LINK: 'Link',
  PREFS: 'Ρυθμίσεις', FOLDER: 'Φάκελος Drive', ACTIVE: 'Ενεργός',
  FORM_EMAIL: 'Email φόρμας',      // 1.5: το email με το οποίο συμπληρώνει τη φόρμα (π.χ. @kwgreece.gr)
  ROLE: 'Ρόλος'                    // 1.17: Μεσίτης · Admin · Μεσίτης + Admin (κενό = Μεσίτης)
};

/** 1.17 · Οι τιμές της στήλης «Ρόλος». */
const ROLE_VALUES = ['Μεσίτης', 'Admin', 'Μεσίτης + Admin'];

/** «Εφαρμογή»: το μόνο φύλλο όπου γράφει η εφαρμογή. */
const APP_HEADERS = ['ID', 'Μεσίτης', 'Κατάσταση', 'Σημειώσεις', 'Άνοιξε', 'Κάλεσε', 'SMS',
  'Follow-up', 'Follow-up ID', 'Υπόδειξη', 'Event ID', 'Διεύθυνση',
  'Πελάτης', 'Email πελάτη', 'Ακίνητο', 'Υπενθύμιση', 'Ενημέρωση',
  'Τηλέφωνο πελάτη', 'SMS υπενθύμισης', 'Αποτέλεσμα υπόδειξης', 'Σχόλιο αποτελέσματος', 'Ρωτήθηκε αποτέλεσμα',
  'Προσπάθειες'];

const ACOL = {
  ID: 1, AGENT: 2, STATUS: 3, NOTES: 4, OPENED: 5, CALLED: 6, SMS: 7,
  FU_AT: 8, FU_ID: 9, SHOW_AT: 10, SHOW_ID: 11, ADDRESS: 12,
  CLIENT: 13, CLIENT_EMAIL: 14, PROPERTY: 15, REMINDED: 16, UPDATED: 17,
  CLIENT_PHONE: 18, SMS_REMIND: 19, OUTCOME: 20, OUTCOME_NOTE: 21, OUTCOME_ASKED: 22,
  TRIES: 23,                         // 2.4 · FEAT-14: συνεχόμενα «Δεν απάντησε»
  WIDTH: 23
};

const STATUS = {
  PENDING:   'Αναπάντητη',
  ANSWERED:  'Απαντημένη',
  NO_ANSWER: 'Δεν απάντησε',
  SHOWING:   'Υπόδειξη',
  CLOSED:    'Κλειστή'
};
const STATUS_LIST = [STATUS.PENDING, STATUS.ANSWERED, STATUS.NO_ANSWER, STATUS.SHOWING, STATUS.CLOSED];

/**
 * Προεπιλεγμένα μηνύματα SMS. Ο κάθε μεσίτης τα αλλάζει από το ⚙.
 * {…} = στοιχείο που συμπληρώνεται. [ … ] = κομμάτι που παραλείπεται αν
 * κάποιο στοιχείο μέσα του είναι κενό (π.χ. όταν ο πελάτης δεν έχει όνομα).
 */
const DEFAULT_TEMPLATES = {
  intro: {
    el: 'Γεια σας[ {πελάτης}], ευχαριστούμε για το ενδιαφέρον σας[ για το ακίνητο {κωδικός}]. ' +
        'Είμαι ο/η {όνομά μου} από {γραφείο}.[ Τηλ. {κινητό μου}.][ {link}]',
    en: 'Hello[ {πελάτης}], thank you for your interest[ in property {κωδικός}]. ' +
        'This is {όνομά μου} from {γραφείο}.[ Tel. {κινητό μου}.][ {link}]'
  },
  reminder: {
    el: 'Υπενθύμιση για το ραντεβού μας {ημέρα} στις {ώρα}[, {διεύθυνση}]. {όνομά μου}',
    en: 'Reminder of our appointment {ημέρα} at {ώρα}[, {διεύθυνση}]. {όνομά μου}'
  },
  cancel: {
    el: 'Το ραντεβού μας {ημέρα} στις {ώρα} ακυρώνεται. Καλέστε με για νέο ραντεβού. {όνομά μου}',
    en: 'Our appointment {ημέρα} at {ώρα} is cancelled. Call me to arrange a new one. {όνομά μου}'
  }
};

const PLACEHOLDERS = ['πελάτης', 'κωδικός', 'διεύθυνση', 'ημέρα', 'ώρα',
                      'όνομά μου', 'κινητό μου', 'γραφείο', 'link'];

// ═════════════════════════════════════════════════════════════
//  API
// ═════════════════════════════════════════════════════════════

const ACTIONS = {
  bootstrap: actBootstrap_,
  leads:     (agent) => myLeads_(agent).map(l => serialize_(l)),
  open:      actOpen_,
  called:    actCalled_,
  status:    actStatus_,
  note:      actNote_,
  sms:       actSms_,
  showing:   actShowing_,
  cancelShowing: actCancelShowing_,
  settings:  actSettings_,
  docs:      actDocs_,
  upload:    actUpload_,
  docDelete: actDocDelete_,
  billMandate: actBillMandate_,
  formCreate: actFormCreate_,
  formStatus: actFormStatus_,
  formCancel: actFormCancel_,
  kwPartners: actKwPartners_,
  referral:   actReferral_,
  referrals:  actReferrals_,
  tasks:     (agent) => tasksFor_(agent),
  taskSave:  actTaskSave_,
  taskDone:  actTaskDone_,
  taskDelete: actTaskDelete_,
  pushRegister: actPushRegister_,
  pushTest:  actPushTest_,
  metrics:   actMetrics_,
  outcome:   actOutcome_,
  contacts:  actContacts_,
  contactSave: actContactSave_,
  contactMail: actContactMail_,
  map:       actMap_,
  media:     actMedia_,
  mediaImg:  actMediaImg_,
  covers:    actCovers_,
  reviewSeen: actReviewSeen_,
  mediaUpload: actMediaUpload_,
  mediaDelete: actMediaDelete_,
  mediaCover:  actMediaCover_,
  presCreate:  actPresCreate_,
  presMark:    actPresMark_,
  callNote:    actCallNote_,          // 1.20
  billPick:    actBillPick_,
  offerStatus: actOfferStatus_,
  offerCreate: actOfferCreate_,
  offerCancel: actOfferCancel_
};

/** 1.17 · Ενέργειες που έχει και όποιος είναι ΜΟΝΟ Admin (χωρίς ρόλο μεσίτη). */
const SHARED_ACTIONS = { bootstrap: 1, settings: 1, pushRegister: 1, pushTest: 1, media: 1, mediaImg: 1, covers: 1 };

/** 1.17 · Μόνο για Admin. Ο έλεγχος ρόλου γίνεται εδώ, στον server, σε κάθε αίτημα. */
const ADMIN_ACTIONS = {
  adminBoot:   actAdminBoot_,
  adminLeads:  (agent) => readLeads_().map(adminLead_).sort((a, b) => b.ts - a.ts),
  adminFiles:  actAdminFiles_,
  adminFile:   actAdminFile_,
  adminZip:    actAdminZip_,
  reviewList:  actReviewList_,
  reviewSet:   actReviewSet_
};

/** Ενέργειες χωρίς σύνδεση: η σύνδεση νέας συσκευής και η φόρμα του πελάτη (με link μίας χρήσης). */
const PUBLIC_ACTIONS = {
  presOpen:   actPresOpen_,          // 1.19: η σελίδα του πελάτη
  presImg:    actPresImg_,
  pairStart:  actPairStart_,
  pairVerify: actPairVerify_,
  formOpen:   actFormOpen_,
  formSubmit: actFormSubmit_,
  offerOpen:  actOfferOpen_,         // 1.20: έντυπο προσφοράς
  offerSubmit: actOfferSubmit_
};

/**
 * Όλα τα αιτήματα της σελίδας: { t (κλειδί συσκευής), action, data }.
 * Απάντηση: { ok, data } ή { ok:false, error, code }.
 * code 'auth' = η συσκευή δεν είναι (πια) συνδεδεμένη → η σελίδα ζητά νέα σύνδεση.
 */
function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Μη έγκυρο αίτημα.' });
  }

  try {
    if (PUBLIC_ACTIONS[req.action]) {
      return json_({ ok: true, data: PUBLIC_ACTIONS[req.action](req.data || {}) });
    }

    const sess = session_(req.t);
    if (!sess) return json_({ ok: false, code: 'auth', error: 'Η συσκευή δεν είναι συνδεδεμένη.' });

    let fn = req.action === 'logout' ? actLogout_ : ACTIONS[req.action];
    if (ADMIN_ACTIONS[req.action]) {
      if (!isAdmin_(sess.agent)) return json_({ ok: false, code: 'role', error: 'Δεν έχεις δικαίωμα Admin.' });
      fn = ADMIN_ACTIONS[req.action];
    } else if (fn && fn !== actLogout_ && !SHARED_ACTIONS[req.action] && !isAgent_(sess.agent)) {
      return json_({ ok: false, code: 'role', error: 'Η ενέργεια είναι μόνο για μεσίτες.' });
    }
    if (!fn) return json_({ ok: false, error: 'Άγνωστη ενέργεια.' });

    return json_({ ok: true, data: fn(sess.agent, req.data || {}, sess) });
  } catch (err) {
    // Τα μηνύματα της φόρμας πελάτη δεν περιέχουν ποτέ τιμές πεδίων (βλ. sfFail_).
    console.error(req.action + ': ' + err.message);
    return json_({ ok: false, error: err.message, code: err.code || '' });
  }
}

/** Έλεγχος ότι η ανάπτυξη απαντά: άνοιξε το /exec στον browser. */
function doGet() {
  return json_({ ok: true, app: 'KW App', env: CONFIG.ENV, version: VERSION });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═════════════════════════════════════════════════════════════
//  ΒΟΗΘΗΤΙΚΑ
// ═════════════════════════════════════════════════════════════

let _ss = null;
function getSS() {
  if (!_ss) _ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return _ss;
}

function sheet_(name) {
  const sh = getSS().getSheetByName(name);
  if (!sh) throw new Error('Λείπει το φύλλο: ' + name);
  return sh;
}

/**
 * Φύλλο με αυτό το όνομα, ή με όνομα κομμένο στο τέλος (π.χ. εισαγωγή από Excel, που κόβει
 * στους 31 χαρακτήρες: «Συνολικές κλήσεις διαθέσιμων ακ»).
 */
function sheetLike_(name) {
  const ss = getSS();
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const want = norm_(name);
  return ss.getSheets().find(sh => { const n = norm_(sh.getName()); return n.length >= 20 && want.indexOf(n) === 0; }) || null;
}

/** 'A' → 1, 'L' → 12, 'AA' → 27 */
function colIdx_(letter) {
  return String(letter).toUpperCase().split('')
    .reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}

function cell_(row, letter) { return row[colIdx_(letter) - 1]; }

function cellText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'dd/MM/yyyy');
  return String(v == null ? '' : v).trim();
}

/** Πεζά, χωρίς τόνους, μονά κενά. */
function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Κωδικός ακινήτου για σύγκριση. Ίδια λογική με το normCode() του app.js. */
function normCode_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^0-9A-ZΑ-Ω]/g, '');
}

/** Ψηφία τηλεφώνου. Ελληνικά → 10 ψηφία, ξένα → με τον κωδικό χώρας. */
function phoneDigits_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('0030') === 0) d = d.slice(4);
  else if (d.length === 12 && d.indexOf('30') === 0) d = d.slice(2);
  else if (d.indexOf('00') === 0) d = d.slice(2);
  return d;
}

function phoneIntl_(d) {
  if (!d) return '';
  return d.length === 10 ? '+30' + d : '+' + d;
}

function ts_(d) {
  const t = d ? new Date(d).getTime() : 0;
  return isNaN(t) ? 0 : t;
}

function fmtDate_(d) { return Utilities.formatDate(new Date(d), TZ, 'dd/MM/yyyy'); }
function fmtTime_(d) { return Utilities.formatDate(new Date(d), TZ, 'HH:mm'); }
function fmtIso_(d)  { return Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd'); }
function stamp_(d)   { return d && ts_(d) ? fmtDate_(d) + ' ' + fmtTime_(d) : ''; }

function ownerEmail_() {
  return (Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

// ═════════════════════════════════════════════════════════════
//  ΑΣΦΑΛΕΙΑ: σύνδεση συσκευής, κλειδιά, ιστορικό
// ═════════════════════════════════════════════════════════════
// Το προσωπικό link (?k=) ΔΕΝ αρκεί για πρόσβαση. Κάθε νέα συσκευή:
//   1. ανοίγει το link → ζητά κωδικό → πάει 6ψήφιος κωδικός στο email του μεσίτη
//   2. γράφει τον κωδικό → παίρνει δικό της τυχαίο κλειδί (256 bit)
// Στο φύλλο «Πρόσβαση» γράφεται μόνο το SHA-256 του κλειδιού: ακόμα κι αν
// κάποιος δει το φύλλο, δεν μπορεί να το χρησιμοποιήσει.
// Ανάκληση: Κατάσταση → «Ανακλήθηκε» (μία συσκευή) ή Agents → Ενεργός ☐ (όλες).

const ACCESS_HEADERS = ['ID', 'Κλειδί (hash)', 'Μεσίτης', 'Συσκευή', 'Συνδέθηκε', 'Τελευταία χρήση', 'Κατάσταση'];
const ACC = { ACTIVE: 'Ενεργή', REVOKED: 'Ανακλήθηκε', LOGOUT: 'Αποσυνδέθηκε', EXPIRED: 'Έληξε' };

function err_(msg, code) { const e = new Error(msg); e.code = code || ''; return e; }

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** Τυχαία από ασφαλή γεννήτρια (Java SecureRandom πίσω από το getUuid). */
function randomHex_(n) {
  let s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}

function randomDigits_(n) {
  return String(parseInt(randomHex_(12), 16) % Math.pow(10, n)).padStart(n, '0');
}

function maskEmail_(e) {
  const m = String(e).match(/^(.{1,2})[^@]*(@.*)$/);
  return m ? m[1] + '•••' + m[2] : '';
}

/** Κείμενο που ξεκινά με = + - @ γράφεται ως κείμενο, όχι ως τύπος του Sheets. */
function safe_(v) {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
function safeRow_(arr) { return arr.map(safe_); }

function log_(event, agentName, detail) {
  try {
    const sh = getSS().getSheetByName(CONFIG.SHEETS.LOG);
    if (sh) sh.appendRow(safeRow_([new Date(), event, agentName || '', String(detail || '').slice(0, 200)]));
  } catch (e) { /* το ιστορικό δεν πρέπει ποτέ να ρίξει αίτημα */ }
}

function readAccess_() {
  const sh = getSS().getSheetByName(CONFIG.SHEETS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ACCESS_HEADERS.length).getValues().map((v, i) => ({
    row: i + 2, id: String(v[0] || ''), hash: String(v[1] || ''), agent: String(v[2] || ''),
    device: String(v[3] || ''), created: v[4], lastUsed: v[5], status: String(v[6] || '')
  })).filter(r => r.hash);
}

function setAccessStatus_(rec, status) {
  sheet_(CONFIG.SHEETS.ACCESS).getRange(rec.row, 7).setValue(status);
}

/** Η συνεδρία από το κλειδί συσκευής, ή null. */
function session_(t) {
  if (!t || String(t).length < 40) return null;
  const hash = sha256_(t);
  const rec = readAccess_().find(r => r.hash === hash);
  if (!rec || rec.status !== ACC.ACTIVE) return null;

  const last = ts_(rec.lastUsed) || ts_(rec.created);
  if (Date.now() - last > CONFIG.SECURITY.IDLE_DAYS * 86400000) {
    setAccessStatus_(rec, ACC.EXPIRED);
    log_('Έληξε (αχρησιμοποίητη)', rec.agent, rec.device);
    return null;
  }

  const agent = readAgents_().find(a => norm_(a.name) === norm_(rec.agent));
  if (!agent || !agent.active) return null;

  // «Τελευταία χρήση» μία φορά τη μέρα — όχι σε κάθε αίτημα.
  if (fmtIso_(last) !== fmtIso_(new Date())) {
    sheet_(CONFIG.SHEETS.ACCESS).getRange(rec.row, 6).setValue(new Date());
  }
  return { agent: agent, id: rec.id, device: rec.device, since: rec.created };
}

/** Βήμα 1: από το προσωπικό link → κωδικός στο email του μεσίτη. */
function actPairStart_(d) {
  const agent = agentByKey_(d.k);
  if (!agent) throw err_('Το link δεν είναι έγκυρο. Ζήτα νέο από το γραφείο.', 'badlink');
  if (!agent.active) throw err_('Ο λογαριασμός σου είναι ανενεργός. Επικοινώνησε με το γραφείο.', 'badlink');
  if (!agent.email) throw err_('Δεν υπάρχει email για σένα στο φύλλο Agents. Επικοινώνησε με το γραφείο.');

  const cache = CacheService.getScriptCache();
  const rk = 'pairs:' + sha256_(agent.name).slice(0, 16);
  const count = Number(cache.get(rk) || 0);
  if (count >= CONFIG.SECURITY.PAIR_MAX_PER_HOUR) {
    log_('Μπλοκαρίστηκε: πολλά αιτήματα κωδικού', agent.name, d.device);
    throw err_('Πολλά αιτήματα κωδικού. Δοκίμασε ξανά σε μία ώρα.');
  }
  cache.put(rk, String(count + 1), 3600);

  const pairId = randomHex_(32);
  const code = randomDigits_(6);
  const ttl = CONFIG.SECURITY.PAIR_CODE_MIN * 60;
  cache.put('pair:' + pairId, JSON.stringify({
    agent: agent.name, hash: sha256_(pairId + ':' + code), tries: 0,
    expires: Date.now() + ttl * 1000
  }), ttl);

  const device = String(d.device || 'Άγνωστη συσκευή').slice(0, 80);
  MailApp.sendEmail({
    to: agent.email,
    subject: 'KW App · κωδικός σύνδεσης συσκευής',
    name: 'KW App',
    htmlBody:
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16161a;max-width:480px">' +
      '<p>Ζητήθηκε σύνδεση στο KW App από: <b>' + device.replace(/</g, '&lt;') + '</b></p>' +
      '<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:20px 0">' + code + '</p>' +
      '<p>Ισχύει για ' + CONFIG.SECURITY.PAIR_CODE_MIN + ' λεπτά.</p>' +
      '<p style="color:#a85b00"><b>Αν δεν το ζήτησες εσύ, μην δώσεις τον κωδικό σε κανέναν ' +
      'και ενημέρωσε το γραφείο.</b></p></div>'
  });
  log_('Ζητήθηκε κωδικός', agent.name, device);

  return { pairId: pairId, email: maskEmail_(agent.email), minutes: CONFIG.SECURITY.PAIR_CODE_MIN };
}

/** Βήμα 2: σωστός κωδικός → νέο κλειδί συσκευής (μόνο το hash του μένει στο φύλλο). */
function actPairVerify_(d) {
  const cache = CacheService.getScriptCache();
  const key = 'pair:' + String(d.pairId || '').replace(/[^0-9a-f]/g, '');
  const raw = cache.get(key);
  if (!raw) throw err_('Ο κωδικός έληξε. Ζήτα νέο.', 'expired');

  const st = JSON.parse(raw);
  const code = String(d.code || '').replace(/\D/g, '');

  if (sha256_(String(d.pairId) + ':' + code) !== st.hash) {
    st.tries++;
    if (st.tries >= CONFIG.SECURITY.PAIR_MAX_TRIES) {
      cache.remove(key);
      log_('Αποτυχία σύνδεσης: πολλές λάθος προσπάθειες', st.agent, d.device);
      throw err_('Πολλές λάθος προσπάθειες. Ζήτα νέο κωδικό.', 'expired');
    }
    cache.put(key, JSON.stringify(st), Math.max(1, Math.floor((st.expires - Date.now()) / 1000)));
    throw err_('Λάθος κωδικός. Απομένουν ' + (CONFIG.SECURITY.PAIR_MAX_TRIES - st.tries) + ' προσπάθειες.');
  }
  cache.remove(key);

  _agents = null;
  const agent = readAgents_().find(a => norm_(a.name) === norm_(st.agent));
  if (!agent || !agent.active) throw err_('Ο λογαριασμός σου είναι ανενεργός.', 'badlink');

  const token = randomHex_(64);
  const device = String(d.device || 'Άγνωστη συσκευή').slice(0, 80);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet_(CONFIG.SHEETS.ACCESS).appendRow(safeRow_([
      'A' + randomHex_(10), sha256_(token), agent.name, device, new Date(), new Date(), ACC.ACTIVE
    ]));
  } finally {
    lock.releaseLock();
  }
  log_('Νέα συσκευή συνδέθηκε', agent.name, device);
  return { token: token };
}

/** «Αποσύνδεση αυτής της συσκευής» από τις ρυθμίσεις. */
function actLogout_(agent, d, sess) {
  const rec = readAccess_().find(r => r.id === sess.id);
  if (rec) setAccessStatus_(rec, ACC.LOGOUT);
  removeDevicesOf_(sess.id);
  log_('Αποσύνδεση συσκευής', agent.name, sess.device);
  return { ok: true };
}

/** Αναφορά για τον διαχειριστή: τρέξ' τη από τον editor. */
function securityReport() {
  _agents = null;
  const acc = readAccess_();
  const lines = ['ΜΕΣΙΤΕΣ'];
  readAgents_().forEach(a => {
    const mine = acc.filter(r => norm_(r.agent) === norm_(a.name));
    const active = mine.filter(r => r.status === ACC.ACTIVE);
    lines.push((a.active ? '✓ ' : '✗ ΑΝΕΝΕΡΓΟΣ ') + a.name + ' · ' + active.length + ' ενεργές συσκευές');
    active.forEach(r => lines.push('    ' + r.device + ' · από ' + stamp_(r.created) + ' · τελευταία ' + stamp_(r.lastUsed)));
  });

  const sh = getSS().getSheetByName(CONFIG.SHEETS.LOG);
  if (sh && sh.getLastRow() > 1) {
    const n = Math.min(20, sh.getLastRow() - 1);
    lines.push('', 'ΤΕΛΕΥΤΑΙΑ ' + n + ' ΣΥΜΒΑΝΤΑ');
    sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues().reverse()
      .forEach(v => lines.push('  ' + stamp_(v[0]) + ' · ' + v[1] + ' · ' + v[2] + (v[3] ? ' · ' + v[3] : '')));
  }
  console.log(lines.join('\n'));
}

// ═════════════════════════════════════════════════════════════
//  AGENTS
// ═════════════════════════════════════════════════════════════

let _agents = null, _agentCols = null;

function agentCols_(sh) {
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(norm_);
  const find = name => headers.indexOf(norm_(name)) + 1;
  const c = {};
  Object.keys(AGENT_HEADERS).forEach(k => { c[k] = find(AGENT_HEADERS[k]); });
  return c;
}

function readAgents_() {
  if (_agents) return _agents;

  const sh = sheet_(CONFIG.SHEETS.AGENTS);
  const c = agentCols_(sh);
  if (!c.NAME || !c.EMAIL) {
    throw new Error('Στο φύλλο Agents λείπουν οι στήλες «' + AGENT_HEADERS.NAME +
                    '» ή «' + AGENT_HEADERS.EMAIL + '».');
  }

  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];
  const get = (v, col) => (col ? String(v[col - 1] == null ? '' : v[col - 1]).trim() : '');

  _agentCols = c;
  _agents = vals.map((v, i) => ({
    row:     i + 2,
    name:    get(v, c.NAME),
    email:   get(v, c.EMAIL).toLowerCase(),
    key:     get(v, c.KEY),
    smsName: get(v, c.SMS_NAME),
    phone:   get(v, c.PHONE),
    link:    get(v, c.LINK),
    prefs:   parsePrefs_(get(v, c.PREFS)),
    folder:  get(v, c.FOLDER),
    formEmail: get(v, c.FORM_EMAIL),
    roles:   parseRoles_(get(v, c.ROLE)),
    // Κενό ή τσεκαρισμένο = ενεργός. Ξετσεκάρισμα = κλειδώνει αμέσως όλες τις συσκευές του.
    active:  !c.ACTIVE || !/^(false|όχι|οχι|no|0)$/i.test(get(v, c.ACTIVE))
  })).filter(a => a.name);

  return _agents;
}

/**
 * 1.17 · «Μεσίτης», «Admin», «Μεσίτης + Admin». Κενό ή άγνωστο = Μεσίτης.
 * Μόνο «Admin» = διαχειριστής χωρίς δικές του κλήσεις, ακίνητα ή ειδοποιήσεις μεσίτη.
 */
function parseRoles_(s) {
  const t = norm_(s);
  const admin = /admin|διαχειρ/.test(t);
  const agent = !admin || /μεσιτ|agent|[+&\/,]|και/.test(t);
  return { agent: agent, admin: admin };
}
function isAdmin_(a) { return !!(a && a.roles && a.roles.admin); }
function isAgent_(a) { return !a || !a.roles || a.roles.agent !== false; }

function parsePrefs_(s) {
  if (!s) return {};
  try { const p = JSON.parse(s); return p && typeof p === 'object' ? p : {}; }
  catch (e) { return {}; }
}

/** Οι ρυθμίσεις του μεσίτη, με τις προεπιλογές όπου δεν έχει αλλάξει κάτι. */
function prefs_(agent) {
  const p = agent.prefs || {};
  const custom = p.templates || {};
  const templates = {};
  Object.keys(DEFAULT_TEMPLATES).forEach(k => {
    templates[k] = { el: (custom[k] || {}).el || '', en: (custom[k] || {}).en || '' };
  });
  return { colors: Object.assign({}, CONFIG.COLORS, p.colors || {}), templates: templates };
}

function templateFor_(agent, kind, lang) {
  return prefs_(agent).templates[kind][lang] || DEFAULT_TEMPLATES[kind][lang];
}

/**
 * Συμπληρώνει ένα μήνυμα. Ίδια λογική με το renderTpl() του app.js.
 *  [ … ] → σβήνεται ολόκληρο αν κάποιο {στοιχείο} μέσα του είναι κενό.
 */
function renderTpl_(tpl, vars) {
  const val = k => String(vars[k] == null ? '' : vars[k]).trim();
  return String(tpl || '')
    .replace(/\[([^\[\]]*)\]/g, (m, inner) => {
      const keys = (inner.match(/\{([^{}]+)\}/g) || []).map(x => x.slice(1, -1));
      return keys.some(k => !val(k)) ? '' : inner;
    })
    .replace(/\{([^{}]+)\}/g, (m, k) => val(k))
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;!?])/g, '$1')
    .replace(/([,.])\1+/g, '$1')
    .trim();
}

/** Ό,τι στέλνεται στη σελίδα για τον μεσίτη. */
function agentPayload_(agent) {
  return {
    name: agent.name,
    email: agent.email,
    smsName: agent.smsName || agent.name,
    phone: agent.phone,
    link: agent.link,
    calendar: calendarStatus_(agent),
    prefs: prefs_(agent)
  };
}

function agentByKey_(k) {
  const key = String(k || '').trim();
  if (key.length < 16) return null;
  return readAgents_().find(a => a.key === key) || null;
}

function teamNames_() {
  return readAgents_().filter(isAgent_).map(a => norm_(a.name));
}

// ═════════════════════════════════════════════════════════════
//  ΑΚΙΝΗΤΑ
// ═════════════════════════════════════════════════════════════

let _props = null, _totals = null;

/** Κωδικός → ακίνητο, για ΟΛΑ τα ακίνητα του φύλλου (όχι μόνο τα διαθέσιμα):
 *  μια κλήση για ακίνητο που μόλις έκλεισε ανήκει ακόμα στον μεσίτη του. */
function readProps_() {
  if (_props) return _props;
  _props = {};

  const sh = getSS().getSheetByName(CONFIG.SHEETS.PROPS);
  if (!sh || sh.getLastRow() < 2) return _props;

  const width = Math.max(sh.getLastColumn(), colIdx_(PCOL.STATUS));
  const avail = norm_(CONFIG.AVAILABLE);
  const dealCol = propDealCol_(sh.getRange(1, 1, 1, width).getValues()[0]);

  sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(r => {
    const key = normCode_(cell_(r, PCOL.ID));
    if (!key) return;
    const p = {
      code:      cellText_(cell_(r, PCOL.ID)),
      title:     cellText_(cell_(r, PCOL.TITLE)),
      type:      cellText_(cell_(r, PCOL.TYPE)),
      area:      cellText_(cell_(r, PCOL.AREA)),
      street:    cellText_(cell_(r, PCOL.STREET)),
      price:     cell_(r, PCOL.PRICE),
      sqm:       cellText_(cell_(r, PCOL.SQM)),
      mandate:   cellText_(cell_(r, PCOL.MANDATE)),
      partner:   cellText_(cell_(r, PCOL.PARTNER)),
      status:    cellText_(cell_(r, PCOL.STATUS)),
      mandateDays: daysUntil_(cell_(r, PCOL.MANDATE_END))
    };
    p.deal = dealOf_(dealCol ? r[dealCol - 1] : '') || dealOf_(p.title);
    p.available = norm_(p.status).indexOf(avail) === 0;
    // Διπλό ID: κρατάμε τη διαθέσιμη γραμμή.
    if (!_props[key] || p.available) _props[key] = p;
  });

  return _props;
}

/** Μέρες μέχρι μια ημερομηνία (Date ή «dd/mm/yyyy»). Χωρίς έγκυρη ημερομηνία: null. */
function daysUntil_(v) {
  let d = v instanceof Date ? v : null;
  if (!d) {
    const m = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(String(v == null ? '' : v));
    if (!m) return null;
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    d = new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((to - from) / 86400000);
}

/** Θέση (1, 2…) της στήλης «Ενοικίαση / Πώληση», ή 0 αν δεν βρεθεί. */
function propDealCol_(headers) {
  if (CONFIG.PROP_DEAL_COL) return colIdx_(CONFIG.PROP_DEAL_COL);
  const re = /συναλλαγ|πωληση|ενοικιαση|ειδος αγγελιας|σκοπος|deal/;
  return headers.findIndex(h => re.test(norm_(h))) + 1;
}

/** Κάθε τρόπος γραφής → «Ενοικίαση» ή «Πώληση». Άγνωστο → κενό. */
function dealOf_(text) {
  const t = norm_(text);
  if (/ενοικ|μισθ|rent/.test(t)) return 'Ενοικίαση';
  if (/πωλ|sale|sell/.test(t)) return 'Πώληση';
  return '';
}

function readTotals_() {
  if (_totals) return _totals;
  _totals = {};

  const sh = sheetLike_(CONFIG.SHEETS.TOTALS);
  if (!sh || sh.getLastRow() < 2) return _totals;

  const width = Math.max(sh.getLastColumn(), colIdx_(TCOL.WEEK));
  sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(r => {
    const key = normCode_(cell_(r, TCOL.ID));
    if (!key) return;
    _totals[key] = {
      total: Number(cell_(r, TCOL.TOTAL)) || 0,
      month: Number(cell_(r, TCOL.MONTH)) || 0,
      week:  Number(cell_(r, TCOL.WEEK)) || 0
    };
  });
  return _totals;
}

/** Τα ακίνητα όλης της ομάδας, κάθε κατάστασης (1.13: η σελίδα φιλτράρει).
 *  Του μεσίτη πρώτα, μετά τα διαθέσιμα. */
function teamProps_(agent) {
  const team = teamNames_();
  const me = norm_(agent.name);
  const totals = readTotals_();
  const props = readProps_();

  return Object.keys(props)
    .map(k => props[k])
    .filter(p => team.indexOf(norm_(p.partner)) !== -1)
    .map(p => {
      const t = totals[normCode_(p.code)] || { total: 0, month: 0, week: 0 };
      return {
        code: p.code, title: p.title, type: p.type, area: p.area, street: p.street,
        price: p.price, sqm: p.sqm, mandate: p.mandate, partner: p.partner, deal: p.deal,
        mandateDays: p.mandateDays, status: p.status, available: p.available,
        mine: norm_(p.partner) === me,
        total: t.total, month: t.month, week: t.week,
        docs: norm_(p.partner) === me ? docCounts_(p.code) : null
      };
    })
    .sort((a, b) => (b.mine - a.mine) || (b.available - a.available) || (b.month - a.month) || (b.total - a.total));
}

// ═════════════════════════════════════════════════════════════
//  ΧΑΡΤΗΣ (1.7)
// ═════════════════════════════════════════════════════════════
//
//  Σβηστός με CONFIG.MAP.ENABLED: false. Η διεύθυνση γίνεται σημείο από το
//  OpenStreetMap, το οποίο δεν ενδείκνυται για εμπορική χρήση σε πολλά γραφεία.
//  Πριν ανάψει για πελάτες, δες «Χάρτης: όταν έρθει η ώρα» στο README.
//  Το αποτέλεσμα κρατιέται στο φύλλο «Χάρτης» και ξαναψάχνεται μόνο αν αλλάξει η
//  διεύθυνση. Λάθος σημείο: διορθώνεις Lat / Lng στο φύλλο και μένει όπως το έβαλες.

const MAP_HEADERS = ['Κωδικός', 'Διεύθυνση', 'Lat', 'Lng', 'Ακρίβεια', 'Πηγή', 'Ενημέρωση'];
const GREECE = { south: 34.5, north: 41.9, west: 19.2, east: 29.8 };

function teamMapProps_() {
  const team = teamNames_();
  const props = readProps_();
  return Object.keys(props).map(k => props[k]).filter(p => team.indexOf(norm_(p.partner)) !== -1);
}

function mapQuery_(p) {
  const st = String(p.street || '').trim();
  if (!st) return '';
  return [st, p.area || CONFIG.MAP.CITY, CONFIG.MAP.COUNTRY].join(', ');
}

/** Κωδικός → γραμμή του φύλλου «Χάρτης». */
function readGeo_() {
  const out = {};
  const sh = getSS().getSheetByName(CONFIG.SHEETS.MAP);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, MAP_HEADERS.length).getValues().forEach((r, i) => {
    const key = normCode_(r[0]);
    if (key) out[key] = { row: i + 2, addr: String(r[1]), lat: Number(r[2]) || 0, lng: Number(r[3]) || 0, quality: String(r[4]) };
  });
  return out;
}

function insideGreece_(lat, lng) {
  return lat >= GREECE.south && lat <= GREECE.north && lng >= GREECE.west && lng <= GREECE.east;
}

function fetchJson_(url) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'KW-App/' + VERSION + ' (real estate office tool)', 'Accept-Language': 'el' }
  });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function geoNominatim_(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=gr&q=' +
              encodeURIComponent(q);
  const r = fetchJson_(url)[0];
  if (!r) return null;
  return { lat: Number(r.lat), lng: Number(r.lon), source: 'Nominatim',
           quality: r.address && r.address.house_number ? 'Ακριβής' : 'Κατά προσέγγιση' };
}

function geoPhoton_(q) {
  const url = 'https://photon.komoot.io/api/?limit=1&bbox=19.2,34.5,29.8,41.9&q=' + encodeURIComponent(q);
  const f = (fetchJson_(url).features || [])[0];
  if (!f) return null;
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], source: 'Photon',
           quality: f.properties && f.properties.housenumber ? 'Ακριβής' : 'Κατά προσέγγιση' };
}

/** Δύο υπηρεσίες: αν η πρώτη δεν βρει ή δεν απαντήσει, δοκιμάζει τη δεύτερη. */
function geocode_(q) {
  let hit = null, failed = 0;
  [geoNominatim_, geoPhoton_].forEach(fn => {
    if (hit) return;
    try {
      const r = fn(q);
      if (r && insideGreece_(r.lat, r.lng)) hit = r;
    } catch (e) { failed++; console.log('Χάρτης: ' + fn.name + ' · ' + e.message); }
  });
  // Αν κάποια δεν απάντησε, το «δεν βρέθηκε» δεν είναι σίγουρο: ξαναδοκιμάζει την επόμενη ώρα.
  if (!hit && failed) throw new Error('Υπηρεσία εντοπισμού δεν απάντησε.');
  return hit;
}

/** Trigger κάθε ώρα. Ψάχνει μόνο νέα ακίνητα και όσα άλλαξαν διεύθυνση. */
function geocodeProps() {
  if (!CONFIG.MAP.ENABLED) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const sh = ensureSheet_(CONFIG.SHEETS.MAP, MAP_HEADERS);
    const geo = readGeo_();
    const todo = teamMapProps_().filter(p => {
      const q = mapQuery_(p), g = geo[normCode_(p.code)];
      return q && (!g || g.addr !== q);
    });

    let found = 0, none = 0;
    const started = Date.now();
    for (let i = 0; i < todo.length && i < CONFIG.MAP.BATCH; i++) {
      if (Date.now() - started > 240000) break;
      const p = todo[i], q = mapQuery_(p);
      let hit;
      try { hit = geocode_(q); }
      catch (e) { console.log(e.message + ' Συνεχίζει στην επόμενη εκτέλεση.'); break; }

      const row = [p.code, q, hit ? hit.lat : '', hit ? hit.lng : '',
                   hit ? hit.quality : 'Δεν βρέθηκε', hit ? hit.source : '', new Date()];
      const g = geo[normCode_(p.code)];
      const at = g ? g.row : sh.getLastRow() + 1;
      sh.getRange(at, 1, 1, row.length).setValues([row]);
      if (hit) found++; else none++;
      Utilities.sleep(1100);                  // όριο Nominatim: 1 αίτημα το δευτερόλεπτο
    }
    console.log('Χάρτης: βρέθηκαν ' + found + ', δεν βρέθηκαν ' + none +
                ', απομένουν ' + Math.max(0, todo.length - found - none));
  } finally {
    lock.releaseLock();
  }
}

/** Όλα τα ακίνητα της ομάδας, κάθε κατάστασης, με το σημείο τους. */
function actMap_(agent) {
  const me = norm_(agent.name);
  const geo = readGeo_();
  const leadDeal = {};
  readLeads_().forEach(l => {
    const k = normCode_(l.code), d = dealOf_(l.deal);
    if (k && d && !leadDeal[k]) leadDeal[k] = d;
  });

  const items = [];
  let missing = 0;
  teamMapProps_().forEach(p => {
    const k = normCode_(p.code), g = geo[k];
    if (!g || !g.lat || !g.lng) { missing++; return; }
    items.push({
      code: p.code, title: p.title, type: p.type, area: p.area, street: p.street, price: p.price,
      partner: p.partner, mine: norm_(p.partner) === me, available: p.available,
      deal: p.deal || leadDeal[k] || '', status: p.status || 'Χωρίς κατάσταση',
      lat: g.lat, lng: g.lng, approx: g.quality !== 'Ακριβής'
    });
  });
  return { items: items, missing: missing };
}

/** Διάγνωση: τι βρίσκει ο κώδικας στο φύλλο. Δεν αλλάζει τίποτα. */
function mapCheck() {
  const sh = sheet_(CONFIG.SHEETS.PROPS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = propDealCol_(headers);
  const props = teamMapProps_();
  const count = key => props.reduce((o, p) => { const v = p[key] || '(κενό)'; o[v] = (o[v] || 0) + 1; return o; }, {});
  const geo = readGeo_();
  console.log([
    'Ακίνητα ομάδας: ' + props.length,
    'Στήλη Ενοικίαση/Πώληση: ' + (col ? '«' + headers[col - 1] + '» (στήλη ' + col + ')'
      : 'ΔΕΝ βρέθηκε. Γράψε το γράμμα της στο CONFIG.PROP_DEAL_COL. Επικεφαλίδες: ' + headers.filter(String).join(' | ')),
    'Συναλλαγή: ' + JSON.stringify(count('deal')),
    'Κατάσταση: ' + JSON.stringify(count('status')),
    'Χωρίς οδό: ' + props.filter(p => !mapQuery_(p)).length,
    'Με σημείο στον χάρτη: ' + props.filter(p => (geo[normCode_(p.code)] || {}).lat).length
  ].join('\n'));
}

// ═════════════════════════════════════════════════════════════
//  ΚΛΗΣΕΙΣ (μηνιαία φύλλα — μόνο ανάγνωση)
// ═════════════════════════════════════════════════════════════

let _leads = null;

function monthNames_() {
  const now = new Date();
  const out = [];
  for (let i = 0; i < CONFIG.MONTHS_BACK; i++) {
    out.push(Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - i, 1), TZ, 'yyyy-MM'));
  }
  return out;
}

function readLeads_() {
  if (_leads) return _leads;
  _leads = [];

  const ss = getSS();
  const width = colIdx_(LCOL.REPEAT);

  monthNames_().forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;

    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), width)).getValues()
      .forEach(v => {
        const id = cellText_(cell_(v, LCOL.ID));
        if (!id) return;
        _leads.push({
          id:       id,
          month:    name,
          date:     cell_(v, LCOL.DATE),
          source:   cellText_(cell_(v, LCOL.SOURCE)),
          attn:     cellText_(cell_(v, LCOL.ATTN)),
          name:     cellText_(cell_(v, LCOL.NAME)),
          phone:    phoneDigits_(cell_(v, LCOL.PHONE)),
          email:    cellText_(cell_(v, LCOL.EMAIL)),
          code:     cellText_(cell_(v, LCOL.CODE)),
          type:     cellText_(cell_(v, LCOL.TYPE)),
          sqm:      cellText_(cell_(v, LCOL.SQM)),
          deal:     cellText_(cell_(v, LCOL.DEAL)),
          location: cellText_(cell_(v, LCOL.LOCATION)),
          price:    cell_(v, LCOL.PRICE),
          message:  cellText_(cell_(v, LCOL.MESSAGE)),
          repeat:   cellText_(cell_(v, LCOL.REPEAT))
        });
      });
  });

  return _leads;
}

/** Ο μεσίτης μιας κλήσης: Κωδικός → Διαθέσιμα ακίνητα (ID) → Συνεργάτης. */
function ownerOf_(lead) {
  const p = readProps_()[normCode_(lead.code)];
  return p ? p.partner : '';
}

function isMine_(agent, lead) {
  const owner = ownerOf_(lead);
  return !!owner && norm_(owner) === norm_(agent.name);
}

function myLeads_(agent) {
  return readLeads_()
    .filter(l => isMine_(agent, l))
    .sort((a, b) => ts_(b.date) - ts_(a.date));
}

/** Βρίσκει κλήση ΜΟΝΟ αν ανήκει στον μεσίτη. Κανείς δεν πειράζει ξένη κλήση. */
function findMyLead_(agent, id) {
  const l = readLeads_().find(x => x.id === String(id));
  if (!l || !isMine_(agent, l)) throw new Error('Δεν βρέθηκε η κλήση.');
  return l;
}

function propertyLine_(l, p) {
  const parts = [l.type, l.sqm, l.location].filter(String);
  if (parts.length) return parts.join(', ');
  if (p && p.title) return p.title;
  return l.code ? 'Κωδικός ' + l.code : 'Ακίνητο';
}

// ═════════════════════════════════════════════════════════════
//  ΦΥΛΛΟ «ΕΦΑΡΜΟΓΗ»
// ═════════════════════════════════════════════════════════════

let _app = null;

function readApp_() {
  if (_app) return _app;
  _app = {};
  const sh = sheet_(CONFIG.SHEETS.APP);
  if (sh.getLastRow() < 2) return _app;
  sh.getRange(2, 1, sh.getLastRow() - 1, ACOL.WIDTH).getValues().forEach((v, i) => {
    const id = String(v[ACOL.ID - 1] || '').trim();
    if (id) _app[id] = { row: i + 2, v: v };
  });
  return _app;
}

function appGet_(id, col) {
  const rec = readApp_()[id];
  return rec ? rec.v[col - 1] : '';
}

/** Γράφει τιμές στη γραμμή της κλήσης (τη δημιουργεί αν λείπει). values = {στήλη: τιμή}. */
function appSet_(agent, id, values) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _app = null;                         // φρέσκια ανάγνωση μέσα στο lock
    const map = readApp_();
    const sh = sheet_(CONFIG.SHEETS.APP);

    let rec = map[id];
    if (!rec) {
      const v = new Array(ACOL.WIDTH).fill('');
      v[ACOL.ID - 1] = id;
      sh.appendRow(v);
      rec = { row: sh.getLastRow(), v: v };
      map[id] = rec;
    }

    Object.keys(values).forEach(c => { rec.v[Number(c) - 1] = values[c]; });
    rec.v[ACOL.AGENT - 1] = agent.name;
    rec.v[ACOL.UPDATED - 1] = new Date();
    sh.getRange(rec.row, 1, 1, ACOL.WIDTH).setValues([safeRow_(rec.v)]);
  } finally {
    lock.releaseLock();
  }
}

function statusOf_(id) {
  return String(appGet_(id, ACOL.STATUS) || '') || STATUS.PENDING;
}

/** Ό,τι χρειάζεται η σελίδα για μία κλήση. */
function serialize_(l) {
  const g = col => appGet_(l.id, col);
  const p = readProps_()[normCode_(l.code)] || null;
  const showAt = g(ACOL.SHOW_AT);

  return {
    id: l.id,
    date: stamp_(l.date),
    ts: ts_(l.date),
    source: l.source,
    name: l.name,
    phone: l.phone,
    phoneIntl: phoneIntl_(l.phone),
    email: l.email,
    code: l.code,
    property: propertyLine_(l, p),
    deal: l.deal,
    price: l.price,
    message: l.message,
    repeat: l.repeat,
    address: String(g(ACOL.ADDRESS) || '') || (p && p.street) || l.location || '',

    status: statusOf_(l.id),
    notes: String(g(ACOL.NOTES) || ''),
    opened: stamp_(g(ACOL.OPENED)),
    called: stamp_(g(ACOL.CALLED)),
    sms: stamp_(g(ACOL.SMS)),
    followUp: stamp_(g(ACOL.FU_AT)),
    tries: Number(g(ACOL.TRIES)) || 0,               // 2.4 · FEAT-14
    showingAt: stamp_(showAt),
    showingDate: showAt && ts_(showAt) ? fmtIso_(showAt) : '',
    showingTime: showAt && ts_(showAt) ? fmtTime_(showAt) : '',
    showingTs: ts_(showAt),
    hasEvent: !!g(ACOL.SHOW_ID),
    smsRemind: stamp_(g(ACOL.SMS_REMIND)),
    outcome: String(g(ACOL.OUTCOME) || ''),
    outcomeNote: String(g(ACOL.OUTCOME_NOTE) || ''),
    contactId: (contactOfLead_(l) || {}).id || '',
    otherCodes: otherCodes_(l),
    form: sfLeadStatus_(l.id),
    calls: callsOf_(l.id),            // 1.20
    offer: ofLeadStatus_(l.id)
  };
}

// ═════════════════════════════════════════════════════════════
//  ΗΜΕΡΟΛΟΓΙΟ ΜΕΣΙΤΗ
// ═════════════════════════════════════════════════════════════
// Τα events γράφονται στο ημερολόγιο του μεσίτη, αν το έχει μοιραστεί με
// τον λογαριασμό της εφαρμογής («Αλλαγές σε συμβάντα»). Αλλιώς μπαίνουν
// στο ημερολόγιο της εφαρμογής με τον μεσίτη ως προσκεκλημένο.
// Κάθε event αποθηκεύεται ως «calendarId::eventId», για να βρεθεί ξανά.

function agentCalendar_(agent) {
  if (!agent.email || agent.email === ownerEmail_()) return CalendarApp.getDefaultCalendar();
  try {
    return CalendarApp.getCalendarById(agent.email) || null;
  } catch (e) {
    return null;
  }
}

function calendarStatus_(agent) {
  const own = !agent.email || agent.email === ownerEmail_();
  return { shared: own || !!agentCalendar_(agent), own: own };
}

function setPopup_(ev, minutes) {
  try { ev.removeAllReminders(); ev.addPopupReminder(minutes); } catch (e) { /* όχι κρίσιμο */ }
}

/** Χρώμα events (1–11). Στο ημερολόγιο του μεσίτη· σε πρόσκληση φαίνεται μόνο στο δικό μας. */
function setColor_(ev, color) {
  if (!color) return;
  try { ev.setColor(String(color)); } catch (e) { /* όχι κρίσιμο */ }
}

/**
 * kind: 'showing' | 'followup' | 'task' → χρώμα από τις ρυθμίσεις του μεσίτη.
 * allDay: ολοήμερο event (end αγνοείται, χωρίς popup).
 */
function createEvent_(agent, title, start, end, opts, popupMin, kind, allDay) {
  const color = kind ? prefs_(agent).colors[kind] : '';
  const make = (cal, o) => allDay ? cal.createAllDayEvent(title, start, o) : cal.createEvent(title, start, end, o);

  const cal = agentCalendar_(agent);
  if (cal) {
    try {
      const ev = make(cal, opts);
      if (!allDay) setPopup_(ev, popupMin);
      setColor_(ev, color);
      return { ref: cal.getId() + '::' + ev.getId(), invited: false };
    } catch (e) {
      console.warn('Ημερολόγιο ' + agent.email + ' χωρίς δικαίωμα εγγραφής: ' + e.message);
    }
  }

  const own = CalendarApp.getDefaultCalendar();
  const o = Object.assign({}, opts);
  if (agent.email) { o.guests = agent.email; o.sendInvites = true; }
  const ev = make(own, o);
  try { ev.setGuestsCanModify(true); } catch (e) { /* όχι κρίσιμο */ }
  if (!allDay) setPopup_(ev, popupMin);
  setColor_(ev, color);
  return { ref: own.getId() + '::' + ev.getId(), invited: !!agent.email };
}

function eventByRef_(ref) {
  const parts = String(ref || '').split('::');
  if (parts.length !== 2) return null;
  try {
    const cal = CalendarApp.getCalendarById(parts[0]);
    return cal ? cal.getEventById(parts[1]) : null;
  } catch (e) {
    return null;
  }
}

function description_(l, address, intro) {
  const p = readProps_()[normCode_(l.code)] || null;
  const lines = [];
  if (intro) lines.push(intro, '');
  lines.push(
    'Πελάτης: '   + (l.name || '—'),
    'Τηλέφωνο: '  + (phoneIntl_(l.phone) || '—'),
    'Email: '     + (l.email || '—'),
    'Ακίνητο: '   + propertyLine_(l, p) + (l.code ? ' (' + l.code + ')' : ''),
    'Διεύθυνση: ' + (address || '—'),
    'Πηγή: '      + (l.source || '—')
  );
  if (l.message) lines.push('', 'Μήνυμα πελάτη:', l.message);
  lines.push('', 'Σημειώσεις:', String(appGet_(l.id, ACOL.NOTES) || '—'));
  lines.push('', 'Άνοιγμα στην εφαρμογή: ' + CONFIG.APP_URL + '?lead=' + encodeURIComponent(l.id));
  return lines.join('\n');
}

// ── Follow-up («Δεν απάντησε») ─────────────────────────────

function createFollowUp_(agent, l, at) {
  clearFollowUp_(agent, l);

  const start = at ? new Date(at) : new Date(Date.now() + CONFIG.FOLLOWUP_HOURS * 3600000);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + CONFIG.FOLLOWUP_DURATION_MIN * 60000);
  const p = readProps_()[normCode_(l.code)] || null;
  const address = (p && p.street) || l.location || '';

  const r = createEvent_(agent,
    'Follow-up: ' + (l.name || 'Πελάτης') + ' — ' + propertyLine_(l, p),
    start, end,
    { description: description_(l, address, 'Δεν απάντησε στην κλήση των ' + fmtTime_(new Date()) + '. Ξανακάλεσε.'),
      location: address },
    0, 'followup');

  const v = {};
  v[ACOL.FU_AT] = start;
  v[ACOL.FU_ID] = r.ref;
  appSet_(agent, l.id, v);
  return r;
}

/** Σβήνει το follow-up μόνο αν είναι ακόμα στο μέλλον. Ένα που πέρασε μένει ως ιστορικό. */
function clearFollowUp_(agent, l) {
  const ref = appGet_(l.id, ACOL.FU_ID);
  if (!ref) return;
  const ev = eventByRef_(ref);
  if (!ev || ev.getStartTime().getTime() <= Date.now()) return;
  try { ev.deleteEvent(); } catch (e) { return; }
  const v = {};
  v[ACOL.FU_AT] = '';
  v[ACOL.FU_ID] = '';
  appSet_(agent, l.id, v);
}

// ═════════════════════════════════════════════════════════════
//  ΕΝΕΡΓΕΙΕΣ
// ═════════════════════════════════════════════════════════════

function actBootstrap_(agent, d, sess) {
  const agentRole = isAgent_(agent);
  return {
    session: sess ? { device: sess.device, since: stamp_(sess.since) } : null,
    roles: { agent: agentRole, admin: isAdmin_(agent) },
    env: CONFIG.ENV,
    version: VERSION,
    agent: agentPayload_(agent),
    defaults: { templates: DEFAULT_TEMPLATES, colors: CONFIG.COLORS },
    placeholders: PLACEHOLDERS,
    docSlots: CONFIG.DOCS.map(s => ({ key: s.key, label: s.label, multi: !!s.multi })),
    billSlots: CONFIG.BILLING.DOCS.map(s => ({ key: s.key, label: s.label, multi: !!s.multi,
                                               optional: !!s.optional, from: s.from || '', pick: s.pick || '' })),
    callLog: { ask: !!CONFIG.CALL_LOG.ASK_NOTE, within: CONFIG.CALL_LOG.ASK_WITHIN_MIN, max: CONFIG.CALL_LOG.NOTE_MAX },
    docsRequires: CONFIG.DOCS_REMINDER.REQUIRES,
    maxUploadMb: CONFIG.MAX_UPLOAD_MB,
    mapEnabled: !!CONFIG.MAP.ENABLED,
    outcomes: CONFIG.OUTCOMES,
    mandateSoon: CONFIG.MANDATE_SOON_DAYS,
    tasks: agentRole ? tasksFor_(agent) : [],
    drive: agentRole ? firstLoginDrive_(agent) : null,
    appAccount: ownerEmail_(),
    push: { ready: !!fcmConfig_(), devices: agentDevices_(agent).length },
    smsMode: CONFIG.SMS_MODE,
    office: CONFIG.OFFICE,
    forms: CONFIG.FORMS,
    bookingUrl: CONFIG.BOOKING_URL,
    statuses: STATUS_LIST,
    leads: agentRole ? myLeads_(agent).map(l => serialize_(l)) : [],
    props: agentRole ? teamProps_(agent) : [],
    reviews: agentRole ? myReviews_(agent) : [],
    flags: featureFlags_(agent)
  };
}

/**
 * 2.3 · Feature flags. Ιδιότητα σεναρίου FEATURES (JSON), π.χ. {"smartMemory":"admin"}.
 * Τιμή ανά feature: "all" = όλοι · "admin" = μόνο admins · "off" = κανείς ·
 * ή λίστα email με κόμμα (π.χ. "a@x.gr, b@x.gr"). Χωρίς FEATURES = όλα κλειστά.
 */
/**
 * 2.3 · FEAT-3 · Κουμπιά μέσα στην ειδοποίηση «Πώς πήγε η υπόδειξη;».
 * Τα Android δείχνουν έως 2 κουμπιά· τα iPhone δεν δείχνουν κουμπιά (περιορισμός
 * της Apple) και η ειδοποίηση ανοίγει την εφαρμογή όπως πάντα.
 * action 'o<N>' = CONFIG.OUTCOMES[N]. Το FCM δέχεται μόνο κείμενο, άρα JSON.
 */
function outcomeActions_() {
  const pick = [['o0', '👍 '], ['o2', '👎 ']];
  return JSON.stringify(pick.map(p => ({ action: p[0], title: p[1] + CONFIG.OUTCOMES[Number(p[0].slice(1))] })));
}

/**
 * 2.4 · FEAT-14 · Το επόμενο σκαλί μετά από «Δεν απάντησε».
 * tries = πόσες φορές συνεχόμενα δεν απάντησε (μαζί με αυτή). Επιστρέφει:
 *  at   πότε ξανά (Date) ή null = καμία νέα κλήση
 *  sms  true = πρότεινε στον μεσίτη έτοιμο SMS
 *  done true = τέλος σκάλας (ο πελάτης «κρύωσε»)
 */
function ladderStep_(tries, now) {
  const L = CONFIG.LADDER;
  const nextDay = (hm) => {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + 1);
    d.setHours(hm[0], hm[1], 0, 0);
    return d;
  };
  const opposite = now.getHours() < L.SWITCH_HOUR ? L.EVENING : L.MORNING;
  if (tries <= 1) return { tries: tries, at: new Date(now.getTime() + CONFIG.FOLLOWUP_HOURS * 3600000), sms: false, done: false };
  if (tries === 2) return { tries: tries, at: nextDay(opposite), sms: false, done: false };
  if (tries < L.MAX) return { tries: tries, at: nextDay(opposite), sms: true, done: false };
  return { tries: tries, at: null, sms: true, done: true };
}

function featureFlags_(agent) {
  let cfg = {};
  try { cfg = JSON.parse(prop_('FEATURES', '{}')) || {}; } catch (e) { cfg = {}; }
  const email = String((agent && agent.email) || '').toLowerCase();
  const admin = isAdmin_(agent);
  const out = {};
  Object.keys(cfg).forEach(k => {
    const v = String(cfg[k] == null ? '' : cfg[k]).trim().toLowerCase();
    out[k] = v === 'all' || (v === 'admin' && admin) ||
      (!!email && v !== 'off' && v.split(',').map(s => s.trim()).indexOf(email) !== -1);
  });
  return out;
}

/** Πρώτη φορά που ο μεσίτης ανοίγει την κλήση. */
function actOpen_(agent, d) {
  const l = findMyLead_(agent, d.id);
  if (!appGet_(l.id, ACOL.OPENED)) {
    const v = {};
    v[ACOL.OPENED] = new Date();
    appSet_(agent, l.id, v);
  }
  return serialize_(l);
}

/** «Κλήση»: Αναπάντητη / Δεν απάντησε → Απαντημένη. */
function actCalled_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const prev = statusOf_(l.id);

  if (prev === STATUS.NO_ANSWER) clearFollowUp_(agent, l);

  const now = new Date();
  const v = {};
  v[ACOL.CALLED] = now;
  if (prev === STATUS.PENDING || prev === STATUS.NO_ANSWER) v[ACOL.STATUS] = STATUS.ANSWERED;
  appSet_(agent, l.id, v);
  clAddSafe_(agent, l.id, d.cid, now);    // 1.20: κάθε κλήση στο ιστορικό
  return serialize_(l);
}

function actStatus_(agent, d) {
  const status = String(d.status || '');
  if (STATUS_LIST.indexOf(status) === -1) throw new Error('Άγνωστη κατάσταση: ' + status);

  const l = findMyLead_(agent, d.id);
  const prev = statusOf_(l.id);

  const v = {};
  v[ACOL.STATUS] = status;
  if (!appGet_(l.id, ACOL.CALLED) && status !== STATUS.PENDING) v[ACOL.CALLED] = new Date();
  appSet_(agent, l.id, v);

  let warning = '', invited = false, ladder = null;
  const useLadder = !!featureFlags_(agent).callLadder;                 // 2.4 · FEAT-14
  if (status === STATUS.NO_ANSWER) {
    const tries = (Number(appGet_(l.id, ACOL.TRIES)) || 0) + 1;
    ladder = useLadder ? ladderStep_(tries, new Date()) : null;
    if (useLadder) { const t = {}; t[ACOL.TRIES] = tries; appSet_(agent, l.id, t); }
    try {
      if (!ladder) invited = createFollowUp_(agent, l).invited;
      else if (ladder.at) invited = createFollowUp_(agent, l, ladder.at).invited;
      else clearFollowUp_(agent, l);                                     // τέλος σκάλας: χωρίς νέο follow-up
    } catch (err) {
      warning = 'Η κατάσταση άλλαξε, αλλά το follow-up δεν μπήκε στο ημερολόγιο: ' + err.message;
    }
  } else {
    if (prev === STATUS.NO_ANSWER) clearFollowUp_(agent, l);
    if (appGet_(l.id, ACOL.TRIES)) { const t = {}; t[ACOL.TRIES] = ''; appSet_(agent, l.id, t); }  // απάντησε → από την αρχή
  }

  const out = serialize_(l);
  out.warning = warning;
  out.invited = invited;
  if (ladder) out.ladder = { tries: ladder.tries, max: CONFIG.LADDER.MAX, sms: ladder.sms, done: ladder.done };
  return out;
}

function actNote_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const v = {};
  v[ACOL.NOTES] = String(d.text || '').slice(0, 5000);
  appSet_(agent, l.id, v);
  return true;
}

/** Καταγράφει πότε ΑΝΟΙΞΕ το έτοιμο SMS — όχι αν στάλθηκε (το κινητό δεν το λέει).
 *  kind: 'intro' (πρώτη επαφή) | 'reminder' (υπενθύμιση υπόδειξης) | 'cancel'. */
function actSms_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const v = {};
  if (d.kind === 'reminder') v[ACOL.SMS_REMIND] = new Date();
  else v[ACOL.SMS] = new Date();
  appSet_(agent, l.id, v);
  return serialize_(l);
}

/** Νέα υπόδειξη, ή αλλαγή ημερομηνίας / ώρας / διεύθυνσης σε υπάρχουσα. */
function actShowing_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const start = parseStart_(d.date, d.time);
  const end = new Date(start.getTime() + CONFIG.SHOWING_DURATION_MIN * 60000);

  const p = readProps_()[normCode_(l.code)] || null;
  const address = String(d.address || '').trim() ||
                  String(appGet_(l.id, ACOL.ADDRESS) || '') ||
                  (p && p.street) || l.location || '';
  const title = 'Υπόδειξη: ' + (l.name || 'Πελάτης') + ' — ' + propertyLine_(l, p);
  const desc = description_(l, address);

  let ref = String(appGet_(l.id, ACOL.SHOW_ID) || '');
  let invited = false;
  const existing = ref ? eventByRef_(ref) : null;
  const updated = !!existing;

  try {
    if (existing) {
      existing.setTime(start, end);
      existing.setTitle(title);
      existing.setLocation(address);
      existing.setDescription(desc);
      setColor_(existing, prefs_(agent).colors.showing);
    } else {
      const r = createEvent_(agent, title, start, end, { description: desc, location: address }, 60, 'showing');
      ref = r.ref;
      invited = r.invited;
    }
  } catch (err) {
    throw new Error('Δεν μπήκε στο ημερολόγιο: ' + err.message);
  }

  if (statusOf_(l.id) === STATUS.NO_ANSWER) clearFollowUp_(agent, l);

  const v = {};
  // Νέα ώρα: το αποτέλεσμα της προηγούμενης δεν ισχύει και ξαναρωτάμε μετά τη νέα.
  if (ts_(appGet_(l.id, ACOL.SHOW_AT)) !== start.getTime()) {
    v[ACOL.OUTCOME] = '';
    v[ACOL.OUTCOME_NOTE] = '';
    v[ACOL.OUTCOME_ASKED] = '';
  }
  v[ACOL.STATUS] = STATUS.SHOWING;
  v[ACOL.SHOW_AT] = start;
  v[ACOL.SHOW_ID] = ref;
  v[ACOL.ADDRESS] = address;
  v[ACOL.CLIENT] = l.name;
  v[ACOL.CLIENT_EMAIL] = l.email;
  v[ACOL.CLIENT_PHONE] = l.phone;
  v[ACOL.PROPERTY] = propertyLine_(l, p) + (address ? ' — ' + address : '');
  v[ACOL.REMINDED] = '';                 // νέα ώρα → νέα υπενθύμιση (email και SMS)
  v[ACOL.SMS_REMIND] = '';
  if (!appGet_(l.id, ACOL.CALLED)) v[ACOL.CALLED] = new Date();
  appSet_(agent, l.id, v);

  return {
    lead: serialize_(l),
    updated: updated,
    invited: invited,
    when: fmtDate_(start) + ' στις ' + fmtTime_(start),
    reminder: l.email
      ? 'Ο πελάτης θα πάρει email στις ' +
        fmtTime_(new Date(start.getTime() - CONFIG.REMINDER_HOURS_BEFORE * 3600000)) + '.'
      : 'Χωρίς email πελάτη — δεν θα σταλεί υπενθύμιση.'
  };
}

function parseStart_(dateStr, timeStr) {
  const p = String(dateStr || '').split('-').map(Number);
  const t = String(timeStr || '').split(':').map(Number);
  if (p.length !== 3 || t.length < 2) throw new Error('Συμπλήρωσε ημερομηνία και ώρα.');

  const start = new Date(p[0], p[1] - 1, p[2], t[0], t[1], 0, 0);
  if (isNaN(start.getTime())) throw new Error('Μη έγκυρη ημερομηνία ή ώρα.');
  if (start.getTime() < Date.now()) throw new Error('Η υπόδειξη είναι στο παρελθόν.');
  return start;
}

/**
 * Ακύρωση υπόδειξης: σβήνει το event, καθαρίζει τις υπενθυμίσεις και γυρίζει
 * την κλήση σε «Απαντημένη». Επιστρέφει την ώρα που ακυρώθηκε, ώστε η σελίδα
 * να ετοιμάσει SMS ακύρωσης για τον πελάτη.
 */
/** «Πώς πήγε η υπόδειξη;»: καταχωρείται στη γραμμή της κλήσης. */
function actOutcome_(agent, d) {
  const l = findMyLead_(agent, d.id);
  if (CONFIG.OUTCOMES.indexOf(d.outcome) === -1) throw new Error('Διάλεξε πώς πήγε η υπόδειξη.');
  if (!appGet_(l.id, ACOL.SHOW_AT)) throw new Error('Δεν υπάρχει υπόδειξη σε αυτή την κλήση.');
  const v = {};
  v[ACOL.OUTCOME] = d.outcome;
  v[ACOL.OUTCOME_NOTE] = String(d.note || '').trim();
  appSet_(agent, l.id, v);
  return serialize_(l);
}

function actCancelShowing_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const at = appGet_(l.id, ACOL.SHOW_AT);
  const ref = appGet_(l.id, ACOL.SHOW_ID);
  if (!at && !ref) throw new Error('Δεν υπάρχει υπόδειξη για ακύρωση.');

  let eventDeleted = false;
  const ev = ref ? eventByRef_(ref) : null;
  if (ev) {
    try { ev.deleteEvent(); eventDeleted = true; }
    catch (err) { console.warn('Ακύρωση: δεν σβήστηκε το event: ' + err.message); }
  }

  const v = {};
  v[ACOL.STATUS] = STATUS.ANSWERED;
  v[ACOL.SHOW_AT] = '';
  v[ACOL.SHOW_ID] = '';
  v[ACOL.REMINDED] = '';
  v[ACOL.SMS_REMIND] = '';
  v[ACOL.OUTCOME] = '';
  v[ACOL.OUTCOME_NOTE] = '';
  v[ACOL.OUTCOME_ASKED] = '';
  appSet_(agent, l.id, v);

  const ok = at && ts_(at);
  return {
    lead: serialize_(l),
    eventDeleted: eventDeleted,
    when: ok ? fmtDate_(at) + ' στις ' + fmtTime_(at) : '',
    date: ok ? fmtIso_(at) : '',
    time: ok ? fmtTime_(at) : ''
  };
}

/** Τα στοιχεία του μεσίτη για το SMS. Γράφονται στη γραμμή του στο Agents. */
/**
 * Ρυθμίσεις μεσίτη. Αλλάζει ΜΟΝΟ ό,τι στέλνεται: { smsName, phone, link,
 * templates: {intro:{el,en},…}, colors: {showing,followup,task} }.
 */
function actSettings_(agent, d) {
  readAgents_();
  const c = _agentCols;
  const sh = sheet_(CONFIG.SHEETS.AGENTS);
  const has = k => Object.prototype.hasOwnProperty.call(d, k);

  if (has('phone')) {
    const phone = phoneDigits_(d.phone);
    if (phone && phone.length < 10) throw new Error('Το κινητό δείχνει ελλιπές.');
    if (c.PHONE) sh.getRange(agent.row, c.PHONE).setNumberFormat('@').setValue(phone);
    agent.phone = phone;
  }
  if (has('smsName')) {
    agent.smsName = String(d.smsName || '').trim();
    if (c.SMS_NAME) sh.getRange(agent.row, c.SMS_NAME).setValue(safe_(agent.smsName));
  }
  if (has('link')) {
    agent.link = String(d.link || '').trim();
    if (agent.link && !/^https:\/\//i.test(agent.link)) throw new Error('Ο σύνδεσμος πρέπει να ξεκινά με https://');
    if (c.LINK) sh.getRange(agent.row, c.LINK).setValue(safe_(agent.link));
  }

  if (has('templates') || has('colors')) {
    const p = agent.prefs || {};

    if (has('templates')) {
      const t = {};
      Object.keys(DEFAULT_TEMPLATES).forEach(k => {
        ['el', 'en'].forEach(l => {
          const v = String(((d.templates || {})[k] || {})[l] || '').trim().slice(0, 600);
          if (v && v !== DEFAULT_TEMPLATES[k][l]) { t[k] = t[k] || {}; t[k][l] = v; }
        });
      });
      p.templates = t;                   // κρατάμε μόνο ό,τι διαφέρει από την προεπιλογή
    }

    if (has('colors')) {
      const col = Object.assign({}, p.colors || {});
      Object.keys(CONFIG.COLORS).forEach(k => {
        const v = String((d.colors || {})[k] || '');
        if (/^([1-9]|1[01])$/.test(v)) col[k] = v;
      });
      p.colors = col;
    }

    agent.prefs = p;
    if (!c.PREFS) throw new Error('Λείπει η στήλη «Ρυθμίσεις» στο Agents. Τρέξε setup().');
    sh.getRange(agent.row, c.PREFS).setValue(JSON.stringify(p));
  }

  return agentPayload_(agent);
}

// ═════════════════════════════════════════════════════════════
//  ΥΠΕΝΘΥΜΙΣΗ ΠΕΛΑΤΗ — trigger ανά 15 λεπτά
// ═════════════════════════════════════════════════════════════

function sendShowingReminders() {
  const sh = sheet_(CONFIG.SHEETS.APP);
  if (sh.getLastRow() < 2) return;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, ACOL.WIDTH).getValues();
  const now = Date.now();
  const window = CONFIG.REMINDER_HOURS_BEFORE * 3600000;

  rows.forEach((v, i) => {
    const row = i + 2;
    const start = v[ACOL.SHOW_AT - 1];
    if (!start || !ts_(start) || v[ACOL.STATUS - 1] !== STATUS.SHOWING) return;

    const t = new Date(start).getTime();
    if (now >= t) { askOutcome_(sh, row, v, t, now); return; }
    if (now < t - window) return;

    // 1. Email στον πελάτη
    const email = String(v[ACOL.CLIENT_EMAIL - 1] || '').trim();
    if (email && !v[ACOL.REMINDED - 1]) {
      try {
        MailApp.sendEmail({
          to: email,
          subject: 'Υπενθύμιση ραντεβού — ' + v[ACOL.PROPERTY - 1],
          htmlBody: reminderHtml_({
            client: v[ACOL.CLIENT - 1], property: v[ACOL.PROPERTY - 1],
            date: fmtDate_(start), time: fmtTime_(start)
          }),
          name: CONFIG.OFFICE.name,
          replyTo: CONFIG.OFFICE.email
        });
        sh.getRange(row, ACOL.REMINDED).setValue(new Date());
      } catch (err) {
        console.error('Email υπενθύμισης, γραμμή ' + row + ': ' + err.message);
      }
    }

    // 2. SMS στον πελάτη
    if (CONFIG.SMS_MODE !== 'off' && !v[ACOL.SMS_REMIND - 1]) {
      try {
        const done = remindBySms_(v, new Date(start));
        if (done) sh.getRange(row, ACOL.SMS_REMIND).setValue(new Date());
      } catch (err) {
        console.error('SMS υπενθύμισης, γραμμή ' + row + ': ' + err.message);
      }
    }
  });
}

/** Μία φορά, OUTCOME_AFTER_HOURS μετά την υπόδειξη και όχι αργότερα από μία μέρα. */
function askOutcome_(sh, row, v, t, now) {
  const from = t + CONFIG.OUTCOME_AFTER_HOURS * 3600000;
  if (now < from || now > t + 86400000 || v[ACOL.OUTCOME - 1] || v[ACOL.OUTCOME_ASKED - 1]) return;

  const id = String(v[ACOL.ID - 1]);
  const agent = readAgents_().find(a => norm_(a.name) === norm_(v[ACOL.AGENT - 1]));
  if (!agent) return;
  const where = String(v[ACOL.ADDRESS - 1] || 'Το ακίνητο');
  const go = 'go:outcome:' + id;
  try {
    const msg = {
      type: 'outcome', id: go, tag: 'outcome-' + id, url: '?lead=' + encodeURIComponent(go),
      title: 'Πώς πήγε η υπόδειξη;', body: where + ' · ' + fmtTime_(new Date(t))
    };
    if (featureFlags_(agent).oneTapPush) msg.acts = outcomeActions_();   // 2.3 · FEAT-3
    const sent = pushToAgent_(agent, msg);
    if (!sent && agent.email) {
      MailApp.sendEmail({ to: agent.email, subject: 'Πώς πήγε η υπόδειξη;', name: 'KW App',
        body: where + ', ' + fmtTime_(new Date(t)) + '\n\nΚαταχώρησε το αποτέλεσμα: ' +
              CONFIG.APP_URL + '?lead=' + encodeURIComponent(go) });
    }
    sh.getRange(row, ACOL.OUTCOME_ASKED).setValue(new Date());
  } catch (err) {
    console.error('Αποτέλεσμα υπόδειξης, γραμμή ' + row + ': ' + err.message);
  }
}

/**
 * 'twilio' → στέλνει το SMS αυτόματα.
 * 'agent'  → ειδοποίηση στον μεσίτη· με ένα πάτημα ανοίγει το έτοιμο SMS.
 *            Αν ο μεσίτης δεν έχει ενεργές ειδοποιήσεις, του πάει email.
 * Επιστρέφει true όταν η υπενθύμιση διεκπεραιώθηκε (για να μην ξαναγίνει).
 */
function remindBySms_(v, start) {
  const id = String(v[ACOL.ID - 1]);
  const phone = phoneDigits_(v[ACOL.CLIENT_PHONE - 1]);
  const client = String(v[ACOL.CLIENT - 1] || 'Πελάτης');
  const agent = readAgents_().find(a => norm_(a.name) === norm_(v[ACOL.AGENT - 1]));
  if (!phone) return true;                              // τίποτα να σταλεί

  if (CONFIG.SMS_MODE === 'twilio') {
    sendTwilioSms_(phone, reminderSmsText_(start, v[ACOL.ADDRESS - 1], agent));
    return true;
  }

  if (!agent) return true;
  const sent = pushToAgent_(agent, {
    type: 'remind', id: id, tag: 'remind-' + id,
    title: 'Υπενθύμιση πελάτη · ' + fmtTime_(start),
    body: (CONFIG.PUSH_SHOW_CLIENT ? client + ' — ' : '') + 'πάτα για να στείλεις το SMS υπενθύμισης',
    url: '?lead=' + encodeURIComponent(id) + '&remind=1'
  });

  if (!sent && agent.email) {
    MailApp.sendEmail({
      to: agent.email,
      subject: 'Στείλε υπενθύμιση: ' + client + ' στις ' + fmtTime_(start),
      body: 'Η υπόδειξη με ' + client + ' είναι στις ' + fmtTime_(start) + '.\n\n' +
            'Άνοιξε από το κινητό για να στείλεις το έτοιμο SMS υπενθύμισης:\n' +
            CONFIG.APP_URL + '?lead=' + encodeURIComponent(id) + '&remind=1',
      name: 'KW App'
    });
  }
  return true;
}

/**
 * Το SMS υπενθύμισης για αυτόματη αποστολή, από το μήνυμα «Υπενθύμιση» του
 * μεσίτη. Φεύγει από τον πάροχο, όχι από το κινητό του, οπότε αν το μήνυμα
 * δεν έχει ήδη το κινητό του, το προσθέτουμε για να μπορεί να τον καλέσει ο πελάτης.
 */
function reminderSmsText_(start, address, agent) {
  const tomorrow = new Date(Date.now() + 86400000);
  const day = fmtIso_(start) === fmtIso_(new Date()) ? 'σήμερα'
            : fmtIso_(start) === fmtIso_(tomorrow) ? 'αύριο'
            : 'την ' + fmtDate_(start).slice(0, 5);
  const tpl = agent ? templateFor_(agent, 'reminder', 'el') : DEFAULT_TEMPLATES.reminder.el;
  let text = renderTpl_(tpl, {
    'ημέρα': day, 'ώρα': fmtTime_(start), 'διεύθυνση': address,
    'όνομά μου': agent ? (agent.smsName || agent.name) : CONFIG.OFFICE.name,
    'κινητό μου': agent ? agent.phone : '', 'γραφείο': CONFIG.OFFICE.name
  });
  if (agent && agent.phone && tpl.indexOf('{κινητό μου}') === -1) text += ' ' + agent.phone;
  return text;
}

function sendTwilioSms_(phoneDigits, text) {
  const tok = PropertiesService.getScriptProperties().getProperty('TWILIO_TOKEN');
  if (!CONFIG.TWILIO_SID || !CONFIG.TWILIO_FROM || !tok) {
    throw new Error('Λείπουν TWILIO_SID / TWILIO_FROM ή TWILIO_TOKEN.');
  }
  const res = UrlFetchApp.fetch(
    'https://api.twilio.com/2010-04-01/Accounts/' + CONFIG.TWILIO_SID + '/Messages.json', {
      method: 'post',
      payload: { To: phoneIntl_(phoneDigits), From: CONFIG.TWILIO_FROM, Body: text },
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.TWILIO_SID + ':' + tok) },
      muteHttpExceptions: true
    });
  if (res.getResponseCode() >= 300) {
    throw new Error('Twilio ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
}

function reminderHtml_(d) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const row = (label, value) =>
    '<tr><td style="padding:5px 18px 5px 0;color:#6b6b73;font-size:14px">' + label +
    '</td><td style="padding:5px 0;font-size:15px"><b>' + esc(value) + '</b></td></tr>';

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#16161a;max-width:520px">',
    '<p>Καλησπέρα ' + esc(d.client) + ',</p>',
    '<p>Υπενθυμίζουμε το σημερινό μας ραντεβού για την υπόδειξη του ακινήτου.</p>',
    '<table style="border-collapse:collapse;margin:20px 0">',
    row('Ημερομηνία', d.date), row('Ώρα', d.time), row('Ακίνητο', d.property),
    '</table>',
    '<p>Αν χρειαστεί να αλλάξει κάτι, καλέστε μας στο ' + esc(CONFIG.OFFICE.phone) + '.</p>',
    '<p style="margin-top:28px;color:#5c5c66;font-size:14px">',
    '<b style="color:#16161a">' + esc(CONFIG.OFFICE.name) + '</b><br>',
    esc(CONFIG.OFFICE.phone) + '<br>', esc(CONFIG.OFFICE.email),
    '</p></div>'
  ].join('');
}

// ═════════════════════════════════════════════════════════════
//  ΕΓΓΡΑΦΑ ΑΚΙΝΗΤΟΥ (Drive)
// ═════════════════════════════════════════════════════════════
// Συνεργάτες / <Μεσίτης> / [Διαθέσιμα /] <κωδικός - διεύθυνση> / Έγγραφα KWAC / ΠΕΑ.pdf
//
// Ο φάκελος του ακινήτου βρίσκεται με τον ΚΩΔΙΚΟ, όπου κι αν είναι μέσα στον
// φάκελο του μεσίτη. Έτσι συνεργάζεται με το script που ήδη οργανώνει τους
// Συνεργάτες (και μετακινεί φακέλους ανάμεσα σε Διαθέσιμα / Δεσμευμένα κ.λπ.).
// Τα IDs των φακέλων κρατιούνται στο φύλλο «Έγγραφα», για να μην ψάχνουμε
// το Drive κάθε φορά — μαζί με το πόσα αρχεία έχει κάθε έγγραφο.

const DOC_FIXED = ['Κωδικός', 'Μεσίτης', 'Φάκελος ακινήτου', 'Φάκελος εγγράφων'];
const docHeaders_ = () => DOC_FIXED.concat(CONFIG.DOCS.map(s => s.label), ['Ενημέρωση']);

function driveRoot_() {
  const id = CONFIG.DRIVE_ROOT_ID || PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID');
  if (!id) throw new Error('Δεν έχει οριστεί ο φάκελος «Συνεργάτες». Τρέξε setup().');
  return DriveApp.getFolderById(id);
}

function childByName_(parent, name) {
  const it = parent.getFoldersByName(name);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

/** Ο φάκελος του μεσίτη μέσα στους Συνεργάτες. Τον φτιάχνει και τον μοιράζεται μαζί του αν λείπει. */
function agentFolder_(agent) {
  if (agent.folder) {
    try {
      const f = DriveApp.getFolderById(agent.folder);
      if (!f.isTrashed()) return f;
    } catch (e) { /* σβήστηκε ή δεν έχουμε πρόσβαση: τον ξαναβρίσκουμε */ }
  }

  const root = driveRoot_();
  let folder = null;
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (norm_(f.getName()) === norm_(agent.name)) { folder = f; break; }
  }
  if (!folder) folder = root.createFolder(agent.name);

  if (agent.email && agent.email !== ownerEmail_()) {
    try {
      const has = folder.getEditors().some(u => (u.getEmail() || '').toLowerCase() === agent.email);
      if (!has) folder.addEditor(agent.email);
    } catch (e) {
      console.warn('Κοινή χρήση φακέλου με ' + agent.email + ': ' + e.message);
    }
  }

  agent.folder = folder.getId();
  readAgents_();
  if (_agentCols.FOLDER) sheet_(CONFIG.SHEETS.AGENTS).getRange(agent.row, _agentCols.FOLDER).setValue(agent.folder);
  return folder;
}

/** Ο φάκελος με τον κωδικό στο όνομα, μέσα στον φάκελο του μεσίτη (έως 4 επίπεδα βάθος). */
function findPropFolder_(agentF, code) {
  const c = String(code).trim();
  if (!c) return null;
  const re = new RegExp('(^|[^0-9A-Za-zΑ-Ωα-ω])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^0-9A-Za-zΑ-Ωα-ω]|$)');
  const target = agentF.getId();
  const it = DriveApp.searchFolders("title contains '" + c.replace(/'/g, "\\'") + "' and trashed = false");

  while (it.hasNext()) {
    const f = it.next();
    if (!re.test(f.getName())) continue;
    let level = [f];
    for (let depth = 0; depth < 4 && level.length; depth++) {
      const next = [];
      for (let i = 0; i < level.length; i++) {
        const ps = level[i].getParents();
        while (ps.hasNext()) {
          const p = ps.next();
          if (p.getId() === target) return f;
          next.push(p);
        }
      }
      level = next;
    }
  }
  return null;
}

function propFolderName_(p) {
  return renderTpl_(CONFIG.DRIVE_FOLDER_NAME, { 'κωδικός': p.code, 'διεύθυνση': p.street || p.area || '' })
    .replace(/[\/\\]/g, '-').replace(/[\s\-–]+$/, '');
}

/** { folder, docs } του ακινήτου. Τους βρίσκει ή τους φτιάχνει. */
function propFolders_(agent, p) {
  const rec = readDocs_()[normCode_(p.code)];
  if (rec && rec.folder && rec.docsFolder) {
    try {
      const folder = DriveApp.getFolderById(rec.folder);
      const docs = DriveApp.getFolderById(rec.docsFolder);
      if (!folder.isTrashed() && !docs.isTrashed()) return { folder: folder, docs: docs };
    } catch (e) { /* ξαναψάχνουμε */ }
  }

  const agentF = agentFolder_(agent);
  let folder = findPropFolder_(agentF, p.code);
  if (!folder) {
    const status = CONFIG.DRIVE_STATUS_FOLDER ? childByName_(agentF, CONFIG.DRIVE_STATUS_FOLDER) : null;
    folder = (status || agentF).createFolder(propFolderName_(p));
  }
  const docs = childByName_(folder, CONFIG.DOCS_FOLDER) || folder.createFolder(CONFIG.DOCS_FOLDER);
  if (!childByName_(folder, CONFIG.MEDIA.FOLDER)) folder.createFolder(CONFIG.MEDIA.FOLDER);   // 1.18

  saveDocs_(agent, p, folder.getId(), docs.getId(), null);
  return { folder: folder, docs: docs };
}

/** Τα ονόματα που ταιριάζουν σε μια θέση: το κύριο και τα εναλλακτικά (π.χ. Συμβόλαιο / Μισθωτήριο). */
const slotNames_ = s => [s.file].concat(s.alt ? [].concat(s.alt) : []);

/** Σε ποια θέση ανήκει ένα όνομα αρχείου: «Εντολή 2.pdf» → Εντολή. Αλλιώς null. */
function slotOfName_(slots, fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  return slots.find(s => slotNames_(s).some(n => base.indexOf(n) === 0 &&
                                   /^( ?\(?\d+\)?)?$/.test(base.slice(n.length)))) || null;
}

/**
 * Τα αρχεία ενός φακέλου εγγράφων, ανά θέση: ΠΕΑ.pdf → pea, Ταυτότητα 2.jpg → id.
 * slots: CONFIG.DOCS (Έγγραφα KWAC) ή CONFIG.BILLING.DOCS (Τιμολόγηση).
 * Σειρά: από το παλαιότερο στο νεότερο, οπότε το τελευταίο είναι το πιο πρόσφατο.
 */
function listDocs_(docsF, slots) {
  slots = slots || CONFIG.DOCS;
  const out = {};
  slots.forEach(s => { out[s.key] = []; });
  if (!docsF) return out;

  const it = docsF.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const slot = slotOfName_(slots, f.getName());
    if (!slot) continue;
    const created = f.getDateCreated();
    out[slot.key].push({
      id: f.getId(), name: f.getName(), url: f.getUrl(), ts: created.getTime(),
      date: stamp_(created), size: f.getSize(), mime: f.getMimeType()
    });
  }
  Object.keys(out).forEach(k => out[k].sort((a, b) => (a.ts - b.ts) || a.name.localeCompare(b.name)));
  return out;
}

// ── Φύλλο «Έγγραφα» ─────────────────────────────────────

let _docs = null;

function readDocs_() {
  if (_docs) return _docs;
  _docs = {};
  const sh = getSS().getSheetByName(CONFIG.SHEETS.DOCS);
  if (!sh || sh.getLastRow() < 2) return _docs;

  sh.getRange(2, 1, sh.getLastRow() - 1, docHeaders_().length).getValues().forEach((v, i) => {
    const key = normCode_(v[0]);
    if (!key) return;
    const counts = {};
    CONFIG.DOCS.forEach((s, j) => { counts[s.key] = Number(v[DOC_FIXED.length + j]) || 0; });
    _docs[key] = { row: i + 2, folder: String(v[2] || ''), docsFolder: String(v[3] || ''), counts: counts };
  });
  return _docs;
}

function docCounts_(code) {
  const rec = readDocs_()[normCode_(code)];
  const out = {};
  CONFIG.DOCS.forEach(s => { out[s.key] = rec ? rec.counts[s.key] || 0 : 0; });
  return out;
}

/** counts = null → κρατάει τα υπάρχοντα. */
function saveDocs_(agent, p, folderId, docsId, counts) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _docs = null;
    const key = normCode_(p.code);
    const rec = readDocs_()[key];
    const keep = counts || (rec ? rec.counts : {});
    const row = [p.code, agent.name, folderId, docsId]
      .concat(CONFIG.DOCS.map(s => keep[s.key] || 0), [new Date()]);

    const sh = sheet_(CONFIG.SHEETS.DOCS);
    if (rec) sh.getRange(rec.row, 1, 1, row.length).setValues([safeRow_(row)]);
    else sh.appendRow(safeRow_(row));
    _docs = null;
  } finally {
    lock.releaseLock();
  }
}

// ── Ενέργειες ───────────────────────────────────────────
// Δύο ομάδες εγγράφων (d.set):
//  'live' → «Έγγραφα KWAC» (ΠΕΑ, Εντολή, Ταυτότητα), μετράνε στο φύλλο «Έγγραφα».
//  'bill' → «Τιμολόγηση» (1.13), τα έντυπα για την απόδειξη. Μόνο ζωντανά από το Drive.

function myProp_(agent, code) {
  const p = readProps_()[normCode_(code)];
  if (!p || norm_(p.partner) !== norm_(agent.name)) throw new Error('Το ακίνητο δεν είναι στα δικά σου.');
  return p;
}

function docSet_(set) { return set === 'bill' ? 'bill' : 'live'; }
function slotsOf_(set) { return set === 'bill' ? CONFIG.BILLING.DOCS : CONFIG.DOCS; }

/** Ο φάκελος «Τιμολόγηση» μέσα στον φάκελο του ακινήτου. create=false → null αν δεν υπάρχει. */
function billFolder_(propF, create) {
  return childByName_(propF, CONFIG.BILLING.FOLDER) || (create ? propF.createFolder(CONFIG.BILLING.FOLDER) : null);
}

/** Η πιο πρόσφατη Εντολή του «Έγγραφα KWAC», ή null. */
function latestMandate_(f) {
  const list = listDocs_(f.docs)[CONFIG.DOCS_REMINDER.REQUIRES] || [];
  return list.length ? list[list.length - 1] : null;
}

const COPY_TAG = 'Αντίγραφο του ';

function docsResult_(agent, p, f, set) {
  if (docSet_(set) === 'bill') {
    const bill = billFolder_(f.folder, false);
    const docs = rvAttach_(listDocs_(bill, CONFIG.BILLING.DOCS));
    const counts = {};
    CONFIG.BILLING.DOCS.forEach(s => { counts[s.key] = docs[s.key].length; });

    // Η Εντολή της Τιμολόγησης είναι αντίγραφο: «current» = αντίγραφο της τελευταίας.
    const src = latestMandate_(f);
    const slot = CONFIG.BILLING.DOCS.find(s => s.from);
    let current = false;
    if (src && slot && docs[slot.key].length) {
      const last = docs[slot.key][docs[slot.key].length - 1];
      try { current = String(DriveApp.getFileById(last.id).getDescription() || '').indexOf(COPY_TAG + src.id) !== -1; }
      catch (e) { /* χωρίς περιγραφή */ }
      if (!current && last.ts >= src.ts) current = true;     // ανέβηκε με το χέρι μετά την τελευταία Εντολή
    }
    const picks = billPicks_(f, docs);    // 1.20: έντυπα για επιλογή + έλεγχος των αντιγράφων
    return { code: p.code, set: 'bill', folderUrl: f.folder.getUrl(), docsUrl: bill ? bill.getUrl() : '',
             docs: docs, counts: counts, source: { available: !!src, current: current }, picks: picks };
  }

  const docs = rvAttach_(listDocs_(f.docs));
  const counts = {};
  CONFIG.DOCS.forEach(s => { counts[s.key] = docs[s.key].length; });
  saveDocs_(agent, p, f.folder.getId(), f.docs.getId(), counts);
  return { code: p.code, set: 'live', folderUrl: f.folder.getUrl(), docsUrl: f.docs.getUrl(), docs: docs, counts: counts };
}

/** Τα έγγραφα ενός ακινήτου, ζωντανά από το Drive. Φτιάχνει τους φακέλους αν λείπουν
 *  (όχι όμως την «Τιμολόγηση»: αυτή φτιάχνεται με το πρώτο αρχείο). */
function actDocs_(agent, d) {
  const p = myProp_(agent, d.code);
  return docsResult_(agent, p, propFolders_(agent, p), d.set);
}

/** Ο πραγματικός τύπος από την «υπογραφή» στα πρώτα bytes, ή '' αν δεν είναι επιτρεπτός. */
function sniffType_(bytes) {
  const b = i => (bytes[i] || 0) & 0xff;
  const ascii = (from, to) => String.fromCharCode.apply(null, bytes.slice(from, to).map(x => x & 0xff));
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(ascii(8, 12))) return 'image/heic';
  return '';
}

const EXT_BY_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
                      'image/heic': '.heic', 'image/heif': '.heif', 'image/webp': '.webp' };

/** Το όνομα του νέου αρχείου. Στο Συμβόλαιο: «Μισθωτήριο» αν το ακίνητο είναι ενοικίαση. */
function slotFileName_(slot, p) {
  return slot.alt && /ενοικ/i.test(norm_(p.deal)) ? [].concat(slot.alt)[0] : slot.file;
}

/** Το επόμενο ελεύθερο όνομα: Εντολή, Εντολή 2, Εντολή 3… */
function freeName_(base, existing) {
  const used = existing.map(x => x.name.replace(/\.[^.]+$/, ''));
  let name = base, n = 1;
  while (used.indexOf(name) !== -1) name = base + ' ' + (++n);
  return name;
}

/**
 * Σβήνει ένα αρχείο από τον φάκελο του ακινήτου (πάει στον κάδο του Drive).
 * Αν το αρχείο το ανέβασε άλλος λογαριασμός στο Drive, το Google επιτρέπει σβήσιμο
 * μόνο στον κάτοχο: τότε το βγάζουμε απλώς από τον φάκελο.
 */
function trashFile_(file, folder) {
  try { file.setTrashed(true); return; } catch (e) { /* όχι κάτοχος */ }
  try { folder.removeFile(file); return; } catch (e) { /* ούτε αυτό */ }
  throw new Error('Το αρχείο το έχει ανεβάσει άλλος λογαριασμός. Σβήσ’ το από το Drive.');
}

/**
 * Ανέβασμα εγγράφου: { code, set, slot, mode, name, mime, data (base64) }.
 * Μετονομάζεται στο όνομα του εγγράφου (ΠΕΑ, Εντολή…).
 *  mode 'replace' → τα παλιά αρχεία της θέσης πάνε στον κάδο (ανακτώνται για 30 ημέρες).
 *  mode 'keep'    → μένουν και τα παλιά· το νέο γίνεται «Εντολή 2» και είναι το τελευταίο.
 *  χωρίς mode (παλιές εκδόσεις σελίδας): μονά έγγραφα → replace, πολλαπλά → keep.
 */
function actUpload_(agent, d) {
  const p = myProp_(agent, d.code);
  const set = docSet_(d.set);
  const slot = slotsOf_(set).find(s => s.key === d.slot);
  if (!slot) throw new Error('Άγνωστο έγγραφο: ' + d.slot);

  const mime = String(d.mime || '').toLowerCase();
  if (!/^application\/pdf$|^image\//.test(mime)) throw new Error('Δεκτά μόνο PDF και φωτογραφίες.');
  const b64 = String(d.data || '');
  if (!b64) throw new Error('Το αρχείο είναι άδειο.');
  if (b64.length * 0.75 > CONFIG.MAX_UPLOAD_MB * 1048576) {
    throw new Error('Το αρχείο ξεπερνά τα ' + CONFIG.MAX_UPLOAD_MB + ' MB.');
  }

  // Ο τύπος που δηλώνει ο browser δεν αρκεί: ελέγχουμε τα πρώτα bytes του αρχείου.
  const bytes = Utilities.base64Decode(b64);
  const real = sniffType_(bytes);
  if (!real) throw new Error('Το αρχείο δεν είναι PDF ή φωτογραφία (JPG, PNG, HEIC, WEBP).');

  const f = propFolders_(agent, p);
  const target = set === 'bill' ? billFolder_(f.folder, true) : f.docs;
  const existing = listDocs_(target, slotsOf_(set))[slot.key];
  const mode = d.mode === 'replace' || d.mode === 'keep' ? d.mode : (slot.multi ? 'keep' : 'replace');

  if (mode === 'replace') {
    existing.forEach(x => { try { trashFile_(DriveApp.getFileById(x.id), target); } catch (e) { /* ήδη σβησμένο */ } });
  }
  const base = mode === 'replace' ? slotFileName_(slot, p) : freeName_(slotFileName_(slot, p), existing);

  const file = target.createFile(Utilities.newBlob(bytes, real, base + EXT_BY_MIME[real]));
  try {
    file.setDescription('Ανέβηκε από ' + agent.name + ' στις ' + stamp_(new Date()) +
                        (d.name ? ' · αρχικό όνομα: ' + d.name : ''));
  } catch (e) { /* όχι κρίσιμο */ }

  // 1.17: στον έλεγχο του Admin. Το νέο αρχείο κλείνει και το «Θέλει διόρθωση» της θέσης.
  rvAddSafe_({ fileId: file.getId(), code: p.code, agent: agent.name, kind: set, slot: slot.key,
               title: slot.label, replaced: mode === 'replace' ? existing.map(x => x.id) : [] });

  return docsResult_(agent, p, f, set);
}

/**
 * Τιμολόγηση: αντίγραφο της τελευταίας Εντολής από το «Έγγραφα KWAC».
 * Το παλιό αντίγραφο (αν υπάρχει) πάει στον κάδο, ώστε να μένει μία Εντολή.
 */
function actBillMandate_(agent, d) {
  const p = myProp_(agent, d.code);
  const f = propFolders_(agent, p);
  const src = latestMandate_(f);
  if (!src) throw new Error('Δεν υπάρχει Εντολή στο «' + CONFIG.DOCS_FOLDER + '». Ανέβασέ τη πρώτα εκεί.');

  const slot = CONFIG.BILLING.DOCS.find(s => s.from);
  const bill = billFolder_(f.folder, true);
  const old = listDocs_(bill, CONFIG.BILLING.DOCS)[slot.key];
  old.forEach(x => { try { trashFile_(DriveApp.getFileById(x.id), bill); } catch (e) { /* ήδη σβησμένο */ } });

  const ext = (src.name.match(/\.[^.]+$/) || [''])[0];
  const copy = DriveApp.getFileById(src.id).makeCopy(slot.file + ext, bill);
  try {
    copy.setDescription(COPY_TAG + src.id + ' («' + src.name + '») · από ' + agent.name + ' στις ' + stamp_(new Date()));
  } catch (e) { /* όχι κρίσιμο */ }

  // 1.17: αντίγραφο εγκεκριμένης Εντολής = εγκεκριμένο κι αυτό. Αλλιώς πάει για έλεγχο.
  let srcOk = false;
  try { const r = rvByFile_()[src.id]; srcOk = !!r && rvGet_(r, RVC.STATUS) === RV.OK; } catch (e) { /* χωρίς φύλλο */ }
  rvAddSafe_({ fileId: copy.getId(), code: p.code, agent: agent.name, kind: 'bill', slot: slot.key, title: slot.label,
               replaced: old.map(x => x.id), status: srcOk ? RV.OK : '', by: srcOk ? 'αυτόματα' : '',
               note: srcOk ? 'Αντίγραφο της εγκεκριμένης Εντολής.' : '' });
  return docsResult_(agent, p, f, 'bill');
}

/** Σβήνει ένα αρχείο από το «Έγγραφα KWAC» ή την «Τιμολόγηση» του ακινήτου (στον κάδο του Drive). */
function actDocDelete_(agent, d) {
  const p = myProp_(agent, d.code);
  const set = docSet_(d.set);
  const f = propFolders_(agent, p);
  const folder = set === 'bill' ? billFolder_(f.folder, false) : f.docs;
  if (!folder) throw new Error('Δεν βρέθηκε ο φάκελος.');
  const file = DriveApp.getFileById(String(d.fileId || ''));

  let inside = false;
  const ps = file.getParents();
  while (ps.hasNext()) if (ps.next().getId() === folder.getId()) inside = true;
  if (!inside) throw new Error('Το αρχείο δεν ανήκει σε αυτό το ακίνητο.');

  trashFile_(file, folder);
  rvMark_([file.getId()], RV.GONE);
  return docsResult_(agent, p, f, set);
}

// ── Φάκελοι για όλους ────────────────────────────────────

/** Στο πρώτο άνοιγμα της εφαρμογής: φάκελος μεσίτη τώρα, φάκελοι ακινήτων στο παρασκήνιο. */
function firstLoginDrive_(agent) {
  try {
    if (!agent.folder) {
      agentFolder_(agent);
      scheduleDriveSync_();
    }
    return { ready: true, url: 'https://drive.google.com/drive/folders/' + agent.folder };
  } catch (e) {
    console.warn('Drive ' + agent.name + ': ' + e.message);
    return { ready: false, error: e.message };
  }
}

function scheduleDriveSync_() {
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('SYNC_SCHEDULED') || 0) < 10 * 60000) return;
  props.setProperty('SYNC_SCHEDULED', String(Date.now()));
  ScriptApp.newTrigger('syncDriveFoldersOnce').timeBased().after(30 * 1000).create();
}

function syncDriveFoldersOnce() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncDriveFoldersOnce')
    .forEach(t => ScriptApp.deleteTrigger(t));
  syncDriveFolders();
}

/**
 * Trigger ανά 6 ώρες: φάκελος για κάθε μεσίτη και για κάθε διαθέσιμο ακίνητό
 * του. Ό,τι υπάρχει ήδη στο φύλλο «Έγγραφα» προσπερνιέται, οπότε μετά την
 * πρώτη φορά τελειώνει σε δευτερόλεπτα. Σταματά πριν το όριο των 6 λεπτών.
 */
function syncDriveFolders(budgetMs) {
  const t0 = Date.now();
  const budget = budgetMs || 270000;
  let made = 0, skipped = 0;

  _agents = null;
  readAgents_().filter(isAgent_).forEach(agent => {
    if (Date.now() - t0 > budget) return;
    try { agentFolder_(agent); } catch (e) { console.warn(agent.name + ': ' + e.message); return; }

    const props = readProps_();
    Object.keys(props).map(k => props[k])
      .filter(p => p.available && norm_(p.partner) === norm_(agent.name))
      .forEach(p => {
        if (Date.now() - t0 > budget) return;
        const rec = readDocs_()[normCode_(p.code)];
        if (rec && rec.docsFolder) { skipped++; return; }
        try { propFolders_(agent, p); made++; }
        catch (e) { console.warn(p.code + ': ' + e.message); }
      });
  });

  console.log('Φάκελοι Drive: ' + made + ' νέοι/συνδέθηκαν, ' + skipped + ' υπήρχαν' +
              (Date.now() - t0 > budget ? ' — σταμάτησε στο όριο χρόνου, συνεχίζει στο επόμενο τρέξιμο' : ''));
}

// ── Υπενθύμιση «λείπουν έγγραφα» ────────────────────────

/** Τα έγγραφα που λείπουν, ΜΟΝΟ αν υπάρχει ήδη η εντολή. Αλλιώς [] (το ακίνητο δεν ξεκίνησε). */
function missingDocs_(counts) {
  const req = CONFIG.DOCS_REMINDER.REQUIRES;
  if (!(counts && counts[req] > 0)) return [];
  return CONFIG.DOCS.filter(s => s.key !== req && !(counts[s.key] > 0)).map(s => s.label);
}

/**
 * Trigger (κάθε Δευτέρα ή κάθε μέρα, βλ. DOCS_REMINDER). Για κάθε μεσίτη:
 * ακίνητα με εντολή που τους λείπει κάποιο έγγραφο → μία ειδοποίηση. Πάτημα →
 * η εφαρμογή ανοίγει τη λίστα τους. Χωρίς ενεργές ειδοποιήσεις → email.
 * Πριν μετρήσει, ξαναδιαβάζει το Drive: πιάνει και αρχεία που μπήκαν με το χέρι.
 */
function docsReminder() {
  _agents = null; _docs = null;
  const props = readProps_();

  readAgents_().filter(isAgent_).forEach(agent => {
    const missing = [];
    const seen = { props: 0, folder: 0, mandate: 0 };

    Object.keys(props).map(k => props[k])
      .filter(p => p.available && norm_(p.partner) === norm_(agent.name))
      .forEach(p => {
        seen.props++;
        const rec = readDocs_()[normCode_(p.code)];
        if (!rec || !rec.docsFolder) return;               // χωρίς φάκελο = χωρίς εντολή
        seen.folder++;
        let counts = rec.counts;
        try {
          const docs = listDocs_(DriveApp.getFolderById(rec.docsFolder));
          counts = {};
          CONFIG.DOCS.forEach(s => { counts[s.key] = docs[s.key].length; });
          saveDocs_(agent, p, rec.folder, rec.docsFolder, counts);
        } catch (e) { /* μένουν τα αποθηκευμένα */ }

        if (counts[CONFIG.DOCS_REMINDER.REQUIRES] > 0) seen.mandate++;
        const lack = missingDocs_(counts);
        if (lack.length) missing.push({ name: p.street || p.code, lack: lack });
      });

    if (!missing.length) {
      console.log(agent.name + ': τίποτα να σταλεί · διαθέσιμα ' + seen.props + ', με φάκελο ' + seen.folder +
                  ', με εντολή ' + seen.mandate + (seen.mandate ? ' (όλα πλήρη)' : ''));
      return;
    }

    const n = missing.length;
    const title = 'Λείπουν έγγραφα · ' + n + (n === 1 ? ' ακίνητο' : ' ακίνητα');
    const lines = missing.map(m => m.name + ': ' + m.lack.join(', '));
    const sent = pushToAgent_(agent, {
      type: 'docs', id: '', tag: 'docs', title: title, url: '?docs=1',
      body: lines.slice(0, 3).join(' · ') + (n > 3 ? ' · …' : '')
    });

    if (!sent && agent.email) {
      MailApp.sendEmail({
        to: agent.email, subject: title, name: 'KW App',
        body: 'Ακίνητα με εντολή που δεν έχουν ακόμα όλα τα έγγραφα για live:\n\n' +
              lines.map(x => '• ' + x).join('\n') +
              '\n\nΆνοιγμα στην εφαρμογή: ' + CONFIG.APP_URL + '?docs=1'
      });
    }
    console.log(agent.name + ': ' + n + ' ακίνητα → ' + (sent ? 'ειδοποίηση σε ' + sent + ' συσκευή/ές'
      : 'email (καμία ενεργή συσκευή στο φύλλο «' + CONFIG.SHEETS.DEVICES + '»' +
        (fcmConfig_() ? '' : ' · λείπει το FCM_SERVICE_ACCOUNT') + ')'));
  });
}

// ═════════════════════════════════════════════════════════════
//  ΕΠΑΦΕΣ (1.11)
// ═════════════════════════════════════════════════════════════
//
//  Δύο φύλλα:
//   · «Επαφές»: το Excel του CRM, όπως το επικολλάς. Η εφαρμογή ΜΟΝΟ το διαβάζει.
//     Οι στήλες βρίσκονται από τις επικεφαλίδες, σε όποια από τις 5 πρώτες γραμμές.
//   · «Επαφές εφαρμογής»: ό,τι γράφει η εφαρμογή (Ενδιαφερόμενος για, σημειώσεις,
//     κλήσεις) και οι πελάτες που ήρθαν από κλήση χωρίς να είναι στο CRM.
//  Ενώνονται με CRM ID, αλλιώς τηλέφωνο, αλλιώς email.
//  Ο μεσίτης βλέπει τις επαφές του CRM που έχουν ΜΟΝΟ αυτόν στον «Συνεργάτη».
//  Κοινές επαφές («Xenofon Zades, Themis Nikolaou») δεν εμφανίζονται σε κανέναν.

const CRM_COLS = {
  ID: /^id$/, ADDED: /^καταχωρηση/, NAME: /^(επαφη|ονοματεπωνυμο|ονομα)$/, JOB: /^επαγγελμα/,
  ROLE: /^ιδιοτητα/, PHONE: /^(τηλεφωνο|κινητο)/, EMAIL: /^e-?mail/, STREET: /^οδος/, AREA: /^περιοχη/,
  SOURCE: /^πηγη/, PARTNER: /^συνεργατης/, STATUS: /^κατασταση/
};

const CONTACT_COLS = [
  ['ID', 'ID', /^id$/],
  ['CRM', 'CRM ID', /^crm id$/],
  ['AGENT', 'Μεσίτης', /^(μεσιτης|συνεργατης)/],
  ['NAME', 'Όνομα', /^(ονοματεπωνυμο|ονομα)/],
  ['PHONE', 'Τηλέφωνο', /^(τηλεφωνο|κινητο)/],
  ['EMAIL', 'Email', /^(e-?mail)/],
  ['CODES', 'Ενδιαφερόμενος για', /^ενδιαφερομενος/],
  ['NOTES', 'Σημειώσεις', /^σημειωσεις/],
  ['FIRST', 'Πρώτη κλήση', /^πρωτη κληση/],
  ['LAST', 'Τελευταία κλήση', /^τελευταια κληση/]
];

let _contacts = null;   // γραμμές του «Επαφές εφαρμογής»
let _crm = null;        // γραμμές του «Επαφές» (CRM)
let _cidx = {};         // μεσίτης → ενωμένες επαφές

function newContactId_() { return 'C' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function emailKey_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function phoneList_(v) { return String(v == null ? '' : v).split(/[,;\/]/).map(phoneDigits_).filter(Boolean); }
function emailList_(v) { return String(v == null ? '' : v).split(/[,;\s]+/).map(emailKey_).filter(x => x.indexOf('@') > 0); }

function contactCols_(sh) {
  const headers = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  const cols = {};
  CONTACT_COLS.forEach(c => {
    const i = headers.findIndex(h => c[2].test(norm_(h)));
    if (i !== -1) cols[c[0]] = i + 1;
  });
  return cols;
}

/**
 * Φτιάχνει τα δύο φύλλα. Αν το «Επαφές» είναι το φύλλο της 1.10 (με «Ενδιαφερόμενος για»
 * και χωρίς CRM), μετονομάζεται σε «Επαφές εφαρμογής» και φτιάχνεται νέο, άδειο «Επαφές».
 */
function ensureContactSheets_() {
  const ss = getSS();
  const old = ss.getSheetByName(CONFIG.SHEETS.CONTACTS);
  if (old && !ss.getSheetByName(CONFIG.SHEETS.CONTACTS_APP) && old.getLastColumn()) {
    const h = old.getRange(1, 1, 1, old.getLastColumn()).getValues()[0].map(norm_);
    const fromApp = h.some(x => /^ενδιαφερομενος/.test(x));
    const fromCrm = h.some(x => CRM_COLS.PARTNER.test(x));
    if (fromApp && !fromCrm) {
      old.setName(CONFIG.SHEETS.CONTACTS_APP);
      console.log('Επαφές: το φύλλο της 1.10 έγινε «' + CONFIG.SHEETS.CONTACTS_APP + '». Επικόλλησε το CRM στο νέο «' +
                  CONFIG.SHEETS.CONTACTS + '».');
    } else if (fromApp && fromCrm) {
      console.log('⚠ Το «' + CONFIG.SHEETS.CONTACTS + '» έχει και CRM και στήλες της εφαρμογής. Δες το README (1.11).');
    }
  }
  if (!ss.getSheetByName(CONFIG.SHEETS.CONTACTS)) ss.insertSheet(CONFIG.SHEETS.CONTACTS);
  return ensureAppContactSheet_();
}

function ensureAppContactSheet_() {
  const ss = getSS();
  const sh = ss.getSheetByName(CONFIG.SHEETS.CONTACTS_APP) || ss.insertSheet(CONFIG.SHEETS.CONTACTS_APP);
  const cols = contactCols_(sh);
  let added = false;
  CONTACT_COLS.forEach(c => {
    if (cols[c[0]]) return;
    sh.getRange(1, sh.getLastColumn() + 1).setValue(c[1]).setFontWeight('bold');
    added = true;
  });
  if (added) { sh.setFrozenRows(1); _contacts = null; _cidx = {}; }
  return sh;
}

/** Ποιος μεσίτης είναι ο λογαριασμός της εφαρμογής (αν είναι κάποιος). */
function ownerAgentName_() {
  const a = readAgents_().find(x => emailKey_(x.email) === ownerEmail_());
  return a ? a.name : '';
}

/** Το CRM, όπως επικολλήθηκε. Κενό αν δεν βρεθούν οι στήλες «Επαφή» και «Συνεργάτης». */
function readCrm_() {
  if (_crm) return _crm;
  _crm = [];
  const sh = getSS().getSheetByName(CONFIG.SHEETS.CONTACTS);
  if (!sh || sh.getLastRow() < 2) return _crm;

  const vals = sh.getDataRange().getValues();
  const hi = vals.slice(0, 5).findIndex(r =>
    r.some(h => CRM_COLS.NAME.test(norm_(h))) && r.some(h => CRM_COLS.PARTNER.test(norm_(h))));
  if (hi === -1) return _crm;

  const hdr = vals[hi].map(norm_), col = {};
  Object.keys(CRM_COLS).forEach(k => {
    const i = hdr.findIndex(h => CRM_COLS[k].test(h));
    if (i !== -1) col[k] = i;
  });
  // Ετικέτες (Lead, ΚΚ…): η στήλη χωρίς τίτλο ακριβώς πριν το ID.
  if (col.ID > 0 && !hdr[col.ID - 1]) col.TAGS = col.ID - 1;
  const at = (r, k) => (col[k] == null ? '' : r[col[k]]);

  vals.slice(hi + 1).forEach(r => {
    const name = cellText_(at(r, 'NAME'));
    const crmId = cellText_(at(r, 'ID'));
    if (!name || !crmId) return;
    const added = at(r, 'ADDED');
    _crm.push({
      crmId: crmId, name: name,
      partners: cellText_(at(r, 'PARTNER')).split(',').map(x => x.trim()).filter(Boolean),
      phones: phoneList_(at(r, 'PHONE')), emails: emailList_(at(r, 'EMAIL')),
      added: added instanceof Date ? added : '', job: cellText_(at(r, 'JOB')), role: cellText_(at(r, 'ROLE')),
      street: cellText_(at(r, 'STREET')), area: cellText_(at(r, 'AREA')), source: cellText_(at(r, 'SOURCE')),
      tags: cellText_(at(r, 'TAGS')), inactive: /^μη/.test(norm_(at(r, 'STATUS')))
    });
  });
  return _crm;
}

/** Οι γραμμές της εφαρμογής. Δίνει ID σε όσες γράφτηκαν με το χέρι. */
function readContacts_() {
  if (_contacts) return _contacts;
  _contacts = [];
  const sh = getSS().getSheetByName(CONFIG.SHEETS.CONTACTS_APP);
  if (!sh || sh.getLastRow() < 2) return _contacts;

  const cols = contactCols_(sh);
  if (!cols.ID || !cols.AGENT || !cols.CODES) return _contacts;       // δεν έχει τρέξει η setup()
  const me = ownerAgentName_();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const at = (r, k) => (cols[k] ? r[cols[k] - 1] : '');

  rows.forEach((r, i) => {
    const name = cellText_(at(r, 'NAME')), phone = phoneDigits_(at(r, 'PHONE')), email = cellText_(at(r, 'EMAIL'));
    const crmId = cellText_(at(r, 'CRM'));
    if (!name && !phone && !email && !crmId) return;
    let id = cellText_(at(r, 'ID'));
    if (!id) {
      id = newContactId_();
      sh.getRange(i + 2, cols.ID).setValue(id);
    }
    _contacts.push({
      row: i + 2, id: id, crmId: crmId, agent: cellText_(at(r, 'AGENT')) || me, name: name, phone: phone, email: email,
      codes: cellText_(at(r, 'CODES')).split(/[,;]/).map(x => x.trim()).filter(Boolean),
      notes: cellText_(at(r, 'NOTES')), first: at(r, 'FIRST'), last: at(r, 'LAST')
    });
  });
  return _contacts;
}

/** Γραμμή της εφαρμογής με αυτό το τηλέφωνο ή email. */
function findContact_(agentName, phone, email) {
  const a = norm_(agentName), mail = emailKey_(email);
  const mine = readContacts_().filter(c => norm_(c.agent) === a);
  return (phone && mine.find(c => c.phone === phone)) ||
         (mail && mine.find(c => emailKey_(c.email) === mail)) || null;
}

/** Οι επαφές ενός μεσίτη: CRM + εφαρμογή, ενωμένες. */
function agentIndex_(agentName) {
  const key = norm_(agentName);
  if (_cidx[key]) return _cidx[key];

  const list = readCrm_()
    .filter(c => c.partners.length === 1 && norm_(c.partners[0]) === key)
    .map(c => Object.assign({ id: 'K' + c.crmId, crm: true, apps: [] }, c));
  const byId = {}, byPhone = {}, byEmail = {};
  const put = c => {
    c.phones.forEach(p => { if (!byPhone[p]) byPhone[p] = c; });
    c.emails.forEach(e => { if (!byEmail[e]) byEmail[e] = c; });
  };
  list.forEach(c => { byId[c.crmId] = c; put(c); });

  readContacts_().filter(a => norm_(a.agent) === key).forEach(a => {
    const m = (a.crmId && byId[a.crmId]) || (a.phone && byPhone[a.phone]) || (a.email && byEmail[emailKey_(a.email)]);
    if (m) { m.apps.push(a); return; }
    const c = { id: a.id, crm: false, crmId: '', name: a.name, phones: a.phone ? [a.phone] : [],
                emails: emailList_(a.email), apps: [a] };
    list.push(c);
    put(c);
  });

  return (_cidx[key] = { list: list, byPhone: byPhone, byEmail: byEmail });
}

function findAgentContact_(agentName, phone, email) {
  const x = agentIndex_(agentName);
  return (phone && x.byPhone[phone]) || (email && x.byEmail[emailKey_(email)]) || null;
}

function codesOf_(m) {
  const out = [];
  m.apps.forEach(a => a.codes.forEach(c => {
    if (!out.some(x => normCode_(x) === normCode_(c))) out.push(c);
  }));
  return out;
}

function contactOfLead_(l) {
  const owner = ownerOf_(l);
  return owner ? findAgentContact_(owner, l.phone, l.email) : null;
}

/** Άλλα ακίνητα για τα οποία έχει καλέσει ο ίδιος πελάτης. */
function otherCodes_(l) {
  const c = contactOfLead_(l);
  if (!c) return [];
  const here = normCode_(l.code);
  return codesOf_(c).filter(x => normCode_(x) !== here);
}

/** Νέα γραμμή στο «Επαφές εφαρμογής». */
function newAppRow_(sh, cols, row, c) {
  const put = { ID: c.id, CRM: c.crmId, AGENT: c.agent, NAME: c.name, PHONE: c.phone, EMAIL: c.email };
  Object.keys(put).forEach(k => { if (put[k]) sh.getRange(row, cols[k]).setValue(safe_(put[k])); });
}

/** Περνά κλήσεις στις επαφές. Γράφει μόνο στο «Επαφές εφαρμογής». */
function addLeadsToContacts_(leads) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureAppContactSheet_();
    const cols = contactCols_(sh);
    readContacts_();
    const start = sh.getLastRow() + 1;
    let added = 0, skipped = 0;

    leads.slice().sort((a, b) => ts_(a.date) - ts_(b.date)).forEach(l => {
      const owner = ownerOf_(l);
      if (!owner || !normCode_(l.code) || (!l.phone && !l.email)) { skipped++; return; }
      let c = findContact_(owner, l.phone, l.email);
      if (!c) {
        const m = findAgentContact_(owner, l.phone, l.email);
        if (m && m.apps.length) c = m.apps[0];
        else {
          c = { row: start + added, id: newContactId_(), crmId: m ? m.crmId : '', agent: owner,
                name: m ? m.name : '', phone: m ? m.phones[0] || '' : '', email: m ? m.emails[0] || '' : '',
                codes: [], notes: '', first: '', last: '', dirty: true };
          _contacts.push(c);
          if (m) m.apps.push(c);
          added++;
        }
      }
      if (!c.name && l.name) { c.name = l.name; c.dirty = true; }
      if (!c.phone && l.phone) { c.phone = l.phone; c.dirty = true; }
      if (!c.email && l.email) { c.email = l.email; c.dirty = true; }
      if (!c.codes.some(x => normCode_(x) === normCode_(l.code))) { c.codes.push(l.code); c.dirty = true; }
      const t = ts_(l.date);
      if (t && (!ts_(c.first) || t < ts_(c.first))) { c.first = new Date(t); c.dirty = true; }
      if (t && t > ts_(c.last)) { c.last = new Date(t); c.dirty = true; }
    });

    const dirty = _contacts.filter(c => c.dirty);
    if (dirty.length) {
      const last = dirty.reduce((m, c) => Math.max(m, c.row), 1);
      if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows());
      const put = {
        ID: c => c.id, CRM: c => c.crmId, AGENT: c => c.agent, NAME: c => c.name, PHONE: c => c.phone,
        EMAIL: c => c.email, CODES: c => c.codes.join(', '), FIRST: c => c.first, LAST: c => c.last
      };
      Object.keys(put).forEach(k => {
        const r = sh.getRange(2, cols[k], last - 1, 1);
        const v = r.getValues();
        dirty.forEach(c => { v[c.row - 2][0] = safe_(put[k](c)); });
        r.setValues(v);
      });
      dirty.forEach(c => { delete c.dirty; });
    }
    _cidx = {};
    return { added: added, updated: dirty.length - added, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

/** Όλα τα μηνιαία φύλλα (ΕΕΕΕ-ΜΜ), για το πέρασμα των παλιών κλήσεων. */
function allMonthLeads_() {
  const out = [];
  const width = colIdx_(LCOL.REPEAT);
  getSS().getSheets().filter(s => /^\d{4}-\d{2}$/.test(s.getName()) && s.getLastRow() > 1).forEach(sh => {
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), width)).getValues().forEach(v => {
      if (!cellText_(cell_(v, LCOL.ID))) return;
      out.push({ date: cell_(v, LCOL.DATE), name: cellText_(cell_(v, LCOL.NAME)),
                 phone: phoneDigits_(cell_(v, LCOL.PHONE)), email: cellText_(cell_(v, LCOL.EMAIL)),
                 code: cellText_(cell_(v, LCOL.CODE)) });
    });
  });
  return out;
}

/** Από τη setup() ή με το χέρι. Ασφαλές να ξανατρέξει: δεν φτιάχνει διπλά. */
function contactsBackfill() {
  const leads = allMonthLeads_();
  const r = addLeadsToContacts_(leads);
  console.log('Επαφές εφαρμογής: κλήσεις ' + leads.length + ', νέες γραμμές ' + r.added + ', ενημερώσεις ' + r.updated +
              ', χωρίς μεσίτη ομάδας ή στοιχεία ' + r.skipped);
}

/** Διάγνωση του CRM: τι βρίσκει ο κώδικας και πόσες επαφές βλέπει κάθε μεσίτης. */
function contactsCheck() {
  _crm = null; _cidx = {};
  const crm = readCrm_();
  const out = ['CRM («' + CONFIG.SHEETS.CONTACTS + '»): ' + crm.length + ' επαφές'];
  if (!crm.length) out.push('  Δεν βρέθηκαν οι στήλες «Επαφή» και «Συνεργάτης» στις 5 πρώτες γραμμές.');
  const shared = crm.filter(c => c.partners.length > 1).length;
  readAgents_().forEach(a => {
    const x = agentIndex_(a.name).list;
    out.push('  ' + a.name + ': ' + x.filter(c => c.crm).length + ' από CRM, ' + x.filter(c => !c.crm).length + ' μόνο από κλήσεις');
  });
  out.push('  Κοινές (δεν εμφανίζονται): ' + shared);
  console.log(out.join('\n'));
}

/** Ό,τι στέλνεται στο κινητό. Τα κενά πεδία παραλείπονται, για μικρότερη λίστα. */
function contactPayload_(m) {
  const props = readProps_();
  const a = m.apps[0] || {};
  const first = m.apps.reduce((x, r) => (ts_(r.first) && (!x || ts_(r.first) < ts_(x)) ? r.first : x), '');
  const last = m.apps.reduce((x, r) => (ts_(r.last) > ts_(x) ? r.last : x), '');
  const out = {
    id: m.id, crm: m.crm, name: m.name || a.name || '', phones: m.phones, emails: m.emails,
    role: m.role, tags: m.tags, job: m.job, source: m.source, street: m.street, area: m.area,
    added: m.added ? fmtDate_(m.added) : '', inactive: !!m.inactive, notes: a.notes,
    first: stamp_(first), last: stamp_(last),
    codes: codesOf_(m).map(code => {
      const p = props[normCode_(code)];
      return { code: code, street: p ? p.street : '', status: p ? p.status : '' };
    })
  };
  Object.keys(out).forEach(k => {
    const v = out[k];
    if (v === '' || v == null || v === false || (Array.isArray(v) && !v.length)) delete out[k];
  });
  return out;
}

function myContact_(agent, id) {
  const c = agentIndex_(agent.name).list.find(x => x.id === String(id));
  if (!c) throw new Error('Δεν βρέθηκε η επαφή.');
  return c;
}

function actContacts_(agent) {
  return agentIndex_(agent.name).list.map(contactPayload_)
    .sort((a, b) => a.name.localeCompare(b.name, 'el'));
}

/**
 * Επαφή του CRM: αλλάζουν μόνο οι σημειώσεις (τα στοιχεία τα γράφει το επόμενο Excel).
 * Επαφή μόνο της εφαρμογής: όλα.
 */
function actContactSave_(agent, d) {
  const notes = String(d.notes || '').trim();
  const sh = ensureAppContactSheet_();
  const cols = contactCols_(sh);
  readContacts_();

  if (String(d.id || '').charAt(0) === 'K') {
    const m = myContact_(agent, d.id);
    let a = m.apps[0];
    if (!a) {
      a = { row: sh.getLastRow() + 1, id: newContactId_(), crmId: m.crmId, agent: agent.name, name: m.name,
            phone: m.phones[0] || '', email: m.emails[0] || '', codes: [], notes: '', first: '', last: '' };
      newAppRow_(sh, cols, a.row, a);
      _contacts.push(a);
    }
    a.notes = notes;
    sh.getRange(a.row, cols.NOTES).setValue(safe_(notes));
    _cidx = {};
    return contactPayload_(myContact_(agent, d.id));
  }

  const name = String(d.name || '').trim(), phone = phoneDigits_(d.phone);
  const email = String(d.email || '').trim();
  if (!name && !phone) throw new Error('Γράψε όνομα ή τηλέφωνο.');

  const own = d.id ? myContact_(agent, d.id) : null;
  if (own && own.crm) throw new Error('Δεν βρέθηκε η επαφή.');
  const same = (phone && findAgentContact_(agent.name, phone, '')) || (email && findAgentContact_(agent.name, '', email));
  if (same && (!own || same.id !== own.id)) throw new Error('Υπάρχει ήδη επαφή με αυτό το τηλέφωνο ή email: ' + (same.name || same.phones[0]));

  let a = own ? own.apps[0] : null;
  if (!a) {
    a = { row: sh.getLastRow() + 1, id: newContactId_(), crmId: '', agent: agent.name, codes: [], first: '', last: '' };
    newAppRow_(sh, cols, a.row, a);
    _contacts.push(a);
  }
  Object.assign(a, { name: name, phone: phone, email: email, notes: notes });
  sh.getRange(a.row, cols.NAME).setValue(safe_(name));
  sh.getRange(a.row, cols.PHONE).setValue(safe_(phone));
  sh.getRange(a.row, cols.EMAIL).setValue(safe_(email));
  sh.getRange(a.row, cols.NOTES).setValue(safe_(notes));
  _cidx = {};
  return contactPayload_(myContact_(agent, a.id));
}

/**
 * Τα email με μια επαφή, από το Gmail του λογαριασμού της εφαρμογής. Ο λογαριασμός
 * αυτός ανήκει σε έναν άνθρωπο, οπότε ανοίγει ΜΟΝΟ για εκείνον: αλλιώς ένας μεσίτης
 * θα διάβαζε ξένη αλληλογραφία. Δεν αποθηκεύεται τίποτα.
 */
function actContactMail_(agent, d) {
  const c = myContact_(agent, d.id);
  if (emailKey_(agent.email) !== ownerEmail_()) return { available: false, items: [] };

  const valid = /^[^\s"'()<>{}]+@[^\s"'()<>{}]+\.[a-z]{2,}$/;
  const emails = c.emails.filter(e => valid.test(e)).slice(0, 3);
  if (!emails.length) {
    if (c.emails.length) throw new Error('Το email της επαφής δεν είναι έγκυρο.');
    return { available: true, items: [] };
  }

  const lim = CONFIG.CONTACTS;
  const items = [];
  const has = text => emails.some(e => text.indexOf(e) !== -1);
  GmailApp.search(emails.map(e => 'from:' + e + ' OR to:' + e).join(' OR '), 0, lim.MAIL_THREADS).forEach(th => {
    th.getMessages().forEach(m => {
      const inbound = has(emailKey_(m.getFrom()));
      if (!inbound && !has(emailKey_(m.getTo() + ',' + m.getCc()))) return;
      items.push({
        ts: m.getDate().getTime(), date: stamp_(m.getDate()), subject: m.getSubject() || '(χωρίς θέμα)',
        inbound: inbound, url: th.getPermalink(),
        text: String(m.getPlainBody() || '').trim().slice(0, lim.MAIL_CHARS)
      });
    });
  });
  items.sort((a, b) => b.ts - a.ts);
  return { available: true, items: items.slice(0, lim.MAIL_MESSAGES) };
}

// ═════════════════════════════════════════════════════════════
//  ΠΡΩΙΝΕΣ ΕΙΔΟΠΟΙΗΣΕΙΣ (1.9)
// ═════════════════════════════════════════════════════════════

/** Trigger κάθε πρωί: πρώτα οι εντολές που λήγουν, μετά η σύνοψη της ημέρας. */
function morningBrief() {
  _agents = null;
  mandateReminder();
  if (CONFIG.MORNING.DAYS.indexOf(new Date().getDay()) === -1) return;

  const today = fmtIso_(new Date());
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  readAgents_().filter(isAgent_).forEach(agent => {
    const leads = myLeads_(agent);
    const status = s => leads.filter(l => statusOf_(l.id) === s).length;
    const showings = leads.filter(l => {
      const at = appGet_(l.id, ACOL.SHOW_AT);
      return statusOf_(l.id) === STATUS.SHOWING && at && ts_(at) && fmtIso_(at) === today;
    }).length;
    const tasks = tasksFor_(agent).filter(t => !t.done && t.date && t.date <= today).length;

    const parts = [];
    if (showings) parts.push(plural(showings, 'υπόδειξη', 'υποδείξεις'));
    if (status(STATUS.PENDING)) parts.push(plural(status(STATUS.PENDING), 'νέα κλήση', 'νέες κλήσεις'));
    if (status(STATUS.NO_ANSWER)) parts.push(plural(status(STATUS.NO_ANSWER), 'για follow-up', 'για follow-up'));
    if (tasks) parts.push(plural(tasks, 'εργασία', 'εργασίες'));
    if (!parts.length) return console.log(agent.name + ': τίποτα για σήμερα');

    const sent = pushToAgent_(agent, {
      type: 'today', id: 'go:today', tag: 'today', url: '?lead=go%3Atoday',
      title: 'Το πρόγραμμά σου σήμερα', body: parts.join(', ')
    });
    console.log(agent.name + ': ' + parts.join(', ') + ' → ' + sent + ' συσκευή/ές');
  });
}

/** Εντολές που λήγουν σε 30, 15, 7 ή 0 μέρες. Χωρίς ειδοποιήσεις: email. */
function mandateReminder() {
  const props = readProps_();
  readAgents_().filter(isAgent_).forEach(agent => {
    Object.keys(props).map(k => props[k])
      .filter(p => p.available && norm_(p.partner) === norm_(agent.name) &&
                   CONFIG.MANDATE_ALERT_DAYS.indexOf(p.mandateDays) !== -1)
      .forEach(p => {
        const name = p.street || p.code;
        const days = p.mandateDays;
        const body = name + ': ' + (days === 0 ? 'η εντολή λήγει σήμερα'
          : 'η εντολή λήγει σε ' + days + (days === 1 ? ' ημέρα' : ' ημέρες'));
        const go = 'go:prop:' + p.code;
        const sent = pushToAgent_(agent, {
          type: 'mandate', id: go, tag: 'mandate-' + p.code, url: '?lead=' + encodeURIComponent(go),
          title: 'Λήξη εντολής', body: body
        });
        if (!sent && agent.email) {
          MailApp.sendEmail({ to: agent.email, subject: 'Λήξη εντολής: ' + name, name: 'KW App', body: body });
        }
        console.log(agent.name + ': ' + body);
      });
  });
}

/** Trigger κάθε Δευτέρα: μόνο σε όσους δεν έστειλαν τη φόρμα της προηγούμενης εβδομάδας. */
function formReminder() {
  if (!metricsSpreadsheet_()) return console.log('Η φόρμα δεν έχει ρυθμιστεί.');
  _agents = null;

  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const start = new Date(monday.getTime() - 7 * 86400000);
  const end = new Date(monday.getTime() - 1);
  const week = dm_(start) + ' – ' + dm_(end);
  const records = readMetricRecords_().records;
  const form = (CONFIG.FORMS || []).filter(f => /μετρησιμ/i.test(norm_(f.title)))[0];

  readAgents_().filter(a => a.active && isAgent_(a)).forEach(agent => {
    const emails = formEmails_(agent);
    if (records.some(r => emails.indexOf(r.email) !== -1 && r.start <= end && r.end >= start)) return;

    const body = 'Δεν έχει σταλεί η φόρμα για ' + week + '. Πάτα για να τη συμπληρώσεις.';
    const sent = pushToAgent_(agent, {
      type: 'form', id: 'go:form', tag: 'form', url: '?lead=go%3Aform',
      title: 'Μετρησιμότητα εβδομάδας', body: body
    });
    if (!sent && agent.email) {
      MailApp.sendEmail({ to: agent.email, subject: 'Μετρησιμότητα εβδομάδας', name: 'KW App',
        body: 'Δεν έχει σταλεί η φόρμα για ' + week + '.' + (form ? '\n\n' + form.url : '') });
    }
    console.log(agent.name + ': δεν έστειλε για ' + week + ' → ' + (sent ? 'ειδοποίηση' : 'email'));
  });
}

// ═════════════════════════════════════════════════════════════
//  ΕΡΓΑΣΙΕΣ
// ═════════════════════════════════════════════════════════════
// Ζουν στο φύλλο «Εργασίες». Όσες έχουν ημερομηνία μπαίνουν και στο ημερολόγιο
// του μεσίτη (με ώρα → event με υπενθύμιση, χωρίς ώρα → ολοήμερο), με το
// χρώμα «Εργασία» από τις ρυθμίσεις του. Ολοκληρωμένη → φεύγει από το ημερολόγιο.

const TASK_HEADERS = ['ID', 'Μεσίτης', 'Τίτλος', 'Σημειώσεις', 'Ημερομηνία', 'Ώρα',
                      'Ολοκληρώθηκε', 'Event', 'Κλήση', 'Κωδικός', 'Δημιουργία', 'Ενημέρωση'];
const KCOL = { ID: 1, AGENT: 2, TITLE: 3, NOTES: 4, DATE: 5, TIME: 6, DONE: 7, EVENT: 8,
               LEAD: 9, CODE: 10, CREATED: 11, UPDATED: 12, WIDTH: 12 };

function readTasks_() {
  const sh = sheet_(CONFIG.SHEETS.TASKS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, KCOL.WIDTH).getValues().map((v, i) => {
    const date = v[KCOL.DATE - 1], time = v[KCOL.TIME - 1];
    return {
      row: i + 2,
      id: String(v[KCOL.ID - 1] || ''),
      agent: String(v[KCOL.AGENT - 1] || ''),
      title: String(v[KCOL.TITLE - 1] || ''),
      notes: String(v[KCOL.NOTES - 1] || ''),
      date: date instanceof Date ? fmtIso_(date) : String(date || ''),
      time: time instanceof Date ? Utilities.formatDate(time, TZ, 'HH:mm') : String(time || ''),
      done: v[KCOL.DONE - 1] || '',
      event: String(v[KCOL.EVENT - 1] || ''),
      lead: String(v[KCOL.LEAD - 1] || ''),
      code: String(v[KCOL.CODE - 1] || ''),
      created: v[KCOL.CREATED - 1] || new Date()
    };
  }).filter(t => t.id);
}

function serializeTask_(t) {
  const lead = t.lead ? readLeads_().find(l => l.id === t.lead) : null;
  return {
    id: t.id, title: t.title, notes: t.notes, date: t.date, time: t.time,
    done: stamp_(t.done), doneTs: ts_(t.done),
    lead: t.lead, leadName: lead ? lead.name || 'Χωρίς όνομα' : '',
    code: t.code, hasEvent: !!t.event
  };
}

function tasksFor_(agent) {
  const cutoff = Date.now() - CONFIG.TASK_DONE_DAYS * 86400000;
  return readTasks_()
    .filter(t => norm_(t.agent) === norm_(agent.name) && (!t.done || ts_(t.done) > cutoff))
    .map(serializeTask_);
}

function myTask_(agent, id) {
  const t = readTasks_().find(x => x.id === String(id));
  if (!t || norm_(t.agent) !== norm_(agent.name)) throw new Error('Δεν βρέθηκε η εργασία.');
  return t;
}

function writeTask_(t) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(CONFIG.SHEETS.TASKS);
    const row = t.row || sh.getLastRow() + 1;
    const v = [t.id, t.agent, t.title, t.notes, t.date, t.time, t.done, t.event,
               t.lead, t.code, t.created, new Date()];
    // Ημερομηνία και ώρα ως κείμενο: αλλιώς το Sheets τις μετατρέπει σε δικές του τιμές.
    sh.getRange(row, KCOL.DATE, 1, 2).setNumberFormat('@');
    sh.getRange(row, 1, 1, KCOL.WIDTH).setValues([safeRow_(v)]);
    t.row = row;
  } finally {
    lock.releaseLock();
  }
}

/** Σβήνει το παλιό event και φτιάχνει νέο, αν η εργασία έχει ημερομηνία και δεν έχει ολοκληρωθεί. */
function syncTaskEvent_(agent, t) {
  if (t.event) {
    const ev = eventByRef_(t.event);
    if (ev) { try { ev.deleteEvent(); } catch (e) { /* ήδη σβησμένο */ } }
    t.event = '';
  }
  t.invited = false;
  if (!t.date || t.done) return;

  const p = t.date.split('-').map(Number);
  const lead = t.lead ? readLeads_().find(l => l.id === t.lead) : null;
  const desc = [t.notes,
    lead ? 'Πελάτης: ' + (lead.name || '—') + ' · ' + (phoneIntl_(lead.phone) || '—') : '',
    t.code ? 'Ακίνητο: ' + t.code : '',
    'Άνοιγμα στην εφαρμογή: ' + CONFIG.APP_URL + (lead ? '?lead=' + encodeURIComponent(lead.id) : '')
  ].filter(String).join('\n\n');

  let r;
  if (t.time) {
    const h = t.time.split(':').map(Number);
    const start = new Date(p[0], p[1] - 1, p[2], h[0], h[1], 0, 0);
    const end = new Date(start.getTime() + CONFIG.TASK_DURATION_MIN * 60000);
    r = createEvent_(agent, 'Εργασία: ' + t.title, start, end, { description: desc }, 10, 'task', false);
  } else {
    r = createEvent_(agent, 'Εργασία: ' + t.title, new Date(p[0], p[1] - 1, p[2]), null,
                     { description: desc }, 0, 'task', true);
  }
  t.event = r.ref;
  t.invited = r.invited;
}

/** Νέα ή αλλαγή: { id?, title, notes, date 'yyyy-MM-dd', time 'HH:mm', lead, code }. */
function actTaskSave_(agent, d) {
  const title = String(d.title || '').trim().slice(0, 200);
  if (!title) throw new Error('Γράψε τίτλο εργασίας.');
  const date = String(d.date || '');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Μη έγκυρη ημερομηνία.');
  const time = date && /^\d{2}:\d{2}$/.test(String(d.time || '')) ? String(d.time) : '';

  const has = k => Object.prototype.hasOwnProperty.call(d, k);
  const t = d.id ? myTask_(agent, d.id)
    : { id: 'T' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), agent: agent.name,
        done: '', event: '', lead: '', code: '', created: new Date() };
  t.title = title;
  t.notes = String(d.notes || '').trim().slice(0, 2000);
  t.date = date;
  t.time = time;
  // Σύνδεση με κλήση / ακίνητο: αλλάζει μόνο αν σταλεί (η επεξεργασία δεν τη χάνει).
  if (has('lead')) t.lead = d.lead ? findMyLead_(agent, d.lead).id : '';
  if (has('code')) t.code = String(d.code || '').trim();

  try { syncTaskEvent_(agent, t); }
  catch (e) { console.warn('Εργασία στο ημερολόγιο: ' + e.message); t.event = ''; }
  writeTask_(t);

  const out = serializeTask_(t);
  out.invited = !!t.invited;
  return out;
}

function actTaskDone_(agent, d) {
  const t = myTask_(agent, d.id);
  t.done = d.done ? new Date() : '';
  try { syncTaskEvent_(agent, t); } catch (e) { t.event = ''; }
  writeTask_(t);
  return serializeTask_(t);
}

function actTaskDelete_(agent, d) {
  const t = myTask_(agent, d.id);
  if (t.event) {
    const ev = eventByRef_(t.event);
    if (ev) { try { ev.deleteEvent(); } catch (e) { /* ήδη σβησμένο */ } }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { sheet_(CONFIG.SHEETS.TASKS).deleteRow(myTask_(agent, d.id).row); }
  finally { lock.releaseLock(); }
  return { deleted: true, id: t.id };
}

// ═════════════════════════════════════════════════════════════
//  ΕΙΔΟΠΟΙΗΣΕΙΣ (Firebase Cloud Messaging — δωρεάν)
// ═════════════════════════════════════════════════════════════
// Το κλειδί του service account του Firebase μπαίνει στα Script properties
// ως FCM_SERVICE_ACCOUNT (ολόκληρο το JSON). Ποτέ μέσα στον κώδικα.
// Κάθε συσκευή που ενεργοποιεί ειδοποιήσεις γράφεται στο φύλλο «Συσκευές».

function fcmConfig_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa.client_email && sa.private_key && sa.project_id ? sa : null;
  } catch (e) {
    return null;
  }
}

/** OAuth token για το FCM, από JWT υπογεγραμμένο με το service account. Cache 50'. */
function fcmAccessToken_(sa) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm_token');
  if (hit) return hit;

  const b64 = obj => Utilities.base64EncodeWebSafe(
    Utilities.newBlob(JSON.stringify(obj)).getBytes()).replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const input = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  });
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(input, sa.private_key)).replace(/=+$/, '');

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + sig },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('FCM σύνδεση: ' + res.getContentText().slice(0, 200));
  }
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put('fcm_token', token, 3000);
  return token;
}

// ── Συσκευές ──────────────────────────────────────────────

function readDevices_() {
  const sh = getSS().getSheetByName(CONFIG.SHEETS.DEVICES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .map((v, i) => ({ row: i + 2, token: String(v[0] || ''), agent: String(v[1] || ''),
                      device: v[2], access: String(v[4] || '') }))
    .filter(d => d.token);
}

/** Μόνο συσκευές με ενεργή πρόσβαση: ανακλημένη συσκευή δεν παίρνει ειδοποιήσεις. */
function agentDevices_(agent) {
  if (!agent.active) return [];
  const live = {};
  readAccess_().forEach(r => { if (r.status === ACC.ACTIVE) live[r.id] = true; });
  return readDevices_().filter(d => norm_(d.agent) === norm_(agent.name) && live[d.access]);
}

function removeDevicesOf_(accessId) {
  const sh = getSS().getSheetByName(CONFIG.SHEETS.DEVICES);
  if (!sh) return;
  readDevices_().filter(d => d.access === accessId)
    .sort((a, b) => b.row - a.row).forEach(d => sh.deleteRow(d.row));
}

function actPushRegister_(agent, d, sess) {
  const token = String(d.token || '').trim();
  if (token.length < 20) throw new Error('Μη έγκυρο token ειδοποιήσεων.');
  const device = String(d.device || '').slice(0, 80);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(CONFIG.SHEETS.DEVICES);
    const hit = readDevices_().find(x => x.token === token);
    const row = safeRow_([token, agent.name, device, new Date(), sess ? sess.id : '']);
    if (hit) sh.getRange(hit.row, 1, 1, 5).setValues([row]);
    else sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return { ready: !!fcmConfig_(), devices: agentDevices_(agent).length };
}

function removeTokens_(tokens) {
  if (!tokens.length) return;
  const sh = sheet_(CONFIG.SHEETS.DEVICES);
  readDevices_().filter(d => tokens.indexOf(d.token) !== -1)
    .sort((a, b) => b.row - a.row)
    .forEach(d => sh.deleteRow(d.row));
}

/**
 * Στέλνει ειδοποίηση σε όλες τις συσκευές του μεσίτη. Επιστρέφει πόσες την πήραν.
 * data: { type, id, title, body, tag, url } — όλα κείμενο.
 * Συσκευές που η Google λέει ότι δεν υπάρχουν πια (απεγκατάσταση) σβήνονται.
 */
function pushToAgent_(agent, data) {
  const sa = fcmConfig_();
  if (!sa) return 0;
  const devices = agentDevices_(agent);
  if (!devices.length) return 0;

  const token = fcmAccessToken_(sa);
  const payload = {};
  Object.keys(data).forEach(k => { payload[k] = String(data[k] == null ? '' : data[k]); });

  const res = UrlFetchApp.fetchAll(devices.map(dv => ({
    url: 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send',
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
    payload: JSON.stringify({ message: {
      token: dv.token,
      data: payload,
      webpush: { headers: { Urgency: 'high', TTL: '86400' } }
    } })
  })));

  let sent = 0;
  const dead = [];
  res.forEach((r, i) => {
    const code = r.getResponseCode();
    if (code === 200) { sent++; return; }
    const text = r.getContentText();
    if (code === 404 || /UNREGISTERED/.test(text)) dead.push(devices[i].token);
    else console.warn('Push ' + agent.name + ': HTTP ' + code + ' ' + text.slice(0, 200));
  });
  removeTokens_(dead);
  return sent;
}

function actPushTest_(agent) {
  const sent = pushToAgent_(agent, {
    type: 'test', id: '', tag: 'test', url: './',
    title: 'KW App', body: 'Οι ειδοποιήσεις δουλεύουν ✓'
  });
  return { sent: sent, ready: !!fcmConfig_(), devices: agentDevices_(agent).length };
}

// ── Νέες κλήσεις ─────────────────────────────────────────
// Trigger ανά NEW_LEAD_CHECK_MIN λεπτά. Ελέγχει πρώτα ένα «αποτύπωμα» των
// μηνιαίων φύλλων (γραμμές + τελευταίο ID). Αν δεν άλλαξε τίποτα, σταματά
// αμέσως — έτσι ο έλεγχος ανά λεπτό κοστίζει ελάχιστο χρόνο εκτέλεσης.
// Κάθε κλήση που ειδοποιήθηκε (ή κρίθηκε ότι δεν χρειάζεται) γράφεται στο
// φύλλο «Ειδοποιήσεις», ώστε να μη σταλεί ποτέ δεύτερη φορά.

function checkNewLeads() {
  const cache = CacheService.getScriptCache();
  if (cache.get('checking')) return;                    // προηγούμενη εκτέλεση τρέχει ακόμα
  cache.put('checking', '1', 120);

  try {
    try { adminDigest_(); } catch (e) { console.warn('Ειδοποίηση Admin: ' + e.message); }   // 1.18
    const ss = getSS();
    const fp = monthNames_().map(n => {
      const sh = ss.getSheetByName(n);
      if (!sh) return n + ':-';
      const last = sh.getLastRow();
      return n + ':' + last + ':' + (last >= 2 ? sh.getRange(last, 1).getValue() : '');
    }).join('|');

    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('LEADS_FP') === fp) return;

    const notified = readNotified_();
    const fresh = readLeads_().filter(l => !notified[l.id]);
    if (fresh.length) {
      try { addLeadsToContacts_(fresh); }
      catch (err) { console.error('Επαφές: ' + err.message); }   // η ειδοποίηση μετράει περισσότερο
    }
    const baseline = !props.getProperty('NOTIFY_STARTED');

    if (fresh.length) {
      const maxAge = CONFIG.NEW_LEAD_MAX_AGE_HOURS * 3600000;
      const agents = readAgents_();
      const rows = fresh.map(l => {
        let result;
        if (baseline) result = 'υπήρχε πριν';
        else if (ts_(l.date) && Date.now() - ts_(l.date) > maxAge) result = 'παλιά κλήση';
        else {
          const owner = ownerOf_(l);
          const agent = owner && agents.find(a => norm_(a.name) === norm_(owner));
          if (!agent) result = 'όχι της ομάδας';
          else {
            try {
              const n = pushToAgent_(agent, leadPush_(l));
              result = n ? agent.name + ' · ' + n + (n === 1 ? ' συσκευή' : ' συσκευές')
                         : agent.name + ' · χωρίς ενεργές ειδοποιήσεις';
            } catch (err) {
              result = 'σφάλμα: ' + err.message;
            }
          }
        }
        return [l.id, new Date(), result];
      });
      const sh = sheet_(CONFIG.SHEETS.NOTIFIED);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
    }

    props.setProperties({ LEADS_FP: fp, NOTIFY_STARTED: '1' });
  } finally {
    cache.remove('checking');
  }
}

function readNotified_() {
  const sh = sheet_(CONFIG.SHEETS.NOTIFIED);
  const set = {};
  if (sh.getLastRow() < 2) return set;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(v => { if (v[0]) set[String(v[0])] = true; });
  return set;
}

/** Τι γράφει η ειδοποίηση νέας κλήσης. */
function leadPush_(l) {
  const p = readProps_()[normCode_(l.code)] || null;
  const where = (p && p.street) || l.location || (l.code ? 'Κωδ. ' + l.code : 'Ακίνητο');
  const repeat = /επαν/i.test(l.repeat) ? ' · επανάληψη' : '';
  return {
    type: 'lead', id: l.id, tag: 'lead-' + l.id,
    title: 'Νέα κλήση · ' + where,
    body: CONFIG.PUSH_SHOW_CLIENT
      ? [l.name || 'Χωρίς όνομα', l.source].filter(String).join(' · ') + repeat
      : [l.source, 'πάτα για λεπτομέρειες'].filter(String).join(' · ') + repeat,
    url: '?lead=' + encodeURIComponent(l.id)
  };
}

// ═════════════════════════════════════════════════════════════
//  ΜΕΤΡΗΣΙΜΟΤΗΤΑ (1.5) — η εβδομαδιαία φόρμα, ανά μήνα
// ═════════════════════════════════════════════════════════════
//
//  Πηγή: το workbook απαντήσεων της φόρμας «Μετρησιμότητα εβδομάδας».
//  Διαβάζονται ΚΑΙ οι δύο μορφές, σε όποια φύλλα υπάρχουν:
//   · «Form Responses»: μία γραμμή ανά υποβολή, επικεφαλίδες στη γραμμή 1.
//   · Αναστραμμένο φύλλο (π.χ. «Zades»): μία ΣΤΗΛΗ ανά υποβολή, οι
//     ερωτήσεις στη στήλη A.
//  Οι δείκτες βρίσκονται με το ΚΕΙΜΕΝΟ της ερώτησης (όχι με θέση), οπότε
//  αν προστεθεί ερώτηση στη φόρμα δεν χαλάει τίποτα.
//  Οι μηνιαίες στήλες του φύλλου (January…Total) ΔΕΝ χρησιμοποιούνται:
//  τα σύνολα υπολογίζονται εδώ από τις εβδομάδες.
//  Μόνο ανάγνωση — η εφαρμογή δεν γράφει ποτέ στο workbook της φόρμας.

/** Οι 16 δείκτες. match = η αρχή της ερώτησης στη φόρμα (χωρίς τόνους/κενά/σύμβολα). */
const METRIC_LIST = [
  { key: 'seller1',    group: 'owners', label: '1ο Ραντεβού με πωλητή', sub: 'δια ζώσης',
    match: '1ο Ραντεβού με πωλητή (δια ζώσης)' },
  { key: 'seller2',    group: 'owners', label: '2ο Ραντεβού με πωλητή', sub: 'Παρουσίαση Αποκλειστικότητας',
    match: '2ο Ραντεβού με πωλητή Παρουσίαση Αποκλειστικότητας' },
  { key: 'landlord1',  group: 'owners', label: '1ο Ραντεβού με εκμισθωτή', sub: 'δια ζώσης',
    match: '1ο Ραντεβού με εκμισθωτή' },
  { key: 'landlord2',  group: 'owners', label: '2ο Ραντεβού με εκμισθωτή', sub: 'Παρουσίαση Αποκλειστικότητας',
    match: '2ο Ραντεβού με εκμισθωτή Παρουσίαση Αποκλειστικότητας' },
  { key: 'buyer',      group: 'clients', label: '1ο Ραντεβού με αγοραστή', sub: 'δια ζώσης ή online',
    match: '1ο Ραντεβού με Αγοραστή (δια ζώσης' },
  { key: 'buyerPhone', group: 'clients', label: '1ο Ραντεβού με αγοραστή', sub: 'δια τηλεφώνου',
    match: '1ο Ραντεβού με Αγοραστή (δια τηλεφώνου' },
  { key: 'tenant',     group: 'clients', label: '1ο Ραντεβού με μισθωτή', sub: 'δια ζώσης',
    match: '1ο Ραντεβού με μισθωτή (δια ζώσης' },
  { key: 'tenantPhone', group: 'clients', label: '1ο Ραντεβού με μισθωτή', sub: 'δια τηλεφώνου',
    match: '1ο Ραντεβού με μισθωτή (δια τηλεφώνου' },
  { key: 'ilist',      group: 'clients', label: 'Ζητήσεις αγοραστών', sub: 'καταγεγραμμένες στο i-list',
    match: 'Καταγεγραμμένες Ζητήσεις Αγοραστών' },
  { key: 'showSale',   group: 'showings', label: 'Υπόδειξη πώλησης', sub: 'υπογεγραμμένη',
    match: 'Υπόδειξη πώλησης' },
  { key: 'showRent',   group: 'showings', label: 'Υπόδειξη ενοικίασης', sub: 'υπογεγραμμένη',
    match: 'Υπόδειξη ενοικίασης' },
  { key: 'exclSale',   group: 'mandates', label: 'Αποκλειστική ανάθεση πώλησης', sub: '',
    match: 'Αποκλειστική Ανάθεση πώλησης' },
  { key: 'simpleSale', group: 'mandates', label: 'Απλή ανάθεση πώλησης', sub: '',
    match: 'Απλή Ανάθεση πώλησης' },
  { key: 'exclRentHi', group: 'mandates', label: 'Αποκλειστική εντολή εκμίσθωσης', sub: 'πάνω από 1.000 €',
    match: 'Αποκλειστική Εντολή εκμίσθωσης (>1000)' },
  { key: 'exclRentLo', group: 'mandates', label: 'Αποκλειστική εντολή εκμίσθωσης', sub: 'έως και 1.000 €',
    match: 'Αποκλειστική Εντολή εκμίσθωσης (έως και 1000)' },
  { key: 'simpleRent', group: 'mandates', label: 'Απλή εντολή εκμίσθωσης', sub: '',
    match: 'Απλή Εντολή εκμίσθωσης' }
];

const METRIC_GROUPS = [
  { key: 'owners',   label: 'Ραντεβού με ιδιοκτήτες' },
  { key: 'clients',  label: 'Αγοραστές & μισθωτές' },
  { key: 'showings', label: 'Υποδείξεις' },
  { key: 'mandates', label: 'Αναθέσεις & εντολές' }
];

const MONTHS_EL = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

// Λατινικά που μοιάζουν με ελληνικά (π.χ. «Kαλλιέργεια» με λατινικό K): μετατρέπονται,
// ώστε η σύγκριση να μην αποτυγχάνει για ένα γράμμα που δεν φαίνεται.
const LOOKALIKE_ = { a: 'α', b: 'β', e: 'ε', h: 'η', i: 'ι', k: 'κ', m: 'μ', n: 'ν', o: 'ο',
                     p: 'ρ', t: 'τ', x: 'χ', y: 'υ', z: 'ζ' };

/** Κείμενο ερώτησης → σκέτα γράμματα/αριθμοί, για σύγκριση. */
function metricText_(s) {
  return norm_(String(s == null ? '' : s).replace(/[º°]/g, 'ο'))
    .replace(/απαιτειται εντυπο|υπογεγραμμενη/g, '')
    .replace(/[a-z]/g, c => LOOKALIKE_[c] || c)
    .replace(/ς/g, 'σ')
    .replace(/[^0-9α-ω]/g, '');
}

/** Επικεφαλίδες → { κλειδί δείκτη: θέση }. Κάθε επικεφαλίδα πάει στο μεγαλύτερο ταίριασμα. */
function metricColumns_(headers) {
  const defs = METRIC_LIST.map(m => ({ key: m.key, t: metricText_(m.match) }));
  const map = {};
  headers.forEach((h, i) => {
    const t = metricText_(h);
    if (!t) return;
    let best = null;
    defs.forEach(d => { if (t.indexOf(d.t) === 0 && (!best || d.t.length > best.t.length)) best = d; });
    if (best && map[best.key] == null) map[best.key] = i;
  });
  return map;
}

function metricsSpreadsheet_() {
  const raw = String((CONFIG.METRICS && CONFIG.METRICS.SPREADSHEET_ID) || '').trim();
  if (!raw || raw.indexOf('ΒΑΛΕ') !== -1) return null;
  // Δέχεται και ολόκληρο το link του φύλλου.
  const m = raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return SpreadsheetApp.openById(m ? m[1] : raw);
}

function metricNum_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v == null ? '' : v).replace(',', '.').trim());
  return isFinite(n) ? n : 0;          // '-', '#N/A', κενό → 0
}

/** Χρονική σημείωση της φόρμας: Date ή κείμενο «M/D/YYYY H:mm:ss». */
function metricTs_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  let mo = +m[1], d = +m[2];
  if (mo > 12) { const x = mo; mo = d; d = x; }    // ημ/μήνας αντί για μήνας/ημ
  return new Date(+m[3], mo - 1, d, +(m[4] || 0), +(m[5] || 0));
}

/** «12/01 - 18/01» → { start, end } (Date). Το έτος βγαίνει από την ώρα υποβολής. */
function metricWeek_(label, ts) {
  const m = String(label || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const ref = ts || new Date();
  let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : ref.getFullYear();
  let start = new Date(y, +m[2] - 1, +m[1]);
  // Εβδομάδα Δεκεμβρίου που υποβλήθηκε τον Ιανουάριο → προηγούμενο έτος.
  if (!m[3] && start - ref > 180 * 86400000) start = new Date(--y, +m[2] - 1, +m[1]);
  let end = new Date(y, +m[5] - 1, +m[4]);
  if (end < start) end = new Date(y + 1, +m[5] - 1, +m[4]);   // «28/12 - 03/01»
  if (isNaN(start) || isNaN(end) || +m[2] > 12 || +m[5] > 12) return null;
  return { start: start, end: end };
}

/** Βρίσκει θέση γραμμής/στήλης με βάση το κείμενο της επικεφαλίδας. */
function metricFind_(labels, test) {
  for (let i = 0; i < labels.length; i++) if (test(norm_(labels[i]))) return i;
  return -1;
}
const isTsLabel_    = t => t === 'timestamp' || t.indexOf('χρονικη σημανση') === 0;
const isEmailLabel_ = t => t === 'email address' || t === 'email' || t.indexOf('διευθυνση email') === 0;
const isWeekLabel_  = t => t.indexOf('εβδομαδ') !== -1 && t.length < 40;

/**
 * Όλες οι υποβολές από όλα τα φύλλα: [{ email, ts, start, end, label, values, sheet }].
 * Ίδιος μεσίτης + ίδια εβδομάδα δύο φορές (διόρθωση) → κρατιέται η πιο πρόσφατη.
 */
function readMetricRecords_() {
  const ss = metricsSpreadsheet_();
  if (!ss) return null;
  const only = (CONFIG.METRICS.SHEETS || []).map(norm_);
  const out = [], info = [];

  ss.getSheets().forEach(sh => {
    if (only.length && only.indexOf(norm_(sh.getName())) === -1) return;
    if (sh.getLastRow() < 2 || sh.getLastColumn() < 2) return;
    const v = sh.getDataRange().getValues();

    // Μορφή 1: επικεφαλίδες στη γραμμή 1 (Form Responses).
    // Μορφή 2: επικεφαλίδες στη στήλη A (αναστραμμένο).
    const row1 = v[0], colA = v.map(r => r[0]);
    let headers, get, n, rowsMode;
    if (metricFind_(row1, isEmailLabel_) !== -1 && metricFind_(row1, isWeekLabel_) !== -1) {
      rowsMode = true; headers = row1; n = v.length - 1;
      get = (k, j) => v[k + 1][j];
    } else if (metricFind_(colA, isEmailLabel_) !== -1 && metricFind_(colA, isWeekLabel_) !== -1) {
      rowsMode = false; headers = colA; n = row1.length - 1;
      get = (k, j) => v[j][k + 1];
    } else return;

    const cTs = metricFind_(headers, isTsLabel_);
    const cEmail = metricFind_(headers, isEmailLabel_);
    const cWeek = metricFind_(headers, isWeekLabel_);
    const cols = metricColumns_(headers);
    let count = 0;

    for (let k = 0; k < n; k++) {
      const email = String(get(k, cEmail) || '').trim().toLowerCase();
      if (email.indexOf('@') === -1) continue;            // κενή στήλη ή στήλη συνόλων
      const ts = cTs !== -1 ? metricTs_(get(k, cTs)) : null;
      const label = cellText_(get(k, cWeek));
      const w = metricWeek_(label, ts);
      if (!w) continue;
      const values = {};
      Object.keys(cols).forEach(key => { values[key] = metricNum_(get(k, cols[key])); });
      out.push({ email: email, ts: ts, start: w.start, end: w.end, label: label,
                 values: values, sheet: sh.getName(), order: out.length });
      count++;
    }
    info.push({ sheet: sh.getName(), mode: rowsMode ? 'γραμμές' : 'στήλες', records: count,
                missing: METRIC_LIST.filter(m => cols[m.key] == null).map(m => m.key) });
  });

  // Διπλές υποβολές: email + εβδομάδα. Η πιο πρόσφατη κερδίζει.
  const byKey = {};
  out.forEach(r => {
    const k = r.email + '|' + fmtIso_(r.start);
    const old = byKey[k];
    const newer = !old || (r.ts && old.ts ? r.ts >= old.ts : r.order > old.order);
    if (newer) byKey[k] = r;
  });
  const records = Object.keys(byKey).map(k => byKey[k]);
  return { records: records, info: info, duplicates: out.length - records.length };
}

/** Τα email με τα οποία συμπληρώνει τη φόρμα ο μεσίτης. */
function formEmails_(agent) {
  return (agent.formEmail || '').split(/[,;\s]+/).concat([agent.email])
    .map(s => s.trim().toLowerCase()).filter(s => s.indexOf('@') !== -1);
}

const ym_ = d => Utilities.formatDate(d, TZ, 'yyyy-MM');
const dm_ = d => Utilities.formatDate(d, TZ, 'dd/MM');

/**
 * Οι εβδομάδες που «έπρεπε» να υπάρχουν σε έναν μήνα, όπως τις δίνει η φόρμα:
 * Δευτέρα–Κυριακή, κομμένες στα όρια του μήνα — εκτός αν το κομμάτι είναι μία
 * μόνο μέρα, οπότε κολλάει στη διπλανή εβδομάδα (π.χ. «24/08 - 31/08», «26/10 - 01/11»).
 * Μόνο όσες έχουν τελειώσει.
 */
function expectedWeeks_(year, month, from, today) {
  const segs = [];
  const last = new Date(year, month + 1, 0).getDate();
  let s = null;
  for (let d = 1; d <= last; d++) {
    const day = new Date(year, month, d);
    if (d === 1 && day.getDay() === 0) continue;     // Κυριακή 1η: ανήκει στον προηγούμενο μήνα
    if (!s) s = day;
    if (day.getDay() === 0 || d === last) { segs.push({ start: s, end: day }); s = null; }
  }
  const n = segs.length;
  if (n > 1 && +segs[n - 1].start === +segs[n - 1].end) {     // Δευτέρα στο τέλος του μήνα
    segs[n - 2].end = segs.pop().end;
  }
  const next1 = new Date(year, month + 1, 1);
  if (next1.getDay() === 0 && segs.length) segs[segs.length - 1].end = next1;
  return segs.filter(w => w.end < today && w.end >= from);
}

function metricsFor_(agent) {
  if (!metricsSpreadsheet_()) {
    return { configured: false };
  }
  const data = readMetricRecords_();
  const emails = formEmails_(agent);
  const mine = data.records.filter(r => emails.indexOf(r.email) !== -1)
    .sort((a, b) => a.start - b.start);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const months = {};
  const month = d => {
    const k = ym_(d);
    if (!months[k]) {
      months[k] = { ym: k, label: MONTHS_EL[d.getMonth()] + ' ' + d.getFullYear(),
                    values: {}, weeks: [], missing: [] };
      METRIC_LIST.forEach(m => { months[k].values[m.key] = 0; });
    }
    return months[k];
  };

  mine.forEach(r => {
    const m = month(r.start);       // η εβδομάδα μετρά στον μήνα που ξεκινά
    METRIC_LIST.forEach(x => { m.values[x.key] += r.values[x.key] || 0; });
    m.weeks.push({ label: dm_(r.start) + ' – ' + dm_(r.end), values: r.values,
                   sent: r.ts ? stamp_(r.ts) : '' });
  });

  // Εβδομάδες που λείπουν: από την πρώτη υποβολή μέχρι σήμερα.
  if (mine.length) {
    const from = mine[0].start;
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= today;
         d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const m = month(d);
      expectedWeeks_(d.getFullYear(), d.getMonth(), from, today).forEach(w => {
        const covered = mine.some(r => r.start <= w.end && r.end >= w.start);
        if (!covered) m.missing.push(dm_(w.start) + ' – ' + dm_(w.end));
      });
    }
  }

  const list = Object.keys(months).sort().reverse().map(k => months[k]);
  const last = mine.reduce((a, r) => (r.ts && (!a || r.ts > a) ? r.ts : a), null);
  const form = (CONFIG.FORMS || []).filter(f => /μετρησιμ/i.test(norm_(f.title)))[0];

  return {
    configured: true,
    metrics: METRIC_LIST.map(m => ({ key: m.key, group: m.group, label: m.label, sub: m.sub })),
    groups: METRIC_GROUPS,
    months: list,
    emails: emails,
    lastSent: last ? stamp_(last) : '',
    formUrl: form ? form.url : '',
    updated: stamp_(now)
  };
}

/** Από την εφαρμογή. 10' cache ανά μεσίτη· «↻» = φρέσκια ανάγνωση. */
function actMetrics_(agent, d) {
  const cache = CacheService.getScriptCache();
  const key = 'mx:' + sha256_(agent.name + '|' + agent.email).slice(0, 24);
  if (!d.refresh) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const res = metricsFor_(agent);
  try {
    cache.put(key, JSON.stringify(res), 60 * (CONFIG.METRICS.CACHE_MIN || 10));
  } catch (e) { /* μεγάλο για cache: απλώς δεν κρατιέται */ }
  return res;
}

/**
 * Από τον editor: τι βρίσκει ο κώδικας στο workbook της φόρμας.
 * Δείχνει φύλλα, υποβολές ανά μεσίτη, δείκτες που δεν βρέθηκαν και
 * email της φόρμας που δεν αντιστοιχούν σε κανέναν μεσίτη.
 */
function metricsCheck() {
  const ss = metricsSpreadsheet_();
  if (!ss) return console.log('Δεν έχει οριστεί το CONFIG.METRICS.SPREADSHEET_ID.');
  const data = readMetricRecords_();
  const lines = ['Workbook: ' + ss.getName(), ''];

  if (!data.info.length) lines.push('Δεν βρέθηκε φύλλο με «Email Address» και «Επιλογή εβδομάδας».');
  data.info.forEach(i => {
    lines.push('Φύλλο «' + i.sheet + '» (υποβολές σε ' + i.mode + '): ' + i.records + ' υποβολές');
    if (i.missing.length) lines.push('   ⚠ Δεν βρέθηκαν οι δείκτες: ' + i.missing.join(', '));
  });
  if (data.duplicates) lines.push('Διπλές υποβολές (κρατήθηκε η πιο πρόσφατη): ' + data.duplicates);

  lines.push('');
  _agents = null;
  const mapped = {};
  readAgents_().forEach(a => {
    const em = formEmails_(a);
    em.forEach(e => { mapped[e] = true; });
    const n = data.records.filter(r => em.indexOf(r.email) !== -1).length;
    lines.push(a.name + ' [' + em.join(', ') + ']: ' + n + ' εβδομάδες' +
               (n ? '' : '  ← συμπλήρωσε τη στήλη «' + AGENT_HEADERS.FORM_EMAIL + '» στο Agents'));
  });

  const orphan = {};
  data.records.forEach(r => { if (!mapped[r.email]) orphan[r.email] = (orphan[r.email] || 0) + 1; });
  const o = Object.keys(orphan);
  if (o.length) {
    lines.push('', 'Email στη φόρμα χωρίς μεσίτη στο Agents:');
    o.forEach(e => lines.push('   ' + e + ' (' + orphan[e] + ' εβδομάδες)'));
  }
  console.log(lines.join('\n'));
}

// ═════════════════════════════════════════════════════════════
//  ΕΓΚΑΤΑΣΤΑΣΗ — τρέχουν από τον editor
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
//  ΕΝΤΥΠΟ ΥΠΟΔΕΙΞΗΣ (1.14)
// ═════════════════════════════════════════════════════════════
// Ροή:
//   1. Ο μεσίτης (μέσα στην υπόδειξη) γράφει τα ελαττώματα και πατά «Αποστολή φόρμας».
//      Φτιάχνεται link μίας χρήσης: APP_URL + 'form.html#' + κλειδί (192 bit).
//      Το κλειδί είναι στο # → δεν φτάνει ποτέ σε server (ούτε στο GitHub, ούτε σε Referer).
//      Στο φύλλο «Έντυπα υπόδειξης» γράφεται ΜΟΝΟ το SHA-256 του.
//   2. Ο πελάτης ανοίγει το link, βλέπει τα στοιχεία του ακινήτου (μόνο ανάγνωση),
//      συμπληρώνει τα δικά του και υπογράφει στην οθόνη ή διαλέγει εκτύπωση.
//   3. Ο server ελέγχει τα πεδία, αντιγράφει το πρότυπο, γεμίζει τα {{ΠΕΔΙΑ}}, βγάζει PDF
//      στο «<ακίνητο>/Υποδείξεις», σβήνει ΟΡΙΣΤΙΚΑ το προσωρινό Doc και κλειδώνει το link.
//   4. Τα στοιχεία του πελάτη υπάρχουν μόνο μέσα στο PDF. Όχι σε φύλλο, όχι σε log,
//      όχι σε ειδοποίηση. Ο πελάτης παίρνει αντίγραφο στο email του (SEND_COPY).

const SF_HEADERS = ['ID', 'Κλειδί (hash)', 'Κλήση', 'Μεσίτης', 'Κωδικός', 'Ακίνητο', 'Ελαττώματα',
                    'Δημιουργία', 'Λήξη', 'Κατάσταση', 'Ανοίγματα', 'Υποβολή', 'Τρόπος', 'Αρχείο',
                    'Έλεγχος', 'Α/Α', 'Συσκευή', 'ΑΦΜ ελέγχθηκε'];
const SFC = { ID: 1, HASH: 2, LEAD: 3, AGENT: 4, CODE: 5, PROP: 6, DEFECTS: 7, CREATED: 8, EXPIRES: 9,
              STATUS: 10, OPENS: 11, SUBMITTED: 12, MODE: 13, FILE: 14, CHECK: 15, AA: 16, DEVICE: 17, AFM_OK: 18 };
const SF = { SENT: 'Στάλθηκε', SIGNED: 'Υπογράφηκε', PRINT: 'Για εκτύπωση', EXPIRED: 'Έληξε', CANCELLED: 'Ακυρώθηκε' };

/** Τα πεδία του προτύπου. Στο Google Doc γράφονται ως {{ΟΝΟΜΑ}}. */
const SF_KEYS = ['ΑΑ', 'ΗΜΕΡΑ', 'ΜΗΝΑΣ', 'ΕΤΟΣ',
  'ΟΝΟΜΑΤΕΠΩΝΥΜΟ', 'ΠΑΤΡΩΝΥΜΟ', 'ΚΑΤΟΙΚΟΣ', 'ΟΔΟΣ', 'ΑΡΙΘΜΟΣ', 'ΕΠΑΓΓΕΛΜΑ', 'ΑΔΤ', 'ΑΦΜ', 'ΔΟΥ', 'ΤΗΛ', 'EMAIL',
  'ΓΙΑ_ΛΟΓΑΡΙΑΣΜΟ', 'ΙΔΙΟΤΗΤΑ',
  'ΚΩΔΙΚΟΣ', 'ΔΙΕΥΘΥΝΣΗ', 'ΕΙΔΟΣ', 'ΤΜ', 'ΤΙΜΗ', 'ΑΜΟΙΒΗ',
  'ΠΟΣΟΣΤΟ_ΛΕΞΗ', 'ΠΟΣΟΣΤΟ', 'ΜΙΣΘΩΜΑ', 'ΜΙΣΘΩΜΑ_ΦΠΑ',
  'ΕΛΑΤΤΩΜΑΤΑ', 'ΥΠΟΓΡΑΦΗ', 'ΥΠΟΓΡΑΦΩΝ', 'ΕΛΕΓΧΟΣ'];

// ── Φύλλο ───────────────────────────────────────────────────

function sfSheet_() { return ensureSheet_(CONFIG.SHEETS.SHOWFORM, SF_HEADERS); }

function sfRows_() {
  const sh = sfSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SF_HEADERS.length).getValues()
    .map((v, i) => ({ row: i + 2, v: v }))
    .filter(r => r.v[SFC.ID - 1]);
}

function sfGet_(r, col) { return r.v[col - 1]; }

function sfSet_(r, values) {
  SF_LEAD_MAP_ = null;
  const sh = sfSheet_();
  Object.keys(values).forEach(col => {
    r.v[col - 1] = values[col];
    sh.getRange(r.row, Number(col)).setValue(safe_(values[col]));
  });
}

/** Η κατάσταση, με τη λήξη υπολογισμένη τώρα. */
function sfStatus_(r) {
  const st = String(sfGet_(r, SFC.STATUS) || '');
  if (st === SF.SENT && ts_(sfGet_(r, SFC.EXPIRES)) < Date.now()) return SF.EXPIRED;
  return st;
}

function sfLatest_(leadId) {
  const rows = sfRows_().filter(r => String(sfGet_(r, SFC.LEAD)) === String(leadId));
  return rows.length ? rows[rows.length - 1] : null;
}

/**
 * 1.16 · Κατάσταση του τελευταίου εντύπου υπόδειξης ανά κλήση, για τη λίστα
 * (Σήμερα → «Θέλουν προσοχή»). Το φύλλο διαβάζεται μία φορά ανά εκτέλεση.
 */
let SF_LEAD_MAP_ = null;
function sfLeadStatus_(leadId) {
  if (!SF_LEAD_MAP_) {
    SF_LEAD_MAP_ = {};
    try {
      sfRows_().forEach(r => { SF_LEAD_MAP_[String(sfGet_(r, SFC.LEAD))] = sfStatus_(r); });
    } catch (e) { console.warn('Έντυπα υπόδειξης: ' + e.message); }
  }
  return SF_LEAD_MAP_[String(leadId)] || '';
}

function sfByToken_(token) {
  const t = String(token || '');
  if (!/^[0-9a-f]{48}$/.test(t)) return null;
  const h = sha256_(t);
  return sfRows_().find(r => sfGet_(r, SFC.HASH) === h) || null;
}

// ── Βοηθητικά ───────────────────────────────────────────────

/** 250000 · '250.000' · '250.000,50 €' → αριθμός. Άκυρο → 0. */
function parseNum_(v) {
  if (typeof v === 'number') return v;
  let s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/** 1240 → '1.240,00' (ελληνική μορφή). */
function fmtNum_(n, dec) {
  const d = dec == null ? 2 : dec;
  const parts = Number(n).toFixed(d).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + parts[1] : '');
}

function fmtEur_(n) { return n ? fmtNum_(n, n % 1 ? 2 : 0) + ' €' : ''; }

/** Ό,τι στέλνει η φόρμα, χωρίς χαρακτήρες ελέγχου, μονά κενά, με όριο μήκους. */
function sfText_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\{\{|\}\}/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

/** Σφάλμα πεδίου: ΠΟΤΕ με την τιμή μέσα, ώστε να μη γραφτεί σε log. */
function sfFail_(field, msg) { return err_(msg, 'field:' + field); }

/** Έλεγχος ΑΦΜ (αλγόριθμος ΓΓΠΣ: 8 ψηφία × δυνάμεις του 2, mod 11, mod 10). */
function validAfm_(afm) {
  if (!/^\d{9}$/.test(afm) || /^0+$/.test(afm)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(afm[i]) * Math.pow(2, 8 - i);
  return (sum % 11) % 10 === Number(afm[8]);
}

/** Τα ακίνητα της υπόδειξης, όπως τα επιβεβαίωσε ο μεσίτης. */
function sfProp_(r) {
  try { return JSON.parse(String(sfGet_(r, SFC.PROP) || '{}')); } catch (e) { return {}; }
}

/** Αμοιβή και όροι 2α / 2β, ανάλογα με τη συναλλαγή. */
function sfFee_(prop) {
  const c = CONFIG.SHOWING_FORM;
  if (prop.deal === 'Ενοικίαση') {
    return { fee: c.FEE_RENT, pctWord: '—', pct: '—',
             rent: prop.price ? fmtEur_(prop.price) : '—',
             rentVat: prop.price ? fmtNum_(prop.price * (1 + c.VAT / 100)) : '—' };
  }
  return { fee: c.FEE_SALE, pctWord: c.SALE_PCT_WORD, pct: String(c.SALE_PCT), rent: '—', rentVat: '—' };
}

function sfAgent_(name) {
  const a = readAgents_().find(x => norm_(x.name) === norm_(name));
  if (!a) throw new Error('Ο μεσίτης της φόρμας δεν βρέθηκε.');
  return a;
}

function sfFileUrl_(id) { return id ? 'https://drive.google.com/file/d/' + id + '/view' : ''; }

/** Ό,τι βλέπει ο μεσίτης για τη φόρμα μιας κλήσης. */
function sfView_(r) {
  if (!r) return { status: '' };
  const prop = sfProp_(r);
  return {
    status: sfStatus_(r),
    created: stamp_(sfGet_(r, SFC.CREATED)),
    expires: stamp_(sfGet_(r, SFC.EXPIRES)),
    submitted: stamp_(sfGet_(r, SFC.SUBMITTED)),
    mode: String(sfGet_(r, SFC.MODE) || ''),
    aa: String(sfGet_(r, SFC.AA) || ''),
    opens: Number(sfGet_(r, SFC.OPENS)) || 0,
    fileUrl: sfFileUrl_(String(sfGet_(r, SFC.FILE) || '')),
    defects: String(sfGet_(r, SFC.DEFECTS) || ''),
    deal: prop.deal || ''
  };
}

// ── Ενέργειες μεσίτη (με σύνδεση) ─────────────────────────

/** Τι θα δει ο πελάτης για το ακίνητο: από το «Διαθέσιμα ακίνητα», όπως είναι τώρα. */
function sfPropFor_(l, deal) {
  const p = readProps_()[normCode_(l.code)] || {};
  return {
    code: p.code || l.code || '',
    address: [p.street, p.area].filter(String).join(', ') || l.location || '',
    type: p.type || l.type || '',
    sqm: p.sqm || l.sqm || '',
    price: parseNum_(p.price != null && p.price !== '' ? p.price : l.price),
    deal: dealOf_(deal) || p.deal || dealOf_(l.deal) || ''
  };
}

/**
 * Νέο link για τον πελάτη: { id (κλήση), defects, deal }.
 * Το παλιό link της ίδιας κλήσης (αν δεν έχει υποβληθεί) ακυρώνεται.
 * Το κλειδί επιστρέφεται ΜΟΝΟ τώρα. Αν χαθεί, φτιάχνεται νέο.
 */
function actFormCreate_(agent, d) {
  const l = findMyLead_(agent, d.id);
  if (!appGet_(l.id, ACOL.SHOW_AT)) throw new Error('Κλείσε πρώτα την υπόδειξη.');
  if (!CONFIG.SHOWING_FORM.TEMPLATE_ID) {
    throw new Error('Δεν έχει οριστεί το πρότυπο του εντύπου (CONFIG.SHOWING_FORM.TEMPLATE_ID).');
  }
  const prop = sfPropFor_(l, d.deal);
  if (!prop.deal) throw err_('Διάλεξε αν είναι Πώληση ή Ενοικίαση.', 'deal');
  prop.showAt = appGet_(l.id, ACOL.SHOW_AT) ? new Date(appGet_(l.id, ACOL.SHOW_AT)).toISOString() : '';
  const defects = sfText_(d.defects, 600);

  const token = randomHex_(48);
  const now = new Date();
  const expires = new Date(now.getTime() + CONFIG.SHOWING_FORM.EXPIRE_HOURS * 3600000);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sfRows_().filter(r => String(sfGet_(r, SFC.LEAD)) === l.id && sfStatus_(r) === SF.SENT)
      .forEach(r => sfSet_(r, { [SFC.STATUS]: SF.CANCELLED }));
    const row = ['SF-' + randomHex_(10), sha256_(token), l.id, agent.name, prop.code, JSON.stringify(prop),
                 defects, now, expires, SF.SENT, 0, '', '', '', '', '', '', ''];
    sfSheet_().appendRow(safeRow_(row));
    SF_LEAD_MAP_ = null;
  } finally {
    lock.releaseLock();
  }
  log_('Έντυπο υπόδειξης: link', agent.name, 'κλήση ' + l.id + ' · ' + prop.code);

  const url = CONFIG.APP_URL + 'form.html#' + token;
  const first = String(l.name || '').split(' ')[0];
  const me = agent.smsName || agent.name;
  return {
    form: sfView_(sfLatest_(l.id)),
    url: url,
    sms: 'Καλησπέρα' + (first ? ' ' + first : '') + ', για την υπόδειξη του ακινήτου ' +
         (prop.address || prop.code) + ' συμπληρώστε το έντυπο εδώ: ' + url +
         ' Ισχύει ' + CONFIG.SHOWING_FORM.EXPIRE_HOURS / 24 + ' ημέρες. ' + me,
    email: { to: l.email || '', subject: 'Έντυπο υπόδειξης ακινήτου · ' + CONFIG.OFFICE.name,
             body: 'Καλησπέρα' + (l.name ? ' ' + l.name : '') + ',\n\nγια την υπόδειξη του ακινήτου ' +
                   (prop.address || prop.code) + ' παρακαλώ συμπληρώστε το έντυπο:\n' + url +
                   '\n\nΤο link ισχύει έως ' + stamp_(expires) + ' και χρησιμοποιείται μία φορά.\n\n' + me +
                   '\n' + CONFIG.OFFICE.name }
  };
}

function actFormStatus_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const view = sfView_(sfLatest_(l.id));
  view.prop = sfPropFor_(l, '');
  view.ready = !!CONFIG.SHOWING_FORM.TEMPLATE_ID;
  return view;
}

function actFormCancel_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const r = sfLatest_(l.id);
  if (r && sfStatus_(r) === SF.SENT) sfSet_(r, { [SFC.STATUS]: SF.CANCELLED });
  return sfView_(sfLatest_(l.id));
}

// ── Ενέργειες πελάτη (χωρίς σύνδεση, μόνο με το κλειδί του link) ─

/** Φρένο σε όποιον δοκιμάζει τυχαία κλειδιά: 40 λάθος σε 15' → κλείνει για όλους για 15'. */
function sfGuard_() {
  const n = Number(CacheService.getScriptCache().get('sf:bad') || 0);
  if (n >= 40) throw new Error('Πολλές λάθος προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.');
}
function sfBad_() {
  const c = CacheService.getScriptCache();
  c.put('sf:bad', String(Number(c.get('sf:bad') || 0) + 1), 900);
}

/** Το link, αν ισχύει. Αλλιώς σφάλμα με ήπιο μήνυμα για τον πελάτη. */
function sfOpenRow_(token) {
  sfGuard_();
  const r = sfByToken_(token);
  if (!r) { sfBad_(); throw err_('Το link δεν είναι έγκυρο. Ζητήστε νέο από τον μεσίτη σας.', 'closed'); }
  const st = sfStatus_(r);
  if (st === SF.SIGNED || st === SF.PRINT) throw err_('Το έντυπο έχει ήδη υποβληθεί. Ευχαριστούμε!', 'done');
  if (st === SF.EXPIRED) throw err_('Το link έληξε. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  if (st !== SF.SENT) throw err_('Το link δεν ισχύει πια. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  if ((Number(sfGet_(r, SFC.OPENS)) || 0) >= CONFIG.SHOWING_FORM.MAX_OPENS) {
    throw err_('Το link άνοιξε πάρα πολλές φορές και κλείδωσε. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  }
  return r;
}

/** Ο πελάτης ανοίγει τη φόρμα. Βλέπει ΜΟΝΟ στοιχεία ακινήτου και γραφείου, τίποτα προσωπικό. */
function actFormOpen_(d) {
  const r = sfOpenRow_(d.f);
  sfSet_(r, { [SFC.OPENS]: (Number(sfGet_(r, SFC.OPENS)) || 0) + 1 });
  const prop = sfProp_(r);
  const fee = sfFee_(prop);
  let agentName = String(sfGet_(r, SFC.AGENT) || '');
  try { const a = sfAgent_(agentName); agentName = a.smsName || a.name; } catch (e) { /* όνομα από το φύλλο */ }
  return {
    office: CONFIG.OFFICE.name,
    agent: agentName,
    city: CONFIG.SHOWING_FORM.CITY,
    prop: { code: prop.code, address: prop.address, type: prop.type, sqm: prop.sqm,
            price: fmtEur_(prop.price), deal: prop.deal },
    fee: fee.fee,
    rentVat: fee.rentVat,
    defects: String(sfGet_(r, SFC.DEFECTS) || ''),
    expires: stamp_(sfGet_(r, SFC.EXPIRES)),
    copy: !!CONFIG.SHOWING_FORM.SEND_COPY
  };
}

/** Έλεγχος και καθαρισμός των στοιχείων του πελάτη. Σφάλμα = ποιο πεδίο, ποτέ η τιμή. */
function sfClean_(c) {
  c = c || {};
  const t = (k, max) => sfText_(c[k], max);
  const out = {
    name: t('name', 120), father: t('father', 60), city: t('city', 60), street: t('street', 80),
    number: t('number', 12), job: t('job', 60), adt: t('adt', 20).toUpperCase(), afm: t('afm', 24).replace(/\s/g, ''),
    doy: t('doy', 60), phone: t('phone', 20), email: t('email', 120).toLowerCase(),
    company: c.onBehalf ? t('company', 120) : '', capacity: c.onBehalf ? t('capacity', 80) : ''
  };
  const req = { name: 'Ονοματεπώνυμο', father: 'Πατρώνυμο', city: 'Κάτοικος', street: 'Οδός', number: 'Αριθμός',
                job: 'Επάγγελμα', adt: 'Α.Δ.Τ.', afm: 'ΑΦΜ', doy: 'ΔΟΥ', phone: 'Τηλέφωνο', email: 'Email' };
  Object.keys(req).forEach(k => { if (!out[k]) throw sfFail_(k, 'Συμπληρώστε: ' + req[k] + '.'); });

  if (out.name.split(' ').length < 2) throw sfFail_('name', 'Γράψτε όνομα και επώνυμο.');
  if (!/^[A-ZΑ-Ω0-9 \-]{5,20}$/.test(out.adt.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    throw sfFail_('adt', 'Ο αριθμός ταυτότητας ή διαβατηρίου δεν φαίνεται σωστός.');
  }
  // 1.14.3: το ψηφίο ελέγχου δεν μπλοκάρει. Αν δεν περνά, ο πελάτης το επιβεβαιώνει
  // («Ο ΑΦΜ μου είναι σωστός») και ο μεσίτης ειδοποιείται να τον ελέγξει.
  out.afm = out.afm.replace(/^(EL|GR|ΕΛ)/i, '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(out.afm)) throw sfFail_('afm', 'Ο ΑΦΜ έχει 9 ψηφία.');
  out.afmChecked = validAfm_(out.afm);
  if (!out.afmChecked && c.afmOk !== true) {
    throw sfFail_('afmOk', 'Ο ΑΦΜ δεν περνά τον αυτόματο έλεγχο. Ελέγξτε τα ψηφία, ή τσεκάρετε «Ο ΑΦΜ μου είναι σωστός».');
  }
  const ph = phoneDigits_(out.phone);
  if (ph.length < 10 || ph.length > 15) throw sfFail_('phone', 'Το τηλέφωνο δεν φαίνεται σωστό.');
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(out.email)) throw sfFail_('email', 'Το email δεν φαίνεται σωστό.');
  if (c.onBehalf && !out.company) throw sfFail_('company', 'Γράψτε για λογαριασμό ποιου συμβάλλεστε.');
  if (c.onBehalf && !out.capacity) throw sfFail_('capacity', 'Γράψτε την ιδιότητά σας (π.χ. νόμιμος εκπρόσωπος).');
  return out;
}

/** Η υπογραφή: PNG από τον καμβά, έως 300 KB. */
function sfSignature_(b64) {
  const data = String(b64 || '').replace(/^data:image\/png;base64,/, '');
  if (!data || data.length > 400000) throw sfFail_('sig', 'Υπογράψτε στο πλαίσιο.');
  const bytes = Utilities.base64Decode(data);
  if (sniffType_(bytes) !== 'image/png' || bytes.length < 800) throw sfFail_('sig', 'Υπογράψτε στο πλαίσιο.');
  return Utilities.newBlob(bytes, 'image/png', 'υπογραφή.png');
}

function sfDevice_(ua) {
  const u = String(ua || '');
  const os = /iPhone|iPad/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' :
             /Mac OS/.test(u) ? 'macOS' : 'Άλλη';
  const br = /CriOS|Chrome\//.test(u) ? 'Chrome' : /Firefox|FxiOS/.test(u) ? 'Firefox' :
             /Safari\//.test(u) ? 'Safari' : 'browser';
  return os + ' · ' + br;
}

/**
 * Ο πελάτης υποβάλλει: { f, c (στοιχεία), mode: 'sign'|'print', sig (PNG base64), consent, ua }.
 * Σφάλμα στα πεδία δεν καίει το link. Επιτυχία το κλειδώνει.
 */
function actFormSubmit_(d) {
  sfGuard_();
  const tries = CacheService.getScriptCache();
  const key = 'sf:try:' + sha256_(String(d.f || '')).slice(0, 20);
  const n = Number(tries.get(key) || 0);
  if (n >= 10) throw new Error('Πολλές προσπάθειες. Δοκιμάστε ξανά σε μία ώρα.');
  tries.put(key, String(n + 1), 3600);

  if (d.consent !== true) throw sfFail_('consent', 'Χρειάζεται η αποδοχή για τα προσωπικά δεδομένα.');
  const mode = d.mode === 'print' ? 'print' : 'sign';
  const client = sfClean_(d.c);
  const sig = mode === 'sign' ? sfSignature_(d.sig) : null;

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let r, agent, pdf, aa, check;
  try {
    r = sfOpenRow_(d.f);                       // ξανά, μέσα στο κλείδωμα: όχι διπλή υποβολή
    agent = sfAgent_(sfGet_(r, SFC.AGENT));
    const prop = sfProp_(r);
    const now = new Date();
    aa = sfNextAa_(now);
    const showAt = appGet_(String(sfGet_(r, SFC.LEAD)), ACOL.SHOW_AT) || prop.showAt || '';
    const values = sfValues_(client, prop, String(sfGet_(r, SFC.DEFECTS) || ''), now, aa, showAt);
    check = sha256_(JSON.stringify(values) + (d.sig || ''));
    values['ΕΛΕΓΧΟΣ'] = (mode === 'sign'
      ? 'Υπογράφηκε ηλεκτρονικά στην οθόνη από τον Εντολέα στις '
      : 'Συμπληρώθηκε ηλεκτρονικά από τον Εντολέα στις ') + stamp_(now) +
      ' · Α/Α ' + aa + ' · κωδικός ελέγχου ' + check.slice(0, 16).replace(/(.{4})(?!$)/g, '$1-') +
      (mode === 'print' ? ' · υπογράφεται ιδιοχείρως' : '');

    const folder = sfFolder_(agent, prop.code);
    pdf = sfBuildPdf_(values, sig, folder,
      'Υπόδειξη ' + aa.replace('/', '-') + ' - ' + client.name.replace(/[\/\\:*?"<>|]/g, ' ') + '.pdf');

    sfSet_(r, {
      [SFC.STATUS]: mode === 'sign' ? SF.SIGNED : SF.PRINT,
      [SFC.SUBMITTED]: now, [SFC.MODE]: mode === 'sign' ? 'Οθόνη' : 'Εκτύπωση',
      [SFC.FILE]: pdf.getId(), [SFC.CHECK]: check, [SFC.AA]: aa, [SFC.DEVICE]: sfDevice_(d.ua),
      [SFC.AFM_OK]: client.afmChecked ? 'Ναι' : 'Όχι, το επιβεβαίωσε ο πελάτης'
    });
  } finally {
    lock.releaseLock();
  }
  // 1.17: μόνο το υπογεγραμμένο στην οθόνη πάει για έλεγχο. Το «σε χαρτί» ελέγχεται όταν
  // ανέβει σκαναρισμένο στην Τιμολόγηση.
  if (mode === 'sign') {
    rvAddSafe_({ fileId: pdf.getId(), code: sfProp_(r).code, agent: agent.name, kind: 'showform',
                 slot: String(sfGet_(r, SFC.LEAD)), title: 'Υπόδειξη ' + aa, lead: String(sfGet_(r, SFC.LEAD)) });
  }
  const afmNote = client.afmChecked ? '' : ' · έλεγξε τον ΑΦΜ';
  log_('Έντυπο υπόδειξης: υποβλήθηκε', agent.name, 'Α/Α ' + aa + ' · ' + (mode === 'sign' ? 'υπογραφή στην οθόνη' : 'για εκτύπωση') +
       (client.afmChecked ? '' : ' · ΑΦΜ χωρίς επιτυχή αυτόματο έλεγχο'));

  let copied = false;
  if (CONFIG.SHOWING_FORM.SEND_COPY) {
    try {
      MailApp.sendEmail({
        to: client.email, name: CONFIG.OFFICE.name, replyTo: agent.email || CONFIG.OFFICE.email,
        subject: 'Το αντίγραφό σας · Εντολή υπόδειξης ακινήτου',
        body: 'Καλησπέρα,\n\nσας στέλνουμε αντίγραφο της εντολής υπόδειξης (Α/Α ' + aa + ').' +
              (mode === 'print' ? '\nΘα την υπογράψουμε μαζί σε χαρτί.' : '') +
              '\n\nΕυχαριστούμε,\n' + (agent.smsName || agent.name) + '\n' + CONFIG.OFFICE.name,
        attachments: [pdf.getBlob()]
      });
      copied = true;
    } catch (e) { console.error('Έντυπο υπόδειξης: δεν στάλθηκε το αντίγραφο (' + e.message + ')'); }
  }

  const leadId = String(sfGet_(r, SFC.LEAD));
  const title = mode === 'sign' ? 'Υπογράφηκε το έντυπο υπόδειξης' : 'Συμπληρώθηκε το έντυπο υπόδειξης';
  const where = sfProp_(r).address || sfProp_(r).code;
  try {
    const sent = pushToAgent_(agent, { type: 'showform', id: leadId, tag: 'sf-' + leadId,
      url: '?lead=' + encodeURIComponent(leadId), title: title,
      body: where + (mode === 'print' ? ' · θέλει εκτύπωση' : '') + afmNote });
    if (!sent && agent.email) {
      MailApp.sendEmail({ to: agent.email, subject: title, name: 'KW App',
        body: where + ' · Α/Α ' + aa + (afmNote ? '\n\nΟ ΑΦΜ δεν πέρασε τον αυτόματο έλεγχο: έλεγξέ τον στο PDF.' : '') +
              '\n\nΤο PDF είναι στον φάκελο του ακινήτου: ' + sfFileUrl_(pdf.getId()) });
    }
  } catch (e) { console.error('Έντυπο υπόδειξης: ειδοποίηση μεσίτη (' + e.message + ')'); }

  return { aa: aa, mode: mode, copied: copied };
}

/** Α/Α: 2026/001, 2026/002… ανά έτος, από τις υποβολές του φύλλου. Καλείται μέσα σε κλείδωμα. */
function sfNextAa_(now) {
  const y = Utilities.formatDate(now, TZ, 'yyyy');
  const max = sfRows_().reduce((m, r) => {
    const a = String(sfGet_(r, SFC.AA) || '').split('/');
    return a[0] === y ? Math.max(m, Number(a[1]) || 0) : m;
  }, 0);
  return y + '/' + String(max + 1).padStart(3, '0');
}

/** Όλα τα {{ΠΕΔΙΑ}} του προτύπου. */
/**
 * Όλα τα {{ΠΕΔΙΑ}} του προτύπου.
 * 1.15: οι ημερομηνίες είναι δύο. Η πρώτη στο έντυπο («Στην Αθήνα σήμερα στις…») =
 * ημερομηνία της υπόδειξης. Η δεύτερη («Αθήνα, …», δίπλα στις υπογραφές) = ημερομηνία
 * υπογραφής. Το sfFill_ γράφει τις τιμές ενός πίνακα με τη σειρά που εμφανίζονται.
 */
function sfValues_(c, prop, defects, now, aa, showAt) {
  const fee = sfFee_(prop);
  const dash = v => v || '—';
  const shown = showAt && ts_(showAt) ? new Date(showAt) : now;
  const two = f => [Utilities.formatDate(shown, TZ, f), Utilities.formatDate(now, TZ, f)];
  return {
    'ΑΑ': aa,
    'ΗΜΕΡΑ': two('dd'), 'ΜΗΝΑΣ': two('MM'), 'ΕΤΟΣ': two('yyyy'),
    'ΟΝΟΜΑΤΕΠΩΝΥΜΟ': c.name, 'ΠΑΤΡΩΝΥΜΟ': c.father, 'ΚΑΤΟΙΚΟΣ': c.city, 'ΟΔΟΣ': c.street,
    'ΑΡΙΘΜΟΣ': c.number, 'ΕΠΑΓΓΕΛΜΑ': c.job, 'ΑΔΤ': c.adt, 'ΑΦΜ': c.afm, 'ΔΟΥ': c.doy,
    'ΤΗΛ': c.phone, 'EMAIL': c.email,
    'ΓΙΑ_ΛΟΓΑΡΙΑΣΜΟ': dash(c.company), 'ΙΔΙΟΤΗΤΑ': dash(c.capacity),
    'ΚΩΔΙΚΟΣ': dash(prop.code), 'ΔΙΕΥΘΥΝΣΗ': dash(prop.address), 'ΕΙΔΟΣ': dash(prop.type),
    'ΤΜ': dash(prop.sqm), 'ΤΙΜΗ': dash(fmtEur_(prop.price)), 'ΑΜΟΙΒΗ': fee.fee,
    'ΠΟΣΟΣΤΟ_ΛΕΞΗ': fee.pctWord, 'ΠΟΣΟΣΤΟ': fee.pct, 'ΜΙΣΘΩΜΑ': fee.rent, 'ΜΙΣΘΩΜΑ_ΦΠΑ': fee.rentVat,
    'ΕΛΑΤΤΩΜΑΤΑ': defects || 'Κανένα',
    'ΥΠΟΓΡΑΦΩΝ': c.name
  };
}

/** «<ακίνητο>/Υποδείξεις». Ο φάκελος του ακινήτου βρίσκεται όπως και για τα έγγραφα. */
function sfFolder_(agent, code) {
  const p = readProps_()[normCode_(code)];
  if (!p || norm_(p.partner) !== norm_(agent.name)) throw new Error('Το ακίνητο δεν ανήκει πια στον μεσίτη.');
  const f = propFolders_(agent, p);
  return childByName_(f.folder, CONFIG.SHOWING_FORM.FOLDER) || f.folder.createFolder(CONFIG.SHOWING_FORM.FOLDER);
}

/** Γράφει την τιμή στη θέση κάθε {{ΚΛΕΙΔΙ}}, κρατώντας τη μορφοποίηση του προτύπου. */
function sfFill_(container, key, values) {
  if (!container) return;
  const pat = '\\{\\{' + key + '\\}\\}';
  const list = Array.isArray(values) ? values : [values];
  let r = container.findText(pat), n = 0;
  while (r) {
    const value = list[Math.min(n++, list.length - 1)];
    const t = r.getElement().asText();
    const a = r.getStartOffset(), b = r.getEndOffsetInclusive();
    if (value) {
      if (b + 1 >= t.getText().length) t.appendText(value);   // στο τέλος του στοιχείου
      else t.insertText(b + 1, value);
    }
    t.deleteText(a, b);
    r = container.findText(pat);
  }
}

/** Η υπογραφή μπαίνει ως εικόνα στη θέση του {{ΥΠΟΓΡΑΦΗ}}. Χωρίς υπογραφή: κενό για το στυλό. */
function sfPlaceSignature_(body, sig) {
  const r = body.findText('\\{\\{ΥΠΟΓΡΑΦΗ\\}\\}');
  if (!r) return false;
  const el = r.getElement();
  el.asText().deleteText(r.getStartOffset(), r.getEndOffsetInclusive());
  if (!sig) return true;
  const par = el.getParent();
  const img = par.insertInlineImage(par.getChildIndex(el) + 1, sig);
  const w = 170, k = w / (img.getWidth() || w);
  img.setWidth(w).setHeight(Math.round((img.getHeight() || 60) * k));
  return true;
}

/** Αντίγραφο προτύπου → πεδία → PDF στον φάκελο → οριστικό σβήσιμο του προσωρινού Doc. */
function sfBuildPdf_(values, sig, folder, name, templateId, keys) {
  const tmp = DriveApp.getFileById(templateId || CONFIG.SHOWING_FORM.TEMPLATE_ID).makeCopy('~ προσωρινό KW App', folder);
  try {
    const doc = DocumentApp.openById(tmp.getId());
    const parts = [doc.getBody(), doc.getHeader(), doc.getFooter()];
    if (!sfPlaceSignature_(doc.getBody(), sig) && sig) throw new Error('Στο πρότυπο λείπει το {{ΥΠΟΓΡΑΦΗ}}.');
    Object.keys(values).forEach(k => { const v = values[k]; parts.forEach(c => sfFill_(c, k, v)); });
    (keys || SF_KEYS).forEach(k => parts.forEach(c => sfFill_(c, k, '')));   // ό,τι περίσσεψε, κενό
    doc.saveAndClose();
    const blob = tmp.getAs('application/pdf').setName(name);
    return folder.createFile(blob);
  } finally {
    sfDropFile_(tmp);
  }
}

/** Οριστική διαγραφή (όχι κάδος): το προσωρινό Doc έχει προσωπικά στοιχεία. */
function sfDropFile_(file) {
  try {
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId() + '?supportsAllDrives=true', {
      method: 'delete', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    });
    if (res.getResponseCode() === 204) return;
  } catch (e) { /* πέφτουμε στον κάδο */ }
  try { file.setTrashed(true); } catch (e) { /* ήδη σβησμένο */ }
}

/** Τρέξ' το με ▶: ποια {{ΠΕΔΙΑ}} βρέθηκαν στο πρότυπο και ποια λείπουν. */
function showingTemplateCheck() {
  const id = CONFIG.SHOWING_FORM.TEMPLATE_ID;
  if (!id) { console.log('Έντυπο υπόδειξης: δεν έχει οριστεί CONFIG.SHOWING_FORM.TEMPLATE_ID.'); return; }
  let doc;
  try { doc = DocumentApp.openById(id); }
  catch (e) { console.log('⚠ Το πρότυπο δεν ανοίγει ως Google Doc (' + e.message + '). Αν είναι .docx: Αρχείο → Αποθήκευση ως Έγγραφο Google.'); return; }
  const text = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(Boolean).map(c => c.getText()).join('\n');
  const found = SF_KEYS.filter(k => text.indexOf('{{' + k + '}}') !== -1);
  const missing = SF_KEYS.filter(k => found.indexOf(k) === -1);
  const unknown = (text.match(/\{\{[^}]*\}\}/g) || []).map(x => x.slice(2, -2)).filter(k => SF_KEYS.indexOf(k) === -1);
  console.log('Έντυπο υπόδειξης «' + doc.getName() + '»: ' + found.length + '/' + SF_KEYS.length + ' πεδία.');
  if (missing.length) console.log('Λείπουν: ' + missing.join(', ') + (missing.indexOf('ΥΠΟΓΡΑΦΗ') !== -1 ? '  ⚠ χωρίς {{ΥΠΟΓΡΑΦΗ}} δεν γίνεται υπογραφή στην οθόνη' : ''));
  if (unknown.length) console.log('⚠ Άγνωστα (λάθος γραφή;): ' + unknown.join(', '));
}


// ═════════════════════════════════════════════════════════════
//  ΣΥΣΤΑΣΗ / ΣΥΝΕΡΓΑΣΙΑ (1.15)
// ═════════════════════════════════════════════════════════════
// Ο μεσίτης διαλέγει γραφείο και συνεργάτη από το «Συνεργάτες KW», γράφει πελάτη και
// χαρακτηριστικά, υπογράφει στην οθόνη. Το PDF μπαίνει στον φάκελό του
// («<μεσίτης>/Συστάσεις - Συνεργασίες») και φεύγει με email στο REFERRAL.SEND_TO.
// Στη Συνεργασία το τηλέφωνο του πελάτη γράφεται κρυμμένο: 694xxxx123.
// Το φύλλο «Συστάσεις» κρατά μόνο ποιος, πότε, προς ποιον. Όχι στοιχεία πελάτη.

const REF_KIND = { systasi: 'Σύσταση', synergasia: 'Συνεργασία' };
const REF_HEADERS = ['ID', 'Ημερομηνία', 'Μεσίτης', 'Είδος', 'Α/Α', 'Γραφείο', 'Συνεργάτης', 'Αρχείο', 'Στάλθηκε σε', 'Κλήση'];
const REF_KEYS = ['ΗΜΕΡΑ', 'ΜΗΝΑΣ', 'ΕΤΟΣ', 'Κ_ΑΓΟΡΑ', 'Κ_ΠΩΛΗΣΗ', 'Κ_ΑΛΛΟ', 'ΑΛΛΟ', 'Κ_ΚΑΤ_ΝΑΙ', 'Κ_ΚΑΤ_ΟΧΙ',
  'ΣΥΝΕΡΓΑΤΗΣ', 'ΚΙΝΗΤΟ', 'EMAIL_ΜΕΣΙΤΗ', 'ΓΡΑΦΕΙΟ', 'ΣΥΝΕΡΓΑΤΗΣ_ΠΡΟΣ', 'ΔΙΕΥΘΥΝΣΗ_ΠΡΟΣ', 'ΠΟΛΗ_ΠΡΟΣ', 'ΤΚ_ΠΡΟΣ',
  'ΤΗΛ_ΠΡΟΣ', 'EMAIL_ΠΡΟΣ', 'Κ_ΕΝΤ_ΟΧΙ', 'Κ_ΕΝΤ_ΑΠΛΗ', 'Κ_ΕΝΤ_ΑΠΟΚΛ', 'ΠΕΛΑΤΗΣ', 'ΤΗΛ_ΠΕΛΑΤΗ', 'EMAIL_ΠΕΛΑΤΗ',
  'Κ_Σ_ΑΓΟΡΑ', 'Κ_Σ_ΠΩΛΗΣΗ', 'Κ_Σ_ΜΙΣΘΩΣΗ', 'Κ_Σ_ΕΚΜΙΣΘΩΣΗ', 'Κ_Σ_ΑΝΤΙΠΑΡΟΧΗ', 'ΤΙΜΗ', 'ΠΡΟΚΑΤΑΒΟΛΗ', 'ΔΑΝΕΙΟ',
  'ΔΙΑΚΑΝΟΝΙΣΜΟΣ', 'ΠΕΡΙΟΧΗ', 'ΗΛΙΚΙΑ', 'ΤΜ', 'Κ_Τ_ΚΑΤΟΙΚΙΑ', 'Κ_Τ_ΚΑΤΑΣΤΗΜΑ', 'Κ_Τ_ΓΡΑΦΕΙΟ', 'Κ_Τ_ΟΙΚΟΠΕΔΟ',
  'Κ_Τ_ΑΛΛΟ', 'ΤΥΠΟΣ_ΑΛΛΟ', 'ΥΔ', 'ΜΠΑΝΙΑ', 'ΥΠΟΓΕΙΟ', 'ΣΤΑΘΜΕΥΣΗ', 'ΣΑΛΟΝΙ', 'ΤΡΑΠΕΖΑΡΙΑ', 'ΒΕΡΑΝΤΕΣ',
  'ΘΕΡΜΑΝΣΗ', 'ΑΛΛΑ', 'Κ_25', 'ΥΠΟΓΡΑΦΗ', 'ΕΛΕΓΧΟΣ'];
const BOX = on => (on ? '☒' : '☐');

// ── «Συνεργάτες KW» ─────────────────────────────────────────
// Οι στήλες βρίσκονται από τις επικεφαλίδες (σε μία από τις 5 πρώτες γραμμές),
// οπότε κενές στήλες στην αρχή ή αλλαγή σειράς δεν πειράζουν.

let _kwp = null;

function readKwPartners_() {
  if (_kwp) return _kwp;
  const sh = getSS().getSheetByName(CONFIG.SHEETS.KW_PARTNERS);
  if (!sh || sh.getLastRow() < 2) throw new Error('Λείπει ή είναι άδειο το φύλλο «' + CONFIG.SHEETS.KW_PARTNERS + '».');
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const want = { ID: /^id$/, NAME: /^επαφη$|^ονομα/, OFFICE: /^γραφειο$/, TEAM: /^ομαδα$/, PHONE: /^τηλεφων/,
                 EMAIL: /^e-?mail$/, CITY: /^πολη$/, AREA: /^περιοχη$/ };
  let hr = -1, col = {};
  for (let i = 0; i < Math.min(5, vals.length) && hr < 0; i++) {
    const h = vals[i].map(x => norm_(x));
    const c = {};
    Object.keys(want).forEach(k => { const j = h.findIndex(x => want[k].test(x)); if (j >= 0) c[k] = j; });
    if (c.NAME != null && c.OFFICE != null) { hr = i; col = c; }
  }
  if (hr < 0) throw new Error('Στο «' + CONFIG.SHEETS.KW_PARTNERS + '» δεν βρέθηκαν οι στήλες «Επαφή» και «Γραφείο».');
  const at = (r, k) => (col[k] != null ? cellText_(r[col[k]]) : '');
  _kwp = vals.slice(hr + 1).map((r, i) => {
    const phones = at(r, 'PHONE').split(/[,;\/]/).map(x => x.trim()).filter(Boolean);
    const mobile = phones.find(x => /^(\+?30)?\s*69/.test(x.replace(/\s/g, ''))) || phones[0] || '';
    return { id: at(r, 'ID') || 'r' + (i + hr + 2), name: at(r, 'NAME'), office: at(r, 'OFFICE'), team: at(r, 'TEAM'),
             phone: mobile, phones: phones, email: at(r, 'EMAIL').split(/[,;\s]/)[0] || '', city: at(r, 'CITY'), area: at(r, 'AREA') };
  }).filter(p => p.name && p.office);
  return _kwp;
}

/** Για τη φόρμα: γραφεία με τους συνεργάτες τους, ταξινομημένα. */
function actKwPartners_(agent) {
  const by = {};
  readKwPartners_().forEach(p => {
    const k = norm_(p.office);
    if (!by[k]) by[k] = { name: p.office, people: [] };
    by[k].people.push({ id: p.id, name: p.name, team: p.team, phone: p.phone, email: p.email, city: p.city, area: p.area });
  });
  const offices = Object.keys(by).map(k => by[k]).sort((a, b) => a.name.localeCompare(b.name, 'el'));
  offices.forEach(o => o.people.sort((a, b) => a.name.localeCompare(b.name, 'el')));
  return { offices: offices, me: { name: agent.smsName || agent.name, phone: agent.phone || '', email: agent.email || '' },
           sendTo: CONFIG.REFERRAL.SEND_TO, ready: { systasi: !!refTemplate_('systasi', true), synergasia: !!refTemplate_('synergasia', true) } };
}

// ── Πρότυπα ─────────────────────────────────────────────────

/** Το ID του προτύπου: από το CONFIG, αλλιώς από το όνομα στο Drive (και το κρατά). */
function refTemplate_(kind, quiet) {
  const cfg = CONFIG.REFERRAL;
  const id = kind === 'systasi' ? cfg.TEMPLATE_SYSTASI : cfg.TEMPLATE_SYNERGASIA;
  if (id) return id;
  const sp = PropertiesService.getScriptProperties();
  const key = 'REF_TPL_' + kind;
  const cached = sp.getProperty(key);
  if (cached) {
    try { if (!DriveApp.getFileById(cached).isTrashed()) return cached; } catch (e) { /* ξαναψάχνουμε */ }
  }
  const name = kind === 'systasi' ? cfg.NAME_SYSTASI : cfg.NAME_SYNERGASIA;
  const it = DriveApp.getFilesByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_DOCS) { sp.setProperty(key, f.getId()); return f.getId(); }
  }
  if (quiet) return '';
  throw new Error('Δεν βρέθηκε το πρότυπο «' + name + '» ως Έγγραφο Google στο Drive.');
}

/** Τρέξ' το με ▶: βρέθηκαν τα πρότυπα; έχουν όλα τα πεδία; */
function referralTemplateCheck() {
  ['systasi', 'synergasia'].forEach(kind => {
    const id = refTemplate_(kind, true);
    if (!id) { console.log(REF_KIND[kind] + ': ⚠ δεν βρέθηκε πρότυπο (ανέβασέ το .docx και Αρχείο → Αποθήκευση ως Έγγραφο Google).'); return; }
    const doc = DocumentApp.openById(id);
    const text = doc.getBody().getText();
    const need = REF_KEYS.filter(k => k !== 'Κ_ΚΑΤ_ΝΑΙ' && k !== 'Κ_ΚΑΤ_ΟΧΙ' && k !== 'Κ_25' || kind === 'systasi');
    const missing = need.filter(k => text.indexOf('{{' + k + '}}') === -1);
    console.log(REF_KIND[kind] + ' «' + doc.getName() + '»: ' + (need.length - missing.length) + '/' + need.length + ' πεδία' +
                (missing.length ? ' · λείπουν: ' + missing.join(', ') : ' ✓'));
  });
  try { console.log('Συνεργάτες KW: ' + readKwPartners_().length + ' άτομα σε ' + actKwPartners_({}).offices.length + ' γραφεία.'); }
  catch (e) { console.log('⚠ ' + e.message); }
}

// ── Αποστολή ────────────────────────────────────────────────

/** 6941234567 → 694xxxx567 (στη Συνεργασία ο πελάτης δεν φαίνεται). */
function maskPhone_(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 7) return d ? 'xxxx' : '';
  return d.slice(0, 3) + 'x'.repeat(d.length - 6) + d.slice(-3);
}

/** nikos.p@gmail.com → nixxxx@gmail.com (στη Συνεργασία: φαίνεται μόνο ότι υπάρχει και σε ποιον πάροχο). */
function maskMail_(e) {
  const m = String(e || '').match(/^([^@]+)@(.+)$/);
  if (!m) return '';
  return m[1].slice(0, Math.min(2, m[1].length - 1)) + 'xxxx@' + m[2];
}

function refNextAa_(kind, now) {
  const sh = ensureSheet_(CONFIG.SHEETS.REFERRALS, REF_HEADERS);
  const y = Utilities.formatDate(now, TZ, 'yyyy');
  const pre = (kind === 'systasi' ? 'ΣΥΣ' : 'ΣΥΝ') + '-' + y + '/';
  const last = sh.getLastRow();
  const list = last > 1 ? sh.getRange(2, 5, last - 1, 1).getValues().map(r => String(r[0])) : [];
  const max = list.filter(a => a.indexOf(pre) === 0).reduce((m, a) => Math.max(m, Number(a.slice(pre.length)) || 0), 0);
  return pre + String(max + 1).padStart(3, '0');
}

/**
 * { kind, interest, interestOther, prevCall, office, partnerId, mandate,
 *   client: {name, phone, email}, prop: {...}, sig, leadId }
 */
function actReferral_(agent, d) {
  const kind = d.kind === 'synergasia' ? 'synergasia' : d.kind === 'systasi' ? 'systasi' : '';
  if (!kind) throw new Error('Διάλεξε Σύσταση ή Συνεργασία.');
  const t = (v, n) => sfText_(v, n || 80);
  const partner = readKwPartners_().find(p => String(p.id) === String(d.partnerId) && norm_(p.office) === norm_(d.office));
  if (!partner) throw sfFail_('partner', 'Διάλεξε γραφείο και συνεργάτη.');
  const c = d.client || {};
  const client = { name: t(c.name, 120), phone: t(c.phone, 20), email: t(c.email, 120).toLowerCase() };
  if (!client.name) throw sfFail_('client', 'Γράψε το ονοματεπώνυμο του πελάτη.');
  if (client.email && !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(client.email)) throw sfFail_('email', 'Το email του πελάτη δεν φαίνεται σωστό.');
  if (!agent.phone) throw sfFail_('me', 'Συμπλήρωσε πρώτα το κινητό σου: ⚙ → Στοιχεία.');
  const interest = ['Αγορά', 'Πώληση', 'Άλλο'].indexOf(d.interest) >= 0 ? d.interest : '';
  if (!interest) throw sfFail_('interest', 'Διάλεξε για τι ενδιαφέρεται ο πελάτης.');
  const sig = sfSignature_(d.sig);
  const p = d.prop || {};
  const pick = (v, list) => (list.indexOf(v) >= 0 ? v : '');
  const deal = pick(p.deal, ['Αγορά', 'Πώληση', 'Μίσθωση', 'Εκμίσθωση', 'Αντιπαροχή']);
  const type = pick(p.type, ['Κατοικία', 'Κατάστημα', 'Γραφείο', 'Οικόπεδο', 'Άλλο']);
  const mandate = pick(d.mandate, ['Όχι', 'Απλή', 'Αποκλειστική']);
  const now = new Date();

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let aa, pdf;
  try {
    aa = refNextAa_(kind, now);
    const f = n => Utilities.formatDate(now, TZ, n);
    const values = {
      'ΗΜΕΡΑ': f('dd'), 'ΜΗΝΑΣ': f('MM'), 'ΕΤΟΣ': f('yyyy'),
      'Κ_ΑΓΟΡΑ': BOX(interest === 'Αγορά'), 'Κ_ΠΩΛΗΣΗ': BOX(interest === 'Πώληση'), 'Κ_ΑΛΛΟ': BOX(interest === 'Άλλο'),
      'ΑΛΛΟ': interest === 'Άλλο' ? t(d.interestOther) : '',
      'Κ_ΚΑΤ_ΝΑΙ': BOX(d.prevCall === 'Ναι'), 'Κ_ΚΑΤ_ΟΧΙ': BOX(d.prevCall === 'Όχι'),
      'ΣΥΝΕΡΓΑΤΗΣ': agent.smsName || agent.name, 'ΚΙΝΗΤΟ': agent.phone, 'EMAIL_ΜΕΣΙΤΗ': agent.email || '',
      'ΓΡΑΦΕΙΟ': partner.office, 'ΣΥΝΕΡΓΑΤΗΣ_ΠΡΟΣ': partner.name, 'ΔΙΕΥΘΥΝΣΗ_ΠΡΟΣ': partner.area,
      'ΠΟΛΗ_ΠΡΟΣ': partner.city, 'ΤΚ_ΠΡΟΣ': '', 'ΤΗΛ_ΠΡΟΣ': partner.phones.join(', '), 'EMAIL_ΠΡΟΣ': partner.email,
      'Κ_ΕΝΤ_ΟΧΙ': BOX(mandate === 'Όχι'), 'Κ_ΕΝΤ_ΑΠΛΗ': BOX(mandate === 'Απλή'), 'Κ_ΕΝΤ_ΑΠΟΚΛ': BOX(mandate === 'Αποκλειστική'),
      'ΠΕΛΑΤΗΣ': client.name,
      'ΤΗΛ_ΠΕΛΑΤΗ': kind === 'synergasia' ? maskPhone_(client.phone) : client.phone,
      'EMAIL_ΠΕΛΑΤΗ': kind === 'synergasia' ? maskMail_(client.email) : client.email,
      'Κ_Σ_ΑΓΟΡΑ': BOX(deal === 'Αγορά'), 'Κ_Σ_ΠΩΛΗΣΗ': BOX(deal === 'Πώληση'), 'Κ_Σ_ΜΙΣΘΩΣΗ': BOX(deal === 'Μίσθωση'),
      'Κ_Σ_ΕΚΜΙΣΘΩΣΗ': BOX(deal === 'Εκμίσθωση'), 'Κ_Σ_ΑΝΤΙΠΑΡΟΧΗ': BOX(deal === 'Αντιπαροχή'),
      'ΤΙΜΗ': t(p.price, 30), 'ΠΡΟΚΑΤΑΒΟΛΗ': t(p.down, 30), 'ΔΑΝΕΙΟ': t(p.loan, 30), 'ΔΙΑΚΑΝΟΝΙΣΜΟΣ': t(p.settle, 40),
      'ΠΕΡΙΟΧΗ': t(p.area, 60), 'ΗΛΙΚΙΑ': t(p.age, 20), 'ΤΜ': t(p.sqm, 12),
      'Κ_Τ_ΚΑΤΟΙΚΙΑ': BOX(type === 'Κατοικία'), 'Κ_Τ_ΚΑΤΑΣΤΗΜΑ': BOX(type === 'Κατάστημα'), 'Κ_Τ_ΓΡΑΦΕΙΟ': BOX(type === 'Γραφείο'),
      'Κ_Τ_ΟΙΚΟΠΕΔΟ': BOX(type === 'Οικόπεδο'), 'Κ_Τ_ΑΛΛΟ': BOX(type === 'Άλλο'), 'ΤΥΠΟΣ_ΑΛΛΟ': type === 'Άλλο' ? t(p.typeOther, 40) : '',
      'ΥΔ': t(p.rooms, 10), 'ΜΠΑΝΙΑ': t(p.baths, 10), 'ΥΠΟΓΕΙΟ': t(p.basement, 10), 'ΣΤΑΘΜΕΥΣΗ': t(p.parking, 20),
      'ΣΑΛΟΝΙ': t(p.living, 10), 'ΤΡΑΠΕΖΑΡΙΑ': t(p.dining, 10), 'ΒΕΡΑΝΤΕΣ': t(p.balconies, 10), 'ΘΕΡΜΑΝΣΗ': t(p.heating, 40),
      'ΑΛΛΑ': t(p.other, 500), 'Κ_25': BOX(true)
    };
    const check = sha256_(JSON.stringify(values) + String(d.sig || ''));
    values['ΕΛΕΓΧΟΣ'] = REF_KIND[kind] + ' ' + aa + ' · υπογράφηκε ηλεκτρονικά από ' + (agent.smsName || agent.name) +
      ' στις ' + stamp_(now) + ' · κωδικός ελέγχου ' + check.slice(0, 16).replace(/(.{4})(?!$)/g, '$1-');

    const af = agentFolder_(agent);
    const folder = childByName_(af, CONFIG.REFERRAL.FOLDER) || af.createFolder(CONFIG.REFERRAL.FOLDER);
    const clean = x => String(x).replace(/[\/\\:*?"<>|]/g, ' ');
    pdf = sfBuildPdf_(values, sig, folder,
      REF_KIND[kind] + ' ' + aa.replace(/^.*-/, '').replace('/', '-') + ' - ' + clean(partner.office) + ' - ' + clean(client.name) + '.pdf',
      refTemplate_(kind), REF_KEYS);

    ensureSheet_(CONFIG.SHEETS.REFERRALS, REF_HEADERS).appendRow(safeRow_([
      'R-' + randomHex_(10), now, agent.name, REF_KIND[kind], aa, partner.office, partner.name, pdf.getId(),
      CONFIG.REFERRAL.SEND_TO, String(d.leadId || '')]));
  } finally {
    lock.releaseLock();
  }

  const to = CONFIG.REFERRAL.SEND_TO;
  MailApp.sendEmail({
    to: to, cc: CONFIG.REFERRAL.CC_AGENT && agent.email ? agent.email : '', name: 'KW App',
    replyTo: agent.email || CONFIG.OFFICE.email,
    subject: REF_KIND[kind] + ' ' + aa + ' · ' + (agent.smsName || agent.name) + ' → ' + partner.name + ' (' + partner.office + ')',
    body: REF_KIND[kind] + ' ' + aa + '\n\nΑπό: ' + (agent.smsName || agent.name) + ', ' + CONFIG.OFFICE.name +
          '\nΠρος: ' + partner.name + ', ' + partner.office + '\n\nΤο έντυπο είναι συνημμένο.',
    attachments: [pdf.getBlob()]
  });
  log_(REF_KIND[kind] + ': στάλθηκε', agent.name, aa + ' · ' + partner.office);
  rvAddSafe_({ fileId: pdf.getId(), code: '', agent: agent.name, kind: 'referral', slot: '',
               title: REF_KIND[kind] + ' ' + aa, lead: String(d.leadId || '') });
  return { aa: aa, fileUrl: sfFileUrl_(pdf.getId()), sentTo: to, kind: REF_KIND[kind] };
}


/**
 * 1.16 · «Οι συστάσεις μου»: τα έντυπα σύστασης και συνεργασίας του μεσίτη,
 * νεότερα πρώτα. Μόνο τα στοιχεία της γραμμής (Α/Α, γραφείο, συνεργάτης) και το
 * link του PDF· τα στοιχεία του πελάτη υπάρχουν μόνο μέσα στο PDF.
 */
function actReferrals_(agent) {
  const sh = ensureSheet_(CONFIG.SHEETS.REFERRALS, REF_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const me = norm_(agent.name);
  let rv = {};
  try { rv = rvByFile_(); } catch (e) { /* χωρίς φύλλο ελέγχου */ }
  return sh.getRange(2, 1, last - 1, REF_HEADERS.length).getValues()
    .filter(r => r[0] && norm_(r[2]) === me)
    .map(r => {
      const rr = rv[String(r[7] || '')];
      const when = r[1] instanceof Date ? r[1] : new Date(r[1]);
      const ok = !isNaN(when.getTime());
      return {
        id: String(r[0]), ts: ok ? when.getTime() : 0, date: ok ? stamp_(when) : String(r[1] || ''),
        kind: String(r[3] || ''), aa: String(r[4] || ''), office: String(r[5] || ''), partner: String(r[6] || ''),
        fileUrl: sfFileUrl_(String(r[7] || '')), leadId: String(r[9] || ''),
        review: rr && rvOpen_(rvGet_(rr, RVC.STATUS)) ? rvBrief_(rr) : null
      };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 200);
}

// ═════════════════════════════════════════════════════════════
//  ADMIN (1.17): όλες οι κλήσεις, τα αρχεία όλων, έλεγχος εντύπων
// ═════════════════════════════════════════════════════════════
//
//  Ο Admin βλέπει, δεν ενεργεί: δεν καλεί, δεν στέλνει SMS, δεν αλλάζει κατάσταση.
//  Η μόνη του «εγγραφή» είναι η απόφαση στον έλεγχο εντύπων.
//  Φύλλο «Έλεγχος εντύπων»: μία γραμμή ανά αρχείο που ανέβηκε (ή που έλεγξε ο Admin).
//  ΧΩΡΙΣ στοιχεία πελάτη: μόνο ID αρχείου, κωδικός, είδος και τίτλος όπως «Εντολή»
//  ή «Υπόδειξη 2026/004». Το όνομα του πελάτη υπάρχει μόνο μέσα στο ίδιο το αρχείο.

const RV_HEADERS = ['ID', 'Αρχείο', 'Κωδικός', 'Μεσίτης', 'Είδος', 'Θέση', 'Τίτλος', 'Ανέβηκε',
  'Κατάσταση', 'Σχόλιο', 'Ελεγκτής', 'Ελέγχθηκε', 'Το είδε ο μεσίτης', 'Κλήση'];
const RVC = { ID: 1, FILE: 2, CODE: 3, AGENT: 4, KIND: 5, SLOT: 6, TITLE: 7, ADDED: 8,
  STATUS: 9, NOTE: 10, BY: 11, AT: 12, SEEN: 13, LEAD: 14 };
const RV = { PENDING: 'Σε έλεγχο', OK: 'Εγκρίθηκε', FIX: 'Θέλει διόρθωση', DONE: 'Αντικαταστάθηκε', GONE: 'Διαγράφηκε' };
const RV_KIND = { live: 'Έγγραφα', bill: 'Τιμολόγηση', showform: 'Υπόδειξη', offerform: 'Προσφορά', referral: 'Σύσταση', other: 'Άλλο αρχείο' };
const RV_OK_DAYS = 90;          // πόσες μέρες φαίνονται τα εγκεκριμένα στη λίστα του Admin

let _rv = null;

function rvSheet_() { return ensureSheet_(CONFIG.SHEETS.REVIEW, RV_HEADERS); }

function rvRows_() {
  if (_rv) return _rv;
  const sh = rvSheet_();
  const last = sh.getLastRow();
  _rv = last < 2 ? [] : sh.getRange(2, 1, last - 1, RV_HEADERS.length).getValues()
    .map((v, i) => ({ row: i + 2, v: v })).filter(r => r.v[0]);
  return _rv;
}

function rvGet_(r, col) { return r.v[col - 1]; }
function rvWrite_(r) { rvSheet_().getRange(r.row, 1, 1, RV_HEADERS.length).setValues([safeRow_(r.v)]); }

/** ID αρχείου → η πιο πρόσφατη γραμμή του. */
function rvByFile_() {
  const m = {};
  rvRows_().forEach(r => { m[String(rvGet_(r, RVC.FILE))] = r; });
  return m;
}

const rvOpen_ = st => st !== RV.DONE && st !== RV.GONE;

/**
 * Νέο αρχείο για έλεγχο. e: { fileId, code, agent, kind, slot, title, lead, replaced[], status, note, by }.
 *  · replaced: αρχεία που μόλις πήγαν στον κάδο → «Αντικαταστάθηκε».
 *  · Αν η θέση (ίδιο ακίνητο, είδος, θέση) είχε «Θέλει διόρθωση», το νέο αρχείο είναι η διόρθωση.
 * Καλείται ΕΞΩ από άλλο κλείδωμα.
 */
function rvAdd_(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _rv = null;
    const gone = (e.replaced || []).map(String);
    rvRows_().forEach(r => {
      const st = rvGet_(r, RVC.STATUS);
      if (!rvOpen_(st)) return;
      const replaced = gone.indexOf(String(rvGet_(r, RVC.FILE))) !== -1;
      const fixed = e.slot && st === RV.FIX && rvGet_(r, RVC.KIND) === e.kind &&
        String(rvGet_(r, RVC.SLOT)) === String(e.slot) &&
        normCode_(rvGet_(r, RVC.CODE)) === normCode_(e.code) && norm_(rvGet_(r, RVC.AGENT)) === norm_(e.agent);
      if (replaced || fixed) { r.v[RVC.STATUS - 1] = RV.DONE; rvWrite_(r); }
    });

    const v = new Array(RV_HEADERS.length).fill('');
    v[RVC.ID - 1] = 'V-' + randomHex_(10);
    v[RVC.FILE - 1] = String(e.fileId);
    v[RVC.CODE - 1] = String(e.code || '');
    v[RVC.AGENT - 1] = String(e.agent || '');
    v[RVC.KIND - 1] = e.kind;
    v[RVC.SLOT - 1] = String(e.slot || '');
    v[RVC.TITLE - 1] = sfText_(e.title, 80);
    v[RVC.ADDED - 1] = e.added || new Date();
    v[RVC.STATUS - 1] = e.status || RV.PENDING;
    v[RVC.NOTE - 1] = e.note || '';
    v[RVC.BY - 1] = e.by || '';
    v[RVC.AT - 1] = e.status && e.status !== RV.PENDING ? new Date() : '';
    v[RVC.LEAD - 1] = String(e.lead || '');
    rvSheet_().appendRow(safeRow_(v));
    _rv = null;
    if (v[RVC.STATUS - 1] === RV.PENDING) rvFlagNew_();      // 1.18: για την ειδοποίηση του Admin
    return v[RVC.ID - 1];
  } finally {
    lock.releaseLock();
  }
}

/** Ίδιο με το rvAdd_, αλλά δεν ρίχνει ποτέ το αίτημα του μεσίτη. */
function rvAddSafe_(e) {
  try { return rvAdd_(e); } catch (err) { console.warn('Έλεγχος εντύπων: ' + err.message); return ''; }
}

/** Αρχεία που σβήστηκαν από την εφαρμογή → «Διαγράφηκε». */
function rvMark_(fileIds, status) {
  try {
    const ids = fileIds.map(String);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      _rv = null;
      rvRows_().forEach(r => {
        if (ids.indexOf(String(rvGet_(r, RVC.FILE))) === -1 || !rvOpen_(rvGet_(r, RVC.STATUS))) return;
        r.v[RVC.STATUS - 1] = status;
        rvWrite_(r);
      });
      _rv = null;
    } finally { lock.releaseLock(); }
  } catch (err) { console.warn('Έλεγχος εντύπων: ' + err.message); }
}

/** Μικρή περίληψη για τη λίστα εγγράφων του μεσίτη. */
function rvBrief_(r) {
  return { id: String(rvGet_(r, RVC.ID)), status: String(rvGet_(r, RVC.STATUS)),
           note: String(rvGet_(r, RVC.NOTE) || ''), at: stamp_(rvGet_(r, RVC.AT)) };
}

/** Βάζει την κατάσταση ελέγχου πάνω σε κάθε αρχείο του listDocs_. */
function rvAttach_(docs) {
  let map;
  try { map = rvByFile_(); } catch (e) { return docs; }
  Object.keys(docs).forEach(k => docs[k].forEach(f => {
    const r = map[f.id];
    if (r && rvOpen_(rvGet_(r, RVC.STATUS))) f.review = rvBrief_(r);
  }));
  return docs;
}

/** Ό,τι στέλνεται στη σελίδα για μία γραμμή ελέγχου. */
function rvPublic_(r, props) {
  props = props || readProps_();
  const code = String(rvGet_(r, RVC.CODE) || '');
  const p = code ? props[normCode_(code)] : null;
  const fileId = String(rvGet_(r, RVC.FILE) || '');
  const kind = String(rvGet_(r, RVC.KIND) || 'other');
  const added = rvGet_(r, RVC.ADDED);
  return {
    id: String(rvGet_(r, RVC.ID)), fileId: fileId, url: sfFileUrl_(fileId),
    code: code, street: p ? (p.street || p.title || '') : '',
    agent: String(rvGet_(r, RVC.AGENT) || ''), kind: kind, kindLabel: RV_KIND[kind] || kind,
    slot: String(rvGet_(r, RVC.SLOT) || ''), title: String(rvGet_(r, RVC.TITLE) || ''),
    date: stamp_(added), ts: ts_(added),
    status: String(rvGet_(r, RVC.STATUS) || ''), note: String(rvGet_(r, RVC.NOTE) || ''),
    by: String(rvGet_(r, RVC.BY) || ''), at: stamp_(rvGet_(r, RVC.AT)),
    seen: !!rvGet_(r, RVC.SEEN), lead: String(rvGet_(r, RVC.LEAD) || '')
  };
}

function rvCounts_() {
  const c = { pending: 0, fix: 0, ok: 0 };
  rvRows_().forEach(r => {
    const st = rvGet_(r, RVC.STATUS);
    if (st === RV.PENDING) c.pending++;
    else if (st === RV.FIX) c.fix++;
    else if (st === RV.OK) c.ok++;
  });
  return c;
}

/** Του μεσίτη: ό,τι θέλει διόρθωση και δεν το έχει δει ακόμα. Για το «Θέλουν προσοχή». */
function myReviews_(agent) {
  try {
    const me = norm_(agent.name);
    const props = readProps_();
    return rvRows_().filter(r => rvGet_(r, RVC.STATUS) === RV.FIX && !rvGet_(r, RVC.SEEN) &&
                                 norm_(rvGet_(r, RVC.AGENT)) === me)
      .map(r => rvPublic_(r, props)).sort((a, b) => b.ts - a.ts).slice(0, 20);
  } catch (e) {
    console.warn('Έλεγχος εντύπων: ' + e.message);
    return [];
  }
}

/** Ο μεσίτης πάτησε «Το είδα»: φεύγει από το «Θέλουν προσοχή». Η κατάσταση μένει. */
function actReviewSeen_(agent, d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _rv = null;
    const r = rvRows_().find(x => String(rvGet_(x, RVC.ID)) === String(d.id) &&
                                 norm_(rvGet_(x, RVC.AGENT)) === norm_(agent.name));
    if (!r) throw new Error('Δεν βρέθηκε το έντυπο.');
    r.v[RVC.SEEN - 1] = new Date();
    rvWrite_(r);
    _rv = null;
  } finally { lock.releaseLock(); }
  return myReviews_(agent);
}

/** Α.Δ.Τ., ΑΦΜ, τηλέφωνα, IBAN: δεν γράφονται ποτέ σε φύλλο ή ειδοποίηση. */
function scrubIds_(s) {
  return String(s || '')
    .replace(/[A-Za-zΑ-Ωα-ω]{1,2}[\s-]?\d{6}(?!\d)/g, '•••')     // Α.Δ.Τ. όπως «ΑΚ 123456»
    .replace(/\d(?:[\s.\-]?\d){6,}/g, '•••');                    // 7+ ψηφία: ΑΦΜ, τηλέφωνο, λογαριασμός
}

// ── Φάκελοι και αρχεία, μόνο ανάγνωση ──────────────────────

/** Είναι μέσα στον φάκελο «Συνεργάτες»; (έως 8 επίπεδα πάνω) */
function insideRoot_(item) {
  const root = driveRoot_().getId();
  let level = [item];
  for (let depth = 0; depth < 8 && level.length; depth++) {
    const next = [];
    for (let i = 0; i < level.length; i++) {
      const ps = level[i].getParents();
      while (ps.hasNext()) {
        const p = ps.next();
        if (p.getId() === root) return true;
        next.push(p);
      }
    }
    level = next;
  }
  return false;
}

/** Ο φάκελος του ακινήτου ΧΩΡΙΣ να φτιάξει τίποτα (ο Admin μόνο κοιτάζει). */
function propFolderRO_(p) {
  const rec = readDocs_()[normCode_(p.code)];
  if (rec && rec.folder) {
    try { const f = DriveApp.getFolderById(rec.folder); if (!f.isTrashed()) return f; }
    catch (e) { /* ξαναψάχνουμε */ }
  }
  const agent = readAgents_().find(a => norm_(a.name) === norm_(p.partner));
  if (!agent) return null;
  let af = null;
  if (agent.folder) {
    try { af = DriveApp.getFolderById(agent.folder); if (af.isTrashed()) af = null; } catch (e) { af = null; }
  }
  if (!af) {
    const it = driveRoot_().getFolders();
    while (it.hasNext()) { const f = it.next(); if (norm_(f.getName()) === norm_(agent.name)) { af = f; break; } }
  }
  return af ? findPropFolder_(af, p.code) : null;
}

function kindOfFolder_(name) {
  const n = norm_(name);
  if (n === norm_(CONFIG.DOCS_FOLDER)) return 'live';
  if (n === norm_(CONFIG.BILLING.FOLDER)) return 'bill';
  if (n === norm_(CONFIG.SHOWING_FORM.FOLDER)) return 'showform';
  if (n === norm_(CONFIG.OFFER.FOLDER)) return 'offerform';
  if (n === norm_(CONFIG.REFERRAL.FOLDER)) return 'referral';
  return 'other';
}

/** Τίτλος για τον έλεγχο, χωρίς ποτέ το όνομα του πελάτη. */
function rvTitleOf_(fileName, kind) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  if (kind === 'live' || kind === 'bill') {
    const slot = slotOfName_(slotsOf_(kind), fileName);
    if (slot) return slot.label;
  }
  let m = /^Υπόδειξη (\d{4})-(\d+)/.exec(base);
  if (m) return 'Υπόδειξη ' + m[1] + '/' + m[2];
  m = /^(Σύσταση|Συνεργασία) (\S+)/.exec(base);
  if (m) return m[1] + ' ' + m[2];
  return scrubIds_(base.split(' - ')[0]).slice(0, 60) || 'Αρχείο';
}

/** Ένα αρχείο για τη λίστα του Admin. */
function fileInfo_(f, kind, byFile) {
  const created = f.getDateCreated();
  const slot = (kind === 'live' || kind === 'bill') ? slotOfName_(slotsOf_(kind), f.getName()) : null;
  const r = byFile[f.getId()];
  return {
    id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(),
    ts: created.getTime(), date: stamp_(created), url: f.getUrl(),
    kind: kind, slot: slot ? slot.key : '', title: rvTitleOf_(f.getName(), kind),
    review: r && rvOpen_(rvGet_(r, RVC.STATUS)) ? rvBrief_(r) : null
  };
}

const KIND_ORDER = { live: 0, bill: 1, showform: 2, offerform: 3, referral: 4, other: 5 };

/** Όλα τα αρχεία του φακέλου του ακινήτου, ανά υποφάκελο (έως 2 επίπεδα). */
function propTree_(folder) {
  const byFile = rvByFile_();
  const groups = [];
  const walk = (fold, path, kind, depth) => {
    const list = [];
    const files = fold.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed() || f.getName().indexOf('~ προσωρινό') === 0) continue;
      list.push(fileInfo_(f, kind, byFile));
    }
    if (list.length) groups.push({ name: path || 'Φάκελος ακινήτου', kind: kind,
                                   files: list.sort((a, b) => b.ts - a.ts), _f: fold });
    if (depth >= 2) return;
    const subs = fold.getFolders();
    while (subs.hasNext()) {
      const s = subs.next();
      if (s.isTrashed()) continue;
      walk(s, path ? path + ' / ' + s.getName() : s.getName(), depth === 0 ? kindOfFolder_(s.getName()) : kind, depth + 1);
    }
  };
  walk(folder, '', 'other', 0);
  return groups.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.name.localeCompare(b.name));
}

function adminProp_(code) {
  const p = readProps_()[normCode_(code)];
  if (!p) throw new Error('Δεν βρέθηκε το ακίνητο.');
  return p;
}

function actAdminFiles_(admin, d) {
  const p = adminProp_(d.code);
  const folder = propFolderRO_(p);
  if (!folder) return { code: p.code, agent: p.partner, folderUrl: '', groups: [], total: 0 };
  const groups = propTree_(folder).map(g => ({ name: g.name, kind: g.kind, files: g.files }));
  return { code: p.code, agent: p.partner, folderUrl: folder.getUrl(), groups: groups,
           total: groups.reduce((n, g) => n + g.files.length, 0) };
}

/** Ένα αρχείο ως base64, ΜΟΝΟ αν είναι μέσα στους «Συνεργάτες». */
function actAdminFile_(admin, d) {
  const file = DriveApp.getFileById(String(d.fileId || ''));
  if (file.isTrashed() || !insideRoot_(file)) throw new Error('Το αρχείο δεν είναι σε φάκελο συνεργάτη.');
  if (file.getSize() > CONFIG.ADMIN.MAX_DOWNLOAD_MB * 1048576) {
    throw new Error('Το αρχείο ξεπερνά τα ' + CONFIG.ADMIN.MAX_DOWNLOAD_MB + ' MB. Άνοιξέ το από το Drive.');
  }
  const native = /^application\/vnd\.google-apps\./.test(file.getMimeType());
  const blob = native ? file.getAs('application/pdf') : file.getBlob();
  const name = native ? file.getName() + '.pdf' : file.getName();
  log_('Admin: κατέβασμα αρχείου', admin.name, file.getId());
  return { name: name, mime: blob.getContentType(), size: blob.getBytes().length,
           data: Utilities.base64Encode(blob.getBytes()) };
}

/** Όλα τα αρχεία του ακινήτου σε ένα zip («Έγγραφα KWAC - ΠΕΑ.pdf» κ.λπ.). */
function actAdminZip_(admin, d) {
  const p = adminProp_(d.code);
  const folder = propFolderRO_(p);
  if (!folder) throw new Error('Δεν υπάρχει ακόμα φάκελος για το ακίνητο.');
  const max = CONFIG.ADMIN.MAX_ZIP_MB * 1048576;
  const used = {};
  const blobs = [];
  let size = 0, skipped = 0;
  propTree_(folder).forEach(g => g.files.forEach(f => {
    if (/^application\/vnd\.google-apps\./.test(f.mime) || size + f.size > max) { skipped++; return; }
    let name = (g.name === 'Φάκελος ακινήτου' ? '' : g.name.replace(/\s*\/\s*/g, ' - ') + ' - ') + f.name;
    name = name.replace(/[\\/:*?"<>|]/g, ' ');
    let n = 1, final = name;
    while (used[final]) final = name.replace(/(\.[^.]+)?$/, ' (' + (++n) + ')$1');
    used[final] = 1;
    blobs.push(DriveApp.getFileById(f.id).getBlob().setName(final));
    size += f.size;
  }));
  if (!blobs.length) throw new Error(skipped ? 'Τα αρχεία είναι πολύ μεγάλα για zip. Κατέβασέ τα ένα-ένα.' : 'Ο φάκελος είναι άδειος.');
  const zip = Utilities.zip(blobs, (p.code + ' ' + (p.street || '')).replace(/[\\/:*?"<>|]/g, ' ').trim() + '.zip');
  log_('Admin: zip ακινήτου', admin.name, p.code + ' · ' + blobs.length + ' αρχεία');
  return { name: zip.getName(), mime: 'application/zip', count: blobs.length, skipped: skipped,
           data: Utilities.base64Encode(zip.getBytes()) };
}

// ── Κλήσεις και ακίνητα όλων ────────────────────────────────

/** Μία κλήση για τον Admin: τι έγινε, χωρίς επαφές CRM (πιο γρήγορο). */
function adminLead_(l) {
  const g = col => appGet_(l.id, col);
  const p = readProps_()[normCode_(l.code)] || null;
  const showAt = g(ACOL.SHOW_AT);
  return {
    id: l.id, date: stamp_(l.date), ts: ts_(l.date), source: l.source,
    name: l.name, phone: l.phone, email: l.email, code: l.code,
    property: propertyLine_(l, p), street: (p && p.street) || '', deal: l.deal, price: l.price,
    message: l.message, repeat: l.repeat, owner: (p && p.partner) || '',
    status: statusOf_(l.id), notes: String(g(ACOL.NOTES) || ''),
    opened: stamp_(g(ACOL.OPENED)), called: stamp_(g(ACOL.CALLED)), sms: stamp_(g(ACOL.SMS)),
    followUp: stamp_(g(ACOL.FU_AT)), showingAt: stamp_(showAt), showingTs: ts_(showAt),
    hasEvent: !!g(ACOL.SHOW_ID), showingDate: showAt && ts_(showAt) ? fmtIso_(showAt) : '',
    outcome: String(g(ACOL.OUTCOME) || ''), outcomeNote: String(g(ACOL.OUTCOME_NOTE) || ''),
    form: sfLeadStatus_(l.id), calls: callsOf_(l.id), offer: ofLeadStatus_(l.id)
  };
}

/** Τα ακίνητα όλης της ομάδας, κάθε κατάστασης, με τα έγγραφα και τα εκκρεμή του ελέγχου. */
function adminProps_() {
  const team = teamNames_();
  const totals = readTotals_();
  const props = readProps_();
  const pend = {};
  rvRows_().forEach(r => {
    if (rvGet_(r, RVC.STATUS) !== RV.PENDING) return;
    const k = normCode_(rvGet_(r, RVC.CODE));
    if (k) pend[k] = (pend[k] || 0) + 1;
  });
  return Object.keys(props).map(k => props[k])
    .filter(p => team.indexOf(norm_(p.partner)) !== -1)
    .map(p => {
      const t = totals[normCode_(p.code)] || { total: 0, month: 0, week: 0 };
      return {
        code: p.code, title: p.title, type: p.type, area: p.area, street: p.street,
        price: p.price, sqm: p.sqm, mandate: p.mandate, partner: p.partner, deal: p.deal,
        mandateDays: p.mandateDays, status: p.status, available: p.available,
        total: t.total, month: t.month, week: t.week,
        docs: docCounts_(p.code), pending: pend[normCode_(p.code)] || 0
      };
    })
    .sort((a, b) => (b.pending - a.pending) || (b.available - a.available) || (b.month - a.month) ||
                    String(a.street).localeCompare(String(b.street)));
}

/** Πρόσβαση ανάγνωσης του Admin στον φάκελο «Συνεργάτες» (μία φορά). */
function adminDrive_(admin) {
  if (!CONFIG.ADMIN.SHARE_DRIVE || !admin.email) return { shared: false };
  if (admin.email === ownerEmail_()) return { shared: true };
  const sp = PropertiesService.getScriptProperties();
  const key = 'ADMIN_DRIVE_' + sha256_(admin.email).slice(0, 16);
  if (sp.getProperty(key)) return { shared: true };
  try {
    driveRoot_().addViewer(admin.email);
    sp.setProperty(key, String(Date.now()));
    log_('Admin: ανάγνωση στον φάκελο Συνεργάτες', admin.name, '');
    return { shared: true };
  } catch (e) {
    console.warn('Admin Drive: ' + e.message);
    return { shared: false };
  }
}

function actAdminBoot_(admin) {
  return {
    agents: readAgents_().filter(isAgent_).map(a => ({ name: a.name, active: a.active })),
    props: adminProps_(),
    leads: ADMIN_ACTIONS.adminLeads(admin),
    review: actReviewList_(admin),
    reasons: CONFIG.ADMIN.REASONS,
    drive: adminDrive_(admin),
    limits: { download: CONFIG.ADMIN.MAX_DOWNLOAD_MB, zip: CONFIG.ADMIN.MAX_ZIP_MB }
  };
}

// ── Έλεγχος εντύπων ────────────────────────────────────────

/** Η λίστα του Admin: όλα τα «Σε έλεγχο» και «Θέλει διόρθωση», και τα εγκεκριμένα των τελευταίων 90 ημερών. */
function actReviewList_(admin) {
  const props = readProps_();
  const since = Date.now() - RV_OK_DAYS * 86400000;
  const items = rvRows_().filter(r => {
    const st = rvGet_(r, RVC.STATUS);
    return st === RV.PENDING || st === RV.FIX || (st === RV.OK && ts_(rvGet_(r, RVC.AT) || rvGet_(r, RVC.ADDED)) >= since);
  }).map(r => rvPublic_(r, props)).sort((a, b) => b.ts - a.ts);
  return { items: items.slice(0, 600), counts: rvCounts_() };
}

/** Γραμμή για αρχείο που δεν ανέβηκε από την εφαρμογή (π.χ. μπήκε κατευθείαν στο Drive). */
function rvEntryFromFile_(fileId, code) {
  const file = DriveApp.getFileById(String(fileId));
  if (!insideRoot_(file)) throw new Error('Το αρχείο δεν είναι σε φάκελο συνεργάτη.');
  const p = code ? readProps_()[normCode_(code)] : null;
  const parent = file.getParents();
  const kind = parent.hasNext() ? kindOfFolder_(parent.next().getName()) : 'other';
  const slot = (kind === 'live' || kind === 'bill') ? slotOfName_(slotsOf_(kind), file.getName()) : null;
  return { fileId: file.getId(), code: p ? p.code : '', agent: p ? p.partner : '', kind: kind,
           slot: slot ? slot.key : '', title: rvTitleOf_(file.getName(), kind), added: file.getDateCreated() };
}

/**
 * Απόφαση του Admin: { id ή fileId (+ code), decision: 'ok' | 'fix', note }.
 * «Θέλει διόρθωση» → ειδοποίηση στον μεσίτη (ή email, αν δεν έχει ειδοποιήσεις).
 */
function actReviewSet_(admin, d) {
  const decision = d.decision === 'ok' ? RV.OK : d.decision === 'fix' ? RV.FIX : '';
  if (!decision) throw new Error('Διάλεξε «Έγκριση» ή «Θέλει διόρθωση».');
  const raw = sfText_(d.note, 500);
  const note = scrubIds_(raw);
  if (decision === RV.FIX && !note) throw sfFail_('note', 'Γράψε τι πρέπει να διορθωθεί.');

  let id = String(d.id || '');
  if (!id) {
    if (!d.fileId) throw new Error('Δεν βρέθηκε το έντυπο.');
    const hit = rvByFile_()[String(d.fileId)];
    id = hit && rvOpen_(rvGet_(hit, RVC.STATUS)) ? String(rvGet_(hit, RVC.ID)) : rvAdd_(rvEntryFromFile_(d.fileId, d.code));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row;
  try {
    _rv = null;
    row = rvRows_().find(r => String(rvGet_(r, RVC.ID)) === id);
    if (!row) throw new Error('Δεν βρέθηκε το έντυπο.');
    if (!rvOpen_(rvGet_(row, RVC.STATUS))) {
      throw new Error('Το αρχείο αντικαταστάθηκε ή σβήστηκε στο μεταξύ. Άνοιξε το νεότερο.');
    }
    row.v[RVC.STATUS - 1] = decision;
    row.v[RVC.NOTE - 1] = note;
    row.v[RVC.BY - 1] = admin.smsName || admin.name;
    row.v[RVC.AT - 1] = new Date();
    row.v[RVC.SEEN - 1] = '';
    rvWrite_(row);
  } finally {
    lock.releaseLock();
  }

  const item = rvPublic_(row);
  log_('Έλεγχος εντύπου: ' + decision, admin.name, item.id + ' · ' + (RV_KIND[item.kind] || item.kind) + (item.code ? ' · ' + item.code : ''));
  let notified = '';
  if (decision === RV.FIX) notified = rvNotify_(item);
  _rv = null;
  return { item: rvPublic_(rvRows_().find(r => String(rvGet_(r, RVC.ID)) === id)),
           counts: rvCounts_(), masked: note !== raw, notified: notified };
}

/** Ειδοποίηση «Θέλει διόρθωση» στον μεσίτη. Το σχόλιο φαίνεται μέσα στην εφαρμογή, όχι στην κλειδωμένη οθόνη. */
function rvNotify_(item) {
  const agent = readAgents_().find(a => norm_(a.name) === norm_(item.agent));
  if (!agent) return '';
  const where = item.street || item.code || item.kindLabel;
  const go = 'go:review:' + item.id;
  try {
    const sent = pushToAgent_(agent, { type: 'review', id: go, tag: 'rv-' + item.id,
      url: '?lead=' + encodeURIComponent(go),
      title: 'Θέλει διόρθωση · ' + item.title, body: where + ' · πάτα για το σχόλιο' });
    if (sent) return 'push';
    if (agent.email) {
      MailApp.sendEmail({ to: agent.email, name: 'KW App', replyTo: CONFIG.OFFICE.email,
        subject: 'Θέλει διόρθωση: ' + item.title + (where ? ' · ' + where : ''),
        body: 'Το έντυπο «' + item.title + '»' + (where ? ' (' + where + ')' : '') + ' θέλει διόρθωση.\n\n' +
              'Σχόλιο: ' + item.note + '\n\nΆνοιξε την εφαρμογή: ' + CONFIG.APP_URL });
      return 'email';
    }
  } catch (e) { console.error('Έλεγχος εντύπων: ειδοποίηση (' + e.message + ')'); }
  return '';
}

/** ▶ Μία φορά για τον Admin: στήλη «Ρόλος» στο Agents και φύλλο «Έλεγχος εντύπων». Δεν πειράζει τίποτα άλλο. */
function setupAdmin() {
  rvSheet_();
  const ag = sheet_(CONFIG.SHEETS.AGENTS);
  let cols = agentCols_(ag);
  if (!cols.ROLE) {
    const c = ag.getLastColumn() + 1;
    ag.getRange(1, c).setValue(AGENT_HEADERS.ROLE).setFontWeight('bold');
    if (ag.getLastRow() > 1) ag.getRange(2, c, ag.getLastRow() - 1, 1).setValue(ROLE_VALUES[0]);
    cols = agentCols_(ag);
  }
  try {
    ag.getRange(2, cols.ROLE, Math.max(ag.getMaxRows() - 1, 1), 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(ROLE_VALUES, true).setAllowInvalid(false).build());
  } catch (e) { /* όχι κρίσιμο */ }
  _agents = null;
  const lines = ['Ρόλοι:'];
  readAgents_().forEach(a => lines.push('  ' + a.name + ': ' + (a.roles.agent ? 'Μεσίτης' : '') +
    (a.roles.agent && a.roles.admin ? ' + ' : '') + (a.roles.admin ? 'Admin' : '')));
  lines.push('', 'Φύλλο «' + CONFIG.SHEETS.REVIEW + '» έτοιμο.');
  console.log(lines.join('\n'));
}

// ═════════════════════════════════════════════════════════════
//  ΕΙΔΟΠΟΙΗΣΗ ADMIN (1.18): «3 νέα έντυπα για έλεγχο»
// ═════════════════════════════════════════════════════════════
//  Κάθε νέο «Σε έλεγχο» ανάβει μια σημαία (RV_NEW). Το checkNewLeads (κάθε λεπτό)
//  τη βλέπει και, αν πέρασε η ώρα από την προηγούμενη, στέλνει ΜΙΑ ειδοποίηση
//  σε κάθε Admin με όσα ήρθαν στο μεταξύ. Τις ήσυχες ώρες περιμένει το πρωί.
//  Χωρίς σημαία, κοστίζει μία ανάγνωση Ιδιότητας: τίποτα.

function rvFlagNew_() {
  try { PropertiesService.getScriptProperties().setProperty('RV_NEW', String(Date.now())); } catch (e) { /* όχι κρίσιμο */ }
}

function adminDigest_() {
  const sp = PropertiesService.getScriptProperties();
  if (!sp.getProperty('RV_NEW')) return '';
  const n = CONFIG.ADMIN.NOTIFY || {};
  if (!n.ENABLED) { sp.deleteProperty('RV_NEW'); return 'off'; }
  const hour = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  if (hour < n.FROM_HOUR || hour >= n.TO_HOUR) return 'quiet';
  const last = Number(sp.getProperty('RV_DIGEST_AT') || 0);
  if (Date.now() - last < n.EVERY_MIN * 60000) return 'wait';

  _rv = null;
  const pending = rvRows_().filter(r => rvGet_(r, RVC.STATUS) === RV.PENDING);
  const fresh = pending.filter(r => ts_(rvGet_(r, RVC.ADDED)) > last);
  sp.setProperty('RV_DIGEST_AT', String(Date.now()));
  sp.deleteProperty('RV_NEW');
  if (!fresh.length) return 'none';

  let sent = 0;
  _agents = null;
  readAgents_().filter(a => a.active && isAdmin_(a)).forEach(admin => {
    const mine = fresh.filter(r => norm_(rvGet_(r, RVC.AGENT)) !== norm_(admin.name));   // όχι τα δικά του
    if (!mine.length) return;
    const by = {};
    mine.forEach(r => { const k = String(rvGet_(r, RVC.AGENT) || 'Χωρίς μεσίτη'); by[k] = (by[k] || 0) + 1; });
    const others = pending.filter(r => norm_(rvGet_(r, RVC.AGENT)) !== norm_(admin.name)).length;
    const go = 'go:adminreview';
    try {
      sent += pushToAgent_(admin, {
        type: 'adminreview', id: go, tag: 'adminreview', url: '?lead=' + encodeURIComponent(go),
        title: (mine.length === 1 ? '1 νέο έντυπο' : mine.length + ' νέα έντυπα') + ' για έλεγχο',
        body: Object.keys(by).map(k => k.split(' ')[0] + ' ' + by[k]).join(' · ') +
              (others > mine.length ? ' · σε έλεγχο συνολικά ' + others : '')
      });
    } catch (e) { console.warn('Ειδοποίηση Admin: ' + e.message); }
  });
  log_('Ειδοποίηση Admin: νέα έντυπα', '', fresh.length + ' έντυπα, ' + sent + ' συσκευές');
  return 'sent:' + sent;
}

// ═════════════════════════════════════════════════════════════
//  ΦΩΤΟΓΡΑΦΙΕΣ ΑΚΙΝΗΤΟΥ (1.18): υποφάκελος MEDIA
// ═════════════════════════════════════════════════════════════
//  Συνεργάτες → μεσίτης → ακίνητο → MEDIA. Εξώφυλλο = η πρώτη φωτογραφία με σειρά
//  ονόματος (01.jpg πριν από 02.jpg), εκτός αν ο μεσίτης διάλεξε άλλη.
//  Οι εικόνες έρχονται στη σελίδα μέσα από την εφαρμογή, σε μικρότερο μέγεθος:
//  δεν χρειάζεται ο μεσίτης να έχει πρόσβαση στο Drive, και φορτώνουν γρήγορα.

const MEDIA_PX = { s: 400, m: 1000, l: 1600 };
const IMG_RE = /^image\//;
const IMG_EXT = /\.(jpe?g|png|webp|heic|heif|gif)$/i;

function canSeeProp_(user, code) {
  const p = readProps_()[normCode_(code)];
  if (!p) throw new Error('Δεν βρέθηκε το ακίνητο.');
  if (isAdmin_(user) || teamNames_().indexOf(norm_(p.partner)) !== -1) return p;
  throw new Error('Το ακίνητο δεν είναι της ομάδας.');
}

/** Ο φάκελος MEDIA του ακινήτου. create: τον φτιάχνει (μόνο για τον μεσίτη του ακινήτου). */
function mediaFolder_(p, create, agent) {
  const cache = CacheService.getScriptCache();
  const key = 'mf:' + normCode_(p.code);
  const hit = cache.get(key);
  if (hit && hit !== '-') {
    try { const f = DriveApp.getFolderById(hit); if (!f.isTrashed()) return f; } catch (e) { /* ξαναψάχνουμε */ }
  }
  if (hit === '-' && !create) return null;
  const propF = create ? propFolders_(agent, p).folder : propFolderRO_(p);
  let m = propF ? childByName_(propF, CONFIG.MEDIA.FOLDER) : null;
  if (!m && create && propF) m = propF.createFolder(CONFIG.MEDIA.FOLDER);
  cache.put(key, m ? m.getId() : '-', m ? 21600 : 600);
  return m;
}

function isImage_(f) { return IMG_RE.test(f.getMimeType()) || IMG_EXT.test(f.getName()); }

/** Οι φωτογραφίες με σειρά ονόματος (φυσική: 2 πριν από 10). */
function mediaList_(m) {
  const out = [];
  if (!m) return out;
  const it = m.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || !isImage_(f)) continue;
    out.push({ id: f.getId(), name: f.getName(), ts: f.getDateCreated().getTime() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'el', { numeric: true, sensitivity: 'base' }));
}

function coverKey_(code) { return 'COVER_' + normCode_(code); }

function coverOf_(code, list) {
  if (!list.length) return '';
  const chosen = PropertiesService.getScriptProperties().getProperty(coverKey_(code));
  return list.some(x => x.id === chosen) ? chosen : list[0].id;
}

/**
 * Η εικόνα σε μέγεθος px (πλάτος), ως { data (base64), mime }.
 *  1. Μικρογραφία του Drive στο μέγεθος που ζητάμε (δουλεύει και για HEIC).
 *  2. Το ίδιο το αρχείο, αν είναι μικρό και ο browser το δείχνει.
 *  3. Η μικρή μικρογραφία του Apps Script.
 */
function imageData_(file, px) {
  const opts = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  try {
    const meta = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId() +
                                   '?fields=thumbnailLink&supportsAllDrives=true', opts);
    const link = meta.getResponseCode() === 200 ? JSON.parse(meta.getContentText()).thumbnailLink : '';
    if (link) {
      const r = UrlFetchApp.fetch(link.replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + '=w' + px, opts);
      const blob = r.getResponseCode() === 200 ? r.getBlob() : null;
      if (blob && IMG_RE.test(blob.getContentType() || '')) {
        return { data: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType() };
      }
    }
  } catch (e) { console.warn('Μικρογραφία Drive: ' + e.message); }
  const mime = file.getMimeType();
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime) && file.getSize() <= (px > 500 ? 3 : 0.6) * 1048576) {
    return { data: Utilities.base64Encode(file.getBlob().getBytes()), mime: mime };
  }
  try {
    const t = file.getThumbnail();
    if (t) return { data: Utilities.base64Encode(t.getBytes()), mime: t.getContentType() || 'image/jpeg' };
  } catch (e) { /* χωρίς μικρογραφία */ }
  return null;
}

/** Με cache για το μικρό μέγεθος (το CacheService κρατά έως 100KB ανά τιμή). */
function imageCached_(file, size) {
  const cache = CacheService.getScriptCache();
  const key = 'im:' + size + ':' + file.getId();
  if (size === 's') {
    const hit = cache.get(key);
    if (hit) { const i = hit.indexOf('|'); return { mime: hit.slice(0, i), data: hit.slice(i + 1) }; }
  }
  const img = imageData_(file, MEDIA_PX[size] || MEDIA_PX.m);
  if (img && size === 's' && img.data.length < 95000) cache.put(key, img.mime + '|' + img.data, 21600);
  return img;
}

const dataUri_ = img => img ? 'data:' + img.mime + ';base64,' + img.data : '';

/** Το αρχείο ΜΟΝΟ αν είναι μέσα στο MEDIA αυτού του ακινήτου. */
function mediaFile_(p, id) {
  const m = mediaFolder_(p, false);
  if (!m) throw new Error('Δεν υπάρχει φάκελος MEDIA.');
  const f = DriveApp.getFileById(String(id || ''));
  const ps = f.getParents();
  while (ps.hasNext()) if (ps.next().getId() === m.getId()) {
    if (f.isTrashed()) break;
    return { file: f, folder: m };
  }
  throw new Error('Η φωτογραφία δεν είναι στο ακίνητο.');
}

function mediaResult_(user, p, m, withCover) {
  const list = mediaList_(m);
  const cover = coverOf_(p.code, list);
  CacheService.getScriptCache().put('cv:' + normCode_(p.code), cover || '-', cover ? 21600 : 600);
  let coverData = '';
  // withCover: true = πάντα, ή το ID του προηγούμενου εξωφύλλου = μόνο αν άλλαξε.
  if (cover && (withCover === true || (typeof withCover === 'string' && withCover !== cover))) {
    try { coverData = dataUri_(imageCached_(DriveApp.getFileById(cover), 'm')); } catch (e) { /* χωρίς εικόνα */ }
  }
  return {
    code: p.code, photos: list, cover: cover, coverData: coverData,
    folderUrl: m ? m.getUrl() : '',
    canEdit: isAgent_(user) && norm_(p.partner) === norm_(user.name),
    max: CONFIG.MEDIA.MAX_MB
  };
}

/** { code } → οι φωτογραφίες και το εξώφυλλο (έτοιμο σε μεσαίο μέγεθος). */
function actMedia_(user, d) {
  const p = canSeeProp_(user, d.code);
  return mediaResult_(user, p, mediaFolder_(p, false), true);
}

/**
 * { code, id, size: s | m | l } → μία εικόνα.
 * { code, ids, size: 's' } → πολλές μικρές μαζί (η λωρίδα κάτω από το carousel), με όριο χρόνου.
 */
function actMediaImg_(user, d) {
  const p = canSeeProp_(user, d.code);
  const size = MEDIA_PX[d.size] ? d.size : 'l';
  if (Array.isArray(d.ids)) {
    const t0 = Date.now(), items = [], pending = [];
    const m = mediaFolder_(p, false);
    const ok = {};
    mediaList_(m).forEach(x => { ok[x.id] = true; });
    d.ids.slice(0, 40).forEach(id => {
      if (!ok[id]) return;
      if (Date.now() - t0 > 18000) { pending.push(id); return; }
      try { items.push({ id: id, src: dataUri_(imageCached_(DriveApp.getFileById(id), size)) }); }
      catch (e) { items.push({ id: id, src: '' }); }
    });
    return { items: items, pending: pending, size: size };
  }
  const img = imageCached_(mediaFile_(p, d.id).file, size);
  if (!img) throw new Error('Η φωτογραφία δεν μπορεί να εμφανιστεί.');
  return { id: d.id, size: size, src: dataUri_(img) };
}

/**
 * { codes } → μικρά εξώφυλλα για τη λίστα Ακίνητα. Με όριο χρόνου: ό,τι δεν
 * πρόλαβε επιστρέφει στο pending και η σελίδα το ξαναζητά.
 */
function actCovers_(user, d) {
  const t0 = Date.now();
  const cache = CacheService.getScriptCache();
  const team = teamNames_();
  const props = readProps_();
  const out = {}, pending = [];
  (d.codes || []).slice(0, 30).forEach(code => {
    const p = props[normCode_(code)];
    if (!p || (!isAdmin_(user) && team.indexOf(norm_(p.partner)) === -1)) return;
    if (Date.now() - t0 > 18000) { pending.push(p.code); return; }
    try {
      let cover = cache.get('cv:' + normCode_(p.code));
      if (!cover) {
        const m = mediaFolder_(p, false);
        cover = coverOf_(p.code, mediaList_(m)) || '-';
        cache.put('cv:' + normCode_(p.code), cover, cover === '-' ? 600 : 21600);
      }
      out[p.code] = cover === '-' ? '' : dataUri_(imageCached_(DriveApp.getFileById(cover), 's'));
    } catch (e) { out[p.code] = ''; }
  });
  return { covers: out, pending: pending };
}

function mediaChanged_(code) {
  CacheService.getScriptCache().remove('cv:' + normCode_(code));
}

/** { code, name, mime, data } → νέα φωτογραφία στο MEDIA (μόνο ο μεσίτης του ακινήτου). */
function actMediaUpload_(agent, d) {
  const p = myProp_(agent, d.code);
  const b64 = String(d.data || '');
  if (!b64) throw new Error('Η φωτογραφία είναι άδεια.');
  if (b64.length * 0.75 > CONFIG.MEDIA.MAX_MB * 1048576) throw new Error('Η φωτογραφία ξεπερνά τα ' + CONFIG.MEDIA.MAX_MB + ' MB.');
  const bytes = Utilities.base64Decode(b64);
  const real = sniffType_(bytes);
  if (!IMG_RE.test(real)) throw new Error('Δεκτές μόνο φωτογραφίες (JPG, PNG, HEIC, WEBP).');

  const m = mediaFolder_(p, true, agent);
  const existing = mediaList_(m);
  let base = String(d.name || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#%]+/g, ' ').trim().slice(0, 60);
  if (!base) base = 'Φωτογραφία ' + String(existing.length + 1).padStart(2, '0');
  const name = freeName_(base, existing) + (EXT_BY_MIME[real] || '.jpg');
  const prevCover = coverOf_(p.code, existing) || '-';
  m.createFile(Utilities.newBlob(bytes, real, name));
  mediaChanged_(p.code);
  log_('Φωτογραφία: ανέβηκε', agent.name, p.code);
  return mediaResult_(agent, p, m, prevCover);
}

function actMediaDelete_(agent, d) {
  const p = myProp_(agent, d.code);
  const hit = mediaFile_(p, d.id);
  trashFile_(hit.file, hit.folder);
  mediaChanged_(p.code);
  log_('Φωτογραφία: διαγράφηκε', agent.name, p.code);
  return mediaResult_(agent, p, hit.folder, true);
}

function actMediaCover_(agent, d) {
  const p = myProp_(agent, d.code);
  const hit = mediaFile_(p, d.id);
  PropertiesService.getScriptProperties().setProperty(coverKey_(p.code), hit.file.getId());
  mediaChanged_(p.code);
  return mediaResult_(agent, p, hit.folder, true);
}

/**
 * ▶ Φτιάχνει τον φάκελο MEDIA σε όσα ακίνητα έχουν ήδη φάκελο. Με όριο χρόνου:
 * αν δεν προλάβει όλα, ξανατρέξ' τη και συνεχίζει. Τρέχει και μέσα από τη setup().
 */
function setupMedia(budgetMs) {
  const t0 = Date.now(), budget = budgetMs || 270000;
  _docs = null;
  const docs = readDocs_();
  let made = 0, had = 0, left = 0;
  Object.keys(docs).forEach(k => {
    const rec = docs[k];
    if (!rec || !rec.folder) return;
    if (Date.now() - t0 > budget) { left++; return; }
    try {
      const propF = DriveApp.getFolderById(rec.folder);
      if (propF.isTrashed()) return;
      if (childByName_(propF, CONFIG.MEDIA.FOLDER)) { had++; return; }
      propF.createFolder(CONFIG.MEDIA.FOLDER);
      CacheService.getScriptCache().remove('mf:' + k);
      made++;
    } catch (e) { console.warn(k + ': ' + e.message); }
  });
  console.log('MEDIA: ' + made + ' νέοι φάκελοι, ' + had + ' υπήρχαν' + (left ? ', ' + left + ' έμειναν (ξανατρέξε setupMedia)' : '') + '.');
}

// ═════════════════════════════════════════════════════════════
//  ΠΑΡΟΥΣΙΑΣΗ ΑΚΙΝΗΤΟΥ ΓΙΑ ΤΟΝ ΠΕΛΑΤΗ (1.19)
// ═════════════════════════════════════════════════════════════
//  Ο μεσίτης στέλνει link (email ή WhatsApp). Ο πελάτης ανοίγει τη σελίδα p.html
//  χωρίς σύνδεση: στοιχεία, φωτογραφίες και τα στοιχεία επικοινωνίας του μεσίτη.
//  · Κλειδί 48 χαρακτήρων μετά το # (δεν φτάνει ποτέ στον server του GitHub).
//    Στο φύλλο κρατιέται ΜΟΝΟ το SHA-256 του.
//  · Λήγει σε PRESENTATION.DAYS ημέρες. Ακύρωση: Κατάσταση = «Ακυρώθηκε» στο φύλλο.
//  · ΧΩΡΙΣ στοιχεία πελάτη: το email / κινητό χρησιμοποιούνται μόνο για την αποστολή.
//  · Ο πελάτης δεν βλέπει ποτέ: ιδιοκτήτη, εντολή, συνεργάτη, σημειώσεις. Μόνο ό,τι
//    επιτρέπει το PRESENTATION (λίστα επικεφαλίδων ή ασφαλής αυτόματη επιλογή).

const PR_HEADERS = ['ID', 'Κλειδί (hash)', 'Κωδικός', 'Μεσίτης', 'Κλήση', 'Κανάλι', 'Δημιουργήθηκε',
  'Λήγει', 'Ανοίγματα', 'Πρώτο άνοιγμα', 'Τελευταίο άνοιγμα', 'Κατάσταση'];
const PRC = { ID: 1, HASH: 2, CODE: 3, AGENT: 4, LEAD: 5, CHANNEL: 6, CREATED: 7, EXPIRES: 8,
  OPENS: 9, FIRST: 10, LAST: 11, STATUS: 12 };
const PR = { ACTIVE: 'Ενεργή', CANCELLED: 'Ακυρώθηκε' };

// Αυτόματη επιλογή στηλών: δείχνουμε ό,τι μοιάζει με χαρακτηριστικό ακινήτου και
// ΠΟΤΕ ό,τι μοιάζει με προσωπικό ή εσωτερικό στοιχείο.
const PR_SAFE = /όροφ|υπνοδωμ|δωμάτ|μπάν|wc|κουζίν|σαλόν|έτος|κατασκευ|ανακαιν|θέρμαν|κλιματ|ενεργειακ|πεα|κλάση|parking|πάρκιν|στάθμευ|θέση|αποθήκ|ασανσέρ|ανελκυσ|μπαλκ|βεράντ|κήπ|πισίν|προσανατολ|θέα|επιπλωμ|διαθεσιμ|κουφώμ|δάπεδ|τζάκι|ηλιακ|πόρτα ασφαλ|συναγερμ|χαρακτηρ|περιγραφ|description|features|οικόπεδ|δόμηση|συντελεστ|απόσταση|μετρό|ζώνη/i;
const PR_NEVER = /ιδιοκτ|owner|τηλ|phone|κινητ|email|mail|αφμ|αδτ|ταυτότ|προμήθ|αμοιβ|εντολ|σημείωσ|σχόλι|notes|συνεργάτ|μεσίτ|agent|πηγή|link|url|drive|κλειδ|κωδικ|id$|ημ\/νία|ημερομ|λήξη|status|κατάστασ/i;

function presSheet_() { return ensureSheet_(CONFIG.SHEETS.PRESENT, PR_HEADERS); }

function presRows_() {
  const sh = presSheet_(), last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, PR_HEADERS.length).getValues()
    .map((v, i) => ({ row: i + 2, v: v })).filter(r => r.v[0]);
}
const prGet_ = (r, c) => r.v[c - 1];
function prWrite_(r) { presSheet_().getRange(r.row, 1, 1, PR_HEADERS.length).setValues([safeRow_(r.v)]); }

function presUrl_(token) { return CONFIG.APP_URL.replace(/\/?$/, '/') + 'p.html#' + token; }

/**
 * Μεσίτης: { code, leadId?, channel?, email?, name? } → νέο link.
 * channel 'email' + email → στέλνει και το email από εδώ (HTML, με το εξώφυλλο).
 * Οποιοδήποτε ακίνητο της ομάδας: τα στοιχεία επικοινωνίας είναι πάντα του μεσίτη που στέλνει.
 */
function actPresCreate_(agent, d) {
  const p = canSeeProp_(agent, d.code);
  if (!p.available) throw new Error('Το ακίνητο δεν είναι διαθέσιμο.');
  let leadId = '';
  if (d.leadId) {
    const l = myLeads_(agent).find(x => String(x.id) === String(d.leadId));
    if (l) leadId = l.id;
  }
  const channel = ['email', 'whatsapp', 'link'].indexOf(d.channel) !== -1 ? d.channel : 'link';
  const email = sfText_(d.email, 120).toLowerCase();
  if (channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw sfFail_('email', 'Γράψε σωστό email.');

  const token = randomHex_(48);
  const now = new Date();
  const expires = new Date(now.getTime() + CONFIG.PRESENTATION.DAYS * 86400000);
  const v = new Array(PR_HEADERS.length).fill('');
  v[PRC.ID - 1] = 'PR-' + randomHex_(8);
  v[PRC.HASH - 1] = sha256_(token);
  v[PRC.CODE - 1] = p.code;
  v[PRC.AGENT - 1] = agent.name;
  v[PRC.LEAD - 1] = leadId;
  v[PRC.CHANNEL - 1] = channel === 'link' ? '' : channel;
  v[PRC.CREATED - 1] = now;
  v[PRC.EXPIRES - 1] = expires;
  v[PRC.OPENS - 1] = 0;
  v[PRC.STATUS - 1] = PR.ACTIVE;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { presSheet_().appendRow(safeRow_(v)); } finally { lock.releaseLock(); }

  const url = presUrl_(token);
  const info = presInfo_(p);
  const me = presAgent_(agent);
  const hello = sfText_(d.name, 60);
  if (channel === 'email') presEmail_(email, hello, info, me, url, p);
  log_('Παρουσίαση: ' + (channel === 'email' ? 'email' : 'link'), agent.name, p.code + ' · ' + v[0]);

  const wa = (hello ? 'Καλησπέρα ' + hello + ', σ' : 'Σ') + 'ας στέλνω την παρουσίαση του ακινήτου «' + info.title + '»' +
    (info.price ? ' (' + info.price + ')' : '') + ':\n' + url + '\n\n' + me.name + (me.phone ? ' · ' + me.phone : '') + '\n' + CONFIG.OFFICE.name;
  return { id: v[0], url: url, expires: stamp_(expires), days: CONFIG.PRESENTATION.DAYS, text: wa, sent: channel === 'email' };
}

/** Ο μεσίτης πάτησε WhatsApp ή Αντιγραφή: μόνο για στατιστική. */
function actPresMark_(agent, d) {
  const r = presRows_().find(x => String(prGet_(x, PRC.ID)) === String(d.id) && norm_(prGet_(x, PRC.AGENT)) === norm_(agent.name));
  if (!r) return false;
  const ch = ['whatsapp', 'copy'].indexOf(d.channel) !== -1 ? d.channel : '';
  if (ch && !prGet_(r, PRC.CHANNEL)) { r.v[PRC.CHANNEL - 1] = ch; prWrite_(r); }
  return true;
}

/** Τα στοιχεία του μεσίτη που στέλνει, για την κάρτα επικοινωνίας. */
function presAgent_(agent) {
  const phone = String(agent.phone || '').replace(/[^\d+]/g, '');
  return { name: agent.smsName || agent.name, phone: agent.phone || '', tel: phone,
           wa: phone ? (phone.indexOf('+') === 0 ? phone.slice(1) : (/^69\d{8}$/.test(phone) ? '30' + phone : phone)) : '',
           email: agent.email || '' };
}

/** Επικεφαλίδες του «Διαθέσιμα ακίνητα» που φαίνονται στον πελάτη. */
function presColumns_(headers) {
  const inc = (CONFIG.PRESENTATION.INCLUDE || []).map(norm_);
  const fixed = Object.keys(PCOL).map(k => colIdx_(PCOL[k]));
  const out = [];
  headers.forEach((h, i) => {
    const name = String(h || '').trim();
    if (!name || fixed.indexOf(i + 1) !== -1) return;
    const ok = inc.length ? inc.indexOf(norm_(name)) !== -1 : (PR_SAFE.test(name) && !PR_NEVER.test(name));
    if (ok) out.push({ col: i + 1, name: name });
  });
  return out;
}

/** Ό,τι βλέπει ο πελάτης για το ακίνητο. */
function presInfo_(p) {
  const facts = [];
  const add = (k, v) => { v = String(v == null ? '' : v).trim(); if (v && v !== '0') facts.push([k, v]); };
  add('Συναλλαγή', p.deal);
  add('Τύπος', p.type);
  add('Εμβαδόν', p.sqm ? p.sqm + ' τ.μ.' : '');
  add('Περιοχή', p.area);
  let description = '';
  try {
    const sh = getSS().getSheetByName(CONFIG.SHEETS.PROPS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const cols = presColumns_(headers);
    if (cols.length) {
      const idCol = colIdx_(PCOL.ID);
      const ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getValues();
      let rowIdx = -1;
      ids.forEach((r, i) => { if (normCode_(r[0]) === normCode_(p.code)) rowIdx = i + 2; });
      if (rowIdx > 0) {
        const row = sh.getRange(rowIdx, 1, 1, sh.getLastColumn()).getValues()[0];
        cols.forEach(c => {
          const raw = row[c.col - 1];
          const val = raw instanceof Date ? fmtDate_(raw) : typeof raw === 'boolean' ? (raw ? 'Ναι' : '') : cellText_(raw);
          if (/περιγραφ|description/i.test(c.name)) description = String(val || '').slice(0, 3000);
          else add(c.name, val);
        });
      }
    }
  } catch (e) { console.warn('Παρουσίαση, στήλες: ' + e.message); }
  const address = CONFIG.PRESENTATION.SHOW_ADDRESS ? [p.street, p.area].filter(Boolean).join(', ') : (p.area || '');
  return { code: p.code, title: p.title || [p.type, p.area].filter(Boolean).join(' · ') || 'Ακίνητο',
           deal: p.deal || '', price: fmtEur_(p.price) + (/ενοικ/i.test(norm_(p.deal)) && p.price ? ' / μήνα' : ''),
           sqm: p.sqm || '', area: p.area || '', address: address,
           mapQuery: address ? address + (CONFIG.PRESENTATION.CITY ? ', ' + CONFIG.PRESENTATION.CITY : '') : '',
           facts: facts, description: description };
}

function presEmail_(to, hello, info, me, url, p) {
  const red = '#b40101';
  const e = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let cover = null;
  try {
    const m = mediaFolder_(p, false);
    const id = coverOf_(p.code, mediaList_(m));
    if (id) {
      const img = imageData_(DriveApp.getFileById(id), 1000);
      if (img) cover = Utilities.newBlob(Utilities.base64Decode(img.data), img.mime, 'cover');
    }
  } catch (err) { console.warn('Παρουσίαση, εξώφυλλο email: ' + err.message); }
  const logo = CONFIG.APP_URL.replace(/\/?$/, '/') + CONFIG.PRESENTATION.LOGO;
  const facts = info.facts.slice(0, 6).map(f => '<td style="padding:8px 12px 8px 0;font:14px Arial,sans-serif;color:#555">' +
    e(f[0]) + '<br><b style="font-size:16px;color:#111">' + e(f[1]) + '</b></td>');
  const rows = [];
  for (let i = 0; i < facts.length; i += 3) rows.push('<tr>' + facts.slice(i, i + 3).join('') + '</tr>');
  const html =
    '<div style="background:#f3f3f1;padding:24px 0">' +
    '<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-collapse:collapse">' +
    '<tr><td style="padding:18px 24px;border-bottom:4px solid ' + red + '"><img src="' + e(logo) + '" alt="' + e(CONFIG.OFFICE.name) + '" height="40" style="display:block;height:40px;border:0"></td></tr>' +
    (cover ? '<tr><td><a href="' + e(url) + '"><img src="cid:cover" width="600" alt="" style="display:block;width:100%;height:auto;border:0"></a></td></tr>' : '') +
    '<tr><td style="padding:24px">' +
    '<p style="margin:0 0 16px;font:16px Arial,sans-serif;color:#111">' + (hello ? 'Καλησπέρα ' + e(hello) + ',' : 'Καλησπέρα,') + '</p>' +
    '<p style="margin:0 0 20px;font:16px Arial,sans-serif;color:#111">σας στέλνω την παρουσίαση του ακινήτου που συζητήσαμε.</p>' +
    (info.deal ? '<span style="display:inline-block;background:' + red + ';color:#fff;font:bold 12px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px">' + e(info.deal) + '</span>' : '') +
    '<h1 style="margin:10px 0 4px;font:bold 24px Arial,sans-serif;color:#111">' + e(info.title) + '</h1>' +
    (info.address ? '<p style="margin:0 0 8px;font:15px Arial,sans-serif;color:#555">' + e(info.address) + '</p>' : '') +
    (info.price ? '<p style="margin:0 0 16px;font:bold 26px Arial,sans-serif;color:#111">' + e(info.price) + '</p>' : '') +
    (rows.length ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">' + rows.join('') + '</table>' : '') +
    '<a href="' + e(url) + '" style="display:inline-block;background:' + red + ';color:#fff;text-decoration:none;font:bold 17px Arial,sans-serif;padding:14px 26px;border-radius:6px">Δείτε την παρουσίαση και τις φωτογραφίες</a>' +
    '<p style="margin:16px 0 0;font:13px Arial,sans-serif;color:#777">Το link ισχύει για ' + CONFIG.PRESENTATION.DAYS + ' ημέρες.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 24px;background:#111;color:#fff;font:15px Arial,sans-serif">' +
    '<b style="font-size:17px">' + e(me.name) + '</b><br><span style="color:#ccc">' + e(CONFIG.OFFICE.name) + '</span><br>' +
    (me.phone ? '<a href="tel:' + e(me.tel) + '" style="color:#fff">' + e(me.phone) + '</a><br>' : '') +
    (me.email ? '<a href="mailto:' + e(me.email) + '" style="color:#fff">' + e(me.email) + '</a>' : '') +
    '</td></tr></table></div>';
  const text = (hello ? 'Καλησπέρα ' + hello + ',' : 'Καλησπέρα,') + '\n\nσας στέλνω την παρουσίαση του ακινήτου «' + info.title + '»' +
    (info.price ? ' (' + info.price + ')' : '') + ':\n' + url + '\n\n' + me.name + '\n' + CONFIG.OFFICE.name +
    (me.phone ? '\n' + me.phone : '') + (me.email ? '\n' + me.email : '');
  const opts = { to: to, name: me.name + ' · ' + CONFIG.OFFICE.name, subject: info.title + (info.price ? ' · ' + info.price : ''),
                 body: text, htmlBody: html };
  if (me.email) opts.replyTo = me.email;
  if (cover) opts.inlineImages = { cover: cover };
  MailApp.sendEmail(opts);
}

// ── Δημόσιο: η σελίδα του πελάτη ───────────────────────────

function presGuard_() {
  if (Number(CacheService.getScriptCache().get('pr:bad') || 0) >= 40) {
    throw err_('Πολλές λάθος προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.', 'closed');
  }
}

/** Η γραμμή του κλειδιού, μόνο αν ισχύει. */
function presRow_(token) {
  presGuard_();
  const t = String(token || '').trim();
  const hash = /^[0-9a-f]{48}$/.test(t) ? sha256_(t) : '';
  const r = hash ? presRows_().find(x => prGet_(x, PRC.HASH) === hash) : null;
  if (!r) {
    const c = CacheService.getScriptCache();
    c.put('pr:bad', String(Number(c.get('pr:bad') || 0) + 1), 900);
    throw err_('Το link δεν είναι έγκυρο. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  }
  if (prGet_(r, PRC.STATUS) !== PR.ACTIVE) throw err_('Η παρουσίαση δεν είναι πια διαθέσιμη. Επικοινωνήστε με τον μεσίτη σας.', 'closed');
  if (ts_(prGet_(r, PRC.EXPIRES)) < Date.now()) throw err_('Το link έληξε. Ζητήστε νέο από τον μεσίτη σας.', 'expired');
  return r;
}

function presProp_(r) {
  const p = readProps_()[normCode_(prGet_(r, PRC.CODE))];
  if (!p || !p.available) throw err_('Το ακίνητο δεν είναι πια διαθέσιμο. Επικοινωνήστε με τον μεσίτη σας για παρόμοια.', 'gone');
  return p;
}

/** { k } → όλα όσα δείχνει η σελίδα, με το εξώφυλλο έτοιμο. Το πρώτο άνοιγμα ειδοποιεί τον μεσίτη. */
function actPresOpen_(d) {
  const r = presRow_(d.k);
  const p = presProp_(r);
  const agent = readAgents_().find(a => norm_(a.name) === norm_(prGet_(r, PRC.AGENT)));
  const first = !prGet_(r, PRC.FIRST);
  r.v[PRC.OPENS - 1] = (Number(prGet_(r, PRC.OPENS)) || 0) + 1;
  if (first) r.v[PRC.FIRST - 1] = new Date();
  r.v[PRC.LAST - 1] = new Date();
  try { prWrite_(r); } catch (e) { /* όχι κρίσιμο */ }
  if (first && agent) {
    try {
      const lead = String(prGet_(r, PRC.LEAD) || '');
      const go = lead || 'go:prop:' + p.code;
      pushToAgent_(agent, { type: 'presopen', id: go, tag: 'pr-' + prGet_(r, PRC.ID), url: '?lead=' + encodeURIComponent(go),
        title: 'Ο πελάτης άνοιξε την παρουσίαση', body: (p.street || p.title || p.code) + (lead ? ' · πάτα για την κλήση' : '') });
    } catch (e) { console.warn('Παρουσίαση, ειδοποίηση: ' + e.message); }
  }
  const m = mediaFolder_(p, false);
  const list = mediaList_(m);
  const cover = coverOf_(p.code, list);
  let coverSrc = '';
  if (cover) { try { coverSrc = dataUri_(imageCached_(DriveApp.getFileById(cover), 'm')); } catch (e) { /* χωρίς εικόνα */ } }
  const photos = cover ? [cover].concat(list.map(x => x.id).filter(id => id !== cover)) : [];
  return {
    prop: presInfo_(p), photos: photos.slice(0, CONFIG.PRESENTATION.MAX_PHOTOS), coverSrc: coverSrc,
    agent: agent ? presAgent_(agent) : { name: CONFIG.OFFICE.name, phone: CONFIG.OFFICE.phone, tel: CONFIG.OFFICE.phone.replace(/[^\d+]/g, ''), wa: '', email: CONFIG.OFFICE.email },
    office: { name: CONFIG.OFFICE.name, phone: CONFIG.OFFICE.phone, address: CONFIG.PRESENTATION.OFFICE_ADDRESS || '',
              site: CONFIG.PRESENTATION.OFFICE_SITE || '' },
    expires: fmtDate_(prGet_(r, PRC.EXPIRES))
  };
}

/** { k, id | ids, size } → εικόνες, μόνο από το MEDIA του ακινήτου της παρουσίασης. */
function actPresImg_(d) {
  const r = presRow_(d.k);
  const p = presProp_(r);
  const size = MEDIA_PX[d.size] ? d.size : 'l';
  const ok = {};
  mediaList_(mediaFolder_(p, false)).forEach(x => { ok[x.id] = true; });
  const one = id => {
    if (!ok[id]) throw err_('Η φωτογραφία δεν βρέθηκε.', 'img');
    return dataUri_(imageCached_(DriveApp.getFileById(id), size));
  };
  if (Array.isArray(d.ids)) {
    const t0 = Date.now(), items = [], pending = [];
    d.ids.slice(0, 40).forEach(id => {
      if (Date.now() - t0 > 18000) { pending.push(id); return; }
      try { items.push({ id: id, src: one(id) }); } catch (e) { items.push({ id: id, src: '' }); }
    });
    return { items: items, pending: pending };
  }
  return { id: d.id, src: one(d.id) };
}

/** ▶ Ποιες στήλες του «Διαθέσιμα ακίνητα» θα δει ο πελάτης. Τρέξ' τη πριν στείλεις την πρώτη. */
function presentationCheck() {
  const sh = getSS().getSheetByName(CONFIG.SHEETS.PROPS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const shown = presColumns_(headers).map(c => c.name);
  const lines = ['Παρουσίαση πελάτη: πάντα Τίτλος, Συναλλαγή, Τύπος, Εμβαδόν, Περιοχή, Τιμή, φωτογραφίες.',
    'Διεύθυνση (οδός): ' + (CONFIG.PRESENTATION.SHOW_ADDRESS ? 'ΝΑΙ' : 'όχι, μόνο η περιοχή') + '.',
    (CONFIG.PRESENTATION.INCLUDE || []).length ? 'Επιπλέον (από PRESENTATION.INCLUDE):' : 'Επιπλέον (αυτόματα):'];
  shown.forEach(n => lines.push('  ✓ ' + n));
  lines.push('', 'ΔΕΝ φαίνονται:');
  headers.forEach(h => { const n = String(h || '').trim(); if (n && shown.indexOf(n) === -1) lines.push('  · ' + n); });
  lines.push('', 'Για να αλλάξεις τι φαίνεται, γράψε τις επικεφαλίδες που θέλεις στο CONFIG.PRESENTATION.INCLUDE.');
  console.log(lines.join('\n'));
}

function ensureSheet_(name, headers) {
  const ss = getSS();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#f5f5f3');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    // Φύλλο από προηγούμενη έκδοση: προσθέτουμε μόνο τις στήλες που λείπουν.
    const from = sh.getLastColumn() + 1;
    sh.getRange(1, from, 1, headers.length - from + 1)
      .setValues([headers.slice(from - 1)]).setFontWeight('bold').setBackground('#f5f5f3');
  }
  return sh;
}

/**
 * Μία φορά (και ξανά όποτε προσθέσεις μεσίτη). Δεν σβήνει τίποτα.
 *  · Φτιάχνει το φύλλο «Εφαρμογή».
 *  · Προσθέτει στο Agents τις στήλες Κλειδί, Όνομα SMS, Κινητό, Link.
 *  · Δίνει κλειδί σε όποιον μεσίτη δεν έχει.
 *  · Βάζει τον trigger των υπενθυμίσεων.
 *  · Γράφει στο log τα προσωπικά links.
 */
function setup() {
  [CONFIG.SHEETS.AGENTS, CONFIG.SHEETS.PROPS].forEach(sheet_);

  ensureSheet_(CONFIG.SHEETS.APP, APP_HEADERS);
  ensureSheet_(CONFIG.SHEETS.DEVICES, ['Token', 'Μεσίτης', 'Συσκευή', 'Ενεργοποίηση', 'Πρόσβαση']);
  const accSh = ensureSheet_(CONFIG.SHEETS.ACCESS, ACCESS_HEADERS);
  ensureSheet_(CONFIG.SHEETS.LOG, ['Ώρα', 'Συμβάν', 'Μεσίτης', 'Λεπτομέρειες']);
  try {
    // Λίστα επιλογών στη στήλη Κατάσταση: ο διαχειριστής ανακαλεί με ένα κλικ.
    accSh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList([ACC.ACTIVE, ACC.REVOKED, ACC.LOGOUT, ACC.EXPIRED], true).build());
  } catch (e) { /* όχι κρίσιμο */ }
  ensureSheet_(CONFIG.SHEETS.NOTIFIED, ['ID κλήσης', 'Ώρα', 'Αποτέλεσμα']);
  ensureSheet_(CONFIG.SHEETS.DOCS, docHeaders_());
  ensureSheet_(CONFIG.SHEETS.TASKS, TASK_HEADERS);
  ensureSheet_(CONFIG.SHEETS.SHOWFORM, SF_HEADERS);
  ensureSheet_(CONFIG.SHEETS.REFERRALS, REF_HEADERS);
  ensureSheet_(CONFIG.SHEETS.REVIEW, RV_HEADERS);
  ensureSheet_(CONFIG.SHEETS.PRESENT, PR_HEADERS);
  ensureSheet_(CONFIG.SHEETS.CALLS, CL_HEADERS);        // 1.20
  ensureSheet_(CONFIG.SHEETS.OFFERS, OF_HEADERS);
  try { setupMedia(60000); } catch (e) { console.warn('MEDIA: ' + e.message); }   // 1.18
  showingTemplateCheck();
  offerTemplateCheck();
  referralTemplateCheck();
  ensureContactSheets_();
  if (CONFIG.MAP.ENABLED) ensureSheet_(CONFIG.SHEETS.MAP, MAP_HEADERS);

  // Φάκελος «Συνεργάτες»: αν δεν έχει οριστεί, ένας δοκιμαστικός στο Drive σου.
  const sp = PropertiesService.getScriptProperties();
  if (!CONFIG.DRIVE_ROOT_ID && !sp.getProperty('DRIVE_ROOT_ID')) {
    const test = DriveApp.createFolder('Συνεργάτες (δοκιμή KW App)');
    sp.setProperty('DRIVE_ROOT_ID', test.getId());
    console.log('Φτιάχτηκε δοκιμαστικός φάκελος Συνεργάτες: ' + test.getUrl());
  }

  // Στήλες στο Agents
  const ag = sheet_(CONFIG.SHEETS.AGENTS);
  let cols = agentCols_(ag);
  ['KEY', 'SMS_NAME', 'PHONE', 'LINK', 'PREFS', 'FOLDER', 'ACTIVE', 'FORM_EMAIL'].forEach(k => {
    if (cols[k]) return;
    const c = ag.getLastColumn() + 1;
    ag.getRange(1, c).setValue(AGENT_HEADERS[k]).setFontWeight('bold');
    cols = agentCols_(ag);
    if (k === 'ACTIVE' && ag.getLastRow() > 1) {
      // Νέα στήλη: όλοι ενεργοί. Ξετσεκάρισμα = κλείδωμα.
      const r = ag.getRange(2, c, ag.getLastRow() - 1, 1);
      try { r.insertCheckboxes(); } catch (e) { /* όχι κρίσιμο */ }
      r.setValues(r.getValues().map(() => [true]));
    }
  });

  setupAdmin();                         // 1.17: στήλη «Ρόλος» και φύλλο «Έλεγχος εντύπων»

  // Κλειδιά
  _agents = null;
  readAgents_().forEach(a => {
    if (a.key) return;
    a.key = Utilities.getUuid().replace(/-/g, '');
    ag.getRange(a.row, cols.KEY).setValue(a.key);
  });

  // Triggers
  ScriptApp.getProjectTriggers()
    .filter(t => ['sendShowingReminders', 'checkNewLeads', 'syncDriveFolders', 'docsReminder', 'geocodeProps', 'morningBrief', 'formReminder']
                   .indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  const dr = CONFIG.DOCS_REMINDER;
  if (dr.EVERY === 'day') {
    ScriptApp.newTrigger('docsReminder').timeBased().everyDays(1).atHour(dr.HOUR).create();
  } else {
    ScriptApp.newTrigger('docsReminder').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(dr.HOUR).create();
  }
  ScriptApp.newTrigger('sendShowingReminders').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('morningBrief').timeBased().everyDays(1).atHour(CONFIG.MORNING.HOUR).create();
  ScriptApp.newTrigger('formReminder').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(CONFIG.FORM_REMINDER_HOUR).create();
  ScriptApp.newTrigger('checkNewLeads').timeBased().everyMinutes(CONFIG.NEW_LEAD_CHECK_MIN).create();
  ScriptApp.newTrigger('syncDriveFolders').timeBased().everyHours(6).create();
  if (CONFIG.MAP.ENABLED) ScriptApp.newTrigger('geocodeProps').timeBased().everyHours(1).create();

  // Πρώτος έλεγχος: σημειώνει τις υπάρχουσες κλήσεις ως «υπήρχε πριν»,
  // ώστε να μη φύγουν εκατοντάδες ειδοποιήσεις με την ενεργοποίηση.
  checkNewLeads();

  console.log('Έτοιμο. Φύλλα «' + CONFIG.SHEETS.APP + '», «' + CONFIG.SHEETS.DEVICES + '», «' +
              CONFIG.SHEETS.NOTIFIED + '», triggers υπενθυμίσεων και νέων κλήσεων.\n' +
              'Ειδοποιήσεις (Firebase): ' + (fcmConfig_() ? 'ρυθμισμένες ✓'
                : 'ΔΕΝ έχουν ρυθμιστεί — βάλε το FCM_SERVICE_ACCOUNT στα Script properties') + '\n' +
              'SMS υπενθύμισης: ' + CONFIG.SMS_MODE + '\n' +
              'Φάκελος Συνεργάτες: ' + driveRoot_().getUrl());

  // Φάκελοι Drive για όσα ακίνητα δεν έχουν ακόμα (έως 2' εδώ· τα υπόλοιπα από τον trigger).
  syncDriveFolders(120000);
  if (CONFIG.MAP.ENABLED) { geocodeProps(); mapCheck(); }
  contactsBackfill();
  contactsCheck();
  agentLinks();
}

/** Δοκιμή από τον editor: ειδοποίηση σε όλες τις συσκευές όλων των μεσιτών. */
function testPush() {
  _agents = null;
  readAgents_().forEach(a => {
    const n = agentDevices_(a).length;
    if (!n) return console.log(a.name + ': καμία συσκευή');
    console.log(a.name + ': ' + pushToAgent_(a, { type: 'test', id: '', tag: 'test', url: './',
      title: 'KW App', body: 'Δοκιμαστική ειδοποίηση' }) + '/' + n);
  });
}

/** Τα προσωπικά links και αν ο καθένας έχει μοιραστεί το ημερολόγιό του. */
function agentLinks() {
  _agents = null;
  const lines = ['Λογαριασμός εφαρμογής (σε αυτόν μοιράζονται τα ημερολόγια): ' + ownerEmail_(), ''];
  readAgents_().forEach(a => {
    const cal = calendarStatus_(a);
    lines.push(a.name + ' <' + (a.email || 'χωρίς email') + '>');
    lines.push('   ' + (a.key ? CONFIG.APP_URL + '?k=' + a.key : 'ΧΩΡΙΣ ΚΛΕΙΔΙ — τρέξε setup()'));
    lines.push('   Ημερολόγιο: ' + (cal.own ? 'ίδιος λογαριασμός' : cal.shared ? 'μοιρασμένο ✓' : 'ΔΕΝ έχει μοιραστεί — θα παίρνει προσκλήσεις'));
  });
  console.log(lines.join('\n'));
}

/** Τι βλέπει ο κώδικας: πόσες κλήσεις ανά μεσίτη, πόσες χωρίς μεσίτη, πόσα ακίνητα. */
function diagnose() {
  const leads = readLeads_();
  const props = readProps_();
  const team = teamNames_();

  const lines = ['Μήνες: ' + monthNames_().join(', ') + ' · κλήσεις: ' + leads.length,
                 'Ακίνητα στο φύλλο: ' + Object.keys(props).length, ''];

  readAgents_().forEach(a => {
    const mine = leads.filter(l => isMine_(a, l));
    const open = mine.filter(l => statusOf_(l.id) === STATUS.PENDING).length;
    const avail = Object.keys(props).filter(k => props[k].available && norm_(props[k].partner) === norm_(a.name)).length;
    lines.push(a.name + ': ' + mine.length + ' κλήσεις (' + open + ' αναπάντητες), ' + avail + ' διαθέσιμα ακίνητα');
  });

  const noProp = leads.filter(l => !props[normCode_(l.code)]).length;
  const otherTeam = leads.filter(l => {
    const o = ownerOf_(l);
    return o && team.indexOf(norm_(o)) === -1;
  }).length;
  lines.push('', 'Κλήσεις με κωδικό που δεν υπάρχει στα Διαθέσιμα ακίνητα: ' + noProp,
             'Κλήσεις για ακίνητα συνεργατών εκτός Agents: ' + otherTeam);

  console.log(lines.join('\n'));
}


// ═════════════════════════════════════════════════════════════
//  1.20 · ΙΣΤΟΡΙΚΟ ΚΛΗΣΕΩΝ
// ═════════════════════════════════════════════════════════════
// Κάθε «Κλήση» από την εφαρμογή στέλνει ένα κλειδί κλήσης (cid, 12 hex) που φτιάχνει η σελίδα.
// Ο server γράφει μια γραμμή. Όταν ο μεσίτης γυρίσει στην εφαρμογή, γράφει σημείωση για
// ΑΥΤΗ την κλήση (callNote). Αν το beacon χάθηκε, η σημείωση φτιάχνει τη γραμμή.
// Σε σημειώσεις σβήνονται αριθμοί που μοιάζουν με Α.Δ.Τ. ή ΑΦΜ (scrubIds_).

const CL_HEADERS = ['ID', 'Κλήση', 'Μεσίτης', 'Ημερομηνία', 'Αποτέλεσμα', 'Σημείωση', 'Ενημέρωση'];
const CLC = { ID: 1, LEAD: 2, AGENT: 3, AT: 4, RESULT: 5, NOTE: 6, UPDATED: 7 };
const CL_RESULTS = ['Μιλήσαμε', 'Δεν απάντησε'];

function clSheet_() { return ensureSheet_(CONFIG.SHEETS.CALLS, CL_HEADERS); }

function clRows_() {
  const sh = clSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, CL_HEADERS.length).getValues()
    .map((v, i) => ({ row: i + 2, v: v }))
    .filter(r => r.v[CLC.ID - 1]);
}

function clValidId_(cid) { return /^[0-9a-f]{12}$/.test(String(cid || '')); }

function clView_(r) {
  const at = r.v[CLC.AT - 1];
  return { id: String(r.v[CLC.ID - 1]).replace(/^C-/, ''), at: stamp_(at), ts: ts_(at),
           result: String(r.v[CLC.RESULT - 1] || ''), note: String(r.v[CLC.NOTE - 1] || '') };
}

/** Οι κλήσεις μιας κλήσης-πελάτη, παλαιότερη πρώτη. Το φύλλο διαβάζεται μία φορά ανά εκτέλεση. */
let CL_MAP_ = null;
function callsOf_(leadId) {
  if (!CL_MAP_) {
    CL_MAP_ = {};
    try {
      clRows_().forEach(r => { const k = String(r.v[CLC.LEAD - 1]); (CL_MAP_[k] = CL_MAP_[k] || []).push(r); });
    } catch (e) { console.warn('Ιστορικό κλήσεων: ' + e.message); }
  }
  return (CL_MAP_[String(leadId)] || []).map(clView_).sort((a, b) => a.ts - b.ts).slice(-CONFIG.CALL_LOG.MAX_SHOWN);
}

/** Νέα γραμμή (μία φορά ανά cid). Καλείται από το «called». */
function clAdd_(agent, leadId, cid, at) {
  if (!clValidId_(cid)) return null;
  const id = 'C-' + cid;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    CL_MAP_ = null;
    const have = clRows_().find(r => r.v[CLC.ID - 1] === id);
    if (have) return have;
    clSheet_().appendRow(safeRow_([id, leadId, agent.name, at || new Date(), '', '', '']));
    return null;
  } finally {
    lock.releaseLock();
  }
}

function clAddSafe_(agent, leadId, cid, at) {
  try { clAdd_(agent, leadId, cid, at); } catch (e) { console.warn('Ιστορικό κλήσεων: ' + e.message); }
}

/** Καθαρό κείμενο σημείωσης: κρατά τις αλλαγές γραμμής, σβήνει Α.Δ.Τ./ΑΦΜ. */
function clText_(v) {
  const raw = String(v == null ? '' : v).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, CONFIG.CALL_LOG.NOTE_MAX);
  const clean = scrubIds_(raw);
  return { text: clean, masked: clean !== raw };
}

/**
 * Σημείωση για μία κλήση: { id (κλήση-πελάτη), cid, result ('Μιλήσαμε'|'Δεν απάντησε'|''), note }.
 * Επιστρέφει { call, lead, masked }.
 */
function actCallNote_(agent, d) {
  const l = findMyLead_(agent, d.id);
  if (!clValidId_(d.cid)) throw new Error('Δεν βρέθηκε η κλήση.');
  const result = CL_RESULTS.indexOf(String(d.result || '')) !== -1 ? String(d.result) : '';
  const note = clText_(d.note);
  const id = 'C-' + d.cid;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row;
  try {
    CL_MAP_ = null;
    const sh = clSheet_();
    row = clRows_().find(r => r.v[CLC.ID - 1] === id);
    if (row && (String(row.v[CLC.LEAD - 1]) !== l.id || norm_(row.v[CLC.AGENT - 1]) !== norm_(agent.name))) {
      throw new Error('Δεν βρέθηκε η κλήση.');
    }
    const now = new Date();
    if (!row) {                                   // το beacon δεν έφτασε: η σημείωση φτιάχνει τη γραμμή
      const at = d.at && ts_(new Date(Number(d.at))) && Math.abs(Date.now() - Number(d.at)) < 864e5
        ? new Date(Number(d.at)) : now;
      sh.appendRow(safeRow_([id, l.id, agent.name, at, result, note.text, now]));
      row = { v: [id, l.id, agent.name, at, result, note.text, now] };
    } else {
      sh.getRange(row.row, CLC.RESULT, 1, 3).setValues([safeRow_([result, note.text, now])]);
      row.v[CLC.RESULT - 1] = result; row.v[CLC.NOTE - 1] = note.text; row.v[CLC.UPDATED - 1] = now;
    }
    CL_MAP_ = null;
  } finally {
    lock.releaseLock();
  }
  return { call: clView_(row), lead: serialize_(l), masked: note.masked };
}


// ═════════════════════════════════════════════════════════════
//  1.20 · ΤΙΜΟΛΟΓΗΣΗ: ΕΠΙΛΟΓΗ ΑΠΟ ΤΑ ΕΝΤΥΠΑ ΤΟΥ ΑΚΙΝΗΤΟΥ
// ═════════════════════════════════════════════════════════════
// Στις θέσεις με «pick» (Υπόδειξη, Προσφορά) η εφαρμογή δείχνει τα PDF του φακέλου
// «Υποδείξεις» / «Προσφορές» του ακινήτου. Με ένα πάτημα μπαίνει αντίγραφο στην Τιμολόγηση.
// Το αντίγραφο κρατά στην περιγραφή του το ID του πρωτότυπου: έτσι ξέρουμε ποια έχουν
// ήδη μπει, και ο έλεγχος του Admin στο πρωτότυπο ισχύει και για το αντίγραφο.

function pickFolderName_(pick) {
  return pick === 'showform' ? CONFIG.SHOWING_FORM.FOLDER : pick === 'offerform' ? CONFIG.OFFER.FOLDER : '';
}

/** Α/Α και τρόπος υπογραφής ανά αρχείο, από τα φύλλα των εντύπων. */
function formFileInfo_() {
  const m = {};
  try {
    sfRows_().forEach(r => {
      const f = String(sfGet_(r, SFC.FILE) || '');
      if (f) m[f] = { aa: String(sfGet_(r, SFC.AA) || ''), signed: sfGet_(r, SFC.MODE) === 'Οθόνη' };
    });
  } catch (e) { /* χωρίς φύλλο */ }
  try {
    ofRows_().forEach(r => {
      const f = String(ofGet_(r, OFC.FILE) || '');
      if (f) m[f] = { aa: String(ofGet_(r, OFC.AA) || ''), signed: true };
    });
  } catch (e) { /* χωρίς φύλλο */ }
  return m;
}

const COPY_RE = /Αντίγραφο του ([A-Za-z0-9_-]+)/;

/**
 * Για κάθε θέση με pick: τα έντυπα του φακέλου (νεότερο πρώτο), με «used» αν έχουν ήδη μπει.
 * Επίσης: αντίγραφο χωρίς δικό του έλεγχο παίρνει τον έλεγχο του πρωτότυπου.
 */
function billPicks_(f, docs) {
  const out = {};
  const slots = CONFIG.BILLING.DOCS.filter(s => s.pick);
  if (!slots.length) return out;
  let rvMap = null, info = null;
  slots.forEach(s => {
    out[s.key] = [];
    try {
      const used = {};
      (docs[s.key] || []).forEach(x => {
        let desc = '';
        try { desc = String(DriveApp.getFileById(x.id).getDescription() || ''); } catch (e) { return; }
        const m = COPY_RE.exec(desc);
        if (!m) return;
        used[m[1]] = x.name;
        if (!x.review) {
          if (!rvMap) { try { rvMap = rvByFile_(); } catch (e) { rvMap = {}; } }
          const r = rvMap[m[1]];
          if (r && rvOpen_(rvGet_(r, RVC.STATUS))) x.review = rvBrief_(r);
        }
      });
      const src = childByName_(f.folder, pickFolderName_(s.pick));
      if (!src) return;
      if (!info) info = formFileInfo_();
      const it = src.getFiles();
      const list = [];
      while (it.hasNext()) {
        const x = it.next();
        if (x.isTrashed() || !/^application\/pdf$|^image\//.test(x.getMimeType())) continue;
        const created = x.getDateCreated();
        const fi = info[x.getId()] || {};
        list.push({ id: x.getId(), name: x.getName(), date: stamp_(created), ts: created.getTime(), url: x.getUrl(),
                    aa: fi.aa || '', signed: fi.signed === true ? 'yes' : fi.signed === false ? 'no' : '',
                    used: used[x.getId()] || '' });
      }
      out[s.key] = list.sort((a, b) => b.ts - a.ts).slice(0, 30);
    } catch (e) { console.warn('Τιμολόγηση, έντυπα: ' + e.message); }
  });
  return out;
}

/**
 * Αντίγραφο ενός εντύπου του ακινήτου στην Τιμολόγηση: { code, slot, fileId, mode }.
 * Μόνο αρχεία που είναι μέσα στον φάκελο «Υποδείξεις»/«Προσφορές» του ΙΔΙΟΥ ακινήτου.
 */
function actBillPick_(agent, d) {
  const p = myProp_(agent, d.code);
  const slot = CONFIG.BILLING.DOCS.find(s => s.key === d.slot && s.pick);
  if (!slot) throw new Error('Άγνωστη θέση της Τιμολόγησης.');
  const f = propFolders_(agent, p);
  const srcF = childByName_(f.folder, pickFolderName_(slot.pick));
  if (!srcF) throw new Error('Δεν υπάρχει φάκελος «' + pickFolderName_(slot.pick) + '» στο ακίνητο.');

  let file;
  try { file = DriveApp.getFileById(String(d.fileId || '')); } catch (e) { throw new Error('Δεν βρέθηκε το έντυπο.'); }
  let inside = false;
  const ps = file.getParents();
  while (ps.hasNext()) if (ps.next().getId() === srcF.getId()) inside = true;
  if (!inside || file.isTrashed()) throw new Error('Το έντυπο δεν είναι στον φάκελο του ακινήτου.');

  const bill = billFolder_(f.folder, true);
  const existing = listDocs_(bill, CONFIG.BILLING.DOCS)[slot.key];
  const mode = d.mode === 'replace' || d.mode === 'keep' ? d.mode : (slot.multi ? 'keep' : 'replace');
  if (mode === 'replace') {
    existing.forEach(x => { try { trashFile_(DriveApp.getFileById(x.id), bill); } catch (e) { /* ήδη σβησμένο */ } });
  }
  const base = mode === 'replace' ? slotFileName_(slot, p) : freeName_(slotFileName_(slot, p), existing);
  const ext = (file.getName().match(/\.[^.]+$/) || ['.pdf'])[0];
  const copy = file.makeCopy(base + ext, bill);
  try {
    copy.setDescription(COPY_TAG + file.getId() + ' («' + file.getName() + '») · από ' + agent.name + ' στις ' + stamp_(new Date()));
  } catch (e) { /* όχι κρίσιμο */ }

  // Έλεγχος: αν το πρωτότυπο έχει ήδη έλεγχο (π.χ. υπογεγραμμένο έντυπο), ισχύει αυτός.
  // Αλλιώς (π.χ. έντυπο για εκτύπωση) το αντίγραφο πάει για έλεγχο.
  let srcRow = null;
  try { srcRow = rvByFile_()[file.getId()] || null; } catch (e) { /* χωρίς φύλλο */ }
  if (!srcRow || !rvOpen_(rvGet_(srcRow, RVC.STATUS))) {
    rvAddSafe_({ fileId: copy.getId(), code: p.code, agent: agent.name, kind: 'bill', slot: slot.key, title: slot.label,
                 replaced: mode === 'replace' ? existing.map(x => x.id) : [] });
  } else if (mode === 'replace' && existing.length) {
    rvMark_(existing.map(x => x.id), RV.DONE);
  }
  log_('Τιμολόγηση: από τα έντυπα', agent.name, p.code + ' · ' + slot.label);
  return docsResult_(agent, p, f, 'bill');
}


// ═════════════════════════════════════════════════════════════
//  1.20 · ΕΝΤΥΠΟ ΠΡΟΣΦΟΡΑΣ
// ═════════════════════════════════════════════════════════════
// Ροή (όπως το έντυπο υπόδειξης):
//   1. Ο μεσίτης, από την κλήση, πατά «Έντυπο προσφοράς». Φτιάχνεται link μίας χρήσης:
//      APP_URL + 'offer.html#' + κλειδί. Στο φύλλο γράφεται ΜΟΝΟ το SHA-256 του.
//   2. Ο πελάτης (στο κινητό του ή στην οθόνη του μεσίτη) βλέπει τα στοιχεία του ακινήτου,
//      γράφει ονοματεπώνυμο, διεύθυνση, τιμή, τρόπο πληρωμής, ΑΦΜ, Α.Δ.Τ. και υπογράφει.
//   3. Το PDF μπαίνει στο «<ακίνητο>/Προσφορές» και στον έλεγχο του Admin.
//      Στο φύλλο μένουν μόνο κατάσταση, ποσό, Α/Α. ΑΦΜ και Α.Δ.Τ. ΜΟΝΟ μέσα στο PDF.

const OF_HEADERS = ['ID', 'Κλειδί (hash)', 'Κλήση', 'Μεσίτης', 'Κωδικός', 'Ακίνητο', 'Δημιουργία', 'Λήξη',
                    'Κατάσταση', 'Ανοίγματα', 'Υποβολή', 'Ποσό', 'Αρχείο', 'Έλεγχος', 'Α/Α', 'Συσκευή', 'ΑΦΜ ελέγχθηκε'];
const OFC = { ID: 1, HASH: 2, LEAD: 3, AGENT: 4, CODE: 5, PROP: 6, CREATED: 7, EXPIRES: 8, STATUS: 9, OPENS: 10,
              SUBMITTED: 11, AMOUNT: 12, FILE: 13, CHECK: 14, AA: 15, DEVICE: 16, AFM_OK: 17 };

/** Τα πεδία του προτύπου («Έντυπο προσφοράς - πρότυπο KW App»), ως {{ΟΝΟΜΑ}}. */
const OF_KEYS = ['ΑΑ', 'ΑΓΟΡΑΣΤΗΣ', 'ΔΙΕΥΘΥΝΣΗ_ΑΓΟΡΑΣΤΗ', 'ΚΩΔΙΚΟΣ', 'ΔΙΕΥΘΥΝΣΗ', 'ΠΕΡΙΓΡΑΦΗ',
  'ΑΓΟΡΑ', 'ΕΚΜΙΣΘΩΣΗ', 'ΜΕΤΡΗΤΟΙΣ', 'ΔΑΝΕΙΟ', 'ΥΠΟΓΡΑΦΗ', 'ΥΠΟΓΡΑΦΩΝ', 'ΗΜΕΡΟΜΗΝΙΑ', 'ΑΦΜ', 'ΑΔΤ', 'ΕΛΕΓΧΟΣ'];

function ofSheet_() { return ensureSheet_(CONFIG.SHEETS.OFFERS, OF_HEADERS); }

function ofRows_() {
  const sh = ofSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, OF_HEADERS.length).getValues()
    .map((v, i) => ({ row: i + 2, v: v }))
    .filter(r => r.v[OFC.ID - 1]);
}

function ofGet_(r, col) { return r.v[col - 1]; }

function ofSet_(r, values) {
  OF_LEAD_MAP_ = null;
  const sh = ofSheet_();
  Object.keys(values).forEach(col => {
    r.v[col - 1] = values[col];
    sh.getRange(r.row, Number(col)).setValue(safe_(values[col]));
  });
}

function ofStatus_(r) {
  const st = String(ofGet_(r, OFC.STATUS) || '');
  if (st === SF.SENT && ts_(ofGet_(r, OFC.EXPIRES)) < Date.now()) return SF.EXPIRED;
  return st;
}

function ofLatest_(leadId) {
  const rows = ofRows_().filter(r => String(ofGet_(r, OFC.LEAD)) === String(leadId));
  return rows.length ? rows[rows.length - 1] : null;
}

let OF_LEAD_MAP_ = null;
function ofLeadStatus_(leadId) {
  if (!OF_LEAD_MAP_) {
    OF_LEAD_MAP_ = {};
    try { ofRows_().forEach(r => { OF_LEAD_MAP_[String(ofGet_(r, OFC.LEAD))] = ofStatus_(r); }); }
    catch (e) { console.warn('Έντυπα προσφοράς: ' + e.message); }
  }
  return OF_LEAD_MAP_[String(leadId)] || '';
}

function ofByToken_(token) {
  const t = String(token || '');
  if (!/^[0-9a-f]{48}$/.test(t)) return null;
  const h = sha256_(t);
  return ofRows_().find(r => ofGet_(r, OFC.HASH) === h) || null;
}

function ofProp_(r) {
  try { return JSON.parse(String(ofGet_(r, OFC.PROP) || '{}')); } catch (e) { return {}; }
}

/** Το πρότυπο: από το CONFIG, αλλιώς από το όνομα στο Drive (Google Doc), και το κρατά. */
function ofTemplate_() {
  if (CONFIG.OFFER.TEMPLATE_ID) return CONFIG.OFFER.TEMPLATE_ID;
  const sp = PropertiesService.getScriptProperties();
  const cached = sp.getProperty('OF_TPL');
  if (cached) {
    try { if (!DriveApp.getFileById(cached).isTrashed()) return cached; } catch (e) { /* ξαναψάχνουμε */ }
  }
  const it = DriveApp.getFilesByName(CONFIG.OFFER.NAME);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_DOCS) { sp.setProperty('OF_TPL', f.getId()); return f.getId(); }
  }
  return '';
}

/** Όροφος, έτος κατασκευής, υπνοδωμάτια: από τις στήλες του «Διαθέσιμα ακίνητα» (DESC_COLS). */
function propExtras_(code) {
  const out = {};
  try {
    const sh = getSS().getSheetByName(CONFIG.SHEETS.PROPS);
    if (!sh || sh.getLastRow() < 2) return out;
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
    const cols = {};
    Object.keys(CONFIG.OFFER.DESC_COLS).forEach(k => {
      const re = new RegExp(CONFIG.OFFER.DESC_COLS[k]);
      const i = headers.findIndex(h => h && re.test(h));
      if (i !== -1) cols[k] = i;
    });
    if (!Object.keys(cols).length) return out;
    const idCol = colIdx_(PCOL.ID);
    const ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getValues();
    let row = -1;
    ids.forEach((r, i) => { if (normCode_(r[0]) === normCode_(code)) row = i + 2; });
    if (row < 0) return out;
    const v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    Object.keys(cols).forEach(k => {
      const raw = v[cols[k]];
      const val = raw instanceof Date ? Utilities.formatDate(raw, TZ, k === 'year' ? 'yyyy' : 'dd/MM/yyyy') : cellText_(raw);
      if (val && val !== '0') out[k] = val;
    });
  } catch (e) { console.warn('Στοιχεία ακινήτου: ' + e.message); }
  return out;
}

/** «Διαμέρισμα 85 τ.μ., όροφος 3ος, έτος κατασκευής 1975, 2 υπνοδωμάτια». */
function ofDescription_(prop) {
  const x = propExtras_(prop.code);
  const parts = [];
  const head = [prop.type, prop.sqm ? prop.sqm + ' τ.μ.' : ''].filter(Boolean).join(' ');
  if (head) parts.push(head);
  if (x.floor) {
    const fl = String(x.floor).trim();
    parts.push(/οροφ|ισογ|υπογ|ημιυπ|ρετιρε/.test(norm_(fl)) ? fl
      : /^\d+$/.test(fl) ? fl + 'ος όροφος' : fl + ' όροφος');
  }
  if (x.year) parts.push('έτος κατασκευής ' + x.year);
  if (x.bedrooms) parts.push(x.bedrooms + (String(x.bedrooms) === '1' ? ' υπνοδωμάτιο' : ' υπνοδωμάτια'));
  return parts.join(', ');
}

function ofPropFor_(l, deal) {
  const prop = sfPropFor_(l, deal);
  prop.description = ofDescription_(prop);
  return prop;
}

function ofView_(r) {
  if (!r) return { status: '' };
  return {
    status: ofStatus_(r),
    created: stamp_(ofGet_(r, OFC.CREATED)),
    expires: stamp_(ofGet_(r, OFC.EXPIRES)),
    submitted: stamp_(ofGet_(r, OFC.SUBMITTED)),
    aa: String(ofGet_(r, OFC.AA) || ''),
    amount: Number(ofGet_(r, OFC.AMOUNT)) ? fmtEur_(Number(ofGet_(r, OFC.AMOUNT))) : '',
    opens: Number(ofGet_(r, OFC.OPENS)) || 0,
    fileUrl: sfFileUrl_(String(ofGet_(r, OFC.FILE) || '')),
    deal: ofProp_(r).deal || ''
  };
}

/** Ο φάκελος «<ακίνητο>/Προσφορές». Το ακίνητο πρέπει να είναι του μεσίτη. */
function ofFolder_(agent, code) {
  const p = readProps_()[normCode_(code)];
  if (!p || norm_(p.partner) !== norm_(agent.name)) throw new Error('Το ακίνητο δεν ανήκει πια στον μεσίτη.');
  const f = propFolders_(agent, p);
  return childByName_(f.folder, CONFIG.OFFER.FOLDER) || f.folder.createFolder(CONFIG.OFFER.FOLDER);
}

// ── Μεσίτης ─────────────────────────────────────────────────

function ofCheckLead_(agent, l) {
  if (!l.code) throw new Error('Η κλήση δεν έχει κωδικό ακινήτου.');
  const p = readProps_()[normCode_(l.code)];
  if (!p || norm_(p.partner) !== norm_(agent.name)) throw new Error('Το ακίνητο δεν είναι στα δικά σου.');
}

function actOfferStatus_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const view = ofView_(ofLatest_(l.id));
  view.prop = ofPropFor_(l, '');
  view.ready = !!ofTemplate_();
  return view;
}

/** Νέο link: { id (κλήση), deal }. Το προηγούμενο ανοιχτό link της ίδιας κλήσης ακυρώνεται. */
function actOfferCreate_(agent, d) {
  const l = findMyLead_(agent, d.id);
  ofCheckLead_(agent, l);
  if (!ofTemplate_()) throw new Error('Δεν βρέθηκε το πρότυπο «' + CONFIG.OFFER.NAME + '» στο Drive.');
  const prop = ofPropFor_(l, d.deal);
  if (!prop.deal) throw err_('Διάλεξε αν είναι Πώληση ή Ενοικίαση.', 'deal');

  const token = randomHex_(48);
  const now = new Date();
  const expires = new Date(now.getTime() + CONFIG.OFFER.EXPIRE_HOURS * 3600000);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ofRows_().filter(r => String(ofGet_(r, OFC.LEAD)) === l.id && ofStatus_(r) === SF.SENT)
      .forEach(r => ofSet_(r, { [OFC.STATUS]: SF.CANCELLED }));
    ofSheet_().appendRow(safeRow_(['OF-' + randomHex_(10), sha256_(token), l.id, agent.name, prop.code,
                                   JSON.stringify(prop), now, expires, SF.SENT, 0, '', '', '', '', '', '', '']));
    OF_LEAD_MAP_ = null;
  } finally {
    lock.releaseLock();
  }
  log_('Έντυπο προσφοράς: link', agent.name, 'κλήση ' + l.id + ' · ' + prop.code);

  const url = CONFIG.APP_URL + 'offer.html#' + token;
  const first = String(l.name || '').split(' ')[0];
  const me = agent.smsName || agent.name;
  const where = prop.address || prop.code;
  const days = Math.round(CONFIG.OFFER.EXPIRE_HOURS / 24);
  const text = 'Καλησπέρα' + (first ? ' ' + first : '') + ', για το ακίνητο ' + where +
               ' μπορείτε να συμπληρώσετε την προσφορά σας εδώ: ' + url + ' Ισχύει ' + days + (days === 1 ? ' ημέρα. ' : ' ημέρες. ') + me;
  return {
    form: ofView_(ofLatest_(l.id)),
    url: url,
    sms: text,
    wa: phoneIntl_(l.phone) ? String(phoneIntl_(l.phone)).replace(/^\+/, '') : '',
    email: { to: l.email || '', subject: 'Έντυπο προσφοράς ακινήτου · ' + CONFIG.OFFICE.name,
             body: 'Καλησπέρα' + (l.name ? ' ' + l.name : '') + ',\n\nγια το ακίνητο ' + where +
                   ' μπορείτε να συμπληρώσετε και να υπογράψετε την προσφορά σας εδώ:\n' + url +
                   '\n\nΤο link ισχύει έως ' + stamp_(expires) + ' και χρησιμοποιείται μία φορά.\n\n' + me + '\n' + CONFIG.OFFICE.name }
  };
}

function actOfferCancel_(agent, d) {
  const l = findMyLead_(agent, d.id);
  const r = ofLatest_(l.id);
  if (r && ofStatus_(r) === SF.SENT) ofSet_(r, { [OFC.STATUS]: SF.CANCELLED });
  return ofView_(ofLatest_(l.id));
}

// ── Πελάτης (χωρίς σύνδεση, μόνο με το κλειδί του link) ───

function ofOpenRow_(token) {
  sfGuard_();
  const r = ofByToken_(token);
  if (!r) { sfBad_(); throw err_('Το link δεν είναι έγκυρο. Ζητήστε νέο από τον μεσίτη σας.', 'closed'); }
  const st = ofStatus_(r);
  if (st === SF.SIGNED) throw err_('Η προσφορά έχει ήδη υποβληθεί. Ευχαριστούμε!', 'done');
  if (st === SF.EXPIRED) throw err_('Το link έληξε. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  if (st !== SF.SENT) throw err_('Το link δεν ισχύει πια. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  if ((Number(ofGet_(r, OFC.OPENS)) || 0) >= CONFIG.OFFER.MAX_OPENS) {
    throw err_('Το link άνοιξε πάρα πολλές φορές και κλείδωσε. Ζητήστε νέο από τον μεσίτη σας.', 'closed');
  }
  return r;
}

/** Ο πελάτης ανοίγει τη φόρμα: μόνο στοιχεία ακινήτου, μεσίτη και γραφείου. */
function actOfferOpen_(d) {
  const r = ofOpenRow_(d.f);
  ofSet_(r, { [OFC.OPENS]: (Number(ofGet_(r, OFC.OPENS)) || 0) + 1 });
  const prop = ofProp_(r);
  let agentName = String(ofGet_(r, OFC.AGENT) || '');
  try { const a = sfAgent_(agentName); agentName = a.smsName || a.name; } catch (e) { /* όνομα από το φύλλο */ }
  return {
    office: CONFIG.OFFICE.name,
    agent: agentName,
    prop: { code: prop.code, address: prop.address, description: prop.description, deal: prop.deal,
            asking: fmtEur_(prop.price) },
    today: Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy'),
    expires: stamp_(ofGet_(r, OFC.EXPIRES)),
    copy: !!CONFIG.OFFER.SEND_COPY
  };
}

/** Έλεγχος των στοιχείων. Σφάλμα = ποιο πεδίο, ποτέ η τιμή. */
function ofClean_(c, deal) {
  c = c || {};
  const t = (k, max) => sfText_(c[k], max);
  const rent = deal === 'Ενοικίαση';
  const out = {
    name: t('name', 120), address: t('address', 160), signName: t('signName', 120) || t('name', 120),
    adt: t('adt', 20).toUpperCase(), afm: t('afm', 24).replace(/\s/g, ''), email: t('email', 120).toLowerCase(),
    price: parseNum_(c.price), cash: rent ? 0 : parseNum_(c.cash), loan: rent ? 0 : parseNum_(c.loan)
  };
  if (!out.name) throw sfFail_('name', 'Συμπληρώστε: Ονοματεπώνυμο.');
  if (out.name.split(' ').length < 2) throw sfFail_('name', 'Γράψτε όνομα και επώνυμο.');
  if (out.address.length < 5) throw sfFail_('address', 'Συμπληρώστε τη διεύθυνση κατοικίας σας.');
  if (!(out.price > 0) || out.price > 1e9) throw sfFail_('price', rent ? 'Γράψτε το μίσθωμα που προτείνετε.' : 'Γράψτε την τιμή που προτείνετε.');
  if (!rent) {
    if (!(out.cash > 0) && !(out.loan > 0)) throw sfFail_('cash', 'Γράψτε πόσα με μετρητά και πόσα με δάνειο.');
    if (Math.abs(out.cash + out.loan - out.price) > 0.5) {
      throw sfFail_('cash', 'Μετρητά και δάνειο μαζί πρέπει να κάνουν την τιμή της προσφοράς.');
    }
  }
  if (out.signName.split(' ').length < 2) throw sfFail_('signName', 'Γράψτε ονοματεπώνυμο για την υπογραφή.');
  out.afm = out.afm.replace(/^(EL|GR|ΕΛ)/i, '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(out.afm)) throw sfFail_('afm', 'Ο ΑΦΜ έχει 9 ψηφία.');
  out.afmChecked = validAfm_(out.afm);
  if (!out.afmChecked && c.afmOk !== true) {
    throw sfFail_('afmOk', 'Ο ΑΦΜ δεν περνά τον αυτόματο έλεγχο. Ελέγξτε τα ψηφία, ή τσεκάρετε «Ο ΑΦΜ μου είναι σωστός».');
  }
  if (!/^[A-ZΑ-Ω0-9 \-]{5,20}$/.test(out.adt.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    throw sfFail_('adt', 'Ο αριθμός ταυτότητας ή διαβατηρίου δεν φαίνεται σωστός.');
  }
  if (out.email && !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(out.email)) throw sfFail_('email', 'Το email δεν φαίνεται σωστό.');
  return out;
}

function ofValues_(c, prop, now, aa) {
  const rent = prop.deal === 'Ενοικίαση';
  const eur = n => n ? fmtNum_(n, n % 1 ? 2 : 0) + ' €' : '—';
  return {
    'ΑΑ': aa,
    'ΑΓΟΡΑΣΤΗΣ': c.name, 'ΔΙΕΥΘΥΝΣΗ_ΑΓΟΡΑΣΤΗ': c.address,
    'ΚΩΔΙΚΟΣ': prop.code || '—', 'ΔΙΕΥΘΥΝΣΗ': prop.address || '—', 'ΠΕΡΙΓΡΑΦΗ': prop.description || '—',
    'ΑΓΟΡΑ': rent ? '—' : eur(c.price),
    'ΕΚΜΙΣΘΩΣΗ': rent ? eur(c.price) + ' / μήνα' : '—',
    'ΜΕΤΡΗΤΟΙΣ': rent ? '—' : eur(c.cash),
    'ΔΑΝΕΙΟ': rent ? '—' : eur(c.loan),
    'ΥΠΟΓΡΑΦΩΝ': c.signName,
    'ΗΜΕΡΟΜΗΝΙΑ': Utilities.formatDate(now, TZ, 'dd/MM/yyyy'),
    'ΑΦΜ': c.afm, 'ΑΔΤ': c.adt
  };
}

function ofNextAa_(now) {
  const y = Utilities.formatDate(now, TZ, 'yyyy');
  const max = ofRows_().reduce((m, r) => {
    const a = String(ofGet_(r, OFC.AA) || '').split('/');
    return a[0] === y ? Math.max(m, Number(a[1]) || 0) : m;
  }, 0);
  return y + '/' + String(max + 1).padStart(3, '0');
}

/** Ο πελάτης υποβάλλει: { f, c, sig, consent, ua }. Λάθος σε πεδίο δεν καίει το link. */
function actOfferSubmit_(d) {
  sfGuard_();
  const tries = CacheService.getScriptCache();
  const key = 'of:try:' + sha256_(String(d.f || '')).slice(0, 20);
  const n = Number(tries.get(key) || 0);
  if (n >= 10) throw new Error('Πολλές προσπάθειες. Δοκιμάστε ξανά σε μία ώρα.');
  tries.put(key, String(n + 1), 3600);

  if (d.consent !== true) throw sfFail_('consent', 'Χρειάζεται η αποδοχή για τα προσωπικά δεδομένα.');
  const sig = sfSignature_(d.sig);

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let r, agent, pdf, aa, client, prop;
  try {
    r = ofOpenRow_(d.f);                       // ξανά, μέσα στο κλείδωμα: όχι διπλή υποβολή
    prop = ofProp_(r);
    client = ofClean_(d.c, prop.deal);
    agent = sfAgent_(ofGet_(r, OFC.AGENT));
    const now = new Date();
    aa = ofNextAa_(now);
    const values = ofValues_(client, prop, now, aa);
    const check = sha256_(JSON.stringify(values) + (d.sig || ''));
    values['ΕΛΕΓΧΟΣ'] = 'Υπογράφηκε ηλεκτρονικά στην οθόνη στις ' + stamp_(now) + ' · Α/Α ' + aa +
      ' · κωδικός ελέγχου ' + check.slice(0, 16).replace(/(.{4})(?!$)/g, '$1-');
    const folder = ofFolder_(agent, prop.code);
    pdf = sfBuildPdf_(values, sig, folder,
      'Προσφορά ' + aa.replace('/', '-') + ' - ' + client.name.replace(/[\/\\:*?"<>|]/g, ' ') + '.pdf', ofTemplate_(), OF_KEYS);
    ofSet_(r, {
      [OFC.STATUS]: SF.SIGNED, [OFC.SUBMITTED]: now, [OFC.AMOUNT]: client.price, [OFC.FILE]: pdf.getId(),
      [OFC.CHECK]: check, [OFC.AA]: aa, [OFC.DEVICE]: sfDevice_(d.ua),
      [OFC.AFM_OK]: client.afmChecked ? 'Ναι' : 'Όχι, το επιβεβαίωσε ο πελάτης'
    });
  } finally {
    lock.releaseLock();
  }
  const leadId = String(ofGet_(r, OFC.LEAD));
  rvAddSafe_({ fileId: pdf.getId(), code: prop.code, agent: agent.name, kind: 'offerform',
               slot: leadId, title: 'Προσφορά ' + aa, lead: leadId });
  log_('Έντυπο προσφοράς: υποβλήθηκε', agent.name, 'Α/Α ' + aa + (client.afmChecked ? '' : ' · ΑΦΜ χωρίς επιτυχή αυτόματο έλεγχο'));

  let copied = false;
  if (CONFIG.OFFER.SEND_COPY && client.email) {
    try {
      MailApp.sendEmail({
        to: client.email, name: CONFIG.OFFICE.name, replyTo: agent.email || CONFIG.OFFICE.email,
        subject: 'Το αντίγραφό σας · Προσφορά για ακίνητο',
        body: 'Καλησπέρα,\n\nσας στέλνουμε αντίγραφο της προσφοράς σας (Α/Α ' + aa + ').\n\nΕυχαριστούμε,\n' +
              (agent.smsName || agent.name) + '\n' + CONFIG.OFFICE.name,
        attachments: [pdf.getBlob()]
      });
      copied = true;
    } catch (e) { console.error('Έντυπο προσφοράς: δεν στάλθηκε το αντίγραφο (' + e.message + ')'); }
  }

  const where = prop.address || prop.code;
  const amount = fmtEur_(client.price) + (prop.deal === 'Ενοικίαση' ? ' / μήνα' : '');
  const afmNote = client.afmChecked ? '' : ' · έλεγξε τον ΑΦΜ';
  try {
    const sent = pushToAgent_(agent, { type: 'offerform', id: leadId, tag: 'of-' + leadId,
      url: '?lead=' + encodeURIComponent(leadId), title: 'Νέα προσφορά · ' + amount, body: where + afmNote });
    if (!sent && agent.email) {
      MailApp.sendEmail({ to: agent.email, subject: 'Νέα προσφορά · ' + amount, name: 'KW App',
        body: where + ' · Α/Α ' + aa + (afmNote ? '\n\nΟ ΑΦΜ δεν πέρασε τον αυτόματο έλεγχο: έλεγξέ τον στο PDF.' : '') +
              '\n\nΤο PDF είναι στον φάκελο του ακινήτου: ' + sfFileUrl_(pdf.getId()) });
    }
  } catch (e) { console.error('Έντυπο προσφοράς: ειδοποίηση μεσίτη (' + e.message + ')'); }

  return { aa: aa, copied: copied };
}

/** ▶ Ποια {{ΠΕΔΙΑ}} βρέθηκαν στο πρότυπο της προσφοράς και ποια λείπουν. */
function offerTemplateCheck() {
  const id = ofTemplate_();
  if (!id) { console.log('Έντυπο προσφοράς: δεν βρέθηκε Google Doc με όνομα «' + CONFIG.OFFER.NAME + '».'); return; }
  let doc;
  try { doc = DocumentApp.openById(id); }
  catch (e) { console.log('⚠ Το πρότυπο δεν ανοίγει ως Google Doc (' + e.message + ').'); return; }
  const text = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(Boolean).map(c => c.getText()).join('\n');
  const found = OF_KEYS.filter(k => text.indexOf('{{' + k + '}}') !== -1);
  const missing = OF_KEYS.filter(k => found.indexOf(k) === -1);
  const unknown = (text.match(/\{\{[^}]*\}\}/g) || []).map(x => x.slice(2, -2)).filter(k => OF_KEYS.indexOf(k) === -1);
  console.log('Έντυπο προσφοράς «' + doc.getName() + '»: ' + found.length + '/' + OF_KEYS.length + ' πεδία.');
  if (missing.length) console.log('Λείπουν: ' + missing.join(', '));
  if (unknown.length) console.log('⚠ Άγνωστα (λάθος γραφή;): ' + unknown.join(', '));
  const x = propExtras_((Object.keys(readProps_())[0]) || '');
  console.log('Στήλες για την «Περιγραφή» (όροφος, έτος, υπνοδωμάτια): ' + (Object.keys(x).join(', ') || 'δεν βρέθηκαν στο πρώτο ακίνητο'));
}

/** ▶ Μία φορά μετά την 1.20: φύλλα «Ιστορικό κλήσεων» και «Έντυπα προσφοράς», έλεγχος προτύπου. */
function setup120() {
  clSheet_();
  ofSheet_();
  offerTemplateCheck();
  console.log('1.20 έτοιμη: φύλλα «' + CONFIG.SHEETS.CALLS + '» και «' + CONFIG.SHEETS.OFFERS + '».');
}
