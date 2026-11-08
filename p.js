/* 1.19 · Παρουσίαση ακινήτου για τον πελάτη.
   Το κλειδί είναι μετά το # (δεν στέλνεται ποτέ στον server της σελίδας).
   Όλα τα κείμενα μπαίνουν ως κείμενο (textContent), ποτέ ως HTML. */
(function () {
  'use strict';

  var API = (window.KW_CONFIG || {}).API_URL || '';
  var KEY = String(location.hash || '').replace(/^#/, '').trim();
  var $ = function (id) { return document.getElementById(id); };
  var D = null;               // ό,τι έστειλε ο server
  var imgs = {};              // 'id:s|l' → data URI
  var lb = { i: -1, loading: {} };

  function api(action, data) {
    data = data || {};
    data.k = KEY;
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ action: action, data: data }) })
      .then(function (r) { if (!r.ok) throw new Error('Σφάλμα δικτύου.'); return r.json(); })
      .then(function (res) {
        if (!res.ok) { var e = new Error(res.error || 'Κάτι πήγε στραβά.'); e.code = res.code; throw e; }
        return res.data;
      });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function initials(name) {
    var w = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().split(/\s+/);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }

  // Αν δεν έχει ανέβει ακόμα το logo, φαίνεται το όνομα του γραφείου.
  function logoFallback() {
    var l = $('logo');
    var bad = function () { l.hidden = true; $('wordmark').hidden = false; };
    if (l.complete && !l.naturalWidth) bad();
    l.addEventListener('error', bad);
  }

  function closed(title, text) {
    $('loading').hidden = true;
    $('closed').hidden = false;
    $('closed-title').textContent = title;
    $('closed-text').textContent = text;
    $('main').setAttribute('aria-busy', 'false');
  }

  // ── Γέμισμα της σελίδας ─────────────────────────────────

  function render() {
    var p = D.prop, a = D.agent;
    document.title = p.title + ' · ' + D.office.name;
    $('top-code').textContent = p.code ? 'Κωδ. ' + p.code : '';

    // Εξώφυλλο
    if (D.coverSrc) {
      $('hero-img').src = D.coverSrc;
      $('hero-img').alt = p.title;
      if (D.photos[0]) imgs[D.photos[0] + ':m'] = D.coverSrc;
    } else {
      $('hero').classList.add('no-photo');
    }
    if (p.deal) { $('deal').hidden = false; $('deal').textContent = p.deal; }
    if (D.photos.length > 1) {
      $('all-photos').hidden = false;
      $('all-photos-text').textContent = 'Όλες οι φωτογραφίες (' + D.photos.length + ')';
    }

    $('title').textContent = p.title;
    if (p.address) { $('where').hidden = false; $('where-text').textContent = p.address; }
    $('price').textContent = p.price || '';

    // Τα 4 βασικά πάνω, τα υπόλοιπα στα Χαρακτηριστικά.
    var key = ['Εμβαδόν', 'Τύπος', 'Περιοχή', 'Συναλλαγή'];
    var kf = $('keyfacts');
    p.facts.filter(function (f) { return key.indexOf(f[0]) !== -1; }).forEach(function (f) {
      var d = el('div', 'kf');
      d.appendChild(el('span', '', f[0]));
      d.appendChild(el('b', '', f[1]));
      kf.appendChild(d);
    });
    kf.hidden = !kf.children.length;
    var rest = p.facts.filter(function (f) { return key.indexOf(f[0]) === -1; });
    if (rest.length) {
      $('facts-block').hidden = false;
      rest.forEach(function (f) {
        var d = el('div');
        d.appendChild(el('dt', '', f[0]));
        d.appendChild(el('dd', '', f[1]));
        $('facts').appendChild(d);
      });
    }
    if (p.description) { $('desc-block').hidden = false; $('desc').textContent = p.description; }
    if (p.mapQuery) {
      $('map-block').hidden = false;
      $('map-link').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.mapQuery);
    }

    // Φωτογραφίες
    if (D.photos.length) {
      $('photos-block').hidden = false;
      $('photos-n').textContent = '(' + D.photos.length + ')';
      var grid = $('grid');
      D.photos.forEach(function (id, i) {
        var b = el('button', 'tile');
        b.setAttribute('aria-label', 'Φωτογραφία ' + (i + 1) + ' από ' + D.photos.length);
        b.addEventListener('click', function () { openLb(i); });
        grid.appendChild(b);
      });
      loadTiles();
    }

    // Μεσίτης
    $('agent-av').textContent = initials(a.name);
    $('agent-name').textContent = a.name;
    $('agent-office').textContent = D.office.name;
    setLink('a-call', a.tel ? 'tel:' + a.tel : '');
    setLink('cta-call', a.tel ? 'tel:' + a.tel : '');
    var waText = 'Καλησπέρα, σας γράφω για το ακίνητο «' + p.title + '»' + (p.code ? ' (κωδ. ' + p.code + ')' : '') + '.';
    var wa = a.wa ? 'https://wa.me/' + a.wa + '?text=' + encodeURIComponent(waText) : '';
    setLink('a-wa', wa);
    setLink('cta-wa', wa);
    setLink('a-mail', a.email ? 'mailto:' + a.email + '?subject=' + encodeURIComponent(p.title + (p.code ? ' · κωδ. ' + p.code : '')) : '');
    var lines = $('agent-lines');
    if (a.phone) { lines.appendChild(document.createTextNode('Κινητό: ')); lines.appendChild(link('tel:' + a.tel, a.phone)); lines.appendChild(el('br')); }
    if (a.email) { lines.appendChild(document.createTextNode('Email: ')); lines.appendChild(link('mailto:' + a.email, a.email)); }
    $('cta').hidden = !a.tel && !wa;

    // Υποσέλιδο
    var o = D.office;
    $('foot-office').textContent = [o.name, o.address, o.phone].filter(Boolean).join(' · ');
    if (o.site) { $('foot-office').appendChild(document.createTextNode(' · ')); $('foot-office').appendChild(link(o.site, o.site.replace(/^https?:\/\//, ''))); }
    $('foot-small').textContent = 'Τα στοιχεία είναι ενδεικτικά και δεν αποτελούν πρόταση σύμβασης. ' +
      'Κάθε γραφείο Keller Williams λειτουργεί ανεξάρτητα. Η παρουσίαση ισχύει έως ' + D.expires + '.';
    $('foot').hidden = false;

    $('loading').hidden = true;
    $('prop').hidden = false;
    $('main').setAttribute('aria-busy', 'false');
  }

  function link(href, text) {
    var a = el('a', '', text);
    a.href = href;
    return a;
  }

  function setLink(id, href) {
    var a = $(id);
    if (href) { a.href = href; a.removeAttribute('aria-disabled'); }
    else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.hidden = id.indexOf('cta') === 0; }
  }

  /** Οι μικρές εικόνες, σε ένα αίτημα· ό,τι δεν πρόλαβε ξαναζητιέται. */
  function loadTiles() {
    var ids = D.photos.filter(function (id) { return !imgs[id + ':s']; });
    if (!ids.length) return;
    api('presImg', { ids: ids, size: 's' }).then(function (r) {
      (r.items || []).forEach(function (it) {
        if (!it.src) return;
        imgs[it.id + ':s'] = it.src;
        var i = D.photos.indexOf(it.id);
        var tile = $('grid').children[i];
        if (tile && !tile.firstChild) {
          var im = el('img');
          im.alt = '';
          im.src = i === 0 && imgs[it.id + ':m'] ? imgs[it.id + ':m'] : it.src;
          tile.appendChild(im);
        }
        var sl = $('lb-track').children[i];
        if (sl && !sl.firstChild.getAttribute('src')) sl.firstChild.src = it.src;
      });
      if (r.pending && r.pending.length) loadTiles();
    }).catch(function () { /* οι φωτογραφίες δεν είναι απαραίτητες για τη σελίδα */ });
  }

  // ── Μεγάλη προβολή ──────────────────────────────────────

  function openLb(start) {
    var t = $('lb-track');
    if (!t.children.length) {
      D.photos.forEach(function (id, i) {
        var s = el('div', 'lb-slide');
        var im = el('img');
        im.alt = 'Φωτογραφία ' + (i + 1);
        var low = imgs[id + ':l'] || imgs[id + ':m'] || imgs[id + ':s'];
        if (low) im.src = low;
        s.appendChild(im);
        t.appendChild(s);
      });
    }
    $('lb').hidden = false;
    document.body.classList.add('lb-open');
    lb.i = -1;
    requestAnimationFrame(function () { t.scrollLeft = start * t.clientWidth; lbSet(start); });
    $('lb-close').focus();
  }

  function lbSet(i) {
    i = Math.max(0, Math.min(D.photos.length - 1, i));
    if (lb.i === i) return;
    lb.i = i;
    $('lb-count').textContent = (i + 1) + ' / ' + D.photos.length;
    $('lb-prev').disabled = i === 0;
    $('lb-next').disabled = i === D.photos.length - 1;
    [i, i + 1, i - 1].forEach(lbLoad);
  }

  function lbLoad(i) {
    var id = D.photos[i];
    if (!id) return;
    var im = $('lb-track').children[i].firstChild;
    if (imgs[id + ':l']) { im.src = imgs[id + ':l']; return; }
    if (lb.loading[id]) return;
    lb.loading[id] = true;
    api('presImg', { id: id, size: 'l' }).then(function (r) {
      imgs[id + ':l'] = r.src;
      im.src = r.src;
    }).catch(function () { lb.loading[id] = false; });
  }

  function lbGo(i) {
    var t = $('lb-track');
    t.scrollTo({ left: i * t.clientWidth, behavior: 'smooth' });
    lbSet(i);
  }

  function closeLb() {
    $('lb').hidden = true;
    document.body.classList.remove('lb-open');
  }

  function wire() {
    $('hero-btn').addEventListener('click', function () { if (D && D.photos.length) openLb(0); });
    $('all-photos').addEventListener('click', function () { openLb(0); });
    $('lb-close').addEventListener('click', closeLb);
    $('lb-prev').addEventListener('click', function () { lbGo(lb.i - 1); });
    $('lb-next').addEventListener('click', function () { lbGo(lb.i + 1); });
    var t = $('lb-track'), timer = null;
    t.addEventListener('scroll', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { lbSet(Math.round(t.scrollLeft / Math.max(1, t.clientWidth))); }, 60);
    }, { passive: true });
    document.addEventListener('keydown', function (e) {
      if ($('lb').hidden) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowRight') lbGo(lb.i + 1);
      if (e.key === 'ArrowLeft') lbGo(lb.i - 1);
    });
  }

  function start() {
    logoFallback();
    wire();
    if (!API) return closed('Η σελίδα δεν έχει ρυθμιστεί', 'Επικοινωνήστε με τον μεσίτη σας.');
    if (!/^[0-9a-f]{48}$/.test(KEY)) return closed('Το link δεν είναι πλήρες', 'Ανοίξτε ξανά το link όπως σας ήρθε, ή ζητήστε νέο από τον μεσίτη σας.');
    api('presOpen').then(function (d) { D = d; render(); })
      .catch(function (e) {
        closed(e.code === 'expired' ? 'Η παρουσίαση έληξε' : e.code === 'gone' ? 'Το ακίνητο δεν είναι πια διαθέσιμο' : 'Η παρουσίαση δεν είναι διαθέσιμη',
               e.message);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
