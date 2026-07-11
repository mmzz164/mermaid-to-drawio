import { escapeXml, round, wrapXml, CATEGORICAL, bodyLines, unquote } from "./drawio-xml.js";
import { visualWidth } from "./text-width.js";

/**
 * Minimal Mermaid treemap parser.
 *
 *   treemap-beta
 *   "Section"
 *       "Leaf": 12
 *       "Nested"
 *           "Leaf2": 5
 *
 * Indentation defines the hierarchy; a trailing `: number` marks a leaf value.
 * Internal-node values are the sum of their descendants. `classDef`/`:::name`
 * styling is accepted and ignored.
 */
export function parseTreemap(source) {
  const warnings = [];
  const root = { name: "", value: 0, children: [], depth: -1, leaf: false };
  const stack = [{ node: root, indent: -1 }];

  for (const { line, trimmed, lineNo } of bodyLines(source, /^treemap(-beta)?\b/i)) {
    if (/^classDef\b/i.test(trimmed) || /^class\b/i.test(trimmed)) continue; // styling: ignored
    const indent = line.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
    // `"Name": value`  |  `"Name"`  |  `Name: value`  |  `Name`
    const m = trimmed.match(/^(?:"([^"]*)"|([^:]+?))\s*(?::\s*(-?[\d.]+))?\s*(?::::[\w-]+)?$/);
    if (!m) {
      warnings.push(`Line ${lineNo}: could not parse treemap line: ${trimmed}`);
      continue;
    }
    const name = unquote((m[1] ?? m[2] ?? "").trim());
    const value = m[3] !== undefined ? parseFloat(m[3]) : null;
    // Pop the stack to the parent for this indent level.
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const node = { name, value: value ?? 0, children: [], depth: parent.depth + 1, leaf: value !== null };
    parent.children.push(node);
    stack.push({ node, indent });
  }

  // Aggregate internal-node values bottom-up.
  (function agg(n) {
    if (n.children.length === 0) return n.value;
    n.value = n.children.reduce((s, c) => s + agg(c), 0);
    return n.value;
  })(root);

  return { root, warnings };
}

const PAD = 4;
const HEADER_H = 20;

function worst(row, side) {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return Infinity;
  const mx = Math.max(...row);
  const mn = Math.min(...row);
  return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
}

/** Squarified treemap tiling (Bruls, Huizing, van Wijk). */
function squarify(nodes, x, y, w, h, out) {
  const total = nodes.reduce((s, n) => s + Math.max(n.value, 0.0001), 0);
  const scale = (w * h) / total;
  const items = nodes.map((n) => ({ node: n, area: Math.max(n.value, 0.0001) * scale }));
  let i = 0;
  while (i < items.length) {
    const wide = w >= h;
    const side = wide ? h : w;
    const row = [items[i].area];
    const rowNodes = [items[i].node];
    let j = i + 1;
    while (j < items.length) {
      if (worst([...row, items[j].area], side) <= worst(row, side)) {
        row.push(items[j].area);
        rowNodes.push(items[j].node);
        j++;
      } else break;
    }
    const rowSum = row.reduce((a, b) => a + b, 0);
    const thickness = rowSum / side;
    let off = 0;
    for (let k = 0; k < row.length; k++) {
      const len = row[k] / thickness;
      if (wide) out.push({ node: rowNodes[k], x, y: y + off, w: thickness, h: len });
      else out.push({ node: rowNodes[k], x: x + off, y, w: len, h: thickness });
      off += len;
    }
    if (wide) { x += thickness; w -= thickness; } else { y += thickness; h -= thickness; }
    i = j;
  }
}

function lighten(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * t);
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, "0")}`;
}

/**
 * Convert a Mermaid treemap to draw.io: nested rectangles whose areas are
 * proportional to their values, tiled with a squarified layout. Internal
 * nodes carry a header label + aggregate value; leaves show a centered label.
 */
export function treemapToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseTreemap(mermaidSource);
  const warnings = [...model.warnings];
  const cells = []; // wrapXml adds the root cells (id 0 and 1)

  const W = 900, H = 600, MARGIN = 20;
  if (model.root.children.length === 0) {
    warnings.push("treemap has no data");
    return { xml: wrapXml(cells, W, H, diagramName), warnings };
  }

  let id = 0;
  // Assign a base color per top-level branch; deepen (lighten) with depth.
  const baseColorOf = new Map();
  model.root.children.forEach((c, i) => baseColorOf.set(c, CATEGORICAL[i % CATEGORICAL.length]));

  function draw(node, x, y, w, h, baseColor, parentId) {
    const isLeaf = node.children.length === 0;
    const fill = lighten(baseColor, Math.min(0.15 + node.depth * 0.18, 0.75));
    const cid = `tm-${id++}`;
    const valTxt = Number.isInteger(node.value) ? `${node.value}` : node.value.toFixed(1);
    if (isLeaf) {
      const label = `<b>${escapeXml(node.name)}</b><br><font style="font-size:10px">${valTxt}</font>`;
      cells.push(
        `<mxCell id="${cid}" value="${escapeXml(label)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=#ffffff;strokeWidth=2;fontSize=12;verticalAlign=middle;align=center;" vertex="1" parent="${parentId}">` +
          `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
          `</mxCell>`
      );
      return;
    }
    // Internal node: frame + header label, then tile children below the header.
    // The whole HTML label is XML-escaped into the value attribute (draw.io
    // unescapes it, then interprets the HTML).
    const header = `${escapeXml(node.name)} <font style="font-size:9px;color:#555">${valTxt}</font>`;
    cells.push(
      `<mxCell id="${cid}" value="${node.depth < 0 ? "" : escapeXml(header)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=#ffffff;strokeWidth=2;fontSize=11;fontStyle=1;verticalAlign=top;align=left;spacingLeft=6;spacingTop=3;" vertex="1" parent="${parentId}">` +
        `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
        `</mxCell>`
    );
    const hh = node.depth < 0 ? 0 : HEADER_H;
    const ix = x + PAD, iy = y + hh + PAD;
    const iw = Math.max(1, w - PAD * 2), ih = Math.max(1, h - hh - PAD * 2);
    const rects = [];
    squarify(node.children, ix, iy, iw, ih, rects);
    for (const r of rects) {
      draw(r.node, r.x, r.y, r.w, r.h, baseColor, "1");
    }
  }

  // Lay out the top-level branches within the canvas, then recurse.
  const rects = [];
  squarify(model.root.children, MARGIN, MARGIN, W - MARGIN * 2, H - MARGIN * 2, rects);
  for (const r of rects) {
    draw(r.node, r.x, r.y, r.w, r.h, baseColorOf.get(r.node), "1");
  }

  return { xml: wrapXml(cells, W, H, diagramName), warnings };
}
