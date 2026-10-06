# Sprint 7, part 1 of 2 — Pages, duplication, invitations and roles (Projeto LNK)

## 0. Founder gate status

Edit this block before running the prompt if anything changed.

```text
SPRINTS 1–6: merged into main. Sprint 6 (customer analytics) is applied to staging; the founder confirmed it working there on 2026-10-06.
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force — the five-person sessions are pending.
UX_DECISIONS confirmed by the founder: UX-020, UX-021, UX-023, UX-025 (2026-09-30).
Other UX decisions (up to UX-050): provisional, and they are the implementation default (do not wait for confirmation).
Staging database: hosted Supabase project (Free) with all eleven migrations up to 202610020002. Hosted Auth is on defaults. No custom SMTP and no mail adapter exist.
Staging application: Vercel, https://linkss-black.vercel.app (main deploys automatically). Two daily Vercel Crons (analytics 04:00 UTC, media cleanup 06:00 UTC).
Still open on staging: real-visitor LCP/CLS and the first successful scheduled run of both crons. These do not block this sprint.
Sprint 7 is split into two prompts run one after the other on the same branch, feat/sprint-7-agency. This is part 1. Part 2 (consolidated dashboard, read-only report link, the tenth-page measurement and the sprint closure) runs after it in a new session that has none of this session's context.
This sprint is developed and verified on the local stack. Do not apply Sprint 7 migrations, create secrets or change settings on the hosted project or on Vercel; list them in the report as deploy steps for the founder.
```

Sprint 7 turns a product that one person uses for one page into a tool an agency operates: many pages, several people, different levels of access. This part changes who can reach a workspace, which is the most sensitive thing the product does after authentication. An invitation that lands in the wrong workspace, a role check that exists only in the interface, or a duplicated page that still shares content with its original are the failures that matter here. They matter more than any missing convenience.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. Sprints 0–6 are done (see `docs/SPRINT_6_REPORT.md`). Your job in this session is the **first half of Sprint 7, "Multi-perfil e operação de agência"**: the page list with search, archiving and duplication; invitations; the members screen with the Owner, Admin and Editor roles; and workspace switching that holds up with several workspaces and several members. Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (UX, next id UX-051) or in ADR 0012 (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; it overrides your defaults, especially §6, §11, §13, §19–§22), `README.md`.
- `PLANO_DE_EXECUCAO.md`: **Sprint 7**, plus Sprints 8 and 9 (billing will assign plans and change entitlements under the limits you enforce here; Sprint 9 reviews authorization and builds export/deletion, which must reach the tables you add).
- `BACKLOG.md` (Sprint 7 section and the open-debt section), `docs/SPRINT_6_REPORT.md` ("Implicações para a Sprint 7"), `docs/SPRINT_2_REPORT.md` (what the tenancy model already provides and what was left without an interface).
- `docs/adr/0004-tenancy-and-authorization.md` (the role matrix, the last-owner guard, the `team_members` trigger, and the note that invitations for people without an account need a `workspace_invitations` table with token hash, email, expiry and revocation), `docs/adr/0005-authentication.md`, `docs/adr/0009-media-and-storage-adapter.md` (media references follow a "same page" rule; duplication must copy assets or widen that rule), ADR 0003, 0007, 0008, 0010 and 0011.
- `docs/ux/JOURNEYS.md` (J2, the agency journey), `docs/ux/WIREFRAMES.md` (section 7, "Conta da agência e nova página"), `docs/ux/UX_DECISIONS.md` (UX-008 on what duplication copies, UX-017 on what an editor cannot do, UX-018 on the limit of agency accounts, UX-019 on archived pages counting toward the limit), `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md`.
- `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md`, `docs/ENVIRONMENTS.md`, `docs/OBSERVABILITY.md`, `docs/runbooks/*`.
- Code: `apps/web/src/modules/identity/*` (`permissions.ts`, `guard.ts`, `page-guard.ts`, `workspace-actions.ts`, `redirects.ts`, `components/workspace-switcher.tsx`), `apps/web/src/modules/profiles/*`, `apps/web/src/modules/entitlements/*`, `apps/web/src/lib/product.ts`, `apps/web/src/modules/media/*`, `apps/web/src/modules/publishing/*` (`cache.ts` in particular), `apps/web/src/modules/audit/*`, every route under `apps/web/src/app/app/`, the prototype under `apps/web/src/app/proto/w/` (the UX reference, not production code), every migration in `supabase/migrations/` and the pgTAP suites in `supabase/tests/database/`.
- Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills before writing any SQL or policy. For Next.js 16 and React 19 behavior, check the installed versions and current documentation instead of relying on memory.

