import { parsePieChart } from "./pie-parser.js";
import { visualWidth } from "./text-width.js";

// Mermaid default-theme pie palette (pie1..pie12), precomputed from the
// theme's HSL math (primary #ECECFF, secondary #ffffde, tertiary
// hsl(80,100%,96.27%), plus khroma adjust() hue/lightness offsets).
const PALETTE = [
  "#ECECFF",
  "#ffffde",
  "#f9ffec",
  "#b9b9ff",
  "#ffffab",
  "#e8ffb9",
  "#ffb9ff",
  "#b9ffff",
  "#ffecec",
  "#ff86ff",
  "#86ffff",
  "#ffb9b9",
];

const RADIUS = 170;
const MARGIN = 20;
const TITLE_H = 34;
const LEGEND_GAP = 40; // circle edge -> legend swatches
const LEGEND_ROW_H = 24;
const SWATCH = 14;
const CHAR_PX = 7.2;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * Build a drawio mxfile that renders a mermaid pie chart natively using
 * draw.io's `mxgraph.basic.pie` shape (startAngle/endAngle are fractions
 * of a full turn, clockwise from 12 o'clock — the same convention d3.pie
 * uses, so slices line up with Mermaid's rendering).
 */
export function pieToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parsePieChart(mermaidSource);
  const warnings = [...model.warnings];

  // d3.pie (and therefore Mermaid) orders slices by descending value.
  const slices = [...model.slices].sort((a, b) => b.value - a.value);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (slices.length === 0) {
    warnings.push("pie chart has no data rows");
  }

  const cx = MARGIN + RADIUS;
  const cy = MARGIN + (model.title ? TITLE_H : 0) + RADIUS;
  const cells = [`<mxCell id="0" />`, `<mxCell id="1" parent="0" />`];

  if (model.title) {
    cells.push(
      `<mxCell id="pie-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${MARGIN}" y="${MARGIN}" width="${RADIUS * 2}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Slices + percentage labels.
  let acc = 0;
  for (const [i, s] of slices.entries()) {
    if (total <= 0 || s.value <= 0) continue;
    const startAngle = acc / total;
    acc += s.value;
    const endAngle = acc / total;
    const frac = endAngle - startAngle;
    const fill = PALETTE[i % PALETTE.length];

    // A ~full-circle pie arc degenerates in mxgraph's renderer; use a
    // plain ellipse for a single 100% slice.
    const style =
      frac >= 0.9995
        ? `ellipse;html=1;fillColor=${fill};strokeColor=#000000;opacity=70;`
        : `shape=mxgraph.basic.pie;html=1;fillColor=${fill};strokeColor=#000000;opacity=70;` +
          `startAngle=${round4(startAngle)};endAngle=${round4(endAngle)};`;
    cells.push(
      `<mxCell id="pie-slice-${i}" value="" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${cx - RADIUS}" y="${cy - RADIUS}" width="${RADIUS * 2}" height="${RADIUS * 2}" as="geometry" />` +
        `</mxCell>`
    );

    // Percentage label at the slice's mid-angle (Mermaid shows rounded
    // integer percentages inside each slice).
    const mid = ((startAngle + endAngle) / 2) * 2 * Math.PI;
    const lr = RADIUS * 0.62;
    const lx = cx + Math.sin(mid) * lr;
    const ly = cy - Math.cos(mid) * lr;
    const pct = `${Math.round(frac * 100)}%`;
    cells.push(
      `<mxCell id="pie-pct-${i}" value="${escapeXml(pct)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=12;" vertex="1" parent="1">` +
        `<mxGeometry x="${Math.round(lx - 25)}" y="${Math.round(ly - 10)}" width="50" height="20" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Legend: swatch + label rows to the right of the circle. Zero-value
  // slices keep their legend entry even though they have no arc.
  const legendX = cx + RADIUS + LEGEND_GAP;
  const legendY = cy - RADIUS + 10;
  let maxLegendW = 0;
  for (const [i, s] of slices.entries()) {
    const rowY = legendY + i * LEGEND_ROW_H;
    const fill = PALETTE[i % PALETTE.length];
    const text = model.showData ? `${s.label} [${s.value}]` : s.label;
    const textW = Math.max(60, Math.round(visualWidth(text) * CHAR_PX) + 12);
    maxLegendW = Math.max(maxLegendW, textW);
    cells.push(
      `<mxCell id="pie-legend-swatch-${i}" value="" ` +
        `style="rounded=0;html=1;fillColor=${fill};strokeColor=#000000;opacity=70;" vertex="1" parent="1">` +
        `<mxGeometry x="${legendX}" y="${rowY}" width="${SWATCH}" height="${SWATCH}" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="pie-legend-label-${i}" value="${escapeXml(text)}" ` +
        `style="text;html=1;align=left;verticalAlign=middle;fontSize=12;" vertex="1" parent="1">` +
        `<mxGeometry x="${legendX + SWATCH + 8}" y="${rowY - (LEGEND_ROW_H - SWATCH) / 2}" width="${textW}" height="${LEGEND_ROW_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  const contentW = legendX + (slices.length ? SWATCH + 8 + maxLegendW : 0) + MARGIN;
  const contentH = Math.max(
    cy + RADIUS + MARGIN,
    legendY + slices.length * LEGEND_ROW_H + MARGIN
  );
  const pageW = Math.max(850, Math.round(contentW));
  const pageH = Math.max(1100, Math.round(contentH));

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

  return { xml, warnings };
}
