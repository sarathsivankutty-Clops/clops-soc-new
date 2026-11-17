# AiSOC Alerts, Correlation & Investigation Findings (Stage 1)

**Date:** 2026-11-17 | **Environment:** `http://localhost:13000` (`7024660b7a56_clops-soc-web-1` built at `dbdc15645`, `clops-soc-api-1`, `clops-soc-agents-1`, `clops-soc-fusion-1`, `clops-soc-postgres-1`, `clops-soc-redis-1`).
**Scope:** Read-only investigation of source, Postgres/Redis state, vitest output, and live Playwright network/DOM captures. No source files modified. Credentials and JWT tokens redacted.

---

## PART A: ALERT ORDERING AND FILTERS

### A.1 Live Reproduction (`http://localhost:13000/alerts`)

Initial load of `/alerts` logged in as `admin@clopssoc.com`:
- **Request:** `GET /api/v1/alerts?page=1&pageSize=25&sort=priority` → `200 OK` (`total: 33` during filter pass; `34` when row 4 arrived live 2 minutes later).
- **Facets returned (`total: 34` capture):** `by_severity: {"medium": 25, "high": 3, "low": 6}`, `by_status: {"investigating": 10, "triaged": 24}`, `unresolved: 34`.
- **First 10 rows rendered (`captured_extra.json`, sorted by `(severity DESC, created_at DESC, id DESC)`):**

| # | Alert ID | Title | Severity | Status | UI `TIME` Column | API `created_at` (UTC) | API `event_time` (UTC) |
|---|---|---|---|---|---|---|---|
| 1 | `6c71f129...` | `RunInstances` | `high` | `triaged` | `about 17 hours ago` | `2026-11-16T13:27:59Z` | `2026-11-16T13:24:40Z` |
| 2 | `cc328685...` | `RunInstances` | `high` | `investigating` | `about 21 hours ago` | `2026-11-16T09:28:06Z` | `2026-11-16T09:26:26Z` |
| 3 | `be1198e4...` | `AWS Policy Attached by a Principal Who Does Not Normally Attach Policies` | `high` | `investigating` | `4 days ago` | `2026-11-13T10:21:50Z` | `2026-11-13T10:21:50Z` |
| 4 | `d11d2b46...` | `AssumeRole` | `medium` | `triaged` | `3 minutes ago` | `2026-11-17T06:18:04Z` | `2026-11-17T06:15:23Z` |
| 5 | `9f60ddd8...` | `ConsoleLogin` | `medium` | `triaged` | `33 minutes ago` | `2026-11-17T05:48:03Z` | `2026-11-17T05:44:47Z` |
| 6 | `1401ed8a...` | `RunInstances` | `medium` | `triaged` | `about 1 hour ago` | `2026-11-17T05:33:16Z` | `2026-11-17T05:31:41Z` |
| 7 | `973cae1f...` | `AttachUserPolicy` | `medium` | `triaged` | `about 1 hour ago` | `2026-11-17T05:33:14Z` | `2026-11-17T05:30:05Z` |
| 8 | `59778ac9...` | `CreateUser` | `medium` | `triaged` | `about 1 hour ago` | `2026-11-17T05:33:11Z` | `2026-11-17T05:30:04Z` |
| 9 | `c3047d72...` | `ConsoleLogin` | `medium` | `triaged` | `about 1 hour ago` | `2026-11-17T05:33:07Z` | `2026-11-17T05:27:41Z` |
| 10 | `cd4b9b77...` | `ConsoleLogin` | `medium` | `investigating` | `about 17 hours ago` | `2026-11-16T13:03:03Z` | `2026-11-16T12:58:46Z` |

**Is it sorted?** Backend-wise **yes** by `(severity_rank_expr().asc(), Alert.created_at.desc(), Alert.id.desc())`. Visually to an analyst:
1. Row 3 (`4 days ago`) sits above Row 4 (`3 minutes ago`), Row 5 (`33 minutes ago`), and Rows 6–9 (`about 1 hour ago`), with **zero sort badge or column sort indicator** on `SEVERITY` or `TIME` (`AlertsView.tsx:695-698` renders static `<span>`s).
2. Clicking **`Clear filters`** on empty filter results sends `GET /api/v1/alerts?page=1&pageSize=25` **without `&sort=priority`** (`AlertsView.tsx:723`), silently flipping the API back to `sort=newest`, which immediately drops all `high` alerts (`Nov 13–16`) below recent `medium` alerts (`Nov 17`).

**Screenshots:**
- Initial `/alerts` (`sort=priority`): [part-a-alerts-initial.png](screenshots/part-a-alerts-initial.png)
- Severity = `High`: [part-a-filter-severity-high.png](screenshots/part-a-filter-severity-high.png)
- Status = `Investigating`: [part-a-filter-status-investigating.png](screenshots/part-a-filter-status-investigating.png)

#### Live Filter & Control Exercise (`total=33` session)

