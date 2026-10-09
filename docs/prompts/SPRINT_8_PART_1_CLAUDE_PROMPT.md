# Sprint 8.1 (part 1 of 2) — Plans, subscriptions and billing (Projeto LNK)

## 0. Founder gate status

Edit this block before running the prompt if anything changed. The lines marked `FOUNDER:` are decisions; where one is still "not decided", the default in this prompt applies and is recorded as provisional.

```text
SPRINTS 1–7: merged into main. Sprint 7 (PR #18) was verified on the local stack only; its result on staging has not been checked.
BRANCH feat/app-design (UX-073, product look on the remaining screens): NOT merged when this prompt was written. Check `git log main` before starting; branch from main as it is.
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force.
UX_DECISIONS: provisional ones are the implementation default (do not wait for confirmation).
PRODUCT DOMAIN: not purchased. The public origin is NEXT_PUBLIC_APP_URL; staging is https://linkss-black.vercel.app. Public brand not chosen.
FOUNDER: PAYMENT_PROVIDER = not decided (see D1: compare, recommend, ask once).
FOUNDER: SANDBOX CREDENTIALS = none yet. No provider account exists.
FOUNDER: DOWNGRADE RULE = not decided (default: nothing is removed, only new creations are refused).
FOUNDER: GRACE PERIOD ON FAILED PAYMENT = not decided (default: 7 days).
LIVE CHARGING: out of reach in this sprint. No production provider account, no legal or accounting review yet. Everything is built and verified in sandbox or against a fake provider.
Staging database: hosted Supabase (Free) with the migrations up to 202610060004 as reported by the founder. Hosted Auth is on defaults.
This sprint is developed and verified on the local stack. Do not apply migrations, create secrets or change settings on the hosted project, on Vercel or on a payment provider; list them in the report as deploy steps for the founder.
```

Sprint 8 makes the MVP sellable. It was split in two because it is large and because one of its items (custom domains) cannot be verified without a domain. This first part is the money path: a workspace gets its plan from a subscription instead of from a manual SQL update. Billing is the first place where a bug costs a customer money or gives the product away for free, and where an outside party (the payment provider) writes to our state through an unauthenticated endpoint. A webhook processed twice, a plan that stays paid after a chargeback, or a downgrade that silently destroys an agency's pages would each be worse than not having billing at all.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. This session has no memory of earlier ones; everything you know comes from the repository. Your job is the **first half of Sprint 8**: the subscription model, the `PaymentsAdapter`, checkout, idempotent webhooks, payment-failure and cancellation handling, the billing area, the downgrade rules and the upgrade entry points. Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (continue from the last id in the file) or in the ADR (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; especially §5, §6, §8, §11, §13, §19–§22), `README.md`.
- `PLANO_DE_EXECUCAO.md`: **Sprint 8** and Sprint 9 (export, deletion and the authorization review must reach what you add). `PLANO_DE_NEGOCIO.md`: the pricing section and the plan table, the annual-discount rule and the legal notes.
- `BACKLOG.md` (Sprint 8 and the open decisions about downgrade), `docs/SPRINT_7_REPORT.md` ("Implicações para a Sprint 8", gaps and questions for the founder).
- `docs/adr/0004-tenancy-and-authorization.md` in full (`workspaces.plan_id` is not user-writable; billing changes it through a server-side, webhook-driven path; the three-agency-workspaces guard), ADR 0009 and ADR 0011 (the HMAC-attested pattern with a server secret mirrored in Supabase Vault, used when the server must write something a signed-in user must not be able to forge), ADR 0012 and ADR 0013 (what each limit does today when it is reached or lost).
- `docs/ARCHITECTURE.md` (the `billing` module and the `PaymentsAdapter` line), `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md` (the "Cobrança" row), `docs/OBSERVABILITY.md`, `docs/ENVIRONMENTS.md`, `docs/SUPABASE_CAPACITY.md`.
- `docs/ux/UX_DECISIONS.md` (UX-007 on showing a limit without a fake checkout, UX-018, UX-019, UX-069, UX-071), `docs/ux/CONTENT_GUIDE.md` (it currently says "no purchase button and no price on limit screens": this sprint changes that rule, so update it), `docs/ux/WIREFRAMES.md`, `docs/ux/DESIGN_TOKENS.md`.
- Code: `apps/web/src/lib/product.ts`, `apps/web/src/modules/entitlements/*` and its drift test, the `plans`, `plan_entitlements` and `workspaces` definitions and the entitlement helper functions in `supabase/migrations/202609250002_identity_tenancy.sql` plus every later migration that added an entitlement key, `apps/web/src/modules/identity/permissions.ts`, every screen that shows a limit today (page limit, seats, analytics periods, the report-links section), how the product badge is decided on the public page and on `/r/<token>`, the marketing home (`apps/web/src/app/(marketing)/home.tsx`, `HOME_COPY`), the two job routes under `/api/jobs/` and `apps/web/vercel.json`, `apps/web/src/proxy.ts`, and the pgTAP suites.
- Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills before writing any SQL or policy. For Next.js 16 route handlers, raw request bodies and caching, read the guides shipped in `node_modules/next/dist/docs/` instead of relying on memory. For the payment provider, use its current official documentation and say in the ADR which pages you read and on what date.

