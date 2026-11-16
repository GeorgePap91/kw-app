// 2.9 · Πίνακας προόδου, στόχοι, οικονομικά και οθόνες Coach
//
//  Μεσίτης (flag dashboard): «Η πορεία μου» = στόχοι με ρυθμό, γραφήματα δραστηριότητας και,
//  με το flag finance, τζίρος, υπόλοιπο ως τον στόχο και cap.
//  Coach (ρόλος): «Ομάδα» = όλοι οι μεσίτες με μια ματιά, φίλτρο ανά μεσίτη, ορισμός στόχων.
//
//  Οι μετρήσεις έρχονται από το υπάρχον 'metrics'· εδώ ζητιούνται μόνο στόχοι και οικονομικά
//  ('dash'). Τα οικονομικά ΔΕΝ αποθηκεύονται στη συσκευή: μένουν στη μνήμη μέχρι να κλείσει η εφαρμογή.
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : globalThis;
  var PERIODS = [{ k: 'w', label: 'Εβδομάδα' }, { k: 'm', label: 'Μήνας' }, { k: 'y', label: 'Έτος' }];
  var MON = ['Ι', 'Φ', 'Μ', 'Α', 'Μ', 'Ι', 'Ι', 'Α', 'Σ', 'Ο', 'Ν', 'Δ'];
  var MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  var REV = 'rev';
  var st = { period: 'm', dash: null, loading: false, coach: null, cLoading: false, cAgent: '', cData: {}, edit: '' };

  // ── Καθαρή λογική (ελέγχεται στα tests) ─────────────────────────────

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** 23400 → «23.400 €», 1234.5 → «1.234,50 €». */
  function money(n) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    var whole = Math.floor(Math.abs(n)), dec = Math.round((Math.abs(n) - whole) * 100);
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '−' : '') + s + (dec ? ',' + pad(dec) : '') + ' €';
  }

  function num(n) { return String(Math.round((Number(n) || 0) * 10) / 10).replace('.', ','); }
  function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function isoDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

  /**
   * Οι τιμές μιας περιόδου από τις μετρήσεις (mx = απάντηση του 'metrics').
   *  w: η τελευταία εβδομάδα που υποβλήθηκε · m: ο τρέχων μήνας · y: το τρέχον έτος.
   * frac = πόσο μέρος της περιόδου καλύπτουν οι υποβολές (0–1)· από αυτό βγαίνει ο ρυθμός.
   */
  function periodData(mx, p, now) {
    now = now || new Date();
    var months = (mx && mx.months) || [];
    var y = now.getFullYear(), ym = y + '-' + pad(now.getMonth() + 1);
    var out = { values: {}, label: '', frac: 0, has: false };
    var add = function (v) { Object.keys(v || {}).forEach(function (k) { out.values[k] = (out.values[k] || 0) + (v[k] || 0); }); };
    var lastEnd = null;
    var seen = function (w) { var e = isoDate(w.end); if (e && (!lastEnd || e > lastEnd)) lastEnd = e; };

    if (p === 'w') {
      var best = null;
      months.forEach(function (m) {
        (m.weeks || []).forEach(function (w) { if (!best || (w.end || '') > (best.end || '')) best = w; });
      });
      if (best) { add(best.values); out.has = true; out.label = 'Εβδομάδα ' + best.label; }
      else out.label = 'Τελευταία εβδομάδα';
      out.frac = 1;
      return out;
    }
    if (p === 'm') {
      var cur = months.filter(function (m) { return m.ym === ym; })[0];
      out.label = MONTHS[now.getMonth()] + ' ' + y;
      if (cur && cur.weeks.length) {
        add(cur.values); out.has = true;
        cur.weeks.forEach(seen);
        var n = daysIn(y, now.getMonth());
        var day = !lastEnd ? now.getDate() : (lastEnd.getMonth() !== now.getMonth() || lastEnd.getFullYear() !== y) ? n : lastEnd.getDate();
        out.frac = Math.min(1, day / n);
      }
      return out;
    }
    out.label = 'Έτος ' + y;
    months.forEach(function (m) {
      if (m.ym.slice(0, 4) !== String(y) || !m.weeks.length) return;
      add(m.values); out.has = true;
      m.weeks.forEach(seen);
    });
    if (out.has) {
      var ref = !lastEnd ? now : lastEnd.getFullYear() > y ? new Date(y, 11, 31) : lastEnd;
      var total = (new Date(y + 1, 0, 1) - new Date(y, 0, 1)) / 86400000;
      out.frac = Math.min(1, Math.round((ref - new Date(y, 0, 1)) / 86400000 + 1) / total);
    }
    return out;
  }

  /** Οι δείκτες που έχουν στόχο στην περίοδο: τιμή, στόχος, ποσοστό και πρόβλεψη με τον ίδιο ρυθμό. */
  function goalRows(metrics, goals, p, pd) {
    return (metrics || []).map(function (m) {
      var g = ((goals || {})[m.key] || {})[p] || 0;
      if (!g) return null;
      var v = pd.values[m.key] || 0;
      return { key: m.key, group: m.group, label: m.label, sub: m.sub, value: v, goal: g, pct: v / g,
               proj: pd.frac > 0 && pd.frac < 1 ? v / pd.frac / g : null };
    }).filter(Boolean);
  }

  /** Μέσος όρος επίτευξης (κάθε δείκτης μετρά έως 100%). null = κανένας στόχος. */
  function overall(rows, field) {
    if (!rows.length) return null;
    return rows.reduce(function (a, r) { return a + Math.min(1, r[field || 'pct'] == null ? r.pct : r[field || 'pct']); }, 0) / rows.length;
  }

  function groupTotals(mx, values) {
    return ((mx && mx.groups) || []).map(function (g) {
      return { key: g.key, label: g.label,
               total: mx.metrics.filter(function (m) { return m.group === g.key; })
                 .reduce(function (a, m) { return a + (values[m.key] || 0); }, 0) };
    });
  }

  function paceText(p, proj) {
    if (proj == null || p === 'w') return '';
    return 'Με αυτόν τον ρυθμό κλείνεις ' + (p === 'm' ? 'τον μήνα' : 'το έτος') + ' στο ' + Math.round(proj * 100) + '%';
  }

  // ── Κομμάτια εμφάνισης ───────────────────────────────────────────────

  function esc(s) { return W.esc(s); }

  /** Δαχτυλίδι: parts = [{ v, cls, label }]. Κενό 2 μονάδων ανάμεσα στα κομμάτια. */
  function donut(parts, center, sub) {
    var total = parts.reduce(function (a, x) { return a + x.v; }, 0);
    var off = 25, arcs = '';
    if (total > 0) {
      parts.forEach(function (x) {
        if (!x.v) return;
        var len = x.v / total * 100, gap = parts.filter(function (q) { return q.v; }).length > 1 ? 1.2 : 0;
        arcs += '<circle class="dn-arc ' + x.cls + '" cx="21" cy="21" r="15.915" stroke-dasharray="' +
          Math.max(0.1, len - gap).toFixed(2) + ' ' + (100 - Math.max(0.1, len - gap)).toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '">' +
          '<title>' + esc(x.label + ': ' + x.text + ' (' + Math.round(x.v / total * 100) + '%)') + '</title></circle>';
        off -= len;
      });
    }
    return '<div class="dn"><svg viewBox="0 0 42 42" role="img" aria-label="' + esc(parts.map(function (x) { return x.label + ' ' + x.text; }).join(', ')) + '">' +
      '<circle class="dn-bg" cx="21" cy="21" r="15.915"/>' + arcs + '</svg>' +
      '<div class="dn-mid"><b>' + esc(center) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div></div>';
  }

  function legend(parts) {
    var total = parts.reduce(function (a, x) { return a + x.v; }, 0);
    return '<ul class="dz-legend">' + parts.map(function (x) {
      return '<li><i class="' + x.cls + '" aria-hidden="true"></i><span>' + esc(x.label) + '</span><b>' + esc(x.text) + '</b>' +
        '<em>' + (total ? Math.round(x.v / total * 100) : 0) + '%</em></li>';
    }).join('') + '</ul>';
  }

  function meter(title, right, pct, note, tone) {
    var w = Math.max(0, Math.min(100, Math.round(pct * 100)));
    return '<div class="dz-meter' + (tone ? ' ' + tone : '') + '"><div class="dz-meter-top"><b>' + esc(title) + '</b><span>' + esc(right) + '</span></div>' +
      '<div class="dz-bar" role="img" aria-label="' + esc(title + ' ' + w + '%') + '"><i style="width:' + w + '%"></i></div>' +
      (note ? '<p>' + note + '</p>' : '') + '</div>';
  }

  function financeHtml(f, revTarget, capStart) {
    if (!f) return '';
    var h = '<h2 class="group-title">Οικονομικά ' + (f.year || '') + '</h2>';
    if (!f.configured) {
      return h + '<div class="dz-card"><p class="card-note">Το αρχείο κλεισιμάτων δεν έχει συνδεθεί ακόμα με την εφαρμογή.</p></div>';
    }
    h += '<div class="dz-card">' + (f.test ? '<p class="dz-test">Δοκιμαστικά στοιχεία · όχι πραγματικά ποσά</p>' : '') +
      '<div class="dz-hero"><b>' + money(f.yearTotal) + '</b><span>Τζίρος ' + f.year + ' · ' +
      W.plural(f.yearDeals, 'κλείσιμο', 'κλεισίματα') + '</span></div>';
    if (revTarget) {
      var left = Math.max(0, revTarget - f.yearTotal);
      h += meter('Στόχος έτους', money(f.yearTotal) + ' από ' + money(revTarget), f.yearTotal / revTarget,
        left ? 'Απομένουν <b>' + money(left) + '</b> για τον στόχο.' : '<b>✓ Ο στόχος του έτους πιάστηκε.</b>', left ? '' : 'done');
    } else {
      h += '<p class="card-note">Δεν έχει οριστεί ακόμα στόχος τζίρου για το έτος.</p>';
    }
    var cycle = 'Κύκλος ' + dmy(f.capFrom) + ' – ' + dmy(f.capTo) + (capStart ? '' : ' (δεν έχει οριστεί έναρξη cap)');
    h += meter('Cap', money(f.capTotal) + ' από ' + money(f.cap), f.capTotal / f.cap,
      (f.capped ? '<b>✓ Έπιασες το cap.</b> ' : 'Απομένουν <b>' + money(f.capLeft) + '</b> μέχρι το cap. ') + esc(cycle) + '.',
      f.capped ? 'done' : '');
    h += '</div>';

    if (f.yearTotal > 0) {
      var parts = [{ v: f.owner, cls: 'c1', label: 'Αμοιβές ιδιοκτητών', text: money(f.owner) },
                   { v: f.buyer, cls: 'c2', label: 'Αμοιβές αγοραστών / μισθωτών', text: money(f.buyer) }];
      h += '<div class="dz-card"><h3>Από πού έρχεται ο τζίρος</h3><div class="dz-split">' +
        donut(parts, money(f.yearTotal), String(f.year)) + legend(parts) + '</div></div>';

      var max = Math.max.apply(null, f.months.concat([1])), nowM = new Date().getMonth();
      h += '<div class="dz-card"><h3>Τζίρος ανά μήνα</h3><div class="dz-cols" role="img" aria-label="Τζίρος ανά μήνα">' +
        f.months.map(function (v, i) {
          return '<span class="dz-col' + (i === nowM ? ' cur' : '') + '" title="' + esc(MONTHS[i] + ': ' + money(v)) + '">' +
            '<i style="height:' + (v ? Math.max(4, Math.round(v / max * 100)) : 0) + '%"></i><em>' + MON[i] + '</em></span>';
        }).join('') + '</div><p class="dz-foot">Καλύτερος μήνας: ' + esc(MONTHS[f.months.indexOf(Math.max.apply(null, f.months))]) +
        ' · ' + money(Math.max.apply(null, f.months)) + '</p></div>';
    }

    var deals = f.deals.filter(function (d) { return d.year; });
    h += '<div class="dz-card"><h3>Κλεισίματα ' + f.year + '</h3>' + (deals.length ?
      '<div class="dz-scroll"><table class="dz-table"><thead><tr><th>Ακίνητο</th><th class="n">Ιδιοκτήτης</th>' +
      '<th class="n">Αγοραστής / μισθωτής</th><th class="n">Σύνολο</th></tr></thead><tbody>' +
      deals.map(function (d) {
        return '<tr><td><b>' + esc(d.code || '—') + '</b><span class="dz-dim dz-date">' + dmy(d.date).slice(0, 5) + '</span></td><td class="n">' + money(d.owner) +
          '</td><td class="n">' + money(d.buyer) + '</td><td class="n"><b>' + money(d.total) + '</b></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Σύνολο</td><td class="n">' + money(f.owner) + '</td><td class="n">' +
      money(f.buyer) + '</td><td class="n"><b>' + money(f.yearTotal) + '</b></td></tr></tfoot></table></div>'
      : '<p class="card-note">Κανένα κλείσιμο φέτος ακόμα.</p>') + '</div>';
    return h;
  }

  function goalsHtml(mx, goals, p, coach) {
    var h = '<h2 class="group-title">Στόχοι</h2><div class="subtabs dz-tabs" role="tablist" aria-label="Περίοδος στόχων">' +
      PERIODS.map(function (x) {
        return '<button class="subtab' + (x.k === p ? ' is-on' : '') + '" role="tab" data-dz-period="' + x.k + '"><span>' + x.label + '</span></button>';
      }).join('') + '</div>';
    if (!mx || !mx.configured) {
      return h + '<div class="dz-card"><p class="card-note">Οι μετρήσεις δεν έχουν συνδεθεί ακόμα με την εφαρμογή.</p></div>';
    }
    var pd = periodData(mx, p), rows = goalRows(mx.metrics, goals, p, pd);
    if (!rows.length) {
      return h + '<div class="dz-card"><p class="card-note">' + (coach ? 'Δεν έχεις ορίσει στόχους για αυτή την περίοδο. Πάτα «Ορισμός στόχων».'
        : 'Ο Coach δεν έχει ορίσει ακόμα στόχους για αυτή την περίοδο.') + '</p></div>' + activityHtml(mx, pd);
    }
    var all = overall(rows), proj = pd.frac > 0 && pd.frac < 1 ? overall(rows, 'proj') : null;
    var hit = rows.filter(function (r) { return r.pct >= 1; }).length;
    h += '<div class="dz-card"><div class="dz-split">' +
      donut([{ v: all, cls: 'c1', label: 'Επίτευξη', text: Math.round(all * 100) + '%' },
             { v: 1 - all, cls: 'c0', label: 'Υπόλοιπο', text: Math.round((1 - all) * 100) + '%' }], Math.round(all * 100) + '%', 'των στόχων') +
      '<div class="dz-sum"><b>' + esc(pd.label) + '</b><span>' + hit + ' από ' + rows.length + (rows.length === 1 ? ' στόχο' : ' στόχους') + ' πιάστηκαν</span>' +
      (proj != null ? '<span class="dz-pace">' + esc(paceText(p, proj)) + '</span>' : '') +
      (!pd.has ? '<span>Δεν υπάρχει ακόμα υποβολή για την περίοδο.</span>' : '') + '</div></div>';
    mx.groups.forEach(function (g) {
      var mine = rows.filter(function (r) { return r.group === g.key; });
      if (!mine.length) return;
      h += '<h3>' + esc(g.label) + '</h3>';
      mine.forEach(function (r) {
        var pace = paceText(p, r.proj);
        h += meter(r.label + (r.sub ? ' · ' + r.sub : ''), num(r.value) + ' από ' + num(r.goal), r.pct,
          r.pct >= 1 ? '<b>✓ Πιάστηκε</b>' : (pace ? esc(pace) + '.' : 'Απομένουν ' + num(r.goal - r.value) + '.'), r.pct >= 1 ? 'done' : '');
      });
    });
    return h + '</div>' + activityHtml(mx, pd);
  }

  function activityHtml(mx, pd) {
    var groups = groupTotals(mx, pd.values), total = groups.reduce(function (a, g) { return a + g.total; }, 0);
    var h = '<h2 class="group-title">Δραστηριότητα · ' + esc(pd.label) + '</h2><div class="dz-card">';
    if (!total) return h + '<p class="card-note">Καμία καταγραφή στην περίοδο.</p></div>';
    var parts = groups.map(function (g, i) { return { v: g.total, cls: 'c' + (i + 1), label: g.label, text: num(g.total) }; });
    h += '<div class="dz-split">' + donut(parts, num(total), 'ενέργειες') + legend(parts) + '</div>';
    h += '<div class="dz-scroll"><table class="dz-table"><thead><tr><th>Δείκτης</th><th class="n">Σύνολο</th></tr></thead><tbody>' +
      mx.metrics.filter(function (m) { return pd.values[m.key]; }).map(function (m) {
        return '<tr><td>' + esc(m.label) + (m.sub ? ' <span class="dz-dim">' + esc(m.sub) + '</span>' : '') + '</td><td class="n"><b>' + num(pd.values[m.key]) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
    return h + '</div>';
  }

  /** Ολόκληρος ο πίνακας ενός μεσίτη μέσα στο el. Ίδιος για τον μεσίτη και για τον Coach. */
  function paint(el, mx, dash, coach) {
    el.innerHTML = '<div class="dz">' + financeHtml(dash.finance, ((dash.goals || {})[REV] || {}).y || 0, dash.capStart) +
      goalsHtml(mx, dash.goals, st.period, coach) + '</div>';
    el.querySelectorAll('[data-dz-period]').forEach(function (b) {
      b.onclick = function () { st.period = b.dataset.dzPeriod; paint(el, mx, dash, coach); };
    });
  }

  function failHtml(e, attr) {
    return '<div class="empty"><b>Δεν φορτώθηκε</b>' + esc(e.message) + '<button class="btn primary wide" ' + attr + '>Δοκίμασε ξανά</button></div>';
  }

  // ── Μεσίτης: «Η πορεία μου» ──────────────────────────────────────────

  function on() { return !!(W.S && W.S.flags && W.S.flags.dashboard); }

  function sync() {
    var row = W.$('more-dash');
    if (row) row.hidden = !on();
  }

  function load(force) {
    var body = W.$('dash-body'), S = W.S;
    if (!on()) { body.innerHTML = '<div class="empty"><b>Δεν είναι ανοιχτό ακόμα</b>Ο πίνακας προόδου θα ανοίξει από το γραφείο.</div>'; return; }
    if (st.loading) return;
    if (st.dash && S.mx && !force) return paint(body, S.mx, st.dash, false);
    st.loading = true;
    if (!st.dash) body.innerHTML = W.skel(5);
    W.$('dash-refresh').disabled = true;
    Promise.all([
      S.mx && !force ? S.mx : W.api('metrics', force ? { refresh: 1 } : {}),
      W.api('dash', force ? { refresh: 1 } : {})
    ]).then(function (r) {
      S.mx = r[0];
      st.dash = r[1];
      if (r[1].off) { body.innerHTML = '<div class="empty"><b>Δεν είναι ανοιχτό ακόμα</b>Ο πίνακας προόδου θα ανοίξει από το γραφείο.</div>'; return; }
      paint(body, S.mx, st.dash, false);
      if (force) W.toast('Ενημερώθηκε');
    }).catch(function (e) {
      if (!st.dash) {
        body.innerHTML = failHtml(e, 'data-dz-retry');
        body.querySelector('[data-dz-retry]').onclick = function () { load(true); };
      } else W.toast(e.message, true);
    }).then(function () { st.loading = false; W.$('dash-refresh').disabled = false; });
  }

  // ── Coach: «Ομάδα» ───────────────────────────────────────────────────

  function pctTag(p) {
    if (p == null) return '<span class="tag">χωρίς στόχους</span>';
    return '<span class="tag' + (p >= 1 ? ' ok' : '') + '">' + Math.round(p * 100) + '% στόχων μήνα</span>';
  }

  function coachPaint() {
    var c = st.coach, body = W.$('c-body'), sel = W.$('c-agent');
    if (!c) return;
    var names = c.agents.map(function (a) { return a.name; });
    if (st.cAgent && names.indexOf(st.cAgent) === -1) st.cAgent = '';
    sel.innerHTML = '<option value="">Όλοι οι μεσίτες</option>' + c.agents.map(function (a) {
      return '<option value="' + esc(a.name) + '"' + (a.name === st.cAgent ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
    W.$('c-goals').hidden = !st.cAgent;
    if (st.cAgent) return coachAgent(st.cAgent, false);

    var act = c.agents.filter(function (a) { return a.active !== false; });
    var sum = act.reduce(function (a, x) { return a + x.yearTotal; }, 0);
    var capped = act.filter(function (a) { return a.capped; }).length;
    var withPct = act.filter(function (a) { return a.monthPct != null; });
    var avg = withPct.length ? withPct.reduce(function (a, x) { return a + x.monthPct; }, 0) / withPct.length : null;
    var h = '<div class="dz">' + (c.finance && c.test ? '<p class="dz-test">Οικονομικά: δοκιμαστικά στοιχεία · όχι πραγματικά ποσά</p>' : '') +
      '<div class="mx-tiles dz-tiles"><div class="mx-tile"><b>' + (avg == null ? '—' : Math.round(avg * 100) + '%') + '</b><span>μέσος όρος στόχων μήνα</span></div>' +
      '<div class="mx-tile"><b>' + (c.finance ? money(sum).replace(' €', '') : '—') + '</b><span>τζίρος ομάδας ' + new Date().getFullYear() + ' (€)</span></div>' +
      '<div class="mx-tile"><b>' + (c.finance ? capped + '/' + act.length : '—') + '</b><span>έπιασαν το cap</span></div></div>' +
      '<h2 class="group-title">Μεσίτες</h2><div class="mlist">';
    h += c.agents.map(function (a) {
      var capPct = c.cap ? Math.min(1, a.capTotal / c.cap) : 0;
      return '<button class="mrow dz-agent" data-c-agent="' + esc(a.name) + '"><span class="avatar" aria-hidden="true">' + esc(W.initials(a.name)) + '</span>' +
        '<span class="mrow-body"><b>' + esc(a.name) + (a.active === false ? ' <span class="tag">Ανενεργός</span>' : '') + '</b>' +
        '<span>' + pctTag(a.monthPct) + '</span>' +
        (c.finance ? '<span>Τζίρος ' + money(a.yearTotal) + (a.revTarget ? ' από ' + money(a.revTarget) : '') + '</span>' : '') +
        (c.finance ? '<span class="dz-mini' + (a.capped ? ' done' : '') + '"><span class="dz-bar"><i style="width:' + Math.round(capPct * 100) + '%"></i></span>' +
          '<em>Cap ' + Math.round(capPct * 100) + '%' + (a.capStart ? ' · από ' + esc(a.capStart) : '') + '</em></span>' : '') +
        '</span>' + W.ico('next', 'ico chev') + '</button>';
    }).join('') || '<p class="card-note">Δεν υπάρχουν μεσίτες στο φύλλο Agents.</p>';
    h += '</div><p class="dz-foot">Πάτα έναν μεσίτη για τον πίνακά του και τους στόχους του. Ενημέρωση ' + esc(c.updated) + '.</p></div>';
    body.innerHTML = h;
    body.querySelectorAll('[data-c-agent]').forEach(function (b) {
      b.onclick = function () { st.cAgent = b.dataset.cAgent; coachPaint(); W.scrollTo(0, 0); };
    });
  }

  function coachAgent(name, force) {
    var body = W.$('c-body'), hit = st.cData[name];
    if (hit && !force) return paint(body, hit.mx, hit.dash, true);
    body.innerHTML = W.skel(5);
    W.api('coachDash', force ? { agent: name, refresh: 1 } : { agent: name }).then(function (d) {
      st.cData[name] = d;
      if (st.cAgent === name) paint(body, d.mx, d.dash, true);
    }).catch(function (e) {
      if (st.cAgent !== name) return;
      body.innerHTML = failHtml(e, 'data-c-retry');
      body.querySelector('[data-c-retry]').onclick = function () { coachAgent(name, true); };
    });
  }

  function coachLoad(force) {
    var body = W.$('c-body');
    if (st.coach && !force) return coachPaint();
    if (st.cLoading) return;
    st.cLoading = true;
    if (!st.coach) body.innerHTML = W.skel(5);
    if (force) st.cData = {};
    return W.api('coachBoot', force ? { refresh: 1 } : {}).then(function (d) {
      st.coach = d;
      st.cLoading = false;
      coachPaint();
      if (force) W.toast('Ανανεώθηκε');
    }, function (e) {
      st.cLoading = false;
      if (!st.coach) {
        body.innerHTML = failHtml(e, 'data-c-retry');
        body.querySelector('[data-c-retry]').onclick = function () { coachLoad(true); };
      } else W.toast(e.message, true);
    });
  }

  function coachMore() {
    var me = W.S.me || {}, r = W.roles();
    W.fillInitials();
    W.$('c-more-name').textContent = me.name || '';
    W.$('c-more-sub').textContent = ['Coach', W.S.boot && W.S.boot.office && W.S.boot.office.name].filter(Boolean).join(' · ');
    W.$('c-mode-wrap').hidden = !(r.agent || r.admin);
    W.$('c-to-agent').hidden = !r.agent;
    W.$('c-to-admin').hidden = !r.admin;
  }

  // ── Coach: ορισμός στόχων ────────────────────────────────────────────

  function goalsOpen() {
    var name = st.cAgent, d = st.cData[name], c = st.coach;
    if (!name || !d || !c) return;
    st.edit = name;
    var goals = d.dash.goals || {};
    var val = function (k, p) { var v = (goals[k] || {})[p]; return v ? String(v).replace('.', ',') : ''; };
    W.$('g-title').textContent = 'Στόχοι · ' + name;
    var h = '<label class="field"><span>Ετήσιος στόχος τζίρου (€)</span>' +
      '<input type="text" inputmode="decimal" id="g-rev" maxlength="9" value="' + esc(val(REV, 'y')) + '" placeholder="π.χ. 60000"></label>' +
      '<label class="field"><span>Έναρξη cap (ημέρα/μήνας)</span>' +
      '<input type="text" inputmode="numeric" id="g-cap" maxlength="5" value="' + esc(d.dash.capStart || '') + '" placeholder="π.χ. 01/09"></label>' +
      '<p class="field-hint">Το cap (' + money(c.cap) + ') μηδενίζει κάθε χρόνο αυτή τη μέρα. Κενό = 1 Ιανουαρίου.</p>' +
      '<button type="button" class="btn wide" id="g-auto">Συμπλήρωσε μήνα και έτος από την εβδομάδα</button>' +
      '<p class="field-hint g-hint">Γράψε μόνο τον στόχο εβδομάδας και πάτα το κουμπί: μήνας = ×4, έτος = ×48 (48 εβδομάδες εργασίας). Μετά αλλάζεις ό,τι θες.</p>';
    c.groups.forEach(function (g) {
      h += '<h3 class="g-group">' + esc(g.label) + '</h3><div class="g-head" aria-hidden="true"><span></span><em>Εβδ.</em><em>Μήνας</em><em>Έτος</em></div>';
      c.metrics.filter(function (m) { return m.group === g.key; }).forEach(function (m) {
        h += '<div class="g-row" data-g="' + m.key + '"><span><b>' + esc(m.label) + '</b>' + (m.sub ? '<small>' + esc(m.sub) + '</small>' : '') + '</span>' +
          ['w', 'm', 'y'].map(function (p) {
            return '<input type="text" inputmode="decimal" maxlength="6" data-p="' + p + '" value="' + esc(val(m.key, p)) + '" aria-label="' +
              esc(m.label + ' ' + (m.sub || '') + ': ' + (p === 'w' ? 'εβδομάδα' : p === 'm' ? 'μήνας' : 'έτος')) + '">';
          }).join('') + '</div>';
      });
    });
    W.$('g-body').innerHTML = h;
    W.$('g-auto').onclick = function () {
      W.$('g-body').querySelectorAll('.g-row').forEach(function (row) {
        var w = parse(row.querySelector('[data-p="w"]').value);
        if (!w) return;
        var m = row.querySelector('[data-p="m"]'), y = row.querySelector('[data-p="y"]');
        if (!parse(m.value)) m.value = num(w * 4);
        if (!parse(y.value)) y.value = num(w * 48);
      });
    };
    W.openSheet('goals');
  }

  function parse(s) {
    var n = Number(String(s || '').replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function goalsSave() {
    var name = st.edit, btn = W.$('g-save');
    var cap = W.$('g-cap').value.trim();
    if (cap && !/^\d{1,2}\/\d{1,2}$/.test(cap)) return W.toast('Έναρξη cap: γράψε ημέρα/μήνα, π.χ. 01/09.', true);
    var goals = {};
    W.$('g-body').querySelectorAll('.g-row').forEach(function (row) {
      var g = {};
      row.querySelectorAll('input').forEach(function (i) { g[i.dataset.p] = parse(i.value); });
      if (g.w || g.m || g.y) goals[row.dataset.g] = g;
    });
    var rev = parse(W.$('g-rev').value);
    if (rev) goals[REV] = { y: rev };
    btn.disabled = true;
    W.api('coachGoalSet', { agent: name, goals: goals, capStart: cap }).then(function (d) {
      st.cData[name] = d;
      st.coach = null;                       // η λίστα της ομάδας ξαναϋπολογίζεται
      W.closeSheet('goals');
      W.toast('Οι στόχοι αποθηκεύτηκαν');
      coachLoad(false);
    }).catch(function (e) { W.toast(e.message, true); }).then(function () { btn.disabled = false; });
  }

  function wire() {
    if (!W.document || !W.$('c-agent')) return;
    W.$('c-agent').onchange = function () { st.cAgent = this.value; coachPaint(); };
    W.$('c-goals').onclick = goalsOpen;
    W.$('c-refresh').onclick = function () { coachLoad(true); };
    W.$('dash-refresh').onclick = function () { load(true); };
    W.$('goals-back').onclick = function () { W.closeSheet('goals'); };
    W.$('g-save').onclick = goalsSave;
  }

  W.kwDash = {
    sync: sync, load: load, coachLoad: coachLoad, coachMore: coachMore,
    money: money, periodData: periodData, goalRows: goalRows, overall: overall, paceText: paceText, groupTotals: groupTotals
  };

  if (W.document) {
    wire();
    // Αν η εφαρμογή άνοιξε πριν φορτώσει αυτό το αρχείο (αντίγραφο χωρίς σήμα), γέμισε την οθόνη τώρα.
    if (W.S && W.S.boot) {
      sync();
      if (W.S.view === 'c-team') coachLoad(false);
      if (W.S.view === 'c-more') coachMore();
      if (W.S.view === 'dash') load(false);
    }
  }
})();