### Facts you must not get wrong

- **Much of the model already exists; find it before adding to it.** `workspace_memberships` has `role`, a `status` of `invited`, `active` or `revoked`, and `invited_by`. `change_member_role` and `remove_workspace_member` exist as RPCs with no interface. `private.guard_last_owner` and `private.enforce_team_member_limit` are triggers. `profile_status` already has `archived`. The `max_profiles` trigger counts every non-deleted page, archived included. A workspace switcher component exists. Extend these; do not build a parallel model.
- **The role matrix lives in two places that must agree:** `modules/identity/permissions.ts` and the database (RLS plus RPCs). pgTAP and Vitest cover both sides. Any new action goes into both, with tests on both.
- **Authorization is decided on the server and in the database.** Hiding a button is presentation. Every Server Action, Route Handler and RPC that this part adds or exposes must reject a caller without the right role in the right workspace, and a test must show it.
- **Ordinary user actions never use the service or secret key.** Invitation acceptance by a person who is not a member yet goes through a narrow `security definer` RPC with a fixed `search_path`, the way `submit_form_lead` and `ensure_personal_workspace` work.
- **Entitlements, not plan names.** Page and member limits come from `max_profiles` and `team_members`. There is no billing yet (Sprint 8): find out how a workspace gets its plan today, do not build plan assignment or upgrade interface, and use local SQL to put a test workspace on the Agency plan. Say in the report how a staging workspace would get the Agency plan before Sprint 8.
- **There is no mail adapter and no custom SMTP.** Do not add a mail vendor or send invitation e-mail through Supabase Auth's admin API. The recommended default is an invitation link that the inviter copies and sends through their own channel; record it as provisional.
- **Adding enum values and using them cannot happen in one transaction.** Earlier sprints used a separate `..._enum_values` migration ahead of the main one; follow that for new audit actions and any other enum.
- **Public pages are static HTML served by ISR from the snapshot.** Any action that changes whether a page is publicly visible (archiving, for example) must go through the existing unpublish path and cache revalidation, and must not make `/[slug]` dynamic.
- **Every new top-level route goes into `reserved_slugs`** (migration + TypeScript list). Prefer routes under the existing `/app` prefix so that none is needed.
- **Copy:** user-facing copy is pt-BR and lives in `content/pt-BR.ts`. `content/public-page.ts` is the only copy file shipped in the public page's client bundle; nothing from this part belongs there. Code, identifiers, ADRs and technical docs are English.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build. Baseline at the end of Sprint 6: 690 Vitest tests, 639 pgTAP assertions, 41 routes.
- **Local environment:** the founder has test accounts in the local database. Apply migrations with `supabase migration up`; do not run `npm run db:reset` without approval. Stay inside this repository: write temporary files only to the session scratchpad, and leave Docker containers that belong to other projects alone.

## 3. Goal and acceptance criteria for this part

**Goal:** a person who runs an agency workspace can find any of its pages quickly, archive the ones no longer in use, start a new client page from an existing one, bring colleagues in with the right level of access, and move between workspaces without ever acting in the wrong one.

Sprint 7 has five acceptance criteria in `PLANO_DE_EXECUCAO.md`. This part owns three of them and prepares a fourth. The remaining one (the shared report) belongs to part 2.

| # | Criterion | Required evidence in this part |
|---|---|---|
| AC1 | Permissions are applied on the server for every sensitive action | A table in ADR 0012 listing every Server Action, Route Handler and RPC added or exposed in this part against owner, admin, editor, member of another workspace, signed-in non-member and `anon`. Vitest for the application side and pgTAP for the database side of every row. At least one check per action that calls the server directly, without the interface, as a role that must be refused |
| AC2 | A duplicated template shares no mutable content with the original | pgTAP and Vitest showing that after duplication: every block id is new; editing, publishing, archiving or deleting either page leaves the other unchanged; deleting the original does not orphan or remove the copy's media; the copy has no publications, analytics, leads, slug history, custom domain or report links; the copy is a draft with its own slug and `draft_revision` |
| AC3 | Invitations expire, can be revoked and never grant access to the wrong workspace | pgTAP for: accepted once and only once; expired; revoked; a token from workspace A presented while naming workspace B; a token accepted by an account whose e-mail does not match (according to the rule ADR 0012 sets); an already-active member; a revoked member invited again; the `team_members` limit reached between invitation and acceptance; an admin trying to invite an owner; an editor trying to invite at all. Invalid, expired, revoked and unknown tokens are indistinguishable to the person presenting them. The stored value is a hash, and the token appears in no log line |
| AC5 (prepared) | An agency can create its tenth page without perceptible degradation | The page list and the create flow make a bounded number of queries that does not grow with the number of pages (no N+1), with the supporting indexes in place. The timed measurement at ten pages is part 2's job; leave it possible |

