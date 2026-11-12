# AGENTS.md

Repository guide for AiSOC (`aisoc-monorepo`), verified against files on disk.

## 1. Repo Layout

### `apps/`
- `apps/docs`: Docusaurus 3 documentation site (`apps/docs/package.json`).
- `apps/mobile`: React Native / Expo responder app, excluded from root pnpm workspace (`pnpm-workspace.yaml`, `apps/mobile/package.json`).
- `apps/web`: Next.js 16 SOC console, marketing site, free tools, and responder PWA (`apps/web/package.json`).

### `services/`
- `services/actions`: Python/FastAPI blast-radius-gated response action executor with rollback (`services/actions/pyproject.toml`).
- `services/agents`: Python LangGraph orchestrator for autonomous triage, investigation, copilot, and hunts (`services/agents/pyproject.toml`).
- `services/api`: Python/FastAPI core API for auth, alerts, cases, RBAC, and vault-encrypted connectors (`services/api/pyproject.toml`).
- `services/connectors`: Python/FastAPI polling service normalizing vendor telemetry to OCSF (`services/connectors/README.md`).
- `services/demo-producer`: Go CLI emitting synthetic security events into ingest for demos (`services/demo-producer/README.md`).
- `services/enrichment`: Go parallel IOC enrichment fan-out service (`services/enrichment/README.md`).
- `services/escalations`: Python ack-clock escalation bridge for unacknowledged critical/high cases (`services/escalations/README.md`).
- `services/fusion`: Python alert deduplication, correlation, detection engine, and entity-risk service (`services/fusion/pyproject.toml`).
- `services/honeytokens`: Python deception token generation and first-touch alerting service (`services/honeytokens/pyproject.toml`).
- `services/ingest`: Go raw-event ingestion, OCSF normalization, ATT&CK mapping, and Kafka publisher (`services/ingest/main.go`).
- `services/mcp`: TypeScript `@aisoc/mcp` server plus IDE extension in `services/mcp/cursor-extension/` (`services/mcp/package.json`).
- `services/mesh`: Python federated threat-intel mesh hub and client (`services/mesh/pyproject.toml`).
- `services/osquery-extensions`: Go osquery virtual-table extension for host state and pending actions (`services/osquery-extensions/main.go`).
- `services/osquery-tls`: Python direct osqueryd TLS endpoint for packs, FIM, and distributed queries (`services/osquery-tls/pyproject.toml`).
- `services/purple-team`: Python Atomic Red Team / Caldera emulation, ATT&CK coverage, and drift service (`services/purple-team/pyproject.toml`).
- `services/realtime`: Node WebSocket/SSE live-event gateway (`services/realtime/package.json`).
- `services/slack-bot`: Python Slack ChatOps slash commands and approval flows (`services/slack-bot/README.md`).
- `services/teams-bot`: Python Microsoft Teams Adaptive Card ChatOps approval flows (`services/teams-bot/README.md`).
- `services/threatintel`: Python TAXII/STIX/MISP/OTX threat-intelligence feed service (`services/threatintel/pyproject.toml`).
- `services/ueba`: Python User & Entity Behaviour Analytics scoring microservice (`services/ueba/pyproject.toml`).

