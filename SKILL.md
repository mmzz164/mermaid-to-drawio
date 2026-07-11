---
name: mermaid-to-drawio
description: Mermaid 図 (flowchart / erDiagram / sequenceDiagram / stateDiagram / classDiagram / pie / gantt / mindmap / journey / timeline / quadrantChart / kanban / packet / xychart / radar / sankey / gitGraph / requirementDiagram / C4) を draw.io (.drawio) のネイティブ図形 (mxCell) に変換する。Markdown 内の複数 mermaid ブロックは複数ページの 1 ファイルに。puppeteer 非依存で軽量。Gliffy / Lucidchart など他ツールでも開ける。
argument-hint: "[mermaid ソース or .mmd ファイルパス or 説明的な指示]"
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Mermaid → draw.io 変換スキル

ユーザーから渡された **mermaid ソース** (コードブロック / ファイル / 説明) を、`.drawio` ネイティブ図形ファイルに変換する。

## ツール本体

このスキルは `tool/` に同梱した `mermaid2drawio` CLI を使う:

- パス: `~/.claude/skills/mermaid-to-drawio/tool/`
- 実行: `node ~/.claude/skills/mermaid-to-drawio/tool/src/cli.js <args>`
- 対応図式（**ネイティブ変換**、23 種）: `flowchart`, `erDiagram`, `sequenceDiagram`, `stateDiagram(-v2)`, `classDiagram`, `pie`, `gantt`, `mindmap`, `journey`, `timeline`, `quadrantChart`, `kanban`, `packet(-beta)`, `xychart(-beta)`, `radar(-beta)`, `sankey(-beta)`, `gitGraph`, `requirementDiagram`, `C4Context/Container/Component/Dynamic/Deployment`, `treemap(-beta)`, `block(-beta)`, `architecture(-beta)`, `zenuml`
- 標準的な Mermaid 図式はすべてネイティブ対応済み。`-m png` / `-m svg`（要 puppeteer、下記）は今後の新図式など未対応分へのフォールバック。図式名は自動判別されエラーメッセージに表示される

> 初回利用時に `node_modules` が無ければ `(cd ~/.claude/skills/mermaid-to-drawio/tool && npm install --omit=optional)` を一度だけ実行する（約 2MB・ネイティブモード用）。
> png/svg モードを使いたい場合のみ `npm install --include=optional`（puppeteer 込み約 500MB）+ `npx puppeteer browsers install chrome-headless-shell` が必要。CLI が無ければその旨のエラーメッセージを出すので、ユーザーに確認してから入れる。

## 手順

### 1. 入力の解釈

引数を以下のいずれかで解釈する。曖昧なら `AskUserQuestion` で確認:

1. **mermaid コードブロック / ソース文字列** → 一時 `.mmd` に書き出すか `--stdin` で渡す
2. **.mmd ファイルパス** → そのまま CLI 引数に（**複数ファイル可**: `a.mmd b.mmd doc.md -o all.drawio` で 1 ファイルに複数ページ、ページ名はファイル名）
3. **Markdown ファイル（.md）や複数の mermaid ブロック** → CLI がフェンスを自動抽出し、**1 つの .drawio に複数ページ**として出力。ページ名は front matter `title:` > **直前の Markdown 見出し**（`## 全体フロー` など） > `Page-N`。別ファイルに分けたい場合のみ手で分割
4. パイプしたい場合は `-o -` で XML を標準出力へ

### 2. 出力先の決定

- ユーザーが出力先を指定していればそれを使用
- ファイル入力で未指定なら `<同名>.drawio` がデフォルト（CLI 側のデフォルト）
- stdin 入力で未指定なら、現在の作業ディレクトリに分かりやすい名前（例: `flowchart.drawio`, `er.drawio`, `sequence.drawio`）で出力
- 既存ファイルを上書きする場合は事前にユーザーへ確認

### 3. 変換コマンド例

