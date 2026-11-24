import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Connector } from '@/lib/api';
import { ConnectorDetailsDrawer, ConnectorInstanceList } from './ConnectorInstanceList';

const connector: Connector = {
  id: 'connector-1',
  name: 'Okta production',
  type: 'okta',
  status: 'active',
  alertCount: 123,
  lastSync: '2026-11-24T12:00:00Z',
  lastEventAt: '2026-11-24T12:01:00Z',
  freshness: {
    status: 'yellow',
    expected_cadence_seconds: 900,
    seconds_since_last_event: 1800,
    category: 'saas',
  },
  lastSchemaDriftAt: '2026-11-24T11:00:00Z',
  lastDriftDetails: {
    added: ['actor.department'],
    removed: ['user.display_name'],
  },
  schemaFingerprint: 'sha256:example',
};

describe('ConnectorInstanceList', () => {
  it('shows connector health in a table and routes row actions to the parent', () => {
    const onTest = vi.fn();
    const onDetails = vi.fn();
    const onConfigure = vi.fn();
    const onDelete = vi.fn();

    render(
      <ConnectorInstanceList
        connectors={[connector]}
        onTest={onTest}
        onDetails={onDetails}
        onAdd={vi.fn()}
        onConfigure={onConfigure}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole('table', { name: 'Installed connectors and their health' })).toBeInTheDocument();
    expect(screen.getByText('Late')).toBeInTheDocument();
    expect(screen.getByText('+1 / -1')).toBeInTheDocument();
    expect(screen.getByText('123 events')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Details for Okta production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure Okta production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Okta production' }));

    expect(onTest).toHaveBeenCalledWith(connector.id);
    expect(onDetails).toHaveBeenCalledWith(connector.id);
    expect(onConfigure).toHaveBeenCalledWith(connector);
    expect(onDelete).toHaveBeenCalledWith(connector);
  });
});

describe('ConnectorDetailsDrawer', () => {
  it('shows test errors and the recorded schema field changes', () => {
    render(
      <ConnectorDetailsDrawer
        connector={connector}
        testing={false}
        testResult={{ success: false, error: 'Invalid API token', latency_ms: 42 }}
        onClose={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid API token');
    expect(screen.getByText('Latency: 42 ms')).toBeInTheDocument();
    expect(screen.getByText('+ actor.department')).toBeInTheDocument();
    expect(screen.getByText('− user.display_name')).toBeInTheDocument();
    expect(screen.getByText(/Current schema fingerprint/)).toBeInTheDocument();
  });
});
