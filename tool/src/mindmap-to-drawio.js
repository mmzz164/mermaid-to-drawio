import dagreModule from "@dagrejs/dagre";
import { parseMindmap } from "./mindmap-parser.js";
import { measureMultiline } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

const CHAR_PX = 7.2;
const WRAP_COLS = 28;

// Per-branch colors (each child subtree of the root gets its own), soft
// pastels in the spirit of Mermaid's section palette.
const BRANCH_COLORS = [
  "#b9b9ff",
  "#ffffab",
  "#e8ffb9",
  "#ffb9ff",
  "#b9ffff",
  "#ffecec",
  "#e8d9ff",
  "#ffd9b3",
];
const ROOT_COLOR = "#ECECFF";

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function round(n) {
  return Math.round(n);
}

function nodeSize(node, depth) {
  const { maxWidth, lineCount } = measureMultiline(node.text, WRAP_COLS);
  const fontScale = depth === 0 ? 1.2 : 1;
  let w = Math.max(60, maxWidth * CHAR_PX * fontScale + 28);
  let h = Math.max(30, lineCount * 17 * fontScale + 14);
  if (node.shape === "circle" || node.shape === "bang" || node.shape === "cloud") {
    // Roundish shapes need extra padding so the text stays inside.
    w += 24;
    h = Math.max(h + 20, w * 0.55);
  }
  return { w: round(w), h: round(h) };
}

function shapeStyle(node, depth, branchColor) {
  const fill = depth === 0 ? ROOT_COLOR : depth === 1 ? branchColor : "#ffffff";
  const stroke = depth === 0 ? "#9673a6" : "#888888";
  const font = depth === 0 ? "fontSize=15;fontStyle=1;" : "fontSize=12;";
  const base = `html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=${stroke};${font}`;
  switch (node.shape) {
    case "circle":
      return `ellipse;${base}`;
    case "cloud":
    case "bang": // no bang shape in drawio; a cloud is the closest match
      return `shape=cloud;${base}`;
    case "hexagon":
      return `shape=hexagon;perimeter=hexagonPerimeter2;${base}`;
    case "square":
      return `rounded=0;${base}`;
    case "rounded":
      return `rounded=1;arcSize=40;${base}`;
    default:
      // Mermaid's bare nodes are just text on a line; a borderless pill
      // with a light fill keeps them visible and editable in draw.io.
      return depth === 0
        ? `ellipse;${base}`
        : `rounded=1;arcSize=50;${base}`;
  }
}

/**
 * Convert a Mermaid mindmap to draw.io XML as a left-to-right tree (dagre
 * layout). Mermaid draws mindmaps radially; a LR tree keeps the same
 * hierarchy while staying easy to rearrange in draw.io. Each top-level
 * branch gets its own color, like Mermaid's per-section coloring.
 */
export function mindmapToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseMindmap(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [`<mxCell id="0" />`, `<mxCell id="1" parent="0" />`];
  if (!model.root) {
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  // Flatten the tree, assigning ids, depths, and branch colors.
  const nodes = [];
  const edges = [];
  (function walk(node, depth, branchIdx) {
    const id = `mm-${nodes.length}`;
    const color = depth === 0 ? ROOT_COLOR : BRANCH_COLORS[branchIdx % BRANCH_COLORS.length];
    nodes.push({ id, node, depth, color });
    node.children.forEach((child, i) => {
      const childBranch = depth === 0 ? i : branchIdx;
      const childId = `mm-${nodes.length}`;
      edges.push({ from: id, to: childId, color: depth === 0 ? BRANCH_COLORS[childBranch % BRANCH_COLORS.length] : color });
      walk(child, depth + 1, childBranch);
    });
  })(model.root, 0, 0);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const { w, h } = nodeSize(n.node, n.depth);
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);

  for (const n of nodes) {
    const li = g.node(n.id);
    cells.push(
      `<mxCell id="${n.id}" value="${escapeXml(n.node.text)}" ` +
        `style="${shapeStyle(n.node, n.depth, n.color)}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(li.x - li.width / 2)}" y="${round(li.y - li.height / 2)}" ` +
        `width="${round(li.width)}" height="${round(li.height)}" as="geometry" />` +
        `</mxCell>`
    );
  }
  edges.forEach((e, i) => {
    cells.push(
      `<mxCell id="mm-e-${i}" value="" ` +
        `style="curved=1;endArrow=none;html=1;strokeWidth=2;strokeColor=${e.color === ROOT_COLOR ? "#9673a6" : darken(e.color)};" ` +
        `edge="1" parent="1" source="${e.from}" target="${e.to}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`
    );
  });

  const attrs = g.graph();
  const pageW = Math.max(850, round(attrs.width || 850) + 40);
  const pageH = Math.max(1100, round(attrs.height || 1100) + 40);
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}

/** Darken a #rrggbb pastel enough to read as a line color. */
function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.round(v * 0.6));
  const r = f((n >> 16) & 0xff);
  const gch = f((n >> 8) & 0xff);
  const b = f(n & 0xff);
  return `#${((r << 16) | (gch << 8) | b).toString(16).padStart(6, "0")}`;
}

function wrapXml(cells, w, h, diagramName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="mermaid2drawio" type="device" version="24.0.0">` +
    `<diagram name="${escapeXml(diagramName)}" id="m2d-1">` +
    `<mxGraphModel dx="${w}" dy="${h}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0">` +
    `<root>` +
    cells.join("") +
    `</root>` +
    `</mxGraphModel>` +
    `</diagram>` +
    `</mxfile>`
  );
}
