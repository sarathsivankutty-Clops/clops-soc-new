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
  it('renders the AiSOC mark and the 10 flat nav items', () => {
    render(<Sidebar />);

    // Brand
    expect(screen.getByText('Ai')).toBeInTheDocument();
    expect(screen.getByText('SOC')).toBeInTheDocument();

    const expected: [string, string][] = [
      ['Dashboard', '/dashboard'],
      ['SOC Insights', '/dashboards/soc-insights'],
      ['SOC Operations', '/dashboards/operations'],
      ['Alerts', '/alerts'],
      ['Investigation Queue', '/queue'],
      ['Hunt', '/hunt'],
      ['Detection', '/detection'],
      ['Runbooks', '/playbooks'],
      ['Dashboards', '/sla'],
      ['Settings', '/settings'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') })).toHaveAttribute('href', href);
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
