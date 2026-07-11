import { parseSequenceDiagram } from "./sequence-parser.js";
import { measureMultiline, visualWidth } from "./text-width.js";

const COL_W = 200; // column width (header width)
const COL_GAP = 60; // gap between columns
const PITCH = COL_W + COL_GAP;
const MARGIN_X = 30;
const MARGIN_Y = 30;
const HEADER_H = 44;
const STEP_MIN_H = 50;
const SELF_LOOP_H = 50;
const NOTE_PAD_Y = 12;
const FRAG_TITLE_H = 22;
const CHAR_PX = 7.2;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function arrowEndStyle(head) {
  switch (head) {
    case "filled":
      return "endArrow=block;endFill=1;";
    case "open":
      return "endArrow=open;endFill=0;";
    case "cross":
      return "endArrow=cross;";
    case "async":
      return "endArrow=open;endFill=0;";
    default:
      return "endArrow=block;";
  }
}

function lineStyle(lineType) {
  return lineType === "dashed" ? "dashed=1;" : "";
}

/**
 * Convert a mermaid box/rect color (rgb()/rgba()/CSS name/transparent) to a
 * drawio fill spec. rgba's alpha becomes the cell's opacity.
 */
function cssFill(color, fallback) {
  if (!color) return { fill: fallback, opacity: null };
  if (color === "transparent") return { fill: "none", opacity: null };
  const m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const hex =
      "#" +
      [m[1], m[2], m[3]]
        .map((v) => Math.min(255, parseInt(v, 10)).toString(16).padStart(2, "0"))
        .join("");
    const opacity = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 100) : null;
    return { fill: hex, opacity };
  }
  return { fill: color, opacity: null }; // CSS color name; drawio accepts it
}

/**
 * Convert a Mermaid sequenceDiagram to draw.io XML.
 * @param {string} mermaidSource
 * @param {object} [opts]
 * @returns {{xml:string, warnings:string[]}}
 */
