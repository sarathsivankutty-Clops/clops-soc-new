'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useOptionalTheme } from '@/components/theme/ThemeProvider';
import { useBrandLogo, useBranding } from '@/hooks/useBranding';
import { TimeWindowSelector } from './TimeWindowSelector';
import { TenantSwitcher } from './TenantSwitcher';
import { RoleBadge } from './RoleBadge';
import { useTenant } from './TenantProvider';

// Order matters: longer/more specific paths first so startsWith() picks
// the right label for nested routes (e.g. /detection/catalog before /detection).
const routeLabels: Record<string, { title: string; description: string }> = {
  '/dashboards/soc-insights': { title: 'SOC Insights', description: 'Rolling KPIs, MTTA, MTTR, and cost per investigation' },
  '/dashboards/operations': { title: 'SOC Operations', description: 'Pipeline health, connector fleet, and agent throughput' },
  '/detection/catalog': { title: 'Detection Catalog', description: 'Curated rule packs and templates' },
  '/detection/coverage': { title: 'MITRE Coverage', description: 'ATT&CK technique coverage across active rules' },
  '/detection/tuning': { title: 'Detection Tuning', description: 'Alert noise tuning and suppression rules' },
  '/settings/users': { title: 'Users', description: 'Member and role management' },
  '/settings/rbac': { title: 'Roles & Permissions', description: 'Access control and team management' },
  '/settings/mfa': { title: 'Two-Factor Auth', description: 'Your second factor, and whether this tenant requires one' },
  '/analytics/team': { title: 'Team Analytics', description: 'Analyst workload, resolution speed, and accuracy' },
  '/dashboard': { title: 'Dashboard', description: 'SOC overview and metrics' },
  '/alerts': { title: 'Alerts', description: 'Security alerts and incidents' },
  '/queue': { title: 'Investigation Queue', description: 'Entity risk-based alerting queue' },
  '/hunt': { title: 'Hunt', description: 'Proactive threat hunts and queries' },
  '/detection': { title: 'Detection', description: 'Rules, catalog, MITRE coverage, and tuning' },
  // [HIDDEN-UI NAV-1 renamed Playbooks -> Runbooks]
  // '/playbooks': { title: 'Playbooks', description: 'Automated response and SOAR workflows' },
  '/playbooks': { title: 'Runbooks', description: 'Automated response and SOAR workflows' },
  '/sla': { title: 'Dashboards', description: 'SLA, team analytics, MSSP, and cost' },
  '/mssp': { title: 'MSSP', description: 'Managed multi-tenant portfolio overview' },
  '/costs': { title: 'Cost', description: 'LLM spend, token usage, and BYOK savings' },
  '/settings': { title: 'Settings', description: 'General, connectors, access, compliance, and audit logs' },
  '/connectors': { title: 'Connectors', description: 'Security tool integrations' },
  '/compliance': { title: 'Compliance', description: 'Frameworks, controls, and evidence' },
  '/audit': { title: 'Audit Logs', description: 'Platform activity and security events' },
  // [HIDDEN-UI NAV-1 routes hidden from primary navigation and redirected to /dashboard]
  // '/cases': { title: 'Cases', description: 'Incident case management' },
  // '/threat-intel': { title: 'Threat Intelligence', description: 'IOC lookup and threat feeds' },
  // '/graph': { title: 'Attack Graph', description: 'Visualize relationships across alerts and assets' },
  // '/copilot': { title: 'AI Copilot', description: 'AI-assisted investigation and triage' },
  // '/marketplace': { title: 'Marketplace', description: 'Plugins, integrations, and content packs' },
  // '/honeytokens': { title: 'Honeytokens', description: 'Deception assets and trip-wire alerts' },
  // '/ai-estate': { title: 'AI Estate', description: 'Observed AI apps, agents, MCP servers, keys and grants' },
  // '/purple-team': { title: 'Purple Team', description: 'Adversary emulation and detection coverage' },
  '/': { title: 'Dashboard', description: 'SOC overview and metrics' },
};

