import { test } from "node:test";
import assert from "node:assert/strict";

import { convertMermaidToDrawio } from "../src/index.js";

/**
 * Guard against emitting raw '<' / '>' inside XML attribute values (HTML
 * labels must be XML-escaped — draw.io refuses to load the file otherwise).
 * Every attribute is extracted with a quote-bounded regex; a raw '<' that
 * leaked into a value shows up in the captured group.
 */
function assertValidAttributes(xml, label) {
  for (const m of xml.matchAll(/[\w-]+="([^"]*)"/g)) {
    assert.ok(
      !/[<>]/.test(m[1]),
      `${label}: raw <> inside attribute value: ${m[1].slice(0, 80)}`
    );
  }
  // Quotes must balance overall (odd count = a nested unescaped quote).
  assert.equal((xml.match(/"/g) || []).length % 2, 0, `${label}: unbalanced quotes`);
}

// One representative source per diagram kind, deliberately using HTML-label
// features (kanban metadata, C4 boundaries/techn, requirement fields) and
// XML-hostile characters.
const SAMPLES = {
  flowchart: `flowchart LR\n  A["<b>bold</b> & 'quote'"] --> B{ok?}`,
  er: `erDiagram\n  A ||--o{ B : "has & <holds>"`,
  sequence: `sequenceDiagram\n  box lightblue G\n    participant A\n  end\n  A->>B: hi & <bye>`,
  state: `stateDiagram-v2\n  [*] --> S1 : go & <fast>`,
  class: `classDiagram\n  class Foo {\n    +bar() void\n  }`,
  pie: `pie title A & <B>\n  "X & <Y>" : 3\n  "Z" : 1`,
  gantt: `gantt\n  dateFormat YYYY-MM-DD\n  section S & <T>\n    Task & <x> :2024-01-01, 2d`,
  mindmap: `mindmap\n  Root\n    A & <b>`,
  journey: `journey\n  section S\n    T & <x>: 3: Me`,
  timeline: `timeline\n  2020 : E & <x>`,
  quadrantChart: `quadrantChart\n  A & <b>: [0.5, 0.5]`,
  kanban: `kanban\n  Todo & <x>\n    a[Card & <y>]\n    @{ assigned: 'a & <b>', priority: 'High' }`,
  packet: `packet-beta\n  0-7: "Byte & <x>"`,
  xychart: `xychart-beta\n  title "T & <x>"\n  x-axis [a, b]\n  bar "s & <x>" [1, 2]`,
  radar: `radar-beta\n  axis a["A & <x>"], b["B"], c["C"]\n  curve x["X & <y>"]{1, 2, 3}`,
  sankey: `sankey-beta\n  "a & <b>",c,5`,
  gitGraph: `gitGraph\n  commit id: "a & <b>" tag: "v1 & <2>"`,
  requirement: `requirementDiagram\n  requirement r1 {\n    id: 1\n    text: hello & <world>\n  }\n  element e1 {\n    type: sim\n  }\n  e1 - satisfies -> r1`,
  C4: `C4Context\n  title T & <x>\n  Person(u, "U & <ser>", "d & <escr>")\n  System_Boundary(b, "B & <x>") {\n    Container(c, "C", "tech & <x>", "d")\n  }\n  Rel(u, c, "uses & <x>", "HTTP & <S>")`,
  treemap: `treemap-beta\n"Cat & <x>"\n    "Leaf & <y>": 10\n    "L2": 5`,
  block: `block-beta\n  columns 2\n  a["A & <x>"] b["B"]\n  a --> b`,
  architecture: `architecture-beta\n  group g(cloud)[G & <x>]\n  service s(server)[S & <y>] in g`,
  zenuml: `zenuml\n  title T & <x>\n  A->B.call() {\n    return r & <y>\n  }`,
};

for (const [kind, src] of Object.entries(SAMPLES)) {
  test(`XML validity: ${kind} output has fully escaped attributes`, async () => {
    const xml = await convertMermaidToDrawio(src);
    assertValidAttributes(xml, kind);
  });
}

test("findXmlAttributeProblems flags raw HTML and passes clean XML", async () => {
  const { findXmlAttributeProblems } = await import("../src/index.js");
  assert.deepEqual(
    findXmlAttributeProblems(`<mxCell id="a" value="ok &lt;b&gt;" style="html=1;" />`),
    []
  );
  const bad = findXmlAttributeProblems(`<mxCell id="a" value="<b>x</b>" />`);
  assert.ok(bad.length >= 1);
  assert.match(bad[0], /raw <>/);
});
