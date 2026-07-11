#!/usr/bin/env node
// Download ground-truth renderings from mermaid.ink for every *.mmd in a
// directory, into <dir>/ref/<name>.png.
//
//   node tool/scripts/fetch-refs.js <work-dir>
//
// Notes (learned the hard way):
// - mermaid.ink's default output is JPEG; `?type=png` forces PNG.
// - Already-downloaded refs are skipped, so the script is safe to re-run
//   after fixing only the sources that failed.
// - An HTTP 400 usually means UPSTREAM mermaid rejects the source syntax
//   (our parser is more tolerant). The response body contains the parse
//   error — read it, then write a mermaid-compatible variant of the .mmd.
//   See docs/visual-qa.md for the known per-kind quirks.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node fetch-refs.js <work-dir with *.mmd files>");
  process.exit(1);
}
const refDir = path.join(dir, "ref");
fs.mkdirSync(refDir, { recursive: true });

const kinds = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".mmd"))
  .map((f) => f.replace(/\.mmd$/, ""))
  .sort();

let failed = 0;
for (const k of kinds) {
  const out = path.join(refDir, `${k}.png`);
  if (fs.existsSync(out)) {
    console.log(`${k}: already present, skipped`);
    continue;
  }
  const code = fs.readFileSync(path.join(dir, `${k}.mmd`), "utf8");
  const payload = Buffer.from(
    JSON.stringify({ code, mermaid: { theme: "default" } })
  ).toString("base64url");
  const url = `https://mermaid.ink/img/${payload}?type=png&bgColor=ffffff`;
  try {
    const httpCode = execSync(
      `curl -sL --max-time 60 -o "${out}" -w "%{http_code}" "${url}"`,
      { stdio: "pipe" }
    )
      .toString()
      .trim();
    const buf = fs.readFileSync(out);
    const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
    if (httpCode === "200" && isPng) {
      console.log(`${k}: OK ${buf.length} bytes`);
    } else {
      console.log(
        `${k}: HTTP ${httpCode} body: ${buf.slice(0, 200).toString("utf8").replace(/\n/g, " ")}`
      );
      fs.unlinkSync(out);
      failed++;
    }
  } catch (e) {
    console.log(`${k}: curl failed (exit ${e.status ?? "?"})`);
    if (fs.existsSync(out)) fs.unlinkSync(out);
    failed++;
  }
  execSync("sleep 1"); // be polite to mermaid.ink
}
process.exit(failed ? 2 : 0);
