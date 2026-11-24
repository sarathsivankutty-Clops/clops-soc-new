'use client';

/**
 * PipelineHealth
 * ==============
 * Five-stage pipeline health card (ingest → normalize → fuse → correlate → alert).
 * Each stage shows a status pill, backlog with a share bar, p95 latency, and an
 * error rate. Layout follows the reference SOC console's pipeline rail, now one
 * card with five divided cells rather than five separate tiles.
 *
 * Data source: `GET /api/v1/health/pipeline` ({@link metricsApi.getPipelineHealth}).
 * Polls every 30 s; ignores SWR retries (the endpoint never throws under nominal
 * conditions — failures are reported in the row).
 *
 * Author: Beenu Arora <beenu@cyble.com>
 */

import useSWR from 'swr';
import { clsx } from 'clsx';
import { StatusPill, type StatusKind } from '@/components/ui/StatusPill';
import {
  metricsApi,
  type PipelineHealth as PipelineHealthData,
  type PipelineStage,
} from '@/lib/api';

type Status = PipelineStage['status'];

const STAGE_LABELS: Record<PipelineStage['stage'], string> = {
  ingest: 'Ingest',
  normalize: 'Normalize',
  fuse: 'Fuse',
  correlate: 'Correlate',
  alert: 'Alert',
};

const STAGE_DESCRIPTIONS: Record<PipelineStage['stage'], string> = {
  ingest: 'Connector → raw events',
  normalize: 'OCSF mapping',
  fuse: 'Alert fusion',
  correlate: 'Cross-source correlation',
  alert: 'Final alert emission',
};

const STAGE_ORDER: PipelineStage['stage'][] = [
  'ingest',
  'normalize',
  'fuse',
  'correlate',
  'alert',
];

interface StatusMeta {
  pill: StatusKind;
  label: string;
  text: string;
  dot: string;
  bar: string;
}

/**
 * Status vocabulary, in semantic tokens.
 *
 * The previous implementation used raw `green-500` / `amber-500` / `red-500` /
 * `gray-600` classes, which do not follow the light theme. The pill labels say
 * what the colour means so the card is readable without relying on it.
 */
const STATUS_META: Record<Status, StatusMeta> = {
  green: {
    pill: 'completed',
    label: 'Healthy',
    text: 'text-tone-success',
    dot: 'bg-dot-success',
    bar: 'bg-dot-success',
  },
  yellow: {
    pill: 'pending',
    label: 'Backlog',
    text: 'text-tone-warning',
    dot: 'bg-dot-warning',
    bar: 'bg-dot-warning',
  },
  red: {
    pill: 'failed',
    label: 'Error',
    text: 'text-tone-danger',
    dot: 'bg-dot-danger',
    bar: 'bg-dot-danger',
  },
  unknown: {
    pill: 'unknown',
    label: 'Unknown',
    text: 'text-fg-muted',
    dot: 'bg-dot-neutral',
    bar: 'bg-dot-neutral',
  },
};

/** The pill an uninstrumented cell gets, so absence never reads as zero. */
function NotMeasured() {
  return (
    <span className="text-fg-muted" title="Not instrumented on this stage yet">
      n/a
    </span>
  );
}

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1) return '< 1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`;
  return `${(ms / 60_000).toFixed(1).replace(/\.0$/, '')} m`;
}