## 4. Deliverables

### D1 — ADR 0012 (multi-page operations, invitations and roles)

Decide, justify and record. Where a recommended default is given, you may choose differently if the code or the documents show a better option; say why.

- **Archiving.** What archiving does to a published page (recommended: it unpublishes through the existing path, the public address stops answering with the page, the slug stays held by the page, analytics aggregates and leads are kept and stay readable, and the page keeps counting toward `max_profiles` per UX-019). What unarchiving returns the page to (recommended: draft, publishing is a separate deliberate step). Who may archive and unarchive. Which state transitions the database enforces. What a visitor sees at the address of an archived page.
- **Duplication.** A single transactional database operation that deep-copies the draft content and the theme into a new draft page in the same workspace, with new block ids and a new slug. State exactly what is copied and what is not (UX-008). Decide the media question left open by ADR 0009: copy the asset rows and objects, or widen the reference rule so one asset can be kept alive by several pages of the same workspace. Whichever you choose, deleting or archiving one page must never break the other's images, the orphan cleanup job must stay correct, and the `storage_mb` accounting must be stated. Decide how Pix keys, WhatsApp numbers and form consent text are treated when a page is copied for a different client (recommended: copied, with a visible notice on the new draft listing the contact and payment details to review before publishing). Duplication across workspaces is out of scope; say so. "Template" in this sprint means duplicating an existing page; there is no shared template library.
- **Invitations.** The `workspace_invitations` model: workspace, normalized e-mail, role (admin or editor; ownership is never granted by invitation), token hash, expiry (recommended: seven days), revocation, acceptance, `invited_by`. Token generation (at least 128 bits from a cryptographic source, shown once, only the hash stored, so a lost link means a new invitation). The acceptance rule: the person must be signed in with a confirmed e-mail; decide whether that e-mail must equal the invited one (recommended: yes, compared after normalization, because the link will travel through chat apps) and what the person sees when it does not. How the link survives sign-in and sign-up for someone without an account, using the existing safe-redirect rules. Whether pending invitations count toward `team_members` (recommended: yes, so the limit cannot be exceeded at acceptance, and it is checked again at acceptance anyway). How `workspace_memberships.status = 'invited'` relates to the new table, so there are not two sources of truth. Limits on creating invitations per workspace and per person. What is audited.
- **Roles and members.** Confirm or amend the matrix for the new actions (`members.invite`, `invitations.revoke`, `profile.archive`, `profile.duplicate`, and any other you add). Recommended: an editor edits and publishes but does not archive, duplicate, invite or manage members, consistent with UX-017, because duplication consumes a paid entitlement. Ownership transfer: decide whether it is in scope (recommended: only what `change_member_role` already allows, with the last-owner guard). What happens to a person's open sessions and in-flight edits when they are removed or demoted: the next server request must be refused.
- **Workspace switching.** How the current workspace is determined (the URL carries `workspaceId`; decide whether a last-used workspace is remembered for `/app` and where), what the switcher lists, and the rule that no action takes its workspace from anything but the request it belongs to.
- **Page list queries.** Search fields (name and slug), matching rule, filters by status, ordering, the page size and the pagination model, and the indexes. With at most a few dozen pages per workspace, do not add an extension or a search service; state the page count at which that would change.
- **The AC1 table** described in §3.

### D2 — Database (forward-only migrations + pgTAP)

