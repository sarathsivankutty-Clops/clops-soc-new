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
