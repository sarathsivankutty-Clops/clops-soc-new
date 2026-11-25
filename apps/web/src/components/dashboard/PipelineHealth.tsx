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

/**
 * One stage of the pipeline as a table row: name, status and description on
 * the left (full text, wrapping), the three measurements in fixed columns on
 * the right. The old five-column layout gave each stage about 110px inside a
 * half-width card, which truncated the stage name to 11px.
 */
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] items-start gap-x-3';

function StageRow({ stage }: { stage: PipelineStage }) {
  const meta = STATUS_META[stage.status];
  const unmeasured = new Set(stage.unmeasured ?? []);
  const cell = 'text-right font-mono text-caption font-medium tabular-nums text-fg-primary';

  return (
    <div className={clsx(ROW_GRID, 'bg-surface-card px-5 py-3')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-control font-semibold text-fg-primary">{STAGE_LABELS[stage.stage]}</p>
          <StatusPill status={meta.pill} label={meta.label} />
        </div>
        <p className="mt-0.5 text-caption text-fg-muted leading-snug">
          {stage.detail ?? STAGE_DESCRIPTIONS[stage.stage]}
        </p>
      </div>
      <span className={cell}>
        {unmeasured.has('backlog') ? <NotMeasured /> : formatBacklog(stage.backlog)}
      </span>
      <span className={cell}>
        {unmeasured.has('p95_latency_ms') ? <NotMeasured /> : formatLatency(stage.p95_latency_ms)}
      </span>
      <span className={clsx(cell, !unmeasured.has('error_rate') && meta.text)}>
        {unmeasured.has('error_rate') ? <NotMeasured /> : formatErrorRate(stage.error_rate)}
      </span>
    </div>
  );
}

/** Five-column rail cell: the Overview layout. SOC Operations passes variant="table" and gets StageRow. */
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
      {/* [HIDDEN-UI OVERVIEW-G1 stage description line ({stage.detail ?? STAGE_DESCRIPTIONS[stage.stage]}) removed from the rail: backlog and errors only] */}

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
        {/* [HIDDEN-UI OVERVIEW-G1 p95 row (formatLatency(stage.p95_latency_ms)) removed from the rail; the Operations table keeps it] */}
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

export function PipelineHealth({ variant = 'rail' }: { variant?: 'rail' | 'table' } = {}) {
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
  const table = variant === 'table';

  const overall = STATUS_META[data?.overall_status ?? 'unknown'];

  return (
    <div className="overflow-hidden rounded-container border border-surface-border bg-surface-card shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-surface-divider px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-card-title font-semibold text-fg-primary">
            Ingestion &amp; Detection Flow
          </h2>
          {/* [HIDDEN-UI OVERVIEW-G1 "Events in to alerts out" subtitle dropped from the Overview rail] */}
          {table && (
            <span className="text-caption text-fg-muted">
              Events in to alerts out
            </span>
          )}
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

      {table && (
        <div className={clsx(ROW_GRID, 'border-b border-surface-divider px-5 py-2 text-caption text-fg-muted')}>
          <span>Stage</span>
          <span className="text-right">Backlog</span>
          <span className="text-right">p95</span>
          <span className="text-right">Errors</span>
        </div>
      )}
      <div
        className={clsx(
          'grid grid-cols-1 gap-px bg-surface-divider',
          !table && 'sm:grid-cols-2 lg:grid-cols-5',
        )}
      >
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
          return table ? (
            <StageRow key={name} stage={stage} />
          ) : (
            <StageCell key={name} stage={stage} maxBacklog={maxBacklog} />
          );
        })}
      </div>
    </div>
  );
}

export default PipelineHealth;

// [HIDDEN-UI UI-OVERHAUL-2 previous five-tile layout kept for restoration, verbatim from 02aaa9f7a.
// Each stage was its own bordered card in `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`. The new rail keeps
// the same data contract (backlog, p95, errors, unmeasured, detail) in one card.
// function StageCard({ stage }: { stage: PipelineStage }) {
//   const styles = statusStyles(stage.status);
//   const unmeasured = new Set(stage.unmeasured ?? []);
//   return (
//     /* [HIDDEN-UI DASH-1 use semantic surface tokens, wrap stage text, and add gap-2 between dt/dd] */
//     <div className="bg-surface-card border border-surface-border rounded-container p-4 min-w-0">
//       <div className="flex items-center justify-between gap-2 mb-1">
//         <p className="text-sm font-semibold text-fg-primary leading-snug">
//           {STAGE_LABELS[stage.stage]}
//         </p>
//         <span
//           className={clsx('h-2.5 w-2.5 shrink-0 rounded-full ring-2', styles.dot, styles.ring)}
//           aria-label={`status ${stage.status}`}
//         />
//       </div>
//       <p className="text-caption text-fg-muted leading-snug">
//         {STAGE_DESCRIPTIONS[stage.stage]}
//       </p>
//
//       <dl className="mt-3 space-y-1.5">
//         <div className="flex items-baseline justify-between gap-2 text-xs">
//           <dt className="text-fg-muted shrink-0">Backlog</dt>
//           <dd className="font-medium text-fg-primary tabular-nums text-right">
//             {unmeasured.has('backlog') ? <NotMeasured /> : formatBacklog(stage.backlog)}
//           </dd>
//         </div>
//         <div className="flex items-baseline justify-between gap-2 text-xs">
//           <dt className="text-fg-muted shrink-0">p95</dt>
//           <dd className="font-medium text-fg-primary tabular-nums text-right">
//             {unmeasured.has('p95_latency_ms') ? <NotMeasured /> : formatLatency(stage.p95_latency_ms)}
//           </dd>
//         </div>
//         <div className="flex items-baseline justify-between gap-2 text-xs">
//           <dt className="text-fg-muted shrink-0">Errors</dt>
//           <dd className={clsx('font-medium tabular-nums text-right', unmeasured.has('error_rate') ? 'text-fg-muted' : styles.text)}>
//             {unmeasured.has('error_rate') ? <NotMeasured /> : formatErrorRate(stage.error_rate)}
//           </dd>
//         </div>
//       </dl>
//
//       {/* What the stage did observe, when the observation is not a backlog.
//           `correlate` reported its single-event alert count as a backlog and
//           the strip rendered "Backlog 7" on an empty queue. */}
//       {stage.detail && (
//         <p className="mt-2 text-caption text-fg-muted leading-snug">{stage.detail}</p>
//       )}
//     </div>
//   );
// }
//
// function LoadingStage({ stage }: { stage: PipelineStage['stage'] }) {
//   return (
//     <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 min-w-0">
//       <div className="flex items-center justify-between mb-1">
//         <p className="text-sm font-semibold text-gray-100 truncate">
//           {STAGE_LABELS[stage]}
//         </p>
//         <span className="h-2.5 w-2.5 rounded-full bg-gray-700 animate-pulse" />
//       </div>
//       <p className="text-[11px] text-gray-500 truncate">
//         {STAGE_DESCRIPTIONS[stage]}
//       </p>
//       <div className="mt-3 space-y-2">
//         <div className="h-3 w-full rounded bg-gray-800/60 animate-pulse" />
//         <div className="h-3 w-full rounded bg-gray-800/60 animate-pulse" />
//         <div className="h-3 w-2/3 rounded bg-gray-800/60 animate-pulse" />
//       </div>
//     </div>
//   );
// }
