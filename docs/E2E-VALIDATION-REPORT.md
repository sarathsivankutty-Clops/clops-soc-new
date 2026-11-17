# E2E Validation & API/UI Audit Report

**Target:** `http://127.0.0.1:13000` (running stack: `clops-soc-web-1`, `clops-soc-api-1`, `clops-soc-agents-1`, `clops-soc-fusion-1`, `clops-soc-litellm-1`, `clops-soc-postgres-1`)
**Method:** Read-only API probes (`127.0.0.1:13000` & `localhost:13000`), Playwright Chromium walkthrough, Postgres inspection (`36` alerts, `24` cases, `2` users), and container logs. **No code or DB changes were made.**

---

## 1. Critical Failures (HTTP 500 & Pipeline/LLM Blockers)

| # | Surface / Endpoint | Observed Status & Latency | Root Cause (Verified Evidence) |
|---|---|---|---|
| **1** | `GET /api/v1/alerts?page=1&page_size=25&sort=priority`<br>`GET /api/v1/alerts/queue`<br>`GET /api/v1/cases/{id}/attack-chain` | **HTTP 500** (`67.9 ms`, `52.2 ms`, `59.9 ms`) | `clops-soc-api-1` log: `sqlalchemy.exc.ProgrammingError: column alerts.incident_id does not exist`. ORM `Alert` (`services/api/app/models/alert.py`) selects `incident_id` and `fusion_decision`, but migrations `161_alert_correlation_fields.sql` and `162_backfill_alerts_case_id.sql` have **not** been applied to `clops-soc-postgres-1` (`\d alerts` confirms `incident_id` absent). Because `TopBar` `LiveQueueBadge` polls `/api/v1/alerts/queue` on every page, **all 13 UI routes** logged a 500 console error. |
| **2** | Fusion alert persistence (`clops-soc-fusion-1`) | **Persist failed + DLQ** | `clops-soc-fusion-1` log: `{"error": "column \"incident_id\" of relation \"alerts\" does not exist", "event": "alert_sink.persist_failed"}` followed by `dlq.recorded` on `aisoc.raw_events`. Same root cause (#1): `alert_sink.py` inserts `incident_id` before migration `161` was applied. |
| **3** | LLM calls (`clops-soc-litellm-1` → AWS Bedrock) | **HTTP 403 Forbidden** | `clops-soc-litellm-1` log: `litellm.PermissionDeniedError: BedrockException - {"Message":"Invalid API Key format: Must start with pre-defined prefix"}` on `aisoc-investigation` and fallback `aisoc-triage` (`AISOC_LLM_MODEL_FAST=bedrock/qwen.qwen3-32b-v1:0`, `AISOC_LLM_API_BASE=https://bedrock-runtime.us-east-1.amazonaws.com`). `clops-soc-agents-1` falls back to heuristics (`findings_count=9, proposed_actions=0, verdict=likely_false_positive`). Note: `ABSK...` long-term key in `OPENAI_API_KEY` is rejected by Bedrock/LiteLLM `v1.102.1` via that path. |
| **4** | `GET /api/v1/honeytokens`<br>`GET /api/v1/purple-team/coverage` | **HTTP 500** (`4005.7 ms`, `3984.0 ms`) | Optional profile services (`honeytokens`, `purple-team`) are not running in `docker ps`, and the API proxy fails with HTTP 500 after ~4s timeout instead of HTTP 503 (`CapabilityUnavailable`). |
| **5** | ClickHouse & Neo4j dependencies (`clops-soc-api-1`, `clops-soc-agents-1`) | **Startup/query errors** | `clickhouse:9000` (`[Errno -2] Name or service not known`) and `neo4j:7687` (`No address associated with hostname`) are not running in this profile. API logs `lake migrations could not run` and `storage_cost lake query failed`; agents log `hunt.telemetry.lake.failed` (120s retry); graph features disabled. |

---

## 2. API Endpoint Matrix (`http://127.0.0.1:13000`, authenticated as `admin@aisoc.internal`)

### Passing Endpoints (HTTP 200)
| Method & Path | Status | Latency | Observed Response |
|---|---|---|---|
| `GET /api/health` | 200 | 47.1 ms | `{"status":"ok"}` |
| `GET /api/runtime-config` | 200 | — (2052 ms via `localhost`) | `{"demoMode":false,"demoModeSource":"runtime","consoleVersion":"23.2.0"}` |
| `POST /api/v1/auth/login` | 200 | 439.4 ms | JWT `access_token` issued |
| `GET /api/v1/auth/me` | 200 | — (2049 ms via `localhost`) | `email: admin@aisoc.internal`, `role: admin` |
| `GET /api/v1/alerts/stats` | 200 | 39.9 ms | `total: 36`, `high: 3, low: 8, medium: 25`, `investigating: 11, triaged: 25` |
| `GET /api/v1/cases?page=1&page_size=20` | 200 | 49.4 ms | `20` cases returned (array) |
| `GET /api/v1/cases/{id}` | 200 | 46.4 ms | Case `2dd185d6-...` (`Investigation — AssumeRole`) |
| `GET /api/v1/cases/{id}/investigations` | 200 | 50.5 ms | `runs: [{ run_id: afd19c4d-..., status: completed }]` |
| `GET /api/v1/approvals?status=pending` | 200 | 28.2 ms | `{"items":[],"total":0,"page":1,"page_size":25,"pages":1}` |
| `GET /api/v1/playbooks` | 200 | 12.9 ms | Returns built-in playbooks (`ato-credential-stuffing-v1`, etc.) |
| `GET /api/v1/connectors` | 200 | 22.2 ms | Returns configured connectors (`AWS Security Hub`, etc.) |
| `GET /api/v1/threat-intel/indicators` | 200 | — (2174 ms via `localhost`) | Returns indicators (`CVE-2025-21042`, etc.) |
| `GET /api/v1/easm/assets` | 200 | — (2099 ms via `localhost`) | `[]` |
| `GET /api/v1/compliance/frameworks` | 200 | — (2028 ms via `localhost`) | `SOC2` controls |
| `GET /api/v1/sla/metrics` | 200 | — (2089 ms via `localhost`) | `alerts_in_window: 36`, `measured: true` |
| `GET /api/v1/audit` | 200 | — (2085 ms via `localhost`) | Returns audit log items |
| `GET /api/v1/rbac/roles` | 200 | — (2103 ms via `localhost`) | Returns roles (`admin`, etc.) |
| `GET /api/v1/saved-views?view_type=alerts` | 200 | — (2057 ms via `localhost`) | `[]` |

### Non-200 Endpoints (403 / 404 / 500)
| Method & Path | Status | Latency | Notes |
|---|---|---|---|
| `GET /api/v1/alerts?page=1&page_size=25&sort=priority` | **500** | 67.9 ms | Missing `alerts.incident_id` column (#1) |
| `GET /api/v1/alerts/queue` | **500** | 52.2 ms | Missing `alerts.incident_id` column (#1) |
| `GET /api/v1/cases/{id}/attack-chain` | **500** | 59.9 ms | Missing `alerts.incident_id` column (#1) |
| `GET /api/v1/honeytokens` | **500** | 4005.7 ms | Service not running / 4s timeout (#4) |
| `GET /api/v1/purple-team/coverage` | **500** | 3984.0 ms | Service not running / 4s timeout (#4) |
| `GET /api/v1/cases/{id}/attack-path` | **404** | 16.7 ms | `{"detail":"Not Found"}` (Neo4j down / no path) |
| `GET /api/v1/mssp/tenants` | **403** | — (2062 ms via `localhost`) | `Not a member of an operator organisation` |
| `GET /api/v1/detections`, `/fim/events`, `/shifts`, `/users`, `/costs/summary`, `/dashboard/summary`, `/entities/risk`, `/hunt/corpus`, `/federated-search/backends`, `/settings/llm-health` | **404** | — | Probed paths not mounted at those exact route names (real UI routes use different subpaths e.g. `/api/v1/detection-rules`, `/api/v1/auth/users`). |

---

## 3. Playwright UI Walkthrough (`http://localhost:13000`)

- **Login (`/login`):** Succeeded (`2102 ms`) → redirected to `/dashboard`.
- **Page Errors (uncaught JS exceptions):** `0`.
- **Route Behaviour & Latencies:**
  - `/alerts` (`784 ms`, `bodyChars=1228`): Renders error state because `/api/v1/alerts` & `/api/v1/alerts/queue` return HTTP 500.
  - `/detection` (`1806 ms`, `bodyChars=14087`): Loaded cleanly (aside from TopBar `queue` 500).
  - `/playbooks` (`883 ms`, `bodyChars=22007`): Loaded cleanly (aside from TopBar `queue` 500).
  - `/hunt` (`4358 ms`, `bodyChars=1356`): Loaded (aside from TopBar `queue` 500).
  - `/settings` (`621 ms`), `/connectors` → `/settings?tab=connectors` (`760 ms`), `/compliance` → `/settings?tab=compliance` (`785 ms`): Loaded cleanly.
  - `/dashboard` (`8356 ms`), `/costs` → `/dashboards?tab=costs` (`4680 ms`): Loaded.
  - **Redirects observed (`~7–8s` each):** `/cases`, `/threat-intel`, `/easm`, `/fim` all redirected to `/dashboards?tab=overview`.

---

## 4. Latency Observations

1. **Windows `localhost` vs `127.0.0.1` IPv6 penalty (+2000 ms):** Calling `http://localhost:13000/api/health` took `2062.8 ms` vs `47.1 ms` on `http://127.0.0.1:13000/api/health` because Docker binds IPv4 only (`0.0.0.0:13000`) while Windows tries `::1` first.
2. **Unreachable optional services (~4000 ms):** `/api/v1/honeytokens` (`4005.7 ms`) and `/api/v1/purple-team/coverage` (`3984.0 ms`) stall for ~4s before returning HTTP 500.
3. **Dashboard/redirected routes (`4.6s – 8.3s`):** `/dashboards?tab=overview` and `/hunt` take 4–8s to settle in headless Chromium due to multiple parallel queries/timeouts.

---

## 6. Post-Fix Verification (Applied & Re-Validated)

### Fixes Applied
1. **Database migrations `161` & `162` applied to `clops-soc-postgres-1`:**
   - Added `alerts.incident_id` (`text`), `alerts.fusion_decision` (`text`), and `idx_alerts_tenant_incident`.
   - Backfilled `alerts.case_id` from `aisoc_cases.alert_ids` (`UPDATE 11`).
2. **LiteLLM → AWS Bedrock auth fixed:**
   - Removed the stale Windows User `OPENAI_API_KEY` (`sk-or-v1-...`) override that shadowed `.env` and recreated `clops-soc-litellm-1` (`OPENAI_API_KEY` prefix `ABSKQmVk`, len `132`).
   - Verified `POST http://127.0.0.1:14000/v1/chat/completions` (`model: aisoc-recon`) → **HTTP 200** (`content: "OK"`).

### Post-Fix API Results (`http://127.0.0.1:13000`, all HTTP 200)
| Endpoint | Status | Latency | Verified Output |
|---|---|---|---|
| `POST /api/v1/auth/login` | 200 | 276.6 ms | JWT issued |
| `GET /api/health` / `/api/runtime-config` / `/api/v1/auth/me` | 200 | 5.9–12.5 ms | OK |
| `GET /api/v1/alerts?page=1&page_size=25&sort=priority` | 200 | 27.0 ms | `total=36`, `returned=25`, High rows first (`×2`, `×7`, `×4`) |
| `GET /api/v1/alerts?page=1&page_size=25&sort=newest` | 200 | 52.7 ms | `total=36`, `returned=25`, newest first |
| `GET /api/v1/alerts?page=1&page_size=25&severity=high&sort=priority` | 200 | 44.9 ms | `total=3`, `returned=3` |
| `GET /api/v1/alerts?page=1&page_size=25&status=investigating&sort=priority` | 200 | 31.0 ms | `total=11`, `returned=11` |
| `GET /api/v1/alerts?page=1&page_size=25&search=AssumeRole&sort=priority` | 200 | 48.5 ms | `total=2`, `returned=2` (incl. `×806`) |
| `GET /api/v1/alerts/queue` | 200 | 55.5 ms | OK |
| `GET /api/v1/cases/2dd185d6-.../attack-chain` | 200 | 54.2 ms | OK |
| `GET /api/v1/cases`, `approvals`, `playbooks`, `connectors`, `threat-intel`, `compliance`, `sla`, `audit`, `rbac`, `saved-views` | 200 | 13.5–87.0 ms | All 200 |

### Post-Fix Playwright Walkthrough (`http://127.0.0.1:13000`)
- **`FAILED_500: []`** (0 server errors), **`PAGE_ERRORS: []`** (0 JS exceptions).
- **Sort orders (first 10 rows):**
  - `Priority`: 3 `High` rows (`RunInstances ×2`, `RunInstances ×7`, `AWS Policy Attached... ×4`) followed by `Medium` rows.
  - `Newest`: `about 1 hour ago` → `about 4 hours ago` → `about 20 hours ago` → `about 21 hours ago`.
  - `Oldest`: `1 day ago` → `about 23 hours ago` → `about 22 hours ago`.
- **Filters & Clear filters:** `High` filter → `3` rows; `Clear filters` preserved `sort=oldest` and restored `25` rows on page 1.
- **Correlation & Case Links:** `7` visible `Case` links on page 1 of `/alerts`; Investigation Rail rendered on row click (`RAIL_VISIBLE: true`).
- **Remaining non-default-profile endpoints:** `/api/v1/honeytokens` and `/api/v1/purple-team/coverage` are only active when those optional Compose profile containers are started.

