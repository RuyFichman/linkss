# ADR 0020 — Product funnel from existing records; help center, pricing and public status

- **Status:** accepted for implementation on 2026-10-13. Verified on the local stack only. The migration `202610130001` was applied to production on 2026-10-14. **`SUPPORT_EMAIL` is not set anywhere and no mailbox exists for it.**
- **Sprint:** preparation of Sprint 10 (private pilot)
- **Related:** ADR 0011 (customer analytics), ADR 0014 (billing, addendum of the same date), ADR 0015 (platform administrators), ADR 0019 (external monitor)

## Context

The private pilot has a gate (activation of at least 60% among the invited, median time to the first publication under ten minutes) and nothing measured it. It also needs somewhere to send a person who is stuck, a page that says what the plans are, and a place that says whether the service is up. None of the four may add a vendor: no analytics database, no help-desk product, no status-page service and no log reader is contracted, and each would be a new subprocessor and a founder decision (AGENTS.md §5, §13, §16).

AGENTS.md §12 keeps two things apart: customer analytics (what a page's owner sees) and product analytics (how the product itself is used). This is the first product analytics in the repository.

## Decision

### 1. The funnel is computed from what the product already records

`public.get_product_metrics(p_weeks)` answers, for accounts created in the last 1 to 12 weeks, how many reached each step, in total and per week of sign-up (weeks start on Monday, `America/Sao_Paulo`):

| Step | Source |
|---|---|
| created the account | `auth.users.created_at` |
| confirmed the e-mail | `auth.users.email_confirmed_at` |
| created a page | a `profiles` row with `created_by` = the account (deleted and archived pages count) |
| published, and published within 24 hours | the account's first `profile_publications.created_at` |
| got a visit | `analytics_daily`, `page_view`, on a page the account created |
| got a value action | `analytics_daily`, the value actions of ADR 0011 (WhatsApp, Pix copy, Pix payment click, form submission) |
| paid | a paid invoice of a workspace the account owns |

Plus the median minutes from sign-up to the first publication, and the cancellation reasons (ADR 0014, addendum).

- **No event, cookie, identifier or table is added for it.** Nothing new is collected from customers or visitors, so the data map gains no store and the privacy notice needs no new paragraph for the funnel.
- **Platform administrators only** (`private.is_platform_admin()`, ADR 0015); a customer gets 42501 and the screen answers 404. The service role cannot execute it either: it is a screen for a signed-in person, not a job.
- **Counts only.** The answer has no name, address, e-mail or identifier (pgTAP checks it). Platform administrators are left out of the counts.
- **Activation** is the share of accounts created that published a page. `ACTIVATION_GATE_PERCENT` (60) and `PUBLISH_MEDIAN_TARGET_MINUTES` (10) in `modules/product-metrics/metrics.ts` are the Sprint 10 numbers; the screen says whether each is met. A rate with nothing to divide by is shown as "sem dados", never as 0%.
- Screen: `/app/administracao/produto`, reached by address like the other two administrator screens.

**Known limits, stated on the screen:**

- Every account created in the period is counted, invited or not. During a closed pilot the two groups are the same; once sign-up is public they are not, and the gate would need a list of who was invited.
- Erased accounts leave the counts (the funnel reads accounts that exist).
- Visits and value actions come from `analytics_daily`, kept for 100 days: that is why at most 12 weeks are returned. An account is credited with the pages it created itself, in whatever workspace.
- In billing sandbox, "paid" counts test payments.
- It answers "how many got how far". It cannot say *where inside a screen* people give up: that needs product telemetry, which is not built.

*Rejected:* a product-analytics vendor or an events table of our own (a new data flow and retention question to answer a question the existing records already answer for a ten-person pilot); a spreadsheet filled by hand (the gate would depend on memory); computing the funnel in the application with the secret key (the definition would live outside the database and outside pgTAP).

### 2. Help center and support contact

- `/ajuda` is a static page of questions and answers written in `content/pt-BR.ts` (`HELP_COPY`). **Every answer must describe something the deployed product does**; the billing section had one text for where paid plans are on sale and another for where they are not, chosen by the same rule as the home (`paidPlansAreOnSale`); since 2026-10-29 it always explains how to subscribe (addendum in ADR 0014). Custom domains and pixels are left out until they have run in production.
- The contact is an address in `SUPPORT_EMAIL` (server-side, read at build time). **While it is empty the page shows no address** and says support is handled by whoever sent the invitation, which is true of the private pilot. An address nobody reads is worse than none.
- The account menu and the first-steps checklist link to it.

*Rejected:* a contact form with a queue in the product (a ticket system is outside the pre-launch scope, AGENTS.md §18, and without e-mail the answer would have nowhere to go); a help-desk widget (third-party script on every screen, new subprocessor).

### 3. Pricing page

`/precos` lists the plans from the same two sources as the plan screen inside the account: amounts from the price catalogue, contents from the entitlements (`planFeatureLines`). **Amounts appear only where billing is live**; elsewhere paid plans are listed as coming, without prices. Static: changing the billing mode needs a redeploy, as on the home.

### 4. Public status page

`/status` reports two components: the application (it rendered this answer) and the database behind pages and the panel (one anonymous read, the same every public page makes, for a reserved address).

- **Rendered per request, with the probe remembered for 30 seconds per instance.** It is deliberately not cached by ISR: a regenerated page is served stale first, so a visitor arriving during an outage would read the state of the last visit. Thirty seconds bounds the database cost at two reads a minute per instance however often the page is opened.
- It names no job, queue, customer or number: those stay behind `OPS_STATUS_SECRET` (ADR 0019).
- **It is served by the application it reports on**, and says so: if the hosting platform is down, the page does not open. It has no incident history and no way to post a notice by hand.
- The external monitor reads it every hour and fails when it does not say everything is working, which makes a database outage an alert even while cached public pages still open.

*Rejected:* a hosted status service (the right tool for a public launch: independent of our hosting, with history and subscriptions; it is a vendor decision for Sprint 12); ISR (above); exposing the checks of `/api/ops/status` (they describe internal queues).

### 5. First steps

A checklist on the page list (create the page, build and publish, share), derived from the counts that screen already has (`modules/profiles/onboarding.ts`). It is shown to who may create pages until the workspace publishes for the first time, and never again; there is no dismissal and nothing is stored. It is a checklist, not a guided overlay: it works without JavaScript and adds no client bundle.

### 6. Latency and availability from outside, without a log reader

The hourly monitor (ADR 0019) now times its requests: `/api/health` must answer in 3 seconds and the home, the status page and the optional published page in 6, in one of three attempts. The log of each run keeps the status and the time of every attempt, which is the only latency history the project has.

**This is not an error-rate alert.** A rate needs every request counted, which means reading the hosting logs: a log drain (not available on the Vercel Hobby plan) and a service to receive it. That remains a founder decision; `docs/OBSERVABILITY.md` and `BACKLOG.md` keep it open.

## Consequences

- The funnel has one definition, in SQL, covered by pgTAP `230-pilot-readiness`. Changing a step means changing the function, `FUNNEL_STEPS` and the screen's labels together.
- The first screen that shows data across customers exists. It shows counts; the only free text is the optional cancellation comment, which may contain personal data and is marked so on the screen.
- Three more public routes (`/ajuda`, `/precos`, `/status`), all on addresses reserved since Sprint 1.
- A sentence in the help center can go stale. The file's header says so; a change to a screen or a rule must look for its answer there.
- The monitor fails for a slow answer measured from a GitHub runner, which is outside Brazil: the thresholds are about availability, not about the LCP target. They are provisional and should be tuned after a few weeks of logs.
