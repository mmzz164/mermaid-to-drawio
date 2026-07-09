import { escapeXml, round, wrapXml, bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal Mermaid quadrantChart parser.
 *
 *   quadrantChart
 *     title Reach and engagement
 *     x-axis Low Reach --> High Reach
 *     y-axis Low Engagement --> High Engagement
 *     quadrant-1 We should expand
 *     Campaign A: [0.3, 0.6]
 *
 * Point styling suffixes (`:::class`, `radius`, `color` metadata) are
 * ignored with a warning.
 */
export function parseQuadrantChart(source) {
  const warnings = [];
  const points = [];
  let title = null;
  const axes = { xLeft: "", xRight: "", yBottom: "", yTop: "" };
  const quadrants = ["", "", "", ""]; // q1..q4

  for (const { trimmed, lineNo } of bodyLines(source, /^quadrantChart\b/i)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = m[1].trim();
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^x-axis\s+(.+?)(?:\s*-->\s*(.+))?$/i))) {
      axes.xLeft = unquote(m[1]);
      axes.xRight = m[2] ? unquote(m[2]) : "";
      continue;
    }
    if ((m = trimmed.match(/^y-axis\s+(.+?)(?:\s*-->\s*(.+))?$/i))) {
      axes.yBottom = unquote(m[1]);
      axes.yTop = m[2] ? unquote(m[2]) : "";
      continue;
    }
    if ((m = trimmed.match(/^quadrant-([1-4])\s+(.+)$/i))) {
      quadrants[parseInt(m[1], 10) - 1] = unquote(m[2]);
      continue;
    }
    if ((m = trimmed.match(/^(.+?):\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\](.*)$/))) {
      if (m[4] && m[4].trim()) {
        warnings.push(`Line ${lineNo}: point styling ignored: ${m[4].trim()}`);
      }
      const x = parseFloat(m[2]);
      const y = parseFloat(m[3]);
      points.push({
        label: unquote(m[1].replace(/:::.*$/, "")),
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse quadrantChart line: ${trimmed}`);
  }

  return { title, axes, quadrants, points, warnings };
}

const SIZE = 420;
const MARGIN = 60; // room for the y-axis labels on the left
const TITLE_H = 34;

// Quadrant fills: q1 top-right, q2 top-left, q3 bottom-left, q4 bottom-right.
const Q_FILLS = ["#dae8fc", "#d5e8d4", "#fff2cc", "#ffe6cc"];

/**
 * Convert a Mermaid quadrantChart to draw.io XML: a 2x2 colored grid with
 * quadrant labels, axis end labels, and labeled points.
 */
export function quadrantToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseQuadrantChart(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];

  const x0 = MARGIN;
  const y0 = 20 + (model.title ? TITLE_H : 0);
  const half = SIZE / 2;

  if (model.title) {
    cells.push(
      `<mxCell id="q-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${x0}" y="20" width="${SIZE}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Quadrant cells: [dx, dy] in halves. q1 TR, q2 TL, q3 BL, q4 BR.
  const QPOS = [
    [1, 0],
    [0, 0],
    [0, 1],
    [1, 1],
  ];
  QPOS.forEach(([dx, dy], i) => {
    cells.push(
      `<mxCell id="q-quad-${i + 1}" value="${escapeXml(model.quadrants[i])}" ` +
        `style="rounded=0;html=1;whiteSpace=wrap;fillColor=${Q_FILLS[i]};strokeColor=#999999;fontSize=12;fontColor=#555555;verticalAlign=middle;align=center;" vertex="1" parent="1">` +
        `<mxGeometry x="${x0 + dx * half}" y="${y0 + dy * half}" width="${half}" height="${half}" as="geometry" />` +
        `</mxCell>`
    );
  });

  // Axis end labels
  const axisLabel = (id, value, x, y, w, h, extra = "") =>
    `<mxCell id="${id}" value="${escapeXml(value)}" ` +
    `style="text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#444444;${extra}" vertex="1" parent="1">` +
    `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
    `</mxCell>`;
  if (model.axes.xLeft) {
    cells.push(axisLabel("q-xl", model.axes.xLeft, x0, y0 + SIZE + 6, half, 20));
  }
  if (model.axes.xRight) {
    cells.push(axisLabel("q-xr", model.axes.xRight, x0 + half, y0 + SIZE + 6, half, 20));
  }
  // Vertical y-axis labels on the left (drawio rotates with horizontal=0).
  if (model.axes.yBottom) {
    cells.push(axisLabel("q-yb", model.axes.yBottom, x0 - 46, y0 + half, 40, half, "horizontal=0;"));
  }
  if (model.axes.yTop) {
    cells.push(axisLabel("q-yt", model.axes.yTop, x0 - 46, y0, 40, half, "horizontal=0;"));
  }

  // Points (y=0 bottom in mermaid; drawio y grows downward).
  model.points.forEach((p, i) => {
    const px = x0 + p.x * SIZE;
    const py = y0 + (1 - p.y) * SIZE;
    cells.push(
      `<mxCell id="q-pt-${i}" value="" style="ellipse;html=1;fillColor=#3366cc;strokeColor=#ffffff;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(px - 6)}" y="${round(py - 6)}" width="12" height="12" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="q-ptl-${i}" value="${escapeXml(p.label)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(px - 60)}" y="${round(py - 26)}" width="120" height="16" as="geometry" />` +
        `</mxCell>`
    );
  });

  const pageW = x0 + SIZE + MARGIN;
  const pageH = y0 + SIZE + 60;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
