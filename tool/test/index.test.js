import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDrawioFromSvg,
  getSvgDimensions,
  convertMermaidToDrawio,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

// The png/svg e2e tests need mermaid-cli (an optional dependency) plus its
// headless Chrome. Skip them cleanly when either is missing so a
// lightweight native-only install still has a green test suite.
const hasMmdc = existsSync(
  path.join(__dirname, "..", "node_modules", ".bin", "mmdc")
);
const mmdcSkip = hasMmdc
  ? false
  : "mermaid-cli not installed (native-only install)";

function skipIfChromeMissing(t, err) {
  if (/chrome|puppeteer/i.test(String(err && err.message))) {
    t.skip("headless Chrome for mermaid-cli is not installed");
    return true;
  }
  return false;
}

test("getSvgDimensions reads width/height attributes", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"></svg>`;
  assert.deepEqual(getSvgDimensions(svg), { width: 320, height: 240 });
});

test("getSvgDimensions falls back to viewBox", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"></svg>`;
  assert.deepEqual(getSvgDimensions(svg), { width: 400, height: 300 });
});

test("getSvgDimensions handles units like '320px'", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320px" height="240px"></svg>`;
  assert.deepEqual(getSvgDimensions(svg), { width: 320, height: 240 });
});

test("buildDrawioFromSvg produces a valid-looking mxfile", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="red"/></svg>`;
  const xml = buildDrawioFromSvg(svg, { diagramName: "Test" });
  assert.match(xml, /<\?xml version="1.0"/);
  assert.match(xml, /<mxfile\b/);
  assert.match(xml, /<diagram name="Test"/);
  assert.match(xml, /<mxGraphModel\b/);
  assert.match(xml, /shape=image/);
  assert.match(xml, /data:image\/svg\+xml%3Bbase64,/);
});

test("buildDrawioFromSvg XML-escapes the diagram name", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`;
  const xml = buildDrawioFromSvg(svg, { diagramName: `a<b&"c'` });
  assert.match(xml, /name="a&lt;b&amp;&quot;c&apos;"/);
});

test("buildDrawioFromSvg url-encodes ';' inside the data URI so drawio's style parser doesn't truncate it", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`;
  const xml = buildDrawioFromSvg(svg);
  // Must NOT contain a bare 'data:image/svg+xml;base64,' inside the style;
  // the ';' has to be encoded as %3B.
  assert.match(xml, /image=data:image\/svg\+xml%3Bbase64,/);
  assert.doesNotMatch(xml, /image=data:image\/svg\+xml;base64,/);

  // And the drawio style parser (split on ';', then '=') must keep the image
  // value intact.
  const styleMatch = xml.match(/style="([^"]+)"/);
  const style = styleMatch[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  const kv = Object.fromEntries(
    style
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)];
      })
  );
  assert.ok(kv.image, "image key should be present");
  assert.ok(
    kv.image.startsWith("data:image/svg+xml%3Bbase64,"),
    `image value should keep its full data URI, got: ${kv.image.slice(0, 60)}`
  );
});

test("convertMermaidToDrawio renders a flowchart end-to-end (svg format)", { skip: mmdcSkip }, async (t) => {
  const src = await fs.readFile(
    path.join(fixtures, "flowchart.mmd"),
    "utf8"
  );
  let xml;
  try {
    xml = await convertMermaidToDrawio(src, {
      diagramName: "flow",
      mode: "svg",
    });
  } catch (e) {
    if (skipIfChromeMissing(t, e)) return;
    throw e;
  }
  assert.match(xml, /<mxfile/);
  assert.match(xml, /shape=image/);
  // Data URI's ';' is URL-encoded, base64 payload follows.
  const m = xml.match(/data:image\/svg\+xml%3Bbase64,([A-Za-z0-9+/=]+)/);
  assert.ok(m, "should contain base64 svg data URI with encoded ';'");
  const svg = Buffer.from(m[1], "base64").toString("utf8");
  assert.match(svg, /<svg\b/);
  assert.match(svg, /Decision|Start/);
});

test("convertMermaidToDrawio renders a flowchart end-to-end (png mode)", { skip: mmdcSkip }, async (t) => {
  const src = await fs.readFile(
    path.join(fixtures, "flowchart.mmd"),
    "utf8"
  );
  let xml;
  try {
    xml = await convertMermaidToDrawio(src, {
      diagramName: "flow",
      mode: "png",
    });
  } catch (e) {
    if (skipIfChromeMissing(t, e)) return;
    throw e;
  }
  assert.match(xml, /<mxfile/);
  assert.match(xml, /shape=image/);
  const m = xml.match(/data:image\/png%3Bbase64,([A-Za-z0-9+/=]+)/);
  assert.ok(m, "should contain base64 png data URI with encoded ';'");
  const png = Buffer.from(m[1], "base64");
  // PNG signature
  assert.equal(png.slice(1, 4).toString("ascii"), "PNG");
});

test("convertMermaidToDrawio default mode is native (no embedded image)", async () => {
  const src = await fs.readFile(
    path.join(fixtures, "flowchart.mmd"),
    "utf8"
  );
  const xml = await convertMermaidToDrawio(src, { diagramName: "flow" });
  assert.match(xml, /<mxfile/);
  assert.doesNotMatch(xml, /data:image/);
  assert.match(xml, /edge="1"/);
});

test("detectDiagramKind recognizes the full mermaid diagram roster", async () => {
  const { detectDiagramKind } = await import("../src/index.js");
  const cases = {
    "flowchart LR\n A-->B": "flowchart",
    "graph TD\n A-->B": "flowchart",
    "erDiagram\n A ||--o{ B : has": "er",
    "sequenceDiagram\n A->>B: x": "sequence",
    "classDiagram\n class A": "class",
    "stateDiagram-v2\n [*] --> A": "state",
    "gantt\n title X": "gantt",
    "pie\n \"A\" : 1": "pie",
    "mindmap\n root": "mindmap",
    "journey\n title X": "journey",
    "gitGraph\n commit": "gitGraph",
    "timeline\n title X": "timeline",
    "quadrantChart\n title X": "quadrantChart",
    "xychart-beta\n title X": "xychart",
    "requirementDiagram\n requirement r {}": "requirement",
    "C4Context\n title X": "C4",
    "kanban\n Todo": "kanban",
    "﻿mindmap\n root": "mindmap", // BOM is stripped
    "just some text": "unknown",
  };
  for (const [src, kind] of Object.entries(cases)) {
    assert.equal(detectDiagramKind(src), kind, `detect: ${src.slice(0, 20)}`);
  }
});
