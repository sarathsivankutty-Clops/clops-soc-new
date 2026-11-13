import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pathnameMock = vi.fn(() => '/cases');
const searchParamsMock = vi.fn(() => new URLSearchParams());

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
  useSearchParams: () => searchParamsMock(),
}));

import { TopBar } from './TopBar';
import { ThemeProvider } from '../theme/ThemeProvider';
import { TimeWindowProvider } from './TimeWindowProvider';
import { TenantProvider } from './TenantProvider';

// TopBar depends on three React contexts:
//  - <ThemeProvider/>      for the WS-F1 theme toggle (`useTheme`)
//  - <TimeWindowProvider/> for the v1.5 W4 global time-window selector
//  - <TenantProvider/>     for the v1.5 W5 tenant switcher + role badge
// Wrap all three here so each test reads naturally without re-stating the
// provider scaffolding.
function renderTopBar() {
  return render(
    <ThemeProvider>
      <TimeWindowProvider>
        <TenantProvider>
          <TopBar />
        </TenantProvider>
      </TimeWindowProvider>
    </ThemeProvider>,
  );
}

describe('TopBar', () => {
  it('shows the per-route title and description for known paths', () => {
    pathnameMock.mockReturnValue('/playbooks');
    renderTopBar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Runbooks');
    expect(screen.getByText('Automated response and SOAR workflows')).toBeInTheDocument();
  });

  it('matches the most specific nested route first', () => {
    // /detection/catalog must win over /detection.
    pathnameMock.mockReturnValue('/detection/catalog');
    renderTopBar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Detection Catalog');
  });

  it('shows the AI Settings title for the deployment settings tab', () => {
    pathnameMock.mockReturnValue('/settings');
    searchParamsMock.mockReturnValue(new URLSearchParams('section=deployment'));
    renderTopBar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI Settings');
    expect(screen.getByText('LLM provider, BYOK, and air-gap configuration')).toBeInTheDocument();
  });

  it('prefers an explicitly selected settings tab over the legacy deep link', () => {
    pathnameMock.mockReturnValue('/settings');
    searchParamsMock.mockReturnValue(new URLSearchParams('tab=general&section=deployment'));
    renderTopBar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
  });

  it('derives a sensible title for unknown routes from the path itself', () => {
    // Regression: previously fell back to "Alerts" for everything unmapped.
    pathnameMock.mockReturnValue('/some-new-page');
    renderTopBar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Some New Page');
  });

  it('dispatches a Cmd-K keyboard event when the palette button is clicked', async () => {
    pathnameMock.mockReturnValue('/dashboard');
    renderTopBar();

    const listener = vi.fn();
    window.addEventListener('keydown', listener);

    await userEvent.click(screen.getByRole('button', { name: /open command palette/i }));

    expect(listener).toHaveBeenCalled();
    const event = listener.mock.calls[0][0] as KeyboardEvent;
    expect(event.key).toBe('k');
    expect(event.metaKey).toBe(true);

    window.removeEventListener('keydown', listener);
  });
});
