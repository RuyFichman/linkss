# ADR 0014 — Payment provider, subscription model and webhooks

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation). **The provider (Stripe) was chosen by the founder on 2026-10-09.** Nothing here has run against a real Stripe account: no account exists yet.
- **Date:** 2026-10-09
- **Sprint:** 8, part 1 of 2 (custom domains and pixels are part 2)
- **Builds on:** ADR 0004 (tenancy; `workspaces.plan_id` is not user-writable), ADR 0009 and ADR 0011 (server attestation with a secret mirrored in Supabase Vault; the job pattern), ADR 0012 and ADR 0013 (what each limit does when it is reached or lost)

## Context

Until now a workspace's plan changed only by a manual SQL update. This part makes the plan follow a subscription. Billing is the first place where a bug costs a customer money or gives the product away, and where an outside party writes to our state through an unauthenticated endpoint. The failures that matter: a webhook processed twice, a plan that stays paid after a chargeback, a downgrade that destroys an agency's pages, a browser that chooses its own price.

Constraints: no provider account exists and none may be created in this sprint; a provider sandbox cannot call `localhost` and no tunnel may be installed; `main` deploys to staging before the founder applies migrations and sets secrets; there is no mail adapter; live charging is out of reach until the legal and accounting review.

## Decision

### Provider: Stripe

The founder chose Stripe. Why it fits what this sprint needs:

