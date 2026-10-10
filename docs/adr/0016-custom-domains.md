# ADR 0016 — Custom domains with proof of control

- **Status:** accepted for implementation on 2026-10-10. Verified on the local stack only, against a local DNS resolver and an emulator of the hosting provider's API. **Not run against the real provider API and not tried with a real domain.**
- **Sprint:** 8, part 2 of 2 (with ADR 0017, pixels)
- **Related:** ADR 0003 (published snapshots), ADR 0004 (tenancy and authorization), ADR 0007 (public renderer), ADR 0012 (duplication), ADR 0014 (entitlements follow the plan)

## Context

Pro and Agency plans promise a custom domain (`custom_domain` has been in `plan_entitlements` since Sprint 2). The acceptance criterion is that a domain is associated only after proof of control and cannot be hijacked by another user. The deliverable also asks for DNS verification and an automatic certificate.

Three things are in tension:

1. A hostname is a public name anybody can type into a form. The product must never serve a page on a hostname because somebody said it was theirs.
2. Certificates and routing belong to the hosting provider (Vercel today), not to the application. The application must not depend on one provider's notion of ownership.
3. Public pages are cached snapshots (ISR). Whatever decides "this hostname opens this page" has to hold when the plan changes, the page goes off the air or the domain moves, without republishing.

## Decision

### One domain per page, in its own table

`public.profile_domains` holds one row per page (`profile_id` unique): `hostname`, a random `challenge`, `status` (`pending`, `active`, `lapsed`) and `routing` (`unknown`, `pending`, `ok`: what the provider said at the last check, information only). Agencies get one domain per client page, which is what "separate domains per client" means in the business plan.

The domain is not a column of `profiles` and not part of the published snapshot: page duplication copies neither (ADR 0012), and whether a domain is in force is read at request time, like the badge (ADR 0014).

Hostnames are stored lowercase, ASCII (IDNs as punycode), at least two labels, with a top-level label that starts with a letter (so an IP address never passes). A fixed list of suffixes is blocked in the database (the product's own domain, the hosting and database providers' shared domains, local and reserved names); the application also blocks the host of `NEXT_PUBLIC_APP_URL`, which the database cannot know. `hostname.ts` mirrors the SQL functions and a Vitest drift guard compares the blocked list with the migration.

### Proof of control: a TXT record read by the server, attested to the database

Claiming (`claim_profile_domain`) creates a `pending` row with the challenge `linkfav-verify=<32 hex>`. The owner publishes it as a TXT record at `_linkfav.<hostname>`. A claim proves nothing and **reserves nothing**: `pending` rows are not unique per hostname, so claiming a name you do not control blocks nobody, and the claim does not reveal whether the hostname is in use.

Checking (`verifyDomainAction` → `createDomainsService().verify`):

1. the application server resolves the TXT record itself, through public recursive resolvers (`1.1.1.1`, `8.8.8.8`), keeping only values in the challenge format;
2. if this claim's challenge is among them and a provider is configured, it attaches the hostname at the provider (idempotent) and reads how it routes;
3. it signs `{at, domainId, hostname, routing, tokens, v}` with `DOMAINS_SIGNING_SECRET` (HMAC-SHA256);
4. `public.confirm_profile_domain(text, signature)` verifies the signature against the Vault secret `domains_signing_secret`, refuses an attestation older than five minutes, re-checks role, workspace and plan, and decides.

The database is the only place a row becomes `active`. A signed-in person calling the RPC directly cannot produce the signature; the tables are not writable by any client role. This is the same attested path used for media (ADR 0009), analytics (ADR 0011), billing (ADR 0014) and abuse reports (ADR 0015).

A TXT record, not "the name points at us": a dangling CNAME left behind by a previous owner would otherwise let anybody attach it. Pointing the name is step two and is never an authorization.

### Hijack rule: one active row per hostname, and DNS today decides

