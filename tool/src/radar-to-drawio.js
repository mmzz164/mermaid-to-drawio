import { escapeXml, round, wrapXml, CATEGORICAL, bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal Mermaid radar chart parser (radar-beta / radar).
 *
 *   radar-beta
 *     title Grades
 *     axis m["Math"], s["Science"], e["English"]
 *     curve a["Alice"]{85, 90, 80}
 *     curve b{70, 75, 85}
 *     max 100
 *     min 0
 *
 * `showLegend` / `graticule` / `ticks` config lines are skipped silently.
 */
export function parseRadar(source) {
  const warnings = [];
  const axes = [];
  const curves = [];
  let title = null;
  let min = 0;
  let max = null;

  for (const { trimmed, lineNo } of bodyLines(source, /^radar(-beta)?\b/i)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = unquote(m[1]);
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(trimmed)) continue;
    if (/^(showLegend|graticule|ticks)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^axis\s+(.+)$/i))) {
      for (const part of m[1].split(",")) {
        const am = part.trim().match(/^[\w-]+\s*\[\s*"?([^\]"]*)"?\s*\]$/) || [null, part.trim()];
        if (am[1]) axes.push(am[1]);
      }
      continue;
    }
    if ((m = trimmed.match(/^curve\s+([\w-]+)(?:\s*\[\s*"?([^\]"]*)"?\s*\])?\s*\{(.*)\}$/i))) {
      const values = m[3].split(",").map((s) => parseFloat(s.trim()));
      if (values.some((v) => !Number.isFinite(v))) {
        warnings.push(`Line ${lineNo}: non-numeric curve value; skipped`);
        continue;
      }
      curves.push({ name: m[2] || m[1], values });
      continue;
    }
    if ((m = trimmed.match(/^min\s+([\d.+-]+)$/i))) {
      min = parseFloat(m[1]);
      continue;
    }
    if ((m = trimmed.match(/^max\s+([\d.+-]+)$/i))) {
      max = parseFloat(m[1]);
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse radar line: ${trimmed}`);
  }

  return { title, axes, curves, min, max, warnings };
}

const R = 170;
const RINGS = 4;
const MARGIN = 90;
const TITLE_H = 34;

/**
 * Convert a Mermaid radar chart to draw.io XML: polygonal graticule rings,
 * spokes with axis labels, and one closed polyline per curve.
 */
export function radarToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseRadar(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  const nAxes = model.axes.length;
  if (nAxes < 3 || model.curves.length === 0) {
    warnings.push("radar chart needs at least 3 axes and 1 curve");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const max = model.max ?? Math.max(...model.curves.flatMap((c) => c.values));
  const min = model.min ?? 0;
  const range = max - min || 1;
  const topY = 20 + (model.title ? TITLE_H : 0);
  const cx = MARGIN + R;
  const cy = topY + MARGIN / 2 + R;
  // Axis i at angle from 12 o'clock, clockwise.
  const pt = (axisIdx, frac) => {
    const a = (axisIdx / nAxes) * 2 * Math.PI;
    return {
      x: round(cx + Math.sin(a) * R * frac),
      y: round(cy - Math.cos(a) * R * frac),
    };
  };

  if (model.title) {
    cells.push(
      `<mxCell id="rd-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${cx - R}" y="20" width="${R * 2}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  const polyline = (id, pts, style, closed) => {
    const all = closed ? [...pts, pts[0]] : pts;
    const mid = all.slice(1, -1).map((p) => `<mxPoint x="${p.x}" y="${p.y}" />`).join("");
    return (
      `<mxCell id="${id}" value="" style="${style}" edge="1" parent="1">` +
      `<mxGeometry relative="1" as="geometry">` +
      `<mxPoint x="${all[0].x}" y="${all[0].y}" as="sourcePoint" />` +
      `<mxPoint x="${all[all.length - 1].x}" y="${all[all.length - 1].y}" as="targetPoint" />` +
      (mid ? `<Array as="points">${mid}</Array>` : "") +
      `</mxGeometry>` +
      `</mxCell>`
    );
  };

  // Graticule rings (polygonal) + spokes + axis labels.
  for (let r = 1; r <= RINGS; r++) {
    const pts = Array.from({ length: nAxes }, (_, i) => pt(i, r / RINGS));
    cells.push(polyline(`rd-ring-${r}`, pts, "endArrow=none;html=1;strokeColor=#d0d0d0;", true));
  }
  model.axes.forEach((label, i) => {
    const end = pt(i, 1);
    cells.push(polyline(`rd-spoke-${i}`, [{ x: cx, y: cy }, end], "endArrow=none;html=1;strokeColor=#d0d0d0;", false));
    const lp = pt(i, 1.14);
    cells.push(
      `<mxCell id="rd-axis-${i}" value="${escapeXml(label)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${lp.x - 55}" y="${lp.y - 10}" width="110" height="20" as="geometry" />` +
        `</mxCell>`
    );
  });

  // Curves (closed polylines, one color per curve) + legend.
  model.curves.forEach((curve, ci) => {
    const color = CATEGORICAL[ci % CATEGORICAL.length];
    const pts = model.axes.map((_, i) => {
      const v = curve.values[i] ?? min;
      const frac = Math.max(0, Math.min(1, (v - min) / range));
      return pt(i, frac);
    });
    cells.push(
      polyline(`rd-curve-${ci}`, pts, `endArrow=none;html=1;strokeColor=${color};strokeWidth=2;`, true)
    );
    for (const [pi, p] of pts.entries()) {
      cells.push(
        `<mxCell id="rd-cpt-${ci}-${pi}" value="" style="ellipse;html=1;fillColor=${color};strokeColor=none;" vertex="1" parent="1">` +
          `<mxGeometry x="${p.x - 4}" y="${p.y - 4}" width="8" height="8" as="geometry" />` +
          `</mxCell>`
      );
    }
    const lx = cx + R + 70;
    const ly = topY + ci * 22;
    cells.push(
      `<mxCell id="rd-leg-${ci}" value="" style="rounded=0;html=1;fillColor=${color};strokeColor=none;" vertex="1" parent="1">` +
        `<mxGeometry x="${lx}" y="${ly}" width="12" height="12" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="rd-legl-${ci}" value="${escapeXml(curve.name)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${lx + 16}" y="${ly - 4}" width="140" height="20" as="geometry" />` +
        `</mxCell>`
    );
  });

  const pageW = cx + R + 240;
  const pageH = cy + R + 60;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
