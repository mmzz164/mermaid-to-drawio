import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMindmap } from "../src/mindmap-parser.js";
import { mindmapToDrawio } from "../src/mindmap-to-drawio.js";
import { convertMermaidToDrawio } from "../src/index.js";

test("parseMindmap builds the indent hierarchy", () => {
  const m = parseMindmap(`mindmap
  root((Main))
    A
      A1
      A2
    B
      B1
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.root.text, "Main");
  assert.equal(m.root.shape, "circle");
  assert.deepEqual(m.root.children.map((c) => c.text), ["A", "B"]);
  assert.deepEqual(m.root.children[0].children.map((c) => c.text), ["A1", "A2"]);
  assert.deepEqual(m.root.children[1].children.map((c) => c.text), ["B1"]);
});

test("parseMindmap recognizes node shapes and skips ::icon", () => {
  const m = parseMindmap(`mindmap
  Root
    sq[Square]
    ro(Rounded)
    ci((Circle))
    cl)Cloud(
    ba))Bang((
    hx{{Hexagon}}
    ::icon(fa fa-book)
`);
  assert.deepEqual(m.warnings, []);
  const shapes = Object.fromEntries(m.root.children.map((c) => [c.text, c.shape]));
  assert.deepEqual(shapes, {
    Square: "square",
    Rounded: "rounded",
    Circle: "circle",
    Cloud: "cloud",
    Bang: "bang",
    Hexagon: "hexagon",
  });
});

test("parseMindmap tolerates a second root with a warning", () => {
  const m = parseMindmap(`mindmap
  First
  Second
`);
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /multiple root/);
  assert.deepEqual(m.root.children.map((c) => c.text), ["Second"]);
});

test("mindmapToDrawio renders nodes and branch-colored edges", () => {
  const { xml, warnings } = mindmapToDrawio(`mindmap
  root((テーマ))
    枝1
      葉1
    枝2
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="テーマ"/);
  assert.match(xml, /value="枝1"/);
  assert.match(xml, /value="葉1"/);
  assert.equal((xml.match(/edge="1"/g) || []).length, 3);
  // Root is an ellipse; children of the same branch share a fill.
  assert.match(xml, /ellipse;[^"]*fillColor=#ECECFF/);
});

test("convertMermaidToDrawio handles mindmap natively", async () => {
  const xml = await convertMermaidToDrawio(`mindmap
  Root
    Child
`);
  assert.match(xml, /<mxfile/);
  assert.doesNotMatch(xml, /data:image/);
});

test("parseMindmap accepts CJK node ids before shape brackets", () => {
  const m = parseMindmap(`mindmap
  Root
    リリース{{重要}}
`);
  assert.equal(m.root.children[0].shape, "hexagon");
  assert.equal(m.root.children[0].text, "重要");
});
