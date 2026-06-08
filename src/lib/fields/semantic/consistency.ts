// R4/T9b — afId consistency guard (PRD §10, Plan-GAN finding).
// BR11 pins domSelector to `[data-af-id="..."]`. If the page (e.g. a React form) re-renders
// between the scan injection and the fill injection and REASSIGNS a data-af-id to a different
// control, a blind fill would silently write the value into the WRONG box — more dangerous
// than failing to fill. Before writing, we re-check that the element still at that afId matches
// the tag + label we recorded at scan time; on mismatch we skip and report it as failed (BR13).

import { extractNearbyText } from './distill';
import type { AfIdMeta } from './types';

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[\s:：*（）()【】[\]，,。.、/]+/g, ' ')
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length >= 2),
  );
}

/** Loose label match: identical-ish, one contains the other, or non-trivial token overlap. */
export function labelsMatch(expected: string, current: string): boolean {
  const a = expected.trim();
  const b = current.trim();
  if (!a || !b) return true; // nothing reliable to compare → don't block on the label alone
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true;
  let shared = 0;
  ta.forEach((t) => {
    if (tb.has(t)) shared += 1;
  });
  return shared > 0;
}

/**
 * Is the element currently at a given afId still the control we scanned? Tag must match;
 * if we recorded a label, the current nearby text must still plausibly match it.
 * Returns false for a null element (afId vanished) — caller treats that as a failed fill.
 */
export function isAfIdConsistent(el: Element | null, expected: AfIdMeta): boolean {
  if (!el) return false;
  if (el.tagName.toLowerCase() !== expected.tag.toLowerCase()) return false;
  if (!expected.label.trim()) return true; // tag matched and we had no label to verify
  return labelsMatch(expected.label, extractNearbyText(el));
}
