// StatusBadge — reusable status indicator for any operation lifecycle.
//
// Lifted from the inline ⏳/✏️/✅/❌ badges sidepanel/App.tsx was using for
// per-field state (queued / generating / done / error). Now reusable for
// file uploads, asset matching, page fill, anything that has phases.
//
// Each phase has a colored pill + icon + label so users can scan a list of
// items and tell at a glance which is still working / which broke.

import type { ReactNode } from 'react';

export type Status = 'queued' | 'busy' | 'done' | 'error' | 'idle' | 'warning';

interface StatusBadgeProps {
  status: Status;
  /** Override the default text for this status. */
  label?: string;
  /** Tooltip on hover — useful for showing the error message on `error` status. */
  tooltip?: string | undefined;
  /** Optional extra content next to the badge (e.g., count). */
  children?: ReactNode;
  size?: 'xs' | 'sm';
}

const styles: Record<Status, { bg: string; icon: string; defaultLabel: string }> = {
  queued: { bg: 'bg-muted text-muted-foreground', icon: '⏳', defaultLabel: '排队中' },
  busy: { bg: 'bg-blue-100 text-blue-700 border border-blue-200', icon: '✏️', defaultLabel: '进行中' },
  done: { bg: 'bg-green-100 text-green-700 border border-green-200', icon: '✅', defaultLabel: '完成' },
  error: { bg: 'bg-red-100 text-red-700 border border-red-200', icon: '❌', defaultLabel: '失败' },
  idle: { bg: 'bg-muted/50 text-muted-foreground', icon: '◯', defaultLabel: '待开始' },
  warning: { bg: 'bg-amber-100 text-amber-700 border border-amber-200', icon: '⚠️', defaultLabel: '警告' },
};

export function StatusBadge({ status, label, tooltip, children, size = 'sm' }: StatusBadgeProps) {
  const style = styles[status];
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${style.bg} ${sizeClass}`}
      title={tooltip}
    >
      <span aria-hidden="true">{style.icon}</span>
      <span>{label ?? style.defaultLabel}</span>
      {children}
    </span>
  );
}
