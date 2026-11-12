import { Suspense } from 'react';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
// [HIDDEN-UI NAV-4 moved into Settings SectionTabs]
// import { SettingsView } from '@/components/settings/SettingsView';
import { SkeletonCard } from '@/components/ui/Skeleton';

export const metadata = {
  title: 'Settings',
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      {/* [HIDDEN-UI NAV-4 wrapped SettingsView in SectionTabs] */}
      {/* <SettingsView /> */}
      <SettingsTabs />
    </Suspense>
  );
}
