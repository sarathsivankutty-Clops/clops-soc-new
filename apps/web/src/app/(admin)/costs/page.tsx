import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 consolidated into /dashboards?tab=costs]
// import { CostDashboardView } from '@/components/admin/CostDashboardView';

export const metadata = { title: 'Cost Dashboard' };

export default function CostDashboardPage() {
  // [HIDDEN-UI NAV-8 redirect with permanent:false (307) to Cost tab]
  // return <CostDashboardView />;
  redirect('/dashboards?tab=costs');
}
