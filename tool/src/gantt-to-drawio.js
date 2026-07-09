import { parseGantt } from "./gantt-parser.js";
import { visualWidth } from "./text-width.js";

const MARGIN = 20;
const TITLE_H = 34;
const AXIS_H = 24; // tick-label strip above the chart
const ROW_H = 30;
const BAR_H = 20;
const SEC_H = 26;
const CHAR_PX = 7.2;
const DAY_MS = 24 * 60 * 60 * 1000;

// Bar colors approximating Mermaid's default gantt theme.
const COLORS = {
  normal: { fill: "#8a90dd", stroke: "#534fbc" },
  active: { fill: "#bfc7ff", stroke: "#534fbc" },
  done: { fill: "#d6d6d6", stroke: "#888888" },
  crit: { fill: "#ff8888", stroke: "#ff0000" },
  critActive: { fill: "#ffcccc", stroke: "#ff0000" },
  critDone: { fill: "#d6d6d6", stroke: "#ff0000" },
};

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

function barColors(task) {
  if (task.crit) {
    if (task.done) return COLORS.critDone;
    if (task.active) return COLORS.critActive;
    return COLORS.crit;
  }
  if (task.done) return COLORS.done;
  if (task.active) return COLORS.active;
  return COLORS.normal;
}

function fmtTick(ms, stepDays) {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (stepDays >= 28) return `${d.getUTCFullYear()}-${mm}`;
  return `${mm}-${dd}`;
}

/**
 * Convert a Mermaid gantt chart to draw.io XML: one bar per task laid out on
 * a linear time axis, grouped into sections with alternating background
 * bands. Milestones become rhombi. The today-marker is not drawn (it would
 * make the output depend on the conversion date).
 */
export function ganttToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseGantt(mermaidSource);
  const warnings = [...model.warnings];
  const tasks = model.sections.flatMap((s) => s.tasks);

  const cells = [`<mxCell id="0" />`, `<mxCell id="1" parent="0" />`];
  if (tasks.length === 0) {
    warnings.push("gantt chart has no tasks");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  let minStart = Math.min(...tasks.map((t) => t.start));
  let maxEnd = Math.max(...tasks.map((t) => t.end));
  if (maxEnd <= minStart) maxEnd = minStart + DAY_MS;
  const spanMs = maxEnd - minStart;
  const spanDays = spanMs / DAY_MS;
  const chartW = Math.max(480, Math.min(1200, Math.round(spanDays * 32)));
  const pxPerMs = chartW / spanMs;
  const chartX = MARGIN;
  const chartY = MARGIN + (model.title ? TITLE_H : 0) + AXIS_H;
  const x = (ms) => chartX + (ms - minStart) * pxPerMs;

  // Row layout: a section-header row before each named section's tasks.
  let rowY = chartY;
  const bands = []; // {y, h, fill} alternating section backgrounds
  const rows = []; // {task, y}
  model.sections.forEach((sec, si) => {
    if (sec.tasks.length === 0) return;
    if (sec.name) {
      rows.push({ sectionName: sec.name, y: rowY });
      rowY += SEC_H;
    }
    if (si % 2 === 0) {
      bands.push({ y: rowY, h: sec.tasks.length * ROW_H, fill: "#f7f7f7" });
    }
    for (const task of sec.tasks) {
      rows.push({ task, y: rowY });
      rowY += ROW_H;
    }
  });
  const chartBottom = rowY;

  if (model.title) {
    cells.push(
      `<mxCell id="gantt-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${chartX}" y="${MARGIN}" width="${chartW}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Alternating section bands (behind everything else).
  bands.forEach((b, i) => {
    cells.push(
      `<mxCell id="gantt-band-${i}" value="" ` +
        `style="rounded=0;html=1;fillColor=${b.fill};strokeColor=none;" vertex="1" parent="1">` +
        `<mxGeometry x="${chartX}" y="${round(b.y)}" width="${chartW}" height="${round(b.h)}" as="geometry" />` +
        `</mxCell>`
    );
  });

  // Time axis: pick a tick step that yields <= ~10 ticks, draw dashed
  // vertical gridlines with date labels on top.
  const stepDays =
    [1, 2, 7, 14, 28, 61, 91, 182, 365].find((s) => spanDays / s <= 10) || 365;
  const stepMs = stepDays * DAY_MS;
  const firstTick = Math.ceil(minStart / DAY_MS) * DAY_MS;
  let tickIdx = 0;
  for (let t = firstTick; t <= maxEnd; t += stepMs) {
    const tx = x(t);
    cells.push(
      `<mxCell id="gantt-grid-${tickIdx}" value="" ` +
        `style="endArrow=none;dashed=1;html=1;strokeColor=#d0d0d0;" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${round(tx)}" y="${round(chartY)}" as="sourcePoint" />` +
        `<mxPoint x="${round(tx)}" y="${round(chartBottom)}" as="targetPoint" />` +
        `</mxGeometry>` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="gantt-tick-${tickIdx}" value="${escapeXml(fmtTick(t, stepDays))}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=10;fontColor=#666666;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(tx - 35)}" y="${round(chartY - AXIS_H)}" width="70" height="${AXIS_H - 4}" as="geometry" />` +
        `</mxCell>`
    );
    tickIdx++;
  }

  // Section headers and task bars.
  let cellId = 0;
  for (const row of rows) {
    if (row.sectionName) {
      cells.push(
        `<mxCell id="gantt-sec-${cellId++}" value="${escapeXml(row.sectionName)}" ` +
          `style="text;html=1;align=left;verticalAlign=middle;fontSize=12;fontStyle=1;" vertex="1" parent="1">` +
          `<mxGeometry x="${chartX}" y="${round(row.y)}" width="${chartW}" height="${SEC_H}" as="geometry" />` +
          `</mxCell>`
      );
      continue;
    }
    const task = row.task;
    const { fill, stroke } = barColors(task);
    const barY = row.y + (ROW_H - BAR_H) / 2;

    if (task.milestone) {
      const midMs = task.start + (task.end - task.start) / 2;
      const cx = x(midMs);
      const size = BAR_H;
      cells.push(
        `<mxCell id="gantt-task-${cellId++}" value="${escapeXml(task.name)}" ` +
          `style="rhombus;html=1;fillColor=${fill};strokeColor=${stroke};` +
          `labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=6;fontSize=11;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(cx - size / 2)}" y="${round(barY)}" width="${size}" height="${size}" as="geometry" />` +
          `</mxCell>`
      );
      continue;
    }

    const x1 = x(task.start);
    const w = Math.max(4, (task.end - task.start) * pxPerMs);
    // Put the name inside the bar when it fits, otherwise to the right.
    const fitsInside = visualWidth(task.name) * CHAR_PX + 10 <= w;
    const labelStyle = fitsInside
      ? "align=center;verticalAlign=middle;"
      : "labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=6;";
    cells.push(
      `<mxCell id="gantt-task-${cellId++}" value="${escapeXml(task.name)}" ` +
        `style="rounded=1;arcSize=30;html=1;fillColor=${fill};strokeColor=${stroke};fontSize=11;${labelStyle}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(x1)}" y="${round(barY)}" width="${round(w)}" height="${BAR_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  const pageW = Math.max(850, chartX + chartW + 200); // room for outside labels
  const pageH = Math.max(1100, chartBottom + MARGIN);
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
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
