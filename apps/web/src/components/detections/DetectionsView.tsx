'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import {
  detectionApi,
  type DetectionLanguage,
  type DetectionRule,
} from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { Button } from '@/components/ui/Button';
import { ContributorLeaderboard } from './ContributorLeaderboard';
import { MitreRuleHeatmap } from './MitreRuleHeatmap';
import { ConfidenceTrends } from './ConfidenceTrends';
import { DriftInbox } from './DriftInbox';
import { canUseDemoData } from '@/lib/demoFallback';

// ─── Demo fallback ────────────────────────────────────────────────────────────

// Deterministic base — no Date.now() to avoid SSR hydration mismatches.
const MOCK_BASE = new Date('2026-05-06T12:00:00Z').getTime();
const ago = (mins: number) => new Date(MOCK_BASE - mins * 60 * 1000).toISOString();

const SAMPLE_SIGMA = `title: Suspicious PowerShell Encoded Command
id: aisoc-rule-001
status: experimental
description: Flags powershell.exe spawning with -EncodedCommand
logsource:
  product: windows
  category: process_creation
detection:
  selection:
    Image|endswith: '\\powershell.exe'
    CommandLine|contains: '-EncodedCommand'
  condition: selection
level: high
tags:
  - attack.execution
  - attack.t1059.001
`;

const SAMPLE_KQL = `// Impossible travel
SigninLogs
| where ResultType == 0
| extend lat = todouble(LocationDetails.geoCoordinates.latitude),
         lon = todouble(LocationDetails.geoCoordinates.longitude)
| order by UserPrincipalName, TimeGenerated asc
| serialize
| extend prevLat = prev(lat), prevLon = prev(lon), prevTime = prev(TimeGenerated)
| where (datetime_diff('minute', TimeGenerated, prevTime)) between (1 .. 240)
| extend km = geo_distance_2points(prevLon, prevLat, lon, lat) / 1000
| where km / (datetime_diff('minute', TimeGenerated, prevTime) / 60.0) > 900
| project TimeGenerated, UserPrincipalName, km, IPAddress
`;

const SAMPLE_EQL = `sequence by aws.account.id with maxspan=1h
  [iam where event.action == "CreateAccessKey"]
  [aws where event.module == "guardduty" and event.severity >= 7]
`;

const DEMO_RULES: DetectionRule[] = [
  {
    id: 'rule-001',
    name: 'Suspicious PowerShell Encoded Command',
    description:
      'Flags powershell.exe spawning with -EncodedCommand, a common LOLBin tradecraft used to evade content filters.',
    language: 'sigma',
    body: SAMPLE_SIGMA,
    enabled: true,
    severity: 'high',
    tags: ['windows', 'lolbin', 'powershell'],
    mitre: ['T1059.001', 'T1027'],
    createdAt: ago(60 * 24 * 14),
    updatedAt: ago(60 * 6),
    lastTriggeredAt: ago(38),
    hitCount: 42,
  },
  {
    id: 'rule-002',
    name: 'Impossible Travel — Same User',
    description:
      'Detects identity sign-ins from two geographies within a window that is physically impossible to traverse.',
    language: 'kql',
    body: SAMPLE_KQL,
    enabled: true,
    severity: 'medium',
    tags: ['identity', 'authn'],
    mitre: ['T1078'],
    createdAt: ago(60 * 24 * 30),
    updatedAt: ago(60 * 24 * 2),
    lastTriggeredAt: ago(60 * 7),
    hitCount: 12,
  },
  {
    id: 'rule-003',
    name: 'AWS GuardDuty High-Severity Finding',
    description:
      'Forwards GuardDuty findings of severity 7+ into AiSOC as alerts and links them to the affected resource.',
    language: 'eql',
    body: SAMPLE_EQL,
    enabled: false,
    severity: 'critical',
    tags: ['aws', 'cloud'],
    mitre: ['T1078.004', 'T1110'],
    createdAt: ago(60 * 24 * 5),
    updatedAt: ago(60 * 24 * 1),
    hitCount: 0,
  },
];

