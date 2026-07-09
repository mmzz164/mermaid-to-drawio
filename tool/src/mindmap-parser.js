/**
 * Minimal Mermaid mindmap parser.
 *
 * Indentation defines the hierarchy (tabs count as 4 spaces). Node shapes:
 *   text            default
 *   [text]          square
 *   (text)          rounded
 *   ((text))        circle
 *   )text(          cloud
 *   ))text((        bang
 *   {{text}}        hexagon
 * An optional leading id (`id[text]`) is accepted and discarded — draw.io
 * cells get generated ids. `::icon(...)` and `:::class` lines are skipped
 * silently.
 */

/**
 * @param {string} source
 * @returns {{
 *   root: {text:string, shape:string, children:Array}|null,
 *   warnings: string[],
 * }}
 */
export function parseMindmap(source) {
  const lines = source.split(/\r?\n/);
  const warnings = [];
  let root = null;
  // Stack of { indent, node } from root to the most recent node.
  const stack = [];
  let started = false;
  let inFrontMatter = false;
  let lineNo = 0;

  for (const raw of lines) {
    lineNo++;
    const noComment = raw.replace(/%%.*$/, "");
    const content = noComment.trim();
    if (!content) continue;
    if (!started && content === "---") {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;
    if (!started) {
      if (/^mindmap\b/i.test(content)) started = true;
      continue;
    }
    // Icon / class decorations attach to the previous node; not rendered.
    if (content.startsWith("::")) continue;

    const indentStr = noComment.match(/^[ \t]*/)[0];
    const indent = indentStr.replace(/\t/g, "    ").length;
    const node = parseNode(content);

    if (!root) {
      root = node;
      stack.length = 0;
      stack.push({ indent, node });
      continue;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      // A second top-level node: Mermaid rejects this; keep going by
      // attaching it under the existing root.
      warnings.push(`Line ${lineNo}: multiple root nodes; '${node.text}' attached under '${root.text}'`);
      root.children.push(node);
      stack.push({ indent: -1, node: root });
      stack.push({ indent, node });
      continue;
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }

  if (!root) warnings.push("mindmap has no nodes");
  return { root, warnings };
}

// The optional node id before the shape brackets can be any run of
// non-bracket, non-space characters (CJK ids are legal in Mermaid).
const ID = "(?:[^\\s()[\\]{}]+)?";
const SHAPE_PATTERNS = [
  // Double-delimiter forms must be tried before their single-char cousins.
  { shape: "circle", re: new RegExp(`^${ID}\\(\\((.+)\\)\\)$`) },
  { shape: "bang", re: new RegExp(`^${ID}\\)\\)(.+)\\(\\($`) },
  { shape: "cloud", re: new RegExp(`^${ID}\\)(.+)\\($`) },
  { shape: "hexagon", re: new RegExp(`^${ID}\\{\\{(.+)\\}\\}$`) },
  { shape: "square", re: new RegExp(`^${ID}\\[(.+)\\]$`) },
  { shape: "rounded", re: new RegExp(`^${ID}\\((.+)\\)$`) },
];

function parseNode(content) {
  for (const { shape, re } of SHAPE_PATTERNS) {
    const m = content.match(re);
    if (m) return { text: unquote(m[1].trim()), shape, children: [] };
  }
  return { text: unquote(content), shape: "default", children: [] };
}

function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}
