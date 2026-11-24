import { redirect } from 'next/navigation';
// [HIDDEN-UI UI-OVERHAUL-1 Compliance retired from Settings; the view is kept
// on disk behind its component so the surface can be restored.
// import { SOC2View } from '@/components/compliance/SOC2View';

export const metadata = { title: 'SOC 2 Compliance' };

export default function SOC2Page() {
  // [HIDDEN-UI UI-OVERHAUL-1 replaced the direct view with a redirect]
  // return <SOC2View />;
  redirect('/settings');
}
