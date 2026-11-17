'use client';

/**
 * Global command palette (⌘K / Ctrl+K).
 *
 * Mirrors the sidebar navigation, exposes quick actions (refresh, toggle
 * Copilot dock, copy current URL, switch tenant placeholder) and a section
 * for "recent pages" sourced from `localStorage`. Built on top of `cmdk`
 * for solid keyboard ergonomics out of the box.
 *
 * The palette is mounted once in `AppShell` so every authenticated route
 * has access to it. We deliberately keep it client-only and decoupled from
 * the sidebar so we don't ship a giant bundle when users never open it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  shortcut?: string[];
  perform: () => void | Promise<void>;
}

interface PaletteGroup {
  id: string;
  heading: string;
  items: PaletteAction[];
}

const RECENT_STORAGE_KEY = 'aisoc.palette.recent';
const MAX_RECENT = 5;

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecent(path: string) {
  if (typeof window === 'undefined') return;
  try {
    const current = readRecent().filter((p) => p !== path);
    current.unshift(path);
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(current.slice(0, MAX_RECENT)),
    );
  } catch {
    // localStorage may be unavailable (private mode) — fail silent.
  }
}

const NAV_ITEMS: { label: string; href: string; keywords: string[]; adminOnly?: boolean }[] = [
  // [HIDDEN-UI NAV-8 seven dashboard entries collapsed into one destination]
  // { label: 'Dashboard',           href: '/dashboard',               keywords: ['home', 'overview', 'metrics'] },
  // { label: 'SOC Insights',        href: '/dashboards/soc-insights', keywords: ['insights', 'mtta', 'mttr', 'kpi'] },
  // { label: 'SOC Operations',      href: '/dashboards/operations',   keywords: ['operations', 'pipeline', 'throughput'] },
  // { label: 'Dashboards',          href: '/sla',                     keywords: ['sla', 'team analytics', 'mssp', 'cost', 'reports'] },
  { label: 'Dashboards',          href: '/dashboards',              keywords: ['dashboard', 'overview', 'metrics', 'insights', 'mtta', 'mttr', 'kpi', 'operations', 'pipeline', 'throughput', 'sla', 'team analytics', 'mssp', 'cost', 'reports'] },
  { label: 'Alerts',              href: '/alerts',                  keywords: ['notifications', 'incidents'] },
  { label: 'Investigation Queue', href: '/queue',                   keywords: ['queue', 'triage', 'entity risk'] },
  { label: 'Runbooks',            href: '/playbooks',               keywords: ['runbooks', 'playbooks', 'soar', 'automation'] },
  // [HIDDEN-UI CHROME-1 hide Hunt from command palette]
  // { label: 'Hunt',                href: '/hunt',                    keywords: ['threat hunting', 'search', 'kql', 'esql'] },
  /* [HIDDEN-UI NAV-9 rename Detection to Detection Rules]
  { label: 'Detection',           href: '/detection',               keywords: ['rules', 'detections', 'sigma', 'catalog', 'mitre', 'coverage', 'tuning'] },
  */
  { label: 'Detection Rules',     href: '/detection',               keywords: ['rules', 'detections', 'sigma', 'catalog', 'mitre', 'coverage', 'tuning'] },
  { label: 'Settings',            href: '/settings',                keywords: ['preferences', 'profile', 'tenant', 'connectors', 'users', 'rbac', 'mfa', 'compliance', 'audit'] },
  // Deep link into the AI tab. `SettingsTabs` selects on `?tab=`, so this used
  // to land on General while the TopBar title said "AI Settings".
  { label: 'AI Settings',         href: '/settings?tab=deployment', keywords: ['ai', 'llm', 'provider', 'model', 'byok'] },
  // [HIDDEN-UI NAV-1 consolidated into SectionTabs or hidden from primary navigation]
  // { label: 'Cases',        href: '/cases',        keywords: ['investigations', 'tickets'] },
  // { label: 'Explore',      href: '/explore',      keywords: ['data explorer', 'lake', 'sql', 'bi', 'query', 'identity', 'intel'] },
  // { label: 'Threat Intel', href: '/threat-intel', keywords: ['ioc', 'feeds', 'cti'] },
  // { label: 'Attack Graph', href: '/graph',        keywords: ['graph', 'paths', 'cytoscape'] },
  // { label: 'AI Copilot',   href: '/copilot',      keywords: ['assistant', 'chat', 'ai'] },
  // { label: 'Connectors',   href: '/connectors',   keywords: ['integrations', 'sources'] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  // Hotkey: ⌘K / Ctrl+K toggles. Ignore when the user is typing in Monaco
  // (the inline detection rule editor) so we don't hijack the editor's own
  // shortcuts. Other inputs are fine — analysts expect ⌘K to open everywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (!isToggle) return;
      const target = e.target as Element | null;
      if (target && typeof (target as Element).closest === 'function') {
        if ((target as Element).closest('.monaco-editor')) return;
      }
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Refresh "recent" each time we open so the list reflects other tabs / sessions.
  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  // Track current page so it appears in recents next time the palette opens.
  useEffect(() => {
    if (!pathname) return;
    if (pathname === '/' || pathname.startsWith('/login')) return;
    writeRecent(pathname);
  }, [pathname]);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes the palette.
  //
  // `cmdk@1.1.1` ships no Escape handling of its own (there is no "Escape"
  // string anywhere in its dist), so the `ESC` keycap this dialog renders was
  // decoration: the key did nothing, and the only ways out were the backdrop or
  // choosing an item. A modal that can only be dismissed by pointer is a
  // keyboard trap — WCAG 2.1.2 — and every other dialog in the console already
  // honours Escape, so this is also the behaviour an analyst arrives with.
  //
  // Bound on `document` in the capture phase rather than on the dialog: the
  // focus can be inside `Command.Input`, and the palette's own shortcut listener
  // on `window` must not swallow the key first.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
      close();
    },
    [router, close],
  );

  const groups = useMemo<PaletteGroup[]>(() => {
    const isAdmin = authApi.currentUser()?.role === 'admin';
    const navGroup: PaletteGroup = {
      id: 'navigation',
      heading: 'Navigation',
      items: NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => ({
        id: `nav:${item.href}`,
        label: item.label,
        hint: item.href,
        keywords: item.keywords,
        perform: () => navigate(item.href),
      })),
    };

    const quickGroup: PaletteGroup = {
      id: 'actions',
      heading: 'Quick actions',
      items: [
        // [HIDDEN-UI CHROME-2 hide floating Copilot dock quick action]
        // {
        //   id: 'action:copilot',
        //   /* [HIDDEN-UI THEME-2 visible product name changed to ClopsSOC] label: 'Ask AiSOC Copilot', */
        //   /* [HIDDEN-UI CHROME-1 rename product to ClopSOC] label: 'Ask ClopsSOC Copilot', */
        //   label: 'Ask ClopSOC Copilot',
        //   hint: 'Open the floating Copilot dock',
        //   shortcut: ['⌘', 'J'],
        //   keywords: ['ai', 'copilot', 'assistant', 'investigate'],
        //   perform: () => {
        //     // Tell the floating dock to open. Lives in CopilotDock.tsx.
        //     window.dispatchEvent(new Event('aisoc:open-copilot'));
        //     close();
        //   },
        // },
        // [HIDDEN-UI NAV-1 full /copilot page hidden; floating CopilotDock remains active]
        // {
        //   id: 'action:full-copilot',
        //   label: 'Open AI Copilot page',
        //   hint: 'Full conversation view',
        //   keywords: ['copilot', 'ai', 'chat'],
        //   perform: () => navigate('/copilot'),
        // },
        {
          id: 'action:refresh',
          label: 'Refresh data',
          hint: 'Reload the current page',
          keywords: ['reload', 'refresh', 'update'],
          perform: () => {
            close();
            window.location.reload();
          },
        },
        {
          id: 'action:copy-url',
          label: 'Copy current URL',
          hint: 'Useful for sharing a view',
          keywords: ['share', 'link', 'url'],
          perform: async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              toast.success('URL copied to clipboard');
            } catch {
              toast.error('Could not copy URL');
            }
            close();
          },
        },
      ],
    };

    const recentGroup: PaletteGroup | null = recent.length
      ? {
          id: 'recent',
          heading: 'Recent pages',
          items: recent
            .filter((href) => href !== pathname)
            .map((href) => {
              const match = NAV_ITEMS.find((item) => href.startsWith(item.href));
              return {
                id: `recent:${href}`,
                label: match ? match.label : href,
                hint: href,
                perform: () => navigate(href),
              };
            }),
        }
      : null;

    return recentGroup ? [navGroup, quickGroup, recentGroup] : [navGroup, quickGroup];
  }, [recent, pathname, navigate, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          aria-modal="true"
          role="dialog"
          aria-label="Command palette"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={close}
          />

          <motion.div
            initial={{ y: -8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="relative w-full max-w-xl rounded-container border border-surface-border-strong bg-surface-card shadow-overlay overflow-hidden"
          >
            <Command
              /* [HIDDEN-UI CHROME-1 rename product to ClopSOC] label="ClopsSOC command palette" */
              /* [HIDDEN-UI CHROME-3 rename product to SOC] label="ClopSOC command palette" */
              label="SOC command palette"
              loop
              className="flex flex-col"
            >
              <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3">
                <svg
                  className="w-4 h-4 text-fg-subtle shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  />
                </svg>
                <Command.Input
                  autoFocus
                  placeholder="Type a command, search a page, or ask the Copilot…"
                  className="flex-1 bg-transparent text-body text-fg-primary placeholder:text-fg-subtle outline-none"
                />
                <kbd className="rounded-control border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-eyebrow font-mono text-fg-muted">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-96 overflow-y-auto py-2">
                <Command.Empty className="px-4 py-6 text-center text-control-sm text-fg-muted">
                  No matches. Try “alerts”, “hunt”, or “copilot”.
                </Command.Empty>

                {groups.map((group) => (
                  <Command.Group
                    key={group.id}
                    heading={group.heading}
                    className="px-2 pb-2 text-eyebrow font-semibold uppercase tracking-wider text-fg-subtle"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${item.hint ?? ''} ${(item.keywords ?? []).join(' ')}`}
                        onSelect={() => {
                          void item.perform();
                        }}
                        className="group flex items-center gap-3 rounded-control px-3 py-2 text-body text-fg-secondary cursor-pointer aria-selected:bg-nav-active-bg aria-selected:text-accent"
                      >
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint && (
                          <span className="text-caption text-fg-subtle group-aria-selected:text-accent truncate max-w-xs text-right">
                            {item.hint}
                          </span>
                        )}
                        {item.shortcut && (
                          <span className="flex items-center gap-0.5">
                            {item.shortcut.map((key) => (
                              <kbd
                                key={key}
                                className="rounded-control border border-surface-border bg-surface-elevated px-1 py-0.5 text-eyebrow font-mono text-fg-muted"
                              >
                                {/* [HIDDEN-UI THEME-7 prior keycap class: rounded] */}
                                {key}
                              </kbd>
                            ))}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>

              <div className="flex items-center justify-between border-t border-surface-border px-4 py-2 text-caption text-fg-subtle">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    {/* [HIDDEN-UI THEME-7 use control radius for keycaps]
                    <kbd className="rounded border border-surface-border bg-surface-elevated px-1 py-0.5 font-mono text-fg-muted">↑</kbd>
                    <kbd className="rounded border border-surface-border bg-surface-elevated px-1 py-0.5 font-mono text-fg-muted">↓</kbd>
                    */}
                    <kbd className="rounded-control border border-surface-border bg-surface-elevated px-1 py-0.5 font-mono text-fg-muted">↑</kbd>
                    <kbd className="rounded-control border border-surface-border bg-surface-elevated px-1 py-0.5 font-mono text-fg-muted">↓</kbd>
                    navigate
                  </span>
                  <span className="flex items-center gap-1">
                    {/* [HIDDEN-UI THEME-7 use control radius for keycaps]
                    <kbd className="rounded border border-surface-border bg-surface-elevated px-1 py-0.5 font-mono text-fg-muted">↵</kbd>
                    */}
                    <kbd className="rounded-control border border-surface-border bg-surface-elevated px-1 py-0.5 font-mono text-fg-muted">↵</kbd>
                    select
                  </span>
                </div>
                {/* [HIDDEN-UI CHROME-1 rename product to ClopSOC] <span className="hidden sm:inline">ClopsSOC · ⌘K to toggle</span> */}
                {/* [HIDDEN-UI CHROME-3 rename product to SOC] <span className="hidden sm:inline">ClopSOC · ⌘K to toggle</span> */}
                <span className="hidden sm:inline">SOC · ⌘K to toggle</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
