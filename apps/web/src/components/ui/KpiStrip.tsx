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
}

/**
 * Framed KPI strip rendered with 1px `surface-border` dividers between cells
 * instead of per-tile shadows or outer gaps.
 */
export function KpiStrip({ items, cols = 4, className }: KpiStripProps) {
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
              'relative bg-surface-card p-5 text-left flex flex-col justify-between gap-1.5 min-w-0 transition-colors',
              clickable && 'cursor-pointer hover:bg-surface-elevated',
              item.active && 'bg-nav-active-bg',
            )}
          >
            {clickable && (
              <span className="absolute top-5 right-5 text-eyebrow font-semibold text-accent shrink-0">
                {item.active ? 'Active' : 'Filter'}
              </span>
            )}
            <p className={clsx('text-caption font-medium text-fg-muted truncate', clickable && 'pr-12')}>
              {item.label}
            </p>
            <p className="text-kpi font-bold font-mono tabular-nums text-fg-primary leading-tight">
              {item.value}
            </p>
            {item.sub && (
              <div className={clsx('text-caption truncate', TONE_TEXT[tone])}>
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
