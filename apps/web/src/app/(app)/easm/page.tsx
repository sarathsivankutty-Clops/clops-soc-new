import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { EASMView } from '@/components/easm/EASMView';

export const metadata = { title: 'EASM' };

export default function EASMPage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return (
  //   <div className="p-6 max-w-7xl mx-auto">
  //     <EASMView />
  //   </div>
  // );
  redirect('/dashboard');
}
