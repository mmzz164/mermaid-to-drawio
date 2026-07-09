import dagreModule from "@dagrejs/dagre";
import { escapeXml, round, wrapXml, bodyLines, unquote } from "./drawio-xml.js";
import { visualWidth } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

const REQ_TYPES = new Set([
  "requirement",
  "functionalrequirement",
  "interfacerequirement",
  "performancerequirement",
  "physicalrequirement",
  "designconstraint",
]);
const REL_TYPES = new Set([
  "contains",
  "copies",
  "derives",
  "satisfies",
  "verifies",
  "refines",
  "traces",
]);

/**
 * Minimal Mermaid requirementDiagram parser.
 *
 *   requirementDiagram
 *     requirement test_req {
 *       id: 1
 *       text: the test text.
 *       risk: high
 *       verifymethod: test
 *     }
 *     element test_entity {
 *       type: simulation
 *     }
 *     test_entity - satisfies -> test_req
 *     test_req <- copies - test_entity2
 */
export function parseRequirementDiagram(source) {
  const warnings = [];
  const nodes = new Map(); // name -> {kind, name, fields:{}}
  const relations = []; // {from, to, type}
  let currentNode = null;

  for (const { trimmed, lineNo } of bodyLines(source, /^requirementDiagram\b/i)) {
    let m;
    if (currentNode) {
      if (trimmed === "}") {
        currentNode = null;
        continue;
      }
      if ((m = trimmed.match(/^(\w+)\s*:\s*(.+)$/))) {
        currentNode.fields[m[1].toLowerCase()] = unquote(m[2]);
        continue;
      }
      warnings.push(`Line ${lineNo}: could not parse field: ${trimmed}`);
      continue;
    }

    if ((m = trimmed.match(/^(\w+)\s+([\w.-]+)\s*\{\s*$/))) {
      const kind = m[1].toLowerCase();
      if (REQ_TYPES.has(kind) || kind === "element") {
        currentNode = { kind, name: m[2], fields: {} };
        nodes.set(m[2], currentNode);
        continue;
      }
    }
    // a - satisfies -> b
    if ((m = trimmed.match(/^([\w.-]+)\s*-\s*(\w+)\s*->\s*([\w.-]+)$/))) {
      const type = m[2].toLowerCase();
      if (!REL_TYPES.has(type)) warnings.push(`Line ${lineNo}: unknown relation '${m[2]}'`);
      relations.push({ from: m[1], to: m[3], type });
      continue;
    }
    // b <- satisfies - a  (arrow points back to the left operand)
    if ((m = trimmed.match(/^([\w.-]+)\s*<-\s*(\w+)\s*-\s*([\w.-]+)$/))) {
      const type = m[2].toLowerCase();
      if (!REL_TYPES.has(type)) warnings.push(`Line ${lineNo}: unknown relation '${m[2]}'`);
      relations.push({ from: m[3], to: m[1], type });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse requirement line: ${trimmed}`);
  }

  return { nodes: [...nodes.values()], relations, warnings };
}

const FIELD_ORDER = ["id", "text", "risk", "verifymethod", "type", "docref"];

function nodeLabel(node) {
  const stereotype = node.kind === "element" ? "element" : node.kind;
  const lines = [`&lt;&lt;${escapeXml(stereotype)}&gt;&gt;`, `<b>${escapeXml(node.name)}</b>`];
  const fields = FIELD_ORDER.filter((f) => node.fields[f] !== undefined).map(
    (f) => `${escapeXml(f)}: ${escapeXml(node.fields[f])}`
  );
  return { header: lines.join("<br>"), fields };
}

function nodeSize(node) {
  const { fields } = nodeLabel(node);
  let widest = visualWidth(node.name) + 4;
  for (const f of fields) widest = Math.max(widest, Math.min(46, f.length));
  const w = Math.max(180, Math.round(widest * 7.2) + 24);
  const h = 44 + Math.max(1, fields.length) * 16 + 8;
  return { w, h };
}

/**
 * Convert a Mermaid requirementDiagram to draw.io XML: requirement/element
 * boxes with a stereotype header and field rows, dagre layout, dashed
 * labeled arrows for the relations.
 */
export function requirementToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseRequirementDiagram(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.nodes.length === 0) {
    warnings.push("requirementDiagram has no nodes");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of model.nodes) {
    const { w, h } = nodeSize(n);
    g.setNode(n.name, { width: w, height: h });
  }
  model.relations.forEach((r, i) => {
    if (g.hasNode(r.from) && g.hasNode(r.to)) g.setEdge(r.from, r.to, {}, `r${i}`);
  });
  dagre.layout(g);

  for (const n of model.nodes) {
    const li = g.node(n.name);
    const { header, fields } = nodeLabel(n);
    const isElement = n.kind === "element";
    const fill = isElement ? "#d5e8d4" : "#dae8fc";
    const stroke = isElement ? "#82b366" : "#6c8ebf";
    const body = fields.length ? `<hr size="1">${fields.join("<br>")}` : "";
    // HTML labels are stored XML-escaped in the value attribute.
    cells.push(
      `<mxCell id="req-${escapeXml(n.name)}" value="${escapeXml(header + body)}" ` +
        `style="rounded=0;html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=${stroke};align=center;verticalAlign=top;spacingTop=4;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(li.x - li.width / 2)}" y="${round(li.y - li.height / 2)}" width="${round(li.width)}" height="${round(li.height)}" as="geometry" />` +
        `</mxCell>`
    );
  }

  model.relations.forEach((r, i) => {
    if (!g.hasNode(r.from) || !g.hasNode(r.to)) {
      warnings.push(`relation references undeclared node: ${r.from} - ${r.type} -> ${r.to}`);
      return;
    }
    // `contains` is a structural (solid) relation in SysML; the rest are
    // dashed dependencies with a stereotype label.
    const dashed = r.type === "contains" ? "" : "dashed=1;";
    cells.push(
      `<mxCell id="req-rel-${i}" value="${escapeXml(`&lt;&lt;${escapeXml(r.type)}&gt;&gt;`)}" ` +
        `style="html=1;endArrow=open;endFill=0;${dashed}fontSize=10;labelBackgroundColor=#ffffff;edgeStyle=orthogonalEdgeStyle;rounded=1;" ` +
        `edge="1" parent="1" source="req-${escapeXml(r.from)}" target="req-${escapeXml(r.to)}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`
    );
  });

  const attrs = g.graph();
  const pageW = round(attrs.width || 850) + 40;
  const pageH = round(attrs.height || 1100) + 40;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
