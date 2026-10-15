# ADR 0021 — Transactional e-mail through an outbox and Resend

- **Status:** accepted for implementation on 2026-10-14. Verified on the local stack only, against a stand-in for Resend's API and the local Mailpit. Migration `202610140001` was applied to production on 2026-10-14, before the code was merged. Live on production since 2026-10-14 (PR #39): Resend account, `linkfav.com` verified in the São Paulo region without a tracking domain, custom SMTP in Supabase; the founder reported a password-recovery e-mail and a new-contact notice arriving. **No contract or DPA with Resend and no legal review yet.**
- **Related:** ADR 0011 (customer analytics: third parties never block a visitor), ADR 0012 (invitations; addendum of the same date), ADR 0014 (billing), ADR 0019 (suspension, appeal, monitor), ADR 0020 (support address)

## Context

The product sent no e-mail of its own. Four notices existed only on a screen that the person had to open: a new form contact, a page suspended by moderation, the answer to an appeal, a payment that failed. A yearly renewal was not announced at all. Supabase Auth sent its own messages (confirmation, recovery) through the hosted default sender, which is rate-limited and, on the hosted plan, does not allow custom templates; that is why an invitation accepted on another device could not work (ADR 0012).

The founder chose Resend on 2026-10-11. Constraints from AGENTS.md: vendors behind narrow adapters (§5, §16); third-party failures never block a visitor (§6.7); webhooks, jobs and retries idempotent (§6.10); never log addresses or lead contents (§8); minimize personal data (§13). The hosting plan runs cron jobs once a day.

## Decision

### 1. An outbox in Postgres, written by the facts themselves

`mail_outbox` holds one row per message and recipient. The rows are written by **triggers on the tables where the facts already land** (`form_leads`, `moderation_suspensions`, `moderation_appeals`, `billing_subscriptions`) and, for renewals, by the daily job. So:

- a message exists exactly when its fact was committed: never lost when the provider is down, never sent for a fact that was rolled back;
- each trigger catches its own errors: **a broken outbox can never make the original write fail** (a contact is the visitor's and is stored regardless; pgTAP forces the failure and checks it);
- a unique `dedupe_key` per fact and recipient makes repeats harmless: a second contact in the same hour, a webhook delivered twice, a job run again.

A row names the recipient by **user id**; the address is read at claim time and only when it is confirmed, so an erased or unconfirmed account gets nothing, and the outbox never stores an address. Rows cascade with the account and the workspace.

### 2. Sent right after the request that caused it, and once a day as a safety net

The Server Action or route that caused the fact (form submission, moderation decision, billing webhook, billing job) calls `scheduleMailDrain`, which uses Next's `after()`: the drain runs **after the response is sent**, so neither a visitor nor the payment provider waits for e-mail. The new daily job `/api/jobs/mail` (09:00 UTC) queues renewal reminders, sends what is still due (a provider that was down), expires what waited too long and purges what finished 30 days ago.

Claiming takes a ten-minute lease (`for update skip locked`); a crashed sender's messages come back by themselves. Each send carries the outbox id as Resend's `Idempotency-Key`, so a retry after a lost answer does not send twice. A provider failure backs off (5, 10, 20, 40 minutes) and gives up after five attempts; a refusal is final. Every message has an expiry (a contact notice after two days, a payment notice at the end of the grace period, a renewal at the renewal date): mail switched off for a week does not produce a week of stale e-mails when it is switched on.

### 3. Resend behind a MailAdapter

`MailAdapter.send` in the product's terms; `createResendAdapter` is one `POST /emails` over `fetch`, no SDK. Configuration: `RESEND_API_KEY`, `MAIL_FROM` (a sender on a domain verified at Resend), optional `MAIL_REPLY_TO` (defaults to `SUPPORT_EMAIL`). Missing or malformed: mail is off, messages wait and expire, nothing errors. A loopback base URL is accepted only outside production, for the local stand-in.

Supabase Auth's own messages move to Resend's **SMTP** in the Supabase dashboard: a configuration, not code. That is what makes the hosted templates in `supabase/templates/` usable in production.

### 4. What each notice says, and to whom

| Notice | Recipients | Carries | Expires |
|---|---|---|---|
| New form contact | owners and admins who did not turn it off; at most one per page, per person and per hour | page title and address; **never what the visitor typed** | 2 days |
| Page suspended | owners and admins (they may appeal) | page title and the category of the suspension; **never the moderator's justification** | 14 days |
| Appeal answered | owners, admins and whoever sent it | the decision and the answer written for the workspace | 14 days |
| Payment failed | owner | plan and end of the grace period | end of grace |
| Yearly renewal in the next 7 days | owner | plan, date, amount | renewal date |

Each links to the screen that acts on it. Only the contact notice can be turned off (`user_accounts.notify_new_leads`, on *Meus dados*): the others are about the account itself. Monthly renewals get no reminder (the provider's receipt follows every charge). In billing sandbox the two billing notices say they are tests.

### 5. Invitation confirmed on another device

See the addendum in ADR 0012. The confirmation template carries `redirect_to`; `/auth/confirm` reads the invitation path from it. Needs the custom template, hence custom SMTP.

### 6. Operations

Sixth job (`mail`) with a heartbeat; the monitor gains `mail:overdue` (critical while mail is on: messages due for an hour that nobody sent) and `mail:failed` (attention: messages that gave up in a day). Logs carry kinds and counts, never an address, a name or a page.

## Consequences

- **Resend is a new subprocessor** with an international transfer (United States): it receives the recipient's address and name, the page title and, for an appeal, the moderator's answer. `docs/DATA_MAP.md` records it; the privacy notice and the legal review must cover it before the first e-mail.
- The domain `linkfav.com` needs SPF, DKIM and (recommended) DMARC records published for Resend. Until then nothing can be sent from it.
- Stripe can also e-mail a failed payment. With both on, the owner gets two messages; the runbook leaves it to the founder.
- A new notice means: a kind in the table check, a trigger or a job step, a template in `modules/mail/templates.ts`, copy in `MAIL_COPY`, a row in this table, and pgTAP `240-transactional-email`.
- The outbox adds a write to five hot paths. Each is one insert per recipient (a handful of rows), inside the existing transaction.

## Alternatives considered

- **Sending inside the request:** a visitor's form submission would wait for Resend, and a Resend outage would surface as an error to someone who did nothing wrong.
- **Sending from database triggers through `pg_net`:** the secret key would live in Postgres, retries and idempotency would be ours to build in SQL, and nothing would run the tests on it.
- **A queue service:** a new vendor and an ADR for a volume of a few dozen e-mails a day.
- **Putting the contact's data in the e-mail:** convenient, and it would copy personal data of visitors to a third party and to the owner's inbox. The panel already shows it with access control.
- **The Resend SDK:** one call does not justify a dependency (AGENTS.md §16).
