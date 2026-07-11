# mermaid2drawio

*[English version → README.md](README.md)*

Mermaid 図を draw.io (`.drawio`) ファイルに変換する Node.js 製 CLI ツール。

3 種類の変換モードを持ちます：

| モード | 説明 | 対応図式 | 互換ツール |
| --- | --- | --- | --- |
| **`native`** (デフォルト) | mermaid を **draw.io ネイティブ図形 (mxCell)** にパース変換。個別ノードを編集可能。puppeteer 不要。 | flowchart, erDiagram, sequenceDiagram, stateDiagram(-v2), classDiagram, pie, gantt, mindmap, journey, timeline, quadrantChart, kanban, packet, xychart, radar, sankey, gitGraph, requirementDiagram, C4 | draw.io / Gliffy / Lucidchart など |
| `png` | mermaid-cli で PNG レンダリング → 画像として埋め込み | 全 mermaid 図式 | draw.io |
| `svg` | mermaid-cli で SVG レンダリング → 画像として埋め込み | 全 mermaid 図式 | draw.io |

ネイティブ非対応で残っているのは `block-beta` / `architecture-beta` / `zenuml` のみ（png/svg モードで対応）。

> 補足: 画像埋め込みモード（png/svg）は内部で `@mermaid-js/mermaid-cli` (puppeteer + headless Chromium) を使うため重めです。ネイティブモードで済むならそちらが速くて編集もしやすく、ツール間互換性も高いです。

Markdown ファイル（``` ```mermaid``` フェンスを含む `.md`）を入力すると、各ブロックが 1 ページずつの**複数ページ .drawio** になります。ページ名は front matter `title:` > 直前の Markdown 見出し > `Page-N`。**複数の入力ファイル**を並べて渡すと 1 つの複数ページファイルにまとまります（ページ名はファイル名）。

## インストール

npm から（推奨）:

```bash
npx mermaid2drawio diagram.mmd          # インストールせずに実行
npm install -g mermaid2drawio           # または CLI をグローバルインストール
```

`@mermaid-js/mermaid-cli` は **optionalDependencies** です。ネイティブモードだけならソースからの軽量インストールで足ります（`node_modules` 約 2MB）:

```bash
cd mermaid2drawio
npm install --omit=optional
```

png/svg モードも使う場合はフルインストール（puppeteer 込み、約 500MB）+ headless Chrome の取得が必要です:

```bash
npm install --include=optional
npx puppeteer browsers install chrome-headless-shell
```

## 使い方

```bash
# ネイティブモード（デフォルト・推奨）
mermaid2drawio diagram.mmd

# 出力先指定
mermaid2drawio diagram.mmd -o out.drawio

# PNG 埋め込み（gantt など ネイティブ非対応図式で使う）
mermaid2drawio gantt.mmd -m png -o gantt.drawio

# 標準入力から
cat diagram.mmd | mermaid2drawio --stdin -o out.drawio

# Markdown 内の複数 mermaid ブロック → 複数ページの 1 ファイル
mermaid2drawio design-doc.md -o design-doc.drawio

# 複数入力ファイルをまとめて 1 ファイルに / XML を標準出力へ
mermaid2drawio flow.mmd er.mmd notes.md -o all.drawio
mermaid2drawio diagram.mmd -o -
```

Markdown 入力時のページ名は、各ブロックの YAML front matter `title:` > 直前の Markdown 見出し（各見出しはその直後の最初のブロックのみ命名。コードフェンス内の `#` は無視） > `Page-N`。

### サポートする構文（ネイティブモード）

