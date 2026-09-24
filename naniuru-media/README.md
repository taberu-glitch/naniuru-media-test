# ナニウルメディア

ナニウル公式サイトの `/media/` に置くオウンドメディアです。
記事は `content/articles/` のファイル1本＝1記事。ファイルを追加・編集すると、GitHub Actions が `/media/` 以下のページを作り直します。

```
リポジトリ
├─ .github/workflows/naniuru-media.yml   自動ビルド（更新時＋毎日0:05）
├─ naniuru-media/                        ← ここを編集する
│   ├─ content/
│   │   ├─ site.json          サイト設定（カテゴリー・品目・連載・タグ・CTA・古物商表示）
│   │   ├─ articles/*.html    記事
│   │   ├─ pages/about.html   「ナニウルメディアについて」
│   │   └─ images/            記事の画像（/media/images/ で公開）
│   ├─ assets/                デザイン（media.css / media.js）
│   ├─ admin/                 記事エディタ（/media/admin/ で公開）
│   ├─ lib/frontmatter.js
│   └─ build.js               ビルド
└─ media/                     ← 自動生成。直接編集しない
```

## 最初の設定（公開前に必ず）

`naniuru-media/content/site.json` を開いて、次を記入します。

| 項目 | 内容 |
| --- | --- |
| `kobutsu.commission` / `number` / `holder` | 古物商許可の公安委員会名・許可番号・氏名または名称。全ページのフッターに出ます（ホームページで取引する古物商には表示義務あり）。未記入の間はフッターに記入を促す表示が出ます。 |
| `siteUrl` | 例：`https://naniuru.jp`（末尾の / なし）。入れると canonical・sitemap.xml・feed.xml が出力されます。 |
| `cta.primary.url` | 「LINEで査定」ボタンのリンク先。今は `/kaitori/`。 |
| `cta.secondary` / `footerLinks` | URLが空の項目は表示されません。来店予約・運営会社・プライバシーポリシー等のURLが決まったら入れてください。 |
| `ogImage` | SNSでシェアされたときの画像（1200×630のJPG/PNG）。 |
| `admin.repo` | エディタの初期値。例：`naniuru/website`。 |

`outDir`（初期値 `../media`）は「リポジトリ直下の `media/` フォルダがそのまま `https://ドメイン/media/` で公開される」前提です。公開フォルダが `public/` などの場合は `../public/media` に変えてください。

記事の本文中にある `/kaitori/` と `/kaitori/gold/` は既存サイト側のページです。存在しない場合は記事側のリンクを差し替えてください（ビルド時に一覧が表示されます）。

`/media/admin/` は検索エンジンに出ないよう noindex にしてありますが、既存サイトの robots.txt にも `Disallow: /media/admin/` を追加してください。

## 記事を追加・更新する方法

### A. ブラウザのエディタから（おすすめ）

1. `https://ドメイン/media/admin/` を開く
2. 初回だけ「接続設定」でリポジトリ名とアクセストークンを入れる
   - GitHub → Settings → Developer settings → Fine-grained tokens で作成
   - Repository access：このリポジトリのみ ／ Permissions：Contents を Read and write
   - トークンはそのブラウザにだけ保存されます
3. 「＋ 新しい記事」または左の一覧から記事を選んで編集
4. 「保存して公開」→ 数分後にサイトへ反映

- **下書き**にチェック → 保存しても公開されません
- **公開日を未来の日付**にする → その日の0:05に自動で公開されます（予約投稿）
- 内容を直したら**更新日**を今日にしてください。記事の冒頭に「更新」として表示されます
- 保存時に、説明文の長さ、「最高値」「無料査定」などブランドルールで使わない表現、未登録のタグを警告します
- 接続していなくても「ファイルに書き出す」で記事ファイルを作れます

### B. ファイルを直接置く

`content/articles/記事名.html` を作ってコミットします。形式：

```html
---
title: 見出し｜副題（「｜」の前が見出し、後ろが副題）
shortTitle: パンくず・連載一覧で使う短い名前
description: 検索結果に出る説明文（80〜120文字目安）
url: /media/guide/kaitori-erabikata/
date: 2026-09-24
updated: 2026-09-24
category: guide            # site.json の categories の slug
items: [kikinzoku]         # site.json の items の slug（複数可）
tags: [本人確認, 宅配買取]  # site.json の tags の name
series: hajimete           # 任意。site.json の series の slug
seriesOrder: 1
featured: true             # 編集部のおすすめに表示
coverLabel: CHECK 6        # カバー画像に入る刻印文字
draft: false
---

<h2>結論：…</h2>
<p>…</p>
```

本文はHTMLです。使えるクラス：`ul.checklist`（チェックリスト）、`p.formula`（計算式の枠）、`p.cta > a.cta-button`（査定ボタン）。`<table>` は自動で横スクロール対応になり、`<h2>` から目次が自動で作られます。

### カテゴリー・品目・連載・タグを増やす

`site.json` に追記するだけです。記事が1本もないカテゴリー・連載・品目のページは作られず、ナビにも出ません（トップの「品目から探す」では「準備中」と表示）。

- **人気記事ランキング**：`ranking` に記事のファイル名（拡張子なし）を順に並べると、トップに「よく読まれている記事」が出ます。アクセス数の裏付けがあるときだけ使ってください。
- **編集部のおすすめ**：`editorPicks` にファイル名を並べると、その順で表示。空なら `featured: true` の記事を新しい順に表示。

## 手元で確認する

```bash
cd naniuru-media
node build.js --out /tmp/media-preview --relative --drafts   # 下書きも含めて相対リンクで出力
open /tmp/media-preview/index.html
node build.js --strict    # 公開前チェック（古物商表示・siteUrl・リンク切れがあると失敗）
```

Node 18 以上。外部パッケージは使っていません。

## 自動ビルドについて

`.github/workflows/naniuru-media.yml` が、`naniuru-media/` の変更時と毎日0:05（日本時間）に `media/` を作り直してコミットします。
既存サイトの公開が「GitHub Actions のワークフローで push をきっかけにデプロイ」する方式の場合、このワークフローからの push では次のワークフローが起動しません。その場合は、このファイルの最後にデプロイの手順を追加するか、デプロイ側のワークフローに `workflow_run` を設定してください。
