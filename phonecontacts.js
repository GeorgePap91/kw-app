// 2.17 · Επαφές κινητού (flag phoneContacts)
//
//  1. «Φέρε τις επαφές μου»: CSV (Google) ή vCard (iPhone / Android). Το αρχείο διαβάζεται ΕΔΩ, στο κινητό.
//     Ο έλεγχος διπλών γίνεται εδώ, με τις επαφές που έχει ήδη η εφαρμογή. Στον server πάνε ΜΟΝΟ
//     οι επαφές που τσέκαρε ο μεσίτης· οι υπόλοιπες (οικογένεια, φίλοι) δεν φεύγουν από το κινητό.
//  2. Ομάδα → ακίνητο: «4411 Βαρίκα 13», «Βαρίκα 13» ή «4411» ταιριάζουν με το δικό του ακίνητο.
//  3. «Νέοι πελάτες στο κινητό»: Αυτόματα (Βοηθός επαφών) · Με ένα πάτημα (αρχείο vCard) · Όχι.
//  4. «Πιθανά διπλά»: όσα έμειναν για απόφαση.
//  5. Στο ακίνητο: «Ενδιαφερόμενοι (N)». Στην επαφή: «Αποθήκευση στο κινητό».
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};

  // ── Καθαρή λογική (τη δοκιμάζουν τα tests) ───────────────────────

  /** Ίδια λογική με το phoneDigits_ του server: ελληνικά → 10 ψηφία, ξένα → με κωδικό χώρας. */
  function digits(v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.indexOf('0030') === 0) d = d.slice(4);
    else if (d.length === 12 && d.indexOf('30') === 0) d = d.slice(2);
    else if (d.indexOf('00') === 0) d = d.slice(2);
    return d;
  }
  function okPhone(d) { return d.length >= 8 && d.length <= 15; }
  function mail(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function okMail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
  function uniq(a) { var o = []; (a || []).forEach(function (x) { if (x && o.indexOf(x) === -1) o.push(x); }); return o; }

  /** Κεφαλαία, χωρίς τόνους, μόνο γράμματα και αριθμοί. */
  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^0-9A-ZΑ-Ω]+/g, ' ').trim();
  }
  function code(s) { return fold(s).replace(/ /g, ''); }

  // Ελληνικά → λατινικά, για να ταιριάζει «Μαρία» με «Maria».
  var GR = { Α: 'A', Β: 'V', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'I', Θ: 'TH', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N',
             Ξ: 'X', Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'I', Φ: 'F', Χ: 'CH', Ψ: 'PS', Ω: 'O' };
  function latin(s) {
    return fold(s).replace(/[Α-Ω]/g, function (c) { return GR[c] || c; })
      .replace(/Y/g, 'I').replace(/W/g, 'O').replace(/OU/g, 'U');
  }
  function nameWords(s) { return latin(s).split(' ').filter(function (w) { return w.length >= 3; }); }

  /** Το ίδιο πρόσωπο; Αν λείπει το ένα όνομα, δεν το ξέρουμε: το θεωρούμε ίδιο. */
  function sameName(a, b) {
    var x = nameWords(a), y = nameWords(b);
    if (!x.length || !y.length) return true;
    return x.some(function (w) { return y.indexOf(w) !== -1; });
  }

  // Ετικέτες της Google που δεν είναι ακίνητα.
  var SYSTEM = /^(\*\s*)?(mycontacts|starred|friends|family|coworkers|imported on|εισαγωγη|other contacts|οικογενεια|φιλοι|συναδελφοι)/i;

  function cleanLabels(list) {
    return uniq((list || []).map(function (x) { return String(x || '').replace(/^\*\s*/, '').trim(); })
      .filter(function (x) { return x && !SYSTEM.test(x.normalize('NFD').replace(/[\u0300-\u036f]/g, '')); }));
  }

  /**
   * Σε ποιο ακίνητο αντιστοιχεί μια ετικέτα. props = τα ακίνητα του μεσίτη [{ code, street }].
   * Πρώτα ο κωδικός (μέσα στην ετικέτα), μετά η οδός (όλες οι λέξεις της ετικέτας μέσα στην οδό).
   * Επιστρέφει { code, street } · { ambig: [...] } · null.
   */
  function propMatch(label, props) {
    var words = fold(label).split(' ').filter(Boolean);
    if (!words.length) return null;
    // Ο κωδικός μπορεί να είναι «A-12» → λέξεις «A», «12»: ψάχνουμε και 2–3 διαδοχικές λέξεις ενωμένες.
    var used = {};
    var at = function (k) {
      if (k.length < 3) return -1;
      for (var i = 0; i < words.length; i++) {
        for (var len = 1; len <= 3 && i + len <= words.length; len++) {
          if (words.slice(i, i + len).join('') === k) return i * 10 + len;
        }
      }
      return -1;
    };
    var byCode = props.filter(function (p) {
      var hit = at(code(p.code));
      if (hit < 0) return false;
      for (var j = 0; j < hit % 10; j++) used[Math.floor(hit / 10) + j] = 1;
      return true;
    });
    if (byCode.length === 1) return { code: byCode[0].code, street: byCode[0].street || '' };
    var rest = words.filter(function (w, i) { return !used[i]; });
    if (!rest.some(function (w) { return /[A-ZΑ-Ω]/.test(w); })) return byCode.length ? { ambig: byCode } : null;
    var pool = byCode.length ? byCode : props;
    var hits = pool.filter(function (p) {
      var s = ' ' + fold(p.street) + ' ';
      return rest.every(function (w) { return s.indexOf(' ' + w + ' ') !== -1; });
    });
    if (hits.length === 1) return { code: hits[0].code, street: hits[0].street || '' };
    return hits.length ? { ambig: hits } : null;
  }

  // ── Αρχεία ──

  /** Χωρίζει στα κόμματα που δεν έχουν \ μπροστά (χωρίς lookbehind: δουλεύει και σε παλιά iPhone). */
  function splitV(v) {
    var out = [], cur = '';
    for (var i = 0; i < v.length; i++) {
      if (v[i] === '\\' && i + 1 < v.length) { cur += v[i] + v[i + 1]; i++; }
      else if (v[i] === ',') { out.push(cur); cur = ''; }
      else cur += v[i];
    }
    out.push(cur);
    return out;
  }

  function unescV(s) { return String(s).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1'); }

  function decodeQP(s, charsetUtf8) {
    var bytes = [], str = String(s).replace(/=\r?\n/g, '');
    for (var i = 0; i < str.length; i++) {
      if (str[i] === '=' && /^[0-9A-F]{2}$/i.test(str.substr(i + 1, 2))) { bytes.push(parseInt(str.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(str.charCodeAt(i) & 0xff);
    }
    try { if (charsetUtf8 !== false && typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
    catch (e) { /* συνεχίζουμε */ }
    return bytes.map(function (b) { return String.fromCharCode(b); }).join('');
  }

  /** vCard 2.1 / 3.0 / 4.0 (iPhone, Google, Android, Outlook). */
  function parseVcf(text) {
    var lines = String(text).replace(/\r\n?/g, '\n')
      .replace(/=\n/g, '=\u0001')            // soft break του quoted-printable
      .replace(/\n[ \t]/g, '')               // συνεχόμενες γραμμές
      .replace(/=\u0001/g, '=\n').split('\n');
    var out = [], cur = null;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (/^BEGIN:VCARD/i.test(line)) { cur = { name: '', n: '', phones: [], emails: [], labels: [], org: '' }; return; }
      if (/^END:VCARD/i.test(line)) { if (cur) out.push(cur); cur = null; return; }
      if (!cur) return;
      var i = line.indexOf(':');
      if (i < 0) return;
      var head = line.slice(0, i), val = line.slice(i + 1);
      var prop = head.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      if (/ENCODING=QUOTED-PRINTABLE/i.test(head)) val = decodeQP(val);
      if (prop === 'FN') cur.name = unescV(val).trim();
      else if (prop === 'N') cur.n = val.split(';').slice(0, 3).map(unescV).filter(Boolean).reverse().join(' ').trim();
      else if (prop === 'ORG') cur.org = unescV(val.split(';')[0]).trim();
      else if (prop === 'TEL') cur.phones.push(val.replace(/^tel:/i, ''));
      else if (prop === 'EMAIL') cur.emails.push(unescV(val).replace(/^mailto:/i, ''));
      else if (prop === 'CATEGORIES' || prop === 'X-CATEGORIES') {
        splitV(val).forEach(function (c) { cur.labels.push(unescV(c)); });
      }
    });
    return out.map(function (c) {
      return { name: c.name || c.n || c.org, phones: c.phones, emails: c.emails, labels: cleanLabels(c.labels) };
    });
  }

  /** CSV κατά RFC 4180 (εισαγωγικά, κόμματα και αλλαγές γραμμής μέσα σε πεδίο). */
  function parseCsvRows(text) {
    var rows = [], row = [], f = '', q = false, s = String(text).replace(/^\uFEFF/, '');
    var sep = (s.split('\n')[0].split(';').length > s.split('\n')[0].split(',').length) ? ';' : ',';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some(function (x) { return x.trim(); })) rows.push(row);
        row = [];
      } else f += ch;
    }
    row.push(f);
    if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }

  /** CSV της Google (νέο και παλιό), του Outlook και παρόμοια. Οι στήλες βρίσκονται από τις επικεφαλίδες. */
  function parseCsv(text) {
    var rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    var h = rows[0].map(function (x) { return fold(x).toLowerCase(); });
    var idx = function (re) { var o = []; h.forEach(function (x, i) { if (re.test(x)) o.push(i); }); return o; };
    var full = idx(/^(name|display name|ονομα|ονοματεπωνυμο|full name)$/);
    var first = idx(/^(first name|given name|ονομα)$/), mid = idx(/^(middle name|additional name)$/),
        last = idx(/^(last name|family name|επωνυμο)$/);
    var phones = idx(/(phone|τηλεφωνο|κινητο|mobile).*(value)?$/).filter(function (i) { return !/(type|label)$/.test(h[i]); });
    var emails = idx(/(e ?mail)/).filter(function (i) { return !/(type|label)$/.test(h[i]); });
    var labels = idx(/^(labels|group membership|categories|ετικετες|ομαδες)$/);
    var org = idx(/^(organization name|organization 1 name|company|εταιρεια)$/);
    var cell = function (r, i) { return String(r[i] == null ? '' : r[i]).trim(); };
    var multi = function (v) { return v.split(/\s*:::\s*|\s*;\s*/).filter(Boolean); };
    return rows.slice(1).map(function (r) {
      var name = full.map(function (i) { return cell(r, i); }).filter(Boolean)[0] ||
        [first, mid, last].map(function (g) { return g.map(function (i) { return cell(r, i); }).filter(Boolean)[0] || ''; })
          .filter(Boolean).join(' ') || org.map(function (i) { return cell(r, i); }).filter(Boolean)[0] || '';
      var ph = [], em = [], lb = [];
      phones.forEach(function (i) { multi(cell(r, i)).forEach(function (x) { ph.push(x); }); });
      emails.forEach(function (i) { multi(cell(r, i)).forEach(function (x) { em.push(x); }); });
      labels.forEach(function (i) { cell(r, i).split(/\s*:::\s*|\s*;\s*/).forEach(function (x) { lb.push(x); }); });
      return { name: name, phones: ph, emails: em, labels: cleanLabels(lb) };
    });
  }

  /** Από το κείμενο του αρχείου: { src, list }. Καθαρά τηλέφωνα και email, χωρίς άδειες επαφές. */
  function parseFile(fileName, text) {
    var vcf = /BEGIN:VCARD/i.test(String(text).slice(0, 4000));
    var src = vcf ? (/X-APPLE|PRODID:.*Apple|X-ABLabel/i.test(text) ? 'iPhone' : 'Αρχείο') : 'Google';
    var list = (vcf ? parseVcf(text) : parseCsv(text)).map(function (c) {
      return {
        name: String(c.name || '').replace(/\s+/g, ' ').trim(),
        phones: uniq(c.phones.map(digits).filter(okPhone)),
        emails: uniq(c.emails.map(mail).filter(okMail)),
        labels: c.labels
      };
    }).filter(function (c) { return c.phones.length || c.emails.length; });
    return { src: src, list: list, hint: String(fileName || '').replace(/\.(vcf|vcard|csv)$/i, '').trim() };
  }

  /** Κείμενο από τα bytes: UTF-8, UTF-16 (Outlook) ή Windows-1253 (παλιά ελληνικά Excel). */
  function decodeBytes(buf) {
    var u = new Uint8Array(buf);
    if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder('utf-16le').decode(u);
    if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder('utf-16be').decode(u);
    var t = new TextDecoder('utf-8').decode(u);
    if ((t.match(/\uFFFD/g) || []).length > 3) {
      try { return new TextDecoder('windows-1253').decode(u); } catch (e) { /* μένει UTF-8 */ }
    }
    return t;
  }

  /**
   * Έλεγχος διπλών. list = επαφές του αρχείου, mine = οι επαφές της εφαρμογής ({ id, name, phones, emails }).
   *   new      : δεν υπάρχει πουθενά
   *   same     : ίδιο τηλέφωνο ή email (και όνομα που ταιριάζει ή λείπει) → συγχώνευση
   *   maybe    : ίδιο ένα από τα δύο, άλλο όνομα → ρωτάμε
   *   conflict : τηλέφωνο σε μία επαφή, email σε άλλη → «Πιθανά διπλά»
   * Ίδιος άνθρωπος δύο φορές στο αρχείο → μία γραμμή (dupFile = πόσες ενώθηκαν).
   */
  function classify(list, mine) {
    var byP = {}, byE = {};
    (mine || []).forEach(function (c) {
      (c.phones || []).forEach(function (p) { var d = digits(p); if (d && !byP[d]) byP[d] = c; });
      (c.emails || []).forEach(function (e) { var m = mail(e); if (m && !byE[m]) byE[m] = c; });
    });
    var fP = {}, fE = {}, rows = [], dupFile = 0;
    list.forEach(function (c) {
      var g = c.phones.map(function (p) { return fP[p]; }).filter(Boolean)[0] || c.emails.map(function (e) { return fE[e]; }).filter(Boolean)[0];
      if (g) {
        dupFile++;
        if (!g.name && c.name) g.name = c.name;
        g.phones = uniq(g.phones.concat(c.phones)); g.emails = uniq(g.emails.concat(c.emails)); g.labels = uniq(g.labels.concat(c.labels));
      } else {
        g = { name: c.name, phones: c.phones.slice(), emails: c.emails.slice(), labels: c.labels.slice() };
        rows.push(g);
      }
      g.phones.forEach(function (p) { fP[p] = g; });
      g.emails.forEach(function (e) { fE[e] = g; });
    });
    rows.forEach(function (r, i) {
      r.k = i;
      var pm = r.phones.map(function (p) { return byP[p]; }).filter(Boolean)[0] || null;
      var em = r.emails.map(function (e) { return byE[e]; }).filter(Boolean)[0] || null;
      if (pm && em && pm.id !== em.id) { r.status = 'conflict'; r.target = pm; r.target2 = em; return; }
      var t = pm || em;
      if (!t) { r.status = 'new'; return; }
      r.target = t;
      r.status = (pm && em) || sameName(r.name, t.name) ? 'same' : 'maybe';
    });
    return { rows: rows, dupFile: dupFile };
  }

  /** Τι στέλνεται στον server για μία γραμμή. act: η απόφαση του μεσίτη για τα «maybe». */
  function toItem(r) {
    var action = r.status === 'new' ? 'auto' : r.status === 'same' ? 'merge'
      : r.status === 'maybe' ? (r.act === 'merge' ? 'merge' : r.act === 'separate' ? 'separate' : 'later') : 'later';
    return { name: r.name, phones: r.phones, emails: r.emails, codes: r.codes || [], action: action,
             target: action === 'merge' && r.target ? r.target.id : '' };
  }

  // ── vCard προς το κινητό ──

  function vEsc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function intl(d) { return d.length === 10 ? '+30' + d : '+' + d; }

  /** items: [{ name, phones, emails, groups, note }] → κείμενο .vcf (3.0, που ανοίγουν iPhone και Android). */
  function vcard(items) {
    return items.map(function (it) {
      var parts = String(it.name || '').trim().split(/\s+/);
      var L = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + vEsc(it.name || ''),
               'N:' + vEsc(parts.slice(1).join(' ')) + ';' + vEsc(parts[0] || '') + ';;;'];
      (it.phones || []).forEach(function (d) { L.push('TEL;TYPE=CELL:' + intl(digits(d))); });
      (it.emails || []).forEach(function (e) { L.push('EMAIL;TYPE=INTERNET:' + vEsc(e)); });
      if ((it.groups || []).length) L.push('CATEGORIES:' + it.groups.map(vEsc).join(','));
      if (it.note) L.push('NOTE:' + vEsc(it.note));
      L.push('END:VCARD');
      return L.join('\r\n');
    }).join('\r\n') + '\r\n';
  }

  var LOGIC = { digits: digits, fold: fold, latin: latin, sameName: sameName, propMatch: propMatch, parseVcf: parseVcf,
                parseCsv: parseCsv, parseFile: parseFile, classify: classify, toItem: toItem, vcard: vcard, cleanLabels: cleanLabels };
  if (typeof module !== 'undefined' && module.exports) { module.exports = LOGIC; return; }

  // ── Οθόνες ───────────────────────────────────────────────────────

  var st = { status: null, parsed: null, rows: null, filter: 'props', q: '', page: 0, guide: '', bulk: '' };
  var PAGE = 30;
  var ALL_GROUP = 'KW Πελάτες';

  function on() { return !!(W.S && W.S.flags && W.S.flags.phoneContacts); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return W.esc(s); }
  function body() { return $('pc-body'); }
  function title(t) { $('pcbox-title').textContent = t; }
  function n(x) { return Number(x || 0).toLocaleString('el-GR'); }
  function pl(k, one, many) { return n(k) + ' ' + (k === 1 ? one : many); }
  function back(to) { return '<button type="button" class="link pc-back" data-pc-back="' + to + '">‹ Πίσω</button>'; }

  function myProps() {
    return ((W.S && W.S.props) || []).filter(function (p) { return p.mine; })
      .map(function (p) { return { code: p.code, street: p.street || p.title || '' }; });
  }
  function propName(c) {
    var p = myProps().filter(function (x) { return code(x.code) === code(c); })[0];
    return p ? (p.code + (p.street ? ' · ' + p.street : '')) : c;
  }

  function wireBack(box) {
    box.querySelectorAll('[data-pc-back]').forEach(function (b) {
      b.onclick = function () { var t = b.dataset.pcBack; if (t === 'hub') hub(); else if (t === 'guide') guide(st.guide); };
    });
  }

  function apiErr(e) {
    return /Άγνωστη ενέργεια/.test(e.message) ? 'Ο server δεν έχει ακόμα την 2.17 (Νέα έκδοση στο Apps Script).' : e.message;
  }

  // ── Κεντρική οθόνη ──

  function open() {
    if (!on()) return;
    W.openPop('pcbox');
    hub();
  }

  function modeText(m) { return m === 'auto' ? 'Αυτόματα' : m === 'tap' ? 'Με ένα πάτημα' : 'Όχι'; }

  function hub() {
    title('Επαφές κινητού');
    var s = st.status;
    var box = body();
    box.innerHTML =
      '<p class="pc-lead">Φέρε τους πελάτες σου από το κινητό στην εφαρμογή, και τους νέους πελάτες από τις κλήσεις στο κινητό.</p>' +
      '<button type="button" class="pc-big" data-pc="import"><b>Φέρε τις επαφές μου</b><span>Από Google ή iPhone, χωρίς διπλές</span></button>' +
      '<button type="button" class="pc-big" data-pc="mode"><b>Νέοι πελάτες στο κινητό</b><span>' +
        (s ? modeText(s.mode) + (s.mode === 'auto' && !s.linked ? ' · θέλει σύνδεση' : '') +
             (s.mode === 'tap' && s.pendingPhone ? ' · ' + pl(s.pendingPhone, 'περιμένει', 'περιμένουν') : '') : 'Φόρτωση…') +
      '</span></button>' +
      '<button type="button" class="pc-big" data-pc="pending"' + (s && !s.pendingDup ? ' hidden' : '') + '><b>Πιθανά διπλά</b><span>' +
        (s ? pl(s.pendingDup, 'επαφή περιμένει', 'επαφές περιμένουν') + ' απόφαση' : '') + '</span></button>' +
      '<p class="save-hint err" id="pc-hint"></p>';
    box.querySelector('[data-pc="import"]').onclick = function () { guide(st.guide || guessDevice()); };
    box.querySelector('[data-pc="mode"]').onclick = mode;
    box.querySelector('[data-pc="pending"]').onclick = pending;
    loadStatus().then(function (fresh) { if (fresh && $('pc-hint') && !$('pcbox').hidden && box.querySelector('[data-pc="import"]')) hub(); });
  }

  function loadStatus() {
    return W.api('pcStatus', {}).then(function (s) {
      var changed = JSON.stringify(s) !== JSON.stringify(st.status);
      st.status = s;
      card();
      return changed;
    }).catch(function (e) { var h = $('pc-hint'); if (h) h.textContent = apiErr(e); return false; });
  }

  function guessDevice() { return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android'; }

  // ── Οδηγός + επιλογή αρχείου ──

  function guide(dev) {
    st.guide = dev;
    title('Φέρε τις επαφές μου');
    var ios = dev === 'ios';
    var steps = ios ? [
      'Άνοιξε την εφαρμογή <b>Επαφές</b> και πάτα <b>Λίστες</b> (πάνω αριστερά).',
      'Κράτα πατημένη τη λίστα που θέλεις, π.χ. «4411 Βαρίκα 13», ή «Όλες οι επαφές».',
      'Πάτα <b>Εξαγωγή</b> → <b>Αποθήκευση στα Αρχεία</b>.',
      'Γύρνα εδώ και πάτα <b>Διάλεξε το αρχείο</b>.'
    ] : [
      'Στον υπολογιστή ή στο κινητό, άνοιξε το <b>contacts.google.com</b>.',
      'Αν θες, βάλε τους πελάτες σε ετικέτα με τον κωδικό και την οδό, π.χ. «4411 Βαρίκα 13».',
      'Πάτα <b>Εξαγωγή</b> → <b>Google CSV</b> → <b>Εξαγωγή</b>.',
      'Γύρνα εδώ και πάτα <b>Διάλεξε το αρχείο</b>.'
    ];
    var box = body();
    box.innerHTML = back('hub') +
      '<div class="seg pc-seg" role="tablist"><button type="button" role="tab" class="seg-btn' + (ios ? '' : ' is-on') + '" data-dev="android" aria-selected="' + !ios + '">Android / Google</button>' +
      '<button type="button" role="tab" class="seg-btn' + (ios ? ' is-on' : '') + '" data-dev="ios" aria-selected="' + ios + '">iPhone</button></div>' +
      '<ol class="pc-steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' +
      (ios ? '<p class="pc-note">Το iPhone δεν γράφει το όνομα της λίστας μέσα στο αρχείο. Αν το αρχείο έχει το όνομα της λίστας ' +
             '(π.χ. «4411 Βαρίκα 13.vcf»), το ακίνητο μπαίνει μόνο του. Αλλιώς το διαλέγεις στο επόμενο βήμα.</p>'
           : '<p class="pc-note">Η ετικέτα με το ακίνητο είναι προαιρετική: μπορείς να διαλέξεις το ακίνητο και στο επόμενο βήμα.</p>') +
      '<input type="file" id="pc-file" accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard" hidden>' +
      '<button type="button" class="btn solid-red wide" id="pc-pick">Διάλεξε το αρχείο</button>' +
      '<p class="pc-note">Το αρχείο διαβάζεται μόνο στο κινητό σου. Στην εφαρμογή περνούν μόνο όσες επαφές τσεκάρεις.</p>' +
      '<p class="save-hint err" id="pc-hint"></p>';
    wireBack(box);
    box.querySelectorAll('[data-dev]').forEach(function (b) { b.onclick = function () { guide(b.dataset.dev); }; });
    $('pc-pick').onclick = function () { $('pc-file').click(); };
    $('pc-file').onchange = function () { if (this.files[0]) readFile(this.files[0]); };
  }

  function readFile(f) {
    var hint = $('pc-hint'), btn = $('pc-pick');
    if (f.size > 15 * 1024 * 1024) { hint.textContent = 'Το αρχείο είναι πολύ μεγάλο (πάνω από 15 MB).'; return; }
    btn.disabled = true;
    btn.textContent = 'Διαβάζω το αρχείο…';
    var fr = new FileReader();
    fr.onerror = function () { btn.disabled = false; btn.textContent = 'Διάλεξε το αρχείο'; hint.textContent = 'Δεν διαβάστηκε το αρχείο.'; };
    fr.onload = function () {
      var parsed;
      try { parsed = parseFile(f.name, decodeBytes(fr.result)); }
      catch (e) { parsed = { list: [] }; }
      if (!parsed.list.length) {
        btn.disabled = false; btn.textContent = 'Διάλεξε το αρχείο';
        hint.textContent = 'Δεν βρέθηκαν επαφές με τηλέφωνο ή email. Διάλεξε αρχείο .csv (Google) ή .vcf (iPhone).';
        return;
      }
      btn.textContent = 'Ελέγχω για διπλές…';
      var go = function () { prepare(parsed); };
      if (W.S.contacts) go(); else W.loadContacts().then(go, function (e) {
        btn.disabled = false; btn.textContent = 'Διάλεξε το αρχείο'; hint.textContent = 'Δεν φορτώθηκαν οι επαφές σου: ' + e.message;
      });
    };
    fr.readAsArrayBuffer(f);
  }

  function prepare(parsed) {
    var props = myProps();
    var res = classify(parsed.list, W.S.contacts || []);
    var fromName = parsed.hint ? propMatch(parsed.hint, props) : null;
    if (fromName && !fromName.code) fromName = null;
    var ambig = 0;
    res.rows.forEach(function (r) {
      r.codes = [];
      r.labels.forEach(function (lb) {
        var m = propMatch(lb, props);
        if (m && m.code) { if (r.codes.indexOf(m.code) === -1) r.codes.push(m.code); }
        else if (m && m.ambig) ambig++;
      });
      if (!r.codes.length && fromName) r.codes.push(fromName.code);
      r.sel = !!r.codes.length;
    });
    st.parsed = parsed;
    st.rows = res.rows;
    st.dupFile = res.dupFile;
    st.ambig = ambig;
    st.fromName = fromName;
    st.page = 0;
    st.q = '';
    st.filter = res.rows.some(function (r) { return r.codes.length; }) ? 'props' : 'all';
    preview();
  }

  // ── Προεπισκόπηση ──

  var BADGE = {
    new: ['showing', 'Νέα'], same: ['answered', 'Υπάρχει ήδη · συγχώνευση'],
    maybe: ['noanswer', 'Μάλλον ίδια · διάλεξε'], conflict: ['noanswer', 'Σύγκρουση · για μετά']
  };

  function shownRows() {
    var words = fold(st.q).split(' ').filter(Boolean);
    return st.rows.filter(function (r) {
      if (st.filter === 'props' && !r.codes.length) return false;
      if (st.filter === 'sel' && !r.sel) return false;
      if (st.filter === 'ask' && !(r.status === 'maybe' && !r.act) && r.status !== 'conflict') return false;
      if (!words.length) return true;
      var hay = ' ' + fold([r.name].concat(r.emails, r.codes).join(' ')) + ' ' + r.phones.join(' ');
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  function counts() {
    var c = { all: st.rows.length, props: 0, sel: 0, ask: 0, new: 0, same: 0, maybe: 0, conflict: 0 };
    st.rows.forEach(function (r) {
      if (r.codes.length) c.props++;
      if (r.sel) { c.sel++; c[r.status]++; }
      if ((r.status === 'maybe' && !r.act) || r.status === 'conflict') c.ask++;
    });
    return c;
  }

  function propOptions(sel) {
    return '<option value="">Χωρίς ακίνητο</option>' + myProps().map(function (p) {
      return '<option value="' + esc(p.code) + '"' + (sel === p.code ? ' selected' : '') + '>' + esc(p.code + (p.street ? ' · ' + p.street : '')) + '</option>';
    }).join('');
  }

  function rowHtml(r) {
    var b = BADGE[r.status];
    var sub = [r.phones[0], r.emails[0]].filter(Boolean).join(' · ');
    var who = r.target ? (r.target.name || (r.target.phones || [])[0] || '') : '';
    var ask = '';
    if (r.status === 'maybe') {
      ask = '<div class="pc-ask"><span>Υπάρχει ως «' + esc(who) + '». Ίδιος άνθρωπος;</span>' +
        '<button type="button" class="btn' + (r.act === 'merge' ? ' primary' : '') + '" data-act="merge" data-k="' + r.k + '">Συγχώνευση</button>' +
        '<button type="button" class="btn' + (r.act === 'separate' ? ' primary' : '') + '" data-act="separate" data-k="' + r.k + '">Ξεχωριστή</button></div>';
    } else if (r.status === 'same') {
      ask = '<p class="pc-why">Θα ενωθεί με «' + esc(who) + '». Προστίθεται μόνο ό,τι λείπει.</p>';
    } else if (r.status === 'conflict') {
      ask = '<p class="pc-why">Το τηλέφωνο είναι στην «' + esc(who) + '» και το email στην «' +
        esc(r.target2.name || (r.target2.emails || [])[0] || '') + '». Θα μπει στα Πιθανά διπλά.</p>';
    }
    return '<div class="pc-row' + (r.sel ? ' on' : '') + '">' +
      '<label class="pc-check"><input type="checkbox" data-sel="' + r.k + '"' + (r.sel ? ' checked' : '') + '>' +
      '<span><b>' + esc(r.name || r.phones[0] || r.emails[0]) + '</b><small>' + esc(sub) + '</small></span></label>' +
      '<span class="tag ' + b[0] + '">' + b[1] + '</span>' +
      (r.sel ? '<select class="pc-prop" data-prop="' + r.k + '" aria-label="Ακίνητο">' + propOptions(r.codes[0] || '') + '</select>' +
        (r.codes.length > 1 ? '<small class="pc-more">+ ' + r.codes.slice(1).map(propName).map(esc).join(', ') + '</small>' : '') : '') +
      (r.sel ? ask : '') + '</div>';
  }

  function preview() {
    title('Έλεγχος επαφών');
    var c = counts(), list = shownRows();
    var needBulk = st.rows.filter(function (r) { return r.sel && !r.codes.length; }).length;
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (st.page >= pages) st.page = pages - 1;
    var slice = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
    var chip = function (k, t, x) {
      return '<button type="button" role="tab" class="seg-btn' + (st.filter === k ? ' is-on' : '') + '" data-flt="' + k + '" aria-selected="' + (st.filter === k) + '">' + t + ' (' + n(x) + ')</button>';
    };
    var box = body();
    box.innerHTML = back('guide') +
      '<p class="pc-lead">Βρέθηκαν <b>' + pl(c.all, 'επαφή', 'επαφές') + '</b>' +
        (st.dupFile ? ' · ' + pl(st.dupFile, 'διπλή ενώθηκε', 'διπλές ενώθηκαν') + ' μέσα στο αρχείο' : '') + '.' +
        (st.fromName ? ' Ακίνητο από το όνομα του αρχείου: <b>' + esc(propName(st.fromName.code)) + '</b>.' : '') + '</p>' +
      (st.ambig ? '<p class="pc-note">' + pl(st.ambig, 'ετικέτα ταιριάζει', 'ετικέτες ταιριάζουν') + ' σε πάνω από ένα ακίνητο. Βάλε και τον κωδικό στην ετικέτα, ή διάλεξέ το εδώ.</p>' : '') +
      '<div class="seg pc-seg pc-flt" role="tablist">' + chip('props', 'Με ακίνητο', c.props) + chip('all', 'Όλες', c.all) +
        chip('sel', 'Επιλεγμένες', c.sel) + (c.ask ? chip('ask', 'Θέλουν απόφαση', c.ask) : '') + '</div>' +
      '<div class="search-box pc-search"><input class="search" type="search" id="pc-q" placeholder="Όνομα ή τηλέφωνο" value="' + esc(st.q) + '" autocomplete="off"></div>' +
      (needBulk ? '<div class="pc-bulk"><label for="pc-bulk">Ακίνητο για ' + pl(needBulk, 'επιλεγμένη χωρίς ακίνητο', 'επιλεγμένες χωρίς ακίνητο') + ':</label>' +
        '<select id="pc-bulk">' + propOptions(st.bulk) + '</select></div>' : '') +
      '<div class="pc-tools"><button type="button" class="link" id="pc-all">Όλες ✓</button>' +
        '<button type="button" class="link" id="pc-none">Καμία</button></div>' +
      (slice.length ? slice.map(rowHtml).join('') : '<div class="empty small"><b>Καμία επαφή εδώ</b>Δοκίμασε «Όλες».</div>') +
      (pages > 1 ? '<div class="pc-pager"><button type="button" class="btn" id="pc-prev"' + (st.page ? '' : ' disabled') + '>‹</button>' +
        '<span>' + (st.page + 1) + ' / ' + pages + '</span><button type="button" class="btn" id="pc-next"' + (st.page < pages - 1 ? '' : ' disabled') + '>›</button></div>' : '') +
      '<div class="pc-foot"><p class="pc-sum">' + summary(c) + '</p>' +
      '<button type="button" class="btn solid-red wide" id="pc-go"' + (c.sel ? '' : ' disabled') + '>Πέρασε ' + pl(c.sel, 'επαφή', 'επαφές') + '</button>' +
      '<p class="save-hint err" id="pc-hint"></p></div>';
    wireBack(box);
    box.querySelectorAll('[data-flt]').forEach(function (b) { b.onclick = function () { st.filter = b.dataset.flt; st.page = 0; preview(); }; });
    var q = $('pc-q');
    q.oninput = function () { st.q = q.value; st.page = 0; clearTimeout(st.qt); st.qt = setTimeout(function () { preview(); var x = $('pc-q'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 250); };
    if ($('pc-bulk')) $('pc-bulk').onchange = function () {
      st.bulk = this.value;
      if (st.bulk) st.rows.forEach(function (r) { if (r.sel && !r.codes.length) r.codes = [st.bulk]; });
      st.bulk = '';
      preview();
    };
    $('pc-all').onclick = function () { list.forEach(function (r) { r.sel = true; if (!r.codes.length && st.bulk) r.codes = [st.bulk]; }); preview(); };
    $('pc-none').onclick = function () { list.forEach(function (r) { r.sel = false; }); preview(); };
    box.querySelectorAll('[data-sel]').forEach(function (cb) {
      cb.onchange = function () {
        var r = st.rows[Number(cb.dataset.sel)];
        r.sel = cb.checked;
        if (r.sel && !r.codes.length && st.bulk) r.codes = [st.bulk];
        preview();
      };
    });
    box.querySelectorAll('[data-prop]').forEach(function (s) {
      s.onchange = function () {
        var r = st.rows[Number(s.dataset.prop)];
        r.codes = s.value ? [s.value].concat(r.codes.slice(1).filter(function (x) { return x !== s.value; })) : r.codes.slice(1);
        preview();
      };
    });
    box.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () { st.rows[Number(b.dataset.k)].act = b.dataset.act; preview(); };
    });
    if ($('pc-prev')) $('pc-prev').onclick = function () { st.page--; preview(); box.scrollTop = 0; };
    if ($('pc-next')) $('pc-next').onclick = function () { st.page++; preview(); box.scrollTop = 0; };
    $('pc-go').onclick = doImport;
  }

  function summary(c) {
    var p = [];
    if (c.new) p.push(pl(c.new, 'νέα', 'νέες'));
    if (c.same) p.push(pl(c.same, 'συγχώνευση', 'συγχωνεύσεις'));
    if (c.maybe) p.push(n(c.maybe) + ' μάλλον ίδιες');
    if (c.conflict) p.push(pl(c.conflict, 'σύγκρουση', 'συγκρούσεις'));
    var undecided = st.rows.filter(function (r) { return r.sel && r.status === 'maybe' && !r.act; }).length;
    return (p.join(' · ') || 'Τσέκαρε τις επαφές που θέλεις.') +
      (undecided ? ' · ' + n(undecided) + ' για μετά' : '');
  }

  function doImport() {
    var btn = $('pc-go'), hint = $('pc-hint');
    var items = st.rows.filter(function (r) { return r.sel; }).map(toItem);
    var total = { added: 0, merged: 0, later: 0, skipped: 0 }, CHUNK = 300, i = 0;
    btn.disabled = true;
    W.used && W.used('pcImport');
    var step = function () {
      if (i >= items.length) return done(total);
      btn.textContent = 'Περνάω… ' + Math.min(i + CHUNK, items.length) + ' / ' + items.length;
      W.api('pcImport', { src: st.parsed.src, items: items.slice(i, i + CHUNK) }).then(function (r) {
        ['added', 'merged', 'later', 'skipped'].forEach(function (k) { total[k] += r[k] || 0; });
        i += CHUNK;
        step();
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Ξαναδοκίμασε';
        hint.textContent = apiErr(e) + (i ? ' (πέρασαν ήδη ' + i + ' — δεν θα διπλασιαστούν αν ξαναπατήσεις)' : '');
      });
    };
    step();
  }

  function done(t) {
    title('Έτοιμο');
    W.S.contacts = null;
    W.loadContacts().catch(function () {});
    var s = st.status || {};
    var box = body();
    box.innerHTML = '<div class="pc-done"><b>✓</b>' +
      '<p>Νέες <b>' + n(t.added) + '</b> · Συγχωνεύτηκαν <b>' + n(t.merged) + '</b>' +
      (t.later ? ' · Περιμένουν απόφαση <b>' + n(t.later) + '</b>' : '') + '</p>' +
      (t.skipped ? '<p class="pc-note">' + pl(t.skipped, 'επαφή παραλείφθηκε', 'επαφές παραλείφθηκαν') + ' (χωρίς τηλέφωνο ή email).</p>' : '') + '</div>' +
      (t.later ? '<button type="button" class="btn wide" id="pc-to-pend">Δες τα Πιθανά διπλά</button>' : '') +
      (s.mode !== 'auto' ? '<div class="pc-card-in"><b>Και ανάποδα;</b><p>Οι νέοι πελάτες από τις κλήσεις μπορούν να μπαίνουν μόνοι τους στο κινητό σου, ' +
        'στην ομάδα του ακινήτου. Όταν σε ξαναπάρουν, θα βλέπεις ποιος είναι.</p>' +
        '<button type="button" class="btn solid-red wide" id="pc-to-mode">Ναι, θέλω</button></div>' : '') +
      '<button type="button" class="btn wide" data-pop-close-pc>Τέλος</button>';
    if ($('pc-to-pend')) $('pc-to-pend').onclick = pending;
    if ($('pc-to-mode')) $('pc-to-mode').onclick = mode;
    box.querySelector('[data-pop-close-pc]').onclick = function () { W.closePop('pcbox'); };
    loadStatus();
  }

  // ── Νέοι πελάτες στο κινητό ──

  function mode() {
    title('Νέοι πελάτες στο κινητό');
    var s = st.status || { mode: 'off' };
    var opt = function (k, t, d) {
      return '<button type="button" class="pc-opt' + (s.mode === k ? ' on' : '') + '" data-mode="' + k + '"><b>' + t + '</b><span>' + d + '</span></button>';
    };
    var extra = '';
    if (s.mode === 'auto') {
      extra = s.linked
        ? '<p class="pc-ok">✓ Συνδεδεμένο' + (s.last ? ' · τελευταία φορά ' + esc(W.niceDate ? W.niceDate(s.last) : s.last) : '') + '</p>' +
          '<button type="button" class="link" id="pc-relink">Σύνδεση ξανά</button> <button type="button" class="link" id="pc-unlink">Αποσύνδεση</button>'
        : (s.helper
          ? '<p class="pc-note">Ένα βήμα ακόμα: δώσε άδεια να γράφονται οι πελάτες στις επαφές σου Google. Θα ανοίξει μια σελίδα της Google· ' +
            'διάλεξε τον λογαριασμό σου και πάτα «Σύνδεση».</p><button type="button" class="btn solid-red wide" id="pc-link">Σύνδεση με τις επαφές Google</button>' +
            (guessDevice() === 'ios' ? '<p class="pc-note">Στο iPhone: Ρυθμίσεις → Επαφές → Προεπιλεγμένος λογαριασμός → Gmail. Αλλιώς οι επαφές δεν φαίνονται στο κινητό.</p>' : '')
          : '<p class="pc-note">Ο Βοηθός επαφών δεν έχει εγκατασταθεί ακόμα στο γραφείο. Διάλεξε «Με ένα πάτημα» ή ενημέρωσε τον Admin.</p>');
    } else if (s.mode === 'tap') {
      extra = s.pendingPhone
        ? '<button type="button" class="btn solid-red wide" id="pc-tap">Πρόσθεσε ' + pl(s.pendingPhone, 'πελάτη', 'πελάτες') + ' στο κινητό</button>' +
          '<p class="pc-note">Ανοίγει αρχείο επαφών· πάτα «Προσθήκη όλων». Στο Android μπαίνουν και στην ομάδα του ακινήτου, στο iPhone χωρίς ομάδα.</p>'
        : '<p class="pc-ok">✓ Όλοι οι πελάτες σου είναι ήδη στο κινητό.</p>';
    }
    var box = body();
    box.innerHTML = back('hub') +
      opt('auto', 'Αυτόματα <i class="tag showing">Προτείνεται</i>', 'Κάθε βράδυ οι νέοι πελάτες μπαίνουν μόνοι τους στις επαφές σου, στην ομάδα του ακινήτου.') +
      opt('tap', 'Με ένα πάτημα', 'Κάθε βράδυ ειδοποίηση· τους προσθέτεις εσύ με ένα πάτημα.') +
      opt('off', 'Όχι', 'Οι επαφές του κινητού σου δεν αλλάζουν.') +
      '<div class="pc-extra">' + extra + '</div><p class="save-hint err" id="pc-hint"></p>';
    wireBack(box);
    box.querySelectorAll('[data-mode]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.mode === s.mode) return;
        b.disabled = true;
        W.api('pcMode', { mode: b.dataset.mode }).then(function (r) { st.status = r; card(); mode(); })
          .catch(function (e) { b.disabled = false; $('pc-hint').textContent = apiErr(e); });
      };
    });
    var link = function () {
      var w = W.open('about:blank', '_blank');                 // ανοίγει πριν το αίτημα, αλλιώς το μπλοκάρει ο browser
      W.api('pcLinkStart', {}).then(function (r) {
        if (w) w.location = r.url; else W.location.href = r.url;
        $('pc-hint').className = 'save-hint';
        $('pc-hint').textContent = 'Μόλις τελειώσεις στη σελίδα της Google, γύρνα εδώ.';
        setTimeout(function () { loadStatus().then(function () { if (!$('pcbox').hidden) mode(); }); }, 20000);
      }).catch(function (e) { if (w) w.close(); $('pc-hint').textContent = apiErr(e); });
    };
    if ($('pc-link')) $('pc-link').onclick = link;
    if ($('pc-relink')) $('pc-relink').onclick = link;
    if ($('pc-unlink')) $('pc-unlink').onclick = function () {
      W.api('pcUnlink', {}).then(function (r) { st.status = r; mode(); }).catch(function (e) { $('pc-hint').textContent = apiErr(e); });
    };
    if ($('pc-tap')) $('pc-tap').onclick = tapNow;
  }

  /** «Με ένα πάτημα»: ο server δίνει ό,τι λείπει, το κινητό το κάνει αρχείο vCard. */
  function tapNow() {
    var btn = $('pc-tap'), hint = $('pc-hint');
    btn.disabled = true;
    W.api('pcBatch', {}).then(function (r) {
      if (!r.items.length) { btn.disabled = false; return loadStatus().then(mode); }
      var items = r.items.map(function (it) { it.groups = [ALL_GROUP].concat(it.groups); return it; });
      return shareVcf(vcard(items), 'KW πελάτες.vcf').then(function () {
        body().querySelector('.pc-extra').innerHTML =
          '<p>Μπήκαν οι επαφές στο κινητό σου;</p>' +
          '<button type="button" class="btn solid-red wide" id="pc-yes">Ναι, μπήκαν</button>' +
          '<button type="button" class="btn wide" id="pc-no">Όχι, ξανά</button>';
        $('pc-yes').onclick = function () {
          this.disabled = true;
          W.api('pcMarked', { ids: r.items.map(function (x) { return x.id; }) }).then(function () { return loadStatus(); })
            .then(function () { W.toast('Έγινε ✓'); mode(); }).catch(function (e) { $('pc-hint').textContent = apiErr(e); });
        };
        $('pc-no').onclick = mode;
      });
    }).catch(function (e) { btn.disabled = false; hint.textContent = apiErr(e); });
  }

  /** Κοινή χρήση αρχείου (iPhone, Android) ή λήψη. */
  function shareVcf(text, name) {
    var blob = new Blob([text], { type: 'text/vcard;charset=utf-8' });
    try {
      var file = new File([blob], name, { type: 'text/vcard' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: name }).catch(function (e) {
          if (e && e.name === 'AbortError') throw e;
          return download(blob, name);
        });
      }
    } catch (e) { /* συνεχίζουμε με λήψη */ }
    return download(blob, name);
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 60000);
    return Promise.resolve();
  }

  // ── Πιθανά διπλά ──

  function pending() {
    title('Πιθανά διπλά');
    var box = body();
    box.innerHTML = back('hub') + W.skel(3);
    wireBack(box);
    W.api('pcPending', {}).then(function (list) {
      if (!list.length) {
        box.innerHTML = back('hub') + '<div class="empty small"><b>Τίποτα για απόφαση ✓</b>Όλες οι επαφές σου είναι τακτοποιημένες.</div>';
        wireBack(box); loadStatus(); return;
      }
      var who = function (m) { return m ? esc(m.name || m.phone || m.email) + (m.phone ? ' · ' + esc(m.phone) : '') : ''; };
      box.innerHTML = back('hub') + '<p class="pc-lead">Για κάθε μία: είναι ο ίδιος άνθρωπος με μια επαφή που έχεις ήδη;</p>' +
        list.map(function (p) {
          var t = p.byPhone || p.byEmail;
          return '<div class="pc-row on" data-pid="' + esc(p.id) + '"><span><b>' + esc(p.name || p.phones[0] || p.emails[0]) + '</b>' +
            '<small>' + esc([p.phones[0], p.emails[0]].filter(Boolean).join(' · ')) + '</small>' +
            (p.codes.length ? '<small>' + p.codes.map(propName).map(esc).join(', ') + '</small>' : '') + '</span>' +
            '<p class="pc-why">' + esc(p.why) + '</p>' +
            (p.byPhone ? '<p class="pc-why">Ίδιο τηλέφωνο: ' + who(p.byPhone) + '</p>' : '') +
            (p.byEmail ? '<p class="pc-why">Ίδιο email: ' + who(p.byEmail) + '</p>' : '') +
            '<div class="pc-ask">' +
              (p.byPhone ? '<button type="button" class="btn" data-res="merge" data-t="' + esc(p.byPhone.id) + '">Ένωσε με ' + esc(p.byPhone.name || 'αυτή του τηλεφώνου') + '</button>' : '') +
              (p.byEmail ? '<button type="button" class="btn" data-res="merge" data-t="' + esc(p.byEmail.id) + '">Ένωσε με ' + esc(p.byEmail.name || 'αυτή του email') + '</button>' : '') +
              (!t || (!p.byPhone !== !p.byEmail) ? '<button type="button" class="btn" data-res="separate">Ξεχωριστή επαφή</button>' : '') +
              '<button type="button" class="btn" data-res="skip">Άσ\' τη</button></div></div>';
        }).join('') + '<p class="save-hint err" id="pc-hint"></p>';
      wireBack(box);
      box.querySelectorAll('[data-res]').forEach(function (b) {
        b.onclick = function () {
          var row = b.closest('[data-pid]');
          row.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
          W.api('pcResolve', { id: row.dataset.pid, action: b.dataset.res, target: b.dataset.t || '' }).then(function () {
            row.remove();
            W.S.contacts = null;
            if (!box.querySelector('[data-pid]')) pending();
          }).catch(function (e) {
            row.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
            $('pc-hint').textContent = apiErr(e);
          });
        };
      });
    }).catch(function (e) { box.innerHTML = back('hub') + '<div class="empty small"><b>Δεν φορτώθηκαν</b>' + esc(apiErr(e)) + '</div>'; wireBack(box); });
  }

  // ── Κάρτα στις Επαφές, κουμπί στην επαφή, Ενδιαφερόμενοι στο ακίνητο ──

  function card() {
    var el = $('pc-card');
    if (!el) return;
    el.hidden = !on();
    if (!on()) return;
    if (!st.status && !st.asked) { st.asked = true; loadStatus(); }      // μία φορά: για τον αριθμό πάνω στην κάρτα
    var s = st.status;
    var badge = s ? (s.pendingDup || 0) + (s.mode === 'tap' ? s.pendingPhone || 0 : 0) : 0;
    el.innerHTML = W.ico('phone') + '<span><b>Επαφές κινητού</b><small>' +
      (s && s.mode === 'auto' && s.linked ? 'Αυτόματα στο κινητό ✓' : 'Φέρε τις επαφές σου · νέοι πελάτες στο κινητό') + '</small></span>' +
      (badge ? '<i class="badge">' + badge + '</i>' : '') + W.ico('next', 'ico chev');
    el.onclick = open;
  }

  function contactGroups(c) {
    return [ALL_GROUP].concat((c.codes || []).map(function (x) { return [x.code, x.street].filter(Boolean).join(' '); }));
  }

  function contact(c) {
    var b = $('btn-ct-phone');
    if (!b) return;
    b.hidden = !on() || !((c.phones || []).length || (c.emails || []).length);
    W.label(b, 'phone', 'Αποθήκευση στο κινητό');
    b.onclick = function () {
      W.used && W.used('pcSaveOne');
      shareVcf(vcard([{ name: c.name, phones: c.phones, emails: c.emails, groups: contactGroups(c),
                        note: (c.codes || []).length ? 'KW App · ' + contactGroups(c).slice(1).join(' · ') : '' }]),
               (c.name || 'Επαφή').replace(/[\\/:*?"<>|]/g, '') + '.vcf').catch(function () {});
    };
  }

  function interested(p) {
    var k = code(p.code);
    return (W.S.contacts || []).filter(function (c) { return (c.codes || []).some(function (x) { return code(x.code) === k; }); });
  }

  function prop(p) {
    var b = $('pd-interest');
    if (!b) return;
    b.hidden = !on() || !p.mine;
    if (b.hidden) return;
    var paint = function () {
      var list = W.S.contacts ? interested(p) : null;
      W.label(b, 'people', 'Ενδιαφερόμενοι' + (list ? ' (' + list.length + ')' : ''));
    };
    paint();
    if (!W.S.contacts) W.loadContacts().then(function () { if (W.S.prop === p) paint(); }, function () {});
    b.onclick = function () { showInterested(p); };
  }

  function showInterested(p) {
    W.openPop('pcbox');
    title('Ενδιαφερόμενοι · ' + (p.street || p.code));
    var box = body();
    var paint = function () {
      var list = interested(p).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'el'); });
      if (!list.length) {
        box.innerHTML = '<div class="empty small"><b>Κανείς ακόμα</b>Οι πελάτες μπαίνουν εδώ από τις κλήσεις και από τις επαφές του κινητού σου.</div>';
        return;
      }
      box.innerHTML = '<p class="pc-lead">' + pl(list.length, 'πελάτης', 'πελάτες') + ' για το ακίνητο.</p>' +
        list.map(function (c) {
          var tel = (c.phones || [])[0];
          return '<div class="pc-row on pc-int"><button type="button" class="pc-open" data-cid="' + esc(c.id) + '"><b>' + esc(c.name || tel || (c.emails || [])[0]) + '</b>' +
            '<small>' + esc([tel, c.last ? 'κλήση ' + (W.niceDate ? W.niceDate(c.last) : c.last) : ''].filter(Boolean).join(' · ')) + '</small></button>' +
            (tel ? '<a class="btn" href="tel:' + esc(W.intlPhone ? W.intlPhone(tel) : tel) + '">' + W.ico('phone') + '</a>' : '') + '</div>';
        }).join('') +
        '<button type="button" class="btn wide" id="pc-int-save">' + W.ico('phone') + '<span>Αποθήκευση όλων στο κινητό</span></button>';
      box.querySelectorAll('[data-cid]').forEach(function (b) {
        b.onclick = function () { W.closePop('pcbox'); W.openContact(b.dataset.cid); };
      });
      $('pc-int-save').onclick = function () {
        shareVcf(vcard(list.map(function (c) {
          return { name: c.name, phones: c.phones, emails: c.emails, groups: contactGroups(c), note: 'KW App · ' + contactGroups(c).slice(1).join(' · ') };
        })), (p.code + ' ' + (p.street || '')).trim().replace(/[\\/:*?"<>|]/g, '') + '.vcf').catch(function () {});
      };
    };
    if (W.S.contacts) paint();
    else { box.innerHTML = W.skel(4); W.loadContacts().then(paint, function (e) { box.innerHTML = '<div class="empty small"><b>Δεν φορτώθηκαν</b>' + esc(e.message) + '</div>'; }); }
  }

  W.kwPc = { open: open, card: card, contact: contact, prop: prop, logic: LOGIC };
})();
