import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { ExploreView } from '@/components/explore/ExploreView';

export const metadata = {
  title: 'Data Explorer',
};

export default function ExplorePage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <ExploreView />;
  redirect('/dashboard');
}
