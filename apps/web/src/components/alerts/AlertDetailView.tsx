'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  alertsApi,
  casesApi,
  ledgerApi,
  feedbackApi, computeRedispositionToken,
  type Alert,
  type ConfidenceFactor,
  type ConfidenceLabel,
  type AnalystVerdict,
  type RedispositionCandidate,
} from '@/lib/api';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { ContextualActions } from '@/components/copilot/ContextualActions';
import { ExplainDrawer } from '@/components/alerts/ExplainDrawer';
import { CreateCaseModal, alertSeverityToCaseSeverity } from '@/components/alerts/CreateCaseModal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { demoFallback } from '@/lib/demoFallback';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  /* [HIDDEN-UI THEME-4 kept all 5 severity tiers distinct with dot + soft tint, no border] */
  critical: { label: 'Critical', badge: 'bg-severity-bg-critical text-severity-ink-critical', dot: 'bg-severity-dot-critical' },
  high: { label: 'High', badge: 'bg-severity-bg-high text-severity-ink-high', dot: 'bg-severity-dot-high' },
  medium: { label: 'Medium', badge: 'bg-severity-bg-medium text-severity-ink-medium', dot: 'bg-severity-dot-medium' },
  low: { label: 'Low', badge: 'bg-severity-bg-low text-severity-ink-low', dot: 'bg-severity-dot-low' },
  info: { label: 'Info', badge: 'bg-severity-bg-info text-severity-ink-info', dot: 'bg-severity-dot-info' },
} as const;

const STATUS_CONFIG = {
  new: { label: 'New', badge: 'bg-pill-info-bg text-accent', dot: 'bg-dot-info' },
  triaged: { label: 'Triaged', badge: 'bg-pill-purple-bg text-tone-purple', dot: 'bg-tone-purple' },
  investigating: { label: 'Investigating', badge: 'bg-pill-warning-bg text-tone-warning', dot: 'bg-dot-warning' },
  resolved: { label: 'Resolved', badge: 'bg-pill-success-bg text-tone-success', dot: 'bg-dot-success' },
  false_positive: { label: 'False Positive', badge: 'bg-pill-neutral-bg text-fg-muted', dot: 'bg-dot-neutral' },
} as const;

const CONFIDENCE_CONFIG: Record<ConfidenceLabel, { label: string; badge: string; dot: string; description: string }> = {
  high: {
    label: 'High Confidence',
    badge: 'bg-pill-success-bg text-tone-success',
    dot: 'bg-dot-success',
    description: 'Multiple corroborating signals; low risk of false positive.',
  },
  medium: {
    label: 'Medium Confidence',
    badge: 'bg-pill-warning-bg text-tone-warning',
    dot: 'bg-dot-warning',
    description: 'Mixed signals; review supporting evidence before action.',
  },
  low: {
    label: 'Low Confidence',
    badge: 'bg-pill-neutral-bg text-fg-muted',
    dot: 'bg-dot-neutral',
    description: 'Weak or partial signal; likely needs analyst validation.',
  },
};

