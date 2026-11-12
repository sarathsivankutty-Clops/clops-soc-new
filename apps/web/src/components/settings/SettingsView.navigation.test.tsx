import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationTestProvider } from '@/test/NavigationTestProvider';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { SettingsView } from './SettingsView';

// Panel data is independent of navigation. Keep the actual view, router hook,
// sidebar and panels; do not issue backend requests for this component suite.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

function renderSettings() {
  return render(<ThemeProvider><SettingsView /></ThemeProvider>, { wrapper: NavigationTestProvider });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings URL navigation', () => {
  it('opens Deployment & AI directly from the onboarding deep link without colliding with ?tab=', () => {
    window.history.replaceState(null, '', '/settings?tab=general&section=deployment');
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Deployment & AI' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
  });

  it.each([
    ['profile', 'Profile'],
    ['workspace', 'Workspace'],
    ['integrations', 'Integrations'],
    ['autonomy', 'Autonomy guardrails'],
    ['api-keys', 'API keys'],
    ['scim', 'SCIM provisioning'],
    ['branding', 'Branding'],
    ['retention', 'Retention'],
    ['rule-packs', 'Rule packs'],
    ['delegations', 'Delegations'],
    ['notifications', 'Notifications'],
    ['appearance', 'Appearance'],
    ['deployment', 'Deployment & AI'],
    ['audit', 'Audit log'],
    ['about', 'About AiSOC'],
  ])('selects the %s section from its ?section= URL', (section, heading) => {
    window.history.replaceState(null, '', `/settings?section=${section}`);
    renderSettings();

    expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
  });

  it.each(['', '?section=', '?section=unknown', '?section=constructor', '?section=%2Fsettings'])
  ('falls back to Profile for %s', (query) => {
    window.history.replaceState(null, '', `/settings${query}`);
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });

  it('follows a query-only navigation without remounting', async () => {
    renderSettings();
    act(() => window.history.replaceState(null, '', '/settings?section=deployment'));
    expect(await screen.findByRole('heading', { name: 'Deployment & AI' })).toBeInTheDocument();

    act(() => window.history.replaceState(null, '', '/settings?section=invalid'));
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });

  // [HIDDEN-UI NAV-6 inner tab bar hidden; click-based inner nav tests disabled]
  /*
  it('updates the URL on a click and keeps unrelated query values and the fragment', async () => {
    ...
  });

  it('does not add history entries when the selected section is clicked again', async () => {
    ...
  });
  */
});
