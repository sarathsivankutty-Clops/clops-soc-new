import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { FimDashboard } from '@/components/fim/FimDashboard';

export const metadata: Metadata = {
  title: 'File Integrity Monitoring',
  description:
    'Real-time osquery file_events telemetry — track file creation, deletion, and modification across your fleet.',
};

export default function FimPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <FimDashboard />;
  redirect('/dashboard');
}
