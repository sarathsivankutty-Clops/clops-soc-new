import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock Next.js routing primitives. The Sidebar reads `usePathname` to decide
// which item is active and uses `<Link>` for navigation; for a smoke test we
// just need both to behave as plain functions/elements.
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders the SOC mark and the 4 grouped sections', () => {
    render(<Sidebar />);

    // Brand — [HIDDEN-UI THEME-2 visible product name changed from Ai/SOC to ClopsSOC]
    // [HIDDEN-UI CHROME-1 rename product to ClopSOC]
    // expect(screen.getByText('ClopsSOC')).toBeInTheDocument();
    // [HIDDEN-UI CHROME-3 rename product to SOC]
    // expect(screen.getByText('ClopSOC')).toBeInTheDocument();
    expect(screen.getByText('SOC')).toBeInTheDocument();

    // [HIDDEN-UI NAV-9 rename Monitor to Navigation, remove Respond/Detect/Admin subheadings, rename Detection to Detection Rules]
    // for (const heading of ['Monitor', 'Respond', 'Detect', 'Admin']) {
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    for (const removed of ['Monitor', 'Respond', 'Detect', 'Admin']) {
      expect(screen.queryByText(removed)).not.toBeInTheDocument();
    }

    const expected: [string, string][] = [
      ['Overview', '/dashboards'],
      ['SOC Operations', '/operations'],
      ['Alerts', '/alerts'],
      ['Investigation Queue', '/queue'],
      ['Runbooks', '/playbooks'],
      // [HIDDEN-UI CHROME-1 hide Hunt from sidebar navigation]
      // ['Hunt', '/hunt'],
      ['Detection Rules', '/detection'],
      ['Settings', '/settings'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') })).toHaveAttribute('href', href);
    }
    expect(screen.queryByRole('link', { name: /^Hunt(?:\s|$)/i })).not.toBeInTheDocument();

    // The retired dashboard tabs and the old "Dashboards" label are no longer
    // top-level links. [HIDDEN-UI UI-OVERHAUL-1] SOC Operations is a real
    // destination now, so it is no longer in this list.
    for (const retired of ['Dashboards', 'SOC Insights', 'Dashboard', 'SLA', 'Team Analytics', 'MSSP', 'Cost']) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${retired}(?:\\s|$)`, 'i') })).not.toBeInTheDocument();
    }
  });

  it('hides the section headings when the rail is collapsed', () => {
    render(<Sidebar collapsed />);

    // [HIDDEN-UI NAV-9 rename Monitor to Navigation, remove subheadings]
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });

  it('hides consolidated and retired nav links', () => {
    render(<Sidebar />);

    expect(screen.queryByRole('link', { name: /marketplace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /cases/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /compliance/i })).not.toBeInTheDocument();
  });

  /* [HIDDEN-UI CHROME-1 hide version and MIT License attribution from sidebar footer]
  it('renders the MIT license attribution in the footer', () => {
    render(<Sidebar />);

    const license = screen.getByRole('link', { name: /MIT License/i });
    expect(license).toHaveAttribute('href', 'https://github.com/beenuar/AiSOC');
  });
  */
  it('hides the version and MIT license attribution in the footer', () => {
    render(<Sidebar />);

    expect(screen.queryByRole('link', { name: /MIT License/i })).not.toBeInTheDocument();
  });
});
