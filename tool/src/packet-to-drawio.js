import { escapeXml, round, wrapXml, bodyLines, unquote } from "./drawio-xml.js";

/**
 * Minimal Mermaid packet diagram parser (packet / packet-beta).
 *
 *   packet-beta
 *     title TCP Packet
 *     0-15: "Source Port"
 *     16-31: "Destination Port"
 *     32: "Flag"
 *     +16: "Checksum"        (v11.7 relative form: next 16 bits)
 */
export function parsePacket(source) {
  const warnings = [];
  const fields = [];
  let title = null;
  let nextBit = 0;

  for (const { trimmed, lineNo } of bodyLines(source, /^packet(-beta)?\b/i)) {
    let m;
    if ((m = trimmed.match(/^title\s+(.+)$/i))) {
      title = m[1].trim();
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^\+(\d+)\s*:\s*(.+)$/))) {
      const width = parseInt(m[1], 10);
      fields.push({ start: nextBit, end: nextBit + width - 1, label: unquote(m[2]) });
      nextBit += width;
      continue;
    }
    if ((m = trimmed.match(/^(\d+)(?:\s*-\s*(\d+))?\s*:\s*(.+)$/))) {
      const start = parseInt(m[1], 10);
      const end = m[2] !== undefined ? parseInt(m[2], 10) : start;
      if (end < start) {
        warnings.push(`Line ${lineNo}: bit range ends before it starts: ${trimmed}`);
        continue;
      }
      fields.push({ start, end, label: unquote(m[3]) });
      nextBit = end + 1;
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse packet line: ${trimmed}`);
  }

  return { title, fields, warnings };
}

const BITS_PER_ROW = 32;
const BIT_W = 26;
const ROW_H = 40;
const MARGIN = 20;
const TITLE_H = 34;

/**
 * Convert a Mermaid packet diagram to draw.io XML: 32 bits per row, fields
 * as boxes (split across rows when they span one), start/end bit numbers
 * above each box edge.
 */
export function packetToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parsePacket(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.fields.length === 0) {
    warnings.push("packet diagram has no fields");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const topY = MARGIN + (model.title ? TITLE_H : 0) + 14; // headroom for bit numbers
  if (model.title) {
    cells.push(
      `<mxCell id="pk-title" value="${escapeXml(model.title)}" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${MARGIN}" y="${MARGIN}" width="${BITS_PER_ROW * BIT_W}" height="${TITLE_H}" as="geometry" />` +
        `</mxCell>`
    );
  }

  let maxRow = 0;
  let id = 0;
  for (const field of model.fields) {
    // Split the bit range at row boundaries.
    let s = field.start;
    let first = true;
    while (s <= field.end) {
      const row = Math.floor(s / BITS_PER_ROW);
      const rowEnd = Math.min(field.end, (row + 1) * BITS_PER_ROW - 1);
      maxRow = Math.max(maxRow, row);
      const x = MARGIN + (s % BITS_PER_ROW) * BIT_W;
      const w = (rowEnd - s + 1) * BIT_W;
      const y = topY + row * (ROW_H + 18);
      const label = first ? field.label : `${field.label} (cont.)`;
      cells.push(
        `<mxCell id="pk-f-${id}" value="${escapeXml(label)}" ` +
          `style="rounded=0;html=1;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${ROW_H}" as="geometry" />` +
          `</mxCell>`
      );
      // Start/end bit numbers above the box corners.
      cells.push(
        `<mxCell id="pk-b-${id}-s" value="${s}" style="text;html=1;align=left;verticalAlign=bottom;fontSize=9;fontColor=#888888;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(x)}" y="${round(y - 14)}" width="40" height="14" as="geometry" />` +
          `</mxCell>`
      );
      if (rowEnd > s) {
        cells.push(
          `<mxCell id="pk-b-${id}-e" value="${rowEnd}" style="text;html=1;align=right;verticalAlign=bottom;fontSize=9;fontColor=#888888;" vertex="1" parent="1">` +
            `<mxGeometry x="${round(x + w - 40)}" y="${round(y - 14)}" width="40" height="14" as="geometry" />` +
            `</mxCell>`
        );
      }
      id++;
      s = rowEnd + 1;
      first = false;
    }
  }

  const pageW = MARGIN * 2 + BITS_PER_ROW * BIT_W;
  const pageH = topY + (maxRow + 1) * (ROW_H + 18) + MARGIN;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
