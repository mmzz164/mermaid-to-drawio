import { test } from "node:test";
import assert from "node:assert/strict";

import { parseJourney, journeyToDrawio } from "../src/journey-to-drawio.js";
import { parseTimeline, timelineToDrawio } from "../src/timeline-to-drawio.js";
import { parseQuadrantChart, quadrantToDrawio } from "../src/quadrant-to-drawio.js";
import { parseKanban, kanbanToDrawio } from "../src/kanban-to-drawio.js";
import { parsePacket, packetToDrawio } from "../src/packet-to-drawio.js";
import { parseXychart, xychartToDrawio } from "../src/xychart-to-drawio.js";
import { parseRadar, radarToDrawio } from "../src/radar-to-drawio.js";
import { parseSankey, sankeyToDrawio } from "../src/sankey-to-drawio.js";

// ---------- journey ----------

test("journey: parser reads sections, scores, actors", () => {
  const m = parseJourney(`journey
  title Day
  section Work
    Make tea: 5: Me
    Do work: 1: Me, Cat
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.title, "Day");
  assert.deepEqual(m.actors, ["Me", "Cat"]);
  assert.equal(m.sections[0].tasks[1].score, 1);
  assert.deepEqual(m.sections[0].tasks[1].actors, ["Me", "Cat"]);
});

test("journey: renderer emits score markers and actor legend", () => {
  const { xml, warnings } = journeyToDrawio(`journey
  section S
    Good: 5: Me
    Bad: 1: Me, Cat
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="5"/);
  assert.match(xml, /value="1"/);
  assert.match(xml, /j-leg-lab-1/); // two actors in the legend
  // High score sits higher on the page (smaller y).
  const y5 = +xml.match(/id="j-dot-0"[^>]*>.*?<mxGeometry[^>]*y="(\d+)"/s)[1];
  const y1 = +xml.match(/id="j-dot-1"[^>]*>.*?<mxGeometry[^>]*y="(\d+)"/s)[1];
  assert.ok(y5 < y1);
});

// ---------- timeline ----------

test("timeline: parser handles multi-event periods and continuations", () => {
  const m = parseTimeline(`timeline
  title T
  section Early
    2002 : LinkedIn
    2004 : Facebook : Google
         : Flickr
`);
  assert.deepEqual(m.warnings, []);
  const periods = m.sections[0].periods;
  assert.equal(periods[0].label, "2002");
  assert.deepEqual(periods[1].events, ["Facebook", "Google", "Flickr"]);
});

test("timeline: renderer draws periods, events, section band", () => {
  const { xml, warnings } = timelineToDrawio(`timeline
  section Early
    2002 : LinkedIn
    2004 : Facebook
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="Early"/);
  assert.match(xml, /value="2002"/);
  assert.match(xml, /value="LinkedIn"/);
  assert.match(xml, /tl-axis/);
});

// ---------- quadrantChart ----------

test("quadrantChart: parser reads axes, quadrants, points", () => {
  const m = parseQuadrantChart(`quadrantChart
  x-axis Low --> High
  y-axis Weak --> Strong
  quadrant-1 Expand
  A: [0.25, 0.75]
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.axes.xRight, "High");
  assert.equal(m.quadrants[0], "Expand");
  assert.deepEqual(m.points[0], { label: "A", x: 0.25, y: 0.75 });
});

test("quadrantChart: point position maps y up", () => {
  const { xml } = quadrantToDrawio(`quadrantChart
  TopRight: [1, 1]
  BottomLeft: [0, 0]
`);
  const g1 = xml.match(/id="q-pt-0"[^>]*>.*?<mxGeometry x="(\d+)" y="(\d+)"/s);
  const g2 = xml.match(/id="q-pt-1"[^>]*>.*?<mxGeometry x="(\d+)" y="(\d+)"/s);
  assert.ok(+g1[1] > +g2[1], "TopRight is further right");
  assert.ok(+g1[2] < +g2[2], "TopRight is higher up");
});

// ---------- kanban ----------

test("kanban: parser splits columns and cards, reads metadata", () => {
  const m = parseKanban(`kanban
  Todo
    [Write docs]
    id2[Blog post]
    @{ assigned: 'alice', priority: 'High' }
  Done
    [Ship it]
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.columns.length, 2);
  assert.equal(m.columns[0].name, "Todo");
  assert.equal(m.columns[0].cards[1].text, "Blog post");
  assert.equal(m.columns[0].cards[1].meta.priority, "High");
  assert.equal(m.columns[1].cards[0].text, "Ship it");
});

test("kanban: renderer draws columns and priority border", () => {
  const { xml, warnings } = kanbanToDrawio(`kanban
  Todo
    a[Task]
    @{ priority: 'High' }
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="Todo"/);
  assert.match(xml, /value="Task"/);
  assert.match(xml, /strokeColor=#e06c5f/); // High priority border
});

// ---------- packet ----------

test("packet: parser reads ranges, single bits, relative fields", () => {
  const m = parsePacket(`packet-beta
  0-15: "Source"
  16: "Flag"
  +15: "Rest"
`);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.fields[1], { start: 16, end: 16, label: "Flag" });
  assert.deepEqual(m.fields[2], { start: 17, end: 31, label: "Rest" });
});

