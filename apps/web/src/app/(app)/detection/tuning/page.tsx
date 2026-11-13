import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-2 consolidated into Detection SectionTabs]
// import RuleTuningView from '@/components/detections/RuleTuningView';

export const metadata = {
  title: 'Detection Tuning',
};

export default function DetectionTuningPage() {
  // [HIDDEN-UI NAV-2 redirect with permanent:false (307) to Tuning tab]
  // return <RuleTuningView />;
  redirect('/detection?tab=tuning');
}
