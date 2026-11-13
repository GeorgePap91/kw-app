/**
 * KW App · 2.3 · Κινήσεις δαχτύλου στη λίστα κλήσεων
 * ─────────────────────────────────────────────────────────────
 * FEAT-2 · Σύρσιμο (flag «swipeRows»)
 *   → δεξιά  : «Υπόδειξη»     ανοίγει τον πελάτη με τη φόρμα υπόδειξης έτοιμη
 *   ← αριστερά: «Δεν απάντησε» με 4″ «Αναίρεση» πριν σταλεί (όπως το Gmail),
 *               ώστε ένα λάθος σύρσιμο να μη βάλει ποτέ follow-up στο ημερολόγιο.
 *               Μόνο σε κλήσεις χωρίς υπόδειξη και όχι κλειστές.
 * FEAT-6 · Παρατεταμένο πάτημα (flag «peekProp»)
 *   Κρατάς το δάχτυλο στη γραμμή → ανοίγει η καρτέλα του ακινήτου (φωτό, τιμή,
 *   τ.μ., διεύθυνση, κλήσεις) από πάνω, χωρίς να φύγεις από τη λίστα.
 *
 * Κανόνες για ευκολία:
 *   · Το σύρσιμο «πιάνει» μόνο αν είναι καθαρά οριζόντιο, ώστε το scroll να δουλεύει όπως πριν.
 *   · Χρειάζεται να σύρεις πάνω από το ~1/3 της γραμμής. Στο όριο: δόνηση + «Άφησε για…».
 *   · Ένα απλό πάτημα ανοίγει την κλήση όπως πάντα.
 * Φορτώνεται μετά το app.js (χρειάζεται S, feat, findLead, showLead, openShowingForm,
 * openProp, send, merge, render, toast, normCode, ST, $).
 */

var GST = {
  MOVE: 10,          // px πριν αποφασίσουμε αν είναι οριζόντιο ή scroll
  RATIO: 0.35,       // πόσο της γραμμής πρέπει να συρθεί
  MIN: 90,           // ...και τουλάχιστον τόσα px
  LONG: 550,         // ms για παρατεταμένο πάτημα
  UNDO: 4000         // ms για «Αναίρεση»
};

/** Συνδέει τις κινήσεις στις γραμμές μιας λίστας (καλείται από wireLeadRows). */
function wireGestures(el) {
  var swipe = feat('swipeRows'), peek = feat('peekProp');
  if (!swipe && !peek) return;
  el.querySelectorAll('.row.lead[data-id]').forEach(function (r) { gstRow(r, swipe, peek); });
}

/** Ποιες κινήσεις επιτρέπονται σε αυτή την κλήση. */
function gstAllowed(l) {
  if (!l) return { right: false, left: false };
  var closed = l.status === ST.CLOSED;
  var showing = l.status === ST.SHOWING || (typeof hasShowing === 'function' && hasShowing(l));
  return { right: !closed, left: !closed && !showing };
}

/** Το ακίνητο της κλήσης, αν υπάρχει στη λίστα ακινήτων. */
function gstProp(l) {
  if (!l || !l.code || !S.props) return null;
  var k = normCode(l.code);
  return S.props.filter(function (p) { return normCode(p.code) === k; })[0] || null;
}

function gstRow(r, swipe, peek) {
  if (r._gst) return;
  r._gst = true;
  r.classList.add('gst');

  var orig = r.onclick;                          // απλό πάτημα: όπως πριν, εκτός αν μόλις έγινε κίνηση
  r.onclick = function (e) {
    if (r._gstBlock) { r._gstBlock = false; e.preventDefault(); return; }
    if (orig) orig.call(r, e);
  };
  r.addEventListener('contextmenu', function (e) { if (peek) e.preventDefault(); });

  var x0, y0, mode, timer, hint, armed, dir;

  r.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    mode = ''; armed = false; dir = 0;
    clearTimeout(timer);
    if (peek) timer = setTimeout(function () {
      if (mode) return;
      mode = 'long';
      r._gstBlock = true;
      gstBuzz();
      gstPeek(findLead(r.dataset.id));
    }, GST.LONG);
  }, { passive: true });

  r.addEventListener('touchmove', function (e) {
    if (mode === 'long' || mode === 'scroll') return;
    var dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if (!mode) {
      if (Math.abs(dx) < GST.MOVE && Math.abs(dy) < GST.MOVE) return;
      clearTimeout(timer);
      mode = swipe && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'swipe' : 'scroll';
      if (mode !== 'swipe') return;
    }
    var ok = gstAllowed(findLead(r.dataset.id));
    dir = dx > 0 ? 1 : -1;
    if ((dir > 0 && !ok.right) || (dir < 0 && !ok.left)) { gstHint(r, null); hint = null; return; }
    e.preventDefault();                          // κρατά τη σελίδα ακίνητη όσο σέρνεις
    var need = Math.max(GST.MIN, r.offsetWidth * GST.RATIO);
    var now = Math.abs(dx) >= need;
    if (now && !armed) gstBuzz();
    armed = now;
    hint = gstHint(r, { dir: dir, pct: Math.min(1, Math.abs(dx) / need), armed: armed });
  }, { passive: false });

  function end() {
    clearTimeout(timer);
    if (mode === 'swipe') {
      r._gstBlock = true;
      setTimeout(function () { r._gstBlock = false; }, 400);
      gstHint(r, null);
      if (armed) gstDo(findLead(r.dataset.id), dir);
    }
    mode = ''; armed = false;
  }
  r.addEventListener('touchend', end);
  r.addEventListener('touchcancel', function () { clearTimeout(timer); gstHint(r, null); mode = ''; armed = false; });
}

