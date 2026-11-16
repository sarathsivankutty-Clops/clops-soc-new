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
  it('renders the ClopsSOC mark and the 4 grouped sections', () => {
    render(<Sidebar />);

    // Brand — [HIDDEN-UI THEME-2 visible product name changed from Ai/SOC to ClopsSOC]
    expect(screen.getByText('ClopsSOC')).toBeInTheDocument();

    // NAV-8: 4 labelled sections, 7 destinations.
    for (const heading of ['Monitor', 'Respond', 'Hunt & Detect', 'Admin']) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }

    const expected: [string, string][] = [
      ['Dashboards', '/dashboards'],
      ['Alerts', '/alerts'],
      ['Investigation Queue', '/queue'],
      ['Runbooks', '/playbooks'],
      ['Hunt', '/hunt'],
      ['Detection', '/detection'],
      ['Settings', '/settings'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') })).toHaveAttribute('href', href);
    }

    // The six tabs that used to be peers are no longer top-level links.
    for (const retired of ['SOC Insights', 'SOC Operations', 'Dashboard', 'SLA', 'Team Analytics', 'MSSP', 'Cost']) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${retired}(?:\\s|$)`, 'i') })).not.toBeInTheDocument();
    }
  });

  it('hides the section headings when the rail is collapsed', () => {
    render(<Sidebar collapsed />);

    for (const heading of ['Monitor', 'Respond', 'Hunt & Detect', 'Admin']) {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    }
  });

  it('hides consolidated and retired nav links', () => {
    render(<Sidebar />);

    expect(screen.queryByRole('link', { name: /marketplace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /cases/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /compliance/i })).not.toBeInTheDocument();
  });

  it('renders the MIT license attribution in the footer', () => {
    render(<Sidebar />);

    const license = screen.getByRole('link', { name: /MIT License/i });
    expect(license).toHaveAttribute('href', 'https://github.com/beenuar/AiSOC');
  });
});
