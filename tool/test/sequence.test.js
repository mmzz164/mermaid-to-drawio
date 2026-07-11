import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSequenceDiagram } from "../src/sequence-parser.js";
import { sequenceToDrawio } from "../src/sequence-to-drawio.js";
import { detectDiagramKind, convertMermaidToDrawio } from "../src/index.js";

test("seq parser: + and - sigils on arrows do not drop messages", () => {
  const src = `sequenceDiagram
    A->>+B: req
    B-->>-A: res`;
  const model = parseSequenceDiagram(src);
  const msgs = model.steps.filter((s) => s.type === "message");
  assert.equal(msgs.length, 2);
  const acts = model.steps.filter((s) => s.type === "activate");
  const deacts = model.steps.filter((s) => s.type === "deactivate");
  assert.equal(acts.length, 1);
  assert.equal(deacts.length, 1);
  assert.equal(acts[0].participant, "B");
  assert.equal(deacts[0].participant, "B");
  assert.deepEqual(model.warnings, []);
});

test("seq parser: box and rect blocks are accepted (no parse failures)", () => {
  const src = `sequenceDiagram
    box "Group"
      participant A
      participant B
    end
    rect rgb(200, 220, 240)
      A->>B: hello
    end`;
  const model = parseSequenceDiagram(src);
  assert.deepEqual(model.warnings, []);
  assert.deepEqual(
    model.participants.map((p) => p.id).sort(),
    ["A", "B"]
  );
  const msgs = model.steps.filter((s) => s.type === "message");
  assert.equal(msgs.length, 1);
});

test("sequenceToDrawio: box/rect produce no visual frame", () => {
  const src = `sequenceDiagram
    box "Group"
      participant A
      participant B
    end
    A->>B: hi`;
  const { xml, warnings } = sequenceToDrawio(src);
  assert.deepEqual(warnings, []);
  assert.doesNotMatch(xml, /id="frag-\d+"/);
  assert.match(xml, /id="msg-1"/);
});

test("sequenceToDrawio: activation bar is rendered for +/- sigils", () => {
  const src = `sequenceDiagram
    A->>+B: req
    B-->>-A: res`;
  const { xml } = sequenceToDrawio(src);
  const acts = [...xml.matchAll(/<mxCell id="act-\d+"/g)];
  assert.equal(acts.length, 1);
});

test("detectDiagramKind: sequenceDiagram header", () => {
  assert.equal(
    detectDiagramKind("sequenceDiagram\n  A->>B: hi"),
    "sequence"
  );
});

test("seq parser: participants with aliases", () => {
  const src = `sequenceDiagram
    participant U as User
    participant W as Webshop
    U->>W: Hi`;
  const m = parseSequenceDiagram(src);
  assert.equal(m.participants.length, 2);
  assert.equal(m.participants[0].id, "U");
  assert.equal(m.participants[0].label, "User");
  assert.equal(m.participants[1].label, "Webshop");
});

test("seq parser: all arrow types", () => {
  const src = `sequenceDiagram
    A->B: 1
    A-->B: 2
    A->>B: 3
    A-->>B: 4
    A-x B: 5
    A--x B: 6
    A-)B: 7
    A--)B: 8`;
  const m = parseSequenceDiagram(src);
  assert.equal(m.steps.length, 8);
  assert.equal(m.steps[0].line, "solid");
  assert.equal(m.steps[0].head, "open");
  assert.equal(m.steps[1].line, "dashed");
  assert.equal(m.steps[1].head, "open");
  assert.equal(m.steps[2].line, "solid");
  assert.equal(m.steps[2].head, "filled");
  assert.equal(m.steps[3].line, "dashed");
  assert.equal(m.steps[3].head, "filled");
  assert.equal(m.steps[4].head, "cross");
  assert.equal(m.steps[6].head, "async");
});

test("seq parser: alt/else/end", () => {
  const src = `sequenceDiagram
    A->>B: 1
    alt cond1
      A->>B: yes
    else cond2
      A->>B: no
    end`;
  const m = parseSequenceDiagram(src);
  const kinds = m.steps.map((s) => s.type);
  assert.deepEqual(kinds, [
    "message",
    "fragment-begin",
    "message",
    "fragment-section",
    "message",
    "fragment-end",
  ]);
  assert.equal(m.steps[1].kind, "alt");
  assert.equal(m.steps[1].condition, "cond1");
  assert.equal(m.steps[3].keyword, "else");
});

