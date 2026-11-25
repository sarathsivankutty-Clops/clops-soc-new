import { clsx } from 'clsx';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

const ORBITAL_DOTS: ReadonlyArray<{ cx: number; cy: number; r: number }> = [
  { cx: 12, cy: 3.5, r: 1.85 },
  { cx: 18, cy: 6, r: 2.15 },
  { cx: 20.5, cy: 12, r: 2.45 },
  { cx: 18, cy: 18, r: 2.75 },
  { cx: 12, cy: 20.5, r: 1.05 },
  { cx: 6, cy: 18, r: 1.25 },
  { cx: 3.5, cy: 12, r: 1.45 },
  { cx: 6, cy: 6, r: 1.65 },
];

/**
 * 8-dot graduated orbital spinner. Inherits color via `currentColor` so
 * callers can tint it with semantic tokens (`text-accent`, `text-white`, etc.).
 */
export function Spinner({ size = 'sm', className }: SpinnerProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={clsx(
        'inline-block shrink-0 animate-spin motion-reduce:animate-none',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {ORBITAL_DOTS.map((dot, idx) => (
        <circle key={idx} cx={dot.cx} cy={dot.cy} r={dot.r} />
      ))}
    </svg>
  );
}
