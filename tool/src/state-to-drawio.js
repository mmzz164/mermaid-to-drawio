import dagreModule from "@dagrejs/dagre";
import { parseStateDiagram } from "./state-parser.js";
import { measureMultiline } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

const NODE_DEFAULT_W = 120;
const NODE_DEFAULT_H = 44;
const PSEUDO_R = 16; // diameter of the start/end pseudo state
const FORK_W = 60;
const FORK_H = 8;
const CHOICE_W = 36;
const CHOICE_H = 36;
const NOTE_W = 160;
const NOTE_H = 60;
const CHAR_PX = 7.5;
const SG_PAD_X = 24;
const SG_PAD_Y = 32;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Size & style decisions per state kind. */
function dimsFor(state) {
  switch (state.kind) {
    case "start":
    case "end":
      return { w: PSEUDO_R, h: PSEUDO_R };
    case "fork":
    case "join":
      return { w: FORK_W, h: FORK_H };
    case "choice":
      return { w: CHOICE_W, h: CHOICE_H };
    default: {
      const { maxWidth, lineCount } = measureMultiline(state.label || state.id);
      const w = Math.max(NODE_DEFAULT_W, Math.round(maxWidth * CHAR_PX) + 24);
      const h = Math.max(NODE_DEFAULT_H, lineCount * 22 + 16);
      return { w, h };
    }
  }
}

function styleFor(state) {
  switch (state.kind) {
    case "start":
      return "ellipse;fillColor=#000000;strokeColor=#000000;html=1;";
    case "end":
      return "shape=endState;fillColor=#000000;strokeColor=#000000;html=1;";
    case "fork":
    case "join":
      return "shape=line;direction=east;strokeColor=#000000;strokeWidth=4;html=1;";
    case "choice":
      return "rhombus;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;";
    default:
      return "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;arcSize=20;";
  }
}

function dirToRankdir(d) {
  switch (d) {
    case "LR": return "LR";
    case "RL": return "RL";
    case "BT": return "BT";
    case "TB":
    case "TD":
    default:   return "TB";
  }
}

function round(n) { return Math.round(n); }

/**
 * Build a drawio mxfile that renders a mermaid stateDiagram natively.
 * The layout reuses dagre's hierarchical layout (the same pattern as
 * flowcharts) so composite states stay tight.
 *
 * @param {string} src
 * @param {object} [opts]
 * @param {string} [opts.diagramName="Page-1"]
 * @returns {{xml:string, warnings:string[]}}
 */
