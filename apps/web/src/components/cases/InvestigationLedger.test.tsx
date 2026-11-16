import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const ledgerApi = vi.hoisted(() => ({
  listRuns: vi.fn(),
  replay: vi.fn(),
  getRun: vi.fn(),
  listArtifacts: vi.fn(),
  explain: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  __esModule: true,
  ledgerApi,
}));

vi.mock('@/components/cases/replay/ReplayControls', () => ({
  __esModule: true,
  ReplayControls: () => null,
}));

vi.mock('@/components/cases/replay/useReplayController', () => ({
  __esModule: true,
  useReplayController: () => ({ isPlaying: false }),
}));

import { InvestigationLedger } from './InvestigationLedger';

describe('InvestigationLedger UX-1 empty state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const fn of Object.values(ledgerApi)) fn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it('(d) renders started copy and elapsed-time counter from started_at while a run is live with 0 events', async () => {
    const fixedNow = new Date('2026-11-16T12:00:12Z');
    vi.setSystemTime(fixedNow);

    ledgerApi.listRuns.mockResolvedValue([
      {
        id: 'run-live-1',
        case_id: 'case-1',
        status: 'running',
        model_used: null,
        iterations: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        measured_call_count: 0,
        estimated_cost_usd: 0,
        estimated_call_count: 0,
        unpriced_call_count: 0,
        started_at: '2026-11-16T12:00:00Z',
        completed_at: null,
        error: null,
      },
    ]);
    ledgerApi.replay.mockResolvedValue([]);
    ledgerApi.getRun.mockResolvedValue({
      id: 'run-live-1',
      case_id: 'case-1',
      status: 'running',
      model_used: null,
      iterations: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      measured_call_count: 0,
      estimated_cost_usd: 0,
      estimated_call_count: 0,
      unpriced_call_count: 0,
      started_at: '2026-11-16T12:00:00Z',
      completed_at: null,
      error: null,
      alert_summary: '',
      event_count: 0,
      artifact_count: 0,
      model_costs: [],
    });

    await act(async () => {
      render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <InvestigationLedger caseId="case-1" activeRunId="run-live-1" />
        </SWRConfig>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      screen.getByText('Investigation started. Results appear when the first agent step finishes.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Elapsed: 12s')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the agent/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('Elapsed: 13s')).toBeInTheDocument();
  });
});