| Control Used | What UI Sent (Exact Path + Query) | HTTP | API Returned (`total` / `items` / First 3 Rows) | Table Changed? |
|---|---|---|---|---|
| Severity: `Critical` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&severity=critical` | 200 | `0` / `0` / `[]` | Yes → `"No alerts match these filters"` |
| Severity: `High` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&severity=high` | 200 | `3` / `3` / `RunInstances`, `RunInstances`, `AWS Policy Attached...` (`high`) | Yes (3 rows, KPI Total=3) |
| Severity: `Medium` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&severity=medium` | 200 | `24` / `24` / `ConsoleLogin`, `RunInstances`, `AttachUserPolicy` (`medium`) | Yes (24 rows) |
| Severity: `Low` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&severity=low` | 200 | `6` / `6` / `GetSecretValue`, `GetSecretValue`, `ListAccessKeys` (`low`) | Yes (6 rows) |
| Severity: `Info` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&severity=info` | 200 | `0` / `0` / `[]` | Yes (empty state) |
| Severity: `All severities` | `/api/v1/alerts?page=1&pageSize=25&sort=priority` | 200 | `33` / `25` / `RunInstances` (`high`) x2, `AWS Policy Attached...` (`high`) | Yes (25 rows) |
| Status: `New` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&status=new` | 200 | `0` / `0` / `[]` | Yes (empty state) |
| Status: `Investigating` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&status=investigating` | 200 | `10` / `10` / `RunInstances` (`high`), `AWS Policy Attached...` (`high`), `ConsoleLogin` (`medium`) | Yes (10 rows) |
| Status: `Triaged` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&status=triaged` | 200 | `23` / `23` | Yes (23 rows) |
| Status: `Resolved` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&status=resolved` | 200 | `0` / `0` | Yes (empty state) |
| Status: `False Positive` | `/api/v1/alerts?page=1&pageSize=25&sort=priority&status=false_positive` | 200 | `0` / `0` | Yes (empty state) |
| Button: `Clear filters` | `/api/v1/alerts?page=1&pageSize=25` (**drops `sort=priority`**) | 200 | `33` / `25` / `ConsoleLogin` (`medium`), `RunInstances` (`medium`), `AttachUserPolicy` (`medium`) | Yes (**wrong order: `high` buried!**) |
| **Source filter** | **Control does not exist in DOM** (`selects: []`) | — | — | N/A |
| **Time window filter** | **Control hidden in TopBar** (`TopBar.tsx:290-297`) | — | — | N/A |
| **Search box** | **Control does not exist in DOM** (only row checkboxes in `inputs`) | — | — | N/A |
| **Sort control** | **Control does not exist in DOM** (`ALERT`, `SEVERITY`, `STATUS`, `TIME` are `<span>`) | — | — | N/A |
| **Saved views** | Empty DB table (`saved_views = 0 rows`), shows `"None yet"` | — | — | N/A |

#### Direct API Contract Probes (from authenticated browser session)

| Probe URL Sent | HTTP | Result Observed | Proof |
|---|---|---|---|
| `/api/v1/alerts?page=1&page_size=25&sort=newest` | 200 | `total: 33`, row 1 is `medium ConsoleLogin (2026-11-17T05:48:03Z)` | Default `newest` buries `high` |
| `/api/v1/alerts?page=1&page_size=25&sort=severity` | **422** | `literal_error: Input should be 'newest' or 'priority'` | Any non-literal `sort` 422s |
| `/api/v1/alerts?page=1&page_size=25&search=AssumeRole` | 200 | `total: 33, count: 25`, returns `ConsoleLogin`, `RunInstances` | **`search` param is a dead no-op** |
| `/api/v1/alerts?page=1&pageSize=5&sort=priority` | 200 | `page_size: 25, count: 25` | **camelCase `pageSize` ignored by FastAPI** |
| `/api/v1/alerts?page=1&page_size=5&sort=priority` | 200 | `page_size: 5, count: 5` | snake_case `page_size` works |
| `/api/v1/alerts?page=1&page_size=25&source=aws_cloudtrail` | 200 | `total: 33, count: 25` (`sort` defaults to `newest`) | `source` query param ignored |
| `/api/v1/alerts?page=1&page_size=25&connector_type=aws_cloudtrail` | 200 | `total: 33, count: 25` | `connector_type` param ignored |
| `/api/v1/alerts?page=1&page_size=25&startTime=2026-11-17T00:00:00Z` | 200 | `total: 33, count: 25` | **camelCase `startTime` ignored** |
| `/api/v1/alerts?page=1&page_size=25&event_since=2026-11-17T00:00:00Z` | 200 | `total: 5, count: 5` | snake_case `event_since` works |

---

### A.2 Suspect Verification & Root Causes

- **2a) `sort`/`order` value mismatch:** **Partially Fixed; 3 Bugs Remain.**
  - Default load now sends `sort: 'priority'` (`AlertsView.tsx:378`), accepted by `alerts.py:809` (`Literal["newest", "priority"]`).
  - **Bug 1 (Clear filters drops sort):** `AlertsView.tsx:723` resets to `{ page: 1, pageSize: filters.pageSize ?? 25 }` without `sort: 'priority'`. Confirmed live: clicking Clear filters flips order to `sort=newest`, burying all 3 `high` alerts.
  - **Bug 2 (SavedViewsBar overwrites sort):** `AlertsView.tsx:589-595` spreads `...applied` without preserving `sort`.
  - **Bug 3 (No UI sort control & `createdAt` vs `event_time`):** No sort dropdown or clickable column header exists (`AlertsView.tsx:223-273, 695-698`), and `AlertRow` (`AlertsView.tsx:361`) formats `createdAt` (DB insert time) instead of `event_time` (actual telemetry time), with no visual indicator why `4 days ago` sits above `3 minutes ago`.

- **2b) `camelCase` vs `snake_case` mismatch (`13` TS errors claim):** **TS errors fixed on disk; runtime API-param & omitted-field mismatches CONFIRMED.**
  - `pnpm --filter @aisoc/web exec tsc --noEmit` exits `0` (**0 errors**). `normalizeAlert` (`apps/web/src/lib/api.ts:1783-2033`) now coerces `created_at`→`createdAt`, `confidence`/`confidence_score`→`confidenceScore`, `connector_type`→`source`.
  - **Confirmed runtime mismatch #1 (Query params):** `AlertFilters` (`api.ts:2088-2106`) defines camelCase `pageSize`, `startTime`, `endTime`, `source`, `assignee`, `tenantId`, and `alertsApi.list` (`api.ts:2143`) forwards them verbatim (`params: filters`). FastAPI `list_alerts` (`alerts.py:794-813`) declares `page_size`, `event_since`, `event_until`, `category`, `assigned_to_me`, `hostname`. Result: `pageSize`, `startTime`, `endTime`, `source` are **silently ignored** (verified live).
  - **Confirmed runtime mismatch #2 (Dropped response columns):** `AlertResponse` (`alerts.py:77-121`) omits ORM columns `rule_id`, `rule_name`, `entities`, `source_event_ids`, `parent_alert_id`, `child_alert_ids`, `is_merged`, `enrichment_data`, and `assigned_to_id` (`services/api/app/models/alert.py:34-111`), so `normalizeAlert` receives `undefined`.

- **2c) Global time-window / tenant selector overriding filters:** **Not Overriding — Hidden/Disconnected.**
  - `TimeWindowSelector` and `TenantSwitcher` are commented out in `TopBar.tsx:6-10, 290-297` (`[HIDDEN-UI CHROME-1]`). `AlertsView.tsx` never imports `useTimeWindow()` and never sends `event_since`/`event_until`.

- **2d) Client-side filtering over current page only / missing server filters:** **Severity/Status are server-side; `search`, `source`, & full status vocabulary are CONFIRMED BROKEN.**
  - Severity and status pills update SWR key `['alerts', filters]` (`AlertsView.tsx:387-390`) and hit the server.
  - **Dead `search` parameter:** `search: str | None = Query(default=None)` is declared at `services/api/app/api/v1/endpoints/alerts.py:806` and **never referenced in `filters` (`alerts.py:858-928`)**. Confirmed live (`?search=AssumeRole` returns all `33` alerts).
  - **Missing `source`/`connector_type` param:** `list_alerts` (`alerts.py:790-813`) has no `source` or `connector_type` parameter at all (only `category`).
  - **Status vocabulary gap:** `FiltersBar` (`AlertsView.tsx:233`) exposes 5 statuses (`new`, `investigating`, `triaged`, `resolved`, `false_positive`), while backend `WRITTEN_STATUSES` (`alert_status.py:82-93`) defines 12 (`triaging`, `in_progress`, `escalated`, `snoozed`, `closed`, `fp`, `dismissed`). Alerts in the other 7 statuses cannot be filtered in `/alerts` and render fallback label `"New"` (`AlertsView.tsx:214`).
  - Client-side behavior of `EntityRiskQueue`: Not verified beyond API calls (`?limit=50`).

- **2e) Default tab showing 0 rows (`Entities` vs `Alerts`):** **Confirmed historical bug, mitigated by `dbdc15645`.**
  - `AlertsView.tsx:383-384` previously defaulted `viewMode` to `'entities'`; `dbdc15645` switched default to `'alerts'`.
  - `EntityRiskQueue` calls `GET /api/v1/fusion/entity-risk/queue?limit=50` backed by volatile Redis ZSET `aisoc:fusion:rba:topn:{tenant}` (`entity_risk.py:179`). Currently Redis has `12` entities (`stats` + `queue` returned 200 OK), but any Redis eviction/decay leaves `Entities` at 0 rows while Postgres has 34 alerts. Note also Dark-on-Light contrast bug in [part-b-entities-tab.png](screenshots/part-b-entities-tab.png).

- **2f) Stat tiles capped by page size (`AlertsTileCounts`):** **Fixed on HEAD.**
  - Backend `_alert_facets` (`alerts.py:759-786, 909`) computes `by_severity`, `by_status`, and `unresolved` using `GROUP BY` over the active `WHERE` filters; `AlertsView.tsx:557-577` renders `facets.bySeverity.critical`, `facets.bySeverity.high`, `facets.unresolved`. Caveat: filtering to `High` changes the `Critical` and `Total` KPI tiles to the filtered subset (`0`, `3`), not global tenant totals (`part-a-filter-severity-high.png`).

---

### A.3 Test Run: `AlertsQueryOrder` & `AlertsTileCounts`

Executed `pnpm --filter @aisoc/web test -- AlertsQueryOrder AlertsTileCounts` → **Exit 0: 2 files passed, 7/7 tests passed (16.77s)**.

| Test File & Test Name | Exact Assertion | Component Behavior (`AlertsView.tsx`) | Verdict |
|---|---|---|---|
| `AlertsQueryOrder.test.tsx:59` `"requests severity-first ordering"` | Clicks `Alerts` tab, expects `requestedFilters()?.sort === 'priority'` | `AlertsView.tsx:378` initializes `filters.sort = 'priority'` | **Test is RIGHT** |
| `AlertsQueryOrder.test.tsx:66` `"sends a value the API accepts"` | Expects `['newest', 'priority']` to contain `sort` | Initial state passes `'priority'` | **Test is RIGHT** (gap: no test clicks `Clear filters`!) |
| `AlertsTileCounts.test.tsx:112` `"shows the whole-result-set critical count..."` | Page has 3 criticals, `facets.bySeverity.critical = 118`; expects `118`, not `3` | `AlertsView.tsx:563` reads `facets.bySeverity.critical` | **Test is RIGHT** |
| `AlertsTileCounts.test.tsx:119` `"shows the whole-result-set high count"` | Expects `64` even with 0 high rows on page | Reads `facets.bySeverity.high` | **Test is RIGHT** |
| `AlertsTileCounts.test.tsx:126` `"counts every unresolved status..."` | Expects `facets.unresolved` (`290`) | Reads `facets.unresolved` | **Test is RIGHT** |
| `AlertsTileCounts.test.tsx:134` `"renders a real zero when the server says zero"` | Missing `critical` key in `facets.bySeverity` → renders `'0'` | `facets.bySeverity.critical ?? 0` | **Test is RIGHT** |
| `AlertsTileCounts.test.tsx:149` `"does not fall back to the page-derived count..."` | Missing `facets` object → renders `'—'` | `facets ? ... : '—'` | **Test is RIGHT** |

---

### A.4 Real API Contract (`GET /api/v1/alerts`)

Verified in `services/api/app/api/v1/endpoints/alerts.py:789-929` and schemas at lines `77-121, 215-240`:

- **Accepted Query Parameters:**
  - `page: int = 1` (`>= 1`)
  - `page_size: int = 25` (`1..200`), or alias `limit: int | None` (`1..200`; `400` if both provided with differing values)
  - `severity: str | None` (exact match)
  - `status: str | None` (exact match)
  - `category: str | None` (exact match — **note:** `connector_type` / `source` is **not** a parameter)
  - `assigned_to_me: bool = False` (`Alert.assigned_to_id == current_user.user_id`)
  - `search: str | None` (**accepted cleanly, completely unimplemented**)
  - `min_confidence: int | None` (`0..100`, `Alert.confidence >= min_confidence`)
  - `confidence_label: str | None` (`high | medium | low`, else `400`)
  - `sort: Literal["newest", "priority"] = "newest"` (`422` at FastAPI validation / `400` direct call otherwise)
  - `event_since: AwareDatetime | None` (`Alert.event_time >= event_since`), `event_until: AwareDatetime | None` (`Alert.event_time < event_until`, `400` if `event_since >= event_until`)
  - `hostname: str | None` (`1..255`, matches `Alert.entities.contains([{"type":"host","value":hostname}])` OR `Alert.affected_hosts.contains([hostname])`)
- **Response Shape (`AlertListResponse`):** `{ items: AlertResponse[], total: int, page: int, page_size: int, pages: int, facets: { by_severity: Record<string,int>, by_status: Record<string,int>, unresolved: int } }`.
- **Per-item `AlertResponse` fields (`alerts.py:77-121`):** `id, tenant_id, title, description, severity, status, priority, category, mitre_tactics, mitre_techniques, connector_type, ai_score, ai_summary, ai_recommendations, confidence, confidence_label, confidence_rationale, disposition, src_ip_class, src_ip_class_dataset_version, affected_ips, affected_hosts, affected_users, case_id, tags, event_time, first_seen, last_seen, snoozed_until, snoozed_by_id, created_at, updated_at`.

---

## PART B: CORRELATION DISPLAY

### B.1 End-to-End Field Trace (Fusion → DB/Redis → API → UI)

| Correlation Mechanism / Field | Producer (`file:line`) | Persisted in DB / Redis | API Exposed? (`file:line`) | UI Read / Ignored? |
|---|---|---|---|---|
| **Dedup fingerprint** (`dedup_hash`) | `RawAlert.fingerprint()` `services/fusion/app/models/alert.py:116-130`; `Deduplicator` `deduplicator.py:42-80` | `alerts.dedup_hash` (`alert_sink.py:131`); Redis `aisoc:fusion:dedup:{fp}` | Dropped from `AlertResponse` (`alerts.py:77-121`) | **Ignored** everywhere |
| **Dedup source list & rollup count** (`source_event_ids`, `alert_occurrences.occurrence_count`) | `AlertSink._record_deduplicated_event()` `alert_sink.py:195-266, 1069-1123` | `alerts.source_event_ids` (up to 200); table `alert_occurrences` (`16` rows in DB, max `615`) | Zero SQL queries on `alert_occurrences` in `services/api/app/`; `AlertResponse` omits `source_event_ids` (`attack_chain.py` returns `source_event_ids`) | **Ignored** on `/alerts`, Rail, `/alerts/[id]`, Cases |
| **Incident grouping** (`incident_id`, `fusion_decision`, `IncidentSummary`) | `RawAlert.correlation_key()` `models/alert.py:132-173`; `Correlator.correlate()` `correlator.py:44-140` | Redis `aisoc:fusion:incident:{id}`; **dropped** in `AlertSink._INSERT_SQL` (`alert_sink.py:127-154`); only prose survives in `alerts.narrative` | No Fusion endpoint serves `IncidentSummary`; `narrative_projection.py:182-194` infers `"correlated"` only from `alert.case_id` (`0/34` set in DB!) | **Dropped**; every alert Rail falsely says `"this is the first alert on a newly opened incident"` |
| **Fuse-time Attack Chain** (`fused.enrichments["attack_chain"]`: `chain_id`, `position`, `prior_alert_ids`, `member_count`, `joined_by_kind`) | `AttackChainGrouper.assign()` `attack_chain_grouper.py:324-426`; `fusion_engine.py:289-295` | Redis `chain:idx:*`, `chain:members:*`; **dropped** in `AlertSink._INSERT_SQL` (never inserts `enrichment_data` — `0/34` non-empty in DB!) | `alerts.enrichment_data` omitted from `AlertResponse`; Rail reads `enrichment_data` (`alert_rail.py:276`), always `{}` | **Dropped** end-to-end |
| **Cross-vendor root-cause** (`root_cause_findings`, `alert_root_cause_members`) | `AlertSink._link_root_cause()` `alert_sink.py:99-125, 287-337, 968-1004` | Postgres tables `root_cause_findings` / `alert_root_cause_members` (`0` rows in live DB: needs `hostname`/`domain` + `mitre_techniques` + `principal`) | **0 references** in `services/api/app/` | **Never read** |
| **Session keys** (`session_id`, `session_key_kind`, `originating_human`) | `AlertSink._INSERT_SQL` (`alert_sink.py:136, 621-623`) | Postgres columns on `alerts` | Not mapped on `Alert` ORM (`models/alert.py`) or `AlertResponse` | **Ignored** |
| **Hierarchy** (`parent_alert_id`, `child_alert_ids`, `is_merged`) | Declared on `Alert` ORM (`models/alert.py:97-99`) | Empty/false (never written by `AlertSink`) | Not in `AlertResponse` (`alerts.py:77-121`) | **Ignored** |
| **Case back-link** (`alerts.case_id` vs `aisoc_cases.alert_ids`) | `create_case()` `cases.py:559-589` writes `aisoc_cases.alert_ids` only | `0/34` DB `alerts` rows have `case_id` set despite `22` rows in `aisoc_cases` | `AlertResponse.case_id` is always `null` | Rail / `/alerts/[id]` show `"Start AI Investigation"` instead of linking to existing Case |
| **Entity Risk Queue (RBA)** | `EntityRiskEngine.observe()` `entity_risk.py:144-166` | Redis `aisoc:fusion:rba:*` (`12` entities, `2` promoted in live Redis) | `GET /api/v1/fusion/entity-risk/queue` (`router.py:156-182`) | **Shown** in `/alerts` → `Entities` tab (`EntityRiskQueue.tsx`) |
| **Case Attack Chain (BFS)** | On-demand 3-hop BFS over `affected_users`/`ips`/`hosts`/`assets` (`services/api/app/services/attack_chain.py:107-332`) | Cached in `aisoc_attack_chains` (`5` non-empty chains in DB) | `GET /api/v1/cases/{id}/attack-chain?window=24h` (`attack_chain.py:52-189`) | **Shown** in `/cases/{id}?tab=attack-chain` (`CaseWorkspace.tsx:1820-2140`) |
| **Case Attack Path (Graph)** | Neo4j query or SQL fallback `_attack_path_from_relational` (`graph.py:321-407`) | Reads `aisoc_cases.alert_ids` & `mitre_techniques` only | `GET /api/v1/graph/attack-path/{id}` (`graph.py:321-407`) | **Shown** in `?tab=attack-path`, but SQL fallback shows only `Case -> INCLUDES -> Alert` (no entities/siblings) |
| **Standalone Entity Graph (`/graph`)** | `get_graph_overview` (`graph.py:410-430`) | Neo4j | `GET /api/v1/graph` | **DEAD:** `apps/web/src/app/(app)/graph/page.tsx:12` redirects `/graph` → `/dashboard`! |

---

### B.2 UI Surface Audit (Screenshots & Real vs Placeholder Data)

| Screen | Screenshot | Real Data Shown | Missing / Placeholder / Broken |
|---|---|---|---|
| `/alerts` (`Alerts` tab) | [part-a-alerts-initial.png](screenshots/part-a-alerts-initial.png) | 25 of 34 alerts, confidence (`LOW`/`MED`), severity, status, `mitreTechniques[0]` | Flat ungrouped list (`RunInstances` x3, `ConsoleLogin` x3). No `occurrence_count`, no user/IP entity subtitles, no case/incident/chain badge. `Clear filters` drops `sort=priority`. |
| `/alerts` (`Entities` tab) | [part-b-entities-tab.png](screenshots/part-b-entities-tab.png) | **Real Redis RBA data:** `12` entities (`Dnyaneshwar_Gitte` 84 CRITICAL PROMOTED, `45.112.53.58` 36 MEDIUM PROMOTED, `Sarath_S` 26), `26.5:1` ratio | Hardcoded dark cards (`bg-gray-900/40`) look washed out in Light Mode; ephemeral Redis store drops to 0 on eviction/restart. |
| `/alerts` → Rail (`Story` & `Details`) | [part-b-alert-rail-story.png](screenshots/part-b-alert-rail-story.png), [part-b-alert-rail-details.png](screenshots/part-b-alert-rail-details.png) | Evidence counts (`User 1`, `Ip 1`, `Mitre Technique 1`), `confidence 45/100`, narrative bullets (`ML priority rank +0.95`, `ML anomaly -0.15`), `Related entities` (`Deepthi_KU`, `45.112.53.58`) | `PROGRESSION` empty (`"No ATT&CK tactic is mapped..."`); `Response` empty (`0` actions); narrative claims `"first alert on a newly opened incident"`; entity pivot links `/graph?entity=...` redirect to `/dashboard`! Dark rail background in Light Mode makes section headings nearly invisible. |
| `/alerts/[id]` (`be1198e4...`) | [part-b-alert-detail.png](screenshots/part-b-alert-detail.png) | Title, 9-factor `Detection Confidence` (`52/100`), `T1098.003`, 2-row audit timeline, Raw JSON + `wazuhLocator` | **Zero correlation UI:** does not render `narrative`, `related_entities`, `mini_timeline`, sibling alerts, or existing Case `fe8d8ddc...` link (`Start AI Investigation` shown instead). |
| `/cases/[id]` → `Overview` | [part-b-case-overview.png](screenshots/part-b-case-overview.png) | Linked alerts `(1)`: `be1198e4...`, 3-event Timeline, Jira/Slack/Summary controls | Only lists `1` manually linked alert, hiding the 8 correlated sibling alerts; dark card colors clash with Light Mode. |
| `/cases/[id]` → `Attack Path` | [part-b-attack-path.png](screenshots/part-b-attack-path.png) | `2 nodes · 1 edge` (`Case -> INCLUDES -> Alert`) | No Neo4j data; SQL fallback (`graph.py:321-407`) omits users, IPs, and all 8 correlated alerts. |
| `/cases/[id]` → `Attack Chain` | [part-b-attack-chain.png](screenshots/part-b-attack-chain.png) | **Real data:** `9 links · 12 entities · 17 edges · window 24h · confidence 89%`, scores `0.89`/`0.87`, Δt (`+11m`, `+46m`, `+28m`), shared `Endpoint 45.112.53.58` & `Identity Deepthi_KU` | Only visible inside Case workspace on `?tab=attack-chain`; items in chain are non-clickable cards (no link to `/alerts/[id]`); dark slate cards render low-contrast gray text in Light Mode. |
| `/graph` | [part-b-graph.png](screenshots/part-b-graph.png) | Redirects to `/dashboards` (`Overview` page) | **`redirect('/dashboard')` at `apps/web/src/app/(app)/graph/page.tsx:12`** completely disables standalone graph & all entity pivots from Rail. |

---

### B.3 Correlated AWS CloudTrail Group Walkthrough

Verified in live Postgres (`alerts`, `alert_occurrences`, `aisoc_attack_chains`) and Playwright captures for seed alert `be1198e4-baf6-57bc-a7d3-1dcc2735c8a4` (`AWS Policy Attached by a Principal Who Does Not Normally Attach Policies`, `high`, `2026-11-13T10:21:50Z`, `Deepthi_KU` @ `45.112.53.58`) and Case `fe8d8ddc-eaa3-43b5-a4ca-b8fae490cf56`:

1. **In Postgres (`aisoc_attack_chains` & `GET /api/v1/cases/fe8d8ddc.../attack-chain?window=24h`):** 9 CloudTrail alerts belong together within `±46m` sharing `Identity: Deepthi_KU` and/or `Endpoint: 45.112.53.58`:
   - Seed: `be1198e4...` `AWS Policy Attached...` (`high`, `source_event_ids: 2`, `occ_count: 2`)
   - Link 1: `b8874969...` `AttachUserPolicy` (`score 0.894`, `Δt 273.61s`, shares `45.112.53.58` & `Deepthi_KU`, `source_event_ids: 1`)
   - Link 2: `a9aa3111...` `CreatePolicy` (`score 0.8928`, `Δt 644.39s`, `source_event_ids: 3` deduplicated events)
   - Link 3: `347f5158...` `AttachRolePolicy` (`score 0.8928`, `Δt 644.39s`, `source_event_ids: 3`)
   - Link 4: `4817...` `CreateRole` (`score 0.8928`, `Δt +11m`)
   - Links 5–7: `CreateRole`, `AttachRolePolicy`, `CreatePolicy` (`+46m`, shares `Deepthi_KU`)
   - Links 8–9: `GetAccountSummary`, `ListAccessKeys` (`+28m`, `low`, shares `45.112.53.58` & `Deepthi_KU`).
   Meanwhile in `alert_occurrences` (`psql`), deduplication folded hundreds of repeats onto single rows — e.g., `AssumeRole` (`1e901795...`, `occurrence_count = 615`), `ListAccessKeys` (`90eb052d...`, `occurrence_count = 34`), `RunInstances` (`cc328685...`, `occurrence_count = 7`).
2. **What the analyst sees at each screen:**
   - **`/alerts`:** Sees `RunInstances` twice and `AWS Policy Attached...` as 3 separate ungrouped rows; sees **zero** count badge (`×2`, `×7`, `×615`), **zero** shared actor (`Deepthi_KU` / `45.112.53.58`), and **no** clue `be1198e4...` belongs to a 9-alert sequence or Case `fe8d8ddc...`.
   - **Rail on `/alerts`:** Clicking `be1198e4...` shows `User 1, Ip 1` on Story tab and `"first alert on a newly opened incident"` on Details tab; clicking `Deepthi_KU` or `45.112.53.58` redirects to `/dashboards`.
   - **`/alerts/be1198e4...`:** Shows raw CloudTrail JSON and `"Start AI Investigation"` button — hides the 8 sibling alerts and existing Case.
   - **`/cases/fe8d8ddc...`:** `Overview` shows `Linked alerts (1)` and `Attack Path` shows `Case -> Alert` (2 nodes). **Only clicking `Attack Chain` reveals all 9 correlated alerts.**

---

### B.4 Analyst Questions Matrix

| Analyst Question | Data Exists in DB / Redis? | Currently Surfaced in UI? | Gap |
|---|---|---|---|
| **Which alerts belong together?** | **Yes:** `aisoc_attack_chains` (Postgres BFS), `alert_occurrences` (`16` rows), `aisoc_cases.alert_ids`, Redis `chain:members:*` & `aisoc:fusion:incident:*` | **Partially:** Only on `/cases/[id]?tab=attack-chain` (if manually opened as a Case) and `/alerts` → `Entities` tab (`contributing_alerts`) | Invisible on `/alerts` grid, Rail, `/alerts/[id]`, and `Case -> Overview`/`Attack Path`; `AlertSink` drops `incident_id` and `attack_chain` |
| **Why were they grouped?** | **Yes:** `AttackChain.chain[].shared_entities` (`kind`, `value`), `score`, `dt_seconds`, `AttackChainGrouper` `joined_by_kind`/`strength`, `Correlator` `correlation_keys` | **Partially:** `Attack Chain` tab shows entity chips (`Endpoint 45.112.53.58`, `Identity Deepthi_KU`) & score | No human-readable grouping reason on `/alerts` or Rail; `enrichment_data["attack_chain"]` & Redis `IncidentSummary` dropped before API |
| **What is the timeline?** | **Yes:** `Alert.event_time`, `AttackChain.chain[].dt_seconds` & `event_time`, `alert_occurrences.first_seen/last_seen`, `ForensicFindings.timeline` | **Partially:** `Attack Chain` shows `Δt +11m` cards; `AlertDetailView` shows 2-step DB created/updated timeline | `/alerts` shows `created_at` instead of `event_time`; Case Investigation card **drops `forensic.timeline` entirely** (`CaseWorkspace.tsx:1514-1540`) |
| **Which entities are shared?** | **Yes:** `affected_users`, `affected_ips`, `affected_hosts`, `entities`, `AttackChain.entity_graph`, `related_entities` in `/alerts/{id}` | **Partially:** Rail `Details` tab lists `related_entities` chips; `Attack Chain` bottom bar lists entities | Pivoting a Rail entity chip hits dead `/graph` redirect (`page.tsx:12`); `/alerts` table & `/alerts/[id]` hide entity summary |
| **What is the blast radius?** | **Partially:** `ForensicFindings.blast_radius` (string), `ReconFindings.attack_surface`, `AttackChain.entity_graph` (`node_count`, `edge_count`), `alert_occurrences.occurrence_count` | **Almost None:** `Attack Chain` shows `12 entities · 17 edges` header only | `CaseWorkspace.tsx:1514-1540` **drops both `forensic.blast_radius` and `recon.attack_surface`**; Neo4j attack path is empty |

---

## PART C: INVESTIGATION FINDINGS AND FIX SUGGESTIONS

### C.1 Completed Investigation JSON vs UI Rendering

Inspected live completed 4-agent run `d2db9add-6684-4984-99e6-92df8cac5ebc` on Case `8ccf6d3c-7ad6-4c22-842c-ed4eb3d9f7bf` (`PutBucketPolicy`, 21 ledger events, 10,978 tokens, `$0.0034`, `bedrock/qwen.qwen3-32b-v1:0`).

**Trimmed real JSON returned by `GET /api/v1/cases/8ccf6d3c-7ad6-4c22-842c-ed4eb3d9f7bf/investigations/d2db9add-6684-4984-99e6-92df8cac5ebc`:**
```json
{
  "run_id": "d2db9add-6684-4984-99e6-92df8cac5ebc",
  "status": "completed",
  "recon": {
    "iocs": [{"type": "ip", "value": "45.112.53.58"}, {"type": "domain", "value": "s3.amazonaws.com"}],
    "related_incidents": [],
    "threat_actors": ["Unknown", "Potential insider or misconfigured access"],
    "attack_surface": {"affected_systems": ["AWS S3 bucket"], "data_at_risk": "Data stored in the S3 bucket could be exposed..."},
    "mitre_techniques": ["T1530", "T1190"],
    "summary": "The alert indicates a PutBucketPolicy event on an AWS S3 bucket..."
  },
  "forensic": {
    "timeline": [{"ts": "2026-11-16T11:56:41+00:00", "event": "PutBucketPolicy event on s3.amazonaws.com", "src": "aws_cloudtrail"}],
    "artefacts": ["s3.amazonaws.com"],
    "root_cause_hypothesis": "A PutBucketPolicy event was triggered, potentially modifying access permissions...",
    "blast_radius": "The S3 bucket and its contents are at risk of exposure or unauthorized access...",
    "confidence": 0.4,
    "summary": "A PutBucketPolicy event was detected on an AWS S3 bucket...",
    "groundedness": 1
  },
  "responder": {
    "recommended_actions": [
      {"priority": 1, "action": "Review the S3 bucket policy to determine...", "rationale": "Understanding the specific...", "risk": "medium"},
      {"priority": 2, "action": "Identify the user or service that initiated...", "rationale": "Confirming the source...", "risk": "medium"},
      {"priority": 3, "action": "Check for any recent changes to IAM roles...", "rationale": "Misconfigured IAM...", "risk": "medium"}
    ],
    "containment_steps": ["Step 1: Temporarily restrict access...", "Step 2: Enable logging..."],
    "eradication_steps": ["Revert the bucket policy...", "Remove or disable any IAM roles..."],
    "recovery_steps": ["Verify that the bucket policy aligns...", "Conduct a full audit..."],
    "estimated_effort_hours": 4,
    "risk_level": "medium",
    "dry_run": true,
    "summary": "A PutBucketPolicy event was detected, potentially altering..."
  }
}
```
And `GET .../report.md` returns a 4,365-char Markdown document starting with `# Incident Report — 8ccf6d3c-7ad6-4c22-842c-ed4eb3d9f7bf`, containing sections `## Executive Summary`, `## Timeline of Events` (pipe table), `## IOC Analysis` (pipe table), `## MITRE ATT&CK Mapping`.