**flowchart**
- `flowchart TD` / `TB` / `BT` / `LR` / `RL`
- サブグラフ内の `direction X` ディレクティブで個別の方向指定可
- ノード形状: `A`, `A[Label]`, `A(Round)`, `A((Circle))`, `A{Diamond}`, `A([Stadium])`, `A[[Subroutine]]`, `A{{Hexagon}}`, `A[/Para/]`, `A[\Trap\]`, `A[(Database)]`
- エッジ: `A --> B`, `A --- B`, `A -.-> B`, `A ==> B`, `A --o B` (circle end), `A --x B` (cross end), `A ~~~ B` (不可視/レイアウト専用)
- 双方向: `A <--> B`, `A <==> B`, `A <-.-> B`, `A x--x B`, `A o--o B`
- 長い矢印: `A ---> B` / `A --------> B`（長さによる影響は無し、単に一本のエッジ）
- ラベル付きエッジ: `A -- text --> B`, `A -->|text| B`（ラベルはクオート対応）
- マルチエッジ `&`: `A & B --> C & D` は 4 本のエッジに展開
- 同一行複文区切り: `A --> B; C --> D`
- ノード ID: 英字/数字/`_`/`-`/`.`（`pkg.Module` のような階層 ID OK）
- mermaid v10 attribute form: `A@{ shape: cyl, label: "DB" }` （主要シェイプは `rect/rounded/stadium/pill/circle/ellipse/diamond/rhombus/hex/hexagon/cyl/db/database/parallelogram/trapezoid/subroutine` をマップ）
- ラベルの markdown 強調: `**bold**` / `__bold__` → `<b>`, `*italic*` / `_italic_` → `<i>`, `` `code` `` → `<code>`。シングル `*`/`_` は単語境界（句読点・空白・行頭末）に隣接する場合のみ italic 化されるため、`user_id_field` や `1*2*3` のような識別子は変換されない。
- マルチエッジ: 同一ペアの並行エッジは exit/entry 位置をずらして重なりを回避
- スタイル指定:
  - `A:::className` 接尾辞でクラスを付与
  - `classDef className fill:#f00,stroke:#000,color:#fff,stroke-width:3px,...`
  - `class A,B className` で既存ノードにクラスを後付け
  - `style A fill:#xxx,stroke:#xxx,...` で個別ノードを直接スタイリング（クラスより優先）
  - `style <subgraphId> fill:..` でサブグラフフレームも上書き可
  - 認識される CSS 風プロパティ: `fill` / `stroke` / `color` / `stroke-width` / `stroke-dasharray` / `font-size` / `font-weight` / `font-style` / `opacity`
- リンクスタイル: `linkStyle 0,2 stroke:#f00,stroke-width:2px` / `linkStyle default stroke:#999`
- 自己ループ `A --> A`: 可視ループとして描画（自動で exit/entry を割当）
- YAML front matter / `%%{init: ...}%%`: 先頭の `--- title: ... ---` を認識し、`title` を diagram 名に反映
- サブグラフ: `subgraph Id["Display Name"] ... end` (ネスト可、内部レイアウトは独立に最適化)

**erDiagram**
- エンティティ別名(mermaid v11): `p[Person]` / `a["Customer Account"]` — リレーションは id で参照、角括弧内が表示名
- リレーション: `EntityA ||--o{ EntityB : "label"` など
  - 左カーディナリティ: `||` / `|o` / `}o` / `}|` / `o|`
  - 線種: `--` (実線/identifying) / `..` (破線/non-identifying)
  - 右カーディナリティ: `||` / `o|` / `|o` / `o{` / `|{`
- 属性ブロック: `EntityName { type name [PK|FK|UK] "comment" }`
  - コメント文字列は名前列に併記される
  - 属性のタイプ列と名前列はそれぞれの内容に応じて幅が動的に決定
- 自己参照（同じエンティティとのリレーション）可
- エンティティ ID にドット可（`pkg.Module`）

**sequenceDiagram**
- `participant X` / `participant X as Alias` / `actor X`、ID にクオート文字列も可（`participant "User A" as U`）
- `create participant X` / `create actor X` は生成位置からライフラインを開始、`destroy X` はライフラインを ✕ で終端（本家準拠）
- メッセージ: `->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`
- 活性化サフィックス: `A->>+B: msg`（B を活性化）、`B-->>-A: msg`（送信者を非活性化）。
  活性化バーが lifeline 上に矩形で描画される。
