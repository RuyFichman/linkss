# ADR 0013 — Consolidated analytics and shared report links

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-10-06
- **Sprint:** 7, part 2 of 2
- **Builds on:** ADR 0003 (published snapshots), ADR 0004 (tenancy and authorization), ADR 0011 (customer analytics), ADR 0012 (multi-page operations, invitations and roles)

## Context

Sprint 6 gave each page its own results; part 1 of Sprint 7 gave an agency many pages and many people. Two things were missing for the differentiator "multi-profile operations plus proof of results": one screen with every page's results, and a way to hand a client the proof without giving them an account.

The report link is the first surface where data that belongs to a workspace is shown to somebody with no account, through nothing but a secret in a URL. It must stop working the moment the agency says so, show one page and nothing else, and say nothing about how the page or the workspace is configured. The numbers carry the Sprint 6 obligation: one definition, labeled as estimates, and "no data" never shown as zero.

## Decision

### One definition of every number

- `public.get_profile_analytics` keeps its signature and its answer, and now delegates to `private.profile_analytics(profile, from, to)`, which holds the body it had in Sprint 6. The shared report calls the same private function. There is one place where a page's days, blocks and sources are counted.
- The consolidated read needs the open days (not final yet, normally only today) of every page of a workspace. Calling `private.analytics_counts` once per page would scan the open days of every tenant once per page, so a second function, `private.analytics_workspace_counts(workspace, from, to)`, counts the same raw events filtered by workspace and restricted to the two dimensions the consolidated view shows (`total` and `source`). It is the one deliberate duplication; pgTAP compares the consolidated result with the sum of the per-page reads on a fixture with several pages (`160-reports.test.sql`), which is the drift guard.
- In the application, `modules/analytics/workspace.ts` and `modules/reports/shared-report.ts` build their view models with `dailySeries`, `periodTotals`, `totalsFromCounts`, `dashboardState`, `blockRanking` and `shareRanking` from `modules/analytics/dashboard.ts` and the date arithmetic of `dates.ts`. `totalsFromCounts` was extracted from `periodTotals` so that a page's row in the consolidated table and a page's own dashboard cannot disagree. No second funnel and no second date calculation exist.

### Consolidated read

`public.get_workspace_analytics(workspace_id, from, to)` returns one bounded JSON object:

| Field | Meaning |
|---|---|
| `timezone`, `today`, `from`, `to`, `history_days`, `configured`, `last_final_day` | Exactly as in the per-page read. The window is clamped to today and to the `analytics_days` entitlement of the workspace's plan |
| `collecting_since` | The later of the workspace's creation and the start of collection |
| `first_event_day` | First day with any event of any live page, across the retained history |
| `days[]` `{day, event_type, count}` | Workspace totals per day and type |
| `sources[]` `{key, count}` | Visits by source, summed across pages |
| `pages[]` `{profile_id, title, slug, status, ever_published, collecting_since, first_event_day, counts}` | One row per listed page, with the period's counts already summed |
| `page_count`, `pages_omitted`, `pages_truncated` | Live pages in the workspace; pages left out of the table; whether the table was cut |

- **Which pages count.** Every page that is not soft-deleted, whatever its status: a page that was unpublished or archived yesterday still produced the results of last week. **Soft-deleted pages are left out of everything**, totals included: their own dashboard already refuses them, so including them would break "consolidated equals the sum of the pages", and deletion is a statement that the data should go.
- **Which pages are listed.** A page is a row when it is on the air or has an event in the window. Drafts and archived pages with nothing to show are counted in `pages_omitted` and mentioned in one line, so they do not bury the pages that need attention. Archived pages with results are listed and labeled.
- **Bound.** At most 200 rows (`private.workspace_analytics_page_limit()`), the ones with most visits; `pages_truncated` tells the screen to say so. Totals always cover every page. No plan allows more than 10 pages today.
- **Final and open days.** Final days come from `analytics_daily` through the `(workspace_id, day)` index created in Sprint 6 for this purpose; days after the watermark come from the workspace's raw events through `(workspace_id, profile_id, occurred_at)`. Never more raw data than the bounded open-day window of ADR 0011.
- **Mixed states.** The workspace has one state (`workspaceState`: not available, no pages, nothing published, before collection, no data yet, zero, data) and each row has its own, derived by the page dashboard's rule from the row read as a one-page report (`pageState`). A row without numbers shows "sem dado" and the reason in words, never 0. The screen says how many listed pages have data and how many do not.
- **"Atualizado em"** is the time of the read: open days are counted live. The delay warning is the Sprint 6 one (`aggregationIsDelayed`), because the watermark is global.

