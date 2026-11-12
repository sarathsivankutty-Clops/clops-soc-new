/**
 * T3.8 — AiSOC console StatusPill primitive.
 *
 * Compact status indicator with an animated dot for live states. Used
 * in the runs panel, connector cards, ingest health bar, etc.
 */
import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export type StatusKind =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

const STATUS_META: Record<StatusKind, { label: string; classes: string; dot: string; pulse: boolean }> = {
  /* [HIDDEN-UI THEME-3 restyled StatusPill to borderless dot + soft tint tokens] */
  pending: { label: 'Pending', classes: 'text-tone-warning bg-pill-warning-bg', dot: 'bg-dot-warning', pulse: false },
  running: { label: 'Running', classes: 'text-accent bg-pill-info-bg', dot: 'bg-dot-info', pulse: true },
  completed: { label: 'Completed', classes: 'text-tone-success bg-pill-success-bg', dot: 'bg-dot-success', pulse: false },
  failed: { label: 'Failed', classes: 'text-tone-danger bg-pill-danger-bg', dot: 'bg-dot-danger', pulse: false },
  cancelled: { label: 'Cancelled', classes: 'text-fg-muted bg-pill-neutral-bg', dot: 'bg-dot-neutral', pulse: false },
  unknown: { label: 'Unknown', classes: 'text-fg-subtle bg-pill-neutral-bg', dot: 'bg-dot-neutral', pulse: false },
};

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusKind;
  /** Override the rendered label (defaults to the canonical name). */
  label?: string;
}

export function StatusPill({ status, label, className, ...rest }: StatusPillProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
        meta.classes,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-pill',
          meta.dot,
          meta.pulse && 'animate-pulse',
        )}
      />
      {label ?? meta.label}
    </span>
  );
}
