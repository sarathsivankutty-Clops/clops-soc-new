'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

/** Keep deep links, tab clicks and browser history on the same source of truth. */
export function useUrlTab<T extends string>(
  tabs: readonly T[],
  defaultTab: T,
  paramKey = 'tab',
) {
  const searchParams = useSearchParams();
  const tab = tabs.find((candidate) => candidate === searchParams?.get(paramKey)) ?? defaultTab;

  const setTab = useCallback((next: T) => {
    const url = new URL(window.location.href);
    const current = tabs.find((candidate) => candidate === url.searchParams.get(paramKey)) ?? defaultTab;
    if (next === current) return;

    url.searchParams.set(paramKey, next);
    // [HIDDEN-UI NAV-6 use replaceState so Back does not step through every tab]
    // window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [tabs, defaultTab, paramKey]);

  return [tab, setTab] as const;
}
