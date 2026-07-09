/**
 * Minimal Mermaid pie chart parser.
 *
 * Supported subset:
 *   pie
 *   pie showData
 *   pie title Chart title
 *   pie showData title Chart title
 *   title Chart title            (on its own line)
 *   showData                     (on its own line)
 *   "Label" : 42.5
 *   Label : 42.5                 (unquoted labels tolerated)
 *
 * `accTitle` / `accDescr` are skipped silently. Negative or non-numeric
 * values are skipped with a warning. Zero-value slices are kept (they get
 * a legend entry but no arc), matching Mermaid.
 */

/**
 * @param {string} source
 * @returns {{
 *   title: string|null,
 *   showData: boolean,
 *   slices: Array<{label:string, value:number}>,
 *   warnings: string[],
 * }}
 */
export function parsePieChart(source) {
  const lines = source.split(/\r?\n/);
  const slices = [];
  const warnings = [];
  let title = null;
  let showData = false;
  let started = false;
  let inFrontMatter = false;
  let lineNo = 0;

  for (const raw of lines) {
    lineNo++;
    const line = raw.replace(/%%.*$/, "").trim();
    if (!line) continue;
    if (!started && line === "---") {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;

    if (!started) {
      const m = line.match(/^pie\b(.*)$/i);
      if (!m) continue;
      started = true;
      let rest = m[1].trim();
      const sd = rest.match(/^showData\b(.*)$/i);
      if (sd) {
        showData = true;
        rest = sd[1].trim();
      }
      const tm = rest.match(/^title\s+(.+)$/i);
      if (tm) title = unquote(tm[1].trim());
      else if (rest) warnings.push(`Line ${lineNo}: ignored after 'pie': ${rest}`);
      continue;
    }

    if (/^showData$/i.test(line)) {
      showData = true;
      continue;
    }
    let m = line.match(/^title\s+(.+)$/i);
    if (m) {
      title = unquote(m[1].trim());
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(line)) continue;

    m =
      line.match(/^"([^"]*)"\s*:\s*(-?[0-9]*\.?[0-9]+)\s*$/) ||
      line.match(/^([^:"]+?)\s*:\s*(-?[0-9]*\.?[0-9]+)\s*$/);
    if (m) {
      const label = m[1].trim();
      const value = parseFloat(m[2]);
      if (!Number.isFinite(value) || value < 0) {
        warnings.push(`Line ${lineNo}: skipped invalid pie value: ${line}`);
      } else {
        slices.push({ label, value });
      }
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse pie entry: ${line}`);
  }

  return { title, showData, slices, warnings };
}

function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
