import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type KpiTone = 'default' | 'ok' | 'warn' | 'bad' | 'info' | 'purple';

export interface KpiItem {
  id?: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  tone?: KpiTone;
  active?: boolean;
  onClick?: () => void;
}

const TONE_TEXT: Record<KpiTone, string> = {
  default: 'text-fg-muted',
  ok: 'text-tone-success',
  warn: 'text-tone-warning',
  bad: 'text-tone-danger',
  info: 'text-accent',
  purple: 'text-tone-purple',
};

// Dense tiles carry their tone as a left rule and a tinted value instead of a sub-line.
const TONE_BAR: Record<KpiTone, string | null> = {
  default: null,
  ok: 'bg-dot-success',
  warn: 'bg-dot-warning',
  bad: 'bg-dot-danger',
  info: 'bg-dot-info',
  purple: 'bg-dot-purple',
};

const COLS_CLASS: Record<2 | 3 | 4 | 5, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
};

export interface KpiStripProps {
  items: readonly KpiItem[];
  cols?: 2 | 3 | 4 | 5;
  className?: string;
  /** One line per tile (label and value side by side) for list pages that need the vertical space. */
  dense?: boolean;
}

/**
 * Framed KPI strip rendered with 1px `surface-border` dividers between cells
 * instead of per-tile shadows or outer gaps.
 */
export function KpiStrip({ items, cols = 4, className, dense = false }: KpiStripProps) {
  return (
    <div
      className={clsx(
        'grid gap-px rounded-container border border-surface-border bg-surface-border overflow-hidden',
        COLS_CLASS[cols],
        className,
      )}
    >
      {items.map((item, idx) => {
        const tone = item.tone ?? 'default';
        const clickable = typeof item.onClick === 'function';
        const Comp = clickable ? 'button' : 'div';
        return (
          <Comp
            key={item.id ?? `${item.label}-${idx}`}
            {...(clickable ? { type: 'button' as const, onClick: item.onClick } : {})}
            className={clsx(
              'relative bg-surface-card text-left flex min-w-0 transition-colors',
              // [HIDDEN-UI ALERTS-G2 dense was 'items-baseline justify-between gap-3 px-4 py-2.5': label far left, value far right]
              dense ? 'flex-row-reverse items-baseline justify-end gap-2.5 px-5 py-3' : 'flex-col justify-between gap-1.5 p-5',
              clickable && 'cursor-pointer hover:bg-surface-elevated',
              item.active && 'bg-nav-active-bg',
            )}
          >
            {dense && TONE_BAR[tone] && (
              <span aria-hidden className={clsx('absolute inset-y-3 left-0 w-0.5 rounded-pill', TONE_BAR[tone])} />
            )}
            {clickable && (
              <span className="absolute top-5 right-5 text-eyebrow font-semibold text-accent shrink-0">
                {item.active ? 'Active' : 'Filter'}
              </span>
            )}
            <p
              className={clsx(
                'font-medium truncate',
                dense ? 'text-control text-fg-secondary' : 'text-caption text-fg-muted',
                clickable && 'pr-12',
              )}
            >
              {item.label}
            </p>
            <p
              className={clsx(
                'font-mono tabular-nums leading-tight',
                dense ? 'text-page-title font-semibold' : 'text-kpi font-bold',
                dense && tone !== 'default' ? TONE_TEXT[tone] : 'text-fg-primary',
              )}
            >
              {item.value}
            </p>
            {item.sub && (
              /* [HIDDEN-UI AUDIT-P2 `truncate` clipped sub-lines such as "1 in progress · 0 opened / ..."] */
              <div className={clsx('text-caption break-words', TONE_TEXT[tone])}>
                {item.sub}
              </div>
            )}
            {item.meta && (
              <div className="text-eyebrow text-fg-subtle truncate">{item.meta}</div>
            )}
          </Comp>
        );
      })}
    </div>
  );
}
