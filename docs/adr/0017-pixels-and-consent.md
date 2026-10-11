# ADR 0017 — Meta Pixel and Google Analytics per page, with visitor consent

- **Status:** accepted for implementation on 2026-10-10. Verified on the local stack only. **No request was made to Meta or Google, and the consent notice was not reviewed by counsel.**
- **Sprint:** 8, part 2 of 2 (with ADR 0016, custom domains)
- **Related:** ADR 0007 (public renderer), ADR 0011 (customer analytics), ADR 0014 (entitlements follow the plan), ADR 0015 (security headers)

## Context

Paid plans promise pixels: the page owner wants visits to their page to reach their own Meta Ads and Google Analytics accounts. The acceptance criterion is that pixels respect the consent configuration and the published policy. Two invariants constrain the design: arbitrary user-supplied JavaScript is prohibited (AGENTS.md §6.14), and public pages must stay fast and useful when any measurement fails.

Pixels are different from the product's own customer analytics (ADR 0011), which uses no cookie, no browser storage and no third party. A vendor pixel sets cookies and sends the visit to a third party outside Brazil, under the page owner's account.

## Decision

### Identifiers only

`public.profile_pixels` holds, per page, a Meta Pixel ID (`^[0-9]{10,20}$`) and a Google Analytics 4 measurement ID (`^G-[A-Z0-9]{6,14}$`). There is no field that takes a script, a snippet or a URL. Google Tag Manager containers (`GTM-…`) and Universal Analytics IDs are refused on purpose: a container is a way to run arbitrary scripts.

The format is checked four times: the form mirror (`parsePixelsInput`), the RPC (`set_profile_pixels`), the table checks, and again in the browser loader before anything is added to the page (`parsePublicPixels`, `loadPixels`).

### The product's own loader

`modules/pixels/loader.ts` is the only code that runs. After consent it adds the two vendor libraries at fixed addresses (`https://connect.facebook.net/en_US/fbevents.js`, `https://www.googletagmanager.com/gtag/js?id=<id>`), with the standard queue stubs, and reports **one page view** to each tool. No other event is sent by the product in this sprint.

### Consent first, per page

`PixelConsent` is mounted only by the two public routes, and only for a page whose identifiers are in force. It is rendered after hydration, fixed to the bottom of the viewport (no layout shift, never the largest paint).

- Until the visitor taps **Aceitar**, nothing is requested from Meta or Google: no script, no image, no connection.
- **Recusar** is the same size and one tap away.
- The choice is kept in `localStorage` under `lnk_pixel_consent:<slug>`, with the identifiers it was given for: accepting one owner's tools says nothing about another page on the same domain, and a new identifier asks again. If storage is blocked (some in-app browsers), the choice lasts for the visit.
- A link at the end of the page reopens the choice. Withdrawing consent reloads the page, because a library that already ran cannot be unloaded.
- The notice names the tools in use and says data of the visit is sent to those companies.

Opt-in was chosen as the default because it is the reading that needs no legal conclusion to be safe. The consequence is stated to the owner on the settings screen: vendor numbers will be lower than the product's own results.

### Read at request time, never in the snapshot

`get_public_page` returns `pixels` (`{"meta": …, "ga": …}`) only while the workspace plan has `tracking_pixels`. Identifiers are not part of the published document: saving them takes effect without republishing, losing the plan turns them off without republishing, page duplication does not copy them (ADR 0012), and shared reports never see them (ADR 0013). The preview and the editor reuse the renderer without the consent component, so they never load a pixel.

### Content-Security-Policy scoped to public pages

The vendor origins are allowed only where a published page is rendered: the route `/[slug]` (a source pattern that excludes every reserved top-level route, so sign-in, sign-up and the legal pages keep the baseline) and `/` on a custom hostname (ADR 0016). The product area, the report and every other route keep the baseline policy unchanged. A Vitest test asserts the two policies differ by exactly the vendor origins and that `next.config.ts` installs them only there.

