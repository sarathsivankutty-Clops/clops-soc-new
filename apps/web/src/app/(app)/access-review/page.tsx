import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { AccessReviewView } from '@/components/access-review/AccessReviewView';

export const metadata = {
  title: 'Access review',
  description:
    'What each principal was granted, through which object, and whether it was used. Read-only.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function AccessReviewPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return <AccessReviewView />;
  redirect('/dashboard');
}