- `workspace_invitations` with RLS: members who may manage invitations read their own workspace's rows without the token hash being useful to them; nobody else reads anything. Indexes on the foreign keys, the token hash, and the fields used by RLS and by expiry.
- RPCs to create, revoke and accept an invitation, and a lookup that returns to the invited person only what the acceptance screen needs (workspace name, role, inviter's display name) and only for a valid token.
- Archive and unarchive operations, audited, with the transitions enforced.
- The duplication operation, audited, honoring `max_profiles` through the existing trigger and the storage entitlement.
- A bounded read for the page list that returns what the list shows in one query (including publication status), with search, filter and pagination.
- New audit actions, in a separate enum migration.
- pgTAP, at minimum: every AC2 and AC3 case; every row of the AC1 table; archive and unarchive by each role and by another workspace's member; archiving a published page removes it from `get_public_page` and unarchiving does not republish it; duplication at the `max_profiles` limit, by an editor, across workspaces, and of an archived or soft-deleted page; the page list never returns another workspace's pages whatever the search string, including hostile strings and wildcard characters; the last-owner guard through the new interface paths; `anon` on every new function and table.
- Regenerate `apps/web/src/lib/database.types.ts` (`npm run db:types`). Run the Supabase advisors on the local stack and fix what they report.

### D3 — Pure modules and Server Actions

- Extend `modules/identity/permissions.ts` with the new actions and keep its tests in step with pgTAP.
- Invitation logic that can be tested without a database: e-mail normalization, token generation and hashing, expiry arithmetic with an injected clock, and the mapping from every database outcome to one user-facing state.
- Page list parameters: parsing and validating the search string, filter, order and page from untrusted query strings.
- Duplication naming: how the copy's name and suggested slug are derived, including collisions and length limits.
- Server Actions for every operation, validating input at the boundary, checking the role on the server before calling the database, and returning the existing form-state shape. Structured logs with a correlation id and outcome, and never an e-mail address or a token.

### D4 — Interface (pt-BR, mobile-first)

Use the `/proto/w/` prototype and `docs/ux/WIREFRAMES.md` section 7 as the starting point.

- **Page list** at the workspace home: search, status filter, plan usage ("3 de 10 páginas"), each page's status and public address, and the actions the viewer's role allows. Search and filter live in the URL so that they survive reload and the back button. An empty search keeps the filters and offers to clear the search.
- **Archive and unarchive** with a simple confirmation that says what happens to the public address. **Duplicate** from the list and from the page's management screen, landing on the new draft with the review notice.
- **Members screen:** members with role, pending invitations with expiry, invite form, revoke, change role, remove, and leave. The limit from `team_members` is shown before the person hits it.
- **Invitation acceptance** screen for every state: valid, signed out, signed in with a different e-mail, already a member, limit reached, and the single generic "this invitation is not valid" state.
- **Workspace switcher** reviewed with one, two and several workspaces, and with a workspace the person has just been removed from.
- Every screen defines loading, empty, success, validation, failure and permission-denied states. Server Components by default; client components only where there is browser interaction. 44 px targets, visible focus, programmatic labels, no state carried by color alone, `prefers-reduced-motion`.

### D5 — Tests

Vitest for every D3 module, for each Server Action's refusal paths, and for the mapping of invitation outcomes. pgTAP as in D2. Tests inject the clock; no wall-clock sleeps. Every deterministic bug found on the way gets a regression test.

### D6 — Documentation and handoff to part 2

Part 2 starts in a new session with none of this one's context. Whatever it needs must be in the repository.

- `docs/adr/0012-*.md` (D1). Update ADR 0004 and ADR 0009 where their open notes are now resolved, and `docs/ARCHITECTURE.md`.
- `docs/THREAT_MODEL.md`: invitation token theft and replay, acceptance into the wrong workspace, role escalation by an admin, enumeration of invitations and of workspace membership, a removed member's open session, duplication as a route around entitlements; implemented versus pending.
- `docs/DATA_MAP.md`: the invited e-mail address is personal data about someone who may never sign up. Record purpose, basis, retention (decide when expired and revoked invitations are deleted, and whether a purge is scheduled now or listed for Sprint 9) and how export and deletion will reach it.
- `docs/ux/UX_DECISIONS.md` (UX-051 onward, provisional), `docs/ux/CONTENT_GUIDE.md`, a runbook entry for "someone cannot accept an invitation" and "a member has the wrong access", and `docs/ENVIRONMENTS.md` if a deploy step was added.
- **`docs/SPRINT_7_REPORT.md`**, started now and marked plainly as **in progress, part 1 of 2**. Use `docs/SPRINT_6_REPORT.md` as the structural baseline and follow AGENTS.md §20. Fill in what this part did: decisions, the acceptance table with honest status for all five criteria (AC4 as not started, AC5 as prepared), deliverables with paths, exact verification results, negative cases tested, gaps and risks, questions for the founder, and a section named "Handoff to part 2" with the state of the branch, the local test accounts and workspaces created (never passwords or tokens), anything left unfinished with the exact continuation point, and anything part 2 should know before reading aggregates per workspace.
- `BACKLOG.md`: check off only Sprint 7 items that are done and verified. Do not edit `AGENTS.md` §22 in this part; part 2 updates it once, at the real end state.

## 5. Out of scope for this part

The consolidated dashboard, the read-only report link and the `/r/` route, the timed tenth-page measurement and the sprint closure (part 2). Also: billing, plan assignment or upgrade interface, custom domains, pixels (Sprint 8); account export and deletion, moderation, global rate limiting, CAPTCHA (Sprint 9); sending e-mail of any kind; a shared template library; duplication or moving of pages across workspaces; per-page permissions or custom roles; real-time collaborative editing; white-labeling; a public API; region (UF) in analytics; generative AI; staging provisioning.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken RLS, validation, rate limits or authorization to make a test pass.
- No new runtime dependency without a concrete need and a justification in ADR 0012. Run `npm audit` after any dependency change.
- Migrations are forward-only and compatible with rolling the application back one version. No destructive changes. `main` deploys to staging before the founder applies migrations, so code that needs a Sprint 7 migration must fail safe: existing flows keep working and the new screens say the feature is not available yet.
- Preserve Sprint 0–6 behavior (onboarding, block editor, autosave and conflict flow, publish/rollback/unpublish, uploads, leads, analytics collection and dashboard, both cron jobs). Don't touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px, about 768 px and desktop ≥1280 px, with no horizontal scroll, for every new screen in every state.
- WCAG 2.2 AA for the new flows.
- With Docker and the local stack running, verify in a browser with at least three accounts: an owner invites an admin and an editor; each accepts; each sees only the actions their role allows, and a direct request for a forbidden action is refused; a revoked and an expired invitation show the generic state; an invitation opened by the wrong account is refused; an editor is removed while their editor tab is open and the next save is refused; a page with images, a form and a Pix block is duplicated, both are edited and published separately, and the original is then deleted with the copy's images still loading; a published page is archived and its public address stops serving it; search and filter with ten or more pages; switching between two workspaces. If any of this can't be done, say so and mark the item *prepared*, not verified.

## 8. Work order

1. **Read and plan:** read §2 and inspect the git state. Summarize the plan, the schema drafts, the risks, and how AC1, AC2 and AC3 will be evidenced.
2. **Branch:** work on `feat/sprint-7-agency`, which already exists and carries a documentation commit that is not in `main`. Confirm it contains the current `main`. If it does not, say so and bring it up to date with a merge, not a rebase.
3. **ADR 0012.**
4. **Pure modules + Vitest** (D3).
5. **Migrations + pgTAP;** iterate until `npm run test:db` passes; regenerate types; run advisors.
6. **Server Actions,** then the **page list, archive and duplication** interface.
7. **Invitations, members screen and acceptance flow.**
8. **Workspace switcher review** and the **browser verification** in §7.
9. **Docs, the part 1 sprint report and the handoff section, backlog.**
10. **Final gate:** review the full diff for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails. The branch must be green and committed when this session ends, because part 2 builds on it.

Commit along the way in coherent Conventional Commits (for example `feat(db): add workspace invitations and page archive/duplicate operations`, `feat(profiles): add page search, archiving and duplication`, `feat(identity): add invitations and the members screen`).

**If this part is at risk of overrunning,** cut in this order and record each cut in the report: remembering the last-used workspace; the status filter (keep search); role change from the interface (keep invite, revoke and remove); leaving a workspace from the interface. Do not cut server-side authorization for any action, invitation expiry and revocation, the wrong-workspace and wrong-account refusals, deep-copy isolation in duplication, tenant isolation in the page list, or accessibility.

## 9. Stop and ask for approval before

- applying migrations, creating secrets, changing settings or creating anything on a **hosted** Supabase project or on Vercel (including through MCP tools); use the local stack only;
- running `npm run db:reset` or anything else that deletes local data;
- adding any paid service, new vendor, subprocessor or runtime dependency not justified in ADR 0012, and sending e-mail by any means;
- any destructive migration or data loss;
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- writing or deleting anything outside this repository;
- expanding scope beyond §4, or cutting an item that is not in the §8 cut list.

## 10. Final response format

1. Outcome in 3–5 sentences, stating that this is part 1 of 2.
2. Acceptance-criteria table for all five criteria (status + evidence).
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), advisors, build (routes).
5. Negative cases tested (each role against each action, cross-workspace, `anon`, invitation replay, expiry, revocation, wrong workspace, wrong account, limit reached, hostile search strings, duplication isolation).
6. Decisions awaiting founder confirmation (UX-051 onward and the ADR 0012 choices), and any item cut from scope.
7. What part 2 inherits: branch state, unfinished items with the continuation point, and anything that changes part 2's plan.
