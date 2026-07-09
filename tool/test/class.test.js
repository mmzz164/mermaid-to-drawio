import { test } from "node:test";
import assert from "node:assert/strict";

import { parseClassDiagram } from "../src/class-parser.js";
import { classDiagramToDrawio } from "../src/class-to-drawio.js";
import { detectDiagramKind, convertMermaidToDrawio } from "../src/index.js";

test("class parser: members inside braces are attributed correctly", () => {
  const src = `classDiagram
    class Animal {
      +String name
      +int age
      +makeSound() void
      +eat() void
    }`;
  const m = parseClassDiagram(src);
  const a = m.classes.get("Animal");
  assert.deepEqual(a.attributes, ["+String name", "+int age"]);
  assert.deepEqual(a.methods, ["+makeSound() void", "+eat() void"]);
});

test("class parser: stereotype is captured", () => {
  const src = `classDiagram
    class Comparable {
      <<interface>>
      +compareTo(Object) int
    }`;
  const m = parseClassDiagram(src);
  const c = m.classes.get("Comparable");
  assert.equal(c.stereotype, "interface");
  assert.equal(c.methods.length, 1);
});

test("class parser: inheritance / composition / aggregation / dependency tokens", () => {
  const src = `classDiagram
    Animal <|-- Dog
    Animal <|-- Cat
    Dog "1" *-- "many" Leg
    Cat o-- Tail
    Dog --> Owner : has
    Logger <.. Animal
    Animal ..|> Comparable`;
  const m = parseClassDiagram(src);
  assert.equal(m.relations.length, 7);
  const inh = m.relations.find((r) => r.from === "Animal" && r.to === "Dog");
  assert.equal(inh.kind, "inheritance");
  assert.match(inh.startArrow, /block/);
  assert.match(inh.startArrow, /startFill=0/);
  const comp = m.relations.find((r) => r.from === "Dog" && r.to === "Leg");
  assert.equal(comp.kind, "composition");
  assert.equal(comp.fromCard, "1");
  assert.equal(comp.toCard, "many");
  const real = m.relations.find((r) => r.to === "Comparable");
  assert.equal(real.kind, "realization");
  assert.equal(real.dashed, true);
});

test("class parser: colon-form `Animal : +name` adds to attributes", () => {
  const src = `classDiagram
    Animal : +String name
    Animal : +eat() void`;
  const m = parseClassDiagram(src);
  const a = m.classes.get("Animal");
  assert.deepEqual(a.attributes, ["+String name"]);
  assert.deepEqual(a.methods, ["+eat() void"]);
});

test("class parser: notes (global and scoped) are captured", () => {
  const src = `classDiagram
    class Animal
    note "Global note"
    note for Animal "Scoped note"`;
  const m = parseClassDiagram(src);
  assert.equal(m.notes.length, 2);
  assert.equal(m.notes[0].target, null);
  assert.equal(m.notes[1].target, "Animal");
});

test("classDiagramToDrawio: renders class blocks with attributes and methods", () => {
  const src = `classDiagram
    class Animal {
      +String name
      +makeSound() void
    }`;
  const { xml } = classDiagramToDrawio(src);
  // value contains the bold class name and the member lines (HTML-escaped).
  assert.match(xml, /<mxCell id="Animal"[^>]*value="[^"]*Animal[^"]*name[^"]*makeSound/);
});

test("classDiagramToDrawio: inheritance edge has hollow triangle on parent side", () => {
  const src = `classDiagram
    Animal <|-- Dog`;
  const { xml } = classDiagramToDrawio(src);
  // Parser stores from=Animal, to=Dog; the <|-- token puts the triangle at source.
  const m = xml.match(/source="Animal" target="Dog"[^>]*/);
  assert.ok(m, "edge from Animal to Dog must exist");
  const styleMatch = xml.match(/<mxCell[^>]*style="([^"]+)"[^>]*source="Animal" target="Dog"/);
  assert.match(styleMatch[1], /startArrow=block/);
  assert.match(styleMatch[1], /startFill=0/);
});

test("convertMermaidToDrawio: native class diagram end-to-end via detector", async () => {
  const src = `classDiagram
    class Foo {
      +bar() void
    }
    class Baz
    Foo --> Baz`;
  assert.equal(detectDiagramKind(src), "class");
  const xml = await convertMermaidToDrawio(src);
  assert.match(xml, /<mxCell id="Foo"/);
  assert.match(xml, /<mxCell id="Baz"/);
});