// Mock alert for development
const MOCK_ALERT: Alert = {
  id: 'alert-1',
  title: 'Suspicious PowerShell execution detected',
  description: 'A PowerShell script was executed with obfuscated content and attempted to download a payload from an external domain. The process was spawned by a user with administrative privileges outside of business hours.',
  severity: 'critical',
  status: 'new',
  source: 'CrowdStrike',
  sourceRef: 'CS-2024-789012',
  tenantId: 'tenant-1',
  riskScore: 95,
  mitreAttack: [
    { tactic: 'Execution', technique: 'PowerShell', techniqueId: 'T1059.001' },
    { tactic: 'Defense Evasion', technique: 'Obfuscated Files or Information', techniqueId: 'T1027' },
    { tactic: 'Command and Control', technique: 'Application Layer Protocol', techniqueId: 'T1071' },
  ],
  iocs: [
    { type: 'ip', value: '185.220.101.45', malicious: true },
    { type: 'domain', value: 'payload-c2.xyz', malicious: true },
    { type: 'hash', value: 'a1b2c3d4e5f6789012345678901234567890abcd', malicious: true },
  ],
  tags: ['powershell', 'c2-beacon', 'high-priority'],
  assignee: 'analyst@example.com',
  createdAt: '2026-05-06T11:00:00Z',
  updatedAt: '2026-05-06T11:30:00Z',
  confidenceLabel: 'high',
  // Canonical 0-100 scale, as `normalizeAlert` emits. This mock held `0.86`,
  // which is why the view's `* 100` looked correct in every test that used it.
  confidenceScore: 86,
  confidenceRationale: [
    {
      factor: 'severity',
      label: 'Critical severity from source',
      value: 1.0,
      contribution: 0.20,
      weight: 0.20,
    },
    {
      factor: 'mitre_coverage',
      label: '3 MITRE techniques mapped (T1059.001, T1027, T1071)',
      value: 1.0,
      contribution: 0.18,
      weight: 0.18,
    },
    {
      factor: 'threat_intel',
      label: 'IOC matched against known C2 infrastructure',
      value: 1.0,
      contribution: 0.20,
      weight: 0.20,
    },
    {
      factor: 'ml_score',
      label: 'Anomaly score 0.94 (UEBA baseline deviation)',
      value: 0.94,
      contribution: 0.14,
      weight: 0.15,
    },
    {
      factor: 'upstream_risk',
      label: 'Affected user is in elevated-risk cohort',
      value: 0.78,
      contribution: 0.08,
      weight: 0.10,
    },
    {
      factor: 'ioc_density',
      label: '3 distinct malicious IOCs in single event',
      value: 0.85,
      contribution: 0.06,
      weight: 0.07,
    },
  ],
  ledgerRunId: 'run-mock-c2-beacon-investigation',
};

// ─── Sections ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-container p-5 shadow-card">
      <h3 className="text-eyebrow font-semibold text-fg-muted uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-surface-divider last:border-b-0">
      <span className="text-caption text-fg-muted shrink-0">{label}</span>
      <span className="text-control text-fg-primary text-right break-words min-w-0">{value}</span>
    </div>
  );
}

function IOCBadge({ type, value, malicious }: { type: string; value: string; malicious?: boolean }) {
  return (
    <div className={clsx(
      'flex items-center gap-2 px-3 py-2 rounded-control text-control-sm font-mono border',
      malicious
        ? 'bg-pill-danger-bg border-tone-danger/25 text-tone-danger'
        : 'bg-surface-elevated border-surface-border text-fg-primary'
    )}>
      <span className={clsx(
        'px-1.5 py-0.5 rounded-pill text-eyebrow font-bold uppercase',
        malicious ? 'bg-surface-card text-tone-danger' : 'bg-surface-subtle text-fg-muted'
      )}>
        {type}
      </span>
      <span className="truncate max-w-xs">{value}</span>
      {malicious && <span className="ml-auto text-tone-danger shrink-0 text-eyebrow font-semibold uppercase tracking-wide">malicious</span>}
    </div>
  );
}

// ─── Detection Confidence ─────────────────────────────────────────────────────

function ConfidenceChip({ label, score }: { label: ConfidenceLabel; score?: number }) {
  const cfg = CONFIDENCE_CONFIG[label];
  // `score` is already the canonical 0-100 integer (see `normalizeAlert`).
  // This multiplied it by 100 and printed a real confidence of 21 as "2100%",
  // which the Investigation Rail was rendering correctly as "21/100" on the
  // same page. Rendered as `N/100` rather than a percentage because the value
  // is not a probability that the verdict is correct.
  const points = typeof score === 'number' ? Math.round(score) : null;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 text-caption font-medium rounded-pill whitespace-nowrap',
        cfg.badge,
      )}
      title={cfg.description}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-pill', cfg.dot)} />
      {cfg.label}
      {points !== null && (
        <span className="opacity-75 font-mono">{`· ${points}/100`}</span>
      )}
    </span>
  );
}

/** `+0.20` / `−0.30`, never `+-0.30`. Matches the narrative builder's glyphs. */
function signedContribution(contribution: number): string {
  const sign = contribution < 0 ? '\u2212' : '+';
  return `${sign}${Math.abs(contribution).toFixed(2)}`;
}

