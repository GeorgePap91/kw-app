// 2.8 · FEAT-25 · «Κλείσε τη μέρα σου» σε 1 λεπτό (flag dayClose)
//
// Οδηγός με ΜΙΑ ερώτηση τη φορά, κάθε απάντηση με 1 πάτημα:
//   1. Υποδείξεις που έγιναν χωρίς αποτέλεσμα → πατάς το αποτέλεσμα
//   2. Νέες κλήσεις που δεν κλήθηκαν          → «Κλήση τώρα» ή «Δεν απάντησε»
//   3. Σημερινές κλήσεις χωρίς σημείωση       → γράφεις μία γραμμή ή παραλείπεις
// Υπολογίζεται στο κινητό (0 κλήσεις στον server για να ανοίξει). Οι απαντήσεις περνούν από το
// send(): χωρίς σήμα μπαίνουν στην ουρά και φεύγουν μόλις έρθει.
(function () {
  'use strict';
  var W = window;
  var DAY = 86400000;
  var st = { list: [], i: 0, done: 0 };

  function on() { return !!(W.S && W.S.flags && W.S.flags.dayClose); }

  function items(now) {
    now = now || Date.now();
    var S = W.S, out = [];
    if (!S || !S.leads) return out;
    var today = W.isoDate(new Date(now));
    S.leads.forEach(function (l) {
      if (W.needsOutcome(l) && now - l.showingTs < 7 * DAY) out.push({ kind: 'outcome', l: l, r: 1 });
      else if (l.status === W.ST.PENDING) out.push({ kind: 'call', l: l, r: 2 });
      (l.calls || []).forEach(function (c) {
        if (c.note || c.result === 'Δεν απάντησε' || !c.ts) return;
        if (W.isoDate(new Date(c.ts)) === today) out.push({ kind: 'note', l: l, c: c, r: 3 });
      });
    });
    return out.sort(function (a, b) { return a.r - b.r; });
  }

  function btn(attr, text, cls) { return '<button type="button" class="btn ' + (cls || '') + '" ' + attr + '>' + W.esc(text) + '</button>'; }

  function render() {
    var box = W.$('cl-body'), esc = W.esc;
    if (st.i >= st.list.length) {
      box.innerHTML = '<div class="empty small cl-end"><b>Η μέρα έκλεισε ✓</b>' +
        (st.done ? 'Τακτοποίησες ' + st.done + (st.done === 1 ? ' εκκρεμότητα.' : ' εκκρεμότητες.') : 'Δεν είχες εκκρεμότητες.') + '</div>' +
        '<button type="button" class="btn primary wide" data-pop-close>Τέλος</button>';
      box.querySelector('[data-pop-close]').onclick = function () { W.closePop('closebox'); };
      return;
    }
    var x = st.list[st.i], l = x.l, name = l.name || 'Χωρίς όνομα';
    var sub = [l.property, l.code ? 'Κωδ. ' + l.code : ''].filter(Boolean).join(' · ');
    var q, acts;
    if (x.kind === 'outcome') {
      q = 'Πώς πήγε η υπόδειξη;';
      sub = W.lowerDay(W.niceDate(l.showingAt)) + (sub ? ' · ' + sub : '');
      acts = ((W.S.boot && W.S.boot.outcomes) || []).map(function (o, n) { return btn('data-cl-out="' + n + '"', o, n === 0 ? 'solid-red' : ''); }).join('');
    } else if (x.kind === 'call') {
      q = 'Δεν έχεις καλέσει ακόμα';
      acts = btn('data-cl-call="1"', 'Κλήση τώρα', 'solid-red') + btn('data-cl-na="1"', 'Δεν απάντησε', '');
    } else {
      q = 'Τι ειπώθηκε στην κλήση;';
      acts = '<textarea id="cl-note" rows="3" maxlength="600" placeholder="Μία γραμμή αρκεί: τι ψάχνει, τι συμφωνήσατε…"></textarea>' +
        btn('data-cl-save="1"', 'Αποθήκευση', 'solid-red');
    }
    box.innerHTML = '<p class="cl-step">' + (st.i + 1) + ' από ' + st.list.length + '</p>' +
      '<div class="rp-card cl-card"><span>' + esc(q) + '</span><b>' + esc(name) + '</b><span>' + esc(sub) + '</span></div>' +
      '<div class="cl-acts">' + acts + '</div>' +
      '<button type="button" class="link cl-skip" data-cl-skip="1">Παράλειψη</button>' +
      '<p class="save-hint err" id="cl-hint"></p>';
    wire(box, x);
  }

  function next(counted) { if (counted) st.done++; st.i++; render(); W.render(); }

  function fail(e) { var h = W.$('cl-hint'); if (h) h.textContent = e.message; }

  function sent(r) { var d = r && r.data; if (d && d.lead) W.merge(d.lead); else if (d && d.id) W.merge(d); }

  function wire(box, x) {
    var l = x.l;
    box.querySelectorAll('[data-cl-out]').forEach(function (b) {
      b.onclick = function () {
        var o = W.S.boot.outcomes[Number(b.dataset.clOut)];
        W.send('outcome', { id: l.id, outcome: o, note: '' }).then(function (r) { sent(r); next(true); }).catch(fail);
      };
    });
    box.querySelectorAll('[data-cl-na]').forEach(function (b) {
      b.onclick = function () {
        W.send('status', { id: l.id, status: W.ST.NO_ANSWER }).then(function (r) { sent(r); next(true); }).catch(fail);
      };
    });
    box.querySelectorAll('[data-cl-call]').forEach(function (b) {
      b.onclick = function () { W.closePop('closebox'); W.callLead(l.id); };
    });
    box.querySelectorAll('[data-cl-save]').forEach(function (b) {
      b.onclick = function () {
        var note = (W.$('cl-note').value || '').trim();
        if (!note) return fail({ message: 'Γράψε μία γραμμή ή πάτα Παράλειψη.' });
        W.send('callNote', { id: l.id, cid: x.c.id, result: x.c.result || '', note: note, at: x.c.ts })
          .then(function (r) { sent(r); next(true); }).catch(fail);
      };
    });
    box.querySelectorAll('[data-cl-skip]').forEach(function (b) { b.onclick = function () { next(false); }; });
  }

  function open() {
    if (!on()) return;
    st = { list: items(), i: 0, done: 0 };
    render();
    W.openPop('closebox');
  }

  W.kwClose = { open: open, items: items };
  if (W.S && W.S.boot && typeof W.render === 'function') W.render();
})();
