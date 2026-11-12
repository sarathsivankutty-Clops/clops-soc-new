import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-2 consolidated into Detection SectionTabs]
// import { DetectionCatalog } from '@/components/detections/DetectionCatalog';

export const metadata = { title: 'Detection Catalog' };

export default function DetectionCatalogPage() {
  // [HIDDEN-UI NAV-2 redirect with permanent:false (307) to Detection Catalog tab]
  // return <DetectionCatalog />;
  redirect('/detection?tab=catalog');
}
