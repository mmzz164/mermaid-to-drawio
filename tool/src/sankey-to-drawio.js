import { escapeXml, round, wrapXml, CATEGORICAL, bodyLines, unquote } from "./drawio-xml.js";
import { visualWidth } from "./text-width.js";

/**
 * Minimal Mermaid sankey parser (sankey-beta / sankey). The grammar is CSV:
 *
 *   sankey-beta
 *     source,target,value
 *     "quoted, name",other,12.5
 */
export function parseSankey(source) {
  const warnings = [];
  const links = [];

  for (const { trimmed, lineNo } of bodyLines(source, /^sankey(-beta)?\b/i)) {
    const parts = splitCsv(trimmed);
    if (parts.length !== 3) {
      warnings.push(`Line ${lineNo}: expected 'source,target,value': ${trimmed}`);
      continue;
    }
    const value = parseFloat(parts[2]);
    if (!Number.isFinite(value) || value < 0) {
      warnings.push(`Line ${lineNo}: invalid value: ${parts[2]}`);
      continue;
    }
    links.push({ from: unquote(parts[0]), to: unquote(parts[1]), value });
  }
  return { links, warnings };
}

function splitCsv(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter((s) => s !== "");
}

const LAYER_GAP = 220;
const NODE_W = 24;
const NODE_GAP = 24;
const MARGIN = 40;
const PX_PER_UNIT_MAX = 3;

/**
 * Convert a Mermaid sankey to draw.io XML — a simplified sankey: nodes are
 * placed in layers by longest path from the sources, node heights and edge
 * stroke widths are proportional to flow. (True curved ribbons are not
 * representable as editable draw.io cells.)
 */
export function sankeyToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseSankey(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.links.length === 0) {
    warnings.push("sankey has no links");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  // Collect nodes; compute layer = longest path from any source.
  const names = [];
  const nameSet = new Set();
  for (const l of model.links) {
    for (const n of [l.from, l.to]) {
      if (!nameSet.has(n)) {
        nameSet.add(n);
        names.push(n);
      }
    }
  }
  const layer = new Map(names.map((n) => [n, 0]));
  // Relax edges up to V times (cycles guard); a cycle would loop forever.
  for (let iter = 0; iter < names.length; iter++) {
    let changed = false;
    for (const l of model.links) {
      if (layer.get(l.to) < layer.get(l.from) + 1) {
        layer.set(l.to, layer.get(l.from) + 1);
        changed = true;
      }
    }
    if (!changed) break;
    if (iter === names.length - 1) {
      warnings.push("sankey contains a cycle; layering is approximate");
    }
  }

  // Node throughput = max(in, out); scale to pixels.
  const inflow = new Map();
  const outflow = new Map();
  for (const l of model.links) {
    outflow.set(l.from, (outflow.get(l.from) || 0) + l.value);
    inflow.set(l.to, (inflow.get(l.to) || 0) + l.value);
  }
  const throughput = (n) => Math.max(inflow.get(n) || 0, outflow.get(n) || 0);
  const maxThroughput = Math.max(...names.map(throughput));
  const pxPerUnit = Math.min(PX_PER_UNIT_MAX, 200 / maxThroughput);

  // Stack nodes per layer.
  const layers = new Map();
  for (const n of names) {
    const li = layer.get(n);
    if (!layers.has(li)) layers.set(li, []);
    layers.get(li).push(n);
  }
  const pos = new Map();
  const color = new Map(names.map((n, i) => [n, CATEGORICAL[i % CATEGORICAL.length]]));
  let maxBottom = 0;
  let maxLayer = 0;
  for (const [li, members] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    maxLayer = Math.max(maxLayer, li);
    let y = MARGIN;
    for (const n of members) {
      const h = Math.max(18, throughput(n) * pxPerUnit);
      const x = MARGIN + li * LAYER_GAP;
      pos.set(n, { x, y, h });
      y += h + NODE_GAP;
    }
    maxBottom = Math.max(maxBottom, y);
  }

  // Nodes with labels beside them.
  names.forEach((n, i) => {
    const p = pos.get(n);
    cells.push(
      `<mxCell id="sk-n-${i}" value="" style="rounded=0;html=1;fillColor=${color.get(n)};strokeColor=none;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(p.x)}" y="${round(p.y)}" width="${NODE_W}" height="${round(p.h)}" as="geometry" />` +
        `</mxCell>`
    );
    const isLast = layer.get(n) === maxLayer;
    const lw = Math.max(60, visualWidth(n) * 7.2 + 10);
    const lx = isLast ? p.x - lw - 4 : p.x + NODE_W + 4;
    cells.push(
      `<mxCell id="sk-nl-${i}" value="${escapeXml(n)}" ` +
        `style="text;html=1;align=${isLast ? "right" : "left"};verticalAlign=middle;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(lx)}" y="${round(p.y + p.h / 2 - 10)}" width="${round(lw)}" height="20" as="geometry" />` +
        `</mxCell>`
    );
  });

  // Links: stroke width proportional to value, labeled with the value.
  const nodeIdx = new Map(names.map((n, i) => [n, i]));
  model.links.forEach((l, i) => {
    const w = Math.max(1, Math.min(30, l.value * pxPerUnit));
    cells.push(
      `<mxCell id="sk-e-${i}" value="${escapeXml(String(l.value))}" ` +
        `style="endArrow=none;html=1;curved=1;strokeWidth=${round(w)};strokeColor=${color.get(l.from)};opacity=45;` +
        `fontSize=10;labelBackgroundColor=#ffffff;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" ` +
        `edge="1" parent="1" source="sk-n-${nodeIdx.get(l.from)}" target="sk-n-${nodeIdx.get(l.to)}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`
    );
  });

  const pageW = MARGIN * 2 + (maxLayer + 1) * LAYER_GAP;
  const pageH = maxBottom + MARGIN;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
