#!/usr/bin/env node
/*
 * ナニウルメディア 静的サイトビルド
 *
 *   node build.js                 … content/ から ../media を生成（site.json の outDir）
 *   node build.js --out DIR       … 出力先を指定
 *   node build.js --relative      … 相対リンクで出力（ローカル確認・プレビュー用）
 *   node build.js --drafts        … 下書き・予約記事も出力（確認用。本番では使わない）
 *   node build.js --strict        … 警告があれば失敗にする（本番公開前のチェック）
 *   node build.js --today 2026-10-01 … 「今日」を指定（予約公開の確認用）
 *
 * 依存パッケージなし（Node 18 以上）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FM = require('./lib/frontmatter');

// ---------- options ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : undefined; };
const ROOT = __dirname;
const CONTENT = path.join(ROOT, 'content');
const site = JSON.parse(fs.readFileSync(path.join(CONTENT, 'site.json'), 'utf8'));
const OPT = {
  relative: flag('--relative'),
  drafts: flag('--drafts'),
  strict: flag('--strict'),
  out: path.resolve(ROOT, opt('--out') || site.outDir || '../media'),
  today: opt('--today') || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) // JST
};
const BASE = site.basePath || '/media/';
const warnings = [];
const warn = (m) => warnings.push(m);

// ---------- helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = (h) => String(h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const dot = (d) => (d || '').replace(/-/g, '.');
const jaDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}年${m}月${dd}日`; };
const hash = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
const splitTitle = (t) => { const i = t.indexOf('｜'); return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)]; };
const abs = (u) => (site.siteUrl ? site.siteUrl.replace(/\/$/, '') + u : '');

function link(to, from) {
  if (!to) return '';
  if (/^(https?:|mailto:|tel:|#|data:)/.test(to)) return to;
  if (!OPT.relative || !to.startsWith(BASE)) return to;
  const [p, h] = to.split('#');
  const fromDir = from.endsWith('/') ? from : path.posix.dirname(from) + '/';
  const target = p.endsWith('/') ? p + 'index.html' : p;
  return (path.posix.relative(fromDir, target) || 'index.html') + (h ? '#' + h : '');
}
function rootDir(from) {
  if (!OPT.relative) return BASE;
  const fromDir = from.endsWith('/') ? from : path.posix.dirname(from) + '/';
  const r = path.posix.relative(fromDir, BASE);
  return r ? r + '/' : './';
}
function outFile(url) {
  const rel = url.slice(BASE.length);
  return path.join(OPT.out, url.endsWith('/') ? path.join(rel, 'index.html') : rel);
}
const written = new Set();
function write(url, content) {
  const f = outFile(url);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  written.add(url);
}
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// ---------- taxonomy ----------
const cats = new Map(site.categories.map((c) => [c.slug, c]));
const items = new Map(site.items.map((i) => [i.slug, i]));
const seriesMap = new Map(site.series.map((s) => [s.slug, s]));
const tagByName = new Map(site.tags.map((t) => [t.name, t]));
function tagFor(name) {
  if (!tagByName.has(name)) {
    const t = { slug: 't-' + hash(name), name };
    tagByName.set(name, t);
    warn(`タグ「${name}」が site.json の tags に未登録です（仮のURL ${t.slug} を使用）。`);
  }
  return tagByName.get(name);
}
const catUrl = (c) => `${BASE}category/${c.slug}/`;
const itemUrl = (i) => `${BASE}item/${i.slug}/`;
const tagUrl = (t) => `${BASE}tag/${t.slug}/`;
const seriesUrl = (s) => `${BASE}series/${s.slug}/`;

// ---------- load content ----------
function processBody(html) {
  const toc = [];
  let n = 0;
  html = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (m, attrs = '', inner) => {
    let id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
    if (!id) { id = 'sec-' + (++n); attrs += ` id="${id}"`; }
    toc.push({ id, text: strip(inner) });
    return `<h2${attrs}>${inner}</h2>`;
  });
  html = html.replace(/<table([\s\S]*?)<\/table>/g, '<div class="table-wrap" tabindex="0"><table$1</table></div>');
  return { html, toc };
}

function loadDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.html?$/.test(f)).sort().map((f) => {
    const { data, body } = FM.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { file: f, slug: f.replace(/\.html?$/, ''), fm: data, raw: body };
  });
}

const all = [];
for (const a of loadDir(path.join(CONTENT, 'articles'))) {
  const fm = a.fm;
  const where = `articles/${a.file}`;
  for (const k of ['title', 'url', 'date', 'category']) if (!fm[k]) warn(`${where}: ${k} がありません。`);
  if (!fm.title || !fm.url || !fm.date) continue;
  let url = String(fm.url).trim();
  if (!url.startsWith(BASE)) { warn(`${where}: url は ${BASE} で始めてください（${url}）。`); continue; }
  if (!url.endsWith('/')) url += '/';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) { warn(`${where}: date は YYYY-MM-DD 形式にしてください。`); continue; }
  const draft = fm.draft === true;
  const scheduled = fm.date > OPT.today;
  if ((draft || scheduled) && !OPT.drafts) {
    console.log(`  - ${draft ? '下書き' : '予約（' + fm.date + ' 公開）'}のため出力しません: ${a.file}`);
    continue;
  }
  const cat = cats.get(fm.category);
  if (!cat) warn(`${where}: category「${fm.category}」が site.json にありません。`);
  const its = (fm.items || []).map((s) => { const i = items.get(s); if (!i) warn(`${where}: items「${s}」が site.json にありません。`); return i; }).filter(Boolean);
  const series = fm.series ? seriesMap.get(fm.series) : null;
  if (fm.series && !series) warn(`${where}: series「${fm.series}」が site.json にありません。`);
  const { html, toc } = processBody(a.raw);
  const [main, sub] = splitTitle(fm.title);
  all.push({
    slug: a.slug, file: a.file, url, title: fm.title, main, sub,
    shortTitle: fm.shortTitle || main,
    seoTitle: fm.seoTitle || `${fm.title}｜${site.publisher}`,
    description: fm.description || '',
    date: fm.date, updated: fm.updated && fm.updated > fm.date ? fm.updated : fm.date,
    cat: cat || site.categories[0], items: its,
    tags: (fm.tags || []).map(tagFor),
    series, seriesOrder: Number(fm.seriesOrder) || 0,
    featured: fm.featured === true, author: fm.author || site.defaultAuthor,
    cover: fm.cover || '', coverCredit: fm.coverCredit || '', coverLabel: fm.coverLabel || (cat ? cat.en : ''),
    ogImage: fm.ogImage || site.ogImage || '',
    draft, scheduled, html, toc,
    readMin: Math.max(1, Math.round(strip(html).length / 500))
  });
}
all.sort((a, b) => (b.date + b.updated).localeCompare(a.date + a.updated) || a.slug.localeCompare(b.slug));
const seen = new Map();
for (const a of all) { if (seen.has(a.url)) warn(`URLが重複しています: ${a.url}（${seen.get(a.url)} と ${a.file}）`); seen.set(a.url, a.file); }

const pages = loadDir(path.join(CONTENT, 'pages')).map((p) => {
  let url = String(p.fm.url || `${BASE}${p.slug}/`); if (!url.endsWith('/')) url += '/';
  const { html, toc } = processBody(p.raw);
  return { ...p, url, title: p.fm.title || p.slug, description: p.fm.description || '', updated: p.fm.updated || '', html, toc };
});

const byCat = (c) => all.filter((a) => a.cat.slug === c.slug);
const byItem = (i) => all.filter((a) => a.items.includes(i));
const byTag = (t) => all.filter((a) => a.tags.includes(t));
const bySeries = (s) => all.filter((a) => a.series === s).sort((a, b) => (a.seriesOrder - b.seriesOrder) || a.date.localeCompare(b.date));
const liveCats = site.categories.filter((c) => byCat(c).length);
const liveSeries = site.series.filter((s) => bySeries(s).length);
const liveTags = [...tagByName.values()].map((t) => ({ t, n: byTag(t).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
const coverUrl = (a) => a.cover ? (/^(https?:)?\/\//.test(a.cover) || a.cover.startsWith('/') ? a.cover : `${BASE}images/${a.cover.replace(/^images\//, '')}`) : `${BASE}assets/covers/${a.slug}.svg`;

// ---------- icons ----------
const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>'
};

// ---------- components ----------
function catChip(c, L) {
  return `<span class="chip-cat" style="--c:${esc(c.color)}">${esc(c.name)}</span>`;
}
function tagList(tags, L, max = 3) {
  if (!tags.length) return '';
  return `<ul class="tags">${tags.slice(0, max).map((t) => `<li><a href="${L(tagUrl(t))}">#${esc(t.name)}</a></li>`).join('')}</ul>`;
}
function card(a, L, variant = 'std', hl = 'h3') {
  const img = `<div class="card__media"><img src="${L(coverUrl(a))}" alt="" width="1200" height="675" loading="lazy" decoding="async"></div>`;
  const sub = variant === 'lead' && a.sub ? `<span class="card__sub">${esc(a.sub)}</span>` : '';
  const desc = variant === 'lead' ? `<p class="card__desc">${esc(a.description)}</p>` : '';
  return `<article class="card card--${variant}">
  <a class="card__link" href="${L(a.url)}">${img}<div class="card__body">${catChip(a.cat, L)}<${hl} class="card__title">${esc(a.main)}${sub}</${hl}>${desc}</div></a>
  <div class="card__meta">${tagList(a.tags, L, variant === 'row' ? 2 : 3)}<time datetime="${a.date}">${dot(a.date)}</time></div>
</article>`;
}
function sectionHead(en, ja, L, more) {
  return `<div class="sec-head"><p class="stamp">${esc(en)}</p><h2 class="sec-head__title">${esc(ja)}</h2>${more ? `<a class="more" href="${L(more.url)}">${esc(more.label)}${ICON.arrow}</a>` : ''}</div>`;
}
function grid(list, L, variant = 'std') {
  return `<div class="grid grid--${variant}">${list.map((a) => card(a, L, variant)).join('\n')}</div>`;
}
function leadPlus(list, L) {
  if (!list.length) return '';
  const [first, ...rest] = list;
  return `<div class="lead-plus">${card(first, L, 'lead')}${rest.length ? `<div class="lead-plus__rest">${rest.map((a) => card(a, L, 'row')).join('\n')}</div>` : ''}</div>`;
}
function crumbs(list, L) {
  return `<nav class="crumbs" aria-label="パンくずリスト"><ol>${list.map((c, i) => i === list.length - 1
    ? `<li><span aria-current="page">${esc(c.name)}</span></li>`
    : `<li><a href="${L(c.url)}">${esc(c.name)}</a></li>`).join('')}</ol></nav>`;
}
function crumbsLd(list) {
  if (!site.siteUrl) return null;
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.url) })) };
}

// ---------- layout ----------
let ASSET_V = '';

function kobutsuLine() {
  const k = site.kobutsu || {};
  if (k.commission && k.number && k.holder) return `古物商許可　${esc(k.commission)}　第${esc(k.number)}号　${esc(k.holder)}`;
  return '<span class="todo">古物商許可の表示：公安委員会名・許可番号・氏名または名称を site.json に記入してください</span>';
}

function layout(p) {
  const from = p.url;
  const L = (u) => link(u, from);
  const canonical = abs(p.url);
  const title = p.fullTitle || (p.title ? `${p.title}｜${site.name}` : `${site.name}｜${site.tagline}`);
  const ld = (p.ld || []).filter(Boolean).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
  const v = `?v=${ASSET_V}`;
  const og = p.ogImage ? (p.ogImage.startsWith('http') ? p.ogImage : abs(p.ogImage)) : '';
  const nav = liveCats.map((c) => `<a href="${L(catUrl(c))}"${p.active === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`).join('')
    + (liveSeries.length ? `<a href="${L(BASE + 'series/')}"${p.active === 'series' ? ' aria-current="page"' : ''}>連載</a>` : '')
    + `<a href="${L(BASE + 'articles/')}"${p.active === 'articles' ? ' aria-current="page"' : ''}>記事一覧</a>`;
  const cta = site.cta;
  const liveItems = site.items.filter((i) => byItem(i).length);
  return `<!DOCTYPE html>
<html lang="${esc(site.lang || 'ja')}" data-root="${esc(rootDir(from))}" data-rel="${OPT.relative ? 1 : 0}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(p.description || site.description)}">
${p.noindex ? '<meta name="robots" content="noindex">\n' : ''}${canonical && !p.noindex ? `<link rel="canonical" href="${esc(canonical)}">\n` : ''}<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:title" content="${esc(p.ogTitle || title)}">
<meta property="og:description" content="${esc(p.description || site.description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">\n` : ''}${og ? `<meta property="og:image" content="${esc(og)}">\n<meta name="twitter:card" content="summary_large_image">\n` : ''}<meta name="theme-color" content="#076BED">
<link rel="preload" href="${L(BASE + 'assets/fonts/OverusedGrotesk-VF.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${L(BASE + 'assets/media.css')}${v}">
${site.siteUrl ? `<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="${esc(abs(BASE + 'feed.xml'))}">\n` : ''}${ld}
</head>
<body class="${p.bodyClass || ''}">
<a class="skip" href="#main">本文へスキップ</a>
<header class="hd" data-hd>
  <div class="hd__in">
    <a class="brand" href="${L(BASE)}">
      <span class="brand__mark" aria-hidden="true">NU</span>
      <span class="brand__txt"><span class="brand__name">${esc(site.name)}</span><span class="brand__sub">八王子の買取店ナニウルが運営</span></span>
    </a>
    <nav class="hd__nav" aria-label="カテゴリー">${nav}</nav>
    <div class="hd__act">
      <button class="icon-btn" type="button" data-open-search aria-label="記事を検索">${ICON.search}</button>
      <a class="btn btn--cta hd__cta" href="${L(cta.primary.url)}">LINEで査定</a>
      <button class="icon-btn hd__menu" type="button" data-open-drawer aria-label="メニューを開く">${ICON.menu}</button>
    </div>
  </div>
</header>
<main id="main">
${p.main}
</main>
<section class="cta-band" aria-labelledby="cta-band-title">
  <div class="wrap cta-band__in">
    <div>
      <p class="stamp stamp--light">Appraisal</p>
      <h2 class="cta-band__title" id="cta-band-title">${esc(cta.heading)}</h2>
      <p class="cta-band__text">${esc(cta.text)}</p>
    </div>
    <div class="cta-band__act">
      <a class="btn btn--light btn--lg" href="${L(cta.primary.url)}">${esc(cta.primary.label)}${ICON.arrow}</a>
      ${(cta.secondary || []).filter((s) => s.url).map((s) => `<a class="cta-band__sub" href="${L(s.url)}">${esc(s.label)}</a>`).join('')}
    </div>
  </div>
</section>
<footer class="ft">
  <div class="wrap">
    <div class="ft__grid">
      <div class="ft__about">
        <a class="brand brand--ft" href="${L(BASE)}"><span class="brand__mark" aria-hidden="true">NU</span><span class="brand__txt"><span class="brand__name">${esc(site.name)}</span></span></a>
        <p>${esc(site.description)}</p>
      </div>
      <nav class="ft__col" aria-label="カテゴリー"><h2>カテゴリー</h2><ul>${liveCats.map((c) => `<li><a href="${L(catUrl(c))}">${esc(c.name)}</a></li>`).join('')}</ul></nav>
      ${liveItems.length ? `<nav class="ft__col" aria-label="品目"><h2>品目</h2><ul>${liveItems.map((i) => `<li><a href="${L(itemUrl(i))}">${esc(i.name)}</a></li>`).join('')}</ul></nav>` : ''}
      <nav class="ft__col" aria-label="サイト情報"><h2>メディア</h2><ul>${site.footerLinks.filter((f) => f.url).map((f) => `<li><a href="${L(f.url)}">${esc(f.label)}</a></li>`).join('')}</ul></nav>
    </div>
    <div class="ft__legal">
      <p>${kobutsuLine()}</p>
      <p>© ${OPT.today.slice(0, 4)} ${esc(site.publisher)}</p>
    </div>
  </div>
</footer>
<dialog class="modal modal--search" id="search" aria-label="記事を検索">
  <div class="modal__in">
    <div class="modal__hd"><p class="stamp">Search</p><button class="icon-btn" type="button" data-close aria-label="閉じる">${ICON.close}</button></div>
    <form class="search-form" role="search" data-search-form>
      <label class="sr" for="search-q">キーワード</label>
      <input id="search-q" name="q" type="search" placeholder="例：K18、宅配、本人確認" autocomplete="off" data-search-input>
      <button class="btn btn--cta" type="submit">検索</button>
    </form>
    <p class="search-status" data-search-status aria-live="polite"></p>
    <ul class="search-results" data-search-results></ul>
    ${liveTags.length ? `<div class="modal__tags"><h2 class="mini-title">タグから探す</h2><ul class="chips">${liveTags.slice(0, 12).map(({ t }) => `<li><a href="${L(tagUrl(t))}">#${esc(t.name)}</a></li>`).join('')}</ul></div>` : ''}
  </div>
</dialog>
<dialog class="modal modal--drawer" id="drawer" aria-label="メニュー">
  <div class="modal__in">
    <div class="modal__hd"><p class="stamp">Menu</p><button class="icon-btn" type="button" data-close aria-label="閉じる">${ICON.close}</button></div>
    <h2 class="mini-title">カテゴリー</h2>
    <ul class="drawer__cats">${liveCats.map((c) => `<li><a href="${L(catUrl(c))}"><span class="drawer__en" style="--c:${esc(c.color)}">${esc(c.en)}</span><strong>${esc(c.name)}</strong><span>${esc(c.lead)}</span></a></li>`).join('')}</ul>
    ${liveItems.length ? `<h2 class="mini-title">品目</h2><ul class="chips">${liveItems.map((i) => `<li><a href="${L(itemUrl(i))}">${esc(i.name)}</a></li>`).join('')}</ul>` : ''}
    ${liveSeries.length ? `<h2 class="mini-title">連載</h2><ul class="drawer__list">${liveSeries.map((s) => `<li><a href="${L(seriesUrl(s))}">${esc(s.name)}</a></li>`).join('')}</ul>` : ''}
    <ul class="drawer__list drawer__list--sub">${site.footerLinks.filter((f) => f.url).map((f) => `<li><a href="${L(f.url)}">${esc(f.label)}</a></li>`).join('')}</ul>
    <a class="btn btn--cta btn--block" href="${L(cta.primary.url)}">${esc(cta.primary.label)}</a>
  </div>
</dialog>
<script src="${L(BASE + 'assets/media.js')}${v}" defer></script>
</body>
</html>
`;
}

// ---------- pages ----------
function pageTop() {
  const url = BASE; const L = (u) => link(u, url);
  const latest = all.slice(0, 5);
  const picks = (site.editorPicks || []).length
    ? site.editorPicks.map((s) => all.find((a) => a.slug === s)).filter(Boolean)
    : all.filter((a) => a.featured).slice(0, 5);
  const ranking = (site.ranking || []).map((s) => all.find((a) => a.slug === s)).filter(Boolean).slice(0, 5);
  const pickupSeries = liveSeries.filter((s) => s.pickup);
  let h = `<section class="mast"><div class="wrap mast__in">
  <h1 class="mast__title">${esc(site.tagline)}</h1>
  <p class="mast__lead">${esc(site.description)}</p>
</div></section>
<section class="fv" aria-label="新着記事"><div class="wrap">${leadPlus(latest, L)}</div></section>`;

  if (pickupSeries.length) {
    h += `<section class="pickup" aria-labelledby="pickup-title"><div class="wrap">
  <div class="pickup__hd"><p class="stamp stamp--light">Pickup Series</p><h2 class="pickup__title" id="pickup-title">注目の連載</h2></div>
  <div class="pickup__row">${pickupSeries.map((s) => {
    const list = bySeries(s);
    return `<a class="pickup__card" href="${L(seriesUrl(s))}">
      <span class="pickup__count">${list.length}<small>本</small></span>
      <strong class="pickup__name">${esc(s.name)}</strong>
      <span class="pickup__desc">${esc(s.description)}</span>
      <ol class="pickup__list">${list.slice(0, 3).map((a) => `<li>${esc(a.shortTitle)}</li>`).join('')}</ol>
    </a>`;
  }).join('')}</div>
</div></section>`;
  }

  if (picks.length) {
    h += `<section class="sec sec--tint" aria-labelledby="picks"><div class="wrap">
  ${sectionHead('Editor\u2019s Picks', '編集部のおすすめ', L).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="picks">')}
  ${leadPlus(picks, L)}
</div></section>`;
  }

  if (ranking.length) {
    h += `<section class="sec" aria-labelledby="ranking"><div class="wrap">
  ${sectionHead('Ranking', 'よく読まれている記事', L).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="ranking">')}
  <ol class="ranking">${ranking.map((a, i) => `<li><span class="ranking__no">${i + 1}</span>${card(a, L, 'row')}</li>`).join('')}</ol>
</div></section>`;
  }

  h += `<section class="sec" aria-labelledby="items-title"><div class="wrap">
  ${sectionHead('Search by Item', '品目から探す', L).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="items-title">')}
  <p class="sec-lead">ナニウルでは、次の11の品目を買い取っています。品目ごとの記事は順次公開します。</p>
  <ul class="items">${site.items.map((i) => {
    const n = byItem(i).length;
    const inner = `<span class="items__mark">${esc(i.mark)}</span><span class="items__name">${esc(i.name)}</span><span class="items__n">${n ? n + '本の記事' : '準備中'}</span>`;
    return `<li>${n ? `<a class="items__tile" href="${L(itemUrl(i))}">${inner}</a>` : `<span class="items__tile is-empty">${inner}</span>`}</li>`;
  }).join('')}</ul>
</div></section>`;

  if (liveCats.length) {
    h += `<section class="sec sec--cats" aria-labelledby="cats-title"><div class="wrap">
  ${sectionHead('Categories', '記事カテゴリー', L).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="cats-title">')}
  ${liveCats.map((c) => {
    const list = byCat(c);
    return `<section class="cat-block" style="--c:${esc(c.color)}" aria-labelledby="cat-${c.slug}">
    <div class="cat-block__hd">
      <p class="cat-block__en">${esc(c.en)}</p>
      <h3 class="cat-block__name" id="cat-${c.slug}">${esc(c.name)}</h3>
      <p class="cat-block__lead">${esc(c.lead)}</p>
      <p class="cat-block__desc">${esc(c.description)}</p>
      <a class="more" href="${L(catUrl(c))}">「${esc(c.name)}」の記事をもっと見る${ICON.arrow}</a>
    </div>
    <div class="cat-block__list">${list.slice(0, 5).map((a, i) => card(a, L, i === 0 ? 'std' : 'row', 'h4')).join('\n')}</div>
  </section>`;
  }).join('\n')}
</div></section>`;
  }

  if (liveSeries.length) {
    h += `<section class="sec sec--series" aria-labelledby="series-title"><div class="wrap">
  ${sectionHead('Series', 'テーマを掘り下げる連載', L, { url: BASE + 'series/', label: 'すべての連載を見る' }).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="series-title">')}
  ${liveSeries.map((s) => `<section class="series-block" aria-labelledby="s-${s.slug}">
    <div class="series-block__hd"><h3 class="series-block__name" id="s-${s.slug}">${esc(s.name)}</h3><p>${esc(s.description)}</p><a class="more" href="${L(seriesUrl(s))}">この連載の記事一覧を見る${ICON.arrow}</a></div>
    <div class="grid grid--std">${bySeries(s).slice(0, 3).map((a) => card(a, L, 'std', 'h4')).join('\n')}</div>
  </section>`).join('\n')}
</div></section>`;
  }

  if (liveTags.length) {
    h += `<section class="sec sec--tint" aria-labelledby="tags-title"><div class="wrap">
  ${sectionHead('Tags', 'タグから探す', L).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="tags-title">')}
  <ul class="chips chips--lg">${liveTags.map(({ t, n }) => `<li><a href="${L(tagUrl(t))}">#${esc(t.name)}<span>${n}</span></a></li>`).join('')}</ul>
</div></section>`;
  }

  const ld = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: abs(BASE) || undefined, inLanguage: 'ja', publisher: { '@type': 'Organization', name: site.publisher } }];
  write(url, layout({ url, main: h, bodyClass: 'page-top', ld, ogImage: site.ogImage }));
}

function pageArticle(a) {
  const url = a.url; const L = (u) => link(u, url);
  const cr = [{ name: site.mainSite.label.replace('公式サイト', ''), url: site.mainSite.url }, { name: 'メディア', url: BASE }, { name: a.cat.name, url: catUrl(a.cat) }, { name: a.shortTitle, url }];
  const body = a.html.replace(/(href|src)="(\/[^"]*)"/g, (m, attr, u) => `${attr}="${L(u)}"`);
  const toc = a.toc.length > 2 ? `<nav class="toc" aria-labelledby="toc-${a.slug}"><details open><summary id="toc-${a.slug}">目次</summary><ol>${a.toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></details></nav>` : '';
  let seriesBox = '';
  if (a.series) {
    const list = bySeries(a.series);
    const idx = list.indexOf(a);
    seriesBox = `<aside class="series-box" aria-labelledby="sb-${a.slug}">
      <p class="stamp">Series</p>
      <h2 class="series-box__title" id="sb-${a.slug}">連載「<a href="${L(seriesUrl(a.series))}">${esc(a.series.name)}</a>」</h2>
      <ol class="series-box__list">${list.map((x, i) => x === a ? `<li aria-current="page"><span class="series-box__no">${i + 1}</span><span>${esc(x.shortTitle)}<em>この記事</em></span></li>` : `<li><span class="series-box__no">${i + 1}</span><a href="${L(x.url)}">${esc(x.shortTitle)}</a></li>`).join('')}</ol>
      ${idx > -1 && list[idx + 1] ? `<a class="more" href="${L(list[idx + 1].url)}">次の記事：${esc(list[idx + 1].shortTitle)}${ICON.arrow}</a>` : ''}
    </aside>`;
  }
  // related: shared series/tags/category score
  const related = all.filter((x) => x !== a).map((x) => ({ x, s: (x.series && x.series === a.series ? 3 : 0) + x.tags.filter((t) => a.tags.includes(t)).length + (x.cat === a.cat ? 1 : 0) }))
    .filter((r) => r.s > 0).sort((p, q) => q.s - p.s || q.x.date.localeCompare(p.x.date)).slice(0, 4).map((r) => r.x);
  const main = `<div class="wrap wrap--article">
  ${crumbs(cr, L)}
  <article class="art${toc ? ' art--toc' : ''}">
    <header class="art-hd">
      <div class="art-hd__top">${`<a class="chip-cat" style="--c:${esc(a.cat.color)}" href="${L(catUrl(a.cat))}">${esc(a.cat.name)}</a>`}${a.series ? `<a class="art-hd__series" href="${L(seriesUrl(a.series))}">連載「${esc(a.series.name)}」</a>` : ''}</div>
      <h1 class="art-hd__title">${esc(a.main)}${a.sub ? `<span class="art-hd__sub">${esc(a.sub)}</span>` : ''}</h1>
      <p class="art-hd__desc">${esc(a.description)}</p>
      <dl class="art-hd__meta">
        <div><dt>執筆</dt><dd><a href="${L(BASE + 'about/')}">${esc(a.author)}</a></dd></div>
        <div><dt>公開</dt><dd><time datetime="${a.date}">${dot(a.date)}</time></dd></div>
        ${a.updated !== a.date ? `<div><dt>更新</dt><dd><time datetime="${a.updated}">${dot(a.updated)}</time></dd></div>` : ''}
        <div><dt>読了目安</dt><dd>約${a.readMin}分</dd></div>
      </dl>
      ${tagList(a.tags, L, 99)}
    </header>
    <figure class="art-cover"><img src="${L(coverUrl(a))}" alt="" width="1200" height="675">${a.coverCredit ? `<figcaption>${a.coverCredit.startsWith('http') ? `<a href="${esc(a.coverCredit)}" target="_blank" rel="noopener">写真：Unsplash</a>` : esc(a.coverCredit)}</figcaption>` : ''}</figure>
    <div class="art-grid">
      ${toc}
      <div class="prose">
${body}
      </div>
    </div>
    <footer class="art-ft">
      ${seriesBox}
      <div class="author-box">
        <span class="brand__mark" aria-hidden="true">NU</span>
        <div><p class="author-box__name">${esc(a.author)}</p><p>八王子の買取店ナニウルの編集部です。価格や制度の説明では、公表元・出典を示しています。<a href="${L(BASE + 'about/')}">編集方針を見る</a></p></div>
      </div>
    </footer>
  </article>
</div>
${related.length ? `<section class="sec sec--tint" aria-labelledby="rel-title"><div class="wrap">${sectionHead('Related', 'あわせて読みたい', L).replace('<h2 class="sec-head__title">', '<h2 class="sec-head__title" id="rel-title">')}${grid(related, L)}</div></section>` : ''}`;
  const ld = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.description,
    datePublished: a.date, dateModified: a.updated, inLanguage: 'ja',
    author: { '@type': 'Organization', name: a.author }, publisher: { '@type': 'Organization', name: site.publisher },
    ...(site.siteUrl ? { mainEntityOfPage: abs(url) } : {}),
    ...(a.ogImage && (a.ogImage.startsWith('http') || site.siteUrl) ? { image: a.ogImage.startsWith('http') ? a.ogImage : abs(a.ogImage) } : {})
  }, crumbsLd(cr)];
  write(url, layout({ url, main, fullTitle: a.seoTitle, ogTitle: a.title, description: a.description, ogType: 'article', ld, active: a.cat.slug, ogImage: a.ogImage, bodyClass: 'page-article' }));
}

function paginate(baseUrl, list, render) {
  const per = site.perPage || 12;
  const n = Math.max(1, Math.ceil(list.length / per));
  for (let i = 1; i <= n; i++) {
    const url = i === 1 ? baseUrl : `${baseUrl}page/${i}/`;
    render(url, list.slice((i - 1) * per, i * per), { i, n, baseUrl });
  }
}
function pager(pg, L) {
  if (pg.n < 2) return '';
  const u = (i) => (i === 1 ? pg.baseUrl : `${pg.baseUrl}page/${i}/`);
  let h = '<nav class="pager" aria-label="ページ">';
  if (pg.i > 1) h += `<a href="${L(u(pg.i - 1))}" rel="prev">前へ</a>`;
  for (let i = 1; i <= pg.n; i++) h += i === pg.i ? `<span aria-current="page">${i}</span>` : `<a href="${L(u(i))}">${i}</a>`;
  if (pg.i < pg.n) h += `<a href="${L(u(pg.i + 1))}" rel="next">次へ</a>`;
  return h + '</nav>';
}
function listingPage({ baseUrl, list, en, title, lead, desc, color, active, crumbName, extra = '' }) {
  paginate(baseUrl, list, (url, slice, pg) => {
    const L = (u) => link(u, url);
    const cr = [{ name: 'メディア', url: BASE }, { name: crumbName || title, url: baseUrl }];
    const main = `<div class="wrap">${crumbs(cr, L)}</div>
<header class="list-hd"${color ? ` style="--c:${esc(color)}"` : ''}><div class="wrap">
  <p class="stamp">${esc(en)}</p>
  <h1 class="list-hd__title">${esc(title)}</h1>
  ${lead ? `<p class="list-hd__lead">${esc(lead)}</p>` : ''}
  ${desc ? `<p class="list-hd__desc">${esc(desc)}</p>` : ''}
  <p class="list-hd__count">${list.length}本の記事${pg.n > 1 ? `（${pg.i} / ${pg.n}ページ）` : ''}</p>
</div></header>
<section class="sec sec--list"><div class="wrap">${extra}${grid(slice, L)}${pager(pg, L)}</div></section>`;
    write(url, layout({ url, main, title: pg.i > 1 ? `${title}（${pg.i}ページ目）` : title, description: desc || lead || site.description, active, ld: [crumbsLd(cr)] }));
  });
}

function pageSeriesIndex() {
  const url = BASE + 'series/'; const L = (u) => link(u, url);
  const cr = [{ name: 'メディア', url: BASE }, { name: '連載', url }];
  const main = `<div class="wrap">${crumbs(cr, L)}</div>
<header class="list-hd"><div class="wrap"><p class="stamp">Series</p><h1 class="list-hd__title">連載</h1><p class="list-hd__lead">ひとつのテーマを、順番に読める連載です。</p></div></header>
<section class="sec sec--list"><div class="wrap">${liveSeries.map((s) => `<section class="series-block" aria-labelledby="s-${s.slug}">
  <div class="series-block__hd"><h2 class="series-block__name" id="s-${s.slug}">${esc(s.name)}</h2><p>${esc(s.description)}</p><a class="more" href="${L(seriesUrl(s))}">この連載の記事一覧を見る（${bySeries(s).length}本）${ICON.arrow}</a></div>
  <div class="grid grid--std">${bySeries(s).slice(0, 3).map((a) => card(a, L)).join('\n')}</div>
</section>`).join('\n')}</div></section>`;
  write(url, layout({ url, main, title: '連載', description: 'ナニウルメディアの連載一覧です。', active: 'series', ld: [crumbsLd(cr)] }));
}

function pageStatic(p) {
  const url = p.url; const L = (u) => link(u, url);
  const cr = [{ name: 'メディア', url: BASE }, { name: p.title, url }];
  const body = p.html.replace(/(href|src)="(\/[^"]*)"/g, (m, attr, u) => `${attr}="${L(u)}"`);
  const main = `<div class="wrap wrap--article">${crumbs(cr, L)}
<article class="art art--page"><header class="art-hd"><h1 class="art-hd__title">${esc(p.title)}</h1><p class="art-hd__desc">${esc(p.description)}</p>${p.updated ? `<dl class="art-hd__meta"><div><dt>更新</dt><dd><time datetime="${p.updated}">${dot(p.updated)}</time></dd></div></dl>` : ''}</header>
<div class="prose">${body}</div></article></div>`;
  write(url, layout({ url, main, title: p.title, description: p.description, ld: [crumbsLd(cr)] }));
}

function pageSearch() {
  const url = BASE + 'search/'; const L = (u) => link(u, url);
  const main = `<header class="list-hd"><div class="wrap"><p class="stamp">Search</p><h1 class="list-hd__title">記事を探す</h1>
<form class="search-form search-form--page" role="search" data-search-form data-search-page>
  <label class="sr" for="search-page-q">キーワード</label>
  <input id="search-page-q" name="q" type="search" placeholder="例：K18、宅配、本人確認" autocomplete="off" data-search-input>
  <button class="btn btn--cta" type="submit">検索</button>
</form></div></header>
<section class="sec sec--list"><div class="wrap"><p class="search-status" data-search-status aria-live="polite"></p><ul class="search-results search-results--page" data-search-results></ul></div></section>`;
  write(url, layout({ url, main, title: '記事を探す', noindex: true }));
}

function page404() {
  const url = BASE + '404.html'; const L = (u) => link(u, url);
  const main = `<header class="list-hd"><div class="wrap"><p class="stamp">404</p><h1 class="list-hd__title">ページが見つかりません</h1><p class="list-hd__lead">記事が移動したか、URLが変わった可能性があります。</p><p><a class="btn btn--cta" href="${L(BASE)}">メディアのトップへ</a></p></div></header>
<section class="sec"><div class="wrap">${sectionHead('Latest', '新着記事', L)}${grid(all.slice(0, 3), L)}</div></section>`;
  write(url, layout({ url, main, title: 'ページが見つかりません', noindex: true }));
}

function coverSvg(a) {
  const c = a.cat; const bg = c.color; const ink = c.ink;
  const label = a.coverLabel || c.en;
  const fs1 = Math.min(118, Math.floor(520 / Math.max(3, label.length * 0.6)));
  const rings = Array.from({ length: 16 }, (_, i) => `<ellipse cx="930" cy="338" rx="${70 + i * 30}" ry="${42 + i * 18}"/>`).join('');
  const sub = (a.items[0] && a.items[0].name) || c.name;
  const e = (s) => esc(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-label="${e(a.shortTitle)}">
<rect width="1200" height="675" fill="${bg}"/>
<g fill="none" stroke="${ink}" stroke-opacity=".14" stroke-width="2">${rings}</g>
<rect x="36" y="36" width="1128" height="603" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width="2"/>
<text x="72" y="96" fill="${ink}" font-family="'Overused Grotesk Variable','Helvetica Neue',Arial,sans-serif" font-size="26" letter-spacing="6" font-weight="600">NANIURU MEDIA</text>
<text x="72" y="600" fill="${ink}" fill-opacity=".85" font-family="'Overused Grotesk Variable','Helvetica Neue',Arial,sans-serif" font-size="24" letter-spacing="4">${e(c.en.toUpperCase())}</text>
<g transform="translate(560 350)">
<ellipse rx="380" ry="170" fill="${bg}" stroke="${ink}" stroke-width="7"/>
<ellipse rx="356" ry="146" fill="none" stroke="${ink}" stroke-width="2.5"/>
<text y="${Math.round(fs1 * 0.35)}" text-anchor="middle" fill="${ink}" font-family="'Overused Grotesk Variable','Helvetica Neue',Arial,sans-serif" font-weight="600" font-size="${fs1}" letter-spacing="2">${e(label)}</text>
<text y="-92" text-anchor="middle" fill="${ink}" fill-opacity=".8" font-family="'Yu Gothic','Hiragino Sans',sans-serif" font-size="26" letter-spacing="8">${e(sub)}</text>
</g>
</svg>`;
}

function searchIndex() {
  return JSON.stringify(all.map((a) => ({
    u: a.url.slice(BASE.length), t: a.title, d: a.description, c: a.cat.name, g: a.tags.map((t) => t.name), i: a.items.map((i) => i.name), dt: a.date,
    x: strip(a.html).slice(0, 4000)
  })));
}

function sitemap() {
  const urls = [...written].filter((u) => u.endsWith('/') && !u.includes('/search/') && !u.includes('/page/'));
  const lastmod = (u) => { const a = all.find((x) => x.url === u); if (a) return a.updated; const p = pages.find((x) => x.url === u); return (p && p.updated) || (all[0] && all[0].updated) || OPT.today; };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(abs(u))}</loc><lastmod>${lastmod(u)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}
function feed() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(site.name)}</title><link>${esc(abs(BASE))}</link><description>${esc(site.description)}</description><language>ja</language>\n${all.slice(0, 20).map((a) => `<item><title>${esc(a.title)}</title><link>${esc(abs(a.url))}</link><guid>${esc(abs(a.url))}</guid><pubDate>${new Date(a.date + 'T09:00:00+09:00').toUTCString()}</pubDate><description>${esc(a.description)}</description></item>`).join('\n')}\n</channel></rss>\n`;
}

// ---------- run ----------
const MARK = '.naniuru-media-build';
if (fs.existsSync(OPT.out)) {
  if (!fs.existsSync(path.join(OPT.out, MARK))) {
    console.error(`出力先 ${OPT.out} はこのビルドが作ったフォルダではないため、上書きしません。--out で別の場所を指定してください。`);
    process.exit(1);
  }
  fs.rmSync(OPT.out, { recursive: true, force: true });
}
fs.mkdirSync(OPT.out, { recursive: true });
fs.writeFileSync(path.join(OPT.out, MARK), 'このフォルダは naniuru-media/build.js が生成します。直接編集しないでください。\n');

copyDir(path.join(ROOT, 'assets'), path.join(OPT.out, 'assets'));
copyDir(path.join(CONTENT, 'images'), path.join(OPT.out, 'images'));
ASSET_V = hash(fs.readFileSync(path.join(ROOT, 'assets/media.css'), 'utf8') + fs.readFileSync(path.join(ROOT, 'assets/media.js'), 'utf8'));
fs.mkdirSync(path.join(OPT.out, 'assets/covers'), { recursive: true });
for (const a of all) if (!a.cover) fs.writeFileSync(path.join(OPT.out, 'assets/covers', a.slug + '.svg'), coverSvg(a));

pageTop();
for (const a of all) pageArticle(a);
listingPage({ baseUrl: BASE + 'articles/', list: all, en: 'All Articles', title: '記事一覧', lead: '新しい順に、すべての記事を掲載しています。', active: 'articles' });
for (const c of liveCats) listingPage({ baseUrl: catUrl(c), list: byCat(c), en: c.en, title: c.name, lead: c.lead, desc: c.description, color: c.color, active: c.slug });
for (const i of site.items) { const l = byItem(i); if (l.length) listingPage({ baseUrl: itemUrl(i), list: l, en: 'Item / ' + i.mark, title: i.name, lead: `${i.name}の買取に関する記事です。`, crumbName: i.name }); }
for (const { t } of liveTags) listingPage({ baseUrl: tagUrl(t), list: byTag(t), en: 'Tag', title: '#' + t.name, lead: `「${t.name}」に関する記事です。`, crumbName: '#' + t.name });
if (liveSeries.length) {
  pageSeriesIndex();
  for (const s of liveSeries) listingPage({ baseUrl: seriesUrl(s), list: bySeries(s), en: 'Series', title: s.name, lead: s.description, active: 'series', crumbName: s.name });
}
for (const p of pages) pageStatic(p);
pageSearch();
page404();
fs.writeFileSync(path.join(OPT.out, 'search-index.json'), searchIndex());
if (site.siteUrl) {
  fs.writeFileSync(path.join(OPT.out, 'sitemap.xml'), sitemap());
  fs.writeFileSync(path.join(OPT.out, 'feed.xml'), feed());
} else warn('site.json の siteUrl が空のため、canonical・sitemap.xml・feed.xml を出力していません（ドメイン確定後に記入）。');

// admin
copyDir(path.join(ROOT, 'admin'), path.join(OPT.out, 'admin'));
fs.copyFileSync(path.join(ROOT, 'lib/frontmatter.js'), path.join(OPT.out, 'admin/frontmatter.js'));
fs.writeFileSync(path.join(OPT.out, 'admin/site.json'), JSON.stringify(site, null, 2));

// ---------- checks ----------
const k = site.kobutsu || {};
if (!(k.commission && k.number && k.holder)) warn('古物商許可の表示（site.json の kobutsu）が未記入です。ホームページでの取引には表示義務があります。');
for (const a of all) {
  for (const m of a.html.matchAll(/href="(\/media\/[^"#]*)/g)) {
    let u = m[1]; if (!u.endsWith('/') && !/\.\w+$/.test(u)) u += '/';
    if (!written.has(u)) warn(`${a.file}: リンク先 ${u} のページがありません（未公開の記事かURLの誤り）。`);
  }
}
const external = new Set([site.cta.primary.url, ...all.flatMap((a) => [...a.html.matchAll(/href="(\/(?!media\/)[^"]*)"/g)].map((m) => m[1]))].filter((u) => u && u !== '/' && !u.startsWith(BASE)));

const uniq = [...new Set(warnings)];
console.log(`\n✓ ${all.length}本の記事、${written.size}ページを ${path.relative(process.cwd(), OPT.out) || '.'} に出力しました（今日＝${OPT.today}${OPT.relative ? '、相対リンク' : ''}${OPT.drafts ? '、下書き含む' : ''}）。`);
if (external.size) console.log(`\n既存サイト側にあるべきリンク先: ${[...external].join('  ')}`);
if (uniq.length) { console.log(`\n確認事項（${uniq.length}件）:`); uniq.forEach((w) => console.log('  ! ' + w)); }
if (OPT.strict && uniq.length) { console.error('\n--strict: 確認事項があるためビルドを失敗にしました。'); process.exit(1); }
