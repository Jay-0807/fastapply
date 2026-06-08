// AsyncButton — unified wrapper for "click → remote operation → result" UI.
//
// Problem this solves:
//   Before this existed, every async button in the app had its own bespoke
//   try/catch/setIsLoading dance. Most got it slightly wrong:
//     - no disabled state (user double-clicks, double-fires the request)
//     - errors only logged to console (user sees nothing happen)
//     - no timeout (operation hangs forever, button looks like it's working)
//     - no cooldown (success feedback flashes too fast to read)
//
// AsyncButton fixes all four by handling the lifecycle internally. Callers
// just provide `onClick: async () => ...` and labels for each state.
//
// State machine: idle → busy → (done → idle) | (error → idle)
//
// See 05a-ux-design.md §A.0 for the design rationale.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Status = 'idle' | 'busy' | 'done' | 'error';

export interface AsyncButtonProps {
  /** The async operation. Throw to surface an error. */
  onClick: () => Promise<void>;
  /** Default text in idle state. */
  label: string;
  /** Optional leading icon (a lucide component) shown in the idle state. Prefer
   *  this over emoji in `label` — icons must be lucide, not emoji (redline 2026-05-29). */
  icon?: ReactNode;
  /** Text shown during busy state. Can be plain string or a render func that receives a setter for live progress updates. */
  loadingLabel?: string | ((setProgress: (msg: string) => void) => string);
  /** Text shown briefly after success (default: "✅ 完成"). */
  successLabel?: string;
  /** Prefix for error messages — final shown text is `${errorPrefix}: ${err.message}`. */
  errorPrefix?: string;
  /** Hard timeout in ms. If onClick doesn't resolve/reject by then, we treat it as an error. Default 60s. */
  timeoutMs?: number;
  /** Custom message when timing out (default uses errorPrefix). */
  timeoutMessage?: string;
  /** How long to show the success state before returning to idle (default 1500ms). */
  successCooldownMs?: number;
  /** Whether the button is disabled for reasons external to its own state (e.g., form invalid). */
  disabled?: boolean;
  /** Visual variant. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Size. */
  size?: 'sm' | 'md' | 'lg';
  /** Optional extra class names. */
  className?: string;
  /** Called when an error happens — caller can also toast it. */
  onError?: (message: string) => void;
  /** Called on success after the cooldown — caller can run side effects. */
  onSuccess?: () => void;
}

const variantClasses: Record<NonNullable<AsyncButtonProps['variant']>, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
};

const sizeClasses: Record<NonNullable<AsyncButtonProps['size']>, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
};

/**
 * Run a promise with a wall-clock timeout. If `ms` elapses first, throws
 * an Error with the given message. Cleans up its timer either way.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function AsyncButton({
  onClick,
  label,
  icon,
  loadingLabel,
  successLabel = '✅ 完成',
  errorPrefix = '操作失败',
  timeoutMs = 60_000,
  timeoutMessage,
  successCooldownMs = 1500,
  disabled = false,
  variant = 'primary',
  size = 'md',
  className = '',
  onError,
  onSuccess,
}: AsyncButtonProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [progressText, setProgressText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  // Guard against state updates after unmount (the async op might still be running).
  const mountedRef = useRef(true);
  // Guard against re-entrancy: if user double-clicks before we set busy.
  const inFlightRef = useRef(false);

  // Cleanup on unmount — async operations may still be in-flight when the
  // user closes the sidepanel; we don't want them setting state on a dead tree.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (inFlightRef.current || status === 'busy') return;
    inFlightRef.current = true;
    setStatus('busy');
    setProgressText('');
    setErrorMessage('');
    const effectiveTimeoutMessage = timeoutMessage ?? `操作超时（${Math.round(timeoutMs / 1000)}s 无响应）`;
    try {
      await withTimeout(onClick(), timeoutMs, effectiveTimeoutMessage);
      if (!mountedRef.current) return;
      setStatus('done');
      // Auto-return to idle after the cooldown so the button can be clicked again.
      setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus('idle');
        setProgressText('');
        onSuccess?.();
      }, successCooldownMs);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      const display = `${errorPrefix}：${msg}`;
      setStatus('error');
      setErrorMessage(display);
      onError?.(display);
      // Errors return to idle faster — user might want to retry immediately.
      setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus('idle');
      }, 2000);
    } finally {
      inFlightRef.current = false;
    }
  }, [
    onClick,
    timeoutMs,
    timeoutMessage,
    errorPrefix,
    successCooldownMs,
    status,
    onError,
    onSuccess,
  ]);

  // Resolve the display label based on current status.
  const displayLabel = (() => {
    if (status === 'busy') {
      if (typeof loadingLabel === 'function') {
        return loadingLabel((msg) => mountedRef.current && setProgressText(msg));
      }
      if (progressText) return progressText;
      return loadingLabel ?? '处理中…';
    }
    if (status === 'done') return successLabel;
    if (status === 'error') return errorMessage || `${errorPrefix}`;
    return label;
  })();

  // Visual style per state. Error/done override variant briefly so feedback is visible.
  const stateOverride = status === 'error' ? variantClasses.danger : status === 'done' ? 'bg-green-600 text-white hover:bg-green-700' : variantClasses[variant];
  const isDisabled = disabled || status === 'busy' || status === 'done';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className={[
        'rounded-md font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5',
        stateOverride,
        sizeClasses[size],
        className,
      ].join(' ')}
    >
      {status === 'busy' && (
        <span
          className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
      )}
      {status === 'idle' && icon}
      <span className="truncate max-w-[40ch]">{displayLabel}</span>
    </button>
  );
}