```bash
# ファイル入力（推奨）
node ~/.claude/skills/mermaid-to-drawio/tool/src/cli.js diagram.mmd -o out.drawio

# 標準入力
cat <<'EOF' | node ~/.claude/skills/mermaid-to-drawio/tool/src/cli.js --stdin -o out.drawio
flowchart LR
  A --> B
EOF

# Markdown 内の複数 mermaid ブロック → 複数ページの 1 ファイル(見出しがページ名に)
node ~/.claude/skills/mermaid-to-drawio/tool/src/cli.js design-doc.md -o design-doc.drawio

# 複数入力ファイルをまとめて 1 ファイルに
node ~/.claude/skills/mermaid-to-drawio/tool/src/cli.js flow.mmd er.mmd notes.md -o all.drawio

# 画像埋め込み（ネイティブ非対応の図式のみ。puppeteer 必要）
node ~/.claude/skills/mermaid-to-drawio/tool/src/cli.js diagram.mmd -m png -o out.drawio
```

### 4. 警告の扱い

CLI は未対応構文を **警告として stderr に出して処理を続行** する。`style` / `classDef` / `class` / `linkStyle` / `:::class` などの CSS 風スタイル指定はネイティブに解釈されるため警告は出ない。
- 警告があった場合はユーザーに要約を伝える（無視されたディレクティブが何か）
- エラー（パース失敗・ファイル未生成）の場合は出力をそのまま見せて指示を仰ぐ

### 5. 検証

生成後:
- ファイルが作成されたか確認 (`ls -la <output>`)
- バイト数が極端に小さくないか軽くチェック
- 必要なら冒頭 `<mxGraphModel>` が含まれているか `head` で確認
- CLI は書き出し前に XML 妥当性(属性値のエスケープ漏れ等)を自動検査し、不正なら書き出さずエラー終了する

## メンテナンス時の注意

- ツールを改変したら `(cd ~/.claude/skills/mermaid-to-drawio/tool && npm test)` を実行。**ゴールデンテスト**(`test/fixtures/golden/`)が全図式の出力をバイト単位で固定しているので、意図した出力変更なら `npm run golden:update` で更新してから差分を確認する
- **レンダラの見た目に関わる変更をしたら視覚 QA を回す**: テスト全通過でも画像を見るまで分からないバグがある(矢じり不可視・ラベル重なり等の実例あり)。手順・躓きポイント・エージェント委譲の方法は `docs/visual-qa.md` に完備(補助スクリプトは `tool/scripts/`)
- スキルルートは git 管理されている。変更したらコミットしておくこと

## サポートする mermaid 構文（ネイティブモード）

詳細は `tool/README.ja.md`（日本語）/ `tool/README.md`（英語）参照。要点:

- **flowchart**
  - 方向: `TD/TB/BT/LR/RL` （subgraph 内 `direction X` も尊重）
  - ノード形状各種 (`[]`, `()`, `(())`, `{}`, `{{}}`, `([])`, `[[]]`, `[/]`, `[\]`, `[(数珠)]`)
  - **mermaid v10 形式** `A@{ shape: cyl, label: "DB" }` — `cyl/db/database` `stadium/pill` `circle/ellipse` `rhombus/diamond` `hex/hexagon` `parallelogram/trapezoid` 等を主要シェイプにマップ
  - エッジ: 通常/破線/太線/`-->`/`---`/`--x`/`--o`/`~~~`(不可視) / **双方向 `<-->` `<==>` `<-.->`**
  - ラベル付き: `A -- text --> B` / `A -->|text| B`、ラベルは `**bold**` / `__bold__` / `*italic*` / `_italic_` / `` `code` `` を HTML タグに変換（シングル `*`/`_` は単語境界に隣接する場合のみ italic 化、`user_id_field` や `1*2*3` のような識別子は素のまま）
  - **マルチノード `&`**: `A & B --> C & D` でクロス積を自動展開
  - **複数文区切り `;`**: 同一行に複数ステートメント
  - **`:::class` 接尾辞** / **`classDef` / `class A,B Foo` / `style A fill:...,stroke:...`** — CSS 風プロパティを drawio スタイルに反映（`fill`/`stroke`/`color`/`stroke-width`/`stroke-dasharray`/`font-size`/`font-weight`/`font-style`/`opacity`）
  - **`linkStyle 0,2 stroke:...` / `linkStyle default ...`** — エッジ色や太さの指定
  - **`style <subgraphId> fill:...,stroke:...`** — サブグラフフレームの色や塗りを上書き
  - **自己ループ `A --> A`** — exit/entry を指定して可視ループとして描画
  - **同一ペアの並行エッジ** — レイアウト方向に対し垂直に異なるアンカーを割り当てて重なりを回避
  - ノード ID にドット可（`pkg.Module`）
  - サブグラフ階層レイアウト（子の bbox が親をきつく収める）
  - **YAML front matter (`--- title: ... ---`)** と `%%{init: ...}%%` ディレクティブを認識（title を diagram 名に反映）
