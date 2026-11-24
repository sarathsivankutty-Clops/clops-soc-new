'use client';

/**
 * DashboardView
 * =============
 * Main SOC dashboard with live metrics, charts, and source activity.
 *
 * UI-OVERHAUL-2: the Overview page now follows the reference console layout —
 * a five-tile KPI strip, the Ingestion & Detection Flow card, a two-column
 * alert-volume / connected-sources grid, and a MITRE tactic card. Live feed,
 * the funnel strip, the efficiency report and the SOC performance block are
 * hidden on this surface ([HIDDEN-UI UI-OVERHAUL-2]); their components are
 * still on disk and mounted by their own routes.
 *
 * WS-F3: Drag-and-drop widget reordering. Each major section is a draggable
 * "widget". The user can grab the ⠿ handle and drop it anywhere in the layout.
 * Order persists to localStorage so it survives page refreshes.
 *
 * Author: Beenu <beenu@cyble.com>
 */

import React, { Component, Suspense, type ErrorInfo, type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { metricsApi, type DashboardMetrics } from '@/lib/api';
import { useTimeWindow } from '@/components/layout/TimeWindowProvider';
import { TIME_WINDOW_LONG_LABEL, TIME_WINDOW_SHORT_LABEL } from '@/lib/timeWindow';
import { clsx } from 'clsx';
import Link from 'next/link';
import { DashboardWelcome } from './DashboardWelcome';
// [HIDDEN-UI UI-OVERHAUL-2 the Overview layout is the reference console's
// four sections; these widgets stay on disk for the operations and SOC pages.
// import { LiveFeedPanel } from './LiveFeedPanel';
// import { SOCMetricsDashboard } from './SOCMetricsDashboard';
// import { FunnelKpiBar } from './FunnelKpiBar';
// import { EfficiencyReport } from './EfficiencyReport';
import { PipelineHealth } from './PipelineHealth';
import { demoFallback } from '@/lib/demoFallback';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { Card } from '@/components/ui/Card';
import { StatusPill, type StatusKind } from '@/components/ui/StatusPill';
// [HIDDEN-UI UI-OVERHAUL-2 the reference layout has no in-page page head;
// the top bar already carries the destination title.
// import { PageHead } from '@/components/ui/PageHead';

class DashboardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[DashboardView] render error:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center text-fg-muted">
          <p className="text-control">Dashboard encountered an error. Please refresh.</p>
          <button onClick={() => this.setState({ hasError: false })} className="mt-2 text-caption text-accent underline">
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_METRICS: DashboardMetrics = {
  alerts: {
    total: 1247,
    new: 89,
    critical: 12,
    high: 43,
    medium: 156,
    low: 289,
    resolvedToday: 67,
    // Hours, matching the API field. This read `42`, which looked like a
    // plausible number of minutes next to the tile's old `m` suffix.
    mttr: 4.2,
    mttr_sample_count: 34,
  },
  cases: {
    open: 23,
    inProgress: 15,
    resolvedThisWeek: 34,
  },
  sources: [
    { name: 'CrowdStrike EDR', count: 412, status: 'active' },
    { name: 'Microsoft Sentinel', count: 287, status: 'active' },
    { name: 'AWS CloudTrail', count: 198, status: 'active' },
    { name: 'Okta Identity', count: 163, status: 'active' },
    { name: 'Google Workspace', count: 107, status: 'active' },
    { name: 'GitHub Audit', count: 84, status: 'active' },
  ],
  topMitre: [
    { tactic: 'Execution', count: 89 },
    { tactic: 'Defense Evasion', count: 67 },
    { tactic: 'Command & Control', count: 54 },
    { tactic: 'Credential Access', count: 43 },
    { tactic: 'Lateral Movement', count: 38 },
    { tactic: 'Exfiltration', count: 21 },
  ],
  // Deterministic timestamps — no Date.now()/Math.random() to avoid SSR hydration mismatches.
  alertsTrend: Array.from({ length: 24 }, (_, i) => ({
    timestamp: new Date(new Date('2026-05-06T12:00:00Z').getTime() - (23 - i) * 3600000).toISOString(),
    count: ((i * 37 + 13) % 80) + 20,
    severity: 'all',
  })),
  threatsBySource: [
    { source: 'CrowdStrike EDR', count: 412 },
    { source: 'Microsoft Sentinel', count: 287 },
    { source: 'AWS CloudTrail', count: 198 },
    { source: 'Okta Identity', count: 163 },
    { source: 'Google Workspace', count: 107 },
    { source: 'GitHub Audit', count: 84 },
  ],
};

// ─── Honest data-absent panel ─────────────────────────────────────────────────

/**
 * What a panel shows when it has no numbers to show.
 *
 * Three states, not two. An error branch and an empty branch alone read as
 * complete right up until you notice that the empty branch is also what
 * renders *before* the request lands. On first paint the dashboard asserted
 * "No alerts in the last 24 hours": a measured claim about a window nothing
 * had looked at.
 *
 *   - `error` set   → the request failed. Say so, offer a retry.
 *   - `pending` set → the answer is not in. Never claim a measurement.
 *   - neither       → the request succeeded and the tenant genuinely has no
 *                     data for this panel.
 */
function PanelUnavailable({
  error,
  pending,
  onRetry,
  emptyTitle,
  emptyDescription,
  action,
}: {
  error?: unknown;
  /** The answer is not in. Never claim a measurement. */
  pending?: boolean;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  action?: ReactNode;
}) {
  if (error) {
    return (
      <ErrorState
        title="Could not load this panel"
        description="The metrics API did not respond. Nothing is rendered here rather than a placeholder number."
        error={error}
        onRetry={onRetry}
        className="px-4 py-6"
      />
    );
  }
  if (pending) {
    return (
      <EmptyState
        title="Not loaded yet"
        description="Waiting on the metrics API. This panel will say what it found once it answers."
        className="px-4 py-6"
      />
    );
  }
  return (
    <EmptyState
      title={emptyTitle}
      description={emptyDescription}
      action={action}
      className="px-4 py-6"
    />
  );
}

// ─── Alert volume by severity (24 buckets, div bars) ─────────────────────────
//
// `/metrics/dashboard` returns one `alertsTrend` row per (bucket, severity), so
// a stacked bar is the honest reading of that payload. The previous area chart
// flattened the rows to a single `count` and a separate pie re-used the
// current-state severity totals — two different windows side by side.

type SeverityKey = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_KEYS: readonly SeverityKey[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_BAR: Record<SeverityKey, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
  info: 'bg-severity-info',
};

const SEVERITY_LEGEND: readonly { key: SeverityKey; label: string }[] = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

interface VolumeBucket {
  key: string;
  timestamp: number;
  counts: Record<SeverityKey | 'unspecified', number>;
  total: number;
}

function buildVolumeBuckets(
  trend: DashboardMetrics['alertsTrend'],
): VolumeBucket[] {
  const byTimestamp = new Map<string, VolumeBucket>();
  for (const point of trend) {
    const key = String(point.timestamp);
    const parsed = Date.parse(key);
    const existing = byTimestamp.get(key);
    const bucket: VolumeBucket =
      existing ?? {
        key,
        timestamp: Number.isFinite(parsed) ? parsed : 0,
        counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unspecified: 0 },
        total: 0,
      };
    const severity = (
      SEVERITY_KEYS as readonly string[]
    ).includes(point.severity)
      ? (point.severity as SeverityKey)
      : 'unspecified';
    bucket.counts[severity] += point.count;
    bucket.total += point.count;
    byTimestamp.set(key, bucket);
  }
  return Array.from(byTimestamp.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-24);
}

