import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationTestProvider } from '@/test/NavigationTestProvider';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { SettingsView } from './SettingsView';
import { SettingsTabs } from './SettingsTabs';

// Panel data is independent of navigation. Keep the actual view, router hook,
// sidebar and panels; do not issue backend requests for this component suite.
const swrKeys = vi.hoisted(() => [] as string[]);
vi.mock('swr', () => ({
  default: (key: string) => {
    swrKeys.push(key);
    return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

function renderSettings() {
  return render(<ThemeProvider><SettingsView /></ThemeProvider>, { wrapper: NavigationTestProvider });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
  swrKeys.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings URL navigation', () => {
  it('does not request AI panel data while the General tab is active', () => {
    window.history.replaceState(null, '', '/settings?tab=general');
    render(<SettingsTabs />, { wrapper: NavigationTestProvider });

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(swrKeys).not.toContain('settings:airgap-status');
    expect(swrKeys).not.toContain('settings:llm-status');
    expect(swrKeys).not.toContain('settings:llm-credential');
  });

  it('does not render the old Deployment panel inside General when section=deployment is retained', () => {
    window.history.replaceState(null, '', '/settings?tab=general&section=deployment');
    render(<SettingsTabs />, { wrapper: NavigationTestProvider });

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Deployment & AI' })).not.toBeInTheDocument();
  });

  it('opens AI Settings from the existing deep link without an inner tab bar', () => {
    window.history.replaceState(null, '', '/settings?section=deployment');
    render(<SettingsTabs />, { wrapper: NavigationTestProvider });

    expect(screen.getByRole('tab', { name: 'AI Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Deployment & AI' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Profile' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
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
    ['audit', 'Audit log'],
    // [HIDDEN-UI THEME-5 product name updated to ClopsSOC] ['about', 'About AiSOC'],
    ['about', 'About ClopsSOC'],
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
    act(() => window.history.replaceState(null, '', '/settings?section=workspace'));
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();

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