/** Η χρωματιστή μπάρα που «γεμίζει» όσο σέρνεις, με το τι θα γίνει. */
function gstHint(r, s) {
  var h = r.querySelector('.gst-hint');
  if (!s) { if (h) h.remove(); return null; }
  if (!h) { h = document.createElement('span'); h.className = 'gst-hint'; h.setAttribute('aria-hidden', 'true'); r.appendChild(h); }
  var right = s.dir > 0;
  h.className = 'gst-hint ' + (right ? 'is-right' : 'is-left') + (s.armed ? ' is-armed' : '');
  h.style.width = Math.round(s.pct * 100) + '%';
  h.textContent = (s.armed ? 'Άφησε για ' : '') + (right ? '📅 Υπόδειξη' : '📵 Δεν απάντησε');
  return h;
}

function gstBuzz() { try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) { /* χωρίς δόνηση */ } }

/** Εκτελεί την ενέργεια του συρσίματος. */
function gstDo(l, dir) {
  if (!l) return;
  if (dir > 0) {                                 // → Υπόδειξη
    showLead(l, {});
    openShowingForm();
    return;
  }
  gstLater(l);                                   // ← Δεν απάντησε (με αναίρεση)
}

/** «Δεν απάντησε» σε 4″, με κουμπί «Αναίρεση». Χωρίς αναίρεση → στέλνεται (και offline). */
function gstLater(l) {
  var t = $('toast');
  if (S.gstPending) gstCommit(S.gstPending);       // προηγούμενο σε αναμονή: στέλνεται τώρα
  var job = { id: l.id, name: l.name || 'Χωρίς όνομα' };
  job.timer = setTimeout(function () { gstCommit(job); }, GST.UNDO);
  S.gstPending = job;
  t.className = 'toast gst-toast';
  t.innerHTML = '';
  t.appendChild(document.createTextNode('📵 ' + job.name + ': Δεν απάντησε '));
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'gst-undo';
  b.textContent = 'Αναίρεση';
  b.onclick = function () {
    clearTimeout(job.timer);
    if (S.gstPending === job) S.gstPending = null;
    t.hidden = true;
    toast('Ακυρώθηκε');
  };
  t.appendChild(b);
  t.hidden = false;
  clearTimeout(t._x);
  t._x = setTimeout(function () { t.hidden = true; }, GST.UNDO);
}

function gstCommit(job) {
  clearTimeout(job.timer);
  if (S.gstPending === job) S.gstPending = null;
  if (job.done) return;
  job.done = true;
  send('status', { id: job.id, status: ST.NO_ANSWER }).then(function (r) {
    var l = r.data;
    if (l) merge(l);
    render();
    if (r.queued) toast('Δεν απάντησε · το follow-up θα μπει στο ημερολόγιο μόλις έρθει σήμα');
    else if (l && l.warning) toast(l.warning, true);
    else if (l && l.followUp) toast('Follow-up ' + l.followUp + (l.invited ? ' · ήρθε ως πρόσκληση' : ''));
  }).catch(function (e) { toast(e.message, true); });
}

/** FEAT-6 · Η καρτέλα του ακινήτου πάνω από τη λίστα. */
function gstPeek(l) {
  var p = gstProp(l);
  if (!p) return toast(l && l.code ? 'Το ακίνητο ' + l.code + ' δεν είναι στη λίστα ακινήτων.' : 'Η κλήση δεν έχει κωδικό ακινήτου.', true);
  openProp(p.code);
}
