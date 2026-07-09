/**
 * Minimal Mermaid flowchart parser.
 *
 * Supported subset:
 *   - `flowchart <DIR>` / `graph <DIR>`  (DIR in TB|TD|BT|LR|RL)
 *   - Subgraphs:
 *       subgraph Id["Display Name"]
 *           ...
 *       end
 *     (display name optional; falls back to Id)
 *   - Nodes (shape inferred from delimiters):
 *       A             -> rectangle (auto, label = "A")
 *       A[Label]      -> rectangle
 *       A(Label)      -> rounded rectangle
 *       A((Label))    -> ellipse
 *       A{Label}      -> rhombus
 *       A>Label]      -> rectangle (flag) – mapped to rectangle
 *       A([Label])    -> stadium     – mapped to rounded rectangle
 *       A[[Label]]    -> rectangle   – mapped to rectangle (subroutine)
 *       A[/Label/]    -> parallelogram (mapped to rectangle)
 *   - Edges:
 *       A --> B
 *       A --- B          (no arrow)
 *       A -.-> B         (dashed)
 *       A ==> B          (thick)
 *       A -- text --> B
 *       A -->|text| B
 *
 * Anything we don't understand is recorded in `warnings` and skipped.
 */

const DIRECTIONS = new Set(["TB", "TD", "BT", "LR", "RL"]);

const NODE_SHAPE_PATTERNS = [
  // Order matters: try longest/most specific first.
  { re: /^\[\[(.+)\]\]$/, shape: "rectangle" },     // [[label]]
  { re: /^\[\((.+)\)\]$/, shape: "cylinder" },      // [(label)]
  { re: /^\(\((.+)\)\)$/, shape: "ellipse" },       // ((label))
  { re: /^\(\[(.+)\]\)$/, shape: "stadium" },       // ([label])
  { re: /^\[\/(.+)\/\]$/, shape: "parallelogram" }, // [/label/]
  { re: /^\[\\(.+)\\\]$/, shape: "parallelogram" }, // [\label\]
  { re: /^\{\{(.+)\}\}$/, shape: "hexagon" },       // {{label}}
  { re: /^\[(.+)\]$/, shape: "rectangle" },          // [label]
  { re: /^\((.+)\)$/, shape: "rounded" },            // (label)
  { re: /^\{(.+)\}$/, shape: "rhombus" },            // {label}
  { re: /^>(.+)\]$/, shape: "rectangle" },           // >label]
];

// Allow dot in node identifiers, e.g. `pkg.Module` or `svc.api.v1`.
const ID_RE = "[A-Za-z_][A-Za-z0-9_\\-\\.]*";

/**
 * Tokenize a single non-empty, non-comment line into useful chunks.
 * We don't tokenize per-character; we work line-by-line and parse with
 * regexes since the supported subset is small.
 */
function stripComments(line) {
  return line.replace(/%%.*$/, "").trimEnd();
}

