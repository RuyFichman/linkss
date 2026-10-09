# Sprint 8.2 (part 2 of 2) — Tracking pixels with visitor consent, custom domains (gated) and sprint closure (Projeto LNK)

## 0. Founder gate status

Edit this block before running the prompt if anything changed, in particular the lines about part 1 and about the custom domain.

```text
SPRINTS 1–7: merged into main.
SPRINT 8 PART 1 (plans, subscriptions, billing, ADR 0014): its real state is in docs/SPRINT_8_REPORT.md, marked "in progress, part 1 of 2". Check whether its branch (feat/sprint-8-billing) was merged into main and whether it was applied to staging; do not assume either.
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force.
UX_DECISIONS: provisional ones are the implementation default (do not wait for confirmation).
PRODUCT DOMAIN: not purchased. The public origin is NEXT_PUBLIC_APP_URL; staging is https://linkss-black.vercel.app.
FOUNDER: CUSTOM_DOMAIN = DEFERRED. There is no domain to test with, so proof of control, routing by host and certificate issuance cannot be verified. Deliver the design only (D6). To build it, change this line to "CUSTOM_DOMAIN = BUILD, test domain: <domain>, DNS access: <who changes the records>" and D7 applies.
FOUNDER: LEGAL REVIEW of visitor analytics, pixels and the cookie policy = not done.
This sprint is developed and verified on the local stack. Do not apply migrations, create secrets, add domains or change settings on the hosted project or on Vercel; list them in the report as deploy steps for the founder.
```

