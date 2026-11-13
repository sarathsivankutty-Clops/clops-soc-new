/**
 * T3.8 — AiSOC console Badge primitive.
 *
 * The console scatters ~30 inline ``<span class="text-xs ...">`` badges
 * with subtly different palettes. This component codifies the five
 * semantic tones we actually use (info / success / warning / danger /
 * neutral) plus the AiSOC-specific severity tones (low / medium / high
 * / critical) that mirror the OCSF severity ladder.
 *
 * Use this anywhere you would have inlined a label pill: alert
 * severity, run status, MITRE tactic, connector mode, etc.
 */
import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'severity-info'
  | 'severity-low'
  | 'severity-medium'
  | 'severity-high'
  | 'severity-critical';

const TONE_CLASSES: Record<BadgeTone, { badge: string; dot: string }> = {
  /* [HIDDEN-UI THEME-3 replaced bordered gray/900 badges with dot + soft tint, no border] */
  neutral: {
    badge: 'bg-pill-neutral-bg text-fg-muted',
    dot: 'bg-dot-neutral',
  },
  info: {
    badge: 'bg-pill-info-bg text-accent',
    dot: 'bg-dot-info',
  },
  success: {
    badge: 'bg-pill-success-bg text-tone-success',
    dot: 'bg-dot-success',
  },
  warning: {
    badge: 'bg-pill-warning-bg text-tone-warning',
    dot: 'bg-dot-warning',
  },
  danger: {
    badge: 'bg-pill-danger-bg text-tone-danger',
    dot: 'bg-dot-danger',
  },
  'severity-info': {
    badge: 'bg-severity-bg-info text-severity-ink-info',
    dot: 'bg-severity-dot-info',
  },
  'severity-low': {
    badge: 'bg-severity-bg-low text-severity-ink-low',
    dot: 'bg-severity-dot-low',
  },
  'severity-medium': {
    badge: 'bg-severity-bg-medium text-severity-ink-medium',
    dot: 'bg-severity-dot-medium',
  },
  'severity-high': {
    badge: 'bg-severity-bg-high text-severity-ink-high',
    dot: 'bg-severity-dot-high',
  },
  'severity-critical': {
    badge: 'bg-severity-bg-critical text-severity-ink-critical',
    dot: 'bg-severity-dot-critical',
  },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Small dot on the left; defaults to true on semantic/severity tones. */
  dot?: boolean;
}

export function Badge({
  tone = 'neutral',
  icon,
  dot,
  className,
  children,
  ...rest
}: BadgeProps) {
  const showDot = dot ?? tone !== 'neutral';
  const styles = TONE_CLASSES[tone];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
        styles.badge,
        className,
      )}
      {...rest}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={clsx('h-1.5 w-1.5 shrink-0 rounded-pill', styles.dot)}
        />
      )}
      {icon}
      {children}
    </span>
  );
}