#### Field-by-Field Rendering Matrix (`CaseWorkspace.tsx:1458-1607, 2254-2344`)

| Agent Phase | Field (`services/agents/app/investigator/state.py:64-125`) | Rendered in `Investigation` Tab? | Dropped? |
|---|---|---|---|
| **Recon** | `summary` (`str`) | Yes (`CaseWorkspace.tsx:1484-1486`) | No |
| Recon | `iocs` (`list[{type,value}]`) | **Capped at 5** (`slice(0, 5)` at `1491`) | Items > 5 dropped |
| Recon | `mitre_techniques` (`list[str]`) | Yes (`1499-1510`) | No |
| Recon | `threat_actors`, `related_incidents`, `attack_surface` | **No** | **Dropped completely** |
| **Forensic** | `summary`, `root_cause_hypothesis`, `confidence` | Yes (`1518-1539`) | No |
| Forensic | `timeline`, `artefacts`, `blast_radius`, `groundedness` | **No** | **Dropped completely** |
| **Responder** | `summary`, `risk_level` | Yes (`1545-1547, 1581-1594`) | No |
| Responder | `recommended_actions` (`list[{priority,action,rationale,risk}]`) | **Capped at 4** (`slice(0, 4)` at `1550`), plain text bullets | Items > 4 dropped; **no status/action button** |
| Responder | `containment_steps`, `eradication_steps`, `recovery_steps`, `estimated_effort_hours`, `dry_run` | **No** | **Dropped completely** |
| **Report** | `report.md` (`str`) | Shown on `Report` tab as raw `<pre>` (`CaseWorkspace.tsx:2339-2341`) | Headings/tables unrendered |

