import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { DetectionProposalsView } from '@/components/detections/DetectionProposalsView';

export const metadata = { title: 'Detection proposals' };

export default function DetectionProposalsPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <DetectionProposalsView />;
  redirect('/dashboard');
}
