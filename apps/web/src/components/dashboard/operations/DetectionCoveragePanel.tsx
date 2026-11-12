'use client';

/**
 * Detection coverage, as a ratio of techniques with at least one *active* rule.
 *
 * `GET /api/v1/detection/coverage` distinguishes total rules from active ones
 * and counts techniques covered by an active rule. That distinction is the
 * whole point: a corpus of 800 rules with half of them disabled covers far
 * less than the headline rule count implies, and a disabled rule is exactly as
 * useful as no rule.
 *
 * The panel therefore leads with covered-vs-total techniques, names the number
 * of inactive rules explicitly rather than folding them into a total, and
 * lists the tactics with the thinnest active coverage — which is the part an
 * operator can act on this week.
 */

import useSWR from 'swr';
import Link from 'next/link';
import { clsx } from 'clsx';
import { detectionApi, type DetectionCoverage } from '@/lib/api';
import { displayTactic } from '@/lib/mitreTactics';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

/** Tactics ranked by how little active coverage they have. */
export function thinnestTactics(
  coverage: DetectionCoverage,
  take = 5,
): Array<{ tactic: string; covered: number; total: number }> {
  const byTactic = new Map<string, { covered: number; total: number }>();

  for (const cell of coverage.cells) {
    // The API reads its tactic from `rule.mitre_tactics[0]`, and the compiled
    // built-in corpus carries no tactic key — so on a real deployment every
    // cell arrived `null` and this ranking was empty, while the alert detail
    // page resolved the same technique IDs correctly. `displayTactic` falls
    // back to the technique→tactic map rather than discarding the row.
    //
    // A technique neither the rule nor the map can place is still skipped:
    // inventing an "Unknown" bucket would imply a gap in a tactic that does
    // not exist.
    const tactic = displayTactic(cell.tactic, cell.techniqueId);
    if (!tactic) continue;
    const entry = byTactic.get(tactic) ?? { covered: 0, total: 0 };
    entry.total += 1;
    if (cell.activeRules > 0) entry.covered += 1;
    byTactic.set(tactic, entry);
  }

  return [...byTactic.entries()]
    .map(([tactic, v]) => ({ tactic, ...v }))
    .sort((a, b) => a.covered / Math.max(a.total, 1) - b.covered / Math.max(b.total, 1))
    .slice(0, take);
}

export function DetectionCoveragePanel() {
  const { data, error, isLoading, mutate } = useSWR(
    'ops-detection-coverage',
    () => detectionApi.coverage(),
    { refreshInterval: 300_000, revalidateOnFocus: false },
  );

  const summary = data?.summary;
  const ratio =
    summary && summary.techniques > 0 ? summary.coveredTechniques / summary.techniques : null;

  return (
    <section
      aria-labelledby="ops-coverage-heading"
      className="rounded-container border border-surface-border bg-surface-card shadow-card overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-surface-divider">
        <h2 id="ops-coverage-heading" className="text-card-title font-semibold text-fg-primary">
          Detection coverage
        </h2>
        <p className="mt-0.5 text-caption text-fg-muted">
          Techniques with at least one enabled rule. A disabled rule covers nothing.
        </p>
      </div>

      {isLoading && !data ? (
        <div className="m-4 h-24 animate-pulse rounded-control bg-surface-subtle" />
      ) : error ? (
        <ErrorState
          title="Coverage unavailable"
          error={error}
          onRetry={() => {
            void mutate();
          }}
          className="m-4"
        />
      ) : !summary || summary.techniques === 0 ? (
        <EmptyState
          title="No detection rules loaded"
          description="Coverage is computed from the rules this tenant has enabled."
          action={
            <Link
              href="/detection"
              className="text-body text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              Browse detection rules
            </Link>
          }
          className="m-4"
        />
      ) : (
        <div className="space-y-4 p-5">
          <div className="flex items-end gap-6">
            <div>
              <p className="text-eyebrow uppercase tracking-wider text-fg-muted">
                Techniques covered
              </p>
              <p className="text-kpi font-bold font-mono text-fg-primary">
                {`${summary.coveredTechniques} / ${summary.techniques}`}
              </p>
            </div>
            <div>
              <p className="text-eyebrow uppercase tracking-wider text-fg-muted">Active rules</p>
              <p className="text-kpi font-bold font-mono text-fg-primary">
                {summary.activeRules.toLocaleString()}
              </p>
              {summary.inactiveRules > 0 && (
                <p className="text-caption text-tone-warning">
                  {`${summary.inactiveRules.toLocaleString()} disabled`}
                </p>
              )}
            </div>
          </div>

          {ratio !== null && (
            <div>
              <div className="h-1.5 rounded-pill bg-surface-subtle overflow-hidden">
                <div
                  className={clsx(
                    'h-1.5 rounded-pill',
                    ratio >= 0.6 ? 'bg-dot-success' : ratio >= 0.3 ? 'bg-dot-warning' : 'bg-dot-danger',
                  )}
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-caption text-fg-muted">
                {`${Math.round(ratio * 100)}% of the ${summary.techniques} techniques your rules reference have an enabled rule — coverage of your own corpus, not of ATT&CK.`}
              </p>
            </div>
          )}

          {data && (
            <div>
              <p className="mb-2 text-eyebrow uppercase tracking-wider text-fg-muted">
                Thinnest tactics
              </p>
              <ul className="space-y-1.5">
                {thinnestTactics(data).map((t) => (
                  <li key={t.tactic} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-control-sm text-fg-primary">{t.tactic}</span>
                    <span className="shrink-0 text-caption font-mono text-fg-muted">
                      {`${t.covered}/${t.total} covered`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
