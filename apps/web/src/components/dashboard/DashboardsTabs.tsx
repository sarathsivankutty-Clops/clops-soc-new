'use client';

import { CostDashboardView } from '@/components/admin/CostDashboardView';
import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { OperationsDashboard } from '@/components/dashboard/operations/OperationsDashboard';
import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';
import { SLADashboard } from '@/components/sla/SLADashboard';
import { SOCInsightsView } from '@/components/soc-insights/SOCInsightsView';
import { SectionTabs, type SectionTabItem } from '@/components/ui/SectionTabs';

/**
 * The whole "Dashboards" destination.
 *
 * Seven tabs, one route (`/dashboards?tab=`), one tab bar. Each tab used to be
 * its own top-level nav entry — Dashboard, SOC Insights, SOC Operations, SLA,
 * Team Analytics, MSSP and Cost all sat in the sidebar as peers, which said
 * nothing about which one answers which question. They are one destination
 * now, ordered from "what is happening" to "what it costs", with the two
 * admin-scoped views last and behind the same `adminOnly` gate as Settings →
 * Users (the API is still the real gate — see `api/v1/endpoints/costs.py`).
 */
const DASHBOARD_TABS: readonly SectionTabItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    render: () => <DashboardView />,
  },
  {
    id: 'soc-insights',
    label: 'SOC Insights',
    render: () => <SOCInsightsView />,
  },
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
  {
    id: 'mssp',
    label: 'MSSP',
    adminOnly: true,
    render: () => <MSSPDashboardView />,
  },
  {
    id: 'costs',
    label: 'Cost',
    adminOnly: true,
    render: () => <CostDashboardView />,
  },
];

/**
 * Index of the first tab that belongs to the "organisation" half of the bar.
 * Overview → SLA answer questions about the estate; Team Analytics → Cost
 * answer questions about the team running it.
 */
const DASHBOARD_DIVIDER_AFTER = 3;

export function DashboardsTabs({ defaultTab = 'overview' }: { defaultTab?: string }) {
  return (
    <SectionTabs
      tabs={DASHBOARD_TABS}
      defaultTab={defaultTab}
      ariaLabel="Dashboards sections"
      dividerAfter={DASHBOARD_DIVIDER_AFTER}
    />
  );
}
