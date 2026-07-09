import {
  escapeXml,
  round,
  wrapXml,
  CATEGORICAL,
  PASTEL,
  darken,
  bodyLines,
} from "./drawio-xml.js";

/**
 * Minimal Mermaid user-journey parser.
 *
 *   journey
 *     title My working day
 *     section Go to work
 *       Make tea: 5: Me
 *       Do work: 1: Me, Cat
 *
 * Task: `name : score [: actor, actor...]`. Scores are numbers (Mermaid
 * uses 1..5 for faces; anything numeric is accepted and clamped for
 * placement).
 */
export function parseJourney(source) {
  const warnings = [];
  const sections = [];
  const actors = [];
  let title = null;
  let currentSection = null;

  for (const { trimmed, lineNo } of bodyLines(source, /^journey\b/i)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = m[1].trim();
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^section\s+(.+)$/i))) {
      currentSection = { name: m[1].trim(), tasks: [] };
      sections.push(currentSection);
      continue;
    }
    const parts = trimmed.split(":").map((s) => s.trim());
    if (parts.length >= 2 && parts[1] !== "" && !isNaN(parseFloat(parts[1]))) {
      const score = parseFloat(parts[1]);
      const taskActors = parts[2]
        ? parts[2].split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      for (const a of taskActors) {
        if (!actors.includes(a)) actors.push(a);
      }
      if (!currentSection) {
        currentSection = { name: "", tasks: [] };
        sections.push(currentSection);
      }
      currentSection.tasks.push({ name: parts[0], score, actors: taskActors });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse journey line: ${trimmed}`);
  }

  return { title, sections, actors, warnings };
}

const COL_W = 130;
const COL_GAP = 14;
const MARGIN = 20;
const TITLE_H = 34;
const SEC_H = 26;
const LABEL_H = 44;
const CHART_H = 5 * 34; // score 1..5 -> 34px per step
const DOT_R = 13;

function faceColor(score) {
  if (score >= 4) return { fill: "#7ac36a", stroke: "#4e7f44" };
  if (score >= 3) return { fill: "#f4d03f", stroke: "#a08a1d" };
  return { fill: "#e06c5f", stroke: "#8f3d33" };
}

/**
 * Convert a Mermaid user journey to draw.io XML: section bands, task
 * labels, score markers on a 1..5 vertical scale, per-actor dots, and an
 * actor color legend.
 */
export function journeyToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseJourney(mermaidSource);
  const warnings = [...model.warnings];
  const tasks = model.sections.flatMap((s) => s.tasks);
  const cells = [];
  if (tasks.length === 0) {
    warnings.push("journey has no tasks");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const actorColor = new Map(
    model.actors.map((a, i) => [a, CATEGORICAL[i % CATEGORICAL.length]])
  );

  const topY = MARGIN + (model.title ? TITLE_H : 0);
  const secY = topY;
  const labelY = secY + SEC_H + 4;
  const chartTop = labelY + LABEL_H + 26; // headroom for actor dots
  const baseline = chartTop + CHART_H;

  if (model.title) {
    cells.push(
      `<mxCell id="j-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${MARGIN}" y="${MARGIN}" width="${tasks.length * (COL_W + COL_GAP)}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  let col = 0;
  let id = 0;
  for (const [si, sec] of model.sections.entries()) {
    if (sec.tasks.length === 0) continue;
    const x0 = MARGIN + col * (COL_W + COL_GAP);
    const w = sec.tasks.length * (COL_W + COL_GAP) - COL_GAP;
    const fill = PASTEL[si % PASTEL.length];
    if (sec.name) {
      cells.push(
        `<mxCell id="j-sec-${si}" value="${escapeXml(sec.name)}" ` +
          `style="rounded=1;html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=${darken(fill)};fontStyle=1;fontSize=12;" vertex="1" parent="1">` +
          `<mxGeometry x="${x0}" y="${secY}" width="${round(w)}" height="${SEC_H}" as="geometry" />` +
          `</mxCell>`
      );
    }
    for (const task of sec.tasks) {
      const x = MARGIN + col * (COL_W + COL_GAP);
      const cx = x + COL_W / 2;
      // Task name box
      cells.push(
        `<mxCell id="j-task-${id}" value="${escapeXml(task.name)}" ` +
          `style="rounded=0;html=1;whiteSpace=wrap;fillColor=none;strokeColor=none;fontSize=11;verticalAlign=top;" vertex="1" parent="1">` +
          `<mxGeometry x="${x}" y="${labelY}" width="${COL_W}" height="${LABEL_H}" as="geometry" />` +
          `</mxCell>`
      );
      // Score marker (higher score = higher position)
      const clamped = Math.max(1, Math.min(5, task.score));
      const cy = baseline - (clamped / 5) * CHART_H;
      const { fill: fFill, stroke: fStroke } = faceColor(task.score);
      cells.push(
        `<mxCell id="j-dot-${id}" value="${escapeXml(String(task.score))}" ` +
          `style="ellipse;html=1;fillColor=${fFill};strokeColor=${fStroke};fontSize=11;fontStyle=1;fontColor=#ffffff;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(cx - DOT_R)}" y="${round(cy - DOT_R)}" width="${DOT_R * 2}" height="${DOT_R * 2}" as="geometry" />` +
          `</mxCell>`
      );
      // Actor dots above the marker
      task.actors.forEach((a, ai) => {
        const ax = cx - (task.actors.length - 1) * 8 + ai * 16;
        cells.push(
          `<mxCell id="j-actor-${id}-${ai}" value="" ` +
            `style="ellipse;html=1;fillColor=${actorColor.get(a)};strokeColor=#ffffff;" vertex="1" parent="1">` +
            `<mxGeometry x="${round(ax - 6)}" y="${round(cy - DOT_R - 18)}" width="12" height="12" as="geometry" />` +
            `</mxCell>`
        );
      });
      col++;
      id++;
    }
  }

  // Actor legend on the right
  const legendX = MARGIN + col * (COL_W + COL_GAP) + 20;
  model.actors.forEach((a, i) => {
    const y = chartTop + i * 24;
    cells.push(
      `<mxCell id="j-leg-dot-${i}" value="" style="ellipse;html=1;fillColor=${actorColor.get(a)};strokeColor=none;" vertex="1" parent="1">` +
        `<mxGeometry x="${legendX}" y="${y}" width="12" height="12" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="j-leg-lab-${i}" value="${escapeXml(a)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=12;" vertex="1" parent="1">` +
        `<mxGeometry x="${legendX + 18}" y="${y - 5}" width="140" height="22" as="geometry" />` +
        `</mxCell>`
    );
  });

  const pageW = legendX + 180;
  const pageH = baseline + 40;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
