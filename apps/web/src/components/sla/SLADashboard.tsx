'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { demoFallback } from '@/lib/demoFallback';
import { apiFetch, authedFetcher } from '@/lib/api';

interface SeverityMetrics {
  total: number;
  breaches: number;
  breach_rate: number;
  mttd_avg: number | null;
  mttr_avg: number | null;
  mttc_avg: number | null;
  mttd_target: number | null;
  mttr_target: number | null;
  mttc_target: number | null;
}

interface KpiBarPayload {
  targets: {
    false_positive_rate_max_pct: number;
    alert_to_incident_ratio_min: number;
    mitre_technique_tagging_min_pct: number;
    mitre_subtechnique_tagging_min_pct: number;
  };
  observed: {
    total_alerts: number;
    false_positives: number;
    false_positive_rate_pct: number;
    /** Alerts with a decided verdict — the rate's own denominator. */
    false_positive_rate_denominator?: number;
    distinct_cases: number;
    alert_to_incident_ratio: number;
    mitre_technique_tagging_pct: number;
    mitre_subtechnique_tagging_pct: number;
  };
  breaches: {
    false_positive_rate: boolean;
    alert_to_incident_ratio: boolean;
    mitre_technique_tagging: boolean;
    mitre_subtechnique_tagging: boolean;
  };
  breach_count: number;
}

interface SLAMetrics {
  period_days: number;
  computed_at: string;
  overall: {
    /** Alerts with at least one SLA lifecycle event — *not* the alert count. */
    total_alerts: number;
    /** Every alert in the window, whether or not it is SLA-measurable. */
    alerts_in_window?: number;
    /** False when nothing in the window is SLA-measurable. */
    measured?: boolean;
    total_breaches: number;
    breach_rate: number;
    mttd_avg: number | null;
    mttr_avg: number | null;
    mttc_avg: number | null;
  };
  per_severity: Record<string, SeverityMetrics>;
  kpi_bar: KpiBarPayload | null;
}

interface SLAConfig {
  id: string;
  severity: string;
  mttd_target: number;
  mttr_target: number;
  mttc_target: number;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-severity-critical-ink',
  high:     'text-severity-high-ink',
  medium:   'text-severity-medium-ink',
  low:      'text-severity-low-ink',
  info:     'text-severity-info-ink',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-surface-card border-surface-border',
  high:     'bg-surface-card border-surface-border',
  medium:   'bg-surface-card border-surface-border',
  low:      'bg-surface-card border-surface-border',
  info:     'bg-surface-card border-surface-border',
};

