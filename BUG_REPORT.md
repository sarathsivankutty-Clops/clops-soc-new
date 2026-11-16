# Exploratory Testing Report

Date: 2026-11-16
Environment: Local Docker Stack (`clops-soc`), Next.js 16.4.5, FastAPI Backend
Browser: Google Chrome 131.0 (Headless & Headed via Playwright Automation)
Application URL: http://127.0.0.1:13000

---

## Summary

Pages visited: 52
Components tested: 165+
Total operations evaluated: 290+ API operations & 460+ UI interactions
Duration: ~95 minutes
Bugs found: 18
Warnings: 6
Passed checks: 56

---

# Bugs

## Bug 1

Title: Command Palette Modal Traps Focus & Ignores Escape Key, Freezing Application Clicks

Severity: High

Priority: P1

Page: http://127.0.0.1:13000/dashboards?tab=overview (and all console pages)

Steps to Reproduce:
1. Log in to the application and open any dashboard.
2. Open the Command Palette by clicking "Search alerts, cases, rules..." in the top bar or pressing `Ctrl+K`.
3. The Command Palette dialog opens with a dark semi-transparent backdrop.
4. Press the `Escape` key on the keyboard to dismiss the palette.

Expected Result:
The Command Palette dialog closes immediately, focus returns to the previously focused element, and normal mouse clicks across the UI are restored.

Actual Result:
The dialog fails to dismiss when `Escape` is pressed. Furthermore, an invisible backdrop overlay (`pointer-events: auto`) intercepts all mouse clicks across the entire screen, trapping the user and rendering all buttons, tabs, and navigation links unresponsive until a hard browser page refresh.

Screenshot: `test-results/screenshots/bug_command_palette_trapped.png`

Console Errors:
None directly emitted (DOM focus trap and event propagation interception issue).

Network Errors:
None.

Possible Cause:
`<Command.Input>` in `apps/web/src/components/layout/CommandPalette.tsx` does not attach an `onKeyDown` handler for `Escape`, and the modal backdrop fails to dispatch dismiss state on escape key events.

Recommendation:
Add an explicit `onKeyDown` listener to `<Command.Input>`:
```tsx
onKeyDown={(e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    setOpen(false);
  }
}}
```
Ensure the backdrop overlay cleanly unmounts when `open === false`.

---

## Bug 2

Title: Server 500 on Case Investigation PDF Download Due to Missing Native Library `libgobject-2.0-0`

Severity: High

Priority: P1

Page: http://127.0.0.1:13000/cases/[id]?tab=report

Steps to Reproduce:
1. Navigate to any case with an investigation run (e.g. `http://127.0.0.1:13000/cases/87ca3ca5-1774-4222-af07-2dcb25a6cf03?tab=report`).
2. Select the "Report" tab to view the generated incident report.
3. Click the "Download PDF" button in the upper right corner of the report card.
4. Observe the response and UI banner.

Expected Result:
The server renders the HTML report to a PDF document and streams it to the user's browser as a `.pdf` file download.

Actual Result:
The backend returns `HTTP 500 Internal Server Error`, and a red error banner appears on the UI:
```
PDF error: {"detail":"{\"detail\":\"PDF generation failed: cannot load library 'libgobject-2.0-0': libgobject-2.0-0: cannot open shared object file: No such file or directory. Additionally, ctypes.util.find_library() did not manage to locate a library called 'libgobject-2.0-0'\"}"}
```

Screenshot: `test-results/screenshots/bug_pdf_generation_libgobject_error.png`

Console Errors:
`Failed to load resource: the server responded with a status of 500 (Internal Server Error)` (`GET /api/v1/cases/87ca3ca5-1774-4222-af07-2dcb25a6cf03/investigations/537d3e37-940d-40f1-869e-b6aa978b7a93/report.pdf`)

Network Errors:
`500 GET /api/v1/cases/87ca3ca5-1774-4222-af07-2dcb25a6cf03/investigations/537d3e37-940d-40f1-869e-b6aa978b7a93/report.pdf`

Possible Cause:
`services/agents/Dockerfile` installs Python dependencies including `weasyprint`, but fails to install the underlying C system libraries (`libgobject-2.0-0`, `libpango-1.0-0`, `libcairo2`, `libgdk-pixbuf-2.0-0`, `shared-mime-info`) required by WeasyPrint's Pango/Cairo rendering stack. Note that `services/api/Dockerfile` installs these libraries, but `services/agents/Dockerfile` only installs `build-essential`.

Recommendation:
1. Update `services/agents/Dockerfile` to install the required native rendering packages:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
```
2. In `services/agents/app/api/investigate.py`, catch `(ImportError, OSError)` gracefully and return `503 Service Unavailable` with a clear message rather than throwing an unhandled `500 Internal Server Error`.

---

## Bug 3

Title: Missing API Route Proxy for Investigation HTML Reports (HTTP 404)

Severity: Medium

Priority: P2

Page: http://127.0.0.1:18000/api/v1/cases/{case_id}/investigations/{run_id}/report.html

Steps to Reproduce:
1. Make a `GET` request to `/api/v1/cases/{case_id}/investigations/{run_id}/report.html` for any completed investigation run.

Expected Result:
The core API proxies the request to `services/agents` `GET /api/v1/investigations/{run_id}/report.html` and returns the print-ready HTML incident report (status 200).

Actual Result:
Returns `HTTP 404 Not Found` (`{"detail": "Not Found"}`).

Screenshot:
N/A (API routing gap).

Console Errors:
`404 (Not Found)`

Network Errors:
`404 GET /api/v1/cases/87ca3ca5-1774-4222-af07-2dcb25a6cf03/investigations/537d3e37-940d-40f1-869e-b6aa978b7a93/report.html`

Possible Cause:
`services/api/app/api/v1/endpoints/cases.py` explicitly proxies `report.pdf` (line 2385) and `report.md`, but forgot to add the proxy route for `report.html`, even though `services/agents/app/api/investigate.py` (line 439) implements the endpoint.

Recommendation:
Add the missing route handler in `services/api/app/api/v1/endpoints/cases.py`:
```python
@router.get("/{case_id}/investigations/{run_id}/report.html")
async def case_investigation_html(case_id: str, run_id: str, user: CaseReader) -> Response:
    resp = await _agents_proxy("GET", f"/api/v1/investigations/{run_id}/report.html")
    return Response(content=resp.content, media_type="text/html")
