import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM dispatcher at the network boundary (legitimate unit-test mock; the production
// extract logic — prompt build + parse + map — is exercised for real).
vi.mock('@/lib/claude/client', () => ({ callLLM: vi.fn() }));
import { callLLM } from '@/lib/claude/client';
import { extractFieldsViaLLM, parseSemanticExtractResponse, buildSemanticPrompt } from './extract';
import type { ControlManifestEntry } from './types';

const cfg = { provider: 'anthropic' as const, apiKey: 'k', modelId: 'm' };
const manifest: ControlManifestEntry[] = [{ afId: 'af-0', tag: 'input', nearbyText: '姓名', domConstraints: {} }];

describe('parseSemanticExtractResponse', () => {
  it('parses a clean fields array', () => {
    const out = parseSemanticExtractResponse('{"fields":[{"afIds":["af-0"],"label":"姓名","type":"text","sensitive":"personal"}]}');
    expect(out).toEqual([{ afIds: ['af-0'], label: '姓名', type: 'text', sensitive: 'personal' }]);
  });

  it('tolerates ```json fences and RAW newlines inside string values', () => {
    const dirty = '```json\n{"fields":[{"afIds":["af-1"],"label":"项目\n简介","type":"textarea"}]}\n```';
    const out = parseSemanticExtractResponse(dirty);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]!.afIds).toEqual(['af-1']);
    expect(out![0]!.type).toBe('textarea');
  });

  it('drops entries without afIds and coerces an invalid type to unknown', () => {
    const out = parseSemanticExtractResponse('{"fields":[{"label":"x"},{"afIds":["af-2"],"type":"weird"}]}');
    expect(out).toEqual([{ afIds: ['af-2'], label: '', type: 'unknown' }]);
  });

  it('returns null on UNPARSEABLE text (distinct from a valid empty list)', () => {
    expect(parseSemanticExtractResponse('not json at all')).toBeNull();
  });

  it('returns [] (not null) for a valid but empty fields array', () => {
    expect(parseSemanticExtractResponse('{"fields":[]}')).toEqual([]);
  });
});

describe('buildSemanticPrompt', () => {
  it('instructs the model to only use real afIds and to exclude action controls', () => {
    const { system, user } = buildSemanticPrompt(manifest);
    expect(system).toMatch(/绝不编造/);
    expect(system).toMatch(/排除/);
    expect(user).toContain('af-0');
  });
});

describe('extractFieldsViaLLM', () => {
  beforeEach(() => vi.mocked(callLLM).mockReset());

  it('maps a mocked LLM response into LlmExtractedField[]', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      text: '{"fields":[{"afIds":["af-0"],"label":"姓名","type":"text"}]}',
      usage: { input: 1, output: 1 },
    });
    const out = await extractFieldsViaLLM(manifest, cfg);
    expect(out[0]!.label).toBe('姓名');
  });

  // NB: extractFieldsViaLLM does NOT catch callLLM errors — it rethrows so the orchestrator can
  // decide (hybrid → fall back to heuristic; llm → surface). That PROPAGATION is verified
  // end-to-end in orchestrate.test.ts ("llm mode surfaces the error" / "hybrid LLM failure falls
  // back"): scanHybrid only sees the error because extractFieldsViaLLM rethrows it. Asserting the
  // reject directly here trips a tinyspy async-rejection-tracking flake, so we cover it there.

  it('returns [] when the LLM legitimately reports no fillable fields ({"fields":[]})', async () => {
    vi.mocked(callLLM).mockResolvedValue({ text: '{"fields":[]}', usage: { input: 1, output: 1 } });
    await expect(extractFieldsViaLLM(manifest, cfg)).resolves.toEqual([]);
  });

  it('throws on an UNPARSEABLE LLM response so pure-llm mode can surface ok:false (api.md §5)', async () => {
    // callLLM RESOLVES (no reject) with garbage; extractFieldsViaLLM throws after parse returns null.
    vi.mocked(callLLM).mockResolvedValue({ text: '这不是 JSON', usage: { input: 1, output: 1 } });
    await expect(extractFieldsViaLLM(manifest, cfg)).rejects.toThrow('无法解析');
  });

  it('short-circuits an empty manifest without calling the LLM', async () => {
    const out = await extractFieldsViaLLM([], cfg);
    expect(out).toEqual([]);
    expect(callLLM).not.toHaveBeenCalled();
  });
});
