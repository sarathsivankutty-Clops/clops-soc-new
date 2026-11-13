'use client';

import { useState, useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import Link from 'next/link';
import { BulkTriageBar } from './BulkTriageBar';
import { alertsApi, type Alert, type AlertFacets, type AlertFilters, type ConfidenceLabel } from '@/lib/api';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { EntityRiskQueue } from './EntityRiskQueue';
import { InvestigationRail } from './InvestigationRail';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { PageHead } from '@/components/ui/PageHead';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { SavedViewsBar } from '@/components/saved-views/SavedViewsBar';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { demoFallback } from '@/lib/demoFallback';

// Wave 1 of the AiSOC v6 capability roadmap. The "entities" tab renders the
// rolled-up Risk-Based Alerting queue — alerts contribute time-decayed risk
// points to the entities they touch, and the queue surfaces those entities
// (not the raw alerts) to the analyst. The "alerts" tab keeps the legacy
// alert-centric grid for tenants that prefer it or have RBA disabled.
//
// v1.5 W6 — The alerts tab is now a two-pane layout: the dense grid on the
// left, an Investigation Rail on the right. Selecting a row populates the
// rail with the deterministic narrative + related entities + recent events +
// recommended actions envelope from `GET /alerts/{id}`. The legacy
// `ExplainDrawer` is no longer mounted from this view directly; it has been
// demoted to a "Deep Explain" button inside the rail itself, so analysts
// only burn an LLM call when they explicitly ask for it.
type ViewMode = 'entities' | 'alerts';

// ─── Config ───────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  /* [HIDDEN-UI THEME-4 kept all 5 severity tiers distinct with dot + soft tint, no border] */
  critical: { label: 'Critical', dot: 'bg-severity-dot-critical', text: 'text-severity-ink-critical', bg: 'bg-severity-bg-critical' },
  high: { label: 'High', dot: 'bg-severity-dot-high', text: 'text-severity-ink-high', bg: 'bg-severity-bg-high' },
  medium: { label: 'Medium', dot: 'bg-severity-dot-medium', text: 'text-severity-ink-medium', bg: 'bg-severity-bg-medium' },
  low: { label: 'Low', dot: 'bg-severity-dot-low', text: 'text-severity-ink-low', bg: 'bg-severity-bg-low' },
  info: { label: 'Info', dot: 'bg-severity-dot-info', text: 'text-severity-ink-info', bg: 'bg-severity-bg-info' },
};

const STATUS_CONFIG = {
  new: { label: 'New', color: 'text-tone-purple bg-pill-purple-bg', dot: 'bg-dot-purple' },
  triaged: { label: 'Triaged', color: 'text-accent bg-pill-info-bg', dot: 'bg-dot-info' },
  investigating: { label: 'Investigating', color: 'text-tone-warning bg-pill-warning-bg', dot: 'bg-dot-warning' },
  resolved: { label: 'Resolved', color: 'text-tone-success bg-pill-success-bg', dot: 'bg-dot-success' },
  false_positive: { label: 'False Positive', color: 'text-fg-muted bg-pill-neutral-bg', dot: 'bg-dot-neutral' },
};

// ─── Mock Data ────────────────────────────────────────────────────────────────

