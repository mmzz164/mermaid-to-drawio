/**
 * Minimal Mermaid gantt parser.
 *
 * Supported subset:
 *   title <text>
 *   dateFormat <fmt>       (YYYY/YY/MM/DD/HH/mm/ss tokens, e.g. YYYY-MM-DD)
 *   section <name>
 *   <task name> : [crit,] [active|done,] [milestone,] [id,] [start,] end
 *     start: a date, or `after id1 [id2 ...]`
 *     end:   a date, a duration (30d / 2w / 12h / 90m / 30s), or `until id`
 *
 * Metadata item count follows Mermaid: after stripping leading tags,
 *   1 item  -> end only (start = previous task's end)
 *   2 items -> start, end
 *   3 items -> id, start, end
 *
 * `axisFormat` / `tickInterval` / `todayMarker` / `weekend` are presentation
 * hints and skipped silently. `excludes` affects date math and is NOT
 * supported — it produces a warning.
 */

const TAGS = new Set(["active", "done", "crit", "milestone"]);

const DURATION_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Build a date-string parser for a Mermaid/dayjs-style format. Returns a
 * function (string) -> epoch-ms (UTC) or null when the string doesn't match.
 */
export function buildDateParser(fmt) {
  const TOKENS = ["YYYY", "YY", "MM", "M", "DD", "D", "HH", "H", "mm", "m", "ss", "s"];
  const TOKEN_RE = {
    YYYY: "(\\d{4})",
    YY: "(\\d{2})",
    MM: "(\\d{2})",
    M: "(\\d{1,2})",
    DD: "(\\d{2})",
    D: "(\\d{1,2})",
    HH: "(\\d{2})",
    H: "(\\d{1,2})",
    mm: "(\\d{2})",
    m: "(\\d{1,2})",
    ss: "(\\d{2})",
    s: "(\\d{1,2})",
  };
  const fields = [];
  let pattern = "";
  let i = 0;
  while (i < fmt.length) {
    const tok = TOKENS.find((t) => fmt.startsWith(t, i));
    if (tok) {
      fields.push(tok);
      pattern += TOKEN_RE[tok];
      i += tok.length;
    } else {
      pattern += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  const re = new RegExp(`^${pattern}$`);
  return (str) => {
    const m = str.match(re);
    if (!m) return null;
    const v = { year: 1970, month: 1, day: 1, hour: 0, min: 0, sec: 0 };
    fields.forEach((f, idx) => {
      const n = parseInt(m[idx + 1], 10);
      if (f === "YYYY") v.year = n;
      else if (f === "YY") v.year = 2000 + n;
      else if (f === "MM" || f === "M") v.month = n;
      else if (f === "DD" || f === "D") v.day = n;
      else if (f === "HH" || f === "H") v.hour = n;
      else if (f === "mm" || f === "m") v.min = n;
      else if (f === "ss" || f === "s") v.sec = n;
    });
    if (v.month < 1 || v.month > 12 || v.day < 1 || v.day > 31) return null;
    return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.min, v.sec);
  };
}

function parseDuration(str) {
  const m = str.match(/^(\d+(?:\.\d+)?)([smhdw])$/);
  if (!m) return null;
  return parseFloat(m[1]) * DURATION_MS[m[2]];
}

/**
 * @param {string} source
 * @returns {{
 *   title: string|null,
 *   dateFormat: string,
 *   sections: Array<{name:string, tasks:Array<object>}>,
 *   warnings: string[],
 * }}
 */
export function parseGantt(source) {
  const lines = source.split(/\r?\n/);
  const warnings = [];
  const sections = [];
  const byId = new Map();
  let title = null;
  let dateFormat = "YYYY-MM-DD";
  let parseDate = buildDateParser(dateFormat);
  let started = false;
  let inFrontMatter = false;
  let currentSection = null;
  let prevTask = null;
  let lineNo = 0;

  function section(name) {
    currentSection = { name, tasks: [] };
    sections.push(currentSection);
    return currentSection;
  }

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
      if (/^gantt\b/i.test(line)) started = true;
      continue;
    }

    let m;
    if ((m = line.match(/^title\s+(.+)$/i))) {
      title = m[1].trim();
      continue;
    }
    if ((m = line.match(/^dateFormat\s+(.+)$/i))) {
      dateFormat = m[1].trim();
      parseDate = buildDateParser(dateFormat);
      continue;
    }
    if (/^(axisFormat|tickInterval|todayMarker|weekend|weekday|inclusiveEndDates|topAxis|displayMode)\b/i.test(line)) {
      continue; // presentation hints: skipped silently
    }
    if (/^excludes\b/i.test(line)) {
      warnings.push(`Line ${lineNo}: 'excludes' is not supported; dates are computed without exclusions`);
      continue;
    }
    if (/^acc(Title|Descr)\b/i.test(line)) continue;
    if ((m = line.match(/^section\s+(.+)$/i))) {
      section(m[1].trim());
      continue;
    }

    // Task line: "name : meta, meta, ..."
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const name = line.slice(0, colonIdx).trim();
      const items = line
        .slice(colonIdx + 1)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const task = {
        name,
        id: null,
        start: null,
        end: null,
        active: false,
        done: false,
        crit: false,
        milestone: false,
      };
      while (items.length && TAGS.has(items[0])) {
        task[items.shift()] = true;
      }

      let startStr = null;
      let endStr = null;
      if (items.length === 1) {
        endStr = items[0];
      } else if (items.length === 2) {
        [startStr, endStr] = items;
      } else if (items.length >= 3) {
        if (items.length > 3) {
          warnings.push(`Line ${lineNo}: extra task metadata ignored: ${items.slice(3).join(", ")}`);
        }
        [task.id, startStr, endStr] = items;
      } else {
        warnings.push(`Line ${lineNo}: task has no date metadata: ${line}`);
        continue;
      }

      // Resolve start
      if (startStr === null) {
        task.start = prevTask ? prevTask.end : null;
        if (task.start === null) {
          warnings.push(`Line ${lineNo}: first task has no start date; skipped: ${name}`);
          continue;
        }
      } else if ((m = startStr.match(/^after\s+(.+)$/i))) {
        const refs = m[1].split(/\s+/);
        let best = null;
        for (const r of refs) {
          const t = byId.get(r);
          if (t) best = best === null ? t.end : Math.max(best, t.end);
          else warnings.push(`Line ${lineNo}: 'after ${r}' refers to unknown task id`);
        }
        task.start = best ?? (prevTask ? prevTask.end : null);
        if (task.start === null) {
          warnings.push(`Line ${lineNo}: could not resolve start; skipped: ${name}`);
          continue;
        }
      } else {
        task.start = parseDate(startStr);
        if (task.start === null) {
          warnings.push(`Line ${lineNo}: could not parse date '${startStr}' with format '${dateFormat}'; skipped: ${name}`);
          continue;
        }
      }

      // Resolve end
      if ((m = endStr.match(/^until\s+(\S+)$/i))) {
        const t = byId.get(m[1]);
        if (t) task.end = t.start;
        else {
          warnings.push(`Line ${lineNo}: 'until ${m[1]}' refers to unknown task id; skipped: ${name}`);
          continue;
        }
      } else {
        const dur = parseDuration(endStr);
        if (dur !== null) {
          task.end = task.start + dur;
        } else {
          task.end = parseDate(endStr);
          if (task.end === null) {
            warnings.push(`Line ${lineNo}: could not parse end '${endStr}'; skipped: ${name}`);
            continue;
          }
        }
      }
      if (task.end < task.start) {
        warnings.push(`Line ${lineNo}: task '${name}' ends before it starts; clamped`);
        task.end = task.start;
      }

      if (!currentSection) section("");
      currentSection.tasks.push(task);
      if (task.id) byId.set(task.id, task);
      prevTask = task;
      continue;
    }

    warnings.push(`Line ${lineNo}: could not parse gantt line: ${line}`);
  }

  return { title, dateFormat, sections, warnings };
}
