import { escapeXml, round, wrapXml, bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal Mermaid block-beta parser.
 *
 *   block-beta
 *     columns 3
 *     a["Frontend"] b["API"] c["DB"]
 *     space:3
 *     block:group1:2
 *       d e
 *     end
 *     a --> b
 *
 * Supported: `columns N`, blocks with a label + shape + `:span`, `space[:N]`,
 * one level of `block:id[:span] ... end` groups, and edges (`a --> b`,
 * `a -- "label" --> b`). `classDef`/`style`/`class` are accepted and ignored.
 */
const SHAPE_OPENERS = [
  ["((", "))", "circle"],
  ["([", "])", "stadium"],
  ["[[", "]]", "subroutine"],
  ["{{", "}}", "hexagon"],
  ["(", ")", "rounded"],
  ["[", "]", "square"],
  ["{", "}", "rhombus"],
  [">", "]", "flag"],
];

function readBlockToken(s, i) {
  // returns { token: {id,label,shape,span} | {space:true,span}, next } or null
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length) return null;
  const idm = s.slice(i).match(/^([A-Za-z0-9_぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯-]+)/);
  if (!idm) return null;
  let id = idm[1];
  let j = i + id.length;
  let label = id;
  let shape = "square";
  // Optional shape wrapper.
  for (const [open, close, name] of SHAPE_OPENERS) {
    if (s.startsWith(open, j)) {
      const end = s.indexOf(close, j + open.length);
      if (end !== -1) {
        label = unquote(s.slice(j + open.length, end).trim());
        shape = name;
        j = end + close.length;
      }
      break;
    }
  }
  // Optional :span
  let span = 1;
  const spanm = s.slice(j).match(/^:(\d+)/);
  if (spanm) { span = parseInt(spanm[1], 10); j += spanm[0].length; }
  if (id === "space") return { token: { space: true, span }, next: j };
  return { token: { id, label, shape, span }, next: j };
}

const STYLE_MAP = {
  circle: (l) => `ellipse;whiteSpace=wrap;html=1;`,
  stadium: () => `rounded=1;arcSize=40;whiteSpace=wrap;html=1;`,
  subroutine: () => `shape=process;whiteSpace=wrap;html=1;`,
  hexagon: () => `shape=hexagon;whiteSpace=wrap;html=1;`,
  rounded: () => `rounded=1;whiteSpace=wrap;html=1;`,
  square: () => `rounded=0;whiteSpace=wrap;html=1;`,
  rhombus: () => `rhombus;whiteSpace=wrap;html=1;`,
  flag: () => `shape=trapezoid;whiteSpace=wrap;html=1;`,
};

