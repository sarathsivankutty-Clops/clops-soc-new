import { Metadata } from 'next';
import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-4 consolidated into ComplianceFrameworksView + Settings SectionTabs]
// import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Compliance',
};

/*
[HIDDEN-UI NAV-4 moved framework list to ComplianceFrameworksView.tsx]
const FRAMEWORKS = [ ... ];
*/

export default function CompliancePage() {
  // [HIDDEN-UI NAV-4 redirect with permanent:false (307) to Compliance tab]
  redirect('/settings?tab=compliance');
}