function formatBacklog(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

function formatErrorRate(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0) return '—';
  if (ratio === 0) return '0%';
  if (ratio < 0.001) return '< 0.1%';
  return `${(ratio * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** One cell of the five-stage rail. */
function StageCell({
  stage,
  maxBacklog,
}: {
  stage: PipelineStage;
  maxBacklog: number;
}) {
  const meta = STATUS_META[stage.status];
  const unmeasured = new Set(stage.unmeasured ?? []);
  const backlogUnmeasured = unmeasured.has('backlog');
  const share =
    backlogUnmeasured || maxBacklog <= 0
      ? 0
      : Math.max(0, Math.min(100, Math.round((stage.backlog / maxBacklog) * 100)));

  return (
    <div className="min-w-0 bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-control font-semibold text-fg-primary">
          {STAGE_LABELS[stage.stage]}
        </p>
        <StatusPill status={meta.pill} label={meta.label} />
      </div>
      <p
        className="mt-1 truncate text-caption text-fg-muted leading-snug"
        title={STAGE_DESCRIPTIONS[stage.stage]}
      >
        {stage.detail ?? STAGE_DESCRIPTIONS[stage.stage]}
      </p>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="text-fg-muted">Backlog</span>
          <span className="text-right font-mono font-medium tabular-nums text-fg-primary">
            {backlogUnmeasured ? <NotMeasured /> : formatBacklog(stage.backlog)}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-subtle">
          <div
            className={clsx('h-full rounded-pill', meta.bar)}
            style={{ width: `${share}%` }}
          />
        </div>
      </div>

      <dl className="mt-2 space-y-1 text-caption">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">p95</dt>
          <dd className="text-right font-mono font-medium tabular-nums text-fg-primary">
            {unmeasured.has('p95_latency_ms') ? (
              <NotMeasured />
            ) : (
              formatLatency(stage.p95_latency_ms)
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">Errors</dt>
          <dd
            className={clsx(
              'text-right font-mono font-medium tabular-nums',
              unmeasured.has('error_rate') ? 'text-fg-muted' : meta.text,
            )}
          >
            {unmeasured.has('error_rate') ? (
              <NotMeasured />
            ) : (
              formatErrorRate(stage.error_rate)
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LoadingStage({ stage }: { stage: PipelineStage['stage'] }) {
  return (
    <div className="min-w-0 bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-control font-semibold text-fg-primary">
          {STAGE_LABELS[stage]}
        </p>
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-pill bg-surface-hover" />
      </div>
      <p className="mt-1 truncate text-caption text-fg-muted">
        {STAGE_DESCRIPTIONS[stage]}
      </p>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-full animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-hover" />
      </div>
    </div>
  );
}

function MissingStage({
  stage,
  reason,
}: {
  stage: PipelineStage['stage'];
  reason: string;
}) {
  return (
    <div className="min-w-0 bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-control font-semibold text-fg-primary">
          {STAGE_LABELS[stage]}
        </p>
        <StatusPill status="unknown" label="Not reported" />
      </div>
      <p className="mt-1 truncate text-caption text-fg-muted">
        {STAGE_DESCRIPTIONS[stage]}
      </p>
      <p className="mt-3 text-caption text-fg-muted">{reason}</p>
    </div>
  );
}

export function PipelineHealth() {
  const { data, error, isLoading } = useSWR<PipelineHealthData>(
    'pipeline-health',
    () => metricsApi.getPipelineHealth(),
    {
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  // Build a stage→data map and render in canonical order so the UI never
  // re-orders mid-flight even if the API ever changes its ordering.
  const stagesByName: Partial<Record<PipelineStage['stage'], PipelineStage>> = {};
  for (const s of data?.stages ?? []) stagesByName[s.stage] = s;

  const maxBacklog = Math.max(
    1,
    ...(data?.stages ?? [])
      .filter((s) => !(s.unmeasured ?? []).includes('backlog'))
      .map((s) => s.backlog),
  );

  const overall = STATUS_META[data?.overall_status ?? 'unknown'];

  return (
    <div className="overflow-hidden rounded-container border border-surface-border bg-surface-card shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-surface-divider px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-card-title font-semibold text-fg-primary">
            Ingestion &amp; Detection Flow
          </h2>
          <span className="text-caption text-fg-muted">
            Events in to alerts out
          </span>
        </div>
        {error ? (
          <span className="text-caption font-medium text-tone-danger">
            unavailable
          </span>
        ) : data ? (
          <span className="inline-flex items-center gap-1.5 text-caption font-medium text-tone-success">
            <span
              aria-hidden="true"
              className={clsx('h-1.5 w-1.5 rounded-pill', overall.dot)}
            />
            Live
          </span>
        ) : (
          // `Live` was shown whenever `error` was falsy, which includes the
          // whole first-paint window: the header asserted liveness before a
          // single byte had arrived.
          <span className="text-caption text-fg-muted">Loading…</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-px bg-surface-divider sm:grid-cols-2 lg:grid-cols-5">
        {STAGE_ORDER.map((name) => {
          const stage = stagesByName[name];
          if (isLoading) return <LoadingStage key={name} stage={name} />;
          // A stage absent from a *successful* response is not still loading.
          // It used to animate as a skeleton indefinitely, with no error and
          // no timeout, which reads as "nearly there" rather than "missing".
          if (!stage)
            return (
              <MissingStage
                key={name}
                stage={name}
                reason={error ? 'stage unavailable' : 'not reported'}
              />
            );
          return <StageCell key={name} stage={stage} maxBacklog={maxBacklog} />;
        })}
      </div>
    </div>
  );
}

export default PipelineHealth;

/* [HIDDEN-UI UI-OVERHAUL-2 previous five-tile layout kept for restoration.
   It rendered each stage as its own bordered card in
   `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` and styled statuses with raw
   `bg-green-500` / `text-red-400` / `gray-*` classes. The new rail keeps the
   same data contract (backlog, p95, errors, unmeasured, detail) in one card.

function OldStageCard({ stage }: { stage: PipelineStage }) {
  const styles = statusStyles(stage.status);
  const unmeasured = new Set(stage.unmeasured ?? []);
  return (
    <div className="bg-surface-card border border-surface-border rounded-container p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm font-semibold text-fg-primary leading-snug">
          {STAGE_LABELS[stage.stage]}
        </p>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2"
          aria-label={`status ${stage.status}`} />
      </div>
      <p className="text-caption text-fg-muted leading-snug">
        {STAGE_DESCRIPTIONS[stage.stage]}
      </p>
      <dl className="mt-3 space-y-1.5"> ... </dl>
    </div>
  );
}
*/