// ─── Source status vocabulary ────────────────────────────────────────────────

function sourceMeta(status: string): { status: StatusKind; label: string } {
  switch (status) {
    case 'active':
      return { status: 'completed', label: 'Healthy' };
    case 'ingesting':
      return { status: 'running', label: 'Delivering' };
    case 'error':
    case 'failed':
      return { status: 'failed', label: 'Error' };
    case 'stale':
    case 'degraded':
      return { status: 'pending', label: 'Late' };
    default:
      return { status: 'unknown', label: 'Unknown' };
  }
}

// ─── Drag-and-Drop Widget Layout (WS-F3) ──────────────────────────────────────

const WIDGET_ORDER_KEY = 'aisoc:dashboard:widget-order';

type WidgetId =
  | 'welcome'
  | 'overview-kpis'
  | 'pipeline'
  | 'volume-and-sources'
  | 'mitre-posture';

const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  'welcome',
  'overview-kpis',
  'pipeline',
  'volume-and-sources',
  'mitre-posture',
];

function loadWidgetOrder(): WidgetId[] {
  if (typeof window === 'undefined') return DEFAULT_WIDGET_ORDER;
  try {
    const raw = localStorage.getItem(WIDGET_ORDER_KEY);
    if (!raw) return DEFAULT_WIDGET_ORDER;
    const parsed = JSON.parse(raw) as WidgetId[];
    // Guard against stale storage with missing or extra IDs
    if (
      Array.isArray(parsed) &&
      parsed.length === DEFAULT_WIDGET_ORDER.length &&
      DEFAULT_WIDGET_ORDER.every((id) => parsed.includes(id))
    ) {
      return parsed;
    }
  } catch {}
  return DEFAULT_WIDGET_ORDER;
}

