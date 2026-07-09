import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  convertMermaidToDrawio,
  convertManyMermaidToDrawio,
  extractMermaidBlocksWithHeadings,
} from "../src/index.js";

/**
 * Golden snapshot tests: every diagram kind (plus a multi-page Markdown
 * document) is converted and compared byte-for-byte against a committed
 * .expected.drawio file. Any change in generated output — intended or not —
 * fails here first.
 *
 * To bless intentional output changes:  npm run golden:update
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, "fixtures", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const inputs = fs
  .readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".mmd") || f.endsWith(".md"))
  .sort();

async function convertLikeCli(file, src) {
  const base = file.replace(/\.(mmd|md)$/, "");
  if (file.endsWith(".md")) {
    const blocks = extractMermaidBlocksWithHeadings(src);
    return convertManyMermaidToDrawio(
      blocks.map((b, i) => ({
        source: b.source,
        defaultName: b.heading || (blocks.length > 1 ? `${base}-${i + 1}` : base),
      }))
    );
  }
  return convertMermaidToDrawio(src, { defaultDiagramName: base });
}

for (const file of inputs) {
  test(`golden: ${file}`, async () => {
    const src = fs.readFileSync(path.join(GOLDEN_DIR, file), "utf8");
    const xml = await convertLikeCli(file, src);
    const goldenPath = path.join(
      GOLDEN_DIR,
      `${file.replace(/\.(mmd|md)$/, "")}.expected.drawio`
    );
    if (UPDATE) {
      fs.writeFileSync(goldenPath, xml, "utf8");
      return;
    }
    assert.ok(
      fs.existsSync(goldenPath),
      `missing golden file for ${file}; run: npm run golden:update`
    );
    assert.equal(
      xml,
      fs.readFileSync(goldenPath, "utf8"),
      `output changed for ${file}; if this is intentional, run: npm run golden:update`
    );
  });
}
