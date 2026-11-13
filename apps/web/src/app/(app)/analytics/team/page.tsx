import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-3 consolidated into Dashboards SectionTabs]
// import { TeamAnalyticsView } from '@/components/analytics/TeamAnalyticsView';

export const metadata = { title: 'Team Analytics' };

export default function TeamAnalyticsPage() {
  // [HIDDEN-UI NAV-3 redirect with permanent:false (307) to Team Analytics tab]
  // return (
  //   <div className="p-6 max-w-7xl mx-auto">
  //     <TeamAnalyticsView />
  //   </div>
  // );
  redirect('/sla?tab=team');
}
