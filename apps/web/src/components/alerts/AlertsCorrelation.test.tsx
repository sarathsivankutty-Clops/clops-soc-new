import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Alert } from '@/lib/api';

const listMock = vi.hoisted(() => vi.fn());
const getMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/alerts',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    alertsApi: {
      ...actual.alertsApi,
      list: listMock,
      get: getMock,
    },
    casesApi: {
      ...actual.casesApi,
      listExternalRefs: vi.fn().mockResolvedValue([]),
    },
    savedViewsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      remove: vi.fn(),
    },
  };
});

import { AlertsView } from './AlertsView';
import { InvestigationRail } from './InvestigationRail';
import { AlertDetailView } from './AlertDetailView';

const CORRELATED_ALERT: Alert = {
  id: 'a-main',
  title: 'IAM Policy Modified',
  description: 'Policy change',
  severity: 'high',
  status: 'investigating',
  source: 'aws_cloudtrail',
  tenantId: 't1',
  caseId: 'case-99',
  incidentId: 'inc-77',
  fusionDecision: 'correlate',
  correlatedCount: 2,
  correlationReasons: ['Incident inc-77', 'Shared entities: user:alice'],
  correlatedAlerts: [
    {
      id: 'sib-1',
      title: 'AssumeRole Anomaly',
      severity: 'medium',
      status: 'new',
      eventTime: '2026-11-17T09:50:00Z',
      sharedEntities: ['user:alice'],
    },
  ],
  eventTime: '2026-11-17T10:00:00Z',
  createdAt: '2026-11-17T10:01:00Z',
  updatedAt: '2026-11-17T10:01:00Z',
};

beforeEach(() => {
  listMock.mockResolvedValue({
    alerts: [CORRELATED_ALERT],
    total: 1,
    page: 1,
    pageSize: 25,
    facets: { bySeverity: { high: 1 }, byStatus: { investigating: 1 }, unresolved: 1 },
  });
  getMock.mockResolvedValue(CORRELATED_ALERT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PR2: correlation display across list, rail, and detail', () => {
  it('shows +N correlated badge and no row Case link in AlertsView', async () => {
    render(<AlertsView />);

    expect(await screen.findByText('IAM Policy Modified')).toBeInTheDocument();
    expect(screen.getByText('+2 correlated')).toBeInTheDocument();
    // [ALERTS-G2] The row Case link was removed; the case opens from the rail.
    expect(screen.queryByRole('link', { name: 'Case' })).not.toBeInTheDocument();
  });

  it('shows Why grouped, sibling link, and Open case in InvestigationRail', async () => {
    render(<InvestigationRail alertId="a-main" onClose={vi.fn()} />);

    expect(await screen.findByText(/Incident inc-77/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open case/i })).toHaveAttribute('href', '/cases/case-99');
    const sibLink = screen.getByRole('link', { name: /AssumeRole Anomaly/i });
    expect(sibLink).toHaveAttribute('href', '/alerts/sib-1');
  });

  it('shows Correlated alerts section, Why grouped, sibling link, and Open case in AlertDetailView', async () => {
    render(<AlertDetailView alertId="a-main" />);

    expect(await screen.findByText(/Correlated alerts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Shared entities: user:alice/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /AssumeRole Anomaly/i })).toHaveAttribute('href', '/alerts/sib-1');
    const caseLinks = screen.getAllByRole('link', { name: /Open case/i });
    expect(caseLinks[0]).toHaveAttribute('href', '/cases/case-99');
  });
});