- 明示的な `activate X` / `deactivate X` でも同様に描画
- 自己メッセージ（同じ参加者宛て）はループ矢印で描画
- フラグメント: `alt / else / end`, `opt / end`, `loop / end`, `par / and / end`,
  `critical / option / end`, `break / end`（ネスト可）
- 参加者グループ `box <色> <ラベル> ... end`: 囲んだ参加者のライフライン全体を覆う枠を背面に描画。色は `rgb()` / `rgba()` / CSS 色名 / `transparent`
- 背景ハイライト `rect rgb(r,g,b) ... end`: 囲んだメッセージ区間 × 関与するライフラインの範囲に背景矩形を描画（`rgba()` のアルファは opacity へ変換、ネスト可）
- ノート: `Note over X[,Y]: ...` / `Note left of X: ...` / `Note right of X: ...`
- `autonumber`: 各メッセージのラベル先頭に `1. 2. 3. ...` を自動付与
- `title <text>`: diagram 名に反映（front matter よりも優先度は低い）

**stateDiagram(-v2)**
- 擬似ステート `[*]` を `ellipse` (start) / `shape=endState` (end) として描画。同一ソース内に複数現れても重ならない
- コンポジット `state Outer { ... }` はネスト可。コンポジット内でも `direction LR/TB` を尊重
- ステレオタイプ `state X <<fork>>` / `<<join>>` / `<<choice>>` / `<<end>>` を専用シェイプ（fork/join は太い線、choice は菱形）に変換
- 遷移 `A --> B : trigger / action`、状態説明 `X : description`
- 単一行 `note left of X : text` / 複数行 `note left of X` ... `end note`
- `direction LR/TB/BT/RL` を上位 / コンポジット単位で適用
- 並行領域: コンポジット内の `--` 行で領域を分割し、破線区切りで縦積みに描画(mermaid と同じレイアウト)

**classDiagram**
- `class Foo`, `class Foo { ... }`、ジェネリクス `Foo~T~`
- `namespace Name { class A ... }` のグループ枠(クラスは枠内にレイアウト、リレーションは枠をまたいで OK)
- メンバー: `+ - # ~` の可視性記号付きの属性／メソッド（カッコでメソッドを判定）。`<<interface>>`, `<<abstract>>` 等のステレオタイプも保持
- 関係: 継承 `<|--` / 実装 `..|>` / コンポジション `*--` / 集約 `o--` / 関連 `-->` `<--` `--` / 依存 `..>` `<..` / リンク `..` を、UML 標準の矢印頭・実線/破線で描画
- `"1"` / `"many"` などのカーディナリティを両端ラベルとして配置
- `note "..."` および `note for ClassName "..."`
- クラスは UML 3 区画（名前 / ステレオタイプ / 属性 / メソッド）を HTML で 1 セルにまとめて描画

**pie**
- `pie` / `pie showData` / `pie title <text>`（`title` / `showData` は独立行でも可）
- データ行: `"Label" : 42.5`（クオート無しラベルも許容）
- draw.io の `mxgraph.basic.pie` 図形でスライスを描画（12 時起点・時計回り、値の降順 = mermaid と同じ並び）
- 各スライスに整数丸めの `%` ラベル、右側に色見本付き凡例（`showData` 時は `Label [value]`）
- 配色は mermaid デフォルトテーマの pie1–pie12 相当

**gantt**
- `title` / `dateFormat`（`YYYY` `YY` `MM` `DD` `HH` `mm` `ss` トークンの組合せ、例 `YYYY-MM-DD`）/ `section`
- タスク行: `名前 : [crit,] [active|done,] [milestone,] [id,] 開始, 終了`
  - 開始: 日付 or `after id1 [id2 ...]`（参照タスクの終了の最大値）。省略時は直前タスクの終了
  - 終了: 日付 or 期間（`30d` / `2w` / `12h` / `90m` / `30s`）or `until id`