### `packages/`
- `packages/aisoc-action`: `@aisoc/action` GitHub Action triaging repo security signals (`packages/aisoc-action/package.json`).
- `packages/aisoc-ai-sdk`: Python SDK emitting AI runtime telemetry and guardrail findings (`packages/aisoc-ai-sdk/pyproject.toml`).
- `packages/aisoc-benchmark`: Python SOC-agent grading harness over a common corpus (`packages/aisoc-benchmark/pyproject.toml`).
- `packages/aisoc-cli`: Python developer CLI for scaffolding/validating plugins and detections (`packages/aisoc-cli/pyproject.toml`).
- `packages/aisoc-detections`: Python detection-as-code framework with inline fixture tests (`packages/aisoc-detections/pyproject.toml`).
- `packages/aisoc-lite`: `aisoc` CLI wedge for offline deterministic alert triage (`packages/aisoc-lite/package.json`).
- `packages/aisoc-migrate`: Python inbound SPL/KQL/EQL detection translator (`packages/aisoc-migrate/inbound.py`).
- `packages/aisoc-packs`: Python content-pack schema and validator (`packages/aisoc-packs/pack_schema.py`).
- `packages/aisoc-sandbox`: Python offline agent investigation sandbox (`packages/aisoc-sandbox/pyproject.toml`).
- `packages/ocsf`: `@aisoc/ocsf` OCSF TypeScript types and normalization helpers (`packages/ocsf/package.json`).
- `packages/plugin-sdk-go`: Go SDK for custom connectors, enrichers, and response actions (`packages/plugin-sdk-go/README.md`).
- `packages/plugin-sdk-py`: Python SDK for custom connectors, enrichers, and response actions (`packages/plugin-sdk-py/pyproject.toml`).
- `packages/report-card`: `@aisoc/report-card` SVG/Markdown share-card renderer (`packages/report-card/package.json`).
- `packages/sdk-go`: Go client models for AiSOC (`packages/sdk-go/go.mod`).
- `packages/sdk-py`: Python typed `httpx` client SDK (`packages/sdk-py/pyproject.toml`).
- `packages/sdk-ts`: `@aisoc/sdk` TypeScript client checked against `docs/openapi.yaml` (`packages/sdk-ts/package.json`).
- `packages/types`: `@aisoc/types` shared platform TypeScript interfaces (`packages/types/package.json`).
- `packages/ui`: `@aisoc/ui` shared React UI component library (`packages/ui/package.json`).

### `infra/`
- `infra/cloudflare`: Cloudflare Tunnel config and startup script (`infra/cloudflare/README.md`).
- `infra/compose`: Docker Compose overlays: `airgap`, `demo`, `dev`, `gpu`, `host-llm` (`infra/compose/`).
- `infra/coolify`: Coolify self-hosting VPS deployment guide (`infra/coolify/README.md`).
- `infra/docker`: Prometheus, Alertmanager, Grafana dashboards, and OTel/Tempo configs (`infra/docker/`).
- `infra/fly`: Fly.io manifests and scripts; README notes nothing currently deployed (`infra/fly/README.md`).
- `infra/helm`: Kubernetes Helm chart and HA values (`infra/helm/README.md`).
- `infra/litellm`: LiteLLM task-alias gateway routing config (`infra/litellm/config.yaml`).
- `infra/postgres`: Postgres `initdb` migration and runtime-role bootstrap scripts (`infra/postgres/initdb/`).
- `infra/railway`: Railway 4-service demo deployment config (`infra/railway/README.md`).
- `infra/terraform`: AWS/cloud Terraform provisioning modules (`infra/terraform/README.md`).

