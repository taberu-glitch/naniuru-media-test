/* ナニウルメディア 記事エディタ
 * 記事ファイル（content/articles/*.html）を GitHub API で読み書きする。
 * 保存 → GitHub Actions がビルド → サイトに反映。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'naniuru-media-admin';
  var SITE = null;
  var state = { files: [], current: null /* {path, sha, data} */ };

  // ---------- settings (this browser only) ----------
  function loadCfg() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveCfg(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  var cfg = loadCfg();
  function ready() { return cfg.repo && cfg.token; }
  function dir() { return (cfg.dir || 'naniuru-media/content').replace(/\/$/, ''); }
  function branch() { return cfg.branch || 'main'; }

  // ---------- GitHub API ----------
  function gh(method, path, body) {
    return fetch('https://api.github.com/repos/' + cfg.repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + (method === 'GET' ? '?ref=' + encodeURIComponent(branch()) : ''), {
      method: method,
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 404 && method === 'GET') return null;
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
        var m = r.status === 401 ? 'トークンが無効です。接続設定を確認してください。'
          : r.status === 403 ? 'このトークンには書き込み権限がありません（Contents: Read and write が必要）。'
          : r.status === 409 || r.status === 422 ? 'ほかの人がこの記事を先に更新しました。再読み込みしてから編集し直してください。'
          : (j.message || ('GitHub API エラー ' + r.status));
        throw new Error(m);
      });
      return r.json();
    });
  }
  var b64enc = function (s) { return btoa(unescape(encodeURIComponent(s))); };
  var b64dec = function (s) { return decodeURIComponent(escape(atob(s.replace(/\n/g, '')))); };

  // ---------- messages ----------
  function msg(text, kind) { var m = $('msg'); m.textContent = text || ''; m.className = 'ad-msg' + (kind ? ' is-' + kind : ''); }
  function setConn() {
    var c = $('conn');
    if (ready()) { c.textContent = cfg.repo + '（' + branch() + '）'; c.classList.add('is-ok'); }
    else { c.textContent = '未接続'; c.classList.remove('is-ok'); }
  }

  // ---------- taxonomy ----------
  function fillTaxonomy() {
    $('f-category').innerHTML = SITE.categories.map(function (c) { return '<option value="' + c.slug + '">' + c.name + '</option>'; }).join('');
    $('f-series').innerHTML = '<option value="">（なし）</option>' + SITE.series.map(function (s) { return '<option value="' + s.slug + '">' + s.name + '</option>'; }).join('');
    $('f-items').innerHTML = SITE.items.map(function (i) { return '<label><input type="checkbox" value="' + i.slug + '"> ' + i.name + '</label>'; }).join('');
    $('tag-list').innerHTML = SITE.tags.map(function (t) { return '<option value="' + t.name + '">'; }).join('');
    $('tag-hint').textContent = '登録済み：' + SITE.tags.map(function (t) { return t.name; }).join('、');
  }

  // ---------- form <-> data ----------
  var FIELDS = ['title', 'shortTitle', 'description', 'url', 'date', 'updated', 'category', 'series', 'seriesOrder', 'coverLabel', 'cover', 'seoTitle'];
  function today() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function toForm(data, body, slug) {
    FIELDS.forEach(function (k) { $('f-' + k).value = data[k] == null ? '' : data[k]; });
    $('f-slug').value = slug || '';
    $('f-draft').checked = data.draft === true;
    $('f-featured').checked = data.featured === true;
    $('f-tags').value = (data.tags || []).join(', ');
    Array.prototype.forEach.call($('f-items').querySelectorAll('input'), function (i) { i.checked = (data.items || []).indexOf(i.value) > -1; });
    $('f-body').value = body || '';
    updateCount(); renderPreview(); $('issues').innerHTML = '';
  }
  function fromForm() {
    var base = state.current ? JSON.parse(JSON.stringify(state.current.data)) : {};
    FIELDS.forEach(function (k) { var v = $('f-' + k).value.trim(); if (v === '') delete base[k]; else base[k] = v; });
    if (base.seriesOrder) base.seriesOrder = Number(base.seriesOrder);
    base.items = Array.prototype.filter.call($('f-items').querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
    base.tags = $('f-tags').value.split(/[,、，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    base.featured = $('f-featured').checked;
    base.draft = $('f-draft').checked;
    if (!base.author) base.author = SITE.defaultAuthor;
    return { data: base, body: $('f-body').value.replace(/\s+$/, '') + '\n', slug: $('f-slug').value.trim() };
  }

  function validate(d) {
    var issues = [], data = d.data;
    if (!data.title) issues.push('タイトルを入力してください。');
    if (!/^[a-z0-9-]+$/.test(d.slug)) issues.push('ファイル名は半角英小文字・数字・ハイフンで入力してください。');
    if (!data.description) issues.push('説明文を入力してください。');
    if (!data.url || !/^\/media\/.+\/$/.test(data.url)) issues.push('公開URLは /media/ で始まり / で終わる形にしてください（例：/media/guide/xxx/）。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) issues.push('公開日を入力してください。');
    if (!data.category) issues.push('カテゴリーを選んでください。');
    if (!d.body.trim()) issues.push('本文が空です。');
    // URL の重複
    state.files.forEach(function (f) { if (f.data && f.data.url === data.url && (!state.current || f.path !== state.current.path)) issues.push('公開URLが「' + f.data.title + '」と重複しています。'); });
    return issues;
  }
  function advisories(d) {
    var w = [], txt = d.body.replace(/<[^>]+>/g, '');
    var len = (d.data.description || '').length;
    if (len && (len < 60 || len > 140)) w.push('説明文は80〜120文字が目安です（現在' + len + '文字）。');
    [['最高値', '根拠を示せない最上級表現'], ['業界No.1', '根拠を示せない最上級表現'], ['どこよりも高', '根拠を示せない最上級表現'], ['無料査定', '「無料」は確認できるまで使わない方針'], ['高価買取', '広告的な表現']].forEach(function (p) {
      if (txt.indexOf(p[0]) > -1 || (d.data.title || '').indexOf(p[0]) > -1) w.push('「' + p[0] + '」が含まれています（' + p[1] + '）。');
    });
    if (/\d[\d,]*円\s*\/\s*g|1gあたり[\d,]+円/.test(txt) && !/仮の値/.test(txt)) w.push('1gあたりの価格が本文に固定で書かれていないか確認してください（相場は公表元へ誘導する方針）。');
    var unknown = d.data.tags.filter(function (t) { return !SITE.tags.some(function (x) { return x.name === t; }); });
    if (unknown.length) w.push('未登録のタグ：' + unknown.join('、') + '（使えますが、URLは自動の英数字になります。site.json の tags に登録するとURLを指定できます）。');
    return w;
  }

  // ---------- list ----------
  function statusOf(data) {
    if (!data) return '';
    if (data.draft === true) return '<span class="ad-badge">下書き</span>';
    if (data.date > today()) return '<span class="ad-badge">予約 ' + data.date + '</span>';
    return '';
  }
  function renderList() {
    var ul = $('list');
    if (!ready()) { ul.innerHTML = '<li class="ad-empty">接続設定をすると、リポジトリの記事が表示されます。</li>'; return; }
    if (!state.files.length) { ul.innerHTML = '<li class="ad-empty">記事がありません。</li>'; return; }
    var files = state.files.slice().sort(function (a, b) { return ((b.data && b.data.date) || '').localeCompare((a.data && a.data.date) || ''); });
    ul.innerHTML = files.map(function (f) {
      var cur = state.current && state.current.path === f.path ? ' aria-current="true"' : '';
      return '<li><button type="button" data-path="' + f.path + '"' + cur + '><span>' + statusOf(f.data) + esc(f.data ? f.data.shortTitle || f.data.title : f.name) + '</span><small>' + esc(f.name) + '・' + ((f.data && f.data.date) || '') + '</small></button></li>';
    }).join('');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function loadList() {
    if (!ready()) { renderList(); return Promise.resolve(); }
    msg('記事を読み込んでいます…');
    return gh('GET', dir() + '/articles').then(function (list) {
      list = (list || []).filter(function (f) { return f.type === 'file' && /\.html?$/.test(f.name); });
      return Promise.all(list.map(function (f) {
        return gh('GET', f.path).then(function (full) {
          var text = b64dec(full.content), p = FrontMatter.parse(text);
          return { name: f.name, path: f.path, sha: full.sha, data: p.data, body: p.body };
        });
      }));
    }).then(function (files) { state.files = files; renderList(); msg(''); })
      .catch(function (e) { msg(e.message, 'err'); });
  }

  function openFile(path) {
    var f = state.files.filter(function (x) { return x.path === path; })[0];
    if (!f) return;
    state.current = { path: f.path, sha: f.sha, data: f.data };
    $('filename').textContent = f.path;
    $('danger').hidden = false; $('confirm-del').hidden = true;
    toForm(f.data, f.body, f.name.replace(/\.html?$/, ''));
    renderList(); msg('');
    window.scrollTo(0, 0);
  }
  function newArticle() {
    state.current = null;
    $('filename').textContent = '新しい記事';
    $('danger').hidden = true;
    toForm({ date: today(), updated: today(), category: SITE.categories[0].slug, draft: true, author: SITE.defaultAuthor }, '<h2>結論：</h2>\n<p></p>\n', '');
    renderList(); msg('新しい記事です。最初は「下書き」になっています。公開するときはチェックを外してください。');
    $('f-title').focus();
  }

  // ---------- save / delete / download ----------
  function save(e) {
    e.preventDefault();
    var d = fromForm();
    var issues = validate(d), adv = advisories(d);
    $('issues').innerHTML = issues.concat(adv).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    if (issues.length) { msg('入力内容を確認してください。', 'err'); return; }
    if (!ready()) { msg('GitHubに接続していません。「接続設定」をするか、「ファイルに書き出す」で保存してください。', 'err'); return; }
    var text = FrontMatter.stringify(d.data, d.body);
    var path = dir() + '/articles/' + d.slug + '.html';
    var renamed = state.current && state.current.path !== path;
    if (!state.current && state.files.some(function (f) { return f.path === path; })) { msg('同じファイル名の記事がすでにあります。ファイル名を変えてください。', 'err'); return; }
    $('btn-save').disabled = true; msg('保存しています…');
    var body = { message: (state.current ? '記事を更新: ' : '記事を追加: ') + d.data.title, content: b64enc(text), branch: branch() };
    if (state.current && !renamed) body.sha = state.current.sha;
    gh('PUT', path, body).then(function (res) {
      if (renamed) return gh('DELETE', state.current.path, { message: 'ファイル名を変更: ' + state.current.path + ' → ' + path, sha: state.current.sha, branch: branch() }).then(function () { return res; });
      return res;
    }).then(function (res) {
      return loadList().then(function () {
        openFile(res.content.path);
        var when = d.data.draft ? '下書きとして保存しました（サイトには表示されません）。'
          : d.data.date > today() ? '保存しました。' + d.data.date + ' に自動で公開されます。'
          : '保存しました。数分後にサイトへ反映されます。';
        msg(when, 'ok');
        $('issues').innerHTML = adv.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      });
    }).catch(function (err) { msg(err.message, 'err'); })
      .then(function () { $('btn-save').disabled = false; });
  }
  function del() {
    if (!state.current) return;
    msg('削除しています…');
    gh('DELETE', state.current.path, { message: '記事を削除: ' + (state.current.data.title || state.current.path), sha: state.current.sha, branch: branch() })
      .then(function () { state.current = null; return loadList(); })
      .then(function () { newArticle(); msg('削除しました。数分後にサイトから消えます。', 'ok'); })
      .catch(function (e) { msg(e.message, 'err'); });
  }
  function download() {
    var d = fromForm();
    if (!d.slug) { msg('ファイル名を入力してください。', 'err'); return; }
    var blob = new Blob([FrontMatter.stringify(d.data, d.body)], { type: 'text/html' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = d.slug + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    msg(d.slug + '.html を書き出しました。content/articles/ に置くと記事になります。', 'ok');
  }

  // ---------- body tools ----------
  var SNIP = {
    h2: '<h2>見出し</h2>\n', h3: '<h3>小見出し</h3>\n', p: '<p>本文</p>\n',
    strong: function (sel) { return '<strong>' + (sel || '強調する語句') + '</strong>'; },
    a: function (sel) { return '<a href="/media/">' + (sel || 'リンクの文字') + '</a>'; },
    ul: '<ul>\n  <li>項目</li>\n  <li>項目</li>\n</ul>\n',
    ol: '<ol>\n  <li>手順</li>\n  <li>手順</li>\n</ol>\n',
    checklist: '<ul class="checklist">\n  <li>確認すること</li>\n  <li>確認すること</li>\n</ul>\n',
    table: '<table>\n  <thead>\n    <tr><th scope="col">項目</th><th scope="col">内容</th></tr>\n  </thead>\n  <tbody>\n    <tr><td></td><td></td></tr>\n    <tr><td></td><td></td></tr>\n  </tbody>\n</table>\n',
    formula: '<p class="formula"><strong>計算式</strong></p>\n',
    faq: '<h3>Q. 質問</h3>\n<p>回答</p>\n',
    cta: '<p class="cta"><a class="cta-button" href="/kaitori/">LINEで査定を依頼する</a></p>\n'
  };
  function insert(text) {
    var ta = $('f-body'), s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end'); ta.focus(); renderPreview();
  }
  document.querySelector('.ad-tools').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ins]'); if (!b) return;
    var sn = SNIP[b.getAttribute('data-ins')], ta = $('f-body');
    insert(typeof sn === 'function' ? sn(ta.value.slice(ta.selectionStart, ta.selectionEnd)) : sn);
  });
  $('img-file').addEventListener('change', function () {
    var file = this.files[0]; this.value = '';
    if (!file) return;
    if (!ready()) { msg('画像のアップロードにはGitHubの接続が必要です。', 'err'); return; }
    if (file.size > 2 * 1024 * 1024) { msg('画像は2MB以下にしてください（横1600px程度に縮小がおすすめです）。', 'err'); return; }
    var name = file.name.toLowerCase().replace(/[^a-z0-9.\-_]/g, '-');
    var r = new FileReader();
    r.onload = function () {
      msg('画像をアップロードしています…');
      gh('PUT', dir() + '/images/' + name, { message: '画像を追加: ' + name, content: String(r.result).split(',')[1], branch: branch() })
        .then(function () { insert('<figure><img src="/media/images/' + name + '" alt="画像の説明" loading="lazy"><figcaption>キャプション</figcaption></figure>\n'); msg('画像を追加しました。alt（画像の説明）を書き換えてください。', 'ok'); })
        .catch(function (e) { msg(e.message, 'err'); });
    };
    r.readAsDataURL(file);
  });

  // ---------- preview ----------
  var pv;
  function renderPreview() {
    clearTimeout(pv);
    pv = setTimeout(function () {
      var tpl = document.createElement('template');
      tpl.innerHTML = $('f-body').value;
      tpl.content.querySelectorAll('script, iframe, object, embed').forEach(function (n) { n.remove(); });
      tpl.content.querySelectorAll('*').forEach(function (n) {
        Array.prototype.slice.call(n.attributes).forEach(function (a) { if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name); });
        if (n.tagName === 'IMG' && /^\/media\//.test(n.getAttribute('src') || '')) n.setAttribute('src', '../' + n.getAttribute('src').slice(7));
      });
      var out = $('preview'); out.innerHTML = ''; out.appendChild(tpl.content);
    }, 150);
  }
  function updateCount() { $('desc-count').textContent = $('f-description').value.length; }

  // ---------- events ----------
  $('form').addEventListener('submit', save);
  $('f-body').addEventListener('input', renderPreview);
  $('f-description').addEventListener('input', updateCount);
  $('f-title').addEventListener('input', function () {
    if (!state.current && !$('f-shortTitle').dataset.touched) $('f-shortTitle').value = this.value.split('｜')[0];
  });
  $('f-shortTitle').addEventListener('input', function () { this.dataset.touched = '1'; });
  $('f-slug').addEventListener('input', function () {
    if (state.current) return;
    var cat = SITE.categories.filter(function (c) { return c.slug === $('f-category').value; })[0] || {}, v = this.value.trim();
    if (v) $('f-url').value = '/media/' + (cat.urlPrefix || '') + v + '/';
  });
  $('list').addEventListener('click', function (e) { var b = e.target.closest('[data-path]'); if (b) openFile(b.getAttribute('data-path')); });
  $('btn-new').addEventListener('click', newArticle);
  $('btn-reload').addEventListener('click', loadList);
  $('btn-download').addEventListener('click', download);
  $('btn-delete').addEventListener('click', function () { $('confirm-del').hidden = false; });
  $('btn-delete-no').addEventListener('click', function () { $('confirm-del').hidden = true; });
  $('btn-delete-yes').addEventListener('click', del);
  $('open-file').addEventListener('change', function () {
    var file = this.files[0]; this.value = ''; if (!file) return;
    file.text().then(function (t) {
      var p = FrontMatter.parse(t); state.current = null;
      $('filename').textContent = file.name + '（ファイルから）'; $('danger').hidden = true;
      toForm(p.data, p.body, file.name.replace(/\.html?$/, ''));
      msg('ファイルを開きました。「保存して公開」でリポジトリに追加されます。');
    });
  });
  $('btn-settings').addEventListener('click', function () {
    $('s-repo').value = cfg.repo || ''; $('s-branch').value = cfg.branch || ''; $('s-dir').value = cfg.dir || ''; $('s-token').value = cfg.token || '';
    $('settings').showModal();
  });
  $('settings-form').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value !== 'save') return;
    cfg = { repo: $('s-repo').value.trim(), branch: $('s-branch').value.trim(), dir: $('s-dir').value.trim(), token: $('s-token').value.trim() };
    saveCfg(cfg); setConn(); loadList();
  });

  // ---------- boot ----------
  fetch('site.json').then(function (r) { return r.json(); }).then(function (s) {
    SITE = s;
    if (!cfg.repo && s.admin) cfg = Object.assign({}, s.admin, cfg);
    fillTaxonomy(); setConn(); newArticle(); msg('');
    if (ready()) loadList(); else $('btn-settings').click();
  }).catch(function () { msg('site.json を読み込めませんでした。ビルドされた /media/admin/ から開いてください。', 'err'); });
})();
