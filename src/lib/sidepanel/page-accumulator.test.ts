import { describe, expect, it } from 'vitest';
import {
  combinePages,
  totalAccumulatedFields,
  currentPageNumber,
  nextPageLabel,
  isLikelySamePage,
  type AccumulatedPage,
} from './page-accumulator';
import type { QAPair } from '@/lib/db/types';

// Minimal QAPair factory — only fieldId + finalValue matter for these tests.
function qa(fieldId: string, finalValue = `val:${fieldId}`): QAPair {
  return {
    fieldId,
    fieldLabel: fieldId,
    fieldType: 'text',
    fieldConstraints: {},
    aiDraft: '',
    aiModel: '',
    finalValue,
    userAction: 'accepted',
    ragReferences: { chunkIds: [], similarities: [] },
    generatedAt: 0,
    retryCount: 0,
  };
}

function page(label: string, ids: string[]): AccumulatedPage {
  return { label, qaPairs: ids.map((id) => qa(id)) };
}

describe('combinePages — consolidate every page into one flat list', () => {
  it('single-page case (no accumulation) is byte-identical to current answers', () => {
    const current = [qa('a'), qa('b')];
    expect(combinePages([], current)).toEqual(current);
  });

  it('concatenates accumulated pages then the current page, in order', () => {
    const acc = [page('第 1 页', ['p1a', 'p1b']), page('第 2 页', ['p2a'])];
    const current = [qa('p3a')];
    const out = combinePages(acc, current);
    expect(out.map((q) => q.fieldId)).toEqual(['p1a', 'p1b', 'p2a', 'p3a']);
  });

  it('NEVER drops a field when two pages mint the SAME fieldId (flat array, not a map)', () => {
    // af-field counter resets per scan, so page 1 and page 2 can both produce
    // "af-field-0-...". A keyed map would collapse these to one entry and lose
    // page 1's answer; the flat array must keep BOTH.
    const acc = [page('第 1 页', ['af-field-0'])];
    const current = [qa('af-field-0', 'page-2-answer')];
    const out = combinePages(acc, current);
    expect(out).toHaveLength(2);
    expect(out.map((q) => q.finalValue)).toEqual(['val:af-field-0', 'page-2-answer']);
  });
});

describe('counters & labels', () => {
  it('totalAccumulatedFields sums accumulated + current', () => {
    const acc = [page('第 1 页', ['a', 'b']), page('第 2 页', ['c'])];
    expect(totalAccumulatedFields(acc, [qa('d'), qa('e')])).toBe(5);
    expect(totalAccumulatedFields([], [qa('a')])).toBe(1);
  });

  it('currentPageNumber / nextPageLabel are 1-based off accumulated length', () => {
    expect(currentPageNumber([])).toBe(1);
    expect(nextPageLabel([])).toBe('第 1 页');
    const acc = [page('第 1 页', ['a'])];
    expect(currentPageNumber(acc)).toBe(2);
    expect(nextPageLabel(acc)).toBe('第 2 页');
  });
});

describe('isLikelySamePage — guard against double-accumulating the same page', () => {
  it('identical scan (site has not advanced) → same page', () => {
    const ids = ['af-field-0-x', 'af-field-1-y', 'af-field-2-z'];
    expect(isLikelySamePage(ids, ids)).toBe(true);
  });

  it('completely different ids (real next page) → not same page', () => {
    expect(isLikelySamePage(['p1a', 'p1b'], ['p2a', 'p2b', 'p2c'])).toBe(false);
  });

  it('majority overlap is treated as the same page', () => {
    // 2 of 3 shared (>50%).
    expect(isLikelySamePage(['a', 'b', 'c'], ['a', 'b', 'zzz'])).toBe(true);
  });

  it('minority overlap (one stray shared id) is a new page', () => {
    // 1 of 4 shared (25%) — below threshold.
    expect(isLikelySamePage(['a', 'b', 'c', 'd'], ['a', 'w', 'x', 'y'])).toBe(false);
  });

  it('empty on either side is never "the same page"', () => {
    expect(isLikelySamePage([], ['a'])).toBe(false);
    expect(isLikelySamePage(['a'], [])).toBe(false);
    expect(isLikelySamePage([], [])).toBe(false);
  });
});
