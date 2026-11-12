'use client';

import { useState } from 'react';
import { SWRConfig } from 'swr';
import { BrandedDocumentTitle } from './BrandedDocumentTitle';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { TimeWindowProvider } from './TimeWindowProvider';
import { TenantProvider } from './TenantProvider';
import { CopilotDock } from '@/components/copilot/CopilotDock';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { DemoAutoLogin } from '@/components/demo/DemoAutoLogin';
import { ClientOnly } from '@/components/util/ClientOnly';
import { isDemoMode } from '@/lib/demoMode';

interface AppShellProps {
  children: React.ReactNode;
  /**
   * Resolved by the Server Component in `app/(app)/layout.tsx`, which can see
   * the running container's `AISOC_DEMO_MODE`. Passed in rather than read here
   * so server and client render the same value by construction. Optional so
   * the stories and tests that mount the shell directly keep working; those
   * run in the browser, where `isDemoMode()` is the only answer available.
   */
  demoMode?: boolean;
}

export function AppShell({ children, demoMode }: AppShellProps) {
  // In demo mode the banner adds 36px (h-9) to the top, so push the main
  // content down to keep the TopBar from sliding underneath it.
  const demo = demoMode ?? isDemoMode();
  const topPadClass = demo ? 'pt-[100px]' : 'pt-16';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <SWRConfig value={{ revalidateOnMount: true, revalidateIfStale: true }}>
      <DemoAutoLogin />
      <TimeWindowProvider>
        <TenantProvider>
          <div className="min-h-screen bg-surface-base text-fg-primary">
            <DemoBanner demoMode={demo} sidebarCollapsed={sidebarCollapsed} />
            <BrandedDocumentTitle />
            <Sidebar collapsed={sidebarCollapsed} />
            <div className={`transition-[margin] duration-200 ${sidebarCollapsed ? 'md:ml-0' : 'md:ml-64'}`}>
              <TopBar
                demoOffset={demo}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
              />
              <main className={`${topPadClass} min-h-screen`}>
                {/* [HIDDEN-UI THEME-2 replaced p-6 wrapper with 1320px container and 28/32/96 padding] */}
                {/* <div className="p-6">{children}</div> */}
                <div className="max-w-content mx-auto w-full pt-7 px-8 pb-24">{children}</div>
              </main>
            </div>
            <ClientOnly>
              <CopilotDock />
            </ClientOnly>
            <ClientOnly>
              <CommandPalette />
            </ClientOnly>
          </div>
        </TenantProvider>
      </TimeWindowProvider>
    </SWRConfig>
  );
}
