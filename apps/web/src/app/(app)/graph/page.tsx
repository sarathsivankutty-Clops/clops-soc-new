import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import AttackGraphClient from '@/components/graph/AttackGraphClient';

export const metadata = {
  title: 'Attack Graph',
};

export default function GraphPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <AttackGraphClient />;
  redirect('/dashboard');
}
