import dagreModule from "@dagrejs/dagre";
import { escapeXml, round, wrapXml, bodyLines } from "./drawio-xml.js";
import { measureMultiline } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

/**
 * Minimal Mermaid C4 parser (C4Context / C4Container / C4Component /
 * C4Dynamic / C4Deployment).
 *
 *   C4Context
 *     title System Context
 *     Person(customerA, "Customer", "A customer of the bank.")
 *     Enterprise_Boundary(b0, "Bank") {
 *       System(SystemAA, "Internet Banking", "Allows customers to ...")
 *     }
 *     Rel(customerA, SystemAA, "Uses", "HTTPS")
 *
 * Rel direction variants (Rel_D/U/L/R/Back/Neighbor) are treated as plain
 * Rel; BiRel gets arrowheads on both ends. UpdateElementStyle/UpdateRelStyle
 * and layout directives are skipped silently. `$`-prefixed args (sprites,
 * tags, links) are dropped.
 */
export function parseC4(source) {
  const warnings = [];
  const root = { kind: "root", alias: "__root__", label: "", children: [] };
  const stack = [root];
  const byAlias = new Map();
  const rels = [];
  let title = null;

  const ELEMENT_KINDS = new Set([
    "person", "person_ext",
    "system", "system_ext", "systemdb", "systemdb_ext", "systemqueue", "systemqueue_ext",
    "container", "container_ext", "containerdb", "containerdb_ext",
    "containerqueue", "containerqueue_ext",
    "component", "component_ext", "componentdb", "componentdb_ext",
    "componentqueue", "componentqueue_ext",
  ]);
  const BOUNDARY_KINDS = new Set([
    "boundary", "enterprise_boundary", "system_boundary", "container_boundary",
    "node", "node_l", "node_r", "deployment_node",
  ]);

  for (const { trimmed, lineNo } of bodyLines(source, /^C4(Context|Container|Component|Dynamic|Deployment)\b/)) {
    let m;
    if (trimmed === "}") {
      if (stack.length > 1) stack.pop();
      else warnings.push(`Line ${lineNo}: unmatched '}'`);
      continue;
    }
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = m[1].trim();
      continue;
    }
    if (/^(UpdateElementStyle|UpdateRelStyle|UpdateBoundaryStyle|UpdateLayoutConfig|LAYOUT|SHOW_|acc(Title|Descr))/i.test(trimmed)) {
      continue;
    }
    m = trimmed.match(/^([A-Za-z_]+)\s*\((.*)\)\s*(\{?)\s*$/);
    if (!m) {
      warnings.push(`Line ${lineNo}: could not parse C4 line: ${trimmed}`);
      continue;
    }
    const kind = m[1].toLowerCase();
    const args = splitArgs(m[2]).filter((a) => !a.startsWith("$"));
    const opensBlock = m[3] === "{";
    const parent = stack[stack.length - 1];

    if (BOUNDARY_KINDS.has(kind)) {
      const typeLabel =
        kind === "boundary"
          ? args[2] || "boundary"
          : kind.replace(/_boundary$/, "").replace(/^node.*/, "node").replace(/^deployment.*/, "node");
      const b = {
        kind: "boundary",
        type: typeLabel,
        alias: args[0] || `b${byAlias.size}`,
        label: args[1] || args[0] || "",
        children: [],
      };
      parent.children.push(b);
      byAlias.set(b.alias, b);
      if (opensBlock) stack.push(b);
      continue;
    }
    if (ELEMENT_KINDS.has(kind)) {
      const ext = kind.endsWith("_ext");
      const base = kind.replace(/_ext$/, "");
      const family = base.replace(/(db|queue)$/, "");
      const shape = base.endsWith("db") ? "db" : base.endsWith("queue") ? "queue" : "box";
      // Container/Component take (alias, label, techn, descr);
      // Person/System take (alias, label, descr).
      const isTech = family === "container" || family === "component";
      const el = {
        kind: "element",
        family,
        shape,
        ext,
        alias: args[0] || `e${byAlias.size}`,
        label: args[1] || args[0] || "",
        techn: isTech ? args[2] || null : null,
        descr: (isTech ? args[3] : args[2]) || null,
      };
      parent.children.push(el);
      byAlias.set(el.alias, el);
      if (opensBlock) stack.push(el); // tolerate odd blocks
      continue;
    }
    if (/^(bi)?rel(_[a-z]+)?$/i.test(kind)) {
      rels.push({
        from: args[0],
        to: args[1],
        label: args[2] || "",
        techn: args[3] || null,
        bidir: /^birel/i.test(kind),
      });
      continue;
    }
    warnings.push(`Line ${lineNo}: unknown C4 keyword '${m[1]}'`);
  }
  if (stack.length > 1) warnings.push("unclosed boundary block(s)");

  return { title, root, byAlias, rels, warnings };
}

