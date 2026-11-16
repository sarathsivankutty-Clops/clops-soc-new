import { DashboardsTabs } from '@/components/dashboard/DashboardsTabs';
// [HIDDEN-UI NAV-8 seven dashboard routes consolidated into DashboardsTabs]
// import { DashboardView } from '@/components/dashboard/DashboardView';
// import { SOCInsightsView } from '@/components/soc-insights/SOCInsightsView';
// import { OperationsDashboard } from '@/components/dashboard/operations/OperationsDashboard';
// import { SLADashboard } from '@/components/sla/SLADashboard';
// import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';
// import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';
// import { CostDashboardView } from '@/components/admin/CostDashboardView';

export const metadata = {
  title: 'Dashboards',
};

export default function DashboardsPage() {
  return <DashboardsTabs />;
}
