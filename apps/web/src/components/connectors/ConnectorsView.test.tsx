import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Connector, ConnectorHealthSummary, ConnectorsResponse } from '@/lib/api';

const swrState = vi.hoisted(() => ({
  listData: null as unknown,
  listError: undefined as unknown,
  healthData: null as unknown,
  mutate: vi.fn(),
}));
const api = vi.hoisted(() => ({
  test: vi.fn(),
  delete: vi.fn(),
}));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: string) =>
    key === 'connectors'
      ? {
          data: swrState.listData,
          error: swrState.listError,
          isLoading: false,
          mutate: swrState.mutate,
        }
      : { data: swrState.healthData },
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    connectorsApi: {
      ...actual.connectorsApi,
      test: api.test,
      delete: api.delete,
    },
  };
});
vi.mock('react-hot-toast', () => ({ __esModule: true, default: toastMock }));
vi.mock('./AddConnectorModal', () => ({ AddConnectorModal: () => null }));
vi.mock('./EditConnectorModal', () => ({ EditConnectorModal: () => null }));
vi.mock('./InboxTokensPanel', () => ({ InboxTokensPanel: () => null }));

import { ConnectorsView } from './ConnectorsView';

const connector: Connector = {
  id: 'connector-1',
  name: 'Okta production',
  type: 'okta',
  status: 'active',
  enabled: true,
  freshness: {
    status: 'yellow',
    expected_cadence_seconds: 900,
    seconds_since_last_event: 1800,
    category: 'saas',
  },
  lastSchemaDriftAt: '2026-11-24T11:00:00Z',
  lastDriftDetails: { added: ['new.field'] },
};

const response: ConnectorsResponse = { connectors: [connector], total: 1 };
const health: ConnectorHealthSummary = {
  total: 1,
  healthy: 1,
  unhealthy: 0,
  unknown: 0,
  drifted: 1,
  driftedRecently: 1,
  totalEventsIngested: 10,
  totalEventsDropped: 0,
};

beforeEach(() => {
  swrState.listData = response;
  swrState.listError = undefined;
  swrState.healthData = health;
  swrState.mutate.mockReset().mockResolvedValue(undefined);
  api.test.mockReset();
  api.delete.mockReset().mockResolvedValue(undefined);
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

afterEach(cleanup);

describe('ConnectorsView actions', () => {
  it('uses a themed confirmation dialog before deleting a connector', async () => {
    render(<ConnectorsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Okta production' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Already-ingested alerts are preserved.');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Okta production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete connector' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(connector.id));
    expect(swrState.mutate).toHaveBeenCalled();
  });

  it('opens the diagnostic drawer with the returned connection test error', async () => {
    api.test.mockResolvedValue({
      success: false,
      message: 'Connection failed',
      error: 'Invalid token',
    });
    render(<ConnectorsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(api.test).toHaveBeenCalledWith(connector.id));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid token');
    expect(screen.getByRole('dialog', { name: 'Connector details: Okta production' })).toBeInTheDocument();
  });
});
