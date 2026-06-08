// Lightweight performance instrumentation.
// Wraps async functions with a timer and reports to Sentry's performance API.

import * as Sentry from '@sentry/browser';

export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    const dur = performance.now() - start;
    Sentry.metrics.distribution(`applyforge.${name}.duration_ms`, dur, {
      unit: 'millisecond',
      tags: { ok: String(ok) },
    });
    if (import.meta.env.DEV) {
      console.debug(`[perf] ${name}: ${dur.toFixed(0)}ms (${ok ? 'ok' : 'fail'})`);
    }
  }
}
