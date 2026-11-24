import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 SOC Insights consolidated into /dashboards?tab=soc-insights]
// import { SOCInsightsView } from '@/components/soc-insights/SOCInsightsView';

export const metadata = {
  title: /* [HIDDEN-UI THEME-7 prior title used AiSOC] */ 'SOC Insights | ClopsSOC',
};

export default function SOCInsightsPage() {
  // [HIDDEN-UI NAV-8 replaced direct view with a redirect]
  // return <SOCInsightsView />;
  // [HIDDEN-UI UI-OVERHAUL-1 SOC Insights tab hidden; land on Overview instead]
  // redirect('/dashboards?tab=soc-insights');
  redirect('/dashboards');
}