**CRITICAL DB FALLBACK BUG (`services/api/app/api/v1/endpoints/cases.py:1929-1949`):**
- Right now, `clops-soc-agents-1` has been up 23h so `GET .../investigations/{run_id}` hits agents' in-memory `_runs` dict (`started_at`, full structured `recon`/`forensic`/`responder`).
- When `agents` restarts or evicts `_runs`, `cases.py:1907` falls back to Postgres `investigation_events` via `_ledger_phase_blocks` → `_parse_llm_json(ev.payload)` (`cases.py:1929-1949`), which calls `json.loads(raw)` **without stripping markdown code fences**.
- Verified in Postgres `investigation_events` for `d2db9add...` and [part-c-ledger-expanded.png](screenshots/part-c-ledger-expanded.png): `ReconAgent` (`seq 1`) and `ResponderAgent` (`seq 15`) store `payload.response` wrapped in ```` ```json\n{...}\n``` ````! Unlike `ReconAgent._llm_recon` (`recon_agent.py:124`, which uses `parse_json_object`), `_parse_llm_json` raises `ValueError` and returns `{}`, **erasing all Recon IOCs/MITRE and all Responder actions** after an `agents` restart (notice in `d2db9add`, `seq 10` ForensicAgent happens to lack fences, so `_has_content(forensic, ...)` is `True` and `router_state` fallback doesn't even run — leaving `recon` and `responder` empty with only a 1-line summary!).

---

### C.2 Readability Audit (`Investigation`, `Report`, `Ledger` Tabs)

**Screenshots:**
- Investigation tab: [part-c-investigation-tab.png](screenshots/part-c-investigation-tab.png)
- Report tab: [part-c-report-tab.png](screenshots/part-c-report-tab.png)
- Ledger tab: [part-c-ledger-tab.png](screenshots/part-c-ledger-tab.png)
- Ledger step `#01` expanded: [part-c-ledger-expanded.png](screenshots/part-c-ledger-expanded.png)

**Specific Readability & Triage Defects Observed:**
1. **Severe Light-Mode contrast failure (`CaseWorkspace.tsx:1482-1595, 1714, 1950, 2339`):** Cards use hardcoded `bg-slate-900/40`, `text-slate-400`, `text-slate-500`. In Light Mode (`part-c-investigation-tab.png`, `part-c-report-tab.png`), card bodies render dark gray with **nearly unreadable dark/faint slate prose** (Recon summary, Forensic summary, Download `.md` button, `"Opened from alert: ..."` subtitle).
2. **Raw Markdown wall of text on `Report` tab (`CaseWorkspace.tsx:2339-2341`):** `<pre className="whitespace-pre-wrap font-mono text-[11px]">` renders literal `#`, `**`, backticks, and `|---|---|` pipe tables (and `[Not Provided]` timestamps even when `forensic.timeline` has `2026-11-16T11:56:41Z`).
3. **Missing critical decision context:** Investigation tab drops `forensic.timeline`, `forensic.blast_radius`, `forensic.groundedness`, `recon.attack_surface`, `responder.containment_steps`/`eradication_steps`/`recovery_steps`, and `estimated_effort_hours` — hiding the exact information an analyst needs to judge blast radius and act.
4. **Actions have no state, target, or button:** Responder actions render as `P1`..`P3` prose paragraphs with `MEDIUM` risk pill (`"Review the S3 bucket policy..."`) — no target entity (`s3.amazonaws.com` / `45.112.53.58`), no `proposed`/`pending_approval`/`executed` badge, and no button to stage or run.
5. **Zero provenance links from findings to evidence:** Nothing links `45.112.53.58`, `T1530`, or `Root cause hypothesis` to Ledger `seq` numbers (`#01`, `#04`, `#10`) or raw `source_event_ids` (even though `InvestigationEvent` `evidence_cited` rows already record them at `seq 4–7, 11`). Also note Ledger `seq 2–3`: `enrich_ioc` returned `[Errno -2] Name or service not known` yet logged `success: true`.

---

### C.3 Where Recommended Actions Live & Execution / `dry_run` Behavior

| Location | Data Source & Status Today | UI Surface | Execute / Approve Wired? | `dry_run` Behavior |
|---|---|---|---|---|
| **1) Case Responder Output** (`responder.recommended_actions`) | Live LLM JSON in `CaseWorkspace.tsx:1548-1580` (`d2db9add` has 3 actions + containment/eradication/recovery steps) | Case `Investigation` tab (`Response` card) | **Text only.** No button, no approval POST, no runbook link | `ResponderAgent` (`responder_agent.py:213`) hardcodes `dry_run=True` with prompt `"All actions are DRY-RUN only — do NOT attempt to execute anything."` (`seq 14`) |
| **2) Alert Auto-Triage Recommendations** (`alerts.ai_recommendations` → `recommended_actions`) | **Always `[]` in DB (`0/34` rows)!** `FusedAlertTriageWorker.triage()` calls `_record()` at `fused_alert_consumer.py:983` **before** `_maybe_escalate()` at line `1013` when `state.proposed_actions` is empty; furthermore `_record()` (`1686-1695`) writes key `"action_type"`/`"description"`, whereas `build_recommended_actions()` (`alert_rail.py:550`) requires key `"action"` and drops any dict missing it | `InvestigationRail.tsx:759-796`, `AttackStory.tsx:316-362`, `QueueView.tsx:281-293` | **Unwired stub.** `AttackStory.tsx:325-359` renders checkboxes that say `"1 action staged. Submitting sends them for approval..."`, but **has no Submit button** and `InvestigationRail.tsx:228` passes no `onStageActions` handler | N/A (dead field) |
| **3) Deep Explain Drawer** (`/api/v1/alerts/{id}/explain`) | Generated LLM/template `next_steps` / `recommended_actions` with optional `playbook_id` | `ExplainDrawer.tsx:774-780, 973-981` | **Fake on DetailView, hidden on Rail:** `AlertDetailView.tsx:1169-1172` passes `onRunPlaybook` that only fires `toast.success("Queued runbook " + pid)` (**zero API call!**); `InvestigationRail.tsx:248-254` omits `onRunPlaybook` so button doesn't render | None (client toast only) |
| **4) Action & Approval APIs** (`POST /api/v1/approvals`, `POST /api/v1/approvals/{id}/decide`, `POST /api/v1/actions`) | Real DB & gate backend (`approvals.py:271-480`, `services/actions/app/api/router.py:209-260`, `remediation.py:6-11`), currently `0` rows in `agent_approvals` | `/responder/approvals` (`approvals/page.tsx:187-216`); `/dashboards?tab=operations` (`ResponseActionsPanel.tsx`) links to `/responder/approvals` | **Works end-to-end only on mobile `/responder/approvals`**, disconnected from `/cases/[id]` and `/alerts` | `services/actions` evaluates blast radius + `apply_matrix(request, ...)` (`router.py:220-225`) and gates execution behind `pending_approval` or autonomous L0–L4 policy |

