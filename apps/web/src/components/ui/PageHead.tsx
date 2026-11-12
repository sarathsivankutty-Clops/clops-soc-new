import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface PageHeadProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared SREOps-adapted page header strip with eyebrow, 22px title, optional
 * count pill, muted description, and right-aligned action controls.
 */
export function PageHead({
  eyebrow,
  title,
  description,
  count,
  actions,
  className,
}: PageHeadProps) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-start justify-between gap-4 mb-6',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-eyebrow font-semibold uppercase tracking-widest text-accent mb-1">
            {eyebrow}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-page-title font-semibold text-fg-primary tracking-tight">
            {title}
          </h2>
          {count !== undefined && count !== null && (
            <span className="inline-flex items-center rounded-pill bg-surface-subtle px-2.5 py-0.5 text-caption font-medium text-fg-secondary">
              {count}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 text-body text-fg-muted max-w-2xl">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
