import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMermaidFlowchart,
} from "../src/mermaid-parser.js";
import { flowchartToDrawio } from "../src/flowchart-to-drawio.js";

test("parser: simple flowchart with shapes", () => {
  const src = `flowchart LR
    A[Rect] --> B(Round)
    B --> C{Diamond}
    C --> D((Circle))`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.direction, "LR");
  assert.equal(m.nodes.size, 4);
  assert.equal(m.nodes.get("A").shape, "rectangle");
  assert.equal(m.nodes.get("A").label, "Rect");
  assert.equal(m.nodes.get("B").shape, "rounded");
  assert.equal(m.nodes.get("C").shape, "rhombus");
  assert.equal(m.nodes.get("D").shape, "ellipse");
  assert.equal(m.edges.length, 3);
  assert.equal(m.edges[0].arrow, "normal");
});

test("parser: edge labels in both syntaxes", () => {
  const src = `flowchart LR
    A -- hello --> B
    B -->|world| C`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.edges.length, 2);
  assert.equal(m.edges[0].label, "hello");
  assert.equal(m.edges[1].label, "world");
});

test("parser: edge labels with hyphens and special chars are preserved", () => {
  const src = `flowchart LR
    A -- a-b-c --> B
    B -- 子 Order 永続化 --> C
    C -.-> D
    D ==> E`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.edges.length, 4);
  assert.equal(m.edges[0].label, "a-b-c");
  assert.equal(m.edges[1].label, "子 Order 永続化");
  assert.equal(m.edges[2].arrow, "dashed");
  assert.equal(m.edges[3].arrow, "thick");
});

test("parser: subgraph membership", () => {
  const src = `flowchart TB
    subgraph G1["Group One"]
      A
      B
    end
    A --> B
    A --> C`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.subgraphs.length, 1);
  assert.equal(m.subgraphs[0].id, "G1");
  assert.equal(m.subgraphs[0].label, "Group One");
  assert.deepEqual(m.subgraphs[0].children.sort(), ["A", "B"]);
  assert.equal(m.nodes.get("A").parent, "G1");
  assert.equal(m.nodes.get("B").parent, "G1");
  // C declared outside the subgraph
  assert.equal(m.nodes.get("C").parent, null);
});

test("parser: subgraph with quoted display name and identifier with hyphen-ish text", () => {
  const src = `flowchart LR
    subgraph Backend["delivery-api"]
      OS[OrderService]
    end`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.subgraphs[0].label, "delivery-api");
  assert.equal(m.nodes.get("OS").label, "OrderService");
});

test("parser: ignores comments and styling directives", () => {
  const src = `flowchart LR
    %% a comment
    A --> B
    style A fill:#f00`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.edges.length, 1);
});

test("parser: & creates a cross product of edges", () => {
  // A & B --> C & D should produce 4 edges.
  const src = `flowchart LR
    A & B --> C & D`;
  const m = parseMermaidFlowchart(src);
  const pairs = m.edges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(pairs, ["A->C", "A->D", "B->C", "B->D"]);
  assert.equal(m.nodes.size, 4);
});

test("parser: ; separates multiple statements on the same line", () => {
  const src = `flowchart LR
    A --> B; C --> D; E[Label] --> F`;
  const m = parseMermaidFlowchart(src);
  const pairs = m.edges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(pairs, ["A->B", "C->D", "E->F"]);
  assert.equal(m.nodes.get("E").label, "Label");
});

test("parser: ::: class suffix is consumed (not warned as junk)", () => {
  const src = `flowchart LR
    A:::myclass
    A --> B:::other`;
  const m = parseMermaidFlowchart(src);
  // No "trailing junk" warning should appear.
  const junk = m.warnings.filter((w) => /trailing junk|could not parse/.test(w));
  assert.deepEqual(junk, []);
  assert.equal(m.nodes.has("A"), true);
  assert.equal(m.nodes.has("B"), true);
  assert.equal(m.edges.length, 1);
});

test("parser: ~~~ produces an invisible edge", () => {
  const src = `flowchart LR
    A ~~~ B`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.edges.length, 1);
  assert.equal(m.edges[0].arrow, "invisible");
});

