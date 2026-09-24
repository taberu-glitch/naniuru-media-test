/*
 * ナニウルメディア — 記事ファイルの front matter 読み書き
 * ビルド（Node）と管理画面（ブラウザ）の両方で使う。
 *
 * 形式:
 *   ---
 *   title: 記事タイトル
 *   tags: [金, 相場, "カンマ, を含む値"]
 *   featured: true
 *   ---
 *   <h2>本文（HTML）</h2>
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrontMatter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function unquote(v) {
    v = v.trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
      try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); }
    }
    if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }

  function parseArray(inner) {
    var out = [], cur = '', q = null;
    for (var i = 0; i < inner.length; i++) {
      var c = inner[i];
      if (q) {
        cur += c;
        if (c === '\\' && q === '"') { cur += inner[++i] || ''; continue; }
        if (c === q) q = null;
      } else if (c === '"' || c === "'") { q = c; cur += c; }
      else if (c === ',') { if (cur.trim() !== '') out.push(unquote(cur)); cur = ''; }
      else cur += c;
    }
    if (cur.trim() !== '') out.push(unquote(cur));
    return out;
  }

  function parseValue(raw) {
    var v = raw.trim();
    if (v === '') return '';
    if (v[0] === '[' && v[v.length - 1] === ']') return parseArray(v.slice(1, -1));
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v) && v.length < 10) return Number(v);
    return unquote(v);
  }

  function parse(text) {
    text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    var data = {};
    if (text.slice(0, 4) !== '---\n') return { data: data, body: text };
    var end = text.indexOf('\n---', 3);
    if (end === -1) return { data: data, body: text };
    var head = text.slice(4, end);
    var after = text.indexOf('\n', end + 4);
    var body = after === -1 ? '' : text.slice(after + 1);
    head.split('\n').forEach(function (line) {
      if (!line.trim() || /^\s*#/.test(line)) return;
      var i = line.indexOf(':');
      if (i === -1) return;
      var key = line.slice(0, i).trim();
      if (!/^[A-Za-z_][\w-]*$/.test(key)) return;
      data[key] = parseValue(line.slice(i + 1));
    });
    return { data: data, body: body.replace(/^\n+/, '') };
  }

  function needsQuote(s) {
    return s === '' || /^[\s"'\[\]{}#&*!|>%@`-]/.test(s) || /\s$/.test(s) ||
      /^(true|false|null|-?\d+)$/.test(s) || /[,\]]/.test(s) || /\n/.test(s);
  }
  function fmt(v, inArray) {
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    v = String(v == null ? '' : v);
    if (inArray ? needsQuote(v) : (v === '' ? false : needsQuote(v.replace(/[,\]]/g, 'x')))) return JSON.stringify(v);
    return v;
  }

  var ORDER = ['title', 'shortTitle', 'seoTitle', 'description', 'url', 'date', 'updated',
    'category', 'items', 'tags', 'series', 'seriesOrder', 'featured', 'author',
    'cover', 'coverCredit', 'coverLabel', 'ogImage', 'draft'];

  function stringify(data, body) {
    var keys = Object.keys(data).filter(function (k) { return data[k] !== undefined && data[k] !== null; });
    keys.sort(function (a, b) {
      var ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    var lines = keys.map(function (k) {
      var v = data[k];
      if (Array.isArray(v)) return k + ': [' + v.map(function (x) { return fmt(x, true); }).join(', ') + ']';
      return k + ': ' + fmt(v, false);
    });
    return '---\n' + lines.join('\n') + '\n---\n\n' + String(body || '').replace(/^\n+/, '');
  }

  return { parse: parse, stringify: stringify };
});
