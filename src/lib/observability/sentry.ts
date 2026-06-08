// Sentry browser SDK init for ApplyForge.
//
// Reads DSN from build-time env var to support both "no Sentry" (DSN empty)
// and active monitoring. The beforeSend hook scrubs anything resembling user
// content so we never accidentally ship sensitive project material to Sentry.

import * as Sentry from '@sentry/browser';

const DSN = import.meta.env.WXT_SENTRY_DSN || '';
const RELEASE = import.meta.env.WXT_RELEASE || `applyforge@0.1.0`;

const SENSITIVE_KEYS = [
  'masterPassword',
  'plainKeys',
  'anthropicKey',
  'openaiKey',
  'rawText',
  'aiDraft',
  'finalValue',
  'embedding',
  'text',          // chunk text
  'qaPairs',
  'documents',
];

export function initSentry(context: 'background' | 'popup' | 'sidepanel' | 'options' | 'content') {
  if (!DSN) {
    // Sentry not configured — skip silently to keep dev / privacy-mode usable.
    return;
  }
  Sentry.init({
    dsn: DSN,
    release: RELEASE,
    environment: import.meta.env.DEV ? 'development' : 'production',
    tracesSampleRate: 0.1,
    initialScope: { tags: { context } },
    beforeSend(event) {
      return scrubSensitive(event);
    },
    beforeBreadcrumb(crumb) {
      // Strip console breadcrumbs that may contain user data
      if (crumb.category === 'console' && typeof crumb.message === 'string') {
        crumb.message = redactString(crumb.message);
      }
      return crumb;
    },
  });
}

function scrubSensitive<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map(scrubSensitive) as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubSensitive(v);
      }
    }
    return out as T;
  }
  return value;
}

function redactString(s: string): string {
  // Redact common patterns: API keys (sk-...), email (best-effort), long high-entropy strings
  return s
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, 'sk-[REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_\-]{20,}/g, 'sk-ant-[REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email-REDACTED]');
}

export const captureException = (err: unknown, context?: Record<string, unknown>) => {
  if (!DSN) return;
  Sentry.captureException(err, { extra: scrubSensitive(context ?? {}) });
};

export const captureMessage = (msg: string, level: 'info' | 'warning' | 'error' = 'info') => {
  if (!DSN) return;
  Sentry.captureMessage(msg, level);
};
