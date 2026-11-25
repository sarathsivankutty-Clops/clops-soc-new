'use client';

/**
 * Grid of saved connector instances with per-card actions.
 *
 * The list itself is purely presentational — the parent (`ConnectorsView`)
 * owns data fetching and mutation so SWR cache invalidation lives in one
 * place. This component only knows how to render a `Connector[]` and emit
 * action callbacks (test, configure, delete) when the operator clicks a row.
 *
 * Layout follows the rest of the AiSOC dashboard: 3-up grid on wide
 * screens, with a trailing "Add Connector" tile that the parent wires to
 * the `AddConnectorModal`. Empty state replaces the grid entirely so a
 * fresh tenant gets a useful onboarding nudge instead of just the
 * dashed placeholder card.
 */

import { useEffect } from 'react';
import { clsx } from 'clsx';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusPill, type StatusKind } from '@/components/ui/StatusPill';
import type { Connector, ConnectorTestResult } from '@/lib/api';

const CONNECTOR_LABELS: Record<string, string> = {
  crowdstrike: 'CS',
  splunk: 'SPL',
  aws_security_hub: 'AWS',
  okta: 'OKT',
  microsoft_sentinel: 'SNT',
  azure_entra: 'AZE',
  azure_activity: 'AZA',
  azure_defender: 'AZD',
  gcp_cloud_audit: 'GCP',
  gcp_scc: 'SCC',
  m365_audit: 'M365',
  google_workspace: 'GWS',
  cloudflare: 'CF',
  github: 'GH',
};

const STATUS_CONFIG: Record<
  Connector['status'],
  { label: string; color: string; dot: string }
> = {
  active: {
    label: 'Active',
    color: 'text-tone-success bg-pill-success-bg border-tone-success/30',
    dot: 'bg-tone-success',
  },
  inactive: {
    label: 'Inactive',
    color: 'text-fg-muted bg-surface-raised border-surface-border',
    dot: 'bg-surface-raised',
  },
  error: {
    label: 'Error',
    color: 'text-tone-danger bg-pill-danger-bg border-tone-danger/30',
    dot: 'bg-pill-danger-bg',
  },
  configuring: {
    label: 'Configuring',
    color: 'text-tone-warning bg-pill-warning-bg border-tone-warning/30',
    dot: 'bg-pill-warning-bg',
  },
};

