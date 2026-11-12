'use client';

/**
 * Connector fleet health.
 *
 * This is the panel the alert-centric dashboards structurally cannot provide.
 * When a connector stops polling, alerts from that source stop arriving, and
 * every alert-shaped widget in the console gets *quieter*. An absence of
 * alerts is indistinguishable from an absence of threats unless something is
 * watching the sources themselves.
 *
 * `GET /api/v1/health/fleet` has been writing that answer for a while with
 * nothing reading it. It judges staleness per connector against that
 * connector's own configured cadence, which is why this panel reports
 * "3.2 intervals missed" rather than an absolute age: a daily connector and a
 * five-minute connector are not late at the same wall-clock time.
 */

import useSWR from 'swr';
import Link from 'next/link';
import { clsx } from 'clsx';
import { operationsApi, type FleetConnectorHealth, type FleetHealthState } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

const STATE_STYLE: Record<FleetHealthState, { dot: string; text: string; label: string }> = {
  healthy: { dot: 'bg-dot-success', text: 'text-tone-success', label: 'Healthy' },
  degraded: { dot: 'bg-dot-warning', text: 'text-tone-warning', label: 'Degraded' },
  failed: { dot: 'bg-dot-danger', text: 'text-tone-danger', label: 'Failed' },
  unproven: { dot: 'bg-dot-info', text: 'text-accent', label: 'Never synced' },
  disabled: { dot: 'bg-dot-neutral', text: 'text-fg-muted', label: 'Disabled' },
};

/** Order worst-first so the answer is the first thing read. */
const STATE_ORDER: FleetHealthState[] = ['failed', 'degraded', 'unproven', 'healthy', 'disabled'];

export function formatStaleness(row: FleetConnectorHealth): string {
  if (row.last_sync === null) return 'never synced';

  const missed = row.missed_intervals;
  if (missed !== null && missed >= 1) {
    // Cadence-relative is the actionable framing: "two intervals late" tells
    // an operator it is genuinely behind, where "22 minutes" does not unless
    // they also remember the interval.
    return `${missed.toFixed(1)} intervals behind`;
  }

  const secs = row.seconds_since_sync;
  if (secs === null) return 'sync time unknown';
  if (secs < 90) return 'synced just now';
  if (secs < 3600) return `synced ${Math.round(secs / 60)}m ago`;
  if (secs < 86_400) return `synced ${Math.round(secs / 3600)}h ago`;
  return `synced ${Math.round(secs / 86_400)}d ago`;
}

function ConnectorRow({ row }: { row: FleetConnectorHealth }) {
  const style = STATE_STYLE[row.state] ?? STATE_STYLE.unproven;
  return (
    <li
      className="flex items-start gap-3 px-5 py-3"
      data-testid={`fleet-row-${row.connector_id}`}
    >
      <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-pill', style.dot)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-body font-medium text-fg-primary">{row.name}</span>
          <span className="text-caption text-fg-muted">{row.connector_type}</span>
          <span className={clsx('text-caption font-medium', style.text)}>{style.label}</span>
        </div>
        <p className="mt-0.5 text-caption text-fg-muted">{row.reason}</p>
      </div>
      <div className="shrink-0 text-right text-caption text-fg-muted">
        <div>{formatStaleness(row)}</div>
        <div className="mt-0.5 font-mono">
          {row.events_ingested.toLocaleString()} events
          {row.error_count > 0 ? ` · ${row.error_count} errors` : ''}
        </div>
      </div>
    </li>
  );
}

export function ConnectorFleetPanel() {
  const { data, error, isLoading, mutate } = useSWR(
    'ops-fleet-health',
    () => operationsApi.fleetHealth(),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  const connectors = data?.connectors ?? [];
  const sorted = [...connectors].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
  );
  const counts = data?.counts;
  const needsAttention = (counts?.failed ?? 0) + (counts?.degraded ?? 0);

  return (
    <section
      aria-labelledby="ops-fleet-heading"
      className="rounded-container border border-surface-border bg-surface-card shadow-card overflow-hidden"
    >
      <div className="flex items-baseline justify-between px-5 py-4 border-b border-surface-divider">
        <div>
          <h2 id="ops-fleet-heading" className="text-card-title font-semibold text-fg-primary">
            Connector fleet
          </h2>
          <p className="mt-0.5 text-caption text-fg-muted">
            Staleness measured against each connector&apos;s own poll cadence.
          </p>
        </div>
        {data && connectors.length > 0 && (
          <span
            className={clsx(
              'shrink-0 rounded-pill px-2.5 py-0.5 text-caption font-medium',
              needsAttention > 0
                ? 'bg-pill-danger-bg text-tone-danger'
                : 'bg-pill-success-bg text-tone-success',
            )}
          >
            {needsAttention > 0
              ? `${needsAttention} need attention`
              : `All ${connectors.length} sources reporting`}
          </span>
        )}
      </div>

      {isLoading && !data ? (
        <div className="m-4 h-24 animate-pulse rounded-control bg-surface-subtle" />
      ) : error ? (
        <ErrorState
          title="Fleet health unavailable"
          description="Connector staleness is unknown right now. Treat a quiet alert queue as unexplained until this recovers."
          error={error}
          onRetry={() => {
            void mutate();
          }}
          className="m-4"
        />
      ) : connectors.length === 0 ? (
        <EmptyState
          title="No connectors configured"
          description="Nothing is feeding the pipeline yet, so an empty alert queue is expected."
          action={
            <Link
              href="/connectors"
              className="text-body text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              Connect a source
            </Link>
          }
          className="m-4"
        />
      ) : (
        <ul className="divide-y divide-surface-divider">
          {sorted.map((row) => (
            <ConnectorRow key={row.connector_id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