---

## PART D: PROPOSAL (Design Only — No Code)

### D.1 Part A: Alert Ordering & Filters

- **Confirmed Root Causes:**
  1. `AlertsView.tsx:723` (`Clear filters`) and `589` (`SavedViewsBar`) drop `sort: 'priority'`, reverting to `sort=newest`.
  2. `AlertFilters` (`api.ts:2088-2106, 2143`) sends camelCase params (`pageSize`, `startTime`, `endTime`, `source`) that `list_alerts` (`alerts.py:790-813`) ignores.
  3. `alerts.py:806` declares `search` as a no-op and has no `connector_type` filter; `FiltersBar` (`AlertsView.tsx:223-273`) exposes no search, source, sort, or time-window UI and misses 7/12 `WRITTEN_STATUSES`.
  4. `AlertRow` (`AlertsView.tsx:361`) shows `createdAt` instead of `event_time`, headers are non-interactive `<span>`s, and un-grouped duplicate rows + `MED`/`High` pill confusion obscure order.
- **Smallest Fix:**
  - Preserve `sort: filters.sort ?? 'priority'` in `Clear filters` and `SavedViewsBar` `onApply`; map `AlertFilters` camelCase→snake_case in `alertsApi.list`; implement `ILike` on `Alert.title`/`description`/`entities`/`affected_*` for `search` and add `connector_type` param in `alerts.py`; add explicit `Sort: Priority | Newest` button + Search input in `FiltersBar`.
