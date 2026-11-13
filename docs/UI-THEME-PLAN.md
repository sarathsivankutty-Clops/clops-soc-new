# UI Theme Adaptation Plan (SREOps → AiSOC Console)

Branch: `ui-theme` (from `ui-nav`). Read-only plan; SOC routes, APIs, tab groups, and permission gates stay unchanged.

## 1. Reference Inventory (`ui_src_final/src`)
- **Tokens (`styles/app.css`)**:
  - Light (`:root,[data-theme="light"]`, `:21-38`): `--bg:#F8FAFC`, `--bg2:#FFFFFF`, `--surf:#FFFFFF`, `--surf2:#F8FAFC`, `--surf3:#F1F5F9`, `--bd:#E2E8F0`, `--bd2:#CBD5E1`, `--line:#EEF2F7`, `--t:#0F172A`, `--t2:#475569`, `--m:#64748B`, `--m2:#94A3B8`, `--ac:#2563EB`, `--ac2:#1D4ED8`, `--nav-active-bg:#EFF6FF`, `--nav-active-bar:#10B981`, `--g:#059669`, `--am:#D97706`, `--r:#E11D48`, `--p:#7C3AED`, `--pill-*`/`--dot-*`, `--shadow:0 1px 3px rgba(15,23,42,.05)`.
  - Dark (`[data-theme="dark"]`, `:41-55`): `--bg:#0B1220`, `--bg2:#111B2E`, `--surf:#111B2E`, `--surf2:#172442`, `--surf3:#1C2840`, `--bd:#2A3A55`, `--bd2:#36496A`, `--line:#223150`, `--t:#F1F5F9`, `--t2:#94A3B8`, `--m:#94A3B8`, `--m2:#64748B`, `--ac:#3B82F6`, `--ac2:#60A5FA`, `--nav-active-bg:rgba(59,130,246,.12)`, `--nav-active-bar:#52B788`, `--g:#52B788`, `--am:#FBBF24`, `--r:#FB7185`, `--p:#A78BFA`.
  - Scale (`:57-71,:190-258`): `--font:'Inter'`, `--mono:ui-monospace,'JetBrains Mono'`, `--radius:1.25rem`, `--radius-sm:0.75rem`, `--radius-pill:9999px`, `--btn-grad:linear-gradient(135deg,#2563EB,#22C55E)`, `--sidebar-w:256px`, body `13px`, `.content` padding `28px 32px 64px` (`max-width:1320px`), `.page-title` `22px`, `.kpi-v` `28px`, `.pane`/`.card` padding `18px`.
- **Shell (`components/Shell.tsx:18-152`, `app.css:81-178`)**: collapsible `256px` sidebar, left `2px` `--nav-active-bar` indicator, sidebar-foot theme switch + user role card, `60px` topbar with collapse chevron + breadcrumb + dual light/dark logo PNG, renders `<Copilot />`.
- **Shared (`components/ui.tsx:9-149`, `Overlays.tsx:5-50`, `Copilot.tsx:12-107`, `app.css:204-766`)**: `KpiCard`, `MetricStrip` (1px `--bd` divider grid), `PageHead` (eyebrow/title/desc/actions), `FeedItem`, `EmptyState`, `LineChart`, `Donut`, `Topology`, `.btn.primary` gradient CTA, `.badge` (`12%` alpha pill + dot), `.pane`/`.split`/`.split-wide`, `.tbl`, `.filters`/`.fchip`/`.seg`, `#copilot-fab` (`54px` gradient orb) + `.copilot` drawer, `.auth-body` (`styles/auth.css:13-100`).
- **Patterns (`screens/*.tsx`)**: `Overview.tsx` (time `.seg` + 5-col `MetricStrip` + chart + split), `Incidents.tsx` (4-col `MetricStrip` + `.fchip` + `.tbl`), `IncidentDetail.tsx` (`detail-grid` 2-col + Jira link + `Escalate`), `Connectors.tsx` (`MetricStrip` + `.cap-tabs` + `.cap-avail-row`), `Analytics.tsx` (4-col `MetricStrip` + `LineChart` + `Donut`), `Settings.tsx` (user table + filters).

