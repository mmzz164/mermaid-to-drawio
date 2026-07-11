import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTreemap, treemapToDrawio } from "../src/treemap-to-drawio.js";
import { parseBlock, blockToDrawio } from "../src/block-to-drawio.js";
import { parseArchitecture, architectureToDrawio } from "../src/architecture-to-drawio.js";
import { parseZenuml } from "../src/zenuml-to-drawio.js";
import { detectDiagramKind, convertMermaidToDrawio } from "../src/index.js";
import { findXmlAttributeProblems } from "../src/drawio-xml.js";

// ---------- detection ----------

test("detectDiagramKind recognizes the newly-native kinds", () => {
  assert.equal(detectDiagramKind("treemap-beta\n  \"A\": 1"), "treemap");
  assert.equal(detectDiagramKind("block-beta\n  a"), "block");
  assert.equal(detectDiagramKind("architecture-beta\n  service a"), "architecture");
  assert.equal(detectDiagramKind("zenuml\n  A->B: x"), "zenuml");
});

// ---------- treemap ----------

test("treemap: hierarchy + bottom-up value aggregation", () => {
  const m = parseTreemap(`treemap-beta
"A"
    "A1": 10
    "Sub"
        "S1": 15
        "S2": 5
"B": 30`);
  assert.deepEqual(m.warnings, []);
  const [a, b] = m.root.children;
  assert.equal(a.name, "A");
  assert.equal(a.value, 30); // 10 + (15 + 5)
  const sub = a.children.find((c) => c.name === "Sub");
  assert.equal(sub.value, 20);
  assert.equal(b.value, 30);
});

test("treemap: areas are proportional to values", () => {
  const { xml } = treemapToDrawio(`treemap-beta
"Big": 90
"Small": 10`);
  const areas = [...xml.matchAll(/id="tm-\d+"[\s\S]*?width="([\d.]+)" height="([\d.]+)"/g)]
    .map((m) => Number(m[1]) * Number(m[2]));
  // The larger value's tile has ~9x the area of the smaller.
  const [a1, a2] = areas.slice(0, 2).sort((x, y) => y - x);
  assert.ok(a1 / a2 > 5, `expected big tile much larger (ratio ${a1 / a2})`);
});

// ---------- block ----------

test("block: columns, spans, space, groups, and edges parse", () => {
  const m = parseBlock(`block-beta
  columns 3
  a["A"] b c
  space:3
  block:g:2
    d e
  end
  f
  a --> b`);
  assert.equal(m.columns, 3);
  const group = m.items.find((it) => it.type === "group");
  assert.ok(group && group.children.filter((c) => c.type === "block").length === 2);
  assert.ok(m.items.some((it) => it.type === "space"));
  assert.deepEqual(m.edges[0], { from: "a", to: "b", label: "" });
});

test("block: shape wrappers map to distinct styles", () => {
  const { xml } = blockToDrawio(`block-beta
  columns 3
  a(("circ")) b{"rho"} c["sq"]`);
  assert.match(xml, /id="a"[^>]*ellipse/);
  assert.match(xml, /id="b"[^>]*rhombus/);
});

// ---------- architecture ----------

test("architecture: groups, services with icons, `in`, and anchored edges", () => {
  const m = parseArchitecture(`architecture-beta
  group api(cloud)[API]
  service db(database)[DB] in api
  service srv(server)[Server] in api
  db:L -- R:srv`);
  assert.deepEqual(m.warnings, []);
  assert.ok(m.groups.has("api"));
  assert.equal(m.services.get("db").group, "api");
  assert.equal(m.services.get("db").icon, "database");
  assert.deepEqual(m.edges[0], { from: "db", fromSide: "L", to: "srv", toSide: "R", arrow: "--" });
  const { xml } = architectureToDrawio(`architecture-beta
  group api(cloud)[API]
  service db(database)[DB] in api`);
  assert.match(xml, /id="db"[^>]*shape=cylinder/);
});

// ---------- zenuml ----------

test("zenuml: translates to a sequence model (calls, returns, actors)", () => {
  const m = parseZenuml(`zenuml
  @Actor User
  User->Web.submit(x)
  Web->Auth.verify() {
    return token
  }
  Web->User: welcome`);
  assert.deepEqual(m.warnings, []);
  assert.ok(m.participants.find((p) => p.id === "User" && p.isActor));
  const msgs = m.steps.filter((s) => s.type === "message");
  assert.ok(msgs.some((s) => s.text === "submit(x)"));
  const ret = msgs.find((s) => s.text === "token");
  assert.ok(ret && ret.line === "dashed" && ret.from === "Auth" && ret.to === "Web");
  assert.ok(m.steps.some((s) => s.type === "activate" && s.participant === "Auth"));
});

// ---------- end-to-end: all four emit valid, non-blank, dup-free XML ----------

test("newly-native kinds convert to valid non-blank XML (no duplicate ids)", async () => {
  const sources = [
    `treemap-beta\n"A"\n    "x": 1\n    "y": 2`,
    `block-beta\n  columns 2\n  a b\n  a --> b`,
    `architecture-beta\n  service a(server)[A]\n  service b(database)[B]\n  a:R -- L:b`,
    `zenuml\n  A->B.m() {\n    return r\n  }`,
  ];
  for (const src of sources) {
    const xml = await convertMermaidToDrawio(src);
    assert.ok((xml.match(/<mxCell/g) || []).length >= 3, `blank: ${src.slice(0, 15)}`);
    assert.deepEqual(findXmlAttributeProblems(xml), [], `xml problems: ${src.slice(0, 15)}`);
  }
});