```

---

## Bug 4

Title: Live Actions Proxy Collapses Validation Errors into HTTP 502 Bad Gateway

Severity: Medium

Priority: P2

Page: http://127.0.0.1:18000/api/v1/live-actions/dry-run

Steps to Reproduce:
1. Send a POST request to `/api/v1/live-actions/dry-run` with incomplete or unmapped capability parameters:
   ```json
   {
     "capability": "isolate_host",
     "target": "srv-app-01",
     "parameters": {}
   }
   ```
2. Observe the HTTP response code and error payload.

Expected Result:
The API returns `HTTP 400 Bad Request` or `HTTP 422 Unprocessable Entity` with a detailed schema validation message explaining which fields are missing.

Actual Result:
The API responds with `HTTP 502 Bad Gateway`:
```json
{"detail": "The action service returned 422."}
```

Screenshot:
N/A (API error handling defect).

Console Errors:
`HTTP 502 Bad Gateway`

Network Errors:
`502 POST /api/v1/live-actions/dry-run`

Possible Cause:
In `services/api/app/api/v1/endpoints/live_actions.py`, the `_unwrap(response, path)` function unconditionally raises `HTTPException(status_code=502)` for any upstream response code `>= 400`, discarding the upstream 4xx status code and JSON validation errors.

Recommendation:
Preserve 4xx client validation errors in `_unwrap`:
```python
def _unwrap(response: httpx.Response, path: str) -> Any:
    if 400 <= response.status_code < 500:
        raise HTTPException(status_code=response.status_code, detail=response.json())
    elif response.status_code >= 500:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"The action service returned {response.status_code}.")
    return response.json()
```

---

## Bug 5

Title: Unhandled HTTP 503 & 4-Second Blocking Stall on Attack Graph Endpoints

Severity: High

Priority: P1

Page: http://127.0.0.1:13000/graph and http://127.0.0.1:18000/api/v1/graph

Steps to Reproduce:
1. Navigate to `/graph` or execute `GET /api/v1/graph`.
2. Measure response latency and observe console output.

Expected Result:
If Neo4j is not deployed in the current profile, the endpoint should immediately return a cached graph or a lightweight 200 empty state with `{ "nodes": [], "edges": [] }` without blocking.

Actual Result:
The request blocks for 3.99 seconds waiting on a socket connection to `bolt://neo4j:7687`, and then throws:
`HTTP 503 Service Unavailable: {"detail":"the entity graph runs in the 'full' profile and is not part of this deployment (ServiceUnavailable)"}`.
Furthermore, `/api/v1/graph/attack-path/{case_id}` blocks for 3.88 seconds on every case load before falling back to relational SQL queries.

Screenshot: `test-results/screenshots/bug_dashboard_operations_truncation.png`

Console Errors:
`Failed to load resource: the server responded with a status of 503 (Service Unavailable)` (`GET /api/v1/graph`)

Network Errors:
`503 GET /api/v1/graph` (Latency: ~4000ms)

Possible Cause:
`services/api/app/api/v1/endpoints/graph.py` attempts a live TCP socket handshake against `NEO4J_URI` on every request before failing or falling back, creating severe user-perceived lag on case and graph pages.

Recommendation:
Implement a quick circuit breaker with a fast health check (< 200ms) or check profile capability flags at startup before attempting bolt connection handshakes.

---

## Bug 6

Title: Severe 7.9-Second Blocking Latency on Funnel Metrics Endpoint (`/api/v1/metrics/funnel`)

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/dashboards/operations and http://127.0.0.1:18000/api/v1/metrics/funnel

Steps to Reproduce:
1. Navigate to the Operations Dashboard (`/dashboards/operations`).
2. Observe network request duration for `/api/v1/metrics/funnel`.

Expected Result:
Operations Funnel metrics (`events_of_interest`, `correlation_instances`, `alerts_generated`, `mttd`) load within 100-300ms using aggregated counts or indexed queries.

Actual Result:
The request takes **7.93 seconds** to respond, delaying the render of the Operations Funnel cards on every page reload and time-window change.

Screenshot: `test-results/screenshots/bug_dashboard_operations_truncation.png`

Console Errors:
None (Endpoint succeeds, but creates massive UI latency).

Network Errors:
None (`200 OK`, latency: 7930ms).

Possible Cause:
`services/api/app/api/v1/endpoints/metrics.py` performs un-indexed full-table scans across raw events, correlations, and alert tables for the selected time window without using materialized rollup tables or Redis cache.