- タスクバーは時間軸に比例配置。セクション見出し + 交互の背景帯、日付目盛り + 破線グリッド
- 彩色: 通常=紫 / `active`=淡青 / `done`=グレー / `crit`=赤枠。`milestone` は菱形
- `axisFormat` / `tickInterval` / `todayMarker` / `weekend` は無視（表示ヒント）。`excludes` は非対応で警告。today マーカーは描画しない（変換日に依存する出力を避ける）

**mindmap**
- インデントで階層を表現（タブ = 4 スペース換算）
- ノード形状: `text`（デフォルト）、`[四角]`、`(丸)`、`((円))`、`)雲(`、`))バン((`（雲で近似）、`{{六角形}}`。ID 接頭辞可（`id[text]`、CJK 文字も可）
- `::icon(...)` / `::` 装飾行はスキップ。複数ルートは警告のうえ最初のルート配下へ
- dagre による左→右ツリーレイアウト（mermaid の放射状レイアウトの代わり。階層は同一で draw.io 上での編集が容易）
- ルート = 楕円、トップレベルの枝ごとに色分け（深さ 2 以降は白地 + 枝色の縁取り）

**journey**
- `title` / `section` / `タスク名: スコア[: 役者, 役者]`
- スコア (1–5 にクランプ) の高さにマーカーを配置（≥4 緑 / 3 黄 / ≤2 赤）、役者ごとの色ドット + 凡例

**timeline**
- `期間 : イベント : イベント`、継続行 `: イベント`、`section` グループ
- 水平時間軸 + 期間ボックス、イベントは各期間の下に積み上げ。セクションごと（無ければ期間ごと）に色分け

**quadrantChart**
- `x-axis Left --> Right` / `y-axis Bottom --> Top` / `quadrant-1..4 ラベル` / `名前: [x, y]`（0–1）
- 4 色の象限グリッド + 縦書き y 軸ラベル + ラベル付きポイント。`:::class` 等のスタイルは警告のうえ無視

**kanban**
- トップレベルのインデント = 列、ネスト = カード。`id[テキスト]` / 素のテキスト両対応
- `@{ assigned: 'x', ticket: 'y', priority: 'High' }`: priority がカード枠色（Very High/High/Low/Very Low）、assigned/ticket は 2 行目に小さく表示

**packet (packet-beta)**
- `0-15: "Field"` / 単一ビット `16: "Flag"` / 相対幅 `+16: "Next"`
- 32 ビット/行。行をまたぐフィールドは自動分割（`(cont.)` ラベル）、各ボックスに開始/終了ビット番号

**xychart (xychart-beta)**
- `title` / `x-axis [a, b, c]`（カテゴリ）or `x-axis min --> max`（数値）/ `y-axis "label" [min --> max]`
- `bar "name" [..]` / `line "name" [..]` 複数系列（bar はカテゴリ内でグループ化、line は折れ線）
- y 軸は「きりのいい」目盛りを自動選択、グリッド線・凡例付き。`horizontal` は非対応（警告して縦向き）

**radar (radar-beta)**
- `axis a["A"], b["B"], ...` / `curve x["X"]{v1, v2, ...}` / `min` / `max`
- 多角形グラティキュール（4 リング）+ スポーク + 軸ラベル、カーブは閉じた折れ線 + 頂点ドット + 凡例

**sankey (sankey-beta)**
- CSV 行 `source,target,value`（クオート内カンマ対応）
- 簡易サンキー: ソースからの最長経路でレイヤを決定し、ノード高さ・エッジ太さを流量に比例させる（曲線リボンではなく編集可能な通常エッジ）。循環は警告