interface TopBarProps {
  /**
   * When true, the demo banner is rendered above this bar so we shift the
   * fixed-position TopBar down by its height (h-9 = 36px). Driven by
   * `AppShell` which reads `isDemoMode()` once at render.
   */
  demoOffset?: boolean;
  /** Desktop sidebar collapse state and toggle passed from `AppShell`. */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function TopBar({
  demoOffset = false,
  sidebarCollapsed = false,
  onToggleSidebar,
}: TopBarProps) {
  const pathname = usePathname();
  /* [HIDDEN-UI THEME-2 clock consolidated out of TopBar chrome]
  const [now, setNow] = useState<Date | null>(null);
  */
  const [shortcut, setShortcut] = useState<'⌘K' | 'Ctrl K'>('⌘K');
  const { userRole } = useTenant();
  const themeCtx = useOptionalTheme();
  const isDark = themeCtx?.resolved !== 'light';
  const { branding } = useBranding();
  const logoSrc = useBrandLogo(branding.logo_url);
  const fallbackLogo = isDark ? '/brand/logo-dark.png' : '/brand/logo-light.png';

  // Show the right OS-specific shortcut hint without breaking SSR.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    setShortcut(isMac ? '⌘K' : 'Ctrl K');
  }, []);

  // Match the most specific path first. Object insertion order is preserved
  // and routeLabels lists nested routes (e.g. /detection/catalog) before
  // their parents so startsWith() picks the deepest match.
  const routeKey = Object.keys(routeLabels).find(
    (key) => key !== '/' && pathname.startsWith(key)
  ) || (pathname === '/' ? '/' : null);

  // Derive a sensible title for unknown routes from the URL itself instead
  // of silently falling back to "Alerts", which used to make every page
  // look like the alerts page.
  const fallbackFromPath = (() => {
    const segment = pathname.split('/').filter(Boolean)[0] ?? '';
    const title = segment
      ? segment
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
      : 'ClopsSOC';
    return { title, description: '' };
  })();

  const routeInfo = routeKey ? routeLabels[routeKey] : fallbackFromPath;

  const openPalette = () => {
    // Synthesize the same keystroke the palette listens for. Keeps a single
    // source of truth — the palette itself owns the open/close logic.
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);
  };

  /* [HIDDEN-UI THEME-2 TopBar clock formatting removed] */

  return (
    <header
      className={`fixed left-0 ${
        sidebarCollapsed ? 'md:left-0' : 'md:left-64'
      } right-0 h-16 flex items-center justify-between gap-4 px-5 bg-surface-card border-b border-surface-border z-20 transition-[left] duration-200 ${
        demoOffset ? 'top-9' : 'top-0'
      }`}
    >
      {/* Left: collapse chevron + plain page title */}
      <div className="flex items-center gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:grid place-items-center w-8 h-8 rounded-control border border-surface-border text-fg-secondary hover:bg-surface-hover hover:text-fg-primary transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${sidebarCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-card-title font-semibold text-fg-primary leading-tight truncate">
            {routeInfo.title}
          </h1>
          {/* [HIDDEN-UI THEME-2 description kept sr-only for a11y while TopBar displays plain title] */}
          <p className="sr-only">{routeInfo.description}</p>
        </div>
      </div>

      {/* Center: command palette launcher */}
      <div className="flex-1 max-w-md mx-4 hidden sm:block">
        <button
          type="button"
          onClick={openPalette}
          aria-label="Open command palette"
          className="group relative flex w-full items-center gap-3 rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-left text-body text-fg-muted transition-colors hover:border-surface-border-strong hover:text-fg-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <svg
            className="h-4 w-4 text-fg-subtle transition-colors group-hover:text-fg-secondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <span className="flex-1 truncate text-fg-muted group-hover:text-fg-secondary">
            Search alerts, cases, rules, or run a command…
          </span>
          <kbd className="pointer-events-none rounded-control bg-surface-subtle px-1.5 py-0.5 font-mono text-eyebrow uppercase tracking-wide text-fg-secondary">
            {shortcut}
          </kbd>
        </button>
      </div>

      {/* Right: global selectors + brand logo (tenant logo wins; brand PNG fallback) */}
      <div className="flex items-center gap-2.5 ml-auto">
        <div className="hidden md:block">
          <TimeWindowSelector />
        </div>
        <div className="hidden md:block">
          <TenantSwitcher />
        </div>
        <div className="hidden lg:block">
          <RoleBadge role={userRole} />
        </div>
        <div className="hidden sm:block h-6 w-px bg-surface-border" aria-hidden />
        {/* [HIDDEN-UI THEME-2 TopBar clock, bell, ThemeToggle, and static SO avatar consolidated to Sidebar footer] */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc ?? fallbackLogo}
          alt={branding.product_name}
          className="h-9 w-auto max-w-40 object-contain shrink-0"
        />
      </div>
    </header>
  );
}
