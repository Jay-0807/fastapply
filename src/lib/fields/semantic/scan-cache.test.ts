import { describe, it, expect, beforeEach } from 'vitest';
import { computeDomSignature, getCached, setCached, clearScanCache } from './scan-cache';
import type { ControlManifestEntry } from './types';
import type { DetectedField } from '@/lib/db/types';

const m1: ControlManifestEntry[] = [{ afId: 'af-0', tag: 'input', nearbyText: '姓名', domConstraints: {} }];
const m2: ControlManifestEntry[] = [
  { afId: 'af-0', tag: 'input', nearbyText: '姓名', domConstraints: {} },
  { afId: 'af-1', tag: 'input', nearbyText: '电话', domConstraints: {} },
];
const fields: DetectedField[] = [
  { fieldId: 'x', domSelector: '#x', label: '姓名', type: 'text', constraints: {}, rawElementInfo: { tagName: 'input', classes: [] } },
];

describe('scan-cache', () => {
  beforeEach(() => clearScanCache());

  it('hits on an identical signature', () => {
    const sig = computeDomSignature('http://x', m1);
    setCached(sig, fields);
    expect(getCached(sig)).toBe(fields);
  });

  it('misses when a control is added (signature changes)', () => {
    const sig1 = computeDomSignature('http://x', m1);
    const sig2 = computeDomSignature('http://x', m2);
    setCached(sig1, fields);
    expect(sig1).not.toBe(sig2);
    expect(getCached(sig2)).toBeUndefined();
  });

  it('misses when the url changes', () => {
    expect(computeDomSignature('http://a', m1)).not.toBe(computeDomSignature('http://b', m1));
  });
});
