import { test } from "node:test";
import assert from "node:assert/strict";

import { convertMermaidToDrawio } from "../src/index.js";
import { findXmlAttributeProblems } from "../src/drawio-xml.js";
import { parseMermaidFlowchart } from "../src/mermaid-parser.js";
import { parseSequenceDiagram } from "../src/sequence-parser.js";
import { parseClassDiagram } from "../src/class-parser.js";
import { parseStateDiagram } from "../src/state-parser.js";
import { parseErDiagram } from "../src/erdiagram-parser.js";
import { parseRequirementDiagram } from "../src/requirement-to-drawio.js";
import { parseC4 } from "../src/c4-to-drawio.js";

// Broad correctness sweep across many syntax variants — heavy on CJK, which
// is where an ASCII-only ID regex silently produces a BLANK diagram. This is
// the guard that would have caught the round-2 CJK-identifier regressions.
// Every case must convert to valid, non-blank draw.io XML.
const CONVERT_CASES = [
  ["flowchart cjk", "flowchart LR\n  受付 -->|申請| 審査 --> 承認"],
  ["flowchart no-arrow", "flowchart LR\n  A --- B --- C"],
  ["flowchart thick/dotted", "flowchart LR\n  A ==> B\n  B -.-> C"],
  ["flowchart o/x arrows", "flowchart LR\n  A --o B\n  A --x C"],
  ["flowchart amp-chain", "flowchart LR\n  A & B --> C & D"],
  ["flowchart shapes", "flowchart TD\n  a[矩形]-->b([スタジアム])-->c[(DB)]-->d((円))-->e{菱形}-->f{{六角}}"],
  ["flowchart style cjk", "flowchart LR\n  開始 --> 終了\n  style 開始 fill:#f9f\n  class 終了 hot\n  classDef hot fill:#f96"],
  ["flowchart subgraph cjk nested", "flowchart TB\n  subgraph 外\n    subgraph 内\n      A --> B\n    end\n  end"],
  ["flowchart self-loop", "flowchart LR\n  A --> A"],
  ["sequence cjk bare", "sequenceDiagram\n  顧客->>店員: 注文\n  店員-->>顧客: 提供"],
  ["sequence activation", "sequenceDiagram\n  A->>+B: req\n  B-->>-A: res"],
  ["sequence note-over cjk", "sequenceDiagram\n  甲->>乙: x\n  Note over 甲,乙: 合意"],
  ["sequence nested frags", "sequenceDiagram\n  A->>B: x\n  alt c1\n    loop 3\n      A->>B: y\n    end\n  else c2\n    opt m\n      A->>B: z\n    end\n  end"],
  ["class cjk", "classDiagram\n  動物 <|-- 犬\n  class 動物 {\n    +名前 string\n    +鳴く() void\n  }"],
  ["class generics", "classDiagram\n  class Repo~T~ {\n    +List~T~ all()\n  }"],
  ["class all-relations", "classDiagram\n  A <|-- B\n  C *-- D\n  E o-- F\n  G <.. H\n  I ..|> J"],
  ["class namespace cjk", "classDiagram\n  namespace 生物 {\n    class 犬\n    class 猫\n  }"],
  ["state cjk", "stateDiagram-v2\n  [*] --> 待機\n  待機 --> 実行 : 開始\n  実行 --> [*]"],
  ["state concurrency", "stateDiagram-v2\n  state 稼働 {\n    [*] --> A\n    --\n    [*] --> B\n  }"],
  ["state choice", "stateDiagram-v2\n  state c <<choice>>\n  [*] --> c\n  c --> A"],
  ["state bare+note", "stateDiagram-v2\n  待機\n  note right of 待機 : アイドル"],
  ["er cjk", "erDiagram\n  顧客 ||--o{ 注文 : 行う\n  顧客 {\n    int 番号 PK\n    string 氏名\n  }"],
  ["er all-cardinalities", "erDiagram\n  A ||--|| B : a\n  C ||--o{ D : b\n  E }o--o{ F : c\n  G }|--|{ H : d"],
  ["pie cjk", "pie title 内訳\n  \"犬\" : 40\n  \"猫\" : 35"],
  ["gantt cjk deps", "gantt\n  dateFormat YYYY-MM-DD\n  section 設計\n    要件 :a1, 2026-01-01, 5d\n    設計 :after a1, 3d"],
  ["mindmap cjk", "mindmap\n  root((根))\n    枝1\n      葉1\n    枝2"],
  ["journey cjk", "journey\n  title 一日\n  section 朝\n    起床: 3: 私\n    朝食: 5: 私, 家族"],
  ["timeline cjk", "timeline\n  title 歴史\n  section 古代\n    紀元前 : 出来事A : 出来事B"],
  ["quadrant", "quadrantChart\n  quadrant-1 Q1\n  quadrant-2 Q2\n  quadrant-3 Q3\n  quadrant-4 Q4\n  項目A: [0.3, 0.7]"],
  ["kanban cjk inline-meta", "kanban\n  やること\n    タスク1\n    id2[タスク2]@{ assigned: '田中', priority: 'High' }"],
  ["packet cjk", "packet-beta\n  0-15: \"送信元\"\n  16-31: \"宛先\""],
  ["xychart cjk", "xychart-beta\n  title \"売上\"\n  x-axis [\"1月\", \"2月\", \"3月\"]\n  bar [30, 60, 90]"],
  ["radar cjk", "radar-beta\n  axis 数学[\"数学\"], 理科[\"理科\"], 国語[\"国語\"]\n  curve a{80, 90, 70}"],
  ["sankey", "sankey-beta\nA,B,10\nB,C,5"],
  ["requirement cjk", "requirementDiagram\n  requirement 要求 {\n    id: 1\n    text: \"速い\"\n  }\n  element 装置 {\n    type: hw\n  }\n  装置 - satisfies -> 要求"],
  ["c4 cjk aliases", "C4Context\n  Person(顧客, \"顧客\")\n  System(基幹, \"基幹\")\n  Rel(顧客, 基幹, \"利用\")"],
  ["treemap nested", "treemap-beta\n\"A\"\n    \"a1\": 10\n    \"Sub\"\n        \"s1\": 5\n\"B\": 20"],
  ["treemap flat", "treemap-beta\n\"X\": 1\n\"Y\": 2\n\"Z\": 3"],
  ["block grid+group", "block-beta\n  columns 3\n  a b c\n  block:g:2\n    d e\n  end\n  f\n  a --> d"],
  ["block shapes", "block-beta\n  columns 3\n  a((\"c\")) b{\"r\"} c([\"s\"])"],
  ["architecture groups", "architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g\n  service b(database)[B] in g\n  a:R -- L:b"],
  ["architecture junction", "architecture-beta\n  service a(server)[A]\n  junction j\n  a:R -- L:j"],
  ["zenuml if-else", "zenuml\n  A->B.check() {\n    if (ok) {\n      B->C: yes\n    } else {\n      B->C: no\n    }\n    return done\n  }"],
  ["zenuml plain", "zenuml\n  @Actor U\n  U->S: request\n  S->U: reply"],
  ["hostile amp/lt/gt", "flowchart LR\n  A[\"a & b < c > d\"] --> B[\"<script>x</script>\"]"],
  ["hostile generics", "classDiagram\n  class M {\n    +Map~String, List~int~~ data\n  }"],
  ["crlf", "flowchart LR\r\n  A --> B\r\n  B --> C"],
  ["bom", "﻿flowchart LR\n  A --> B"],
];

