import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-4 consolidated into Settings SectionTabs]
// import { MfaView } from '@/components/settings/MfaView';

export const metadata = {
  title: 'Two-factor authentication',
};

export default function MfaSettingsPage() {
  // [HIDDEN-UI NAV-4 redirect with permanent:false (307) to MFA tab]
  // return (
  //   <div className="p-6">
  //     <MfaView />
  //   </div>
  // );
  redirect('/settings?tab=mfa');
}
