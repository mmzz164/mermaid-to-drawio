import dagreModule from "@dagrejs/dagre";
import {
  parseErDiagram,
  cardinalitySymbol,
  arrowEndForCard,
} from "./erdiagram-parser.js";
import { measureMultiline, visualWidth } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

const HEADER_H = 28;
const ROW_H = 22;
const PADDING_X = 12;
const NODE_MIN_W = 160;
const CHAR_PX = 7.2;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Compute split widths for the type/name columns based on the widest
 * content in each column. Always at least min widths; capped at 60% of
 * the row so the other column never disappears.
 */
function estimateColumnWidths(entity, totalWidth) {
  const MIN_COL = 60;
  let typeMax = 4; // "type" header heuristic
  let nameMax = 4;
  for (const a of entity.attributes) {
    typeMax = Math.max(typeMax, visualWidth(a.type || ""));
    nameMax = Math.max(nameMax, visualWidth(formatAttrName(a)));
  }
  const innerPad = PADDING_X * 2;
  const innerW = Math.max(MIN_COL * 2, totalWidth - innerPad);
  const ratio = typeMax / Math.max(1, typeMax + nameMax);
  let typeW = Math.round(innerW * ratio);
  typeW = Math.max(MIN_COL, Math.min(Math.round(innerW * 0.6), typeW));
  let nameW = totalWidth - typeW;
  if (nameW < MIN_COL) {
    nameW = MIN_COL;
    typeW = totalWidth - nameW;
  }
  return { typeW, nameW };
}

function estimateEntitySize(entity) {
  const rows = entity.attributes.length;
  // Take the visual width of the widest line: name OR any "type name (keys) - comment"
  let widest = visualWidth(entity.name);
  for (const a of entity.attributes) {
    widest = Math.max(widest, visualWidth(formatAttr(a)));
  }
  const w = Math.max(NODE_MIN_W, Math.round(widest * CHAR_PX) + PADDING_X * 2);
  const h = HEADER_H + rows * ROW_H;
  return { w, h };
}

function formatAttr(a) {
  const keyTag = a.keys && a.keys.length ? ` ${a.keys.join(",")}` : "";
  const cmt = a.comment ? ` "${a.comment}"` : "";
  return `${a.type} ${a.name}${keyTag}${cmt}`;
}

function formatAttrName(a) {
  const keyTag = a.keys && a.keys.length ? ` (${a.keys.join(",")})` : "";
  const cmt = a.comment ? ` – ${a.comment}` : "";
  return `${a.name}${keyTag}${cmt}`;
}

/**
 * Build a drawio mxfile that renders a mermaid erDiagram natively.
 * Each entity is a draw.io table shape: a parent rectangle (header) with
 * a child row per attribute.
 */
