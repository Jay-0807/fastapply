import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/claude/client', () => ({ callLLM: vi.fn() }));
import { callLLM } from '@/lib/claude/client';
import { scanHybrid } from './orchestrate';
import { clearScanCache } from './scan-cache';
import type { ControlManifestEntry } from './types';
import type { DetectedField } from '@/lib/db/types';

const cfg = { provider: 'anthropic' as const, apiKey: 'k', modelId: 'm' };
const manifest: ControlManifestEntry[] = [
  { afId: 'af-0', tag: 'input', inputType: 'text', nearbyText: '项目名称', domConstraints: {} },
];

function hf(label: string): DetectedField {
  return {
    fieldId: `h-${label}`,
    domSelector: `#${label}`,
    label,
    type: 'text',
    constraints: {},
    rawElementInfo: { tagName: 'input', classes: [] },
    provenance: { source: 'html-input', selector: `#${label}`, visibilityState: 'visible', labelSource: 'label-tag', labelConfidence: 'exact' },
  };
}

function llmText(label: string): string {
  return JSON.stringify({ fields: [{ afIds: ['af-0'], label, type: 'text' }] });
}

describe('scanHybrid', () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
    clearScanCache();
  });

  it('hybrid: LLM failure falls back to heuristic and never white-screens (BR7/F8)', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('429 forever'));
    const heuristicFields = [hf('项目名称')];
    const res = await scanHybrid({ url: 'http://x', mode: 'hybrid', manifest, heuristicFields, llmConfig: cfg });
    expect(res.fields).toEqual(heuristicFields);
    expect(res.meta.mode).toBe('heuristic');
    expect(res.meta.llmFallback).toBe(true);
  });

  it('hybrid: marks consensus when heuristic and LLM agree (no duplicate)', async () => {
    vi.mocked(callLLM).mockResolvedValue({ text: llmText('项目名称'), usage: { input: 1, output: 1 } });
    const res = await scanHybrid({ url: 'http://x1', mode: 'hybrid', manifest, heuristicFields: [hf('项目名称')], llmConfig: cfg });
    expect(res.fields.length).toBe(1);
    expect(res.fields[0]!.provenance?.source).toBe('heuristic+llm');
    expect(res.meta.mode).toBe('hybrid');
  });

  it('hybrid: appends LLM-only fields the heuristic missed (recall ≥ heuristic)', async () => {
    vi.mocked(callLLM).mockResolvedValue({ text: llmText('全新字段'), usage: { input: 1, output: 1 } });
    const heuristicFields = [hf('项目名称')];
    const res = await scanHybrid({ url: 'http://x2', mode: 'hybrid', manifest, heuristicFields, llmConfig: cfg });
    expect(res.fields.length).toBe(2);
    expect(res.meta.mergedCount).toBeGreaterThanOrEqual(heuristicFields.length);
  });

  it('llm mode: surfaces the error instead of falling back (api.md error table)', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('down'));
    await expect(
      scanHybrid({ url: 'http://x3', mode: 'llm', manifest, heuristicFields: [hf('x')], llmConfig: cfg }),
    ).rejects.toThrow('down');
  });

  it('caches the result — a second identical scan hits cache without a new LLM call (F6)', async () => {
    vi.mocked(callLLM).mockResolvedValue({ text: llmText('项目名称'), usage: { input: 1, output: 1 } });
    const heuristicFields = [hf('项目名称')];
    await scanHybrid({ url: 'http://cache', mode: 'hybrid', manifest, heuristicFields, llmConfig: cfg });
    const callsAfterFirst = vi.mocked(callLLM).mock.calls.length;
    const res2 = await scanHybrid({ url: 'http://cache', mode: 'hybrid', manifest, heuristicFields, llmConfig: cfg });
    expect(res2.meta.cacheHit).toBe(true);
    expect(vi.mocked(callLLM).mock.calls.length).toBe(callsAfterFirst);
  });

  it('does NOT falsely merge distinct fields sharing one token — First Name / Last Name (BUG 2)', async () => {
    const m: ControlManifestEntry[] = [{ afId: 'af-0', tag: 'input', inputType: 'text', nearbyText: 'First Name', domConstraints: {} }];
    vi.mocked(callLLM).mockResolvedValue({
      text: JSON.stringify({ fields: [{ afIds: ['af-0'], label: 'First Name', type: 'text' }] }),
      usage: { input: 1, output: 1 },
    });
    const res = await scanHybrid({ url: 'http://en', mode: 'hybrid', manifest: m, heuristicFields: [hf('Last Name')], llmConfig: cfg });
    expect(res.fields.length).toBe(2); // kept distinct, NOT merged into one
    const labels = res.fields.map((f) => f.label);
    expect(labels).toContain('First Name');
    expect(labels).toContain('Last Name');
  });

  it('does NOT cache a fallback result — a recovered LLM is retried on the next scan (BUG 1)', async () => {
    const heuristicFields = [hf('项目名称')];
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('transient 503'));
    const res1 = await scanHybrid({ url: 'http://retry', mode: 'hybrid', manifest, heuristicFields, llmConfig: cfg });
    expect(res1.meta.llmFallback).toBe(true);
    // LLM recovered: the second scan must actually call it again (not serve a cached degraded result).
    vi.mocked(callLLM).mockResolvedValue({ text: llmText('全新字段'), usage: { input: 1, output: 1 } });
    const res2 = await scanHybrid({ url: 'http://retry', mode: 'hybrid', manifest, heuristicFields, llmConfig: cfg });
    expect(res2.meta.cacheHit).toBeFalsy();
    expect(res2.meta.mode).toBe('hybrid');
  });
});