for (const [name, src] of CONVERT_CASES) {
  test(`broad-convert: ${name} → valid, non-blank XML`, async () => {
    const xml = await convertMermaidToDrawio(src);
    const cells = (xml.match(/<mxCell/g) || []).length;
    assert.ok(cells >= 3, `blank diagram (${cells} cells)`);
    assert.deepEqual(findXmlAttributeProblems(xml), [], "invalid draw.io XML");
  });
}

// Valid, fully-supported inputs (CJK in secondary positions) must parse with
// ZERO warnings — a warning here means dropped or mis-parsed content.
const PARSERS = {
  flowchart: parseMermaidFlowchart,
  sequence: parseSequenceDiagram,
  class: parseClassDiagram,
  state: parseStateDiagram,
  er: parseErDiagram,
  requirement: parseRequirementDiagram,
  c4: parseC4,
};
const WARN_CASES = [
  ["flowchart", "flowchart LR\n  開始 --> 終了\n  style 開始 fill:#f9f"],
  ["flowchart", "flowchart TB\n  subgraph 群\n    direction LR\n    A --> B\n  end"],
  ["sequence", "sequenceDiagram\n  甲->>乙: x\n  Note over 甲,乙: 合意"],
  ["sequence", "sequenceDiagram\n  box 青 バックエンド\n    participant API\n    participant DB\n  end\n  API->>DB: q"],
  ["class", "classDiagram\n  会社 \"1\" --> \"*\" 社員 : 雇用"],
  ["class", "classDiagram\n  動物 : +名前 string\n  動物 : +鳴く() void"],
  ["state", "stateDiagram-v2\n  待機\n  note right of 待機 : アイドル"],
  ["state", "stateDiagram-v2\n  [*] --> 稼働\n  稼働 --> [*]\n  state 稼働 {\n    [*] --> 実行\n  }"],
  ["er", "erDiagram\n  顧客 ||--o{ 注文 : 発注する\n  注文 }|--|| 商品 : 含む"],
  ["requirement", "requirementDiagram\n  requirement 要求 {\n    id: 1\n    text: \"x\"\n  }\n  element 部品 {\n    type: hw\n  }\n  要求 <- satisfies - 部品"],
  ["c4", "C4Context\n  System(甲, \"甲\")\n  System(乙, \"乙\")\n  BiRel(甲, 乙, \"同期\")"],
];

for (const [kind, src] of WARN_CASES) {
  test(`broad-warn: ${kind} valid input parses with no warnings`, () => {
    const model = PARSERS[kind](src);
    assert.deepEqual(model.warnings, [], model.warnings.join(" | "));
  });
}
