import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { Suspense } from 'react';
// import { OnboardingView } from '@/components/onboarding/OnboardingView';
// import { SetupChecklist } from '@/components/onboarding/SetupChecklist';

export const metadata = {
  title: 'Get started',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function OnboardingPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return (
  //   <Suspense fallback={null}>
  //     <div className="mx-auto max-w-5xl px-6 pt-6">
  //       <SetupChecklist />
  //     </div>
  //     <OnboardingView />
  //   </Suspense>
  // );
  redirect('/dashboard');
}
