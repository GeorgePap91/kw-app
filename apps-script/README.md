# apps-script/

Εδώ μπαίνει ο κώδικας του backend (Code.gs κ.λπ.) ώστε το GitHub να είναι η
μοναδική πηγή αλήθειας. Το GitHub Action `deploy-apps-script.yml` τον ανεβάζει
αυτόματα στο Apps Script.

## Πρώτη φορά (μία εντολή στον υπολογιστή σου)
```bash
npm i -g @google/clasp@2.4.2
clasp login                                  # ο λογαριασμός που κατέχει το script
cd apps-script
clasp clone <SCRIPT_ID_PROD> --rootDir .     # κατεβάζει Code.gs + appsscript.json
rm .clasp.json                               # το φτιάχνει μόνο του το Action
```
Μετά commit + push. Τα `.clasp.json` / `.clasprc.json` δεν ανεβαίνουν ποτέ (βλ. .gitignore).

## Ιδιότητες σεναρίου (Script properties)
Ο κώδικας είναι δημόσιος, οπότε IDs αρχείων και email ΔΕΝ γράφονται μέσα του.
Ορίζονται σε κάθε project (PROD και DEV) από ⚙ Ρυθμίσεις έργου → Script properties:

| Ιδιότητα | Τι είναι | DEV |
|---|---|---|
| `ENV` | `test` ή `prod` | `test` |
| `SPREADSHEET_ID` | workbook «Κλήσεις» | αντίγραφο με test δεδομένα |
| `OFFICE_EMAIL` | reply-to στα email | το δικό σου |
| `REFERRAL_SEND_TO` | παραλήπτης εντύπων σύστασης (κενό = OFFICE_EMAIL) | κενό |
| `SHOWING_TEMPLATE_ID` | Google Doc εντολής υπόδειξης | ίδιο με PROD |
| `METRICS_SPREADSHEET_ID` | απαντήσεις «Μετρησιμότητα» | ίδιο ή κενό |
| `PROD_SPREADSHEET_IDS` | παραγωγικά workbooks (κόμμα) — το Demo δεν τα αγγίζει | ίδιο με PROD |
| `DRIVE_ROOT_ID`, `OF_TPL`, `REF_TPL_*`, `FCM_SERVICE_ACCOUNT` | όπως πριν | βλ. docs/PIPELINE.md |