- **Better SOC Analyst Design (`/alerts` Triage Strip & Grid):**
```
+---------------------------------------------------------------------------------------------------+
| KPI: Total 34 | Critical 0 | High 3 | Unresolved 34         View: [Alerts] [Entities]             |
+---------------------------------------------------------------------------------------------------+
| [ Search title, user, IP, host... ]  Source:[All v]  Window:[24h v]  Sort:[Severity+Time v] [Reset]|
| Sev: [All] Crit High Med Low   Status: [All] Open(New/Triaging) Triaged Investigating Resolved     |
+---------------------------------------------------------------------------------------------------+
| [ ] ALERT / ACTOR / CORRELATION                  CONF   SEV    STATUS         OCCURRED (event_time)|
| [x] AWS Policy Attached... (T1098.003)            52%   HIGH   Investigating  Nov 13 15:51  [x2]  |
|     aws_cloudtrail · user:Deepthi_KU · ip:45.112.53.58  [Case fe8d · 9 in chain]                  |
| [ ] RunInstances · user:Dnyaneshwar_Gitte         44%   HIGH   Investigating  -21h          [x7]  |
|     aws_cloudtrail · ip:45.112.53.58 · [Chain: 2 alerts]                                          |
+---------------------------------------------------------------------------------------------------+
```
  - Always show **primary actor (`user`/`host`/`ip`)** on line 2 of every alert row so `RunInstances` / `ConsoleLogin` rows are distinguishable under time pressure.
  - Display **`event_time`** in `TIME` column with tooltip for `created_at` ingest time; highlight active sort column (`Severity ▾` / `Time ▾`) so `4d ago High` above `3m ago Medium` is self-explanatory.
  - Collapse confidence into numeric `%` (`52%`) instead of `"MED"` pill right beside `"High"` severity badge.
