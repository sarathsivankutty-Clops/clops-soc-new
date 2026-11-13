'use client';

/**
 * DemoBanner — top-of-page strip rendered on a public demo deployment.
 *
 * Sits inside `AppShell` above the TopBar so it covers every authenticated
 * page. Renders nothing when `NEXT_PUBLIC_DEMO_MODE !== 'true'`, so self-hosted
 * deployments never see it.
 *
 * Accessibility: announced via role="status" so screen readers pick up the
 * "writes are disabled" message at page load. Not dismissible — visitors have
 * to know writes will 403, otherwise they'll think the app is broken.
 */

import { isDemoMode, demoBannerMessage } from '@/lib/demoMode';
import { docs } from '@/lib/docs';

interface DemoBannerProps {
  /**
   * The deployment's answer, resolved server-side in `app/(app)/layout.tsx`
   * so it reflects the running container rather than the build. Falls back to
   * the compiled value when the banner mounted outside that layout, as the
   * stories and tests do.
   */
  demoMode?: boolean;
  sidebarCollapsed?: boolean;
}

export function DemoBanner({ demoMode, sidebarCollapsed = false }: DemoBannerProps = {}) {
  if (!(demoMode ?? isDemoMode())) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 h-9 px-4 text-control-sm font-medium bg-pill-warning-bg text-tone-warning border-b border-surface-border transition-[left] duration-200 ${
        sidebarCollapsed ? 'md:left-0' : 'md:left-64'
      }`}
    >
      <span>{demoBannerMessage()}</span>
      <span aria-hidden="true" className="text-fg-subtle">
        |
      </span>
      <a
        href={docs('quickstart')}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-fg-primary transition-colors"
      >
        {/* [HIDDEN-UI THEME-2 visible product name changed to ClopsSOC] Self-host AiSOC */}
        Self-host ClopsSOC
      </a>
    </div>
  );
}
