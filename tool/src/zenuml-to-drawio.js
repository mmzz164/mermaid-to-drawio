import { sequenceToDrawio } from "./sequence-to-drawio.js";
import { bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal ZenUML parser. ZenUML is an alternative sequence DSL; we translate
 * it into the same model shape the Mermaid sequence renderer consumes and
 * reuse that renderer.
 *
 *   zenuml
 *     title Login
 *     @Actor User
 *     @Boundary Web
 *     User->Web.submit(creds)
 *     Web->Auth.verify() {
 *       return token
 *     }
 *     Web->User: welcome
 *
 * Supported: `@Type Name` participants (@Actor → stick figure), sync calls
 * `A->B.method(args)` and `A->B: text`, `return x` inside a call block,
 * and `if/else`, `while`, `for`, `opt`, `par` blocks (→ alt/loop/opt/par
 * fragments). Unsupported lines are recorded as warnings and skipped.
 */
export function parseZenuml(source) {
  const warnings = [];
  const participants = [];
  const participantIndex = new Map();
  const steps = [];
  let title = null;
  const braceStack = []; // {kind:'call', from, to} | {kind:'frag'}

  function ensure(id, isActor = false) {
    let p = participantIndex.get(id);
    if (!p) {
      p = { id, label: id, isActor };
      participantIndex.set(id, p);
      participants.push(p);
    } else if (isActor) p.isActor = true;
    return p;
  }
  const defaultSource = () => (participants[0] ? participants[0].id : ensure("Starter").id);

  const ID = "[A-Za-z0-9_.\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF-]+";
  const CALL = new RegExp(`^(?:(${ID})\\s*->\\s*)?(${ID})\\.([^(]+)\\(([^)]*)\\)\\s*(\\{)?\\s*$`);
  const TEXTMSG = new RegExp(`^(${ID})\\s*->\\s*(${ID})\\s*:\\s*(.+?)\\s*(\\{)?$`);

  for (const { trimmed, lineNo } of bodyLines(source, /^zenuml\b/i)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) { title = m[1].trim(); continue; }
    // @Type Name  (participant declaration)
    if ((m = trimmed.match(/^@(\w+)\s+(.+)$/))) {
      ensure(m[2].trim(), /actor/i.test(m[1]));
      continue;
    }
    // Fragment openers.
    if ((m = trimmed.match(/^(if|while|for|forEach|loop|opt|par|try)\b\s*(?:\(([^)]*)\))?\s*\{$/i))) {
      const kw = m[1].toLowerCase();
      const kind = kw === "if" ? "alt" : (kw === "while" || kw === "for" || kw === "foreach" || kw === "loop") ? "loop" : kw === "par" ? "par" : "opt";
      steps.push({ type: "fragment-begin", kind, condition: (m[2] || "").trim() });
      braceStack.push({ kind: "frag" });
      continue;
    }
    if ((m = trimmed.match(/^\}\s*(else\s*if|else)\b\s*(?:\(([^)]*)\))?\s*\{$/i))) {
      steps.push({ type: "fragment-section", keyword: "else", condition: (m[2] || "").trim() });
      continue;
    }
    // return value  (inside a call block → dashed reply to the caller)
    if ((m = trimmed.match(/^return\s+(.+)$/i))) {
      const call = [...braceStack].reverse().find((b) => b.kind === "call");
      if (call) steps.push({ type: "message", from: call.to, to: call.from, line: "dashed", head: "open", text: unquote(m[1].trim()) });
      continue;
    }
    // Closing brace: end a fragment or a call block.
    if (trimmed === "}") {
      const top = braceStack.pop();
      if (!top) { warnings.push(`Line ${lineNo}: unmatched '}'`); continue; }
      if (top.kind === "frag") steps.push({ type: "fragment-end" });
      else steps.push({ type: "deactivate", participant: top.to });
      continue;
    }
    // Method call: A->B.method(args)  (source optional → default source)
    if ((m = trimmed.match(CALL))) {
      const from = m[1] ? m[1] : defaultSource();
      const to = m[2];
      ensure(from); ensure(to);
      const label = `${m[3].trim()}(${m[4].trim()})`;
      steps.push({ type: "activate", participant: to });
      steps.push({ type: "message", from, to, line: "solid", head: "filled", text: label });
      if (m[5]) braceStack.push({ kind: "call", from, to });
      else steps.push({ type: "deactivate", participant: to });
      continue;
    }
    // Plain text message: A->B: text
    if ((m = trimmed.match(TEXTMSG))) {
      const from = m[1], to = m[2];
      ensure(from); ensure(to);
      steps.push({ type: "message", from, to, line: "solid", head: "filled", text: m[3].trim() });
      if (m[4]) braceStack.push({ kind: "call", from, to });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse zenuml line: ${trimmed}`);
  }
  // Close any dangling call blocks.
  while (braceStack.length) {
    const top = braceStack.pop();
    if (top.kind === "call") steps.push({ type: "deactivate", participant: top.to });
    else steps.push({ type: "fragment-end" });
  }

  return { participants, steps, warnings, autonumber: true, title, boxes: [] };
}

export function zenumlToDrawio(mermaidSource, opts = {}) {
  const model = parseZenuml(mermaidSource);
  // Feed the translated model straight into the sequence renderer.
  const { xml, warnings } = sequenceToDrawio("", { ...opts, model });
  return { xml, warnings: [...model.warnings, ...(warnings || []).filter((w) => !model.warnings.includes(w))] };
}
