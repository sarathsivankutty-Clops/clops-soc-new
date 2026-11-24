# Session Summary: Investigation BYOK Resolution & Runtime Deployment Fix

## 1. Overview & Context

During local and production operations, an issue was identified where case investigations were routing to the local default Ollama backend (`llama3.2:3b-instruct-q4_K_M`) and timing out, rather than respecting the tenant's configured BYOK (Bring Your Own Key) model and endpoint (e.g., Groq, hosted OpenAI).

This resulted in:
- LiteLLM logging:
  - `Received Model Group=aisoc-investigation`
  - `Ollama_chatException` / connection timeouts
  - Fallback attempts to `aisoc-triage`
- Wall-clock budget timeouts in the agents service (`investigation.budget_timeout`).
- Cost telemetry recording `call_count=0`, `prompt_tokens=0`, `completion_tokens=0`, and `models=[]` because no model calls succeeded.

Subsequent end-to-end validation against a real tenant configured with Groq BYOK credentials (`qwen/qwen3.8-27b`, `https://api.groq.com/openai/v1`) uncovered two further blockers:
1. Groq rejected requests with **HTTP 401 Unauthorized** because the `agents` service was unable to decrypt `api_key_vault` from PostgreSQL due to a missing environment variable in Docker Compose, causing it to fall back to the environment's `OPENAI_API_KEY` (an OpenRouter key).
2. Ad-hoc streaming via WebSocket (`/investigations/{run_id}/stream`) was not wrapping executions inside `with llm_override(**byok):`.
3. Calls to hosted providers with strict on-demand output tokens per minute (OTPM) limits (such as Groq's 1,000 OTPM limit) were rejected with **HTTP 429** when `max_completion_tokens` defaulted to 2,048.

---

## 2. Why This Changed (Root Cause Analysis)

### 2.1 Code-Level Investigation BYOK Omission
- **Alert Explain** (`services/agents/app/api/explain.py`) and **Auto-Triage** (`services/agents/app/workers/fused_alert_consumer.py`) both consult `app.security.llm_resolver.resolve_llm_config(tenant_id)` to decrypt and retrieve per-tenant BYOK credentials (`api_key`, `base_url`, `model`).
- During model invocation, Auto-Triage binds these credentials using `with llm_override(...)` (`services/agents/app/llm/factory.py`), which sets a request-scoped `ContextVar`. Downstream calls to `make_chat_model()` automatically check this override and target the tenant's configured provider.
- However, the **Investigation pipeline** (`services/agents/app/api/investigate.py` and `services/agents/app/investigator/orchestrator.py`) initially never invoked `resolve_llm_config` or `llm_override`.

### 2.2 WebSocket Ad-Hoc Stream Bypass (`investigate.py:L538-L547`)
- While the background task path (`_run_and_store`) was updated to resolve BYOK, the direct WebSocket streaming path (`stream_investigation` mode 2, used for ad-hoc / dev investigations when `run_id` is not pre-registered in `_runs`) called `_investigate_stream(...)` directly without resolving tenant credentials or entering `with llm_override(**byok):`.
- Any ad-hoc stream on `/investigations/{run_id}/stream` therefore ran without tenant BYOK configuration.

### 2.3 Runtime Environment Defect (`AISOC_CREDENTIAL_KEY` Missing on `agents`)
- `services/agents/app/security/credential_vault.py:get_vault()` inspects `os.getenv("AISOC_CREDENTIAL_KEY")` to initialize the process-wide Fernet vault singleton.
- In `docker-compose.yml` (and `docker-compose.prod.yml`), `AISOC_CREDENTIAL_KEY` was passed to the `api` (line 406) and `connectors` (line 1317) services, but was **completely omitted** from the `agents` container environment block.
- When `resolve_llm_config(tenant_id)` was called in `agents`, `_decrypt_vault_token` logged:
  `explain.llm_resolve_vault_disabled reason='AISOC_CREDENTIAL_KEY not set; tenant BYOK key cannot be decrypted, falling back to environment baseline'`.
- As a result, `api_key_from_tenant` evaluated to `False`, `byok["api_key"]` remained `None`, and `make_chat_model()` fell back to `resolve_api_key()`, reading the container's `OPENAI_API_KEY` (`sk-or-v1-...`, an OpenRouter key). Groq received this key on `https://api.groq.com/openai/v1` and rejected it with **HTTP 401 Unauthorized**.

### 2.4 Provider Output Token Limit (OTPM) Overflows
- Groq's on-demand free tier enforces an Output Tokens Per Minute (OTPM) limit of 1,000 tokens for `qwen/qwen3.8-27b`.
- When Groq estimates OTPM requirements for an incoming request, it calculates the ceiling using the requested `max_tokens`. With `DEFAULT_MAX_COMPLETION_TOKENS = 2048`, Groq calculated ~1,715 expected tokens and returned **HTTP 429**:
  `Request too large for model qwen/qwen3.8-27b ... Limit 1000, Requested 1715. Reduce max_tokens and try again.`

---

## 3. What Changed

### 3.1 `services/agents/app/api/investigate.py`
- Added `_resolve_tenant_llm_override(tenant_ref: str | None) -> dict[str, str | None]`:
  - Invokes `resolve_llm_config(tenant_ref)`.
  - Extracts `api_key`, `base_url`, and `model` only when marked with `*_from_tenant=True`.
- In `_run_and_store` (lines 300-313), wrapped `async for event in _investigate_stream(...)` inside `with llm_override(**byok):`.
- **In `stream_investigation` (lines 538-547)**:
  - Updated mode 2 (ad-hoc streaming) to resolve `byok = await _resolve_tenant_llm_override(tenant_id)` and wrap `_investigate_stream(...)` inside `with llm_override(**byok):`.
  - Ensures ad-hoc WebSocket connections also consume tenant BYOK credentials.

### 3.2 `services/agents/app/investigator/orchestrator.py`
- Added `_resolve_tenant_byok(tenant_ref: str | None) -> dict[str, str | None]`.
- Wrapped `self._graph.ainvoke(initial.to_dict())` in `with llm_override(**byok):` in `InvestigatorOrchestrator.run(...)`.
- Wrapped `self._graph.astream(initial.to_dict())` in `with llm_override(**byok):` in `InvestigatorOrchestrator.stream(...)` to provide defense-in-depth for direct orchestrator consumers.

### 3.3 Compose & Runtime Configuration (`docker-compose.yml`, `docker-compose.prod.yml`, `tests/test_full_profile_gate.py`)
- Added `AISOC_CREDENTIAL_KEY: ${AISOC_CREDENTIAL_KEY:-}` and `AISOC_CREDENTIAL_KEY_ROTATION_FROM: ${AISOC_CREDENTIAL_KEY_ROTATION_FROM:-}` to the `agents` service environment block in `docker-compose.yml`.
- Added `AISOC_CREDENTIAL_KEY: ${AISOC_CREDENTIAL_KEY:?set AISOC_CREDENTIAL_KEY}` to `agents` in `docker-compose.prod.yml`.
- Added `AISOC_INVESTIGATOR_MAX_COMPLETION_TOKENS: ${AISOC_INVESTIGATOR_MAX_COMPLETION_TOKENS:-800}` to `agents` environment in `docker-compose.yml` to prevent 429 OTPM quota rejections on hosted providers.
- Updated `tests/test_full_profile_gate.py` to assert that `agents` receives `AISOC_CREDENTIAL_KEY` alongside `api` and `connectors`.

---

## 4. Key Guarantees & Verification Evidence

1. **Decryption & Provider Authentication**:
   - `resolve_llm_config` now decrypts the tenant's Groq key cleanly (`gsk_6V1B...`).
   - Direct requests to `https://api.groq.com/openai/v1/chat/completions` succeed with HTTP 200.
2. **End-to-End Investigation Execution**:
   - Triggered live investigation via `POST /api/v1/cases/1cea4676-b96e-4930-8861-710f810b031c/investigate` (`run_id: 66ccda28-559f-4001-b918-6438998c2bfa`).
   - All 4 agents (`ReconAgent`, `ForensicAgent`, `ResponderAgent`, `ReportWriterAgent`) ran against Groq's `qwen/qwen3.8-27b`.
   - Run completed in 41 seconds with 0 errors.
   - Database record in `investigation_runs`:
     - `status: completed`
     - `iterations: 4`
     - `total_tokens: 6044`
3. **Static Checks & Regression**:
   - `pnpm --filter @aisoc/web type-check`: 0 errors.
   - `docker compose config -q`: Passed cleanly with 0 errors.
   - ContextVar concurrency isolation: Verified between concurrent tenant contexts.

---

## 5. Alerts Entities Queue & EC2 WebSocket Deployment Fixes

### 5.1 Root Cause Analysis: `TypeError: Cannot read properties of undefined (reading 'critical')`
- **Problem**: On `/alerts` (Entities tab), the UI crashed with "This page couldn't load".
- **Root Cause**: `services/fusion/app/services/entity_risk.py` emitted `severities` and `contributors`, whereas the frontend `EntityRiskQueue.tsx` (`SeverityHistogram`) expected `severity_histogram` and `contributions`. `histogram['critical']` threw an unhandled TypeError.
- **Fix Applied** (commit `2fb737d35`):
  - `apps/web/src/lib/api.ts`: Added `normalizeEntityRiskRecord()` to map `severities` -> `severity_histogram` and `contributors` -> `contributions`, and sanitized ISO timestamps.
  - `apps/web/src/components/alerts/EntityRiskQueue.tsx`: Added defensive access `histogram?.[sev] ?? 0` and `parseDateSafe()`.
  - `services/fusion/app/services/entity_risk.py`: Dual-emitted both field sets.
  - `apps/web/src/components/alerts/EntityRiskNormalization.test.ts`: Added passing regression tests.

### 5.2 Root Cause Analysis: `ws://localhost:18086/ws/alerts` on EC2
- **Problem**: When accessing EC2 console via `http://100.25.223.93:13000/alerts`, the browser console attempted to connect to `ws://localhost:18086/ws/alerts`.
- **Root Cause**: Next.js inlines `NEXT_PUBLIC_*` environment variables at build time. In `docker-compose.yml`, `web.build.args` passes:
  `NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:-ws://${PUBLIC_HOST:-localhost}:${REALTIME_PORT:-18086}}`.
  Without `PUBLIC_HOST=100.25.223.93` in `.env` during `docker compose build web`, it defaulted to `localhost:18086`. In addition, `realtime` CORS origins in `docker-compose.yml` defaulted to `localhost:13000`.
- **Fix Applied** (commit `81605a4ab`):
  - Created `.env.ec2.example` with `PUBLIC_HOST=100.25.223.93`, `AISOC_CONSOLE_BIND_ADDR=0.0.0.0`, `AISOC_REALTIME_BIND_ADDR=0.0.0.0`, `WEB_PORT=13000`, `REALTIME_PORT=18086`, and public CORS origins.
  - Rebuilding `web` with `docker compose build web` on EC2 inlines `ws://100.25.223.93:18086` into the client bundle.

---

## 6. Exploratory QA, UX Review & AI Investigation Workflow Redesign (`UX-1` & `UX-2`)

### 6.1 Exploratory QA & Workflow Analysis (`BUG_REPORT.md`, `docs/UX_REVIEW.md`)
- Executed an exploratory Playwright QA pass against the live console (`http://127.0.0.1:13000`), capturing runtime issues, API/export errors (such as missing `libgobject-2.0-0` causing PDF report export failures in WeasyPrint), and UI/accessibility findings in `BUG_REPORT.md`.
- Documented the end-to-end Alert -> Case -> AI Investigation workflow issues and redesign plan in `docs/UX_REVIEW.md`, covering duplicate run creation, silent startup delays, `/alerts` opening on `Entities` instead of the `Alerts` queue, competing AI CTA affordances, and missing run-picker accessibility labels.

### 6.2 Phase `UX-1` — Resume Running Investigations & Prevent Duplicate Runs (commit `b4a91fa8b`)
- `apps/web/src/components/cases/CaseWorkspace.tsx`:
  - Extracted `attachRunTracking(runId)` and reused it inside the mount-restore `useEffect` so reloading `/cases/[id]` while a run has `status === "running"` restores `investigationRunId`, enters the investigating state, and resumes WebSocket + polling updates.
  - Replaced the single-state `"Investigate with agent"` button with a tri-state control: disabled `"Investigation in progress"` when active, secondary `"Run again"` with an inline `"This starts a new run."` (`Confirm` / `Cancel`) confirmation when completed or failed, and `"Investigate with agent"` when no run exists.
  - Turned the `Cases` breadcrumb segment into a `<Link href="/alerts">`, keeping `{caseRecord.id}` as plain text.
  - Added `[TODO-BACKEND: ...]` comments tracking backend run-deduplication and incremental `audit_log` flushing.
- `apps/web/src/components/cases/InvestigationLedger.tsx`:
  - Updated the live empty state (`isLive` with 0 events) to display `"Investigation started. Results appear when the first agent step finishes."` alongside a live `Elapsed: Ns` counter computed from `activeRun.started_at`.
- `apps/web/src/components/alerts/AlertDetailView.tsx`:
  - Guarded `AIInvestigation` so alerts with an existing `caseId` route directly to `/cases/${caseId}?tab=ledger` instead of creating a duplicate case (with `[TODO-BACKEND: link existing case to alert]`).
- Added unit tests in `CaseWorkspaceUx1.test.tsx`, `InvestigationLedger.test.tsx`, and `AlertDetailViewUx1.test.tsx`.

### 6.3 Phase `UX-2` — UI Redesign (`RD1`–`RD7`, `U11`, `U13`) & Container Rebuild
- `apps/web/src/components/alerts/AlertsView.tsx`:
  - Changed initial `viewMode` state from `'entities'` to `'alerts'`, placed the `Alerts` tab first in the header `tablist`, and hid the disabled `+ Create Alert` / `Planned for v1.1` controls behind `[HIDDEN-UI UX-2 ...]` comments.
- `apps/web/src/components/alerts/InvestigationRail.tsx`:
  - Added a `footer` slot on `RailShell` and an optional `onNavigate` prop on `InvestigationRailProps`.
  - Rendered a sticky footer with theme tokens (`border-surface-border`, `bg-surface-elevated`, `text-tone-danger`, `text-fg-secondary`) containing a primary `"Investigate with agent"` / `"Open existing investigation"` CTA and a `"Full alert view →"` link; clicking launches or opens the linked case investigation at `/cases/${caseId}?tab=investigation`.
- `apps/web/src/components/alerts/AlertDetailView.tsx`:
  - Promoted the `AIInvestigation` CTA button from `variant="secondary"` to `variant="primary"`.
- `apps/web/src/components/cases/CaseWorkspace.tsx` & `apps/web/src/components/cases/InvestigationLedger.tsx`:
  - Passed `runId={investigationRunId}` to `InvestigationPanel` and updated the `"running"` state header to show a truncated `run` badge and live step counter (`steps recorded`) using theme tokens.
  - Added `aria-label="Select investigation run"` to the ledger run picker `<select>`.
- Added unit tests in `InvestigationRail.test.tsx` and `InvestigationLedger.test.tsx`.

### 6.4 Verification & Live Deployment Evidence
- `pnpm --filter @aisoc/web type-check`: **0 errors** (exit 0).
- `pnpm --filter @aisoc/web lint`: **0 errors, 95 warnings** (exit 0).
- Targeted Vitest suites (8 alert/case test files): **8/8 files passed, 74/74 tests passed**.
- Full Vitest suite (`pnpm --filter @aisoc/web test`): **129/132 files passed, 1,273/1,278 tests passed** (only the 3 pre-existing baseline failures in `a11y.test.tsx`, `MitrePanelWording.test.tsx`, and `ThreatIntelLookupHonesty.test.tsx`).
- `pnpm --filter @aisoc/web build`: **passed** (exit 0, 108 static pages).
- `docker compose -p clops-soc up -d --build web`: rebuilt `clops-soc-web:local` and started `clops-soc-web-1` on `0.0.0.0:13000->3000/tcp`; `http://127.0.0.1:13000/login` and `http://127.0.0.1:13000/api/health` both returned HTTP `200`.

---

## 7. Console Chrome Simplification & `ClopSOC` Branding (`CHROME-1` & `CHROME-2`)

### 7.1 Phase `CHROME-1` — Sidebar Footer, `Hunt`, TopBar Controls & `ClopSOC` Branding
All removals preserved source lines inside `[HIDDEN-UI CHROME-1 ...]` comments rather than deleting code:
- `apps/web/src/components/layout/Sidebar.tsx`:
  - Commented out `useConsoleVersion` and the footer `v{consoleVersion} · MIT License` (`https://github.com/beenuar/AiSOC`) block.
  - Commented out `SearchIcon` and the `Hunt` navigation entry (`Hunt & Detect` section updated to `Detect`).
  - Renamed the visible sidebar brand wordmark from `ClopsSOC` to `ClopSOC`.
- `apps/web/src/components/layout/TopBar.tsx`:
  - Commented out the command-palette search bar (`Search alerts, cases, rules, or run a command…`), `TimeWindowSelector`, and `TenantSwitcher` (`Default`), along with their unused helpers (`shortcut`, `openPalette`, `useEffect`, `useState`).
  - Renamed the fallback product title to `ClopSOC`.
- Updated visible product branding from `ClopsSOC` to `ClopSOC` and hid `Hunt` in `CommandPalette.tsx` (`NAV_ITEMS`), `useBranding.ts` (`DEFAULT_BRANDING`), `app/layout.tsx`, `app/login/page.tsx`, `DashboardWelcome.tsx`, and `SettingsView.tsx`.
- Updated unit tests in `Sidebar.test.tsx`, `TopBar.test.tsx`, `BrandedDocumentTitle.test.tsx`, and `SettingsView.navigation.test.tsx`.

### 7.2 Phase `CHROME-2` — Floating Ask Copilot Dock Removal
Preserved inside `[HIDDEN-UI CHROME-2 ...]` comments:
- `apps/web/src/components/layout/AppShell.tsx`: Commented out the `CopilotDock` import and `<ClientOnly><CopilotDock /></ClientOnly>` mount.
- `apps/web/src/components/layout/CommandPalette.tsx`: Commented out the `'action:copilot'` (`"Open the floating Copilot dock"`) quick action.

### 7.3 Verification & Live Deployment Evidence
- `pnpm --filter @aisoc/web type-check`: **0 errors** (exit 0).
- `pnpm --filter @aisoc/web lint`: **0 errors, 94 warnings** (exit 0).
- Layout & settings unit tests (`Sidebar.test.tsx`, `TopBar.test.tsx`, `BrandedDocumentTitle.test.tsx`, `SettingsView.navigation.test.tsx`): **4/4 files passed, 35/35 tests passed**; `BrandedDocumentTitle.test.tsx` (`2/2`) re-verified after `CHROME-2`.
- Filtered accessibility check (`vitest run src/test/a11y.test.tsx -t "TopBar|Sidebar"`): **2 passed, 10 skipped (filtered)**.
- `pnpm --filter @aisoc/web build`: **passed** (exit 0, 108 static pages).
- `docker compose -p clops-soc up -d --build web`: rebuilt `clops-soc-web:local` and started `clops-soc-web-1` on `0.0.0.0:13000->3000/tcp`; `http://127.0.0.1:13000/login` and `http://127.0.0.1:13000/api/health` both returned HTTP `200`.

---

## 8. Alerts Ordering/Filters, Findings, Correlation, Approvals Bridge & E2E Validation

### 8.1 Stage 2 + PR4 + Compose Commits (`initial-setup` → pushed to `origin/main`)
- **PR1a (`fede08f27`):** `apps/web/src/lib/api.ts` (`AlertFilters` snake_case params `page_size`, `event_since`, `event_until`, `assigned_to_me`, `search`), `apps/web/src/lib/alertStatus.ts` (all 12 backend statuses grouped `Open` / `In progress` / `Closed`), `apps/web/src/components/alerts/AlertsView.tsx` (Sort `Priority` / `Newest` / `Oldest`, clickable column headers, in-page time window, `event_time` with `ingest` fallback, actor subtitle, `Clear filters` & `SavedViewsBar` preserving `sort`).
- **PR3 (`d2df44d0d`):** `services/api/app/services/llm_json.py` + `cases.py` (`parse_llm_json_payload` stripping `<think>` blocks and markdown fences, emitting ledger `seq`), `apps/web/src/components/ui/SafeMarkdown.tsx`, and `CaseWorkspace.tsx` (full Recon/Forensic/Responder fields, `"Suggested - not executed"`, `"not measured"`, semantic theme tokens).
- **PR1b (`e4b0d80c4`):** `services/api/app/services/alert_search.py` + `alerts.py` (parameterized `search` across `title`/`rule_name`/`entities`/`affected_*`, `connector_type` filter, `alert_occurrences` left-join `occurrence_count`), plus UI search input, source `<select>`, and `×N` repeat badge.
- **PR2 (`2072194f1`):**
  - Migrations `services/api/migrations/161_alert_correlation_fields.sql` (`alerts.incident_id`, `alerts.fusion_decision`, `idx_alerts_tenant_incident`) and `162_backfill_alerts_case_id.sql` (backfill `alerts.case_id` from `aisoc_cases.alert_ids`).
  - `services/fusion/app/services/alert_sink.py` persists `incident_id`, `fusion_decision`, and `enrichment_data`.
  - `services/api/app/api/v1/endpoints/cases.py` syncs `alerts.case_id` on `create_case` and `link_alerts`; `alert_rail.py` updates `_graph_pivot` away from the retired `/graph` redirect; `alerts.py` + `AlertsView.tsx` / `InvestigationRail.tsx` / `AlertDetailView.tsx` render `+N correlated`, siblings, `"Why grouped"`, and `Case` links.
- **PR4 + TopBar (`8a32bf829`):**
  - Commented out `<RoleBadge role={userRole} />` in `TopBar.tsx` (`[HIDDEN-UI TOPBAR-2]`).
  - `services/agents/app/workers/fused_alert_consumer.py` re-persists `proposed_actions` after `_maybe_escalate` with `"action"` key; `approvals.py` adds `case_id` and `alert_id` filters to `GET /api/v1/approvals`.
  - Wired `"Request Approval"` in `CaseWorkspace.tsx`, staged submission in `AttackStory.tsx`, and `responderApi.runPlaybook` in `AlertDetailView.tsx`.
- **Unique Compose Naming (`56306a1f9` + duplicate `name:` fix in `docker-compose.yml`):** Updated `docker-compose.yml` (`name: clopsoc`, `clopsoc-*:${TAG:-local}` for all 15 first-party services) and `docker-compose.prod.yml` (`clopsoc-core-api`), and pushed `initial-setup -> main` on `https://github.com/sarathsivankutty-Clops/clops-soc-new.git`.

### 8.2 Runtime Fixes & E2E Validation (`docs/E2E-VALIDATION-REPORT.md`)
- **Applied migrations `161` & `162`** to `clops-soc-postgres-1` (`UPDATE 11` rows backfilled), resolving the HTTP 500s (`column alerts.incident_id does not exist`) on `/api/v1/alerts`, `/api/v1/alerts/queue`, `/api/v1/cases/{id}/attack-chain`, and `clops-soc-fusion-1` DLQ.
- **Fixed LiteLLM → AWS Bedrock 403:** Removed the stale Windows User `OPENAI_API_KEY` (`sk-or-v1-...`) override that shadowed `.env` and recreated `clops-soc-litellm-1` (`ABSK...` key); verified `POST http://127.0.0.1:14000/v1/chat/completions` (`model: aisoc-recon`) → **HTTP 200** (`"OK"`).
- **Post-fix verification (`http://127.0.0.1:13000`):**
  - All 24 probed core API endpoints returned **HTTP 200** in `5.9–87.0 ms` (login `276.6 ms`).
  - Playwright walkthrough: `FAILED_500: []`, `PAGE_ERRORS: []`, verified `Priority` / `Newest` / `Oldest` sorting, `High` filter (`3` rows), `Clear filters` preserving `sort=oldest` (`25` rows), `7` `Case` links on `/alerts`, and Investigation Rail rendering.

### 9.1 Compose-managed first administrator (`docker-compose.yml`, `docker-compose.prod.yml`)
- **Root cause of `admin@aisoc.internal` / the supplied password failing on `localhost:13000`:** the `clopsoc` project's database had `tenants` = 1 and `users` = 0. `POST /api/v1/auth/login` (`services/api/app/api/v1/endpoints/auth.py:103`) selects the row by email and answers `401 Incorrect email or password` for every password when there is none; the account that used to work lives in the older `clops-soc` Postgres volume. The repeated attempts also tripped `login_throttle` (10 failures → 900 s lockout, keys `aisoc:login:{account,source}:*` in Redis, which runs with AOF so a restart does not clear them).
- **`docker-compose.yml`:** `api.environment` anchored as `&api-env`; new CORE one-shot `bootstrap` service (`image: clopsoc-api:${TAG:-local}`, `pull_policy: never`, `depends_on: api: service_healthy`, `restart: "no"`, `environment: *api-env`, `networks: [clops-soc]`) running `app.scripts.bootstrap_admin`. Compose starts an exited one-shot again on the next `up`, which is the mechanism; the script is idempotent ("An administrator already exists", exit 0, hash untouched).
- **Log-safety guard:** when `AISOC_ADMIN_PASSWORD` is empty the service declines instead of letting the script generate a password that would land in the container log (a secret stored on disk). `make bootstrap` stays the path that prints a generated password once.
- **`docker-compose.prod.yml`:** `bootstrap` restated with `depends_on: preflight-secrets: service_completed_successfully`, required by `tests/test_production_compose_gate.py`.
- **Gates/docs:** `bootstrap` added to `ONE_SHOTS` in `tests/test_doctor_service_coverage.py`; `apps/docs/docs/quickstart.md` CORE table row and a paragraph describing the compose path.
- **Verified:** `docker compose config -q` exit 0; `docker compose up -d` → `bootstrap exited 0` and `users` holds `admin@aisoc.internal`; a second `up` re-runs it and reports "already exists" (1 row, 1 distinct hash); `POST http://localhost:13000/api/v1/auth/login` → **200** with an access and refresh token; compose/docs pytest gates 210 passed, 5 skipped.

### 9.2 `[HIDDEN-UI R6]` Saved views bar removed from the list surfaces
- **Why:** on Alerts, Cases and Playbooks the bar rendered as a full-width band above the filters and, with no presets saved, said only "None yet — save your current filters to come back to them later." It read as an unfinished feature and cost a row of vertical space on the primary triage screen.
- **Alerts** (`components/alerts/AlertsView.tsx`): import and the `<SavedViewsBar>` element commented out with a `[HIDDEN-UI R6 saved-views]` tag; the element is kept verbatim so `viewType`/`filters`/`onApply` do not have to be reconstructed. No other symbol depended on it.
- **Cases** (`components/cases/CasesView.tsx`): same, plus the `CaseFilterSnapshot` type, which existed only as the bar's wire format.
- **Playbooks** (`components/playbooks/PlaybooksView.tsx`): same, plus `handleApplyView` (its only caller) commented out. `setGalleryFilters` and `setGalleryKey` were dropped from the two `useState` destructures because that handler was their only writer; `galleryFilters` is still read to seed `PlaybooksGallery`, and `galleryKey` still keys it. The restore note names both setters.
- **Deliberately untouched:** `components/saved-views/SavedViewsBar.tsx` and its ~12 tests, `savedViewsApi` in `lib/api.ts`, the backend endpoints and the saved-view rows already stored. No API, data-model or auth change.
- **Gates:** `tsc --noEmit` 0; `eslint` 0 errors / 94 warnings (baseline); `vitest run` 3 files failed / 136 passed, 5 failed / 1290 passed — the same five known failures (`a11y` AlertsView timeout, `MitrePanelWording` CRLF ×2, `ThreatIntelLookupHonesty` ×2), which pass when those files run alone; `next build` 0. No test asserts the bar's presence, so no test needed editing.

---

## 10. HTTPS edge — nginx TLS termination (`deploy/https`, in progress)

### 10.1 Branch state
- `test-push` held the whole tree as untracked (75 entries); `git checkout main` refused to overwrite them. Every path tracked in `main` matched the working tree byte-for-byte except `apps/web/next-env.d.ts` (generated) and `services/agents/tests/eval_data/cicids_micro.csv`, so `git checkout -f main` was a content no-op. Branched `deploy/https` from `ac33d5766`. Untouched: the running laptop stack, `.env`, and the untracked audit docs.

### 10.2 Baseline measured before editing (laptop, read-only)
- `scripts/check_deployment_auth_posture.py` → 0 (21 vars / 36 services).
- `check_published_images.py` → 0; `check_env_placeholders.py` → 0; `check_hosted_hostname.py` → 0; `check_service_token_wiring.py` → 0; `check_runtime_db_role.py` → 0; `check_published_secrets.py --check/--check-env` → 0.
- **Already red before this phase:** `check_profile_service_counts.py` (publishes 16, compose has 17) and `check_deployment_completeness.py` (bootstrap has no Helm workload). Left as found; adding `nginx` moves the count figure by one and is reported, not hidden.

### 10.3 How the browser gets live updates (verified)
- WS URL = `wsOrigin()` + `/ws/<channel>?token=` (`apps/web/src/lib/api.ts:7887`); `wsOrigin()` returns `NEXT_PUBLIC_WS_URL` verbatim when set, else derives `ws|wss://` from `window.location` (`api.ts:67-74`).
- SSE URL = `REALTIME_BASE` + `/sse?token=` (`api.ts:7894-7897`), `REALTIME_BASE` from `NEXT_PUBLIC_REALTIME_URL`.
- Compose bakes `NEXT_PUBLIC_WS_URL=ws://host:18086` / `NEXT_PUBLIC_REALTIME_URL=http://host:18086` as **build args** (`docker-compose.yml:1884-1885`), so today the browser talks to realtime on 18086 directly.
- `next.config.js:193-200` rewrites `/ws/:path*` and `/sse` to realtime, but Next rewrites do not carry the WebSocket upgrade — so nginx routes `/ws/` and `/sse` straight to `realtime:4000` and everything else to `web:3000`.

### 10.4 Findings that constrain the change
- API mints its own HS256 session JWT (`core/security.py:318-334`); no IdP token validation on requests. The only cookie the API sets is the OIDC state cookie, **without `secure`** (`auth/oidc.py:308`) — must become `secure` before HTTPS is real.
- Audit IP attribution: `core/trusted_proxy.py:13-20` ignores `X-Forwarded-For` unless `AISOC_TRUSTED_PROXIES` lists the immediate peer. uvicorn starts with `--fd` and **no** `--proxy-headers/--forwarded-allow-ips` (`app/scripts/serve.py:43-56`), so behind nginx `actor_ip` would be the nginx container address → `[TODO]` recorded, fix is config-only.
- Realtime already prefers `x-forwarded-for` (`services/realtime/src/index.ts:235-236`), so its rate limiter sees the client once nginx sets the header.

### 10.5 Files being written this phase
- `docker-compose.yml`: `nginx` + `certbot` services, `clops_soc_letsencrypt` / `clops_soc_acme_webroot` volumes, web/realtime host ports removed, `PUBLIC_SCHEME` + `PUBLIC_PORT_SUFFIX` applied to the public URLs.
- `infra/nginx/{bootstrap,tls,snippets}`: bootstrap HTTP config (ACME + redirect), TLS config (TLS1.2/1.3, OCSP, 444 default, WS/SSE routing, login rate limits), shared `server-name-*.conf` includes.
- `.env.https.example`, `scripts/preflight.sh` (80/443 + DNS), `docs/DEPLOY-HTTPS.md`.

### 10.6 Verification (laptop; the running stack was never started, stopped or rebuilt)
- `docker compose config -q` → 0 (default `.env`), and `docker compose --env-file .env.https.example config -q` → 0 (also with `--profile certbot`, which is where the certbot command lives).
- With `.env.https.example`: `AISOC_CONSOLE_URL=https://soc.cloudifyops.com`, `AISOC_CORS_ORIGINS=https://…`, web build args `wss://soc.cloudifyops.com` / `https://soc.cloudifyops.com`, nginx `0.0.0.0:80->80, 0.0.0.0:443->443`, certbot `certonly --webroot … --staging`.
- `nginx -t` in throwaway containers (`docker run --rm nginx:1.28-alpine`), bootstrap and TLS configs, with a self-signed cert generated into a temp dir for `/etc/letsencrypt/live/soc.cloudifyops.com/`: both "syntax is ok / test is successful". The TLS run warns `ssl_stapling ignored, no OCSP responder URL` — expected for a self-signed test cert, not for a Let's Encrypt one.
- Resolved port table: only `nginx` binds `0.0.0.0` (80/443). Everything else is `127.0.0.1` (api 18000, agents 18001, …), unchanged from before; `web` (13000) and `realtime` (18086) publish nothing.
- Gates after the change: posture 0 (38 services), published_images 0, published_secrets `--check`/`--check-env` 0, env_placeholders 0, hosted_hostname 0, service_token_wiring 0, runtime_db_role 0. `sh -n` + shellcheck on `preflight.sh` 0.
- Still red, as before: `check_profile_service_counts.py` (now says 18 long-running vs the published 16 — it was already 17 vs 16) and `check_deployment_completeness.py` (now also flags that the Helm chart renders no workload for `nginx`; `bootstrap` was already flagged). Adding a Helm workload is deliberately out of this compose-only phase.
- Not verified: no EC2, no DNS record, no certificate, no security-group change, and no browser WebSocket run — the runbook's steps 1–11 are the verification path on the instance.

---

## 11. Keycloak Production Identity Provider (`deploy/keycloak`)

### 11.1 Services & Secrets (`docker-compose.yml`, `.env.secrets.example`, `.gitignore`)
- Reused the exact digest-pinned image from `.github/workflows/sso-live.yml:191`:
  `quay.io/keycloak/keycloak:26.8@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc`.
- Added dedicated `keycloak-db` (`postgres:16-alpine`) with its own named volume `clops_soc_keycloak_db_data` and mandatory `KEYCLOAK_DB_PASSWORD`.
- Added `keycloak` running production `start --import-realm --hostname=https://${KEYCLOAK_HOSTNAME:-auth.cloudifyops.com} --hostname-admin=http://127.0.0.1:${KEYCLOAK_ADMIN_PORT:-18080} --proxy-headers=xforwarded --http-enabled=true --health-enabled=true`, `mem_limit: 1024m`, `mem_reservation: 512m`, `restart: unless-stopped`, loopback admin binding `127.0.0.1:${KEYCLOAK_ADMIN_PORT:-18080}:8080`, and a bash `/dev/tcp/127.0.0.1/9000` healthcheck against `/health/ready` (`curl` and `wget` are absent in the ubi9-micro image).
- Verified all CLI flags against `kc.sh start --help` inside the pinned image container.
- All secrets (`KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_USER`, `KEYCLOAK_ADMIN_PASSWORD`, `OIDC_CLIENT_SECRET`) have no defaults in `docker-compose.yml` and are read from `.env.secrets` (gitignored, template in `.env.secrets.example`).

### 11.2 Nginx & Realm Export (`infra/nginx/tls/30-auth.conf`, `infra/keycloak/realm-clopssoc.json`, `docs/DEPLOY-KEYCLOAK.md`)
- Activated `infra/nginx/tls/30-auth.conf` (and added the HTTP-01 challenge server block for `auth.cloudifyops.com` to `infra/nginx/bootstrap/default.conf`), blocking `/admin`, `/admin/*`, `/realms/master`, and `/realms/master/*` with `403`, and rate-limiting `/realms/*/login-actions/` (`aisoc_login`) and `/realms/*/protocol/openid-connect/(auth|token|registrations)` (`aisoc_auth`).
- Created `infra/keycloak/realm-clopssoc.json`: realm `clopssoc`, confidential client `clopssoc-console` (`standardFlowEnabled: true`, `implicitFlowEnabled: false`, `directAccessGrantsEnabled: false`, `pkce.code.challenge.method: S256`, redirect URI `https://soc.cloudifyops.com/auth/oidc/callback`, web origin & post-logout redirect `https://soc.cloudifyops.com`, placeholder secret), `oidc-group-membership-mapper` emitting `groups` (`full.path: false`), groups `soc-analysts` and `soc-admins`, `verifyEmail: true`, `registrationAllowed: false`, `bruteForceProtected: true`, `passwordPolicy: "length(12) and notUsername and notEmail"`, no test users, and no Google IdP secret.
- Documented full EC2 runbook, manual Google IdP steps (`Hosted Domain: cloudifyops.com`, verified email), app env vars, `POST /api/v1/sso-connections` creation, MFA policy verification (`GET/PUT /api/v1/auth/mfa/policy`), rollback, and test checklist in `docs/DEPLOY-KEYCLOAK.md`.

---

## 12. Console UI overhaul (`ui/console-overhaul`, branched from `02aaa9f7a`)

### 12.1 Phase 1 — navigation split and surface removals
- `Sidebar.tsx`: `Dashboards` → `Overview` (`/dashboards`); new `SOC Operations` item (`/operations`). `isActive` split: `/dashboards` lights for `/dashboard`, `/mssp`, `/costs` (the surviving redirects) and `/operations` lights for `/sla`, `/analytics/team`, `/dashboards/operations`.
- `OperationsTabs.tsx` + `apps/web/src/app/(app)/operations/page.tsx`: `SectionTabs` with `operations` / `sla` / `team`, reusing `OperationsDashboard`, `SLADashboard`, `TeamAnalyticsView`.
- `/dashboards` renders `DashboardView` directly; `DashboardsTabs` is kept, reduced to the Overview tab, and no longer mounted (`[HIDDEN-UI UI-OVERHAUL-1]`).
- Redirects (307 via `next/navigation`): `/sla` → `/operations?tab=sla`, `/analytics/team` → `/operations?tab=team`, `/dashboards/operations` → `/operations?tab=operations`, `/mssp`, `/costs`, `/dashboards/soc-insights` → `/dashboards`.
- `SettingsTabs.tsx`: Two-Factor Auth and Compliance tabs commented out with their imports; `/settings/mfa`, `/compliance`, `/compliance/soc2`, `/compliance/[framework]` all 307 to `/settings`.
- `PlaybooksView.tsx`: Community tab button, its render branch, and the "Browse community" empty-state action commented out; component kept on disk.
- `TopBar.tsx` / `CommandPalette.tsx`: Overview + SOC Operations destinations; `/operations` titles follow `?tab=`; retired dashboard tab labels kept commented.
- `Sidebar.test.tsx` updated for the new rail.
- Verification: `pnpm --filter @aisoc/web type-check` → 0 errors; `lint` → 0 errors, 94 warnings (was 95); targeted Vitest (`Sidebar`, `SectionTabs`, `SettingsView.navigation`, `DashboardHonesty`) → 4 files / 49 tests passed.

### 12.2 Phase 2 — Overview redesign and pipeline rename
- `DashboardView.tsx` now renders the reference console layout as five draggable widgets: `DashboardWelcome`, the five-tile `KpiStrip`, `PipelineHealth`, a 2:1 alert-volume / connected-sources grid, and a full-width MITRE tactic card.
- KPI tiles: `Open Alerts`, `Critical`, `MTTR`, `Open Cases`, `Connected Sources`. MTTR keeps the `—` + `not measured · no cases closed` branch when `mttr_sample_count === 0`, and the source tile keeps the `describeConnectedSources` caption, so `DashboardHonesty` / `ConnectedSourceCount` contracts still hold.
- Alert volume is a 24-bucket stacked bar built from the per-severity `alertsTrend` rows (no recharts; semantic `bg-severity-*` tokens). Empty window still renders `No alerts in the last 24 hours`; first paint still renders `Not loaded yet` via `PanelUnavailable`.
- Connected sources is a row list (name, event count, status pill); status vocabulary is `Healthy` / `Delivering` / `Late` / `Error` / `Unknown` via `StatusPill`. Empty state keeps `No sources connected` + `Go to connectors`.
- MITRE card keeps the `Top MITRE ATT&CK Tactics` heading and `emptyTitle="No tactic coverage yet"`, now labelled `Alerts ranked by tactic`; bars are relative alert counts, not invented technique coverage.
- `PipelineHealth.tsx` retitled **Ingestion & Detection Flow** and rebuilt as one card with five divided stage cells: status pill (`Healthy` / `Backlog` / `Error`), backlog share bar, p95, errors, and the existing `n/a` handling for `unmeasured` fields. All raw `green-*` / `amber-*` / `red-*` / `gray-*` classes replaced with semantic tokens. `Live` / `unavailable` / `Loading…` header states kept.
- Retired on this surface with `[HIDDEN-UI UI-OVERHAUL-2]`: `LiveFeedPanel`, `FunnelKpiBar`, `EfficiencyReport`, `SOCMetricsDashboard`, the recharts area/pie/bar renderers, and the in-page `PageHead`. Components and their routes stay on disk.
- `FunnelKpiBar.test.tsx`: pipeline-title assertion updated to `Ingestion & Detection Flow`.
- Verification: `type-check` → 0 errors; `lint` → 0 errors, 94 warnings; full Vitest → 138/139 files, 1,293/1,295 tests passed (the two failures are the pre-existing CRLF `MitrePanelWording` `indexOf('\n')` assertions); `next build` → passed.

### 12.3 Phase 3 — Runbooks filter dropdowns
- `PlaybooksGallery.tsx`: replaced the four stacked Category / MITRE / Severity / Uses chip rows with labelled native dropdowns in a single toolbar card. Search, All / Shipped Packs / Custom controls, and clear-filters behavior remain.
- Dropdown options include the existing facet counts; the Category dropdown remains hidden for Custom runbooks. Previous chip markup and helpers are retained with `[HIDDEN-UI UI-OVERHAUL-3]`.
- Replaced the raw palette classes in `TRIGGER_COLORS` with semantic pill and tone tokens; updated the component/helper descriptions to match the dropdown UI.
- Added `PlaybooksGallery.test.tsx` to cover filter selection/count labels, clearing filters, and the Custom source behavior.
- Verification: `pnpm --filter @aisoc/web test -- src/components/playbooks/PlaybooksGallery.test.tsx` → 1 file / 2 tests passed; `pnpm --filter @aisoc/web type-check` → passed; `pnpm --filter @aisoc/web exec eslint src/components/playbooks/PlaybooksGallery.tsx src/components/playbooks/PlaybooksGallery.test.tsx` → passed.