- **erDiagram**
  - **エンティティ別名 `p[Person]` / `a["表示名"]`**（mermaid v11、id で参照・角括弧内を表示）
  - 各種カーディナリティ（`||`, `|o`, `}o`, `}|`, `o|`, `o{`, `|{`）
  - `..` 非識別関係（破線）
  - 属性ブロック (`type name [PK|FK|UK] "comment"`) — **コメントを名前列に表示**
  - **属性カラム幅を内容に応じて動的調整**（type / name どちらの列も中身に応じて広狭が自動決定）
  - 自己参照（同一エンティティ間のリレーション）
  - ID にドット可
- **sequenceDiagram**
  - `participant/actor`, 同期/非同期/応答各種矢印, 自己メッセージ（ループ描画）
  - **`create participant/actor X` / `destroy X`** — create は該当参加者のライフラインを生成位置から開始、destroy はライフラインを ✕ で終端(本家準拠)
  - `alt/opt/loop/par/critical/break` のネスト
  - `Note over/left of/right of`
  - **`A->>+B` / `B-->>-A` 活性化サフィックス**（活性化バーを描画）
  - **`box <色> <ラベル> ... end`** — 参加者グループを囲む枠を背面に描画（`rgb()`/色名/`transparent` 対応）
  - **`rect rgb(...) ... end`** — 囲んだメッセージ区間の背景ハイライトを描画（`rgba()` のアルファは opacity に変換）
  - **`autonumber`** — 各メッセージのラベルに `1. 2. 3. ...` の接頭辞を自動付与
  - **`title <text>`** — diagram 名に反映（front matter よりも優先度低）
- **stateDiagram(-v2)**
  - `[*]` 開始/終了の擬似ステート（黒丸 / endState 図形に描画）
  - `state X { ... }` でコンポジット（ネスト）ステート、内部レイアウトは独立
  - **並行領域**: コンポジット内の `--` 行で分割し、破線区切りの縦積みで描画
  - ステレオタイプ `state X <<fork>>` / `<<join>>` / `<<choice>>` / `<<end>>`
  - 遷移 `A --> B : trigger / action`
  - ノート `note left of X : text` / `note right of X` 複数行 (`end note` まで)
  - `direction LR/TB/...`（コンポジット内でも可）
- **classDiagram**
  - クラスブロック `class Foo { ... }` / ジェネリクス `Foo~T~`
  - **`namespace Name { ... }` のグループ枠**と `direction LR/RL/TB/BT`
  - メンバー: 可視性記号 `+ - # ~` 含む属性／メソッド（カッコでメソッドを判定）
  - ステレオタイプ `<<interface>>` / `<<abstract>>` 等
  - UML リレーション: 継承 `<|--`、実装 `..|>`、コンポジション `*--`、集約 `o--`、関連 `-->`、依存 `..>`、リンク `..`/`--`、カーディナリティ `"1"`/`"many"`
  - ノート `note "..."` / `note for ClassName "..."`
  - クラスは UML 3 区画（名前 / 属性 / メソッド）の HTML レンダリング
- **pie**
  - `pie` / `pie showData` / `pie title <text>`（`title` / `showData` は独立行でも可）
  - データ行 `"Label" : 42.5`（クオート無しも可）。値の降順・12 時起点・時計回り（mermaid と同じ並び）
  - スライスは draw.io ネイティブの `mxgraph.basic.pie` 図形、`%` ラベルと色見本付き凡例を自動生成（`showData` で `Label [value]`）
  - 配色は mermaid デフォルトテーマ相当
