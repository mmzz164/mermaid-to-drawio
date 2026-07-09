import { escapeXml, round, wrapXml, CATEGORICAL, bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal Mermaid xychart parser (xychart-beta / xychart).
 *
 *   xychart-beta
 *     title "Sales Revenue"
 *     x-axis [jan, feb, mar]         (categories)
 *     x-axis "label" 1 --> 10        (numeric range)
 *     y-axis "Revenue" 4000 --> 11000
 *     bar "2023" [5000, 6000, 7500]
 *     line [4000, 5500, 8000]
 *
 * `xychart-beta horizontal` is accepted but rendered vertically (warning).
 */
export function parseXychart(source) {
  const warnings = [];
  const series = []; // {type: "bar"|"line", name, values[]}
  let title = null;
  let categories = null;
  let xLabel = null;
  let xRange = null;
  let yLabel = null;
  let yRange = null;
  let horizontal = false;

  const headerRe = /^xychart(-beta)?\b/i;
  const src = source.replace(/^\uFEFF/, "");
  const headerLine = src.split(/\r?\n/).map((l) => l.trim()).find((l) => headerRe.test(l));
  if (headerLine && /\bhorizontal\b/i.test(headerLine)) {
    horizontal = true;
    warnings.push("horizontal orientation is not supported; rendered vertically");
  }

  for (const { trimmed, lineNo } of bodyLines(source, headerRe)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = unquote(m[1]);
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^x-axis\s+(?:"([^"]*)"\s*)?\[(.*)\]\s*$/i))) {
      xLabel = m[1] || null;
      categories = m[2].split(",").map((s) => unquote(s.trim())).filter((s) => s !== "");
      continue;
    }
    if ((m = trimmed.match(/^x-axis\s+(?:"([^"]*)"\s*)?([\d.+-]+)\s*-->\s*([\d.+-]+)\s*$/i))) {
      xLabel = m[1] || null;
      xRange = [parseFloat(m[2]), parseFloat(m[3])];
      continue;
    }
    if ((m = trimmed.match(/^y-axis\s+(?:"([^"]*)"\s*)?(?:([\d.+-]+)\s*-->\s*([\d.+-]+))?\s*$/i))) {
      yLabel = m[1] || null;
      if (m[2] !== undefined) yRange = [parseFloat(m[2]), parseFloat(m[3])];
      continue;
    }
    if ((m = trimmed.match(/^(bar|line)\s+(?:"([^"]*)"\s*)?\[(.*)\]\s*$/i))) {
      const values = m[3].split(",").map((s) => parseFloat(s.trim()));
      if (values.some((v) => !Number.isFinite(v))) {
        warnings.push(`Line ${lineNo}: non-numeric value in series; skipped`);
        continue;
      }
      series.push({ type: m[1].toLowerCase(), name: m[2] || null, values });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse xychart line: ${trimmed}`);
  }

  return { title, categories, xLabel, xRange, yLabel, yRange, series, horizontal, warnings };
}

const CHART_W = 620;
const CHART_H = 320;
const MARGIN_L = 80;
const MARGIN_T = 20;
const TITLE_H = 34;

/** Pick a "nice" tick step giving ~5 ticks over range. */
function niceStep(range) {
  const raw = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (raw <= mult * mag) return mult * mag;
  }
  return 10 * mag;
}

/**
 * Convert a Mermaid xychart to draw.io XML: y-axis with nice ticks and
 * gridlines, grouped bars per category, line series as polylines. Series
 * colors follow a categorical palette; named series get a legend.
 */
export function xychartToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseXychart(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.series.length === 0) {
    warnings.push("xychart has no data series");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const n = Math.max(...model.series.map((s) => s.values.length));
  const categories =
    model.categories ||
    (model.xRange
      ? Array.from({ length: n }, (_, i) =>
          String(
            Math.round((model.xRange[0] + (i * (model.xRange[1] - model.xRange[0])) / Math.max(1, n - 1)) * 100) / 100
          )
        )
      : Array.from({ length: n }, (_, i) => String(i + 1)));

  const allValues = model.series.flatMap((s) => s.values);
  let yMin = model.yRange ? model.yRange[0] : Math.min(0, ...allValues);
  let yMax = model.yRange ? model.yRange[1] : Math.max(...allValues);
  if (yMax <= yMin) yMax = yMin + 1;
  const step = niceStep(yMax - yMin);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;

  const topY = MARGIN_T + (model.title ? TITLE_H : 0);
  const x0 = MARGIN_L;
  const y0 = topY + CHART_H; // baseline (y = yMin)
  const yOf = (v) => y0 - ((v - yMin) / (yMax - yMin)) * CHART_H;
  const slotW = CHART_W / categories.length;

  if (model.title) {
    cells.push(
      `<mxCell id="xy-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${x0}" y="${MARGIN_T}" width="${CHART_W}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  // y gridlines + tick labels
  let gi = 0;
  for (let v = yMin; v <= yMax + step / 1000; v += step) {
    const y = yOf(v);
    cells.push(
      `<mxCell id="xy-grid-${gi}" value="" style="endArrow=none;html=1;strokeColor=#e0e0e0;" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${x0}" y="${round(y)}" as="sourcePoint" />` +
        `<mxPoint x="${x0 + CHART_W}" y="${round(y)}" as="targetPoint" />` +
        `</mxGeometry>` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="xy-ytick-${gi}" value="${escapeXml(String(Math.round(v * 1000) / 1000))}" ` +
        `style="text;html=1;align=right;verticalAlign=middle;fontSize=10;fontColor=#666666;" vertex="1" parent="1">` +
        `<mxGeometry x="${x0 - 64}" y="${round(y - 9)}" width="58" height="18" as="geometry" />` +
        `</mxCell>`
    );
    gi++;
  }
  if (model.yLabel) {
    cells.push(
      `<mxCell id="xy-ylabel" value="${escapeXml(model.yLabel)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=11;horizontal=0;" vertex="1" parent="1">` +
        `<mxGeometry x="${MARGIN_L - 80}" y="${topY}" width="20" height="${CHART_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  // x category labels (+ optional axis label)
  categories.forEach((c, i) => {
    cells.push(
      `<mxCell id="xy-xtick-${i}" value="${escapeXml(c)}" ` +
        `style="text;html=1;align=center;verticalAlign=top;fontSize=10;fontColor=#666666;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(x0 + i * slotW)}" y="${round(y0 + 4)}" width="${round(slotW)}" height="18" as="geometry" />` +
        `</mxCell>`
    );
  });
  if (model.xLabel) {
    cells.push(
      `<mxCell id="xy-xlabel" value="${escapeXml(model.xLabel)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${x0}" y="${round(y0 + 24)}" width="${CHART_W}" height="18" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Bars first (behind lines). Bars within a category are grouped.
  const barSeries = model.series.filter((s) => s.type === "bar");
  const groupW = slotW * 0.6;
  const barW = barSeries.length ? groupW / barSeries.length : 0;
  let colorIdx = 0;
  const seriesColor = new Map();
  for (const s of model.series) {
    seriesColor.set(s, CATEGORICAL[colorIdx % CATEGORICAL.length]);
    colorIdx++;
  }
  barSeries.forEach((s, si) => {
    const color = seriesColor.get(s);
    s.values.forEach((v, i) => {
      if (i >= categories.length) return;
      const cx = x0 + i * slotW + slotW / 2;
      const bx = cx - groupW / 2 + si * barW;
      const yTop = Math.min(yOf(v), yOf(0) - 1);
      const h = Math.max(2, Math.abs(yOf(0) - yOf(v)));
      cells.push(
        `<mxCell id="xy-bar-${si}-${i}" value="" ` +
          `style="rounded=0;html=1;fillColor=${color};strokeColor=none;opacity=85;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(bx)}" y="${round(yTop)}" width="${round(Math.max(3, barW - 3))}" height="${round(h)}" as="geometry" />` +
          `</mxCell>`
      );
    });
  });

  // Line series as polyline edges with waypoints.
  model.series.forEach((s, si) => {
    if (s.type !== "line") return;
    const color = seriesColor.get(s);
    const pts = s.values
      .slice(0, categories.length)
      .map((v, i) => ({ x: round(x0 + i * slotW + slotW / 2), y: round(yOf(v)) }));
    if (pts.length < 2) return;
    const mid = pts.slice(1, -1).map((p) => `<mxPoint x="${p.x}" y="${p.y}" />`).join("");
    cells.push(
      `<mxCell id="xy-line-${si}" value="" ` +
        `style="endArrow=none;html=1;strokeColor=${color};strokeWidth=2;rounded=0;" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${pts[0].x}" y="${pts[0].y}" as="sourcePoint" />` +
        `<mxPoint x="${pts[pts.length - 1].x}" y="${pts[pts.length - 1].y}" as="targetPoint" />` +
        (mid ? `<Array as="points">${mid}</Array>` : "") +
        `</mxGeometry>` +
        `</mxCell>`
    );
  });

  // Legend for named series.
  const named = model.series.filter((s) => s.name);
  named.forEach((s, i) => {
    const lx = x0 + CHART_W + 16;
    const ly = topY + i * 22;
    cells.push(
      `<mxCell id="xy-leg-${i}" value="" style="rounded=0;html=1;fillColor=${seriesColor.get(s)};strokeColor=none;" vertex="1" parent="1">` +
        `<mxGeometry x="${lx}" y="${ly}" width="12" height="12" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="xy-legl-${i}" value="${escapeXml(s.name)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${lx + 16}" y="${ly - 4}" width="140" height="20" as="geometry" />` +
        `</mxCell>`
    );
  });

  const pageW = x0 + CHART_W + (named.length ? 180 : 40);
  const pageH = y0 + 60;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