function unquoteLabel(s) {
  if (!s) return s;
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function inferShape(rawAfterId) {
  if (!rawAfterId) return { shape: "rectangle", label: null };
  for (const { re, shape } of NODE_SHAPE_PATTERNS) {
    const m = rawAfterId.match(re);
    if (m) return { shape, label: unquoteLabel(m[1]) };
  }
  return { shape: "rectangle", label: unquoteLabel(rawAfterId) };
}

/**
 * Mermaid v10 expanded shape name → internal shape key.
 *
 * Mermaid's v10 attribute form (`A@{ shape: cyl, label: "DB" }`) supports a
 * large vocabulary of named shapes. We map the common ones to the closest
 * shape this renderer can draw natively; the rest fall back to `rectangle`.
 * Updated 2026 with mermaid's published shape list.
 */
const V10_SHAPE_MAP = {
  rect: "rectangle",
  rectangle: "rectangle",
  rounded: "rounded",
  "rounded-rect": "rounded",
  stadium: "stadium",
  pill: "stadium",
  circle: "ellipse",
  circ: "ellipse",
  ellipse: "ellipse",
  diam: "rhombus",
  diamond: "rhombus",
  rhombus: "rhombus",
  hex: "hexagon",
  hexagon: "hexagon",
  cyl: "cylinder",
  cylinder: "cylinder",
  db: "cylinder",
  database: "cylinder",
  disk: "cylinder",
  subproc: "rectangle",
  subroutine: "rectangle",
  fr_rect: "rectangle",
  framed_rectangle: "rectangle",
  trap: "parallelogram",
  trapezoid: "parallelogram",
  para: "parallelogram",
  parallelogram: "parallelogram",
  "lean-r": "parallelogram",
  "lean-l": "parallelogram",
};

/**
 * Parse a single node spec like `A[Label]`, `A`, `A((B))`, or the mermaid
 * v10 form `A@{ shape: cyl, label: "DB" }`.
 * Returns the parsed node info AND the remainder of the string after it.
 * @param {string} s
 */
function consumeNode(s) {
  const idMatch = s.match(new RegExp(`^(${ID_RE})`));
  if (!idMatch) return null;
  const id = idMatch[1];
  let rest = s.slice(id.length);

  // mermaid v10 attribute form: `A@{ shape: cyl, label: "DB" }`.
  // We accept whitespace around `@` to be lenient and parse the body with
  // a quote-aware brace matcher so that labels containing `}` or `,` don't
  // truncate the attribute block prematurely.
  const v10Start = rest.match(/^\s*@\s*\{/);
  let matched = null;
  let v10Shape = null;
  let v10Label = null;
  let v10 = null;
  if (v10Start) {
    const open = v10Start[0];
    const braceStart = open.indexOf("{");
    const afterOpen = rest.slice(open.length);
    // We've already consumed the opening `{`; find the matching close in
    // the substring that follows. findMatchingClose expects the OPEN to be
    // included at index 0, so prepend `{` here.
    const closeRel = findMatchingClose(`{${afterOpen}`, "{", "}");
    if (closeRel > 0) {
      const innerLen = closeRel - 1; // subtract the synthetic leading `{`
      const body = afterOpen.slice(0, innerLen);
      v10 = true;
      for (const kv of splitTopLevel(body, ",")) {
        const m = kv.match(/^\s*([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.+?)\s*$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = unquoteLabel(m[2].trim());
        if (key === "shape") v10Shape = V10_SHAPE_MAP[val.toLowerCase()] || "rectangle";
        else if (key === "label") v10Label = val;
        else if (key === "icon" || key === "form" || key === "img") {
          // Recognized keys we don't render; tolerated.
        }
      }
      rest = afterOpen.slice(innerLen + 1); // skip body + closing `}`
    }
  }
  if (!v10) {
    // Try matching balanced shape brackets following the id
    // We try patterns; the trick is matching balanced delimiters.
    const openings = ["[[", "[(", "((", "([", "[/", "[\\", "{{", "[", "(", "{", ">"];
    for (const open of openings) {
      if (rest.startsWith(open)) {
        const close = matchingClose(open);
        // find close at the END logic: find the right close for this open.
        // For simplicity, we scan for the corresponding closing token.
        const closeIdx = findMatchingClose(rest, open, close);
        if (closeIdx >= 0) {
          const raw = rest.slice(0, closeIdx + close.length);
          matched = raw;
          rest = rest.slice(closeIdx + close.length);
          break;
        }
      }
    }
  }
  const inferred = v10 ? { shape: v10Shape || "rectangle", label: v10Label } : inferShape(matched);
  const { shape, label } = inferred;

  // Optional class-assignment suffix `:::ClassName[,Other]`. We record the
  // class list on the node so the renderer can apply matching `classDef`
  // styles.
  let classes = null;
  const classMatch = rest.match(
    /^:::([A-Za-z_][A-Za-z0-9_\-]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_\-]*)*)/
  );
  if (classMatch) {
    classes = classMatch[1].split(/\s*,\s*/).filter(Boolean);
    rest = rest.slice(classMatch[0].length);
  }

  return {
    node: { id, label: label ?? id, shape, classes },
    rest,
  };
}

function matchingClose(open) {
  switch (open) {
    case "[[": return "]]";
    case "[(": return ")]";
    case "((": return "))";
    case "([": return "])";
    case "[/": return "/]";
    case "[\\": return "\\]";
    case "{{": return "}}";
    case "[": return "]";
    case "(": return ")";
    case "{": return "}";
    case ">": return "]";
    default: return "";
  }
}

function findMatchingClose(s, open, close) {
  // Skip past the opening token
  let i = open.length;
  let depth = 1;
  while (i < s.length) {
    if (s.startsWith(close, i)) {
      depth--;
      if (depth === 0) return i;
      i += close.length;
      continue;
    }
    if (s.startsWith(open, i)) {
      depth++;
      i += open.length;
      continue;
    }
    // Handle quoted strings to avoid false matches.
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Parse a single edge clause like:
 *   --> | --- | -.-> | ==> | -- text --> | -->|text|
 * Returns { arrow: 'normal'|'none'|'dashed'|'thick', label: string|null, length: number }
 * and the remainder of the string after the edge token.
 */
function consumeEdge(s) {
  // Try edge styles in order. After the edge, optionally there's a "|label|".
  // Mermaid edges (supported here):
  //  A --- B            (no arrow)
  //  A --> B            (normal arrow; any length of dashes)
  //  A -.-> B           (dashed)
  //  A -.- B            (dashed no arrow)
  //  A ==> B            (thick)
  //  A === B            (thick no arrow)
  //  A -- text --> B    (label between two segments)
  //  A -.text.-> B      (dashed with inline label)
  //  A ==text==> B      (thick with inline label)
  //  A -->|text| B      (label after edge)
  //
  // Labels may contain hyphens or any characters except '|' and the trailing
  // closing arrow token.
  let arrow = null;
  let label = null;
  let matchLen = 0;

  // 0) Bidirectional bare edges first (e.g., <-->, <===>, <-.->, x--x, o--o).
  // Try before single-direction patterns so the shorter `-->` doesn't win.
  const bidi = s.match(
    /^\s*(<-{2,}>|<={2,}>|<-\.+->|x-{2,}x|o-{2,}o)/
  );
  if (bidi) {
    arrow = arrowKindForBidi(bidi[1]);
    matchLen = bidi[0].length;
    let rest = s.slice(matchLen);
    const pipe = rest.match(/^\|([^|]+)\|\s*/);
    if (pipe) {
      label = unquoteLabel(pipe[1].trim());
      rest = rest.slice(pipe[0].length);
    }
    return { edge: { arrow, label }, rest };
  }

  // 1) Dashed/solid/thick edges with inline label: -- text -->, -. text .->, == text ==>
  //
  // Whitespace between head/label and label/tail is REQUIRED. Otherwise
  // `--------> ` would be parsed as head=`--`, label=`-`, tail=`---` (eating
  // 8 dashes total and dropping the right-hand node). Long bare arrows
  // (`--->`, `------->`) must fall through to the bare matcher below.
  const inline = s.match(
    /^\s*(--|-\.|==)\s+([^|>]+?)\s+(-->|--x|--o|---|\.->|\.-x|\.-o|\.-|==>|==x|==o|===)/
  );
  if (inline) {
    const head = inline[1];
    const tail = inline[3];
    label = unquoteLabel(inline[2].trim());
    arrow = arrowKindFor(head, tail);
    matchLen = inline[0].length;
  } else {
    // 2) Bare edges without inline label: -->, --->, ---->, -.->, ==>, ===, --x, --o, ~~~ ...
    const bare = s.match(/^\s*(-{2,}>|-{2,}x|-{2,}o|-{2,}|-\.+->|-\.+-x|-\.+-o|-\.+-|={2,}>|={2,}x|={2,}o|={2,}|~{3,})/);
    if (!bare) return null;
    arrow = arrowKindForBare(bare[1]);
    matchLen = bare[0].length;
  }

  let rest = s.slice(matchLen);
  // Optional pipe-label after the edge: |text|
  const pipe = rest.match(/^\|([^|]+)\|\s*/);
  if (pipe) {
    label = unquoteLabel(pipe[1].trim());
    rest = rest.slice(pipe[0].length);
  }
  return { edge: { arrow, label }, rest };
}

function arrowKindFor(head, tail) {
  // head: '--' (solid), '-.' (dashed), '==' (thick)
  // tail: '-->','---','--x','--o',  '.->','.-','.-x','.-o',  '==>','===','==x','==o'
  const solid = head === "--";
  const dashed = head === "-.";
  const thick = head === "==";
  if (tail === "-->" || tail === ".->" || tail === "==>") {
    if (thick) return "thick";
    if (dashed) return "dashed";
    return "normal";
  }
  if (tail === "---" || tail === ".-" || tail === "===") {
    if (thick) return "thick-none";
    if (dashed) return "dashed-none";
    return "none";
  }
  if (tail.endsWith("x")) return solid ? "cross" : dashed ? "dashed-cross" : "thick-cross";
  if (tail.endsWith("o")) return solid ? "circle" : dashed ? "dashed-circle" : "thick-circle";
  return "normal";
}

function arrowKindForBidi(tok) {
  if (/^<-{2,}>$/.test(tok)) return "bidirectional";
  if (/^<={2,}>$/.test(tok)) return "thick-bidirectional";
  if (/^<-\.+->$/.test(tok)) return "dashed-bidirectional";
  if (/^x-{2,}x$/.test(tok)) return "cross-bidirectional";
  if (/^o-{2,}o$/.test(tok)) return "circle-bidirectional";
  return "bidirectional";
}

function arrowKindForBare(tok) {
  if (/^-{2,}>$/.test(tok)) return "normal";
  if (/^-{2,}$/.test(tok)) return "none";
  if (/^-{2,}x$/.test(tok)) return "cross";
  if (/^-{2,}o$/.test(tok)) return "circle";
  if (/^-\.+->$/.test(tok)) return "dashed";
  if (/^-\.+-$/.test(tok)) return "dashed-none";
  if (/^-\.+-x$/.test(tok)) return "dashed-cross";
  if (/^-\.+-o$/.test(tok)) return "dashed-circle";
  if (/^={2,}>$/.test(tok)) return "thick";
  if (/^={2,}$/.test(tok)) return "thick-none";
  if (/^={2,}x$/.test(tok)) return "thick-cross";
  if (/^={2,}o$/.test(tok)) return "thick-circle";
  if (/^~{3,}$/.test(tok)) return "invisible";
  return "normal";
}

/**
 * Parse mermaid flowchart source into an internal model.
 * @param {string} source
 * @returns {{
 *   direction: string,
 *   nodes: Map<string, {id:string,label:string,shape:string,parent:string|null}>,
 *   edges: Array<{from:string,to:string,arrow:string,label:string|null}>,
 *   subgraphs: Array<{id:string,label:string,parent:string|null,children:string[]}>,
 *   warnings: string[],
 * }}
 */
export function parseMermaidFlowchart(source) {
  const lines = source.split(/\r?\n/);
  let direction = "TB";
  const nodes = new Map();
  const edges = [];
  const subgraphs = [];
  const subgraphStack = [];
  const warnings = [];
  // Styling state. `classDefs` maps a class name to a CSS-like prop bag;
  // `styles` maps a nodeId to its inline style bag; `linkStyles` maps an
  // edge index (in encounter order) — or the string "default" — to a bag.
  /** @type {Object.<string, Object>} */
  const classDefs = {};
  /** @type {Object.<string, Object>} */
  const styles = {};
  /** @type {Object.<string, Object>} */
  const linkStyles = {};

  // Find the header line
  let started = false;
  let lineNo = 0;
  for (const rawLine of lines) {
    lineNo++;
    const line = stripComments(rawLine).trim();
    if (!line) continue;

    if (!started) {
      const m = line.match(/^(flowchart|graph)\s+([A-Z]{2})\s*$/i);
      if (m) {
        const dir = m[2].toUpperCase();
        if (DIRECTIONS.has(dir)) direction = dir;
        else warnings.push(`Unknown direction: ${dir}, defaulting to TB`);
        started = true;
        continue;
      }
      // Skip non-flowchart prelude (e.g., %%{init: ...}%% directives)
      continue;
    }

    if (line === "end") {
      if (subgraphStack.length === 0) {
        warnings.push(`Line ${lineNo}: unexpected 'end'`);
      } else {
        subgraphStack.pop();
      }
      continue;
    }

    const sgMatch = line.match(
      new RegExp(`^subgraph\\s+(${ID_RE})\\s*(?:\\[(.+)\\])?\\s*$`)
    );
    if (sgMatch) {
      const id = sgMatch[1];
      const labelRaw = sgMatch[2];
      const label = labelRaw ? unquoteLabel(labelRaw) : id;
      const parent =
        subgraphStack.length > 0
          ? subgraphStack[subgraphStack.length - 1]
          : null;
      const sg = { id, label, parent, children: [], direction: null };
      subgraphs.push(sg);
      subgraphStack.push(id);
      continue;
    }

    // `direction X` directive: sets the layout direction for the enclosing
    // subgraph (mermaid v9+). When at the top level it overrides the diagram's
    // direction.
    const dirMatch = line.match(/^direction\s+([A-Z]{2})\s*$/i);
    if (dirMatch) {
      const dir = dirMatch[1].toUpperCase();
      if (!DIRECTIONS.has(dir)) {
        warnings.push(`Line ${lineNo}: unknown direction "${dir}"`);
      } else if (subgraphStack.length > 0) {
        const topId = subgraphStack[subgraphStack.length - 1];
        const sg = subgraphs.find((s) => s.id === topId);
        if (sg) sg.direction = dir;
      } else {
        direction = dir;
      }
      continue;
    }

    // Styling directives. We record them in the model so the renderer can
    // translate Mermaid CSS-style properties into drawio styles.
    //   style A fill:#f00,stroke:#000,color:#fff
    //   classDef Foo fill:#f00,stroke:#000
    //   class A,B Foo
    //   linkStyle 0,2 stroke:#f00,stroke-width:2px
    //   linkStyle default stroke:#ccc
    //   click A "https://example.com"     ← still ignored, not visual
    // `style ID prop:val,...` — the body MUST start with `key:value` so that
    // ordinary lines whose first token happens to be a literal `style` (used
    // as a node id) are not silently swallowed.
    const styleMatch = line.match(
      /^style\s+([A-Za-z_][A-Za-z0-9_\-.]*)\s+([A-Za-z\-]+\s*:\s*.+)$/i,
    );
    if (styleMatch) {
      styles[styleMatch[1]] = parseCssProps(styleMatch[2]);
      continue;
    }
    const classDefMatch = line.match(
      /^classDef\s+([A-Za-z_][A-Za-z0-9_\-,\s]*)\s+([A-Za-z\-]+\s*:\s*.+)$/i,
    );
    if (classDefMatch) {
      const names = classDefMatch[1].split(",");
      const props = parseCssProps(classDefMatch[2]);
      for (const n of names) classDefs[n.trim()] = props;
      continue;
    }
    // `class A,B,C ClassName` — targets and class names must both be valid
    // identifiers separated by commas. Disallows arrow tokens so that real
    // graph statements aren't mistaken for class assignments.
    const classApplyMatch = line.match(
      /^class\s+([A-Za-z_][A-Za-z0-9_\-.]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_\-.]*)*)\s+([A-Za-z_][A-Za-z0-9_\-]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_\-]*)*)\s*$/i,
    );
    if (classApplyMatch) {
      const targets = classApplyMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      const cls = classApplyMatch[2].split(",").map((s) => s.trim()).filter(Boolean);
      for (const t of targets) {
        if (!styles[t]) styles[t] = {};
        styles[t]._classes = (styles[t]._classes || []).concat(cls);
      }
      continue;
    }
    const linkStyleMatch = line.match(
      /^linkStyle\s+(default|\d+(?:\s*,\s*\d+)*)\s+([A-Za-z\-]+\s*:\s*.+)$/i,
    );
    if (linkStyleMatch) {
      const props = parseCssProps(linkStyleMatch[2]);
      const which = linkStyleMatch[1].trim();
      if (which.toLowerCase() === "default") {
        linkStyles.default = props;
      } else {
        for (const w of which.split(",")) {
          const idx = parseInt(w.trim(), 10);
          if (!Number.isNaN(idx)) linkStyles[String(idx)] = props;
        }
      }
      continue;
    }
    if (/^click\b/.test(line)) {
      // `click` only attaches hyperlinks / callbacks; ignore silently.
      continue;
    }

    // Otherwise: parse one or more node-edge-node clauses on this line.
    const parentSg =
      subgraphStack.length > 0
        ? subgraphStack[subgraphStack.length - 1]
        : null;
    if (!parseStatement(line, parentSg, nodes, edges, subgraphs, warnings, lineNo)) {
      warnings.push(`Line ${lineNo}: could not parse: ${line}`);
    }
  }

  // Attach parents to subgraph nodes (subgraphs that contain subgraphs)
  return { direction, nodes, edges, subgraphs, warnings, classDefs, styles, linkStyles };
}

