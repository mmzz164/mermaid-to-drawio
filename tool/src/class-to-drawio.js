import dagreModule from "@dagrejs/dagre";
import { parseClassDiagram } from "./class-parser.js";
import { measureMultiline, visualWidth } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

const HEADER_H = 28;
const ROW_H = 20;
const MIN_W = 160;
const PAD_X = 14;
const CHAR_PX = 7.2;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function classBlockSize(cls) {
  let widest = visualWidth(cls.label || cls.id);
  for (const a of cls.attributes) widest = Math.max(widest, visualWidth(a));
  for (const m of cls.methods) widest = Math.max(widest, visualWidth(m));
  if (cls.stereotype) widest = Math.max(widest, visualWidth(`<<${cls.stereotype}>>`));
  const w = Math.max(MIN_W, Math.round(widest * CHAR_PX) + PAD_X * 2);
  const rows = cls.attributes.length + cls.methods.length;
  const stereoH = cls.stereotype ? ROW_H : 0;
  const h =
    HEADER_H + stereoH + rows * ROW_H +
    (cls.attributes.length ? 4 : 0) + (cls.methods.length ? 4 : 0);
  return { w, h: Math.max(HEADER_H + ROW_H, h) };
}

function dirToRankdir(d) {
  switch (d) {
    case "LR": return "LR";
    case "RL": return "RL";
    case "BT": return "BT";
    default:   return "TB";
  }
}

function round(n) { return Math.round(n); }

/**
 * Render a parsed classDiagram into drawio XML. Each class becomes a single
 * rectangle whose label is HTML-formatted: a bold class name on top,
 * followed by an optional stereotype, an attributes section divided from a
 * methods section. Relations connect classes with arrowheads chosen for
 * each UML relation kind.
 *
 * @param {string} src
 * @param {object} [opts]
 * @param {string} [opts.diagramName="Page-1"]
 * @returns {{xml:string, warnings:string[]}}
 */
