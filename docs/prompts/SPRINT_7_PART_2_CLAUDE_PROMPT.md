# Sprint 7, part 2 of 2 — Consolidated dashboard, shared report link and sprint closure (Projeto LNK)

## 0. Founder gate status

Edit this block before running the prompt if anything changed, in particular the line about part 1.

```text
SPRINTS 1–6: merged into main. Sprint 6 (customer analytics) is applied to staging; the founder confirmed it working there on 2026-10-06.
SPRINT 7 PART 1: done on the branch feat/sprint-7-agency (page list, search, archiving, duplication, invitations, members and roles, ADR 0012). Its state, gaps and handoff notes are in docs/SPRINT_7_REPORT.md, which is marked "in progress, part 1 of 2". Not pushed, not merged, not applied to staging.
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force — the five-person sessions are pending.
UX_DECISIONS confirmed by the founder: UX-020, UX-021, UX-023, UX-025 (2026-09-30). All others are provisional and are the implementation default (do not wait for confirmation).
Staging database: hosted Supabase project (Free) with the eleven migrations up to 202610020002. Hosted Auth is on defaults.
Staging application: Vercel, https://linkss-black.vercel.app (main deploys automatically). Two daily Vercel Crons (analytics 04:00 UTC, media cleanup 06:00 UTC).
This sprint is developed and verified on the local stack. Do not apply Sprint 7 migrations, create secrets or change settings on the hosted project or on Vercel; list them in the report as deploy steps for the founder.
```

