/**
 * Shared helpers for the smaller diagram renderers (journey, timeline,
 * quadrantChart, kanban, packet, xychart, radar, sankey, gitGraph,
 * requirementDiagram, C4). The five original renderers predate this module
 * and keep their own copies — do not "deduplicate" them into this file
 * without re-running their full test suites.
 */

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function round(n) {
  return Math.round(n);
}

/**
 * Wrap mxCell strings into a complete single-page .drawio document.
 */
export function wrapXml(cells, w, h, diagramName) {
  const pw = Math.max(850, Math.round(w));
  const ph = Math.max(1100, Math.round(h));
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="mermaid2drawio" type="device" version="24.0.0">` +
    `<diagram name="${escapeXml(diagramName)}" id="m2d-1">` +
    `<mxGraphModel dx="${pw}" dy="${ph}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pw}" pageHeight="${ph}" math="0" shadow="0">` +
    `<root>` +
    `<mxCell id="0" />` +
    `<mxCell id="1" parent="0" />` +
    cells.join("") +
    `</root>` +
    `</mxGraphModel>` +
    `</diagram>` +
    `</mxfile>`
  );
}

/** Categorical series palette (AntV-derived, readable on white). */
export const CATEGORICAL = [
  "#5B8FF9",
  "#61DDAA",
  "#F6BD16",
  "#7262fd",
  "#78D3F8",
  "#9661BC",
  "#F6903D",
  "#008685",
  "#F08BB4",
  "#65789B",
];

/** Pastel fills (with matching darker strokes via darken()). */
export const PASTEL = [
  "#dae8fc",
  "#d5e8d4",
  "#ffe6cc",
  "#fff2cc",
  "#f8cecc",
  "#e1d5e7",
  "#d0f0f7",
  "#f5e3ff",
];

/** Darken a #rrggbb color by factor (0..1, smaller = darker). */
export function darken(hex, factor = 0.6) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.round(v * factor));
  const r = f((n >> 16) & 0xff);
  const g = f((n >> 8) & 0xff);
  const b = f(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Scan generated drawio XML for the bug class that makes draw.io refuse a
 * file: raw '<'/'>' inside attribute values (HTML labels must be stored
 * XML-escaped) or unbalanced quotes. Returns a list of human-readable
 * problems — empty when the document looks sound.
 *
 * @param {string} xml
 * @returns {string[]}
 */
export function findXmlAttributeProblems(xml) {
  const problems = [];
  for (const m of xml.matchAll(/[\w-]+="([^"]*)"/g)) {
    if (/[<>]/.test(m[1])) {
      problems.push(`raw <> inside attribute value: ${m[1].slice(0, 80)}`);
    }
  }
  if (((xml.match(/"/g) || []).length & 1) !== 0) {
    problems.push("unbalanced double quotes");
  }
  // Duplicate mxCell ids make the draw.io viewer refuse the whole model
  // (renders blank) — e.g. a renderer that emits the root cells 0/1 that
  // wrapXml already adds. This passes the escaping checks, so guard it here.
  const ids = new Set();
  for (const m of xml.matchAll(/<mxCell\s[^>]*\bid="([^"]*)"/g)) {
    if (ids.has(m[1])) problems.push(`duplicate mxCell id: ${m[1]}`);
    ids.add(m[1]);
  }
  return problems;
}

/**
 * Strip a %% comment, but keep %% inside quoted strings intact.
 * Good enough for line-based grammars where quotes never nest.
 */
export function stripComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (!inQuote && line[i] === "%" && line[i + 1] === "%") {
      return line.slice(0, i);
    }
  }
  return line;
}

export function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Iterate the body lines of a diagram source: skips front matter, blank
 * lines, %%-comments, and everything up to (and including) the header line
 * matched by headerRe. Yields { line, lineNo }.
 */
export function* bodyLines(source, headerRe) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let started = false;
  let inFrontMatter = false;
  let lineNo = 0;
  for (const raw of lines) {
    lineNo++;
    const line = stripComment(raw).trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!started && trimmed === "---") {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;
    if (!started) {
      if (headerRe.test(trimmed)) started = true;
      continue;
    }
    yield { line, trimmed, lineNo };
  }
}
