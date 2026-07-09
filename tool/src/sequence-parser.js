/**
 * Minimal Mermaid sequenceDiagram parser.
 *
 * Supported subset:
 *   participant X
 *   participant X as Alias
 *   actor X
 *   actor X as Alias
 *
 *   X->Y: text         (solid line, no arrow)
 *   X-->Y: text        (dashed, no arrow)
 *   X->>Y: text        (solid, filled arrow)
 *   X-->>Y: text       (dashed, filled arrow)
 *   X-x Y: text        (solid, X end)
 *   X--x Y: text       (dashed, X end)
 *   X-)Y: text         (solid, async open arrow)
 *   X--)Y: text        (dashed, async open arrow)
 *
 *   Note left of X: text
 *   Note right of X: text
 *   Note over X[,Y]: text
 *
 *   alt cond / else cond / end
 *   opt cond / end
 *   loop cond / end
 *   par cond / and cond / end
 *
 *   activate X / deactivate X            (recorded; not drawn in this version)
 *   create participant X [as Alias]      (treated as a plain declaration)
 *   create actor X [as Alias]
 *   destroy X                            (accepted; not drawn)
 *   autonumber                           (numbers each message label)
 *   title ...                            (becomes the diagram name)
 */

const ID_RE = "[A-Za-z_][A-Za-z0-9_\\-]*";

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

// CSS color names accepted as the first word of `box <color> <label>`.
const BOX_COLOR_NAMES = new Set([
  "aqua", "aquamarine", "beige", "bisque", "black", "blue", "coral",
  "crimson", "cyan", "gold", "gray", "grey", "green", "greenyellow",
  "ivory", "khaki", "lavender", "lightblue", "lightcyan", "lightgray",
  "lightgreen", "lightgrey", "lightpink", "lightyellow", "lime", "magenta",
  "maroon", "mintcream", "mistyrose", "navy", "olive", "orange", "orchid",
  "pink", "plum", "purple", "red", "salmon", "silver", "snow", "tan",
  "teal", "thistle", "tomato", "transparent", "violet", "wheat", "white",
  "yellow",
]);

/**
 * Split a `box` header into { color, label }. The color is an optional
 * leading `rgb(...)` / `rgba(...)` expression or CSS color name.
 */
function parseBoxHeader(rest) {
  let color = null;
  let label = rest;
  const rgbM = rest.match(/^(rgba?\([^)]*\))\s*(.*)$/i);
  if (rgbM) {
    color = rgbM[1];
    label = rgbM[2];
  } else {
    const first = rest.split(/\s+/)[0];
    if (first && BOX_COLOR_NAMES.has(first.toLowerCase())) {
      color = first.toLowerCase();
      label = rest.slice(first.length).trim();
    }
  }
  return { color, label: unquote(label.trim()) };
}

const MESSAGE_ARROWS = [
  // Order matters: longer tokens first.
  { token: "-->>", line: "dashed", head: "filled" },
  { token: "->>", line: "solid", head: "filled" },
  { token: "-->",  line: "dashed", head: "open"   },
  { token: "->",   line: "solid", head: "open"   },
  { token: "--x",  line: "dashed", head: "cross"  },
  { token: "-x",   line: "solid", head: "cross"  },
  { token: "--)",  line: "dashed", head: "async"  },
  { token: "-)",   line: "solid", head: "async"  },
];

/**
 * @param {string} source
 * @returns {{
 *   participants: Array<{id:string,label:string,isActor:boolean}>,
 *   steps: Array<object>,
 *   warnings: string[],
 * }}
 */