This part delivers the second half of the product's differentiator, "multi-profile operations plus proof of results": the agency sees all its pages' results in one place and hands a client a link that proves them. The report link is the first surface where data that belongs to a workspace is shown to a person with no account, through nothing but a secret in a URL. A link that outlives its revocation, that shows another page's numbers, or that leaks how the page is configured would damage the agency in front of its own client. The numbers carry the same obligation as in Sprint 6: defensible, labeled as estimates, and honest about gaps.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. This session has no memory of the one that did part 1; everything you know about it comes from the repository. Your job is the **second half of Sprint 7**: the consolidated dashboard for a workspace, the read-only report link with expiry and revocation, the measurement behind the tenth-page criterion, and the closure of the whole sprint (report, source-of-truth documents, backlog, `AGENTS.md` §22). Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (continue from the last id in the file) or in ADR 0013 (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; especially §6, §11, §12, §13, §19–§22), `README.md`.
- **`docs/SPRINT_7_REPORT.md`** (part 1: decisions, status of each criterion, gaps, and the "Handoff to part 2" section) and **`docs/adr/0012-*.md`**. Then check them against reality: `git log main..HEAD`, `git status`, the migrations and the routes actually present. Where the report and the code disagree, the code is the fact; record the disagreement and correct the report.
- `PLANO_DE_EXECUCAO.md`: **Sprint 7**, plus Sprints 8 and 9 (billing will switch `shareable_reports` and `analytics_days` on and off for a workspace; Sprint 9's export, deletion and authorization review must reach report links).
- `BACKLOG.md`, `docs/SPRINT_6_REPORT.md` ("Implicações para a Sprint 7" and "Pendências, gaps e riscos").
- `docs/adr/0011-customer-analytics.md` in full (the aggregate model, the reporting timezone, visit and value-action definitions, open days read from raw events, the day-status table behind "delayed versus zero", retention and the `analytics_days` entitlement), ADR 0003, 0004 and 0007.
- `docs/ux/JOURNEYS.md` (J2: report creation and reading; expiry or revocation must not reveal whether another token exists), `docs/ux/WIREFRAMES.md` (section 7 and section 8, "Relatório do cliente"), `docs/ux/UX_DECISIONS.md` (UX-009: the report defaults to 30 days with an explicit expiry; UX-043 to UX-050 on what counts as a result and how numbers are worded), `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md`.
- `docs/ARCHITECTURE.md` (the analytics rows, including the Sprint 7 note), `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md`, `docs/OBSERVABILITY.md`, `docs/ENVIRONMENTS.md`, `docs/SUPABASE_CAPACITY.md`, `docs/runbooks/ANALYTICS.md`.
- Code: `apps/web/src/modules/analytics/*` (`dashboard.ts`, `dates.ts`, `service.ts`, `supabase-repository.ts`, `csv.ts`, `block-labels.ts`, `components/`), the per-page dashboard under `/app/w/[workspaceId]/paginas/[profileId]/resultados` and its export route, `get_profile_analytics` and `record_analytics_export` in `supabase/migrations/202610020002_customer_analytics.sql`, `apps/web/src/modules/entitlements/*`, `apps/web/src/modules/identity/permissions.ts`, everything part 1 added, the prototypes under `apps/web/src/app/proto/r/` and `apps/web/src/app/proto/w/` (UX references, not production code), `apps/web/src/modules/profiles/reserved-slugs.ts`, `apps/web/src/proxy.ts`, `apps/web/scripts/analytics-accuracy.mjs`, and the pgTAP suites.
- Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills before writing any SQL or policy. For Next.js 16 caching and route behavior, check the installed version and current documentation instead of relying on memory.

### Facts you must not get wrong

- **Dashboards read aggregates.** `analytics_daily` already has the `(workspace_id, day)` index. No client role reads the analytics tables directly; reads go through functions such as `get_profile_analytics`, which apply the role check and the `analytics_days` entitlement. The consolidated read and the report read are new functions of the same kind, not new access to the tables, and neither scans raw events beyond the bounded open-day window ADR 0011 already defines.
- **One definition of every number.** A visit, a result and a period mean the same thing in the per-page dashboard, the consolidated dashboard, the report and every CSV. For the same page and period, all of them show the same totals. Reuse `modules/analytics/dashboard.ts` and `dates.ts`; do not write a second funnel or a second date calculation.
- **Zero is not the same as missing or delayed.** The states from Sprint 6 (never published, no event yet, period before the page existed, zero, delayed, not deployed yet) apply here too, and a consolidated view adds mixed cases: some pages with data and some without.
- **Shareable reports are an entitlement** (`shareable_reports`, a feature key that only the Agency plan has today). Check the entitlement, never a plan name. Decide what happens to existing links when the entitlement is lost.
- **The report is reached by a token and nothing else.** Anonymous access goes through a narrow `security definer` RPC with a fixed `search_path`, granted to `anon`, like `get_public_page`. No service or secret key in that path. Only a hash of the token is stored. The token must not appear in logs, in analytics, in an Open Graph image URL or in a `Referer` header sent to another site.
- **Revocation and expiry take effect on the next request.** A report must not be served from a cache after it has been revoked or has expired. Public pages use ISR; the report must not.
- **Invalid, expired, revoked and unknown tokens look the same** to the person who opens them, with the same status code and the same copy.
- **The report shows results, not configuration.** Nothing from the editor, the workspace, its members, its plan, other pages, leads, audit events or internal identifiers. Decide deliberately whether UTM campaign names appear: they are the agency's internal labels.
- **Opening a report is not a visit.** The customer-analytics collector is mounted only by `/[slug]` and must stay that way; a test should show the report route does not mount it.
- **`r` is already in `reserved_slugs`,** added in Sprint 1 for this purpose. Verify that in the migration and in the TypeScript list before relying on it. Any other new top-level segment needs both.
- **Copy:** pt-BR. The report is read by people outside the product; decide where its copy lives and keep `content/public-page.ts` as the only copy file in the public page's client bundle (the report is a different route with its own bundle).
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build. The test and route counts at the end of part 1 are in `docs/SPRINT_7_REPORT.md`; confirm them by running the suites before you change anything.
- **Local environment:** the founder has test accounts in the local database. Apply migrations with `supabase migration up`; do not run `npm run db:reset` without approval. Stay inside this repository: write temporary files only to the session scratchpad, and leave Docker containers that belong to other projects alone. Analytics needs `ANALYTICS_SIGNING_SECRET` locally, and a signed-in browser is never counted (generate test traffic from a private window or with the accuracy script).

## 3. Goal and acceptance criteria

**Goal:** the person running an agency workspace opens one screen and sees how all its pages performed in a period and which ones need attention, then creates a link that lets a client read that page's results, for as long as the agency decides, without the client needing an account and without seeing anything else.

| # | Criterion (`PLANO_DE_EXECUCAO.md`) | Required evidence |
|---|---|---|
| AC4 | A shared report exposes no internal settings and no data from other pages | pgTAP showing the anonymous read returns only aggregates of the one page the token was issued for; a token for page A never returns page B's data, in the same or another workspace; expired, revoked, unknown and malformed tokens return the same empty result; a link stops working when its page is deleted, when its workspace is suspended, and according to the rule ADR 0013 sets for archived pages and a lost entitlement. A written field-by-field list of what the report response contains, and a test that fails if a field outside that list appears. Response headers that keep the token out of referrers and the page out of search engines and shared caches, checked in a test |
| AC5 | An agency can create its tenth page without perceptible degradation | A reproducible local measurement in an Agency-plan workspace: server time and query count for the page list, the consolidated dashboard and the create-page flow at one page and at ten pages (and at fifty for the reads, as headroom, if the entitlement can be raised locally). `EXPLAIN` output showing index use for the list and the consolidated read. The threshold that defines "perceptible" is stated before measuring (recommended: no query count that grows with the number of pages, and the tenth creation within the same order of time as the first). The measurement script stays in the repository |
| AC1 (completed) | Permissions are applied on the server for every sensitive action | The table part 1 put in ADR 0012 extended with every action of this part (view consolidated dashboard, export it, create, list, revoke a report link, open a report), with pgTAP and Vitest for each row. Then review part 1's rows against the code as it stands and fix or report anything that no longer holds |
| AC2, AC3 | Duplication isolation; invitations | Owned by part 1. Re-run their tests, confirm the status recorded in the report, and carry it into the final table with the evidence. If part 1 left either partial, finish it before starting the new deliverables and say so |

## 4. Deliverables

### D1 — ADR 0013 (consolidated analytics and shared report links)

Decide, justify and record. Where a recommended default is given, you may choose differently if the code or the documents show a better option; say why.

- **Consolidated read.** One function per workspace and date window that returns workspace totals, the daily series, and one row per page (visits, results, the rate as worded in UX-047, and the page's data state). Which pages are included: published, draft, archived, soft-deleted (recommended: every non-deleted page that has data in the period or is currently published, with archived pages labeled). How the `analytics_days` entitlement bounds the window. How the open day is read. The maximum number of pages returned and what happens beyond it. How the mixed data states are derived and what the workspace-level "updated at" means.
- **What the consolidated dashboard is for.** It is a ranking and a triage tool, not a second per-page dashboard: recommended scope is totals, the daily series, the page table ordered by results with a link into each page's own dashboard, and sources summed across pages. Blocks stay in the per-page view.
- **Report link model.** A `report_links` table: workspace, page, token hash, the period the report shows (recommended: a rolling window ending on the last completed day, 30 days by default per UX-009, never longer than the workspace's `analytics_days`; decide whether a fixed date range is also offered), an explicit expiry (recommended: required, 30 days by default, with a maximum), `revoked_at`, `created_by`, an optional label for the agency's own reference, and the minimum of usage information (recommended: a last-opened timestamp and nothing else; decide and justify it against the data-minimization rule). The limit of active links per page and per workspace.
- **Token.** At least 128 bits from a cryptographic source, shown once at creation, only the hash stored, so a lost link means a new one. Where it travels (path segment or fragment) and the consequences for logs and referrers.
- **What the report contains,** field by field, and what it leaves out. Recommended content: the agency's workspace name, the page's name and public address, the period and timezone, visits, results and the rate, the daily series, sources at the level of source (decide on UTM campaign), and the blocks ranked by clicks with their current titles (those titles are already public on the page). Decide whether the "Criado com Projeto LNK" attribution appears and whether that depends on `remove_badge`. Marketing wording on the report may only describe what exists.
- **Lifecycle rules.** What a link does when its page is unpublished, archived, soft-deleted or restored; when the workspace is suspended or deleted; when `shareable_reports` is lost on a downgrade (recommended: links stop resolving and are kept, so they work again if the entitlement returns, and the management screen says why); when the creator leaves the workspace (recommended: the link belongs to the workspace and survives).
- **Serving.** A dynamic route with no shared caching, `noindex`, a referrer policy that sends nothing, no third-party request, no collector. The single generic state and its status code. Abuse: token guessing is infeasible by entropy, but state the database-level limit on failed lookups (the `analytics_rate_hits` and `form_submission_hits` precedents) and what stays exposed until the global rate limiting of Sprint 9.
- **Roles.** Who creates, lists and revokes report links, and who sees the consolidated dashboard and exports it. Recommended: every member views; owners and admins create and revoke links, because a link publishes workspace data outside the workspace. Add the actions to the matrix on both sides.
- **Audit.** Creation and revocation of a link are audited; decide about exports. Opening a report is not written to the audit trail.
- **Retention and privacy.** How long revoked and expired links are kept, how export and deletion in Sprint 9 will reach them, and confirmation that the report holds no personal data about visitors (aggregates only).

### D2 — Database (forward-only migrations + pgTAP)

- The consolidated read function, authorized by membership and bounded by the entitlement.
- `report_links` with RLS, the indexes for its foreign keys, the token hash, RLS fields and expiry, and RPCs to create, list and revoke.
- The anonymous report read, `security definer`, fixed `search_path`, granted to `anon`, returning exactly the field list in ADR 0013.
- New audit actions in a separate enum migration, following the earlier sprints.
- pgTAP, at minimum: every AC4 case; consolidated totals equal the sum of the per-page function's totals for the same window on a fixture with several pages, including a page with no data, an archived page and a soft-deleted page; the day boundary in the reporting timezone; the entitlement bound; a member of another workspace and `anon` get nothing from the consolidated read; an editor against each link action per the matrix; creating a link without `shareable_reports`; a link whose expiry is in the past, beyond the maximum, or missing; revoking twice; a link for a page in another workspace; the report totals equal the per-page dashboard's totals for the same window; the failed-lookup limit.
- Regenerate `apps/web/src/lib/database.types.ts` (`npm run db:types`). Run the Supabase advisors on the local stack and fix what they report.

### D3 — Pure modules and server code

- Under `modules/analytics/` (or a sibling module if the boundary is clearer): the consolidated view model built from the function's rows, including the mixed data states, ordering with ties, the zero-visit denominator, and archived or removed pages. Reuse the Sprint 6 functions.
- Report links: token generation and hashing, expiry validation with an injected clock, the period rule, the mapping from every database outcome to one user-facing state, and the report view model with its closed field list.
- Server Actions and Route Handlers validating input at the boundary and checking the role on the server. Structured logs with a correlation id and outcome, and never a token, on both the management side and the public route. Add a signal for report reads and failed lookups to `docs/OBSERVABILITY.md`.
- Vitest tables for all of it.

### D4 — Consolidated dashboard (pt-BR, mobile-first)

A workspace-level results screen, linked from the workspace navigation and the page list.

- The same period presets as the per-page dashboard, with the timezone and the "atualizado em" time.
- Workspace totals, the daily series (server-rendered SVG or CSS with a table alternative, no chart library), and the page table with each page's numbers, its data state in words, and a link to its own dashboard. On a phone the table must stay readable without horizontal scroll of the page body.
- Every data state, including the mixed ones and a workspace with one page, plus loading, error and permission-denied states.
- CSV export of per-page totals for the period, with the same escaping and formula-injection protection as the existing exports, the timezone stated, and the audit decided in ADR 0013.

### D5 — Report links (pt-BR, mobile-first)

- **Management,** on the page's results screen: create a link (period, expiry, optional label), see the link once with a copy button, list the links with status in words (active, expires on, expired, revoked), and revoke with a confirmation that says the link stops working immediately. A clear state when the workspace does not have `shareable_reports`, with no upgrade flow (Sprint 8) and no claim about pricing beyond what `lib/product.ts` already states.
- **The report at `/r/[token]`:** read-only, designed to be opened on a phone from a chat app and to be printed or saved as PDF from the browser. Agency name, page name, period, the numbers with the same labels as the dashboard, a short note on how visits are counted and that they are estimates, and the date the link expires. Every number is available as text or in a table. The generic unavailable state.
- 44 px targets, visible focus, no state carried by color alone, `prefers-reduced-motion`, WCAG 2.2 AA.

### D6 — The tenth-page measurement (AC5)

A script kept in the repository, in the manner of `apps/web/scripts/analytics-accuracy.mjs`, that builds the fixture workspace on the local stack and records the measurements in §3. It uses accounts under the `example.test` domain, never the founder's test accounts, and says how to remove what it created. If a measurement shows growth with the number of pages, fix the cause and measure again; report both runs.

### D7 — Tests

Vitest for D3, for the refusal paths of every Server Action and route, for the report route's headers and generic state, and a test that the report and the consolidated dashboard do not mount the collector. pgTAP as in D2. Tests inject the clock. Every deterministic bug found on the way gets a regression test.

### D8 — Documentation and sprint closure

- `docs/adr/0013-*.md` (D1). Update ADR 0011 and ADR 0012 where their notes are now resolved, and `docs/ARCHITECTURE.md`.
- `docs/THREAT_MODEL.md`: token leakage through referrers, logs, previews and forwarded messages; guessing; use after revocation through a cache; cross-page and cross-workspace reads; a report used to probe which pages exist; implemented versus pending.
- `docs/DATA_MAP.md`: `report_links` field by field, the fact that a report is a disclosure of workspace data to a third party chosen by the workspace, retention, and how export and deletion reach it. Review `apps/web/src/app/(marketing)/privacidade` and the marketing pages: they may now describe reports and team access, and only as built.
- `docs/OBSERVABILITY.md`, `docs/runbooks/` ("a client says the report link does not open", "a link must be killed now", "consolidated numbers disagree with a page's numbers"), `docs/SUPABASE_CAPACITY.md` if the new reads or tables change an estimate, `.env.example` if a variable was added.
- `docs/ENVIRONMENTS.md`: "Passos de deploy da Sprint 7", ordered, covering both parts (migrations first, then any secret, then the merge), and what the application does in between.
- `docs/ux/UX_DECISIONS.md` and `docs/ux/CONTENT_GUIDE.md`.
- `BACKLOG.md`: check off only Sprint 7 items that are done and verified, and add the follow-ups that came out of the sprint.
- **`docs/SPRINT_7_REPORT.md` as the final report of the whole sprint.** Remove the "in progress" marking and merge part 1's content with this part's into one document that follows AGENTS.md §20 and the structure of `docs/SPRINT_6_REPORT.md`: objective and outcome, decisions (including §0 and the split into two sessions), the table of all five criteria with honest status (implemented / verified / prepared / partial / blocked / not started) and direct evidence, deliverables with paths, exact final results of `npm audit`, lint, typecheck, unit tests, DB tests, advisors and build, the AC5 measurements, security/privacy/accessibility/performance/operations implications, gaps and risks, questions for the founder, the staging deploy steps, and implications for Sprint 8 (plans and billing will drive `max_profiles`, `team_members`, `shareable_reports` and `analytics_days`; say what happens on a downgrade to pages, members and links above the new limits, or list it as a decision Sprint 8 must make).
- Update `AGENTS.md` §22 "Current project state" to the real end state.

## 5. Out of scope

Billing, checkout, plan assignment or upgrade interface, custom domains, Meta Pixel and GA (Sprint 8); global rate limiting, CAPTCHA, moderation, account export and deletion execution (Sprint 9); e-mailing reports or scheduling them; PDF generation on the server; white-labeled reports, custom logos or colors on the report beyond what the page's theme already defines; a report covering several pages or the whole workspace; password-protected links; per-visitor data of any kind; region (UF); comparing periods; goals and alerts; a chart or date library; an external analytics store; real-time dashboards; a public API; generative AI; staging provisioning. Do not redo part 1's deliverables except to fix defects you find; record each such fix in the report.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken RLS, validation, rate limits or authorization to make a test pass.
- No new runtime dependency without a concrete need and a justification in ADR 0013. Run `npm audit` after any dependency change.
- Migrations are forward-only and compatible with rolling the application back one version. No destructive changes. `main` deploys to staging before the founder applies migrations, so code that needs a Sprint 7 migration must fail safe: existing flows keep working, the new screens say the feature is not available yet, and `/r/[token]` shows the generic unavailable state.
- Preserve Sprint 0–6 behavior and part 1's. The per-page dashboard's numbers must not change. Don't touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px, about 768 px and desktop ≥1280 px for the consolidated dashboard, the link management and the report, in every state. Check the report's print layout.
- Public-page performance is untouched: confirm the public route's client JS size did not change.
- With Docker and the local stack running, verify in a browser: generate traffic for three or more pages of one workspace (private window or the accuracy script), run the analytics job, and compare the consolidated totals with each page's dashboard; create a report link, open it in a private window, compare its numbers with the page's dashboard for the same window; revoke it and reload (it must be gone on that reload); let a link expire by creating one with a short expiry through a test path that injects the clock, or by adjusting the row locally, and open it; open a link for page A and try to reach page B by changing the URL; open the report with a second workspace's session and with no session; try every link action as an editor and as a member of another workspace by calling the server directly; a workspace without `shareable_reports`; the consolidated CSV opened in a spreadsheet. If any of this can't be done, say so and mark the item *prepared*, not verified.

## 8. Work order

1. **Read and verify the starting point:** read §2, inspect the git state on `feat/sprint-7-agency`, and run `npm run test:db` and `npm run check` before changing anything. If either fails, fix that first and record what was wrong. Summarize part 1's real state, the plan, the schema drafts, the risks, and how AC4 and AC5 will be evidenced.
2. **Finish anything part 1 left partial** that §3 assigns to it.
3. **ADR 0013.**
4. **Pure modules + Vitest** (D3).
5. **Migrations + pgTAP;** iterate until `npm run test:db` passes; regenerate types; run advisors.
6. **Consolidated dashboard and its CSV** (D4).
7. **Report links: management, then the public route** (D5).
8. **The AC5 measurement** (D6), the **AC1 review** across both parts, and the **browser verification** in §7.
9. **Docs, runbooks, privacy and marketing review, backlog, the final sprint report, `AGENTS.md` §22.**
10. **Final gate:** review the full branch diff against `main` for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit along the way in coherent Conventional Commits (for example `feat(db): add the workspace analytics read and report links`, `feat(analytics): add the consolidated dashboard`, `feat(reports): add read-only report links with expiry and revocation`).

**If this part is at risk of overrunning,** cut in this order and record each cut in the report: the consolidated CSV; sources in the consolidated view; the link label and last-opened timestamp; the block ranking in the report (keep totals, series and sources); the fifty-page headroom measurement. Do not cut the token hash, expiry and immediate revocation, the generic unavailable state, the closed field list of the report, tenant isolation of the consolidated read, the equality of totals across views, server-side authorization, the zero-versus-missing states, accessibility, or the sprint report.

## 9. Stop and ask for approval before

- applying migrations, creating secrets, changing settings or creating anything on a **hosted** Supabase project or on Vercel (including through MCP tools); use the local stack only;
- running `npm run db:reset` or anything else that deletes local data;
- adding any paid service, new vendor, subprocessor or runtime dependency not justified in ADR 0013;
- setting any cookie or persistent identifier on people who open a report;
- any destructive migration or data loss;
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- writing or deleting anything outside this repository;
- expanding scope beyond §4, or cutting an item that is not in the §8 cut list.

## 10. Final response format

1. Outcome of the whole sprint in 3–5 sentences.
2. Acceptance-criteria table for all five criteria (status + evidence), saying which part produced each piece of evidence.
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), advisors, build (routes), the AC5 table (query count and server time at one, ten and fifty pages), and the comparison of consolidated, per-page and report totals for the same window.
5. Security and privacy negative cases tested (cross-page and cross-workspace reads, expired, revoked, unknown and malformed tokens, missing entitlement, each role against each action, `anon`, cache after revocation, token in logs and referrers, the report's field list).
6. Decisions awaiting founder confirmation (the new UX ids and the ADR 0012 and 0013 choices), any item cut from scope, and any defect of part 1 fixed here.
7. Ordered staging deploy steps for the founder for the whole sprint, blockers, pending external setup and the recommended starting point for Sprint 8.
