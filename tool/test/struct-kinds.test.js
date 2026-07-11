import { test } from "node:test";
import assert from "node:assert/strict";

import { parseGitGraph, gitGraphToDrawio } from "../src/gitgraph-to-drawio.js";
import { parseRequirementDiagram, requirementToDrawio } from "../src/requirement-to-drawio.js";
import { parseC4, c4ToDrawio } from "../src/c4-to-drawio.js";
import { convertMermaidToDrawio } from "../src/index.js";

// ---------- gitGraph ----------

test("gitGraph: parser tracks branches, merges, cherry-picks", () => {
  const m = parseGitGraph(`gitGraph
  commit id: "init"
  branch develop
  commit id: "d1"
  checkout main
  commit
  merge develop tag: "v1"
  cherry-pick id: "d1"
`);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.branches.map((b) => b.name), ["main", "develop"]);
  const merge = m.commits.find((c) => c.type === "MERGE");
  assert.equal(merge.tag, "v1");
  assert.equal(merge.parents.length, 2);
  const cp = m.commits.find((c) => c.type === "CHERRY_PICK");
  assert.ok(cp.parents.includes("d1"));
  // `branch develop` also checks out: d1 is on develop.
  assert.equal(m.commits.find((c) => c.id === "d1").branch, "develop");
});

test("gitGraph: renderer draws lanes, dots, tags, cross-lane edges", () => {
  const { xml, warnings } = gitGraphToDrawio(`gitGraph
  commit id: "a"
  branch dev
  commit id: "b"
  checkout main
  merge dev tag: "v1"
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="main"/);
  assert.match(xml, /value="dev"/);
  assert.match(xml, /value="v1"/); // tag
  assert.equal((xml.match(/gg-c-/g) || []).length, 3);
  // Merge has 2 parents; a->b crosses lanes: at least one bend point.
  assert.ok((xml.match(/gg-e-/g) || []).length >= 3);
  assert.match(xml, /<Array as="points">/);
});

test("gitGraph: unknown checkout/merge produce warnings, not crashes", () => {
  const m = parseGitGraph(`gitGraph
  commit
  checkout nope
  merge nope2
`);
  assert.equal(m.warnings.length, 2);
});

// ---------- requirementDiagram ----------

test("requirement: parser reads blocks and both relation directions", () => {
  const m = parseRequirementDiagram(`requirementDiagram
  requirement r1 {
    id: 1
    text: hello
    risk: high
  }
  element e1 {
    type: sim
  }
  e1 - satisfies -> r1
  r1 <- verifies - e1
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.nodes.length, 2);
  assert.equal(m.nodes[0].fields.risk, "high");
  assert.deepEqual(m.relations[0], { from: "e1", to: "r1", type: "satisfies" });
  assert.deepEqual(m.relations[1], { from: "e1", to: "r1", type: "verifies" });
});

test("requirement: renderer emits stereotype boxes and dashed edges", () => {
  const { xml, warnings } = requirementToDrawio(`requirementDiagram
  functionalRequirement fr {
    id: 1.1
    text: log in
  }
  element app {
    type: web
  }
  app - satisfies -> fr
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /&amp;lt;&amp;lt;functionalrequirement&amp;gt;&amp;gt;|&lt;&lt;functionalrequirement&gt;&gt;/);
  assert.match(xml, /satisfies/);
  assert.match(xml, /dashed=1/);
});

// ---------- C4 ----------

test("C4: parser handles boundaries, elements, rels, $args", () => {
  const m = parseC4(`C4Context
  title Ctx
  Person(u, "User", "desc")
  Enterprise_Boundary(b0, "Bank") {
    System(s1, "Core", "core system")
    System_Boundary(b1, "Inner") {
      SystemDb(db, "DB", "data", $tags="v1.0")
    }
  }
  Rel(u, s1, "uses", "HTTPS")
  BiRel(s1, db, "sync")
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.title, "Ctx");
  const b0 = m.root.children.find((c) => c.alias === "b0");
  assert.equal(b0.kind, "boundary");
  const b1 = b0.children.find((c) => c.alias === "b1");
  assert.ok(b1.children.find((c) => c.alias === "db"));
  assert.equal(m.rels.length, 2);
  assert.equal(m.rels[1].bidir, true);
});

