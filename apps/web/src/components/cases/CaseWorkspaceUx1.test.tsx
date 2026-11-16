import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Case } from '@/lib/api';
import { __setDemoModeForTests } from '@/lib/demoMode';
import { NavigationTestProvider } from '@/test/NavigationTestProvider';

const CASE_ID = 'case-ux1-001';

const mockCase: Case = {
  id: CASE_ID,
  title: 'Suspected credential dumping',
  description: 'Suspicious lsass access detected.',
  status: 'investigating',
  severity: 'high',
  alertIds: ['alert-1'],
  alertCount: 1,
  tags: [],
  mitre: [],
  createdBy: 'system',
  createdAt: '2026-11-16T10:00:00Z',
  updatedAt: '2026-11-16T10:05:00Z',
  timeline: [],
  tasks: [],
};

const apiFetch = vi.hoisted(() => vi.fn());
const casesApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  investigate: vi.fn(),
  getInvestigation: vi.fn(),
  addComment: vi.fn(),
  addTask: vi.fn(),
  updateTask: vi.fn(),
  openAutoSummaryHtml: vi.fn(),
  downloadReportPdf: vi.fn(),
  getAttackChain: vi.fn(),
  getTimeline: vi.fn(),
  reopen: vi.fn(),
  listExternalRefs: vi.fn(),
  pushToItsm: vi.fn(),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: unknown) => {
    if (Array.isArray(key) && key[0] === 'case') {
      return {
        data: mockCase,
        error: undefined,
        isLoading: false,
        mutate: vi.fn(async () => undefined),
      };
    }
    if (Array.isArray(key) && key[0] === 'war-rooms') {
      return {
        data: [],
        error: undefined,
        isLoading: false,
        mutate: vi.fn(async () => undefined),
      };
    }
    if (typeof key === 'string' && key.startsWith('case-external-refs:')) {
      return {
        data: [],
        error: undefined,
        isLoading: false,
        mutate: vi.fn(async () => undefined),
      };
    }
    return {
      data: null,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(async () => undefined),
    };
  },
}));

vi.mock('@/lib/api', () => ({
  __esModule: true,
  apiFetch,
  casesApi,
  graphApi: { getCaseAttackPath: vi.fn() },
  realtimeApi: { ticket: vi.fn().mockRejectedValue(new Error('no ticket')) },
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => `/cases/${CASE_ID}`,
  };
});

vi.mock('react-hot-toast', () => {
  const fn = vi.fn();
  return {
    __esModule: true,
    default: Object.assign(fn, {
      success: vi.fn(),
      error: vi.fn(),
      loading: vi.fn(),
    }),
    toast: Object.assign(fn, {
      success: vi.fn(),
      error: vi.fn(),
      loading: vi.fn(),
    }),
    Toaster: () => null,
  };
});

vi.mock('./InvestigationLedger', () => ({
  __esModule: true,
  InvestigationLedger: () => <div data-testid="investigation-ledger" />,
}));

vi.mock('@/components/copilot/ContextualActions', () => ({
  __esModule: true,
  ContextualActions: () => null,
}));

vi.mock('./WarRoomPanel', () => ({
  __esModule: true,
  WarRoomPanel: () => null,
}));

import { CaseWorkspace } from './CaseWorkspace';

function renderWorkspace() {
  return render(<CaseWorkspace caseId={CASE_ID} />, { wrapper: NavigationTestProvider });
}

describe('CaseWorkspace UX-1 investigation workflow', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/cases/${CASE_ID}`);
    __setDemoModeForTests(false);
    apiFetch.mockReset();
    for (const fn of Object.values(casesApi)) fn.mockReset();
    casesApi.getTimeline.mockResolvedValue({ events: [] });
    casesApi.getAttackChain.mockResolvedValue({ nodes: [], edges: [] });
    casesApi.listExternalRefs.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    __setDemoModeForTests(null);
  });

  it('(a) resumes polling and disables the investigate button when a running run exists on mount', async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation(async (path: string) => {
      if (path === `/api/v1/cases/${CASE_ID}/investigations`) {
        return {
          ok: true,
          json: async () => ({ runs: [{ run_id: 'run-active-1', status: 'running' }] }),
        } as Response;
      }
      return { ok: false, text: async () => '' } as Response;
    });
    casesApi.getInvestigation.mockResolvedValue({
      run_id: 'run-active-1',
      case_id: CASE_ID,
      status: 'running',
    });

    await act(async () => {
      renderWorkspace();
      await Promise.resolve();
      await Promise.resolve();
    });

    const btn = screen.getByRole('button', { name: /investigation in progress/i });
    expect(btn).toBeDisabled();
    expect(casesApi.investigate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(casesApi.getInvestigation).toHaveBeenCalledWith(CASE_ID, 'run-active-1');
  });

  it('(b) shows "Run again" and requires confirmation before starting a new run when a completed run exists', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === `/api/v1/cases/${CASE_ID}/investigations`) {
        return {
          ok: true,
          json: async () => ({ runs: [{ run_id: 'run-done-1', status: 'completed' }] }),
        } as Response;
      }
      if (path === `/api/v1/cases/${CASE_ID}/investigations/run-done-1/report.md`) {
        return { ok: true, text: async () => '# Report' } as Response;
      }
      return { ok: false, text: async () => '' } as Response;
    });
    casesApi.getInvestigation.mockResolvedValue({
      run_id: 'run-done-1',
      case_id: CASE_ID,
      status: 'completed',
    });
    casesApi.investigate.mockResolvedValue({
      run_id: 'run-new-2',
      case_id: CASE_ID,
      status: 'running',
      message: 'started',
    });

    renderWorkspace();

    const rerunBtn = await screen.findByRole('button', { name: /^run again$/i });
    expect(casesApi.investigate).not.toHaveBeenCalled();

    fireEvent.click(rerunBtn);
    expect(screen.getByText('This starts a new run.')).toBeInTheDocument();
    expect(casesApi.investigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText('This starts a new run.')).not.toBeInTheDocument();
    expect(casesApi.investigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^run again$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => {
      expect(casesApi.investigate).toHaveBeenCalledWith(
        CASE_ID,
        'Suspicious lsass access detected.',
      );
    });
  });

  it('(b2) shows "Run again" when a failed run exists', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === `/api/v1/cases/${CASE_ID}/investigations`) {
        return {
          ok: true,
          json: async () => ({ runs: [{ run_id: 'run-fail-1', status: 'failed' }] }),
        } as Response;
      }
      return { ok: false, text: async () => '' } as Response;
    });
    casesApi.getInvestigation.mockResolvedValue({
      run_id: 'run-fail-1',
      case_id: CASE_ID,
      status: 'failed',
      error: 'Model timeout',
    });

    renderWorkspace();

    expect(await screen.findByRole('button', { name: /^run again$/i })).toBeInTheDocument();
  });

  it('(c) renders the normal enabled "Investigate with agent" button and breadcrumb Link to /alerts when no runs exist', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    } as Response);

    renderWorkspace();

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(`/api/v1/cases/${CASE_ID}/investigations`);
    });

    const btn = screen.getByRole('button', { name: /investigate with agent/i });
    expect(btn).toBeEnabled();

    const casesCrumb = screen.getByRole('link', { name: /^cases$/i });
    expect(casesCrumb).toHaveAttribute('href', '/alerts');
    expect(screen.getByText(CASE_ID).tagName).not.toBe('A');

    await userEvent.click(btn);
    expect(casesApi.investigate).toHaveBeenCalledWith(CASE_ID, 'Suspicious lsass access detected.');
  });
});
