// R5 — hybrid orchestration (PRD §10 pipeline part 5; the convergence of design-doc "Plan B").
// Ties the pieces together and, crucially, KEEPS the heuristic scanner as the fast path +
// cross-check + offline fallback (F2/F8/F11). Runs in the service worker; it receives the
// already-injected { manifest, heuristicFields } from background (no chrome/DOM dependency here,
// so it's fully unit-testable).
//
//   hybrid : heuristic ∪ LLM, merged with consensus marking; LLM failure → fall back to heuristic (BR7, ok:true).
//   llm    : LLM only; LLM failure → throw (background returns ok:false; api.md error table).
//   (heuristic mode never reaches here — background serves it via the existing scan path.)

import type { DetectedField } from '@/lib/db/types';
import { extractFieldsViaLLM, type SemanticLLMConfig } from './extract';
import { backfillAndValidate } from './backfill';
import { computeDomSignature, getCached, setCached } from './scan-cache';
import type { ControlManifestEntry, ScanResult, ScanResultMeta } from './types';

export interface HybridScanInput {
  url: string;
  mode: 'hybrid' | 'llm';
  manifest: ControlManifestEntry[];
  heuristicFields: DetectedField[];
  llmConfig: SemanticLLMConfig;
}

/** Tokenize a label for overlap-ratio comparison (CJK has no word boundaries → spaceless tokens). */
function labelTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[\s:：*（）()【】[\]，,。.、/]+/g, ' ').split(' ').map((t) => t.trim()).filter((t) => t.length >= 2),
  );
}

/**
 * STRICT label match for consensus merging (BR8). Deliberately stricter than consistency.ts's
 * labelsMatch (which is loose ON PURPOSE for the BR13 fill guard): a single shared token like
 * "name" must NOT merge "First Name" and "Last Name" — that would silently drop the LLM-only field
 * hybrid exists to find (Code-GAN BUG 2). Requires exact equality, substantial containment, or a
 * high token-overlap RATIO.
 */
function strongLabelMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false; // can't confirm consensus without labels → keep distinct
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  if (short.length >= 4 && long.includes(short)) return true; // '项目名称' ⊂ '项目名称：'
  const tx = labelTokens(x);
  const ty = labelTokens(y);
  if (tx.size === 0 || ty.size === 0) return false;
  let shared = 0;
  tx.forEach((t) => {
    if (ty.has(t)) shared += 1;
  });
  return shared / Math.min(tx.size, ty.size) >= 0.6;
}

/** Same underlying field? Same type + a STRICT label match (avoids false consensus, BR8). */
function sameField(a: DetectedField, b: DetectedField): boolean {
  return a.type === b.type && strongLabelMatch(a.label, b.label);
}

/** Mark a field as detected by both heuristic and LLM (consensus). Keeps the heuristic field's
 * battle-tested selector; only upgrades provenance.source. */
function markConsensus(f: DetectedField): DetectedField {
  const prov = f.provenance
    ? { ...f.provenance, source: 'heuristic+llm' as const }
    : {
        source: 'heuristic+llm' as const,
        selector: f.domSelector,
        visibilityState: 'visible' as const,
        labelSource: 'inferred' as const,
        labelConfidence: 'inferred' as const,
      };
  return { ...f, provenance: prov };
}

/** Union heuristic + LLM fields. Overlaps (same field) become consensus; LLM-only are appended. */
function mergeFields(heuristic: DetectedField[], llm: DetectedField[]): DetectedField[] {
  const result = [...heuristic];
  const used = new Set<number>();
  for (const lf of llm) {
    const idx = result.findIndex((hf, i) => !used.has(i) && sameField(hf, lf));
    if (idx >= 0) {
      used.add(idx);
      result[idx] = markConsensus(result[idx]!);
    } else {
      result.push(lf); // LLM caught something the heuristic missed
    }
  }
  return result;
}

export async function scanHybrid(input: HybridScanInput): Promise<ScanResult> {
  const { url, mode, manifest, heuristicFields, llmConfig } = input;
  const heuristicCount = heuristicFields.length;
  const signature = computeDomSignature(url, manifest);

  const cached = getCached(signature);
  if (cached) {
    return {
      fields: cached,
      meta: { mode, heuristicCount, mergedCount: cached.length, cacheHit: true },
    };
  }

  let llmFields: DetectedField[];
  try {
    const extracted = await extractFieldsViaLLM(manifest, llmConfig);
    llmFields = backfillAndValidate(extracted, manifest);
  } catch (err) {
    if (mode === 'llm') throw err; // pure-LLM mode surfaces the error (ok:false)
    // hybrid: never white-screen — fall back to the heuristic result (BR7).
    const msg = err instanceof Error ? err.message : String(err);
    const meta: ScanResultMeta = {
      mode: 'heuristic',
      heuristicCount,
      mergedCount: heuristicCount,
      llmFallback: true,
      llmError: msg,
    };
    // Do NOT cache a fallback — a transient LLM failure (429/timeout) must not disable the LLM
    // pass for the rest of the session; the next scan retries (Code-GAN BUG 1).
    return { fields: heuristicFields, meta };
  }

  if (mode === 'llm') {
    setCached(signature, llmFields);
    return {
      fields: llmFields,
      meta: { mode: 'llm', heuristicCount, llmCount: llmFields.length, mergedCount: llmFields.length },
    };
  }

  const merged = mergeFields(heuristicFields, llmFields);
  setCached(signature, merged);
  return {
    fields: merged,
    meta: { mode: 'hybrid', heuristicCount, llmCount: llmFields.length, mergedCount: merged.length },
  };
}
