// State persistence helpers for cross-mount continuity.
//
// Problem: React useState resets every time a component unmounts. For
// ApplyForge, the sidepanel can be closed and reopened mid-workflow, or the
// user can switch tabs. With pure useState, that means losing:
//   - which step the user was on (project / context / draft / submitted)
//   - the detected event context (potentially edited by hand)
//   - the scanned fields and any draft generation in progress
//   - asset overrides the user manually picked
//
// chrome.storage.session is a RAM-only key-value store. It survives sidepanel
// close/reopen and tab switches but is cleared when the browser process exits.
// That's exactly the lifecycle we want for "this in-flight workflow" state.
//
// Three lifecycle layers:
//   1. localState  — React useState. Truly transient UI (hover, dropdown open).
//   2. tabSession  — chrome.storage.session keyed by tabId. The active workflow.
//   3. projectSession — db.appSettings / db.* tables. Long-lived prefs.
//
// This module owns layer 2.

import { useEffect, useState, useCallback, useRef } from 'react';

const STORAGE_AREA = 'session' as const;
const KEY_PREFIX = 'applyforge';

/**
 * Build the namespaced storage key for a (tabId, field) pair.
 * Unnamespaced keys would collide across tabs (e.g., two sidepanels open
 * to different forms would clobber each other's eventDraft).
 */
function buildKey(field: string, tabId: number | 'global'): string {
  return `${KEY_PREFIX}.${tabId}.${field}`;
}

/**
 * Read the current active tab's ID. Cached after first call per page load —
 * chrome.tabs.query is async and we want the hook to be synchronous-feeling.
 * For sidepanel/popup contexts the active tab is stable for the lifetime of
 * the React tree.
 */
let cachedTabId: number | null = null;
let tabIdPromise: Promise<number | 'global'> | null = null;

async function resolveTabId(): Promise<number | 'global'> {
  if (cachedTabId !== null) return cachedTabId;
  if (tabIdPromise) return tabIdPromise;
  tabIdPromise = (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        cachedTabId = tab.id;
        return tab.id;
      }
    } catch {
      // chrome.tabs API not available (e.g., in options page in some contexts)
    }
    // Fall back to a global key. The user's expectation is that options page
    // state doesn't depend on the active tab anyway.
    return 'global' as const;
  })();
  return tabIdPromise;
}

/**
 * React hook that persists state to chrome.storage.session, scoped to the
 * current active tab. Behaves like useState but the value survives sidepanel
 * close/reopen.
 *
 * Initial render: returns `defaultValue` while the async load is pending.
 * Once loaded, subsequent renders return the stored value. Writes are
 * eventually consistent — set returns immediately, the actual storage write
 * happens in the background.
 *
 * Cross-tab isolation: each tab gets its own keyspace, so two sidepanels
 * open to different forms don't interfere.
 *
 * @example
 *   const [step, setStep] = useTabSessionState<Step>('sidepanel.step', 'project');
 */
export function useTabSessionState<T>(
  field: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValueLocal] = useState<T>(defaultValue);
  const tabIdRef = useRef<number | 'global' | null>(null);
  // Track whether we've finished hydrating from storage. Until then, writes
  // are buffered to a ref to avoid racing with the initial read.
  const hydratedRef = useRef(false);

  // ----- Hydrate from storage on mount -----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tabId = await resolveTabId();
      if (cancelled) return;
      tabIdRef.current = tabId;
      const key = buildKey(field, tabId);
      try {
        const result = await chrome.storage.session.get(key);
        if (cancelled) return;
        const stored = result[key];
        if (stored !== undefined) {
          setValueLocal(stored as T);
        }
      } catch (err) {
        // chrome.storage.session not available — graceful degrade to useState.
        // Happens in tests or non-extension contexts.
        console.warn(`[session-state] load failed for ${field}:`, err);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately don't include `field` in deps — changing the field key
    // mid-component-life would be a programming error, not a feature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Subscribe to external changes (other contexts writing same key) -----
  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== STORAGE_AREA) return;
      const tabId = tabIdRef.current;
      if (tabId === null) return;
      const key = buildKey(field, tabId);
      if (changes[key]) {
        const next = changes[key].newValue;
        if (next !== undefined) {
          setValueLocal(next as T);
        }
      }
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch {
      // No-op in test envs.
    }
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {
        // No-op.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Setter writes through to storage -----
  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueLocal((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        // Persist asynchronously. If the tabId is not yet resolved we still
        // need to wait — race the resolve.
        void (async () => {
          const tabId = tabIdRef.current ?? (await resolveTabId());
          const key = buildKey(field, tabId);
          try {
            await chrome.storage.session.set({ [key]: resolved });
          } catch (err) {
            console.warn(`[session-state] save failed for ${field}:`, err);
          }
        })();
        return resolved;
      });
    },
    [field],
  );

  return [value, setValue];
}

/**
 * Direct (non-hook) read for one-shot lookups outside React.
 * Used by background.ts to peek at sidepanel state if needed.
 */
export async function getTabSessionValue<T>(
  field: string,
  tabId: number | 'global',
): Promise<T | undefined> {
  const key = buildKey(field, tabId);
  try {
    const result = await chrome.storage.session.get(key);
    return result[key] as T | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clear all session state for a tab. Called when the user explicitly resets
 * the workflow ("start over") — saves them from stale data confusion.
 */
export async function clearTabSession(tabId: number | 'global'): Promise<void> {
  try {
    const all = await chrome.storage.session.get(null);
    const prefix = `${KEY_PREFIX}.${tabId}.`;
    const keysToRemove = Object.keys(all).filter((k) => k.startsWith(prefix));
    if (keysToRemove.length > 0) {
      await chrome.storage.session.remove(keysToRemove);
    }
  } catch (err) {
    console.warn('[session-state] clear failed:', err);
  }
}