test("parser: node IDs may contain dots", () => {
  const src = `flowchart LR
    pkg.A --> pkg.B`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.nodes.has("pkg.A"), true);
  assert.equal(m.nodes.has("pkg.B"), true);
  assert.equal(m.edges.length, 1);
});

test("flowchartToDrawio: invisible edge has no stroke", () => {
  const src = `flowchart LR
    A ~~~ B`;
  const { xml } = flowchartToDrawio(src);
  // The invisible edge must still create an edge cell, but with no stroke
  // so it doesn't visually appear.
  assert.match(
    xml,
    /<mxCell id="edge-1"[^>]*style="[^"]*strokeColor=none[^"]*"[^>]*edge="1"/
  );
});

test("parser: bidirectional <--> keeps both sides", () => {
  const src = `flowchart LR
    M1 <--> M2
    M3 <==> M4
    M5 <-.-> M6`;
  const m = parseMermaidFlowchart(src);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.edges.length, 3);
  assert.equal(m.edges[0].arrow, "bidirectional");
  assert.equal(m.edges[1].arrow, "thick-bidirectional");
  assert.equal(m.edges[2].arrow, "dashed-bidirectional");
});

test("flowchartToDrawio: bidirectional edge has start+end arrows", () => {
  const src = `flowchart LR
    A <--> B`;
  const { xml } = flowchartToDrawio(src);
  assert.match(
    xml,
    /<mxCell id="edge-1"[^>]*style="[^"]*startArrow=classic[^"]*endArrow=classic[^"]*"/
  );
});

test("parser: long arrow ------> is a single edge, not a label", () => {
  const src = `flowchart LR
    P --------> Q`;
  const m = parseMermaidFlowchart(src);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.nodes.has("Q"), true);
  assert.equal(m.edges.length, 1);
  assert.equal(m.edges[0].arrow, "normal");
});

test("parser: 'direction X' inside a subgraph is recognized (no ghost node)", () => {
  const src = `flowchart TB
    subgraph G["Group"]
      direction LR
      A --> B
    end`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.nodes.has("direction"), false, "no ghost 'direction' node");
  const sg = m.subgraphs.find((s) => s.id === "G");
  assert.equal(sg.direction, "LR");
});

test("parser: inline edge labels are unquoted", () => {
  const src = `flowchart LR
    A -- "hello" --> B`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.edges[0].label, "hello");
});

test("flowchartToDrawio: produces native mxCells (no data: URIs)", () => {
  const src = `flowchart LR
    subgraph G["G"]
      A[A] --> B[B]
    end`;
  const { xml, warnings } = flowchartToDrawio(src, { diagramName: "test" });
  assert.match(xml, /<mxfile/);
  assert.doesNotMatch(xml, /data:image/, "must not embed images");
  // Vertex cells for A, B, G
  assert.match(xml, /id="A"/);
  assert.match(xml, /id="B"/);
  assert.match(xml, /id="G"/);
  // Child cells should reference G as parent
  assert.match(xml, /parent="G"/);
  // Edge between A and B
  assert.match(xml, /edge="1"[^/]*source="A"[^/]*target="B"/);
  assert.deepEqual(warnings, []);
});

test("flowchartToDrawio: edge labels appear as value=", () => {
  const src = `flowchart LR
    A -- ping --> B`;
  const { xml } = flowchartToDrawio(src);
  assert.match(xml, /value="ping"[^>]*edge="1"/);
});

test("flowchartToDrawio: real-world delivery diagram", () => {
  const src = `flowchart LR
    subgraph Webshop["Webshop"]
        UI[Order Confirmation]
        DS[Delivery Status Page]
    end
    subgraph Backend["delivery-api"]
        OS[OrderService]
        Judge[Multi-Robot Judgment]
    end
    UI -- 注文確定 --> OS
    OS -- 容積判定 --> Judge`;
  const { xml, warnings } = flowchartToDrawio(src);
  assert.deepEqual(warnings, []);
  // Both subgraphs as containers
  assert.match(xml, /id="Webshop"[^/]*value="Webshop"/);
  assert.match(xml, /id="Backend"[^/]*value="delivery-api"/);
  // Japanese label preserved
  assert.match(xml, /value="注文確定"/);
});

