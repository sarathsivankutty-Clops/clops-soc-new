'use client';

/**
 * Investigation Queue workbench (PR-5 / v1.5 §W7).
 *
 * Answers the analyst's one true question — "what should I work on next?" —
 * with a ranked, server-prioritised feed of alerts split across three buckets:
 *
 *   ┌───────────┬──────────────────────────────────────────────────────────┐
 *   │   Mine    │  Alerts already assigned to the current responder.       │
 *   │ Unassigned│  Up-for-grabs alerts the responder can claim atomically. │
 *   │    All    │  Mine first, then unassigned, ordered by SLA + severity. │
 *   └───────────┴──────────────────────────────────────────────────────────┘
 *
 * The page polls the backend every 15 seconds, but per-row SLA countdowns tick
 * down once per second on the client to avoid a stale-looking workbench.
 * Countdowns are anchored to the server's `generated_at` timestamp so the
 * clock the analyst sees matches the clock the SLA rules ran against.
 *
 * Actions are deliberately single-click — Claim, Release, Snooze, Open — so an
 * SOC can move through the queue without diving into modals. Backend ownership
 * semantics are atomic (single-writer 409 on simultaneous claims), so the UI
 * surfaces conflicts via toast instead of optimistic-lock surprises.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import {
  queueApi,
  authApi,
  type AlertSeverity,
  type QueueItem,
  type QueueOwner,
  type QueuePeriod,
  type QueueResponse,
} from '@/lib/api';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHead } from '@/components/ui/PageHead';
import { Skeleton } from '@/components/ui/Skeleton';

// ─── Config ───────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { label: string; dot: string; text: string; bg: string }
> = {
  /* [HIDDEN-UI THEME-4 kept all 5 severity tiers distinct with dot + soft tint, no border] */
  critical: { label: 'CRIT', dot: 'bg-severity-dot-critical', text: 'text-severity-ink-critical', bg: 'bg-severity-bg-critical' },
  high: { label: 'HIGH', dot: 'bg-severity-dot-high', text: 'text-severity-ink-high', bg: 'bg-severity-bg-high' },
  medium: { label: 'MED', dot: 'bg-severity-dot-medium', text: 'text-severity-ink-medium', bg: 'bg-severity-bg-medium' },
  low: { label: 'LOW', dot: 'bg-severity-dot-low', text: 'text-severity-ink-low', bg: 'bg-severity-bg-low' },
  info: { label: 'INFO', dot: 'bg-severity-dot-info', text: 'text-severity-ink-info', bg: 'bg-severity-bg-info' },
};

const RISK_CONFIG = {
  high: { dot: 'bg-dot-danger', text: 'text-tone-danger' },
  medium: { dot: 'bg-dot-warning', text: 'text-tone-warning' },
  low: { dot: 'bg-dot-info', text: 'text-accent' },
} as const;

const OWNER_OPTIONS: { value: QueueOwner; label: string }[] = [
  { value: 'me', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'all', label: 'All' },
];

const PERIOD_OPTIONS: { value: QueuePeriod; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

// Snooze presets cover the realistic "I'll get back to this" windows an analyst
// uses during triage. Longer windows (days/weeks) should go through a proper
// suppression rule, not a single-alert snooze.
const SNOOZE_PRESETS: { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '4h', minutes: 240 },
  { label: '24h', minutes: 1440 },
];

const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Re-render every second so per-row SLA countdowns stay accurate without
 * round-tripping to the server on every tick.
 *
 * The hook returns a numeric "tick" so callers can use it as a dependency, but
 * most callers only need the side-effect of forcing a re-render.
 */
function useSecondTick(enabled: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return tick;
}

/**
 * Render a remaining-seconds value as a compact "1h 12m" or "23m 04s" string.
 * Negative values mean "breached" and are formatted as "-1h 12m".
 */