test("seq parser: notes", () => {
  const src = `sequenceDiagram
    A->>B: 1
    Note over A: simple
    Note left of B: bar
    Note over A,B: spans both`;
  const m = parseSequenceDiagram(src);
  const notes = m.steps.filter((s) => s.type === "note");
  assert.equal(notes.length, 3);
  assert.equal(notes[0].position, "over");
  assert.deepEqual(notes[0].participants, ["A"]);
  assert.equal(notes[1].position, "left of");
  assert.deepEqual(notes[2].participants, ["A", "B"]);
});

test("seq parser: self message and loop nesting", () => {
  const src = `sequenceDiagram
    loop forever
      A->>A: self
      alt x
        A->>B: y
      end
    end`;
  const m = parseSequenceDiagram(src);
  const kinds = m.steps.map((s) => s.type);
  assert.deepEqual(kinds, [
    "fragment-begin",
    "message",
    "fragment-begin",
    "message",
    "fragment-end",
    "fragment-end",
  ]);
  assert.equal(m.steps[1].from, "A");
  assert.equal(m.steps[1].to, "A");
});

test("sequenceToDrawio: emits participants, lifelines, messages and fragments", () => {
  const src = `sequenceDiagram
    participant A
    participant B
    A->>B: hi
    alt c1
      A->>B: yes
    else c2
      A->>B: no
    end`;
  const { xml, warnings } = sequenceToDrawio(src);
  assert.deepEqual(warnings, []);
  // headers
  assert.match(xml, /id="A-head"/);
  assert.match(xml, /id="B-head"/);
  assert.match(xml, /id="A-life"/);
  // 3 messages, 1 fragment, 1 section
  const msgCount = (xml.match(/id="msg-\d+"/g) || []).length;
  assert.equal(msgCount, 3);
  const fragCount = (xml.match(/id="frag-\d+"/g) || []).length;
  assert.equal(fragCount, 1);
  const sectCount = (xml.match(/id="frag-\d+-sec/g) || []).length;
  assert.equal(sectCount, 1);
});

test("sequenceToDrawio: self message renders a loop edge on same lifeline", () => {
  const src = `sequenceDiagram
    A->>A: self`;
  const { xml } = sequenceToDrawio(src);
  // Floating orthogonal edge with two waypoints forming the loop
  assert.match(xml, /id="msg-1"[^>]*edge="1"/);
  const wp = (xml.match(/<Array as="points">[^<]*<mxPoint[^/]*\/>[^<]*<mxPoint[^/]*\/>[^<]*<\/Array>/g) || []);
  assert.ok(wp.length >= 1, "expected at least one waypoint pair for self-loop");
});

test("convertMermaidToDrawio: native sequence end-to-end (delivery)", async () => {
  const src = `sequenceDiagram
    participant U as User
    participant W as Webshop
    participant API as delivery-api
    participant BG as BG task (same process)
    participant DB as DB

    U->>W: Checkout
    W->>API: POST
    API->>API: compute
    API->>DB: persist
    alt N == 1
      API-->>W: ok
    else N >= 2
      API->>BG: fire
      API-->>W: ok
    end
    W->>U: show
    loop For each remaining robot
      BG->>DB: reserve
      alt ok
        BG->>DB: child
      else fail
        BG->>DB: mark
        Note over BG: abort
      end
    end`;
  const xml = await convertMermaidToDrawio(src);
  for (const id of ["U-head", "W-head", "API-head", "BG-head", "DB-head"]) {
    assert.match(xml, new RegExp(`id="${id}"`));
  }
  // self-message present (rendered as a floating orthogonal loop with waypoints)
  assert.match(xml, /id="msg-3"[^>]*>[^<]*<mxGeometry[^>]*>[^<]*<mxPoint[^/]*as="sourcePoint"[^/]*\/>[^<]*<mxPoint[^/]*as="targetPoint"[^/]*\/>[^<]*<Array as="points">/);
  // notes/fragments rendered
  assert.match(xml, /shape=note/);
  assert.match(xml, /id="frag-\d+"/);
});

test("seq parser: autonumber and title directives are captured", () => {
  const src = `sequenceDiagram
    title Order Flow
    autonumber
    A->>B: hi
    B-->>A: ok`;
  const m = parseSequenceDiagram(src);
  assert.equal(m.autonumber, true);
  assert.equal(m.title, "Order Flow");
});

test("sequenceToDrawio: autonumber prefixes each message label with 1./2./...", () => {
  const src = `sequenceDiagram
    autonumber
    A->>B: request
    B-->>A: response
    A->>B: again`;
  const { xml } = sequenceToDrawio(src);
  assert.match(xml, /value="1\. request"/);
  assert.match(xml, /value="2\. response"/);
  assert.match(xml, /value="3\. again"/);
});

test("sequenceToDrawio: title directive becomes the diagram name when caller doesn't set one", () => {
  const src = `sequenceDiagram
    title Order Flow
    A->>B: hi`;
  const { xml } = sequenceToDrawio(src);
  assert.match(xml, /<diagram name="Order Flow"/);
});

test("seq parser: create participant / destroy are accepted without warnings", () => {
  const src = `sequenceDiagram
    participant A
    A->>B: hi
    create participant C as Worker
    A->>C: spawn
    destroy C
    C-->>A: done`;
  const m = parseSequenceDiagram(src);
  assert.deepEqual(m.warnings, []);
  const c = m.participants.find((p) => p.id === "C");
  assert.ok(c, "C should be declared");
  assert.equal(c.label, "Worker");
});

test("seq parser: create actor marks the participant as an actor", () => {
  const src = `sequenceDiagram
    A->>B: hi
    create actor U as User
    B->>U: notify`;
  const m = parseSequenceDiagram(src);
  assert.deepEqual(m.warnings, []);
  const u = m.participants.find((p) => p.id === "U");
  assert.equal(u.isActor, true);
  assert.equal(u.label, "User");
});

test("seq parser: box records its participants, color, and label", () => {
  const src = `sequenceDiagram
    box rgb(200, 220, 255) Backend Team
      participant S as Server
      participant D as DB
    end
    box transparent Client
      participant C
    end
    C->>S: req`;
  const m = parseSequenceDiagram(src);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.boxes.length, 2);
  assert.equal(m.boxes[0].color, "rgb(200, 220, 255)");
  assert.equal(m.boxes[0].label, "Backend Team");
  assert.deepEqual(m.boxes[0].participants, ["S", "D"]);
  assert.equal(m.boxes[1].color, "transparent");
  assert.deepEqual(m.boxes[1].participants, ["C"]);
});

test("seq parser: box with a color-name first word", () => {
  const m = parseSequenceDiagram(`sequenceDiagram
    box lightblue Group A
      participant A
    end`);
  assert.equal(m.boxes[0].color, "lightblue");
  assert.equal(m.boxes[0].label, "Group A");
});

test("sequenceToDrawio draws box frames behind the participants", () => {
  const { xml, warnings } = sequenceToDrawio(`sequenceDiagram
    box rgb(200, 220, 255) Backend
      participant S
      participant D
    end
    S->>D: query`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /pbox-1/);
  assert.match(xml, /fillColor=#c8dcff/);
  assert.match(xml, /value="Backend"/);
  // The frame cell must come before the participant header cells (z-order).
  assert.ok(xml.indexOf("pbox-1") < xml.indexOf(`"S-head"`));
});

test("sequenceToDrawio draws rect highlight spanning involved lifelines", () => {
  const { xml } = sequenceToDrawio(`sequenceDiagram
    participant A
    participant B
    participant C
    rect rgba(191, 223, 255, 0.5)
      A->>B: hello
    end
    B->>C: other`);
  assert.match(xml, /rect-bg-1/);
  assert.match(xml, /fillColor=#bfdfff/);
  assert.match(xml, /opacity=50/);
  // Behind messages: the rect cell appears before the first message cell.
  assert.ok(xml.indexOf("rect-bg-1") < xml.indexOf(`"msg-1"`));
});

test("sequence: message edges keep a visible arrowhead (endSize=0 regression)", () => {
  const { xml } = sequenceToDrawio(`sequenceDiagram
  A->>B: hi
  B-->>A: yo`);
  const msgStyles = [...xml.matchAll(/<mxCell id="msg-\d+"[^>]*style="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(msgStyles.length, 2);
  for (const s of msgStyles) {
    assert.match(s, /endArrow=(block|open)/);
    assert.doesNotMatch(s, /endSize=0/);
  }
});
