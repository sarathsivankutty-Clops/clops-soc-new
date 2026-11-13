'use client';

/**
 * Managed portfolio console, read from `/api/v1/mssp/portfolio`.
 *
 * This view used to be a hardcoded table of six companies — "Acme Financial",
 * "GlobalRetail Corp" — with invented alert counts, MTTD/MTTR figures, risk
 * scores, analyst headcounts and ARR. It made no API call at all, so what an
 * operator saw was the same six rows on every deployment, including their own.
 *
 * Two of those columns could not be sourced and are gone rather than nulled:
 * there is no revenue data anywhere in this product, and no analyst-allocation
 * or composite risk score either. Inventing a number is worse than omitting it;
 * a column of nulls would still imply the measurement exists.
 *
 * Nothing here falls back to sample data. First paint renders a loading state,
 * a failure renders the failure, and an empty portfolio says so — because those
 * are the three states a self-hoster with a fresh backend actually spends their
 * time in, and each is a different problem with a different fix.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { clsx } from 'clsx';
import Link from 'next/link';
import { ApiError, msspApi, type Portfolio, type PortfolioAlert, type PortfolioTenant } from '@/lib/api';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

type TenantFilter = 'all' | 'critical' | 'sla' | 'no-connectors';

const FILTERS: { key: TenantFilter; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Every tenant in the portfolio' },
  { key: 'critical', label: 'Critical alerts', hint: 'At least one open critical alert' },
  { key: 'sla', label: 'SLA breached', hint: 'At least one case past its SLA' },
  { key: 'no-connectors', label: 'No connectors', hint: 'No data source connected' },
];

function matches(tenant: PortfolioTenant, filter: TenantFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'critical':
      return tenant.critical_alerts > 0;
    case 'sla':
      return tenant.sla_breached_cases > 0;
    case 'no-connectors':
      return tenant.connectors.total === 0;
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

/** `null` means "not measured", which must never render as a confident 0. */
function formatMinutes(value: number | null): string {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${Math.round(value)}m`;
  return `${(value / 60).toFixed(1)}h`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'No events yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-severity-critical-bg text-severity-critical-ink',
  high: 'bg-severity-high-bg text-severity-high-ink',
  medium: 'bg-severity-medium-bg text-severity-medium-ink',
  low: 'bg-severity-low-bg text-severity-low-ink',
  info: 'bg-severity-info-bg text-severity-info-ink',
};

function connectorTone(tenant: PortfolioTenant): string {
  if (tenant.connectors.total === 0) return 'text-fg-subtle';
  if (tenant.connectors.error > 0) return 'text-tone-danger';
  if (tenant.connectors.stale > 0) return 'text-tone-warning';
  return 'text-tone-success';
}

/**
 * CSV of exactly the rows on screen, built from data already in memory.
 *
 * The button here used to raise a success toast and do nothing else. A control
 * that reports success without acting is worse than no control.
 */
function downloadCsv(rows: PortfolioTenant[]): void {
  const header = [
    'tenant',
    'slug',
    'active',
    'open_alerts',
    'critical_alerts',
    'high_alerts',
    'untriaged_alerts',
    'synthetic_alerts',
    'open_cases',
    'sla_breached_cases',
    'mttr_minutes',
    'connectors_total',
    'connectors_healthy',
    'connectors_stale',
    'connectors_error',
    'last_event_at',
  ];
  const escape = (value: string | number | boolean | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((t) =>
    [
      t.name,
      t.slug,
      t.is_active,
      t.open_alerts,
      t.critical_alerts,
      t.high_alerts,
      t.untriaged_alerts,
      t.synthetic_alerts,
      t.open_cases,
      t.sla_breached_cases,
      t.mttr_minutes,
      t.connectors.total,
      t.connectors.healthy,
      t.connectors.stale,
      t.connectors.error,
      t.last_event_at,
    ]
      .map(escape)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function summaryCards(portfolio: Portfolio): { label: string; value: string; hint?: string }[] {
  const s = portfolio.summary;
  return [
    { label: 'Tenants', value: String(s.tenants), hint: `${s.tenants_active} active` },
    { label: 'Open alerts', value: String(s.open_alerts), hint: `${s.critical_alerts} critical, ${s.high_alerts} high` },
    { label: 'Untriaged', value: String(s.untriaged_alerts), hint: 'Awaiting a first verdict' },
    { label: 'Open cases', value: String(s.open_cases), hint: `${s.sla_breached_cases} past SLA` },
    { label: 'MTTR', value: formatMinutes(s.mttr_minutes), hint: 'Cases closed in the last 30 days' },
    {
      label: 'Connectors',
      value: `${s.connectors_healthy}/${s.connectors_total}`,
      hint: s.connectors_total === 0 ? 'None connected' : `${s.connectors_stale} stale, ${s.connectors_error} error`,
    },
  ];
}

export default function MSSPDashboardView() {
  const [filter, setFilter] = useState<TenantFilter>('all');

  // No `fallbackData`: supplying it disables SWR revalidation, so a placeholder
  // becomes what the view permanently shows rather than a first paint.
  const {
    data: portfolio,
    error: portfolioError,
    isLoading,
    mutate,
  } = useSWR<Portfolio>('mssp-portfolio', () => msspApi.getPortfolio(), { refreshInterval: 60_000 });

  const { data: alerts, error: alertsError } = useSWR<PortfolioAlert[]>('mssp-portfolio-alerts', () =>
    msspApi.listPortfolioAlerts({ limit: 25 }),
  );

  const tenants = useMemo(() => portfolio?.tenants ?? [], [portfolio]);
  const visible = useMemo(() => tenants.filter((t) => matches(t, filter)), [tenants, filter]);

  const notAMember = portfolioError instanceof ApiError && portfolioError.status === 403;

  const header = (
    <div>
      <h1 className="text-page-title font-bold text-fg-primary">Managed portfolio</h1>
      <p className="text-fg-muted mt-1 text-body">
        {portfolio?.org_name ? (
          <>
            Tenants managed by{' '}
            <span className="text-fg-primary">{portfolio.org_name}</span>
          </>
        ) : (
          'Security posture across the tenants you manage'
        )}
      </p>
    </div>
  );

  if (notAMember) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={EmptyStateIcons.shield}
          title="You do not manage any tenants"
          description="This view is for operators who manage tenants on behalf of others. Your account belongs to no operator organisation, so there is no portfolio to show. An organisation owner can add you from their settings."
        />
      </div>
    );
  }

  if (portfolioError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Could not load the portfolio"
          description="The portfolio API did not answer. Nothing below is being substituted for it."
          error={portfolioError}
          onRetry={() => void mutate()}
        />
      </div>
    );
  }

  if (isLoading || !portfolio) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-body text-fg-muted" role="status">
          Loading portfolio…
        </p>
      </div>
    );
  }

  const hasTenants = tenants.length > 0;

  return (
    <div className="space-y-6">
      {header}

      {portfolio.summary.synthetic_alerts > 0 && (
        <p className="rounded-control border border-tone-warning/30 bg-pill-warning-bg px-4 py-2 text-body text-tone-warning">
          {portfolio.summary.synthetic_alerts} seeded demo alert(s) are counted separately and excluded from the
          figures above.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {summaryCards(portfolio).map((c) => (
          <div key={c.label} className="rounded-container border border-surface-border bg-surface-card p-4">
            <p className="text-caption text-fg-muted uppercase tracking-wider">{c.label}</p>
            <p className="mt-1 text-kpi font-semibold font-mono tabular-nums text-fg-primary">{c.value}</p>
            {c.hint && <p className="mt-1 text-xs text-fg-subtle">{c.hint}</p>}
          </div>
        ))}
      </div>

      <section className="rounded-container border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-card-title font-semibold text-fg-primary">Tenants</h2>
          <div className="flex items-center gap-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                title={f.hint}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={clsx(
                  'rounded-pill px-2.5 py-1 text-xs font-medium transition',
                  filter === f.key ? 'bg-nav-active-bg text-fg-primary' : 'text-fg-muted hover:text-fg-primary',
                )}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              disabled={visible.length === 0}
              onClick={() => downloadCsv(visible)}
              className="text-control px-3 py-1.5 rounded-control border border-surface-border bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 text-fg-primary transition-colors"
            >
              Export CSV
            </button>
          </div>
        </div>

        {!hasTenants ? (
          <EmptyState
            icon={EmptyStateIcons.shield}
            title={
              portfolio.portfolio_wide
                ? 'This organisation manages no tenants yet'
                : 'You have not been granted access to any tenants'
            }
            description={
              portfolio.portfolio_wide
                ? 'Once a tenant accepts an invitation from this organisation, its posture appears here.'
                : 'Your role reaches only the tenants explicitly granted to you, and none have been. An organisation owner can grant them from their settings.'
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={EmptyStateIcons.shield}
            title="No tenants match this filter"
            description="Every tenant in the portfolio is outside the selected filter."
            action={
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="rounded-control border border-surface-border bg-surface-elevated px-4 py-2 text-control text-fg-primary hover:bg-surface-hover transition-colors"
              >
                Show all tenants
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-surface-border text-left text-caption uppercase tracking-wider text-fg-muted">
                  <th scope="col" className="px-5 py-3 font-medium">Tenant</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Open alerts</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Critical</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Untriaged</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Open cases</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Past SLA</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">MTTR</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Connectors</th>
                  <th scope="col" className="px-5 py-3 font-medium">Last event</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.tenant_id} className="border-b border-surface-border hover:bg-surface-hover transition-colors">
                    <td className="px-5 py-3 font-medium text-fg-primary">
                      {t.name}
                      {!t.is_active && <span className="ml-2 text-xs text-fg-muted">(inactive)</span>}
                      {t.synthetic_alerts > 0 && (
                        <span className="ml-2 rounded-pill px-1.5 py-0.5 text-eyebrow uppercase tracking-wide bg-pill-warning-bg text-tone-warning">
                          {t.synthetic_alerts} seeded
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-secondary">{t.open_alerts}</td>
                    <td className={clsx('px-5 py-3 text-right font-medium font-mono tabular-nums', t.critical_alerts > 0 ? 'text-tone-danger' : 'text-fg-subtle')}>
                      {t.critical_alerts}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-secondary">{t.untriaged_alerts}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-secondary">{t.open_cases}</td>
                    <td className={clsx('px-5 py-3 text-right font-mono tabular-nums', t.sla_breached_cases > 0 ? 'text-tone-warning' : 'text-fg-subtle')}>
                      {t.sla_breached_cases}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-secondary">{formatMinutes(t.mttr_minutes)}</td>
                    <td className={clsx('px-5 py-3 text-right font-mono tabular-nums', connectorTone(t))}>
                      {t.connectors.total === 0 ? 'None' : `${t.connectors.healthy}/${t.connectors.total}`}
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{formatTimestamp(t.last_event_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-container border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border">
          <h2 className="text-card-title font-semibold text-fg-primary">Open alerts across the portfolio</h2>
        </div>
        {alertsError ? (
          <ErrorState
            title="Could not load portfolio alerts"
            description="The alert feed did not answer. No placeholder is being shown in its place."
            error={alertsError}
            className="m-5"
          />
        ) : !alerts ? (
          <p className="px-5 py-6 text-body text-fg-muted" role="status">
            Loading alerts…
          </p>
        ) : alerts.length === 0 ? (
          <EmptyState
            icon={EmptyStateIcons.alert}
            title="No open alerts"
            description="No tenant in this portfolio has an open alert right now."
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {alerts.map((a) => (
              <li key={a.alert_id} className="px-5 py-3 flex items-center gap-4">
                <span
                  className={clsx(
                    'rounded-pill px-2.5 py-0.5 text-xs font-medium capitalize shrink-0',
                    SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.info,
                  )}
                >
                  {a.severity}
                </span>
                <Link href={`/alerts/${a.alert_id}`} className="text-body text-fg-primary hover:text-accent truncate">
                  {a.title}
                </Link>
                <span className="ml-auto text-xs text-fg-muted shrink-0">{a.tenant_name}</span>
                <span className="text-xs text-fg-subtle shrink-0">{formatTimestamp(a.event_time ?? a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