## 2. SOC Inventory (`apps/web`, `packages/ui`)
- **Tokens (`apps/web/src/app/globals.css:28-98`, `tailwind.config.ts:1-199`)**: Dark-first CSS vars (`--surface-{base:#0a0d14, raised:#11151f, card:#141926, hover:#1a2030, subtle:#0d1119}`, `--fg-{primary:#e2e8f0, secondary:#cbd5e1, muted:#9ca3af, subtle:#6b7280}`); light vars (`#f8fafc`/`#ffffff`/`#0f172a`/`#334155`/`#64748b`); `brand.50..900` (`#2563eb`–`#1e3a8a`), `severity.*`, `status.*`. `ThemeProvider.tsx:1-146` (`light|dark|system`, `localStorage["aisoc-theme"]`).
- **Shell**: `AppShell.tsx:1-103` (`md:ml-60`), `Sidebar.tsx:153-402` (`w-60`, 10 flat items, `adminOnly`, `LiveQueueBadge`), `TopBar.tsx:15-253` (`h-16`, `routeLabels`, `⌘K` `CommandPalette.tsx`, `TimeWindowSelector`, `TenantSwitcher`, `RoleBadge`, clock, `ThemeToggle.tsx`, notifications, static `SO` avatar), `SectionTabs.tsx:1-89` (`?tab=`, `replaceState`, `adminOnly`), `CopilotDock.tsx:1-355` (bottom-right emerald pill `⌘J` + dark `slate-900` drawer).
- **Primitives & Branding**: `components/ui/*` (`Badge`, `Button`, `Card`, `EmptyState`, `ErrorState`, `FailureBanner`, `CapabilityUnavailable`, `SectionTabs`, `Skeleton`, `StatusPill` — several still use raw `gray-*`/`blue-*` classes); `packages/ui/src/index.ts` (`MetricCard`, `DataTable`, `AlertCard`, `SeverityBadge`, `StatusBadge`, `Timeline`, `SearchInput`). Org branding uses **DB/API (`brandingApi.get`/`logo` -> `/api/v1/branding`)** via `hooks/useBranding.ts:16-86`, `BrandedDocumentTitle.tsx`, `BrandingPanel.tsx`, NOT `NEXT_PUBLIC_ORG_*` env vars (only `NEXT_PUBLIC_APP_VERSION` in `next.config.js:125`).
- **Equivalents**: `MetricStrip`/`KpiCard` <-> inline `DashboardView` `MetricCard` + `@aisoc/ui` `MetricCard`; `.badge` <-> `Badge` + `StatusPill`; `EmptyState` <-> `ui/EmptyState`; `LineChart`/`Donut` <-> `recharts` in `DashboardView`; `ToastHost`/`ModalHost` <-> `react-hot-toast` + modal components; `Copilot` <-> `CopilotDock`.

## 3. Gap Table (Tokens Light & Dark + Elements)
| SREOps Element | SOC Equivalent | Action | Risk |
| --- | --- | --- | --- |
| Surface dark (`#0B1220`/`#111B2E`/`#172442`/`#1C2840`) & border (`#2A3A55`) | `globals.css:28-68` (`#0a0d14`/`#11151f`/`#141926`/`rgba(148,163,184,.12)`) | **restyle** CSS vars | Low; contrasts must pass WCAG AA (`a11y.test.tsx`) |
| Surface light (`#F8FAFC`/`#FFFFFF`/`#F1F5F9`), bd (`#E2E8F0`) | `globals.css:70-98` (`#f8fafc`/`#ffffff`/`#f1f5f9`) | **reuse/tune** border+hover | Low; fixes raw `gray-*` light-mode clashes |
| Accent/semantic (`--ac` `#2563EB`/`#3B82F6`, `--nav-active-bar` `#10B981`/`#52B788`, `--btn-grad`) | `tailwind.config.ts` `brand.*` + emerald dock | **restyle** via semantic CSS vars | Med; keep `branding.primary_color`/`accent_color` override |
| Radius (`1.25rem`/`0.75rem`) & shadows | `rounded-xl`/`rounded-lg` | **restyle** tokens | Low; updates `storybook-snapshots` |
| Collapsible Sidebar (`256px`), `--nav-active-bar`, user card | `Sidebar.tsx` (`w-60`), `TopBar.tsx` avatar | **restyle** + optional collapse | Med; keep `TimeWindowSelector`, `TenantSwitcher`, `RoleBadge` |
| `PageHead` + `.seg` + `.fchip` | `TopBar` route title + inline headers | **restyle** (`SectionTabs` too) | Low |
| `MetricStrip` / `KpiCard` (1px hairline grid) | Inline `DashboardView` `MetricCard` | **build new** in `components/ui/` | Med; decouple page metrics cleanly |
| `Card`/`Pane`, `Badge`/`StatusPill`, `Button`, `EmptyState`, `Skeleton` | `components/ui/{Card,Badge,StatusPill,Button,EmptyState,Skeleton}` | **restyle** to semantic tokens | High snapshot churn (`storybook-snapshots.test.tsx`) |
| `.tbl` / `.split` / `.detail-grid` | Tailwind tables / grids per view | **restyle** shared wrappers | Low |
| `#copilot-fab` (`54px` gradient orb) + `.copilot` | `CopilotDock.tsx` (emerald pill + `slate-900`) | **restyle** with CSS tokens | Low; preserve `Ask Copilot` aria-label & `⌘J` |
| `Shell.tsx` `logoDark`/`logoLight`, `Keycloak`, `Jira` | `useBranding`, native auth | **skip** | Avoids brand/auth leaks |

