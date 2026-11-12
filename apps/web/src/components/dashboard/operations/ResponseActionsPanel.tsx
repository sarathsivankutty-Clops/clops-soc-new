'use client';

/**
 * Response actions the agent has stopped on, waiting for a human.
 *
 * The agent pauses before a high-risk action — isolate a host, disable an
 * account, revoke a session — and writes an approval request. Until someone
 * decides, the containment has not happened. An approval sitting unnoticed
 * for two hours is an incident still running, so the count and the age of the
 * oldest one belong on an operations dashboard rather than only inside the
 * on-call queue.
 *
 * Deciding happens on `/responder/approvals`, which already does it properly
 * (full context, deny-with-comment, optimistic reconciliation). This panel
 * links there rather than growing a cramped second approve button: a
 * one-tap irreversible action in a dashboard tile is a worse affordance than
 * a link to the surface built for it.
 */

import useSWR from 'swr';
import Link from 'next/link';
import { clsx } from 'clsx';
import { responderApi, type ApprovalRequest } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

const RISK_STYLE: Record<ApprovalRequest['risk_level'], string> = {
  critical: 'bg-severity-bg-critical text-severity-ink-critical',
  high: 'bg-severity-bg-high text-severity-ink-high',
  medium: 'bg-severity-bg-medium text-severity-ink-medium',
  low: 'bg-severity-bg-low text-severity-ink-low',
};

const RISK_ORDER: ReadonlyArray<ApprovalRequest['risk_level']> = [
  'critical',
  'high',
  'medium',
  'low',
];

export function formatWaitingFor(createdAt: string, now: number = Date.now()): string {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return 'waiting';
  const secs = Math.max(0, Math.round((now - started) / 1000));
  if (secs < 60) return 'waiting <1m';
  if (secs < 3600) return `waiting ${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `waiting ${Math.round(secs / 3600)}h`;
  return `waiting ${Math.round(secs / 86_400)}d`;
}

export function ResponseActionsPanel() {
  const { data, error, isLoading, mutate } = useSWR(
    'ops-pending-approvals',
    () => responderApi.listApprovals({ status: 'pending', page_size: 25 }),
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );

  const items = data?.items ?? [];
  const sorted = [...items].sort((a, b) => {
    const byRisk = RISK_ORDER.indexOf(a.risk_level) - RISK_ORDER.indexOf(b.risk_level);
    if (byRisk !== 0) return byRisk;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return (
    <section
      aria-labelledby="ops-approvals-heading"
      className="rounded-container border border-surface-border bg-surface-card shadow-card overflow-hidden"
    >
      <div className="flex items-baseline justify-between px-5 py-4 border-b border-surface-divider">
        <div>
          <h2 id="ops-approvals-heading" className="text-card-title font-semibold text-fg-primary">
            Actions awaiting approval
          </h2>
          <p className="mt-0.5 text-caption text-fg-muted">
            Containment the agent has proposed and paused on.
          </p>
        </div>
        {data && data.total > 0 && (
          <span className="shrink-0 rounded-pill bg-pill-warning-bg px-2.5 py-0.5 text-caption font-medium text-tone-warning">
            {`${data.total} pending`}
          </span>
        )}
      </div>

      {isLoading && !data ? (
        <div className="m-4 h-20 animate-pulse rounded-control bg-surface-subtle" />
      ) : error ? (
        <ErrorState
          title="Approval queue unavailable"
          description="Pending containment actions cannot be listed. Check /responder/approvals directly."
          error={error}
          onRetry={() => {
            void mutate();
          }}
          className="m-4"
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="Nothing waiting on a human"
          description="No response action is currently paused for approval."
          className="m-4"
        />
      ) : (
        <>
          <ul className="divide-y divide-surface-divider">
            {sorted.slice(0, 6).map((item) => (
              <li
                key={item.id}
                className="px-5 py-3"
              >
                <Link
                  href="/responder/approvals"
                  className="flex items-start gap-3 hover:opacity-90"
                >
                  <span
                    className={clsx(
                      'mt-0.5 shrink-0 rounded-pill px-2 py-0.5 text-eyebrow font-medium uppercase',
                      RISK_STYLE[item.risk_level],
                    )}
                  >
                    {item.risk_level}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-fg-primary">{item.title}</span>
                    <span className="block truncate text-caption text-fg-muted">
                      {item.summary}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption font-mono text-fg-muted">
                    {formatWaitingFor(item.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-surface-divider px-5 py-3">
            <Link
              href="/responder/approvals"
              className="text-control-sm text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              {sorted.length > 6
                ? `Review all ${data?.total ?? sorted.length} in the approvals queue`
                : 'Open the approvals queue'}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