- **gantt**
  - `title` / `dateFormat`（YYYY/MM/DD/HH/mm/ss トークン）/ `section`
  - タスク: `名前 : [crit,] [active|done,] [milestone,] [id,] 開始, 終了`。開始は日付か `after id...`、終了は日付・期間 (`30d`/`2w`/`12h`) ・`until id`。開始省略で直前タスクの終了から
  - 時間軸グリッド + 日付目盛り、セクション見出し + 交互の背景帯、milestone は菱形。done=グレー / active=淡青 / crit=赤枠で mermaid 風に彩色
  - `axisFormat` / `tickInterval` / `todayMarker` は静かに無視。`excludes` は非対応（警告）。today マーカーは描画しない（変換日で出力が変わるのを避けるため）
- **mindmap**
  - インデント階層（タブ=4 スペース換算）。ノード形状 `[角丸なし]` `(丸)` `((円))` `)雲(` `))バン((` `{{六角形}}`、ID 接頭辞（CJK 可）
  - `::icon(...)` 行はスキップ。複数ルートは警告して最初のルート配下に接続
  - 左→右のツリーレイアウト（dagre）。mermaid の放射状ではないが階層は同じで、draw.io 上で編集しやすい。トップレベルの枝ごとに色分け
- **journey** — `section` / `タスク: スコア: 役者` 。1–5 のスコア高さにマーカー（色は良/普通/悪）、役者ドット + 凡例
- **timeline** — `期間 : イベント : イベント` と継続行 `: イベント`。時間軸 + 期間ボックス + 下にイベント積み上げ、`section` 帯で色分け
- **quadrantChart** — `x-axis A --> B` / `y-axis` / `quadrant-1..4` / `点: [x, y]`。4 色の象限 + 軸ラベル(縦書き) + 点
- **kanban** — インデントで列とカード、`@{ assigned/ticket/priority }` メタデータ対応（priority で枠色、assigned/ticket は小さく併記）
- **packet(-beta)** — `0-15: "field"` / 単一ビット / `+16:` 相対幅。32bit/行で行またぎは自動分割、ビット番号付き
- **xychart(-beta)** — `x-axis [カテゴリ]` or `min --> max` / `y-axis "label" min --> max` / 複数 `bar`・`line` 系列。目盛り・グリッド・凡例付き。`horizontal` は非対応(警告して縦向き)
- **radar(-beta)** — `axis a["A"], ...` / `curve x["X"]{...}` / `min`/`max`。多角形グリッド + スポーク + 閉曲線 + 凡例
- **sankey(-beta)** — CSV (`source,target,value`)。簡易サンキー: 最長経路でレイヤ配置、ノード高さ・エッジ太さは流量比例（曲線リボンではなく編集可能なエッジ）
- **gitGraph** — `commit (id:/tag:/type:)` / `branch (order:)` / `checkout|switch` / `merge` / `cherry-pick id:`。ブランチ=レーン、コミット丸(HIGHLIGHT=四角、REVERSE=✕、マージ=大きめ)、タグ、cherry-pick は破線。TB/BT は LR に落とす(警告)
- **requirementDiagram** — 6 種の requirement + `element` ブロック、`a - satisfies -> b` / `b <- verifies - a` 両向き。ステレオタイプ付きボックス + 破線オープン矢印 (dagre レイアウト)
- **C4 (Context/Container/Component/Dynamic/Deployment)** — Person/System/Container/Component (+`_Ext`/`Db`/`Queue`)、`*_Boundary { ... }` ネスト(再帰レイアウトで境界がメンバーを内包)、`Rel`/`BiRel`(方向サフィックス無視)、`title`。C4 標準配色、Db=円柱。`$tags` 等の `$` 引数と `UpdateElementStyle` 系は無視

未対応構文はスキップ・警告のみで処理続行。UTF-8 BOM 付きファイルも可。

## 注意

- 出力は **draw.io 互換 XML**。Gliffy / Lucidchart などでもそのまま import 可能
- 日本語ラベル OK
- 画像埋め込みモード（png/svg）は puppeteer + headless Chromium を起動するため重い。可能ならネイティブモードを使う
- 大きい図はレイアウトに時間がかかる場合あり（dagre 利用）
