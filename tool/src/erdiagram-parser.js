/**
 * Minimal Mermaid erDiagram parser.
 *
 * Supported:
 *   - Relationships:  EntityA <leftCard><line><rightCard> EntityB : "label"
 *     leftCard:  ||  |o  }o  }|
 *     line:      --  ..
 *     rightCard: ||  o|  o{  |{
 *   - Entity attribute blocks:
 *       Entity {
 *         type name [PK|FK|UK] "optional comment"
 *       }
 */

// Allow dot in entity identifiers, e.g. `pkg.Module`.
const ID_RE = "[A-Za-z_][A-Za-z0-9_\\-\\.]*";

const LEFT_CARDS = new Set(["||", "|o", "}o", "}|", "o|"]);
const RIGHT_CARDS = new Set(["||", "o|", "o{", "|{", "|o"]);

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

function cardinalitySymbol(card, side) {
  // Convert Mermaid ER cardinality token to a human-readable badge.
  // side: 'left' or 'right'. Mermaid mirrors the symbol depending on side.
  // Returns a short token like '1', '0..1', '1..N', '0..N'.
  const exactlyOne = card === "||";
  if (exactlyOne) return "1";
  if (side === "left") {
    if (card === "|o" || card === "o|") return "0..1";
    if (card === "}o") return "0..N";
    if (card === "}|") return "1..N";
  } else {
    if (card === "o|" || card === "|o") return "0..1";
    if (card === "o{") return "0..N";
    if (card === "|{") return "1..N";
  }
  return card;
}

function arrowEndForCard(card) {
  // Choose a drawio arrow end style based on cardinality.
  // draw.io built-in ER arrow head names:
  //   ERone, ERmany, ERzeroToOne, ERoneToMany, ERzeroToMany
  if (card === "||") return "ERone";
  if (card === "|o" || card === "o|") return "ERzeroToOne";
  if (card === "}o" || card === "o{") return "ERzeroToMany";
  if (card === "}|" || card === "|{") return "ERoneToMany";
  return "none";
}

/**
 * Parse an erDiagram mermaid source.
 * @param {string} source
 * @returns {{
 *   entities: Map<string, { name: string, attributes: Array<{type:string,name:string,keys:string[],comment:string|null}> }>,
 *   relationships: Array<{from:string,to:string,leftCard:string,rightCard:string,identifying:boolean,label:string|null}>,
 *   warnings: string[],
 * }}
 */
export function parseErDiagram(source) {
  const lines = source.split(/\r?\n/);
  const entities = new Map();
  const relationships = [];
  const warnings = [];

  let started = false;
  let inBlock = null; // entity name when reading attributes
  let lineNo = 0;

  for (const raw of lines) {
    lineNo++;
    const line = stripComments(raw).trim();
    if (!line) continue;

    if (!started) {
      if (/^erDiagram\b/i.test(line)) {
        started = true;
        const rest = line.replace(/^erDiagram\b\s*/i, "");
        if (rest) {
          // Some authors put content on the same line; not common, ignore.
        }
        continue;
      }
      // Allow directives before the header
      continue;
    }

    // Inside an entity attribute block: `Entity {` ... `}`
    if (inBlock) {
      if (line === "}") {
        inBlock = null;
        continue;
      }
      const attr = parseAttribute(line);
      if (!attr) {
        warnings.push(`Line ${lineNo}: could not parse attribute: ${line}`);
        continue;
      }
      ensureEntity(entities, inBlock).attributes.push(attr);
      continue;
    }

    // Entity-only declaration: `EntityName {`
    const blockOpen = line.match(new RegExp(`^(${ID_RE})\\s*\\{\\s*$`));
    if (blockOpen) {
      inBlock = blockOpen[1];
      ensureEntity(entities, inBlock);
      continue;
    }
    // Inline attribute block: `EntityName { type name }` on one line
    const inlineBlock = line.match(
      new RegExp(`^(${ID_RE})\\s*\\{\\s*(.+?)\\s*\\}\\s*$`)
    );
    if (inlineBlock) {
      const name = inlineBlock[1];
      ensureEntity(entities, name);
      const inner = inlineBlock[2];
      // Split by ; or newline-like separator
      const parts = inner.split(/[;,]\s*/).filter(Boolean);
      for (const p of parts) {
        const attr = parseAttribute(p);
        if (attr) entities.get(name).attributes.push(attr);
      }
      continue;
    }

    // Relationship line:
    //   EntityA <leftCard><line><rightCard> EntityB : "label"
    const rel = parseRelationship(line);
    if (rel) {
      ensureEntity(entities, rel.from);
      ensureEntity(entities, rel.to);
      relationships.push(rel);
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse: ${line}`);
  }
  return { entities, relationships, warnings };
}

function ensureEntity(entities, name) {
  if (!entities.has(name)) {
    entities.set(name, { name, attributes: [] });
  }
  return entities.get(name);
}

function parseAttribute(s) {
  // Format: `type name [PK|FK|UK]* "comment"?`
  const m = s.match(
    /^(\S+)\s+(\S+)(?:\s+([A-Z, ]+))?(?:\s+"([^"]*)")?\s*$/
  );
  if (!m) return null;
  const type = m[1];
  const name = m[2];
  const keyStr = m[3] ? m[3].trim() : "";
  const comment = m[4] ?? null;
  const keys = keyStr
    ? keyStr
        .split(/[,\s]+/)
        .map((k) => k.toUpperCase())
        .filter((k) => ["PK", "FK", "UK"].includes(k))
    : [];
  return { type, name, keys, comment };
}

function parseRelationship(s) {
  // Cardinality tokens are 2 chars each. Connector is `--` or `..`.
  // We allow optional `: label` (label may be quoted).
  const m = s.match(
    new RegExp(
      "^(" +
        ID_RE +
        ")\\s+" +
        "(\\|\\||\\|o|o\\||\\}o|\\}\\|)" +     // left cardinality
        "(--|\\.\\.)" +                          // line type
        "(\\|\\||o\\||\\|o|o\\{|\\|\\{)" +    // right cardinality
        "\\s+(" +
        ID_RE +
        ")" +
        "(?:\\s*:\\s*(.+))?$"
    )
  );
  if (!m) return null;
  const [, from, leftCard, lineType, rightCard, to, labelRaw] = m;
  if (!LEFT_CARDS.has(leftCard)) return null;
  if (!RIGHT_CARDS.has(rightCard)) return null;
  return {
    from,
    to,
    leftCard,
    rightCard,
    identifying: lineType === "--",
    label: labelRaw ? unquote(labelRaw.trim()) : null,
  };
}

export { cardinalitySymbol, arrowEndForCard };
