import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { ThreatIntelView } from '@/components/threat-intel/ThreatIntelView';

export const metadata = {
  title: 'Threat Intelligence',
};

export default function ThreatIntelPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <ThreatIntelView />;
  redirect('/dashboard');
}
