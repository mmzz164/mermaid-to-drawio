/**
 * Minimal Mermaid stateDiagram-v2 parser.
 *
 * Supported subset:
 *   - `stateDiagram` and `stateDiagram-v2` headers
 *   - Pseudo states: `[*]` (start / end)
 *   - Plain state declarations: `state "Display name" as Id` / `state Id`
 *   - Special states: `state X <<choice>>` / `<<fork>>` / `<<join>>` / `<<end>>`
 *   - Transitions: `A --> B`, `A --> B : trigger / action`
 *   - Composite states (nested):
 *       state OuterId {
 *         A --> B
 *       }
 *   - Notes: `note left of X : text` / `note right of X : text` /
 *            multi-line `note left of X\n  ...\nend note`
 *   - `direction LR/TB/RL/BT` at top level or inside a composite state
 *
 * Anything else is recorded in `warnings` and skipped, so unsupported
 * constructs degrade gracefully.
 */

const DIRECTIONS = new Set(["TB", "TD", "BT", "LR", "RL"]);

const ID_RE = "[A-Za-z_][A-Za-z0-9_\\-\\.]*";

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

/**
 * @param {string} source
 * @returns {{
 *   direction: string,
 *   states: Map<string, {id:string,label:string,kind:string,parent:string|null}>,
 *   transitions: Array<{from:string,to:string,label:string|null}>,
 *   composites: Array<{id:string,label:string,parent:string|null,children:string[],direction:string|null}>,
 *   notes: Array<{target:string,position:string,text:string}>,
 *   warnings: string[],
 * }}
 */
