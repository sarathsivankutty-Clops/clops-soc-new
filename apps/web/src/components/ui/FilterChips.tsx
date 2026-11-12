import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface FilterChipOption<T extends string = string> {
  id: T;
  label: string;
  count?: number | string;
  icon?: ReactNode;
}

export interface FilterChipsProps<T extends string = string> {
  options: readonly FilterChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Row of filter chips with optional inline counts (`.fchip` pattern).
 */
export function FilterChips<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel = 'Filters',
  className,
}: FilterChipsProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={clsx('flex flex-wrap items-center gap-2', className)}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-control-sm font-medium transition-colors',
              active
                ? 'border-accent/40 bg-pill-info-bg text-accent font-semibold'
                : 'border-surface-border bg-surface-card text-fg-secondary hover:border-surface-border-strong hover:text-fg-primary',
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={clsx(
                  'rounded-pill px-1.5 py-0.5 font-mono text-eyebrow tabular-nums',
                  active ? 'bg-surface-card text-accent' : 'bg-surface-subtle text-fg-muted',
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentedOption<T extends string = string> {
  id: T;
  label: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Compact segmented control bar (`.seg` pattern).
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel = 'View selector',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex items-center rounded-control border border-surface-border bg-surface-card p-1 gap-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={clsx(
              'rounded-control px-3 py-1 text-control-sm font-semibold transition-colors',
              active
                ? 'bg-surface-subtle text-fg-primary'
                : 'text-fg-muted hover:text-fg-primary',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
