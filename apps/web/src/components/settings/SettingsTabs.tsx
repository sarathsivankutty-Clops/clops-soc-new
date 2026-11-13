'use client';

import { useSearchParams } from 'next/navigation';
import { AuditLogView } from '@/components/audit/AuditLogView';
import { ComplianceFrameworksView } from '@/components/compliance/ComplianceFrameworksView';
import { ConnectorsView } from '@/components/connectors/ConnectorsView';
import { MfaView } from '@/components/settings/MfaView';
import { RBACView } from '@/components/settings/RBACView';
import { DeploymentAIPanel, SettingsView } from '@/components/settings/SettingsView';
import { UsersView } from '@/components/settings/UsersView';
import { SectionTabs, type SectionTabItem } from '@/components/ui/SectionTabs';

const SETTINGS_TABS: readonly SectionTabItem[] = [
  { id: 'general', label: 'General', render: () => <SettingsView /> },
  { id: 'deployment', label: 'AI Settings', render: () => <DeploymentAIPanel /> },
  { id: 'connectors', label: 'Connectors', render: () => <ConnectorsView /> },
  {
    id: 'users',
    label: 'Users',
    adminOnly: true,
    render: () => (
      <div className="p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-fg-primary">Users</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Manage members and their roles. Role changes revoke the member&apos;s active sessions and are audited.
          </p>
        </div>
        <UsersView />
      </div>
    ),
  },
  {
    id: 'rbac',
    label: 'Roles & Permissions',
    render: () => (
      <div className="p-6">
        <RBACView />
      </div>
    ),
  },
  {
    id: 'mfa',
    label: 'Two-Factor Auth',
    render: () => (
      <div className="p-6">
        <MfaView />
      </div>
    ),
  },
  { id: 'compliance', label: 'Compliance', render: () => <ComplianceFrameworksView /> },
  { id: 'audit-logs', label: 'Audit Logs', render: () => <AuditLogView /> },
];

export function SettingsTabs({ defaultTab = 'general' }: { defaultTab?: string }) {
  const searchParams = useSearchParams();
  const initialTab =
    searchParams?.get('section') === 'deployment' && !searchParams.get('tab')
      ? 'deployment'
      : defaultTab;

  return (
    <SectionTabs
      tabs={SETTINGS_TABS}
      defaultTab={initialTab}
      ariaLabel="Settings groups"
    />
  );
}