## 4. Do-Not-Copy List
- **Strings/Brand**: `"SREOps Platform"`, `"CloudifyOps"`, `"SRE Agent"`, `"payments-prod"`, `"platform-shared"`, `"Investigated by CloudifyOps SRE Agent"`, AWS EC2/RDS/SG/TGW copy (`ui_src_final/src/data/copilot.ts:3-37`, `mock.ts:39-60`, `api.ts:163`).
- **Assets & URLs**: `assets/logo-dark.png`, `assets/logo-light.png` (`Shell.tsx:6-7,140`), `https://api.sreops.cloudifyops.com/...` (`mock.ts:128`, `Connectors.tsx:514`), `https://cloudifyops.atlassian.net/browse/` (`IncidentDetail.tsx:10`), `cloudifyops-workspace`/`cloudifyops.slack.com` (`mock.ts:165-173`).
- **Auth/Endpoints/Mock**: `src/lib/keycloak.ts` (`sreops-realm`, `sre-platform-web`, `localhost:8081`, `@gmail.com` block, hardcoded admin email `:191`), `src/data/api.ts:9` (`/api/metrics`), `src/data/mock.ts`, `auth.css` signup tabs (keep self-signup disabled per SOC auth policy), Jira/GitLab/Slack/MCP/Lambda wizards (`screens/Register*.tsx`, `RotateWebhook.tsx`, `ConfigureWebhook.tsx`).

## 5. SOC Screen Mapping
| SOC Nav / Tab Group | Route(s) & View | Adapted Pattern | Data Gaps vs SREOps |
| --- | --- | --- | --- |
| Dashboard | `/dashboard` (`DashboardView`) | `Overview.tsx` (time controls + KPI strip + chart + 2-col feed) | None |
| SOC Insights | `/dashboards/soc-insights` (`SOCInsightsView`) | `Analytics.tsx` (4-col KPI tiles + trend panes) | None |
| SOC Operations | `/dashboards/operations` (`OperationsDashboard`) | `ActionCenter` + pipeline health split panes | None (`/api/v1/approvals` exists) |
| Alerts | `/alerts` (`AlertsView`), `/alerts/[id]` (`AlertDetailView`) | `Incidents.tsx` (`.fchip` + `.tbl`), `IncidentDetail.tsx` (`detail-grid`) | **Lacks** Jira issue link, AWS Change/VPC `Topology`, shift `Escalate` flow |
| Investigation Queue | `/queue` (`QueueView`) | `Incidents.tsx` filter strip + `.tbl` | None |
| Hunt | `/hunt` (`HuntView`) | `.pane` query bar + `.cli-block` + `.tbl` | None |
| Detection (`SectionTabs`) | `/detection` (`rules`, `catalog`, `coverage`, `tuning`) | `.cap-tabs` hairline tabs + `.fchip`/`.tbl`/`.sla-bar` | None |
| Runbooks | `/playbooks` (`PlaybooksView`, `[id]` `PlaybookEditor`) | `Runbooks.tsx` (`MetricStrip` + grid/cards) | None |
| Dashboards (`SectionTabs`) | `/sla` (`sla`, `team`, `mssp`, `costs`) | `Analytics.tsx` (`MetricStrip` + `.sla-row` + `.tbl`) | None |
| Settings (`SectionTabs`) | `/settings` (`general`, `connectors`, `users` `adminOnly`, `rbac`, `mfa`, `compliance`, `audit-logs`) | `Settings.tsx` + `Connectors.tsx` (`MetricStrip` + `.cap-avail-row`) | **Connectors** lacks SREOps MCP/Skill/Lambda-webhook backend |
| Auth (`/login`) | `/login` (`LoginPage`) | `auth.css` card/gradient palette (sign-in only) | Exclude signup tab |