test("C4: renderer nests boundary boxes around their members", () => {
  const { xml, warnings } = c4ToDrawio(`C4Context
  Person(u, "User")
  System_Boundary(b, "Bank") {
    System(s, "Core")
  }
  Rel(u, s, "uses")
`);
  assert.deepEqual(warnings, []);
  const bg = xml.match(/id="b"[^>]*>.*?<mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/s);
  const sg = xml.match(/id="s"[^>]*>.*?<mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/s);
  assert.ok(bg && sg);
  const [bx, by, bw, bh] = bg.slice(1).map(Number);
  const [sx, sy, sw, sh] = sg.slice(1).map(Number);
  assert.ok(sx >= bx && sy >= by && sx + sw <= bx + bw && sy + sh <= by + bh, "system inside boundary");
  assert.match(xml, /c4-rel-0/);
  assert.match(xml, /dashed=1/); // boundary border
});

test("C4: person and external colors follow the C4 convention", () => {
  const { xml } = c4ToDrawio(`C4Context
  Person(u, "User")
  System_Ext(x, "Other")
  Rel(u, x, "uses")
`);
  assert.match(xml, /fillColor=#08427B/);
  assert.match(xml, /fillColor=#999999/);
});

// ---------- routing ----------

test("convertMermaidToDrawio routes all new kinds natively", async () => {
  const sources = [
    "journey\n  section S\n    T: 3: Me",
    "timeline\n  2020 : Event",
    "quadrantChart\n  A: [0.5, 0.5]",
    "kanban\n  Todo\n    [Task]",
    "packet-beta\n  0-7: \"Byte\"",
    "xychart-beta\n  bar [1, 2]",
    "radar-beta\n  axis a[\"A\"], b[\"B\"], c[\"C\"]\n  curve x{1, 2, 3}",
    "sankey-beta\n  a,b,5",
    "gitGraph\n  commit",
    "requirementDiagram\n  requirement r {\n    id: 1\n  }",
    "C4Context\n  Person(u, \"U\")",
  ];
  for (const src of sources) {
    const xml = await convertMermaidToDrawio(src);
    assert.match(xml, /<mxfile/, src.slice(0, 20));
    assert.doesNotMatch(xml, /data:image/, src.slice(0, 20));
  }
});

test("gitGraph: a branch lane line is bounded to its active range, not full-width", () => {
  const { xml } = gitGraphToDrawio(`gitGraph
  commit id: "a"
  commit id: "a2"
  branch dev
  commit id: "b"
  checkout main
  commit id: "c"
`);
  const laneSpan = (i) => {
    const m = xml.match(new RegExp(`id="gg-lane-${i}"[\\s\\S]*?<mxPoint x="(\\d+)"[^>]*as="sourcePoint"[^>]*/>\\s*<mxPoint x="(\\d+)"[^>]*as="targetPoint"`));
    return m ? [+m[1], +m[2]] : null;
  };
  const main = laneSpan(0);
  const dev = laneSpan(1); // dev forks from a2 and is never merged
  // dev starts at its fork point (a2), not at the chart's left edge (main's start = a).
  assert.ok(dev[0] > main[0], `dev starts right of main (dev ${dev[0]} vs main ${main[0]})`);
  // Unmerged dev ends around its last commit (b), before main's end (c).
  assert.ok(dev[1] < main[1], `unmerged dev ends before main (dev ${dev[1]} vs main ${main[1]})`);
});

test("C4: SystemDb type annotation says System Db", () => {
  const { xml } = c4ToDrawio(`C4Context
  Person(u, "User")
  SystemDb(db, "DB", "data")
  Rel(u, db, "reads")
`);
  assert.match(xml, /\[System Db\]/);
});

test("C4: a rel crossing another element bows around it; adjacent rels stay direct", () => {
  const { xml } = c4ToDrawio(`C4Context
  System(a, "Top")
  System(b, "Middle")
  System(c, "Bottom")
  Rel(a, b, "next")
  Rel(b, c, "next2")
  Rel(a, c, "skip")
`);
  // a→b is adjacent: no waypoints.
  const direct = xml.match(/id="c4-rel-0".*?<\/mxCell>/s)[0];
  assert.doesNotMatch(direct, /<Array as="points">/);
  // a→c passes through b's box: routed around the side with two waypoints.
  const bow = xml.match(/id="c4-rel-2".*?<\/mxCell>/s)[0];
  assert.match(bow, /exitX=1/);
  assert.equal((bow.match(/<mxPoint /g) || []).length, 2);
});

test("gitGraph: merge/cherry-pick auto-ids are not printed; explicit ids are", () => {
  const { xml } = gitGraphToDrawio(`gitGraph
  commit id: "init"
  branch dev
  commit id: "d1"
  checkout main
  merge dev
  cherry-pick id: "d1"
`);
  // Explicit ids still shown.
  assert.match(xml, /value="init"/);
  // The auto-generated merge id (c1/c2/...) is not printed as an id label.
  assert.doesNotMatch(xml, /<mxCell id="gg-id-[0-9]+" value="c\d+"/);
});
