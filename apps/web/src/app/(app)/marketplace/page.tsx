import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { MarketplaceView } from '@/components/marketplace/MarketplaceView';

export const metadata = {
  title: 'Marketplace',
};

export default function MarketplacePage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <MarketplaceView />;
  redirect('/dashboard');
}
