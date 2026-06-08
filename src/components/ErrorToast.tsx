// ErrorToast — non-blocking error feedback overlay.
//
// Problem this solves:
//   The previous codebase swallowed errors in two common patterns:
//     (a) `catch (err) { console.warn(...) }` — user sees nothing
//     (b) `alert(err.message)` — modal blocks the page and looks janky
//   Both fail the "looks broken / nothing happened" UX test.
//
// This component provides:
//   - Non-blocking toast stack at bottom of viewport
//   - Auto-dismiss after a few seconds (configurable per toast)
//   - Manual dismiss via ✕ button
//   - Visual severity tiers (error / warning / info)
//   - Context provider + useToast hook so any descendant can fire one
//
// See 05a-ux-design.md §A.1.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Severity = 'error' | 'warning' | 'info' | 'success';

interface Toast {
  id: string;
  severity: Severity;
  title: string;
  message?: string | undefined;
  durationMs: number;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  /** Convenience shortcuts. */
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  success: (title: string, message?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Wrap the root of each entrypoint (popup / sidepanel / options) with this.
 * Children can fire toasts via useToast().
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'> & { id?: string }): string => {
      const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const next: Toast = {
        id,
        severity: toast.severity,
        title: toast.title,
        message: toast.message,
        durationMs: toast.durationMs,
      };
      setToasts((prev) => {
        // Dedup by id — if a caller fires the same logical toast repeatedly we don't pile them up.
        const filtered = prev.filter((t) => t.id !== id);
        // Cap at 5 visible; oldest falls off.
        const trimmed = filtered.length >= 5 ? filtered.slice(1) : filtered;
        return [...trimmed, next];
      });
      return id;
    },
    [],
  );

  // Convenience helpers — common case is "fire an error toast in one line".
  const error = useCallback(
    (title: string, message?: string) =>
      push({ severity: 'error', title, message, durationMs: 6000 }),
    [push],
  );
  const warning = useCallback(
    (title: string, message?: string) =>
      push({ severity: 'warning', title, message, durationMs: 5000 }),
    [push],
  );
  const info = useCallback(
    (title: string, message?: string) =>
      push({ severity: 'info', title, message, durationMs: 4000 }),
    [push],
  );
  const success = useCallback(
    (title: string, message?: string) =>
      push({ severity: 'success', title, message, durationMs: 3000 }),
    [push],
  );

  return (
    <ToastContext.Provider value={{ push, dismiss, error, warning, info, success }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Hook for descendants to fire toasts.
 * Throws if used outside a ToastProvider — fail loud, not silently.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

const severityStyles: Record<Severity, { bg: string; icon: string; border: string }> = {
  error: { bg: 'bg-destructive/95 text-destructive-foreground', icon: '❌', border: 'border-destructive' },
  warning: { bg: 'bg-amber-500/95 text-amber-50', icon: '⚠️', border: 'border-amber-600' },
  info: { bg: 'bg-blue-500/95 text-blue-50', icon: 'ℹ️', border: 'border-blue-600' },
  success: { bg: 'bg-green-600/95 text-green-50', icon: '✅', border: 'border-green-700' },
};

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="fixed bottom-3 left-3 right-3 z-[9999] flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-label="通知区"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  // Auto-dismiss timer. We pause it on hover so the user has time to read long messages.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [paused, toast.id, toast.durationMs, onDismiss]);

  const style = severityStyles[toast.severity];

  return (
    <div
      className={[
        'pointer-events-auto rounded-md shadow-lg border-l-4',
        style.bg,
        style.border,
        'px-3 py-2 flex items-start gap-2 text-sm',
      ].join(' ')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="alert"
    >
      <span aria-hidden="true" className="text-base leading-tight pt-0.5">
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-tight">{toast.title}</div>
        {toast.message && (
          <div className="text-xs opacity-90 mt-0.5 break-words">{toast.message}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="opacity-70 hover:opacity-100 text-xs leading-none p-0.5"
        aria-label="关闭通知"
      >
        ✕
      </button>
    </div>
  );
}