### What the consolidated dashboard is for

A ranking and a triage tool at `/app/w/<workspace>/resultados`: totals, the number of pages with activity, the page table ordered by results (ties: visits, then name, then id; pages without numbers last) with a link into each page's own dashboard for the same period, the daily series, and sources summed across pages. Blocks, UTM campaigns, devices and countries stay in the per-page view: summed across unrelated clients they answer no question. A CSV export gives the page table (one row per page, the period and the timezone as columns, empty cells for a page without numbers).

### Report link model

Table `public.report_links`:

| Column | Notes |
|---|---|
| `id`, `workspace_id`, `profile_id` | One link, one page. Both foreign keys cascade |
| `token_hash` | SHA-256 of the token, hex, unique. Not granted to any client role |
| `period_days` | 7, 30 or 90: a **rolling window ending on the last completed reporting day**. Default 30 (UX-009) |
| `expires_at` | Required. `create_report_link` takes a number of days from 1 to 90 (the screen offers 7, 30 and 90; default 30) and the table refuses an expiry before the creation or more than 90 days after it |
| `label` | Optional, up to 80 characters, for the agency's own reference. Never shown on the report and never written to the audit trail |
| `created_by`, `created_at`, `revoked_at`, `revoked_by` | People are `on delete set null`: the link belongs to the workspace |

- **Rolling, not fixed.** A client opens the same link during the month and sees the last 30 completed days each time. Completed days only: the numbers a client reads at 10:00 are the numbers at 18:00, and nobody has to explain "today is still being counted". *Provisional*: a fixed date range ("September") is not offered; an agency that needs it prints the report or saves it as PDF from the browser.
- **Never longer than the plan shows.** Creation refuses a period above `analytics_days`; the read clamps again, so a downgrade shortens existing reports instead of exposing history the plan no longer covers.
- **No usage record.** The recommended "last opened" timestamp was **not** built. A chat app fetches the link to build a preview the moment the agency pastes it, so the value would say "opened" before any person read it; keeping it honest would need user-agent handling on a route that otherwise stores nothing about who opens it. Data minimization wins: a link has no counter, no timestamp and no trace of its readers. *Provisional*.
- **Limits (*provisional*).** 5 active links per page and 100 per workspace (`LK091`), 30 created per workspace in 24 hours (`LK092`).

### Token

256 bits from `crypto.getRandomValues`, base64url (43 characters), generated by the application server, shown once to the person who created the link, and never stored: `create_report_link` receives only the hash. A lost link means a new one. The read receives the token and hashes it in the database, so a hash read from somewhere opens nothing (pgTAP).

The token travels in the **path** (`/r/<token>`). A fragment would keep it out of request logs, but the server could then not render the report: the page would need JavaScript and an API that takes the token anyway, and it would not print or load in a restrictive in-app browser. Consequences accepted: the hosting platform's request log holds the path (the application's own logs never do); browser history holds it. Mitigations: required expiry, immediate revocation, `Referrer-Policy: no-referrer`, no third-party request from the page, a generic page title and no Open Graph image.

### What the report contains

`public.get_shared_report(token, client)` returns `{"status": "unavailable"}` or exactly these fields (pgTAP fails if any other appears; `SHARED_REPORT_FIELDS` mirrors the list in the application):

| Field | Why |
|---|---|
| `status` | `ok` |
| `workspace_name` | Who is reporting |
| `page_title` | From the published snapshot (the draft title only for a page that was never published) |
| `page_slug` | Only while the page is on the air; null otherwise, so the report never links to a 404 |
| `expires_at` | Shown at the foot of the report |
| `ever_published`, `configured`, `collecting_since`, `first_event_day`, `last_final_day`, `timezone`, `today`, `from`, `to` | What the state rules need to tell "no data" from zero, and the period |
| `days[]` `{day, event_type, count}` | The daily series and every total |
| `sources[]` `{key, count}` | Visits by source category |
| `blocks[]` `{ref, position, block_type, title, event_type, count}` | Blocks ranked by clicks. `title` and `position` come from the **published** snapshot (live, or the latest one for a page off the air); `ref` is an ordinal, not an identifier |
| `show_badge` | The "Relatório gerado com Projeto LNK" line follows `remove_badge`, like the public page |

