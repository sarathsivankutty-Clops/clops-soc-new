import { DetectionTabs } from '@/components/detections/DetectionTabs';
// [HIDDEN-UI NAV-2 moved into DetectionTabs]
// import { DetectionsView } from '@/components/detections/DetectionsView';

export const metadata = {
  title: 'Detection',
};

export default function DetectionPage() {
  // [HIDDEN-UI NAV-2 replaced direct view with SectionTabs]
  // return <DetectionsView />;
  return <DetectionTabs />;
}