function splitArgs(s) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (const ch of s) {
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

const EL_W = 200;
const PAD = 24;
const HEADER = 26; // boundary label strip (drawn at the bottom, C4-style)

const COLORS = {
  person: { fill: "#08427B", stroke: "#052E56", font: "#ffffff" },
  system: { fill: "#1168BD", stroke: "#0B4884", font: "#ffffff" },
  container: { fill: "#438DD5", stroke: "#2E6295", font: "#ffffff" },
  component: { fill: "#85BBF0", stroke: "#5D82A8", font: "#000000" },
  ext: { fill: "#999999", stroke: "#6B6B6B", font: "#ffffff" },
};

function elementColors(el) {
  return el.ext ? COLORS.ext : COLORS[el.family] || COLORS.system;
}

function elementSize(el) {
  const descrLines = el.descr ? measureMultiline(el.descr, 28).lineCount : 0;
  const h = 46 + (el.techn ? 14 : 0) + descrLines * 14 + (el.family === "person" ? 14 : 0);
  return { w: EL_W, h: Math.max(64, h) };
}

function elementLabel(el) {
  const typeName =
    el.family.charAt(0).toUpperCase() + el.family.slice(1) + (el.ext ? " Ext" : "");
  let s = `<b>${escapeXml(el.label)}</b>`;
  s += `<br><font style="font-size:9px">[${escapeXml(typeName)}${el.techn ? ": " + escapeXml(el.techn) : ""}]</font>`;
  if (el.descr) s += `<br><font style="font-size:10px">${escapeXml(el.descr)}</font>`;
  return s;
}

/**
 * Convert a Mermaid C4 diagram to draw.io XML. Boundaries are laid out
 * recursively (dagre inside each boundary, then the boundary participates
 * as a single node in its parent), so nesting stays tight. Elements use
 * C4's conventional coloring; Db/Queue variants render as cylinders.
 */
export function c4ToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseC4(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.root.children.length === 0) {
    warnings.push("C4 diagram has no elements");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  // Map each alias to its ancestor group chain (root first).
  const chains = new Map();
  (function walk(group, chain) {
    for (const child of group.children) {
      chains.set(child.alias, [...chain, group]);
      if (child.kind === "boundary") walk(child, [...chain, group]);
    }
  })(model.root, []);

  // Assign each rel to the lowest common ancestor group, projected onto that
  // group's direct children so dagre can see it.
  const groupEdges = new Map(); // group.alias -> [{a, b}]
  for (const rel of model.rels) {
    const ca = chains.get(rel.from);
    const cb = chains.get(rel.to);
    if (!ca || !cb) {
      warnings.push(`relation references unknown alias: ${rel.from} -> ${rel.to}`);
      continue;
    }
    let depth = 0;
    while (depth < ca.length && depth < cb.length && ca[depth] === cb[depth]) depth++;
    const lca = ca[depth - 1];
    const repOf = (chain, alias) => (depth < chain.length ? chain[depth].alias : alias);
    if (!groupEdges.has(lca.alias)) groupEdges.set(lca.alias, []);
    groupEdges.get(lca.alias).push({ a: repOf(ca, rel.from), b: repOf(cb, rel.to) });
  }

  // Bottom-up sizing: dagre-layout each group's children.
  (function size(group) {
    for (const child of group.children) {
      if (child.kind === "boundary") size(child);
    }
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 50, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const child of group.children) {
      const dim = child.kind === "boundary" ? { width: child.w, height: child.h } : (() => {
        const { w, h } = elementSize(child);
        return { width: w, height: h };
      })();
      g.setNode(child.alias, dim);
    }
    (groupEdges.get(group.alias) || []).forEach((e, i) => {
      if (g.hasNode(e.a) && g.hasNode(e.b) && e.a !== e.b) g.setEdge(e.a, e.b, {}, `e${i}`);
    });
    dagre.layout(g);
    let maxX = 0;
    let maxY = 0;
    for (const child of group.children) {
      const li = g.node(child.alias);
      child.relX = li.x - li.width / 2;
      child.relY = li.y - li.height / 2;
      maxX = Math.max(maxX, li.x + li.width / 2);
      maxY = Math.max(maxY, li.y + li.height / 2);
    }
    group.w = maxX + PAD * 2;
    group.h = maxY + PAD * 2 + (group.kind === "boundary" ? HEADER : 0);
  })(model.root);

  // Top-down absolute positioning + cell emission (boundaries before their
  // children so the children draw on top).
  const titleH = model.title ? 40 : 0;
  let bId = 0;
  (function emit(group, x, y) {
    for (const child of group.children) {
      const cx = x + PAD + child.relX;
      const cy = y + PAD + child.relY;
      if (child.kind === "boundary") {
        // HTML labels are stored XML-escaped in the value attribute
        // (draw.io unescapes, then interprets the HTML).
        const bLabel = `<b>${escapeXml(child.label)}</b> <font style="font-size:9px">[${escapeXml(child.type)}]</font>`;
        cells.push(
          `<mxCell id="${escapeXml(child.alias)}" value="${escapeXml(bLabel)}" ` +
            `style="rounded=0;html=1;dashed=1;fillColor=none;strokeColor=#444444;verticalAlign=bottom;align=left;spacingLeft=8;spacingBottom=4;fontSize=11;" vertex="1" parent="1">` +
            `<mxGeometry x="${round(cx)}" y="${round(cy)}" width="${round(child.w)}" height="${round(child.h)}" as="geometry" />` +
            `</mxCell>`
        );
        bId++;
        emit(child, cx, cy);
      } else {
        const { w, h } = elementSize(child);
        const { fill, stroke, font } = elementColors(child);
        let style;
        if (child.shape === "db") {
          style = `shape=cylinder;html=1;whiteSpace=wrap;boundedLbl=1;fillColor=${fill};strokeColor=${stroke};fontColor=${font};fontSize=11;verticalAlign=middle;`;
        } else if (child.shape === "queue") {
          style = `shape=cylinder;direction=south;html=1;whiteSpace=wrap;boundedLbl=1;horizontal=1;fillColor=${fill};strokeColor=${stroke};fontColor=${font};fontSize=11;verticalAlign=middle;`;
        } else {
          const arc = child.family === "person" ? "rounded=1;arcSize=20;" : "rounded=1;arcSize=6;";
          style = `${arc}html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=${stroke};fontColor=${font};fontSize=11;verticalAlign=middle;`;
        }
        cells.push(
          `<mxCell id="${escapeXml(child.alias)}" value="${escapeXml(elementLabel(child))}" style="${style}" vertex="1" parent="1">` +
            `<mxGeometry x="${round(cx)}" y="${round(cy)}" width="${w}" height="${h}" as="geometry" />` +
            `</mxCell>`
        );
        // Person marker: a small head circle on the top edge.
        if (child.family === "person") {
          cells.push(
            `<mxCell id="${escapeXml(child.alias)}-head" value="" ` +
              `style="ellipse;html=1;fillColor=${fill};strokeColor=${stroke};" vertex="1" parent="1">` +
              `<mxGeometry x="${round(cx + w / 2 - 12)}" y="${round(cy - 14)}" width="24" height="24" as="geometry" />` +
              `</mxCell>`
          );
        }
      }
    }
  })(model.root, 0, titleH);

  if (model.title) {
    cells.unshift(
      `<mxCell id="c4-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=left;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${PAD}" y="4" width="${round(Math.max(300, model.root.w - PAD))}" height="30" as="geometry" />` +
        `</mxCell>`
    );
  }

  // Relations between concrete elements (aliases are globally unique ids).
  model.rels.forEach((rel, i) => {
    if (!chains.has(rel.from) || !chains.has(rel.to)) return;
    let label = escapeXml(rel.label);
    if (rel.techn) label += `<br><font style="font-size:9px"><i>[${escapeXml(rel.techn)}]</i></font>`;
    const start = rel.bidir ? "startArrow=block;startFill=1;" : "";
    cells.push(
      `<mxCell id="c4-rel-${i}" value="${escapeXml(label)}" ` +
        `style="html=1;endArrow=block;endFill=1;${start}strokeColor=#666666;fontSize=10;fontColor=#444444;labelBackgroundColor=#ffffff;rounded=1;" ` +
        `edge="1" parent="1" source="${escapeXml(rel.from)}" target="${escapeXml(rel.to)}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`
    );
  });

  const pageW = model.root.w + PAD;
  const pageH = model.root.h + titleH + PAD;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
