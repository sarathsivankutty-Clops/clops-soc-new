'use client';

import { useCallback, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import useSWR from 'swr';

import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHead } from '@/components/ui/PageHead';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import {
  tuningApi,
  type ApplyTuningRequest,
  type TuningAction,
  type TuningEntry,
  type TuningListParams,
  type TuningResponse,
  type TuningSuggestion,
} from '@/lib/api';

const PAGE_SIZE = 25;

const SUGGESTION_FILTERS: Array<{ value: 'all' | TuningSuggestion; label: string }> = [
  { value: 'all', label: 'All suggestions' },
  { value: 'disable', label: 'Disable' },
  { value: 'add_suppression', label: 'Add suppression' },
  { value: 'raise_threshold', label: 'Raise threshold' },
  { value: 'tune_confidence', label: 'Tune confidence' },
  { value: 'review_stale', label: 'Review stale' },
  { value: 'healthy', label: 'Healthy' },
];

const SEVERITY_FILTERS = ['all', 'critical', 'high', 'medium', 'low', 'info'] as const;

type SeverityFilter = (typeof SEVERITY_FILTERS)[number];
type SuggestionFilter = 'all' | TuningSuggestion;

const SUGGESTION_LABEL: Record<TuningSuggestion, string> = {
  disable: 'Disable',
  add_suppression: 'Add suppression',
  raise_threshold: 'Raise threshold',
  tune_confidence: 'Tune confidence',
  review_stale: 'Review stale',
  healthy: 'Healthy',
};

const SUGGESTION_TONE: Record<TuningSuggestion, string> = {
  disable: 'bg-pill-danger-bg text-tone-danger',
  add_suppression: 'bg-pill-warning-bg text-tone-warning',
  raise_threshold: 'bg-severity-high-bg text-severity-high-ink',
  tune_confidence: 'bg-pill-info-bg text-tone-info',
  review_stale: 'bg-pill-purple-bg text-tone-purple',
  healthy: 'bg-pill-success-bg text-tone-success',
};

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-severity-critical-bg text-severity-critical-ink',
  high: 'bg-severity-high-bg text-severity-high-ink',
  medium: 'bg-severity-medium-bg text-severity-medium-ink',
  low: 'bg-severity-low-bg text-severity-low-ink',
  info: 'bg-severity-info-bg text-severity-info-ink',
};

/**
 * Suggestion → primary apply action. ``healthy`` has no primary action; we
 * offer Acknowledge instead so the row can be cleared from the queue without
 * mutating the rule.
 */
const SUGGESTION_TO_ACTION: Record<TuningSuggestion, TuningAction | null> = {
  disable: 'disable',
  add_suppression: 'add_suppression',
  raise_threshold: 'raise_threshold',
  tune_confidence: 'acknowledge',
  review_stale: 'acknowledge',
  healthy: null,
};

const APPLY_LABEL: Record<TuningAction, string> = {
  disable: 'Disable rule',
  add_suppression: 'Add suppression',
  raise_threshold: 'Raise threshold',
  acknowledge: 'Acknowledge',
};

type BusyAction = 'apply' | 'dismiss' | 'auto_tune';

interface RuleTuningViewProps {
  /** Initial state hook so tests / deep-links can preselect a suggestion. */
  initialSuggestion?: SuggestionFilter;
}