### Facts you must not get wrong

- **The plan comes from the subscription, and only the server changes it.** `workspaces.plan_id` has no column grant and no interface. After this sprint it changes through one audited server-side path driven by verified provider events. No client role may write a subscription or a plan, and the service role is not a shortcut for ordinary user actions.
- **Entitlements, never plan names.** Code asks "does this workspace have `shareable_reports`" or "what is `max_profiles`", not "is this Agency". Limits live in `plan_entitlements` and are mirrored by `lib/product.ts` with a drift test; a change to one changes both and the test.
- **Money is integer cents with an explicit currency.** `lib/product.ts` has monthly prices only. The acceptance criteria fix all four: Pro R$ 14,90/month or R$ 149/year; Agency R$ 57,90/month or R$ 579/year.
- **We never see card data.** Checkout happens on the provider's hosted page or component. We store provider identifiers and status. If the provider requires the customer's CPF or CNPJ, that is personal data with a purpose and a retention to document before collecting it.
- **A webhook is an unauthenticated public endpoint written to by a third party.** Verify the signature over the raw body before parsing anything, answer quickly, and treat every delivery as possibly duplicated, delayed, out of order or forged. Processing an event twice must change nothing the second time.
- **The provider is the source of truth for payment state; our tables are a copy.** Decide how the copy is repaired when a webhook is lost.
- **A subscription belongs to a workspace,** not to a person. Every profile belongs to a workspace, so does every subscription row, with the tenant relationship and indexes AGENTS.md §6 requires.
- **Downgrade preserves data.** Today, above a limit, nothing is removed: pages stay, members keep access, report links stop resolving and are kept. Whatever you decide, no downgrade, failed payment or cancellation deletes customer content.
- **Marketing describes what exists in the deployed product.** With no production provider account, nobody can actually pay. The home page says paid plans are "em breve" without prices; decide what it says after this sprint under each billing mode (D6), and do not present a sandbox checkout as a real offer.
- **`main` deploys to staging before the founder applies migrations and sets secrets.** Without the migration or without the provider secrets, the application behaves as it does today: no checkout button, the limit screens keep their current sentence, nothing errors.
- **The badge and the report footer follow `remove_badge`.** Find out where that is evaluated (at publish time into the snapshot, or at read time) and make sure a plan change reaches a page that is already published and cached, in both directions.
- **Local environment:** the founder has test accounts in the local database. Apply migrations with `supabase migration up`; do not run `npm run db:reset` without approval. Stay inside this repository: write temporary files only to the session scratchpad, and leave Docker containers of other projects alone. A provider sandbox cannot call `localhost`; do not install a tunnel. Local webhook verification is done by replaying signed payloads from a script.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build. `AGENTS.md` §22 gives the counts at the end of Sprint 7 (943 Vitest tests, 951 pgTAP assertions, 47 routes); later merges may have changed them, so run the suites before changing anything and use what you measure.

## 3. Goal and acceptance criteria

**Goal:** the owner of a workspace on the Free plan reaches a limit, sees what the paid plan gives and what it costs in reais, pays monthly or yearly on the provider's checkout, and comes back to a workspace that has the new limits, without anyone running SQL. When a payment fails, they get a defined period to fix it. When they cancel or downgrade, they are told beforehand exactly what stops working, and nothing they built is deleted.

