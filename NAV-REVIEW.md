# UI Navigation Review — `main..ui-nav`

Review only; no source changes, staging, or commit.

| ID | Severity | File:line | Finding | Suggested fix |
|---|---|---|---|---|
| N1 | Major | `apps/web/src/components/detections/DetectionTabs.tsx:12`; `apps/web/src/components/detections/DetectionsView.tsx:155`; `apps/web/src/components/settings/SettingsView.tsx:423` | Detection and Settings retain nested tab bars using `?tab=`. Detection’s inner `coverage` tab collides with the outer MITRE Coverage tab; Settings General keeps its own tabs and duplicate heading. | Use distinct query keys or remove the nested tab bars. |
| N2 | Major | `apps/web/src/components/cases/CaseWorkspace.tsx:707`; `apps/web/src/components/detections/DetectionsView.tsx:403`; `apps/web/src/components/dashboard/DashboardWelcome.tsx:61` | In-page links still lead to hidden routes: `/cases` (also `OnboardingView.tsx:224`), `/detection/proposals`, `/onboarding` (also `StartHero.tsx:152`), `/copilot` (`CopilotDock.tsx:204,271`), and `/marketplace` (`Footer.tsx:56`). These redirect to Dashboard; the onboarding CTA then returns to Dashboard. | Remove or retarget these links and CTAs. |
| N3 | Minor | `apps/web/src/components/playbooks/PlaybooksView.tsx:451,547` | The page heading, list tab, empty/error states, and other visible copy still say “Playbooks,” despite the Runbooks navigation and metadata. | Rename remaining user-visible copy to “Runbooks.” |
| N4 | Minor | `apps/web/src/hooks/useUrlTab.ts:13`; `apps/web/src/app/(app)/cases/page.tsx:16` | Tab clicks use `pushState`; browser Back behavior is **Not verified**. Fixed redirect destinations discard incoming query parameters. | Verify Back/Forward and preserve relevant parameters. |
| N5 | Minor | `apps/web/src/components/layout/TopBar.tsx:84` | Tab URLs keep the parent title (`Detection`, `Dashboards`, or `Settings`), not the active tab title. | Confirm parent-level titles are intended. |

## Navigation and redirects

- Sidebar and Cmd+K share ten primary items: Dashboard, SOC Insights, SOC Operations, Alerts, Investigation Queue, Hunt, Detection, Runbooks, Dashboards, Settings. Cmd+K additionally has quick actions and recent pages. Detection, Dashboard, and Settings sub-items are in tabs. Cost appears only as a Dashboards tab. TopBar has the corresponding route titles plus legacy-route titles.
- Added redirects (all temporary `redirect()`): to `/dashboard` — `/access-review`, `/ai-estate`, `/cases`, `/copilot`, `/coverage-advisor`, `/detection/proposals`, `/easm`, `/evaluate`, `/explore`, `/federated-search`, `/fim`, `/graph`, `/honeytokens`, `/marketplace`, `/onboarding`, `/purple-team`, `/threat-intel`; to `/sla?tab=...` — `/costs`→`costs`, `/analytics/team`→`team`, `/mssp`→`mssp`; to `/settings?tab=...` — `/audit`→`audit-logs`, `/compliance`→`compliance`, `/connectors`→`connectors`, `/settings/mfa`→`mfa`, `/settings/rbac`→`rbac`, `/settings/users`→`users`; to `/detection?tab=...` — `/detection/catalog`→`catalog`, `/detection/coverage`→`coverage`, `/detection/tuning`→`tuning`.
- No added permanent redirect or redirect cycle found. `/cases/[id]` and `/alerts/[id]` remain dynamic routes; no changed route was removed to 404.
- SectionTabs renders only the active view and has unknown-tab fallback coverage. Refresh behavior is covered by URL selection; browser Back/Forward behavior is **Not verified**. Invalid or missing tabs fall back to the configured default. Hidden non-admin Users tab falls back when directly selected.

## Permissions and rules

- Users remains `adminOnly`; no prior UI role gates found lost for Roles, Audit, MSSP, Cost, or Settings. The Cost page moved from `(admin)` to `(app)`; both layouts use `AppShell`.
- 71 `[HIDDEN-UI NAV-*]` tags across 36 files; hidden implementations are comment-wrapped. No active raw-palette/hex/arbitrary-size additions, new localStorage, service/config/lockfile changes, or API-client changes found. `SectionTabs` reads role via `authApi.currentUser()`. New styles use theme tokens.
- Jira key / “View in Jira” and `[TODO-BACKEND]` markers not found. “Create case” remains in `apps/web/src/components/alerts/CreateCaseModal.tsx:263` and `apps/web/src/components/alerts/AlertDetailView.tsx:914`.

## Gates

| Command | Result | Baseline |
|---|---|---|
| `pnpm --filter @aisoc/web type-check` | Passed, 0 errors | 0 errors |
| `pnpm --filter @aisoc/web lint` | Passed, 0 errors / 95 warnings | 95 warnings |
| `pnpm --filter @aisoc/web build` | Passed, 105/105 static pages | Passed |
| `pnpm --filter @aisoc/web test` | 1,259 passed / 5 failed of 1,264 | 1,257 passed / 3 failed of 1,260 |

- Three baseline failures remain. Two additional failures are unrelated to navigation/labels; cause **Not verified**: `does not render "clean" when the service could not be reached` and `names the indicator it did not check, so the answer cannot be read as being about it` in `apps/web/src/components/threat-intel/ThreatIntelLookupHonesty.test.tsx:55,68`.

## Manual checks

- Check light and dark themes at `/detection?tab=rules` (inner Coverage tab), `/settings?tab=general` (nested tabs/title), `/settings?tab=users` as admin and non-admin, `/sla?tab=costs`, and `/playbooks` (visible labels).
- Check the Dashboard onboarding CTA, refresh, Back/Forward, and invalid `?tab=` fallback.
- Review run left an existing unstaged snapshot file untouched.

**Verdict: FIX FIRST.**
