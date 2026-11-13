/**
 * T3.8 — AiSOC console Button primitive.
 *
 * The console already had ~40 inline ``<button className="...">``s with
 * subtly different padding, radius, and hover colours. This component
 * codifies the canonical set so the Storybook design system has a
 * single source of truth.
 *
 * Variants:
 *   - primary   — solid blue, the main CTA on a page
 *   - secondary — subtle gray, supporting actions
 *   - destructive — solid red, irreversible actions (block IP, etc.)
 *   - ghost     — transparent until hovered
 *   - outline   — bordered, for low-emphasis actions next to a primary
 *
 * Sizes follow the 4-token ladder (xs / sm / md / lg) the rest of the
 * console uses for tap-target heights.
 */
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'ghost'
  | 'outline';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  /* [HIDDEN-UI THEME-3 restyled Button variants to console button and semantic surface tokens] */
  primary:
    'bg-btn-grad text-white hover:brightness-105 active:translate-y-px disabled:opacity-45',
  secondary:
    'bg-surface-card border border-surface-border text-fg-primary hover:bg-surface-hover hover:border-surface-border-strong disabled:opacity-45',
  destructive:
    'bg-surface-card border border-surface-border text-tone-danger hover:bg-pill-danger-bg disabled:opacity-45',
  ghost:
    'bg-transparent text-fg-secondary hover:bg-surface-hover hover:text-fg-primary disabled:text-fg-subtle',
  outline:
    'bg-transparent text-fg-secondary border border-surface-border hover:border-surface-border-strong hover:bg-surface-hover disabled:opacity-50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-caption gap-1.5',
  sm: 'h-8 px-3 text-caption gap-1.5',
  md: 'h-9 px-3.5 text-control gap-2',
  lg: 'h-10 px-5 text-body gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Renders an inline spinner and disables the button. */
  loading?: boolean;
  /** Sets ``aria-pressed`` and a subtle pressed style; used for toggles. */
  pressed?: boolean;
}

/**
 * Console button primitive. Forwards its ref so popovers and tooltips
 * can anchor to it without contortions.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leadingIcon,
    trailingIcon,
    loading = false,
    pressed,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center rounded-control font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        pressed && 'ring-1 ring-accent/50',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : (
        leadingIcon
      )}
      <span>{children}</span>
      {!loading && trailingIcon}
    </button>
  );
});