This part delivers what an agency asks for right after "can I measure it": sending the page's visits to the client's own Meta and Google accounts. It is the first time the public page loads code from a third party and the first time it stores anything in a visitor's browser. Until now the page set no cookie, used no browser storage and called nobody but us. A pixel that fires before the visitor agrees, a field that accepts something other than an identifier, or a script that slows every page whether it has a pixel or not would cost the product its two strongest properties: a fast page and a clean privacy position.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. This session has no memory of the one that did part 1; everything you know about it comes from the repository. Your job is the **second half of Sprint 8**: pixel configuration by identifier, the visitor consent mechanism, the loaders, the published policy, the custom-domain item according to §0, and the closure of the whole sprint (report, source-of-truth documents, backlog, `AGENTS.md` §22). Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (continue from the last id in the file) or in the ADR (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; especially §6 invariants 5, 7 and 14, §10, §12, §13, §19–§22), `README.md`.
- **`docs/SPRINT_8_REPORT.md`** (part 1: decisions, status of each criterion, gaps, "Handoff to part 2") and **`docs/adr/0014-*.md`**. Then check them against reality: `git log`, `git status`, the migrations and routes actually present. Where the report and the code disagree, the code is the fact; record the disagreement and correct the report.
- `PLANO_DE_EXECUCAO.md`: **Sprint 8** and Sprint 9 (terms, privacy, cookies and versioned acceptance; CSP and headers; rate limits). `PLANO_DE_NEGOCIO.md`: the plan table (pixels are listed under Pro) and the legal notes on consent for analytics, pixels and forms.
- `BACKLOG.md`, `docs/SPRINT_7_REPORT.md` (custom domain and pixels are not copied on duplication and do not appear in the shared report; the address shown in the report comes from `NEXT_PUBLIC_APP_URL`).
- `docs/adr/0003-published-snapshots.md`, ADR 0007 (the public route, ISR, `proxy.ts`), ADR 0008 and ADR 0010 (snapshot schema version 2, additive changes, expand/contract; the embed allowlist by provider and id with click-to-load is the closest precedent for "third-party content without arbitrary markup"), ADR 0011 (the first-party collector: no cookie, no storage, mounted only by `/[slug]`), ADR 0012 (duplication) and ADR 0013.
- `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md`, `docs/OBSERVABILITY.md`, `docs/ENVIRONMENTS.md`.
- `docs/ux/UX_DECISIONS.md` (UX-008, UX-043 to UX-050), `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md`, `docs/ux/WIREFRAMES.md`.
- Code: the public route `/[slug]` and everything it renders, `get_public_page` and `private.published_block`, `modules/publishing/document.ts`, the customer-analytics collector and its `data-block-id` / `data-block-type` hooks, `apps/web/src/content/public-page.ts` (the only copy file shipped in the public page's client bundle), `apps/web/next.config.ts` (the headers set today; find out whether any Content-Security-Policy exists), `apps/web/src/proxy.ts`, the editor's "Página" tab and the page settings route, `modules/entitlements/*`, `lib/product.ts`, the duplication RPC, the privacy notice under `apps/web/src/app/(marketing)/privacidade`, `modules/profiles/reserved-slugs.ts`, and the pgTAP suites.
- Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills before writing SQL. For Next.js 16 script loading, dynamic imports and caching, read the guides in `node_modules/next/dist/docs/`. For Meta Pixel and Google tag behaviour, identifier formats and consent signalling, use the current official documentation and say in the ADR which pages you read and on what date.

### Facts you must not get wrong

- **An identifier, never a script.** The owner types a Meta Pixel id and a Google Analytics measurement id. Each is validated against a strict format on the server and in the database, and the loader builds the vendor URL from a constant plus that id. No field accepts a snippet, a URL, a domain or free text that ends up in markup. This is invariant 14.
- **Google Tag Manager is a way to run arbitrary JavaScript chosen by the container's owner.** Accepting a GTM container id would let any script onto a page we serve. The execution plan says "Google Analytics/Tag"; the recommended reading is the Google tag for GA4 only, with GTM refused and the reason recorded.
- **Nothing is sent before the visitor agrees.** Before consent: no request to Meta or Google, no vendor script fetched, no vendor cookie. Declining is as easy as accepting and is remembered. Check the legal position on the page owner's side only as far as documenting it for the reviewers; do not write legal conclusions into the product copy as facts.
- **A page without a pixel is untouched.** No banner, no storage, no extra request and no extra client JavaScript on the critical path. Measure the public route's client bundle before and after for a page with no pixel configured; the difference must be zero or justified byte by byte.
- **The first-party collector is separate.** Customer analytics keeps working whatever the visitor answers about pixels, on its own legal basis, and still writes no cookie and no storage. Do not route our own events through the consent switch, and do not send anything we collect to Meta or Google from the server.
- **The public page is served from a published snapshot through ISR.** Decide where the pixel configuration lives so that it reaches the public page, changes when the owner changes it, and stops when the workspace loses the entitlement. Part 1 solved the same problem for the badge; reuse its mechanism rather than inventing a second one.
- **Pixels are a paid capability and there is no entitlement key for them today.** Adding one means an enum migration, the `plan_entitlements` rows, `lib/product.ts` and the drift test together. Check the entitlement, never a plan name.
- **Performance budgets hold with a pixel on.** CLS 0 (the consent prompt must not push content), LCP p75 at or below 2.5 s on mobile. Vendor scripts load after consent and off the critical path. A vendor that is slow, blocked by an ad blocker or down never blocks navigation or a click (invariant 7).
- **The preview, the editor, `/r/<token>` and the app never load a pixel,** and neither does a visit our own collector already discards as the owner's (decide and state it).
- **No personal data in events.** No form contents, e-mail, phone, name or lead id go to a vendor; no "advanced matching".
- **Duplication does not copy pixel settings or a custom domain** (UX-008, ADR 0012). Make that true in the duplication RPC and test it.
- **Copy read by visitors lives in `content/public-page.ts`;** everything else stays in `content/pt-BR.ts`.
- **Local environment:** the founder has test accounts in the local database. Apply migrations with `supabase migration up`; do not run `npm run db:reset` without approval. Stay inside this repository (no edits to the hosts file or anything else outside it): write temporary files only to the session scratchpad, and leave Docker containers of other projects alone. A signed-in browser is never counted by the collector: test in a private window. Lighthouse on this machine is inflated by a render-blocking script injected by the antivirus unless it is blocked with `--blocked-url-patterns`.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build. Run the suites before changing anything and use the counts you measure.

## 3. Goal and acceptance criteria

**Goal:** the owner of a page on a paid plan types the client's Meta Pixel id and Google Analytics id in the page settings, publishes, and sees visits arrive in those accounts from visitors who agreed, while a visitor who declines or ignores the prompt gets the same fast page and sends nothing to anyone but us.

| # | Criterion (`PLANO_DE_EXECUCAO.md`) | Required evidence |
|---|---|---|
| AC6 | Pixels respect the consent setting and the published policy | A browser test or scripted check on the local stack recording network requests: before an answer, zero requests to any Meta or Google host and no vendor cookie; after declining, the same, and still the same after a reload; after accepting, the vendor script and the page-view hit, and the choice remembered; consent withdrawn from a visible control stops further hits. Vitest for the consent state machine with every transition. A published policy page that names what is loaded, when, by whom, what it stores and how to withdraw, linked from the prompt |
| AC6b | No arbitrary scripts | A Vitest table and pgTAP for the identifier validators (valid ids; a snippet, a URL, markup, a GTM id, whitespace and Unicode look-alikes, an over-long value, an id with a trailing payload); a test that the only vendor origins the loader can ever request come from a constant list; a forged direct write that bypasses the interface is refused by the database |
| AC6c | The page keeps its budgets | Client JS size of the public route for a page without pixels: unchanged. Lighthouse mobile, with the antivirus script blocked, for the same page with and without a pixel, before and after consent: CLS 0 in all runs, LCP reported for each. A vendor host made unreachable does not delay a link click |
| AC7 | A domain is attached only after proof of control and cannot be hijacked by another user | **If §0 says DEFERRED:** status *not started*, with ADR 0016 as the prepared design and the blocker stated. **If §0 says BUILD:** the evidence listed in D7 |
| AC1–AC5 | Owned by part 1 | Re-run their tests, confirm the status recorded in the report, and carry it into the final table with the evidence. If part 1 left any of them partial, finish it before starting the new deliverables and say so |

## 4. Deliverables

### D1 — ADR 0015 (tracking pixels and visitor consent)

Confirm `0015` is the next free number. Decide, justify and record. Where a recommended default is given, you may choose differently if the code or the documents show a better option; say why.

- **Vendors and identifiers.** Meta Pixel and GA4, the exact accepted formats, and the refusal of GTM. One pixel of each kind per page (recommended).
- **Where the configuration lives** (per page, recommended, since an agency's pages belong to different clients), how it reaches the public page, how a change or a lost entitlement takes effect on an already-published page and within what time, and whether changing it needs a new publication.
- **Entitlement.** The new key, which plans have it, and what the settings screen shows without it (with the upgrade link from part 1 for the roles that can act).
- **Consent.** The states (unanswered, accepted, declined), what an unanswered visitor experiences (recommended: a small fixed prompt that covers no call to action, with two equally prominent buttons; nothing loads until an answer), per-purpose or single switch (recommended: one switch, "medição e anúncios", since both vendors serve that purpose here), where the answer is stored (recommended: first-party `localStorage`, scoped to the page's address, no cookie, with an expiry after which the question is asked again), how it is withdrawn, and how in-app browsers of Instagram and WhatsApp behave with that storage. Whether Google's consent signalling is used in addition to not loading the script at all (recommended: do not load before consent; that is the stronger guarantee).
- **What is sent.** Recommended: the page view, plus a small fixed mapping from the value actions our collector already recognises to standard vendor events (for example a WhatsApp click as a contact, a form submission as a lead), with no parameters beyond the event name. No custom events defined by the owner, no personal data, no server-side conversion API.
- **Loading.** After consent only, through a dynamic import that is absent from the bundle of a page without pixels, from a constant list of origins. What happens when the vendor fails. Whether a Content-Security-Policy exists today and, if it does, the exact additions; if it does not, state what Sprint 9's CSP must allow.
- **Roles and audit.** Who sets and removes a pixel (recommended: owner and admin, because it sends visitor data to a third party), added to the permission matrix; configuration changes audited with the vendor and never the full identifier if that is avoidable.
- **Privacy position, for the reviewers.** Who decides to send the data (the page owner), what our role is, the international transfer to Meta and Google, and the open questions for the legal review. List them; do not settle them.

### D2 — Database (forward-only migrations + pgTAP)

- Storage for the configuration with constraints that enforce the identifier formats, RLS, and the write path through an RPC that checks role and entitlement.
- The new entitlement key (enum change in its own migration) and plan rows; new audit actions the same way.
- The public read extended additively so the public page learns which pixels to offer, and nothing else. The snapshot stays compatible with the previous application version (expand/contract).
- Duplication leaves the copy without pixels.
- pgTAP, at minimum: each validator case in AC6b; set and clear as owner, admin, editor, a member of another workspace and `anon`; set without the entitlement; the public read returns the ids for an entitled workspace and none after the entitlement is lost, with the rows kept; an archived, unpublished or soft-deleted page exposes nothing; duplication; the shared report read still returns its closed field list with no pixel data.
- Regenerate `apps/web/src/lib/database.types.ts`. Run the advisors on the local stack and fix what they report.

### D3 — Pure modules and server code

- Identifier validation shared by the server and the settings form; the consent state machine with an injected clock and an injected storage that may throw (private windows and blocked storage must degrade to "ask again", never to "accepted"); the mapping from our value actions to vendor events; the vendor URL builders from the constant origin list.
- Server Actions validating at the boundary and checking role and entitlement on the server; structured logs without identifiers that are not needed.
- Vitest tables for all of it.

### D4 — Settings (pt-BR, mobile-first)

In the editor's "Página" tab or the page settings, wherever the existing structure puts it: a section with the two fields, format help, validation errors that say what a valid id looks like, save and remove, the state without the entitlement, the state for a role that cannot edit, and a plain note that visitors are asked before anything is sent and that the page owner is responsible for the accounts receiving the data. Loading, empty, success, validation and failure states; 44 px targets; visible focus; WCAG 2.2 AA.

### D5 — The consent prompt, the loaders and the policy

- The prompt on `/[slug]` only when the page has a pixel on offer: fixed, no layout shift, reachable and operable by keyboard and screen reader, respects `prefers-reduced-motion`, readable over every theme and template (the page's theme colours are the customer's; the prompt must keep contrast on all of them), and a persistent, discreet way to change the answer later.
- The loaders, as decided in D1.
- The published policy: a page that describes what exists (what is loaded, when, by which company, what is stored in the browser and for how long, how to withdraw), linked from the prompt. A new top-level route segment goes into `reserved_slugs` (migration and TypeScript list); prefer a path under an existing reserved segment if one fits. Update the privacy notice so both stay true.

### D6 — ADR 0016 (custom domains): design only when §0 says DEFERRED

Write the decision record as *proposed*, clearly not implemented, so the work can start the day a domain exists: one domain per page or per workspace; apex and subdomain and the DNS records each needs; proof of control (recommended: a TXT record carrying a token bound to the workspace, checked before anything is attached); what prevents a second workspace from claiming a domain another one verified, or a domain whose DNS still points to us after the owner removed it; re-verification and what happens when the proof disappears; normalization, IDN and punycode, and a blocklist (our own origin, Vercel and Supabase hosts, look-alikes of the product); how the host reaches the right page in `proxy.ts` and which paths are never served on a customer's host (`/app`, the auth routes, `/r/`, `/api/` except what the public page needs) and why session cookies make that a security rule; canonical URL, Open Graph and the address shown in reports once a page has its own domain; certificate issuance through the hosting platform, the credentials it needs and the plan limits to confirm; audit, rate limits, and removal. List what must be verified with a real domain. Mark AC7 *not started* and do not build tables or screens for it.

### D7 — Custom domains: build only when §0 says BUILD

Promote ADR 0016 to accepted and implement it: migrations with RLS and pgTAP (a domain verified by workspace A cannot be added, verified or attached by workspace B; an unverified domain serves nothing; the same domain in two spellings is one domain; removal frees it under the stated rule; every role against every action; `anon`), the DNS check behind a resolver interface with an injected fake for tests, host routing with tests that app, auth, report and job routes answer 404 on a customer host, the settings flow with each state (waiting for DNS, verified, certificate pending, active, failed with the reason, removed), and a runbook. Attaching the domain to the hosting project and issuing a certificate change a hosted service: prepare the code, then stop and ask (§9) before the first real call. Evidence for AC7 must include one end-to-end run with the test domain, or the criterion is *prepared*, not verified.

### D8 — Tests and measurement

Vitest and pgTAP as above; the network-request check for AC6 kept as a script under `apps/web/scripts/` that says how to run it and how to remove what it created (accounts under `example.test`, never the founder's); the bundle-size comparison and the Lighthouse runs for AC6c with the exact commands. A test that the editor preview, `/r/<token>` and the app routes never include the loader. Every deterministic bug found on the way gets a regression test.

### D9 — Documentation and sprint closure

- `docs/adr/0015-*.md` and `docs/adr/0016-*.md`; update ADR 0008/0010 if the public document changed, ADR 0012 for duplication, and `docs/ARCHITECTURE.md`.
- `docs/THREAT_MODEL.md`: script injection through a pixel field; a vendor script reading the page (form fields, the Pix key); an agency member pointing a client's page at their own account; loading before consent; consent state lost or forged; and, for custom domains, the hijack and dangling-DNS cases as designed or as built.
- `docs/DATA_MAP.md`: the stored identifiers, the consent record kept in the visitor's browser, Meta and Google as recipients chosen by the page owner, the international transfer, and how export and deletion in Sprint 9 reach the configuration.
- `docs/OBSERVABILITY.md` and `docs/runbooks/` ("the client says the pixel shows no visits", "a pixel must be removed from a page now").
- `docs/ENVIRONMENTS.md`: "Passos de deploy da Sprint 8", ordered, covering both parts, and what the application does between each step. `.env.example` if a variable was added.
- `docs/ux/UX_DECISIONS.md`, `docs/ux/CONTENT_GUIDE.md`. The marketing home and the plans screen may now mention pixels, and custom domains only if they were built and verified; otherwise the plans screen must not list a custom domain as something a customer gets today. Check what part 1's generated plan features say about `custom_domain` and fix it if it promises the feature.
- `BACKLOG.md`: check off only what is done and verified; add the custom-domain follow-up with its blocker.
- **`docs/SPRINT_8_REPORT.md` as the final report of the whole sprint.** Remove the "in progress" marking and merge part 1's content with this part's into one document that follows AGENTS.md §20 and the structure of `docs/SPRINT_7_REPORT.md`: objective and outcome, decisions (including §0 and the split), the table of all criteria with honest status and direct evidence, deliverables with paths, exact final results, the AC6c measurements, security/privacy/accessibility/performance/operations implications, gaps and risks, questions for the founder, the list for the legal review, the staging deploy steps, and implications for Sprint 9 (terms, cookie policy and versioned acceptance; CSP including the vendor origins; rate limits on the new endpoints; export and deletion reaching billing and pixel data).
- Update `AGENTS.md` §22 to the real end state.

## 5. Out of scope

Google Tag Manager, TikTok, LinkedIn, Pinterest or any other vendor; owner-defined events or parameters; server-side conversion APIs; advanced matching; pixels at workspace level applied to every page; a consent management platform or a third-party banner; per-vendor consent choices beyond what D1 decides; consent logs stored on our servers; cookie walls; A/B testing; anything in the shared report; billing changes other than the new entitlement and fixes to part 1 defects (record each in the report); buying or configuring the product domain; the Sprint 9 CSP, rate limiting, moderation, export and deletion; a public API; staging provisioning.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken validation, RLS, headers or authorization to make a test pass.
- No new runtime dependency without a concrete need and a justification in the ADR. No vendor SDK package: the loaders are a few lines around a constant URL. Run `npm audit` after any dependency change.
- Migrations are forward-only and compatible with rolling the application back one version. `main` deploys to staging before the founder applies migrations: without them the public page renders exactly as today with no prompt, and the settings section says the feature is not available yet.
- Preserve the behaviour of Sprints 0–7 and of part 1. The first-party analytics numbers must not change. Don't touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px first for the prompt (it is seen inside Instagram's and WhatsApp's browsers), then about 768 px and desktop ≥1280 px; every template and theme from Sprint 5; the settings section in every state.
- With Docker and the local stack running, verify in a private browser window with the network panel open: a page without pixels (nothing new on the wire); a page with both pixels before answering, after declining, after accepting, after withdrawing, and after a reload in each state; with storage blocked; with the vendor hosts blocked (the page and its links still work); the editor preview and `/r/<token>` (no loader); an identifier pasted as a snippet in the form and sent directly to the server; set and remove as editor and as a member of another workspace by calling the server directly; a workspace moved to Free with a pixel configured (the public page stops offering it within the time the ADR states, and the configuration is still there when the plan returns); a duplicated page. Made-up identifiers are enough: what is being verified is what leaves the browser, not what arrives at the vendor. If any of this can't be done, say so and mark the item *prepared*, not verified.

## 8. Work order

1. **Read and verify the starting point:** read §2, inspect the git state, branch `feat/sprint-8-pixels` from wherever part 1 actually lives (main if merged, its branch if not; say which), and run `npm run test:db` and `npm run check` before changing anything. If either fails, fix that first and record what was wrong. Summarize part 1's real state, the plan, the schema drafts, the risks and how AC6 will be evidenced. Record the public route's client JS size now, as the baseline.
2. **Finish anything part 1 left partial** that §3 assigns to it.
3. **ADR 0015.**
4. **Pure modules + Vitest** (validators, consent state machine, event mapping, URL builders).
5. **Migrations + pgTAP;** iterate until `npm run test:db` passes; regenerate types; run advisors.
6. **Settings section.**
7. **Consent prompt, loaders, policy page.**
8. **Measurements** (bundle, Lighthouse, the network check) and the **browser verification** in §7.
9. **Custom domains:** ADR 0016 as design (D6), or the build (D7) if §0 says so.
10. **Docs, runbooks, privacy and marketing review, backlog, the final sprint report, `AGENTS.md` §22.**
11. **Final gate:** review the full branch diff for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit along the way in coherent Conventional Commits (for example `feat(db): add per-page tracking pixels behind an entitlement`, `feat(public): ask for consent before loading tracking pixels`, `docs(adr): propose the custom-domain design`).

**If this part is at risk of overrunning,** cut in this order and record each cut in the report: the mapping of value actions to vendor events (keep the page view); the Lighthouse comparison across every template (keep one page with and without a pixel); the expiry of a stored answer; ADR 0016 down to its hijack-prevention and routing sections. Do not cut identifier validation in the database, the refusal of GTM, nothing-before-consent, the equal decline option, the zero-cost guarantee for pages without pixels, the entitlement check, server-side authorization, the policy page, accessibility of the prompt, or the sprint report.

## 9. Stop and ask for approval before

- applying migrations, creating secrets, adding a domain, issuing a certificate, changing settings or creating anything on a **hosted** Supabase project or on Vercel (including through MCP tools); use the local stack only;
- accepting any tracking identifier other than a Meta Pixel id and a GA4 measurement id, or any field that takes markup, a URL or a script;
- loading anything from a third party before a visitor's consent, or setting a cookie on visitors;
- sending any data we collect to a vendor from the server;
- running `npm run db:reset` or anything else that deletes local data;
- adding any paid service, vendor, subprocessor or runtime dependency not justified in the ADR;
- any destructive migration or data loss;
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- writing or deleting anything outside this repository;
- expanding scope beyond §4, or cutting an item that is not in the §8 cut list.

## 10. Final response format

1. Outcome of the whole sprint in 3–5 sentences, including plainly what happened to custom domains.
2. Acceptance-criteria table for all Sprint 8 criteria (status + evidence), saying which part produced each piece of evidence.
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), advisors, build (routes), the bundle-size comparison, the Lighthouse table, and the network-request check in each consent state.
5. Security and privacy negative cases tested (snippet and GTM ids refused at the form, the server and the database; nothing before consent; declined and withdrawn; storage blocked; vendor blocked; each role against each action; lost entitlement; duplication; preview and report).
6. Decisions awaiting founder confirmation (the new UX ids and the ADR 0015 and 0016 choices), the list for the legal review, any item cut from scope, and any defect of part 1 fixed here.
7. Ordered staging deploy steps for the founder for the whole sprint, blockers, pending external setup, what is needed to build custom domains, and the recommended starting point for Sprint 9.