**Left out, deliberately:** every identifier (workspace, page, block, person, link); UTM values, which are the agency's internal campaign labels; devices and countries; the plan and its limits; members; other pages; leads; audit events; the draft (a title changed but not published does not appear); the link's own label. The report has no visitor-level data because none exists in the aggregates.

The copy lives in `apps/web/src/content/shared-report.ts`. The route is server-rendered, so nothing of it is shipped to a browser bundle, and `content/public-page.ts` stays the only copy file in the public page's client bundle. The report states how visits are counted and that the numbers are estimates.

### Lifecycle

| Event | What the link does |
|---|---|
| Page unpublished or archived | Keeps working: the results exist and an agency may deliver a final report. `page_slug` becomes null |
| Page soft-deleted | Stops resolving. If the page is restored within its retention, the link resolves again |
| Page or workspace purged | The row is deleted by the foreign key |
| Workspace suspended or soft-deleted | Stops resolving |
| `shareable_reports` lost (downgrade) | Stops resolving; the rows are kept, so the links work again if the entitlement returns. The management screen says why; since ADR 0014 it also links the owner to the plans screen when plans are for sale, and the downgrade confirmation says how many active links will stop |
| Creator leaves the workspace | Nothing: the link belongs to the workspace |
| Page duplicated | Links are not copied (ADR 0012) |
| Expiry, revocation | Unavailable from the next request on |

A revoked or expired link is kept for 90 days (*provisional*) and deleted on the next creation in the same workspace; the scheduled purge is Sprint 9.

### Serving