export function erDiagramToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseErDiagram(mermaidSource);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: 50,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const entity of model.entities.values()) {
    const { w, h } = estimateEntitySize(entity);
    g.setNode(entity.name, { width: w, height: h });
  }

  let edgeIdx = 0;
  for (const rel of model.relationships) {
    if (!g.hasNode(rel.from) || !g.hasNode(rel.to)) continue;
    g.setEdge(rel.from, rel.to, {}, `e${edgeIdx++}`);
  }

  dagre.layout(g);

  const cells = [
    `<mxCell id="0" />`,
    `<mxCell id="1" parent="0" />`,
  ];

  // Entities: a parent header row + child rows for each attribute.
  for (const entity of model.entities.values()) {
    const li = g.node(entity.name);
    if (!li) continue;
    const x = li.x - li.width / 2;
    const y = li.y - li.height / 2;
    const w = li.width;
    const h = li.height;

    const entId = entity.name;

    const headerStyle =
      "shape=table;startSize=28;container=1;collapsible=0;childLayout=tableLayout;fontSize=14;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;";

    cells.push(
      `<mxCell id="${escapeXml(entId)}" value="${escapeXml(entity.name)}" style="${headerStyle}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
        `</mxCell>`
    );

    // Dynamically split each row into type/name columns based on the longest
    // content per column. With short types and long names the type column
    // shrinks; with long types and short names it grows (capped at 60%).
    const { typeW: typeColW } = estimateColumnWidths(entity, Math.round(w));
    let rowY = HEADER_H;
    for (const [i, attr] of entity.attributes.entries()) {
      const rowId = `${entId}-row-${i}`;
      const rowStyle =
        "shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;strokeColor=inherit;top=0;left=0;bottom=0;right=0;collapsible=0;dropTarget=0;fillColor=none;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;fontSize=12;";
      cells.push(
        `<mxCell id="${escapeXml(rowId)}" value="" style="${rowStyle}" vertex="1" parent="${escapeXml(entId)}">` +
          `<mxGeometry y="${rowY}" width="${round(w)}" height="${ROW_H}" as="geometry" />` +
          `</mxCell>`
      );
      // Two cells: type, name (+keys)
      const cell1Style =
        "shape=partialRectangle;html=1;whiteSpace=wrap;connectable=0;strokeColor=inherit;overflow=hidden;fillColor=none;top=0;left=0;bottom=0;right=0;pointerEvents=1;fontSize=12;align=left;spacingLeft=6;";
      const cell2Style = cell1Style;
      const typeText = escapeXml(attr.type);
      const nameText = escapeXml(formatAttrName(attr));
      cells.push(
        `<mxCell id="${escapeXml(rowId)}-c1" value="${typeText}" style="${cell1Style}" vertex="1" parent="${escapeXml(rowId)}">` +
          `<mxGeometry width="${typeColW}" height="${ROW_H}" as="geometry" />` +
          `</mxCell>`
      );
      cells.push(
        `<mxCell id="${escapeXml(rowId)}-c2" value="${nameText}" style="${cell2Style}" vertex="1" parent="${escapeXml(rowId)}">` +
          `<mxGeometry x="${typeColW}" width="${w - typeColW}" height="${ROW_H}" as="geometry" />` +
          `</mxCell>`
      );
      rowY += ROW_H;
    }
  }

  // Relationships
  let eId = 1;
  for (const rel of model.relationships) {
    if (!model.entities.has(rel.from) || !model.entities.has(rel.to)) continue;
    const startArrow = arrowEndForCard(rel.leftCard);
    const endArrow = arrowEndForCard(rel.rightCard);
    const dashed = rel.identifying ? "" : "dashed=1;";
    const selfRef = rel.from === rel.to;
    // For self-references, drawio's entityRelationEdgeStyle router does not
    // produce a usable path (source==target), so fall back to a plain edge
    // whose waypoints define the loop.
    const routerStyle = selfRef ? "" : "edgeStyle=entityRelationEdgeStyle;";
    const style =
      routerStyle +
      "fontSize=11;html=1;labelBackgroundColor=#ffffff;rounded=0;" +
      "endArrow=" +
      endArrow +
      ";startArrow=" +
      startArrow +
      ";" +
      (selfRef
        ? "exitX=1;exitY=0.25;exitDx=0;exitDy=0;entryX=1;entryY=0.75;entryDx=0;entryDy=0;"
        : "") +
      dashed;
    const value = rel.label ? escapeXml(rel.label) : "";

    let geom = `<mxGeometry relative="1" as="geometry" />`;
    if (selfRef) {
      const node = g.node(rel.from);
      if (node) {
        const right = Math.round(node.x + node.width / 2);
        const top = Math.round(node.y - node.height / 2);
        const yIn = top + Math.round(node.height * 0.25);
        const yOut = top + Math.round(node.height * 0.75);
        const loopX = right + 60;
        geom =
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${right}" y="${yIn}" as="sourcePoint" />` +
          `<mxPoint x="${right}" y="${yOut}" as="targetPoint" />` +
          `<Array as="points">` +
          `<mxPoint x="${loopX}" y="${yIn}" />` +
          `<mxPoint x="${loopX}" y="${yOut}" />` +
          `</Array>` +
          `</mxGeometry>`;
      }
    }

    cells.push(
      `<mxCell id="er-edge-${eId}" value="${value}" style="${style}" edge="1" parent="1" source="${escapeXml(rel.from)}" target="${escapeXml(rel.to)}">` +
        geom +
        `</mxCell>`
    );
    eId++;
  }

  const graphAttrs = g.graph();
  const pageW = Math.max(850, Math.round(graphAttrs.width || 850) + 40);
  const pageH = Math.max(1100, Math.round(graphAttrs.height || 1100) + 40);

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="mermaid2drawio" type="device" version="24.0.0">` +
    `<diagram name="${escapeXml(diagramName)}" id="m2d-1">` +
    `<mxGraphModel dx="${pageW}" dy="${pageH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">` +
    `<root>` +
    cells.join("") +
    `</root>` +
    `</mxGraphModel>` +
    `</diagram>` +
    `</mxfile>`;

  return { xml, warnings: model.warnings };
}

function round(n) {
  return Math.round(n);
}
