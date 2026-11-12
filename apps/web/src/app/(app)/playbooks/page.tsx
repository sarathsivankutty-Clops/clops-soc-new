import { PlaybooksView } from '@/components/playbooks/PlaybooksView';

export const metadata = {
  // [HIDDEN-UI NAV-3 renamed Playbooks -> Runbooks]
  // title: 'Playbooks',
  title: 'Runbooks',
};

export default function PlaybooksPage() {
  return <PlaybooksView />;
}
