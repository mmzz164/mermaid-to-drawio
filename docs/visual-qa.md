# 視覚 QA 手順書 — 変換結果を本家 Mermaid と目視照合する

レンダラを変更したら、**テスト全通過でも画像を見るまで分からないバグ**が残る
(実例: sequence の矢じり不可視 `endSize=0`、C4 の XML 不正、エッジラベルがノードに重なる、
gitGraph のレーン線欠落 — すべてテストは通っていた)。
この手順書は、その照合作業を**安価なサブエージェントに委譲して**回すための完全なランブック。
2026-07-11 に全 19 図式で実施し、7 件検出 → 全修正した実績のある手順そのまま。

## 全体構成(なぜこの形か)

```
[オーケストレータ = 高価なモデル]        [サブエージェント = 安価なモデル × 数体]
  ハーネス準備(スクリプト実行)     →      画像を「見る」係:
  レポートのレビュー・修正・テスト  ←        スクショ撮影 + 正解画像と比較 + 所見報告
```

- 正解(ground truth)= **mermaid.ink** が返す本家 Mermaid のレンダリング PNG
- 我々の描画 = 生成した .drawio を **draw.io 公式埋め込みビューア**でローカル表示したスクショ
- 画像の読み込み(トークンが最も重い)はサブエージェント側でのみ発生させる。
  オーケストレータは**画像を一切見ない**(経路の動作確認に 1 枚だけ見るのは可)

## 前提

- playwright MCP(ブラウザ操作)が使えること
- インターネット接続(mermaid.ink と viewer-static.min.js の取得)
- サブエージェントは**画像が読めるモデル**を指定(Agent ツールの `model` パラメータ)

## 手順

### 1. 作業ディレクトリ準備(オーケストレータ)

```bash
QA=<scratchpad>/visual-qa && mkdir -p $QA
cp tool/test/fixtures/golden/*.mmd $QA/
for f in $QA/*.mmd; do node tool/src/cli.js "$f" -o "${f%.mmd}.drawio"; done
```

### 2. 正解画像の取得

```bash
node tool/scripts/fetch-refs.js $QA     # → $QA/ref/<kind>.png
```

**HTTP 400 が返る図式は「本家 mermaid が拒否する構文」**(下の躓きポイント表を参照)。
エラーメッセージを読み、互換な変種に .mmd を書き換えて再実行し、
**同じ変種を CLI でも再変換する**(比較条件を揃えるため)。fetch-refs は取得済みをスキップするので再実行は安全。

### 3. ローカルビューア生成 + 配信

```bash
node tool/scripts/gen-viewers.js $QA    # → $QA/view-<kind>.html
cd $QA && python3 -m http.server 18924 &   # 素の静的サーバで十分(CORS 不要)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18924/view-flowchart.html  # 200 を確認
```

最初の 1 回だけ、自分で 1 ページ navigate → screenshot → 画像を見て
「draw.io の図形が実際に描画されている」ことを確認してから委譲する(経路の故障を安いモデルに診断させない)。

### 4. 比較エージェントの起動

- **5 図式 / 1 エージェント**程度に分割(1 コンテキストに画像 10 枚程度が上限の目安)
- **必ず順次実行**(ブラウザは全エージェント共有。並列にすると navigate が衝突する)
- モデルは安価な視覚対応モデルを指定。**報告のみ・修正禁止**と明記する

エージェントへのプロンプトに必ず含める要素(実績のあるテンプレート):

1. 各図式 K について: `QA/K.mmd` を Read → `http://localhost:18924/view-K.html` へ navigate →
   **2 秒 wait**(ビューアは非同期描画)→ screenshot(png / css スケール / fullPage / filename `shot-K.png`)→
   スクショと `QA/ref/K.png` を Read して比較
2. チェック観点: 全要素・全ラベルの存在と正しさ / 文字化け・切れ・重なり /
   エッジの向き・線種・矢じり / 包含関係 / 図形種 / 数値の整合(円グラフの比率、軸の値)
3. **設計上の許容差(誤検知防止に必須)**:
   - mindmap は放射状でなく LR ツリー
   - sankey はリボンでなく太線の簡易表現
   - gantt は today マーカーなし
   - 配色・フォント・寸法比は本家と違ってよい(構造・ラベル・トポロジ・形状種のみ照合)
4. 報告形式: `## K — OK | ISSUES` + `- [high|medium|low] 一文 (ref は X、ours は Y)`。
   「画像で実際に見えたものだけを報告せよ」と念押しする

### 5. 修正 → 再検証

1. レポートをレビューし、ソースの原因を特定して修正
2. `npm test` → 意図的変更で golden が落ちたら `npm run golden:update` → 再度 `npm test` 全通過
3. **修正した図式だけ** .drawio を再変換 + gen-viewers 再実行 → 再検証エージェントを 1 体起動
   (「前回の指摘 X が直っているか + 新たな劣化がないか」を明示して依頼)
4. README のデモ画像に影響する変更(flowchart / sequence / gitGraph)なら demo 画像も再生成:
   ビューア HTML の body に `zoom: 1.4` を足した変種を作り、fullPage スクショ → PIL で白背景の
   bbox に余白 12–14px で autocrop → `docs/images/demo-*.png` を上書き(既存は幅 ~1030–1050px)
5. コミット & push

## 躓きポイント(すべて実際に踏んだもの)

### 表示経路