// Deterministic mock data — no Date.now() or Math.random() to avoid SSR hydration mismatches.
const MOCK_BASE_TS = '2026-05-06T12:00:00Z';
const MOCK_ALERTS: Alert[] = Array.from({ length: 25 }, (_, i): Alert => {
  const sev = (['critical', 'high', 'high', 'medium', 'medium', 'medium', 'low', 'info'] as const)[i % 8];
  const src = ['CrowdStrike', 'Splunk', 'AWS Security Hub', 'Okta', 'Microsoft Sentinel'][i % 5];
  const status = (['new', 'investigating', 'new', 'resolved', 'false_positive'] as const)[i % 5];
  const conf = (['high', 'high', 'medium', 'medium', 'medium', 'low'] as const)[i % 6];
  const confScore = conf === 'high' ? 0.78 + (i % 5) * 0.03 : conf === 'medium' ? 0.45 + (i % 5) * 0.03 : 0.18 + (i % 5) * 0.03;
  const base = new Date(MOCK_BASE_TS).getTime();
  return {
    id: `ALT-${String(1000 + i).padStart(4, '0')}`,
    title: [
      'Suspicious PowerShell Execution via Encoded Command',
      'Lateral Movement via WMI Remote Execution',
      'Credential Dumping Detected: LSASS Access',
      'New Admin Account Created Outside Business Hours',
      'DNS Tunneling Activity Detected',
      'Brute Force Attack: 50+ Failed Logins in 5 Minutes',
      'Malicious File Download: Known Malware Signature',
      'Privilege Escalation: Sudo Command Without Password',
      'Ransomware Behavior: Mass File Encryption Attempt',
      'Command and Control Beacon Traffic Detected',
    ][i % 10],
    description: 'Automated detection based on behavioral analytics and threat intelligence correlation.',
    severity: sev,
    status,
    source: src,
    createdAt: new Date(base - i * 1800000).toISOString(),
    updatedAt: new Date(base - i * 900000).toISOString(),
    tenantId: 'default',
    assignee: i % 3 === 0 ? 'analyst@example.com' : undefined,
    tags: i % 2 === 0 ? ['mitre:T1059', 'endpoint'] : ['network'],
    iocs: [],
    mitreAttack: i % 3 === 0 ? [{ tactic: 'Execution', technique: 'PowerShell', techniqueId: 'T1059.001' }] : [],
    riskScore: ((i * 37 + 13) % 100),
    confidenceLabel: conf,
    // Canonical 0-100 scale, matching what `normalizeAlert` emits for a real
    // alert. Sample data on a different scale than the real payload is how the
    // `2100%` render passed review.
    confidenceScore: Math.round(confScore * 100),
  };
});

/**
 * The aggregate the API would return for a set of alerts.
 *
 * Only reachable through `demoFallback`, where `MOCK_ALERTS` is the entire
 * result set rather than a page of one — so this is the same question the
 * server answers, not the page-derived count the stat strip used to show.
 */
function demoFacets(rows: Alert[]): AlertFacets {
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  // Mirrors `app/services/alert_status.py`: anything not explicitly finished
  // is still someone's problem.
  const RESOLVED = new Set(['resolved', 'closed']);
  return {
    bySeverity,
    byStatus,
    unresolved: rows.filter((r) => !RESOLVED.has(r.status)).length,
  };
}

// Wave 1 — Detection confidence chip rendered inline in the alert grid so an
// analyst can spot low-confidence alerts at a glance without clicking through.
// Click-through still goes to AlertDetailView for the full evidence chain.
const CONFIDENCE_ROW_CONFIG: Record<ConfidenceLabel, { label: string; tone: BadgeTone }> = {
  /* [HIDDEN-UI THEME-7 use shared semantic tones instead of raw palette styles]
  high: { label: 'HIGH', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  medium: { label: 'MED', cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  low: { label: 'LOW', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/20' },
  */
  high: { label: 'HIGH', tone: 'success' },
  medium: { label: 'MED', tone: 'warning' },
  low: { label: 'LOW', tone: 'neutral' },
};

function ConfidencePill({ label }: { label: ConfidenceLabel }) {
  const cfg = CONFIDENCE_ROW_CONFIG[label];
  /* [HIDDEN-UI THEME-7 shared Badge now provides the dot and token tint]
  return (
    <span
      className={clsx('text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border shrink-0', cfg.cls)}
      title={`Detection confidence: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  ); */
  return <Badge tone={cfg.tone} title={`Detection confidence: ${cfg.label}`}>{cfg.label}</Badge>;
}

