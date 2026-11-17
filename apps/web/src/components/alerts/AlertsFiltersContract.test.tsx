import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const swrKeys = vi.hoisted(() => [] as unknown[]);
const swrData = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('swr', () => ({
  __esModule: true,
  useSWRConfig: () => ({ mutate: vi.fn() }),
  default: (key: unknown) => {
    swrKeys.push(key);
    const isAlertList = Array.isArray(key) && key[0] === 'alerts';
    return {
      data: isAlertList ? swrData.value : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    };
  },
}));

vi.mock('@/components/alerts/EntityRiskQueue', () => ({
  EntityRiskQueue: () => <div data-testid="entity-queue" />,
}));

import { AlertsView } from './AlertsView';
import { ALERT_STATUS_LIST } from '@/lib/alertStatus';

function latestFilters(): Record<string, unknown> | undefined {
  const keys = swrKeys.filter((k) => Array.isArray(k) && k[0] === 'alerts') as unknown[][];
  return keys.at(-1)?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  swrKeys.length = 0;
  swrData.value = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PR1a: AlertsView ordering, filters, and status coverage', () => {
  it('renders all 12 backend statuses grouped into Open / In progress / Closed', () => {
    render(<AlertsView />);
    const select = screen.getByLabelText('Filter by status');
    const optgroups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(optgroups).toEqual(['Open', 'In progress', 'Closed']);

    const optionValues = Array.from(select.querySelectorAll('option'))
      .map((o) => o.value)
      .filter(Boolean);
    expect(optionValues).toEqual(ALERT_STATUS_LIST.map((s) => s.value));
    expect(optionValues).toHaveLength(12);
  });

  it('preserves active sort when clicking Clear filters', async () => {
    swrData.value = { alerts: [], total: 0, page: 1, pageSize: 25 };
    render(<AlertsView />);

    await userEvent.click(screen.getByRole('button', { name: 'Critical' }));
    expect(latestFilters()?.severity).toBe('critical');
    expect(latestFilters()?.sort).toBe('priority');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(latestFilters()?.severity).toBeUndefined();
    expect(latestFilters()?.sort).toBe('priority');
  });

  it('switches sort mode and updates explanation label', async () => {
    render(<AlertsView />);
    expect(screen.getByTestId('alerts-sort-explanation')).toHaveTextContent(/Priority/i);

    const sortSelect = screen.getByLabelText('Sort alerts');
    await userEvent.selectOptions(sortSelect, 'newest');
    expect(latestFilters()?.sort).toBe('newest');
    expect(screen.getByTestId('alerts-sort-explanation')).toHaveTextContent(/Newest/i);

    await userEvent.selectOptions(sortSelect, 'oldest');
    expect(latestFilters()?.sort).toBe('oldest');
    expect(screen.getByTestId('alerts-sort-explanation')).toHaveTextContent(/Oldest/i);
  });

  it('applies and clears in-page time window via eventSince', async () => {
    render(<AlertsView />);
    const winSelect = screen.getByLabelText('Time window');
    await userEvent.selectOptions(winSelect, '24h');
    expect(typeof latestFilters()?.eventSince).toBe('string');

    await userEvent.selectOptions(winSelect, 'all');
    expect(latestFilters()?.eventSince).toBeUndefined();
  });

  it('renders actor subtitle and distinguishes event_time vs created_at fallback', () => {
    swrData.value = {
      alerts: [
        {
          id: 'a1',
          title: 'AttachUserPolicy',
          description: '',
          severity: 'high',
          status: 'triaging',
          source: 'aws_cloudtrail',
          tenantId: 't1',
          eventTime: '2026-11-17T05:00:00Z',
          createdAt: '2026-11-17T06:00:00Z',
          updatedAt: '2026-11-17T06:00:00Z',
          affectedUsers: ['Deepthi_KU'],
        },
        {
          id: 'a2',
          title: 'LegacyAlert',
          description: '',
          severity: 'medium',
          status: 'escalated',
          source: 'splunk',
          tenantId: 't1',
          createdAt: '2026-11-17T04:00:00Z',
          updatedAt: '2026-11-17T04:00:00Z',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    };

    render(<AlertsView />);
    expect(screen.getByText('user:Deepthi_KU')).toBeInTheDocument();
    expect(screen.getByText('ingest')).toBeInTheDocument();
    const row1 = screen.getByText('AttachUserPolicy').closest('a')!;
    expect(within(row1).getByText('Triaging')).toBeInTheDocument();
  });
});
