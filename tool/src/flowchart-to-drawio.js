import dagreModule from "@dagrejs/dagre";
import { parseMermaidFlowchart } from "./mermaid-parser.js";
import { measureMultiline } from "./text-width.js";

const dagre = dagreModule.default ?? dagreModule;

const NODE_DEFAULT_W = 140;
const NODE_DEFAULT_H = 48;
const NODE_PAD_X = 24;
const NODE_PAD_H = 16;
const CHAR_PX = 7.5; // pixels per ASCII column at default font

// Padding INSIDE a subgraph cluster, used as dagre marginx/marginy when
// laying out its content. marginy is set high enough so the subgraph's
// title label (drawn at the top via verticalAlign=top) never overlaps
// top-row children.
const SG_PAD_X = 24;
const SG_PAD_Y = 32;

function estimateLabelSize(label) {
  const { maxWidth, lineCount } = measureMultiline(label);
  const w = Math.max(NODE_DEFAULT_W, Math.round(maxWidth * CHAR_PX) + NODE_PAD_X * 2);
  const h = Math.max(NODE_DEFAULT_H, lineCount * 22 + NODE_PAD_H);
  return { w, h };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Translate a Mermaid CSS-style property bag (`{ fill: "#f00", "stroke-width": "2px" }`)
 * into a drawio style overlay (`{ fillColor: "#f00", strokeWidth: "2" }`).
 *
 * Unknown keys are ignored, so legacy diagrams won't crash; values are
 * passed through with light cleanup (`px` suffix stripped from widths).
 *
 * @param {Object<string,string>|undefined|null} props
 * @returns {Object<string,string>}
 */
function cssPropsToDrawioStyle(props) {
  if (!props) return {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("_")) continue; // internal bookkeeping
    const val = String(v).trim();
    switch (k) {
      case "fill":
      case "background":
      case "background-color":
        out.fillColor = val;
        break;
      case "stroke":
      case "border-color":
        out.strokeColor = val;
        break;
      case "color":
        out.fontColor = val;
        break;
      case "stroke-width":
      case "border-width":
        out.strokeWidth = val.replace(/px$/i, "");
        break;
      case "stroke-dasharray":
        out.dashed = "1";
        break;
      case "font-size":
        out.fontSize = val.replace(/px$/i, "");
        break;
      case "font-weight":
        if (/bold|[6-9]00/i.test(val)) out.fontStyle = "1";
        break;
      case "font-style":
        if (/italic/i.test(val)) {
          // 4 = italic in drawio; combine with bold via bitwise OR.
          out.fontStyle = out.fontStyle
            ? String(parseInt(out.fontStyle, 10) | 4)
            : "4";
        }
        break;
      case "opacity":
        out.opacity = String(Math.round(parseFloat(val) * 100));
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Merge a drawio style overlay into an existing style string. Existing keys
 * are replaced; new keys are appended. The order of base keys is preserved
 * so that visual diffs remain small for unaffected nodes.
 *
 * @param {string} baseStyle
 * @param {Object<string,string>} overlay
 * @returns {string}
 */
function mergeStyle(baseStyle, overlay) {
  if (!overlay || Object.keys(overlay).length === 0) return baseStyle;
  const segs = baseStyle.split(";");
  const seen = new Set();
  const out = [];
  for (const seg of segs) {
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq < 0) {
      out.push(seg);
      continue;
    }
    const k = seg.slice(0, eq);
    if (k in overlay) {
      out.push(`${k}=${overlay[k]}`);
      seen.add(k);
    } else {
      out.push(seg);
    }
  }
  for (const [k, v] of Object.entries(overlay)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  return out.join(";") + (out.length ? ";" : "");
}

/**
 * Resolve the final style overlay for a node by combining its `:::class`
 * memberships, any `class A,B Foo` assignments, and the per-node `style A
 * fill:...` directive (which wins over class-derived properties).
 *
 * @param {{id:string,classes?:string[]|null}} node
 * @param {{classDefs:Object,styles:Object}} model
 * @returns {Object<string,string>}
 */
function resolveNodeStyleOverlay(node, model) {
  const merged = {};
  const inline = model.styles?.[node.id] || null;
  const fromClassAssign = inline?._classes || [];
  const declared = node.classes || [];
  for (const cls of [...declared, ...fromClassAssign]) {
    const def = model.classDefs?.[cls];
    if (def) Object.assign(merged, cssPropsToDrawioStyle(def));
  }
  if (inline) Object.assign(merged, cssPropsToDrawioStyle(inline));
  return merged;
}

function shapeStyle(shape) {
  switch (shape) {
    case "rounded":
      return "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;";
    case "ellipse":
      return "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;";
    case "stadium":
      return "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;";
    case "rhombus":
      return "rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;";
    case "hexagon":
      return "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;";
    case "cylinder":
      return "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#dae8fc;strokeColor=#6c8ebf;";
    case "parallelogram":
      return "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;";
    case "rectangle":
    default:
      return "rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;";
  }
}

function edgeStyle(arrow) {
  const base =
    "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;labelBackgroundColor=#ffffff;fontSize=12;";
  switch (arrow) {
    case "invisible":
      // Mermaid `~~~` is a layout-only link with no visible stroke.
      return base + "endArrow=none;strokeColor=none;";
    case "none":
      return base + "endArrow=none;";
    case "dashed":
      return base + "dashed=1;endArrow=classic;";
    case "dashed-none":
      return base + "dashed=1;endArrow=none;";
    case "thick":
      return base + "strokeWidth=3;endArrow=classic;";
    case "thick-none":
      return base + "strokeWidth=3;endArrow=none;";
    case "cross":
      return base + "endArrow=cross;";
    case "circle":
      return base + "endArrow=oval;endFill=0;";
    case "dashed-cross":
      return base + "dashed=1;endArrow=cross;";
    case "dashed-circle":
      return base + "dashed=1;endArrow=oval;endFill=0;";
    case "thick-cross":
      return base + "strokeWidth=3;endArrow=cross;";
    case "thick-circle":
      return base + "strokeWidth=3;endArrow=oval;endFill=0;";
    case "bidirectional":
      return base + "startArrow=classic;endArrow=classic;";
    case "thick-bidirectional":
      return base + "strokeWidth=3;startArrow=classic;endArrow=classic;";
    case "dashed-bidirectional":
      return base + "dashed=1;startArrow=classic;endArrow=classic;";
    case "cross-bidirectional":
      return base + "startArrow=cross;endArrow=cross;";
    case "circle-bidirectional":
      return base + "startArrow=oval;startFill=0;endArrow=oval;endFill=0;";
    case "normal":
    default:
      return base + "endArrow=classic;";
  }
}

/**
 * Layout the parsed model hierarchically and produce a drawio mxfile XML.
 *
 * The previous implementation laid out all nodes (across nested subgraphs) in
 * one big dagre compound graph and then tightened cluster bounds afterwards.
 * In real diagrams, dagre would often place siblings of the same subgraph on
 * opposite sides of the page (to minimize edge crossings against nodes in
 * OTHER subgraphs), causing the cluster to stretch across the whole canvas.
 *
 * The new approach lays out subgraphs RECURSIVELY (bottom-up):
 *   - For each leaf-most subgraph, run dagre on just its direct children.
 *     The result has a tight bounding box.
 *   - When laying out the next level up, the inner subgraph is treated as a
 *     single opaque fixed-size box (a regular dagre node). dagre then only
 *     sees the high-level structure and produces a sensible top-level layout.
 *   - This is repeated up to the virtual root level.
 *
 * Edges that span subgraph boundaries are "lifted" at each level to point to
 * the representative child of that level (the topmost containing
 * subgraph), so the layout engine still sees enough connectivity to place
 * things sensibly.
 *
 * @param {string} mermaidSource
 * @param {object} [opts]
 * @param {string} [opts.diagramName="Page-1"]
 * @returns {{xml:string, warnings:string[]}}
 */
export function flowchartToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseMermaidFlowchart(mermaidSource);

  // Map from id -> parent id (for both leaf nodes and subgraphs).
  const parentOf = new Map();
  for (const n of model.nodes.values()) parentOf.set(n.id, n.parent || null);
  for (const sg of model.subgraphs) parentOf.set(sg.id, sg.parent || null);

  // Index direct children per level (null = top level).
  const childNodesByLevel = new Map(); // levelId|null -> id[]
  const childSubgraphsByLevel = new Map();
  childNodesByLevel.set(null, []);
  childSubgraphsByLevel.set(null, []);
  for (const sg of model.subgraphs) {
    childNodesByLevel.set(sg.id, []);
    childSubgraphsByLevel.set(sg.id, []);
  }
  for (const n of model.nodes.values()) {
    const p = n.parent || null;
    childNodesByLevel.get(p)?.push(n.id);
  }
  for (const sg of model.subgraphs) {
    const p = sg.parent || null;
    childSubgraphsByLevel.get(p)?.push(sg.id);
  }

  // Walk up from `id` until reaching a direct child of `levelId`.
  // Returns null when `id` is not in `levelId`'s subtree.
  function findRepresentative(id, levelId) {
    let cur = id;
    // Guard against infinite loops with a depth cap.
    for (let i = 0; i < 1024; i++) {
      const p = parentOf.has(cur) ? parentOf.get(cur) : null;
      if (p === levelId) return cur;
      if (p == null) return levelId == null ? cur : null;
      cur = p;
    }
    return null;
  }

  // Recursively layout each level. Returns:
  //   { width, height, positions: { id -> {x, y, width, height} },
  //     children: { sgId -> recursive result } }
  // where positions are relative to (0,0) of this level's bbox.
  function layoutLevel(levelId) {
    const directNodes = childNodesByLevel.get(levelId) || [];
    const directSubgraphs = childSubgraphsByLevel.get(levelId) || [];

    // Bottom-up: layout direct child subgraphs first to get their sizes.
    const childResults = {};
    for (const sgId of directSubgraphs) {
      childResults[sgId] = layoutLevel(sgId);
    }

    const g = new dagre.graphlib.Graph({ multigraph: true });
    const isSubgraph = levelId != null;
    // Per-level rankdir: a subgraph can override the diagram direction via
    // its own `direction X` directive (mermaid v9+). Fall back to the
    // outer diagram's direction.
    const sg = isSubgraph
      ? model.subgraphs.find((s) => s.id === levelId)
      : null;
    const levelDir = (sg && sg.direction) || model.direction;
    g.setGraph({
      rankdir: dirToRankdir(levelDir),
      nodesep: 40,
      ranksep: 60,
      edgesep: 20,
      marginx: isSubgraph ? SG_PAD_X : 20,
      marginy: isSubgraph ? SG_PAD_Y : 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const nid of directNodes) {
      const node = model.nodes.get(nid);
      const { w, h } = estimateLabelSize(node.label);
      g.setNode(nid, { width: w, height: h });
    }
    for (const sgId of directSubgraphs) {
      const r = childResults[sgId];
      g.setNode(sgId, { width: r.width, height: r.height });
    }

    // Lift edges to this level. An edge from a deep node A to deep node B
    // is represented at this level as an edge between A's and B's nearest
    // ancestors that are direct children of this level.
    let edgeIdx = 0;
    for (const e of model.edges) {
      const a = findRepresentative(e.from, levelId);
      const b = findRepresentative(e.to, levelId);
      if (!a || !b || a === b) continue;
      if (!g.hasNode(a) || !g.hasNode(b)) continue;
      g.setEdge(a, b, {}, `e${edgeIdx++}`);
    }

    dagre.layout(g);

    const positions = {};
    for (const nid of directNodes) {
      const li = g.node(nid);
      positions[nid] = {
        x: li.x - li.width / 2,
        y: li.y - li.height / 2,
        width: li.width,
        height: li.height,
      };
    }
    for (const sgId of directSubgraphs) {
      const li = g.node(sgId);
      positions[sgId] = {
        x: li.x - li.width / 2,
        y: li.y - li.height / 2,
        width: li.width,
        height: li.height,
      };
    }

    const ga = g.graph();
    return {
      width: ga.width || 0,
      height: ga.height || 0,
      positions,
      children: childResults,
    };
  }

  const root = layoutLevel(null);

  // Emit cells in DFS pre-order so each container appears before its children
  // (drawio parses fine either way, but pre-order is more conventional).
  const cells = [];
  cells.push(`<mxCell id="0" />`);
  cells.push(`<mxCell id="1" parent="0" />`);

  function emitLevel(levelId, result) {
    const directNodes = childNodesByLevel.get(levelId) || [];
    const directSubgraphs = childSubgraphsByLevel.get(levelId) || [];
    const drawioParent = levelId || "1";

    for (const sgId of directSubgraphs) {
      const sg = model.subgraphs.find((s) => s.id === sgId);
      const pos = result.positions[sgId];
      const baseStyle =
        "rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;fontStyle=1;" +
        "fillColor=none;strokeColor=#999999;dashed=1;fontColor=#555555;";
      // Allow `style <subgraphId> fill:#... ,stroke:#...` to override the
      // default subgraph chrome (frame colour, dash, fill, text colour).
      const overlay = resolveNodeStyleOverlay({ id: sgId, classes: null }, model);
      const style = mergeStyle(baseStyle, overlay);
      cells.push(
        `<mxCell id="${escapeXml(sgId)}" value="${escapeXml(sg.label)}" style="${style}" vertex="1" parent="${escapeXml(drawioParent)}">` +
          `<mxGeometry x="${round(pos.x)}" y="${round(pos.y)}" width="${round(pos.width)}" height="${round(pos.height)}" as="geometry" />` +
          `</mxCell>`
      );
      // Recurse: children of this subgraph
      emitLevel(sgId, result.children[sgId]);
    }

    for (const nid of directNodes) {
      const node = model.nodes.get(nid);
      const pos = result.positions[nid];
      const overlay = resolveNodeStyleOverlay(node, model);
      const style = mergeStyle(shapeStyle(node.shape), overlay);
      const label = escapeXml(mermaidLabelToHtml(node.label));
      cells.push(
        `<mxCell id="${escapeXml(nid)}" value="${label}" style="${style}" vertex="1" parent="${escapeXml(drawioParent)}">` +
          `<mxGeometry x="${round(pos.x)}" y="${round(pos.y)}" width="${round(pos.width)}" height="${round(pos.height)}" as="geometry" />` +
          `</mxCell>`
      );
    }
  }

  emitLevel(null, root);

  // Edges (flat list, regardless of containment). Per-edge linkStyle entries
  // are keyed by encounter order in the Mermaid source — the index used here
  // matches `model.edges`'s order, which is what Mermaid documents.
  //
  // When the same pair (a→b or a↔b) appears more than once, we assign each
  // duplicate a different exit/entry anchor pair so drawio renders them as
  // distinguishable parallel lines instead of stacking them on top of each
  // other.
  const pairCounts = new Map(); // key "a||b" (undirected) -> total occurrences
  for (const e of model.edges) {
    if (e.from === e.to) continue;
    const key = e.from < e.to ? `${e.from}||${e.to}` : `${e.to}||${e.from}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  const pairSeen = new Map();
  let eId = 1;
  const defaultLink = cssPropsToDrawioStyle(model.linkStyles?.default);
  for (let i = 0; i < model.edges.length; i++) {
    const e = model.edges[i];
    if (!model.nodes.has(e.from) || !model.nodes.has(e.to)) continue;
    const perEdge = cssPropsToDrawioStyle(model.linkStyles?.[String(i)]);
    const overlay = { ...defaultLink, ...perEdge };
    let style = mergeStyle(edgeStyle(e.arrow), overlay);
    if (e.from === e.to) {
      style = mergeStyle(style, {
        exitX: "1",
        exitY: "0.25",
        exitDx: "0",
        exitDy: "0",
        entryX: "0.75",
        entryY: "0",
        entryDx: "0",
        entryDy: "0",
      });
    } else {
      const sortedLow = e.from < e.to ? e.from : e.to;
      const key = e.from < e.to ? `${e.from}||${e.to}` : `${e.to}||${e.from}`;
      const total = pairCounts.get(key) || 1;
      if (total > 1) {
        const seen = pairSeen.get(key) || 0;
        pairSeen.set(key, seen + 1);
        // If this edge goes "against" the canonical pair orientation
        // (sorted ascending) we flip exit/entry sides so reverse edges fan
        // out correctly along the layout direction instead of routing the
        // long way around.
        const reversed = e.from !== sortedLow;
        const overlayAnchor = parallelEdgeAnchors(
          model.direction,
          total,
          seen,
          reversed,
        );
        style = mergeStyle(style, overlayAnchor);
      }
    }
    const value = e.label ? escapeXml(mermaidLabelToHtml(e.label)) : "";
    cells.push(
      `<mxCell id="edge-${eId}" value="${value}" style="${style}" edge="1" parent="1" source="${escapeXml(e.from)}" target="${escapeXml(e.to)}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`
    );
    eId++;
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

function dirToRankdir(dir) {
  switch (dir) {
    case "LR":
      return "LR";
    case "RL":
      return "RL";
    case "BT":
      return "BT";
    case "TB":
    case "TD":
    default:
      return "TB";
  }
}

function round(n) {
  return Math.round(n);
}

/**
 * Compute distinct entry/exit anchor pairs for parallel edges between the
 * same pair of nodes. The anchors are distributed across the perpendicular
 * axis (relative to the diagram's layout direction) so multiple edges fan
 * out instead of stacking on top of each other.
 *
 * When `reversed` is true the source/target sides are swapped so reverse
 * edges (e.g. B→A in a left-to-right layout) exit from the upstream side
 * and enter the downstream side.
 *
 * @param {string} dir   Diagram direction ("TB"|"BT"|"LR"|"RL"|"TD")
 * @param {number} total Total number of parallel edges between the pair
 * @param {number} seen  Zero-based index of THIS edge among the pair (0..total-1)
 * @param {boolean} [reversed=false] Flip the anchor sides for reverse edges
 * @returns {Object<string,string>} Style overlay with exit{X,Y}/entry{X,Y}
 */
function parallelEdgeAnchors(dir, total, seen, reversed = false) {
  // Spread N anchors over (0.2 .. 0.8) so they stay clear of corners. With
  // N=1 the center (0.5) is used; with N=2 we get 0.33 / 0.67, etc.
  const t = (seen + 1) / (total + 1); // ∈ (0, 1)
  const v = 0.2 + 0.6 * t;
  const horizontal = dir === "LR" || dir === "RL";
  if (horizontal) {
    // Edges run left↔right. Offset along Y on both ends.
    const forwardExitX = dir === "LR" ? "1" : "0";
    const forwardEntryX = dir === "LR" ? "0" : "1";
    return {
      exitX: reversed ? forwardEntryX : forwardExitX,
      exitY: v.toFixed(3),
      entryX: reversed ? forwardExitX : forwardEntryX,
      entryY: v.toFixed(3),
      exitDx: "0",
      exitDy: "0",
      entryDx: "0",
      entryDy: "0",
    };
  }
  // Vertical diagrams (TB/BT): offset along X on both ends.
  const forwardExitY = dir === "BT" ? "0" : "1";
  const forwardEntryY = dir === "BT" ? "1" : "0";
  return {
    exitX: v.toFixed(3),
    exitY: reversed ? forwardEntryY : forwardExitY,
    entryX: v.toFixed(3),
    entryY: reversed ? forwardExitY : forwardEntryY,
    exitDx: "0",
    exitDy: "0",
    entryDx: "0",
    entryDy: "0",
  };
}

/**
 * Translate light-weight markdown emphasis used in Mermaid labels into the
 * HTML drawio expects when `html=1` is set on the cell.
 *
 *   - `**bold**`   / `__bold__`   → <b>...</b>
 *   - `*italic*`   / `_italic_`   → <i>...</i>
 *   - `` `code` ``                → <code>...</code>
 *
 * Single-delimiter italic only fires when the markers sit on a non-word
 * boundary so identifiers and arithmetic expressions stay intact:
 *
 *   `user_id_field`  → unchanged  (markers are surrounded by word chars)
 *   `1*2*3`          → unchanged
 *   `*important*`    → <i>important</i>
 *   `(read _this_ carefully)` → `(read <i>this</i> carefully)`
 *
 * Bold is processed before italic so `**foo**` isn't half-eaten by the
 * italic rule. Pre-existing HTML (e.g. `<br>`) is preserved.
 *
 * @param {string} s
 * @returns {string}
 */
function mermaidLabelToHtml(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>");
  out = out.replace(/__([^_\n]+?)__/g, "<b>$1</b>");
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Single `*` italic: require the delimiters to be on a non-word boundary
  // so common patterns like `1*2*3` or glob `*.txt` don't accidentally match.
  out = out.replace(
    /(^|[^A-Za-z0-9_*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![A-Za-z0-9_*])/g,
    "$1<i>$2</i>",
  );
  // Single `_` italic: same non-word-boundary requirement. This protects
  // snake_case identifiers, file names like `date_2024_v2`, etc.
  out = out.replace(
    /(^|[^A-Za-z0-9_])_(?!\s)([^_\n]+?)(?<!\s)_(?![A-Za-z0-9_])/g,
    "$1<i>$2</i>",
  );
  return out;
}