test("packet: fields spanning a row boundary are split", () => {
  const { xml, warnings } = packetToDrawio(`packet-beta
  0-15: "A"
  16-47: "B"
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="B"/);
  assert.match(xml, /value="B \(cont\.\)"/);
});

// ---------- xychart ----------

test("xychart: parser reads axes and series", () => {
  const m = parseXychart(`xychart-beta
  title "Sales"
  x-axis [jan, feb]
  y-axis "Rev" 0 --> 100
  bar "2025" [10, 20]
  line [15, 25]
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.title, "Sales");
  assert.deepEqual(m.categories, ["jan", "feb"]);
  assert.deepEqual(m.yRange, [0, 100]);
  assert.equal(m.series.length, 2);
  assert.equal(m.series[0].name, "2025");
});

test("xychart: renderer emits bars, a line, and a legend", () => {
  const { xml, warnings } = xychartToDrawio(`xychart-beta
  x-axis [a, b, c]
  bar "s1" [1, 2, 3]
  line "s2" [3, 2, 1]
`);
  assert.deepEqual(warnings, []);
  assert.equal((xml.match(/xy-bar-/g) || []).length, 3);
  assert.match(xml, /xy-line-1/);
  assert.match(xml, /value="s1"/);
  assert.match(xml, /value="s2"/);
});

test("xychart: horizontal is accepted with a warning", () => {
  const m = parseXychart(`xychart-beta horizontal
  bar [1]
`);
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /horizontal/);
});

// ---------- radar ----------

test("radar: parser reads axes, curves, min/max", () => {
  const m = parseRadar(`radar-beta
  axis a["A"], b["B"], c["C"]
  curve x["X"]{1, 2, 3}
  curve y{3, 2, 1}
  max 5
`);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.axes, ["A", "B", "C"]);
  assert.equal(m.curves[0].name, "X");
  assert.equal(m.curves[1].name, "y");
  assert.equal(m.max, 5);
});

test("radar: renderer draws rings, spokes, closed curves", () => {
  const { xml, warnings } = radarToDrawio(`radar-beta
  axis a["A"], b["B"], c["C"]
  curve x["X"]{1, 2, 3}
  max 3
`);
  assert.deepEqual(warnings, []);
  assert.equal((xml.match(/rd-ring-/g) || []).length, 4);
  assert.equal((xml.match(/rd-spoke-/g) || []).length, 3);
  assert.match(xml, /rd-curve-0/);
  assert.match(xml, /value="X"/);
});

// ---------- sankey ----------

test("sankey: parser reads CSV links incl. quoted names", () => {
  const m = parseSankey(`sankey-beta
  "a, plus",b,10
  b,c,4.5
`);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.links[0], { from: "a, plus", to: "b", value: 10 });
});

test("sankey: nodes are layered and edges width-scaled", () => {
  const { xml, warnings } = sankeyToDrawio(`sankey-beta
  a,b,10
  b,c,4
`);
  assert.deepEqual(warnings, []);
  // Three nodes in three layers: x positions strictly increase.
  const xs = [...xml.matchAll(/id="sk-n-\d+"[^>]*>.*?<mxGeometry x="(\d+)"/gs)].map((m2) => +m2[1]);
  assert.equal(xs.length, 3);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2]);
  // Wider flow gets a wider stroke.
  const w1 = +xml.match(/id="sk-e-0"[^>]*strokeWidth=(\d+)/)[1];
  const w2 = +xml.match(/id="sk-e-1"[^>]*strokeWidth=(\d+)/)[1];
  assert.ok(w1 > w2);
});

// ---------- kanban inline metadata (mermaid's canonical form) ----------

test("kanban: inline @{} metadata attaches to its card", () => {
  const m = parseKanban(`kanban
  Todo
    id1[Task A]@{ assigned: 'bob', priority: 'High' }
    [Task B]`);
  assert.deepEqual(m.warnings, []);
  const [a, b] = m.columns[0].cards;
  assert.equal(a.text, "Task A");
  assert.equal(a.meta.assigned, "bob");
  assert.equal(a.meta.priority, "High");
  assert.equal(b.text, "Task B");
});

test("quadrant: quadrant labels sit at the top of each cell", () => {
  const { xml } = quadrantToDrawio(`quadrantChart
  quadrant-1 One
  quadrant-2 Two
  quadrant-3 Three
  quadrant-4 Four
  P: [0.8, 0.8]`);
  const quadStyles = [...xml.matchAll(/<mxCell id="q-quad-\d"[^>]*style="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(quadStyles.length, 4);
  for (const s of quadStyles) assert.match(s, /verticalAlign=top/);
});

test("quadrant: point labels sit below their dots (clear of quadrant titles)", () => {
  const { xml } = quadrantToDrawio(`quadrantChart
  quadrant-1 One
  quadrant-2 Two
  quadrant-3 Three
  quadrant-4 Four
  P: [0.2, 0.95]`);
  const dot = xml.match(/id="q-pt-0"[^>]*>\s*<mxGeometry x="[\d.]+" y="([\d.]+)"/);
  const lbl = xml.match(/id="q-ptl-0"[^>]*>\s*<mxGeometry x="[\d.-]+" y="([\d.]+)"/);
  assert.ok(dot && lbl);
  assert.ok(Number(lbl[1]) > Number(dot[1]), "label y is below the dot y");
});
