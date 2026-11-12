'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useUrlTab } from '@/hooks/useUrlTab';
import { authApi } from '@/lib/api';

export interface SectionTabItem {
  id: string;
  label: string;
  render: () => ReactNode;
  adminOnly?: boolean;
}

export interface SectionTabsProps {
  tabs: readonly SectionTabItem[];
  defaultTab?: string;
  ariaLabel?: string;
}

function SectionTabsInner({
  tabs,
  defaultTab,
  ariaLabel = 'Section navigation',
}: SectionTabsProps) {
  const [meRole, setMeRole] = useState<string | null>(null);
  useEffect(() => {
    setMeRole(authApi.currentUser()?.role ?? null);
  }, []);
  const isAdmin = meRole === 'admin';

  const visibleTabs = useMemo(
    () => tabs.filter((t) => !t.adminOnly || isAdmin),
    [tabs, isAdmin],
  );
  const tabIds = useMemo(() => visibleTabs.map((t) => t.id), [visibleTabs]);
  const fallbackId =
    defaultTab && tabIds.includes(defaultTab)
      ? defaultTab
      : (tabIds[0] ?? tabs[0]?.id ?? '');
  const [activeId, setActiveId] = useUrlTab(tabIds, fallbackId);
  const activeTab =
    visibleTabs.find((t) => t.id === activeId) ?? visibleTabs[0] ?? tabs[0];

  if (!activeTab) return null;

  return (
    <div className="space-y-6">
      <nav aria-label={ariaLabel} className="border-b border-surface-border">
        <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-1 -mb-px">
          {visibleTabs.map((item) => {
            const selected = item.id === activeTab.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(item.id)}
                className={clsx(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                  selected
                    ? 'border-brand-500 text-fg-primary bg-surface-card/60'
                    : 'border-transparent text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50',
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
      <div role="tabpanel" aria-label={activeTab.label}>
        {activeTab.render()}
      </div>
    </div>
  );
}

export function SectionTabs(props: SectionTabsProps) {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <SectionTabsInner {...props} />
    </Suspense>
  );
}