- **Recurring billing with monthly and yearly intervals** is the core product (Stripe Billing), with a hosted checkout in pt-BR and BRL, so card data never touches the product.
- **Webhooks are signed** (HMAC-SHA256 over `<timestamp>.<raw body>`, 5-minute tolerance in Stripe's libraries) and **retried** for up to three days in live mode; Stripe states that delivery order is not guaranteed and that the same event can arrive more than once, which is exactly what the design below assumes.
- **A customer portal** exists for the card and the receipts, so the product builds neither.
- **The API is plain HTTPS with idempotency keys**, so no SDK is needed (below).
- **Exit cost is bounded** by the `PaymentsAdapter`: nothing outside one file knows a Stripe name.

What the founder must know about this choice (read in Stripe's documentation on 2026-10-09):

- **No recurring Pix with a Brazilian Stripe account.** "Stripe accounts in Brazil can accept one-time Pix payments with settlement in BRL. Pix Automático is not available in Brazil." Subscriptions through Stripe in Brazil are therefore paid by **card** (boleto may be possible; not confirmed). The business plan lists Pix as a local differentiator for the *product's pages*, not for our own billing, so this does not contradict it, but it is a real limit of the choice.
- A subscription whose first payment does not complete stays `incomplete` for 23 hours and then expires; it never grants a plan here.

Pages read (all on 2026-10-09): `docs.stripe.com/webhooks` (signature scheme, tolerance, retries, ordering, duplicates), `docs.stripe.com/payments/pix` (recurring support, account countries), `docs.stripe.com/api/checkout/sessions/create` (parameters, `locale` values including `pt-BR`), `docs.stripe.com/api/subscriptions/object` (statuses, `cancel_at_period_end`, the period on the item), `docs.stripe.com/api/versioning` (current version `2026-09-30.endive`).

**Not confirmed, and to be checked when the account is opened:** what Stripe requires to open a Brazilian merchant account (CPF or CNPJ, a website, a live domain); fees and payout schedule; boleto for subscriptions; how the portal behaves for a subscription built from inline prices; the exact shape of every object in a real sandbox (see "What is verified" below).

**Alternatives not chosen.** The prompt asked for a comparison when no provider was named; one was named, so no fresh research was done on the others. From general knowledge, **not checked against current documentation**: Asaas, Pagar.me and Mercado Pago are Brazilian providers with recurring billing, card and boleto, and each has some form of recurring Pix; they differ in webhook signing (some authenticate with a shared token rather than a signature over the body), sandbox quality and hosted checkout. If recurring Pix for our own billing becomes a requirement, that comparison has to be done properly; the adapter is what makes the switch a contained change.

### `PaymentsAdapter`

`modules/billing/adapter.ts`, in the product's terms: create the provider customer of a workspace; start a hosted checkout; fetch a subscription; find a customer's latest subscription; list invoices; find the customer of a charge; cancel at period end; resume; change plan; cancel now; open the provider's self-service page; verify a webhook and reduce it to `{id, topic, customerId, subscriptionId, chargeId}`.

- **No provider type crosses the file.** Stripe's eight subscription statuses are reduced to four inside the adapter (table below). The adapter never decides what a workspace is entitled to.
- **Two implementations:** `stripe-adapter.ts` and `fake-adapter.ts` (deterministic, in memory, with the provider's side as methods: a customer pays, a card fails, a period ends). One contract test runs the same cases against both.
- **No SDK, no new dependency.** The Stripe adapter is `fetch` against ten endpoints with form encoding, the pinned header `Stripe-Version: 2026-09-30.endive`, an 8-second timeout and `Idempotency-Key` where a retry could create something twice. Stripe's Node SDK would add a runtime dependency for types the adapter deliberately does not expose. Errors leave the adapter as three kinds (`unavailable`, `rejected`, `not_found`) plus Stripe's machine-readable code; never its message, which can quote input.
- **Prices are built inline from the catalogue.** Checkout and plan changes send `price_data` (currency, amount, interval) with a product per plan whose id the product chooses (`lnk_plan_<plan>`, created on first use). There is no price id to configure and nothing to drift.

| Stripe status | Product status | Why |
|---|---|---|
| `incomplete` | `incomplete` | first payment not confirmed: grants nothing |
| `incomplete_expired`, `canceled` | `ended` | terminal |
| `active`, `trialing` | `active` | the product offers no trial; our checkout cannot produce `trialing` |
| `past_due`, `unpaid`, `paused` | `past_due` | payment is missing; our grace clock decides, not Stripe's retry schedule |

### Data model

| Table | Holds | Read by | Written by |
|---|---|---|---|
| `plan_prices` | plan, interval, amount in cents, currency; unique on (interval, amount, currency) | signed-in people | migration |
| `billing_customers` | workspace → provider customer id (one per workspace; a customer belongs to one workspace) | the owner | `register_billing_customer` (owner + server signature) |
| `billing_subscriptions` | copy of the provider's subscription: plan, interval, amount, status, period end, cancel-at-period-end, `grace_until`, `grace_expired_at`, `held_plan_id` / `held_until`, `granted_plan_id`, `observed_at` | owner and admin | `private.apply_billing_snapshot`, the maintenance function |
| `billing_events` | processed-event ledger: provider event id (primary key), reason, outcome, times. Never a payload | no client role | the same |
| `billing_invoices` | invoice id, amount in cents, currency, status, issued and paid dates, the provider's hosted receipt link (https only). Nothing else | the owner | the same |

RLS is enabled on all five; no client role can insert, update or delete in any of them; `billing_events` has no policy at all. Constraints: at most one paying subscription per workspace (partial unique index on `status in ('active','past_due')`), amounts positive, currency `BRL`, status and outcome from closed lists. Foreign keys cascade from the workspace; the ledger has none, so it neither blocks nor vanishes with a purge.

**Invoices are stored** (id, amount, currency, status, dates, receipt link), not read on demand: the history screen then costs no provider call and works when the provider is down.

**Card data, tax ids and addresses are never stored or requested by the product.** If Stripe's checkout collects a CPF or CNPJ, it stays at Stripe.

### State machine

States: none (no row), `incomplete`, `active`, `past_due`, `ended`. "Cancelled, effective at period end" is `active` with `cancel_at_period_end`; "downgraded, effective at period end" is `active` with a held plan. The transition is "stored row + what the provider says now → next row" (`transition` in `modules/billing/subscription.ts`, mirrored by `private.apply_billing_snapshot`; a Vitest table covers every pair of states and pgTAP runs the same life with an injected clock).

| What happened at the provider | Next state | Paid plan |
|---|---|---|
| Checkout finished, first payment pending | `incomplete` | no |
| First payment confirmed; any later successful charge; a yearly renewal | `active` (a renewal only moves the period end) | yes |
| A charge fails | `past_due`; `grace_until` = first sight of the failure + 7 days; later failed attempts do not restart it | yes, until `grace_until` |
| The failed charge is paid, inside or after the grace period | `active`, grace cleared | yes (restored if it had been lost) |
| The grace deadline passes with no payment (no event: the clock) | stays `past_due`, `grace_expired_at` set by the job | **no** |
| The owner cancels | `active` + `cancel_at_period_end` | yes, until the period ends |
| The owner resumes | `active` | yes |
| The paid period ends on a cancelled subscription; the provider gives up after its retries; somebody deletes the subscription in the provider's dashboard | `ended` (terminal: a later observation never revives it) | no |
| A chargeback (dispute) | the product cancels the subscription at the provider at once → `ended` | no |
| A refund | no transition by itself (the invoice history is updated). Refund and cancellation are done together by hand (runbook) | unchanged |
| Upgrade (a more expensive price) | `active`, new plan at once | the new plan |
| Downgrade to a cheaper paid plan | `active`, the cheaper price; `held_plan_id` keeps the plan already paid for until `held_until` (the paid period's end) | the old plan until then |

**Grace period: 7 days** (*provisional*, the default the founder left). It ends at the first run of the daily job after the deadline, so up to a day later, always in the customer's favour. Stripe's own retry schedule and what it does when retries are exhausted are dashboard settings (deploy steps); the product does not depend on them.

### How the plan changes: one attested path

```text
provider event / owner action / daily job
        │  (never trusted for state: it only says "look again")
        ▼
server reads the provider NOW (adapter) ──► serializes a snapshot ──► signs it (HMAC-SHA256, BILLING_SIGNING_SECRET)
        ▼
public.apply_billing_snapshot(payload, signature)      [anon may call; the signature authorizes]
        │  verifies the signature with the Vault secret `billing_signing_secret`
        ▼
private.apply_billing_snapshot(json, now)
   1. shape check (closed lists, patterns); a snapshot not about "now" (±15 min) is not processed
   2. insert into the ledger by event id ── conflict ──► "duplicate", nothing else happens
   3. customer → workspace (billing_customers); the workspace id the provider stored must match
   4. lock the workspace row; plan := plan_prices row for the amount, currency and interval CHARGED
   5. older than the stored observation ──► "stale"; ended ──► terminal
   6. write the subscription row; audit `billing.subscription_changed` if it changed
   7. private.billing_sync_plan ──► workspaces.plan_id; audit `billing.plan_changed {from, to, reason}`
   8. upsert invoices; record the outcome in the ledger
```

All of it is one transaction. `private.billing_sync_plan` is the only statement in the codebase that writes `workspaces.plan_id`.

**Credential: the Vault-mirrored HMAC, not the secret key.** Compared:

| | Signed snapshot through an anon-callable RPC (chosen) | Secret key from the webhook route |
|---|---|---|
| What a leak of the credential allows | forging plan changes (free plans for the attacker); no read of anything | everything: RLS is bypassed for every table |
| Key that bypasses RLS in a public, unauthenticated request path | no | yes |
| Owner actions (a signed-in user must write something they cannot forge: which provider customer is theirs) | same mechanism, with the user's session: no service key for a user action (AGENTS.md §11) | would need the service key for a user action, or a second mechanism |
| Deploy steps | one more secret, in two places | none |

The secret attests; it grants no access to data. The daily job uses the secret key only to call the maintenance function, like the other jobs; the snapshots it produces still go through the signed door.

**The plan granted is derived from the charge.** `plan_prices` is unique on (interval, amount, currency), so the amount Stripe reports identifies one plan. Metadata naming a plan is never read. An amount that is not a catalogue price grants nothing (`price_mismatch`, logged as an error). The amount sent to Stripe comes from `modules/billing/catalog.ts`; `plan_prices` mirrors it and a drift test compares the two.

**A plan set by hand is left alone.** A subscription only takes a plan away if it was the one that granted it (`granted_plan_id`). A workspace the founder moved to Agency by SQL keeps working, is shown as "definido manualmente", and is never touched by the job. If its owner subscribes, the subscription then decides.

### Ordering, replay and repair

- **Ordering.** A delivery is a hint. The handler fetches the subscription from Stripe and writes what Stripe says *now*, so an old event arriving late writes current state. Two handlers racing are ordered by `observed_at` (the server's clock when it read Stripe): a strictly older observation is `stale`.
- **Replay.** The ledger's primary key is the provider's event id. A second delivery, concurrent or later, finds the row and changes nothing. A captured signed *snapshot* cannot be replayed either: it is refused once it is 15 minutes old, and its event id is in the ledger.
- **Answering.** The route verifies the signature over the raw body, then works synchronously with bounded calls (8 s per provider call, 6 s for the database) and answers the status alone: 200 done, 400 not valid, 503 try again. It does not acknowledge first and work later: if the work fails, Stripe must retry, and an early 200 would lose the event. *Provisional*: Stripe's guidance is to acknowledge quickly and queue; with no queue (an extraction signal, not an MVP need) a bounded synchronous handler plus the daily repair is the simpler correct choice.
- **Repair.** `/api/jobs/billing` (third Vercel Cron, 05:00 UTC; the Hobby plan allows 100 crons, each at most daily, checked for ADR 0011 on 2026-10-02) calls `run_billing_maintenance`, which (a) ends grace periods and held periods that are over, (b) purges the ledger after 90 days, and (c) returns up to 50 subscriptions that are not over and were not read for 20 hours, plus the customers of workspaces that started a checkout in the last three days and have no paying subscription on record (a subscription whose first webhook never arrived has no row to read again); the job reads each at Stripe and applies a snapshot. A lost webhook is therefore corrected within about a day, and the job logs `corrected` so a lost webhook is visible.
- **A second paying subscription** for a workspace that has one (two checkouts opened and both paid) is never stored as live (`conflict`); the handler cancels it at Stripe and logs an error. It is then recorded as `ended` with its payment in the history. **The refund is manual** (runbook).

### Checkout

- The Server Action takes a workspace, a plan and an interval. It checks the owner role, validates the plan against the catalogue, asks the database (`begin_billing_checkout`: owner, writable workspace, plan for sale, no paying subscription, at most 10 checkouts per hour, audit entry) and opens the hosted checkout. Nothing the browser sends can become an amount.
- **Double start.** The idempotency key is a hash of (workspace, plan, interval, how many subscriptions the workspace has had, a 10-minute bucket): a double click or two tabs get the same checkout; a new attempt after a subscription (paid, pending or ended) gets a new one.
- **The return page grants nothing.** It renders what the database holds; "success" in the address is ignored. While no snapshot has arrived it shows a waiting state and asks the server again every 3 seconds (40 times), then says the confirmation has not arrived yet and that the plan changes by itself. Opening the success address without paying shows that waiting state.

### Plan changes

- **Upgrade: immediate.** Stripe invoices the prorated difference now (`proration_behavior=always_invoice`); the action then reads Stripe and applies the snapshot, so the screen changes without waiting for the webhook.
- **Downgrade to a cheaper paid plan: at the end of the paid period.** The price changes at Stripe with no proration (no credit, no charge); the database keeps the plan already paid for until the period ends, then the job applies the cheaper plan.
- **Cancellation: at the end of the paid period**, reversible until then ("manter a assinatura"). Allowed in a suspended workspace: stopping a charge is never blocked.
- **Monthly ↔ yearly on a running subscription: cut** (second item of the cut list). The person cancels and subscribes again at the end of the period; the screen says so.
- **Who may buy what** (*provisional*): any workspace, personal or agency, may buy either paid plan. The plan table describes plans by what they give, not by who may hold them.
- **UX-018 (three agency workspaces per person) is kept** (*provisional*): every workspace still starts on the free plan, so the guard still stops free pages from being multiplied. Each workspace is billed separately.
- **Deleting a workspace that is being charged is refused** (`LK102`) until its subscription is cancelled; otherwise the subscription would outlive it.

### Downgrade rules

Default left by the founder, kept: **nothing is removed.**

| Entitlement | Existing things above the new value |
|---|---|
| `max_profiles` | every page stays, published and editable; creating and duplicating are refused |
| `team_members` | everyone keeps access; inviting is refused; a pending invitation beyond the limit cannot be accepted |
| `storage_mb` | images stay; uploads are refused until usage is under the limit |
| `analytics_days` | dashboards and reports show fewer days; the stored 100 days are kept and return with the plan |
| `shareable_reports` | links stop resolving and are kept; they resolve again if the entitlement returns |
| `remove_badge` | the badge returns on public pages and reports |

**Nothing else is blocked.** In particular publishing stays allowed above the page limit: blocking it would stop an agency from fixing a client's live page because of a billing state. `downgradeImpact` (pure, tested) turns a workspace's usage and a target plan into this list with the real numbers; the confirmation screen renders it before the button.

### The badge and already-published pages (AC5)

`remove_badge` is evaluated **at read time** by `get_public_page` and `get_shared_report`, not stored in the snapshot. The report is dynamic, so it follows the plan on the next request. The public page is ISR: when a snapshot or the job changes a plan, the database returns the addresses of the workspace's pages on the air and the handler drops their cached copies (`revalidatePublicPage`). **Stated time: at once when the change arrives through the webhook, an owner action or the job; at most the 60-second ISR window otherwise.**

### Billing mode

`BILLING_MODE`, server-only, resolved by `modules/billing/mode.ts`:

| Mode | Needs | What the product does | Marketing home |
|---|---|---|---|
| `off` (default) | nothing | exactly what it did before: no checkout button, limit screens keep their sentence, the webhook answers 503, the job still runs the clock | paid plans "em breve", no prices |
| `sandbox` | a Stripe **test** key, the webhook secret, the signing secret | checkout is offered; every billing screen says "Ambiente de teste" | the same as `off`: a test checkout is not an offer |
| `live` | a Stripe **live** key, the same secrets, an https application address | real charges | prices and a call to action |

The mode asked for and the kind of key must agree: a live key under `sandbox` or a test key under `live` resolves to `off`, so a mistake can neither charge real money in a test environment nor present a test checkout as a real offer. `STRIPE_API_BASE_URL` is honoured only in `sandbox` and only for a loopback address (the local emulator). Missing migration or missing secret: `off`, nothing errors.

### Roles

| Action | owner | admin | editor | Enforced by |
|---|:-:|:-:|:-:|---|
| `billing.view` (plan, its state, the banner) | ✓ | ✓ | – | page guard; RLS on `billing_subscriptions` |
| payment history, provider customer | ✓ | – | – | RLS on `billing_invoices`, `billing_customers` |
| `billing.manage` (checkout, change plan, cancel, resume, provider's page) | ✓ | – | – | service guard; `private.require_billing_owner` in every RPC |

*Provisional.* An editor sees nothing about payment: no tab, no banner, no link from a limit screen.

### AC1 of the sprint plan: server-side authorization of every surface

| Surface | owner | admin | editor | member of another workspace | `anon` | Check |
|---|---|---|---|---|---|---|
| Page `/app/w/[id]/plano` | full | plan and state, no history, no action | told who can; no price | not found | sign-in | life-cycle script |
| Page `…/plano/confirmar` | ✓ | told who can | told who can | not found | sign-in | life-cycle script |
| Action `startCheckoutAction` → `begin_billing_checkout`, `register_billing_customer` | ✓ | forbidden (`42501`) | forbidden | not found (`P0002`) | no execute | Vitest `service.test.ts`; pgTAP 170; the owner's form replayed with each session |
| Actions cancel / resume / change plan → `begin_billing_change` | ✓ | forbidden | forbidden | not found | no execute | same |
| Tables `billing_*` (select) | per the data model | subscriptions only | nothing | nothing | no privilege | pgTAP 170 |
| Tables `billing_*`, `workspaces.plan_id` (write) | refused | refused | refused | refused | refused | pgTAP 170; direct calls in the script |
| `public.apply_billing_snapshot` | signature only | | | | | pgTAP 170: unsigned, wrong signature |
| `POST /api/billing/webhook` | provider signature only | | | | | Vitest `route.test.ts`; script |
| `/api/jobs/billing` | `CRON_SECRET` only | | | | | Vitest `route.test.ts` |

### Fail-safe before the migration and the secrets

`main` deploys first. Without the migration: the plan screen says the area is not available yet, every limit screen is unchanged, the banner renders nothing, the webhook answers 503, the job answers 503 `not_deployed`. With the migration but without secrets (mode `off`): the plan screen shows the plan and the catalogue and offers nothing. The deploy order in `docs/ENVIRONMENTS.md` is safe in any order.

### Error contract (extends ADR 0004)

`LK100` the workspace already has a paying subscription; `LK101` too many checkouts; `LK102` the workspace is still being charged; `LK103` the change does not fit the subscription (detail `none`, `already`, `state`, `same`); `22023` (detail `plan`, `kind`, `customer`) invalid input; `LK060` invalid or missing server signature (detail `not_configured` when the Vault secret is absent). `apply_billing_snapshot` never raises for bad input: it answers a status.

### Audit

`billing.checkout_started` (plan, interval), `billing.change_requested` (kind, plan), `billing.subscription_changed` (statuses, plans, interval, flag, reason), `billing.plan_changed` (`from`, `to`, `reason`). The last two have no person as actor when they come from the provider or the clock. No entry holds a provider id, an amount, or anything about a payment method.

## What is verified, and what is not

- **Verified on the local stack:** the database path (pgTAP 170), the pure rules (Vitest), the adapter contract against the fake and against a local emulator of Stripe's API, and the whole life cycle against the production build with the real adapter, webhook route, Server Actions and database (`apps/web/scripts/billing-lifecycle.mjs`).
- **Not verified:** anything against Stripe itself. The emulator (`modules/billing/testing/stripe-emulator.ts`) is written from Stripe's documentation, not recorded from Stripe. It proves the product agrees with our reading of that documentation. **No recorded sandbox fixture exists**; the contract test says so. The first task after the founder opens a sandbox account is to run the deploy steps on staging and compare.
- **Deviation from the prompt's recommendation:** it suggested a fake adapter for the local stack. A fake inside the application needs a fake checkout page and a control endpoint, that is, test hooks in production code. Instead the local stack runs the real adapter against an emulator that lives in the test tree and in a script; the only production concession is `STRIPE_API_BASE_URL`, loopback-only and sandbox-only.

## For the legal and accounting review (nothing below is implemented as a conclusion)

1. **Right of withdrawal** for purchases made online (CDC art. 49, seven days): whether and how it applies to a subscription that starts at once, and what the refund procedure is.
2. **Cancellation by the same channel as the purchase** and with the same ease: the product cancels in the same screen; confirm it is sufficient and what must be said.
3. **Renewal:** what must be told before an automatic renewal, especially the yearly one, and how far in advance. There is no e-mail today.
4. **Nota fiscal de serviço:** obligation, municipality, and who issues it (the product issues nothing).
5. **What the receipt must show** and whether Stripe's receipt is enough.
6. **Fiscal retention** of invoice data versus the deletion of a workspace (today invoices are deleted with the workspace).
7. **Chargebacks and non-payment:** whether ending access at once on a dispute, and after 7 days on non-payment, is acceptable, and what notice is due.
8. **Price display:** total price, taxes included or not, and the yearly "saving" statement.
9. **Stripe as a subprocessor** and the international transfer of the payer's data (`docs/DATA_MAP.md`).
10. **Terms of service** covering plans, limits after a downgrade, and suspension.

## Alternatives considered

- **Trusting the webhook payload** and ordering events by `created`: Stripe says not to; a late event would roll the state back.
- **Acknowledging first and processing after the response** (as analytics does): a failed write after a 200 is a lost event; billing needs the retry.
- **A plan column on the subscription named by metadata:** a checkout tampered with at the provider, or a mistake in the dashboard, would grant a plan that was not paid for.
- **Price ids configured per environment:** four values to keep in sync with the catalogue in every environment, for no gain over inline prices.
- **Subscription schedules for a downgrade at period end:** the right Stripe feature, and a much larger surface (phases, releases). The held plan in our own table gives the same result for the one case we sell.
- **Removing or unpublishing pages above the limit on downgrade:** forbidden by the founder's default and by AC3.
- **Blocking the workspace when a payment fails:** the grace period exists precisely so an expired card does not take a client's page out of the agency's hands.
- **A fake adapter inside the application for the local stack:** discussed above.

## Consequences

- Deploying needs, in order: a Stripe sandbox account, the migrations, the Vault secret, five Vercel variables, the webhook endpoint registered at Stripe, then `BILLING_MODE=sandbox`. Until all are present the product behaves as before.
- Adding a plan or changing a price means changing `lib/product.ts`, the `plan_prices` and `plan_entitlements` seeds (a new migration) and nothing else; the drift tests fail otherwise. Existing subscriptions keep paying their old amount, which would then be a `price_mismatch`: **a price change needs a migration plan for running subscriptions**, not designed here.
- The state machine exists twice (TypeScript for the screens, SQL for the truth). They change together; the Vitest table and pgTAP 170 share the cases.
- Dunning is on screen only (the banner and the billing area): there is no mail adapter. A customer who does not open the product learns of a failed payment from Stripe's own e-mails, if the founder enables them.
- Part 2 (custom domains, pixels) adds entitlements that follow this same path with no change to it: see the handoff in `docs/SPRINT_8_REPORT.md`.
- Sprint 9 must add: the platform rate limit in front of `/api/billing/webhook`, billing rows in the account export, and the order "cancel at the provider, then purge" for account deletion.
