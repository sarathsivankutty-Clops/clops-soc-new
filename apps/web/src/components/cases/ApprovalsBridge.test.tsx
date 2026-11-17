import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Alert } from '@/lib/api';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=investigation'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/cases/c1',
}));

vi.mock('@/hooks/useUrlTab', () => ({
  useUrlTab: () => useState('investigation'),
}));

vi.mock('@/components/copilot/ContextualActions', () => ({
  ContextualActions: () => <div data-testid="contextual-actions" />,
}));
vi.mock('./WarRoomPanel', () => ({
  WarRoomPanel: () => <div data-testid="war-room" />,
}));
vi.mock('./InvestigationLedger', () => ({
  InvestigationLedger: () => <div data-testid="investigation-ledger" />,
}));

import { CaseWorkspace } from './CaseWorkspace';
import { AttackStory } from '@/components/alerts/AttackStory';

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/approvals') && init?.method === 'POST') {
      return okJson({
        id: 'ap-1',
        case_id: 'c1',
        title: 'Isolate host web-01',
        summary: 'Stop lateral movement',
        risk_level: 'high',
        status: 'pending',
        action: { action: 'Isolate host web-01' },
      });
    }
    if (url.includes('/api/v1/approvals')) {
      return okJson({ items: [], total: 0, page: 1, page_size: 25, pages: 0 });
    }
    if (url.endsWith('/investigations/r1/report.md')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/markdown' }),
        text: async () => '# Report',
      } as Response);
    }
    if (url.endsWith('/investigations/r1')) {
      return okJson({
        run_id: 'r1',
        case_id: 'c1',
        status: 'completed',
        responder: {
          summary: 'Response',
          risk_level: 'high',
          dry_run: true,
          recommended_actions: [
            { priority: 1, action: 'Isolate host web-01', rationale: 'Stop lateral movement', risk: 'high' },
          ],
        },
      });
    }
    if (url.endsWith('/investigations')) return okJson({ runs: [{ run_id: 'r1', status: 'completed' }] });
    if (url.endsWith('/external-refs')) return okJson([]);
    if (url.endsWith('/timeline')) return okJson({ events: [] });
    return okJson({
      id: 'c1',
      title: 'Case 1',
      description: 'Desc',
      severity: 'high',
      status: 'investigating',
      alert_ids: ['a1'],
      created_at: '2026-11-17T00:00:00Z',
      updated_at: '2026-11-17T00:00:00Z',
    });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PR4: remediation approval bridge', () => {
  it('posts to /api/v1/approvals when clicking Request Approval in CaseWorkspace', async () => {
    render(<CaseWorkspace caseId="c1" />);

    const btn = await screen.findByRole('button', { name: 'Request Approval' });
    await userEvent.click(btn);

    expect(await screen.findByText('Approval: pending')).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(
      ([u, i]) => String(u).includes('/api/v1/approvals') && (i as RequestInit)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
  });

  it('submits staged AttackStory actions to /api/v1/approvals', async () => {
    const alert = {
      id: 'a1',
      title: 'Alert 1',
      description: '',
      severity: 'high',
      status: 'new',
      source: 'wazuh',
      tenantId: 't1',
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
      recommendedActions: [
        { priority: 'high', action: 'Block IP 1.2.3.4', rationale: 'C2 traffic', risk: 'high' },
      ],
    } as Alert;

    render(<AttackStory alert={alert} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Request approval (1)' }));

    expect(await screen.findByText(/Submitted 1 approval request/)).toBeInTheDocument();
  });
});
