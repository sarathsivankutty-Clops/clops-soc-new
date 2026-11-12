import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-2 consolidated into Detection SectionTabs]
// import { CoverageView } from '@/components/detections/CoverageView';

export const metadata = {
  title: 'MITRE ATT&CK Coverage',
  description:
    "MITRE ATT&CK coverage matrix derived from AiSOC's shipped detections, broken down by tier (native, imported, community).",
};

export default function CoveragePage() {
  // [HIDDEN-UI NAV-2 redirect with permanent:false (307) to MITRE Coverage tab]
  // return <CoverageView />;
  redirect('/detection?tab=coverage');
}
