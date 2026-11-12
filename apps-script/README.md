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