const LANG_LABEL: Record<DetectionLanguage, string> = {
  sigma: 'Sigma',
  yara: 'YARA',
  kql: 'KQL',
  eql: 'EQL',
  lucene: 'Lucene',
  regex: 'Regex',
  'aisoc-match': 'Engine',
};

const LANG_BADGE: Record<DetectionLanguage, string> = {
  sigma: 'bg-pill-info-bg text-tone-info',
  yara: 'bg-pill-purple-bg text-tone-purple',
  kql: 'bg-pill-success-bg text-tone-success',
  eql: 'bg-pill-warning-bg text-tone-warning',
  lucene: 'bg-accent-subtle text-accent',
  regex: 'bg-pill-danger-bg text-tone-danger',
  'aisoc-match': 'bg-pill-neutral-bg text-tone-neutral',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-severity-critical-bg text-severity-critical-ink',
  high: 'bg-severity-high-bg text-severity-high-ink',
  medium: 'bg-severity-medium-bg text-severity-medium-ink',
  low: 'bg-severity-low-bg text-severity-low-ink',
  info: 'bg-severity-info-bg text-severity-info-ink',
};

// ─── Tabs ────────────────────────────────────────────────────────────────────

type DetectionsTab = 'rules' | 'coverage' | 'confidence' | 'drift';

