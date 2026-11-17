import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/alerts',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    alertsApi: {
      ...actual.alertsApi,
      list: listMock,
    },
    savedViewsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      remove: vi.fn(),
    },
  };
});

import { AlertsView } from './AlertsView';

beforeEach(() => {
  listMock.mockResolvedValue({
    alerts: [
      {
        id: 'a1',
        title: 'S3 PutBucketPolicy',
        description: '',
        severity: 'high',
        status: 'new',
        source: 'aws_cloudtrail',
        tenantId: 't1',
        occurrenceCount: 12,
        eventTime: '2026-11-17T10:00:00Z',
        createdAt: '2026-11-17T10:01:00Z',
        updatedAt: '2026-11-17T10:01:00Z',
      },
      {
        id: 'a2',
        title: 'Single Event Alert',
        description: '',
        severity: 'low',
        status: 'new',
        source: 'wazuh',
        tenantId: 't1',
        occurrenceCount: 1,
        eventTime: '2026-11-17T09:00:00Z',
        createdAt: '2026-11-17T09:01:00Z',
        updatedAt: '2026-11-17T09:01:00Z',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 25,
    facets: { bySeverity: { high: 1, low: 1 }, byStatus: { new: 2 }, unresolved: 2 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PR1b: search, connector_type source filter, and repeat count badge', () => {
  it('renders xN badge only when occurrenceCount > 1 and sends connector_type & search', async () => {
    render(<AlertsView />);

    expect(await screen.findByText('S3 PutBucketPolicy')).toBeInTheDocument();
    expect(screen.getByText('×12')).toBeInTheDocument();
    expect(screen.queryByText('×1')).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Filter by source'), 'aws_cloudtrail');
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectorType: 'aws_cloudtrail', page: 1 }),
    );

    const searchInput = screen.getByLabelText('Search alerts');
    await userEvent.type(searchInput, 'bucket');
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'bucket', page: 1 }),
    );
  });
});
