import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const mutate = vi.fn();
vi.mock('swr', () => ({ mutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('react-hot-toast', () => ({ default: { error: (msg: string) => toastError(msg) } }));

import { EnabledToggle } from './rowActions';
import type { Playbook } from './types';

const playbook = { id: 'pb-1', name: 'ATO: Credential Stuffing', enabled: true } as Playbook;

describe('EnabledToggle', () => {
  it('rolls the switch back and says why when the save is refused', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: 'Playbook not found' }) });
    render(<EnabledToggle playbook={playbook} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Playbook not found')));
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('refreshes the list on success and then follows the refreshed prop', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { rerender } = render(<EnabledToggle playbook={playbook} />);

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/v1/playbooks'));
    rerender(<EnabledToggle playbook={{ ...playbook, enabled: false }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});