- **Files to Change:**
  - `[BACKEND]` `services/api/app/api/v1/endpoints/alerts.py` (wire `search`, add `connector_type`, add optional `sort="event_time"`/`priority` option, populate `occurrence_count`, `case_id`, `chain_alert_count` on `AlertResponse`).
  - `[FRONTEND]` `apps/web/src/lib/api.ts` (translate `AlertFilters` to snake_case params), `apps/web/src/components/alerts/AlertsView.tsx` (search/source/window/sort controls, `Clear filters` preserving `sort`, clickable sort headers, actor subtitle + `%` confidence, Light-Mode token fixes in `SavedViewsBar.tsx`).
- **Data Needed:** Searchable fields (`title`, `affected_*`, `entities`, `connector_type`, `event_time`) all **exist** in Postgres; only `occurrence_count` join (`alert_occurrences`) is missing from `AlertResponse`.
- **Tests to Add:** Frontend Vitest proving `Clear filters` & `SavedViewsBar` preserve `sort: 'priority'`, `alertsApi.list` emits `page_size`/`event_since`/`connector_type`, and `search` passes cleanly; Backend pytest verifying `GET /api/v1/alerts?search=...&connector_type=...`.
- **Risk:** Low. Query additions use indexed/bounded `Alert` columns; preserve existing `sort` default (`newest`) for external SDK callers.

---

### D.2 Part B: Correlation Display

- **Confirmed Root Causes:**
  1. `AlertSink._INSERT_SQL` (`alert_sink.py:127-154`) drops `incident_id`, `fusion_decision`, and `enrichment_data` (including `attack_chain` from `AttackChainGrouper`), and nothing in `services/api` reads `alert_occurrences` (`16` rows) or `root_cause_findings`.
  2. `create_case()` (`cases.py:559-589`) populates `aisoc_cases.alert_ids` without setting `alerts.case_id` (`0/34` set), breaking Rail narrative correlation text (`narrative_projection.py:182-194`) and hiding existing Cases from `/alerts/[id]` and Rail.
  3. `/graph` redirects to `/dashboard` (`apps/web/src/app/(app)/graph/page.tsx:12`), breaking every Rail entity pivot link (`/graph?entity=...`), while `_attack_path_from_relational` (`graph.py:321-407`) emits only `Case -> Alert`.
  4. Light-Mode theme classes (`bg-slate-900/40`, `bg-gray-900/60`) break readability on `EntityRiskQueue`, `InvestigationRail`, `AttackChainPanel`, and `CaseWorkspace`.
- **Smallest Fix:**
  - Include `LEFT JOIN alert_occurrences` (`COALESCE(occurrence_count, 1)`) and subquery/lateral lookup of `aisoc_cases` membership (`alert_id = ANY(alert_ids)`) in `GET /api/v1/alerts` & `GET /api/v1/alerts/{id}`.
  - Fix entity pivots in `alert_rail.py:205` to route to `/alerts?search=...` or `/hunt?q=...` (instead of dead `/graph`), OR restore `/graph` page behind a Case/Alerts drilldown.
  - Render `related_entities` + `narrative` + sibling correlated alerts (`attack-chain`) cleanly on `/alerts/[id]` (`AlertDetailView.tsx`) and fix Light Mode surface tokens across `InvestigationRail.tsx` & `AttackChainPanel`.
- **Better SOC Analyst Design (`Alert Detail` / `Rail` Correlation Panel):**
```
+---------------------------------------------------------------------------------------------------+
| ALERT HEADER: AWS Policy Attached...  [HIGH] [Investigating]  Seen: x2 (Nov 13 15:51 - 15:51)     |
| CORRELATED STORY: Part of 9-alert sequence (confidence 89%) via [Deepthi_KU] [45.112.53.58]       |
| CASE LINK: [Open Case #fe8d8ddc (Investigating) ->]   (instead of duplicate "Start AI Inv.")      |
+---------------------------------------------------------------------------------------------------+
| CORRELATED SIBLINGS (9 alerts · -10m to +46m around this alert)                  [View Full Chain] |
|   t-4m   AttachUserPolicy      (Med)   shared: Deepthi_KU, 45.112.53.58          [Open Alert ->]  |
| * t=0    AWS Policy Attached.. (High)  SEED · T1098.003                                           |
|   t+11m  CreatePolicy (x3)     (Med)   shared: Deepthi_KU, 45.112.53.58          [Open Alert ->]  |
|   t+11m  AttachRolePolicy (x3) (Med)   shared: Deepthi_KU, 45.112.53.58          [Open Alert ->]  |
|   t+46m  CreateRole            (Med)   shared: Deepthi_KU                        [Open Alert ->]  |
+---------------------------------------------------------------------------------------------------+
```
- **Files to Change:**
  - `[BACKEND]` `services/fusion/app/services/alert_sink.py` (persist `enrichment_data` & `incident_id` column if migrated, or expose Fusion incident/chain read), `services/api/app/api/v1/endpoints/cases.py` (sync `alerts.case_id` on `create_case` / `link_alerts`), `services/api/app/api/v1/endpoints/alerts.py` (join `alert_occurrences.occurrence_count` & sibling chain summary / `source_event_ids`), `services/api/app/api/v1/endpoints/graph.py` (enrich `_attack_path_from_relational` with entities + correlated chain alerts), `services/api/app/services/alert_rail.py` (update `_graph_pivot` away from redirected `/graph` or add sibling alerts to rail).
  - `[FRONTEND]` `apps/web/src/components/alerts/AlertDetailView.tsx` (surface Case link, Narrative, Related Entities, Correlated Siblings), `apps/web/src/components/alerts/InvestigationRail.tsx` & `EntityRiskQueue.tsx` & `CaseWorkspace.tsx` (clickable chain items, occurrence pill `×N`, semantic `bg-surface-*` / `text-fg-*` tokens).
- **Data Needed:** `alert_occurrences` (`16` rows), `aisoc_attack_chains` (`5` populated chains), `alerts.source_event_ids`, `alerts.affected_*` **all exist**; `alerts.case_id` needs sync backfill from `aisoc_cases.alert_ids`; `enrichment_data["attack_chain"]` & `incident_id` require `AlertSink` write-path fix.
- **Tests to Add:** Backend pytest for `create_case` updating `alerts.case_id` + `GET /api/v1/alerts/{id}` returning `occurrence_count` and working `case_id`; Vitest ensuring Rail/Detail links to existing Case and renders correlated siblings without hitting `/graph` 307 redirect.
- **Risk:** Medium for `AlertSink` DB column additions (needs additive SQL migration & backfill guard); Low for API joins and UI surfaces.

