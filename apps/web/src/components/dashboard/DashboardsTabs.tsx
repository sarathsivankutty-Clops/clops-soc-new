'use client';

import { CostDashboardView } from '@/components/admin/CostDashboardView';
import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';
import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';
import { SLADashboard } from '@/components/sla/SLADashboard';
import { SectionTabs, type SectionTabItem } from '@/components/ui/SectionTabs';

const DASHBOARD_TABS: readonly SectionTabItem[] = [
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
  {
    id: 'mssp',
    label: 'MSSP',
    render: () => <MSSPDashboardView />,
  },
  {
    id: 'costs',
    label: 'Cost',
    render: () => <CostDashboardView />,
  },
];

export function DashboardsTabs({ defaultTab = 'sla' }: { defaultTab?: string }) {
  return (
    <SectionTabs
      tabs={DASHBOARD_TABS}
      defaultTab={defaultTab}
      ariaLabel="Dashboards sections"
    />
  );
}
