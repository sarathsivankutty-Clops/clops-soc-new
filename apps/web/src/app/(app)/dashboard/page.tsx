import { redirect } from 'next/navigation';
// [HIDDEN-UI NAV-8 dashboard consolidated into /dashboards?tab=overview]
// import { DashboardView } from '@/components/dashboard/DashboardView';

export const metadata = {
  title: 'Dashboard',
};

/**
 * `/dashboard` was the entry point for the whole console: the login fallback,
 * the landing hero, `next.config.js`'s `/signup` redirect and every retired
 * route in `(app)` all still point at it. It is now the Overview tab of
 * `/dashboards`, so the path keeps answering with a 307 rather than a 404 —
 * every one of those links is outside this phase's scope, and a redirect is
 * the one change that keeps them working.
 *
 * `?welcome=1` is forwarded: onboarding's "Skip & explore" uses it to open the
 * welcome card, and `DashboardWelcome` reads it from the tab route now.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // [HIDDEN-UI NAV-8 replaced direct view with a redirect]
  // return <DashboardView />;
  const params = (await searchParams) ?? {};
  const welcome = params.welcome;
  const query =
    typeof welcome === 'string' && welcome
      ? `?tab=overview&welcome=${encodeURIComponent(welcome)}`
      : '?tab=overview';
  redirect(`/dashboards${query}`);
}
