// R7 — scan-result cache (PRD §10 pipeline support).
// Keyed by URL + a lightweight DOM signature (control count + label/tag hash). Repeated scans
// of the same unchanged page return the cached merged fields without re-calling the LLM (F6:
// cost/latency). Session-scoped in-memory Map — scanning is infrequent (a few times per
// application), the data is transient, and a heavyweight LRU dependency buys nothing here.

import type { DetectedField } from '@/lib/db/types';
import type { ControlManifestEntry } from './types';

const cache = new Map<string, DetectedField[]>();

/** Stable signature for a page's scannable state. Changes when controls/labels change (paging, expand). */
export function computeDomSignature(url: string, manifest: ControlManifestEntry[]): string {
  const blob = manifest
    .map((m) => `${m.tag}:${m.inputType ?? ''}:${m.nearbyText}:${(m.domConstraints.options ?? []).join(',')}`)
    .join('|');
  let h = 0;
  for (let i = 0; i < blob.length; i += 1) {
    h = (Math.imul(h, 31) + blob.charCodeAt(i)) | 0;
  }
  return `${url}#${manifest.length}#${h >>> 0}`;
}

export function getCached(signature: string): DetectedField[] | undefined {
  return cache.get(signature);
}

export function setCached(signature: string, fields: DetectedField[]): void {
  cache.set(signature, fields);
}

/** Test/maintenance hook. */
export function clearScanCache(): void {
  cache.clear();
}