// Helper: extract numeric attribute from the cell whose id matches `id`.
function attr(xml, id, name) {
  const cell = xml.match(
    new RegExp(`<mxCell id="${id}"[^>]*>\\s*<mxGeometry[^/]*/>`)
  );
  if (!cell) return null;
  const v = cell[0].match(new RegExp(`\\b${name}="([^"]+)"`));
  return v ? parseFloat(v[1]) : null;
}

test("flowchartToDrawio: subgraph stays tight even with cross-subgraph edges", () => {
  // The Webshop subgraph contains UI and DS. UI points into Backend; DS gets
  // its input from Tracker, on the OTHER side of the diagram. In a naive
  // single-shot dagre compound layout, UI would be placed near Backend and
  // DS near Tracker, stretching Webshop across the entire canvas. The
  // hierarchical layout should keep Webshop tight.
  const src = `flowchart LR
    subgraph Webshop["Webshop"]
        UI[Order Confirmation]
        DS[Delivery Status Page]
    end
    subgraph Backend["Backend"]
        OS[OrderService]
    end
    subgraph Tracker["Tracker"]
        SR[SignalR]
    end
    UI --> OS
    SR --> DS`;
  const { xml } = flowchartToDrawio(src);
  const wsW = attr(xml, "Webshop", "width");
  // Webshop only contains 2 short-label rectangles. It must not be wider
  // than ~400 px even when UI and DS link to opposite sides.
  assert.ok(
    wsW !== null && wsW < 400,
    `Webshop should be tight, got width=${wsW}`
  );
});

test("parser: classDef / class / linkStyle / style are captured into the model", () => {
  const src = `flowchart LR
    classDef warn fill:#ffe,stroke:#aa0
    A[Start]:::warn --> B
    B --> C
    style B fill:#dae8fc,stroke:#6c8ebf
    class C warn
    linkStyle 0 stroke:#f00
    linkStyle default stroke:#999`;
  const m = parseMermaidFlowchart(src);
  assert.deepEqual(m.classDefs.warn, { fill: "#ffe", stroke: "#aa0" });
  assert.deepEqual(m.nodes.get("A").classes, ["warn"]);
  assert.deepEqual(m.styles.B, { fill: "#dae8fc", stroke: "#6c8ebf" });
  // class C warn ⇒ styles.C._classes includes "warn"
  assert.ok(m.styles.C._classes.includes("warn"));
  assert.deepEqual(m.linkStyles["0"], { stroke: "#f00" });
  assert.deepEqual(m.linkStyles.default, { stroke: "#999" });
});

