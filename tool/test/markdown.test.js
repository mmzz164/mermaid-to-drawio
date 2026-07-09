import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractMermaidBlocks,
  convertManyMermaidToDrawio,
} from "../src/index.js";

const MD = `# Doc

Some prose.

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`js
console.log("not mermaid");
\`\`\`

~~~mermaid
pie title Pets
  "Dogs" : 1
~~~

\`\`\`\`mermaid
---
title: My ER
---
erDiagram
  A ||--o{ B : has
\`\`\`\`
`;

test("extractMermaidBlocks finds only mermaid fences", () => {
  const blocks = extractMermaidBlocks(MD);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0], /flowchart LR/);
  assert.match(blocks[1], /pie title Pets/);
  assert.match(blocks[2], /erDiagram/);
});

test("extractMermaidBlocks returns [] when no fences", () => {
  assert.deepEqual(extractMermaidBlocks("# nothing here\n"), []);
});

test("convertManyMermaidToDrawio produces one page per source", async () => {
  const blocks = extractMermaidBlocks(MD);
  const xml = await convertManyMermaidToDrawio(blocks);
  assert.equal((xml.match(/<diagram /g) || []).length, 3);
  assert.equal((xml.match(/<mxfile /g) || []).length, 1);
  // Page ids are re-numbered and unique.
  assert.match(xml, /id="m2d-1"/);
  assert.match(xml, /id="m2d-2"/);
  assert.match(xml, /id="m2d-3"/);
  // Front-matter title names its page; the others fall back to Page-N.
  assert.match(xml, /name="Page-1"/);
  assert.match(xml, /name="Page-2"/);
  assert.match(xml, /name="My ER"/);
});

test("convertManyMermaidToDrawio de-duplicates page names", async () => {
  const src = `---
title: Same
---
flowchart LR
  A --> B`;
  const xml = await convertManyMermaidToDrawio([src, src]);
  assert.match(xml, /name="Same"/);
  assert.match(xml, /name="Same \(2\)"/);
});

test("extractMermaidBlocksWithHeadings names blocks after fresh headings", async () => {
  const { extractMermaidBlocksWithHeadings } = await import("../src/index.js");
  const md = `# Doc title

## Flow

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

## Data

\`\`\`mermaid
erDiagram
  A ||--o{ B : x
\`\`\`

\`\`\`mermaid
pie
  "X" : 1
\`\`\`
`;
  const blocks = extractMermaidBlocksWithHeadings(md);
  assert.deepEqual(blocks.map((b) => b.heading), ["Flow", "Data", null]);
});

test("extractMermaidBlocksWithHeadings ignores headings inside code fences", async () => {
  const { extractMermaidBlocksWithHeadings } = await import("../src/index.js");
  const md = `\`\`\`bash
# not a heading
echo hi
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;
  const blocks = extractMermaidBlocksWithHeadings(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].heading, null);
});

test("convertManyMermaidToDrawio honors defaultName items", async () => {
  const xml = await convertManyMermaidToDrawio([
    { source: "flowchart LR\n  A --> B", defaultName: "フロー" },
    { source: "---\ntitle: FM Wins\n---\nflowchart LR\n  C --> D", defaultName: "ignored" },
    "pie\n  \"X\" : 1",
  ]);
  assert.match(xml, /name="フロー"/);
  assert.match(xml, /name="FM Wins"/);
  assert.match(xml, /name="Page-3"/);
});