export default function RuleTuningView({ initialSuggestion = 'all' }: RuleTuningViewProps = {}) {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [suggestion, setSuggestion] = useState<SuggestionFilter>(initialSuggestion);
  const [search, setSearch] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(true);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [page, setPage] = useState(1);
  const [busyMap, setBusyMap] = useState<Record<string, BusyAction>>({});

  const listParams: TuningListParams = useMemo(() => {
    const params: TuningListParams = {
      page,
      page_size: PAGE_SIZE,
      enabled_only: enabledOnly,
      include_dismissed: includeDismissed,
    };
    if (severity !== 'all') params.severity = severity;
    if (suggestion !== 'all') params.suggestion = suggestion;
    const trimmed = search.trim();
    if (trimmed) params.search = trimmed;
    return params;
  }, [page, enabledOnly, includeDismissed, severity, suggestion, search]);

  const swrKey = useMemo(
    () => ['detection-tuning', listParams] as const,
    [listParams],
  );

  const { data, error, isLoading, isValidating, mutate } = useSWR<TuningResponse>(
    swrKey,
    () => tuningApi.list(listParams),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  );

  const setBusy = useCallback((ruleId: string, action: BusyAction | null) => {
    setBusyMap((prev) => {
      const next = { ...prev };
      if (action === null) {
        delete next[ruleId];
      } else {
        next[ruleId] = action;
      }
      return next;
    });
  }, []);

  const handleApply = useCallback(
    async (entry: TuningEntry, action: TuningAction) => {
      setBusy(entry.rule_id, 'apply');
      try {
        const body: ApplyTuningRequest = { action };
        await tuningApi.apply(entry.rule_id, body);
        toast.success(
          action === 'acknowledge'
            ? `Acknowledged "${entry.name}"`
            : `Applied "${APPLY_LABEL[action]}" to "${entry.name}"`,
        );
        await mutate();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed';
        toast.error(message);
      } finally {
        setBusy(entry.rule_id, null);
      }
    },
    [mutate, setBusy],
  );

  const handleDismiss = useCallback(
    async (entry: TuningEntry) => {
      setBusy(entry.rule_id, 'dismiss');
      try {
        await tuningApi.dismiss(entry.rule_id, {});
        toast.success(`Dismissed "${entry.name}" from the workbench`);
        await mutate();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Dismiss failed';
        toast.error(message);
      } finally {
        setBusy(entry.rule_id, null);
      }
    },
    [mutate, setBusy],
  );

  const handleToggleAutoTune = useCallback(
    async (entry: TuningEntry) => {
      const nextEnabled = !entry.auto_tune;
      setBusy(entry.rule_id, 'auto_tune');
      try {
        await tuningApi.autoTune(entry.rule_id, nextEnabled);
        toast.success(
          nextEnabled
            ? `Auto-tune enabled on "${entry.name}"`
            : `Auto-tune disabled on "${entry.name}"`,
        );
        await mutate();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Toggle failed';
        toast.error(message);
      } finally {
        setBusy(entry.rule_id, null);
      }
    },
    [mutate, setBusy],
  );

  const summary = data?.summary;
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersDirty =
    severity !== 'all' ||
    suggestion !== 'all' ||
    search.trim() !== '' ||
    !enabledOnly ||
    includeDismissed;

  const resetFilters = useCallback(() => {
    setSeverity('all');
    setSuggestion('all');
    setSearch('');
    setEnabledOnly(true);
    setIncludeDismissed(false);
    setPage(1);
  }, []);

  return (
    <div className="space-y-6">
      <PageHead
        title="Detection Tuning"
        description="Live tuning workbench for noisy or under-performing detection rules. Suggestions are scored from real false-positive rates, hit volume, and confidence — no more static dashboards."
        actions={
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            {isValidating ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                Refreshing…
              </span>
            ) : data ? (
              <span>Updated {new Date(data.generated_at).toLocaleTimeString()}</span>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={() => mutate()}>
              Refresh
            </Button>
          </div>
        }
      />

      <SummaryCards summary={summary} isLoading={isLoading && !summary} />

      <div className="rounded-container border border-surface-border bg-surface-card">
        <FilterBar
          severity={severity}
          suggestion={suggestion}
          search={search}
          enabledOnly={enabledOnly}
          includeDismissed={includeDismissed}
          onSeverityChange={(v) => {
            setSeverity(v);
            setPage(1);
          }}
          onSuggestionChange={(v) => {
            setSuggestion(v);
            setPage(1);
          }}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          onEnabledOnlyChange={(v) => {
            setEnabledOnly(v);
            setPage(1);
          }}
          onIncludeDismissedChange={(v) => {
            setIncludeDismissed(v);
            setPage(1);
          }}
          onReset={resetFilters}
          filtersDirty={filtersDirty}
        />

        <div className="overflow-x-auto">
          {isLoading && !data ? (
            <TuningTableSkeleton />
          ) : error ? (
            <div className="p-6">
              <ErrorState
                title="Couldn't load tuning suggestions"
                description="The detection tuning service didn't respond. Try again or check the service status."
                error={error}
                onRetry={() => mutate()}
              />
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={EmptyStateIcons.search}
                title={
                  filtersDirty
                    ? 'No rules match your filters'
                    : 'No tuning suggestions right now'
                }
                description={
                  filtersDirty
                    ? 'Try clearing filters or widening the search.'
                    : 'All enabled rules are within healthy false-positive bounds. We will surface tuning suggestions automatically as the picture changes.'
                }
                action={
                  filtersDirty ? (
                    <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <TuningTable
              entries={entries}
              busyMap={busyMap}
              onApply={handleApply}
              onDismiss={handleDismiss}
              onToggleAutoTune={handleToggleAutoTune}
            />
          )}
        </div>

        {!error && entries.length > 0 ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Summary Cards ────────────────────────────────────────────────────────────

interface SummaryCardsProps {
  summary: TuningResponse['summary'] | undefined;
  isLoading: boolean;
}

function SummaryCards({ summary, isLoading }: SummaryCardsProps) {
  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-container border border-surface-border bg-surface-card p-4"
          >
            <Skeleton className="w-24 h-3" />
            <Skeleton className="w-20 h-7 mt-2" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Rules',
      value: summary.total_rules.toLocaleString(),
      hint: `${summary.actionable.toLocaleString()} actionable`,
    },
    {
      label: 'Avg FP Rate',
      value: `${(summary.average_fp_rate * 100).toFixed(1)}%`,
      hint: `${summary.high_fp_count} noisy rules`,
      tone:
        summary.average_fp_rate >= 0.2
          ? 'text-tone-danger'
          : summary.average_fp_rate >= 0.1
            ? 'text-tone-warning'
            : 'text-tone-success',
    },
    {
      label: 'Healthy',
      value: summary.healthy.toLocaleString(),
      hint:
        summary.total_rules > 0
          ? `${Math.round((summary.healthy / summary.total_rules) * 100)}% of population`
          : '—',
      tone: 'text-tone-success',
    },
    {
      label: 'Auto-Tuned',
      value: summary.auto_tune_enabled.toLocaleString(),
      hint: 'rules opted in',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-container border border-surface-border bg-surface-card p-4"
        >
          <p className="text-caption text-fg-muted uppercase tracking-wider">{c.label}</p>
          <p className={clsx('mt-1 text-kpi font-semibold font-mono tabular-nums text-fg-primary', c.tone)}>
            {c.value}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}

// ── Filter Bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  severity: SeverityFilter;
  suggestion: SuggestionFilter;
  search: string;
  enabledOnly: boolean;
  includeDismissed: boolean;
  onSeverityChange: (value: SeverityFilter) => void;
  onSuggestionChange: (value: SuggestionFilter) => void;
  onSearchChange: (value: string) => void;
  onEnabledOnlyChange: (value: boolean) => void;
  onIncludeDismissedChange: (value: boolean) => void;
  onReset: () => void;
  filtersDirty: boolean;
}

function FilterBar({
  severity,
  suggestion,
  search,
  enabledOnly,
  includeDismissed,
  onSeverityChange,
  onSuggestionChange,
  onSearchChange,
  onEnabledOnlyChange,
  onIncludeDismissedChange,
  onReset,
  filtersDirty,
}: FilterBarProps) {
  return (
    <div className="border-b border-surface-border px-5 py-4 flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search rules…"
        aria-label="Search rules"
        className="w-56 rounded-control border border-surface-border bg-surface-elevated px-3 py-1.5 text-body text-fg-primary placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />

      <label className="sr-only" htmlFor="suggestion-filter">
        Filter by suggestion
      </label>
      <select
        id="suggestion-filter"
        value={suggestion}
        onChange={(e) => onSuggestionChange(e.target.value as SuggestionFilter)}
        className="rounded-control border border-surface-border bg-surface-elevated px-3 py-1.5 text-body text-fg-primary focus:border-accent focus:outline-none"
      >
        {SUGGESTION_FILTERS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="severity-filter">
        Filter by severity
      </label>
      <select
        id="severity-filter"
        value={severity}
        onChange={(e) => onSeverityChange(e.target.value as SeverityFilter)}
        className="rounded-control border border-surface-border bg-surface-elevated px-3 py-1.5 text-body text-fg-primary focus:border-accent focus:outline-none"
      >
        {SEVERITY_FILTERS.map((s) => (
          <option key={s} value={s}>
            {s === 'all' ? 'All severities' : s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>

      <label className="inline-flex items-center gap-2 text-body text-fg-secondary ml-2">
        <input
          type="checkbox"
          checked={enabledOnly}
          onChange={(e) => onEnabledOnlyChange(e.target.checked)}
          className="rounded border-surface-border bg-surface-elevated accent-accent"
        />
        Enabled only
      </label>

      <label className="inline-flex items-center gap-2 text-body text-fg-secondary">
        <input
          type="checkbox"
          checked={includeDismissed}
          onChange={(e) => onIncludeDismissedChange(e.target.checked)}
          className="rounded border-surface-border bg-surface-elevated accent-accent"
        />
        Include dismissed
      </label>

      <div className="ml-auto">
        {filtersDirty ? (
          <Button type="button" variant="secondary" size="sm" onClick={onReset}>
            Reset filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

interface TuningTableProps {
  entries: TuningEntry[];
  busyMap: Record<string, BusyAction>;
  onApply: (entry: TuningEntry, action: TuningAction) => void;
  onDismiss: (entry: TuningEntry) => void;
  onToggleAutoTune: (entry: TuningEntry) => void;
}

function TuningTable({
  entries,
  busyMap,
  onApply,
  onDismiss,
  onToggleAutoTune,
}: TuningTableProps) {
  return (
    <table className="w-full text-body">
      <thead>
        <tr className="border-b border-surface-border bg-surface-elevated text-left text-caption uppercase tracking-wider text-fg-muted">
          <th className="px-5 py-3 font-medium">Rule</th>
          <th className="px-5 py-3 font-medium">Suggestion</th>
          <th className="px-5 py-3 font-medium text-right">FP Rate</th>
          <th className="px-5 py-3 font-medium text-right">Hits</th>
          <th className="px-5 py-3 font-medium text-right">Confidence</th>
          <th className="px-5 py-3 font-medium text-center">Auto-Tune</th>
          <th className="px-5 py-3 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <TuningRow
            key={entry.rule_id}
            entry={entry}
            busyAction={busyMap[entry.rule_id] ?? null}
            onApply={onApply}
            onDismiss={onDismiss}
            onToggleAutoTune={onToggleAutoTune}
          />
        ))}
      </tbody>
    </table>
  );
}

interface TuningRowProps {
  entry: TuningEntry;
  busyAction: BusyAction | null;
  onApply: (entry: TuningEntry, action: TuningAction) => void;
  onDismiss: (entry: TuningEntry) => void;
  onToggleAutoTune: (entry: TuningEntry) => void;
}

function TuningRow({
  entry,
  busyAction,
  onApply,
  onDismiss,
  onToggleAutoTune,
}: TuningRowProps) {
  const fpPct = entry.fp_rate * 100;
  const primaryAction = SUGGESTION_TO_ACTION[entry.suggestion];
  const busy = busyAction !== null;
  const severityTone = SEVERITY_TONE[entry.severity] ?? SEVERITY_TONE.info;

  return (
    <tr
      className={clsx(
        'border-b border-surface-border transition-colors',
        entry.dismissed_at ? 'opacity-60' : 'hover:bg-surface-hover',
      )}
      data-testid={`tuning-row-${entry.rule_id}`}
    >
      <td className="px-5 py-3 align-top">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-fg-primary">{entry.name}</span>
            <span
              className={clsx(
                'px-2 py-0.5 rounded-pill text-eyebrow uppercase tracking-wider font-medium',
                severityTone,
              )}
            >
              {entry.severity}
            </span>
            {!entry.enabled ? (
              <span className="px-2 py-0.5 rounded-pill text-eyebrow uppercase tracking-wider bg-pill-neutral-bg text-tone-neutral">
                Disabled
              </span>
            ) : null}
            {entry.dismissed_at ? (
              <span className="px-2 py-0.5 rounded-pill text-eyebrow uppercase tracking-wider bg-pill-neutral-bg text-tone-neutral">
                Dismissed
              </span>
            ) : null}
          </div>
          {entry.reasons.length > 0 ? (
            <p className="text-xs text-fg-muted max-w-md">
              {entry.reasons[0]}
            </p>
          ) : null}
          <p className="text-caption text-fg-subtle">
            {entry.category}
            {entry.last_triggered_at
              ? ` • last hit ${new Date(entry.last_triggered_at).toLocaleDateString()}`
              : ' • never fired'}
          </p>
        </div>
      </td>
      <td className="px-5 py-3 align-top">
        <span
          className={clsx(
            'inline-flex items-center px-2 py-1 rounded-pill text-xs font-medium',
            SUGGESTION_TONE[entry.suggestion],
          )}
        >
          {SUGGESTION_LABEL[entry.suggestion]}
        </span>
      </td>
      <td
        className={clsx(
          'px-5 py-3 align-top text-right font-medium font-mono tabular-nums',
          fpPct >= 50 ? 'text-tone-danger' : fpPct >= 20 ? 'text-tone-warning' : 'text-tone-success',
        )}
      >
        {fpPct.toFixed(1)}%
      </td>
      <td className="px-5 py-3 align-top text-right font-mono tabular-nums text-fg-secondary">
        {entry.total_hits.toLocaleString()}
      </td>
      <td className="px-5 py-3 align-top text-right font-mono tabular-nums text-fg-secondary">
        {entry.confidence}
      </td>
      <td className="px-5 py-3 align-top text-center">
        <button
          type="button"
          onClick={() => onToggleAutoTune(entry)}
          disabled={busy}
          aria-label={`Toggle auto-tune for ${entry.name}`}
          aria-pressed={entry.auto_tune}
          className={clsx(
            'relative inline-flex h-5 w-9 items-center rounded-pill transition-colors disabled:opacity-50',
            entry.auto_tune ? 'bg-accent' : 'bg-surface-border-strong',
          )}
        >
          <span
            className={clsx(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
              entry.auto_tune ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </td>
      <td className="px-5 py-3 align-top">
        <div className="flex items-center justify-end gap-2">
          {primaryAction ? (
            <button
              type="button"
              onClick={() => onApply(entry, primaryAction)}
              disabled={busy || !entry.enabled}
              className="text-xs px-2.5 py-1.5 rounded-control border border-surface-border bg-surface-card text-fg-primary hover:bg-surface-hover transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              title={
                !entry.enabled
                  ? 'Rule is already disabled'
                  : APPLY_LABEL[primaryAction]
              }
            >
              {busyAction === 'apply' ? 'Applying…' : APPLY_LABEL[primaryAction]}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onApply(entry, 'acknowledge')}
              disabled={busy}
              className="text-xs px-2.5 py-1.5 rounded-control border border-surface-border bg-surface-card text-fg-primary hover:bg-surface-hover transition-colors disabled:opacity-45"
            >
              {busyAction === 'apply' ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(entry)}
            disabled={busy || Boolean(entry.dismissed_at)}
            className="text-xs px-2.5 py-1.5 rounded-control text-fg-secondary hover:bg-surface-hover hover:text-fg-primary transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {busyAction === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Skeleton + Pagination ────────────────────────────────────────────────────

function TuningTableSkeleton() {
  return (
    <div className="divide-y divide-surface-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="w-2/3 h-4" />
            <Skeleton className="w-1/2 h-3" />
          </div>
          <Skeleton className="w-24 h-6" />
          <Skeleton className="w-14 h-4" />
          <Skeleton className="w-12 h-4" />
          <Skeleton className="w-9 h-5" />
          <Skeleton className="w-32 h-7" />
        </div>
      ))}
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  return (
    <div className="px-5 py-3 border-t border-surface-border flex flex-wrap items-center justify-between gap-3 text-body text-fg-muted">
      <span>
        Page {page} of {totalPages} • {total.toLocaleString()} rules
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          ← Prev
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