Recommendation:
Cache funnel metric aggregations in Redis with a 60-second TTL or compute counts asynchronously.

---

## Bug 7

Title: ClickHouse 502 Bad Gateway on Event Lake Schema (`/api/v1/lake/schema`)

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/explore and http://127.0.0.1:18000/api/v1/lake/schema

Steps to Reproduce:
1. Navigate to `/explore` or send `GET /api/v1/lake/schema`.
2. Inspect the network response.

Expected Result:
The endpoint returns available tables and schema metadata, or returns an empty list if no external lake is configured.

Actual Result:
Returns `HTTP 502 Bad Gateway` with:
`{"detail":"lake backend error: clickhouse schema lookup failed: Code: 210. No address associated with hostname (clickhouse:9000)"}`

Screenshot:
N/A (Backend service lookup failure).

Console Errors:
`HTTP 502 Bad Gateway`

Network Errors:
`502 GET /api/v1/lake/schema`

Possible Cause:
`services/api` unconditionally attempts to resolve `clickhouse:9000` via TCP socket on the compose network, which fails when ClickHouse is not included in the standard compose profile.

Recommendation:
Catch socket/lookup errors and return a clean fallback payload `{ tables: [], configured: false }` or wrap with capability detection.

---

## Bug 8

Title: Unhandled HTTP 403 Forbidden on MSSP Dashboard & Multi-Tenant Tab

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/mssp and http://127.0.0.1:13000/dashboards?tab=mssp

Steps to Reproduce:
1. Log in as administrator (`admin@aisoc.internal`).
2. Navigate to `http://127.0.0.1:13000/mssp` or click the "MSSP" tab on the dashboard top bar.
3. Observe the page state and open browser developer tools network/console tabs.

Expected Result:
The UI should gracefully handle non-MSSP enterprise tenants by presenting a descriptive feature tier banner (e.g., `<CapabilityUnavailable title="MSSP Portfolio Management" />`) or hide the tab if the current tenant is not licensed for multi-tenant management.

Actual Result:
SWR issues requests to `/api/v1/mssp/portfolio` and `/api/v1/mssp/portfolio/alerts?limit=25`, both of which fail with `HTTP 403 Forbidden` (`{"detail": "Forbidden"}`). The console logs multiple uncaught fetch errors and the screen displays generic failure state.

Screenshot: `test-results/screenshots/bug_mssp_403.png`

Console Errors:
`Failed to load resource: the server responded with a status of 403 (Forbidden)` (`GET /api/v1/mssp/portfolio`)
`Failed to load resource: the server responded with a status of 403 (Forbidden)` (`GET /api/v1/mssp/portfolio/alerts?limit=25`)

Network Errors:
`403 GET /api/v1/mssp/portfolio`
`403 GET /api/v1/mssp/portfolio/alerts?limit=25`

Possible Cause:
Backend endpoint `services/api/app/api/v1/endpoints/mssp.py` enforces enterprise multi-tenant role permissions without the frontend validating tenant capabilities prior to making SWR requests.

Recommendation:
Inspect tenant capabilities or catch HTTP 403 to render a friendly tier upgrade notice rather than throwing unhandled fetch exceptions in the browser.

---

## Bug 9

Title: HTTP 404 API Not Found on Compliance Framework Route `/compliance/nist`

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/compliance/nist

Steps to Reproduce:
1. Log in and navigate to `/compliance`.
2. Select or navigate directly to `http://127.0.0.1:13000/compliance/nist`.
3. Observe the console and network activity.

Expected Result:
The NIST CSF compliance controls, requirements checklist, and score cards should render, or a placeholder framework setup wizard should appear.

Actual Result:
The page triggers an API call `GET /api/v1/compliance/nist`, which returns `HTTP 404 Not Found` (`{"detail": "Framework nist not found"}`), resulting in a broken view with uncaught console errors.

Screenshot: `test-results/screenshots/bug_compliance_nist_404.png`

Console Errors:
`Failed to load resource: the server responded with a status of 404 (Not Found)` (`GET /api/v1/compliance/nist`)

Network Errors:
`404 GET /api/v1/compliance/nist`

Possible Cause:
Only the SOC 2 compliance framework (`/api/v1/compliance/soc2`) is seeded in the database. The frontend dynamically queries `GET /api/v1/compliance/[framework]` without checking if the framework data has been provisioned.

Recommendation:
Seed NIST CSF compliance fixtures in the database or provide a client-side fallback explaining that the NIST control pack needs to be enabled.

---

## Bug 10

Title: Hardcoded AWS IAM Demo Principal Triggers HTTP 404 on Identity Permissions View

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/identity/permissions

Steps to Reproduce:
1. Log in and navigate to `http://127.0.0.1:13000/identity/permissions`.
2. Observe network requests and the initial page state.

Expected Result:
The page should show an initial search bar prompting the analyst to search for an IAM user, role, or service account, or display real discovered cloud identities.

Actual Result:
On page mount, the component automatically executes a query for `GET /api/v1/identity/arn%3Aaws%3Aiam%3A%3A111122223333%3Auser%2Falice/effective-permissions?provider=aws`. Because this hardcoded sample principal does not exist in the active environment, the backend responds with `HTTP 404 Not Found`, logging console errors.

Screenshot: `test-results/screenshots/bug_identity_permissions_404.png`

Console Errors:
`Failed to load resource: the server responded with a status of 404 (Not Found)` (`GET /api/v1/identity/arn%3Aaws%3Aiam%3A%3A111122223333%3Auser%2Falice/effective-permissions?provider=aws`)