function formatLastSync(ts?: string): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(diff)) return 'never';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Render a duration in seconds as a short, human-readable label.
 *
 * Used by the freshness badge tooltip ("Last event 2m ago, expected
 * every 5m"). Kept tiny on purpose — the badge text itself is sized to
 * fit alongside the schema-drift pill, so anything longer than `12m`
 * starts wrapping the row.
 */
function formatDurationSeconds(secs: number | null | undefined): string {
  if (secs == null) return 'never';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(secs / 86400)}d`;
}

/**
 * Tailwind classes for the three rendered freshness states.
 *
 * Centralised so every surface rendering a freshness badge reads the
 * same three swatches. ``unknown`` deliberately has no row —
 * we don't render that variant so a freshly-saved connector with no
 * events yet looks clean instead of being painted gray "stale."
 */
const FRESHNESS_BADGE_STYLES: Record<'green' | 'yellow' | 'red', string> = {
  green: 'text-tone-success bg-pill-success-bg border-tone-success/30',
  yellow: 'text-tone-warning bg-pill-warning-bg border-tone-warning/30',
  red: 'text-tone-danger bg-pill-danger-bg border-tone-danger/30',
};

const FRESHNESS_BADGE_LABELS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Fresh',
  yellow: 'Late',
  red: 'Stalled',
};

function abbreviateType(type: string | undefined): string {
  if (!type) return '???';
  if (CONNECTOR_LABELS[type]) return CONNECTOR_LABELS[type];
  return type.slice(0, 3).toUpperCase();
}

// ─── Card ────────────────────────────────────────────────────────────────────

interface ConnectorCardProps {
  connector: Connector;
  testing: boolean;
  /** `true` = last test passed, `false` = failed, `undefined` = idle. */
  testResult: boolean | undefined;
  onTest: (id: string) => void;
  onConfigure?: (connector: Connector) => void;
  onDelete?: (connector: Connector) => void;
}

// [HIDDEN-UI UI-OVERHAUL-4 the card layout was replaced by the connector
// table below. Retained for rollback without changing the existing card UI.
export function LegacyConnectorCard({
  connector,
  testing,
  testResult,
  onTest,
  onConfigure,
  onDelete,
}: ConnectorCardProps) {
  const statusCfg = STATUS_CONFIG[connector.status] ?? STATUS_CONFIG.configuring;
  const alertCount = connector.alertCount ?? connector.alertsIngested ?? 0;
  const eventsDropped = connector.eventsDropped ?? 0;
  const driftAt = connector.lastSchemaDriftAt;
  const drift = connector.lastDriftDetails;
  const driftAdded = drift?.added?.length ?? 0;
  const driftRemoved = drift?.removed?.length ?? 0;
  const driftRecent =
    driftAt &&
    Date.now() - new Date(driftAt).getTime() < 24 * 60 * 60 * 1000;

  // Compose the drift tooltip lazily — only the schema-drift sentinel emits a
  // diff so we keep the UI quiet when nothing has changed.
  const driftTooltip = drift
    ? [
        driftAdded > 0 ? `+${driftAdded} new field${driftAdded === 1 ? '' : 's'}` : null,
        driftRemoved > 0
          ? `-${driftRemoved} removed field${driftRemoved === 1 ? '' : 's'}`
          : null,
        driftAt ? `at ${new Date(driftAt).toLocaleString()}` : null,
      ]
        .filter(Boolean)
        .join(' • ')
    : '';

  // Freshness SLO badge: server computes the verdict from ``last_event_at``
  // against a per-category cadence table (5m EDR, 15m SIEM, 30m SaaS, 1h
  // vuln, etc.) so a Splunk that polls slowly doesn't drag CrowdStrike's
  // status down. We only render green/yellow/red — ``unknown`` (newly
  // configured, no events yet) is already conveyed by "Last sync: never"
  // and adding a gray badge there would be visual noise.
  const freshness = connector.freshness;
  const showFreshnessBadge =
    freshness && (freshness.status === 'green' || freshness.status === 'yellow' || freshness.status === 'red');
  const freshnessTooltip = freshness
    ? [
        freshness.seconds_since_last_event != null
          ? `Last event ${formatDurationSeconds(freshness.seconds_since_last_event)} ago`
          : 'No events received yet',
        `expected every ${formatDurationSeconds(freshness.expected_cadence_seconds)}`,
      ].join(', ')
    : '';

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 hover:border-surface-border transition-colors flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-surface-raised rounded-xl flex items-center justify-center text-caption font-semibold uppercase tracking-wider text-fg-muted flex-shrink-0">
            {abbreviateType(connector.type)}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-fg-primary truncate">{connector.name}</h3>
            <p className="text-xs text-fg-muted truncate">{connector.type}</p>
          </div>
        </div>
        <span
          className={clsx(
            'text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 flex-shrink-0',
            statusCfg.color,
          )}
          title={connector.errorMessage}
        >
          <span className={clsx('w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
          {statusCfg.label}
        </span>
      </div>

      {connector.description && (
        <p className="text-xs text-fg-muted mb-4 line-clamp-2">{connector.description}</p>
      )}

      {/* Schema-drift, filter-drop, and freshness SLO badges. Only render
          when there is something to surface so a healthy, fresh connector
          keeps its clean look. */}
      {(driftAt || eventsDropped > 0 || showFreshnessBadge) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {showFreshnessBadge && freshness && (
            <span
              title={freshnessTooltip}
              className={clsx(
                'text-caption px-2 py-0.5 rounded-full border inline-flex items-center gap-1',
                FRESHNESS_BADGE_STYLES[
                  freshness.status as 'green' | 'yellow' | 'red'
                ],
              )}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {
                FRESHNESS_BADGE_LABELS[
                  freshness.status as 'green' | 'yellow' | 'red'
                ]
              }
            </span>
          )}
          {driftAt && (
            <span
              title={driftTooltip}
              className={clsx(
                'text-caption px-2 py-0.5 rounded-full border inline-flex items-center gap-1',
                driftRecent
                  ? 'text-tone-warning bg-pill-warning-bg border-tone-warning/30'
                  : 'text-fg-muted bg-surface-raised border-surface-border',
              )}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-2.99l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z"
                />
              </svg>
              {driftRecent ? 'Schema drift' : 'Schema changed'}
              {(driftAdded > 0 || driftRemoved > 0) && (
                <span className="opacity-80">
                  {driftAdded > 0 && `+${driftAdded}`}
                  {driftAdded > 0 && driftRemoved > 0 && '/'}
                  {driftRemoved > 0 && `-${driftRemoved}`}
                </span>
              )}
            </span>
          )}
          {eventsDropped > 0 && (
            <span
              title={`${eventsDropped.toLocaleString()} event${eventsDropped === 1 ? '' : 's'} dropped by pre-ingest filter rules`}
              className="text-caption px-2 py-0.5 rounded-full border inline-flex items-center gap-1 text-accent bg-accent-subtle border-accent"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                />
              </svg>
              {eventsDropped.toLocaleString()} dropped
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-surface-raised rounded-lg p-2">
          <p className="text-xs text-fg-muted">Events ingested</p>
          <p className="text-sm font-medium text-fg-secondary">
            {alertCount.toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-raised rounded-lg p-2">
          <p className="text-xs text-fg-muted">Last sync</p>
          <p className="text-sm font-medium text-fg-secondary">
            {formatLastSync(connector.lastSync)}
          </p>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onTest(connector.id)}
          disabled={testing}
          className="flex-1 text-xs bg-surface-raised hover:bg-surface-raised text-fg-secondary px-3 py-2 rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {testing && (
            <span className="animate-spin w-3 h-3 border-2 border-accent border-t-transparent rounded-full" />
          )}
          Test
        </button>
        {onConfigure && (
          <button
            type="button"
            onClick={() => onConfigure(connector)}
            aria-label={`Configure ${connector.name}`}
            className="flex-1 text-xs bg-surface-raised hover:bg-surface-raised text-fg-secondary px-3 py-2 rounded-lg transition-colors"
          >
            Configure
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(connector)}
            aria-label={`Delete ${connector.name}`}
            className="text-xs text-fg-muted hover:text-tone-danger px-2 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
              />
            </svg>
          </button>
        )}
      </div>

      {testResult !== undefined && (
        <p
          className={clsx(
            'mt-3 text-xs',
            testResult ? 'text-tone-success' : 'text-tone-danger',
          )}
        >
          {testResult ? '✓ Connection successful' : '✗ Connection failed'}
        </p>
      )}
    </div>
  );
}

const STATUS_PILLS: Record<Connector['status'], { status: StatusKind; label: string }> = {
  active: { status: 'completed', label: 'Healthy' },
  inactive: { status: 'unknown', label: 'Inactive' },
  error: { status: 'failed', label: 'Error' },
  configuring: { status: 'pending', label: 'Configuring' },
};

const FRESHNESS_PILLS: Record<
  NonNullable<Connector['freshness']>['status'],
  { status: StatusKind; label: string }
> = {
  green: { status: 'completed', label: 'Fresh' },
  yellow: { status: 'pending', label: 'Late' },
  red: { status: 'failed', label: 'Stalled' },
  unknown: { status: 'unknown', label: 'Unknown' },
};

function ConnectorTableRow({
  connector,
  testing,
  onTest,
  onDetails,
  onConfigure,
  onDelete,
}: {
  connector: Connector;
  testing: boolean;
  onTest: (id: string) => void;
  onDetails: (id: string) => void;
  onConfigure?: (connector: Connector) => void;
  onDelete?: (connector: Connector) => void;
}) {
  const driftAdded = connector.lastDriftDetails?.added?.length ?? 0;
  const driftRemoved = connector.lastDriftDetails?.removed?.length ?? 0;
  const driftLabel = connector.lastSchemaDriftAt
    ? `${driftAdded > 0 ? `+${driftAdded}` : ''}${driftAdded > 0 && driftRemoved > 0 ? ' / ' : ''}${driftRemoved > 0 ? `-${driftRemoved}` : ''}`
    : 'No drift';

  return (
    <tr className="border-t border-surface-border text-body text-fg-secondary">
      <td className="px-4 py-3">
        <div className="flex min-w-48 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface-elevated text-eyebrow font-semibold text-fg-muted">
            {abbreviateType(connector.type)}
          </span>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onDetails(connector.id)}
              className="block max-w-64 truncate text-left font-medium text-fg-primary hover:text-accent"
            >
              {connector.name}
            </button>
            <p className="font-mono text-caption text-fg-muted">{connector.type}</p>
            {connector.description && (
              <p className="max-w-64 truncate text-caption text-fg-subtle">{connector.description}</p>
            )}
          </div>
        </div>
      </td>
      {/* [HIDDEN-UI SETTINGS-G6 Type and Freshness SLO had their own columns; with four action buttons the table overflowed
          at 1440 and scrolled sideways. Type now sits under the name, freshness under the health pill.
      <td className="whitespace-nowrap px-4 py-3 text-caption text-fg-muted">
        {connector.type}
      </td>
      ] */}
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-col items-start gap-1">
        <StatusPill
          status={STATUS_PILLS[connector.status].status}
          label={STATUS_PILLS[connector.status].label}
          title={connector.errorMessage}
        />
        <StatusPill
          status={FRESHNESS_PILLS[connector.freshness?.status ?? 'unknown'].status}
          label={FRESHNESS_PILLS[connector.freshness?.status ?? 'unknown'].label}
          title={
            connector.freshness
              ? `Last event ${formatDurationSeconds(connector.freshness.seconds_since_last_event)} ago; expected every ${formatDurationSeconds(connector.freshness.expected_cadence_seconds)}`
              : 'No freshness data reported'
          }
        />
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <p className="font-medium text-fg-primary">
          {(connector.alertCount ?? connector.alertsIngested ?? 0).toLocaleString()} events
        </p>
        <p className="text-caption text-fg-subtle">Last sync {formatLastSync(connector.lastSync)}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span
          title={
            connector.lastSchemaDriftAt
              ? `Changed ${new Date(connector.lastSchemaDriftAt).toLocaleString()}`
              : undefined
          }
          className={clsx(
            'inline-flex rounded-pill px-2.5 py-0.5 text-caption font-medium',
            connector.lastSchemaDriftAt
              ? 'bg-pill-warning-bg text-tone-warning'
              : 'bg-pill-neutral-bg text-fg-muted',
          )}
        >
          {driftLabel}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onTest(connector.id)}
            disabled={testing}
            className="min-h-8 rounded-control border border-surface-border px-2.5 py-1.5 text-caption font-medium text-fg-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            onClick={() => onDetails(connector.id)}
            aria-label={`Details for ${connector.name}`}
            className="min-h-8 rounded-control border border-surface-border px-2.5 py-1.5 text-caption text-fg-secondary hover:bg-surface-hover"
          >
            Details
          </button>
          {onConfigure && (
            <button
              type="button"
              onClick={() => onConfigure(connector)}
              aria-label={`Configure ${connector.name}`}
              className="min-h-8 rounded-control border border-surface-border px-2.5 py-1.5 text-caption text-fg-secondary hover:bg-surface-hover"
            >
              Configure
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(connector)}
              aria-label={`Delete ${connector.name}`}
              title="Delete"
              className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-control border border-surface-border text-tone-danger hover:bg-pill-danger-bg"
            >
              {/* [HIDDEN-UI SETTINGS-G6 text label "Delete"; an icon keeps the actions column narrow] */}
              <svg aria-hidden className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function ConnectorDetailsDrawer({
  connector,
  testing,
  testResult,
  onClose,
  onTest,
}: {
  connector: Connector | null;
  testing: boolean;
  testResult?: ConnectorTestResult;
  onClose: () => void;
  onTest: (id: string) => void;
}) {
  useEffect(() => {
    if (!connector) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connector, onClose]);

  if (!connector) return null;

  const drift = connector.lastDriftDetails;
  const driftFieldsAvailable = Boolean(drift?.added?.length || drift?.removed?.length);
  const latency = testResult?.latency_ms ?? testResult?.latencyMs;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <button
        type="button"
        aria-label="Close connector details"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Connector details: ${connector.name}`}
        className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-surface-border bg-surface-card shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-surface-border p-5">
          <div className="min-w-0">
            <h2 className="truncate text-section-title font-semibold text-fg-primary">
              {connector.name}
            </h2>
            <p className="mt-1 text-caption text-fg-muted">{connector.type}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control border border-surface-border px-2 py-1 text-caption text-fg-muted hover:bg-surface-hover"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <section aria-labelledby="connector-test-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="connector-test-heading" className="text-control font-semibold text-fg-primary">
                Connection test
              </h3>
              <button
                type="button"
                onClick={() => onTest(connector.id)}
                disabled={testing}
                className="rounded-control border border-surface-border px-3 py-1.5 text-caption font-medium text-fg-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Run test'}
              </button>
            </div>
            {testing ? (
              <div className="flex items-center gap-2">
                <StatusPill status="running" label="Testing" />
                <span className="text-caption text-fg-muted">Checking the saved connection.</span>
              </div>
            ) : testResult ? (
              <div className="space-y-2">
                <StatusPill
                  status={testResult.success ? 'completed' : 'failed'}
                  label={testResult.success ? 'Passed' : 'Failed'}
                />
                {testResult.message && (
                  <p className="text-body text-fg-secondary">{testResult.message}</p>
                )}
                {testResult.error && (
                  <p role="alert" className="rounded-control border border-pill-danger-bg bg-pill-danger-bg p-3 text-caption text-tone-danger">
                    {testResult.error}
                  </p>
                )}
                {latency !== undefined && (
                  <p className="text-caption text-fg-muted">Latency: {latency} ms</p>
                )}
              </div>
            ) : (
              <p className="text-caption text-fg-muted">No connection test run in this session.</p>
            )}
            {connector.errorMessage && (
              <p className="text-caption text-fg-muted">Last connector error: {connector.errorMessage}</p>
            )}
          </section>

          <section aria-labelledby="connector-freshness-heading" className="space-y-2">
            <h3 id="connector-freshness-heading" className="text-control font-semibold text-fg-primary">
              Data freshness
            </h3>
            <dl className="grid grid-cols-2 gap-3 rounded-container border border-surface-border p-3">
              <div>
                <dt className="text-caption text-fg-subtle">Last event</dt>
                <dd className="text-caption text-fg-secondary">
                  {connector.lastEventAt ? new Date(connector.lastEventAt).toLocaleString() : 'Not reported'}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-fg-subtle">Last sync</dt>
                <dd className="text-caption text-fg-secondary">{formatLastSync(connector.lastSync)}</dd>
              </div>
              <div>
                <dt className="text-caption text-fg-subtle">Freshness category</dt>
                <dd className="text-caption text-fg-secondary">{connector.freshness?.category ?? 'Not reported'}</dd>
              </div>
              <div>
                <dt className="text-caption text-fg-subtle">Events dropped</dt>
                <dd className="text-caption text-fg-secondary">{(connector.eventsDropped ?? 0).toLocaleString()}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="connector-drift-heading" className="space-y-2">
            <h3 id="connector-drift-heading" className="text-control font-semibold text-fg-primary">
              Schema drift
            </h3>
            {connector.lastSchemaDriftAt ? (
              <div className="space-y-3 rounded-container border border-surface-border p-3">
                <p className="text-caption text-fg-secondary">
                  Last changed {new Date(connector.lastSchemaDriftAt).toLocaleString()}
                </p>
                {driftFieldsAvailable ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DriftFieldList label="Added" fields={drift?.added ?? []} prefix="+" />
                    <DriftFieldList label="Removed" fields={drift?.removed ?? []} prefix="−" />
                  </div>
                ) : (
                  <p className="text-caption text-fg-muted">The field-level diff is not available.</p>
                )}
                {connector.schemaFingerprint && (
                  <p className="break-all text-eyebrow text-fg-subtle">
                    Current schema fingerprint: {connector.schemaFingerprint}
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-container border border-surface-border p-3 text-caption text-fg-muted">
                No schema drift has been recorded.
              </p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function DriftFieldList({ label, fields, prefix }: { label: string; fields: string[]; prefix: string }) {
  return (
    <div>
      <h4 className="text-caption font-medium text-fg-secondary">{label} ({fields.length})</h4>
      {fields.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {fields.map((field) => (
            <li key={field} className="break-all text-caption text-fg-muted">
              {prefix} {field}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-caption text-fg-subtle">None</p>
      )}
    </div>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

export interface ConnectorInstanceListProps {
  connectors: Connector[];
  isLoading?: boolean;
  /**
   * The list request failed, so `connectors` is empty because nothing could be
   * read — not because the tenant has none. Without this the onboarding empty
   * state ("No connectors yet · Add your first connector") renders over a
   * tenant's working estate during any API outage.
   */
  failed?: boolean;
  testingId?: string | null;
  onTest: (id: string) => void;
  onDetails: (id: string) => void;
  onAdd: () => void;
  onConfigure?: (connector: Connector) => void;
  onDelete?: (connector: Connector) => void;
}

export function ConnectorInstanceList({
  connectors,
  isLoading,
  failed,
  testingId,
  onTest,
  onDetails,
  onAdd,
  onConfigure,
  onDelete,
}: ConnectorInstanceListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-container border border-surface-border bg-surface-card px-4 py-12 text-center">
        <p className="text-control text-tone-warning">The connector list could not be loaded.</p>
        <p className="text-caption text-fg-subtle">
          Treat this as unknown rather than as an empty estate — see the message above, and
          retry from there.
        </p>
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <EmptyState
        icon={
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z"
            />
          </svg>
        }
        // The nearest heading above this is the page `h1`, so the default
        // `h3` skips a level and fails the axe-core heading-order gate.
        headingLevel="h2"
        title="No connectors yet"
        description={/* [HIDDEN-UI THEME-7 prior label: AiSOC vault] */ "Connect your first security tool to start ingesting alerts. Credentials are encrypted at rest with the ClopsSOC vault."}
        action={
          <button
            type="button"
            onClick={onAdd}
              className="rounded-control bg-btn-grad px-4 py-2 text-control font-semibold text-white transition-all hover:brightness-105"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add your first connector
          </button>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-container border border-surface-border bg-surface-card">
      <table className="w-full min-w-max text-left">
        <caption className="sr-only">Installed connectors and their health</caption>
        <thead className="bg-surface-elevated text-eyebrow uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Connector</th>
            {/* [HIDDEN-UI SETTINGS-G6 <th>Type</th> and <th>Freshness SLO</th> folded into Connector and Status] */}
            <th scope="col" className="px-4 py-3 font-medium">Status / Freshness</th>
            <th scope="col" className="px-4 py-3 font-medium">Events / Last Sync</th>
            <th scope="col" className="px-4 py-3 font-medium">Schema Drift</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {connectors.map((connector) => (
            <ConnectorTableRow
              key={connector.id}
              connector={connector}
              testing={testingId === connector.id}
              onTest={onTest}
              onDetails={onDetails}
              onConfigure={onConfigure}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
      {/* [HIDDEN-UI UI-OVERHAUL-4 the trailing add tile was moved to the
          page header; its markup is retained there for reference.
      <button
        type="button"
        onClick={onAdd}
        className="bg-surface-card border border-dashed border-surface-border rounded-xl p-5 flex flex-col items-center justify-center gap-3 hover:border-surface-border hover:bg-surface-card transition-colors text-left"
      >
        <div className="w-10 h-10 bg-surface-raised rounded-xl flex items-center justify-center text-fg-muted">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm text-fg-secondary">Add Connector</p>
          <p className="text-xs text-fg-subtle mt-0.5">Connect a new security tool</p>
        </div>
      </button>
      */}
    </div>
  );
}