---

### D.3 Part C: Investigation Findings, Report & Action Execution

- **Confirmed Root Causes:**
  1. `_parse_llm_json` (`cases.py:1929-1949`) uses raw `json.loads(raw)` instead of fence-tolerant JSON extraction (`parse_json_object`), dropping `recon` and `responder` structured payloads from DB `investigation_events` after any `agents` restart.
  2. `CaseWorkspace.tsx:1469-1607` truncates IOCs (`slice(0, 5)`) and actions (`slice(0, 4)`), drops `forensic.timeline`, `artefacts`, `blast_radius`, `groundedness`, `recon.attack_surface`, `containment_steps`/`eradication_steps`/`recovery_steps`, `estimated_effort_hours`, and `dry_run`.
  3. `ReportPanel` (`CaseWorkspace.tsx:2339-2341`) dumps `reportMd` into `<pre>`; `CaseWorkspace` cards hardcode dark `bg-slate-900/40` illegible in Light Mode.
  4. Action disconnect: `alerts.ai_recommendations` is always `[]` (`fused_alert_consumer.py:983` runs before `_maybe_escalate` at `1013` + key `"action_type"` vs `"action"` mismatch in `alert_rail.py:550`); `AttackStory.tsx` has no Submit button; `AlertDetailView.tsx:1169` `"Run runbook"` only fires a toast; `ResponderAgent` (`dry_run=True`) outputs text-only bullets with no bridge to `POST /api/v1/approvals`.
- **Smallest Fix:**
  - Update `_parse_llm_json` (`cases.py:1929`) to strip ```` ```json ... ``` ```` fences before `json.loads`.
  - Render `forensic.blast_radius`, `forensic.timeline`, `recon.attack_surface`, and full containment/eradication/recovery lists in `CaseWorkspace.tsx`, switch `<pre>` in `ReportPanel` to structured Markdown rendering (headings + tables + badges), and replace dark `slate-900`/`slate-400` classes with `surface-*`/`fg-*` theme tokens.
  - Wire a real **"Request Approval"** button on each `ResponderPlan` recommended action (`POST /api/v1/approvals`) displaying approval status (`pending`/`approved`/`executed` + `[DRY-RUN]` badge) instead of dead prose bullets, and remove/wire `AlertDetailView.tsx:1169` toast-only callback.
- **Better SOC Analyst Design (`Case -> Investigation` & `Report` Tabs):**
```
+---------------------------------------------------------------------------------------------------+
| VERDICT & CONFIDENCE: 40% confidence · Groundedness 100% · Risk: MEDIUM · Dry-Run Mode   [Runbook]|
| BLAST RADIUS: AWS S3 bucket & stored contents at risk of unauthorized access (s3.amazonaws.com)    |
+---------------------------------------------------------------------------------------------------+
| 1. TIMELINE & EVIDENCE            | 2. IOCs & ATT&CK (Click -> Ledger #seq) | 3. PHASED PLAN      |
|  11:56:41Z PutBucketPolicy        |  [ip]     45.112.53.58       (#04)   | Containment (2)      |
|  (aws_cloudtrail) · [#10]         |  [domain] s3.amazonaws.com   (#05)   | Eradication (2)      |
|                                   |  [T1530]  Data Cloud Storage (#06)   | Recovery    (2)      |
+---------------------------------------------------------------------------------------------------+
| RECOMMENDED ACTIONS (Bridge -> /api/v1/approvals)                                                 |
|  [P1 · MED] Review S3 bucket policy for unintended access  Target: s3.amazonaws.com  [Request Appr]|
|  [P2 · MED] Verify principal behind PutBucketPolicy      Target: 45.112.53.58      [Approved -> Go]|
+---------------------------------------------------------------------------------------------------+
```
- **Files to Change:**
  - `[BACKEND]` `services/api/app/api/v1/endpoints/cases.py` (`_parse_llm_json` strip fences + map action approval status), `services/agents/app/workers/fused_alert_consumer.py` (persist `proposed_actions` **after** `_maybe_escalate` or emit `"action"` key matching `alert_rail.py:550`).
  - `[FRONTEND]` `apps/web/src/components/cases/CaseWorkspace.tsx` (render all Recon/Forensic/Responder fields, semantic tokens, Markdown table/heading renderer in `ReportPanel`, `"Request Approval"` CTA wired to `approvalsApi.create`), `apps/web/src/components/alerts/AttackStory.tsx` & `AlertDetailView.tsx` (remove fake `"Queued runbook"` toast; add real Submit / Approval / Runbook execution).
- **Data Needed:** Full structured Recon/Forensic/Responder JSON **already exists** in `agents` & `investigation_events`; approval/execution state **already exists** via `agent_approvals` & `services/actions`. Missing link: linking `case_id`/`run_id` onto `agent_approvals` queries in `CaseWorkspace`.
- **Tests to Add:** Backend pytest for `_parse_llm_json` against real fenced JSON payloads from `investigation_events` + `_record()` writing `"action"` key; Frontend Vitest rendering fenced fallback block, Markdown table in `ReportPanel`, and verifying `"Request Approval"` posts to `/api/v1/approvals` (not toast-only).
- **Risk:** Medium when wiring `POST /api/v1/approvals` + action execution (must preserve `dry_run=True` indicator & server-side permission/separation-of-duties checks already enforced in `approvals.py:233-269`); Low for UI & JSON fence parsing.

---

### D.4 Shippable Build Order

1. **PR 1 — Alert Queue Contract, Search, Sort & Token Contrast (`Part A`):**
   - `[BACKEND]` Wire `search` + `connector_type` + `occurrence_count` join in `services/api/app/api/v1/endpoints/alerts.py`.
   - `[FRONTEND]` Translate `AlertFilters` to snake_case in `api.ts`; fix `Clear filters` & `SavedViewsBar` dropping `sort: 'priority'`; add Search/Source/Sort controls, `event_time` display, and actor subtitles in `AlertsView.tsx`; fix `SavedViewsBar` Light-Mode tokens.
2. **PR 2 — Surface Correlation, Case Links & Working Pivots (`Part B`):**
   - `[BACKEND]` Sync `alerts.case_id` on case creation/linking (`cases.py`); persist `enrichment_data["attack_chain"]` & `incident_id` (`alert_sink.py`); enrich `attack-path` SQL fallback (`graph.py`); replace dead `/graph` pivot links (`alert_rail.py`).
   - `[FRONTEND]` Surface Case link, correlated siblings, `occurrence_count` pills, and Rail sections on `AlertDetailView.tsx`; make `AttackChainPanel` items clickable links to alerts; fix Light-Mode tokens across Rail & EntityRiskQueue.
3. **PR 3 — Durable Investigation Recovery, Full Findings & Readable Report (`Part C.1–C.2`):**
   - `[BACKEND]` Fix `_parse_llm_json` markdown code-fence stripping in `cases.py:1929`.
   - `[FRONTEND]` Display dropped Recon/Forensic/Responder fields (`timeline`, `blast_radius`, `attack_surface`, `containment_steps`/`eradication_steps`/`recovery_steps`, `dry_run`) + evidence Ledger `seq` links + proper Markdown table/heading rendering in `ReportPanel` + Light-Mode token fixes across `CaseWorkspace.tsx`.
4. **PR 4 — Actionable Remediation & Approval Bridge (`Part C.3`):**
   - `[BACKEND]` Reorder `FusedAlertTriageWorker._record()` vs `_maybe_escalate` and align `"action"` key (`fused_alert_consumer.py`).
   - `[FRONTEND]` Wire real approval submission (`POST /api/v1/approvals`) from Case Investigation & `AttackStory` staged checkboxes, and replace fake toast in `AlertDetailView.tsx` `"Run runbook"` with real playbook/action API dispatch.