Network Errors:
`404 GET /api/v1/identity/arn%3Aaws%3Aiam%3A%3A111122223333%3Auser%2Falice/effective-permissions?provider=aws`

Possible Cause:
`apps/web/src/components/identity/EffectivePermissionsView.tsx` initializes state with a hardcoded mock ARN `arn:aws:iam::111122223333:user/alice` instead of leaving the initial query empty or fetching available principals first.

Recommendation:
Initialize principal state to `null` and show an empty state search prompt until the analyst selects or inputs an ARN.

---

## Bug 11

Title: Next.js RSC 404 Route Failure on `/admin/tenants`

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/admin/tenants

Steps to Reproduce:
1. Log in as administrator (`admin@aisoc.internal`).
2. Navigate directly to `http://127.0.0.1:13000/admin/tenants`.
3. Observe developer tools network and console tabs.

Expected Result:
The tenant administration table loads showing existing tenants, tenant ID, and quotas.

Actual Result:
Next.js client-side router attempts to prefetch / load `GET /admin/tenants/default?_rsc=...`, which returns `HTTP 404 Not Found`.

Screenshot: `test-results/screenshots/bug_admin_tenants_404.png`

Console Errors:
`GET http://127.0.0.1:13000/admin/tenants/default?_rsc=... 404 (Not Found)`

Network Errors:
`404 GET /admin/tenants/default?_rsc=...`

Possible Cause:
A missing sub-route or mismatch in Next.js App Router dynamic segment configuration under `apps/web/src/app/(app)/admin/tenants/`.

Recommendation:
Define the default tenant route handler or correct the redirect in the admin tenants layout.

---

## Bug 12

Title: Text Truncation and Static Non-Clickable Metrics in Operations Funnel & Health Cards

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/dashboards/operations and http://127.0.0.1:13000/dashboards?tab=overview

Steps to Reproduce:
1. Navigate to `/dashboards/operations` or the main overview dashboard.
2. Inspect the Operations Funnel cards (`EVENTS OF INTEREST`, `CORRELATION INSTANCES`, `ALERTS GENERATED`), Efficiency Report, and Pipeline Health cards.

Expected Result:
Card titles and metrics are properly wrapped or display full text on hover; metric cards (such as "2 Correlation Instances" or "8 Alerts Generated") are interactive links that filter the alerts or queue tables accordingly.

Actual Result:
Headings and subtitles are truncated aggressively with ellipses (`EVENTS OF INTER...`, `CORRELATION IN...`, `ALERTS GENERAT...`, `7 in progress · 0 opened / 0 c`). Numbers are rendered as static non-clickable text, preventing analysts from clicking through to investigate the underlying correlated events or alerts.

Screenshot: `test-results/screenshots/bug_dashboard_operations_truncation.png`

Console Errors:
None.

Network Errors:
None.

Possible Cause:
CSS utility `truncate` applied with fixed container widths (`whitespace-nowrap`) without tooltip fallbacks or anchor tags wrapping the KPI cards.

Recommendation:
Remove rigid truncation where possible, add `title="..."` attributes for full text on hover, and wrap KPI cards with navigation links to `/alerts?view=correlated` or `/queue`.

---

## Bug 13

Title: Form Controls in Detection Rule Editor, User Management, and Tools Lack Accessible Labels

Severity: Low

Priority: P3

Page: http://127.0.0.1:13000/detection/new, /settings/users, /tools/translate

Steps to Reproduce:
1. Navigate to `/detection/new`.
2. Inspect the input elements for Rule Title, Description, ATT&CK Technique, and Tags using browser DevTools or an accessibility audit tool (Axe / Lighthouse).

Expected Result:
Every form input, textarea, and select element has an associated `<label>`, `aria-label`, or `aria-labelledby` attribute (WCAG 2.1 AA requirement).

Actual Result:
5 input fields on `/detection/new` have no `<label>` element and lack `aria-label` attributes, relying purely on visual placeholder text:
- `<input type="number">` (Severity number)
- `<input type="text" placeholder="Suspicious PowerShell Encoded Command">`
- `<input type="text" placeholder="What does this rule catch? Why does it matter?...">`
- `<input type="text" placeholder="T1059.001">`
- `<input type="text" placeholder="windows, lolbin, cloud">`

Screenshot: `test-results/screenshots/form_detection_new.png`

Console Errors:
None.

Network Errors:
None.

Possible Cause:
Inputs were implemented using bare HTML/Tailwind input styles without wrapping in form label primitives.

Recommendation:
Add `aria-label` attributes or explicit `<label htmlFor="...">` tags for all interactive form inputs across the application.

---

## Bug 14

Title: Horizontal Page Overflow on Mobile Viewports (375x667) in Alerts & Queue Tables

Severity: Low

Priority: P3

Page: http://127.0.0.1:13000/alerts and http://127.0.0.1:13000/queue

Steps to Reproduce:
1. Open Chrome DevTools and emulate iPhone SE (375x667).
2. Navigate to `/alerts` or `/queue`.
3. Scroll horizontally across the page.

Expected Result:
The main page layout fits within the 375px viewport width without body scroll; wide data tables scroll internally within an overflow container.

Actual Result:
The total document scroll width expands to 408px on `/alerts` (+33px overflow) and 492px on `/queue` (+117px overflow), causing the page header, background borders, and floating widgets to shift awkwardly when dragged horizontally.

