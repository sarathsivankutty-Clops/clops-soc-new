import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-4 consolidated into Settings SectionTabs]
// import { AuditLogView } from '@/components/audit/AuditLogView';

export const metadata = { title: 'Audit Log' };

export default function AuditLogPage() {
  // [HIDDEN-UI NAV-4 redirect with permanent:false (307) to Audit Logs tab]
  // return <AuditLogView />;
  redirect('/settings?tab=audit-logs');
}
