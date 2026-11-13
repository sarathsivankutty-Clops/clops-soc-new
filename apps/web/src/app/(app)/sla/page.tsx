import { DashboardsTabs } from '@/components/dashboard/DashboardsTabs';
// [HIDDEN-UI NAV-3 moved into Dashboards SectionTabs]
// import { SLADashboard } from '@/components/sla/SLADashboard';

export const metadata = { title: 'Dashboards' };

export default function SLAPage() {
  // [HIDDEN-UI NAV-3 replaced direct view with DashboardsTabs]
  // return (
  //   <div className="p-6 max-w-6xl mx-auto">
  //     <SLADashboard />
  //   </div>
  // );
  return <DashboardsTabs />;
}
