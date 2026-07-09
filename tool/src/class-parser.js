/**
 * Minimal Mermaid classDiagram parser.
 *
 * Supported subset:
 *   - `classDiagram` header (with or without `-v2`)
 *   - Class declaration:
 *       class Animal
 *       class Animal { ... }
 *       class Map~K, V~ { ... }        (generics, kept as part of label)
 *   - Members (inside braces or via `Animal : member`):
 *       +String name           (attribute)
 *       -int age
 *       #protected
 *       ~package
 *       +makeSound() void      (method, detected by trailing parens)
 *       +makeSound(String s) void
 *       <<abstract>>           (stereotype/annotation)
 *       <<interface>>
 *   - Relations:
 *       Animal <|-- Dog                 inheritance
 *       Animal "1" *-- "many" Leg       composition
 *       Animal o-- Tail                 aggregation
 *       Animal --> Owner                association (arrow)
 *       Animal -- Cage                  association (no arrow)
 *       Animal ..> Logger               dependency (dashed arrow)
 *       Animal ..|> Comparable          realization (dashed, hollow triangle)
 *       Animal .. Whatever              link, dashed, no arrow
 *
 *     Optional trailing label: `: builds`
 *     Cardinality strings on either side are kept on the edge.
 *
 *   - Notes:
 *       note "global note"
 *       note for ClassName "scoped note"
 *
 *   - `direction LR/TB/...`
 *
 * Anything else is recorded in `warnings` and skipped.
 */

const DIRECTIONS = new Set(["TB", "TD", "BT", "LR", "RL"]);

// Allow generics `Foo~T~`, plus the usual ID characters.
const CLASS_ID_RE = "[A-Za-z_][A-Za-z0-9_\\-\\.]*(?:~[^~]+~)?";

const RELATION_TOKEN_RE = /(<\|--|--\|>|\*--|--\*|o--|--o|<--|-->|--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|\.\.|-->)/;

function stripComments(line) {
  return line.replace(/%%.*$/, "").trimEnd();
}