export function parseBlock(source) {
  const warnings = [];
  let columns = 1;
  const items = []; // {type:'block'|'space'|'group', ...}
  const edges = [];
  let group = null; // current open group

  const EDGE_RE = /^([A-Za-z0-9_぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯-]+)\s*(?:--\s*"([^"]*)"\s*-->|-->|---|-\.->|==>)\s*([A-Za-z0-9_぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯-]+)$/;

  for (const { trimmed, lineNo } of bodyLines(source, /^block(-beta)?\b/i)) {
    let m;
    if ((m = trimmed.match(/^columns\s+(\d+)$/i))) { columns = parseInt(m[1], 10); continue; }
    if (/^(classDef|class|style)\b/i.test(trimmed)) continue;
    if (/^end$/i.test(trimmed)) { if (group) { items.push(group); group = null; } continue; }
    if ((m = trimmed.match(/^block:([A-Za-z0-9_-]+)(?::(\d+))?(?:\["([^"]*)"\])?\s*$/i))) {
      group = { type: "group", id: m[1], label: m[3] ? unquote(m[3]) : "", span: m[2] ? parseInt(m[2], 10) : 1, children: [] };
      continue;
    }
    if ((m = trimmed.match(EDGE_RE))) {
      edges.push({ from: m[1], to: m[3], label: m[2] || "" });
      continue;
    }
    // Otherwise: one or more block tokens on the line.
    let i = 0;
    let any = false;
    while (i < trimmed.length) {
      const r = readBlockToken(trimmed, i);
      if (!r) break;
      any = true;
      const dest = group ? group.children : items;
      if (r.token.space) dest.push({ type: "space", span: r.token.span });
      else dest.push({ type: "block", ...r.token });
      i = r.next;
    }
    if (!any) warnings.push(`Line ${lineNo}: could not parse block line: ${trimmed}`);
  }
  if (group) items.push(group); // unterminated group
  return { columns, items, edges, warnings };
}

const CELL_W = 120, CELL_H = 50, GAP = 16, MARGIN = 20, GROUP_PAD = 10, GROUP_HEAD = 4;

export function blockToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseBlock(mermaidSource);
  const warnings = [...model.warnings];
  const cells = []; // wrapXml adds the root cells (id 0 and 1)
  const cols = Math.max(1, model.columns);
  const colStep = CELL_W + GAP;
  const rowStep = CELL_H + GAP;
  const pos = new Map(); // block id -> {cx, cy} center, for edges

  // Grid cursor.
  let col = 0, row = 0;
  const place = (span) => {
    if (col + span > cols) { col = 0; row++; }
    const p = { col, row };
    col += span;
    if (col >= cols) { col = 0; row++; }
    return p;
  };
  const cellX = (c) => MARGIN + c * colStep;
  const cellY = (r) => MARGIN + r * rowStep;
  let maxRow = 0;

  const emitBlock = (b, x, y, w, h, parent = "1") => {
    const style = (STYLE_MAP[b.shape] || STYLE_MAP.square)(b.label) +
      `fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;verticalAlign=middle;align=center;`;
    cells.push(
      `<mxCell id="${escapeXml(b.id)}" value="${escapeXml(b.label)}" style="${style}" vertex="1" parent="${parent}">` +
        `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
        `</mxCell>`
    );
    pos.set(b.id, { cx: x + w / 2, cy: y + h / 2 });
  };

  for (const it of model.items) {
    if (it.type === "space") { place(it.span); continue; }
    if (it.type === "block") {
      const p = place(it.span);
      const w = it.span * CELL_W + (it.span - 1) * GAP;
      emitBlock(it, cellX(p.col), cellY(p.row), w, CELL_H);
      maxRow = Math.max(maxRow, p.row);
      continue;
    }
    if (it.type === "group") {
      // Group occupies `span` columns; lay children in a single inner row.
      const childBlocks = it.children.filter((c) => c.type === "block");
      const p = place(it.span);
      const gx = cellX(p.col), gy = cellY(p.row);
      const gw = it.span * CELL_W + (it.span - 1) * GAP;
      const n = Math.max(1, childBlocks.length);
      const innerW = (gw - GROUP_PAD * 2 - GAP * (n - 1)) / n;
      const gh = CELL_H + GROUP_PAD * 2 + GROUP_HEAD;
      cells.push(
        `<mxCell id="${escapeXml(it.id)}" value="${escapeXml(it.label)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;verticalAlign=top;fontSize=11;fontStyle=1;dashed=1;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(gx)}" y="${round(gy)}" width="${round(gw)}" height="${round(gh)}" as="geometry" />` +
          `</mxCell>`
      );
      childBlocks.forEach((cb, k) => {
        const cx = gx + GROUP_PAD + k * (innerW + GAP);
        emitBlock(cb, cx, gy + GROUP_HEAD + GROUP_PAD, innerW, CELL_H);
      });
      maxRow = Math.max(maxRow, p.row);
      continue;
    }
  }

  // Edges.
  let ei = 0;
  for (const e of model.edges) {
    if (!pos.has(e.from) || !pos.has(e.to)) {
      warnings.push(`edge references unknown block: ${e.from} -> ${e.to}`);
      continue;
    }
    const a = pos.get(e.from), b = pos.get(e.to);
    cells.push(
      `<mxCell id="blk-e-${ei++}" value="${escapeXml(e.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#333333;fontSize=10;labelBackgroundColor=#ffffff;" edge="1" parent="1" source="${escapeXml(e.from)}" target="${escapeXml(e.to)}">` +
        `<mxGeometry relative="1" as="geometry" /></mxCell>`
    );
  }

  const pageW = MARGIN * 2 + cols * colStep;
  const pageH = MARGIN * 2 + (maxRow + 1) * rowStep + 20;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