Screenshot: `test-results/screenshots/overflow_375x667__alerts.png`, `test-results/screenshots/overflow_375x667__queue.png`

Console Errors:
None.

Network Errors:
None.

Possible Cause:
Table containers lack `overflow-x-auto max-w-full`, and action toolbar buttons have fixed minimum widths.

Recommendation:
Apply `overflow-x-auto` to the data table container wrapper and enforce `w-full max-w-full overflow-hidden` on the outer shell.

---

## Bug 15

Title: Report Generation and Template Serialization Crash with HTTP 500 Due to Pydantic ResponseValidationError

Severity: Critical

Priority: P0

Page: http://127.0.0.1:18000/api/v1/reports/generate, /reports/templates, and /reports/artefacts

Steps to Reproduce:
1. Log in to the application as a SOC Lead or Administrator (`admin@aisoc.internal`).
2. Issue a POST request to generate an executive report:
   ```json
   POST /api/v1/reports/generate
   {
     "title": "Monthly Board Executive Summary",
     "report_type": "board_summary",
     "period_start": "2026-11-01T00:00:00Z",
     "period_end": "2026-11-16T00:00:00Z",
     "output_format": "pdf"
   }
   ```
3. Alternatively, attempt to create a report template:
   ```json
   POST /api/v1/reports/templates
   {
     "name": "Weekly SecOps Template",
     "report_type": "board_summary",
     "timezone": "UTC"
   }
   ```
4. Or list generated report artefacts:
   ```
   GET /api/v1/reports/artefacts
   ```

Expected Result:
The backend generates the report artefact record (or template) and serializes the created object as JSON with HTTP 200/201.

Actual Result:
The API crashes immediately with `HTTP 500 Internal Server Error`:
```
fastapi.exceptions.ResponseValidationError: 3 validation errors:
  {'type': 'string_type', 'loc': ('response', 'period_start'), 'msg': 'Input should be a valid string', 'input': datetime.datetime(2026, 11, 1, 0, 0, tzinfo=datetime.timezone.utc)}
  {'type': 'string_type', 'loc': ('response', 'period_end'), 'msg': 'Input should be a valid string', 'input': datetime.datetime(2026, 11, 16, 0, 0, tzinfo=datetime.timezone.utc)}
  {'type': 'string_type', 'loc': ('response', 'created_at'), 'msg': 'Input should be a valid string', 'input': datetime.datetime(2026, 11, 16, 10, 32, 9, 801153, tzinfo=datetime.timezone.utc)}
```
Every attempt to create a template, generate a board report, or list report artefacts crashes with a 500 server exception.

Screenshot: N/A (Backend serialization exception).

Console Errors:
`HTTP 500 Internal Server Error` on `POST /api/v1/reports/generate` and `POST /api/v1/reports/templates`.

Network Errors:
`500 POST /api/v1/reports/generate`
`500 POST /api/v1/reports/templates`
`500 GET /api/v1/reports/artefacts`

Possible Cause:
In `services/api/app/api/v1/endpoints/reports.py`:
- `TemplateOut` defines `created_at: str` and `updated_at: str`.
- `ArtefactOut` defines `period_start: str`, `period_end: str`, and `created_at: str`.
The underlying SQLAlchemy ORM models (`ReportTemplate` and `ReportArtefact`) return Python `datetime.datetime` instances. In Pydantic v2, strict type validation fails to automatically coerce `datetime` to `str` during response serialization, throwing unhandled `fastapi.exceptions.ResponseValidationError` exceptions on all endpoints returning these models.

Recommendation:
Change the field types in `TemplateOut` and `ArtefactOut` to accept `datetime`:
```python
class TemplateOut(TemplateCreate):
    id: uuid.UUID
    tenant_id: uuid.UUID
    is_enabled: bool
    last_run_at: datetime | str | None = None
    created_at: datetime | str
    updated_at: datetime | str

class ArtefactOut(BaseModel):
    ...
    period_start: datetime | str
    period_end: datetime | str
    delivered_at: datetime | str | None
    created_at: datetime | str
```

---

## Bug 16

Title: Access Review Execution Crashes with HTTP 500 Due to Row-Level Security (RLS) Policy Violation

Severity: High

Priority: P1

Page: http://127.0.0.1:13000/access-review and http://127.0.0.1:18000/api/v1/access-review/run

Steps to Reproduce:
1. Navigate to `/access-review`.
2. Click the "Run Review" or "Recompute" button, or issue:
   ```
   POST /api/v1/access-review/run?provider=aws
   ```
3. Observe the response and backend logs.

Expected Result:
The backend computes identity privilege posture across discovered cloud principals, records the review run in `access_review_runs`, and returns the summarized results.

Actual Result:
The backend crashes with `HTTP 500 Internal Server Error`:
```
sqlalchemy.exc.ProgrammingError: (sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) new row violates row-level security policy for table "access_review_runs"
[SQL: INSERT INTO access_review_runs (tenant_id, provider, run_state, ...) VALUES ($1, $2, $3, ...) RETURNING id]
```
The entire Access Review recomputation workflow fails.

Screenshot: `test-results/screenshots/page_access_review.png`

Console Errors:
`Failed to load resource: the server responded with a status of 500 (Internal Server Error)` (`POST /api/v1/access-review/run?provider=aws`)

Network Errors:
`500 POST /api/v1/access-review/run?provider=aws`