export function classDiagramToDrawio(src, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseClassDiagram(src);

  const rankdir = dirToRankdir(model.direction);
  function makeGraph(nodesep, ranksep, margin) {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir, nodesep, ranksep, marginx: margin, marginy: margin });
    g.setDefaultEdgeLabel(() => ({}));
    return g;
  }

  // Layout result: absolute positions per class + namespace frames.
  const pos = new Map(); // class id -> {x, y, width, height}
  const nsFrames = []; // {name, x, y, width, height}
  let totalW = 0;
  let totalH = 0;
  const NS_HEADER = 30; // room for the namespace title inside the frame
  const NS_PAD = 18;

  if ((model.namespaces || []).length === 0) {
    const g = makeGraph(50, 80, 20);
    for (const cls of model.classes.values()) {
      const { w, h } = classBlockSize(cls);
      g.setNode(cls.id, { width: w, height: h });
    }
    let ei = 0;
    for (const r of model.relations) {
      if (!g.hasNode(r.from) || !g.hasNode(r.to)) continue;
      g.setEdge(r.from, r.to, {}, `e${ei++}`);
    }
    dagre.layout(g);
    for (const cls of model.classes.values()) {
      const n = g.node(cls.id);
      if (!n) continue;
      pos.set(cls.id, { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height });
    }
    const ga = g.graph();
    totalW = ga.width || 0;
    totalH = ga.height || 0;
  } else {
    // Two-level layout: classes inside each namespace get their own dagre
    // run; the namespace then joins the top-level layout as a single big
    // node (edges projected onto it), like C4 boundaries.
    const inner = new Map(); // ns name -> {width, height, positions: Map}
    for (const ns of model.namespaces) {
      const g = makeGraph(40, 60, NS_PAD);
      const members = new Set(ns.classes);
      for (const id of ns.classes) {
        const { w, h } = classBlockSize(model.classes.get(id));
        g.setNode(id, { width: w, height: h });
      }
      let ei = 0;
      for (const r of model.relations) {
        if (members.has(r.from) && members.has(r.to) && r.from !== r.to) {
          g.setEdge(r.from, r.to, {}, `e${ei++}`);
        }
      }
      dagre.layout(g);
      const positions = new Map();
      for (const id of ns.classes) {
        const n = g.node(id);
        positions.set(id, {
          x: n.x - n.width / 2,
          y: n.y - n.height / 2 + NS_HEADER,
          width: n.width,
          height: n.height,
        });
      }
      const ga = g.graph();
      inner.set(ns.name, { width: ga.width || 0, height: (ga.height || 0) + NS_HEADER, positions });
    }

    const g = makeGraph(50, 80, 20);
    const nsNodeId = (name) => `__ns__${name}`;
    for (const ns of model.namespaces) {
      const r = inner.get(ns.name);
      g.setNode(nsNodeId(ns.name), { width: r.width, height: r.height });
    }
    for (const cls of model.classes.values()) {
      if (cls.namespace) continue;
      const { w, h } = classBlockSize(cls);
      g.setNode(cls.id, { width: w, height: h });
    }
    const rep = (id) => {
      const ns = model.classes.get(id)?.namespace;
      return ns ? nsNodeId(ns) : id;
    };
    let ei = 0;
    for (const r of model.relations) {
      const a = rep(r.from);
      const b = rep(r.to);
      if (a === b || !g.hasNode(a) || !g.hasNode(b)) continue;
      g.setEdge(a, b, {}, `e${ei++}`);
    }
    dagre.layout(g);
    for (const ns of model.namespaces) {
      const n = g.node(nsNodeId(ns.name));
      const r = inner.get(ns.name);
      const ox = n.x - n.width / 2;
      const oy = n.y - n.height / 2;
      nsFrames.push({ name: ns.name, x: ox, y: oy, width: n.width, height: n.height });
      for (const [id, p] of r.positions) {
        pos.set(id, { x: ox + p.x, y: oy + p.y, width: p.width, height: p.height });
      }
    }
    for (const cls of model.classes.values()) {
      if (cls.namespace) continue;
      const n = g.node(cls.id);
      if (!n) continue;
      pos.set(cls.id, { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height });
    }
    const ga = g.graph();
    totalW = ga.width || 0;
    totalH = ga.height || 0;
  }

  const cells = [`<mxCell id="0" />`, `<mxCell id="1" parent="0" />`];

  // Namespace frames first, so they sit behind their member classes.
  for (const [i, f] of nsFrames.entries()) {
    cells.push(
      `<mxCell id="cls-ns-${i}" value="${escapeXml(f.name)}" ` +
        `style="rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;fontStyle=1;fillColor=#fafafa;strokeColor=#999999;fontSize=12;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(f.x)}" y="${round(f.y)}" width="${round(f.width)}" height="${round(f.height)}" as="geometry" />` +
        `</mxCell>`,
    );
  }

  for (const cls of model.classes.values()) {
    const node = pos.get(cls.id);
    if (!node) continue;
    const x = node.x;
    const y = node.y;
    const w = node.width;
    const h = node.height;

    // Render the body as HTML inside a single cell. drawio understands HTML
    // values when `html=1` is set; we get tidy 3-section UML class boxes
    // without spawning child cells.
    const parts = [];
    parts.push(`<p style=\"margin:0;padding:4px 8px;text-align:center;font-weight:bold;border-bottom:1px solid #999;\">${escapeXml(cls.label)}</p>`);
    if (cls.stereotype) {
      parts.push(`<p style=\"margin:0;padding:0 8px;text-align:center;font-style:italic;color:#666;\">&lt;&lt;${escapeXml(cls.stereotype)}&gt;&gt;</p>`);
    }
    if (cls.attributes.length) {
      const inner = cls.attributes
        .map((a) => `<div style=\"padding:2px 10px;\">${escapeXml(a)}</div>`) // attr per line
        .join("");
      parts.push(`<div style=\"border-top:1px solid #ddd;\">${inner}</div>`);
    }
    if (cls.methods.length) {
      const inner = cls.methods
        .map((m) => `<div style=\"padding:2px 10px;\">${escapeXml(m)}</div>`) // method per line
        .join("");
      parts.push(`<div style=\"border-top:1px solid #ddd;\">${inner}</div>`);
    }
    const value = parts.join("");

    const style = "rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;align=left;fillColor=#ffffff;strokeColor=#666666;fontSize=12;";
    cells.push(
      `<mxCell id="${escapeXml(cls.id)}" value="${escapeXml(value)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
        `</mxCell>`,
    );
  }

  let eId = 1;
  for (const r of model.relations) {
    if (!model.classes.has(r.from) || !model.classes.has(r.to)) continue;
    const segs = [
      "edgeStyle=orthogonalEdgeStyle",
      "rounded=0",
      "html=1",
      "fontSize=11",
      "labelBackgroundColor=#ffffff",
      `startArrow=${r.startArrow.split(";")[0]}`,
      `endArrow=${r.endArrow.split(";")[0]}`,
    ];
    // startFill / endFill come along when the arrow descriptor includes them.
    const startFill = r.startArrow.includes("Fill=") ? r.startArrow.split(";").find((s) => s.includes("Fill=")) : null;
    const endFill = r.endArrow.includes("Fill=") ? r.endArrow.split(";").find((s) => s.includes("Fill=")) : null;
    if (startFill) segs.push(startFill);
    if (endFill) segs.push(endFill);
    if (r.dashed) segs.push("dashed=1");
    const style = segs.join(";") + ";";
    // Compose the label: optional `fromCard` is anchored near the source,
    // `toCard` near the target, and a center label for the verb/role.
    const value = r.label ? escapeXml(r.label) : "";

    const cellXml =
      `<mxCell id="cls-edge-${eId}" value="${value}" style="${style}" edge="1" parent="1" source="${escapeXml(r.from)}" target="${escapeXml(r.to)}">` +
      `<mxGeometry relative="1" as="geometry" />` +
      `</mxCell>`;
    cells.push(cellXml);

    // Cardinality labels are rendered as separate child label cells that
    // float near each end of the edge.
    if (r.fromCard) {
      cells.push(
        `<mxCell id="cls-edge-${eId}-from" value="${escapeXml(r.fromCard)}" ` +
          `style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];labelBackgroundColor=#ffffff;fontSize=10;" ` +
          `vertex="1" connectable="0" parent="cls-edge-${eId}">` +
          `<mxGeometry x="-0.75" relative="1" as="geometry"><mxPoint as="offset" /></mxGeometry></mxCell>`,
      );
    }
    if (r.toCard) {
      cells.push(
        `<mxCell id="cls-edge-${eId}-to" value="${escapeXml(r.toCard)}" ` +
          `style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];labelBackgroundColor=#ffffff;fontSize=10;" ` +
          `vertex="1" connectable="0" parent="cls-edge-${eId}">` +
          `<mxGeometry x="0.75" relative="1" as="geometry"><mxPoint as="offset" /></mxGeometry></mxCell>`,
      );
    }
    eId++;
  }

  // Notes
  let nId = 1;
  for (const note of model.notes) {
    const noteId = `cls-note-${nId}`;
    cells.push(
      `<mxCell id="${noteId}" value="${escapeXml(note.text)}" ` +
        `style="shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;align=left;verticalAlign=top;spacingLeft=4;spacingTop=4;" ` +
        `vertex="1" parent="1">` +
        `<mxGeometry x="0" y="0" width="180" height="60" as="geometry" /></mxCell>`,
    );
    if (note.target && model.classes.has(note.target)) {
      cells.push(
        `<mxCell id="${noteId}-link" value="" style="edgeStyle=none;dashed=1;endArrow=none;strokeColor=#999999;html=1;" edge="1" parent="1" source="${noteId}" target="${escapeXml(note.target)}">` +
          `<mxGeometry relative="1" as="geometry" /></mxCell>`,
      );
    }
    nId++;
  }

  const pageW = Math.max(850, Math.round(totalW || 850) + 40);
  const pageH = Math.max(1100, Math.round(totalH || 1100) + 40);

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
