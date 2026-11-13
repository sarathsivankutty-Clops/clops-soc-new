import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { FederatedSearchView } from '@/components/federated/FederatedSearchView';

export const metadata = {
  title: 'Federated search',
  description:
    'Query every connected SIEM in one place, with a per-backend verdict for each.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function FederatedSearchPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <FederatedSearchView />;
  redirect('/dashboard');
}