- `/r/[token]` is `force-dynamic`: every request asks the database, so revocation and expiry take effect on the next request. It is not ISR and never reaches a shared cache.
- `next.config.ts` adds to everything under `/r/`, the 404 included: `Cache-Control: private, no-store, max-age=0`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`. The layout repeats robots and referrer as meta tags and sets a title that names nobody.
- The read uses the publishable key as `anon`: no session, no cookie, no service key. The proxy does not run for `/r/`, so the route neither reads nor sets a cookie. The page loads nothing from a third party and does not mount the visit collector: opening a report is not a visit (a test pins that only `/[slug]` imports the collector).
- **One generic state.** Unknown, malformed, expired and revoked tokens, a deleted page, a suspended workspace, a plan without shared reports, a caller over the lookup limit and a database that does not answer all get the same 404 with the same text and no link into the product. The framework streams that state's rows in an order that depends on timing; the set of rows is identical.
- **Failed lookups.** Guessing is infeasible by entropy. As a cost limiter, `get_shared_report` counts failures per client in `report_lookup_failures` (a salted daily hash of the address computed by the application server, never the address): after 20 failures in 10 minutes, every lookup of that client answers "unavailable", valid tokens included, until the window moves on. At most 5,000 failures are recorded per 10 minutes and rows are deleted after 24 hours. **Still exposed:** a caller who talks to the RPC directly can send any client value or none (callers without one share a bucket of 300), so this is not a security boundary; the platform-level rate limit in front of `/r/` and the RPC is Sprint 9.

### Roles

| Action | owner | admin | editor |
|---|---|---|---|
| `analytics.view` (consolidated dashboard) | ✓ | ✓ | ✓ |
| `analytics.export` (consolidated CSV) | ✓ | ✓ | ✓ |
| `reports.view` (list a page's links) | ✓ | ✓ | – |
| `reports.create` | ✓ | ✓ | – |
| `reports.revoke` | ✓ | ✓ | – |
| Open a report | anybody who holds the token | | |

Every member reads and exports aggregates, as in ADR 0011. Links are limited to owners and admins because a link publishes workspace data outside the workspace. Revocation, unlike other writes, is accepted in a suspended workspace: taking data off the air is never blocked.

### Audit

`report_link.created` and `report_link.revoked` (target `report_link`; metadata: the page, the period, the number of days; never the token, its hash or the label). The consolidated export writes `analytics.exported` with target `workspace`. Opening a report is not audited: the trail is about what members do.

### Retention and privacy

A report is a disclosure of workspace data to a third party chosen by the workspace, limited to aggregates. `report_links` holds no personal data about visitors; `created_by` and `revoked_by` identify members. Export in Sprint 9 includes the rows without `token_hash`; deletion of a page or a workspace reaches them through the foreign keys. `report_lookup_failures` holds a keyed daily hash for 24 hours and nothing else.

## AC1 — server-side authorization of every action in this part

Extends the table in ADR 0012. "Not found" is the answer that does not confirm another tenant's identifiers.

| Surface | owner | admin | editor | member of another workspace | `anon` | Check |
|---|---|---|---|---|---|---|
| Page `/app/w/[id]/resultados` → RPC `get_workspace_analytics` | ✓ | ✓ | ✓ | not found (`P0002`) | no execute (proxy: sign-in) | pgTAP 160; Vitest `workspace.test.ts` (the service refuses before the repository) |
| Route `POST …/resultados/exportar` → `record_workspace_analytics_export` | ✓ | ✓ | ✓ | not found | no execute | pgTAP 160; Vitest `route.test.ts` (cross-site 403) |
| Table `report_links` (select) | own workspace | own workspace | no rows | no rows | no privilege | pgTAP 160; `token_hash` unreadable by any client role (pgTAP 010, 160) |
| Server Action `createReportLinkAction` → RPC `create_report_link` | ✓ | ✓ | forbidden (`42501`) | not found | no execute | pgTAP 160; Vitest `reports.test.ts`, `actions.test.ts` |
| Server Action `revokeReportLinkAction` → RPC `revoke_report_link` | ✓ | ✓ | forbidden | not found | no execute | same |
| Page `/r/[token]` → RPC `get_shared_report` | by token | by token | by token | by token | by token | pgTAP 160: one page per token, every failure identical |

The part 1 rows of ADR 0012 were re-run against the code as it stands (pgTAP 040 and 150, Vitest `identity`, `invitations`, `member-actions`, `profiles/service`): they hold. One consequence of this part for them: a member removed from a workspace keeps the links they created working, by design.

## Error contract (extends ADR 0004 and 0012)

`LK010` with detail `shareable_reports`: the plan has no shared reports. `22023` with detail `period`, `expires`, `label` or `token_hash`: invalid input. `LK091` with detail `page` or `workspace`: too many active links. `LK092`: too many links created in 24 hours. `get_shared_report` never raises for a bad token: it answers a status.

## Fail-safe before the migration is applied

`main` deploys before migrations. Without `202610060003` and `202610060004`: the per-page dashboard works as in Sprint 6 (its function is unchanged until the migration replaces it with an identical one); the consolidated screen says results are not available yet; the report-links section says the feature is not available in this environment; `/r/<token>` shows the generic unavailable state. No new secret and no new environment variable. The failed-lookup key reuses `VISITOR_HASH_SALT`; without it, callers share one bucket.

## Alternatives considered

- **Summing per-page reads in the application.** One request per page: the tenth page would make the dashboard ten times slower. Rejected by AC5.
- **A materialized workspace aggregate.** Another table to keep consistent, for a read that takes about 30 ms of database time at 50 pages and 30 days. Not needed.
- **A signed, self-contained token (JWT-like).** No database lookup, but revocation would need a deny list, which is the lookup again, and the token would carry identifiers. Rejected.
- **Token in the URL fragment.** Discussed under "Token".
- **A PDF generated by the server.** A dependency and a rendering service for something the browser's print dialog does. Out of scope.
- **Returning the per-page RPC's JSON to the report and hiding fields in the page.** The response itself would leak UTM labels and block identifiers to anybody who reads the network tab. The database builds the closed list.

## Consequences

- An agency has one screen for all its pages and one link per client report, and the numbers on the three surfaces are the same by construction and by test.
- Report links add a public, token-addressed read to the threat model (`docs/THREAT_MODEL.md`). Its safety rests on entropy, expiry, revocation and the closed field list, not on rate limiting.
- The consolidated read's cost grows with the rows aggregated (pages × days), not with the number of requests: 3 PostgREST requests per render at 1, 10 and 50 pages (`apps/web/scripts/agency-scale.mjs`).
- Sprint 8 switches `shareable_reports` and `analytics_days` with the plan; both are read at request time, so a plan change needs no data migration. **Done in ADR 0014**, with no change to this ADR's functions. Sprint 9 must add the scheduled purge of finished links and lookup counters, the platform rate limit, and report links to export and deletion.
- Without JavaScript the generic 404 is an empty page with the right status and headers: the framework renders not-found states on the client. The report itself is complete HTML.
