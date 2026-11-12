import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-4 consolidated into Settings SectionTabs]
// import { RBACView } from '@/components/settings/RBACView';

export const metadata = {
  title: 'Roles & Permissions',
};

export default function RBACPage() {
  // [HIDDEN-UI NAV-4 redirect with permanent:false (307) to RBAC tab]
  // return (
  //   <div className="p-6">
  //     <RBACView />
  //   </div>
  // );
  redirect('/settings?tab=rbac');
}
