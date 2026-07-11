import { test } from "node:test";
import assert from "node:assert/strict";

import { parseStateDiagram } from "../src/state-parser.js";
import { stateToDrawio } from "../src/state-to-drawio.js";
import { detectDiagramKind, convertMermaidToDrawio } from "../src/index.js";

test("state parser: basic states and transitions", () => {
  const src = `stateDiagram-v2
    [*] --> Still
    Still --> Moving : go
    Moving --> [*]`;
  const m = parseStateDiagram(src);
  // [*] start, Still, Moving, [*] end => 4 states
  assert.equal(m.states.size, 4);
  assert.equal(m.transitions.length, 3);
  const startTr = m.transitions[0];
  assert.equal(m.states.get(startTr.from).kind, "start");
  assert.equal(m.transitions[1].label, "go");
});

test("state parser: composite states keep children scoped", () => {
  const src = `stateDiagram-v2
    [*] --> Active
    state Active {
      [*] --> Locked
      Locked --> Unlocked : key
      Unlocked --> [*]
    }
    Active --> [*]`;
  const m = parseStateDiagram(src);
  assert.equal(m.composites.length, 1);
  const c = m.composites[0];
  assert.equal(c.id, "Active");
  // Locked & Unlocked are children of Active
  assert.equal(m.states.get("Locked").parent, "Active");
  assert.equal(m.states.get("Unlocked").parent, "Active");
});

test("state parser: stereotyped states are kept with their kind", () => {
  const src = `stateDiagram-v2
    state fk <<fork>>
    state jn <<join>>
    state cm <<choice>>`;
  const m = parseStateDiagram(src);
  assert.equal(m.states.get("fk").kind, "fork");
  assert.equal(m.states.get("jn").kind, "join");
  assert.equal(m.states.get("cm").kind, "choice");
});

test("state parser: multi-line notes are collected", () => {
  const src = `stateDiagram-v2
    [*] --> A
    note left of A
      first line
      second line
    end note
    A --> [*]`;
  const m = parseStateDiagram(src);
  assert.equal(m.notes.length, 1);
  assert.equal(m.notes[0].target, "A");
  assert.match(m.notes[0].text, /first line\nsecond line/);
});

test("stateToDrawio: pseudo states have correct shapes", () => {
  const src = `stateDiagram-v2
    [*] --> A
    A --> [*]`;
  const { xml } = stateToDrawio(src);
  // start = filled circle ellipse, end = endState shape
  assert.match(xml, /style="ellipse;fillColor=#000000/);
  assert.match(xml, /shape=endState/);
});

test("stateToDrawio: composite states are containers of their children", () => {
  const src = `stateDiagram-v2
    state Outer {
      A --> B
    }`;
  const { xml } = stateToDrawio(src);
  assert.match(xml, /<mxCell id="A"[^>]*parent="Outer"/);
  assert.match(xml, /<mxCell id="B"[^>]*parent="Outer"/);
});

test("convertMermaidToDrawio: native state end-to-end via detector", async () => {
  const src = `stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Idle : stop
    Running --> [*]`;
  assert.equal(detectDiagramKind(src), "state");
  const xml = await convertMermaidToDrawio(src);
  assert.match(xml, /<mxCell id="Idle"/);
  assert.match(xml, /<mxCell id="Running"/);
  assert.match(xml, /value="start"/);
  assert.match(xml, /value="stop"/);
});

test("state parser: -- splits a composite into concurrent regions", () => {
  const m = parseStateDiagram(`stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> CapsLockOn : EvCapsLockPressed
  }
`);
  assert.deepEqual(m.warnings, []);
  const regions = m.composites.filter((c) => c.isRegion);
  assert.equal(regions.length, 2);
  assert.ok(regions.every((r) => r.parent === "Active"));
  assert.equal(m.states.get("NumLockOff").parent, "Active__region1");
  assert.equal(m.states.get("CapsLockOff").parent, "Active__region2");
});

test("state parser: -- outside a composite warns", () => {
  const m = parseStateDiagram(`stateDiagram-v2
  A --> B
  --
`);
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /outside a composite/);
});

test("state renderer: regions stack vertically with a dashed divider", () => {
  const { xml, warnings } = stateToDrawio(`stateDiagram-v2
  state Active {
    A1 --> A2
    --
    B1 --> B2
  }
`);
  assert.deepEqual(warnings, []);
  // Divider between the two regions, parented to the composite.
  assert.match(xml, /id="Active-regsep-1"[^>]*parent="Active"/);
  assert.match(xml, /dashed=1/);
  // Regions are invisible containers.
  assert.match(xml, /id="Active__region1"[^>]*style="[^"]*strokeColor=none/);
  // Region 2 sits below region 1 (its y offset inside Active is positive).
  const r1 = xml.match(/id="Active__region1"[^>]*>.*?<mxGeometry x="(-?\d+)" y="(-?\d+)"/s);
  const r2 = xml.match(/id="Active__region2"[^>]*>.*?<mxGeometry x="(-?\d+)" y="(-?\d+)"/s);
  assert.ok(+r2[2] > +r1[2], "region2 below region1");
  // States are parented to their regions.
  assert.match(xml, /id="A1"[^>]*parent="Active__region1"/);
  assert.match(xml, /id="B1"[^>]*parent="Active__region2"/);
});

test("state renderer: composite referenced before declaration is not emitted twice", () => {
  const { xml } = stateToDrawio(`stateDiagram-v2
  [*] --> Active
  state Active {
    A --> B
  }
`);
  assert.equal((xml.match(/<mxCell id="Active"/g) || []).length, 1);
  // ...and it is the composite frame, not a plain state.
  assert.match(xml, /id="Active"[^>]*style="[^"]*verticalAlign=top/);
});
