/**
 * Canonical alert status vocabulary & groupings.
 *
 * Mirrors ``WRITTEN_STATUSES`` and ``RESOLVED_STATUSES`` in
 * ``services/api/app/services/alert_status.py`` so the `/alerts` filter and
 * status badges cover every status any backend writer can emit.
 */

export type AlertStatusValue =
  | 'new'
  | 'triaging'
  | 'triaged'
  | 'investigating'
  | 'in_progress'
  | 'escalated'
  | 'snoozed'
  | 'resolved'
  | 'closed'
  | 'false_positive'
  | 'fp'
  | 'dismissed';

export type AlertStatusGroup = 'Open' | 'In progress' | 'Closed';

export interface AlertStatusMeta {
  value: AlertStatusValue;
  label: string;
  group: AlertStatusGroup;
  colorClass: string;
  dotClass: string;
}

export const ALERT_STATUS_LIST: readonly AlertStatusMeta[] = [
  // Open
  { value: 'new', label: 'New', group: 'Open', colorClass: 'text-tone-purple bg-pill-purple-bg', dotClass: 'bg-dot-purple' },
  { value: 'triaging', label: 'Triaging', group: 'Open', colorClass: 'text-tone-purple bg-pill-purple-bg', dotClass: 'bg-dot-purple' },
  { value: 'triaged', label: 'Triaged', group: 'Open', colorClass: 'text-accent bg-pill-info-bg', dotClass: 'bg-dot-info' },
  // In progress
  { value: 'investigating', label: 'Investigating', group: 'In progress', colorClass: 'text-tone-warning bg-pill-warning-bg', dotClass: 'bg-dot-warning' },
  { value: 'in_progress', label: 'In Progress', group: 'In progress', colorClass: 'text-tone-warning bg-pill-warning-bg', dotClass: 'bg-dot-warning' },
  { value: 'escalated', label: 'Escalated', group: 'In progress', colorClass: 'text-severity-ink-high bg-severity-bg-high', dotClass: 'bg-severity-dot-high' },
  { value: 'snoozed', label: 'Snoozed', group: 'In progress', colorClass: 'text-fg-muted bg-pill-neutral-bg', dotClass: 'bg-dot-neutral' },
  // Closed
  { value: 'resolved', label: 'Resolved', group: 'Closed', colorClass: 'text-tone-success bg-pill-success-bg', dotClass: 'bg-dot-success' },
  { value: 'closed', label: 'Closed', group: 'Closed', colorClass: 'text-tone-success bg-pill-success-bg', dotClass: 'bg-dot-success' },
  { value: 'false_positive', label: 'False Positive', group: 'Closed', colorClass: 'text-fg-muted bg-pill-neutral-bg', dotClass: 'bg-dot-neutral' },
  { value: 'fp', label: 'FP (Auto)', group: 'Closed', colorClass: 'text-fg-muted bg-pill-neutral-bg', dotClass: 'bg-dot-neutral' },
  { value: 'dismissed', label: 'Dismissed', group: 'Closed', colorClass: 'text-fg-muted bg-pill-neutral-bg', dotClass: 'bg-dot-neutral' },
] as const;

export const ALERT_STATUS_GROUPS: readonly AlertStatusGroup[] = ['Open', 'In progress', 'Closed'] as const;

export const ALERT_STATUS_BY_VALUE: Record<string, AlertStatusMeta> = Object.fromEntries(
  ALERT_STATUS_LIST.map((s) => [s.value, s]),
);