## 2. Frontend (`apps/web`)
- **Framework & versions** (`apps/web/package.json`, `apps/web/next.config.js`): `next@16.4.5` (Turbopack, `turbopack.root` at repo root, `typescript.ignoreBuildErrors: true`), `react@^19.3.1`, `react-dom@^19.3.1`, `typescript@^6.0.3`, `tailwindcss@^4.3.4`, `swr@^2.5.1`, `zustand@^5.0.16`, `lucide-react@^1.59.0`, `recharts@^3.10.1`, `framer-motion@^14.9.1`, `cytoscape@^3.34.4`, `@xyflow/react@^12.12.0`, `@monaco-editor/react@^4.6.0`, `cmdk@^1.1.1`, `vitest@^4.1.12`, `eslint@^9.39.0`. (`package.json` `description` still says "Next.js 14 Frontend".) `next.config.js` proxies `/auth/*`, `/ws/*`, `/sse`, `/api/v1/*` via `rewrites()` and redirects `/signup` -> `/dashboard` (`permanent: true`).
- **Router structure** (`apps/web/src/app/`): App Router with root `layout.tsx` (`FontPreloads`, `themeBootstrapScript`, `localeBootstrapScript`, `PwaBootstrap`, `LocaleProvider`, `ThemeProvider`, `Toaster`) and 5 route groups: `(app)/layout.tsx` (`AppShell` with server `demoModeReport().enabled`), `(admin)/layout.tsx` (`AppShell`), `(marketing)/layout.tsx` (`.velvet-root` + `StickyNav` + `Footer`), `(responder)/layout.tsx` (`ResponderShell`), `(tools)/layout.tsx` (unauthenticated inline-styled shell), plus standalone root routes (`/`, `/login`, `/benchmark`, `/why-open-source`, `/r/[slug]`, `/not-found`, `/api/*`).
- **Navigation**: `config/navigation.ts` and `WorkspaceTabBar` do **not** exist. Console navigation is inline in `apps/web/src/components/layout/Sidebar.tsx` (`navSections`, `adminOnly` on `/settings/users`, `LiveQueueBadge`), duplicated in `apps/web/src/components/layout/CommandPalette.tsx` (`NAV_ITEMS` for Cmd/Ctrl+K), and titled in `apps/web/src/components/layout/TopBar.tsx` (`routeLabels`, `TimeWindowSelector`, `TenantSwitcher`, `RoleBadge`, `ThemeToggle`). `apps/web/src/components/layout/AppShell.tsx` mounts `<SWRConfig value={{ revalidateOnMount: true, revalidateIfStale: true }}>`, `DemoAutoLogin`, `TimeWindowProvider`, `TenantProvider`, `DemoBanner`, `BrandedDocumentTitle`, `Sidebar`, `TopBar`, and `<ClientOnly>` `CopilotDock` + `CommandPalette`. Responder nav lives in `apps/web/src/components/responder/ResponderShell.tsx` (`NAV_ITEMS`).
- **Theming**: `apps/web/src/app/globals.css` (`@import "tailwindcss"; @config "../../tailwind.config.ts";`) defines `:root, [data-theme="dark"]` and `[data-theme="light"]` CSS vars (`--surface-*`, `--fg-*`, `--landing-grad-*`) plus `.velvet-root` (`--velvet-*`) for landing/marketing pages. `apps/web/tailwind.config.ts` binds `surface.*`, `fg.*`, `brand.*`, `severity.*`, `status.*`, `landing.*`, and `velvet.*`. `apps/web/src/components/theme/ThemeProvider.tsx` + `themeScript.ts` persist `localStorage["aisoc-theme"]` (`dark` | `light` | `system`), sync `<html data-theme>` pre-paint, and call `authApi.updateUserPreferences({ theme })`.
- **Shared UI primitives**: `apps/web/src/components/ui/` (`Badge`, `Button`, `CapabilityUnavailable`, `Card`/`CardHeader`/`CardBody`/`CardFooter`, `EmptyState`, `ErrorState`, `FailureBanner`, `Skeleton`/`SkeletonList`/`SkeletonCard`, `StatusPill`) and `packages/ui/src/index.ts` (`SeverityBadge`, `StatusBadge`, `AlertCard`, `MetricCard`, `DataTable`, `TimelineEvent`/`Timeline`, `RiskScore`/`RiskBar`, `LoadingSpinner`/`LoadingOverlay`, `EmptyState`, `SearchInput`, `MitreBadge`/`MitreAttackList`). Note: several `components/ui/*` primitives still contain raw `gray-*`/`blue-*` palette classes.
- **API client & auth** (`apps/web/src/lib/api.ts`, `apps/web/src/lib/responder/auth.ts`): `request<T>()`, `apiRequest<T>()`, `authedFetcher<T>()`, and `apiFetch()` use same-origin paths (`safeBase()` strips cross-origin `NEXT_PUBLIC_*_URL` in browser), attach `X-Tenant-Id` (`getActiveTenantId()` -> `aisoc.activeTenantId` -> `authUser.tenant_id` -> `DEFAULT_TENANT_ID`) and `Authorization: Bearer` from `localStorage["aisoc.responder.accessToken"]`, single-flight refresh via `aisoc.responder.refreshToken`, and clear storage + redirect to `/login?next=...` on unrecoverable 401 outside `AUTH_EXEMPT_PATHS`.