A partial unique index allows one `active` row per hostname. When a claim proves control of a hostname that is active for another page, the attestation lists every challenge found in DNS at that moment:

- the other page's challenge **is still there** → `in_use`; nothing changes;
- it is **gone** (or that page or its workspace was deleted) → that row becomes `lapsed` in the same transaction, is audited in the workspace that lost it, and the new row becomes active.

So a hostname follows whoever controls its DNS zone now. A previous owner of a name keeps nothing; a current owner cannot lose it while their record stands. An advisory lock per hostname serializes concurrent confirmations; the unique index is the backstop.

An active domain whose TXT record disappears stays active until somebody else proves control. There is no scheduled re-verification in this sprint (see "Not built").

### Routing: host-based rewrite to an internal cached route

`next.config.ts` installs two `beforeFiles` rewrites for every request whose Host is **not** one of the product's own (the host of `NEXT_PUBLIC_APP_URL` with and without `www`, `*.vercel.app`, loopback):

- every path except the few a public page requests from its own origin (`/_next/*`, `/api/events`, `/api/vitals`, the icon) → a path with no route, i.e. the application's 404;
- `/` → `/d/<hostname>`.

The catch-all comes first on purpose: Next.js applies later `beforeFiles` entries to the path an earlier one produced, and in the other order the root's destination was caught and every custom domain answered 404. This was found by the local end-to-end script, not by review.

Nothing of the product (sign-in, the app, reports, the API, other pages) is served under a customer's hostname. Session cookies are host-scoped, so a custom hostname never carries a session either.

`/d/[host]` is an ISR route like `/[slug]`. It calls the anonymous `get_public_page_by_domain(hostname)`, which returns the page's `get_public_page` answer when the hostname has an active row **and** the workspace plan has `custom_domain`, and `not_found` otherwise (one answer for unknown, pending, lapsed and out-of-plan). `d` is a reserved slug.

Rewrites were chosen over the proxy because the proxy matcher is deliberately narrow so public pages stay cacheable (ADR 0007), and a host lookup in the proxy would put a database read in front of every request.

### Canonical address

While a page has an active domain in plan, `get_public_page` returns it and both addresses declare `https://<hostname>` as canonical and `og:url`. The product address keeps working and does not redirect: a broken DNS record must not take the page down. The Open Graph image is always the product's.

### Cache

`revalidatePublicPage(slug)` now also drops every custom-hostname copy (`revalidatePath("/d/[host]", "page")`): it does not know the page's hostname, and every caller already funnels through it. Each dropped copy costs one database read on its next visit. This is the simplest correct rule at MVP volume and is the first thing to narrow when publishing volume makes it visible (signal in `docs/ARCHITECTURE.md`). The 60-second ISR window is the fallback, and therefore also the longest a removed domain or a lost plan can keep answering.

### Provider behind `DomainsAdapter`

`ensure(hostname)`, `inspect(hostname)`, `detach(hostname)`; routing is `ok`, `pending` (with the DNS records to create, as the provider recommends them) or `conflict`. The Vercel implementation is plain `fetch`, four calls, written from the REST reference read on 2026-10-10:

- `GET /v9/projects/{id}/domains/{domain}` (Get a project domain)
- `POST /v10/projects/{id}/domains` (Add a domain to a project; 409 = assigned elsewhere)
- `GET /v6/domains/{domain}/config` (`misconfigured`, `recommendedCNAME`, `recommendedIPv4`)
- `DELETE /v9/projects/{id}/domains/{domain}`

Certificates are issued by the provider once DNS points at it; the application neither requests nor stores one. Without `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID`, control can still be proven and the screen says the hostname is not attached automatically in this environment.

The adapter is called only after the proof was read in DNS. A provider failure never undoes a proof (the row is active, the screen says the provider could not be reached) and never blocks a removal (the row is deleted first; a hostname left attached at the provider opens nothing and is logged).

### Roles and plan

`domains.view`: every member. `domains.manage` (claim, check, remove): owners and admins, in the application and in the RPCs. Removal is accepted in a suspended workspace.