const SEVERITY_BADGE_TONES: Record<string, BadgeTone> = {
  critical: 'severity-critical',
  high: 'severity-high',
  medium: 'severity-medium',
  low: 'severity-low',
  info: 'severity-info',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * The translated name of a severity tier, or `null` for a value the ladder
 * does not have.
 *
 * Spelled out as a switch over literal keys rather than
 * ``t(`severity.${severity}`)``. The template form would work and
 * `check_i18n_keys.py` would credit the whole surface for it, but
 * `severity` arrives from the API typed as `string`, so an unexpected value
 * would render the key `severity.sev1` on screen as a label. Enumerating
 * the five tiers means an unknown one falls back to the English config
 * instead, which is the behaviour the ladder already had.
 */
function severityLabel(severity: string, t: (key: string) => string): string | null {
  switch (severity) {
    case 'critical':
      return t('severity.critical');
    case 'high':
      return t('severity.high');
    case 'medium':
      return t('severity.medium');
    case 'low':
      return t('severity.low');
    case 'info':
      return t('severity.info');
    default:
      return null;
  }
}

function SeverityDot({ severity }: { severity: string }) {
  const cfg = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.info;
  return <span className={clsx('w-2 h-2 rounded-full shrink-0', cfg.dot)} />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useLocale();
  const cfg = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.info;
  /* [HIDDEN-UI THEME-7 use the shared semantic severity Badge]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-caption font-medium px-2.5 py-0.5 rounded-pill whitespace-nowrap', cfg.text, cfg.bg)}>
      <span aria-hidden="true" className={clsx('w-1.5 h-1.5 rounded-pill shrink-0', cfg.dot)} />
      {severityLabel(severity, t) ?? cfg.label}
    </span>
  ); */
  return (
    <Badge tone={SEVERITY_BADGE_TONES[severity] ?? 'severity-info'}>
      {severityLabel(severity, t) ?? cfg.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.new;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-caption font-medium px-2.5 py-0.5 rounded-pill whitespace-nowrap', cfg.color)}>
      <span aria-hidden="true" className={clsx('w-1.5 h-1.5 rounded-pill shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function FiltersBar({
  filters,
  onChange,
  total,
}: {
  filters: AlertFilters;
  onChange: (f: AlertFilters) => void;
  total: number;
}) {
  const severities = ['all', 'critical', 'high', 'medium', 'low', 'info'] as const;
  const statuses = ['all', 'new', 'investigating', 'triaged', 'resolved', 'false_positive'] as const;

  return (
    <div className="flex items-center gap-3 flex-wrap py-3 px-4 bg-surface-card border border-surface-border rounded-container">
      <div className="flex items-center gap-1 flex-wrap">
        {severities.map((s) => (
          <button
            key={s}
            onClick={() => onChange({ ...filters, severity: s === 'all' ? undefined : s, page: 1 })}
            className={clsx(
              'text-control-sm font-medium px-2.5 py-1 rounded-control transition-colors',
              (s === 'all' && !filters.severity) || filters.severity === s
                ? 'bg-pill-info-bg text-accent font-semibold'
                : 'text-fg-muted hover:text-fg-primary hover:bg-surface-hover'
            )}
          >
            {s === 'all' ? 'All severities' : SEVERITY_CONFIG[s].label}
          </button>
        ))}
      </div>
      <div className="w-px h-4 bg-surface-border" />
      <div className="flex items-center gap-1 flex-wrap">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => onChange({ ...filters, status: s === 'all' ? undefined : s, page: 1 })}
            className={clsx(
              'text-control-sm font-medium px-2.5 py-1 rounded-control transition-colors',
              (s === 'all' && !filters.status) || filters.status === s
                ? 'bg-surface-subtle text-fg-primary font-semibold'
                : 'text-fg-muted hover:text-fg-primary hover:bg-surface-hover'
            )}
          >
            {s === 'all' ? 'All statuses' : STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>
      <span className="ml-auto text-caption font-mono text-fg-muted">{total} total</span>
    </div>
  );
}

// v1.5 W6 — AlertRow is now a *selection* affordance. Plain click selects the
// row (which populates the Investigation Rail to the right); modifier-clicks
// or middle-clicks still navigate to the full detail page so we don't break
// "open in new tab" muscle memory. The row gets a left-border highlight
// when selected so the analyst can see at a glance which alert the rail is
// describing.
function AlertRow({
  alert,
  selected,
  onSelect,
  checked,
  onToggleChecked,
}: {
  alert: Alert;
  selected: boolean;
  onSelect: (id: string) => void;
  checked: boolean;
  onToggleChecked: (id: string) => void;
}) {
  const { t } = useLocale();
  return (
    <Link
      href={`/alerts/${alert.id}`}
      onClick={(e) => {
        // Modifier or middle-click → keep the native Link behaviour so
        // analysts can open the alert in a new tab/window. Only a plain
        // left-click is hijacked for in-pane selection.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
        e.preventDefault();
        onSelect(alert.id);
      }}
      aria-current={selected ? 'true' : undefined}
      className={clsx(
        'flex items-center gap-4 px-4 py-3 transition-colors border-b border-surface-divider last:border-0 border-l-2',
        selected
          ? 'border-l-accent bg-nav-active-bg'
          : 'border-l-transparent hover:bg-surface-elevated',
      )}
    >
      {/*
        Depth 9.3. The row is a Link, so the checkbox has to stop the event
        before it reaches it — otherwise ticking a box navigates to the
        alert, which is the single most irritating way to break a bulk
        selection.
      */}
      <input
        type="checkbox"
        checked={checked}
        aria-label={`Select ${alert.title}`}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          onToggleChecked(alert.id);
        }}
        className="accent-accent shrink-0"
      />

      <SeverityDot severity={alert.severity} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-body font-medium text-fg-primary truncate">{alert.title}</p>
          {alert.mitreAttack && alert.mitreAttack.length > 0 && (
            <Badge tone="severity-high" dot={false}>
              {alert.mitreAttack[0].techniqueId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-caption text-fg-muted">{alert.source}</span>
          {alert.assignee && (
            <>
              <span className="text-fg-subtle">·</span>
              <span className="text-caption text-fg-muted" title={t('alerts.assignee')}>
                {alert.assignee}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {alert.confidenceLabel && <ConfidencePill label={alert.confidenceLabel} />}
        <SeverityBadge severity={alert.severity} />
        <StatusBadge status={alert.status} />
        <span className="text-caption font-mono text-fg-muted w-24 text-right" suppressHydrationWarning>
          {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
        </span>
      </div>
    </Link>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function AlertsView() {
  // `sort: 'priority'` because the API defaults to reverse-chronological for
  // its SDK clients, and in a console that is the wrong default: a noisy
  // low-severity source emitting faster than an analyst pages pushes a
  // critical off page one and keeps it there.
  const [filters, setFilters] = useState<AlertFilters>({
    page: 1,
    pageSize: 25,
    sort: 'priority',
  });
  // Default to the entity-centric queue — that's the whole point of Wave 1's
  // RBA work. Analysts can flip back to the raw alert grid for legacy
  // workflows or when triaging a specific alert ID.
  const [viewMode, setViewMode] = useState<ViewMode>('entities');
  const { t } = useLocale();

  const { data, error, isLoading } = useSWR(
    ['alerts', filters],
    () => alertsApi.list(filters),
    {
      fallbackData: demoFallback({
        alerts: MOCK_ALERTS,
        total: MOCK_ALERTS.length,
        page: 1,
        pageSize: 25,
        // In the hosted demo the mock set *is* the whole result set — there
        // is no server behind it — so counting it here is the same aggregate
        // the API computes, not a page-derived figure. `demoFallback` keeps
        // the whole object out of a real deployment.
        facets: demoFacets(MOCK_ALERTS),
      }),
      refreshInterval: 30000,
    }
  );

  const handleFilterChange = useCallback((newFilters: AlertFilters) => {
    setFilters(newFilters);
  }, []);

  const alerts = data?.alerts || [];
  const total = data?.total || 0;

  // These used to be `alerts.filter(...)` over `data.alerts`, which is one
  // page of `pageSize` rows, rendered beside a server-side `total` in the
  // hundreds — so the tiles were capped at 25 and moved when the analyst
  // paged. `facets` is the same aggregate the server computes for `total`.
  const facets = data?.facets;

  return (
    <div className="space-y-4">
      <PageHead
        className="mb-0"
        title={t('alerts.title')}
        description={
          viewMode === 'entities'
            ? 'Risk-Based Alerting · entity-centric triage queue'
            : 'Real-time security event monitoring and triage'
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div
              role="tablist"
              aria-label="View mode"
              className="inline-flex items-center bg-surface-card border border-surface-border rounded-control p-1 gap-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'entities'}
                onClick={() => setViewMode('entities')}
                className={clsx(
                  'text-control-sm font-medium px-3 py-1 rounded-control transition-colors',
                  viewMode === 'entities'
                    ? 'bg-surface-subtle text-fg-primary font-semibold'
                    : 'text-fg-muted hover:text-fg-primary',
                )}
              >
                Entities
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'alerts'}
                onClick={() => setViewMode('alerts')}
                className={clsx(
                  'text-control-sm font-medium px-3 py-1 rounded-control transition-colors',
                  viewMode === 'alerts'
                    ? 'bg-surface-subtle text-fg-primary font-semibold'
                    : 'text-fg-muted hover:text-fg-primary',
                )}
              >
                Alerts
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled
                title="Manual alert creation is planned for v1.1"
                className="bg-surface-subtle text-fg-muted border border-surface-border text-control-sm font-medium px-3.5 py-2 rounded-control cursor-not-allowed select-none"
              >
                + Create Alert
              </button>
              <Badge tone="warning">Planned for v1.1</Badge>
            </div>
          </div>
        }
      />

      {viewMode === 'entities' ? (
        <EntityRiskQueue />
      ) : (
        <AlertsTable
          alerts={alerts}
          total={total}
          facets={facets}
          filters={filters}
          isLoading={isLoading}
          error={error}
          onFilterChange={handleFilterChange}
        />
      )}
    </div>
  );
}

// ─── Legacy alert-centric grid (extracted for the view-mode toggle) ──────────

function AlertsTable({
  alerts,
  total,
  facets,
  filters,
  isLoading,
  error,
  onFilterChange,
}: {
  alerts: Alert[];
  total: number;
  facets?: AlertFacets;
  filters: AlertFilters;
  isLoading: boolean;
  error: unknown;
  onFilterChange: (f: AlertFilters) => void;
}) {
  // v1.5 W6 — Selection lives at the AlertsTable level (not AlertsView)
  // because the rail is only rendered inside the "alerts" view mode.
  // Switching to the entities tab unmounts this state cleanly, which is
  // what we want — the rail is alert-scoped, not entity-scoped.
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  // Depth 9.3 — bulk selection, separate from the rail's single selection.
  // A Set rather than an array so toggling is O(1) and the "select all on
  // this page" header checkbox does not have to scan.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const { mutate } = useSWRConfig();

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Stats strip (full width, 1px divider KPI strip) */}
      <div role="group" aria-label="Alert counts">
        <KpiStrip
          cols={4}
          items={[
            { label: 'Total', value: total, tone: 'default' },
            {
              label: 'Critical',
              value: facets ? (facets.bySeverity.critical ?? 0) : '—',
              tone: 'bad',
            },
            {
              label: 'High',
              value: facets ? (facets.bySeverity.high ?? 0) : '—',
              tone: 'warn',
            },
            {
              label: 'Unresolved',
              value: facets ? facets.unresolved : '—',
              tone: 'purple',
            },
          ]}
        />
      </div>

      {/*
        WS-F3 — saved views. The bar reads/writes filters straight through
        ``onFilterChange`` so we don't need a parallel state path. We reset
        ``page`` to 1 when applying a preset because saved pagination would
        be confusing — analysts expect to start from the top.
      */}
      <SavedViewsBar<AlertFilters>
        viewType="alerts"
        filters={filters}
        onApply={(applied) =>
          onFilterChange({
            ...applied,
            page: 1,
            pageSize: filters.pageSize ?? 25,
          })
        }
      />

      <FiltersBar filters={filters} onChange={onFilterChange} total={total} />

      <BulkTriageBar
        selectedIds={[...checkedIds]}
        onClearSelection={() => setCheckedIds(new Set())}
        // Revalidate rather than patching rows locally: the server decided
        // what changed and an optimistic update would show a state it may
        // not have written.
        onApplied={() => void mutate((key) => Array.isArray(key) && key[0] === 'alerts')}
      />

      {/*
        v1.5 W6 — two-pane layout. On wide screens the queue takes the left
        seven cols and the Investigation Rail takes the right five; on narrow
        screens they stack so the rail sits beneath the queue rather than
        squeezing the columns into illegibility. The rail is `sticky` so it
        stays in view while the analyst scrolls the queue.
      */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 space-y-4">
          <AlertsTableGrid
            alerts={alerts}
            isLoading={isLoading}
            error={error}
            filters={filters}
            selectedAlertId={selectedAlertId}
            onSelect={setSelectedAlertId}
            onFilterChange={onFilterChange}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSetChecked={setCheckedIds}
          />
          <AlertsPagination
            alerts={alerts}
            total={total}
            filters={filters}
            onFilterChange={onFilterChange}
          />
        </div>
        <div className="xl:col-span-5">
          <div className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-7rem)] xl:overflow-hidden xl:flex xl:flex-col">
            <InvestigationRail
              alertId={selectedAlertId}
              onClose={() => setSelectedAlertId(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Queue grid (split out from AlertsTable so the two-pane shell stays lean) ─

function AlertsTableGrid({
  alerts,
  isLoading,
  error,
  filters,
  selectedAlertId,
  onSelect,
  onFilterChange,
  checkedIds,
  onToggleChecked,
  onSetChecked,
}: {
  alerts: Alert[];
  isLoading: boolean;
  error: unknown;
  filters: AlertFilters;
  selectedAlertId: string | null;
  onSelect: (id: string) => void;
  onFilterChange: (f: AlertFilters) => void;
  checkedIds: Set<string>;
  onToggleChecked: (id: string) => void;
  onSetChecked: (next: Set<string>) => void;
}) {
  const { t } = useLocale();
  const pageIds = alerts.map((a) => a.id);
  const allOnPageChecked = pageIds.length > 0 && pageIds.every((id) => checkedIds.has(id));

  return (
    <div className="bg-surface-card border border-surface-border rounded-container overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-surface-border bg-surface-elevated">
        <input
          type="checkbox"
          aria-label="Select all alerts on this page"
          checked={allOnPageChecked}
          disabled={pageIds.length === 0}
          onChange={(e) => {
            const next = new Set(checkedIds);
            if (e.target.checked) pageIds.forEach((id) => next.add(id));
            else pageIds.forEach((id) => next.delete(id));
            onSetChecked(next);
          }}
          className="accent-accent"
        />
        <span className="text-eyebrow font-bold uppercase tracking-wider text-fg-muted flex-1">ALERT</span>
        <span className="text-eyebrow font-bold uppercase tracking-wider text-fg-muted w-20">{t('alerts.severity')}</span>
        <span className="text-eyebrow font-bold uppercase tracking-wider text-fg-muted w-24">{t('alerts.status')}</span>
        <span className="text-eyebrow font-bold uppercase tracking-wider text-fg-muted w-24 text-end">TIME</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-pill animate-spin" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorState
            title={t('alerts.loadFailed')}
            description={t('alerts.loadFailedHint')}
            error={error}
          />
        </div>
      ) : alerts.length === 0 ? (
        <div className="p-4">
          {filters.severity || filters.status ? (
            <EmptyState
              icon={EmptyStateIcons.search}
              title="No alerts match these filters"
              description="Try clearing the severity or status filter to widen the search."
              action={
                <button
                  onClick={() => onFilterChange({ page: 1, pageSize: filters.pageSize ?? 25 })}
                  className="text-control-sm font-medium px-3 py-1.5 rounded-control border border-surface-border bg-surface-card text-accent hover:bg-surface-hover transition-colors"
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={EmptyStateIcons.alert}
              title={t('alerts.empty')}
              description={t('alerts.emptyHint')}
            />
          )}
        </div>
      ) : (
        <div>
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              selected={selectedAlertId === alert.id}
              onSelect={onSelect}
              checked={checkedIds.has(alert.id)}
              onToggleChecked={onToggleChecked}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertsPagination({
  alerts,
  total,
  filters,
  onFilterChange,
}: {
  alerts: Alert[];
  total: number;
  filters: AlertFilters;
  onFilterChange: (f: AlertFilters) => void;
}) {
  const { t } = useLocale();
  // One key for the plural and one for the singular, chosen here. The
  // catalogue is a lookup, not an ICU plural engine — two keys covers the
  // two forms English and Arabic both need for this sentence, and a
  // language with more of them is the point at which a plural library
  // earns its place rather than a reason to add one now.
  const count = total === 1 ? t('alerts.countOne') : t('alerts.count', { count: total });
  return (
    <div className="flex items-center justify-between text-xs text-gray-500">
      <span>Showing {alerts.length} of {count}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onFilterChange({ ...filters, page: Math.max(1, (filters.page || 1) - 1) })}
          disabled={(filters.page || 1) <= 1}
          className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="px-2">Page {filters.page || 1}</span>
        <button
          onClick={() => onFilterChange({ ...filters, page: (filters.page || 1) + 1 })}
          disabled={alerts.length < (filters.pageSize || 25)}
          className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
