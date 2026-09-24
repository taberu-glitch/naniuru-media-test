/* ナニウルメディア — media.js（ヘッダー・メニュー・検索・目次） */
(function () {
  'use strict';
  var html = document.documentElement;
  var me = document.currentScript;
  var ROOT = (me && me.src) ? me.src.replace(/assets\/media\.js(\?.*)?$/, '') : (html.getAttribute('data-root') || '/media/');
  var REL = html.getAttribute('data-rel') === '1' || /\.html$/.test(location.pathname);

  // header state
  var hd = document.querySelector('[data-hd]');
  function onScroll() { if (hd) hd.toggleAttribute('data-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // dialogs
  function open(id) {
    var d = document.getElementById(id);
    if (!d || d.open) return;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    var input = d.querySelector('input'); if (input) setTimeout(function () { input.focus(); }, 30);
    if (id === 'search') loadIndex();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open-search]'); if (t) { open('search'); return; }
    t = e.target.closest('[data-open-drawer]'); if (t) { open('drawer'); return; }
    t = e.target.closest('[data-close]'); if (t) { t.closest('dialog').close(); return; }
    if (e.target.tagName === 'DIALOG') e.target.close(); // backdrop
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); open('search'); }
  });

  // search
  var INDEX = null, loading = null;
  function loadIndex() {
    if (INDEX || loading) return loading;
    loading = fetch(ROOT + 'search-index.json').then(function (r) { return r.json(); })
      .then(function (d) { INDEX = d; return d; })
      .catch(function () { INDEX = []; });
    return loading;
  }
  function href(u) { return ROOT + u + (REL && /\/$/.test(u) ? 'index.html' : ''); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s).normalize('NFKC').toLowerCase(); }
  function hl(text, terms) {
    var out = esc(text);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    });
    return out;
  }
  function run(form) {
    var input = form.querySelector('[data-search-input]');
    var scope = form.closest('dialog') || document;
    var list = scope.querySelector('[data-search-results]');
    var status = scope.querySelector('[data-search-status]');
    var q = input.value.trim();
    if (!q) { list.innerHTML = ''; status.textContent = ''; return; }
    status.textContent = '検索しています…';
    Promise.resolve(loadIndex()).then(function () {
      var terms = norm(q).split(/[\s　]+/).filter(Boolean);
      var hits = (INDEX || []).map(function (a) {
        var title = norm(a.t), meta = norm([a.c].concat(a.g, a.i).join(' ')), body = norm(a.d + ' ' + a.x);
        var score = 0;
        for (var i = 0; i < terms.length; i++) {
          var t = terms[i], s = 0;
          if (title.indexOf(t) > -1) s += 5;
          if (meta.indexOf(t) > -1) s += 3;
          if (body.indexOf(t) > -1) s += 1;
          if (!s) return null;
          score += s;
        }
        return { a: a, s: score };
      }).filter(Boolean).sort(function (x, y) { return y.s - x.s || (y.a.dt > x.a.dt ? 1 : -1); });
      status.textContent = hits.length ? '「' + q + '」の検索結果：' + hits.length + '件' : '「' + q + '」に一致する記事はありません。別の言葉で探すか、下のタグから探してください。';
      list.innerHTML = hits.map(function (h) {
        return '<li><a href="' + esc(href(h.a.u)) + '"><small>' + esc(h.a.c) + '・' + esc(h.a.dt.replace(/-/g, '.')) + '</small><strong>' + hl(h.a.t, terms) + '</strong><span>' + hl(h.a.d, terms) + '</span></a></li>';
      }).join('');
    });
  }
  document.querySelectorAll('[data-search-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); run(form); });
    var input = form.querySelector('[data-search-input]'), timer;
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { run(form); }, 180); });
    if (form.hasAttribute('data-search-page')) {
      var q = '';
      try { q = new URLSearchParams(location.search).get('q') || ''; } catch (e) {}
      if (!q && location.hash.length > 1) { try { q = decodeURIComponent(location.hash.slice(1)); } catch (e) {} }
      if (q) { input.value = q; run(form); } else loadIndex();
    }
  });

  // toc highlight
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.remove('is-active'); });
          var a = map[en.target.id]; if (a) a.classList.add('is-active');
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }
})();