export function parseSequenceDiagram(source) {
  const lines = source.split(/\r?\n/);
  const participants = [];
  const participantIndex = new Map();
  const steps = [];
  const warnings = [];
  // `box ... end` groups: which participants belong to which box (and its
  // color) so the renderer can draw a frame around them. blockStack shadows
  // fragment nesting so we know which kind each `end` closes.
  const boxes = [];
  const blockStack = [];
  let currentBox = null;
  // When truthy, `autonumber` makes each message arrow display a leading
  // sequence number (Mermaid's behaviour). `title <text>` is captured so
  // the renderer can place a banner above the diagram.
  let autonumber = false;
  let title = null;

  function ensureParticipant(idOrLabel) {
    const existing = participantIndex.get(idOrLabel);
    if (existing) return existing;
    const p = { id: idOrLabel, label: idOrLabel, isActor: false };
    participantIndex.set(idOrLabel, p);
    participants.push(p);
    return p;
  }

  let started = false;
  let lineNo = 0;
  for (const raw of lines) {
    lineNo++;
    const line = stripComments(raw).trim();
    if (!line) continue;
    if (!started) {
      if (/^sequenceDiagram\b/i.test(line)) {
        started = true;
        continue;
      }
      continue;
    }

    if (/^autonumber\b/i.test(line)) {
      autonumber = true;
      continue;
    }
    const titleMatch = line.match(/^title[:\s]+(.+)$/i);
    if (titleMatch) {
      title = unquote(titleMatch[1].trim());
      continue;
    }

    // `box [color] [label] ... end` groups participants; `rect <color> ...
    // end` highlights a block of steps with a background color.
    let bm;
    if ((bm = line.match(/^box\b\s*(.*)$/i))) {
      const { color, label } = parseBoxHeader((bm[1] || "").trim());
      currentBox = { color, label, participants: [] };
      boxes.push(currentBox);
      blockStack.push("box");
      steps.push({ type: "fragment-begin", kind: "box", condition: label });
      continue;
    }
    if ((bm = line.match(/^rect\b\s*(.*)$/i))) {
      blockStack.push("rect");
      steps.push({
        type: "fragment-begin",
        kind: "rect",
        condition: (bm[1] || "").trim(),
      });
      continue;
    }

    let m;
    // `create participant X` declares X mid-flow; all participants are laid
    // out at the top regardless, so treat it as a plain declaration.
    if ((m = line.match(new RegExp(`^(?:create\\s+)?(participant|actor)\\s+(${ID_RE}|"[^"]+")(?:\\s+as\\s+(.+))?$`, "i")))) {
      const kind = m[1].toLowerCase();
      const id = unquote(m[2]);
      const label = m[3] ? unquote(m[3].trim()) : id;
      let p = participantIndex.get(id);
      if (!p) {
        p = { id, label, isActor: kind === "actor" };
        participantIndex.set(id, p);
        participants.push(p);
      } else {
        p.label = label;
        if (kind === "actor") p.isActor = true;
      }
      if (currentBox && !currentBox.participants.includes(id)) {
        currentBox.participants.push(id);
      }
      continue;
    }

    // Note
    if ((m = line.match(new RegExp(
      `^Note\\s+(left of|right of|over)\\s+(${ID_RE}(?:\\s*,\\s*${ID_RE})?)\\s*:\\s*(.+)$`, "i"
    )))) {
      const position = m[1].toLowerCase();
      const parts = m[2].split(/\s*,\s*/).map((s) => s.trim());
      for (const pname of parts) ensureParticipant(pname);
      steps.push({
        type: "note",
        position,
        participants: parts,
        text: m[3].trim(),
      });
      continue;
    }

    // Fragment markers
    if ((m = line.match(/^(alt|opt|loop|par|critical|break)\b\s*(.*)$/i))) {
      blockStack.push(m[1].toLowerCase());
      steps.push({
        type: "fragment-begin",
        kind: m[1].toLowerCase(),
        condition: (m[2] || "").trim(),
      });
      continue;
    }
    if ((m = line.match(/^(else|and|option)\b\s*(.*)$/i))) {
      steps.push({
        type: "fragment-section",
        keyword: m[1].toLowerCase(),
        condition: (m[2] || "").trim(),
      });
      continue;
    }
    if (/^end\s*$/i.test(line)) {
      if (blockStack.pop() === "box") currentBox = null;
      steps.push({ type: "fragment-end" });
      continue;
    }

    if ((m = line.match(new RegExp(`^activate\\s+(${ID_RE})$`, "i")))) {
      ensureParticipant(m[1]);
      steps.push({ type: "activate", participant: m[1] });
      continue;
    }
    if ((m = line.match(new RegExp(`^deactivate\\s+(${ID_RE})$`, "i")))) {
      ensureParticipant(m[1]);
      steps.push({ type: "deactivate", participant: m[1] });
      continue;
    }

    // `destroy X`: lifeline destruction isn't drawn; accept it silently.
    if ((m = line.match(new RegExp(`^destroy\\s+(${ID_RE}|"[^"]+")$`, "i")))) {
      ensureParticipant(unquote(m[1]));
      continue;
    }

    // Message: <from> <arrow> <to> : <text>
    const msg = parseMessage(line);
    if (msg) {
      ensureParticipant(msg.from);
      ensureParticipant(msg.to);
      if (msg.activateTo) {
        steps.push({ type: "activate", participant: msg.to });
      }
      steps.push({
        type: "message",
        from: msg.from,
        to: msg.to,
        line: msg.line,
        head: msg.head,
        text: msg.text,
      });
      if (msg.deactivateFrom) {
        steps.push({ type: "deactivate", participant: msg.from });
      }
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse: ${line}`);
  }

  return { participants, steps, warnings, autonumber, title, boxes };
}

function parseMessage(line) {
  // Find which arrow token appears in the line; pick the longest match found.
  for (const def of MESSAGE_ARROWS) {
    const idx = findArrow(line, def.token);
    if (idx < 0) continue;
    let from = line.slice(0, idx).trim();
    const after = line.slice(idx + def.token.length);
    const colonIdx = after.indexOf(":");
    let to, text;
    if (colonIdx < 0) {
      to = after.trim();
      text = "";
    } else {
      to = after.slice(0, colonIdx).trim();
      text = after.slice(colonIdx + 1).trim();
    }
    if (!from || !to) continue;

    // `A->>+B: msg`  → activate B after sending
    // `B-->>-A: msg` → deactivate B (the sender) after sending
    // Strip activate/deactivate sigils from either side before validating
    // the participant identifier.
    let activateTo = false;
    let deactivateFrom = false;
    if (to.startsWith("+")) {
      activateTo = true;
      to = to.slice(1).trim();
    } else if (to.startsWith("-")) {
      // Some authors write `-X` to deactivate the receiver. Mermaid only
      // honors the sender side, but we tolerate either spelling.
      deactivateFrom = true;
      to = to.slice(1).trim();
    }
    if (from.endsWith("+") || from.endsWith("-")) {
      // Rare, but harmless: tolerate authors who write `A+->>B`.
      from = from.slice(0, -1).trim();
    }

    if (!new RegExp(`^${ID_RE}$`).test(from)) continue;
    if (!new RegExp(`^${ID_RE}$`).test(to)) continue;
    return {
      from,
      to,
      line: def.line,
      head: def.head,
      text,
      activateTo,
      deactivateFrom,
    };
  }
  return null;
}

function findArrow(line, token) {
  // Make sure we don't match `--` as part of `-->>` etc.
  // Use indexOf but also verify no longer token contains the position.
  const idx = line.indexOf(token);
  return idx;
}
