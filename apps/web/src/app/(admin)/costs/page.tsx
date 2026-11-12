import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-3 consolidated into Dashboards SectionTabs]
// import { CostDashboardView } from '@/components/admin/CostDashboardView';

export const metadata = { title: 'Cost Dashboard' };

export default function CostDashboardPage() {
  // [HIDDEN-UI NAV-3 redirect with permanent:false (307) to Cost tab]
  // return <CostDashboardView />;
  redirect('/sla?tab=costs');
}