Allowing the origins does not load anything: it only makes the request possible after consent.

### Entitlement, roles, audit

New entitlement `tracking_pixels` (Free: no; Pro and Agency: yes), mirrored in `lib/product.ts` with the existing drift test. `pixels.view`: every member; `pixels.manage`: owners and admins, because turning a pixel on sends visitors' data to a third party. Clearing identifiers is allowed on any plan. `pixels.updated` is audited with which tools are on, never the identifiers; application logs carry outcomes only.

## What is verified, and what is not

Verified locally: pgTAP `190-domains-pixels` (roles, formats, plan loss, duplication, audit content); Vitest for the model, the service, the loader against a fake `window`/`document`, the consent storage rules, the import graph (who can mount the consent component and who mentions a vendor address) and the two policies; `scripts/domains-lifecycle.mjs` for the forms, the public HTML (identifiers present for the notice, no vendor address) and the policy header of each route.

**Not verified:** that Meta and Google receive and accept the page view; that the allowed origins are complete for both libraries in every browser (the Google list follows its published CSP guide for GA4; Meta publishes none); Google Consent Mode; the consent notice on real phones and inside the Instagram and WhatsApp in-app browsers; the effect on LCP and INP once a vendor library runs.

## For the legal review (nothing below is implemented as a conclusion)

- Roles: the page owner decides to use the tools and receives the data in their own accounts; the product provides the mechanism. Whether the product is an operator for this processing, and what the Terms must say about the owner's duties to their visitors.
- Whether opt-in consent is the right legal basis and whether the wording of the notice is sufficient; whether the owner needs to publish their own privacy notice and how the page should link to it.
- International transfer: the visitor's browser sends data to Meta and Google directly.
- Whether the product's privacy notice and cookie policy must mention the `lnk_pixel_consent:*` storage entry and the vendor cookies.
- Record of consent: today the choice lives only in the visitor's browser; the product keeps no log of who consented.

## Not built

- Conversion events (a lead, a WhatsApp click, a Pix copy) sent to the pixels.
- Google Tag Manager, TikTok, other vendors, server-side conversion APIs.
- A consent log, Consent Mode signals, a per-owner privacy-notice link.
- Pixels in the workspace export (`export_workspace_data`).

## Alternatives considered

- **A field for the vendor snippet.** Rejected: arbitrary JavaScript on a domain shared by every customer.
- **Loading the pixel without asking, with an opt-out.** Rejected as the default until counsel says otherwise.
- **One consent for the whole domain.** Rejected: pages on the product domain belong to different controllers.
- **Allowing the vendor origins site-wide.** Rejected: it would widen the policy of the signed-in product for no reason.
- **Identifiers in the published snapshot.** Rejected: a plan change would need a republish and duplication would copy them.

## Consequences

- Public pages with pixels have a wider script, connect and image policy than the rest of the product.
- Visitors of pages with pixels see a notice the product controls; owners cannot restyle or remove it.
- The first browser storage entry written by a public page (the consent choice). The customer-analytics collector stays storage-free.

## Addendum (2026-10-11): the "Aceitar" path in a browser

`apps/web/scripts/mobile-a11y.mjs` (local stack, production build, Chrome at phone width) now runs the accept path on a published page with a Meta Pixel ID and a GA4 measurement ID that belong to nobody. The two vendor libraries were **really fetched** from `connect.facebook.net` and `www.googletagmanager.com`; every other request to Meta or Google (the ones that would report a visit) was answered locally, so nothing was sent to them.

Observed: nothing requested before a choice; after **Aceitar**, both libraries requested (the Google tag with the page's measurement ID), `fbq` and `gtag` initialised, a request to `www.google-analytics.com`, the notice gone, the choice remembered on reload, and **no Content-Security-Policy violation**.

Still not verified: that an event actually arrives in a real Meta or Google account (needs real IDs, on production); the vendor libraries' behaviour with real IDs, which may contact origins not seen here; conversion events; the legal review of the notice.
