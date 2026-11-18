// 2.10 · Marketing: προωθητικά ανά ακίνητο (story, post, brochure, banner, open house)
//
//  Το πρότυπο = φόντο (PNG από το Canva, χωρίς κείμενα/φωτογραφίες) + θέσεις (JSON).
//  Το κινητό τα ζωγραφίζει σε canvas: η προεπισκόπηση ΕΙΝΑΙ το τελικό αρχείο, οπότε κάθε
//  αλλαγή (κείμενο, μέγεθος, θέση, φωτογραφία) φαίνεται αμέσως και δεν τρέχει τίποτα στον server.
//  Server: μόνο mktGet / mktSave (περιγραφή, λινκ), mktAsset (φόντο, φωτογραφία μεσίτη), mktLog (μετρήσεις).
//
//  Τα πρότυπα και οι φωτογραφίες των μεσιτών ζουν στο Drive (Ιδιότητα MKT_FOLDER_ID), όχι στο repo.
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : globalThis;

  var DESC_MAX = 260;
  var LINK_MAX = 500;
  var DAYS = ['ΚΥΡΙΑΚΗ', 'ΔΕΥΤΕΡΑ', 'ΤΡΙΤΗ', 'ΤΕΤΑΡΤΗ', 'ΠΕΜΠΤΗ', 'ΠΑΡΑΣΚΕΥΗ', 'ΣΑΒΒΑΤΟ'];
  var FAM = { noto: 'KWNoto', open: 'KWOpen', fira: 'KWFira' };
  var GREEK = 'U+0370-03FF, U+1F00-1FFF';
  var LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212';
  var FONTS = [
    ['KWNoto', 'noto-sans', '400', 'normal', 'normal'], ['KWNoto', 'noto-sans', '700', 'normal', 'normal'],
    ['KWOpen', 'open-sans', '400', 'normal', 'normal'], ['KWOpen', 'open-sans', '700', 'italic', 'italic'],
    ['KWFira', 'fira-sans', '700', 'normal', 'normal']
  ];

  // ═══════════════════════════════════════════════════════════════
  //  Καθαρή λογική (ελέγχεται στα tests, χωρίς browser)
  // ═══════════════════════════════════════════════════════════════

  /** Κεφαλαία όπως γράφονται στα ελληνικά: χωρίς τόνους, με διαλυτικά. «Ενοικιάζεται» → «ΕΝΟΙΚΙΑΖΕΤΑΙ». */
  function upperGr(s) {
    return String(s == null ? '' : s).normalize('NFD')
      .replace(/[\u0300\u0301\u0342\u0313\u0314\u0345]/g, '').toUpperCase().normalize('NFC');
  }

  /** Συναλλαγή ακινήτου → ετικέτα του προτύπου. Άγνωστη → '' (ο μεσίτης διαλέγει). */
  function dealLabel(deal) {
    var d = upperGr(deal);
    if (/ΕΝΟΙΚ|ΜΙΣΘ|RENT|LEASE/.test(d)) return 'ΕΝΟΙΚΙΑΖΕΤΑΙ';
    if (/ΠΩΛ|SALE|ΑΓΟΡ/.test(d)) return 'ΠΩΛΕΙΤΑΙ';
    return '';
  }

  /**
   * Έλεγχος λινκ πριν γίνει QR. hosts (προαιρετικό): επιτρεπτά domains από τη ρύθμιση MKT_LINK_HOSTS.
   * → { ok, url } ή { ok:false, error }.
   */
  function checkLink(s, hosts) {
    var url = String(s == null ? '' : s).trim();
    if (!url) return { ok: true, url: '' };
    if (url.length > LINK_MAX) return { ok: false, error: 'Το λινκ είναι πολύ μεγάλο.' };
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    var m = /^https?:\/\/([^\/?#\s:@]+)(:\d+)?([\/?#][^\s]*)?$/i.exec(url);
    if (!m || m[1].indexOf('.') === -1) return { ok: false, error: 'Δεν μοιάζει με λινκ. Αντίγραψέ το από τη σελίδα του ακινήτου.' };
    var host = m[1].toLowerCase();
    var list = (hosts || []).map(function (h) { return String(h).toLowerCase().replace(/^www\./, '').trim(); }).filter(Boolean);
    if (list.length && !list.some(function (h) { var bare = host.replace(/^www\./, ''); return bare === h || bare.slice(-h.length - 1) === '.' + h; })) {
      return { ok: false, error: 'Επιτρέπονται λινκ μόνο από: ' + list.join(', ') + '.' };
    }
    return { ok: true, url: url };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Open House: «2026-12-05», «13:00», «16:00» → «13:00 – 16:00 / ΣΑΒΒΑΤΟ 05.12.2026». */
  function ohLine(date, from, to) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    var day = '';
    if (m) {
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      day = DAYS[d.getDay()] + ' ' + m[3] + '.' + m[2] + '.' + m[1];
    }
    var t = [from, to].filter(Boolean).join(' – ');
    return [t, day].filter(Boolean).join(' / ');
  }

  /** «{deal}» κ.λπ. → τιμές. Άγνωστα κλειδιά → κενό. */
  function fill(text, data) {
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (_, k) { return data && data[k] != null ? String(data[k]) : ''; });
  }

  function address(p) { return [p && p.street, p && p.area].filter(Boolean).join(', '); }

  function fmtNum(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /** Πρόχειρη περιγραφή από τα στοιχεία, για να μη ξεκινά ο μεσίτης από άδεια σελίδα. */
  function draftDesc(p, deal) {
    p = p || {};
    var parts = [];
    var head = [p.type || 'Ακίνητο', p.sqm ? fmtNum(p.sqm) + ' τ.μ.' : ''].filter(Boolean).join(' ');
    var first = head + (p.area ? ', ' + p.area : '');
    parts.push(/\.$/.test(first) ? first : first + '.');
    if (Number(p.price) > 0) {
      var rent = dealLabel(deal || p.deal) === 'ΕΝΟΙΚΙΑΖΕΤΑΙ';
      parts.push((rent ? 'Μίσθωμα ' : 'Τιμή ') + fmtNum(p.price) + ' €' + (rent ? '/μήνα.' : '.'));
    }
    return parts.join(' ').slice(0, DESC_MAX);
  }

  /** Λεζάντα για Instagram/Facebook. tags: από τη ρύθμιση MKT_TAGS. */
  function caption(p, data, link, tags) {
    var first = [data.deal ? data.deal.charAt(0) + data.deal.slice(1).toLowerCase() : '', p.type, p.sqm ? fmtNum(p.sqm) + ' τ.μ.' : '', p.area]
      .filter(Boolean).join(' · ');
    var out = [first, data.desc, 'Κωδικός: ' + (p.code || ''), link || ''].filter(Boolean).join('\n');
    var tg = String(tags || '').trim();
    var area = String(p.area || '').replace(/[^0-9A-Za-zΑ-Ωα-ωΆ-Ώά-ώϊϋΐΰ]/g, '');
    if (area) tg = (tg ? tg + ' ' : '') + '#' + area;
    return tg ? out + '\n\n' + tg : out;
  }

  /** Σπάσιμο σε γραμμές. measure(κείμενο) → πλάτος. Λέξη μεγαλύτερη από τη γραμμή σπάει σε γράμματα. */
  function wrap(measure, text, maxW) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var cand = line ? line + ' ' + w : w;
        if (measure(cand) <= maxW) { line = cand; return; }
        if (line) out.push(line);
        line = w;
        while (measure(line) > maxW && line.length > 1) {
          var i = line.length - 1;
          while (i > 1 && measure(line.slice(0, i)) > maxW) i--;
          out.push(line.slice(0, i));
          line = line.slice(i);
        }
      });
      out.push(line);
    });
    return out;
  }

  /**
   * Διάταξη ενός κειμένου. measure(str, size, L) → πλάτος σε μονάδες προτύπου.
   * ed: αλλαγές του μεσίτη { text, size, dx, dy }. Με L.fit και χωρίς δικό του μέγεθος, μικραίνει ώσπου να χωρέσει.
   * → { lines, size, lh, prefix, overflow, empty }
   */
  function layoutText(measure, L, ed, data) {
    ed = ed || {};
    var base = ed.text != null ? String(ed.text) : fill(L.text, data);
    base = base.replace(/[ \t]+\n/g, '\n').trim();
    var prefix = L.prefix || '';
    if (L.upper) { base = upperGr(base); prefix = upperGr(prefix); }
    if (!base) return { lines: [], size: L.size, lh: L.lh || 1.2, prefix: '', overflow: false, empty: true };
    var lh = L.lh || 1.2, max = L.maxLines || 99;
    var size = ed.size || L.size, min = L.minSize || Math.round(L.size * 0.5);
    var full = prefix + base;
    var lay = function (sz) {
      var mw = function (t) { return measure(t, sz, L); };
      return max === 1 ? [full.replace(/\s*\n\s*/g, ' ')] : wrap(mw, full, L.w);
    };
    var fits = function (ls, sz) {
      if (ls.length > max || ls.length * sz * lh > L.h + 0.5) return false;
      return ls.every(function (l) { return measure(l, sz, L) <= L.w + 0.5; });
    };
    var lines = lay(size);
    if (L.fit && !ed.size) {
      var guard = 0;
      while (!fits(lines, size) && size > min && guard++ < 60) { size = Math.max(min, size * 0.95); lines = lay(size); }
    }
    return { lines: lines, size: size, lh: lh, prefix: prefix, overflow: !fits(lines, size), empty: false };
  }

  /** Τμήμα πηγής ώστε η εικόνα να γεμίζει το πλαίσιο (cover). fx, fy: 0–1 (0,5 = κέντρο). */
  function coverRect(iw, ih, w, h, fx, fy) {
    var s = Math.max(w / iw, h / ih);
    var sw = w / s, sh = h / s;
    var cx = fx == null ? 0.5 : fx, cy = fy == null ? 0.5 : fy;
    return { sx: (iw - sw) * cx, sy: (ih - sh) * cy, sw: sw, sh: sh, exW: iw * s - w, exH: ih * s - h };
  }

  /** Τι υπάρχει κάτω από το δάχτυλο (x, y σε μονάδες προτύπου). Μόνο κείμενα και φωτογραφίες αλλάζουν. */
  function hit(tpl, edits, x, y) {
    var ls = tpl.layers || [];
    for (var i = ls.length - 1; i >= 0; i--) {
      var L = ls[i];
      if (L.type !== 'text' && L.type !== 'photo') continue;
      var e = (edits && edits[L.id]) || {};
      var lx = L.x + (e.dx || 0), ly = L.y + (e.dy || 0);
      var pad = L.type === 'text' ? 12 : 0;
      if (x >= lx - pad && x <= lx + L.w + pad && y >= ly - pad && y <= ly + L.h + pad) return L.id;
    }
    return null;
  }

  /** Οι φωτογραφίες με σειρά: εξώφυλλο πρώτο. */
  function photoOrder(media) {
    var ph = (media && media.photos) || [];
    var ids = ph.map(function (x) { return x.id; });
    var c = media && media.cover;
    if (c && ids.indexOf(c) > 0) { ids.splice(ids.indexOf(c), 1); ids.unshift(c); }
    return ids;
  }

  /** Ποια φωτογραφία μπαίνει σε κάθε θέση. Λιγότερες φωτογραφίες από θέσεις → επαναλαμβάνονται. */
  function slotPhoto(order, slot, edit) {
    if (edit && edit.pick && order.indexOf(edit.pick) !== -1) return edit.pick;
    if (!order.length) return '';
    return order[slot % order.length];
  }

  /** Έλεγχος προτύπου από το Drive: όσα λείπουν σπάνε τη σχεδίαση, οπότε το πρότυπο δεν εμφανίζεται. */
  function validTpl(t) {
    if (!t || !t.id || !(t.w > 0) || !(t.h > 0) || !t.bg || !Array.isArray(t.layers)) return false;
    return t.layers.every(function (L) {
      if (L.type === 'bg') return true;
      if (['text', 'photo', 'qr', 'agent'].indexOf(L.type) === -1) return false;
      return L.id && isFinite(L.x) && isFinite(L.y) && L.w > 0 && L.h > 0 && (L.type !== 'text' || L.size > 0);
    });
  }

  // ── PDF μίας σελίδας με μία εικόνα JPEG και (προαιρετικά) πατήσιμο λινκ ──
  // Δικό μας, ~50 γραμμές, ώστε να μη φορτώνουμε βιβλιοθήκη 350KB για ένα brochure.
  var A4 = [595.28, 841.89];

  function pdfBytes(jpeg, iw, ih, link, linkBox) {
    var pw = A4[0], ph = A4[1];
    var s = Math.min(pw / iw, ph / ih), dw = iw * s, dh = ih * s, ox = (pw - dw) / 2, oy = (ph - dh) / 2;
    var f = function (n) { return (Math.round(n * 100) / 100).toString(); };
    var esc = function (t) { return String(t).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, function (c) { return encodeURI(c); }); };
    var content = 'q ' + f(dw) + ' 0 0 ' + f(dh) + ' ' + f(ox) + ' ' + f(oy) + ' cm /Im0 Do Q';
    var annot = '';
    if (link && linkBox) {
      var r = [ox + linkBox.x * s, oy + (ih - linkBox.y - linkBox.h) * s, ox + (linkBox.x + linkBox.w) * s, oy + (ih - linkBox.y) * s];
      annot = '<< /Type /Annot /Subtype /Link /Rect [' + r.map(f).join(' ') + '] /Border [0 0 0] /A << /S /URI /URI (' + esc(link) + ') >> >>';
    }
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pw) + ' ' + f(ph) + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R' + (annot ? ' /Annots [6 0 R]' : '') + ' >>',
      null,                                   // η εικόνα: δυαδικά δεδομένα
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'
    ];
    if (annot) objs.push(annot);
    var enc = function (str) { var a = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 255; return a; };
    var parts = [], len = 0, offs = [];
    var push = function (u8) { parts.push(u8); len += u8.length; };
    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    objs.forEach(function (o, i) {
      offs.push(len);
      if (o === null) {
        push(enc((i + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'));
        push(jpeg);
        push(enc('\nendstream\nendobj\n'));
      } else push(enc((i + 1) + ' 0 obj\n' + o + '\nendobj\n'));
    });
    var xref = len;
    var x = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' +
      offs.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('') +
      'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    push(enc(x));
    var out = new Uint8Array(len), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Σχεδίαση σε canvas
  // ═══════════════════════════════════════════════════════════════

  function fontStr(L, size) {
    return (L.style === 'italic' ? 'italic ' : '') + (L.weight || 700) + ' ' + Math.round(size * 100) / 100 + 'px ' +
      (FAM[L.font] || FAM.noto) + ', "Noto Sans", Arial, sans-serif';
  }

  function measurer(ctx) {
    return function (str, size, L) {
      ctx.font = fontStr(L, size);
      var w = ctx.measureText(str).width;
      return w + (L.ls ? L.ls * size * Math.max(0, str.length - 1) : 0);
    };
  }

  /** Γράφει μία γραμμή, με απόσταση γραμμάτων αν χρειάζεται (το ctx.letterSpacing δεν υπάρχει σε όλα τα iPhone). */
  function drawRun(ctx, str, x, y, L, size) {
    if (!L.ls) { ctx.fillText(str, x, y); return ctx.measureText(str).width; }
    var cx = x, gap = L.ls * size;
    for (var i = 0; i < str.length; i++) { ctx.fillText(str[i], cx, y); cx += ctx.measureText(str[i]).width + gap; }
    return cx - x - gap;
  }

  function drawText(ctx, L, E, meas, preview) {
    var ed = E.edits[L.id] || {};
    var lay = layoutText(meas, L, ed, E.data);
    E.lay[L.id] = lay;
    var x = L.x + (ed.dx || 0), y = L.y + (ed.dy || 0);
    if (!lay.empty) {
      ctx.font = fontStr(L, lay.size);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      var step = lay.size * lay.lh, total = lay.lines.length * step;
      var top = L.valign === 'top' ? y : L.valign === 'bottom' ? y + L.h - total : y + (L.h - total) / 2;
      var pre = lay.prefix.length;
      lay.lines.forEach(function (line, i) {
        var lw = meas(line, lay.size, L);
        var lx = L.align === 'left' ? x : L.align === 'right' ? x + L.w - lw : x + (L.w - lw) / 2;
        var ly = top + step * i + step / 2;
        var cut = Math.min(pre, line.length);
        if (cut > 0 && L.prefixColor) {
          ctx.fillStyle = L.prefixColor;
          var pw = drawRun(ctx, line.slice(0, cut), lx, ly, L, lay.size);
          ctx.fillStyle = L.color || '#000';
          drawRun(ctx, line.slice(cut), lx + pw + (L.ls ? L.ls * lay.size : 0), ly, L, lay.size);
        } else {
          ctx.fillStyle = L.color || '#000';
          drawRun(ctx, line, lx, ly, L, lay.size);
        }
        pre -= line.length + 1;
      });
    }
    if (preview) frame(ctx, x, y, L.w, L.h, E.sel === L.id, lay.overflow, E.tpl.w);
  }

  function frame(ctx, x, y, w, h, on, bad, ref) {
    if (!on && !bad) return;
    var lw = Math.max(2, ref / 300);
    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash([lw * 4, lw * 3]);
    ctx.strokeStyle = bad ? '#e0102a' : '#1a73e8';
    ctx.strokeRect(x - lw, y - lw, w + 2 * lw, h + 2 * lw);
    ctx.restore();
  }

  function drawPhoto(ctx, L, E, preview) {
    var ed = E.edits[L.id] || {};
    var id = slotPhoto(E.order, L.slot || 0, ed);
    var img = id && E.photos[id];
    ctx.save();
    ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); ctx.clip();
    if (img) {
      var r = coverRect(img.naturalWidth, img.naturalHeight, L.w, L.h, ed.fx, ed.fy);
      E.cover[L.id] = r;
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, L.x, L.y, L.w, L.h);
    } else {
      ctx.fillStyle = '#d9d6d2'; ctx.fillRect(L.x, L.y, L.w, L.h);
    }
    ctx.restore();
    if (preview) frame(ctx, L.x, L.y, L.w, L.h, E.sel === L.id, false, E.tpl.w);
  }

  /** Η φωτογραφία του μεσίτη (PNG χωρίς φόντο): χωράει ολόκληρη, κάτω-κάτω στο πλαίσιο. */
  function drawAgent(ctx, L, E) {
    var img = E.agentImg;
    if (!img) return;
    var s = Math.min(L.w / img.naturalWidth, L.h / img.naturalHeight);
    var w = img.naturalWidth * s, h = img.naturalHeight * s;
    var x = L.x + (L.w - w) / 2, y = L.anchor === 'top' ? L.y : L.y + L.h - h;
    ctx.drawImage(img, x, y, w, h);
  }

  function drawQr(ctx, L, E) {
    if (!E.link || typeof W.qrcode !== 'function') return;
    var q = W.qrcode(0, 'M');
    q.addData(unescape(encodeURIComponent(E.link)));   // UTF-8 bytes (ελληνικά σε λινκ)
    q.make();
    var n = q.getModuleCount(), quiet = 2;
    var cell = Math.min(L.w, L.h) / (n + quiet * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(L.x, L.y, L.w, L.h);
    ctx.fillStyle = '#000000';
    var ox = L.x + (L.w - cell * n) / 2, oy = L.y + (L.h - cell * n) / 2;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        // +0.5px επικάλυψη: χωρίς λευκές γραμμές ανάμεσα στα τετράγωνα όταν μικραίνει
        if (q.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  /** Όλο το πρότυπο, σε μονάδες προτύπου (ο καλών βάζει την κλίμακα στο ctx). */
  function paint(ctx, E, preview) {
    var meas = measurer(ctx);
    E.lay = {}; E.cover = {};
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, E.tpl.w, E.tpl.h);
    E.tpl.layers.forEach(function (L) {
      if (L.type === 'bg') { if (E.bg) ctx.drawImage(E.bg, 0, 0, E.tpl.w, E.tpl.h); }
      else if (L.type === 'photo') drawPhoto(ctx, L, E, preview);
      else if (L.type === 'text') drawText(ctx, L, E, meas, preview);
      else if (L.type === 'agent') drawAgent(ctx, L, E);
      else if (L.type === 'qr') drawQr(ctx, L, E);
    });
    if (preview && E.tpl.safe && E.showSafe) {
      ctx.save();
      ctx.fillStyle = 'rgba(26,115,232,.18)';
      ctx.fillRect(0, 0, E.tpl.w, E.tpl.safe.top || 0);
      ctx.fillRect(0, E.tpl.h - (E.tpl.safe.bottom || 0), E.tpl.w, E.tpl.safe.bottom || 0);
      ctx.restore();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Φόρτωση: γραμματοσειρές, φόντα, φωτογραφίες
  // ═══════════════════════════════════════════════════════════════

  var fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    if (!W.FontFace || !W.document || !W.document.fonts) return (fontsReady = Promise.resolve());
    var all = [];
    FONTS.forEach(function (f) {
      [['greek', GREEK], ['latin', LATIN]].forEach(function (sub) {
        var file = 'fonts/' + f[1] + '-' + sub[0] + '-' + f[2] + '-' + f[4] + '.woff2';
        var ff = new W.FontFace(f[0], 'url(' + file + ')', { weight: f[2], style: f[3], unicodeRange: sub[1] });
        W.document.fonts.add(ff);
        all.push(ff.load().catch(function () { /* χωρίς αυτή, γράφει με τη γραμματοσειρά του κινητού */ }));
      });
    });
    return (fontsReady = Promise.all(all));
  }

  function toImg(src) {
    return new Promise(function (ok, bad) {
      if (!src) return ok(null);
      var i = new W.Image();
      i.onload = function () { ok(i); };
      i.onerror = function () { bad(new Error('Η εικόνα δεν φόρτωσε.')); };
      i.src = src;
    });
  }

  var CACHE = 'kw-mkt-1';
  var mem = {};

  /** Φόντο προτύπου. Μένει στη συσκευή (Cache Storage) ανά έκδοση v, οπότε κατεβαίνει μία φορά. */
  function bgSrc(t) {
    var key = 'mkt-bg/' + t.id + '/' + (t.v || 1);
    if (mem[key]) return Promise.resolve(mem[key]);
    var url = new URL(key, W.location.href).href;
    var caches = W.caches;
    var fromNet = function () {
      return W.api('mktAsset', { kind: 'bg', tpl: t.id }).then(function (d) {
        mem[key] = d.src;
        if (caches) caches.open(CACHE).then(function (c) { return c.put(url, new W.Response(d.src)); }).catch(function () {});
        return d.src;
      });
    };
    if (!caches) return fromNet();
    return caches.open(CACHE).then(function (c) { return c.match(url); }).then(function (r) {
      return r ? r.text().then(function (s) { mem[key] = s; return s; }) : fromNet();
    }).catch(fromNet);
  }

  /** Φωτογραφία ακινήτου σε μέγεθος size (s/m/l). Ίδια μνήμη με την υπόλοιπη εφαρμογή (S.imgs). */
  function photoSrc(code, id, size) {
    var k = id + ':' + size, S = W.S || {};
    S.imgs = S.imgs || {};
    if (S.imgs[k]) return Promise.resolve(S.imgs[k]);
    return W.api('mediaImg', { code: code, id: id, size: size }).then(function (x) { S.imgs[k] = x.src; return x.src; });
  }

  function mediaOf(code) {
    var S = W.S || {};
    S.media = S.media || {};
    if (S.media[code]) return Promise.resolve(S.media[code]);
    return W.api('media', { code: code }).then(function (r) { S.media[code] = r; return r; });
  }

  var agentMem = {};
  function agentImg(code) {
    if (agentMem[code] !== undefined) return Promise.resolve(agentMem[code]);
    return W.api('mktAsset', { kind: 'agent', code: code })
      .then(function (d) { return toImg(d.src); })
      .then(function (i) { agentMem[code] = i; return i; })
      .catch(function () { return null; });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Ενότητα «Marketing» μέσα στο ακίνητο
  // ═══════════════════════════════════════════════════════════════

  var st = { p: null, d: null, req: 0, dirty: false };

  function $(id) { return W.document.getElementById(id); }
  function esc(s) { return W.esc ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function toast(m, bad) { if (W.toast) W.toast(m, bad); }

  function dataFor(p, d, extra) {
    var deal = dealLabel((d && d.deal) || p.deal);
    return {
      deal: deal, desc: (d && d.desc) || '', code: p.code || '', agent: p.partner || '',
      address: address(p), oh: extra && extra.oh != null ? extra.oh : ''
    };
  }

  function show(p) {
    var body = $('pd-mkt-body');
    if (!body || !p) return;
    st.p = p; st.dirty = false;
    var my = ++st.req;
    body.innerHTML = '<p class="card-note">Φόρτωση…</p>';
    W.api('mktGet', { code: p.code }).then(function (d) {
      if (my !== st.req) return;
      st.d = d;
      st.d.templates = (d.templates || []).filter(validTpl);
      paintPane();
    }).catch(function (e) {
      if (my !== st.req) return;
      body.innerHTML = '<p class="save-hint err">' + esc(e.net ? 'Χρειάζεται σύνδεση για το Marketing.' : e.message) + '</p>';
    });
  }

  function paintPane() {
    var p = st.p, d = st.d, body = $('pd-mkt-body');
    var stats = d.stats || {}, made = 0, shared = 0;
    Object.keys(stats.dl || {}).forEach(function (k) { made += stats.dl[k]; });
    Object.keys(stats.sh || {}).forEach(function (k) { shared += stats.sh[k]; });
    var needDeal = !dealLabel(p.deal);
    var max = d.descMax || DESC_MAX;
    body.innerHTML =
      '<div class="mk-box">' +
        '<label class="field"><span>Περιγραφή για προωθητικά</span>' +
          '<textarea id="mk-desc" rows="4" maxlength="' + max + '" placeholder="π.χ. Διαμπερές 2άρι 75 τ.μ., 3ος όροφος, ανακαινισμένο, κοντά στο μετρό."></textarea></label>' +
        '<div class="mk-under"><button type="button" class="mk-link-btn" id="mk-draft">Πρόταση κειμένου</button><span id="mk-desc-n"></span></div>' +
        '<label class="field"><span>Λινκ ακινήτου (γίνεται QR)</span>' +
          '<input id="mk-link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="' + LINK_MAX + '" placeholder="https://…"></label>' +
        (needDeal ? '<label class="field"><span>Συναλλαγή</span><select id="mk-deal"><option value="">Διάλεξε…</option>' +
          '<option>Πώληση</option><option>Ενοικίαση</option></select></label>' : '') +
        '<button class="btn primary wide" id="mk-save" disabled>Αποθήκευση</button>' +
        '<p class="save-hint" id="mk-hint"></p>' +
      '</div>' +
      '<h3 class="mk-h">Πρότυπα</h3>' +
      (d.templates.length ? '<div class="mk-grid" id="mk-grid">' + d.templates.map(function (t) {
        return '<button type="button" class="mk-tpl" data-id="' + esc(t.id) + '">' +
          '<span class="mk-thumb"><canvas></canvas></span>' +
          '<b>' + esc(t.name || t.id) + '</b><small>' + esc(t.hint || '') + '</small></button>';
      }).join('') + '</div>'
        : '<p class="card-note">Δεν υπάρχουν ακόμα πρότυπα. Ο Admin τα βάζει στον φάκελο Marketing του Drive.</p>') +
      '<p class="mk-stats">' + (made ? made + ' δημιουργήθηκαν · ' + shared + ' κοινοποιήθηκαν' : 'Δεν έχει φτιαχτεί ακόμα προωθητικό για αυτό το ακίνητο.') + '</p>';

    var desc = $('mk-desc'), link = $('mk-link'), save = $('mk-save');
    desc.value = d.desc || '';
    link.value = d.link || '';
    if ($('mk-deal')) $('mk-deal').value = d.deal || '';
    var count = function () { $('mk-desc-n').textContent = desc.value.length + '/' + max; };
    var dirty = function () { st.dirty = true; save.disabled = false; $('mk-hint').textContent = ''; $('mk-hint').className = 'save-hint'; };
    count();
    desc.oninput = function () { count(); dirty(); };
    link.oninput = dirty;
    if ($('mk-deal')) $('mk-deal').onchange = dirty;
    $('mk-draft').onclick = function () {
      if (desc.value.trim() && !W.confirm('Να αντικατασταθεί το κείμενο που έγραψες;')) return;
      desc.value = draftDesc(p, $('mk-deal') ? $('mk-deal').value : d.deal);
      count(); dirty(); desc.focus();
    };
    save.onclick = function () { saveInfo().catch(function () {}); };
    W.Array.prototype.forEach.call(body.querySelectorAll('.mk-tpl'), function (b) {
      b.onclick = function () {
        var go = function () { openEditor(b.dataset.id); };
        if (st.dirty) saveInfo().then(go).catch(function () {}); else go();
      };
    });
    thumbs();
  }

  function saveInfo() {
    var p = st.p, save = $('mk-save'), hint = $('mk-hint');
    var chk = checkLink($('mk-link').value, st.d.hosts);
    if (!chk.ok) { hint.className = 'save-hint err'; hint.textContent = chk.error; return Promise.reject(new Error(chk.error)); }
    save.disabled = true;
    hint.className = 'save-hint'; hint.textContent = 'Αποθήκευση…';
    return W.api('mktSave', {
      code: p.code, desc: $('mk-desc').value, link: chk.url,
      deal: $('mk-deal') ? $('mk-deal').value : undefined, rev: st.d.rev
    }).then(function (r) {
      st.d.desc = r.desc; st.d.link = r.link; st.d.deal = r.deal; st.d.rev = r.rev;
      $('mk-link').value = r.link;
      st.dirty = false;
      hint.textContent = 'Αποθηκεύτηκε';
      thumbs();
    }).catch(function (e) {
      save.disabled = false;
      hint.className = 'save-hint err';
      hint.textContent = e.net ? 'Χρειάζεται σύνδεση για την αποθήκευση.' : e.message;
      throw e;
    });
  }

  /** Μικρογραφία κάθε προτύπου με τα στοιχεία ΑΥΤΟΥ του ακινήτου: ο μεσίτης βλέπει πριν ανοίξει. */
  function thumbs() {
    var p = st.p, d = st.d, grid = $('mk-grid');
    if (!grid) return;
    var my = st.req;
    Promise.all([loadFonts(), mediaOf(p.code).catch(function () { return null; }), agentImg(p.code)]).then(function (r) {
      var order = photoOrder(r[1]);
      var need = order.slice(0, 4);
      return Promise.all(need.map(function (id) { return photoSrc(p.code, id, 'm').then(toImg).catch(function () { return null; }); }))
        .then(function (imgs) {
          var photos = {};
          need.forEach(function (id, i) { if (imgs[i]) photos[id] = imgs[i]; });
          d.templates.forEach(function (t) {
            bgSrc(t).then(toImg).then(function (bg) {
              if (my !== st.req) return;
              var b = grid.querySelector('.mk-tpl[data-id="' + t.id + '"] canvas');
              if (!b) return;
              var px = 360 * Math.min(2, W.devicePixelRatio || 1);
              var sc = px / Math.max(t.w, t.h);
              b.width = Math.round(t.w * sc); b.height = Math.round(t.h * sc);
              var ctx = b.getContext('2d');
              ctx.scale(sc, sc);
              paint(ctx, { tpl: t, bg: bg, edits: {}, data: dataFor(p, d),
                order: order, photos: photos, agentImg: r[2], link: d.link }, false);
            }).catch(function () {});
          });
        });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Επεξεργασία και εξαγωγή
  // ═══════════════════════════════════════════════════════════════

  var E = null;

  function openEditor(id) {
    var t = st.d.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var p = st.p, d = st.d;
    E = { tpl: t, p: p, edits: {}, data: dataFor(p, d), order: [], photos: {}, bg: null, agentImg: null,
      link: d.link || '', sel: null, lay: {}, cover: {}, oh: { date: '', from: '', to: '' }, logged: false, busy: false,
      files: {}, showSafe: false };
    $('mk-title').textContent = t.name || 'Προωθητικό';
    $('mk-safe-wrap').hidden = !t.safe;
    $('mk-safe').checked = false;
    $('mk-tools').innerHTML = '';
    paintInputs();
    paintActions();
    W.openPop('mktbox');
    var c = $('mk-canvas');
    c.width = 10; c.height = 10;
    $('mk-stage').classList.add('is-loading');
    var mine = E;
    Promise.all([loadFonts(), bgSrc(t).then(toImg), mediaOf(p.code).catch(function () { return null; }), agentImg(p.code)])
      .then(function (r) {
        if (E !== mine) return;
        E.bg = r[1]; E.order = photoOrder(r[2]); E.agentImg = r[3];
        var slots = t.layers.filter(function (L) { return L.type === 'photo'; });
        var need = {};
        slots.forEach(function (L) { var x = slotPhoto(E.order, L.slot || 0, null); if (x) need[x] = 1; });
        return Promise.all(Object.keys(need).map(function (pid) {
          return photoSrc(p.code, pid, 'l').then(toImg).then(function (i) { E.photos[pid] = i; }).catch(function () {});
        }));
      })
      .then(function () {
        if (E !== mine) return;
        $('mk-stage').classList.remove('is-loading');
        sizeCanvas();
        draw();
        warn();
      })
      .catch(function (e) { $('mk-stage').classList.remove('is-loading'); toast(e.net ? 'Χρειάζεται σύνδεση για να ανοίξει το πρότυπο.' : e.message, true); });
  }

  /** Τι λείπει: το λέμε πριν από την εξαγωγή, όχι μετά. */
  function warn() {
    var m = [];
    if (!E.link && E.tpl.layers.some(function (L) { return L.type === 'qr'; })) m.push('Χωρίς λινκ δεν μπαίνει QR.');
    if (!E.data.desc && E.tpl.layers.some(function (L) { return L.type === 'text' && /\{desc\}/.test(L.text); })) m.push('Δεν έχει γραφτεί περιγραφή.');
    if (!E.data.deal && E.tpl.layers.some(function (L) { return L.type === 'text' && /\{deal\}/.test(L.text); })) m.push('Λείπει αν πωλείται ή ενοικιάζεται.');
    if (!E.order.length && E.tpl.layers.some(function (L) { return L.type === 'photo'; })) m.push('Το ακίνητο δεν έχει φωτογραφίες.');
    $('mk-warn').hidden = !m.length;
    $('mk-warn').textContent = m.join(' ');
  }

  function paintInputs() {
    var box = $('mk-inputs'), t = E.tpl;
    var has = function (k) { return (t.inputs || []).indexOf(k) !== -1; };
    if (!has('ohDate')) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML =
      '<div class="mk-oh">' +
        '<label class="field"><span>Ημερομηνία</span><input type="date" id="mk-oh-date"></label>' +
        '<label class="field"><span>Από</span><input type="time" id="mk-oh-from" step="900"></label>' +
        '<label class="field"><span>Έως</span><input type="time" id="mk-oh-to" step="900"></label>' +
      '</div>';
    ['date', 'from', 'to'].forEach(function (k) {
      $('mk-oh-' + k).oninput = function () {
        E.oh[k] = this.value;
        E.data.oh = ohLine(E.oh.date, E.oh.from, E.oh.to);
        draw();
      };
    });
  }

  function paintActions() {
    var pdf = E.tpl.pdf === 'a4';
    $('mk-actions').innerHTML =
      '<button class="btn solid-red" id="mk-share">' + (W.ico ? W.ico('out') : '') + '<span>Κοινοποίηση</span></button>' +
      '<button class="btn" id="mk-dl"><span>' + (pdf ? 'PDF για εκτύπωση' : 'Λήψη') + '</span></button>' +
      (pdf ? '<button class="btn" id="mk-dl-img"><span>Εικόνα</span></button>' : '') +
      '<button class="btn" id="mk-copy-link"><span>Αντιγραφή λινκ</span></button>' +
      '<button class="btn" id="mk-copy-cap"><span>Αντιγραφή λεζάντας</span></button>' +
      '<button class="btn" id="mk-reset"><span>Επαναφορά</span></button>';
    $('mk-share').onclick = function () { out(pdf ? 'pdf' : 'img', 'share'); };
    $('mk-dl').onclick = function () { out(pdf ? 'pdf' : 'img', 'dl'); };
    if (pdf) $('mk-dl-img').onclick = function () { out('img', 'dl'); };
    $('mk-copy-link').onclick = function () {
      if (!E.link) return toast('Δεν έχει αποθηκευτεί λινκ για αυτό το ακίνητο.', true);
      copy(E.link, 'Το λινκ αντιγράφηκε. Στο story: sticker «Σύνδεσμος» και επικόλληση.');
    };
    $('mk-copy-cap').onclick = function () { copy(caption(E.p, E.data, E.link, st.d.tags), 'Η λεζάντα αντιγράφηκε'); };
    $('mk-reset').onclick = function () {
      E.edits = {}; E.sel = null; $('mk-tools').innerHTML = ''; draw();
    };
  }

  function copy(text, msg) {
    var done = function () { toast(msg); };
    if (W.navigator.clipboard && W.navigator.clipboard.writeText) {
      W.navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = W.document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    W.document.body.appendChild(ta); ta.select();
    try { W.document.execCommand('copy'); } catch (e) { /* τίποτα */ }
    ta.remove();
  }

  // ── Canvas προεπισκόπησης ──

  var raf = 0;
  function sizeCanvas() {
    var c = $('mk-canvas'), stage = $('mk-stage'), t = E.tpl;
    var maxW = stage.clientWidth || 320;
    var maxH = Math.max(240, W.innerHeight * 0.55);
    var cssW = Math.min(maxW, maxH * t.w / t.h);
    var dpr = Math.min(2, W.devicePixelRatio || 1);
    var px = Math.min(t.w * (t.out || 1), Math.round(cssW * dpr));
    E.pv = px / t.w;
    c.width = px; c.height = Math.round(t.h * E.pv);
    c.style.width = Math.round(cssW) + 'px';
    c.style.height = Math.round(cssW * t.h / t.w) + 'px';
  }

  function draw() {
    if (raf) return;
    raf = (W.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      raf = 0;
      if (!E || !E.pv) return;
      var c = $('mk-canvas'), ctx = c.getContext('2d');
      ctx.setTransform(E.pv, 0, 0, E.pv, 0, 0);
      paint(ctx, E, true);
      if (E.sel) toolsState();
      prepare();
    });
  }

  /**
   * Το αρχείο ετοιμάζεται στο παρασκήνιο λίγο μετά την τελευταία αλλαγή. Έτσι το «Κοινοποίηση»
   * ανοίγει το μενού του κινητού αμέσως: το Safari δέχεται share() μόνο ακριβώς μετά το πάτημα.
   */
  var prepT = 0;
  function prepare() {
    E.files = {};
    clearTimeout(prepT);
    var mine = E, kind = E.tpl.pdf === 'a4' ? 'pdf' : 'img';
    prepT = setTimeout(function () {
      if (E !== mine || E.busy) return;
      render(kind).then(function (f) { if (E === mine && !E.files[kind]) E.files[kind] = f; }).catch(function () {});
    }, 700);
  }

  function toTpl(ev) {
    var r = $('mk-canvas').getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * E.tpl.w, y: (ev.clientY - r.top) / r.height * E.tpl.h };
  }

  var drag = null;
  function wireCanvas() {
    var c = $('mk-canvas');
    c.addEventListener('pointerdown', function (ev) {
      if (!E || !E.pv) return;
      var pt = toTpl(ev);
      var id = hit(E.tpl, E.edits, pt.x, pt.y);
      if (id !== E.sel) select(id);
      if (!id) return;
      var ed = E.edits[id] || (E.edits[id] = {});
      drag = { id: id, x: pt.x, y: pt.y, dx: ed.dx || 0, dy: ed.dy || 0, fx: ed.fx == null ? 0.5 : ed.fx, fy: ed.fy == null ? 0.5 : ed.fy, moved: false };
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* παλιός browser */ }
    });
    c.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var pt = toTpl(ev), mx = pt.x - drag.x, my = pt.y - drag.y;
      if (!drag.moved && Math.abs(mx) + Math.abs(my) < E.tpl.w / 80) return;
      drag.moved = true;
      ev.preventDefault();
      var L = layer(drag.id), ed = E.edits[drag.id];
      if (L.type === 'text') { ed.dx = drag.dx + mx; ed.dy = drag.dy + my; }
      else {
        var r = E.cover[drag.id];
        if (r && r.exW > 1) ed.fx = clamp01(drag.fx - mx / r.exW);
        if (r && r.exH > 1) ed.fy = clamp01(drag.fy - my / r.exH);
      }
      draw();
    });
    var end = function () { drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    W.addEventListener('resize', function () { if (E && !$('mktbox').hidden) { sizeCanvas(); draw(); } });
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function layer(id) { return E.tpl.layers.filter(function (L) { return L.id === id; })[0]; }

  // ── Εργαλεία για ό,τι είναι επιλεγμένο ──

  function select(id) {
    E.sel = id;
    var box = $('mk-tools');
    if (!id) { box.innerHTML = ''; draw(); return; }
    var L = layer(id), ed = E.edits[id] || (E.edits[id] = {});
    if (L.type === 'text') {
      var cur = ed.text != null ? ed.text : (L.upper ? upperGr(fill(L.text, E.data)) : fill(L.text, E.data));
      box.innerHTML =
        '<label class="field mk-text"><span>Κείμενο</span><textarea id="mk-t" rows="' + (L.maxLines === 1 ? 1 : 3) + '"></textarea></label>' +
        '<div class="mk-row">' +
          '<button class="btn small" id="mk-smaller" aria-label="Μικρότερα γράμματα">A−</button>' +
          '<span class="mk-size" id="mk-size"></span>' +
          '<button class="btn small" id="mk-bigger" aria-label="Μεγαλύτερα γράμματα">A+</button>' +
          '<button class="btn small" id="mk-undo-one">Αρχικό</button>' +
        '</div>' +
        '<p class="mk-tip" id="mk-tip">Σύρε το κείμενο με το δάχτυλο για να το μετακινήσεις.</p>';
      $('mk-t').value = cur;
      $('mk-t').oninput = function () { ed.text = this.value; draw(); };
      var step = function (k) { var base = ed.size || (E.lay[id] && E.lay[id].size) || L.size; ed.size = Math.max(8, Math.min(L.size * 2.5, base * k)); draw(); };
      $('mk-smaller').onclick = function () { step(1 / 1.08); };
      $('mk-bigger').onclick = function () { step(1.08); };
      $('mk-undo-one').onclick = function () { delete E.edits[id]; select(id); };
    } else if (L.type === 'photo') {
      box.innerHTML =
        '<p class="mk-tip">Σύρε τη φωτογραφία για να διαλέξεις ποιο κομμάτι φαίνεται, ή διάλεξε άλλη:</p>' +
        '<div class="mk-strip" id="mk-strip"></div>' +
        '<div class="mk-row"><button class="btn small" id="mk-undo-one">Αρχικό</button></div>';
      $('mk-undo-one').onclick = function () { delete E.edits[id]; select(id); };
      strip(id);
    }
    draw();
  }

  /** Οι φωτογραφίες του ακινήτου σε λωρίδα· πατώντας μία μπαίνει στη θέση. */
  function strip(id) {
    var box = $('mk-strip'), p = E.p;
    var cur = slotPhoto(E.order, layer(id).slot || 0, E.edits[id]);
    box.innerHTML = E.order.map(function (pid) {
      return '<button type="button" data-p="' + esc(pid) + '" class="' + (pid === cur ? 'is-on' : '') + '"><img alt=""></button>';
    }).join('') || '<span class="card-note">Το ακίνητο δεν έχει φωτογραφίες.</span>';
    W.Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      var pid = b.dataset.p;
      photoSrc(p.code, pid, 's').then(function (src) { b.firstChild.src = src; }).catch(function () {});
      b.onclick = function () {
        var ed = E.edits[id] || (E.edits[id] = {});
        ed.pick = pid; ed.fx = 0.5; ed.fy = 0.5;
        W.Array.prototype.forEach.call(box.children, function (x) { x.classList.toggle('is-on', x === b); });
        if (E.photos[pid]) return draw();
        photoSrc(p.code, pid, 'l').then(toImg).then(function (i) { E.photos[pid] = i; draw(); })
          .catch(function () { toast('Η φωτογραφία δεν φόρτωσε.', true); });
      };
    });
  }

  function toolsState() {
    var L = layer(E.sel), lay = E.lay[E.sel];
    if (!L || L.type !== 'text' || !lay || !$('mk-size')) return;
    $('mk-size').textContent = Math.round(lay.size / L.size * 100) + '%';
    var tip = $('mk-tip');
    if (tip) {
      tip.className = 'mk-tip' + (lay.overflow ? ' bad' : '');
      tip.textContent = lay.overflow ? 'Το κείμενο δεν χωράει στο πλαίσιο: μίκρυνέ το ή γράψε λιγότερα.' : 'Σύρε το κείμενο με το δάχτυλο για να το μετακινήσεις.';
    }
  }

  // ── Εξαγωγή ──

  function render(kind) {
    var t = E.tpl, sc = t.out || 1;
    var c = W.document.createElement('canvas');
    c.width = Math.round(t.w * sc); c.height = Math.round(t.h * sc);
    var ctx = c.getContext('2d');
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    var keep = E.sel; E.sel = null;
    paint(ctx, E, false);
    E.sel = keep;
    var name = (E.p.code || 'akinito') + '-' + t.id;
    return new Promise(function (ok, bad) {
      c.toBlob(function (b) { b ? ok(b) : bad(new Error('Δεν δημιουργήθηκε η εικόνα.')); }, 'image/jpeg', 0.92);
    }).then(function (jpg) {
      if (kind !== 'pdf') return { blob: jpg, name: name + '.jpg', type: 'image/jpeg' };
      return jpg.arrayBuffer().then(function (buf) {
        var qr = t.layers.filter(function (L) { return L.type === 'qr' && L.link; })[0];
        var bytes = pdfBytes(new Uint8Array(buf), c.width, c.height, E.link,
          qr ? { x: qr.x * sc, y: qr.y * sc, w: qr.w * sc, h: qr.h * sc } : null);
        return { blob: new W.Blob([bytes], { type: 'application/pdf' }), name: name + '.pdf', type: 'application/pdf' };
      });
    });
  }

  function out(kind, how) {
    if (E.busy) return;
    var missing = (E.tpl.inputs || []).indexOf('ohDate') !== -1 && !(E.oh.date && E.oh.from);
    if (missing) return toast('Συμπλήρωσε ημερομηνία και ώρα για το Open House.', true);
    var nav = W.navigator;
    // Η λεζάντα πάει στο πρόχειρο ΤΩΡΑ (μέσα στο πάτημα): το Instagram αγνοεί κείμενο που έρχεται μαζί με εικόνα.
    if (how === 'share' && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(caption(E.p, E.data, E.link, st.d.tags)).catch(function () {});
    }
    var ready = E.files[kind];
    if (ready) return deliver(ready, how, true);
    E.busy = true;
    var btn = $(how === 'share' ? 'mk-share' : 'mk-dl');
    if (btn) btn.disabled = true;
    render(kind).then(function (f) {
      E.files[kind] = f;
      deliver(f, how, false);
    }).catch(function (e) { toast(e.message, true); })
      .then(function () { E.busy = false; if (btn) btn.disabled = false; });
  }

  function deliver(f, how, fresh) {
    if (!E.logged) { E.logged = true; if (W.used) W.used('mktCreate'); }
    log(how === 'share' ? 'sh' : 'dl');
    var nav = W.navigator;
    var file = W.File ? new W.File([f.blob], f.name, { type: f.type }) : null;
    if (how === 'share' && file && nav.canShare && nav.canShare({ files: [file] })) {
      nav.share({ files: [file] }).then(function () { toast('Η λεζάντα είναι στο πρόχειρο: επικόλλησέ τη.'); })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return;
          // Το αρχείο ετοιμάστηκε μετά το πάτημα και το κινητό δεν άφησε να ανοίξει το μενού.
          if (!fresh && e && e.name === 'NotAllowedError') return toast('Έτοιμο. Πάτα ξανά «Κοινοποίηση».');
          download(f);
        });
      return;
    }
    download(f);
  }

  function download(f) {
    var url = W.URL.createObjectURL(f.blob);
    var a = W.document.createElement('a');
    a.href = url; a.download = f.name; a.rel = 'noopener';
    W.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { W.URL.revokeObjectURL(url); }, 60000);
    toast('Αποθηκεύτηκε: ' + f.name);
  }

  /** Μετρήσεις: τι φτιάχτηκε και τι κοινοποιήθηκε, ανά ακίνητο και πρότυπο. Δεν περιμένει απάντηση. */
  function log(ev) {
    var stats = st.d.stats || (st.d.stats = {});
    var b = stats[ev] || (stats[ev] = {});
    b[E.tpl.id] = (b[E.tpl.id] || 0) + 1;
    if (W.api) W.api('mktLog', { code: E.p.code, tpl: E.tpl.id, ev: ev }).catch(function () {});
  }

  function wire() {
    if (!W.document || !$('mk-canvas')) return;
    wireCanvas();
    var safe = $('mk-safe');
    if (safe) safe.onchange = function () { if (E) { E.showSafe = this.checked; draw(); } };
  }

  W.kwMkt = {
    show: show, open: openEditor,
    // για τα tests
    upperGr: upperGr, dealLabel: dealLabel, checkLink: checkLink, ohLine: ohLine, fill: fill, address: address,
    draftDesc: draftDesc, caption: caption, wrap: wrap, layoutText: layoutText, coverRect: coverRect, hit: hit,
    photoOrder: photoOrder, slotPhoto: slotPhoto, validTpl: validTpl, pdfBytes: pdfBytes
  };

  if (W.document) wire();
})();
