import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 consolidated into /dashboards?tab=team]
// import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';

export const metadata = { title: 'Team Analytics' };

export default function TeamAnalyticsPage() {
  // [HIDDEN-UI NAV-8 redirect with permanent:false (307) to Team Analytics tab]
  // return (
  //   <div className="p-6 max-w-7xl mx-auto">
  //     <TeamAnalyticsView />
  //   </div>
  // );
  // [HIDDEN-UI UI-OVERHAUL-1 Team Analytics is a tab of /operations]
  // redirect('/dashboards?tab=team');
  redirect('/operations?tab=team');
}
