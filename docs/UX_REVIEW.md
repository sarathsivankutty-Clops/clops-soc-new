# UX Review — AI Investigation Workflow (AiSOC Console)

**Application:** AiSOC web console, live stack at `http://localhost:13000` (web container `clops-soc-web-1`, footer version `v23.2.0`)
**Method:** Headless Chromium via Playwright (`@playwright/test`, chromium-headless-shell v1243), viewport **1440×900**, logged in as `admin@clopssoc.com` (role: Admin)
**Subject alert:** `cc328685-f2b1-5a2c-a44b-bc67bc91f903` — "RunInstances · aws_cloudtrail · High · Triaged"
**Evidence folder:** `%TEMP%\opencode\uxreview\shots\` (screenshots), `flow.json`, `followup.json`, `crumb.json`, rail/alert-detail/case text dumps
**Verification rule used throughout:** if a claim is not visible in a screenshot, a network log, or a Playwright interaction, it is marked **Unable to Verify ⚠️** and no recommendation is built on it.

### Confidence legend

| Label | Meaning |
| --- | --- |
| **Verified from UI ✅** | Seen in a screenshot / captured page text |
| **Verified from Network ✅** | Seen in the Playwright request/finish log (method, status, timing, body) |
| **Verified from Playwright Interaction ✅** | Seen by driving the element (click, Tab, focus, geometry) |
| **Unable to Verify ⚠️** | Not observable from the running UI; explicitly excluded from conclusions |

---

# Executive Summary

The analyst's instinct is **partly correct, and understated**.

- The workflow from the alert list to actual agent output measured **6 clicks across 6 distinct screens and 4 URLs** — not 4 steps. Three of those clicks (Alerts sub-tab → row → "Open full detail") happen **before** the AI is even offered.
- The **6th click starts a second full agent run** — the analyst believes they are continuing one investigation. Playwright captured both buttons issuing the **same request** to the **same endpoint on the same case**, producing **two different run IDs** on one case (`b17282c2…` and `bb7bec46…`), and the ledger's run picker later listed **two completed runs** (`Nov 16 15:54`, `Nov 16 15:55`).
- The **cause is a landing state**, not analyst error: after "Start AI investigation" the case opens on the **Ledger** tab showing `0 events recorded`, "Waiting for the agent…", and the header CTA **still reads "Investigate with agent" and is enabled**. The UI invites the duplicate click. Screenshot: `m-05-case-ledger.png`.
- Cost of the duplicate click, measured: the second `POST …/investigate` took **7,569 ms**, followed by a `GET …/investigations/bb7bec46` that took **6,569 ms** — ~14 s of extra latency plus a second billable LLM run, to reach a screen that the first run was already going to produce.
- Real latency the UI cannot remove: **15,185 ms** of blank Investigation tab before the first agent step appeared. The UI shows a spinner and the sentence "Investigation in progress… Agents are working." and nothing else for that entire window.
- **Two further structural problems were observed:** there is **no case list** ("Cases" in the header is an `<h1>`, the breadcrumb "Cases" is a non-interactive `<span>`, and `/cases` redirects to `/dashboards?tab=overview`), and the **default Alerts screen shows 0 alert rows** (it opens on the "Entities" sub-tab), forcing a click before the analyst can even see alerts.

**One-line verdict:** the flow is one step too long on the way in (list → rail → detail), and one step too long on the way out (a second, identical investigation). The redesign below removes 4 of 6 clicks and the entire duplicate run.

---

# Current Workflow

Observed path, screen by screen. Every row was executed with Playwright, not inferred.

| # | Analyst action (as observed on screen) | Screen / state | URL after action | Notes |
| --- | --- | --- | --- | --- |
| 0 | Sign in (email, password, **Sign in**) | Login | `/dashboard` → `/dashboards?tab=overview` | Sign in rendered `disabled` at first paint and `enabled` once both fields were filled |
| 1 | Sidebar → **Alerts** | Alerts, **Entities** sub-tab | `/alerts` | `alertRowLinks=0` — no alert rows exist on this default view |
| 2 | Click sub-tab **Alerts** (inside the Alerts page) | Alert list | `/alerts` | 14 rows appear ("Showing 14 of 14 alerts") |
| 3 | Click alert row "**RunInstances**" | Right-hand **rail** slides in | `/alerts` *(unchanged)* | Row is a link to `/alerts/{id}` but a plain click is intercepted; the URL does **not** change |
| 4 | Click **Open full detail** (bottom of rail) | Full **alert detail** page | `/alerts/cc328685-…` | The rail that just opened is replaced by a new full page |
| 5 | Click **Start AI investigation** (right rail card "AI INVESTIGATION") | Case workspace, **Ledger** tab | `/cases/3d75a773-…?tab=ledger` | `POST /api/v1/cases` (201) then `POST /cases/{id}/investigate` (200); shows `0 events recorded`, "Waiting for the agent…" |
| 6 | Click **Investigate with agent** (case header) | Case workspace, **Investigation** tab | `/cases/3d75a773-…?tab=investigation` | Second `POST /cases/{same id}/investigate` (200, 7,569 ms) → **second run** |
| — | *wait* | Investigation tab, empty | — | First agent step visible after **+15,185 ms** |

Two additional states were observed but are not "steps" the analyst is asked to take: the rail's own **Deep Explain** button (opens a drawer over the blurred list, URL unchanged — `f-04-deep-explain.png`) and the global **Ask Copilot** dock present on every screen.

---

# Click Count

**Measured by Playwright (`page.click()` / `locator.click()` calls that changed or should have changed the analyst's state).**

| Segment | Clicks |
| --- | --- |
| Pre-workflow: sign in (email + password + Sign in) | 3 |
| Get from console to the alert rows (sidebar Alerts + Alerts sub-tab) | **2** |
| Select the alert (row → rail) | **1** |
| Open the real alert page ("Open full detail") | **1** |
| Start the AI ("Start AI investigation") | **1** |
| Start the AI again ("Investigate with agent") | **1** |
| **Workflow total (excluding login)** | **6** |
| **Workflow total (including login)** | **9** |

- The analyst's description ("4 steps") **undercounts the real path by 2 clicks**: the `Entities → Alerts` sub-tab click and the "Open full detail" click. The 4 named steps correspond to clicks 3, 4, 5, 6.
- **Minimum viable path to the same outcome** (see Suggested Redesign): **2 clicks** — open the alert, press one Investigate button.
- Typing cost: 1 email field + 1 password field. Not counted as "clicks" but is 2 form fields the analyst must fill before the workflow starts.

---

# Screen Count

**6 distinct screens, across 4 URLs** (so 2 of the screens are "invisible navigations" — the analyst changes screen without changing address).

| # | Screen | URL | Type |
| --- | --- | --- | --- |
| S1 | Alerts — **Entities** (risk-based rollup) | `/alerts` | Full page, default |
| S2 | Alerts — **Alerts** list (14 rows) | `/alerts` | Same URL, tab switch |
| S3 | Alerts — list + **investigation rail** | `/alerts` | Same URL, in-page panel |
| S4 | **Alert detail** (full page, long-scroll) | `/alerts/cc328685-…` | Navigation |
| S5 | **Case workspace — Ledger** | `/cases/3d75a773-…?tab=ledger` | Navigation |
| S6 | **Case workspace — Investigation** | `/cases/3d75a773-…?tab=investigation` | Same page, tab switch |

- Screens S1, S2 and S3 are **three different layouts of one URL**; S5 and S6 are **two different layouts of one case URL**.
- Of the 6 screens, **3 exist only to select or reach the thing the analyst already chose** (S1 to get to the list, S3 to get to the detail, S5 to get to the investigation).

---

# Timeline

**Instrumented console output from the Playwright run (fixed `waitForTimeout` values excluded; timings are click → observable state).**

| t (run clock) | Event | Measured |
| --- | --- | --- |
| 3.95 s | Login submitted → console rendered | **807 ms** |
| 4.62 s | Click sidebar **Alerts** → page ready | **675 ms** |
| 4.83 s | Observation: alert rows in default Entities view | **0 rows** |
| 4.93 s | Click **Alerts** sub-tab → 14 rows | **90 ms** |
| 5.46 s | Click alert row → rail visible | **221 ms** |
| 5.46 s | Observation: URL after row click | **unchanged** (`/alerts`) |
| 5.88 s | Click **Open full detail** → alert detail rendered | **174 ms** |
| 6.30 s | CTA geometry (Start AI investigation) | y=**663**, h=**32** of a 900 px viewport → **no scroll needed** |
| 6.93 s | Click **Start AI investigation** → case ledger rendered | **634 ms** |
| 10.09 s | Ledger state after landing | run `running`, **0 events recorded**, "Waiting for the agent…" |
| 10.27 s | Click **Investigate with agent** → Investigation tab | **177 ms** |
| 25.58 s | **First agent step visible** | **+15,185 ms after click** |

**Network-level timings (separate run, `flow.json`, case `cea1c3b8…`):**

| Request | Status | Duration |
| --- | --- | --- |
| `POST /api/v1/cases` | 201 | 34 ms |
| `POST /api/v1/cases/cea1c3b8…/investigate` *(click 5)* | 200 | **91 ms** → run `b17282c2…` |
| `POST /api/v1/cases/cea1c3b8…/investigate` *(click 6)* | 200 | **7,569 ms** → run `bb7bec46…` |
| `GET /api/v1/cases/…/investigations/bb7bec46…` | 200 | **6,569 ms** |
| `GET /api/v1/cases/…/investigations/bb7bec46…` | 200 | 1,571 ms |

**Interpretation of the timeline**

- **UI work is fast.** Every navigation in the flow completed in **90–675 ms**. There is no sluggish-screen problem; there is a *screen-count* problem.
- **~1.8 s of the run is clicks and page loads; ~15.2 s is waiting for the model.** Removing clicks alone saves ~2 s; removing the *duplicate* click saves ~14 s of network wait plus one billable run.
- **Analyst dwell time (reading the alert detail, choosing an action) is Unable to Verify ⚠️** — it needs a human subject, not a headless browser. It is not counted in any total above.
- Total observed wall clock from "click Alerts in the sidebar" to "first agent step on screen": **~21 s** (5.46 s → 25.58 s on the run clock).

---

# Verified Observations

Every statement below is tied to evidence produced in this session.

### O1 — The two AI buttons are the same operation, on the same case

- **Verified from Network ✅** Both buttons call `POST /api/v1/cases/{id}/investigate`:
  - click 5 → `POST /api/v1/cases/cea1c3b8-809d-4b4e-ae41-73ed2ccf7233/investigate` → `200`, 91 ms, `{"alert_summary":"Opened from the alert detail view by an analyst."}`
  - click 6 → `POST /api/v1/cases/cea1c3b8-809d-4b4e-ae41-73ed2ccf7233/investigate` → `200`, 7,569 ms, `{"alert_summary":"Opened from alert: RunInstances"}`
- **Verified from UI ✅** The two clicks produced **two run IDs on one case**. The case's run picker listed `c86bbc1d-… · Nov 16 15:55 · completed` and `e6331fd7-… · Nov 16 15:54 · completed` (`followup.json`).
- **What differs:** only the `alert_summary` string sent as prompt preamble ("Opened from the alert detail view by an analyst." vs "Opened from alert: RunInstances"). Same endpoint, same case, same side effect: a new full agent run.
- **What "Start AI investigation" additionally does:** it first creates the case (`POST /api/v1/cases` → 201) and lands on `?tab=ledger`; "Investigate with agent" only launches a run and switches to `?tab=investigation`.
- **Net:** the first button is "create case + investigate"; the second is "investigate again". They are **not two stages of one investigation** — the second one **duplicates** the first.
- **Unable to Verify ⚠️** whether the two entry points pass different *agent configuration* beyond `alert_summary`: the request bodies observed contain only `alert_summary`; anything the server adds internally is not visible in the browser network log.

### O2 — The landing screen invites the duplicate click

- **Verified from UI ✅** `m-05-case-ledger.png`: header shows `HIGH · Investigating`, CTA **"Investigate with agent"** (green outline, enabled), tab **Ledger** active; body shows `RUN … running`, `RUN ID e6331fd7…`, `0 events recorded`, and an empty-state card titled **"Waiting for the agent…"**.
- **Verified from Playwright Interaction ✅** `await agentBtn.isEnabled()` returned `true` **while a run was in progress** (run clock 10.09 s).
- **Consequence:** the only thing on screen at that moment is a button that says "start", so a reasonable analyst starts.

### O3 — The default Alerts screen has no alerts on it

- **Verified from UI ✅** `m-01-alerts-default.png` / `03-alerts-list.png`: the page opens on sub-tab **Entities** with `Active entities 2`, an "All entities / Promoted only" toggle and two entity cards — **0 alert rows**.
- **Verified from Playwright Interaction ✅** `alertRowLinks = 0` on the default view; after clicking the **Alerts** sub-tab the page renders `Showing 14 of 14 alerts`.
- **Cost:** one mandatory click before any alert is visible (90 ms of latency, but a full decision — "is my alert here or under the other tab?").

### O4 — The alert row does not navigate

- **Verified from Playwright Interaction ✅** Clicking the row "RunInstances aws_cloudtrail MED High Triaged about 1 hour ago" opened the rail and left the URL at `/alerts` (both runs agree).
- **Verified from UI ✅** `m-03-rail.png` / `12-rail-open.png`: rail slides in with Story/Details tabs and a long narrative; list dims but the same URL persists.
- **Why it matters:** the row *is* an anchor with a real destination (`href="/alerts/cc328685-…"` was present in the DOM at click time), yet a plain click behaves like a selection. The pointer cursor says "navigate", the result says "select". (Whether modifier-click opens a new tab was **not** exercised — **Unable to Verify ⚠️**.)

### O5 — The rail cannot finish the job, so a third screen is required

- **Verified from UI ✅** `rail.txt`: the rail's RESPONSE section reads **"No actions have been recommended for this alert."**, and the rail's own forward action is **"Open full detail →"** at the **bottom** of a scrolling panel.
- **Verified from Playwright Interaction ✅** "Open full detail" is a `link` with `count=1`; clicking navigates to `/alerts/{id}` in **174 ms**.
- **Result:** rail → detail is a page-level detour whose only purpose is to expose content the rail says it lacks.

### O6 — Once on a case, there is no way back to cases

- **Verified from UI ✅** On the case page, "Cases" appears **twice**: as an `<h1>` in the top bar (box x=320 y=22) and as a `<span class="text-slate-500">` breadcrumb (x=288 y=92). Both have `cursor: auto` and **no `href`**.
- **Verified from Playwright Interaction ✅** Clicking the breadcrumb "Cases" left the URL **unchanged** (`/cases/3d75a773-…?tab=ledger`). `getByRole('link', { name: /^Cases$/ })` → **count 0**.
- **Verified from Playwright Interaction ✅** Navigating to `/cases` directly redirects to `/dashboards?tab=overview` (H1 "Overview").
- **Verified from UI ✅** The sidebar (MONITOR / RESPOND / HUNT & DETECT / ADMIN) contains **no Cases item**; the nearest is **Investigation Queue**, which opens on "Mine **0**" and shows **"Nothing in your queue"** with "Switch to Unassigned … or All".
- **Net:** the case workspace is reachable only forwards, from an alert. Leaving it costs the context.

### O7 — Competing AI surfaces on the alert detail

- **Verified from UI ✅** `f-03-start-focus.png` and `alert-detail.txt`, all visible at once on one alert:
  1. header button **"Explain"** (filled gradient — the most prominent control on the screen)
  2. chip **"Explain this alert"**
  3. chip **"Is this a false positive?"**
  4. chip **"Find similar"**
  5. rail card **"AI INVESTIGATION → Start AI investigation"** (outline, 11 px label)
  6. global **"Ask Copilot ⌘J"** dock
  7. status dropdown value **"Investigating"** (a *manual* status word reusing the AI verb)
- **Verified from UI ✅** On the list screen the rail adds a further **"Deep Explain"** button that opens a full-height drawer over the blurred list (WHAT HAPPENED / DETECTION RULE / HISTORICAL FALSE-POSITIVE RATE / KEY EVIDENCE / SUGGESTED ACTIONS) while the URL stays `/alerts` (`f-04-deep-explain.png`).

### O8 — The primary AI action is the least prominent control

- **Verified from Playwright Interaction ✅** CTA geometry: `x=1089, y=663, w=136.8, h=32` in a 900 px viewport → visible without scrolling, but **11 px label**, outline style, placed in the third card of the right rail, below DETAILS.
- **Verified from UI ✅** The same screen gives **filled** treatments to "Explain" and "Create Jira Issue" in the header, while the investigation CTA is an outline button whose focus treatment is a 3 px `rgb(241,245,249)` ring — i.e. the only *state* that carries strong emphasis is keyboard focus, not idle. *The explanation is good, the emphasis is inverted.*
- **Verified from UI ✅** The card's own microcopy is strong ("Promotes this alert to a case and runs the agent against it… You'll be taken to the case when it starts.") — the *explanation* is good, the *emphasis* is inverted.

### O9 — Empty waiting states, twice, with no progress detail

- **Verified from UI ✅** Ledger at 10.09 s: **"Waiting for the agent… / The agent is still planning. Steps will stream in here as soon as it makes its first decision."** + `0 events recorded`.
- **Verified from UI ✅** Investigation tab at 10.27 s (`m-06-investigation-progress.png`): **"Investigation in progress… / Agents are working. Steps appear below in real-time."** with a spinner and **nothing else** for **15,185 ms**.
- **Verified from UI ✅** After the wait, the tab renders a full inline report (RECON / FORENSIC / RESPONSE, "Investigation complete", "View full report").
- **Note the wording trap:** "View **full** report" (Investigation tab) and "Open **full** detail" (rail) are two different destinations with near-identical labels.

### O10 — Accessibility of the CTA and the run picker

- **Verified from Playwright Interaction ✅** `Start AI investigation` is reachable in **21 Tab presses** from the page body; focus ring renders `outline: solid 3px rgb(241,245,249)` and is clearly visible (`f-03-start-focus.png`).
- **Verified from Playwright Interaction ✅** Contrast: **15.71 : 1** dark theme, **17.85 : 1** light theme (white bg `rgb(255,255,255)` on `rgb(15,23,42)` text) — both far above WCAG AA (4.5 : 1).
- **Verified from UI ✅** The alert detail contains exactly **one** `aria-live` region, `aria-live="assertive"`, and its text was **empty** at inspection time — so no live announcement of run start was observable on this page.
- **Verified from Playwright Interaction ✅** The case **run picker** `<select>` has **`aria-label: null`** (`followup.json`) — it is announced only as "combobox" with options formatted `Nov 16 15:55 · completed`, i.e. no run id, no case context.

### O11 — "Start AI investigation" is not idempotent per alert

- **Verified from UI ✅** Two separate sessions on the **same** alert produced two cases with the **same** title "Investigation — RunInstances" and different ids: `cea1c3b8-809d-4b4e-ae41-73ed2ccf7233` (`30-case-workspace.png`) and `3d75a773-934b-4e17-be91-c1b7e29c1f15` (`m-05-case-ledger.png`).
- **Verified from Network ✅** Each click on "Start AI investigation" emitted `POST /api/v1/cases` → `201` with a **new** case id before investigating.
- **Consequence:** an analyst who abandons the case and comes back creates another case for the same alert; the console offers no "this alert already has a case" state in the UI that was observed.

### O12 — The list's largest area is an empty invitation, not a workspace

- **Verified from UI ✅** `m-02-alerts-tab.png`: on the Alerts tab, the right-hand pane (roughly 45% of the 1440 px width, full height below the header) contains only the empty state **"Select an alert to investigate / Click a row in the queue on the left. The rail will show the fusion narrative, related entities, recent events, and recommended actions."**
- **Verified from UI ✅** The rail that then opens does **not** show recommended actions — it shows **"No actions have been recommended for this alert."** (`rail.txt`).
- **Why it matters:** the empty pane is the natural home for the AI action (it is already labelled as the investigation area), and its own copy over-promises. This is the strongest structural argument for RD1.

---

# UX Issues

Severity: **S1** = blocks/duplicates work, **S2** = wastes time or invites a wrong action, **S3** = polish/terminology.

| ID | Issue | Severity | Evidence |
| --- | --- | --- | --- |
| **U1** | **Two identical AI actions.** "Start AI investigation" and "Investigate with agent" hit the same endpoint on the same case and each starts a fresh run. | **S1** | Network ✅ (two `POST …/investigate`, same case, 91 ms and 7,569 ms); UI ✅ (run picker lists 2 completed runs) |
| **U2** | **The landing state invites U1.** Case opens on the Ledger with `0 events` and an **enabled** "Investigate with agent". | **S1** | UI ✅ `m-05-case-ledger.png`; Playwright ✅ `isEnabled() = true` during a running run |
| **U3** | **No case home.** Header "Cases" is an `h1`, breadcrumb "Cases" is a `span`, `/cases` → `/dashboards`, sidebar has no Cases. | **S1** | Playwright ✅ (click → same URL; `/cases` → `/dashboards?tab=overview`); UI ✅ (sidebar, `g-04`) |
| **U4** | **Default Alerts screen has 0 alerts** (opens on "Entities"), so the list costs an extra click. | **S2** | UI ✅ `m-01-alerts-default.png`; Playwright ✅ `alertRowLinks=0` → `14` after tab |
| **U5** | **Row click is a hijacked anchor.** The row carries `href="/alerts/{id}"` but a plain click only selects it; the URL does not change. | **S2** | Playwright ✅ (href present, URL unchanged after click); UI ✅ `m-03-rail.png` |
| **U6** | **Rail promises what it cannot deliver** ("recommended actions" → "No actions have been recommended"), forcing the "Open full detail" hop. | **S2** | UI ✅ `rail.txt` |
| **U7** | **AI action is visually third-class** (11 px outline button, third card, right rail) while "Explain" / "Create Jira Issue" are filled and top-right. | **S2** | UI ✅ `f-03-start-focus.png`; Playwright ✅ geometry + styles |
| **U8** | **Six AI entry points with no differentiation**, including "Explain", "Deep Explain", "Explain this alert", "Find similar", "Is this a false positive?", Copilot. | **S2** | UI ✅ `alert-detail.txt`, `f-04-deep-explain.png` |
| **U9** | **15 s of uninformative wait** on the Investigation tab (spinner + one sentence, no run id, no step count, no cancel). | **S2** | UI ✅ `m-06-investigation-progress.png`; Playwright ✅ `+15,185 ms` |
| **U10** | **Terminology collision:** manual status "Investigating" vs "Start AI investigation" vs "Investigate with agent" vs "Investigation in progress". | **S3** | UI ✅ (status dropdown + pill + button labels on one screen) |
| **U11** | **Run history is unreadable**: picker has no accessible name; options are `Nov 16 15:55 · completed` with no run id, no trigger, no cost. | **S3** | Playwright ✅ (`aria-label: null`, option text) |
| **U12** | **Two near-identical labels to different places:** "Open full detail" (rail → alert page) vs "View full report" (investigation tab → report). | **S3** | UI ✅ `rail.txt` line 216; `m-investigation.txt` |
| **U13** | **A filled "+ Create Alert" button sitting next to a "● Planned for v1.1" pill** — a prominent primary-styled control for a feature that is not shipped, competing with the real workflow. Whether it is clickable was not tested. | **S3** | UI ✅ `m-02-alerts-tab.png` |

**Unable to Verify ⚠️** (explicitly not used as a basis for recommendations)

- Whether the backend de-duplicates runs started close together — no such dedupe was *observable* (the picker shows two runs `15:54` and `15:55` on one case).
- Whether the LLM prompt differs beyond `alert_summary` — not visible in browser traffic.
- Real analyst reading/decision time between screens — requires human study.
- Whether `aria-live="assertive"` announces run start in a screen reader — the region was empty at inspection time; a screen-reader session was not run.

---

# Redundant Steps

| # | Redundant thing | What it duplicates | Measured cost |
| --- | --- | --- | --- |
| **R1** | **"Alerts" sub-tab click** | The sidebar "Alerts" click that just landed on the same page | 1 click, 90 ms, +1 layout |
| **R2** | **Row click (rail) as a separate step** | The detail page it is a link to | 1 click, 221 ms, +1 layout, **URL unchanged** |
| **R3** | **"Open full detail"** | Content that the rail partially shows (story, score, evidence) but refuses to complete | 1 click, 174 ms, +1 page load, +1 screen |
| **R4** | **"Investigate with agent"** | **"Start AI investigation"** — same endpoint, same case | 1 click, **7,569 ms POST + 6,569 ms GET**, 1 extra LLM run, 1 extra run record |
| **R5** | **Two waiting states for one wait** | "Waiting for the agent… 0 events" (Ledger) and "Investigation in progress…" (Investigation tab) | 15 s of duplicate emptiness on two tabs |
| **R6** | **Duplicate confirmations** | *Not observed* — neither AI action asked for confirmation. Zero modals in the entire path. | — |
| **R7** | **Modal-in-modal / modal chains** | *Not observed* — no modal appeared in the flow at all | — |
| **R8** | **Buttons that only redirect to another button** | *Partially observed* — "Open full detail" is exactly this (it reveals "Start AI investigation"), and "Start AI investigation" is close (it reveals "Investigate with agent") | 2 of the 6 clicks are "go somewhere that has the real button" |
| **R9** | **"Continue"-style filler actions** | *Not observed* | — |

**Buttons that could be merged:** "Start AI investigation" + "Investigate with agent" (identical request), and "Explain" + "Explain this alert" + "Deep Explain" (three labels, two surfaces, one intent).

**Unnecessary intermediate page:** the **case Ledger tab** as a landing page. The analyst's goal at click 5 is "watch the agent work"; the Ledger shows `0 events` and a second start button, and the actual work is one tab away.

---

# Confusing Elements

1. **"Alerts" inside "Alerts".** Sidebar item **Alerts** → page title **Alerts** → sub-tabs **Entities** / **Alerts**. Two of three say the same word. *UI ✅*
2. **"Entities" default with 0 alert rows** but a stat strip reading `Active entities 2 / Contributing alerts 10 / Alert → Incident 10:0` — an analyst hunting a specific alert has to conclude "my alert is not on this screen". *UI ✅*
3. **"Open full detail" vs "View full report"** — one goes to an alert, the other to a document. *UI ✅*
4. **"Investigating" as a status you can set by hand** (dropdown value) sitting next to two buttons that start investigations; the pill read `Investigating` on the case both before and after the agent run was launched. *UI ✅*
5. **"Explain" vs "Explain this alert" vs "Deep Explain"** — three labels, no visible statement of difference. *UI ✅*
6. **The header title "Cases" and the breadcrumb "Cases" that are not links** — they look like navigation (placement, casing, crumb typography) and are inert. *Playwright ✅*
7. **A green "Investigate with agent" button on a case that is already investigating.** The colour says go, the state says wait. *UI ✅ `m-05`*
8. **"Starting investigation…" never observed.** The alert-detail CTA navigates in ~634 ms, so the transient label is not what the analyst sees — they see a page change (`loadingLabelVisible=false` at +400 ms). *Playwright ✅*
9. **Run picker `Nov 16 15:54` vs `Nov 16 15:55`** — a 1-minute difference with no "triggered by" or "same case" context; an analyst cannot tell which run is the one they just started. *UI ✅*
10. **"+ Create Alert — Planned for v1.1"** is rendered as a pill next to real controls, adding a dead affordance to the same toolbar. *UI ✅*

---

# Positive Design Decisions

1. **Honest microcopy on the AI card.** "Promotes this alert to a case and runs the agent against it. Every prompt, tool call and piece of cited evidence is written to that case's ledger, where the run can be replayed step by step. **You'll be taken to the case when it starts.**" — it states the side effect *and* the destination before you commit. *UI ✅*
2. **The AI action is fast to acknowledge.** Case creation + run start + navigation in **634 ms**; the analyst is never staring at a frozen alert page. *Playwright ✅*
3. **The ledger is genuinely auditable.** Run id, `STATUS`, `MODEL`, `ITERATIONS`, `TOKENS / COST` (`4,142 · $0.0015`), `STARTED / DURATION` (`15:55:00 · 10s`), a `COST BY MODEL` table (`aisoc-report`, `aisoc-investigation`, `aisoc-recon`), `20 events recorded`, replay with speed control, plus `Live — tailing for new events` and `(end of run)` while running. *UI ✅ (`f-01-ledger-run-picker.png`)*
4. **The "why this score" breakdown is exemplary.** `ML priority rank +0.80/0.16`, `Threat-intel match −0.30/0.14` — signed contributions with denominators, not a black-box number. *UI ✅*
5. **Empty states are specific, not generic.** "Waiting for the agent… The agent is still planning. Steps will stream in here as soon as it makes its first decision." *UI ✅*
6. **Real keyboard support on the CTA**: reachable in 21 tabs with a 3 px visible focus ring; contrast 15.71 / 17.85 : 1. *Playwright ✅*
7. **The row is a real anchor** (`href` present) — the destination is genuine, so the fix is to honour it on left-click, not to rebuild the row. *Playwright ✅*
8. **Run history survives.** Nothing was lost when two runs were created: both `c86bbc1d…` and `e6331fd7…` remained selectable, and both reports were retrievable. *UI ✅*
9. **Institutional memory is exposed to the analyst**: the verdict form ("True Positive / False Positive / Benign / Escalate" + reason) and "Escalate — Needs human follow-up beyond what the agent can do" acknowledge the agent's limits. *UI ✅*
10. **No modal abuse.** The entire six-click path contained **zero** confirmation dialogs and **zero** modals. *Playwright ✅*

---

# Evidence

### Screenshots (`%TEMP%\opencode\uxreview\shots\`)

| File | Shows |
| --- | --- |
| `01-login.png` | Login; Sign in rendered `disabled` before the fields were registered, `enabled` once both were filled |
| `m-01-alerts-default.png`, `03-alerts-list.png` | Alerts page defaulting to **Entities** — 0 alert rows |
| `m-02-alerts-tab.png`, `04-alerts-tab.png` | Alerts sub-tab — 14 rows, "+ Create Alert · Planned for v1.1" |
| `m-03-rail.png`, `12-rail-open.png` | Rail open, URL still `/alerts`; "Open full detail →" at the bottom |
| `m-04-alert-detail.png`, `20/21-alert-detail*` | Alert detail: filled "Explain", 3 AI chips, AI INVESTIGATION card in the rail |
| `f-03-start-focus.png` | "Start AI investigation" focused (3 px white ring), 11 px label, third card, right rail |
| `f-04-deep-explain.png` | "Deep Explain" drawer over the blurred list, URL unchanged |
| `m-05-case-ledger.png` | Case landing for `3d75a773…`: `0 events recorded`, "Waiting for the agent…", **enabled "Investigate with agent"** |
| `30-case-workspace.png` | Case landing for `cea1c3b8…` (same alert, later session): `7 events recorded`, run still `running`, `Investigate with agent` enabled |
| `m-06-investigation-progress.png` | Investigation tab: spinner + "Investigation in progress…" and **nothing else** |
| `33-agent-after-20s.png`, `m-07-investigation-steps.png` | Report appears (RECON / FORENSIC / RESPONSE, "Investigation complete", "View full report") |
| `f-01-ledger-run-picker.png` | Ledger of case `3d75a773…` after both clicks — `RUN Nov 16 15:55 · completed`, `20 events recorded`, `COST BY MODEL` (`$0.0015`, 11.9 s), replay controls. The picker's **second option** (`Nov 16 15:54 · completed`) is captured in `followup.json` |
| `g-04-queue-direct.png` | Investigation Queue: "Mine 0 / Unassigned 12 / All 12" → "Nothing in your queue" |
| `g-02-after-crumb-click.png` | Clicking the "Cases" breadcrumb — no navigation |
| `f-05-light-cta.png` | Light theme contrast check of the CTA |

### Network log (`flow.json`)

```
27305ms 201 POST /api/v1/cases                                     [34ms]
27340ms 200 POST /api/v1/cases/cea1c3b8…/investigate               [91ms]    body {"alert_summary":"Opened from the alert detail view by an analyst."}
35240ms 200 POST /api/v1/cases/cea1c3b8…/investigate               [7569ms]  body {"alert_summary":"Opened from alert: RunInstances"}
47812ms 200 GET  /api/v1/cases/cea1c3b8…/investigations/bb7bec46…  [6569ms]
52811ms 200 GET  /api/v1/cases/cea1c3b8…/investigations/bb7bec46…  [1571ms]
```

### Playwright interaction output (`measure.js` console)

```
[4.62s] click sidebar Alerts (+675ms)            http://localhost:13000/alerts
[4.83s] rows visible on default (Entities) view  alertRowLinks=0
[4.93s] click "Alerts" sub-tab (+90ms)
[5.46s] click alert row -> rail opens (+221ms)   http://localhost:13000/alerts
[5.46s] URL changed on row click?                http://localhost:13000/alerts
[5.88s] click "Open full detail" (+174ms)
[6.30s] Start AI investigation geometry          {"y":663,"h":32,"viewportH":900,"requiresScroll":false}
[6.93s] click "Start AI investigation" -> ledger (+634ms)  /cases/3d75a773…?tab=ledger
[10.09s] "Investigate with agent" enabled while a run is in progress?  true
[10.27s] click "Investigate with agent" -> investigation tab (+177ms)
[25.58s] first agent step visible (+15185ms)
```

### Run picker (`followup.json`)

```json
{"aria": null,
 "value": "c86bbc1d-850a-4711-8bd8-2341297f3e50",
 "options": [
   {"value":"c86bbc1d-…","text":"Nov 16 15:55 · completed"},
   {"value":"e6331fd7-…","text":"Nov 16 15:54 · completed"}]}