**gitGraph**
- `commit` (`id:` / `tag:` / `type: NORMAL|REVERSE|HIGHLIGHT`)、`branch name [order: n]`（作成 + checkout）、`checkout|switch`、`merge branch [id:/tag:]`、`cherry-pick id:"x"`
- ブランチ = 水平レーン（色分け + 左端にラベル）。マージは大きめの丸、HIGHLIGHT は四角、REVERSE は ✕、cherry-pick は元コミットから破線。コミット ID を下、タグを上に表示
- `gitGraph TB:` / `BT:` は警告して LR で描画

**requirementDiagram**
- `requirement` / `functionalRequirement` / `interfaceRequirement` / `performanceRequirement` / `physicalRequirement` / `designConstraint` / `element` ブロック（`id:` `text:` `risk:` `verifymethod:` / `type:` `docref:`）
- 関係 `a - satisfies -> b` と逆向き `b <- satisfies - a`（contains/copies/derives/satisfies/verifies/refines/traces）
- ステレオタイプ見出し + フィールド行のボックス（要求=青、element=緑）、`<<type>>` ラベル付き破線オープン矢印、dagre レイアウト

**C4 (C4Context / C4Container / C4Component / C4Dynamic / C4Deployment)**
- 要素: `Person(_Ext)` / `System(Db|Queue)(_Ext)` / `Container(Db|Queue)(_Ext)` / `Component(Db|Queue)(_Ext)` — C4 標準配色（Person 濃紺 / System 青 / Container 中間 / Component 淡青 / 外部 グレー）、Db は円柱
- 境界: `Enterprise_Boundary` / `System_Boundary` / `Container_Boundary` / `Boundary` / `Node` の `{ ... }` ネスト。再帰レイアウトで境界ボックスがメンバーをきっちり内包
- `Rel` / `BiRel`（`Rel_D` 等の方向サフィックスは無視）、ラベル + `[技術]` 表示。`$sprite` / `$tags` / `$link` 引数と `UpdateElementStyle` / `LAYOUT` 系ディレクティブは静かに無視

どれも日本語ラベル OK。UTF-8 BOM 付き入力も可。未対応構文は警告のみで処理続行（`click` などの非視覚的ディレクティブは静かに無視）。

### オプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-o, --output <file>` | 出力ファイルパス（`-` で標準出力へ） | `<最初の入力>.drawio` |
| `-m, --mode <native\|png\|svg>` | 変換モード | `native` |
| `-s, --scale <n>` | PNG レンダリング倍率 | `2` |
| `-t, --theme <name>` | `default` / `dark` / `forest` / `neutral`（png/svg 用） | `default` |
| `-b, --background <color>` | 背景色 | mode毎に既定 |
| `-n, --name <name>` | drawio のページ名 | 入力ファイル名 |
| `--stdin` | 標準入力からソースを読む | — |
| `-h, --help` | ヘルプ | — |
| `-v, --version` | バージョン | — |

## プログラムからの利用

```js
import {
  convertMermaidToDrawio,
  flowchartToDrawio,     // 同期 (puppeteer 非依存)
  parseMermaidFlowchart, // パーサのみ
} from "mermaid2drawio";

// ネイティブ（同期）
const { xml, warnings } = flowchartToDrawio(src);

// 任意モード（async）
const xml2 = await convertMermaidToDrawio(src, { mode: "png" });
```

## テスト

```bash
npm test
```

全図式の出力は **ゴールデンスナップショット** (`test/fixtures/golden/*.expected.drawio`) でバイト単位に固定されています。レンダラを変更して出力が意図的に変わる場合は:

```bash
npm run golden:update   # 期待出力を再生成
git diff test/fixtures/golden/   # 差分が意図通りか確認してからコミット
```

また CLI は書き出し前に XML 妥当性（属性値のエスケープ漏れ・クオート不整合）を自動検査し、不正なら書き出さずエラー終了します。

## ライセンス

MIT