| 罠 | 回避策 |
|---|---|
| `viewer.diagrams.net/?url=localhost:...` は**サーバ側プロキシ**(viewer.diagrams.net/proxy)経由なので localhost に絶対届かない(常に 400) | 埋め込みビューア HTML(gen-viewers.js)一択 |
| `#R<XML>` フラグメント URL は動くが、browser_navigate の結果に **XML 全文がエコー**され 1 回数千トークン | 同上 |
| app.diagrams.net の Import は**現在ページにマージ**される | 検証にはビューアを使う |
| navigate 直後のスクショは描画前で白い | screenshot 前に **2 秒 wait** |
| playwright のスクショは相対 filename だと**セッションの作業ディレクトリ直下**に落ちる(scratchpad ではない) | エージェントに Read すべき絶対パスを明示して渡す |
| ブラウザは 1 個を全員で共有 | エージェントは**順次**起動。並列禁止 |

### mermaid.ink

| 罠 | 回避策 |
|---|---|
| デフォルト出力は **JPEG**(PNG マジックナンバー検査が失敗する) | URL に `?type=png` |
| URL 形式を間違えやすい | `https://mermaid.ink/img/<base64url(JSON{code, mermaid:{theme:"default"}})>?type=png&bgColor=ffffff` |
| 連打すると失礼/不安定 | リクエスト間 1 秒 sleep(fetch-refs.js に組込み済み) |

### 本家 mermaid が拒否する構文(このツールは寛容に受けるが、正解画像は取れない)

| 図式 | 本家の制約 | 正解画像用の変種 |
|---|---|---|
| kanban | `@{ meta }` は**アイテム直後にインライン**が正(別行は parse error) | `id[テキスト]@{ assigned: 'x' }` に書き換え |
| sankey | データ行の**インデント不可**(厳密 CSV)。さらに **CJK ラベル自体が不可**(引用符でも 400) | ASCII ラベルの変種を作る(CJK 対応は本家超えの機能なので削らない) |
| xychart | x-axis の CJK カテゴリは要引用符: `["1月", "2月"]` | 引用符を付ける |
| requirement | `text:` の CJK は要引用符 | `text: "..."` に |
| quadrant | `quadrant-N` ラベルは **ASCII のみ**(lexer 制約。title の CJK は可) | 英語ラベルに |
| erDiagram | 別名 `c[Customer]` は**宣言行のみ**(関係行に書くと parse error) | `c[Customer]` を単独行で宣言してから `c ||--o{ ...` |

### その他

- `pgrep -f "http.server 18924"` は**検索文字列が自分のシェルにマッチして自殺**する
  → `pgrep -f "http[.]server 18924"` とブラケットで回避
- mindmap の `リリース{{重要}}` のように ID+形状構文が並ぶと**本家も ID 部分を表示しない**。
  「ours と ref が同じ挙動」なら仕様であってバグではない — エージェントの報告を鵜呑みにせず ref と突き合わせる
- サブエージェントの報告には必ず「ref は X、ours は Y」の対で書かせる。
  対になっていない指摘は再確認してから修正に入る(誤検知が混ざる)

## テストが緑でも QA が必要な理由(最重要の教訓)

golden fixtures は**我々が書いた素直な図**なので、潜在バグは**より複雑・実戦的な入力**に潜む。
第 2 ラウンド(2026-07-11、難易度の高い 12 図式を新規作成)で、golden では一度も踏まなかった
**「ASCII 限定 ID 正規表現が CJK 識別子で全滅」**という系統的バグを発見した:

- `flowchart / stateDiagram / classDiagram / sequenceDiagram / erDiagram` の各パーサが
  `[A-Za-z_][A-Za-z0-9_...]*` の ID 正規表現を使っており、**bare CJK 識別子**
  (`開始 --> 処理`、`state 稼働 { ... }`、`class 動物`、`顧客->>店員`、`顧客 ||--o{ 注文`)を
  1 つもパースできず、**警告だけ出して真っ白な図**を返していた。日本語ユーザには致命的。
- golden が ASCII 識別子(Idle/Running、CUSTOMER/ORDER)だったため完全に見逃されていた。
- 修正: 各パーサの ID_RE に BMP のリテラル CJK 範囲を追加(`぀-ヿ` 等、`/u` フラグ不要で
  ASCII 挙動不変)。`test/cjk-identifiers.test.js` で回帰を固定。
- 同系: `subgraph 設計`(CJK タイトル)も subgraph 検出正規表現の ID 制約で枠が消え、
  タイトルがノードとして漏れていた(mermaid-parser.js)。

**教訓**: QA 図式は golden の焼き直しにせず、(1) bare CJK 識別子、(2) 深いネスト・並行、
(3) 多数の要素・エッジ交差、(4) 全 fragment 種(alt/opt/loop/par)——を必ず含めて新規に作る。

## 過去の実績

**第 1 ラウンド(全 19 golden 図式)** — 検出 7 件: sequence 矢じり不可視(`endSize=0`)/ class の
`Owner~T~` 二重化・`~T~` 表示 / kanban インライン `@{}` 未対応 / state 終端 `[*]` の複数描画 /
quadrant ラベルとデータ点の重なり / C4 エッジラベルがノードに重なる(交差検出 + 右迂回ルーティング)/
C4 `[System Db]` 注記。コミット `5d533ba`。

**第 2 ラウンド(難易度の高い 12 図式を新規作成)** — 検出・修正:
CJK 識別子で 5 パーサ全滅(上記)/ CJK subgraph タイトルで枠消失 /
er の PK/FK/UK が名前列に押し込まれ折り返しクリップ(→ 本家同様の型/名前/キーの 3 列化)/
quadrant の点ラベルが上配置で象限タイトルと衝突(→ 本家同様に点の下へ)/
gitGraph がマージ・cherry-pick の自動採番 id を表示(→ 本家同様に非表示、明示 id は表示)。
