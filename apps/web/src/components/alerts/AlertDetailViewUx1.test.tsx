import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Alert } from '@/lib/api';

const push = vi.hoisted(() => vi.fn());
const createCase = vi.hoisted(() => vi.fn());
const investigate = vi.hoisted(() => vi.fn());
const getAlert = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/alerts/alert-existing',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    alertsApi: { ...actual.alertsApi, get: getAlert },
    casesApi: {
      ...actual.casesApi,
      create: createCase,
      investigate,
      listExternalRefs: vi.fn().mockResolvedValue([]),
    },
  };
});

import { AlertDetailView } from './AlertDetailView';

describe('AlertDetailView UX-1 existing case guard', () => {
  beforeEach(() => {
    push.mockReset();
    createCase.mockReset();
    investigate.mockReset();
    getAlert.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('navigates to the existing case instead of creating another when alert.caseId is set', async () => {
    getAlert.mockResolvedValue({
      id: 'alert-existing',
      title: 'Existing linked alert',
      description: 'desc',
      severity: 'high',
      status: 'investigating',
      source: 'crowdstrike',
      tenantId: 't1',
      caseId: 'case-existing-123',
      createdAt: '2026-11-16T00:00:00Z',
      updatedAt: '2026-11-16T00:00:00Z',
    } as Alert);

    render(<AlertDetailView alertId="alert-existing" />);

    const btn = await screen.findByRole('button', { name: /view investigation/i });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/cases/case-existing-123?tab=ledger');
    });
    expect(createCase).not.toHaveBeenCalled();
    expect(investigate).not.toHaveBeenCalled();
  });
});