## 3. Routes Under `apps/web/src/app`
| Route | File (`apps/web/src/app/...`) | Rendered Component / Handler |
| --- | --- | --- |
| `/` | `page.tsx` | `HomePage` (`redirect('/login')` unless `homeRouteReport().marketing`, else landing sections + `StickyNav`/`Footer`) |
| `/login`, `/benchmark`, `/why-open-source` | `login/page.tsx`, `benchmark/page.tsx`, `why-open-source/page.tsx` | `LoginPage` (inline); `BenchmarkPage` (`StickyNav`, `BenchmarkResults`, `ComparisonTable`, `KpiBar`, `CommunitySubmissions`, `Footer`); `WhyOpenSourcePage` (`StickyNav`, `Footer`, inline) |
| `/r/[slug]`, `/r/[slug]/opengraph-image` | `r/[slug]/page.tsx`, `r/[slug]/opengraph-image.tsx` | `ReplayPage` (`ReplayPlayer`); OG image generator |
| `/api/health`, `/api/runtime-config`, `/api/badge/[kind]` | `api/health/route.ts`, `api/runtime-config/route.ts`, `api/badge/[kind]/route.ts` | `GET` route handlers |
| `/robots.txt`, `/sitemap.xml`, 404 | `robots.ts`, `sitemap.ts`, `not-found.tsx` | Metadata generators; `NotFound` (`StickyNav`, `Footer`) |
| `/costs` | `(admin)/costs/page.tsx` | `CostDashboardView` |
| `/dashboard`, `/dashboards/operations`, `/dashboards/soc-insights` | `(app)/dashboard/page.tsx`, `(app)/dashboards/operations/page.tsx`, `(app)/dashboards/soc-insights/page.tsx` | `DashboardView`, `OperationsDashboard`, `SOCInsightsView` |
| `/alerts`, `/alerts/[id]`, `/queue` | `(app)/alerts/page.tsx`, `(app)/alerts/[id]/page.tsx`, `(app)/queue/page.tsx` | `AlertsView`, `AlertDetailView` (`ClientOnly`), `QueueView` |
| `/cases`, `/cases/[id]` | `(app)/cases/page.tsx`, `(app)/cases/[id]/page.tsx` | `CasesView`, `CaseWorkspace` (`ClientOnly`) |
| `/hunt`, `/investigate`, `/explore`, `/federated-search` | `(app)/hunt/page.tsx`, `(app)/investigate/page.tsx`, `(app)/explore/page.tsx`, `(app)/federated-search/page.tsx` | `HuntView`, `permanentRedirect('/hunt')`, `ExploreView`, `FederatedSearchView` |
| `/detection`, `/detection/new`, `/detection/[id]` | `(app)/detection/page.tsx`, `(app)/detection/new/page.tsx`, `(app)/detection/[id]/page.tsx` | `DetectionsView`, `RuleEditor`, `RuleEditor` (`mode="edit"`, `ClientOnly`) |
| `/detection/catalog`, `/detection/coverage`, `/detection/proposals`, `/detection/tuning`, `/noise-tuning` | `(app)/detection/{catalog,coverage,proposals,tuning}/page.tsx`, `(app)/noise-tuning/page.tsx` | `DetectionCatalog`, `CoverageView`, `DetectionProposalsView`, `RuleTuningView`, `redirect('/detection/tuning')` |
| `/threat-intel`, `/graph`, `/copilot`, `/coverage-advisor`, `/easm`, `/evaluate` | `(app)/{threat-intel,graph,copilot,coverage-advisor,easm,evaluate}/page.tsx` | `ThreatIntelView`, `AttackGraphClient` (`AttackGraphView`), `CopilotView`, `CoverageAdvisorView`, `EASMView`, `ReplayEvaluationView` |
| `/playbooks`, `/playbooks/[id]`, `/marketplace`, `/fim`, `/honeytokens`, `/ai-estate`, `/purple-team` | `(app)/playbooks/page.tsx`, `(app)/playbooks/[id]/page.tsx`, `(app)/{marketplace,fim,honeytokens,ai-estate,purple-team}/page.tsx` | `PlaybooksView`, `PlaybookEditor` (`ClientOnly`), `MarketplaceView`, `FimDashboard`, `HoneytokensPage` (inline), `AiEstateView` + `AiChatCompliancePanel`, `PurpleTeamPage` (inline) |
| `/access-review`, `/identity/permissions`, `/onboarding`, `/connectors`, `/mssp`, `/shifts`, `/sla`, `/audit`, `/analytics/team`, `/reports/digest` | `(app)/access-review/page.tsx`, `(app)/identity/permissions/page.tsx`, `(app)/{onboarding,connectors,mssp,shifts,sla,audit}/page.tsx`, `(app)/analytics/team/page.tsx`, `(app)/reports/digest/page.tsx` | `AccessReviewView`, `EffectivePermissionsClient` (`EffectivePermissionsView`), `SetupChecklist` + `OnboardingView`, `ConnectorsView`, `MSSPDashboardView`, `ShiftsView`, `SLADashboard`, `AuditLogView`, `TeamAnalyticsView`, `ExecutiveDigest` |
| `/compliance`, `/compliance/soc2`, `/compliance/[framework]` | `(app)/compliance/page.tsx`, `(app)/compliance/soc2/page.tsx`, `(app)/compliance/[framework]/page.tsx` | `CompliancePage` (inline), `SOC2View`, `FrameworkView` |
| `/admin/tenants`, `/admin/waitlist` | `(app)/admin/tenants/page.tsx`, `(app)/admin/waitlist/page.tsx` | `AdminTenantsPage` (inline), `AdminWaitlistPage` (inline) |
| `/settings`, `/settings/{business-context,mfa,rbac,users}` | `(app)/settings/page.tsx`, `(app)/settings/{business-context,mfa,rbac,users}/page.tsx` | `SettingsView`, `BusinessContextSettings`, `MfaView`, `RBACView`, `UsersView` |
| `/about`, `/blog`, `/blog/[slug]`, `/contact`, `/customers`, `/customers/[slug]`, `/mesh`, `/press`, `/pricing`, `/privacy`, `/sovereign`, `/terms`, `/waitlist` | `(marketing)/{about,blog,blog/[slug],contact,customers,customers/[slug],mesh,press,pricing,privacy,sovereign,terms,waitlist}/page.tsx` | Inline server/client pages (`[slug]` routes use `MDXRemote` + `mdxBodyComponents`) |
| `/responder`, `/responder/{approvals,case,case/[caseId],login,oncall,settings,triage,triage/[alertId]}` | `(responder)/responder/page.tsx`, `(responder)/responder/.../page.tsx` | `redirect('/responder/triage' \| 'case' \| 'oncall')`; inline client pages inside `ResponderShell` |
| `/tools`, `/tools/coverage`, `/tools/nl2sigma`, `/tools/noise`, `/tools/translate`, `/tools/translate/[pair]` | `(tools)/tools/page.tsx`, `(tools)/tools/{coverage,nl2sigma,noise,translate,translate/[pair]}/page.tsx` | `ToolsIndex` (inline), `CoverageTool`, `Nl2SigmaTool`, `NoiseTool`, `TranslateTool`, `TranslateTool` |

