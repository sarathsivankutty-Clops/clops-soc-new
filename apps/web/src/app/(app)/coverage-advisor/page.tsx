import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import CoverageAdvisorView from '@/components/coverage/CoverageAdvisorView';

export const metadata = { title: 'Coverage Gap Advisor' };

export default function CoverageAdvisorPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <CoverageAdvisorView />;
  redirect('/dashboard');
}
