import { describe, it, expect } from 'vitest';
import { backfillAndValidate } from './backfill';
import type { ControlManifestEntry, LlmExtractedField } from './types';

const manifest: ControlManifestEntry[] = [
  { afId: 'af-0', tag: 'input', inputType: 'text', nearbyText: '姓名', domConstraints: { maxLength: 20 } },
  { afId: 'af-1', tag: 'input', inputType: 'radio', nearbyText: '是', domConstraints: {} },
  { afId: 'af-2', tag: 'input', inputType: 'radio', nearbyText: '否', domConstraints: {} },
  { afId: 'af-3', tag: 'select', nearbyText: '赛道', domConstraints: { options: ['AI', '硬件'] } },
];

describe('backfillAndValidate', () => {
  it('drops fields whose afIds do not exist in the manifest (anti-hallucination, BR4)', () => {
    const llm: LlmExtractedField[] = [{ afIds: ['af-999'], label: 'ghost', type: 'text' }];
    expect(backfillAndValidate(llm, manifest)).toEqual([]);
  });

  it('takes hard constraints from the DOM, not the LLM (BR3), and uses a [data-af-id] selector (BR11)', () => {
    const llm: LlmExtractedField[] = [{ afIds: ['af-0'], label: '姓名', type: 'text' }];
    const out = backfillAndValidate(llm, manifest);
    expect(out[0]!.constraints.maxLength).toBe(20);
    expect(out[0]!.domSelector).toBe('[data-af-id="af-0"]');
    expect(out[0]!.provenance?.source).toBe('llm-semantic');
    expect(out[0]!.provenance?.labelSource).toBe('llm-semantic');
  });

  it('flags sensitive fields as noAiFill even when the LLM missed it (heuristic cross-check, BR5)', () => {
    const llm: LlmExtractedField[] = [{ afIds: ['af-0'], label: '联系人手机号', type: 'tel' }];
    const out = backfillAndValidate(llm, manifest);
    expect(out[0]!.constraints.noAiFill).toBe(true);
    expect(out[0]!.constraints.sensitiveKind).toBe('personal');
  });

  it('honours the LLM sensitive=otp classification', () => {
    const llm: LlmExtractedField[] = [{ afIds: ['af-0'], label: '动态口令', type: 'text', sensitive: 'otp' }];
    const out = backfillAndValidate(llm, manifest);
    expect(out[0]!.constraints.sensitiveKind).toBe('otp');
  });

  it('reconstructs radio-group options from the merged afIds (DOM-derived)', () => {
    const llm: LlmExtractedField[] = [{ afIds: ['af-1', 'af-2'], label: '是否成立公司', type: 'radio' }];
    const out = backfillAndValidate(llm, manifest);
    expect(out[0]!.type).toBe('radio');
    expect(out[0]!.constraints.options).toEqual(['是', '否']);
  });

  it('keeps DOM-known control types (select) over the LLM guess', () => {
    const llm: LlmExtractedField[] = [{ afIds: ['af-3'], label: '参赛赛道', type: 'text' }];
    const out = backfillAndValidate(llm, manifest);
    expect(out[0]!.type).toBe('select');
    expect(out[0]!.constraints.options).toEqual(['AI', '硬件']);
  });

  it('reconstructs type + options for ARIA styled-div role=radio groups (no native inputType)', () => {
    const aria: ControlManifestEntry[] = [
      { afId: 'af-0', tag: 'div', role: 'radio', nearbyText: '是', domConstraints: {} },
      { afId: 'af-1', tag: 'div', role: 'radio', nearbyText: '否', domConstraints: {} },
    ];
    const llm: LlmExtractedField[] = [{ afIds: ['af-0', 'af-1'], label: '是否成立公司', type: 'radio' }];
    const out = backfillAndValidate(llm, aria);
    expect(out[0]!.type).toBe('radio');
    expect(out[0]!.constraints.options).toEqual(['是', '否']);
  });
});