export function parseStateDiagram(source) {
  const lines = source.split(/\r?\n/);
  const states = new Map();
  const transitions = [];
  const composites = [];
  const compStack = [];
  const notes = [];
  const warnings = [];
  let direction = "TB";

  // Synthesize a unique anchor id for each `[*]` occurrence so multiple
  // start/end markers don't collapse into a single node. The anchor is
  // attached to the nearest enclosing composite (or null for top-level).
  let pseudoCounter = 0;
  function pseudoId(parentId) {
    pseudoCounter++;
    const suffix = parentId ? `_${parentId}` : "_root";
    return `__pseudo${suffix}_${pseudoCounter}`;
  }

  function ensureState(id, parent, kind = "state", label = null) {
    if (!states.has(id)) {
      states.set(id, {
        id,
        label: label ?? id,
        kind,
        parent: parent ?? null,
      });
      if (parent) {
        const c = composites.find((cc) => cc.id === parent);
        if (c) c.children.push(id);
      }
    } else if (label) {
      const cur = states.get(id);
      if (cur.label === cur.id) cur.label = label;
    }
    return id;
  }

  let started = false;
  let lineNo = 0;
  // Stash multi-line note state: when we see `note left of X` without a
  // trailing `:` we collect subsequent lines until `end note`.
  let pendingNote = null;

  for (const raw of lines) {
    lineNo++;
    const line = stripComments(raw).trim();
    if (!line) continue;

    if (pendingNote) {
      if (/^end\s+note$/i.test(line)) {
        notes.push(pendingNote);
        pendingNote = null;
        continue;
      }
      pendingNote.text += (pendingNote.text ? "\n" : "") + line;
      continue;
    }

    if (!started) {
      if (/^stateDiagram(-v2)?\b/i.test(line)) {
        started = true;
        continue;
      }
      continue;
    }

    if (line === "}") {
      if (compStack.length === 0) {
        warnings.push(`Line ${lineNo}: unexpected '}'`);
      } else {
        compStack.pop();
      }
      continue;
    }

    const dirMatch = line.match(/^direction\s+([A-Z]{2})\s*$/i);
    if (dirMatch) {
      const d = dirMatch[1].toUpperCase();
      if (!DIRECTIONS.has(d)) {
        warnings.push(`Line ${lineNo}: unknown direction "${d}"`);
      } else if (compStack.length > 0) {
        const topId = compStack[compStack.length - 1];
        const c = composites.find((cc) => cc.id === topId);
        if (c) c.direction = d;
      } else {
        direction = d;
      }
      continue;
    }

    const parent = compStack.length > 0 ? compStack[compStack.length - 1] : null;

    // Composite state: `state Name { ... }` or `state Name as ... { ... }`
    const compOpen = line.match(
      new RegExp(`^state\\s+(?:"([^"]+)"\\s+as\\s+)?(${ID_RE})\\s*\\{$`, "i"),
    );
    if (compOpen) {
      const label = compOpen[1] ? compOpen[1] : compOpen[2];
      const id = compOpen[2];
      ensureState(id, parent, "composite", label);
      composites.push({
        id,
        label,
        parent: parent ?? null,
        children: [],
        direction: null,
      });
      compStack.push(id);
      continue;
    }

    // Composite open on its own line (after a regular state declaration).
    // Mermaid permits `state X { ... }` to span; the `{` must be at EOL.
    // The compOpen pattern above already handles this; remaining handling
    // happens via `line === "}"`.

    // Plain state with display name: `state "Label" as Id` (no `{`)
    const stateNamed = line.match(
      new RegExp(`^state\\s+"([^"]+)"\\s+as\\s+(${ID_RE})\\s*$`, "i"),
    );
    if (stateNamed) {
      ensureState(stateNamed[2], parent, "state", stateNamed[1]);
      continue;
    }

    // Plain state: `state Id` (no body, no label).
    const stateBare = line.match(new RegExp(`^state\\s+(${ID_RE})\\s*$`, "i"));
    if (stateBare) {
      ensureState(stateBare[1], parent, "state");
      continue;
    }

    // Stereotyped state: `state X <<choice>>` / `<<fork>>` / `<<join>>` / `<<end>>`
    const stateStereo = line.match(
      new RegExp(`^state\\s+(${ID_RE})\\s+<<(choice|fork|join|end)>>\\s*$`, "i"),
    );
    if (stateStereo) {
      const id = stateStereo[1];
      const kind = stateStereo[2].toLowerCase(); // choice/fork/join/end
      ensureState(id, parent, kind, id);
      continue;
    }

    // Inline action / state description: `X : description text`
    const desc = line.match(new RegExp(`^(${ID_RE})\\s*:\\s*(.+)$`));
    if (desc && !/^note\b/i.test(line) && desc[1] !== "note") {
      const sid = desc[1];
      const text = desc[2].trim();
      if (states.has(sid)) {
        // Append to label as a second line, mermaid-style.
        const cur = states.get(sid);
        cur.label = cur.label && cur.label !== cur.id ? `${cur.label}\n${text}` : text;
      } else {
        ensureState(sid, parent, "state", text);
      }
      continue;
    }

    // Notes (single-line and multi-line).
    const noteSingle = line.match(
      new RegExp(`^note\\s+(left of|right of)\\s+(${ID_RE})\\s*:\\s*(.+)$`, "i"),
    );
    if (noteSingle) {
      notes.push({
        target: noteSingle[2],
        position: noteSingle[1].toLowerCase(),
        text: noteSingle[3].trim(),
      });
      continue;
    }
    const noteMulti = line.match(
      new RegExp(`^note\\s+(left of|right of)\\s+(${ID_RE})\\s*$`, "i"),
    );
    if (noteMulti) {
      pendingNote = {
        target: noteMulti[2],
        position: noteMulti[1].toLowerCase(),
        text: "",
      };
      continue;
    }

    // Transition: `A --> B` or `A --> B : label`
    const trans = line.match(
      new RegExp(`^(\\[\\*\\]|${ID_RE})\\s*-->\\s*(\\[\\*\\]|${ID_RE})\\s*(?::\\s*(.+))?$`),
    );
    if (trans) {
      const rawFrom = trans[1];
      const rawTo = trans[2];
      const label = trans[3] ? trans[3].trim() : null;
      const from = rawFrom === "[*]" ? ensureState(pseudoId(parent), parent, "start") : ensureState(rawFrom, parent);
      const to = rawTo === "[*]" ? ensureState(pseudoId(parent), parent, "end") : ensureState(rawTo, parent);
      transitions.push({ from, to, label });
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse: ${line}`);
  }

  return {
    direction,
    states,
    transitions,
    composites,
    notes,
    warnings,
  };
}
