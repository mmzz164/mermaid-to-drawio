#!/usr/bin/env node
// Generate a self-contained local viewer page (view-<name>.html) for every
// *.drawio in a directory, using draw.io's official embed viewer. Serve the
// directory with any static server and screenshot the pages — this renders
// with the real draw.io engine.
//
//   node tool/scripts/gen-viewers.js <work-dir>
//   cd <work-dir> && python3 -m http.server 18924
//   → http://localhost:18924/view-<name>.html
//
// Why this and not viewer.diagrams.net?
// - `viewer.diagrams.net/?url=...` fetches through THEIR server-side proxy,
//   which can never reach your localhost (always HTTP 400).
// - `#R<xml>` fragment URLs work but echo the full XML into browser tool
//   results, costing thousands of tokens per navigation.
// The embed page keeps the URL short: the XML lives in the HTML file, and
// only viewer-static.min.js is loaded from viewer.diagrams.net (script tag,
// no CORS involved).
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node gen-viewers.js <work-dir with *.drawio files>");
  process.exit(1);
}

const kinds = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".drawio"))
  .map((f) => f.replace(/\.drawio$/, ""))
  .sort();

const escAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

for (const k of kinds) {
  const xml = fs.readFileSync(path.join(dir, `${k}.drawio`), "utf8");
  const cfg = JSON.stringify({ xml, toolbar: "", nav: false, resize: true, border: 12 });
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${k}</title>
<style>body { margin: 0; background: #ffffff; }</style></head>
<body>
<div class="mxgraph" data-mxgraph="${escAttr(cfg)}"></div>
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(dir, `view-${k}.html`), html);
}
console.log(`wrote ${kinds.length} viewer pages: ${kinds.join(", ")}`);