function ConfidenceFactorBar({ factor }: { factor: ConfidenceFactor }) {
  // A factor can push the score down as well as up. The magnitude drives the
  // bar width and the sign drives its colour, so a negative factor reads as
  // "this argued against the verdict" rather than as an empty bar: clamping
  // the signed ratio to [0, 1] rendered every negative factor at zero width.
  const magnitude = Math.min(1, Math.abs(factor.contribution) / Math.max(factor.weight, 0.001));
  const widthPct = Math.round(magnitude * 100);
  const negative = factor.contribution < 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        {/* [HIDDEN-UI THEME-7 use the approved 13px body scale]
            <span className="text-sm text-fg-primary">{factor.label}</span> */}
        <span className="text-body text-fg-primary">{factor.label}</span>
        <span className="text-xs font-mono text-fg-muted shrink-0">
          {`${signedContribution(factor.contribution)} / ${factor.weight.toFixed(2)}`}
        </span>
      </div>
      <div className="h-1.5 bg-surface-subtle rounded-pill overflow-hidden">
        <div
          className={clsx('h-full', negative ? 'bg-dot-danger' : 'bg-dot-success')}
          style={{ width: `${widthPct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="text-eyebrow text-fg-subtle uppercase tracking-wider mt-1 font-mono">
        {factor.factor}
      </div>
    </div>
  );
}

function ConfidenceExplainability({
  label,
  score,
  rationale,
  ledgerRunId,
}: {
  label: ConfidenceLabel;
  score?: number;
  rationale: ConfidenceFactor[];
  ledgerRunId?: string;
}) {
  const cfg = CONFIDENCE_CONFIG[label];
  const sortedRationale = [...rationale].sort((a, b) => b.contribution - a.contribution);

  return (
    <Section title="Detection Confidence">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className={clsx('w-2.5 h-2.5 rounded-full mt-1.5 shrink-0', cfg.dot)} />
          <div className="flex-1">
            <div className="flex items-baseline gap-3">
              {/* [HIDDEN-UI THEME-7 use the approved 13px body scale]
                  <span className="text-sm font-semibold text-fg-primary">{cfg.label}</span> */}
              <span className="text-body font-semibold text-fg-primary">{cfg.label}</span>
              {typeof score === 'number' && (
                <span className="text-xs font-mono text-fg-muted">
                  {`score ${Math.round(score)}/100`}
                </span>
              )}
            </div>
            <p className="text-xs text-fg-muted mt-0.5">{cfg.description}</p>
          </div>
        </div>

        {sortedRationale.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-surface-border">
            <p className="text-xs font-medium text-fg-secondary">
              Why this score
            </p>
            <div className="space-y-3">
              {sortedRationale.map((factor) => (
                <ConfidenceFactorBar key={factor.factor} factor={factor} />
              ))}
            </div>
          </div>
        )}

        {ledgerRunId && (
          <div className="pt-3 border-t border-surface-border">
            <LedgerEvidenceChain runId={ledgerRunId} />
          </div>
        )}
      </div>
    </Section>
  );
}

function LedgerEvidenceChain({ runId }: { runId: string }) {
  const { data, error, isLoading } = useSWR(
    ['ledger-events', runId],
    () => ledgerApi.listEvents(runId, { limit: 8 }),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-secondary">Investigation Ledger evidence chain</p>
        <Link
          href={`/investigations/${runId}`}
          className="text-xs text-accent hover:text-accent-hover"
        >
          Open full ledger →
        </Link>
      </div>

      {isLoading && (
        <p className="text-xs text-fg-subtle">Loading evidence chain…</p>
      )}

      {error && !data && (
        <p className="text-xs text-fg-muted">
          Evidence chain not yet available for this alert.
        </p>
      )}

      {data && data.items.length === 0 && (
        <p className="text-xs text-fg-muted">
          No ledger events recorded yet — start an investigation to populate the chain.
        </p>
      )}

      {data && data.items.length > 0 && (
        <ol className="space-y-2">
          {data.items.map((event) => (
            <li key={event.id} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0 pt-1">
                <span className="w-1.5 h-1.5 bg-dot-info rounded-full" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-eyebrow font-mono text-fg-subtle shrink-0">
                    #{event.seq}
                  </span>
                  <span className="text-xs font-mono text-accent shrink-0">
                    {event.kind}
                  </span>
                  <span className="text-xs text-fg-primary truncate">
                    {event.summary}
                  </span>
                </div>
                <div className="text-eyebrow text-fg-subtle mt-0.5" suppressHydrationWarning>
                  {event.agent} · {format(new Date(event.ts), 'HH:mm:ss')}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── AI Investigation Panel ───────────────────────────────────────────────────

function AIInvestigation({
  alertId,
  alertTitle,
  alertSeverity,
}: {
  alertId: string;
  alertTitle?: string;
  alertSeverity?: Alert['severity'];
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Investigations are owned by a case, not by a bare alert: the agent writes
  // its prompts, tool calls and rationale into that case's ledger, and the case
  // workspace is where they are rendered and replayed. So promote the alert to
  // a case, launch the real run, and hand the analyst to the surface that can
  // actually show it.
  //
  // This previously called `POST /api/v1/agents/investigate`, a route that
  // exists on no backend. The 404 was caught and the catch block rendered a
  // hardcoded "Advanced Persistent Threat - High Confidence" verdict naming a
  // specific IP, a specific C2 domain and three pending response actions, with
  // status 'completed' and no disclaimer. A security product must never invent
  // a finding about a customer's environment.
  const startInvestigation = async () => {
    setIsRunning(true);
    setError(null);
    try {
      // `alertIds` is the part that matters. The API reads it to load the
      // alerts' real `raw_event` payloads and sends those to the agent as
      // `raw_alert`; it used to forward only the string below, so the
      // forensic agent reasoned over a restated headline while auto-triage --
      // the same agent, the other entry point -- got the whole event.
      const createdCase = await casesApi.create({
        title: alertTitle ? `Investigation — ${alertTitle}` : `Investigation — alert ${alertId}`,
        description: alertTitle ? `Opened from alert: ${alertTitle}` : `Opened from alert ${alertId}`,
        alertIds: [alertId],
        // Omitting this let the server default to `medium`, so a critical
        // alert opened a medium case. The same mapping the promotion modal
        // uses, because cases have no `info` tier.
        severity: alertSeverity ? alertSeverityToCaseSeverity(alertSeverity) : undefined,
      });
      // A note about *why*, not a substitute for the evidence. The API
      // prepends this to what it assembled rather than using it instead.
      await casesApi.investigate(createdCase.id, 'Opened from the alert detail view by an analyst.');
      router.push(`/cases/${createdCase.id}?tab=ledger`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not start the investigation. Check that the agents service is reachable.',
      );
      setIsRunning(false);
    }
  };

  return (
    <div className="py-2">
      <p className="text-control font-medium text-fg-secondary mb-1">Agent investigation</p>
      <p className="text-xs text-fg-muted mb-4">
        Promotes this alert to a case and runs the agent against it. Every prompt, tool call and
        piece of cited evidence is written to that case&apos;s ledger, where the run can be replayed
        step by step. You&apos;ll be taken to the case when it starts.
      </p>

      {error && (
        <div className="mb-4 rounded-control border border-severity-critical-ink/30 bg-severity-critical-bg px-3 py-2 text-xs text-severity-critical-ink">
          {error}
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={startInvestigation}
        disabled={isRunning}
        loading={isRunning}
      >
        {isRunning ? 'Starting investigation...' : 'Start AI investigation'}
      </Button>
    </div>
  );
}

// ─── Analyst Override Panel — Tier 1.5 feedback loop ────────────────────────
//
// When the AI agent gets a verdict wrong, the analyst clicks the corrected
// verdict here. The override:
//   1. updates the alert's ``disposition`` server-side
//   2. is persisted to ``aisoc_institutional_memory`` so future investigations
//      of similar alerts pull this up
//   3. surfaces *retroactive candidates* — past alerts that share the same
//      coarse signature (category + connector + primary MITRE technique) and
//      would now flip disposition. The analyst can bulk-apply with one click.
//
// This is the single highest-leverage learning loop in the platform: every
// override = one teaching moment that re-grades the past *and* improves the
// future. Without this UI, the backend pipeline is invisible to the SOC.

const VERDICT_OPTIONS: Array<{
  value: AnalystVerdict;
  label: string;
  description: string;
  badge: string;
}> = [
  {
    value: 'true_positive',
    label: 'True Positive',
    description: 'Real threat — the AI got it right or under-called it',
    badge: 'bg-pill-danger-bg text-tone-danger',
  },
  {
    value: 'false_positive',
    label: 'False Positive',
    description: 'Not a threat — the AI over-called it',
    badge: 'bg-pill-success-bg text-tone-success',
  },
  {
    value: 'benign',
    label: 'Benign',
    description: 'Expected behaviour — suppress for the same signature in future',
    badge: 'bg-pill-info-bg text-tone-info',
  },
  {
    value: 'escalate',
    label: 'Escalate',
    description: 'Needs human follow-up beyond what the agent can do',
    badge: 'bg-pill-warning-bg text-tone-warning',
  },
];

const VERDICT_LABEL: Record<AnalystVerdict, string> = {
  true_positive: 'True Positive',
  false_positive: 'False Positive',
  benign: 'Benign',
  escalate: 'Escalate',
};

function AnalystOverridePanel({
  alert,
  onMutate,
}: {
  alert: Alert;
  onMutate: () => void;
}) {
  const currentDisposition = alert.disposition ?? null;
  const [verdict, setVerdict] = useState<AnalystVerdict | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [candidates, setCandidates] = useState<RedispositionCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [memoryKey, setMemoryKey] = useState<string | null>(null);

  const submit = async () => {
    if (!verdict) return;
    setSubmitting(true);
    try {
      const resp = await feedbackApi.submitOverride({
        alert_id: alert.id,
        // We record the AI's confidence band as the original_verdict — it's
        // the most honest summary of what the AI thought before the analyst
        // intervened. Falls back to "unverified" when the AI never produced
        // a labelled output.
        original_verdict:
          currentDisposition ??
          alert.confidenceLabel ??
          'unverified',
        corrected_verdict: verdict,
        reason: reason.trim() || undefined,
      });
      setCandidates(resp.redisposition_candidates);
      setMemoryKey(resp.memory_key);
      // Pre-select every candidate; the analyst opts *out* by unchecking.
      setSelectedIds(new Set(resp.redisposition_candidates.map((c) => c.alert_id)));
      toast.success(
        resp.redisposition_candidates.length > 0
          ? `Recorded — ${resp.redisposition_candidates.length} similar past alerts found`
          : 'Recorded — institutional memory updated',
      );
      onMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit override');
    } finally {
      setSubmitting(false);
    }
  };

  const applyAll = async () => {
    if (!verdict || selectedIds.size === 0) return;
    setApplying(true);
    try {
      const ids = Array.from(selectedIds);
      const token = await computeRedispositionToken(ids, verdict);
      const resp = await feedbackApi.applyRedisposition({
        alert_ids: ids,
        new_disposition: verdict,
        confirmation_token: token,
      });
      toast.success(
        `Re-dispositioned ${resp.updated} past alert${resp.updated === 1 ? '' : 's'}`,
      );
      // Drop applied candidates from the panel so we don't bulk-apply twice.
      setCandidates((prev) =>
        prev.filter((c) => !selectedIds.has(c.alert_id)),
      );
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply re-disposition');
    } finally {
      setApplying(false);
    }
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(candidates.map((c) => c.alert_id)));
  };
  const clearAll = () => setSelectedIds(new Set());

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-control-sm font-semibold text-fg-primary">
            Was the AI right?
          </p>
          <p className="text-caption text-fg-muted mt-0.5">
            Your correction is written to institutional memory and re-grades
            similar past alerts.
          </p>
        </div>
        {currentDisposition && (
          <span className="text-eyebrow uppercase tracking-wider text-fg-muted shrink-0">
            current ·{' '}
            <span className="text-fg-primary">
              {VERDICT_LABEL[currentDisposition as AnalystVerdict] ??
                currentDisposition}
            </span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {VERDICT_OPTIONS.map((opt) => {
          const active = verdict === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setVerdict(opt.value)}
              className={clsx(
                'text-left p-2.5 rounded-control border transition-colors',
                active
                  ? 'border-accent bg-nav-active-bg text-fg-primary'
                  : 'bg-surface-elevated border-surface-border text-fg-secondary hover:bg-surface-hover',
              )}
            >
              <div className="text-control-sm font-semibold">{opt.label}</div>
              <div className="text-eyebrow mt-0.5 leading-snug text-fg-muted">
                {opt.description}
              </div>
            </button>
          );
        })}
      </div>

      <div>
        <label className="text-caption text-fg-muted block mb-1">
          Reason (optional, surfaced in institutional memory)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. matches our weekly vuln-scanner sweep — known benign"
          rows={2}
          className="w-full bg-surface-elevated border border-surface-border rounded-control px-2.5 py-1.5 text-control-sm text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-none"
        />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={submit}
        disabled={!verdict || submitting}
        className="w-full"
      >
        {submitting ? 'Recording…' : 'Record correction'}
      </Button>

      {memoryKey && (
        <p className="text-eyebrow text-fg-muted font-mono break-all">
          memory key · {memoryKey}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-surface-border">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-tone-warning">
                {candidates.length} past alert
                {candidates.length === 1 ? '' : 's'} match this signature
              </p>
              <p className="text-eyebrow text-fg-muted mt-0.5">
                Apply &ldquo;{verdict ? VERDICT_LABEL[verdict] : ''}&rdquo; to
                everything still selected.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-eyebrow">
              <button
                type="button"
                onClick={selectAll}
                className="text-accent hover:text-accent-hover"
              >
                all
              </button>
              <span className="text-fg-subtle">·</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-fg-muted hover:text-fg-primary"
              >
                none
              </button>
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {candidates.map((c) => {
              const checked = selectedIds.has(c.alert_id);
              return (
                <label
                  key={c.alert_id}
                  className={clsx(
                    'flex items-start gap-2 p-2 rounded-control border cursor-pointer transition-colors',
                    checked
                      ? 'bg-nav-active-bg border-accent/40'
                      : 'bg-surface-subtle border-surface-border hover:bg-surface-elevated',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.alert_id)}
                    className="mt-0.5 accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-eyebrow uppercase tracking-wider text-fg-muted">
                        {c.severity}
                      </span>
                      <span className="text-eyebrow text-fg-subtle">·</span>
                      <span className="text-eyebrow text-fg-muted" suppressHydrationWarning>
                        {format(new Date(c.event_time), 'MMM d, HH:mm')}
                      </span>
                      {c.current_disposition && (
                        <>
                          <span className="text-eyebrow text-fg-subtle">·</span>
                          <span className="text-eyebrow text-fg-muted">
                            was{' '}
                            <span className="text-fg-secondary">
                              {VERDICT_LABEL[
                                c.current_disposition as AnalystVerdict
                              ] ?? c.current_disposition}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                    <Link
                      href={`/alerts/${c.alert_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-fg-primary hover:text-accent line-clamp-2 leading-snug block"
                    >
                      {c.title}
                    </Link>
                  </div>
                </label>
              );
            })}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={applyAll}
            disabled={selectedIds.size === 0 || applying}
            className="w-full"
          >
            {applying
              ? 'Applying…'
              : `Re-disposition ${selectedIds.size} alert${
                  selectedIds.size === 1 ? '' : 's'
                }`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AlertDetailView({ alertId }: { alertId: string }) {
  /* [HIDDEN-UI THEME-4 activeTab removed for single-scroll layout]
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'raw'>('overview');
  */
  const [status, setStatus] = useState<Alert['status']>('new');
  // Side drawer for the "Explain this alert" structured walkthrough
  // (`POST /api/v1/explain`). Kept local to the detail view because it
  // only makes sense while a single alert is on screen.
  const [explainOpen, setExplainOpen] = useState(false);
  // Alert→case promotion modal (issue #293). Opened from the header
  // "Create Case" affordance; lets the analyst spin up a new case or attach
  // the alert to an existing one before running a playbook.
  const [createCaseOpen, setCreateCaseOpen] = useState(false);

  const { data: alert, isLoading, mutate } = useSWR(
    ['alert', alertId],
    () => alertsApi.get(alertId),
    { fallbackData: demoFallback({ ...MOCK_ALERT, id: alertId, status }) }
  );

  const handleStatusChange = async (newStatus: Alert['status']) => {
    setStatus(newStatus);
    try {
      await alertsApi.update(alertId, { status: newStatus });
      mutate();
    } catch {
      // handled gracefully
    }
  };

  if (isLoading || !alert) {
    return (
      <div className="flex items-center justify-center h-64 text-fg-muted animate-pulse">
        Loading alert...
      </div>
    );
  }

  const sevCfg = SEVERITY_CONFIG[alert.severity];
  const stsCfg = STATUS_CONFIG[alert.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.new;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-caption text-fg-muted">
        <Link href="/alerts" className="hover:text-fg-primary transition-colors">Alerts</Link>
        <span>›</span>
        <span className="font-mono text-fg-secondary">{alert.id}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Badge row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-0.5 text-caption font-medium rounded-pill whitespace-nowrap', sevCfg.badge)}>
              <span aria-hidden="true" className={clsx('w-1.5 h-1.5 rounded-pill', sevCfg.dot)} />
              {sevCfg.label}
            </span>
            <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-0.5 text-caption font-medium rounded-pill whitespace-nowrap', stsCfg.badge)}>
              <span aria-hidden="true" className={clsx('w-1.5 h-1.5 rounded-pill', stsCfg.dot)} />
              {stsCfg.label}
            </span>
            {alert.confidenceLabel && (
              <ConfidenceChip
                label={alert.confidenceLabel}
                score={alert.confidenceScore}
              />
            )}
            {typeof alert.riskScore === 'number' && (
              <Badge tone="neutral" dot={false}>
                Risk <span className="font-mono font-bold text-fg-primary">{alert.riskScore}</span>
              </Badge>
            )}
          </div>
          <h1 className="text-page-title font-semibold text-fg-primary">{alert.title}</h1>
          <p className="text-body text-fg-muted mt-1" suppressHydrationWarning>
            {alert.source} · {format(new Date(alert.createdAt), 'MMM d, yyyy HH:mm:ss')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={alert.status}
            onChange={(e) => handleStatusChange(e.target.value as Alert['status'])}
            className="bg-surface-card border border-surface-border text-control text-fg-primary rounded-control px-3 py-1.5 focus:outline-none focus:border-accent"
          >
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setExplainOpen(true)}
            leadingIcon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z" />
                <line x1="9" y1="22" x2="15" y2="22" />
              </svg>
            }
          >
            Explain
          </Button>
          {/* [HIDDEN-UI NAV-6 hide Create Case button] */}
          {/* [TODO-BACKEND: Jira link / create issue] */}
        </div>
      </div>

      {/* [HIDDEN-UI THEME-4 converted overview/timeline/raw tabs to single scroll + 340px Details rail] */}
      <div className="grid grid-cols-1 lg:grid-cols-detail-grid gap-5 items-start">
        {/* Left main scroll column */}
        <div className="space-y-4 min-w-0">
          <ContextualActions
            page="alerts"
            entityId={alert.id}
            entity={{
              title: alert.title,
              description: alert.description,
              severity: alert.severity,
              status: alert.status,
              source: alert.source,
              source_ref: alert.sourceRef,
              risk_score: alert.riskScore,
              tags: alert.tags,
              mitre_attack: alert.mitreAttack,
              iocs: alert.iocs,
              created_at: alert.createdAt,
            }}
            eyebrow="Ask ClopsSOC about this alert"
          />

          <Section title="Description">
            <p className="text-body text-fg-secondary leading-relaxed">{alert.description}</p>
          </Section>

          {alert.confidenceLabel && (
            <ConfidenceExplainability
              label={alert.confidenceLabel}
              score={alert.confidenceScore}
              rationale={alert.confidenceRationale ?? []}
              ledgerRunId={alert.ledgerRunId}
            />
          )}

          {/* MITRE ATT&CK */}
          {alert.mitreAttack && alert.mitreAttack.length > 0 && (
            <Section title="MITRE ATT&CK">
              <div className="space-y-2">
                {alert.mitreAttack.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-pill-purple-bg border border-surface-border rounded-control">
                    <span className="text-caption font-mono text-tone-purple bg-surface-card px-2 py-1 rounded-control">{m.techniqueId}</span>
                    <div className="min-w-0">
                      <div className="text-body font-medium text-fg-primary">{m.technique}</div>
                      <div className="text-caption text-fg-muted">Tactic: {m.tactic}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* IOCs */}
          {alert.iocs && alert.iocs.length > 0 && (
            <Section title="Indicators of Compromise">
              <div className="space-y-2">
                {alert.iocs.map((ioc, i) => (
                  <IOCBadge key={i} {...ioc} />
                ))}
              </div>
            </Section>
          )}

          {/* Timeline (single scroll) */}
          <Section title="Event Timeline">
            <div className="space-y-4">
              {[
                { time: alert.createdAt, type: 'alert_created', title: 'Alert Created', desc: `Alert ingested from ${alert.source}` },
                { time: alert.updatedAt, type: 'status_change', title: 'Status Updated', desc: `Status changed to ${alert.status}` },
              ].map((event, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 bg-dot-info rounded-pill mt-1.5 shrink-0" />
                    {i < 1 && <div className="w-px flex-1 bg-surface-divider mt-1" />}
                  </div>
                  <div className="pb-4 min-w-0">
                    <div className="text-body font-medium text-fg-primary">{event.title}</div>
                    <div className="text-caption text-fg-muted mt-0.5">{event.desc}</div>
                    <div className="text-caption font-mono text-fg-subtle mt-1" suppressHydrationWarning>{format(new Date(event.time), 'MMM d, yyyy HH:mm:ss')}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Raw event (single scroll) */}
          <Section title="Raw Event Data">
            {alert.wazuhLocator && Object.keys(alert.wazuhLocator).length > 0 && (
              <div className="mb-3 rounded-control border border-surface-border bg-surface-elevated p-3 text-control-sm">
                <div className="mb-2 font-semibold text-fg-primary">
                  Find this event in the source console
                </div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
                  {Object.entries(alert.wazuhLocator)
                    .filter(([k]) => k !== 'full_log')
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-fg-muted">{k}</dt>
                        <dd className="break-all select-all text-fg-primary">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
                {typeof alert.wazuhLocator.full_log === 'string' && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-fg-muted">full_log</summary>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface-base p-2 text-fg-primary select-all">
                      {alert.wazuhLocator.full_log}
                    </pre>
                  </details>
                )}
              </div>
            )}
            <pre className="text-control-sm text-fg-secondary font-mono bg-surface-base border border-surface-border rounded-control p-4 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(alert.rawEvent || { message: 'Raw event data not available for this alert.' }, null, 2)}
            </pre>
          </Section>
        </div>

        {/* Right 340px Details rail */}
        <div className="space-y-4 min-w-0">
          <Section title="Details">
            <div>
              <Field label="Source" value={alert.source} />
              <Field label="Source Ref" value={alert.sourceRef || '—'} />
              <Field label="Tenant" value={alert.tenantId} />
              <Field label="Assignee" value={alert.assignee || <span className="text-fg-muted">Unassigned</span>} />
              <Field label="Created" value={<span className="font-mono" suppressHydrationWarning>{format(new Date(alert.createdAt), 'MMM d, yyyy HH:mm:ss')}</span>} />
              {alert.resolvedAt && (
                <Field label="Resolved" value={<span className="font-mono" suppressHydrationWarning>{format(new Date(alert.resolvedAt), 'MMM d, yyyy HH:mm:ss')}</span>} />
              )}
              {alert.tags && alert.tags.length > 0 && (
                <Field label="Tags" value={
                  <div className="flex flex-wrap justify-end gap-1">
                    {alert.tags.map((tag) => (
                      <Badge key={tag} tone="neutral">{tag}</Badge>
                    ))}
                  </div>
                } />
              )}
            </div>
          </Section>

          <Section title="AI Investigation">
            <AIInvestigation
              alertId={alertId}
              alertTitle={alert?.title}
              alertSeverity={alert?.severity}
            />
          </Section>

          <Section title="Verdict & feedback">
            <AnalystOverridePanel alert={alert} onMutate={mutate} />
          </Section>
        </div>
      </div>

      {/*
        Explain drawer is mounted at the root of the detail view so it
        can overlay tabs without unmounting on tab switch. It only fires
        a network call when `open` flips true (see useEffect inside).
      */}
      <ExplainDrawer
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        alert={alert}
        onRunPlaybook={(pid) => {
          toast.success(`Queued runbook ${pid}`);
          setExplainOpen(false);
        }}
      />

      <CreateCaseModal
        open={createCaseOpen}
        onClose={() => setCreateCaseOpen(false)}
        alert={alert}
      />
    </div>
  );
}