function fmtMinutes(min: number | null): string {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${Math.round(min * 10) / 10}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function StatusBadge({ value, target }: { value: number | null; target: number | null }) {
  if (value === null || target === null) {
    return <span className="text-fg-muted">—</span>;
  }
  const ok = value <= target;
  return (
    <span className={ok ? 'text-tone-success' : 'text-tone-danger'}>
      {fmtMinutes(value)}
      <span className="ml-1 text-xs text-fg-muted">/ {fmtMinutes(target)}</span>
    </span>
  );
}

function EditConfigModal({
  config,
  onClose,
  onSaved,
}: {
  config: SLAConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mttd, setMttd] = useState(config.mttd_target);
  const [mttr, setMttr] = useState(config.mttr_target);
  const [mttc, setMttc] = useState(config.mttc_target);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await apiFetch(`/api/v1/sla/config/${config.severity}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mttd_target: mttd, mttr_target: mttr, mttc_target: mttc }),
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-card border border-surface-border-strong rounded-container p-6 w-full max-w-sm space-y-4 shadow-overlay">
        <h3 className="text-fg-primary font-semibold text-card-title capitalize">{config.severity} SLA Targets</h3>
        {[
          { label: 'MTTD (min)', val: mttd, set: setMttd },
          { label: 'MTTR (min)', val: mttr, set: setMttr },
          { label: 'MTTC (min)', val: mttc, set: setMttc },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <label className="text-fg-muted text-xs block mb-1">{label}</label>
            <input
              type="number"
              min={1}
              value={val}
              onChange={(e) => set(Number(e.target.value))}
              className="w-full bg-surface-elevated border border-surface-border text-fg-primary rounded-control px-3 py-1.5 text-body focus:border-accent focus:outline-none"
            />
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-btn-grad hover:brightness-105 text-white rounded-control px-3 py-2 text-control font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-surface-border bg-surface-elevated hover:bg-surface-hover text-fg-primary rounded-control px-3 py-2 text-control"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type KpiBarTargets = KpiBarPayload['targets'];

function EditKpiBarModal({
  targets,
  onClose,
  onSaved,
}: {
  targets: KpiBarTargets;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fpMax, setFpMax] = useState(targets.false_positive_rate_max_pct);
  const [ratioMin, setRatioMin] = useState(targets.alert_to_incident_ratio_min);
  const [mitreMin, setMitreMin] = useState(targets.mitre_technique_tagging_min_pct);
  const [subMin, setSubMin] = useState(targets.mitre_subtechnique_tagging_min_pct);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/sla/kpi-targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          false_positive_rate_max_pct: fpMax,
          alert_to_incident_ratio_min: ratioMin,
          mitre_technique_tagging_min_pct: mitreMin,
          mitre_subtechnique_tagging_min_pct: subMin,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr((j as { detail?: string }).detail ?? `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-gray-700 bg-gray-900 p-6">
        <h3 className="text-lg font-semibold text-white">2026 KPI bar targets</h3>
        <p className="text-xs text-gray-500">
          Published defaults apply until you override. Metrics use the same look-back as SLA metrics.
        </p>
        {[
          {
            label: 'False positive rate (max %)',
            val: fpMax,
            set: setFpMax,
            min: 0,
            max: 100,
            step: 0.5,
          },
          {
            label: 'Alert-to-incident ratio (min)',
            val: ratioMin,
            set: setRatioMin,
            min: 1,
            max: 500,
            step: 1,
          },
          {
            label: 'MITRE technique tagging (min %)',
            val: mitreMin,
            set: setMitreMin,
            min: 0,
            max: 100,
            step: 1,
          },
          {
            label: 'MITRE sub-technique tagging (min %)',
            val: subMin,
            set: setSubMin,
            min: 0,
            max: 100,
            step: 1,
          },
        ].map(({ label, val, set, min, max, step }) => (
          <div key={label}>
            <label className="mb-1 block text-xs text-gray-400">{label}</label>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={val}
              onChange={(e) => set(Number(e.target.value))}
              className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white"
            />
          </div>
        ))}
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The four headline SLA cards.
 *
 * `alert_sla_events` has no writer in the pipeline -- only analyst actions
 * put a row in it -- so on a deployment where nobody has acknowledged or
 * dispositioned anything the table is empty. These cards rendered
 * **Total Alerts 0 / SLA Breaches 0 / Breach Rate 0%** for a tenant with
 * nine alerts, which reads as flawless compliance, directly above a panel
 * that correctly counted nine.
 *
 * Both counts are now shown and named for what they count, and when nothing
 * is measurable the breach figures say so instead of claiming zero.
 */
function SlaSummaryCards({
  overall,
  days,
}: {
  overall: SLAMetrics['overall'];
  days: number;
}) {
  // `=== false` rather than falsiness: an older API sends no flag, and
  // blanking the cards on an upgrade path would be worse than the defect.
  const unmeasured = overall.measured === false;
  const alertsInWindow = overall.alerts_in_window;

  const cards: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Alerts in window',
      value: String(alertsInWindow ?? overall.total_alerts),
      hint:
        alertsInWindow === undefined
          ? undefined
          : `${overall.total_alerts} with SLA lifecycle events`,
    },
    {
      label: 'SLA Breaches',
      value: unmeasured ? '—' : String(overall.total_breaches),
      hint: unmeasured ? `not measured · no SLA events in ${days} days` : undefined,
    },
    {
      label: 'Breach Rate',
      value: unmeasured ? '—' : `${overall.breach_rate}%`,
      hint: unmeasured ? 'nothing to compute a rate over' : undefined,
    },
    { label: 'Avg MTTR', value: fmtMinutes(overall.mttr_avg) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cards.map(({ label, value, hint }) => (
        <div
          key={label}
          className="bg-surface-card border border-surface-border rounded-container p-4"
        >
          <p className="text-fg-muted text-xs">{label}</p>
          <p
            className={
              value === '—'
                ? 'text-fg-subtle text-kpi font-semibold font-mono tabular-nums mt-1'
                : 'text-fg-primary text-kpi font-semibold font-mono tabular-nums mt-1'
            }
          >
            {value}
          </p>
          {hint && <p className="text-eyebrow text-fg-muted mt-1">{hint}</p>}
        </div>
      ))}
    </div>
  );
}

function KpiBarSection({
  kpi,
  days,
  onEditTargets,
}: {
  kpi: KpiBarPayload;
  days: number;
  onEditTargets: () => void;
}) {
  const { targets, observed, breaches, breach_count } = kpi;

  const rows: {
    key: string;
    label: string;
    observed: string;
    target: string;
    breach: boolean;
  }[] = [
    {
      key: 'fp',
      label: 'False positive rate',
      // The denominator is alerts with a *decided* verdict, not every alert
      // in the window. It read "(0 / 9)" while the rate divided by something
      // else entirely, which invited the reader to check the arithmetic and
      // conclude the page was fine.
      observed:
        (observed.false_positive_rate_denominator ?? 0) > 0
          ? `${observed.false_positive_rate_pct}% (${observed.false_positives} / ${observed.false_positive_rate_denominator} decided)`
          : `not measured · no decided verdicts in ${days} days`,
      target: `≤ ${targets.false_positive_rate_max_pct}%`,
      breach: breaches.false_positive_rate,
    },
    {
      key: 'ratio',
      label: 'Alert-to-incident ratio',
      observed:
        observed.distinct_cases > 0
          ? `${observed.alert_to_incident_ratio}:1`
          : `${observed.total_alerts} alerts, no linked cases`,
      target: `≥ ${targets.alert_to_incident_ratio_min}:1 when cases exist`,
      breach: breaches.alert_to_incident_ratio,
    },
    {
      key: 'mitre',
      // Not "coverage". This is the share of *alerts* carrying a technique
      // tag; it says nothing about how much of ATT&CK the tenant can detect,
      // and the target is written against tagging. The API field has always
      // been named `mitre_technique_tagging_pct`; the console renamed it on
      // the way to the screen and then graded it as a coverage breach.
      label: 'Alerts tagged with a technique',
      observed: `${observed.mitre_technique_tagging_pct}%`,
      target: `≥ ${targets.mitre_technique_tagging_min_pct}%`,
      breach: breaches.mitre_technique_tagging,
    },
    {
      key: 'sub',
      label: 'Alerts tagged with a sub-technique',
      observed: `${observed.mitre_subtechnique_tagging_pct}%`,
      target: `≥ ${targets.mitre_subtechnique_tagging_min_pct}%`,
      breach: breaches.mitre_subtechnique_tagging,
    },
  ];

  return (
    <div className="rounded-container border border-surface-border bg-surface-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-card-title font-semibold text-fg-primary">2026 KPI bar</h2>
          <p className="text-xs text-fg-muted">
            Operational quality vs tenant targets (last {days} days)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              breach_count > 0
                ? 'rounded-pill bg-pill-danger-bg px-3 py-1 text-xs font-medium text-tone-danger'
                : 'rounded-pill bg-pill-success-bg px-3 py-1 text-xs font-medium text-tone-success'
            }
          >
            {breach_count === 0 ? 'All KPIs met' : `${breach_count} breach${breach_count === 1 ? '' : 'es'}`}
          </span>
          <button
            type="button"
            onClick={onEditTargets}
            className="text-xs font-medium text-accent hover:text-accent-hover"
          >
            Edit targets
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-body">
          <thead>
            <tr className="border-b border-surface-border text-caption uppercase tracking-wider text-fg-muted">
              <th className="py-2 pr-4 font-medium">Metric</th>
              <th className="py-2 pr-4 font-medium">Observed</th>
              <th className="py-2 pr-4 font-medium">Target</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-surface-border last:border-0">
                <td className="py-2.5 pr-4 text-fg-secondary">{r.label}</td>
                <td className="py-2.5 pr-4 font-mono tabular-nums text-fg-primary">{r.observed}</td>
                <td className="py-2.5 pr-4 text-fg-muted">{r.target}</td>
                <td className="py-2.5">
                  {r.breach ? (
                    <span className="text-tone-danger font-medium">Breach</span>
                  ) : (
                    <span className="text-tone-success font-medium">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MOCK_SLA_METRICS: SLAMetrics = {
  period_days: 30,
  computed_at: '2026-05-06T12:00:00Z',
  overall: { total_alerts: 847, total_breaches: 23, breach_rate: 2.7, mttd_avg: 24.4, mttr_avg: 42.5, mttc_avg: 112.0 },
  per_severity: {
    critical: { total: 42, breaches: 3, breach_rate: 7.1, mttd_avg: 8.2, mttr_avg: 18.5, mttc_avg: 35.1, mttd_target: 15, mttr_target: 30, mttc_target: 60 },
    high: { total: 186, breaches: 8, breach_rate: 4.3, mttd_avg: 15.4, mttr_avg: 38.2, mttc_avg: 72.6, mttd_target: 30, mttr_target: 60, mttc_target: 120 },
    medium: { total: 312, breaches: 9, breach_rate: 2.9, mttd_avg: 28.7, mttr_avg: 65.3, mttc_avg: 124.8, mttd_target: 60, mttr_target: 120, mttc_target: 240 },
    low: { total: 307, breaches: 3, breach_rate: 1.0, mttd_avg: 45.2, mttr_avg: 98.6, mttc_avg: 215.4, mttd_target: 120, mttr_target: 240, mttc_target: 480 },
  },
  kpi_bar: null,
};

const MOCK_SLA_CONFIGS: SLAConfig[] = [
  { id: 'sla-1', severity: 'critical', mttd_target: 15, mttr_target: 30, mttc_target: 60 },
  { id: 'sla-2', severity: 'high', mttd_target: 30, mttr_target: 60, mttc_target: 120 },
  { id: 'sla-3', severity: 'medium', mttd_target: 60, mttr_target: 120, mttc_target: 240 },
  { id: 'sla-4', severity: 'low', mttd_target: 120, mttr_target: 240, mttc_target: 480 },
];

export function SLADashboard() {
  const [days, setDays] = useState(30);
  const [editConfig, setEditConfig] = useState<SLAConfig | null>(null);
  const [editKpiTargets, setEditKpiTargets] = useState<KpiBarTargets | null>(null);

  const { data: rawMetrics, error: metricsError, mutate: refetchMetrics } = useSWR<SLAMetrics>(
    `/api/v1/sla/metrics?days=${days}`,
    authedFetcher,
    {
      refreshInterval: 60_000,
      fallbackData: demoFallback(MOCK_SLA_METRICS),
      shouldRetryOnError: false,
      errorRetryCount: 0,
      revalidateOnFocus: false,
    }
  );

  const isValidMetrics =
    rawMetrics &&
    typeof rawMetrics.overall?.total_alerts === 'number' &&
    typeof rawMetrics.per_severity === 'object';
  // `fallbackData` above is already gated, and this is where that gate used
  // to be thrown away: `isValidMetrics ? rawMetrics : MOCK_SLA_METRICS`.
  // Outside the hosted demo `demoFallback` returns `undefined`, so the test
  // is falsy on first paint as much as on error — and 847 alerts, 23 breaches
  // and a 42.5m MTTR rendered in both, on every deployment, identically.
  const metrics = isValidMetrics ? rawMetrics : undefined;

  const { data: configs } = useSWR<SLAConfig[]>('/api/v1/sla/config', authedFetcher, {
    fallbackData: demoFallback(MOCK_SLA_CONFIGS),
    shouldRetryOnError: false,
    errorRetryCount: 0,
    revalidateOnFocus: false,
  });

  const configBySeverity = (configs ?? []).reduce<Record<string, SLAConfig>>(
    (acc, c) => ({ ...acc, [c.severity]: c }),
    {}
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title font-bold text-fg-primary">SLA Tracking</h1>
          <p className="text-fg-muted text-body mt-1">
            MTTD / MTTR / MTTC metrics vs configured targets
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Reporting period"
          className="bg-surface-card border border-surface-border text-fg-primary text-control rounded-control px-3 py-1.5 focus:border-accent focus:outline-none"
        >
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>

      {!metrics && (
        <div
          role="alert"
          className="rounded-container border border-surface-border bg-surface-card px-4 py-3 text-body text-fg-secondary"
        >
          <h2 className="font-medium text-fg-primary">
            {metricsError ? 'SLA metrics unavailable' : 'SLA metrics not measured yet'}
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            {metricsError
              ? 'The SLA service did not answer, so there is nothing to report for this period.'
              : 'Waiting for the SLA service. Figures appear once it answers.'}
          </p>
          {metricsError != null && (
            <>
              <pre className="mt-2 overflow-x-auto rounded-control bg-surface-subtle px-2 py-1 font-mono text-xs text-fg-muted">
                {metricsError instanceof Error ? metricsError.message : String(metricsError)}
              </pre>
              <button
                onClick={() => void refetchMetrics()}
                className="mt-3 rounded-control border border-surface-border bg-surface-elevated px-3 py-1 text-xs text-fg-primary hover:bg-surface-hover"
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {/* Overall summary cards */}
      {metrics && (
        <SlaSummaryCards overall={metrics.overall} days={days} />
      )}

      {metrics?.kpi_bar && (
        <KpiBarSection
          kpi={metrics.kpi_bar}
          days={days}
          onEditTargets={() => setEditKpiTargets(metrics.kpi_bar!.targets)}
        />
      )}

      {/* Per-severity breakdown */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SEVERITIES.map((sev) => {
            const s = metrics.per_severity[sev];
            const cfg = configBySeverity[sev];
            if (!s) return null;
            return (
              <div
                key={sev}
                className={`border rounded-container p-5 ${SEVERITY_BG[sev]}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2
                    className={`font-semibold text-card-title capitalize ${SEVERITY_COLORS[sev]}`}
                  >
                    {sev}
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-fg-muted text-xs">
                      {s.total} alerts · {s.breaches} breaches ({s.breach_rate}%)
                    </span>
                    {cfg && (
                      <button
                        onClick={() => setEditConfig(cfg)}
                        className="text-xs font-medium text-accent hover:text-accent-hover"
                      >
                        Edit targets
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-body">
                  {[
                    { metric: 'MTTD', avg: s.mttd_avg, target: s.mttd_target },
                    { metric: 'MTTR', avg: s.mttr_avg, target: s.mttr_target },
                    { metric: 'MTTC', avg: s.mttc_avg, target: s.mttc_target },
                  ].map(({ metric, avg, target }) => (
                    <div key={metric}>
                      <p className="text-fg-muted text-xs mb-1">{metric}</p>
                      <StatusBadge value={avg} target={target} />
                    </div>
                  ))}
                </div>
                {/* Breach indicator bar */}
                <div className="mt-4">
                  <div className="h-1.5 w-full bg-surface-subtle rounded-pill overflow-hidden">
                    <div
                      className={`h-full rounded-pill transition-all ${
                        s.breach_rate > 50
                          ? 'bg-dot-danger'
                          : s.breach_rate > 20
                          ? 'bg-dot-warning'
                          : 'bg-dot-success'
                      }`}
                      style={{ width: `${Math.min(s.breach_rate, 100)}%` }}
                    />
                  </div>
                  <p className="text-fg-muted text-xs mt-1">
                    {s.breach_rate}% breach rate
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editConfig && (
        <EditConfigModal
          config={editConfig}
          onClose={() => setEditConfig(null)}
          onSaved={() => {
            mutate('/api/v1/sla/config');
            mutate(`/api/v1/sla/metrics?days=${days}`);
          }}
        />
      )}

      {editKpiTargets && (
        <EditKpiBarModal
          targets={editKpiTargets}
          onClose={() => setEditKpiTargets(null)}
          onSaved={() => {
            mutate('/api/v1/sla/kpi-targets');
            mutate(`/api/v1/sla/metrics?days=${days}`);
          }}
        />
      )}
    </div>
  );
}
