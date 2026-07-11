import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { flowchartToDrawio } from "./flowchart-to-drawio.js";
import { parseMermaidFlowchart } from "./mermaid-parser.js";
import { erDiagramToDrawio } from "./er-to-drawio.js";
import { parseErDiagram } from "./erdiagram-parser.js";
import { sequenceToDrawio } from "./sequence-to-drawio.js";
import { parseSequenceDiagram } from "./sequence-parser.js";
import { stateToDrawio } from "./state-to-drawio.js";
import { parseStateDiagram } from "./state-parser.js";
import { classDiagramToDrawio } from "./class-to-drawio.js";
import { parseClassDiagram } from "./class-parser.js";
import { pieToDrawio } from "./pie-to-drawio.js";
import { parsePieChart } from "./pie-parser.js";
import { ganttToDrawio } from "./gantt-to-drawio.js";
import { parseGantt, buildDateParser } from "./gantt-parser.js";
import { mindmapToDrawio } from "./mindmap-to-drawio.js";
import { parseMindmap } from "./mindmap-parser.js";
import { journeyToDrawio, parseJourney } from "./journey-to-drawio.js";
import { timelineToDrawio, parseTimeline } from "./timeline-to-drawio.js";
import { quadrantToDrawio, parseQuadrantChart } from "./quadrant-to-drawio.js";
import { kanbanToDrawio, parseKanban } from "./kanban-to-drawio.js";
import { packetToDrawio, parsePacket } from "./packet-to-drawio.js";
import { xychartToDrawio, parseXychart } from "./xychart-to-drawio.js";
import { radarToDrawio, parseRadar } from "./radar-to-drawio.js";
import { sankeyToDrawio, parseSankey } from "./sankey-to-drawio.js";
import { gitGraphToDrawio, parseGitGraph } from "./gitgraph-to-drawio.js";
import { requirementToDrawio, parseRequirementDiagram } from "./requirement-to-drawio.js";
import { c4ToDrawio, parseC4 } from "./c4-to-drawio.js";
import { treemapToDrawio, parseTreemap } from "./treemap-to-drawio.js";
import { blockToDrawio, parseBlock } from "./block-to-drawio.js";
import { architectureToDrawio, parseArchitecture } from "./architecture-to-drawio.js";
import { zenumlToDrawio, parseZenuml } from "./zenuml-to-drawio.js";
import { findXmlAttributeProblems } from "./drawio-xml.js";