const TABS: { id: DetectionsTab; label: string; description: string }[] = [
  {
    id: 'rules',
    label: 'Rules',
    description: 'Author, tune, and operate the active rule library.',
  },
  {
    id: 'coverage',
    label: 'Coverage',
    description:
      'Rule-centric MITRE ATT&CK heatmap — see what kill-chain stages are well covered and where the tuning gaps are.',
  },
  {
    id: 'confidence',
    label: 'Confidence',
    description:
      'How trustworthy is your rule library? Distribution, per-tactic averages, and the rules dragging the average down.',
  },
  {
    id: 'drift',
    label: 'Drift',
    description:
      'Rules that need attention: noisy false-positive rates, low confidence, or stale ones that have stopped firing.',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

//: One page of rules. The library is 2,614 entries on a default install, so
//: the list is paged and every filter runs on the server — rendering the
//: whole corpus would trade an empty page for an unusable one.
const PAGE_SIZE = 50;

export function DetectionsView() {
  const [tab /* [HIDDEN-UI NAV-6] , setTab */] = useState<DetectionsTab>('rules');
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<DetectionLanguage | 'all'>('all');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'on' | 'off'>(
    'all',
  );
  const [page, setPage] = useState(0);

  // Typing a character per request would put one round-trip per keystroke
  // against a 2,614-rule search.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter change invalidates the page offset: page 4 of a 2,614-rule
  // list is page 0 of a six-rule one.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, language, enabledFilter]);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      enabled:
        enabledFilter === 'all' ? undefined : enabledFilter === 'on',
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedSearch, enabledFilter, page],
  );

  const { data, error, isLoading, mutate } = useSWR(
    ['detection:rules', query, language],
    () => detectionApi.list(query),
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  );

  // Only the hosted demo substitutes sample rules on error. Elsewhere a
  // load failure must show as a failure: a fabricated rule list tells an
  // operator their detection coverage is fine when the service is down.
  const useFallback = !!error && canUseDemoData();
  // Memoise so `useMemo(filtered)` and selection helpers don't see a fresh
  // array reference on every render — important because we feed `rules`
  // into a downstream useMemo dep array.
  const rules = useMemo<DetectionRule[]>(
    () => data?.rules ?? (useFallback ? DEMO_RULES : []),
    [data, useFallback],
  );

  // Selection state for bulk operations. We keep it as a Set so we can
  // do O(1) `has()` checks while rendering each rule card.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  // The server applies search and enabled-state; the language control is the
  // only filter left on the client, because it is a display choice over a
  // page rather than a query.
  const filtered = useMemo(
    () =>
      language === 'all'
        ? rules
        : rules.filter((r) => r.language === language),
    [rules, language],
  );

  // Totals. `total` counts what matched the filters; `libraryTotal` counts
  // the library. Both are stated because they answer different questions and
  // the page previously answered neither — it showed "No detection rules
  // yet" beside a tile crediting the project with 2,511.
  const matchedTotal = data?.total ?? filtered.length;
  const libraryTotal = (data?.builtinTotal ?? 0) + (data?.customTotal ?? 0);
  const pageCount = Math.max(1, Math.ceil(matchedTotal / PAGE_SIZE));
  const catalogError = data?.catalogError ?? null;
  const missingArtefacts = data?.missingArtefacts ?? [];

  // ─── Selection helpers ─────────────────────────────────────────────────────

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const r of filtered) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of filtered) next.add(r.id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const toggleEnabled = async (rule: DetectionRule) => {
    const next = !rule.enabled;
    // Optimistic
    mutate(
      (curr) =>
        curr
          ? {
              ...curr,
              rules: curr.rules.map((r) =>
                r.id === rule.id ? { ...r, enabled: next } : r,
              ),
            }
          : curr,
      { revalidate: false },
    );

    try {
      if (!useFallback) {
        await detectionApi.update(rule.id, { enabled: next });
      }
      toast.success(next ? 'Rule enabled' : 'Rule disabled');
      mutate();
    } catch (err) {
      console.warn('Toggle failed', err);
      toast.error('Could not update rule');
      mutate(); // Re-fetch to revert
    }
  };

  const runBulkToggle = async (enabled: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    if (useFallback) {
      // Demo mode — apply optimistically with no backend round-trip.
      mutate(
        (curr) =>
          curr
            ? {
                ...curr,
                rules: curr.rules.map((r) =>
                  selected.has(r.id) ? { ...r, enabled } : r,
                ),
              }
            : curr,
        { revalidate: false },
      );
      toast.success(
        `${ids.length} rule${ids.length === 1 ? '' : 's'} ${enabled ? 'enabled' : 'disabled'} (demo)`,
      );
      clearSelection();
      return;
    }

    setBulkPending(true);
    // Optimistic update — flip enabled state in-memory so the UI reflects the
    // intent immediately. We re-fetch on completion to reconcile against
    // anything the backend skipped.
    mutate(
      (curr) =>
        curr
          ? {
              ...curr,
              rules: curr.rules.map((r) =>
                selected.has(r.id) ? { ...r, enabled } : r,
              ),
            }
          : curr,
      { revalidate: false },
    );

    try {
      const result = await detectionApi.bulkToggle(ids, enabled);
      const updatedCount = result.updated;
      const skippedCount = result.skipped.length;
      if (updatedCount > 0) {
        toast.success(
          `${updatedCount} rule${updatedCount === 1 ? '' : 's'} ${enabled ? 'enabled' : 'disabled'}` +
            (skippedCount > 0 ? ` — ${skippedCount} not found` : ''),
        );
      } else if (skippedCount > 0) {
        toast(`No rules updated — ${skippedCount} were not found.`, {
          icon: 'ℹ️',
        });
      }
      clearSelection();
      mutate();
    } catch (err) {
      console.warn('Bulk toggle failed', err);
      toast.error('Could not update rules');
      mutate(); // Re-fetch to revert
    } finally {
      setBulkPending(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHead
        title="Detection rules"
        description={
          TABS.find((t) => t.id === tab)?.description ??
          'Author, test, and operate detection logic across log sources.'
        }
        actions={
          <div className="flex items-center gap-2">
            {/* [HIDDEN-UI NAV-6 /detection/proposals route hidden] */}
            {/* <Link
              href="/detection/proposals"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              Proposals
            </Link> */}
            <Link
              href="/detection/new"
              className="inline-flex items-center justify-center gap-2 rounded-control bg-btn-grad px-4 py-2 text-control font-semibold text-white transition-all hover:brightness-105"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New rule
            </Link>
          </div>
        }
      />

      {/* [HIDDEN-UI NAV-6 hide inner tab bar so only SectionTabs shows] */}
      {/* <div ... /> */}

      {/* Demo banner */}
      {useFallback && (
        <div className="rounded-control border border-tone-warning/30 bg-pill-warning-bg px-4 py-2 text-xs text-tone-warning">
          Detection API unreachable — showing curated demo rules so you can
          explore the workflow.
        </div>
      )}

      {tab === 'rules' && (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-3 rounded-container border border-surface-border bg-surface-card p-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, tag, or technique (T1059, lolbin, identity)…"
                className="w-full rounded-control border border-surface-border bg-surface-elevated px-9 py-2 text-body text-fg-primary placeholder:text-fg-subtle outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </div>

            <select
              value={language}
              onChange={(e) =>
                setLanguage(e.target.value as DetectionLanguage | 'all')
              }
              className="rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-body text-fg-secondary outline-none focus:border-accent"
            >
              <option value="all">All languages</option>
              <option value="aisoc-match">Engine (compiled)</option>
              <option value="sigma">Sigma</option>
              <option value="yara">YARA</option>
              <option value="kql">KQL</option>
              <option value="eql">EQL</option>
              <option value="lucene">Lucene</option>
              <option value="regex">Regex</option>
            </select>

            <div className="inline-flex rounded-control border border-surface-border bg-surface-elevated p-0.5 text-xs">
              {(['all', 'on', 'off'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setEnabledFilter(opt)}
                  className={clsx(
                    'rounded-control px-3 py-1.5 font-medium transition-colors',
                    enabledFilter === opt
                      ? 'bg-nav-active-bg text-fg-primary'
                      : 'text-fg-muted hover:text-fg-primary',
                  )}
                >
                  {opt === 'all' ? 'All' : opt === 'on' ? 'Enabled' : 'Disabled'}
                </button>
              ))}
            </div>
          </div>

          {/* Bulk action bar — appears when rules are selected. */}
          {selected.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-3 rounded-control border border-accent/30 bg-accent-subtle px-4 py-2.5 text-body"
              role="toolbar"
              aria-label="Bulk rule actions"
            >
              <span className="text-fg-primary">
                <span className="font-mono font-semibold">{selected.size}</span>{' '}
                rule{selected.size === 1 ? '' : 's'} selected
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => runBulkToggle(true)}
                  disabled={bulkPending}
                >
                  Enable
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => runBulkToggle(false)}
                  disabled={bulkPending}
                >
                  Disable
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={bulkPending}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          {/* What the library holds, and what the filters matched. Two
              different questions: the page used to answer neither, printing
              "No detection rules yet" beside a tile crediting 2,511 rules. */}
          {!isLoading && !error && (
            <p className="px-1 text-xs text-fg-muted">
              {matchedTotal.toLocaleString()} matching
              {libraryTotal > 0 && (
                <>
                  {' '}
                  of {libraryTotal.toLocaleString()} in the library —{' '}
                  {(data?.builtinTotal ?? 0).toLocaleString()} loaded by the
                  detection engine,{' '}
                  {(data?.customTotal ?? 0).toLocaleString()} authored here
                </>
              )}
            </p>
          )}

          {/* A partial read is reported as partial. Publishing the smaller
              total as if it were the whole corpus is the same mistake in a
              quieter costume. */}
          {missingArtefacts.length > 0 && (
            <div className="rounded-control border border-tone-warning/30 bg-pill-warning-bg px-4 py-2 text-xs text-tone-warning">
              Part of the compiled corpus is missing from this deployment (
              {missingArtefacts.join(', ')}), so the library below is
              incomplete. Rebuild the API image from a tree where{' '}
              <code>scripts/sync_packaged_detection_rulesets.py --check</code>{' '}
              passes.
            </div>
          )}

          {/* Body */}
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : catalogError ? (
            // The engine's rules exist; this deployment cannot read them.
            // Saying "no rules" here would repeat the defect the surface was
            // reported for, in the one case where it is most misleading.
            <EmptyState
              title="The built-in rule library could not be read"
              description={`The detection engine still loads and fires these rules — this service cannot see the compiled corpus to list them. ${catalogError}`}
            />
          ) : error && !useFallback ? (
            // "No detection rules yet" on a failed read tells an operator
            // their coverage is zero and invites them to author one. The
            // ErrorState below is a sibling rather than an alternative, so
            // both used to render — the reassuring one first.
            <EmptyState
              title="Could not load detection rules"
              description="The detection service did not answer. This is not a report that no rules exist."
            />
          ) : filtered.length === 0 ? (
            libraryTotal === 0 ? (
              // Only reachable when the library really is empty: the compiled
              // corpus read fine and held nothing, and the tenant has authored
              // nothing. A default install ships 2,614 engine rules, so this
              // now means what it says.
              <EmptyState
                title="No detection rules yet"
                description="This deployment carries no compiled detection corpus and no rules have been authored here. Write one in Sigma, KQL, or EQL to start building coverage."
                action={
                  <Link
                    href="/detection/new"
                    className="rounded-control bg-btn-grad px-4 py-2 text-control font-semibold text-white hover:brightness-105"
                  >
                    Create a rule
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title="No rules match your filters"
                description="Try clearing the search, switching language, or showing all enabled states."
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setLanguage('all');
                      setEnabledFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            )
          ) : (
            <>
              {/* Select-all header — small horizontal strip above the list */}
              <div className="flex items-center gap-2 px-1 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  aria-label={
                    allFilteredSelected
                      ? 'Deselect all visible rules'
                      : 'Select all visible rules'
                  }
                  className="h-3.5 w-3.5 cursor-pointer rounded border-surface-border bg-surface-elevated accent-accent"
                />
                <span>
                  {allFilteredSelected
                    ? `All ${filtered.length} visible rule${filtered.length === 1 ? '' : 's'} selected`
                    : `Select all ${filtered.length} visible rule${filtered.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <ul className="space-y-3">
                {filtered.map((rule) => (
                  <li key={rule.id}>
                    <RuleCard
                      rule={rule}
                      selected={selected.has(rule.id)}
                      onSelect={() => toggleSelected(rule.id)}
                      onToggle={() => toggleEnabled(rule)}
                    />
                  </li>
                ))}
              </ul>

              {pageCount > 1 && (
                <nav
                  className="flex items-center justify-between gap-3 px-1 text-xs text-fg-muted"
                  aria-label="Rule library pages"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {pageCount.toLocaleString()}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(pageCount - 1, p + 1))
                    }
                    disabled={page >= pageCount - 1}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </>
          )}

          {/* Footer / errors */}
          {error && !useFallback && (
            <ErrorState
              title="Couldn't load detection rules"
              // The guard is `!useFallback`, so the demo set was *not* shown.
              // The copy claimed a substitution its own condition rules out.
              description="The detection service didn't respond. Nothing is shown in its place."
              error={error}
              onRetry={() => mutate()}
            />
          )}

          {/* Contributor leaderboard */}
          <ContributorLeaderboard />
        </>
      )}

      {tab === 'coverage' && <MitreRuleHeatmap />}

      {tab === 'confidence' && <ConfidenceTrends />}

      {tab === 'drift' && <DriftInbox />}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: DetectionRule;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

function RuleCard({ rule, selected, onSelect, onToggle }: RuleCardProps) {
  return (
    <Link
      href={`/detection/${rule.id}`}
      className={clsx(
        'group block rounded-container border p-4 transition-colors',
        selected
          ? 'border-accent/50 bg-nav-active-bg'
          : 'border-surface-border bg-surface-card hover:bg-surface-elevated',
      )}
    >
      <div className="flex items-start gap-4">
        {/* Selection checkbox + status dot stacked */}
        <div className="mt-1 flex flex-col items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => {
              // Don't navigate to the rule detail page on checkbox click.
              e.preventDefault();
              e.stopPropagation();
              onSelect();
            }}
            onChange={() => {
              // Click handler does the work; keep onChange to satisfy React.
            }}
            aria-label={`Select rule ${rule.name}`}
            className="h-3.5 w-3.5 cursor-pointer rounded border-surface-border bg-surface-elevated accent-accent"
          />
          <span
            className={clsx(
              'inline-flex h-2.5 w-2.5 rounded-full',
              rule.enabled
                ? 'bg-dot-success'
                : 'bg-fg-subtle',
            )}
          />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-body font-semibold text-fg-primary group-hover:text-accent">
              {rule.name}
            </h3>
            <span
              className={clsx(
                'rounded-pill px-2 py-0.5 text-eyebrow font-medium uppercase tracking-wide',
                LANG_BADGE[rule.language],
              )}
            >
              {LANG_LABEL[rule.language]}
            </span>
            {rule.severity && (
              <span
                className={clsx(
                  'rounded-pill px-2 py-0.5 text-eyebrow font-medium uppercase tracking-wide',
                  SEVERITY_BADGE[rule.severity] ?? 'bg-pill-neutral-bg text-tone-neutral',
                )}
              >
                {rule.severity}
              </span>
            )}
            {rule.isBuiltin && (
              <span
                title="Loaded and evaluated by the detection engine. Disabling it here stops the engine firing it for this tenant."
                className="rounded-pill bg-pill-info-bg px-2 py-0.5 text-eyebrow font-medium uppercase tracking-wide text-tone-info"
              >
                Built-in
              </span>
            )}
          </div>

          {rule.sourceId && (
            // The id an alert carries. An analyst reading "detection:
            // det-cloud-063" off an alert searches for exactly this string,
            // so it belongs on the card rather than one click deeper.
            <p className="mt-1 font-mono text-caption text-fg-subtle">
              {rule.sourceId}
            </p>
          )}

          {rule.description && (
            <p className="mt-1 text-body text-fg-muted line-clamp-2">
              {rule.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {rule.mitre?.slice(0, 4).map((id) => (
              <span
                key={id}
                className="rounded-control bg-surface-subtle px-1.5 py-0.5 font-mono text-caption text-fg-secondary"
              >
                {id}
              </span>
            ))}
            {rule.tags?.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-pill bg-surface-subtle px-2 py-0.5 text-caption text-fg-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {/* Right meta + toggle */}
        <div className="flex flex-col items-end gap-2">
          <div className="text-right text-xs text-fg-muted">
            {!rule.isBuiltin && (
              <div>
                <span className="font-mono text-fg-primary">
                  {rule.hitCount ?? 0}
                </span>{' '}
                hits
              </div>
            )}
            <div className="mt-0.5" suppressHydrationWarning>
              {rule.lastTriggeredAt
                ? `last fired ${formatDistanceToNow(new Date(rule.lastTriggeredAt), { addSuffix: true })}`
                : rule.isBuiltin
                  ? // The engine writes alerts, not a hit counter on this
                    // table, so "no recent hits" would be a measurement
                    // nobody took rather than an observation.
                    'hits not counted here'
                  : 'no recent hits'}
            </div>
          </div>
          <Toggle enabled={rule.enabled} onChange={onToggle} />
        </div>
      </div>
    </Link>
  );
}

interface ToggleProps {
  enabled: boolean;
  onChange: () => void;
}

function Toggle({ enabled, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? 'Disable rule' : 'Enable rule'}
      className={clsx(
        'relative inline-flex h-5 w-9 items-center rounded-pill transition-colors',
        enabled ? 'bg-dot-success' : 'bg-surface-border-strong',
      )}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