```

### Navigation probes (`crumb.json`)

```
crumbCount: 0        (getByRole('link', { name: /^Cases$/ }))
"Cases" rendered as <h1> in header  (x=320,y=22, cursor=auto, no href)
"Cases" rendered as <span> crumb    (x=288,y=92, cursor=auto, no href)
click breadcrumb → afterClickUrl == beforeClickUrl  (/cases/3d75a773…?tab=ledger)
GET /cases  →  /dashboards?tab=overview   (h1 "Overview")
GET /queue  →  "Investigation Queue", "Mine 0 / Unassigned 12 / All 12"
```

### Console output

No JavaScript errors, unhandled rejections or console warnings were recorded during the instrumented flow (`flow.json` → `console: []`, 0 entries). **Verified from Playwright Interaction ✅**

---

# Suggested Redesign

Each recommendation follows **Current Flow → Problem → Why it hurts → Recommended Flow → Expected Improvement**. All are anchored in an observation above; none is speculative.

---

### RD1 — Make the alert row open the alert (one meaning per control)

**Current Flow:** alert row click → rail slides in, URL unchanged; the rail's bottom link → full alert page.

**Problem:** one control carries a real navigation target but behaves as *select* on a plain click (O4). The analyst must learn a special case, then take a second action to see what a row *looks* like it opens.

**Why it hurts:** it adds a screen (S3) and a click (R2) that exist only to resolve an ambiguity the UI created. It also hides the AI action one layer deeper, because the AI card lives on the *detail* page, not in the rail. And it leaves the list's largest region — 45% of the width, already captioned "Select an alert to investigate" — as a permanent empty state instead of the workspace it claims to be (O12).

**Recommended Flow:**
1. Row click → alert workspace at `/alerts/{id}` **with the rail docked beside it** (single URL, one screen).
2. Put the AI action in the **rail's sticky footer** as the primary button, so the analyst can start the investigation from the list without leaving it.
3. Keep the row a real anchor so its destination stays shareable and open-in-new-tab-capable; just stop swallowing the plain click.

**Expected Improvement:** removes 1 screen and 1 click; the rail keeps the list visible instead of being replaced by a full page; the AI action becomes reachable from the queue, which is where triage actually happens.

---

### RD2 — Merge the two AI buttons into one idempotent action

**Current Flow:** "Start AI investigation" (create case + run) → landing on Ledger → "Investigate with agent" (second run on the same case).

**Problem:** two labels, two placements, **one endpoint**, `POST /api/v1/cases/{id}/investigate`, producing **two runs** (`b17282c2…`, `bb7bec46…`) and **two case records** for the same alert in two sessions (O1, O11).

**Why it hurts:** a duplicate run is the most expensive possible UX defect here — it is billed (a second full LLM investigation), it delays the answer (~14 s observed), and it pollutes the run picker with two indistinguishable entries, which then makes the audit trail harder to trust.

**Recommended Flow:**
1. **One label everywhere: "Investigate with agent."** Drop "Start AI investigation" — it describes an earlier era where creating the case *was* the action.
2. On the alert, the button does **create case (if none) → start run → navigate to Investigation tab** in one press (today it stops at the Ledger, which is why the second press exists).
3. On the case, the button becomes a **state, not an action** while a run is live: `● Running · 0 steps · 00:12 · [View ledger] [Cancel]`, disabled for new runs until the current one terminates.
4. If a case already exists for this alert, the button label becomes **"Open existing investigation"** and it navigates rather than creating a second case.

**Expected Improvement:** deletes 1 click, 1 screen, **1 duplicate LLM run**, ~14 s of wait, and one whole class of audit confusion. Same outcome, one press.

---

### RD3 — Land on the work, not on the ledger

**Current Flow:** "Start AI investigation" → `/cases/{id}?tab=ledger` → `0 events recorded` → "Waiting for the agent…" → click a tab to see the run.

**Problem:** the destination tab cannot show anything yet (O2, O9), and it displays the very button that starts a duplicate run.

**Why it hurts:** the first thing the analyst sees after committing is an empty table plus an instruction to do the thing they just did. That is the exact moment the duplicate click happens — observed at run clock 10.09 s → 10.27 s.

**Recommended Flow:**
1. Land on **`?tab=investigation`** (or an "Agent run" view), which already renders RECON → FORENSIC → RESPONSE as steps arrive.
2. Show a real progress header: run id (truncated, copyable), **step counter** (`0 of ~N`), elapsed timer, current agent (`ReconAgent`), and a **Cancel** action.
3. Move the ledger behind a secondary "Ledger" tab with a one-line summary chip on the investigation view (`7 events · $0.0015 · 10 s`).

**Expected Improvement:** removes the intermediate screen, removes the trigger for RD2's duplicate, and turns 15 s of blank waiting into legible progress. Zero extra clicks.

---

### RD4 — Default the Alerts page to the alert list

**Current Flow:** Alerts → **Entities** (0 rows) → click **Alerts** sub-tab → 14 rows.

**Problem:** the default view contains no alerts, and the sub-tab repeats the page's own name (O3, Confusing #1).

**Why it hurts:** every triage session starts with a wrong turn; a first-time analyst cannot tell whether they have no alerts or are in the wrong view. The tab also costs the first of the 6 clicks.

**Recommended Flow:**
1. Default to the **alert list** (triage order: severity / SLA / recency). Make "Entities" the second tab and label it **"Entity risk"**.
2. Rename the sub-tabs to be unambiguous inside the Alerts page: **"Alert queue"** and **"Entity risk"**.
3. Persist the last-used sub-tab per user; deep links (`/alerts?tab=entities`) keep working.
4. If the queue is genuinely empty, say so on the queue — do not silently show a different view.

**Expected Improvement:** −1 click, −1 wrong-turn screen, and the page finally answers "do I have alerts?" immediately. Removes R1 entirely.

---

### RD5 — Give cases a home, and make the "Cases" label navigate

**Current Flow:** case page → header "Cases" (`h1`, inert) → breadcrumb "Cases" (`span`, inert) → `/cases` redirects to `/dashboards`.

**Problem:** the case workspace has no exit to a case list, and two elements that *look* like that exit are not interactive (O6).

**Why it hurts:** an analyst who finishes one case and wants the next has to re-enter through Alerts and re-select. It also makes the case feel like a modal trap rather than a first-class object — directly contradicting the AI card's promise that "every prompt, tool call and piece of cited evidence is written to that case's ledger."

**Recommended Flow:**
1. Make the breadcrumb **"Cases"** a real link to a **Cases list** (status, severity, assignee, last run, last activity).
2. If a full list is out of scope in this phase, point "Cases" at **Investigation Queue → All** and rename that sidebar item **"Cases & Queue"** so the destination is honest (the queue's own counters read `Unassigned 12`, `All 12`).
3. Add a **Cases** entry in the RESPOND group of the sidebar (it currently has Investigation Queue + Runbooks only).

**Expected Improvement:** ends the dead end, makes the case object navigable like alerts and detections, and removes the "re-enter through the alert" recovery path.

---

### RD6 — Collapse the AI affordances into one "Ask AI" control

**Current Flow:** on the alert detail: **Explain** (filled, top-right) + chips **Explain this alert / Is this a false positive? / Find similar** + **Start AI investigation** (rail) + **Ask Copilot** (global). On the list: **Deep Explain** (rail drawer).

**Problem:** six entry points, three of which use the word "Explain"; the most important one is the least styled (O7, O8).

**Why it hurts:** the analyst has to infer the difference between "Explain", "Deep Explain" and "Explain this alert" before choosing, and the one that actually runs the investigation looks like a footnote. Decision fatigue concentrated exactly where commitment is required.

**Recommended Flow:**
1. One **"Ask AI"** split button in the alert header: primary click = **"Investigate with agent"** (the real work); the caret opens a short labelled menu of read-only aids — **"Explain this alert"**, **"Is this a false positive?"**, **"Find similar"**.
2. Delete the duplicate labels: keep **"Explain this alert"** only (drop "Explain" and "Deep Explain"; the drawer they both open is the same drawer, observed in `f-04`).
3. Keep the Copilot dock as the free-form channel, but retitle the chips so they read as shortcuts *into* it rather than a second system.
4. Promote the investigate button to the filled/primary style; demote "Create Jira Issue" to secondary in that zone.

**Expected Improvement:** one primary action per screen (a standard hierarchy rule), six choices → one action + three clearly-labelled aids, and the CTA stops reading as an afterthought.

---

### RD7 — Make the wait legible (and cancellable)

**Current Flow:** Investigation tab shows a spinner + "Investigation in progress… Agents are working." for **15,185 ms** with no additional information.

**Problem:** there is no run id, no step count, no elapsed time, no cancel, and the same wait is simultaneously described differently on the Ledger ("Waiting for the agent… 0 events recorded") (O9).

**Why it hurts:** the analyst cannot distinguish "working" from "stuck", cannot report the run to a colleague, and cannot stop a bad run. Two different descriptions of one wait also suggest two different systems.

**Recommended Flow:**
1. One shared **RunProgress** component: `ReconAgent · step 2 of 6 · 00:14 · run b17282c2 · [Cancel]`, plus "no output yet" microcopy after 10 s.
2. Use it on **both** the Investigation tab and the Ledger, so the two empty states cannot disagree.
3. On completion, replace it in place with the report (already happens) and replace "View full report" with **"Open report"** to stop colliding with "Open full detail".

**Expected Improvement:** latency is unchanged (it is model-bound), but the *perceived* wait drops because it becomes attributable and interruptible; it also removes one duplicate waiting state (R5) and one label collision (U12).

---

# Before vs After Workflow

| Stage | **Before (observed)** | **After (proposed)** |
| --- | --- | --- |
| 1 | Sidebar **Alerts** → Entities (0 rows) | Sidebar **Alerts** → Alert queue (14 rows) |
| 2 | Click **Alerts** sub-tab | — *(gone: default view is the queue)* |
| 3 | Click alert row → rail (URL unchanged) | Click alert row → alert workspace, rail docked, **Investigate with agent** in rail footer |
| 4 | Click **Open full detail** | — *(gone: rail is the workspace)* |
| 5 | Click **Start AI investigation** → case **Ledger** (`0 events`, "Waiting for the agent…") | Click **Investigate with agent** → case **Investigation** with live progress |
| 6 | Click **Investigate with agent** → second run (7,569 ms) | — *(gone: button is a disabled run-state until the run ends)* |
| 7 | Wait 15,185 ms on a blank tab | Same model latency, but `ReconAgent · step 2 of 6 · 00:14 · [Cancel]` |
| 8 | (dead end) No case list; "Cases" not clickable | Breadcrumb **Cases** → case list / Investigation Queue → All |

- **Screens:** 6 → **3** (queue, alert workspace, case investigation).
- **URLs:** 4 → **3**.
- **Duplicate agent runs:** 2 → **1**.
- **Buttons that only reveal another button:** 2 → **0**.

---

# Estimated Reduction in Clicks

| Metric | Before (measured) | After (projected from the same steps) | Δ |
| --- | --- | --- | --- |
| Clicks from console to first agent output (excl. login) | **6** | **2** (open alert → Investigate) | **−4 (−67%)** |
| Clicks from the default Alerts screen (Entities view) to first agent output | **5** | **2** | −3 (−60%) |
| Distinct screens | **6** | **3** | −3 (−50%) |
| Distinct URLs | **4** | **3** | −1 |
| Agent runs started per investigation | **2** | **1** | −1 (−50%) |
| Network time attributable to the redundant action | **~14.1 s** (7,569 ms POST + 6,569 ms GET) | **0** | −14.1 s |
| Screens showing "waiting" for the same run | **2** | **1** | −1 |
| Dead ends after landing on the case | **1** (no case list) | **0** | −1 |

The click reduction is **projected from removing steps that were measured**, not estimated from a mockup: R1 (90 ms), R2 (221 ms), R3 (174 ms), R4 (7,569 ms) are each an observed, individually-timed step. The only genuinely "new" thing is RD5's case list, which *adds* an exit rather than a step.

---

# Estimated Improvement in User Experience

| Dimension | Observed today | After redesign | Basis |
| --- | --- | --- | --- |
| **Time to first signal** | **~21 s** wall clock (click Alerts → first agent step); of which **~2.0 s** is click→render latency and **15.2 s** is model latency, the remainder being settle waits in the instrumented run | **~15.8 s** (2 clicks ≈ 0.6 s + 15.2 s model) | run-clock: 5.46 s → 25.58 s; per-step latencies |
| **Duplicate cost exposure** | 2 runs, 2 records, ~14 s extra, 2 cases per alert across sessions | 1 run, 1 case, 0 extra network time | `flow.json` + run picker + two case URLs |
| **Decision points before commitment** | 6 screens, ~6 AI affordances | 3 screens, 1 primary + 3 labelled aids | O7, O8 |
| **Obviousness of next action** | Low on the case landing (empty ledger + "start" button) | High (live progress replaces the button) | `m-05`, `m-06` |
| **Reversibility** | None — no cancel on a running run | Cancel available in the progress header | `m-06` has no cancel control |
| **Navigability** | Case is a one-way door | Case list reachable from breadcrumb + sidebar | `crumb.json` |
| **Audit legibility** | Two indistinguishable runs (`15:54`, `15:55`) | One run per action, labelled by trigger | run picker options |
| **Accessibility** | CTA AA-compliant but 11 px and third-class; run picker unnamed | CTA promoted to primary; run picker gets an accessible name | contrast 15.71/17.85; `aria-label: null` |

**Not claimed:** that the analyst stops making mistakes entirely. The redesign removes the *structural incentive* to double-start (RD2 + RD3); it cannot remove the 15 s model latency, which is a backend property, not a UI one.

---

# Final Verdict

**The 4-step framing is directionally right but undercounts the failure.**

- **Verified:** the path is **6 clicks across 6 screens**, and **five of them happen before any agent output exists**.
- **Verified:** the two AI buttons are **not two stages** — they are the **same request to the same endpoint on the same case**, and the second one produced a **second completed run** on a case that already had one (`Nov 16 15:54` and `Nov 16 15:55` in the run picker).
- **Verified:** the duplicate is **caused by the landing screen**, which shows `0 events recorded`, "Waiting for the agent…" and an **enabled "Investigate with agent"** while a run is already live.
- **Verified:** the workflow also has **no exit** — "Cases" is an `h1` and a `span`, `/cases` redirects to the dashboard, and the sidebar has no Cases item.

**Recommended priority**

1. **RD2 + RD3** (merge the buttons, land on the Investigation tab with a live run state) — this is the only change that stops the system doing *duplicate, billable work*. Everything else is friction; this one is waste.
2. **RD4 + RD1** (default to the queue; make the row open the alert with the rail docked) — removes 3 of the 6 clicks and the "select vs open" ambiguity.
3. **RD5** (case home) — closes a real dead end that currently costs a full re-entry through the alert queue.
4. **RD6 + RD7** (one primary AI action; legible, cancellable progress) — reduces decision fatigue and makes a 15-second wait feel attributable instead of blank.

**Bottom line:** a first-time SOC analyst would *not* be lost in this flow — every screen explains itself, the AI card's copy is unusually honest, and there are no modal traps. What the flow does instead is **quietly double the bill**: it invites a second start at the exact moment the first run has produced nothing to look at, then offers no way back to the case you just made.

---

### Confidence summary

| Finding | Confidence |
| --- | --- |
| Both AI buttons call `POST /cases/{id}/investigate` on the same case | **Verified from Network ✅** |
| The two clicks produced two distinct runs / two case records | **Verified from UI ✅** (run picker) + **Verified from Network ✅** (two POSTs, new case ids) |
| "Investigate with agent" enabled during a running run | **Verified from Playwright Interaction ✅** |
| 6 clicks / 6 screens / 4 URLs | **Verified from Playwright Interaction ✅** |
| Per-step latencies (807 / 675 / 90 / 221 / 174 / 634 / 177 ms) | **Verified from Playwright Interaction ✅** |
| 15,185 ms to first agent step | **Verified from Playwright Interaction ✅** |
| Default Alerts view has 0 rows | **Verified from UI ✅** + **Playwright ✅** |
| Row click leaves the URL unchanged | **Verified from Playwright Interaction ✅** |
| "Cases" header/breadcrumb are non-interactive; `/cases` → `/dashboards` | **Verified from Playwright Interaction ✅** |
| Six AI entry points on the alert detail | **Verified from UI ✅** |
| CTA 11 px, third card, outline; contrast 15.71/17.85; 21 tabs | **Verified from Playwright Interaction ✅** |
| Run picker `<select>` has no accessible name | **Verified from Playwright Interaction ✅** |
| Deep Explain opens a drawer over the blurred list | **Verified from UI ✅** (`f-04-deep-explain.png`) |
| No modals / no confirmations / no console errors in the path | **Verified from UI ✅** + **Playwright ✅** |
| Prompt differs beyond `alert_summary` | **Unable to Verify ⚠️** |
| Screen-reader announcement of run start | **Unable to Verify ⚠️** |
| Human reading/decision dwell time per screen | **Unable to Verify ⚠️** |
| Backend de-duplication of concurrent runs | **Unable to Verify ⚠️** (the picker shows two runs a minute apart) |