export {
  findXmlAttributeProblems,
  flowchartToDrawio,
  parseMermaidFlowchart,
  erDiagramToDrawio,
  parseErDiagram,
  sequenceToDrawio,
  parseSequenceDiagram,
  stateToDrawio,
  parseStateDiagram,
  classDiagramToDrawio,
  parseClassDiagram,
  pieToDrawio,
  parsePieChart,
  ganttToDrawio,
  parseGantt,
  buildDateParser,
  mindmapToDrawio,
  parseMindmap,
  journeyToDrawio,
  parseJourney,
  timelineToDrawio,
  parseTimeline,
  quadrantToDrawio,
  parseQuadrantChart,
  kanbanToDrawio,
  parseKanban,
  packetToDrawio,
  parsePacket,
  xychartToDrawio,
  parseXychart,
  radarToDrawio,
  parseRadar,
  sankeyToDrawio,
  parseSankey,
  gitGraphToDrawio,
  parseGitGraph,
  requirementToDrawio,
  parseRequirementDiagram,
  c4ToDrawio,
  parseC4,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOOL_DIR = path.resolve(__dirname, "..");

const MMDC_MISSING_HINT =
  `png/svg mode needs @mermaid-js/mermaid-cli, which is not installed ` +
  `(it is an optional dependency; a lightweight install skips it).\n` +
  `To enable png/svg mode:\n` +
  `  cd ${TOOL_DIR} && npm install --include=optional\n` +
  `  npx puppeteer browsers install chrome-headless-shell\n` +
  `Native mode (the default) does not need it.`;

const CHROME_MISSING_HINT =
  `mermaid-cli is installed but its headless Chrome is missing.\n` +
  `Install it with:\n` +
  `  cd ${TOOL_DIR} && npx puppeteer browsers install chrome-headless-shell`;

/**
 * Locate the mmdc binary: prefer the tool-local node_modules install,
 * fall back to whatever `mmdc` is on PATH. mermaid-cli is an *optional*
 * dependency (it drags in puppeteer, ~500MB), so it may legitimately be
 * absent — the spawn error handler turns ENOENT into MMDC_MISSING_HINT.
 */
async function resolveMmdc() {
  const local = path.join(TOOL_DIR, "node_modules", ".bin", "mmdc");
  try {
    await fs.access(local);
    return local;
  } catch {
    return "mmdc";
  }
}

/**
 * Run mermaid-cli (mmdc) to render the given mermaid source to an SVG string.
 * @param {string} mermaidSource
 * @param {object} [opts]
 * @param {string} [opts.theme]      Mermaid theme: default | dark | forest | neutral
 * @param {string} [opts.background] Background color (e.g. "transparent", "#fff")
 * @returns {Promise<string>} SVG markup
 */
export async function renderMermaidToSvg(mermaidSource, opts = {}) {
  const result = await renderMermaid(mermaidSource, { ...opts, format: "svg" });
  return result.data;
}

/**
 * Render Mermaid to SVG or PNG.
 * @param {string} mermaidSource
 * @param {object} [opts]
 * @param {"svg"|"png"} [opts.format="svg"]
 * @param {string} [opts.theme]
 * @param {string} [opts.background]
 * @param {number} [opts.scale=2] PNG scale factor (1 = native, 2 = HiDPI)
 * @returns {Promise<{format:"svg"|"png", data:string|Buffer, width:number, height:number}>}
 */
export async function renderMermaid(mermaidSource, opts = {}) {
  const {
    theme = "default",
    background = "transparent",
    format = "svg",
    scale = 2,
  } = opts;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "m2d-"));
  const inputPath = path.join(tmpDir, "input.mmd");
  const ext = format === "png" ? "png" : "svg";
  const outputPath = path.join(tmpDir, `output.${ext}`);
  const configPath = path.join(tmpDir, "config.json");

  await fs.writeFile(inputPath, mermaidSource, "utf8");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      flowchart: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      class: { htmlLabels: false, useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      pie: { useMaxWidth: false },
    }),
    "utf8"
  );

  const mmdcBin = await resolveMmdc();

  const args = [
    "-i",
    inputPath,
    "-o",
    outputPath,
    "-t",
    theme,
    "-b",
    background,
    "-c",
    configPath,
    "--quiet",
  ];
  if (format === "png") {
    args.push("-s", String(scale));
  }

  await new Promise((resolve, reject) => {
    const child = spawn(mmdcBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (err && err.code === "ENOENT") reject(new Error(MMDC_MISSING_HINT));
      else reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else if (/could not find.*chrome|chrome-headless-shell/i.test(stderr)) {
        reject(
          new Error(
            `mmdc exited with code ${code}: ${stderr}\n${CHROME_MISSING_HINT}`
          )
        );
      } else reject(new Error(`mmdc exited with code ${code}: ${stderr}`));
    });
  });

  if (format === "png") {
    const buf = await fs.readFile(outputPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
    const { width, height } = readPngDimensions(buf);
    return {
      format: "png",
      data: buf,
      width: Math.round(width / scale),
      height: Math.round(height / scale),
    };
  }

  const raw = await fs.readFile(outputPath, "utf8");
  await fs.rm(tmpDir, { recursive: true, force: true });
  const svg = normalizeSvg(raw);
  const { width, height } = getSvgDimensions(svg);
  return { format: "svg", data: svg, width, height };
}

/**
 * Read width/height from a PNG buffer (IHDR chunk).
 * @param {Buffer} buf
 */
