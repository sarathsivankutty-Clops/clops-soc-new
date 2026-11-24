import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 SOC Operations consolidated into /dashboards?tab=operations]
// import { OperationsDashboard } from '@/components/dashboard/operations/OperationsDashboard';

export const metadata = {
  title: 'SOC operations',
};

export default function OperationsDashboardPage() {
  // [HIDDEN-UI NAV-8 replaced direct view with a redirect]
  // return <OperationsDashboard />;
  // [HIDDEN-UI UI-OVERHAUL-1 the operations views moved to /operations]
  // redirect('/dashboards?tab=operations');
  redirect('/operations?tab=operations');
}
