'use client';

// [HIDDEN-UI UI-OVERHAUL-1 This component is no longer mounted. /dashboards
// renders DashboardView directly and the operations views moved to
// /operations. Kept — with its imports — so the retired layout can be
// restored without reconstructing it.
import { DashboardView } from '@/components/dashboard/DashboardView';
// [HIDDEN-UI UI-OVERHAUL-1 retired-tab imports kept beside their commented
// render branches below. Uncomment together.
// import { CostDashboardView } from '@/components/admin/CostDashboardView';
// import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';
// import { OperationsDashboard } from '@/components/dashboard/operations/OperationsDashboard';
// import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';
// import { SLADashboard } from '@/components/sla/SLADashboard';
// import { SOCInsightsView } from '@/components/soc-insights/SOCInsightsView';
import { SectionTabs, type SectionTabItem } from '@/components/ui/SectionTabs';

/**
 * The retired "Dashboards" destination.
 *
 * Seven tabs, one route (`/dashboards?tab=`), one tab bar. [HIDDEN-UI
 * UI-OVERHAUL-1] Overview is now its own page and SOC Operations / SLA /
 * Team Analytics live under `/operations`; SOC Insights, MSSP and Cost are
 * hidden. The definitions stay here, commented out, so the tab ids the old
 * links used are still readable.
 */
const DASHBOARD_TABS: readonly SectionTabItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    render: () => <DashboardView />,
  },
  /* [HIDDEN-UI UI-OVERHAUL-1 retired dashboard tabs]
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
  */
];

/**
 * Index of the first tab that belongs to the "organisation" half of the bar.
 * [HIDDEN-UI UI-OVERHAUL-1] The bar is no longer rendered; the divider only
 * mattered while seven tabs shared the row.
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
