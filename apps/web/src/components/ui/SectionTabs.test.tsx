import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationTestProvider } from '@/test/NavigationTestProvider';
import { authApi } from '@/lib/api';
import { SectionTabs, type SectionTabItem } from './SectionTabs';

function makeTabs(mountCounts: Record<string, number>): SectionTabItem[] {
  const Counter = ({ id }: { id: string }) => {
    mountCounts[id] = (mountCounts[id] ?? 0) + 1;
    return <div>Panel {id}</div>;
  };
  return [
    { id: 'rules', label: 'Rules', render: () => <Counter id="rules" /> },
    { id: 'catalog', label: 'Catalog', render: () => <Counter id="catalog" /> },
    { id: 'tuning', label: 'Tuning', render: () => <Counter id="tuning" /> },
  ];
}

describe('SectionTabs', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/detection');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts only the active tab and selects from ?tab=', () => {
    window.history.replaceState(null, '', '/detection?tab=catalog');
    const counts: Record<string, number> = {};
    render(<SectionTabs tabs={makeTabs(counts)} defaultTab="rules" />, {
      wrapper: NavigationTestProvider,
    });

    expect(screen.getByText('Panel catalog')).toBeInTheDocument();
    expect(screen.queryByText('Panel rules')).not.toBeInTheDocument();
    expect(screen.queryByText('Panel tuning')).not.toBeInTheDocument();
    expect(counts).toEqual({ catalog: 1 });
  });

  it('updates ?tab= in the URL on click via replaceState and preserves other query params', async () => {
    window.history.replaceState(null, '', '/detection?window=7d');
    const counts: Record<string, number> = {};
    const pushSpy = vi.spyOn(window.history, 'pushState');
    render(<SectionTabs tabs={makeTabs(counts)} defaultTab="rules" />, {
      wrapper: NavigationTestProvider,
    });

    await userEvent.click(screen.getByRole('tab', { name: 'Tuning' }));
    expect(screen.getByText('Panel tuning')).toBeInTheDocument();
    expect(screen.queryByText('Panel rules')).not.toBeInTheDocument();
    expect(pushSpy).not.toHaveBeenCalled();
    const url = new URL(window.location.href);
    expect(url.searchParams.get('tab')).toBe('tuning');
    expect(url.searchParams.get('window')).toBe('7d');
  });

  it('falls back to defaultTab on unknown ?tab=', () => {
    window.history.replaceState(null, '', '/detection?tab=unknown');
    const counts: Record<string, number> = {};
    render(<SectionTabs tabs={makeTabs(counts)} defaultTab="rules" />, {
      wrapper: NavigationTestProvider,
    });

    expect(screen.getByText('Panel rules')).toBeInTheDocument();
  });

  it('filters adminOnly tabs based on authApi.currentUser()', () => {
    vi.spyOn(authApi, 'currentUser').mockReturnValue(null);
    const tabs: SectionTabItem[] = [
      { id: 'general', label: 'General', render: () => <div>General</div> },
      { id: 'users', label: 'Users', adminOnly: true, render: () => <div>Users</div> },
    ];
    render(<SectionTabs tabs={tabs} defaultTab="general" />, {
      wrapper: NavigationTestProvider,
    });

    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('renders one group divider before the requested tab and none by default', () => {
    const counts: Record<string, number> = {};
    const { unmount } = render(
      <SectionTabs tabs={makeTabs(counts)} defaultTab="rules" dividerAfter={2} />,
      { wrapper: NavigationTestProvider },
    );

    const tablist = screen.getByRole('tablist');
    // The rule is decorative only — it must not become a tab stop.
    expect(tablist.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    unmount();

    // Detection and Settings pass no divider and keep their plain bar.
    const plain = render(<SectionTabs tabs={makeTabs(counts)} defaultTab="rules" />, {
      wrapper: NavigationTestProvider,
    });
    expect(
      plain.container.querySelector('[role="tablist"]')?.querySelectorAll('[aria-hidden="true"]'),
    ).toHaveLength(0);
  });
});