Losing `custom_domain` deletes nothing: the hostname stops answering (`get_public_page_by_domain`), the settings screen says the domain is suspended by the plan, and it answers again when the plan comes back. The downgrade confirmation lists active domains as "stops".

### Limits and audit

20 claims per workspace per 24 hours, counted in the audit trail (removed claims leave no row). `domain.claimed`, `domain.verified` (once, not on re-checks), `domain.lapsed` and `domain.removed` are audited with the hostname. Application logs carry outcomes only, never a hostname or a challenge.

### Error contract (extends ADR 0004)

`LK120` the page already has a domain; `LK121` too many claims; `LK010` with detail `custom_domain`; `22023` with detail `hostname` or `blocked`.

### Fail-safe

Without the migration the settings section says the feature is not available yet and `/d/<host>` is a 404. Without the signing secret nothing can be confirmed (`not_configured`). An application one version behind ignores the two columns added to `get_public_page`.

## What is verified, and what is not

Verified locally: pgTAP `190-domains-pixels` (every role against every command, the attestation, taking a hostname over, each public state, plan loss and return); Vitest for hostnames, the service, the adapter against documentation-shaped responses and the routing rules; `scripts/domains-lifecycle.mjs`, which runs the production build against a local DNS resolver and an emulator of the four provider calls, sending requests with the custom hostname in the Host header.

**Not verified:** the real Vercel API (response shapes, the `verified: false` path, error codes, rate limits); certificate issuance; a real domain and a real DNS panel; how `has`/`missing` host conditions behave on Vercel's edge as opposed to `next start`; apex domains at registrars without ALIAS/flattening; behaviour behind a customer's own proxy or CDN.

## Not built

- **Scheduled re-verification.** A domain whose TXT record is removed stays active until another claim proves control. A daily job that lapses domains with no proof and detaches them at the provider is the natural next step.
- **Redirect from the product address to the custom domain**, and `www`↔apex redirects (each hostname is its own claim).
- **Domains in the workspace export** (`export_workspace_data`) and in the account-deletion procedure (Sprint 9 continuation).
- **Narrow cache invalidation** per hostname.
- **Wildcard or workspace-level domains** (`cliente.agencia.com.br` for every page).

## Operational constraints the founder must know

- **Vercel plan.** The Hobby plan is for non-commercial use and limits the number of domains per project; selling custom domains needs a paid Vercel plan. That is a new paid service and a founder decision; nothing here subscribes to it.
- **A provider token is a powerful secret** (it can attach and detach domains of the project). It lives only in server environment variables.
- **Phishing.** A custom domain makes a page look more official. The report link stays on every page and suspension applies on the custom hostname too (`get_public_page` answers `suspended`).

## Alternatives considered

- **CNAME/A pointing as the proof.** Rejected: dangling records are the classic subdomain takeover.
- **Trusting the provider's own verification.** Rejected as the authority: it protects the provider's accounts from each other, not our tenants from each other (all hostnames land in one project).
- **First claim reserves the hostname.** Rejected: squatting on names one does not control.
- **Service-role RPC instead of a signature.** Rejected: ordinary user actions do not use the service role (AGENTS.md §11).
- **Host lookup in the proxy.** Rejected: a database read before every request and public pages no longer cacheable.
- **Storing the domain in the published snapshot.** Rejected: a plan change or a takeover would need a republish.

## Consequences

- A fourth signing secret mirrored in Vault (`domains_signing_secret`), and up to three provider variables.
- `get_public_page` returns two more columns (`custom_domain`, `pixels`); the function was dropped and recreated in the migration.
- A new top-level route (`/d`) and host-dependent behaviour in `next.config.ts`: a new product hostname must be the host of `NEXT_PUBLIC_APP_URL` (or a `*.vercel.app` address), otherwise it is treated as a customer's domain and serves a 404.
- Every publish drops all custom-hostname cache entries.