| # | Criterion (`PLANO_DE_EXECUCAO.md`) | Required evidence |
|---|---|---|
| AC1 | Prices shown: R$ 14,90/month or R$ 149/year; R$ 57,90/month or R$ 579/year | One price catalogue in code (cents + currency + interval) that the plans screen, the checkout request and the tests all read; a Vitest test for the formatted values; a test that the amount sent to the provider is the catalogue amount and cannot be supplied by the browser |
| AC2 | Repeating a webhook creates no duplicate subscription or charge | pgTAP and Vitest: the same event delivered twice, and concurrently, leaves one subscription row, one plan change and one audit entry; an older event arriving after a newer one does not roll the state back; an event with a bad signature, a stale timestamp, an unknown subscription, or a workspace id that does not match the provider customer changes nothing; starting checkout twice for the same workspace does not create two live subscriptions |
| AC3 | Downgrade preserves data and says which capabilities will be blocked | A pure function that, given a workspace's current usage and a target plan, returns what stays, what is blocked and what stops working (pages above `max_profiles`, members and open invitations above `team_members`, report links, history beyond `analytics_days`, storage above `storage_mb`, the badge), with a Vitest table; the confirmation screen renders that list before the person confirms; pgTAP showing that after the plan change no page, member, lead, report link, media asset or aggregate row was deleted |
| AC4 | Failed payment has a defined, recoverable grace period | The state machine written out in the ADR and implemented as a pure transition function with a Vitest table covering every state and event; pgTAP for the plan held during grace, lost at the end of it, and restored when the payment is recovered inside and after the period; the clock is injected; the billing area and a banner say the state and the date in words |
| AC5 (carried) | Entitlements for Free, Pro and Agency; the badge follows the plan | The entitlement matrix in the ADR; the drift test green; a test that a plan change turns the badge on and off on an already-published page within the time the ADR states |

The two remaining Sprint 8 criteria (custom domain, pixels) belong to part 2. Do not start them.

## 4. Deliverables

### D1 — ADR 0014 (payment provider, subscription model and webhooks)

Confirm `0014` is the next free number. Decide, justify and record. Where a recommended default is given, you may choose differently if the code or the documents show a better option; say why.