function unquote(s) {
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

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let q = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/**
 * Classify a member line as attribute, method, or stereotype.
 *   `+name: String`       → attribute (visibility +, name name, type String)
 *   `+doSomething() void` → method
 *   `<<interface>>`       → stereotype
 *
 * @param {string} raw
 * @returns {{kind:"attribute"|"method"|"stereotype", text:string, stereotype?:string}|null}
 */
function classifyMember(raw) {
  const s = raw.trim();
  if (!s) return null;
  const stereo = s.match(/^<<\s*([A-Za-z0-9_\-]+)\s*>>$/);
  if (stereo) return { kind: "stereotype", text: s, stereotype: stereo[1].toLowerCase() };
  // Methods have a `(` somewhere
  if (/\(.*\)/.test(s)) return { kind: "method", text: s };
  return { kind: "attribute", text: s };
}

/**
 * @param {string} source
 * @returns {{
 *   direction: string,
 *   classes: Map<string, {id:string,label:string,stereotype:string|null,attributes:string[],methods:string[]}>,
 *   relations: Array<{from:string,to:string,kind:string,fromCard:string|null,toCard:string|null,label:string|null,dashed:boolean,startArrow:string,endArrow:string}>,
 *   notes: Array<{target:string|null,text:string}>,
 *   warnings: string[],
 * }}
 */
export function parseClassDiagram(source) {
  const lines = source.split(/\r?\n/);
  const classes = new Map();
  const relations = [];
  const notes = [];
  const warnings = [];
  let direction = "TB";

  function ensureClass(id, label = null) {
    const key = id;
    if (!classes.has(key)) {
      classes.set(key, {
        id: key,
        label: label || id,
        stereotype: null,
        attributes: [],
        methods: [],
      });
    } else if (label) {
      const c = classes.get(key);
      if (c.label === c.id) c.label = label;
    }
    return key;
  }

  function addMember(classId, raw) {
    const c = classifyMember(raw);
    if (!c) return;
    const cls = classes.get(classId) || ensureClass(classId) && classes.get(classId);
    if (c.kind === "stereotype") {
      cls.stereotype = c.stereotype;
    } else if (c.kind === "method") {
      cls.methods.push(c.text);
    } else {
      cls.attributes.push(c.text);
    }
  }

  let started = false;
  let lineNo = 0;
  // Composite class body collection: `class Foo {` opens a block, then each
  // subsequent line is a member until `}` is encountered.
  let bodyOf = null;

  for (const raw of lines) {
    lineNo++;
    const line = stripComments(raw).trim();
    if (!line) continue;

    if (!started) {
      if (/^classDiagram(-v2)?\b/i.test(line)) {
        started = true;
        continue;
      }
      continue;
    }

    if (bodyOf) {
      if (line === "}") {
        bodyOf = null;
        continue;
      }
      addMember(bodyOf, line);
      continue;
    }

    const dirMatch = line.match(/^direction\s+([A-Z]{2})\s*$/i);
    if (dirMatch) {
      const d = dirMatch[1].toUpperCase();
      if (DIRECTIONS.has(d)) direction = d;
      else warnings.push(`Line ${lineNo}: unknown direction "${d}"`);
      continue;
    }

    // `class Foo`, `class Foo { ... }` (single line), `class Foo~T~ { ... }`
    const classOpen = line.match(new RegExp(`^class\\s+(${CLASS_ID_RE})\\s*(?:\\{(.*)\\}?)?$`));
    if (classOpen) {
      const id = classOpen[1];
      ensureClass(id);
      if (classOpen[2] !== undefined) {
        // Inline body — may contain `;`-separated members
        const body = classOpen[2].trim();
        if (line.endsWith("{")) {
          bodyOf = id;
        } else if (body.endsWith("}")) {
          for (const m of splitTopLevel(body.slice(0, -1), ";")) {
            const t = m.trim();
            if (t) addMember(id, t);
          }
        } else {
          // Opening brace only; consume subsequent lines.
          if (line.endsWith("{")) bodyOf = id;
        }
      }
      // Detect `{` on its own at end of line (no inline body)
      if (line.endsWith("{") && !bodyOf) bodyOf = id;
      continue;
    }

    // Class member assignment via colon: `Foo : +String name`
    const colon = line.match(new RegExp(`^(${CLASS_ID_RE})\\s*:\\s*(.+)$`));
    if (colon && !/^note\b/i.test(line)) {
      const cid = colon[1];
      ensureClass(cid);
      addMember(cid, colon[2].trim());
      continue;
    }

    // Notes: `note "..."` or `note for ClassName "..."`
    const noteFor = line.match(new RegExp(`^note\\s+for\\s+(${CLASS_ID_RE})\\s+"([^"]+)"$`, "i"));
    if (noteFor) {
      notes.push({ target: noteFor[1], text: noteFor[2] });
      continue;
    }
    const noteAny = line.match(/^note\s+"([^"]+)"$/i);
    if (noteAny) {
      notes.push({ target: null, text: noteAny[1] });
      continue;
    }

    // Relations:
    //   Foo <|-- Bar
    //   Foo "1" *-- "many" Bar : label
    //   Foo --> Bar : label
    // The optional cardinality strings are quoted.
    const relRe = new RegExp(
      `^(${CLASS_ID_RE})` +
      `(?:\\s+"([^"]+)")?` +
      `\\s*(<\\|\\.\\.|\\.\\.\\|>|<\\|--|--\\|>|\\*--|--\\*|o--|--o|<--|-->|<\\.\\.|\\.\\.>|--|\\.\\.|<\\.\\.\\|>|<\\|\\.\\.)` +
      `\\s*(?:"([^"]+)"\\s+)?` +
      `(${CLASS_ID_RE})` +
      `(?:\\s*:\\s*(.+))?$`,
    );
    const rel = line.match(relRe);
    if (rel) {
      const from = ensureClass(rel[1]);
      const fromCard = rel[2] || null;
      const tok = rel[3];
      const toCard = rel[4] || null;
      const to = ensureClass(rel[5]);
      const label = rel[6] ? rel[6].trim() : null;
      const info = classifyRelation(tok);
      relations.push({
        from,
        to,
        fromCard,
        toCard,
        label,
        kind: info.kind,
        dashed: info.dashed,
        startArrow: info.startArrow,
        endArrow: info.endArrow,
      });
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse: ${line}`);
  }

  return { direction, classes, relations, notes, warnings };
}

/**
 * Classify a UML relation token into an edge style description.
 *   kind:        "inheritance"|"composition"|"aggregation"|"association"|
 *                "dependency"|"realization"|"link"
 *   dashed:      true if the line is dashed (uses `..` segments)
 *   startArrow:  drawio endArrow value for the "from" side
 *   endArrow:    drawio endArrow value for the "to" side
 */
function classifyRelation(tok) {
  // Inheritance: solid line with hollow triangle pointing at the parent.
  if (tok === "<|--") return { kind: "inheritance", dashed: false, startArrow: "block;startFill=0", endArrow: "none" };
  if (tok === "--|>") return { kind: "inheritance", dashed: false, startArrow: "none", endArrow: "block;endFill=0" };
  if (tok === "<|..") return { kind: "realization", dashed: true,  startArrow: "block;startFill=0", endArrow: "none" };
  if (tok === "..|>") return { kind: "realization", dashed: true,  startArrow: "none", endArrow: "block;endFill=0" };
  // Composition: filled diamond on the whole side.
  if (tok === "*--") return { kind: "composition", dashed: false, startArrow: "diamondThin;startFill=1", endArrow: "none" };
  if (tok === "--*") return { kind: "composition", dashed: false, startArrow: "none", endArrow: "diamondThin;endFill=1" };
  // Aggregation: hollow diamond.
  if (tok === "o--") return { kind: "aggregation", dashed: false, startArrow: "diamondThin;startFill=0", endArrow: "none" };
  if (tok === "--o") return { kind: "aggregation", dashed: false, startArrow: "none", endArrow: "diamondThin;endFill=0" };
  // Plain association.
  if (tok === "<--") return { kind: "association", dashed: false, startArrow: "classic", endArrow: "none" };
  if (tok === "-->") return { kind: "association", dashed: false, startArrow: "none", endArrow: "classic" };
  if (tok === "--")  return { kind: "association", dashed: false, startArrow: "none", endArrow: "none" };
  // Dependency: dashed arrow.
  if (tok === "<..") return { kind: "dependency", dashed: true, startArrow: "classic", endArrow: "none" };
  if (tok === "..>") return { kind: "dependency", dashed: true, startArrow: "none", endArrow: "classic" };
  if (tok === "..")  return { kind: "link",       dashed: true, startArrow: "none", endArrow: "none" };
  return { kind: "association", dashed: false, startArrow: "none", endArrow: "classic" };
}