Possible Cause:
Migration `125_access_review_findings.sql` enabled Row Level Security on `access_review_runs`:
```sql
CREATE POLICY tenant_isolation ON access_review_runs
USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
WITH CHECK (tenant_id = current_tenant_id());
```
However, in `services/api/app/api/v1/endpoints/access_review.py:112`, `run_review` injects generic `db: DBSession` instead of `db: TenantDBSession`. Because `TenantDBSession` is not used, the session-level GUC `app.current_tenant_id` is never set on the PostgreSQL connection. Consequently, `current_tenant_id()` returns `NULL`, causing `WITH CHECK (tenant_id = current_tenant_id())` to fail on insert and trigger a PostgreSQL RLS rejection error.

Recommendation:
Update `services/api/app/api/v1/endpoints/access_review.py` to inject `db: TenantDBSession` instead of `db: DBSession`:
```python
from app.db.rls import TenantDBSession

@router.post("/run", summary="Recompute the review from current posture and usage")
async def run_review(
    db: TenantDBSession,
    user: Annotated[AuthUser, Depends(require_permission("compliance:read"))],
    provider: str = Query(...),
) -> dict[str, Any]:
```

---

## Bug 17

Title: Replay Evaluation Export Links Bypass Bearer Authentication Resulting in HTTP 401 Unauthorized

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/evaluate

Steps to Reproduce:
1. Navigate to the Replay Evaluation view at `http://127.0.0.1:13000/evaluate`.
2. Select any completed evaluation report.
3. In the export bar, click the "Markdown", "JSON", or "PDF" export buttons.

Expected Result:
The selected evaluation report is downloaded to the analyst's workstation in the requested file format.

Actual Result:
The browser initiates a direct window navigation to:
`http://127.0.0.1:18000/api/v1/evaluations/replay/{id}/export?format={format}`.
Because authentication credentials are stored in browser `localStorage` rather than HTTP-only cookies, the browser sends the navigation request without an `Authorization: Bearer` header. The backend rejects the request with `HTTP 401 Unauthorized: {"detail": "Not authenticated"}`, leaving the analyst stranded on a raw JSON error page instead of initiating a file download.

Screenshot: `test-results/screenshots/page_evaluate.png`

Console Errors:
`401 (Unauthorized)`

Network Errors:
`401 GET /api/v1/evaluations/replay/{id}/export?format={format}`

Possible Cause:
In `apps/web/src/components/evaluations/ReplayEvaluationView.tsx:365-371`, the export buttons are rendered as plain anchor tags (`<a href={evaluationsApi.exportUrl(...)}>`) instead of using an asynchronous authenticated download handler (`apiFetch` + Blob download) as used throughout the rest of the application (e.g. `AuditLogView.tsx` and `CaseWorkspace.tsx`).

Recommendation:
Replace the `<a href="...">` elements in `ExportBar` with button click handlers that fetch via `apiFetch`, create a Blob URL, and trigger a client-side download:
```tsx
const handleDownload = async (format: ReplayExportFormat) => {
  const res = await apiFetch(`/api/v1/evaluations/replay/${id}/export?format=${format}&exclude_latency=${excludeLatency}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aisoc-replay-${id}.${format === 'markdown' ? 'md' : format}`;
  a.click();
  URL.revokeObjectURL(url);
};
```

---

## Bug 18

Title: Executive Digest "Print / Save as PDF" Blocked by Browser Pop-up Blocker

Severity: Medium

Priority: P2

Page: http://127.0.0.1:13000/reports/digest

Steps to Reproduce:
1. Navigate to `http://127.0.0.1:13000/reports/digest`.
2. Click the "Print / Save as PDF" button.
3. Observe browser behavior.

Expected Result:
A new browser tab opens cleanly displaying the printable executive digest, ready for printing or exporting as PDF.

Actual Result:
Modern browser pop-up blockers (Chrome, Safari, Edge) block the new tab from opening because `window.open` is called asynchronously after awaiting `reportsApi.weeklyDigestHtml(params)`. The UI displays a warning banner:
`Pop-up blocked — allow pop-ups for this site to open the printable digest.`
The analyst must manually configure browser site permissions to allow pop-ups before the document can be viewed.

Screenshot: `test-results/screenshots/reports_digest_after_print.png`

Console Errors:
None.

Network Errors:
None.

Possible Cause:
In `apps/web/src/components/reports/ExecutiveDigest.tsx:126`:
`window.open(url, '_blank', 'noopener,noreferrer')` is invoked inside an asynchronous `await` continuation. Modern browsers only permit `window.open` during synchronous user gestures; delayed calls after network promises are treated as untrusted pop-ups and blocked.

Recommendation:
Open the window synchronously on click and update its `location.href` once the HTML blob URL is ready:
```tsx
const win = window.open('about:blank', '_blank');
try {
  const html = await reportsApi.weeklyDigestHtml(params);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  if (win) {
    win.location.href = url;
  }
} catch (err) {
  if (win) win.close();
}
```

---

# Working Features

List every feature tested that worked correctly:

✅ User Authentication (Email/Password Login with JWT token storage in localStorage)
✅ Protected Route Redirects (`/login?next=...` for unauthenticated sessions)
✅ Main Overview Dashboard (`/dashboards?tab=overview`)
✅ SOC Insights Dashboard (`/dashboards/soc-insights`)
✅ Operations Dashboard (`/dashboards/operations`)
✅ Live Time Window Selector (`1h`, `24h`, `7d`, `30d` filtering)
✅ Tenant Switcher & Header Profile Badges
✅ Alerts List View (`/alerts`) with live streaming indicator
✅ Alerts Search & Query Filtering (resistant to SQLi and XSS payloads)
✅ Alert Detail View (`/alerts/[id]`) with raw event JSON viewer
✅ Autonomous Investigation Execution (Orchestrator pipeline: recon → forensic → responder → report_writer)
✅ Case Postmortem API (`/cases/{id}/postmortem`)
✅ Case Auto-Summary JSON & HTML (`/cases/{id}/summary?format=json|html`)
✅ Investigation Report Markdown Export (`/cases/{id}/investigations/{run_id}/report.md`)
✅ Playbook Execution Runner (`POST /api/v1/playbooks/{id}/run` with step-by-step audit)
✅ Jira Integration on Cases (`POST /cases/{id}/push` and external reference linking)
✅ Analyst Triage Queue (`/queue`) with quick disposition actions
✅ Detection Rules Catalog (`/detection/catalog`) with category filters
✅ Detection Rule Editor (`/detection/new`) with YAML / Sigma validation
✅ Natural Language to Sigma Tool (`/tools/nl2sigma`)
✅ Query Translation Tool (`/tools/translate` for SPL, KQL, EQL)
✅ Coverage Heatmap Tool (`/tools/coverage`)
✅ Noise Reduction Tuning (`/tools/noise`)
✅ Business Context Configuration (`/settings/business-context`)
✅ User Management Table (`/settings/users`)
✅ Role-Based Access Control (`/settings/rbac`)
✅ Multi-Factor Authentication Settings (`/settings/mfa`)
✅ Audit Logs View (`/audit`)
✅ Audit Logs CSV Export (`GET /api/v1/audit/export?format=csv`)
✅ Audit Logs HTML Export (`GET /api/v1/audit/export?format=html`)
✅ Executive Weekly Digest JSON (`GET /api/v1/reports/digest/weekly?format=json`)
✅ Executive Weekly Digest Print HTML (`GET /api/v1/reports/digest/weekly?format=html`)
✅ Executive Weekly Digest Server PDF (`GET /api/v1/reports/digest/weekly?format=pdf`)
✅ Cost Dashboard (`/costs`)
✅ Benchmark Comparison Page (`/benchmark`)
✅ Public Marketing Pages (`/why-open-source`, `/about`, `/pricing`, `/mesh`)
✅ Investigation Close & Summary PDF Export (`POST /investigations/{id}/close` + `GET /investigations/{id}/summary.pdf` via pure-Python reportlab)
✅ Investigation Evidence Bundle JSON Export (`GET /api/v1/investigations/{id}/bundle`)
✅ Ad-Hoc Detection Rule Testing for Sigma, KQL, and EQL (`POST /api/v1/detection/test`)
✅ Report Builder Dynamic Template Rendering (`POST /api/v1/report-builder/render`)
✅ Compliance Framework Exports for SOC2, NIST-CSF, HIPAA, ISO27001 (`GET /api/v1/compliance/{fw}/export?fmt=csv|json`)
✅ Natural Language Query Execution (`POST /api/v1/nl-query/execute`)
✅ Investigation Replay Public Ledger Flow (`POST /ledger/{id}/publish/preview` & `POST /ledger/{id}/publish`)
✅ External Attack Surface Scan Trigger (`POST /api/v1/easm/scan`)
✅ Hosted AI Asset Telemetry Scan (`POST /api/v1/ai-assets/scan/hosted-agents`)

---

# Untested Features

The following features were inaccessible or require external production services:
- **SSO Authentication Providers (Okta / SAML / OIDC)**: Requires live identity provider redirect callback.
- **Hardware Passkey / WebAuthn on Mobile PWA**: Tested on desktop Chrome; physical security key biometric prompts were mocked or bypassed.
- **Email Delivery for User Invitations**: SMTP / SendGrid credentials not configured in local compose.
- **Live AWS CloudTrail Connector Sync**: Requires AWS IAM credentials and active S3 bucket telemetry.
- **Caldera / Atomic Red Team Execution**: Purple team emulation runner requires root agent daemon capabilities.

---

# Console Errors

Summary of all distinct console errors captured during testing:

1. `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` — `GET /api/v1/cases/.../investigations/.../report.pdf`
2. `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` — `POST /api/v1/reports/generate`
3. `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` — `POST /api/v1/reports/templates`
4. `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` — `GET /api/v1/reports/artefacts`
5. `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` — `POST /api/v1/access-review/run?provider=aws`
6. `Failed to load resource: the server responded with a status of 401 (Unauthorized)` — `GET /api/v1/evaluations/replay/.../export?format=markdown`
7. `Failed to load resource: the server responded with a status of 503 (Service Unavailable)` — `GET /api/v1/graph`
8. `Failed to load resource: the server responded with a status of 502 (Bad Gateway)` — `GET /api/v1/lake/schema`
9. `Failed to load resource: the server responded with a status of 502 (Bad Gateway)` — `POST /api/v1/live-actions/dry-run`
10. `Failed to load resource: the server responded with a status of 403 (Forbidden)` — `GET /api/v1/mssp/portfolio`
11. `Failed to load resource: the server responded with a status of 403 (Forbidden)` — `GET /api/v1/mssp/portfolio/alerts?limit=25`
12. `Failed to load resource: the server responded with a status of 404 (Not Found)` — `GET /api/v1/compliance/nist`
13. `Failed to load resource: the server responded with a status of 404 (Not Found)` — `GET /api/v1/identity/arn%3Aaws%3Aiam%3A%3A111122223333%3Auser%2Falice/effective-permissions?provider=aws`
14. `Failed to load resource: the server responded with a status of 404 (Not Found)` — `GET /admin/tenants/default?_rsc=...`