- **Provider.** If §0 names one, use it and record why it fits. If it says "not decided": compare at least four providers that serve Brazilian merchants (for example Asaas, Pagar.me, Mercado Pago, Stripe) on recurring billing with monthly and yearly intervals, Pix and card for subscriptions (and what recurring Pix actually means at each), webhook signing and retry behaviour, sandbox quality, hosted checkout, customer self-service, what the merchant account requires (CPF or CNPJ, a website, a live domain), fees, payout, chargeback handling, reconciliation, and exit cost. State what you could not confirm. Give one recommendation, post it in a progress message, and carry on with every deliverable that does not depend on the provider (the model, the state machine, the fake adapter, the screens). Come back to the real adapter last; if the founder has not answered by then, stop and ask (§9).
- **`PaymentsAdapter`.** A narrow interface in domain terms (start checkout for a workspace, plan and interval; fetch a subscription; cancel at period end; resume; change plan; open the provider's self-service page if there is one; verify and parse a webhook into our own event type). No provider type leaks past the adapter. A deterministic fake adapter implements the same interface for tests and for the local stack. Prefer `fetch` to a vendor SDK; a new runtime dependency needs the justification AGENTS.md §16 asks for.
- **Data model.** A provider-customer mapping per workspace, the subscription (plan, interval, status, current period end, cancel-at-period-end, grace deadline, provider ids), the processed-event ledger that makes webhooks idempotent, and the minimum of invoice data for the history screen (decide whether to store it or read it from the provider on demand; recommended: store id, amount in cents, currency, status, paid date and the provider's hosted receipt link, nothing else). RLS on all of it; which role reads what; no client role writes.
- **State machine.** States (recommended: none, incomplete, active, past_due inside grace, canceled-effective-at-period-end, ended) and the event that causes each transition, including refund, chargeback, a yearly renewal, and a provider subscription deleted from the provider's dashboard. Which states grant the paid entitlements. Grace period: 7 days by default unless §0 says otherwise.
- **How the plan changes.** The single path from a verified event to `workspaces.plan_id`, in one transaction with the subscription row, the event ledger and the audit entry. Which credential that path uses and why (the Vault-mirrored HMAC pattern from ADR 0009 and ADR 0011 is the precedent for a server-attested write through a `security definer` RPC; compare it with a secret-key path and choose).
- **Ordering, replay and repair.** How out-of-order events are handled (recommended: on each event, fetch the subscription from the provider and write what the provider says now, rather than trusting the payload's order). The reconciliation job that repairs a lost webhook, its schedule and its bound per run. Check the Vercel plan's cron limit before adding a third cron; if it does not fit, fold it into an existing job route and say so.
- **Plan changes.** Upgrade (recommended: immediate), downgrade and cancellation (recommended: effective at the end of the paid period), monthly to yearly, and what the provider does about proration. Which plans a personal workspace and an agency workspace may buy. What happens to UX-018 (three agency workspaces per person) now that plans are paid.
- **Downgrade rules.** For each entitlement, what happens to existing things above the new limit. Default unless §0 says otherwise: nothing is removed; new creations are refused; report links stop resolving and return if the entitlement returns; history shortens; pages above `max_profiles` stay published. State explicitly whether anything else is blocked (for example publishing while above the page limit) and why.
- **Billing mode.** A server-only setting with three values (recommended: off, sandbox, live). Off is today's behaviour and is the default when a secret or the migration is missing. Sandbox shows checkout to the founder's test accounts and marks every billing screen as a test environment. Live cannot be reached without the production secrets. What the marketing home says in each mode.
- **Roles.** Recommended: only the owner starts checkout, changes plan and cancels; admins see the plan and its limits; editors see nothing about payment. Add the actions to the permission matrix on the server and in the database.
- **Consumer and tax notes for the reviewers.** List what the legal and accounting review must settle before live charging (right of withdrawal for online purchases, cancellation by the same channel as purchase, invoices/nota fiscal, what the receipt must show). Do not implement legal conclusions on your own; list them.

### D2 — Database (forward-only migrations + pgTAP)

- The tables in D1 with RLS, foreign-key and lookup indexes, constraints for the invariants (one live subscription per workspace, valid status values, cents non-negative, currency present).
- The plan-change function and the read functions the billing area needs.
- Annual prices and anything else the catalogue needs, mirrored by `lib/product.ts` and the drift test.
- New audit actions in a separate enum migration, following the earlier sprints.
- pgTAP, at minimum: every AC2 case; every AC4 transition; AC3 (nothing deleted); `anon`, an editor, an admin, the owner and a member of another workspace against each read and each action; a client role cannot insert, update or delete a subscription, an event or an invoice, and cannot change `plan_id`; a forged or unsigned server call is refused; an event for workspace A never changes workspace B; the entitlement helpers return the new plan's values immediately after the change.
- Regenerate `apps/web/src/lib/database.types.ts` (`npm run db:types`). Run the Supabase advisors on the local stack and fix what they report.

### D3 — Pure modules and server code (`modules/billing/`)

- The price catalogue, the state-transition function, the grace-period arithmetic with an injected clock, the downgrade-impact function (AC3), the mapping from provider events to domain events, and the mapping from every outcome to one user-facing state.
- The webhook Route Handler: raw body, signature and timestamp check, size cap, quick acknowledgement, idempotent processing, structured logs with a correlation id and outcome and never a payload, a token or a tax id. The checkout and plan-change Server Actions: input validated at the boundary, role checked on the server, the amount taken from the catalogue. The reconciliation job behind `CRON_SECRET`, like the existing jobs.
- The real provider adapter, last, and only for an approved provider (§9).
- Any new top-level route segment goes into `reserved_slugs` (migration and TypeScript list). Routes under `/api/` and `/app/` are already covered; verify rather than assume.
- Vitest tables for all of it, and a contract test that runs the same cases against the fake adapter and, from recorded sandbox fixtures with secrets and personal data removed, against the real one.

### D4 — Plans, checkout and the billing area (pt-BR, mobile-first)

- A plans screen inside the workspace: the three plans, what each includes (generated from the entitlements, not typed by hand), monthly and yearly prices with the yearly saving stated in reais, the current plan marked, and one action per plan.
- Checkout hand-off and return: success, pending (Pix or boleto not yet paid, if the provider has such a state), cancelled by the person, and failure. The return page must not grant anything by itself; it shows what the database says and, while the webhook has not arrived, a waiting state that resolves without a manual reload trick and without wall-clock promises.
- The billing area: plan, interval, status in words, next charge date and amount, payment history with a link to the provider's receipt, change plan, cancel, resume. A banner across the workspace while a payment is failing, with the date access changes and the way to fix it.
- The downgrade and cancellation confirmation, listing what stops working for this workspace with its real numbers ("3 de 10 páginas ficam acima do limite").
- Every state: loading, empty (never subscribed), error, permission denied for each role, billing mode off, and sandbox marking.
- 44 px targets, visible focus, no state carried by colour alone, `prefers-reduced-motion`, WCAG 2.2 AA. These screens wear the product look already in `globals.css` (`ui-*` classes); do not introduce a new visual language.

### D5 — Upgrade entry points and the badge

- Each place that shows a limit today (page limit, duplicate refused, seats and invitations, analytics periods not covered, the report-links section, storage) gets a link to the plans screen for the roles that can act on it, and keeps its current sentence for the others and when billing mode is off.
- The badge on the public page and the footer of `/r/<token>` change with the plan as the ADR states, including for a page published before the change.

### D6 — Marketing home

Update `HOME_COPY` so that what it says about paid plans is true in each billing mode. In sandbox and off it must not offer something a visitor cannot buy.

### D7 — Tests and verification scripts

Vitest and pgTAP as above. A script kept under `apps/web/scripts/`, in the manner of `analytics-accuracy.mjs`, that drives a full life cycle on the local stack with the fake adapter and signed webhook payloads: subscribe, renew, fail a payment, recover, fail again and let grace end, resubscribe, upgrade, downgrade, cancel, a duplicate delivery and an out-of-order delivery at each step. It uses accounts under `example.test`, never the founder's, and says how to remove what it created. Every deterministic bug found on the way gets a regression test.

### D8 — Documentation and the part 1 report

- `docs/adr/0014-*.md`. Update ADR 0004, 0012 and 0013 where their "Sprint 8 decides" notes are now resolved, and `docs/ARCHITECTURE.md`.
- `docs/THREAT_MODEL.md`: forged, replayed and reordered webhooks; price or plan tampering from the browser; a checkout started for someone else's workspace; a success URL opened without paying; getting a paid plan and charging back; subscription state that outlives a deleted workspace; what stays exposed until the Sprint 9 rate limits.
- `docs/DATA_MAP.md`: every billing field, purpose, retention (including the fiscal retention question for the reviewers), the provider as a new subprocessor and any international transfer. Review the privacy notice under `apps/web/src/app/(marketing)/privacidade` so it stays true.
- `docs/OBSERVABILITY.md`: signals for webhook failures, signature rejections, events waiting too long, reconciliation corrections and subscriptions entering grace, each with an owner and an action. `docs/runbooks/BILLING.md`: "a customer paid and the plan did not change", "a webhook is failing", "refund or cancel by hand", "rotate the webhook secret", "the provider is down".
- `.env.example` with placeholders for every new variable. `docs/ENVIRONMENTS.md`: "Passos de deploy da Sprint 8 (parte 1)", ordered (provider sandbox account, migrations, Vault secret if used, Vercel variables, webhook URL registered at the provider pointing to staging, billing mode), what the application does between each step, and the end-to-end sandbox check the founder runs on staging. Replace the "Plano Agência em staging" SQL note with what is true now.
- `docs/ux/UX_DECISIONS.md`, `docs/ux/CONTENT_GUIDE.md` (billing vocabulary; the limit-screen rule).
- `BACKLOG.md`: check off only what is done and verified; add follow-ups.
- **`docs/SPRINT_8_REPORT.md`, marked "in progress, part 1 of 2",** following AGENTS.md §20 and the structure of `docs/SPRINT_7_REPORT.md`, with a "Handoff to part 2" section: what part 2 must know about the plan-change path, how an entitlement change reaches a published page, and anything left partial.
- Update `AGENTS.md` §22 to the real end state.

## 5. Out of scope

Custom domains, Meta Pixel and Google Analytics (part 2). Live charging and a production provider account. Buying or configuring the product domain. Extra-profile add-ons (the R$ 6,90 hypothesis), coupons, trials, referral credits, gift plans, per-seat pricing, usage-based billing, multiple currencies, split payments, a stored-value wallet, native checkout that touches card data, issuing nota fiscal, dunning e-mails (there is no mail adapter yet: state what the customer sees in the product instead), an admin back office, revenue dashboards, global rate limiting, CAPTCHA, account export and deletion execution (Sprint 9), block scheduling, a public API, staging provisioning.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken RLS, validation, signature checks or authorization to make a test pass.
- Secrets are server-only, never `NEXT_PUBLIC_`, never logged, never in fixtures. If a real key appears anywhere in the repository or in output, stop and report it.
- Migrations are forward-only and compatible with rolling the application back one version. No destructive changes.
- Preserve the behaviour of Sprints 0–7. A workspace with no subscription row behaves exactly as a Free workspace does today, and a workspace the founder moved to Agency by SQL keeps working: decide in the ADR how such a row is treated (recommended: a plan with no subscription is left alone and shown as "definido manualmente" to the owner) so the founder's test data is not downgraded by a reconciliation run.
- Don't touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px, about 768 px and desktop ≥1280 px for the plans screen, the billing area, the confirmation and the banner, in every state.
- Public-page performance is untouched: confirm the public route's client JS size did not change.
- With Docker and the local stack running, verify in a browser with the fake adapter: reach each limit as owner, admin and editor and follow the upgrade link; subscribe monthly and yearly; see the plan and the limits change without reloading tricks; create the second page that was refused before; fail a payment and see the banner; recover; let grace end and see what is blocked and that everything is still there; cancel and see access hold until the period end; downgrade Agency to Pro with 3 pages, 2 members and an active report link and compare the confirmation list with what actually happens; replay a webhook by hand; call each action directly as an editor and as a member of another workspace; run the application against a database without the migration and with billing mode off. If a real sandbox was approved and credentials were provided, also run the adapter's contract test against it. Anything that could not be done is marked *prepared*, not verified.

## 8. Work order

1. **Read and verify the starting point:** read §2, inspect the git state, create `feat/sprint-8-billing` from `main`, run `npm run test:db` and `npm run check` before changing anything. If either fails, fix that first and record what was wrong. Summarize the plan, the schema drafts, the risks and how each criterion will be evidenced.
2. **Provider comparison and ADR 0014;** post the recommendation.
3. **Pure modules + Vitest** (catalogue, state machine, grace, downgrade impact, fake adapter).
4. **Migrations + pgTAP;** iterate until `npm run test:db` passes; regenerate types; run advisors.
5. **Webhook route, plan-change path, reconciliation job, the life-cycle script.**
6. **Plans screen, checkout hand-off and return, billing area, banner, confirmation.**
7. **Upgrade entry points, badge, marketing home.**
8. **The real provider adapter** (only with approval and sandbox credentials) and its contract test.
9. **Browser verification** in §7 and the review of the permission matrix.
10. **Docs, runbook, privacy review, backlog, the part 1 report, `AGENTS.md` §22.**
11. **Final gate:** review the full branch diff against `main` for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit along the way in coherent Conventional Commits (for example `feat(db): add subscriptions and the idempotent event ledger`, `feat(billing): add the payments adapter and webhook processing`, `feat(billing): add plans, checkout and the billing area`).

**If this part is at risk of overrunning,** cut in this order and record each cut in the report: the stored payment history (link to the provider instead); changing between monthly and yearly on an existing subscription; resume after cancel; the marketing home change beyond keeping it true; the real provider adapter (leave the fake verified and the real one not started, and say so). Do not cut signature verification, idempotency, the single audited plan-change path, tenant isolation, the grace period, data preservation on downgrade, the downgrade confirmation list, server-side authorization, the fail-safe when billing is off, accessibility, or the report.

## 9. Stop and ask for approval before

- committing to a payment provider, creating an account at one, or writing code against one the founder has not approved;
- applying migrations, creating secrets, registering webhooks, changing settings or creating anything on a **hosted** Supabase project, on Vercel or at a provider (including through MCP tools); use the local stack only;
- anything that could move real money, including "small test charges";
- running `npm run db:reset` or anything else that deletes local data;
- adding any paid service, vendor, subprocessor, tunnel or runtime dependency not justified in ADR 0014;
- any destructive migration or data loss, including removing pages, members or links on downgrade;
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- writing or deleting anything outside this repository;
- expanding scope beyond §4, or cutting an item that is not in the §8 cut list.

## 10. Final response format

1. Outcome of this part in 3–5 sentences, including plainly whether a real provider was integrated or only the fake.
2. Acceptance-criteria table (status: implemented / verified / prepared / partial / blocked / not started, with evidence).
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), advisors, build (routes), and the life-cycle script's output summary.
5. Security negative cases tested (forged, replayed, reordered and cross-workspace events; price tampering; each role against each action; `anon`; the success URL without payment; client writes to billing tables).
6. Decisions awaiting founder confirmation (provider, grace period, downgrade rules, roles, billing modes, the new UX ids), the list for the legal and accounting review, and any item cut.
7. Ordered staging deploy steps for the founder, what needs the product domain or a production account before live charging, blockers, and the starting point for part 2.
