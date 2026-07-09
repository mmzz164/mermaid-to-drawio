import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePieChart } from "../src/pie-parser.js";
import { pieToDrawio } from "../src/pie-to-drawio.js";
import { convertMermaidToDrawio } from "../src/index.js";

test("parsePieChart reads title, showData and data rows", () => {
  const model = parsePieChart(`pie showData title Pets
  "Dogs" : 386
  "Cats" : 85.5
  Rats : 15
`);
  assert.equal(model.title, "Pets");
  assert.equal(model.showData, true);
  assert.deepEqual(model.slices, [
    { label: "Dogs", value: 386 },
    { label: "Cats", value: 85.5 },
    { label: "Rats", value: 15 },
  ]);
  assert.deepEqual(model.warnings, []);
});

test("parsePieChart accepts title/showData on their own lines", () => {
  const model = parsePieChart(`pie
  showData
  title Key elements
  "Calcium" : 42.96
`);
  assert.equal(model.title, "Key elements");
  assert.equal(model.showData, true);
  assert.equal(model.slices.length, 1);
});

test("parsePieChart skips negative values with a warning", () => {
  const model = parsePieChart(`pie
  "Good" : 10
  "Bad" : -5
`);
  assert.equal(model.slices.length, 1);
  assert.equal(model.warnings.length, 1);
  assert.match(model.warnings[0], /invalid pie value/);
});

test("parsePieChart skips YAML front matter and comments", () => {
  const model = parsePieChart(`---
title: Page name
---
%% a comment
pie title Real title
  "A" : 1 %% trailing comment
`);
  assert.equal(model.title, "Real title");
  assert.deepEqual(model.slices, [{ label: "A", value: 1 }]);
  assert.deepEqual(model.warnings, []);
});

test("pieToDrawio emits one pie slice per positive value plus legend", () => {
  const { xml, warnings } = pieToDrawio(`pie title Pets
  "Dogs" : 3
  "Cats" : 1
`);
  assert.deepEqual(warnings, []);
  assert.equal((xml.match(/mxgraph\.basic\.pie/g) || []).length, 2);
  // Slices are sorted descending: Dogs (75%) comes first from angle 0.
  assert.match(xml, /startAngle=0;endAngle=0\.75/);
  assert.match(xml, /startAngle=0\.75;endAngle=1/);
  assert.match(xml, /value="75%"/);
  assert.match(xml, /value="25%"/);
  assert.match(xml, /value="Dogs"/);
  assert.match(xml, /value="Cats"/);
  assert.match(xml, /value="Pets"/);
});

test("pieToDrawio uses an ellipse for a single 100% slice", () => {
  const { xml } = pieToDrawio(`pie
  "All" : 42
`);
  assert.doesNotMatch(xml, /mxgraph\.basic\.pie/);
  assert.match(xml, /ellipse;/);
  assert.match(xml, /value="100%"/);
});

test("pieToDrawio shows values in the legend with showData", () => {
  const { xml } = pieToDrawio(`pie showData
  "Dogs" : 386
`);
  assert.match(xml, /value="Dogs \[386\]"/);
});

test("pieToDrawio XML-escapes labels", () => {
  const { xml } = pieToDrawio(`pie
  "A<B & C" : 1
  "Other" : 1
`);
  assert.match(xml, /value="A&lt;B &amp; C"/);
});

test("convertMermaidToDrawio handles pie natively", async () => {
  const xml = await convertMermaidToDrawio(`pie title Pets
  "Dogs" : 2
  "Cats" : 1
`);
  assert.match(xml, /<mxfile/);
  assert.doesNotMatch(xml, /data:image/);
  assert.match(xml, /mxgraph\.basic\.pie/);
});
