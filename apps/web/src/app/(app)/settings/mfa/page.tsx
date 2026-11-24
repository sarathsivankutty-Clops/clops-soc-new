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
  // [HIDDEN-UI UI-OVERHAUL-1 Two-Factor Auth tab retired from Settings]
  // redirect('/settings?tab=mfa');
  redirect('/settings');
}
