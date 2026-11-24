'use client';

/**
 * Top-level Connectors page.
 *
 * Owns the SWR cache for `connectorsApi.list()` and renders three sub-views
 * depending on state:
 *
 *   - loading  → skeleton tiles
 *   - error    → `FailureBanner` with retry, over an explicitly-unknown list
 *   - data     → header stats + `ConnectorInstanceList` + add-connector modal
 *
 * `DEMO_CONNECTORS` is gated behind `demoFallback`, so it populates the hosted
 * demo and is `undefined` everywhere else. The error banner used to say
 * "showing demo instances so you can explore the interface" regardless — on a
 * self-hosted deployment that sentence described a list that was empty, above
 * four stat tiles reading a confident zero. Both now say the estate is
 * unknown, which is the only true statement available when the request failed.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import toast from 'react-hot-toast';

import {
  connectorsApi,
  type Connector,
  type ConnectorHealthSummary,
  type ConnectorTestResult,
} from '@/lib/api';
import { AddConnectorModal } from './AddConnectorModal';
import { EditConnectorModal } from './EditConnectorModal';
import { ConnectorDetailsDrawer, ConnectorInstanceList } from './ConnectorInstanceList';
import { InboxTokensPanel } from './InboxTokensPanel';
import { demoFallback } from '@/lib/demoFallback';
import { FailureBanner } from '@/components/ui/FailureBanner';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { describeApiFailure } from '@/lib/failure';

const DEMO_CONNECTORS: Connector[] = [
  {
    id: 'conn-001', name: 'CrowdStrike Falcon', type: 'crowdstrike',
    status: 'active', enabled: true,
    config: {}, alertCount: 4231, alertsIngested: 4231,
    lastSync: '2026-05-06T12:30:00Z',
    createdAt: '2026-03-15T10:00:00Z', updatedAt: '2026-05-06T12:30:00Z',
  },
  {
    id: 'conn-002', name: 'Microsoft Sentinel', type: 'microsoft_sentinel',
    status: 'active', enabled: true,
    config: {}, alertCount: 2847, alertsIngested: 2847,
    lastSync: '2026-05-06T12:28:00Z',
    createdAt: '2026-03-20T14:00:00Z', updatedAt: '2026-05-06T12:28:00Z',
  },
  {
    id: 'conn-003', name: 'Splunk Enterprise', type: 'splunk',
    status: 'active', enabled: true,
    config: {}, alertCount: 1893, alertsIngested: 1893,
    lastSync: '2026-05-06T12:25:00Z',
    createdAt: '2026-04-01T09:00:00Z', updatedAt: '2026-05-06T12:25:00Z',
  },
  {
    id: 'conn-004', name: 'AWS Security Hub', type: 'aws_security_hub',
    status: 'error', enabled: true,
    config: {}, alertCount: 567, alertsIngested: 567,
    lastSync: '2026-05-06T08:15:00Z',
    createdAt: '2026-04-10T11:00:00Z', updatedAt: '2026-05-06T08:15:00Z',
  },
  {
    id: 'conn-005', name: 'Okta SSO', type: 'okta',
    status: 'active', enabled: false,
    config: {}, alertCount: 0, alertsIngested: 0,
    createdAt: '2026-04-20T16:00:00Z', updatedAt: '2026-04-20T16:00:00Z',
  },
];

export function ConnectorsView() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Connector | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectorTestResult | undefined>>({});

  const { data, error, isLoading, mutate } = useSWR(
    'connectors',
    () => connectorsApi.list(),
    {
      revalidateOnFocus: false,
      fallbackData: demoFallback({ connectors: DEMO_CONNECTORS, total: DEMO_CONNECTORS.length }),
    },
  );

  // Health summary is a separate endpoint so the empty/error case is silent —
  // we just fall back to the locally-derived stats. SWR keys are namespaced so
  // the two queries don't fight over the cache.
  const { data: healthSummary } = useSWR<ConnectorHealthSummary | null>(
    'connectors:health',
    async () => {
      try {
        return await connectorsApi.health();
      } catch {
        return null;
      }
    },
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  const connectors: Connector[] = useMemo(() => data?.connectors ?? [], [data]);

  const localStats = useMemo(() => {
    const active = connectors.filter((c) => c.status === 'active').length;
    const errored = connectors.filter((c) => c.status === 'error').length;
    const drifted = connectors.filter((c) => Boolean(c.lastSchemaDriftAt)).length;
    const totalEvents = connectors.reduce(
      (sum, c) => sum + (c.alertCount ?? c.alertsIngested ?? 0),
      0,
    );
    const driftedRecently = connectors.filter((c) => {
      if (!c.lastSchemaDriftAt) return false;
      return Date.now() - new Date(c.lastSchemaDriftAt).getTime() < 24 * 60 * 60 * 1000;
    }).length;
    const totalDropped = connectors.reduce(
      (sum, c) => sum + (c.eventsDropped ?? 0),
      0,
    );
    return { active, errored, drifted, totalEvents, driftedRecently, totalDropped };
  }, [connectors]);

  // Prefer backend-aggregated stats when the API is reachable so the tile
  // matches the source of truth (the schema-drift sentinel runs server-side).
  const stats = useMemo(() => {
    if (healthSummary) {
      return {
        active: healthSummary.healthy,
        errored: healthSummary.unhealthy,
        drifted: healthSummary.drifted,
        totalEvents: healthSummary.totalEventsIngested,
        driftedRecently: healthSummary.driftedRecently,
        totalDropped: healthSummary.totalEventsDropped,
      };
    }
    return localStats;
  }, [healthSummary, localStats]);
  const freshnessStats = useMemo(() => {
    const late = connectors.filter(
      (connector) =>
        connector.freshness?.status === 'yellow' ||
        connector.freshness?.status === 'red',
    ).length;
    const unknown = connectors.filter(
      (connector) =>
        !connector.freshness || connector.freshness.status === 'unknown',
    ).length;
    return { late, unknown };
  }, [connectors]);

  // `localStats` is derived from a list that is `[]` whenever the request
  // failed, so with no health summary to fall back on every tile reads a
  // confident zero — "Total Connectors 0", "Errors 0" — on a tenant whose
  // connectors the console simply could not read. Zero connectors and unknown
  // connectors are opposite findings and both were rendered identically.
  const countsUnknown = !!error && !healthSummary;

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleTest = async (id: string) => {
    setDetailsId(id);
    setTestingId(id);
    setTestResults((prev) => ({ ...prev, [id]: undefined }));
    try {
      const result = await connectorsApi.test(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.success) {
        toast.success(result.message ?? 'Connection test passed');
      } else {
        toast.error(result.error ?? result.message ?? 'Connection test failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test request failed';
      setTestResults((prev) => ({ ...prev, [id]: { success: false, error: msg } }));
      toast.error(msg);
    } finally {
      setTestingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deletingId) return;
    const connector = deleteTarget;
    setDeletingId(connector.id);
    try {
      await connectorsApi.delete(connector.id);
      toast.success(`Removed ${connector.name}`);
      setDeleteTarget(null);
      if (detailsId === connector.id) setDetailsId(null);
      await mutate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete connector';
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfigure = (connector: Connector) => {
    setEditing(connector);
  };

  const handleCreated = () => {
    mutate();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-page-title font-semibold text-fg-primary">Connectors</h1>
          <p className="text-body text-fg-muted mt-0.5">
            Security tool integrations and data source management
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="bg-btn-grad hover:brightness-105 text-white text-control font-semibold px-4 py-2 rounded-control transition-all flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Connector
        </button>
      </div>

      <KpiStrip
        cols={5}
        items={[
          {
            label: 'Installed',
            value: countsUnknown ? '—' : healthSummary?.total ?? data?.total ?? connectors.length,
            sub: countsUnknown ? 'not measured' : undefined,
            tone: 'info',
          },
          {
            label: 'Healthy',
            value: countsUnknown ? '—' : stats.active,
            sub: countsUnknown ? 'not measured' : undefined,
            tone: 'ok',
          },
          {
            label: 'Late / Degraded',
            value: error ? '—' : freshnessStats.late,
            sub: error
              ? 'not measured'
              : freshnessStats.unknown > 0
                ? `${freshnessStats.unknown} unknown`
                : 'outside freshness SLO',
            tone: error ? 'default' : 'warn',
          },
          {
            label: 'Errors',
            value: countsUnknown ? '—' : stats.errored,
            sub: countsUnknown ? 'not measured' : undefined,
            tone: 'bad',
          },
          {
            label: 'Schema Drift',
            value: countsUnknown ? '—' : stats.drifted,
            sub: countsUnknown
              ? 'not measured'
              : healthSummary?.lastDriftAt
              ? `Most recent ${new Date(healthSummary.lastDriftAt).toLocaleDateString()}`
              : undefined,
            tone: 'purple',
          },
        ]}
      />

      {/* Body */}
      {error && (
        <FailureBanner
          title="Connectors unavailable"
          message={describeApiFailure(error, {
            subject: 'connector list',
            service: 'connectors service',
          })}
          onRetry={() => mutate()}
        />
      )}
      {(
        <ConnectorInstanceList
          connectors={connectors}
          failed={!!error}
          isLoading={isLoading && !data}
          testingId={testingId}
          onTest={handleTest}
          onAdd={() => setModalOpen(true)}
          onDetails={setDetailsId}
          onConfigure={handleConfigure}
          onDelete={setDeleteTarget}
        />
      )}

      {/* Universal capture (push) — collapsed by default. Sits below the
          poll-based connector list so the catalog stays the primary path
          and "push for everything else" is one click away. */}
      <InboxTokensPanel />

      {/* Add modal */}
      <AddConnectorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />

      <EditConnectorModal
        connector={editing}
        onClose={() => setEditing(null)}
        onSaved={() => mutate()}
      />

      <ConnectorDetailsDrawer
        connector={connectors.find((connector) => connector.id === detailsId) ?? null}
        testing={testingId === detailsId}
        testResult={detailsId ? testResults[detailsId] : undefined}
        onClose={() => setDetailsId(null)}
        onTest={handleTest}
      />

      <DeleteConnectorDialog
        connector={deleteTarget}
        deleting={deleteTarget !== null && deletingId === deleteTarget.id}
        onCancel={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function DeleteConnectorDialog({
  connector,
  deleting,
  onCancel,
  onConfirm,
}: {
  connector: Connector | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!connector || deleting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connector, deleting, onCancel]);

  if (!connector) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-connector-title"
        aria-describedby="delete-connector-description"
        className="w-full max-w-md rounded-container border border-surface-border bg-surface-card p-5 shadow-2xl"
      >
        <h2 id="delete-connector-title" className="text-section-title font-semibold text-fg-primary">
          Delete connector?
        </h2>
        <p id="delete-connector-description" className="mt-2 text-body text-fg-muted">
          Delete <span className="font-medium text-fg-primary">{connector.name}</span>? This stops polling and removes its credentials. Already-ingested alerts are preserved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-control border border-surface-border px-3 py-2 text-control-sm text-fg-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-control bg-pill-danger-bg px-3 py-2 text-control-sm font-medium text-tone-danger hover:brightness-110 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete connector'}
          </button>
        </div>
      </div>
    </div>
  );
}
