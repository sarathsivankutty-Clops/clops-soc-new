import { DashboardView } from '@/components/dashboard/DashboardView';
// [HIDDEN-UI UI-OVERHAUL-1 /dashboards is the Overview page now; the seven-tab
// destination was retired and the remaining views moved to /operations.
// import { DashboardsTabs } from '@/components/dashboard/DashboardsTabs';
// [HIDDEN-UI NAV-8 seven dashboard routes consolidated into DashboardsTabs]
// import { SOCInsightsView } from '@/components/soc-insights/SOCInsightsView';
// import { OperationsDashboard } from '@/components/dashboard/operations/OperationsDashboard';
// import { SLADashboard } from '@/components/sla/SLADashboard';
// import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';
// import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';
// import { CostDashboardView } from '@/components/admin/CostDashboardView';

export const metadata = {
  title: 'Overview',
};

export default function DashboardsPage() {
  // [HIDDEN-UI UI-OVERHAUL-1 replaced <DashboardsTabs /> with the Overview view]
  // return <DashboardsTabs />;
  return <DashboardView />;
}