function readPngDimensions(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
    return { width: 800, height: 600 };
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

/**
 * Normalize the SVG so draw.io can render it as an embedded image:
 * - Drop `width="100%"` / `height="100%"` style values
 * - Ensure explicit pixel width/height attributes from the viewBox
 * - Strip `style="max-width: ..."` which can constrain rendering
 * @param {string} svg
 * @returns {string}
 */
function normalizeSvg(svg) {
  const headMatch = svg.match(/<svg\b[^>]*>/i);
  if (!headMatch) return svg;
  let head = headMatch[0];

  const viewBox = head.match(/\bviewBox="([^"]+)"/);
  let vbW = null;
  let vbH = null;
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(parseFloat);
    if (parts.length === 4) {
      vbW = parts[2];
      vbH = parts[3];
    }
  }

  // Remove percentage width/height
  head = head.replace(/\swidth="[\d.]+%"/i, "");
  head = head.replace(/\sheight="[\d.]+%"/i, "");
  // Remove problematic max-width style
  head = head.replace(/\sstyle="[^"]*"/i, (m) => {
    const stripped = m.replace(/max-width\s*:\s*[^;"]+;?/gi, "");
    return stripped === ' style=""' ? "" : stripped;
  });

  const hasWidth = /\swidth="[^"]+"/i.test(head);
  const hasHeight = /\sheight="[^"]+"/i.test(head);
  if (!hasWidth && vbW) {
    head = head.replace(/^<svg\b/i, `<svg width="${Math.round(vbW)}"`);
  }
  if (!hasHeight && vbH) {
    head = head.replace(/^<svg\b/i, `<svg height="${Math.round(vbH)}"`);
  }

  return svg.replace(headMatch[0], head);
}

/**
 * Extract width/height (in px) from an SVG string. Falls back to viewBox or defaults.
 * @param {string} svg
 * @returns {{ width: number, height: number }}
 */