export function stateToDrawio(src, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseStateDiagram(src);

  // parent maps
  const parentOf = new Map();
  for (const s of model.states.values()) parentOf.set(s.id, s.parent || null);
  for (const c of model.composites) parentOf.set(c.id, c.parent || null);

  const childStatesByLevel = new Map();
  const childCompsByLevel = new Map();
  childStatesByLevel.set(null, []);
  childCompsByLevel.set(null, []);
  for (const c of model.composites) {
    childStatesByLevel.set(c.id, []);
    childCompsByLevel.set(c.id, []);
  }
  for (const s of model.states.values()) {
    if (s.kind === "composite") continue; // composites are containers, not nodes
    const p = s.parent || null;
    childStatesByLevel.get(p)?.push(s.id);
  }
  for (const c of model.composites) {
    const p = c.parent || null;
    childCompsByLevel.get(p)?.push(c.id);
  }

  function findRepresentative(id, levelId) {
    let cur = id;
    for (let i = 0; i < 1024; i++) {
      const p = parentOf.has(cur) ? parentOf.get(cur) : null;
      if (p === levelId) return cur;
      if (p == null) return levelId == null ? cur : null;
      cur = p;
    }
    return null;
  }

  function layoutLevel(levelId) {
    const directStates = childStatesByLevel.get(levelId) || [];
    const directComps = childCompsByLevel.get(levelId) || [];

    const childResults = {};
    for (const cid of directComps) childResults[cid] = layoutLevel(cid);

    const g = new dagre.graphlib.Graph({ multigraph: true });
    const isInside = levelId != null;
    const comp = isInside ? model.composites.find((c) => c.id === levelId) : null;
    const lvlDir = (comp && comp.direction) || model.direction;
    g.setGraph({
      rankdir: dirToRankdir(lvlDir),
      nodesep: 40,
      ranksep: 60,
      marginx: isInside ? SG_PAD_X : 20,
      marginy: isInside ? SG_PAD_Y : 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const sid of directStates) {
      const st = model.states.get(sid);
      const { w, h } = dimsFor(st);
      g.setNode(sid, { width: w, height: h });
    }
    for (const cid of directComps) {
      const r = childResults[cid];
      g.setNode(cid, { width: r.width, height: r.height });
    }

    let ei = 0;
    for (const t of model.transitions) {
      const a = findRepresentative(t.from, levelId);
      const b = findRepresentative(t.to, levelId);
      if (!a || !b || a === b) continue;
      if (!g.hasNode(a) || !g.hasNode(b)) continue;
      g.setEdge(a, b, {}, `e${ei++}`);
    }

    dagre.layout(g);

    const positions = {};
    for (const sid of directStates) {
      const li = g.node(sid);
      positions[sid] = {
        x: li.x - li.width / 2,
        y: li.y - li.height / 2,
        width: li.width,
        height: li.height,
      };
    }
    for (const cid of directComps) {
      const li = g.node(cid);
      positions[cid] = {
        x: li.x - li.width / 2,
        y: li.y - li.height / 2,
        width: li.width,
        height: li.height,
      };
    }
    const ga = g.graph();
    return { width: ga.width || 0, height: ga.height || 0, positions, children: childResults };
  }

  const root = layoutLevel(null);

  const cells = [`<mxCell id="0" />`, `<mxCell id="1" parent="0" />`];

  function emitLevel(levelId, result) {
    const directStates = childStatesByLevel.get(levelId) || [];
    const directComps = childCompsByLevel.get(levelId) || [];
    const drawioParent = levelId || "1";

    for (const cid of directComps) {
      const c = model.composites.find((x) => x.id === cid);
      const pos = result.positions[cid];
      const style =
        "rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;fontStyle=1;" +
        "fillColor=#f5f5f5;strokeColor=#666666;arcSize=8;";
      cells.push(
        `<mxCell id="${escapeXml(cid)}" value="${escapeXml(c.label)}" style="${style}" vertex="1" parent="${escapeXml(drawioParent)}">` +
          `<mxGeometry x="${round(pos.x)}" y="${round(pos.y)}" width="${round(pos.width)}" height="${round(pos.height)}" as="geometry" />` +
          `</mxCell>`,
      );
      emitLevel(cid, result.children[cid]);
    }

    for (const sid of directStates) {
      const st = model.states.get(sid);
      const pos = result.positions[sid];
      const style = styleFor(st);
      // Pseudo states & forks/joins are unlabeled
      const label =
        st.kind === "start" || st.kind === "end" || st.kind === "fork" || st.kind === "join"
          ? ""
          : escapeXml(st.label || "");
      cells.push(
        `<mxCell id="${escapeXml(sid)}" value="${label}" style="${style}" vertex="1" parent="${escapeXml(drawioParent)}">` +
          `<mxGeometry x="${round(pos.x)}" y="${round(pos.y)}" width="${round(pos.width)}" height="${round(pos.height)}" as="geometry" />` +
          `</mxCell>`,
      );
    }
  }

  emitLevel(null, root);

  // Transitions
  let eId = 1;
  for (const t of model.transitions) {
    if (!model.states.has(t.from) || !model.states.has(t.to)) continue;
    const style =
      "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;" +
      "html=1;labelBackgroundColor=#ffffff;fontSize=12;endArrow=classic;";
    const value = t.label ? escapeXml(t.label) : "";
    cells.push(
      `<mxCell id="state-edge-${eId}" value="${value}" style="${style}" edge="1" parent="1" source="${escapeXml(t.from)}" target="${escapeXml(t.to)}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`,
    );
    eId++;
  }

  // Notes: rendered as floating note-shape rectangles next to the target.
  let nId = 1;
  for (const note of model.notes) {
    if (!model.states.has(note.target)) continue;
    // We don't know the absolute coordinates of the target without walking
    // the parent chain, so we anchor the note to the target via a connector
    // and let drawio's positioning land it in a sensible spot.
    const noteId = `state-note-${nId}`;
    cells.push(
      `<mxCell id="${noteId}" value="${escapeXml(note.text)}" ` +
        `style="shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;align=left;verticalAlign=top;spacingLeft=4;spacingTop=4;" ` +
        `vertex="1" parent="1">` +
        `<mxGeometry x="0" y="0" width="${NOTE_W}" height="${NOTE_H}" as="geometry" />` +
        `</mxCell>`,
    );
    // Dashed connector from note to its target.
    cells.push(
      `<mxCell id="${noteId}-link" value="" style="edgeStyle=none;dashed=1;endArrow=none;strokeColor=#999999;html=1;" edge="1" parent="1" source="${noteId}" target="${escapeXml(note.target)}">` +
        `<mxGeometry relative="1" as="geometry" /></mxCell>`,
    );
    nId++;
  }

  const pageW = Math.max(850, Math.round(root.width || 0) + 40);
  const pageH = Math.max(1100, Math.round(root.height || 0) + 40);
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
