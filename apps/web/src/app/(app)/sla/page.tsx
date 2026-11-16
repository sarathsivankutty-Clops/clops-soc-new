import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 consolidated into /dashboards?tab=sla]
// import { SLADashboard } from '@/components/sla/SLADashboard';

export const metadata = { title: 'Dashboards' };

export default function SLAPage() {
  // [HIDDEN-UI NAV-8 replaced DashboardsTabs with a redirect to its new route]
  // return <DashboardsTabs />;
  redirect('/dashboards?tab=sla');
}
