import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMermaidFlowchart } from "../src/mermaid-parser.js";
import { parseSequenceDiagram } from "../src/sequence-parser.js";
import { parseErDiagram } from "../src/erdiagram-parser.js";
import { parseClassDiagram } from "../src/class-parser.js";
import { parseStateDiagram } from "../src/state-parser.js";
import { convertMermaidToDrawio } from "../src/index.js";

// Regression: bare CJK identifiers (not just bracketed labels) must parse.
// Previously every structural parser used an ASCII-only ID regex, so a
// Japanese user writing `開始 --> 処理` or `state 稼働 { ... }` got a blank
// diagram with no error. See docs/visual-qa.md.

test("flowchart: bare CJK node identifiers parse", () => {
  const m = parseMermaidFlowchart("flowchart LR\n  開始 --> 処理\n  処理 --> 終了");
  assert.deepEqual(m.warnings, []);
  assert.equal(m.nodes.size, 3);
  assert.equal(m.edges.length, 2);
});

test("flowchart: subgraph with a CJK title keeps its frame and children", () => {
  const m = parseMermaidFlowchart(
    "flowchart TD\n  A --> B\n  subgraph 設計\n    B --> C\n  end",
  );
  assert.deepEqual(m.warnings, []);
  assert.equal(m.subgraphs.length, 1);
  assert.equal(m.subgraphs[0].label, "設計");
  // No stray node called "subgraph".
  assert.ok(!m.nodes.has("subgraph"));
  // B and C belong to the subgraph.
  assert.equal(m.nodes.get("C").parent, m.subgraphs[0].id);
});

test("sequence: bare CJK participants parse", () => {
  const m = parseSequenceDiagram("sequenceDiagram\n  顧客->>店員: 注文\n  店員-->>顧客: 提供");
  assert.deepEqual(m.warnings, []);
  assert.equal(m.participants.length, 2);
  assert.equal(m.steps.filter((s) => s.type === "message").length, 2);
});

test("er: bare CJK entities and attributes parse", () => {
  const m = parseErDiagram("erDiagram\n  顧客 ||--o{ 注文 : 行う\n  顧客 {\n    int 番号 PK\n  }");
  assert.deepEqual(m.warnings, []);
  assert.equal(m.entities.size, 2);
  assert.equal(m.relationships.length, 1);
});

test("class: bare CJK class + namespace names parse", () => {
  const m = parseClassDiagram(
    "classDiagram\n  namespace 生物 {\n    class 動物 {\n      +名前 string\n    }\n  }\n  動物 <|-- 犬",
  );
  assert.deepEqual(m.warnings, []);
  assert.ok(m.classes.has("動物"));
  assert.ok(m.classes.has("犬"));
  assert.equal(m.classes.get("動物").attributes[0], "+名前 string");
  assert.equal(m.namespaces[0].name, "生物");
});

test("state: bare CJK state names + composites parse (not a blank diagram)", () => {
  const m = parseStateDiagram(
    "stateDiagram-v2\n  [*] --> 待機\n  待機 --> 稼働 : 起動\n  state 稼働 {\n    [*] --> 準備\n  }\n  稼働 --> [*]",
  );
  assert.deepEqual(m.warnings, []);
  assert.ok(m.states.has("待機"));
  assert.ok(m.states.has("稼働"));
  assert.equal(m.composites.length, 1);
});

test("end-to-end: CJK-identifier diagrams emit real cells, not empty models", async () => {
  const sources = [
    "flowchart LR\n  開始 --> 終了",
    "stateDiagram-v2\n  [*] --> 稼働\n  稼働 --> [*]",
    "classDiagram\n  動物 <|-- 犬",
    "erDiagram\n  顧客 ||--o{ 注文 : 行う",
    "sequenceDiagram\n  顧客->>店員: 注文",
  ];
  for (const src of sources) {
    const xml = await convertMermaidToDrawio(src);
    const cellCount = (xml.match(/<mxCell/g) || []).length;
    assert.ok(cellCount > 2, `expected real cells for: ${src.slice(0, 20)} (got ${cellCount})`);
  }
});
