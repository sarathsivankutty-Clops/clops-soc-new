import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { ReplayEvaluationView } from '@/components/evaluations/ReplayEvaluationView';

export const metadata = {
  title: 'Evaluate on your history',
  description:
    /* [HIDDEN-UI THEME-7 prior description named AiSOC] */
    "Measure ClopsSOC triage against your own analysts' past decisions, on your own closed findings.",
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function EvaluatePage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <ReplayEvaluationView />;
  redirect('/dashboard');
}
