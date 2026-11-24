'use client';

import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';
import { OperationsDashboard } from '@/components/dashboard/operations/OperationsDashboard';
import { SLADashboard } from '@/components/sla/SLADashboard';
import { SectionTabs, type SectionTabItem } from '@/components/ui/SectionTabs';

/**
 * `/operations` — the team-and-service-health destination.
 *
 * These three views used to be tabs of the seven-tab `/dashboards` bar, which
 * put "what is the SOC doing right now" next to "what does the estate look
 * like". They answer questions about running the SOC, so they moved to their
 * own rail destination and the Overview page lost its tab bar.
 *
 * `?tab=sla` and `?tab=team` are the entry points the retired `/sla` and
 * `/analytics/team` routes redirect to, so the ids must not change.
 */
const OPERATIONS_TABS: readonly SectionTabItem[] = [
  {
    id: 'operations',
    label: 'SOC Operations',
    render: () => <OperationsDashboard />,
  },
  {
    id: 'sla',
    label: 'SLA',
    render: () => (
      <div className="p-6 max-w-6xl mx-auto">
        <SLADashboard />
      </div>
    ),
  },
  {
    id: 'team',
    label: 'Team Analytics',
    render: () => (
      <div className="p-6 max-w-7xl mx-auto">
        <TeamAnalyticsView />
      </div>
    ),
  },
];

export function OperationsTabs({ defaultTab = 'operations' }: { defaultTab?: string }) {
  return (
    <SectionTabs
      tabs={OPERATIONS_TABS}
      defaultTab={defaultTab}
      ariaLabel="SOC operations sections"
    />
  );
}
