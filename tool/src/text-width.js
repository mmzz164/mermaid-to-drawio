/**
 * Estimate a string's visual width using a simple monospace-style model that
 * accounts for double-width East-Asian (CJK) characters.
 *
 * Returns the number of "ASCII-equivalent columns" the string occupies.
 *
 *   visualWidth("abc")     // 3
 *   visualWidth("日本語")  // 6
 *   visualWidth("ロボット") // 8
 */
export function visualWidth(s) {
  if (s == null) return 0;
  let w = 0;
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (isFullWidth(code)) w += 2;
    else if (code < 0x20) continue;
    else w += 1;
  }
  return w;
}

/**
 * Split a label into wrapped lines and report the visual width of the widest
 * line plus the line count.
 */
export function measureMultiline(label, hardWrap = Infinity) {
  if (!label) return { maxWidth: 0, lineCount: 1 };
  const raw = String(label).split(/<br\s*\/?>|\r?\n/);
  let maxW = 0;
  let lines = 0;
  for (const part of raw) {
    if (part.length === 0) {
      lines += 1;
      continue;
    }
    const w = visualWidth(part);
    if (w <= hardWrap) {
      maxW = Math.max(maxW, w);
      lines += 1;
    } else {
      // wrap roughly every `hardWrap` columns
      let consumed = 0;
      while (consumed < w) {
        maxW = Math.max(maxW, Math.min(hardWrap, w - consumed));
        consumed += hardWrap;
        lines += 1;
      }
    }
  }
  return { maxWidth: maxW, lineCount: Math.max(1, lines) };
}

function isFullWidth(code) {
  // The same intervals used by most CJK width detectors. Not 100% but good
  // enough for diagram labels.
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Kangxi, CJK punct
    (code >= 0x3041 && code <= 0x33ff) || // Hiragana, Katakana, Bopomofo, etc.
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK Compat Forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth signs
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  );
}
