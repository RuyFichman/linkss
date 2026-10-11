# ADR 0018 — Request limits, CAPTCHA, scheduled retention and account erasure

- **Status:** accepted for implementation on 2026-10-11. Verified on the local stack only. **Nothing here was configured or run on the hosted environment: no firewall rule exists, CAPTCHA is off in Supabase Auth, the migration is not applied, and no account of a real person was erased.**
- **Sprint:** 9 (continuation)
- **Related:** ADR 0005 (auth), ADR 0009 (media cleanup), ADR 0014 (billing), ADR 0015 (privacy requests), ADR 0016 (domains)

## Context

Four items stood between the product and its first outside users: no limit in front of the public endpoints other than the per-page and per-visitor limits inside Postgres; an Auth API that tells an attacker whether an address exists (measured in Sprint 2); retention periods that were only enforced "on the next write", so a quiet page kept expired leads forever and nothing ever removed a page deleted 30 days earlier; and an account deletion that was a request in a queue with no way to carry it out.

Constraints: production runs on Vercel Hobby and Supabase Free (founder decision, 2026-10-10); no new vendor without a decision; no second store (queue, cache, key-value) without a requirement.

## Decision

### 1. Request limits in two layers

**Edge layer: one Vercel Firewall rate-limit rule, configured in the Vercel dashboard.** It is the only layer that counts across instances and that stops a request before it costs a function invocation. The Hobby plan allows exactly one rate-limit rule per project, keyed by IP, fixed window of 10 s to 10 min, counted per region. The rule (`docs/runbooks/RATE_LIMITS.md`) therefore covers everything except static assets with one generous per-address limit, started in *Log* mode. It cannot be expressed in this repository; the runbook is its source of truth.

**Application layer: per-instance counters in memory** (`lib/security/rate-limit.ts`) for `POST /api/events`, `POST /api/vitals`, `POST /api/media`, `/r/<token>`, the public form submission and the abuse report. A fixed window per address and endpoint, keyed by a truncated SHA-256 of the address, bounded to 5,000 counters. It is honest about what it is: another instance has its own counters and a cold start resets them. It exists because it is free, needs no store, and sheds the common case (one address hammering a warm instance) before a body is read or the database is called. A request with no address (local runs, no proxy) is never limited.

Refused requests get the answer each endpoint already gives for a dropped request: 204 for the two beacons, 429 for uploads, the generic 404 for a report link, the form's own "too many attempts" state, and the neutral "received" for an abuse report.

**Not done:** the public renderer `/<slug>` and `/d/<host>` have no application-layer limit. Putting the proxy in front of them would turn every cached page view into a function invocation; they rely on the firewall rule. The database limits (ADR 0010, 0011, 0013, 0015) stay as the durable per-page and per-visitor limits.

*Rejected:* a Redis/KV limiter (new vendor and store for a pre-revenue product); a Postgres-backed global limiter (a database write in front of every beacon, on the Free plan); `@vercel/firewall` in code (a new dependency that still shares the single Hobby rule).

### 2. CAPTCHA: Cloudflare Turnstile, verified by Supabase Auth

