/**
 * Οι ρυθμίσεις της σελίδας. Τίποτα από αυτά δεν είναι μυστικό: είναι
 * διευθύνσεις και δημόσια αναγνωριστικά. Τα κλειδιά που πρέπει να μείνουν
 * κρυφά είναι στο Apps Script (Ιδιότητες σεναρίου), όχι εδώ.
 *
 * Δοκιμή → ανάπτυξη και Firebase project του georgepapadakis532@gmail.com
 * Παραγωγή → αλλάζει μόνο το API_URL (το Firebase μπορεί να μείνει ίδιο)
 */
(function () {
  // Παραγωγή: η ανάπτυξη του PROD Apps Script (τελειώνει σε /exec).
  var PROD_API_URL = 'https://script.google.com/macros/s/AKfycbzvR5oALOE8M6afHlts00p7VMMLPPsYXS0Jk0cQUYGxAYSvBf4Xe8Myh_9l6JLXnsv9/exec';
  // 2.4 · Δοκιμές: η ανάπτυξη του DEV Apps Script (ψεύτικα δεδομένα). Κενό = δεν έχει στηθεί ακόμα.
  var DEV_API_URL = '';
  // Preview links (Cloudflare Pages, *.pages.dev): ΠΟΤΕ στην παραγωγή.
  var preview = /\.pages\.dev$/.test(location.hostname);
  window.KW_PREVIEW = preview;
  window.KW_API = preview ? DEV_API_URL : PROD_API_URL;
})();

window.KW_CONFIG = {
  API_URL: window.KW_API,

  // Firebase → ⚙ Ρυθμίσεις έργου → Γενικά → Οι εφαρμογές σου → KW App → «Config».
  // Αντέγραψε τις 5 τιμές από εκεί, μέσα στα εισαγωγικά.
  FIREBASE: {
    apiKey: 'AIzaSyBFyEi0V-TSPgMwyquhHB_uz7yFEoO_1vU',
    authDomain: 'kw-app-cb908.firebaseapp.com',
    projectId: 'kw-app-cb908',
    messagingSenderId: '327303965974',
    appId: '1:327303965974:web:03f54987e183001a0b7437'
  },

  // Firebase → ⚙ Ρυθμίσεις έργου → Cloud Messaging → Web Push certificates → «Key pair».
  VAPID_KEY: 'BFlt7GJ7BSnxB0bGY_FB7BoHr8tJeV6GDAbbLHWtq_6ViyryIPPb8fnG8HVNeJquRKq08GaCEj9DmcHXiSeJfJY'
};
