import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM boundary; the heuristic scanner + tag/distill + merge run for real.
vi.mock('@/lib/claude/client', () => ({ callLLM: vi.fn() }));
import { callLLM } from '@/lib/claude/client';
import { scanFields } from '@/lib/fields/field-scanner';
import { tagInteractiveControls } from './tagger';
import { distillManifest } from './distill';
import { scanHybrid } from './orchestrate';
import { clearScanCache } from './scan-cache';
import { FIXTURES } from './__fixtures__/dogfood-forms';

function keyLabelRecall(detectedLabels: string[], keyLabels: string[]): number {
  const found = keyLabels.filter((k) => detectedLabels.some((l) => l.includes(k) || k.includes(l)));
  return found.length / keyLabels.length;
}

describe('recall regression (representative dogfood corpus, R8)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearScanCache();
    vi.mocked(callLLM).mockReset();
  });

  for (const fx of FIXTURES) {
    it(`heuristic recovers the expected fields in ${fx.name}`, () => {
      document.body.innerHTML = fx.html;
      const labels = scanFields().map((d) => d.label);
      const recall = keyLabelRecall(labels, fx.keyLabels);
      const floor = fx.minRecall ?? 0.5;
      // The floor IS the recorded baseline — if a scanner change drops below it, this fails.
      expect(
        recall,
        `${fx.name} heuristic recall=${recall.toFixed(2)} (floor ${floor}; labels: ${labels.join(' | ')})`,
      ).toBeGreaterThanOrEqual(floor);
    });
  }

  it('hybrid never reduces recall vs heuristic (union property, integration)', async () => {
    const fx = FIXTURES[0]!;
    document.body.innerHTML = fx.html;
    tagInteractiveControls(document);
    const manifest = distillManifest(document);
    const heuristicFields = scanFields();

    // Simulate the LLM surfacing one extra field the heuristic missed.
    const extraAfId = manifest[0]?.afId ?? 'af-0';
    vi.mocked(callLLM).mockResolvedValue({
      text: JSON.stringify({ fields: [{ afIds: [extraAfId], label: '一个启发式没给的新字段', type: 'text' }] }),
      usage: { input: 1, output: 1 },
    });

    const res = await scanHybrid({
      url: 'http://fixture',
      mode: 'hybrid',
      manifest,
      heuristicFields,
      llmConfig: { provider: 'anthropic', apiKey: 'k', modelId: 'm' },
    });
    expect(res.meta.mergedCount).toBeGreaterThanOrEqual(heuristicFields.length);
  });
});
