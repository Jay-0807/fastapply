// Multi-page registration accumulator (2026-06-28).
//
// Real 创赛 / 孵化器 / 高校 forms are wizards: 赛区 → 基本信息 → 团队 → …, each a
// fresh page. The user wants to fill EVERY page and then seal the whole thing as
// ONE experience record (PM decision 2026-06-28), not one-record-per-page (the
// old V2.7 model). This module owns the pure data logic for that accumulation so
// it can be unit-tested away from the React/Chrome surface.
//
// ⚠️ Load-bearing invariant (data integrity): the combined Q&A is a FLAT ARRAY,
// never a fieldId-keyed map. fieldId = `af-field-${counter}-${hash(containerHTML)}`
// and `counter` resets every scan, so two pages can mint the SAME fieldId (same
// index + structurally identical container). A keyed map would silently overwrite
// page 1's answer with page 2's; a flat array cannot drop a field. Same lesson
// family as the "去重循环必须回灌新建项" bugs (seed-import / bulk-import).

import type { QAPair } from '@/lib/db/types';

/** One finished page held in the accumulator, awaiting the final consolidated seal. */
export interface AccumulatedPage {
  /** Human label for the banner, e.g. "第 1 页". */
  label: string;
  /** The page's Q&A as it stood when the user advanced to the next page. */
  qaPairs: QAPair[];
}

/**
 * Combine every prior accumulated page plus the current page into ONE flat
 * QAPair list for a single consolidated QARecord. Order = accumulation order,
 * current page last (matches the order the user filled them). Returns a flat
 * array specifically so cross-page fieldId collisions cannot drop a field.
 */
export function combinePages(accumulated: AccumulatedPage[], current: QAPair[]): QAPair[] {
  return [...accumulated.flatMap((p) => p.qaPairs), ...current];
}

/** Total field count across accumulated pages + the current page (for the banner). */
export function totalAccumulatedFields(accumulated: AccumulatedPage[], current: QAPair[]): number {
  return accumulated.reduce((n, p) => n + p.qaPairs.length, 0) + current.length;
}

/** 1-based page number the user is currently on (accumulated pages + this one). */
export function currentPageNumber(accumulated: AccumulatedPage[]): number {
  return accumulated.length + 1;
}

/** Build the next page's label from how many pages are already accumulated. */
export function nextPageLabel(accumulated: AccumulatedPage[]): string {
  return `第 ${accumulated.length + 1} 页`;
}

/**
 * Heuristic guard: has the website NOT actually advanced to a new page?
 *
 * True when the freshly-scanned fields overlap heavily (by fieldId) with the
 * page we're leaving. fieldId embeds a hash of the container HTML, so an
 * unchanged page yields (near-)identical ids, while a genuine next page yields
 * almost none in common. Returning true means "don't snapshot, don't advance" —
 * it stops the same page being accumulated twice when the user clicks 下一页
 * before clicking the site's own 下一步/保存.
 *
 * Empty on either side → false (can't be "the same page" if there's nothing to
 * compare; an empty new scan is handled separately by the caller).
 */
export function isLikelySamePage(
  prevFieldIds: readonly string[],
  newFieldIds: readonly string[],
  threshold = 0.5,
): boolean {
  if (prevFieldIds.length === 0 || newFieldIds.length === 0) return false;
  const prev = new Set(prevFieldIds);
  const overlap = newFieldIds.filter((id) => prev.has(id)).length;
  return overlap / Math.max(prevFieldIds.length, newFieldIds.length) > threshold;
}