export function getSvgDimensions(svg) {
  const root = svg.match(/<svg\b[^>]*>/i);
  if (!root) return { width: 800, height: 600 };
  const head = root[0];

  const widthAttr = head.match(/\bwidth="([^"]+)"/);
  const heightAttr = head.match(/\bheight="([^"]+)"/);
  const viewBox = head.match(/\bviewBox="([^"]+)"/);

  const parsePx = (s) => {
    if (!s) return null;
    if (/%\s*$/.test(s)) return null;
    const m = s.match(/^([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  };

  let width = parsePx(widthAttr?.[1]);
  let height = parsePx(heightAttr?.[1]);

  if ((!width || !height) && viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(parseFloat);
    if (parts.length === 4) {
      width = width || parts[2];
      height = height || parts[3];
    }
  }
  return {
    width: Math.max(1, Math.round(width || 800)),
    height: Math.max(1, Math.round(height || 600)),
  };
}

/**
 * Encode arbitrary string to base64 for embedding into drawio image shape.
 * @param {string} s
 */
function toBase64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * XML-escape a string for inclusion in attribute values / text nodes.
 * @param {string} s
 */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build a draw.io XML document that embeds the rendered SVG as an image cell.
 * @param {string} svg
 * @param {object} [opts]
 * @param {string} [opts.diagramName="Page-1"]
 * @returns {string} drawio XML (uncompressed mxfile)
 */
export function buildDrawioFromSvg(svg, opts = {}) {
  const { width, height } = getSvgDimensions(svg);
  const dataUri = `data:image/svg+xml;base64,${toBase64String(svg)}`;
  return buildDrawioFromDataUri(dataUri, width, height, opts);
}

/**
 * Build a draw.io XML document that embeds the rendered PNG as an image cell.
 * @param {Buffer} pngBuffer
 * @param {number} width  Display width in px
 * @param {number} height Display height in px
 * @param {object} [opts]
 */
export function buildDrawioFromPng(pngBuffer, width, height, opts = {}) {
  const dataUri = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  return buildDrawioFromDataUri(dataUri, width, height, opts);
}

function buildDrawioFromDataUri(dataUri, width, height, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  // draw.io styles are ';'-separated; semicolons inside the data URI must be
  // URL-encoded as %3B so the style parser doesn't truncate the image value.
  const safeUri = dataUri.replace(/;/g, "%3B");
  const style = `shape=image;verticalLabelPosition=bottom;labelBackgroundColor=#ffffff;verticalAlign=top;aspect=fixed;imageAspect=0;image=${safeUri};`;

  const pageW = Math.max(width + 40, 850);
  const pageH = Math.max(height + 40, 1100);

  const mxGraphModel =
    `<mxGraphModel dx="${pageW}" dy="${pageH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">` +
    `<root>` +
    `<mxCell id="0" />` +
    `<mxCell id="1" parent="0" />` +
    `<mxCell id="2" value="" style="${escapeXml(style)}" vertex="1" parent="1">` +
    `<mxGeometry x="20" y="20" width="${width}" height="${height}" as="geometry" />` +
    `</mxCell>` +
    `</root>` +
    `</mxGraphModel>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="mermaid2drawio" type="device" version="24.0.0">` +
    `<diagram name="${escapeXml(diagramName)}" id="m2d-1">` +
    mxGraphModel +
    `</diagram>` +
    `</mxfile>`;

  return xml;
}

function toBase64String(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Build a draw.io XML document by importing the SVG as native draw.io shapes
 * using the "edit-svg" approach (stylesheet `editableCssSvg`). Not all SVG
 * features map cleanly, so we keep the embed-image approach as the default.
 * Provided here for completeness/experimentation.
 *
 * Currently returns the same as buildDrawioFromSvg.
 * @param {string} svg
 * @param {object} [opts]
 */
export function buildDrawioFromSvgEditable(svg, opts = {}) {
  return buildDrawioFromSvg(svg, opts);
}

/**
 * High-level convert: mermaid source -> drawio XML string.
 * @param {string} mermaidSource
 * @param {object} [opts]
 * @param {"native"|"svg"|"png"} [opts.mode="native"]
 *   "native": Parse the mermaid flowchart and emit native drawio shapes.
 *             Most compatible (works in draw.io / Gliffy / Lucid). flowchart only.
 *   "svg":    Render via mermaid-cli and embed as SVG image.
 *   "png":    Render via mermaid-cli and embed as PNG image.
 * @param {string} [opts.theme]
 * @param {string} [opts.background]
 * @param {string} [opts.diagramName]
 * @param {number} [opts.scale=2]
 * @returns {Promise<string>}
 */
export async function convertMermaidToDrawio(mermaidSource, opts = {}) {
  mermaidSource = mermaidSource.replace(/^\uFEFF/, ""); // strip UTF-8 BOM
  const mode = opts.mode || "native";
  // YAML front-matter `title:` overrides the diagram page name unless the
  // caller explicitly passed a diagramName.
  const fmTitle = extractFrontMatterTitle(mermaidSource);
  // Diagram-name precedence: explicit opts.diagramName > YAML front-matter
  // `title:` > caller-provided `defaultDiagramName` (e.g. CLI basename) >
  // each renderer's hard-coded "Page-1".
  const effectiveOpts = { ...opts };
  if (!effectiveOpts.diagramName) {
    if (fmTitle) effectiveOpts.diagramName = fmTitle;
    else if (opts.defaultDiagramName) effectiveOpts.diagramName = opts.defaultDiagramName;
  }
  if (mode === "native") {
    const kind = detectDiagramKind(mermaidSource);
    let result;
    if (kind === "er") {
      result = erDiagramToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "flowchart") {
      result = flowchartToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "sequence") {
      result = sequenceToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "state") {
      result = stateToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "class") {
      result = classDiagramToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "pie") {
      result = pieToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "gantt") {
      result = ganttToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "mindmap") {
      result = mindmapToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "journey") {
      result = journeyToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "timeline") {
      result = timelineToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "quadrantChart") {
      result = quadrantToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "kanban") {
      result = kanbanToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "packet") {
      result = packetToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "xychart") {
      result = xychartToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "radar") {
      result = radarToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "sankey") {
      result = sankeyToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "gitGraph") {
      result = gitGraphToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "requirement") {
      result = requirementToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "C4") {
      result = c4ToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "treemap") {
      result = treemapToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "block") {
      result = blockToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "architecture") {
      result = architectureToDrawio(mermaidSource, effectiveOpts);
    } else if (kind === "zenuml") {
      result = zenumlToDrawio(mermaidSource, effectiveOpts);
    } else {
      throw new Error(
        `Native mode supports flowchart, erDiagram, sequenceDiagram, stateDiagram, ` +
          `classDiagram, pie, gantt, mindmap, journey, timeline, quadrantChart, ` +
          `kanban, packet, xychart, radar, sankey, gitGraph, requirementDiagram, C4, ` +
          `treemap, block, architecture, and zenuml. ` +
          `Detected: ${kind || "unknown"}. Use --mode png or --mode svg instead.`
      );
    }
    const { xml, warnings } = result;
    if (warnings && warnings.length && opts.onWarn) {
      for (const w of warnings) opts.onWarn(w);
    }
    return xml;
  }
  const renderOpts = { ...opts, format: mode };
  const rendered = await renderMermaid(mermaidSource, renderOpts);
  if (rendered.format === "png") {
    return buildDrawioFromPng(rendered.data, rendered.width, rendered.height, effectiveOpts);
  }
  return buildDrawioFromSvg(rendered.data, effectiveOpts);
}

/**
 * Detect the kind of Mermaid diagram from the source's header line.
 *
 * Skips:
 *   - `---` YAML front matter blocks (delimited by `---` on its own line on
 *     both sides)
 *   - `%%{ ... }%%` init directives
 *   - blank lines and `%%` comments
 *
 * @param {string} source
 * @returns {string} one of: flowchart, er, sequence, class, state, gantt,
 *   pie, mindmap, journey, gitGraph, timeline, quadrantChart, xychart,
 *   requirement, C4, sankey, block, packet, kanban, architecture, zenuml,
 *   radar, or "unknown"
 */
export function detectDiagramKind(source) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let inFrontMatter = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/%%.*$/, "").trim();
    if (!line) continue;
    if (line === "---") {
      // Toggle YAML front matter block. The opener must be the very first
      // non-blank line; after the closing `---` we resume normal scanning.
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;
    if (line.startsWith("%%{")) continue;
    if (/^(flowchart|graph)\b/i.test(line)) return "flowchart";
    if (/^erDiagram\b/i.test(line)) return "er";
    if (/^sequenceDiagram\b/i.test(line)) return "sequence";
    if (/^classDiagram(-v2)?\b/i.test(line)) return "class";
    if (/^stateDiagram(-v2)?\b/i.test(line)) return "state";
    if (/^gantt\b/i.test(line)) return "gantt";
    if (/^pie\b/i.test(line)) return "pie";
    if (/^mindmap\b/i.test(line)) return "mindmap";
    if (/^journey\b/i.test(line)) return "journey";
    if (/^gitGraph\b/i.test(line)) return "gitGraph";
    if (/^timeline\b/i.test(line)) return "timeline";
    if (/^quadrantChart\b/i.test(line)) return "quadrantChart";
    if (/^xychart(-beta)?\b/i.test(line)) return "xychart";
    if (/^requirementDiagram\b/i.test(line)) return "requirement";
    if (/^C4(Context|Container|Component|Dynamic|Deployment)\b/.test(line)) return "C4";
    if (/^sankey(-beta)?\b/i.test(line)) return "sankey";
    if (/^treemap(-beta)?\b/i.test(line)) return "treemap";
    if (/^block(-beta)?\b/i.test(line)) return "block";
    if (/^packet(-beta)?\b/i.test(line)) return "packet";
    if (/^kanban\b/i.test(line)) return "kanban";
    if (/^architecture(-beta)?\b/i.test(line)) return "architecture";
    if (/^zenuml\b/i.test(line)) return "zenuml";
    if (/^radar(-beta)?\b/i.test(line)) return "radar";
    return "unknown";
  }
  return "unknown";
}

/**
 * Extract the bodies of ```mermaid fenced code blocks from Markdown text.
 * Handles ``` and ~~~ fences of length >= 3 (closing fence must match the
 * opening characters) and info strings like "mermaid {init: ...}".
 *
 * @param {string} text
 * @returns {string[]} mermaid sources, in document order
 */
export function extractMermaidBlocks(text) {
  return extractMermaidBlocksWithHeadings(text).map((b) => b.source);
}

/**
 * Like extractMermaidBlocks, but each block also carries the nearest
 * preceding Markdown heading — provided that heading appeared *after* the
 * previous mermaid block (each heading names at most the first block that
 * follows it, so a single document title doesn't get copied onto every
 * block). Headings inside other code fences are ignored.
 *
 * @param {string} text
 * @returns {Array<{source: string, heading: string|null}>}
 */
export function extractMermaidBlocksWithHeadings(text) {
  const src = text.replace(/^\uFEFF/, "");
  const FENCE_ANY = /(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\1[ \t]*(?=\n|$)/g;
  const fenceSpans = [...src.matchAll(FENCE_ANY)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const inFence = (pos) => fenceSpans.some(([s, e]) => pos >= s && pos < e);
  const headings = [...src.matchAll(/(?:^|\n)[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*(?=\n|$)/g)]
    .filter((m) => !inFence(m.index))
    .map((m) => ({ pos: m.index, text: m[2].trim() }));

  const blocks = [];
  const re = /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g;
  let m;
  let prevEnd = 0;
  while ((m = re.exec(src)) !== null) {
    const body = m[2].replace(/\s+$/, "");
    if (!body.trim()) continue;
    let heading = null;
    for (const h of headings) {
      if (h.pos >= prevEnd && h.pos < m.index) heading = h.text;
    }
    blocks.push({ source: body, heading });
    prevEnd = m.index + m[0].length;
  }
  return blocks;
}

/**
 * Convert several mermaid sources into a single multi-page .drawio file
 * (one <diagram> page per source). Each entry is either a plain source
 * string or {source, defaultName}. Page-name precedence: the block's YAML
 * front-matter `title:` > defaultName (e.g. a Markdown heading or file
 * basename) > "Page-N"; duplicates get a numeric suffix.
 *
 * @param {Array<string|{source: string, defaultName?: string|null}>} sources
 * @param {object} [opts] Same options as convertMermaidToDrawio (mode,
 *                        theme, background, scale, onWarn).
 * @returns {Promise<string>} drawio XML with one page per source
 */
export async function convertManyMermaidToDrawio(sources, opts = {}) {
  if (!sources.length) throw new Error("no mermaid sources given");
  const items = sources.map((s) =>
    typeof s === "string" ? { source: s, defaultName: null } : s
  );
  const pages = [];
  const usedNames = new Set();
  for (let i = 0; i < items.length; i++) {
    const src = items[i].source;
    let name =
      extractFrontMatterTitle(src) || items[i].defaultName || `Page-${i + 1}`;
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
    }
    usedNames.add(name);

    const pageOpts = { ...opts, diagramName: name };
    delete pageOpts.defaultDiagramName;
    const onWarn = opts.onWarn
      ? (w) => opts.onWarn(`[page ${i + 1}: ${name}] ${w}`)
      : undefined;
    const xml = await convertMermaidToDrawio(src, { ...pageOpts, onWarn });

    // Every renderer emits exactly one <diagram ... id="m2d-1"> element;
    // lift it out and re-number the id so pages stay unique.
    const dm = xml.match(/<diagram [^>]*>[\s\S]*?<\/diagram>/);
    if (!dm) throw new Error(`internal: no <diagram> element for page ${i + 1}`);
    pages.push(dm[0].replace(/\bid="m2d-1"/, `id="m2d-${i + 1}"`));
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="mermaid2drawio" type="device" version="24.0.0">` +
    pages.join("") +
    `</mxfile>`
  );
}

/**
 * Extract `title:` from a YAML front matter block. Returns null when no
 * front matter or no title is present.
 *
 * @param {string} source
 * @returns {string|null}
 */
export function extractFrontMatterTitle(source) {
  const lines = source.split(/\r?\n/);
  let inFrontMatter = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "---") {
      if (!inFrontMatter) {
        inFrontMatter = true;
        continue;
      }
      return null; // closed without finding title
    }
    if (!inFrontMatter) return null;
    const m = line.match(/^title\s*:\s*(.*)$/i);
    if (m) {
      let t = m[1].trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1);
      }
      return t;
    }
  }
  return null;
}
