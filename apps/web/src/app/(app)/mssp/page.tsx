import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-3 consolidated into Dashboards SectionTabs]
// import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';

export const metadata = { title: 'MSSP Executive Dashboard' };

export default function MSSPPage() {
  // [HIDDEN-UI NAV-3 redirect with permanent:false (307) to MSSP tab]
  // return <MSSPDashboardView />;
  redirect('/sla?tab=mssp');
}
