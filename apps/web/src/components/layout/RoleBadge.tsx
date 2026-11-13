'use client';

import { clsx } from 'clsx';

/**
 * The user's *organisation-level* role, surfaced in the TopBar so operators
 * always know what permissions they're operating under. Tone is tuned per
 * role so an `admin` badge visually outranks a `viewer` badge.
 *
 * Unknown roles fall back to a neutral slate styling — a future RBAC
 * iteration could add bespoke colours, but we'd rather render *something*
 * informative than a confident-but-wrong label.
 */
const ROLE_STYLES: Record<string, { label: string; classes: string; dot: string }> = {
  admin: {
    label: 'Admin',
    classes: 'bg-pill-danger-bg text-tone-danger',
    dot: 'bg-dot-danger',
  },
  responder: {
    label: 'Responder',
    classes: 'bg-pill-warning-bg text-tone-warning',
    dot: 'bg-dot-warning',
  },
  analyst: {
    label: 'Analyst',
    classes: 'bg-pill-info-bg text-accent',
    dot: 'bg-dot-info',
  },
  viewer: {
    label: 'Viewer',
    classes: 'bg-pill-neutral-bg text-fg-muted',
    dot: 'bg-dot-neutral',
  },
  auditor: {
    label: 'Auditor',
    classes: 'bg-pill-success-bg text-tone-success',
    dot: 'bg-dot-success',
  },
};

const FALLBACK = {
  label: 'User',
  classes: 'bg-pill-neutral-bg text-fg-muted',
  dot: 'bg-dot-neutral',
};

interface RoleBadgeProps {
  role: string | null | undefined;
  /** Visible label override, e.g. "Admin · Acme Corp". */
  label?: string;
  className?: string;
  /** Optional tooltip (title attribute). */
  tooltip?: string;
}

/**
 * W5 — Role badge surfaced in the TopBar.
 *
 * Renders the user's role with role-specific styling. We intentionally use
 * `border-*` + a translucent background instead of solid fills so the badge
 * sits cleanly against both light- and dark-mode chrome.
 */
export function RoleBadge({ role, label, className, tooltip }: RoleBadgeProps) {
  const norm = (role ?? '').toLowerCase();
  const style = ROLE_STYLES[norm] ?? FALLBACK;
  const displayLabel = label ?? style.label;
  return (
    <span
      title={tooltip}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-caption font-medium',
        style.classes,
        className,
      )}
    >
      <span
        aria-hidden
        className={clsx('h-1.5 w-1.5 rounded-pill', style.dot)}
      />
      {displayLabel}
    </span>
  );
}
