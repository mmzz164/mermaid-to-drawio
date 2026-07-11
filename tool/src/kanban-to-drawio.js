import { escapeXml, round, wrapXml, PASTEL, darken, bodyLines } from "./drawio-xml.js";
import { measureMultiline } from "./text-width.js";

/**
 * Minimal Mermaid kanban parser.
 *
 *   kanban
 *     Todo
 *       [Create documentation]
 *       docs[Create blog post]
 *     id2[In progress]
 *       id6[Create renderer]
 *
 * Indentation separates columns (top level) from cards (nested). Both
 * accept `id[text]` or bare text. `@{ ... }` metadata (assigned, ticket,
 * priority) is parsed; `priority` tints the card border, the rest is
 * appended as a small second line.
 */
export function parseKanban(source) {
  const warnings = [];
  const columns = [];
  let currentColumn = null;
  let columnIndent = null;
  let lastCard = null;

  function parseMetaInto(card, body) {
    for (const kv of body.split(",")) {
      const kvm = kv.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
      if (kvm) {
        card.meta[kvm[1]] = kvm[2].replace(/^['"]|['"]$/g, "");
      }
    }
  }

  for (const { line, trimmed, lineNo } of bodyLines(source, /^kanban\b/i)) {
    // Metadata on its own line attaches to the previous card (tolerated even
    // though mermaid itself requires the inline form).
    let m;
    if ((m = trimmed.match(/^@\{(.*)\}$/))) {
      if (!lastCard) {
        warnings.push(`Line ${lineNo}: metadata with no card: ${trimmed}`);
        continue;
      }
      parseMetaInto(lastCard, m[1]);
      continue;
    }

    // Mermaid's canonical form puts metadata inline: `id6[Task]@{ assigned: 'x' }`
    let itemSrc = trimmed;
    let metaBody = null;
    if ((m = trimmed.match(/^(.+?)@\{(.*)\}\s*$/))) {
      itemSrc = m[1].trim();
      metaBody = m[2];
    }

    const indent = line.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
    const text = parseItemText(itemSrc);
    if (columnIndent === null || indent <= columnIndent) {
      columnIndent = indent;
      currentColumn = { name: text, cards: [] };
      columns.push(currentColumn);
      lastCard = null;
    } else {
      if (!currentColumn) {
        currentColumn = { name: "", cards: [] };
        columns.push(currentColumn);
      }
      lastCard = { text, meta: {} };
      if (metaBody) parseMetaInto(lastCard, metaBody);
      currentColumn.cards.push(lastCard);
    }
  }

  return { columns, warnings };
}

function parseItemText(s) {
  const m = s.match(/^[^\s[\]]*\[(.+)\]$/);
  return m ? m[1].trim() : s.trim();
}

const COL_W = 220;
const COL_GAP = 16;
const MARGIN = 20;
const HEADER_H = 34;
const CARD_GAP = 8;
const PRIORITY_COLOR = {
  "very high": "#cc0000",
  high: "#e06c5f",
  low: "#7ac36a",
  "very low": "#4e7f44",
};

/**
 * Convert a Mermaid kanban board to draw.io XML: one column per lane with a
 * colored header and stacked cards. Priority metadata colors the card
 * border; assigned/ticket render as a smaller second line.
 */
export function kanbanToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseKanban(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.columns.length === 0) {
    warnings.push("kanban has no columns");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  let maxBottom = 0;
  model.columns.forEach((colDef, ci) => {
    const x = MARGIN + ci * (COL_W + COL_GAP);
    const fill = PASTEL[ci % PASTEL.length];
    let y = MARGIN + HEADER_H + CARD_GAP;
    const colCells = [];
    colDef.cards.forEach((card, i) => {
      const sub = [card.meta.assigned, card.meta.ticket].filter(Boolean).join(" · ");
      // HTML labels are stored XML-escaped in the value attribute.
      const label = sub
        ? escapeXml(
            `${escapeXml(card.text)}<br><font style="font-size:9px" color="#666666">${escapeXml(sub)}</font>`
          )
        : escapeXml(card.text);
      const lines = measureMultiline(card.text, 26).lineCount + (sub ? 1 : 0);
      const h = Math.max(34, lines * 16 + 16);
      const prio = (card.meta.priority || "").toLowerCase();
      const stroke = PRIORITY_COLOR[prio] || "#cccccc";
      const strokeW = PRIORITY_COLOR[prio] ? "strokeWidth=2;" : "";
      colCells.push(
        `<mxCell id="kb-card-${ci}-${i}" value="${label}" ` +
          `style="rounded=1;html=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=${stroke};${strokeW}align=left;spacingLeft=8;fontSize=11;shadow=1;" vertex="1" parent="1">` +
          `<mxGeometry x="${x + 8}" y="${round(y)}" width="${COL_W - 16}" height="${round(h)}" as="geometry" />` +
          `</mxCell>`
      );
      y += h + CARD_GAP;
    });
    const colH = Math.max(y + CARD_GAP, MARGIN + HEADER_H + 60) - MARGIN;
    // Column background + header drawn first so cards sit on top.
    cells.push(
      `<mxCell id="kb-col-${ci}" value="" ` +
        `style="rounded=1;html=1;fillColor=#f5f5f5;strokeColor=#d0d0d0;" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${MARGIN}" width="${COL_W}" height="${round(colH)}" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(
      `<mxCell id="kb-head-${ci}" value="${escapeXml(colDef.name)}" ` +
        `style="rounded=1;html=1;whiteSpace=wrap;fillColor=${fill};strokeColor=${darken(fill)};fontStyle=1;fontSize=12;" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${MARGIN}" width="${COL_W}" height="${HEADER_H}" as="geometry" />` +
        `</mxCell>`
    );
    cells.push(...colCells);
    maxBottom = Math.max(maxBottom, MARGIN + colH);
  });

  const pageW = MARGIN * 2 + model.columns.length * (COL_W + COL_GAP);
  const pageH = maxBottom + MARGIN;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
