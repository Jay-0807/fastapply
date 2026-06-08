import { describe, it, expect } from 'vitest';
import { hardTruncate } from './client';

// Problem-2 fix (2026-05-31 dogfood): the last-resort truncation must never
// hand the user half a sentence (the form said "不超过 200 字" and the old
// hardTruncate blindly sliced at exactly 200, cutting mid-sentence). It now
// walks back to the last sentence end, then a clause break, then hard-clips.
describe('hardTruncate — sentence-aware truncation (2026-05-31)', () => {
  it('returns text unchanged when within the limit', () => {
    expect(hardTruncate('短答案', 10)).toBe('短答案');
  });

  it('cuts back to the last full sentence instead of mid-sentence', () => {
    // "。" sits at index 7; limit 10 → end on the period, not at char 10.
    const out = hardTruncate('我们做AI产品。然后还有很多额外内容补充说明', 10);
    expect(out).toBe('我们做AI产品。');
    expect(Array.from(out).length).toBeLessThanOrEqual(10);
  });

  it('falls back to a clause break when there is no sentence end in range', () => {
    const out = hardTruncate('我们做AI产品，然后还有很多额外内容补充说明', 10);
    expect(out).toBe('我们做AI产品，');
  });

  it('hard-clips when a single sentence is longer than the whole budget', () => {
    const out = hardTruncate('我们是一家专注人工智能的科技创业公司团队', 8);
    expect(Array.from(out).length).toBe(8);
  });

  it('prefers an EARLY complete sentence over a longer mid-content fragment (overshoot case)', () => {
    // The real bug: the model overshot the cap, the only period sat early, and
    // the old 0.6 floor skipped it and fell to a comma / hard cut → half sentence.
    // Now completeness wins: end on the period even though it is short.
    const text = 'We build it. Then a long second clause that runs on and on far past the limit';
    expect(hardTruncate(text, 30)).toBe('We build it.');
  });
});