## 6. Execution Phases (T1–T6)
**Baseline (`AGENTS.md` §4, `ui-nav`)**: `type-check` 0 errors; `lint` 0 errors / 95 warnings; `build` passed (105 static pages); `test` 124/126 files passed, 1,257/1,260 passed, 3 failures (`a11y.test.tsx` timeout on `AlertsView`, 2 CRLF checks in `MitrePanelWording.test.tsx`); `check:tokens` N/A.
- **T1 (Tokens)**: Update `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`, `ThemeProvider.tsx` (`--surface-*`, `--fg-*`, `--brand-*`, `--nav-active-*`, `--radius-*`, `--shadow-*` light+dark). *Tests at risk*: `ThemeProvider.test.tsx`.
- **T2 (Shell & Nav Chrome)**: Restyle `Sidebar.tsx`, `TopBar.tsx`, `AppShell.tsx`, `SectionTabs.tsx`, `CommandPalette.tsx`, `ThemeToggle.tsx`, `RoleBadge.tsx`, `TenantSwitcher.tsx`, `TimeWindowSelector.tsx` (semantic tokens, `256px`/collapsible consideration, left accent bar, tab hairline bar). *Tests*: `Sidebar.test.tsx`, `SidebarBranding.test.tsx`, `TopBar.test.tsx`, `BrandedDocumentTitle.test.tsx`, `SectionTabs.test.tsx`, `a11y.test.tsx`.
- **T3 (Shared Primitives)**: Migrate `components/ui/{Badge,Button,Card,EmptyState,ErrorState,FailureBanner,CapabilityUnavailable,Skeleton,StatusPill}.tsx` from raw `gray-*`/`blue-*` to tokens + add `KpiStrip`/`MetricCard` primitive. *Tests*: `storybook-snapshots.test.tsx` (update `.snap`), `EmptyState.test.tsx`, `BannerHonesty.test.tsx`, `CapabilityUnavailable.test.tsx`.
- **T4 (Core SOC Screens)**: Restyle `DashboardView`, `SOCInsightsView`, `OperationsDashboard`, `AlertsView`, `AlertDetailView`, `QueueView`, `HuntView`. *Tests*: `Dashboard*test.tsx`, `Alerts*test.tsx`, `QueueView.test.tsx`, `Hunt*test.tsx`, `OperationsDashboard.test.tsx`, `SOCInsightsView.test.tsx`.
- **T5 (Remaining Screens)**: Restyle `Detection*`/`Coverage*`/`RuleTuning*`, `Playbooks*`, `SLADashboard`, `TeamAnalyticsView`, `MSSPDashboardView`, `CostDashboardView`, `Settings*`, `ConnectorsView`, `UsersView`, `RBACView`, `MfaView`, `ComplianceFrameworksView`, `AuditLogView`, `login/page.tsx`. *Tests*: `*View.test.tsx`, `SettingsView.*.test.tsx`.
- **T6 (Floating AI Copilot)**: Restyle `CopilotDock.tsx` launcher orb + drawer header/context pills/chat bubbles to match SREOps `Copilot` tokens while retaining `Ask Copilot` aria-label, `⌘J`, `copilotApi.chat`, and demo gating. *Tests*: `copilotReply.test.ts` + UI/a11y checks.

## 7. Open Questions
1. Should pending response approvals stay inside **SOC Operations** (`/dashboards/operations`), or should T4 surface them via an "Action Center" card/tab?
2. For TopBar/Sidebar branding: keep the `AiSOC` vector shield + dynamic `brandingApi` tenant logo (`SidebarBranding`), or replace the unbranded default mark with a new `apps/web/public` SVG/PNG asset?
3. Product naming: confirm keeping `AiSOC` / `AI Copilot` everywhere unbranded (never `SREOps` / `CloudifyOps` / `SRE Agent`).
4. Confirm **Jira link/create** (`AlertDetailView` `[TODO-BACKEND]`), **Escalate** handoff, and **MCP/Lambda Connector** wizards remain out of scope for T1–T6.
5. Keep solid `--brand-600` primary buttons (`Button.tsx`) or adopt SREOps blue-to-green gradient (`--btn-grad`) on primary CTAs & Copilot orb only?
6. Leave `packages/ui` (`@aisoc/ui`), `(marketing)`, and `(tools)` untouched during T1–T6, scoping changes strictly to console `(app)`/`(admin)` + `/login`?
7. Keep dark theme as default (`themeScript.ts`) while calibrating light-mode tokens to SREOps (`#F8FAFC` / `#FFFFFF` / `#E2E8F0`)?
