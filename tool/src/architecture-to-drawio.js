import { escapeXml, round, wrapXml, bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal Mermaid architecture-beta parser.
 *
 *   architecture-beta
 *     group api(cloud)[API]
 *     service db(database)[Database] in api
 *     service server(server)[Server] in api
 *     db:L -- R:server
 *     server:R --> L:gateway
 *
 * Supported: groups (with optional `in parent`), services and junctions
 * (with optional `in group`), and edges with L/R/T/B side anchors (plain
 * `--` or arrow `-->` / `<-->`).
 */
const ID = "[A-Za-z0-9_-]+";

export function parseArchitecture(source) {
  const warnings = [];
  const groups = new Map(); // id -> {id, icon, label, parent}
  const services = new Map(); // id -> {id, icon, label, group, junction}
  const edges = [];

  const decl = new RegExp(`^(group|service|junction)\\s+(${ID})(?:\\(([^)]*)\\))?(?:\\[([^\\]]*)\\])?(?:\\s+in\\s+(${ID}))?\\s*$`, "i");
  const edge = new RegExp(`^(${ID})(?::([LRTB]))?\\s*(<?-->?|--)\\s*(?::?([LRTB]))?:?(${ID})$`, "i");

  for (const { trimmed, lineNo } of bodyLines(source, /^architecture(-beta)?\b/i)) {
    let m;
    if (/^(classDef|class|style)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(decl))) {
      const kind = m[1].toLowerCase();
      const rec = { id: m[2], icon: (m[3] || "").trim(), label: m[4] !== undefined ? unquote(m[4]) : m[2] };
      if (kind === "group") { rec.parent = m[5] || null; groups.set(rec.id, rec); }
      else { rec.group = m[5] || null; rec.junction = kind === "junction"; services.set(rec.id, rec); }
      continue;
    }
    if ((m = trimmed.match(edge))) {
      edges.push({ from: m[1], fromSide: (m[2] || "").toUpperCase(), to: m[5], toSide: (m[4] || "").toUpperCase(), arrow: m[3] });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse architecture line: ${trimmed}`);
  }
  return { groups, services, edges, warnings };
}

// Map mermaid icon names to self-contained draw.io shapes.
function iconStyle(icon) {
  switch ((icon || "").toLowerCase()) {
    case "cloud": return "shape=cloud;";
    case "database": case "db": return "shape=cylinder;";
    case "disk": return "shape=cylinder;";
    case "server": return "shape=cube;";
    case "internet": return "ellipse;";
    default: return "rounded=1;";
  }
}

const SVC = 70, LABEL_H = 18, GAP = 40, MARGIN = 30, GHEAD = 24, GPAD = 20;
const SIDE = { L: [0, 0.5], R: [1, 0.5], T: [0.5, 0], B: [0.5, 1] };

export function architectureToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseArchitecture(mermaidSource);
  const warnings = [...model.warnings];
  const cells = []; // wrapXml adds the root cells (id 0 and 1)

  const rect = new Map(); // id -> {x,y,w,h}
  // Group direct members.
  const membersOf = new Map();
  for (const g of model.groups.values()) membersOf.set(g.id, []);
  const ungrouped = [];
  for (const s of model.services.values()) {
    if (s.group && membersOf.has(s.group)) membersOf.get(s.group).push(s);
    else ungrouped.push(s);
  }
  const topGroups = [...model.groups.values()].filter((g) => !g.parent || !model.groups.has(g.parent));

  // Lay a group's services in a grid (2 columns), return its size.
  function groupSize(g) {
    const svcs = membersOf.get(g.id) || [];
    const cols = Math.min(2, Math.max(1, svcs.length));
    const rows = Math.ceil(svcs.length / cols) || 1;
    const w = GPAD * 2 + cols * SVC + (cols - 1) * GAP;
    const h = GHEAD + GPAD * 2 + rows * (SVC + LABEL_H) + (rows - 1) * GAP;
    return { w, h, cols };
  }

  function emitService(s, x, y) {
    const size = s.junction ? 16 : SVC;
    const sx = s.junction ? x + (SVC - size) / 2 : x;
    const style = s.junction
      ? "ellipse;fillColor=#333333;strokeColor=#333333;"
      // Icon tile with the label BELOW it (on the canvas) — dark text so it
      // stays readable; white would vanish against the page.
      : `${iconStyle(s.icon)}html=1;whiteSpace=wrap;fillColor=#2374AB;strokeColor=#17557d;fontColor=#333333;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;`;
    cells.push(
      `<mxCell id="${escapeXml(s.id)}" value="${s.junction ? "" : escapeXml(s.label)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(sx)}" y="${round(y)}" width="${size}" height="${size}" as="geometry" />` +
        `</mxCell>`
    );
    rect.set(s.id, { x: sx, y, w: size, h: size });
  }

  function emitGroup(g, x, y) {
    const { w, h, cols } = groupSize(g);
    cells.push(
      `<mxCell id="${escapeXml(g.id)}" value="${escapeXml(g.label)}" style="rounded=0;html=1;dashed=1;fillColor=none;strokeColor=#9673a6;verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=12;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
        `</mxCell>`
    );
    rect.set(g.id, { x, y, w, h });
    const svcs = membersOf.get(g.id) || [];
    svcs.forEach((s, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const sx = x + GPAD + c * (SVC + GAP);
      const sy = y + GHEAD + GPAD + r * (SVC + LABEL_H + GAP);
      emitService(s, sx, sy);
    });
  }

  // Place top-level groups then ungrouped services, left to right.
  let cx = MARGIN, maxH = 0;
  for (const g of topGroups) {
    emitGroup(g, cx, MARGIN);
    const r = rect.get(g.id);
    cx += r.w + GAP;
    maxH = Math.max(maxH, r.h);
  }
  for (const s of ungrouped) {
    emitService(s, cx, MARGIN + GHEAD);
    cx += SVC + GAP;
    maxH = Math.max(maxH, SVC + LABEL_H);
  }

  // Edges with side anchors.
  let ei = 0;
  for (const e of model.edges) {
    if (!rect.has(e.from) || !rect.has(e.to)) {
      warnings.push(`edge references unknown node: ${e.from} -- ${e.to}`);
      continue;
    }
    const exit = SIDE[e.fromSide] || [0.5, 0.5];
    const entry = SIDE[e.toSide] || [0.5, 0.5];
    const startArrow = e.arrow.startsWith("<") ? "startArrow=block;startFill=1;" : "";
    const endArrow = e.arrow.includes(">") ? "endArrow=block;endFill=1;" : "endArrow=none;";
    cells.push(
      `<mxCell id="arch-e-${ei++}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=${exit[0]};exitY=${exit[1]};entryX=${entry[0]};entryY=${entry[1]};${startArrow}${endArrow}strokeColor=#333333;strokeWidth=2;" edge="1" parent="1" source="${escapeXml(e.from)}" target="${escapeXml(e.to)}">` +
        `<mxGeometry relative="1" as="geometry" /></mxCell>`
    );
  }

  const pageW = cx + MARGIN;
  const pageH = MARGIN * 2 + maxH + 20;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