## 4. Commands & Baseline
- `install`: `pnpm install --frozen-lockfile` (root `pnpm-lock.yaml`, `pnpm@8.15.1`; add `--ignore-scripts` to skip `prepare` -> `scripts/setup_hooks.sh`).
- `dev`: `pnpm --filter @aisoc/web dev` (`next dev -p 3000`; root `pnpm dev` runs `turbo run dev`). Not run (persistent).
- `type-check`: `pnpm --filter @aisoc/web type-check` (`tsc --noEmit`) — **0 errors** (exit 0). Note: root `pnpm type-check` (`turbo run type-check`) fails on Windows at `@aisoc/ui#build` (`cp ... 2>/dev/null || true`).
- `lint`: `pnpm --filter @aisoc/web lint` (`eslint .`) — **0 errors, 95 warnings** (exit 0; pre-existing `react-hooks/*` warnings in `apps/web/eslint.config.mjs`, plus `api.ts`).
- `build`: `pnpm --filter @aisoc/web build` (`next build` Turbopack) — **passed** (exit 0, 105 static pages; `next.config.js` ignores TS build errors).
- `test`: `pnpm --filter @aisoc/web test` (`vitest run`) — **124/126 files passed, 1,257/1,260 tests passed, 3 failures** (exit 1; `test:cov` adds v8 thresholds in `apps/web/vitest.config.ts`). Failing tests observed:
  - `apps/web/src/test/a11y.test.tsx`: `WCAG 2.1 AA — high-traffic surfaces > AlertsView (the queue and alert list) has no accessibility violations` (5000ms timeout).
  - `apps/web/src/components/dashboard/MitrePanelWording.test.tsx`: `the coverage row describes techniques > does not claim to count tactics` (`indexOf` on `ROW_LABEL + '\n'` returns `-1` on CRLF checkout).
  - `apps/web/src/components/dashboard/MitrePanelWording.test.tsx`: `the coverage row describes techniques > names the denominator it divides by` (same `\n` mismatch).
