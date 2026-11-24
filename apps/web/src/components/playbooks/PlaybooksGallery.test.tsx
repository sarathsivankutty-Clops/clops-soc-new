import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Playbook } from './types';
import { PlaybooksGallery } from './PlaybooksGallery';

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: pushMock }),
}));

function makePlaybook(overrides: Partial<Playbook>): Playbook {
  return {
    id: 'ransomware-pack-v1',
    name: 'Ransomware response',
    description: 'Contain a ransomware alert.',
    version: '1.0.0',
    tags: ['ransomware', 'mitre.t1486'],
    trigger: { on: 'alert', severity: ['critical'] },
    steps: [
      {
        id: 'isolate',
        name: 'Isolate host',
        type: 'isolate_host',
        params: {},
        on_failure: 'abort',
        retry_max: 0,
        timeout_seconds: 30,
      },
    ],
    author: 'AiSOC',
    enabled: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const playbooks = [
  makePlaybook({}),
  makePlaybook({
    id: 'exfiltration-pack-v1',
    name: 'Exfiltration response',
    tags: ['data-exfil', 'mitre.t1041'],
    trigger: { on: 'alert', severity: ['high'] },
    steps: [],
  }),
  makePlaybook({
    id: 'c0a80123-0000-4000-8000-000000000001',
    name: 'Custom response',
    tags: [],
    author: 'Analyst',
    trigger: { on: 'manual' },
    steps: [],
  }),
];

describe('PlaybooksGallery filters', () => {
  it('filters runbooks through dropdowns and keeps facet counts in the options', () => {
    render(<PlaybooksGallery playbooks={playbooks} />);

    const category = screen.getByRole('combobox', { name: 'Category' });
    expect(within(category).getByRole('option', { name: 'Ransomware (1)' })).toBeInTheDocument();

    fireEvent.change(category, { target: { value: 'ransomware' } });

    expect(screen.getByText('Ransomware response')).toBeInTheDocument();
    expect(screen.queryByText('Exfiltration response')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('combobox', { name: 'MITRE tactic' })).getByRole('option', {
        name: 'Impact (1)',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('combobox', { name: 'Severity' })).getByRole('option', {
        name: 'critical (1)',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('combobox', { name: 'Uses' })).getByRole('option', {
        name: 'EDR / Endpoint (1)',
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Exfiltration response')).toBeInTheDocument();
  });

  it('hides the pack category dropdown for Custom and shows only custom runbooks', () => {
    render(<PlaybooksGallery playbooks={playbooks} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Custom (1)' }));

    expect(screen.queryByRole('combobox', { name: 'Category' })).not.toBeInTheDocument();
    expect(screen.getByText('Custom response')).toBeInTheDocument();
    expect(screen.queryByText('Ransomware response')).not.toBeInTheDocument();
    expect(screen.queryByText('Exfiltration response')).not.toBeInTheDocument();
  });
});
