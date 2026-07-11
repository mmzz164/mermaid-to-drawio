import {
  escapeXml,
  round,
  wrapXml,
  PASTEL,
  darken,
  bodyLines,
} from "./drawio-xml.js";
import { measureMultiline } from "./text-width.js";

/**
 * Minimal Mermaid timeline parser.
 *
 *   timeline
 *     title History of Social Media
 *     section The early days
 *       2002 : LinkedIn
 *       2004 : Facebook : Google
 *            : (continuation lines add events to the previous period)
 *
 * Periods without a section go into an unnamed section.
 */
export function parseTimeline(source) {
  const warnings = [];
  const sections = [];
  let title = null;
  let currentSection = null;
  let currentPeriod = null;

  function ensureSection() {
    if (!currentSection) {
      currentSection = { name: "", periods: [] };
      sections.push(currentSection);
    }
    return currentSection;
  }

  for (const { trimmed, lineNo } of bodyLines(source, /^timeline\b/i)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = m[1].trim();
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^section\s+(.+)$/i))) {
      currentSection = { name: m[1].trim(), periods: [] };
      sections.push(currentSection);
      currentPeriod = null;
      continue;
    }
    if (trimmed.startsWith(":")) {
      // Continuation: more events for the previous period.
      const events = trimmed.slice(1).split(" : ").map((s) => s.trim()).filter(Boolean);
      if (currentPeriod) currentPeriod.events.push(...events);
      else warnings.push(`Line ${lineNo}: event continuation with no period: ${trimmed}`);
      continue;
    }
    const parts = trimmed.split(" : ").map((s) => s.trim());
    // Also allow "2002: event" without spaces around the first colon.
    if (parts.length === 1) {
      const m2 = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (m2) {
        currentPeriod = {
          label: m2[1].trim(),
          events: m2[2] ? m2[2].split(" : ").map((s) => s.trim()).filter(Boolean) : [],
        };
        ensureSection().periods.push(currentPeriod);
        continue;
      }
      currentPeriod = { label: trimmed, events: [] };
      ensureSection().periods.push(currentPeriod);
      continue;
    }
    currentPeriod = { label: parts[0], events: parts.slice(1).filter(Boolean) };
    ensureSection().periods.push(currentPeriod);
  }

  return { title, sections, warnings };
}

const COL_W = 150;
const COL_GAP = 16;
const MARGIN = 20;
const TITLE_H = 34;
const SEC_H = 26;
const PERIOD_H = 34;
const EVENT_GAP = 8;

/**
 * Convert a Mermaid timeline to draw.io XML: periods as colored boxes on a
 * horizontal axis, events stacked below each period, section bands above.
 */
export function timelineToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseTimeline(mermaidSource);
  const warnings = [...model.warnings];
  const periods = model.sections.flatMap((s) => s.periods);
  const cells = [];
  if (periods.length === 0) {
    warnings.push("timeline has no periods");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const hasSections = model.sections.some((s) => s.name);
  const topY = MARGIN + (model.title ? TITLE_H : 0);
  const periodY = topY + (hasSections ? SEC_H + 8 : 0);
  const eventsY = periodY + PERIOD_H + 14;

  if (model.title) {
    cells.push(
      `<mxCell id="tl-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${MARGIN}" y="${MARGIN}" width="${periods.length * (COL_W + COL_GAP)}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Axis line centered between the period boxes and the events (like mermaid),
  // not through the period boxes.
  const axisY = periodY + PERIOD_H + 7;
  const axisX2 = MARGIN + periods.length * (COL_W + COL_GAP) - COL_GAP;
  cells.push(
    `<mxCell id="tl-axis" value="" style="endArrow=blockThin;endFill=1;html=1;strokeColor=#666666;strokeWidth=2;" edge="1" parent="1">` +
      `<mxGeometry relative="1" as="geometry">` +
      `<mxPoint x="${MARGIN - 6}" y="${axisY}" as="sourcePoint" />` +
      `<mxPoint x="${axisX2 + 26}" y="${axisY}" as="targetPoint" />` +
      `</mxGeometry>` +
      `</mxCell>`
  );

  let col = 0;
  let maxBottom = eventsY;
  for (const [si, sec] of model.sections.entries()) {
    if (sec.periods.length === 0) continue;
    const fill = PASTEL[si % PASTEL.length];
    const stroke = darken(fill);
    if (sec.name) {
      const x0 = MARGIN + col * (COL_W + COL_GAP);
      const w = sec.periods.length * (COL_W + COL_GAP) - COL_GAP;
      cells.push(
        `<mxCell id="tl-sec-${si}" value="${escapeXml(sec.name)}" ` +
          `style="rounded=1;html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=${stroke};fontStyle=1;fontSize=12;" vertex="1" parent="1">` +
          `<mxGeometry x="${x0}" y="${topY}" width="${round(w)}" height="${SEC_H}" as="geometry" />` +
          `</mxCell>`
      );
    }
    for (const period of sec.periods) {
      const x = MARGIN + col * (COL_W + COL_GAP);
      // Without sections each period cycles the palette itself (mermaid's
      // default coloring); with sections the section color is used.
      const pFill = hasSections ? fill : PASTEL[col % PASTEL.length];
      const pStroke = darken(pFill);
      cells.push(
        `<mxCell id="tl-p-${col}" value="${escapeXml(period.label)}" ` +
          `style="rounded=1;html=1;whiteSpace=wrap;fillColor=${pFill};strokeColor=${pStroke};fontStyle=1;fontSize=12;" vertex="1" parent="1">` +
          `<mxGeometry x="${x}" y="${periodY}" width="${COL_W}" height="${PERIOD_H}" as="geometry" />` +
          `</mxCell>`
      );
      // Dashed connector from the period box down through its events (drawn
      // first so it sits behind the white event boxes), crossing the axis.
      if (period.events.length) {
        const cxp = x + COL_W / 2;
        let colBottom = eventsY;
        for (const ev of period.events) colBottom += Math.max(30, measureMultiline(ev, 18).lineCount * 15 + 12) + EVENT_GAP;
        cells.push(
          `<mxCell id="tl-conn-${col}" value="" style="endArrow=none;html=1;dashed=1;dashPattern=4 4;strokeColor=#9e9e9e;" edge="1" parent="1">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="${round(cxp)}" y="${round(periodY + PERIOD_H)}" as="sourcePoint" />` +
            `<mxPoint x="${round(cxp)}" y="${round(colBottom - EVENT_GAP)}" as="targetPoint" /></mxGeometry></mxCell>`
        );
      }
      let ey = eventsY;
      period.events.forEach((ev, ei) => {
        const lines = measureMultiline(ev, 18).lineCount;
        const h = Math.max(30, lines * 15 + 12);
        cells.push(
          `<mxCell id="tl-e-${col}-${ei}" value="${escapeXml(ev)}" ` +
            `style="rounded=0;html=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=${pStroke};fontSize=11;" vertex="1" parent="1">` +
            `<mxGeometry x="${x + 8}" y="${round(ey)}" width="${COL_W - 16}" height="${round(h)}" as="geometry" />` +
            `</mxCell>`
        );
        ey += h + EVENT_GAP;
      });
      maxBottom = Math.max(maxBottom, ey);
      col++;
    }
  }

  const pageW = MARGIN * 2 + periods.length * (COL_W + COL_GAP) + 30;
  const pageH = maxBottom + MARGIN;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
