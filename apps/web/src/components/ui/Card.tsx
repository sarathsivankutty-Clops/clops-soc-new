/**
 * T3.8 — AiSOC console Card primitive.
 *
 * Cards live everywhere on the console (KPI tiles, gallery items,
 * incident panes). Codifying the four-corner anatomy here makes it
 * trivial to keep padding, radius and border tokens consistent.
 *
 * Composition: ``<Card>`` is the outer surface; ``<CardHeader>``,
 * ``<CardBody>`` and ``<CardFooter>`` are optional thin wrappers
 * that add the canonical spacing. Each piece accepts a className so
 * callers can override locally without re-implementing the surface.
 */
import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type CardElevation = 'flat' | 'raised' | 'inset';

const ELEVATION_CLASSES: Record<CardElevation, string> = {
  /* [HIDDEN-UI THEME-3 cards enforce 1px border + zero drop shadow via semantic tokens] */
  flat: 'bg-surface-card border border-surface-border shadow-card',
  raised: 'bg-surface-card border border-surface-border shadow-card',
  inset: 'bg-surface-elevated border border-surface-border shadow-card',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
  /** When true, removes the outer padding so a list/table can hug the edges. */
  flush?: boolean;
}

export function Card({
  elevation = 'raised',
  flush = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-container overflow-hidden',
        ELEVATION_CLASSES[elevation],
        !flush && 'p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  // We re-define ``title`` as ``ReactNode`` (instead of HTML's
  // ``string | undefined`` tooltip attribute) because card headers
  // routinely render an icon next to the title; HTML's ``title``
  // attribute is unreachable here anyway as the wrapper is a <div>.
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({
  title,
  description,
  action,
  className,
  children,
  ...rest
}: CardHeaderProps) {
  return (
    <div className={clsx('flex items-start justify-between gap-3 mb-3.5', className)} {...rest}>
      {children ?? (
        <div className="min-w-0">
          {title && <h3 className="text-card-title font-semibold text-fg-primary">{title}</h3>}
          {description && (
            <p className="mt-0.5 text-caption text-fg-muted">{description}</p>
          )}
        </div>
      )}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('text-body text-fg-secondary', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'mt-4 flex items-center justify-end gap-2 border-t border-surface-divider pt-3',
        className,
      )}
      {...rest}
    />
  );
}