function formatRemaining(seconds: number): string {
  const negative = seconds < 0;
  const abs = Math.abs(Math.round(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const sign = negative ? '-' : '';
  if (h > 0) return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${sign}${m}m ${String(s).padStart(2, '0')}s`;
  return `${sign}${s}s`;
}

/**
 * Compute remaining-seconds against the server's authoritative clock so the
 * countdown the analyst sees matches the deadline the SLA engine enforces.
 *
 * The math: `generated_at` is the server's wall-clock at the moment the queue
 * response was assembled. The client treats that moment as "T=0 for this
 * payload" and ticks down based on real elapsed time since then. This nudges
 * out client/server clock skew bigger than the page refresh interval.
 */
function computeRemainingSeconds(item: QueueItem, generatedAt: string): number {
  const generatedMs = new Date(generatedAt).getTime();
  const elapsedSec = (Date.now() - generatedMs) / 1000;
  return item.sla_remaining_seconds - elapsedSec;
}

/**
 * Map a remaining-seconds value to a colour state used by the SLA pill.
 *
 * The 10-minute amber threshold matches the operations spec — anything inside
 * the last 10 minutes of an SLA is "act now" territory, regardless of severity.
 */
function slaState(remainingSec: number): 'ok' | 'warn' | 'breached' {
  if (remainingSec < 0) return 'breached';
  if (remainingSec < 600) return 'warn';
  return 'ok';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-caption font-mono font-medium px-2.5 py-0.5 rounded-pill whitespace-nowrap', cfg.text, cfg.bg)}>
      <span aria-hidden="true" className={clsx('w-1.5 h-1.5 rounded-pill', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function OwnerToggle({
  value,
  counts,
  onChange,
}: {
  value: QueueOwner;
  counts: QueueResponse['counts'] | null;
  onChange: (next: QueueOwner) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Queue owner filter"
      className="inline-flex items-center bg-surface-card border border-surface-border rounded-control p-1 gap-0.5"
    >
      {OWNER_OPTIONS.map((opt) => {
        const active = value === opt.value;
        const count =
          counts == null
            ? null
            : opt.value === 'me'
              ? counts.mine
              : opt.value === 'unassigned'
                ? counts.unassigned
                : counts.all;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'text-control-sm font-medium px-3 py-1 rounded-control transition-colors flex items-center gap-1.5',
              active ? 'bg-surface-subtle text-fg-primary font-semibold' : 'text-fg-muted hover:text-fg-primary',
            )}
          >
            {opt.label}
            {count != null && (
              <span
                aria-live="polite"
                className={clsx(
                  'text-eyebrow font-mono px-1.5 py-px rounded-pill',
                  active ? 'bg-surface-card text-accent' : 'bg-surface-elevated text-fg-muted',
                )}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PeriodFilter({
  value,
  onChange,
}: {
  value: QueuePeriod;
  onChange: (next: QueuePeriod) => void;
}) {
  return (
    <div className="inline-flex items-center bg-surface-card border border-surface-border rounded-control p-1 gap-0.5">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={clsx(
            'text-control-sm font-medium px-2.5 py-1 rounded-control transition-colors',
            value === opt.value
              ? 'bg-surface-subtle text-fg-primary font-semibold'
              : 'text-fg-muted hover:text-fg-primary',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SlaCountdown({
  item,
  generatedAt,
}: {
  item: QueueItem;
  generatedAt: string;
}) {
  const remaining = computeRemainingSeconds(item, generatedAt);
  const state = slaState(remaining);
  const cls =
    state === 'breached'
      ? 'text-tone-danger bg-pill-danger-bg'
      : state === 'warn'
        ? 'text-tone-warning bg-pill-warning-bg'
        : 'text-tone-success bg-pill-success-bg';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 text-caption font-mono px-2.5 py-0.5 rounded-pill whitespace-nowrap',
        cls,
      )}
      title={`SLA due ${new Date(item.sla_due_at).toLocaleString()}`}
      aria-live="off"
    >
      {state === 'breached' && (
        <span className="w-1.5 h-1.5 rounded-pill bg-dot-danger animate-pulse" aria-hidden />
      )}
      SLA {formatRemaining(remaining)}
    </span>
  );
}

function SuggestedActionBadge({ item }: { item: QueueItem }) {
  if (!item.suggested_action) return null;
  const cfg = RISK_CONFIG[item.suggested_action.risk];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-eyebrow text-fg-muted bg-pill-neutral-bg px-2 py-0.5 rounded-pill"
      title={`Suggested next action (risk: ${item.suggested_action.risk})`}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-pill', cfg.dot)} aria-hidden />
      <span className="truncate max-w-56">→ {item.suggested_action.action}</span>
    </span>
  );
}

function BucketBadge({ bucket }: { bucket: 'mine' | 'unassigned' }) {
  if (bucket === 'mine') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption font-medium text-accent bg-pill-info-bg px-2.5 py-0.5 rounded-pill">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-pill bg-dot-info" />
        Mine
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-medium text-fg-muted bg-pill-neutral-bg px-2.5 py-0.5 rounded-pill">
      Unassigned
    </span>
  );
}

function QueueRowActions({
  item,
  isMine,
  busyAction,
  onClaim,
  onRelease,
  onSnooze,
}: {
  item: QueueItem;
  isMine: boolean;
  busyAction: 'claim' | 'release' | 'snooze' | null;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
  onSnooze: (id: string, minutes: number) => void;
}) {
  // <details>-based dropdown gives us zero-dep, keyboard-accessible disclosure
  // without pulling a popover library. Clicking outside closes via the native
  // toggle; we additionally close after picking a duration.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const closeSnoozeMenu = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };

  const claimable = !isMine && !item.assigned_to_id;
  const releasable = isMine;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {claimable && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClaim(item.id);
          }}
          disabled={busyAction === 'claim'}
          className="text-caption font-semibold px-2.5 py-1 rounded-control border border-accent/30 bg-pill-info-bg text-accent hover:bg-nav-active-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busyAction === 'claim' ? 'Claiming…' : 'Claim'}
        </button>
      )}

      {releasable && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRelease(item.id);
          }}
          disabled={busyAction === 'release'}
          className="text-caption font-medium px-2.5 py-1 rounded-control border border-surface-border bg-surface-card text-fg-secondary hover:bg-surface-hover hover:text-fg-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busyAction === 'release' ? 'Releasing…' : 'Release'}
        </button>
      )}

      <details ref={detailsRef} className="relative">
        <summary
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="list-none cursor-pointer text-caption font-medium px-2.5 py-1 rounded-control border border-surface-border bg-surface-card text-fg-secondary hover:bg-surface-hover hover:text-fg-primary transition-colors select-none"
          aria-label="Snooze options"
        >
          {busyAction === 'snooze' ? 'Snoozing…' : 'Snooze'}
        </summary>
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 flex flex-col bg-surface-card border border-surface-border-strong rounded-control shadow-overlay p-1 min-w-32"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <span className="text-eyebrow uppercase tracking-wider text-fg-muted px-2 py-1">
            Snooze for
          </span>
          {SNOOZE_PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              role="menuitem"
              onClick={() => {
                onSnooze(item.id, preset.minutes);
                closeSnoozeMenu();
              }}
              className="text-left text-control-sm px-2 py-1 rounded-control text-fg-secondary hover:bg-surface-hover hover:text-fg-primary transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

interface QueueRowProps {
  item: QueueItem;
  generatedAt: string;
  isMine: boolean;
  busyAction: 'claim' | 'release' | 'snooze' | null;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
  onSnooze: (id: string, minutes: number) => void;
}

function QueueRow({ item, generatedAt, isMine, busyAction, onClaim, onRelease, onSnooze }: QueueRowProps) {
  const remaining = computeRemainingSeconds(item, generatedAt);
  const breached = remaining < 0;

  return (
    <Link
      href={`/alerts/${item.id}`}
      className={clsx(
        'group flex items-start gap-3 px-4 py-3.5 transition-colors',
        breached
          ? 'bg-pill-danger-bg hover:bg-surface-hover border-l-2 border-l-dot-danger'
          : 'hover:bg-surface-elevated',
      )}
      aria-label={`Investigate ${item.title}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={item.severity} />
          <BucketBadge bucket={item.bucket} />
          <SlaCountdown item={item} generatedAt={generatedAt} />
          {item.case_id && (
            <span
              className="text-eyebrow text-tone-purple bg-pill-purple-bg px-2 py-0.5 rounded-pill"
              title="Already linked to a case"
            >
              In case
            </span>
          )}
        </div>

        <p className="text-body font-medium text-fg-primary mt-1.5 truncate">
          {item.title}
        </p>

        <div className="flex items-center gap-2 mt-1 text-caption text-fg-muted flex-wrap">
          {item.asset && (
            <span className="font-mono text-fg-secondary" title={item.asset.kind}>
              {item.asset.label ?? item.asset.value}
            </span>
          )}
          {item.connector_type && (
            <>
              <span className="text-fg-subtle">·</span>
              <span>{item.connector_type}</span>
            </>
          )}
          {item.category && (
            <>
              <span className="text-fg-subtle">·</span>
              <span>{item.category}</span>
            </>
          )}
          <span className="text-fg-subtle">·</span>
          <span>{formatRemaining(item.age_seconds)} old</span>
          {item.suggested_action && (
            <>
              <span className="text-fg-subtle">·</span>
              <SuggestedActionBadge item={item} />
            </>
          )}
        </div>
      </div>

      <QueueRowActions
        item={item}
        isMine={isMine}
        busyAction={busyAction}
        onClaim={onClaim}
        onRelease={onRelease}
        onSnooze={onSnooze}
      />
    </Link>
  );
}

function QueueSkeleton() {
  return (
    <div className="border border-gray-800/60 rounded-xl divide-y divide-gray-800/40 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="w-12 h-4" />
              <Skeleton className="w-16 h-4" />
              <Skeleton className="w-20 h-4" />
            </div>
            <Skeleton className="w-3/4 h-4" />
            <Skeleton className="w-1/2 h-3" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="w-14 h-7" />
            <Skeleton className="w-16 h-7" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function QueueView() {
  const [owner, setOwner] = useState<QueueOwner>('me');
  const [period, setPeriod] = useState<QueuePeriod>('all');
  const [page, setPage] = useState(1);
  // Map of alert ids to "we have an in-flight mutation against this row" so we
  // can disable per-row buttons without blocking the whole table.
  const [busyMap, setBusyMap] = useState<Record<string, 'claim' | 'release' | 'snooze'>>({});

  // The current user's id powers the "is this row mine?" check and the
  // sidebar's live counts.
  const currentUserId = useMemo(() => authApi.currentUser()?.id ?? null, []);

  const { data, error, isLoading, mutate } = useSWR<QueueResponse>(
    ['queue', owner, period, page],
    () => queueApi.list({ owner, period, page, page_size: PAGE_SIZE }),
    {
      // 15-second polling keeps the queue fresh without hammering the API.
      // Inter-fetch drift is absorbed by the per-row countdown ticker.
      refreshInterval: 15000,
      keepPreviousData: true,
    },
  );

  // Tick once a second so SLA pills decrement live between fetches. We only
  // tick when there are rows on screen — saves a wasted setInterval on empty
  // states and during the initial loading skeleton.
  const items = data?.items ?? [];
  useSecondTick(items.length > 0);

  const setBusy = useCallback((id: string, action: 'claim' | 'release' | 'snooze' | null) => {
    setBusyMap((prev) => {
      const next = { ...prev };
      if (action === null) delete next[id];
      else next[id] = action;
      return next;
    });
  }, []);

  const handleClaim = useCallback(
    async (alertId: string) => {
      setBusy(alertId, 'claim');
      try {
        await queueApi.claim(alertId);
        toast.success('Claimed — this alert is yours');
        await mutate();
      } catch (err) {
        // Backend returns 409 if a teammate beat us to it. We surface that
        // clearly rather than blanket-erroring, because it's the most common
        // failure mode and an analyst needs to know the row is no longer free.
        const message =
          err instanceof Error && err.message.toLowerCase().includes('409')
            ? 'Another responder claimed this alert first'
            : err instanceof Error
              ? err.message
              : 'Failed to claim alert';
        toast.error(message);
        await mutate();
      } finally {
        setBusy(alertId, null);
      }
    },
    [mutate, setBusy],
  );

  const handleRelease = useCallback(
    async (alertId: string) => {
      setBusy(alertId, 'release');
      try {
        await queueApi.assign(alertId, null);
        toast.success('Released back to the unassigned pool');
        await mutate();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to release alert';
        toast.error(message);
      } finally {
        setBusy(alertId, null);
      }
    },
    [mutate, setBusy],
  );

  const handleSnooze = useCallback(
    async (alertId: string, minutes: number) => {
      setBusy(alertId, 'snooze');
      try {
        await queueApi.snooze(alertId, { duration_minutes: minutes });
        toast.success(`Snoozed for ${minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}`);
        await mutate();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to snooze alert';
        toast.error(message);
      } finally {
        setBusy(alertId, null);
      }
    },
    [mutate, setBusy],
  );

  const counts = data?.counts ?? null;
  const generatedAt = data?.generated_at ?? new Date().toISOString();
  const total = data?.total ?? 0;
  const totalPages = data?.pages ?? 1;

  // Loading state — only shows the skeleton on first paint. Subsequent
  // re-fetches keep the previous data on screen (`keepPreviousData`) so the
  // queue doesn't flicker every 15 seconds.
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <Header
          owner={owner}
          period={period}
          counts={null}
          onOwnerChange={setOwner}
          onPeriodChange={setPeriod}
        />
        <QueueSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header
        owner={owner}
        period={period}
        counts={counts}
        onOwnerChange={(next) => {
          setOwner(next);
          setPage(1);
        }}
        onPeriodChange={(next) => {
          setPeriod(next);
          setPage(1);
        }}
      />

      {error && (
        <ErrorState
          title="Couldn't load the queue"
          description="The backend didn't return queue data. Try again, or check the API logs if this keeps happening."
          error={error}
          onRetry={() => mutate()}
        />
      )}

      {!error && items.length === 0 && (
        <EmptyState
          icon={EmptyStateIcons.alert}
          title={
            owner === 'me'
              ? 'Nothing in your queue'
              : owner === 'unassigned'
                ? 'Nothing waiting to be claimed'
                : 'Queue is clear'
          }
          description={
            owner === 'me'
              ? "Your team is on top of it. Switch to Unassigned to pick something up, or All to see the broader queue."
              : owner === 'unassigned'
                ? 'Every alert is assigned. Switch to Mine to keep working through your queue.'
                : 'No alerts inside the current period. Widen the period filter to see older work.'
          }
        />
      )}

      {!error && items.length > 0 && (
        <div className="border border-surface-border rounded-container divide-y divide-surface-divider overflow-hidden bg-surface-card">
          {items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              generatedAt={generatedAt}
              isMine={Boolean(currentUserId) && item.assigned_to_id === currentUserId}
              busyAction={busyMap[item.id] ?? null}
              onClaim={handleClaim}
              onRelease={handleRelease}
              onSnooze={handleSnooze}
            />
          ))}
        </div>
      )}

      {!error && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      )}
    </div>
  );
}

// ─── Header + Pagination ──────────────────────────────────────────────────────

function Header({
  owner,
  period,
  counts,
  onOwnerChange,
  onPeriodChange,
}: {
  owner: QueueOwner;
  period: QueuePeriod;
  counts: QueueResponse['counts'] | null;
  onOwnerChange: (next: QueueOwner) => void;
  onPeriodChange: (next: QueuePeriod) => void;
}) {
  return (
    <PageHead
      className="mb-0"
      title="Investigation Queue"
      description="Ranked by SLA pressure and severity — your next move, top of the list."
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <OwnerToggle value={owner} counts={counts} onChange={onOwnerChange} />
          <PeriodFilter value={period} onChange={onPeriodChange} />
        </div>
      }
    />
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between text-caption text-fg-muted px-1">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-control border border-surface-border bg-surface-card text-fg-secondary hover:bg-surface-hover hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="px-2 font-mono text-fg-muted">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2.5 py-1 rounded-control border border-surface-border bg-surface-card text-fg-secondary hover:bg-surface-hover hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