test("flowchartToDrawio: class / classDef colours are baked into node styles", () => {
  const src = `flowchart LR
    classDef important fill:#f00,stroke:#000,color:#fff,stroke-width:3px
    A[Start]:::important --> B[Step]
    style B fill:#dae8fc,color:#003366,font-weight:bold`;
  const { xml } = flowchartToDrawio(src);
  const A = xml.match(/<mxCell id="A"[^>]*style="([^"]+)"/);
  const B = xml.match(/<mxCell id="B"[^>]*style="([^"]+)"/);
  assert.ok(A, "A cell must exist");
  assert.ok(B, "B cell must exist");
  assert.match(A[1], /fillColor=#f00/);
  assert.match(A[1], /strokeColor=#000/);
  assert.match(A[1], /fontColor=#fff/);
  assert.match(A[1], /strokeWidth=3/);
  assert.match(B[1], /fillColor=#dae8fc/);
  assert.match(B[1], /fontColor=#003366/);
  assert.match(B[1], /fontStyle=1/);
});

test("flowchartToDrawio: linkStyle (index + default) colours edges", () => {
  const src = `flowchart LR
    A --> B
    B --> C
    linkStyle 0 stroke:#f00,stroke-width:2
    linkStyle default stroke:#999`;
  const { xml } = flowchartToDrawio(src);
  const e1 = xml.match(/<mxCell id="edge-1"[^>]*style="([^"]+)"/);
  const e2 = xml.match(/<mxCell id="edge-2"[^>]*style="([^"]+)"/);
  assert.match(e1[1], /strokeColor=#f00/);
  assert.match(e1[1], /strokeWidth=2/);
  assert.match(e2[1], /strokeColor=#999/);
});

test("flowchartToDrawio: self-loop carries explicit entry/exit anchors", () => {
  const src = `flowchart LR
    A[Server] --> A`;
  const { xml } = flowchartToDrawio(src);
  const e = xml.match(/<mxCell id="edge-1"[^>]*style="([^"]+)"[^>]*source="A"[^>]*target="A"/);
  assert.ok(e, "self-loop edge must exist with source=target");
  assert.match(e[1], /exitX=1/);
  assert.match(e[1], /entryX=0\.75/);
});

test("flowchartToDrawio: nested subgraphs are also tight and have correct parent", () => {
  const src = `flowchart TB
    subgraph Outer["Outer"]
      subgraph Inner["Inner"]
        A[A]
        B[B]
      end
      C[C]
    end
    A --> C
    B --> C`;
  const { xml } = flowchartToDrawio(src);
  // Inner has Outer as drawio parent.
  assert.match(
    xml,
    /<mxCell id="Inner"[^>]*parent="Outer"/,
    "Inner subgraph must be a child of Outer"
  );
  // A and B are inside Inner.
  assert.match(xml, /<mxCell id="A"[^>]*parent="Inner"/);
  assert.match(xml, /<mxCell id="B"[^>]*parent="Inner"/);
  // C is a direct child of Outer.
  assert.match(xml, /<mxCell id="C"[^>]*parent="Outer"/);

  const innerW = attr(xml, "Inner", "width");
  const outerW = attr(xml, "Outer", "width");
  assert.ok(innerW < outerW, `Inner (${innerW}) must fit inside Outer (${outerW})`);
});

test("detectDiagramKind: handles YAML front matter blocks", async () => {
  const { detectDiagramKind, convertMermaidToDrawio } = await import(
    "../src/index.js"
  );
  const src = `---
title: My Title
---
flowchart LR
    A --> B`;
  assert.equal(detectDiagramKind(src), "flowchart");
  const xml = await convertMermaidToDrawio(src);
  assert.match(xml, /<diagram name="My Title"/);
});

test("detectDiagramKind: ignores %%{init}%% directives", async () => {
  const { detectDiagramKind } = await import("../src/index.js");
  const src = `%%{init: {'theme':'dark'}}%%
flowchart TD
    A --> B`;
  assert.equal(detectDiagramKind(src), "flowchart");
});

test("flowchartToDrawio: style <subgraphId> applies to the cluster frame", () => {
  const src = `flowchart LR
    subgraph G["Group"]
      A --> B
    end
    style G fill:#e8f4ff,stroke:#4a86e8`;
  const { xml } = flowchartToDrawio(src);
  const g = xml.match(/<mxCell id="G"[^>]*style="([^"]+)"/);
  assert.ok(g, "G cell exists");
  assert.match(g[1], /fillColor=#e8f4ff/);
  assert.match(g[1], /strokeColor=#4a86e8/);
});

test("regression: single _ or * in identifiers are NOT interpreted as markdown", () => {
  const src = `flowchart LR
    A[user_id_field] --> B[1*2*3]
    C[date_2024-01-15] --> D[foo_bar_baz]
    E[the user_id and order_id]
    F[*.txt only]`;
  const { xml } = flowchartToDrawio(src);
  // None of these patterns should have <i> tags injected — the markers are
  // glued to word characters or unmatched (`*.txt` has no closing `*`).
  assert.doesNotMatch(xml, /<i>/);
  assert.match(xml, /value="user_id_field"/);
  assert.match(xml, /value="1\*2\*3"/);
  assert.match(xml, /value="date_2024-01-15"/);
  assert.match(xml, /value="\*\.txt only"/);
});

test("italic: *foo* and _foo_ ARE converted when on a non-word boundary", () => {
  const src = `flowchart LR
    A[*important* notice]
    B[read _this_ carefully]
    G -- *italic edge* --> H
    H -- _underscore italic_ --> I
    K[start *one* and *two* end]`;
  const { xml } = flowchartToDrawio(src);
  assert.match(xml, /value="&lt;i&gt;important&lt;\/i&gt; notice"/);
  assert.match(xml, /value="read &lt;i&gt;this&lt;\/i&gt; carefully"/);
  assert.match(xml, /value="&lt;i&gt;italic edge&lt;\/i&gt;"/);
  assert.match(xml, /value="&lt;i&gt;underscore italic&lt;\/i&gt;"/);
  // Multiple italics in one label
  assert.match(xml, /value="start &lt;i&gt;one&lt;\/i&gt; and &lt;i&gt;two&lt;\/i&gt; end"/);
});

test("regression: **bold** and backtick `code` ARE converted to HTML", () => {
  const src = `flowchart LR
    A[**important** note]
    B -- ** highlighted ** --> C
    D[code is \`foo()\`]`;
  const { xml } = flowchartToDrawio(src);
  assert.match(xml, /&lt;b&gt;important&lt;\/b&gt;/);
  assert.match(xml, /&lt;b&gt; highlighted &lt;\/b&gt;/);
  assert.match(xml, /&lt;code&gt;foo\(\)&lt;\/code&gt;/);
});

test("regression: reserved keywords usable as node IDs", () => {
  const src = `flowchart LR
    style --> node1
    class --> node2
    classDef --> node3
    linkStyle --> node4`;
  const m = parseMermaidFlowchart(src);
  for (const id of ["style", "class", "classDef", "linkStyle", "node1", "node2", "node3", "node4"]) {
    assert.ok(m.nodes.has(id), `node "${id}" must be parsed as a node`);
  }
  assert.equal(m.edges.length, 4);
  // No directives should have been captured
  assert.deepEqual(m.styles, {});
  assert.deepEqual(m.classDefs, {});
  assert.deepEqual(m.linkStyles, {});
});

test("regression: v10 attribute form tolerates `}` and `,` inside labels", () => {
  const src = `flowchart LR
    A@{ shape: cyl, label: "has } brace" }
    B@{ shape: hex, label: "comma, inside" }
    A --> B`;
  const m = parseMermaidFlowchart(src);
  assert.equal(m.warnings.length, 0, `expected no warnings, got ${m.warnings.join(" | ")}`);
  assert.equal(m.nodes.get("A").label, "has } brace");
  assert.equal(m.nodes.get("A").shape, "cylinder");
  assert.equal(m.nodes.get("B").label, "comma, inside");
  assert.equal(m.nodes.get("B").shape, "hexagon");
});

test("regression: bidirectional same-pair edges use mirrored anchors", () => {
  const src = `flowchart LR
    A --> B
    B --> A`;
  const { xml } = flowchartToDrawio(src);
  const e1 = xml.match(/edge-1[^>]*style="([^"]+)"/);
  const e2 = xml.match(/edge-2[^>]*style="([^"]+)"/);
  assert.match(e1[1], /exitX=1[\s;]/);
  assert.match(e1[1], /entryX=0[\s;]/);
  // Reverse edge must flip the X anchors so it exits from the upstream side.
  assert.match(e2[1], /exitX=0[\s;]/);
  assert.match(e2[1], /entryX=1[\s;]/);
});

test("regression: diagramName precedence — explicit > frontmatter > default", async () => {
  const { convertMermaidToDrawio } = await import("../src/index.js");
  const src = `---
title: From Frontmatter
---
flowchart LR
    A --> B`;
  // 1. explicit diagramName wins
  const a = await convertMermaidToDrawio(src, { diagramName: "Explicit" });
  assert.match(a, /<diagram name="Explicit"/);
  // 2. frontmatter wins over defaultDiagramName
  const b = await convertMermaidToDrawio(src, { defaultDiagramName: "DefaultName" });
  assert.match(b, /<diagram name="From Frontmatter"/);
  // 3. no frontmatter, no explicit → defaultDiagramName is used
  const src2 = `flowchart LR
    A --> B`;
  const c = await convertMermaidToDrawio(src2, { defaultDiagramName: "DefaultName" });
  assert.match(c, /<diagram name="DefaultName"/);
});
