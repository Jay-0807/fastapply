// Field post-processing: clean the DISPLAY label, parse the min-length floor,
// and order fields in visual reading order. Pure + unit-tested so the messy
// real-form cases (深创赛 etc.) have a regression net the scanner itself can't
// easily get (Chrome MCP can't drive the sidepanel — see dogfood memory).
//
// Why post-processing instead of changing detection: the heuristic merges a
// field's parent heading with its inner label as `${heading} - ${inner}`
// (analyzeElement), and the inner label falls back to the control's PLACEHOLDER
// when there's no <label>. So a textarea titled "项目概要" with placeholder
// "产品开发：…" becomes label "项目概要 - 产品开发：…" — the 副标题 (placeholder)
// swallowed into the 主标题. Constraints are extracted from the RAW label first
// (so "（最少200字，最多不超过1000字）" is still parsed); THEN we clean the label
// for display. Touching detection risks the 50+ scanner fixtures; cleaning the
// output does not.

/** "最少 200 字" / "至少 200 字" / "不少于 200 字" / "200 字以上" / "min 200 words". */
const MIN_LENGTH_PATTERNS: RegExp[] = [
  /(?:最少|至少|不少于|不低于|最低|起码|下限)\s*(\d{1,5})\s*(?:字|个字|汉字)/,
  /(\d{1,5})\s*(?:字|个字|汉字)\s*(?:以上|起步|起|打底|或以上)/,
  /(?:min(?:imum)?|at least|no fewer than|no less than)\s+(\d{1,5})\s+(?:words?|chars?|characters?)/i,
  /(\d{1,5})\s+(?:words?|chars?|characters?)\s+(?:min(?:imum)?|or more|or above)/i,
];

/** First min-length hint in `text`, or undefined. Pure. */
export function extractMinLength(text: string): number | undefined {
  for (const pat of MIN_LENGTH_PATTERNS) {
    const m = text.match(pat);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  return undefined;
}

const LEAD_PREFIX = /^(?:请输入您的|请输入你的|请填写您的|请填写你的|请输入|请填写|请描述|请说明|请填|请选择)\s*/;
// A trailing "(...)" / "（...）" whose contents look like a length hint (a digit
// next to 字/字数/word/char). We only strip THESE — parentheticals like
// "（可增加）" carry meaning and stay.
// 字 must be the length unit, not the head of 字段/字条/字符/字节/字句/字母 (so
// "（第3字段）" is left alone); 字数 is allowed (it IS a length word).
const TRAILING_LENGTH_PAREN = /\s*[（(][^（()）]*\d{1,5}\s*(?:字(?![段条符节句母])|words?|chars?|characters?)[^（()）]*[)）]\s*$/i;

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Is this placeholder a content HINT (副标题) rather than a real sub-field label?
 * Hints are long, sentence-punctuated, or a generic "请输入…" prompt. Short,
 * unpunctuated placeholders like "姓名"/"职业" are genuine sub-labels and must
 * survive into a compound title. Heuristic, deliberately conservative — when
 * unsure (short + clean), treat as a real label and keep it.
 */
function isHintLikePlaceholder(ph: string): boolean {
  return ph.length >= 8 || /[，。：、；,.;！？!?]/.test(ph) || LEAD_PREFIX.test(ph);
}

/**
 * Turn a raw scanned label into a clean main title (主标题):
 *  - drop a trailing " - <placeholder>" segment the heuristic merged in (副标题),
 *  - drop a leading 请输入/请填写… prompt prefix,
 *  - drop leading * and trailing :,
 *  - drop a trailing length-hint parenthetical "（最少200字…）" (already parsed
 *    into constraints by the caller).
 * Never returns empty: if cleaning would wipe the label, the squashed original
 * is returned instead.
 */
export function cleanDisplayLabel(rawLabel: string, placeholder?: string): string {
  const original = squash(rawLabel);
  if (!original) return original;
  let t = original;

  // 1. Drop a " - <placeholder>" / " — <placeholder>" tail that duplicates the
  //    control's placeholder — BUT only when the placeholder is a content HINT
  //    (副标题), not a genuine short sub-field label. "产品开发：生产策略…" and
  //    "请输入内容" are hints → drop; "姓名" / "职业" under a "出席项目队员" heading
  //    are real sub-labels → keep the compound "出席项目队员 - 姓名".
  const ph = squash(placeholder ?? '');
  if (ph && isHintLikePlaceholder(ph)) {
    const parts = t.split(/\s+[-—–]\s+/);
    if (parts.length >= 2) {
      const last = squash(parts[parts.length - 1]!);
      const same = last === ph || ph.startsWith(last) || last.startsWith(ph);
      if (same) t = parts.slice(0, -1).join(' - ');
    }
  }

  // 2. Leading prompt prefix + required marker, trailing colon.
  t = t.replace(/^[*＊✱\s]+/, '');
  t = t.replace(LEAD_PREFIX, '');
  t = t.replace(/[：:]\s*$/, '');

  // 3. Trailing length-hint parenthetical.
  t = t.replace(TRAILING_LENGTH_PAREN, '');

  t = squash(t);
  return t || original;
}

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Visual reading order (top→bottom, then left→right within a row) for a list of
 * element rects. Returns the indices of `rects` in reading order, or **null**
 * when there's no usable layout (every rect is zero-sized — e.g. happy-dom in
 * tests, or pre-layout). Null tells the caller to fall back to DOM order, which
 * keeps the existing test fixtures (zero rects) byte-identical.
 *
 * Rows are formed by vertical overlap: an element joins the current row if its
 * top is above the row's running bottom (they overlap vertically). Ties resolve
 * by original index, so the sort is stable.
 */
export function readingOrder(rects: readonly RectLike[]): number[] | null {
  if (rects.length === 0) return null;
  const hasBox = (i: number) => rects[i]!.width > 0 || rects[i]!.height > 0;

  // Only elements that actually have a box can be placed by geometry. No-box
  // fields (display:none, conditional wizard steps, pre-paint) keep their DOM
  // order and go LAST — they're not visible now, so they have no reading
  // position; putting them at top:0 (their fake rect) would wrongly hoist them.
  const laid = rects.map((_, i) => i).filter(hasBox);
  const noBox = rects.map((_, i) => i).filter((i) => !hasBox(i));
  if (laid.length === 0) return null; // no layout at all → caller uses DOM order

  laid.sort((a, b) => {
    const ra = rects[a]!;
    const rb = rects[b]!;
    if (ra.top !== rb.top) return ra.top - rb.top;
    if (ra.left !== rb.left) return ra.left - rb.left;
    return a - b;
  });

  // Band into rows against the row ANCHOR's box (the first element's vertical
  // span), NOT a running max-bottom. Anchoring stops a tall control (e.g. a
  // 120px textarea) from chaining the bands of the rows below it into one giant
  // row that then gets re-sorted by column. An element joins the current row
  // only if its top falls inside the anchor's box.
  const rows: number[][] = [];
  let anchorBottom = -Infinity;
  for (const i of laid) {
    const r = rects[i]!;
    if (rows.length === 0 || r.top >= anchorBottom) {
      rows.push([i]);
      anchorBottom = r.top + Math.max(r.height, 0);
    } else {
      rows[rows.length - 1]!.push(i);
    }
  }
  for (const row of rows) {
    row.sort((a, b) => {
      const ra = rects[a]!;
      const rb = rects[b]!;
      if (ra.left !== rb.left) return ra.left - rb.left;
      return a - b;
    });
  }
  return [...rows.flat(), ...noBox];
}