The founder chose Turnstile on 2026-10-11 (free in its low-friction mode; hCaptcha's free tier shows image puzzles, which costs sign-ups inside social-app browsers). Supabase Auth verifies the token; the secret key lives only in Supabase. This application renders the widget on sign-up, sign-in, confirmation resend and password recovery (`CaptchaField`) and forwards the token (`captchaToken`).

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` absent: no widget, no token, no extra origin in any policy. This is correct only while CAPTCHA is off in Supabase.
- **Order of activation matters:** the site key must be deployed before CAPTCHA is switched on in Supabase Auth, or every sign-in fails with `captcha_failed`.
- `captcha_failed` is its own outcome and message. It is never reported as wrong credentials or as "we sent an e-mail" (which would hide a broken setup behind a neutral answer); it reveals nothing about the address.
- The vendor origin is allowed in `script-src` and `frame-src` of the four form routes only, and only when the build has a site key.
- New subprocessor: Cloudflare receives the visitor's address and browser signals on those four screens (`docs/DATA_MAP.md`).

**Not done:** CAPTCHA on the public lead form and on the abuse report (both keep honeypot plus limits).

### 3. One daily retention job

`public.run_retention_maintenance` (service role only), called by `/api/jobs/retention` at 07:00 UTC, one hour after the media job. Every statement is bounded; what is left waits a day and is reported.

| What | Removed when |
|---|---|
| `form_leads` | `purge_after` passed (90 days, provisional) |
| `form_submission_hits`, `report_lookup_failures` | older than 1 day |
| `workspace_invitations` | finished more than 30 days ago |
| `report_links` | finished more than 90 days ago |
| `moderation_reports` | decided more than 180 days ago, or never decided, older than 180 days and about a page that no longer exists (**new, provisional**) |
| `privacy_requests` and their history | closed more than 5 years ago (**new, provisional**) |
| `audit_events` | older than 1 year (provisional since Sprint 2) |
| `slug_history` | hold ended more than 1 year ago |
| `profiles` | `purge_after` passed (30 days after deletion) and no image file left |
| `workspaces` | `purge_after` passed, no image file left, no subscription that has not ended |

A page is never removed before its image files: `media_assets` references pages and workspaces with `ON DELETE RESTRICT`, and deleting rows first would leave unreachable files in the bucket. The media job already claims the files of a page past `purge_after`; the retention job runs after it and reports `pendingProfiles` / `pendingWorkspaces` for what still waits.

The history of a privacy request stays append-only for every client role; like the audit trail, only a function owned by the database owner may delete it.

### 4. Account erasure in two database steps, with the server in between

Run by a platform administrator from the privacy queue, for a request of kind `account_deletion` in status `processing` (the operator's statement that identity and scope were checked).

1. **`begin_account_erasure`** refuses while a workspace the person owns has a subscription that has not ended (`LK123`) or another active member (`LK124`). Otherwise every page of the workspaces the person owns goes off the air and is marked for immediate purge (their addresses go on hold as for any deleted page), and the function returns the addresses to drop from the cache and the hostnames attached at the hosting provider.
2. **The server** drops the cached pages, detaches the hostnames (`DomainsAdapter`), and runs the media cleanup, which now claims those pages' files.
3. **`finish_account_erasure`** refuses while an image file remains (`LK125`) or a page is still live (`LK122`); then, in one transaction, deletes the owned workspaces (cascading to pages, publications, leads, results, report links, invitations sent, domains, pixels and billing rows), the invitations addressed to the person's e-mail, their waitlist entry, and the `auth.users` row (cascading to the account row, memberships elsewhere, legal acceptances and sessions), and closes the request with the evidence reference.

Every step is idempotent: any outcome other than success is resolved by fixing its cause and running the same request again.

The media cleanup in step 2 uses the secret key, as the scheduled job does. It runs only after step 1 succeeded, which is the database's own confirmation that the caller is a platform administrator.

**What stays, on purpose:** the privacy request and its history (proof of fulfilment; no e-mail in them); `audit_events` and `slug_history`, where the person is an identifier that no longer resolves to anyone, for their retention periods; abuse reports about their pages, for theirs; whatever Stripe keeps (customer, invoices, receipts) under the founder's fiscal obligations; and backups, until they age out (`docs/runbooks/BACKUP.md`). The reply to the person must say so.

*Rejected:* automatic erasure when the person clicks (irreversible, and identity, shared workspaces and subscriptions need a human check first); deleting the Auth user through the Admin API in a separate call (two non-atomic steps; a failure between them leaves an account with no data, or data with no account).

## Consequences

- A fourth Vercel Cron. A new failure mode: a media outage delays page purges (visible as `pendingProfiles`).
- The erasure removes other people's access to nothing: content in a workspace the person only worked in stays with that workspace.
- **Open:** the firewall rule and CAPTCHA activation are founder steps (`docs/ENVIRONMENTS.md`); the 180-day and 5-year periods and the reply template need the legal review; transferring a shared workspace to another owner has no screen, so `LK124` is resolved by the members leaving; a subscription must be cancelled and reach `ended` before erasure, which can take until the end of the paid period unless it is cancelled immediately at the provider; the detached hostname and the Stripe customer are not verified after the fact; nothing notifies the person (no transactional e-mail exists).