/** Drag state kept in a ref so re-renders stay minimal during the drag gesture. */
interface DragState {
  dragId: WidgetId | null;
  overId: WidgetId | null;
}

interface DraggableWidgetProps {
  id: WidgetId;
  dragState: DragState;
  onDragStart: (id: WidgetId) => void;
  onDragOver: (id: WidgetId) => void;
  onDrop: () => void;
  children: ReactNode;
}

/**
 * Thin drag-and-drop shell around each dashboard section.
 * The ⠿ handle (aria-label "Drag to reorder") is the only interactive target;
 * clicking anywhere else in the widget works normally.
 */
function DraggableWidget({ id, dragState, onDragStart, onDragOver, onDrop, children }: DraggableWidgetProps) {
  const isDragging = dragState.dragId === id;
  const isOver = dragState.overId === id && dragState.dragId !== id;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(id); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDrop}
      className={clsx(
        'relative group transition-opacity',
        isDragging && 'opacity-40',
        isOver && 'ring-2 ring-accent/60 ring-offset-2 ring-offset-surface-base rounded-container',
      )}
      aria-label={`Dashboard widget: ${id}`}
    >
      {/* Drag handle — visible on hover */}
      <button
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className={clsx(
          'absolute top-2 right-2 z-10 cursor-grab active:cursor-grabbing',
          'px-1.5 py-0.5 rounded text-fg-subtle hover:text-fg-muted',
          'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
          'select-none text-base leading-none',
        )}
        // Pointer-down on the handle initiates the native drag
        onPointerDown={(e) => {
          // We rely on the parent div's draggable; just prevent focus loss
          e.currentTarget.closest('[draggable]')?.dispatchEvent(
            new DragEvent('dragstart', { bubbles: true })
          );
        }}
        tabIndex={-1}
      >
        ⠿
      </button>
      {children}
    </div>
  );
}