- `check:tokens`: **Not present** (no `check:tokens` script in root `package.json`, `apps/web/package.json`, or `scripts/`).

## 5. Conventions
- **API mocking in tests**: `apps/web/src/test/setup.ts` installs `localStorage`/`sessionStorage`, `matchMedia`, `IntersectionObserver`, and `ResizeObserver` stubs and clears SWR's cache in `afterEach`. Tests mock `@/lib/api` and/or `swr` with `vi.hoisted` state (`DashboardHonesty.test.tsx`, `CaseWorkspace.test.tsx`), stub `globalThis.fetch` (`api.alerts-list.test.ts`), wrap URL-sync components in `NavigationTestProvider` (`src/test/NavigationTestProvider.tsx`), and toggle demo/marketing state via `__setDemoModeForTests()` (`lib/demoMode.ts`) and `__setMarketingHomeForTests()` (`lib/homeRoute.ts`).
- **Env vars**: `NEXT_PUBLIC_*` vars are build-time inlined in `apps/web/next.config.js` (`NEXT_PUBLIC_TENANT_ID` defaults to `00000000-0000-0000-0000-000000000001`; `NEXT_PUBLIC_APP_VERSION` reads root `VERSION`). Server-only runtime vars (`AISOC_DEMO_MODE`, `AISOC_MARKETING_HOME`, `API_URL`, `AGENTS_URL`, `REALTIME_URL`, `FUSION_URL`, `ENRICHMENT_URL`, `OSQUERY_TLS_URL`, `HONEYTOKENS_URL`, `PURPLE_TEAM_URL`, `AISOC_PROXY_TIMEOUT_MS`) outrank `NEXT_PUBLIC_*` twins in Server Components/rewrites and `GET /api/runtime-config`.
- **Feature flags**: Backend `AISOC_FEATURE_*` booleans live in `services/api/app/core/config.py` (all default `True`). Console UI gates demo mocks via `isDemoMode()` / `demoFallback()` / `canUseDemoData()` (`lib/demoFallback.ts`), optional profile backends via `isCapabilityAbsent(err)` (HTTP `503` -> `<CapabilityUnavailable />`), federated search disablement via `AISOC_FEATURE_FED_SEARCH` handling in `lib/api.ts` + `FederatedSearchView.tsx`, and admin nav via `Sidebar.tsx` `adminOnly`.

## 6. Rules for Future Agents
- Never delete code; hide with comments tagged [HIDDEN-UI <phase> <reason>].
- Presentation-only changes unless told otherwise. No API/auth/data changes.
- Tokens only (no raw palette classes, hex, arbitrary sizes).
- One phase per run, commit per phase, report type-check/build/test numbers.
- Redirects use permanent: false.
- Never push to any remote other than origin; never force push; never git add -A.
- Secrets never in localStorage, logs or URLs.