/**
 * Parse a CSS-style key/value list as used by Mermaid:
 *   "fill:#f00, stroke: #000, stroke-width:2px"
 * @param {string} s
 * @returns {Object<string,string>}
 */
function parseCssProps(s) {
  const out = {};
  for (const part of s.split(/\s*,\s*/)) {
    if (!part) continue;
    const m = part.match(/^([A-Za-z\-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

function parseStatement(line, parentSg, nodes, edges, subgraphs, warnings, lineNo) {
  // A line may contain multiple ;-separated statements. Split into chunks
  // and parse each independently. (`;` inside a label is shielded by the
  // brackets that consumeNode matches, so we can split at top level.)
  const chunks = splitTopLevel(line.trim(), ";");
  let ok = true;
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    if (!parseSingleStatement(chunk, parentSg, nodes, edges, subgraphs, warnings, lineNo)) {
      ok = false;
    }
  }
  return ok;
}

function parseSingleStatement(line, parentSg, nodes, edges, subgraphs, warnings, lineNo) {
  // A single statement is: nodeGroup (edge nodeGroup)*
  // where nodeGroup is: node ("&" node)*
  // Edges between groups create a cross product (A & B --> C & D ⇒ 4 edges).
  let s = line.trim();
  if (!s) return true;

  const first = consumeNodeGroup(s);
  if (!first) return false;
  for (const n of first.nodes) registerNode(n, parentSg, nodes, subgraphs);
  let prevIds = first.nodes.map((n) => n.id);
  s = first.rest.trim();

  while (s.length > 0) {
    const edge = consumeEdge(s);
    if (!edge) {
      warnings.push(`Line ${lineNo}: trailing junk after node: "${s}"`);
      return false;
    }
    s = edge.rest.trim();
    const next = consumeNodeGroup(s);
    if (!next) {
      warnings.push(`Line ${lineNo}: expected node after edge`);
      return false;
    }
    for (const n of next.nodes) registerNode(n, parentSg, nodes, subgraphs);
    for (const from of prevIds) {
      for (const to of next.nodes) {
        edges.push({
          from,
          to: to.id,
          arrow: edge.edge.arrow,
          label: edge.edge.label,
        });
      }
    }
    prevIds = next.nodes.map((n) => n.id);
    s = next.rest.trim();
  }
  return true;
}

/**
 * Consume `node ("&" node)*` from the start of `s`.
 */
function consumeNodeGroup(s) {
  const first = consumeNode(s);
  if (!first) return null;
  const nodes = [first.node];
  let rest = first.rest;
  while (true) {
    const m = rest.match(/^\s*&\s*/);
    if (!m) break;
    const after = rest.slice(m[0].length);
    const more = consumeNode(after);
    if (!more) break;
    nodes.push(more.node);
    rest = more.rest;
  }
  return { nodes, rest };
}

/**
 * Split a string on `sep` at "top level" — outside any of the bracket pairs
 * Mermaid uses for node labels and outside quoted strings. We don't need to
 * be perfect here (no nesting depth), just to keep `;` inside `A[Hello; world]`
 * from splitting the line.
 */
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let inQuote = null;
  let start = 0;
  const openers = "([{";
  const closers = ")]}";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (openers.includes(ch)) depth++;
    else if (closers.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function registerNode(node, parentSg, nodes, subgraphs) {
  const existing = nodes.get(node.id);
  if (existing) {
    // Update label/shape only if the new one is non-default (has explicit shape).
    if (node.label && node.label !== node.id) {
      existing.label = node.label;
    }
    if (node.shape && node.shape !== "rectangle") {
      existing.shape = node.shape;
    }
    if (node.classes && node.classes.length) {
      existing.classes = (existing.classes || []).concat(node.classes);
    }
    if (parentSg && !existing.parent) {
      existing.parent = parentSg;
      const sg = subgraphs.find((s) => s.id === parentSg);
      if (sg) sg.children.push(node.id);
    }
    return;
  }
  const stored = {
    id: node.id,
    label: node.label,
    shape: node.shape,
    parent: parentSg,
    classes: node.classes || null,
  };
  nodes.set(node.id, stored);
  if (parentSg) {
    const sg = subgraphs.find((s) => s.id === parentSg);
    if (sg) sg.children.push(node.id);
  }
}