/** Persist + manage the ordered list of widget IDs. */
function useDashboardLayout() {
  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_WIDGET_ORDER);
  const dragState = useRef<DragState>({ dragId: null, overId: null });
  // Trigger a render when drag state changes so highlights update
  const [, forceRender] = useState(0);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => { setOrder(loadWidgetOrder()); }, []);

  const handleDragStart = useCallback((id: WidgetId) => {
    dragState.current = { dragId: id, overId: null };
    forceRender((n) => n + 1);
  }, []);

  const handleDragOver = useCallback((id: WidgetId) => {
    if (dragState.current.overId !== id) {
      dragState.current = { ...dragState.current, overId: id };
      forceRender((n) => n + 1);
    }
  }, []);

  const handleDrop = useCallback(() => {
    const { dragId, overId } = dragState.current;
    dragState.current = { dragId: null, overId: null };
    forceRender((n) => n + 1);

    if (!dragId || !overId || dragId === overId) return;

    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragId);
      const to = next.indexOf(overId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      try { localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { order, dragState: dragState.current, handleDragStart, handleDragOver, handleDrop };
}

/**
 * How many of a tenant's sources are actually connected.
 *
 * This counted `status === 'active'` alone. `active` is a connector *health*
 * value the poller writes, and the two cases it gets wrong both show up as a
 * tile reading 0 above a panel listing real sources: a webhook or batch-ingest
 * source has no poller and so no health, and a connector whose last poll
 * errored can still be receiving events.
 *
 * Delivering counts, healthy counts, and a dead integration that has sent
 * nothing does not — otherwise the tile silently becomes a count of
 * configured integrations, which answers a different question.
 */
export function countConnectedSources(
  sources: DashboardMetrics['sources'],
): number {
  return sources.filter((s) => s.status === 'active' || s.count > 0).length;
}

/**
 * Name the sources the count above counted.
 *
 * `sources` is "what produced alerts in this window", not "what the tenant
 * configured" — a tenant with no connectors at all can still have five, via
 * the ingest webhook. So the caption lists the real names rather than a
 * fixed taxonomy that happened to have five entries too.
 */
export function describeConnectedSources(
  sources: DashboardMetrics['sources'],
): string {
  const named = sources
    .filter((s) => s.status === 'active' || s.count > 0)
    .map((s) => s.name)
    .filter(Boolean);
  if (named.length === 0) return 'no source has produced an alert yet';
  if (named.length <= 3) return named.join(', ');
  return `${named.slice(0, 3).join(', ')} +${named.length - 3} more`;
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function DashboardView() {
  // The global selector in the header. Every fetch below binds to it, so
  // changing the window actually changes what is shown -- it used to drive
  // nothing at all.
  const { window: timeWindow } = useTimeWindow();

  const {
    data: rawMetrics,
    error: metricsError,
    isLoading: metricsLoading,
    mutate: mutateMetrics,
  } = useSWR(
    // The window is part of the key, which is the whole fix: it was the
    // constant string 'dashboard-metrics', so SWR served one cache entry for
    // every window and the selector could not have refetched even if it had
    // asked. A key that does not name its inputs is a cache that cannot
    // distinguish them.
    ['dashboard-metrics', timeWindow],
    () => metricsApi.getDashboard(timeWindow),
    {
      fallbackData: demoFallback(MOCK_METRICS),
      refreshInterval: 60000,
      revalidateOnMount: true,
      revalidateOnFocus: false,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 4000,
    }
  );

  const retryMetrics = useCallback(() => {
    void mutateMetrics();
  }, [mutateMetrics]);

  const metricsErrorMessage =
    metricsError instanceof Error
      ? metricsError.message
      : metricsError
        ? String(metricsError)
        : null;

  // `MOCK_METRICS` reaches this component through exactly one door: the
  // `demoFallback` above, which returns `undefined` outside the hosted demo.
  //
  // It used to reach it through a second door as well — a per-section merge
  // that substituted the mock whenever the API omitted a section, plus a
  // blanket `: MOCK_METRICS` when the call failed. That published a fabricated
  // connector inventory ("CrowdStrike EDR · 412 events"), a fabricated MITRE
  // tactic ranking, and a fabricated 24h volume curve as tenant state on any
  // self-hosted install whose API was reachable but whose lake was empty.
  // Sections the API does not populate now render an honest empty state.
  const apiData = rawMetrics as Partial<DashboardMetrics> | undefined;
  const metrics: DashboardMetrics | null =
    apiData && typeof apiData.alerts?.total === 'number'
      ? {
          alerts: apiData.alerts,
          cases: apiData.cases ?? { open: 0, inProgress: 0, resolvedThisWeek: 0 },
          sources: apiData.sources ?? [],
          topMitre: apiData.topMitre ?? [],
          alertsTrend: apiData.alertsTrend ?? [],
          threatsBySource: apiData.threatsBySource ?? [],
        }
      : null;

  /**
   * Whether these panels have anything measured to report.
   *
   * Both halves matter. `metricsLoading` is the request still being in flight,
   * which is the first-paint case. `!metrics` also covers the request having
   * answered with a payload that carries no alert totals — equally unmeasured,
   * and equally not a zero. A panel reached through either branch must not
   * describe a result.
   */
  const metricsPending = metricsLoading || (!metrics && !metricsError);

  const sources = metrics?.sources ?? [];
  const topMitre = metrics?.topMitre ?? [];
  const activeSourceCount = countConnectedSources(sources);

  const periodLabel = TIME_WINDOW_SHORT_LABEL[timeWindow] ?? '';
  const volumeBuckets = buildVolumeBuckets(metrics?.alertsTrend ?? []);
  const maxVolume = Math.max(1, ...volumeBuckets.map((b) => b.total));
  const maxTactic = Math.max(1, ...topMitre.map((t) => t.count));

  // WS-F3: drag-and-drop widget reordering
  const { order, dragState, handleDragStart, handleDragOver, handleDrop } = useDashboardLayout();

  /** Map each widget ID to its rendered section. */
  const widgetContent: Record<WidgetId, ReactNode> = {
    welcome: <Suspense fallback={null}><DashboardWelcome /></Suspense>,

    // Five-tile strip: open alerts, critical, MTTR, open cases, connected
    // sources. Every figure comes from `metricsApi.getDashboard`; the MTTR
    // tile keeps its "not measured · no cases closed" branch so a tenant that
    // has resolved nothing does not score zero hours.
    'overview-kpis': metrics ? (
      <KpiStrip
        cols={5}
        items={[
          {
            label: 'Open Alerts',
            value: metrics.alerts.active ?? metrics.alerts.total,
            sub: `${metrics.alerts.total} in last ${periodLabel}`,
            tone: 'info',
          },
          {
            label: 'Critical',
            value: metrics.alerts.criticalActive ?? metrics.alerts.critical,
            sub: `${metrics.alerts.resolved ?? 0} resolved`,
            tone: metrics.alerts.criticalActive ? 'bad' : 'default',
          },
          {
            label: 'MTTR',
            value:
              metrics.alerts.mttr_sample_count === 0
                ? '—'
                : `${metrics.alerts.mttr.toFixed(1)}h`,
            sub:
              metrics.alerts.mttr_sample_count === 0
                ? 'not measured · no cases closed'
                : 'Mean time to resolve',
            tone: 'ok',
          },
          {
            label: 'Open Cases',
            value: metrics.cases.open,
            sub: `${metrics.cases.inProgress} in progress · ${metrics.cases.openedThisWeek ?? 0} opened / ${metrics.cases.closedThisWeek ?? 0} closed (7d)`,
            tone: 'warn',
          },
          {
            label: 'Connected Sources',
            value: activeSourceCount,
            sub: describeConnectedSources(sources),
            tone: 'purple',
          },
        ]}
      />
    ) : (
      <PanelUnavailable
        error={metricsError}
        pending={metricsPending}
        onRetry={retryMetrics}
        emptyTitle="No dashboard metrics yet"
        emptyDescription="Connect a data source to start populating alert, case and MTTR counters."
      />
    ),

    pipeline: <PipelineHealth />,

    'volume-and-sources': (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-card-title font-semibold text-fg-primary">
              Alert Volume by Severity
            </h3>
            <span className="text-caption text-fg-muted">Last {periodLabel}</span>
          </div>
          {volumeBuckets.length > 0 ? (
            <>
              <div
                className="flex h-36 items-end gap-1"
                role="img"
                aria-label="Alert volume by severity over the selected window"
              >
                {volumeBuckets.map((bucket) => {
                  const height =
                    bucket.total > 0
                      ? Math.max((bucket.total / maxVolume) * 100, 4)
                      : 0;
                  return (
                    <div
                      key={bucket.key}
                      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded"
                      style={{ height: `${height}%` }}
                    >
                      {SEVERITY_KEYS.map((key) =>
                        bucket.counts[key] > 0 ? (
                          <div
                            key={key}
                            className={clsx('w-full', SEVERITY_BAR[key])}
                            style={{ flex: bucket.counts[key] }}
                          />
                        ) : null,
                      )}
                      {bucket.counts.unspecified > 0 ? (
                        <div
                          className="w-full bg-surface-border-strong"
                          style={{ flex: bucket.counts.unspecified }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {SEVERITY_LEGEND.map((entry) => (
                  <span
                    key={entry.key}
                    className="inline-flex items-center gap-1.5 rounded-pill bg-surface-subtle px-2 py-0.5 text-caption text-fg-secondary"
                  >
                    <span
                      aria-hidden="true"
                      className={clsx('h-1.5 w-1.5 rounded-pill', SEVERITY_BAR[entry.key])}
                    />
                    {entry.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <PanelUnavailable
              error={metricsError}
              pending={metricsPending}
              onRetry={retryMetrics}
              emptyTitle={`No alerts in the last ${TIME_WINDOW_LONG_LABEL[
                timeWindow
              ].replace(/^Last /, '')}`}
              emptyDescription="The volume curve plots alert counts once alerts start arriving."
            />
          )}
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-card-title font-semibold text-fg-primary">
              Connected Sources
            </h3>
            <span className="text-caption text-fg-muted">Events</span>
          </div>
          {sources.length === 0 ? (
            <PanelUnavailable
              error={metricsError}
              pending={metricsPending}
              onRetry={retryMetrics}
              emptyTitle="No sources connected"
              emptyDescription="Connect a data source and its event volume appears here."
              action={
                <Link
                  href="/connectors"
                  className="text-control-sm text-accent underline underline-offset-2 hover:text-accent-hover"
                >
                  Go to connectors
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-surface-divider">
              {sources.map((src) => {
                const meta = sourceMeta(src.status);
                return (
                  <li
                    key={src.name}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'h-1.5 w-1.5 shrink-0 rounded-pill',
                          src.status === 'active'
                            ? 'bg-dot-success'
                            : src.status === 'error'
                              ? 'bg-dot-danger'
                              : 'bg-dot-info',
                        )}
                      />
                      <span className="truncate text-control-sm text-fg-primary">
                        {src.name}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-caption tabular-nums text-fg-muted">
                        {src.count.toLocaleString()}
                      </span>
                      <StatusPill status={meta.status} label={meta.label} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    ),

    // MITRE posture. `topMitre` ranks *tactics* by the alert counts tagged
    // with them; it is not technique coverage (that lives on the coverage
    // surfaces). The card says "alerts" so the two cannot be read as one
    // number — see MitrePanelWording.test.tsx.
    'mitre-posture': (
      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-card-title font-semibold text-fg-primary">
            Top MITRE ATT&CK Tactics
          </h3>
          <span className="text-caption text-fg-muted">Alerts ranked by tactic</span>
        </div>
        {topMitre.length === 0 ? (
          <PanelUnavailable
            error={metricsError}
            pending={metricsPending}
            onRetry={retryMetrics}
            emptyTitle="No tactic coverage yet"
            emptyDescription="Ranks ATT&CK tactics by alert count. Alerts tagged only with technique IDs do not appear here."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {topMitre.map((tactic) => (
              <li key={tactic.tactic} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-control-sm text-fg-primary">
                    {tactic.tactic}
                  </span>
                  <span className="font-mono text-caption tabular-nums text-fg-muted">
                    {tactic.count}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-subtle">
                  <div
                    className="h-full rounded-pill bg-accent"
                    style={{
                      width: `${Math.round((tactic.count / maxTactic) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
  };

  return (
    <DashboardErrorBoundary>
      <div className="space-y-5">
        {metricsErrorMessage && (
          <div className="rounded-container border border-tone-danger/30 bg-pill-danger-bg px-4 py-3 text-body text-tone-danger">
            <p className="font-semibold">Dashboard metrics unavailable</p>
            <p className="mt-1 text-caption text-fg-secondary">
              {metricsErrorMessage}
            </p>
            <p className="mt-1 text-caption text-fg-muted">
              Panels below are blank rather than showing placeholder figures.
              Retrying every 4s.
            </p>
          </div>
        )}
        {order.map((id) => (
          <DraggableWidget
            key={id}
            id={id}
            dragState={dragState}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {widgetContent[id]}
          </DraggableWidget>
        ))}
      </div>
    </DashboardErrorBoundary>
  );
}

// [HIDDEN-UI UI-OVERHAUL-2 previous Overview widgets kept for restoration, verbatim from 02aaa9f7a.
// Retired: recharts area/pie/bar charts, the chart tooltip, and the widgetContent map (funnel KPI strip,
// efficiency report, live feed, SOC performance block). The components themselves are untouched on disk.
// const RechartsArea = dynamic(
//   () => import('recharts').then((m) => {
//     const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = m;
//     function RechartsAreaInner(props: { data: { time: string; count: number }[] }) {
//       return (
//         <ResponsiveContainer width="100%" height={180}>
//           <AreaChart data={props.data}>
//             <defs>
//               <linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1">
//                 <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
//                 <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
//               </linearGradient>
//             </defs>
//             <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
//             <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} interval={3} />
//             <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
//             <Tooltip content={<CustomTooltip />} />
//             <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#alertGrad)" strokeWidth={2} name="Alerts" />
//           </AreaChart>
//         </ResponsiveContainer>
//       );
//     }
//     return RechartsAreaInner;
//   }),
//   { ssr: false, loading: () => <div className="h-[180px] bg-gray-800/30 animate-pulse rounded" /> },
// );
//
// const RechartsPie = dynamic(
//   () => import('recharts').then((m) => {
//     const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = m;
//     function RechartsPieInner(props: { data: { name: string; value: number; color: string }[] }) {
//       return (
//         <ResponsiveContainer width="100%" height={140}>
//           <PieChart>
//             <Pie data={props.data} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" strokeWidth={0}>
//               {props.data.map((entry, i) => (
//                 <Cell key={i} fill={entry.color} />
//               ))}
//             </Pie>
//             <Tooltip formatter={(value, name) => [value, name]} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }} />
//           </PieChart>
//         </ResponsiveContainer>
//       );
//     }
//     return RechartsPieInner;
//   }),
//   { ssr: false, loading: () => <div className="h-[140px] bg-gray-800/30 animate-pulse rounded" /> },
// );
//
// const RechartsBar = dynamic(
//   () => import('recharts').then((m) => {
//     const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = m;
//     function RechartsBarInner(props: { data: { tactic: string; count: number }[] }) {
//       return (
//         <ResponsiveContainer width="100%" height={180}>
//           <BarChart data={props.data} layout="vertical">
//             <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
//             <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
//             <YAxis type="category" dataKey="tactic" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={false} width={100} />
//             <Tooltip content={<CustomTooltip />} />
//             <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Alerts" />
//           </BarChart>
//         </ResponsiveContainer>
//       );
//     }
//     return RechartsBarInner;
//   }),
//   { ssr: false, loading: () => <div className="h-[180px] bg-gray-800/30 animate-pulse rounded" /> },
// );
//
// class DashboardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {

// function CustomTooltip({ active, payload, label }: any) {
//   if (!active || !payload?.length) return null;
//   return (
//     <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs">
//       <p className="text-gray-400 mb-1">{label}</p>
//       {payload.map((p: any, i: number) => (
//         <p key={i} style={{ color: p.color }} className="font-medium">
//           {p.name}: {p.value}
//         </p>
//       ))}
//     </div>
//   );
// }
//

//   const widgetContent: Record<WidgetId, ReactNode> = {
//     welcome: <Suspense fallback={null}><DashboardWelcome /></Suspense>,
//
//     // PR-3 / W1: Six-tile funnel KPI strip (events → correlations → alerts +
//     // signal/noise, MTTD, analyst queue) backed by /api/v1/metrics/funnel.
//     'funnel-kpis': <FunnelKpiBar period={timeWindow} />,
//
//     // PR-3 / W1+W9: Efficiency ratios (correlation efficiency, alert yield,
//     // MITRE coverage) alongside per-stage pipeline health.
//     'efficiency-and-pipeline': (
//       /* [HIDDEN-UI DASH-1 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">] */
//       <div className="grid grid-cols-1 gap-4">
//         <EfficiencyReport period={timeWindow} />
//         <PipelineHealth />
//       </div>
//     ),
//
//     'top-metrics': (
//       <div>
//         <PageHead
//           eyebrow="Overview"
//           title="Security Operations Center"
//           description={`Entity-risk alerting, confidence-scored triage, and ${metrics ? activeSourceCount : '—'} connected sources`}
//           className="mb-4"
//         />
//         {metrics ? (
//           <KpiStrip
//             cols={5}
//             items={[
//               {
//                 label: 'Active Alerts',
//                 value: metrics.alerts.active ?? metrics.alerts.total,
//                 sub: `${metrics.alerts.total} in last ${periodLabel}`,
//                 tone: 'info',
//               },
//               {
//                 label: 'Critical Active',
//                 value: metrics.alerts.criticalActive ?? metrics.alerts.critical,
//                 sub: `${metrics.alerts.resolved ?? 0} resolved`,
//                 tone: metrics.alerts.criticalActive ? 'bad' : 'default',
//               },
//               {
//                 label: 'Open Cases',
//                 value: metrics.cases.open,
//                 sub: `${metrics.cases.inProgress} in progress · ${metrics.cases.openedThisWeek ?? 0} opened / ${metrics.cases.closedThisWeek ?? 0} closed (7d)`,
//                 tone: 'warn',
//               },
//               {
//                 label: 'MTTR',
//                 value:
//                   metrics.alerts.mttr_sample_count === 0
//                     ? '—'
//                     : `${metrics.alerts.mttr.toFixed(1)}h`,
//                 sub:
//                   metrics.alerts.mttr_sample_count === 0
//                     ? 'not measured · no cases closed'
//                     : 'Mean time to resolve',
//                 tone: 'ok',
//               },
//               {
//                 label: 'Connected Sources',
//                 value: activeSourceCount,
//                 sub: describeConnectedSources(sources),
//                 tone: 'purple',
//               },
//             ]}
//           />
//         ) : (
//           <PanelUnavailable
//             error={metricsError}
//             pending={metricsPending}
//             onRetry={retryMetrics}
//             emptyTitle="No dashboard metrics yet"
//             emptyDescription="Connect a data source to start populating alert, case and MTTR counters."
//           />
//         )}
//       </div>
//     ),
//
//     'charts-row': (
//       <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
//         <Card className="lg:col-span-2">
//           <div className="flex items-center justify-between mb-4">
//             <h3 className="text-card-title font-semibold text-fg-primary">Alert Volume ({periodLabel})</h3>
//             <span className="text-caption text-fg-muted">Last {periodLabel}</span>
//           </div>
//           {trendData.length > 0 ? (
//             <RechartsArea data={trendData} />
//           ) : (
//             <PanelUnavailable
//               error={metricsError}
//               pending={metricsPending}
//               onRetry={retryMetrics}
//               emptyTitle={`No alerts in the last ${TIME_WINDOW_LONG_LABEL[
//                 timeWindow
//               ].replace(/^Last /, '')}`}
//               emptyDescription="The volume curve plots alert counts once alerts start arriving."
//             />
//           )}
//         </Card>
//         <Card>
//           <h3 className="text-card-title font-semibold text-fg-primary mb-4">Severity Breakdown</h3>
//           {metrics ? (
//             <>
//               <RechartsPie data={SEVERITY_CHART_DATA} />
//               <div className="space-y-1.5 mt-2">
//                 {SEVERITY_CHART_DATA.map((d) => (
//                   <div key={d.name} className="flex items-center justify-between text-control-sm">
//                     <div className="flex items-center gap-1.5">
//                       <span className="w-2 h-2 rounded-pill" style={{ background: d.color }} />
//                       <span className="text-fg-secondary">{d.name}</span>
//                     </div>
//                     <span className="text-fg-primary font-mono font-semibold">{d.value}</span>
//                   </div>
//                 ))}
//               </div>
//             </>
//           ) : (
//             <PanelUnavailable
//               error={metricsError}
//               pending={metricsPending}
//               onRetry={retryMetrics}
//               emptyTitle="No severity data"
//               emptyDescription="Severity counts appear once the API returns alert metrics."
//             />
//           )}
//         </Card>
//       </div>
//     ),
//
//     'bottom-row': (
//       <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
//         <Card>
//           <h3 className="text-card-title font-semibold text-fg-primary mb-4">Top MITRE ATT&CK Tactics</h3>
//           {topMitre.length > 0 ? (
//             <RechartsBar data={topMitre} />
//           ) : (
//             <PanelUnavailable
//               error={metricsError}
//               pending={metricsPending}
//               onRetry={retryMetrics}
//               emptyTitle="No tactic coverage yet"
//               emptyDescription="Ranks ATT&CK tactics by alert count. Alerts tagged only with technique IDs are counted under MITRE coverage in SOC Performance instead."
//             />
//           )}
//         </Card>
//         <Card>
//           <h3 className="text-card-title font-semibold text-fg-primary mb-4">Connected Sources</h3>
//           {sources.length === 0 ? (
//             <PanelUnavailable
//               error={metricsError}
//               pending={metricsPending}
//               onRetry={retryMetrics}
//               emptyTitle="No sources connected"
//               emptyDescription="Connect a data source and its event volume appears here."
//               action={
//                 <Link
//                   href="/connectors"
//                   className="text-control-sm text-accent underline underline-offset-2 hover:text-accent-hover"
//                 >
//                   Go to connectors
//                 </Link>
//               }
//             />
//           ) : (
//           <div className="space-y-3">
//             {sources.map((src) => {
//               const maxCount = Math.max(...sources.map(s => s.count), 1);
//               const pct = Math.round((src.count / maxCount) * 100);
//               return (
//                 <div key={src.name}>
//                   <div className="flex items-center justify-between mb-1">
//                     <div className="flex items-center gap-2">
//                       <span className={clsx(
//                         'w-1.5 h-1.5 rounded-pill',
//                         src.status === 'active' ? 'bg-dot-success' : 'bg-dot-neutral'
//                       )} />
//                       <span className="text-control-sm text-fg-primary">{src.name}</span>
//                     </div>
//                     <span className="text-caption font-mono text-fg-muted">{src.count}</span>
//                   </div>
//                   <div className="h-1.5 bg-surface-subtle rounded-pill overflow-hidden">
//                     <div className="h-1.5 bg-accent rounded-pill" style={{ width: `${pct}%` }} />
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//           )}
//         </Card>
//         <LiveFeedPanel />
//       </div>
//     ),
//
//     'soc-performance': (
//       <div className="pt-2">
//         <div className="flex items-center justify-between mb-3">
//           <div>
//             <h2 className="text-card-title font-semibold text-fg-primary">SOC Performance</h2>
//             <p className="text-caption text-fg-muted mt-0.5">
//               Outcome metrics, agent calibration, and technique coverage. Auto-computed every 30s.
//             </p>
//           </div>
//         </div>
//         <SOCMetricsDashboard />
//       </div>
//     ),
//   };