export function sequenceToDrawio(mermaidSource, opts = {}) {
  let { diagramName = "Page-1" } = opts;
  const model = parseSequenceDiagram(mermaidSource);
  // An inline `title <text>` directive overrides the default page name when
  // the caller didn't supply an explicit diagramName.
  if (model.title && (!opts.diagramName || opts.diagramName === "Page-1")) {
    diagramName = model.title;
  }
  const cells = [
    `<mxCell id="0" />`,
    `<mxCell id="1" parent="0" />`,
  ];

  if (model.participants.length === 0) {
    const xml = wrapXml(cells, 850, 1100, diagramName);
    return { xml, warnings: model.warnings };
  }

  // Assign x-position to each participant
  const pIndex = new Map();
  model.participants.forEach((p, i) => {
    pIndex.set(p.id, i);
  });

  function centerX(participantId) {
    const i = pIndex.get(participantId);
    return MARGIN_X + i * PITCH + COL_W / 2;
  }

  // Compute Y positions for every step
  // Build a list of step layout entries with y
  const yStarts = new Array(model.steps.length);
  const fragKindStack = []; // y-pass shadow stack to know which kind a fragment-end closes
  let y = MARGIN_Y + HEADER_H + 30; // start below headers
  for (let i = 0; i < model.steps.length; i++) {
    const step = model.steps[i];
    yStarts[i] = y;
    switch (step.type) {
      case "message": {
        if (step.from === step.to) {
          // self-message: extra vertical room based on wrapped line count
          const { lineCount } = measureMultiline(step.text || "", 30);
          const cappedLines = Math.min(lineCount, 4);
          const loopH = Math.max(34, cappedLines * 16 + 12);
          y += loopH + 24;
        } else {
          const { lineCount } = measureMultiline(step.text || "", 80);
          const extra = (lineCount - 1) * 18;
          y += STEP_MIN_H + extra;
        }
        break;
      }
      case "note": {
        const { lineCount } = measureMultiline(step.text || "", 40);
        y += Math.max(STEP_MIN_H, lineCount * 20 + 24);
        break;
      }
      case "fragment-begin":
        fragKindStack.push(step.kind);
        // `box` and `rect` are visually invisible in our output; they only
        // delimit blocks of regular content, so don't consume vertical space.
        if (step.kind === "box" || step.kind === "rect") break;
        y += FRAG_TITLE_H + 16;
        break;
      case "fragment-section":
        y += FRAG_TITLE_H + 8;
        break;
      case "fragment-end": {
        const kind = fragKindStack.pop();
        if (kind === "box" || kind === "rect") break;
        y += 18;
        break;
      }
      default:
        break;
    }
  }
  const totalY = y + 20;

  // Compute activation bars from activate/deactivate steps. Activations may
  // come from explicit `activate X` / `deactivate X` lines or from `+`/`-`
  // sigils on message arrows (handled by the parser).
  const activations = [];
  const openActs = new Map();
  for (let i = 0; i < model.steps.length; i++) {
    const step = model.steps[i];
    if (step.type === "activate") {
      if (!openActs.has(step.participant)) openActs.set(step.participant, []);
      openActs.get(step.participant).push(yStarts[i]);
    } else if (step.type === "deactivate") {
      const stack = openActs.get(step.participant);
      if (stack && stack.length) {
        const sY = stack.pop();
        activations.push({
          participant: step.participant,
          startY: sY,
          endY: yStarts[i],
        });
      }
    }
  }
  // Close any still-open activations at the bottom of the diagram.
  for (const [p, stack] of openActs) {
    while (stack.length) {
      activations.push({
        participant: p,
        startY: stack.pop(),
        endY: totalY - 10,
      });
    }
  }

  // Render participant headers + lifelines
  const lifelineBottom = totalY;

  // `box` participant groups: a frame behind the boxed lifelines, spanning
  // from above the headers to below the footers. Emitted before the headers
  // so it stays in the background.
  let boxId = 1;
  for (const box of model.boxes || []) {
    const idxs = box.participants
      .map((p) => pIndex.get(p))
      .filter((v) => v !== undefined);
    if (idxs.length === 0) continue;
    const minI = Math.min(...idxs);
    const maxI = Math.max(...idxs);
    const bx = MARGIN_X + minI * PITCH - 8;
    const bw = (maxI - minI) * PITCH + COL_W + 16;
    const by = MARGIN_Y - 22;
    const bh = lifelineBottom + HEADER_H - by + 8;
    const { fill, opacity } = cssFill(box.color, "#f5f5f5");
    const style =
      `rounded=1;arcSize=4;html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=#999999;` +
      `verticalAlign=top;fontStyle=1;fontSize=11;` +
      (opacity !== null ? `opacity=${opacity};` : "");
    cells.push(
      `<mxCell id="pbox-${boxId}" value="${escapeXml(box.label || "")}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(bx)}" y="${round(by)}" width="${round(bw)}" height="${round(bh)}" as="geometry" />` +
        `</mxCell>`
    );
    boxId++;
  }

  model.participants.forEach((p, i) => {
    const x = MARGIN_X + i * PITCH;
    const yHead = MARGIN_Y;
    const style = p.isActor
      ? "shape=umlActor;verticalLabelPosition=bottom;labelPosition=center;verticalAlign=top;html=1;outlineConnect=0;"
      : "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;";
    const headW = p.isActor ? 40 : COL_W;
    const headH = p.isActor ? 50 : HEADER_H;
    const headX = p.isActor ? x + (COL_W - headW) / 2 : x;
    cells.push(
      `<mxCell id="${escapeXml(p.id)}-head" value="${escapeXml(p.label)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${headX}" y="${yHead}" width="${headW}" height="${headH}" as="geometry" />` +
        `</mxCell>`
    );
    // Footer (mirror of header)
    cells.push(
      `<mxCell id="${escapeXml(p.id)}-foot" value="${escapeXml(p.label)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${headX}" y="${lifelineBottom}" width="${headW}" height="${headH}" as="geometry" />` +
        `</mxCell>`
    );
    // Lifeline (dashed vertical line)
    const cx = MARGIN_X + i * PITCH + COL_W / 2;
    const yLifeTop = MARGIN_Y + HEADER_H;
    const yLifeBottom = lifelineBottom;
    cells.push(
      `<mxCell id="${escapeXml(p.id)}-life" value="" style="endArrow=none;dashed=1;html=1;strokeColor=#888888;" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${round(cx)}" y="${round(yLifeTop)}" as="sourcePoint" />` +
        `<mxPoint x="${round(cx)}" y="${round(yLifeBottom)}" as="targetPoint" />` +
        `</mxGeometry>` +
        `</mxCell>`
    );
  });

  // Render activation bars on lifelines.
  const ACT_W = 10;
  let actId = 1;
  for (const a of activations) {
    if (!pIndex.has(a.participant)) continue;
    const cx = centerX(a.participant);
    const h = Math.max(8, a.endY - a.startY);
    cells.push(
      `<mxCell id="act-${actId}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">` +
        `<mxGeometry x="${round(cx - ACT_W / 2)}" y="${round(a.startY)}" width="${ACT_W}" height="${round(h)}" as="geometry" />` +
        `</mxCell>`
    );
    actId++;
  }

  // Render messages, notes, and pre-compute fragment groupings
  const fragStack = []; // each: { kind, condition, startY, sections, minI, maxI }
  let edgeId = 1;
  let noteId = 1;
  let fragId = 1;
  let rectId = 1;
  let msgCounter = 0; // 1-based counter for `autonumber`
  const bgCells = []; // rect highlight backgrounds; spliced in behind everything

  // Track which lifelines each open fragment touches so `rect` blocks can
  // span just the involved participants (mermaid's behaviour).
  function touch(indices) {
    for (const frag of fragStack) {
      for (const idx of indices) {
        if (idx === undefined) continue;
        frag.minI = frag.minI === null ? idx : Math.min(frag.minI, idx);
        frag.maxI = frag.maxI === null ? idx : Math.max(frag.maxI, idx);
      }
    }
  }

  for (let i = 0; i < model.steps.length; i++) {
    const step = model.steps[i];
    const y = yStarts[i];

    if (step.type === "message") {
      touch([pIndex.get(step.from), pIndex.get(step.to)]);
      let labelText = step.text || "";
      if (model.autonumber) {
        msgCounter++;
        const prefix = `${msgCounter}. `;
        labelText = labelText ? prefix + labelText : prefix.trim();
      }
      const fromCx = centerX(step.from);
      const toCx = centerX(step.to);
      if (step.from === step.to) {
        // self-message: floating loop on the right of the lifeline.
        // Width of the loop and number of label lines are sized to the label
        // so a long message doesn't visually overflow into the next column.
        const text = labelText;
        // Wrap roughly at ~30 visual columns
        const wrapAt = 30;
        const { lineCount } = measureMultiline(text, wrapAt);
        const cappedLines = Math.min(lineCount, 4);
        // Loop horizontal extent — capped at PITCH/2 to avoid bleeding into
        // the next column.
        const labelW = visualWidth(text) * CHAR_PX;
        const loopW = Math.max(70, Math.min(Math.round(PITCH / 2), Math.round(labelW / Math.max(1, cappedLines) / 2 + 30)));
        const cx = fromCx;
        const yTop = y;
        const yBot = y + Math.max(34, cappedLines * 16 + 12);
        const loopX = cx + loopW;
        const style =
          "html=1;" +
          arrowEndStyle(step.head) +
          lineStyle(step.line) +
          "rounded=0;labelBackgroundColor=#ffffff;align=left;verticalAlign=middle;spacingLeft=8;whiteSpace=wrap;";
        cells.push(
          `<mxCell id="msg-${edgeId}" value="${escapeXml(text)}" style="${style}" edge="1" parent="1">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="${round(cx)}" y="${round(yTop)}" as="sourcePoint" />` +
            `<mxPoint x="${round(cx)}" y="${round(yBot)}" as="targetPoint" />` +
            `<Array as="points">` +
            `<mxPoint x="${round(loopX)}" y="${round(yTop)}" />` +
            `<mxPoint x="${round(loopX)}" y="${round(yBot)}" />` +
            `</Array>` +
            `</mxGeometry>` +
            `</mxCell>`
        );
      } else {
        const style =
          "html=1;" +
          arrowEndStyle(step.head) +
          lineStyle(step.line) +
          "verticalAlign=bottom;align=center;rounded=0;labelBackgroundColor=#ffffff;";
        cells.push(
          `<mxCell id="msg-${edgeId}" value="${escapeXml(labelText)}" style="${style}" edge="1" parent="1">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="${round(fromCx)}" y="${round(y)}" as="sourcePoint" />` +
            `<mxPoint x="${round(toCx)}" y="${round(y)}" as="targetPoint" />` +
            `</mxGeometry>` +
            `</mxCell>`
        );
      }
      edgeId++;
    } else if (step.type === "note") {
      const xs = step.participants
        .map((p) => pIndex.get(p))
        .filter((v) => v !== undefined)
        .sort((a, b) => a - b);
      if (xs.length === 0) continue;
      touch(xs);
      const leftI = xs[0];
      const rightI = xs[xs.length - 1];
      let nx, nw;
      if (step.position === "left of") {
        nw = COL_W;
        nx = MARGIN_X + leftI * PITCH - PITCH / 2 + COL_GAP / 2;
        nx = Math.max(MARGIN_X / 2, nx);
      } else if (step.position === "right of") {
        nw = COL_W;
        nx = MARGIN_X + rightI * PITCH + PITCH / 2 + COL_GAP / 2 - COL_W;
      } else {
        const xLeft = MARGIN_X + leftI * PITCH + COL_W / 2;
        const xRight = MARGIN_X + rightI * PITCH + COL_W / 2;
        const span = xRight - xLeft;
        nx = xLeft - 60;
        nw = Math.max(140, span + 120);
      }
      const nh = Math.max(36, measureMultiline(step.text || "", 40).lineCount * 18 + NOTE_PAD_Y);
      const ny = y - 4;
      cells.push(
        `<mxCell id="note-${noteId}" value="${escapeXml(step.text)}" style="shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;align=center;verticalAlign=middle;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(nx)}" y="${round(ny)}" width="${round(nw)}" height="${round(nh)}" as="geometry" />` +
          `</mxCell>`
      );
      noteId++;
    } else if (step.type === "fragment-begin") {
      fragStack.push({
        kind: step.kind,
        condition: step.condition,
        startY: y,
        sections: [],
        minI: null,
        maxI: null,
      });
    } else if (step.type === "fragment-section") {
      const top = fragStack[fragStack.length - 1];
      if (!top) continue;
      top.sections.push({
        y,
        keyword: step.keyword,
        condition: step.condition,
      });
    } else if (step.type === "fragment-end") {
      const frag = fragStack.pop();
      if (!frag) continue;
      // `box` frames are drawn from model.boxes (they wrap participants,
      // not steps); nothing to emit here.
      if (frag.kind === "box") continue;
      // `rect <color>` highlights its steps with a background rectangle
      // spanning the involved lifelines.
      if (frag.kind === "rect") {
        let xL, xR;
        if (frag.minI !== null) {
          xL = MARGIN_X + frag.minI * PITCH + COL_W / 2 - 50;
          xR = MARGIN_X + frag.maxI * PITCH + COL_W / 2 + 50;
        } else {
          xL = MARGIN_X - 10;
          xR = MARGIN_X + (model.participants.length - 1) * PITCH + COL_W + 10;
        }
        const yTop = frag.startY - 26;
        const yBottom = y - 14;
        const { fill, opacity } = cssFill(frag.condition || null, "#f0f4ff");
        const style =
          `rounded=0;html=1;fillColor=${fill};strokeColor=none;` +
          (opacity !== null ? `opacity=${opacity};` : "");
        bgCells.push(
          `<mxCell id="rect-bg-${rectId}" value="" style="${style}" vertex="1" parent="1">` +
            `<mxGeometry x="${round(xL)}" y="${round(yTop)}" width="${round(xR - xL)}" height="${round(yBottom - yTop)}" as="geometry" />` +
            `</mxCell>`
        );
        rectId++;
        continue;
      }
      const xLeft = MARGIN_X - 10;
      const xRight = MARGIN_X + (model.participants.length - 1) * PITCH + COL_W + 10;
      const yTop = frag.startY;
      const yBottom = y + 8;
      const w = xRight - xLeft;
      const h = yBottom - yTop;
      const fragLabel = `${frag.kind}${frag.condition ? " [" + frag.condition + "]" : ""}`;
      // Outer rectangle (no label — label goes on tab)
      cells.push(
        `<mxCell id="frag-${fragId}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#888888;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(xLeft)}" y="${round(yTop)}" width="${round(w)}" height="${round(h)}" as="geometry" />` +
          `</mxCell>`
      );
      // Tab label in top-left corner (simple rect — works in draw.io and Gliffy)
      const tabW = Math.max(50, visualWidth(fragLabel) * CHAR_PX + 16);
      cells.push(
        `<mxCell id="frag-${fragId}-tab" value="${escapeXml(fragLabel)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#e8e8e8;strokeColor=#888888;fontStyle=1;fontSize=11;align=left;verticalAlign=middle;spacingLeft=6;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(xLeft)}" y="${round(yTop)}" width="${round(tabW)}" height="20" as="geometry" />` +
          `</mxCell>`
      );
      // Section dividers
      for (const sec of frag.sections) {
        const secLabel = `${sec.keyword}${sec.condition ? " [" + sec.condition + "]" : ""}`;
        cells.push(
          `<mxCell id="frag-${fragId}-sec-${sec.y}" value="${escapeXml(secLabel)}" style="endArrow=none;dashed=1;html=1;strokeColor=#888888;align=left;verticalAlign=bottom;fontStyle=2;labelBackgroundColor=#ffffff;" edge="1" parent="1">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="${round(xLeft)}" y="${round(sec.y)}" as="sourcePoint" />` +
            `<mxPoint x="${round(xRight)}" y="${round(sec.y)}" as="targetPoint" />` +
            `</mxGeometry>` +
            `</mxCell>`
        );
      }
      fragId++;
    }
  }

  // rect highlights must sit behind lifelines, messages, and frames but in
  // front of `box` group fills: cell order is z-order, so splice them in
  // right after the two root cells and the box frames.
  if (bgCells.length) cells.splice(2 + (boxId - 1), 0, ...bgCells);

  const pageW = MARGIN_X * 2 + model.participants.length * PITCH;
  const pageH = totalY + HEADER_H + MARGIN_Y;

  const xml = wrapXml(cells, Math.max(850, pageW), Math.max(1100, pageH), diagramName);
  return { xml, warnings: model.warnings };
}

function round(n) {
  return Math.round(n);
}

function wrapXml(cells, w, h, diagramName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="mermaid2drawio" type="device" version="24.0.0">` +
    `<diagram name="${escapeXml(diagramName)}" id="m2d-1">` +
    `<mxGraphModel dx="${w}" dy="${h}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0">` +
    `<root>` +
    cells.join("") +
    `</root>` +
    `</mxGraphModel>` +
    `</diagram>` +
    `</mxfile>`
  );
}
