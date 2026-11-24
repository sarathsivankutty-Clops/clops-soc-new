import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 consolidated into /dashboards?tab=mssp]
// import MSSPDashboardView from '@/components/mssp/MSSPDashboardView';

export const metadata = { title: 'MSSP Executive Dashboard' };

export default function MSSPPage() {
  // [HIDDEN-UI NAV-8 redirect with permanent:false (307) to MSSP tab]
  // return <MSSPDashboardView />;
  // [HIDDEN-UI UI-OVERHAUL-1 MSSP tab hidden; land on Overview instead]
  // redirect('/dashboards?tab=mssp');
  redirect('/dashboards');
}
