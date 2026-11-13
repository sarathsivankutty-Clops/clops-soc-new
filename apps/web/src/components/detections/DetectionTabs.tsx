'use client';

import { CoverageView } from '@/components/detections/CoverageView';
import { DetectionCatalog } from '@/components/detections/DetectionCatalog';
import { DetectionsView } from '@/components/detections/DetectionsView';
import RuleTuningView from '@/components/detections/RuleTuningView';
import { SectionTabs, type SectionTabItem } from '@/components/ui/SectionTabs';

const DETECTION_TABS: readonly SectionTabItem[] = [
  { id: 'rules', label: 'Rules', render: () => <DetectionsView /> },
  { id: 'catalog', label: 'Catalog', render: () => <DetectionCatalog /> },
  { id: 'coverage', label: 'MITRE Coverage', render: () => <CoverageView /> },
  { id: 'tuning', label: 'Tuning', render: () => <RuleTuningView /> },
];

export function DetectionTabs({ defaultTab = 'rules' }: { defaultTab?: string }) {
  return (
    <SectionTabs
      tabs={DETECTION_TABS}
      defaultTab={defaultTab}
      ariaLabel="Detection sections"
    />
  );
}