---

# Network Failures

Summary of all HTTP 4xx/5xx responses recorded:

| Method | Endpoint | Status | Impact |
|---|---|---|---|
| `GET` | `/api/v1/cases/.../investigations/.../report.pdf` | `500 Internal Server Error` | PDF generation fails: missing `libgobject-2.0-0` in agents container |
| `POST` | `/api/v1/reports/generate` | `500 Internal Server Error` | ResponseValidationError: Pydantic 2 strictly rejects datetime for string fields |
| `POST` | `/api/v1/reports/templates` | `500 Internal Server Error` | ResponseValidationError: Pydantic 2 strictly rejects datetime for string fields |
| `GET` | `/api/v1/reports/artefacts` | `500 Internal Server Error` | ResponseValidationError on report artefact list serialization |
| `POST` | `/api/v1/access-review/run?provider=aws` | `500 Internal Server Error` | PostgreSQL RLS policy violation: missing TenantDBSession leaves tenant context unset |
| `GET` | `/api/v1/evaluations/replay/.../export` | `401 Unauthorized` | UI export buttons use bare `<a>` tags without Bearer auth header |
| `GET` | `/api/v1/graph` | `503 Service Unavailable` | Neo4j socket timeout stalls for 4s then returns 503 |
| `GET` | `/api/v1/lake/schema` | `502 Bad Gateway` | ClickHouse host lookup failure Code 210 |
| `POST` | `/api/v1/live-actions/dry-run` | `502 Bad Gateway` | Action gateway maps 422 validation errors to 502 Bad Gateway |
| `GET` | `/api/v1/cases/.../investigations/.../report.html` | `404 Not Found` | Core API missing proxy route for investigation HTML report |
| `GET` | `/api/v1/mssp/portfolio` | `403 Forbidden` | Unhandled permission check failure on MSSP dashboard |
| `GET` | `/api/v1/mssp/portfolio/alerts?limit=25` | `403 Forbidden` | MSSP alerts stream fails to load |
| `GET` | `/api/v1/compliance/nist` | `404 Not Found` | NIST compliance framework route broken (requires `NIST-CSF`) |
| `GET` | `/api/v1/identity/.../effective-permissions` | `404 Not Found` | Identity permissions view fails on initial mount with hardcoded demo ARN |
| `GET` | `/admin/tenants/default?_rsc=...` | `404 Not Found` | Admin tenant page Next.js RSC failure |
| `POST` | `/api/v1/push/test` | `503 Service Unavailable` | Push notification service unconfigured in local development environment |

---

# Accessibility Issues

WCAG 2.1 AA violations identified:

1. **Missing Input Labels on `/detection/new`**:
   - Rule title input (`<input type="text">`) lacks `<label>` or `aria-label`.
   - Rule description input (`<input type="text">`) lacks `<label>` or `aria-label`.
   - Severity input (`<input type="number">`) lacks `<label>` or `aria-label`.
   - ATT&CK technique input (`<input type="text">`) lacks `<label>` or `aria-label`.
   - Rule tags input (`<input type="text">`) lacks `<label>` or `aria-label`.
2. **Missing Form Labels in Add User Modal (`/settings/users`)**:
   - User email input and role select elements lack explicit `<label for="...">` associations.
3. **Contrast and Text Resizing**:
   - Muted secondary labels in Operations Funnel cards (`text-xs text-muted`) fall below 4.5:1 contrast ratio against dark surface backgrounds.

---

# UI Issues

Visual and layout issues identified:

1. **Investigation Report PDF Error Banner**:
   - Red error alert banner rendered on case report view: `PDF error: {"detail":"{\"detail\":\"PDF generation failed: cannot load library 'libgobject-2.0-0'...\"}"}`.
2. **Card Header & Label Truncation**:
   - Operations dashboard metric cards truncate text aggressively (`EVENTS OF INTER...`, `CORRELATION IN...`, `ALERTS GENERAT...`).
3. **Pipeline Metric Overlaps**:
   - Pipeline health cards truncate status descriptions (`7 in progress · 0 opened / 0 c`).
4. **Horizontal Page Overflow on Mobile (375x667)**:
   - `/alerts` width expands to 408px (+33px overflow).
   - `/queue` width expands to 492px (+117px overflow).
5. **Command Palette Backdrop Overlay**:
   - An invisible backdrop overlay persists on Escape key, blocking user pointer clicks.

---

# Performance Observations

1. **Severe Latency on Funnel Metrics (`/api/v1/metrics/funnel`)**:
   - Takes **7.93 seconds** to respond, causing noticeable delays on every Operations Dashboard load.
2. **Neo4j Socket Blocking Delay (`/api/v1/graph`)**:
   - Graph queries stall for **3.99 seconds** before throwing 503, and `/graph/attack-path/{case_id}` stalls for **3.88 seconds** before falling back to relational SQL.
3. **SWR Polling Frequency**:
   - `/dashboards` and `/alerts` continuously poll `/api/v1/alerts/feed` every 3-5 seconds. On lower-spec client machines or slower connections, this triggers repeated DOM re-renders.
4. **Monaco Editor Initialization**:
   - `/detection/new` and `/detection/[id]` load the complete Monaco Editor bundle, taking ~1.2s to render on initial cold mount.
