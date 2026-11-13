import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation; floating CopilotDock remains active]
// import { CopilotView } from '@/components/copilot/CopilotView';

export const metadata = {
  title: 'AI Copilot',
};

export default function CopilotPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <CopilotView />;
  redirect('/dashboard');
}
