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
 *   - Concurrency: a `--` line inside a composite splits it into parallel
 *     regions. Regions are materialized as synthetic child composites with
 *     `isRegion: true` so the renderer can stack them with dividers.
 *
 * Anything else is recorded in `warnings` and skipped, so unsupported
 * constructs degrade gracefully.
 */

const DIRECTIONS = new Set(["TB", "TD", "BT", "LR", "RL"]);

// Identifier characters: ASCII word chars plus CJK / kana / full-width ranges
// (BMP literals, so no /u flag is needed and ASCII behavior is unchanged).
// Without the CJK ranges, `state 稼働 { ... }` and `待機 --> 稼働` failed to
// parse and produced an entirely blank diagram.
const CJK = "\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF";
const ID_RE = `[A-Za-z_${CJK}][A-Za-z0-9_\\-\\.${CJK}]*`;

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
 *   composites: Array<{id:string,label:string,parent:string|null,children:string[],direction:string|null,isRegion?:boolean}>,
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

  // Concurrency (`--` separators): while parsing, remember which region of
  // its parent composite each direct child was declared in; regions are
  // materialized as synthetic composites in a post-pass.
  const regionCounter = new Map(); // composite id -> current region index
  const regioned = new Set(); // composite ids that contain at least one `--`
  const childRegion = new Map(); // child id -> region index at declaration

  // `[*]` anchors: mermaid draws ONE initial and ONE final node per scope,
  // no matter how many transitions touch them — so the anchor id is keyed by
  // (scope, start|end), not by occurrence.
  function pseudoId(parentId, kind) {
    const suffix = parentId ? `_${parentId}` : "_root";
    return `__${kind}${suffix}`;
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
        childRegion.set(id, regionCounter.get(parent) || 0);
      }
    } else {
      const cur = states.get(id);
      if (label && cur.label === cur.id) cur.label = label;
      // A state can be referenced by a transition before its
      // `state X { ... }` declaration: upgrade its kind so the renderer
      // doesn't emit it both as a composite frame and as a plain state.
      if (kind === "composite" && cur.kind !== "composite") cur.kind = "composite";
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

    // Concurrency separator: a bare `--` line splits the enclosing
    // composite into parallel regions.
    if (/^-{2,}$/.test(line)) {
      if (compStack.length === 0) {
        warnings.push(`Line ${lineNo}: '--' separator outside a composite state`);
      } else {
        const topId = compStack[compStack.length - 1];
        regionCounter.set(topId, (regionCounter.get(topId) || 0) + 1);
        regioned.add(topId);
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
      if (parent) childRegion.set(id, regionCounter.get(parent) || 0);
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
      const from = rawFrom === "[*]" ? ensureState(pseudoId(parent, "start"), parent, "start") : ensureState(rawFrom, parent);
      const to = rawTo === "[*]" ? ensureState(pseudoId(parent, "end"), parent, "end") : ensureState(rawTo, parent);
      transitions.push({ from, to, label });
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse: ${line}`);
  }

  // Materialize concurrent regions: every composite that contained a `--`
  // gets one synthetic child composite per region, and its direct children
  // are re-parented into the region they were declared in. The renderer
  // stacks region composites vertically with dashed dividers.
  for (const compId of regioned) {
    const regionCount = (regionCounter.get(compId) || 0) + 1;
    const regionIds = [];
    for (let i = 0; i < regionCount; i++) {
      const rid = `${compId}__region${i + 1}`;
      regionIds.push(rid);
      composites.push({
        id: rid,
        label: "",
        parent: compId,
        children: [],
        direction: null,
        isRegion: true,
      });
    }
    for (const s of states.values()) {
      if (s.parent === compId) {
        s.parent = regionIds[childRegion.get(s.id) ?? 0];
      }
    }
    for (const c of composites) {
      if (c.isRegion) continue;
      if (c.parent === compId) {
        c.parent = regionIds[childRegion.get(c.id) ?? 0];
      }
    }
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
