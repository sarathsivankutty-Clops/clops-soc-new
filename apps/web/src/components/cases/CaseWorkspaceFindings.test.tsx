import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

const CASE_PAYLOAD = {
  id: 'c1',
  title: 'PutBucketPolicy Investigation',
  description: 'Opened from alert',
  severity: 'medium',
  status: 'investigating',
  alert_ids: ['a1'],
  created_at: '2026-11-16T13:00:00Z',
  updated_at: '2026-11-16T13:00:00Z',
};

const INV_DETAIL = {
  run_id: 'r1',
  case_id: 'c1',
  status: 'completed',
  recon: {
    summary: 'Recon summary text',
    iocs: [
      { type: 'ip', value: '1.1.1.1' },
      { type: 'ip', value: '2.2.2.2' },
      { type: 'ip', value: '3.3.3.3' },
      { type: 'ip', value: '4.4.4.4' },
      { type: 'ip', value: '5.5.5.5' },
      { type: 'domain', value: 's3.amazonaws.com' },
    ],
    mitre_techniques: ['T1530'],
    threat_actors: ['Unknown'],
    related_incidents: ['INC-9'],
    attack_surface: { affected_systems: ['S3 bucket'], data_at_risk: 'Bucket objects' },
  },
  forensic: {
    summary: 'Forensic summary',
    root_cause_hypothesis: 'Public policy applied',
    blast_radius: 'Single S3 bucket',
    confidence: 0.4,
    groundedness: null,
    artefacts: ['s3.amazonaws.com'],
    timeline: [{ ts: '2026-11-16T11:56:41Z', event: 'PutBucketPolicy', src: 'aws_cloudtrail' }],
  },
  responder: {
    summary: 'Response summary',
    risk_level: 'medium',
    dry_run: true,
    estimated_effort_hours: 4,
    recommended_actions: [
      { priority: 1, action: 'Review S3 bucket policy', rationale: 'Check public access', risk: 'medium' },
    ],
    containment_steps: ['Restrict bucket ACL'],
    eradication_steps: ['Revert bucket policy'],
    recovery_steps: ['Verify compliance'],
  },
  audit_log: [
    { seq: 4, kind: 'evidence_cited', agent: 'ReconAgent', summary: 'ioc: 1.1.1.1' },
    { seq: 8, kind: 'recon', agent: 'ReconAgent', summary: 'Found 6 IOCs' },
  ],
};

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
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/investigations/r1/report.md')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/markdown' }),
        text: async () => '# Incident Report\n\n| Key | Val |\n|---|---|\n| IP | `1.1.1.1` |',
      } as Response);
    }
    if (url.endsWith('/investigations/r1')) return okJson(INV_DETAIL);
    if (url.endsWith('/investigations')) return okJson({ runs: [{ run_id: 'r1', status: 'completed' }] });
    if (url.endsWith('/external-refs')) return okJson([]);
    if (url.endsWith('/timeline')) return okJson({ events: [] });
    return okJson(CASE_PAYLOAD);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PR3: CaseWorkspace findings & SafeMarkdown report', () => {
  it('renders dropped recon/forensic/responder fields, show-all IOCs, ledger seq, and Suggested label', async () => {
    render(<CaseWorkspace caseId="c1" />);

    expect(await screen.findByText('Investigation complete')).toBeInTheDocument();
    expect(screen.getByText('Single S3 bucket')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getAllByText('not measured').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Restrict bucket ACL')).toBeInTheDocument();
    expect(screen.getByText('Revert bucket policy')).toBeInTheDocument();
    expect(screen.getByText('Verify compliance')).toBeInTheDocument();
    expect(screen.getByText('Suggested - not executed')).toBeInTheDocument();
    expect(screen.getByText('Est. effort: 4h')).toBeInTheDocument();
    expect(screen.getByText('ledger #8')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();

    expect(screen.queryByText(/s3\.amazonaws\.com/)).not.toBeNull(); // in forensic artefacts
    await userEvent.click(screen.getByRole('button', { name: 'Show all 6' }));
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'report' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Incident Report' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
