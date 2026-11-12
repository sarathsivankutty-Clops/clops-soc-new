import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-4 consolidated into Settings SectionTabs]
// import { ConnectorsView } from '@/components/connectors/ConnectorsView';

export const metadata = {
  title: 'Connectors',
};

export default function ConnectorsPage() {
  // [HIDDEN-UI NAV-4 redirect with permanent:false (307) to Connectors tab]
  // return <ConnectorsView />;
  redirect('/settings?tab=connectors');
}
