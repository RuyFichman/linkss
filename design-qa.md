# Home showcase — visual QA, 2026-10-27

## Scope and visual truth

Replace only the home `#modelos` gallery shown in `nosso.PNG` with five polished international page compositions based on the supplied real-page references. This is a production-repository change, not a new prototype application or a clone of any customer's identity. The existing hero, editor illustration and feature illustration are outside this task.

Source visual truth paths supplied by the founder:

- `C:/Users/Pichau/Downloads/base1.PNG` — photographer, creator and lavender-farm directions.
- `C:/Users/Pichau/Downloads/base2.PNG` — plum recipe page and pink coaching page.
- `C:/Users/Pichau/Downloads/base3.PNG` — five-card proportions, spacing, elevation and cyan musician page.
- `C:/Users/Pichau/Downloads/nosso.PNG` — exact section to replace.

The new English identities are Olivia Hart, The Green Table, Maya Bennett, Willow & Wild, and Nova Reed. They are original presentation content, not real Linkfav customers, testimonials, traffic or revenue evidence. The UI presents possibilities, without a customer-count or endorsement claim. It does not offer these as one-click editor templates.

## Implementation evidence

- `apps/web/src/app/(marketing)/showcase.tsx`: server-rendered visual compositions; uses the repository's theme fonts and existing social glyphs.
- `apps/web/src/app/(marketing)/showcase-gallery.tsx`: client interaction limited to opening the shared accessible Dialog.
- `apps/web/public/images/showcase/`: seven original ImageGen photographs, plus two square avatar crops, compressed as nine WebP files (912,432 bytes total). Originals remain outside the repository. No downloaded customer photos, external image requests, imitation partner player, or placeholder initials are used in this gallery.
- `docs/ux/evidence/showcase-desktop.webp`: whole section.
- `docs/ux/evidence/showcase-rail.webp`: five-card composition.
- `docs/ux/evidence/showcase-detail.webp`: enlarged photographer page.
- `docs/ux/evidence/showcase-mobile.webp`: horizontal gallery at 390px.
- `docs/ux/evidence/showcase-mobile-detail.webp`: coaching preview on mobile.
- `docs/ux/evidence/showcase-qa.json`: automated browser results.

## Viewport, normalization and comparison

Chrome/Playwright was explicitly authorized by the founder after both integrated browser and Windows Computer Use failed with `failed to write kernel assets`. Browser verification was repeated against the production build with `next start` at `http://localhost:3100`.

Desktop CSS viewport: 1440 × 1100, deviceScaleFactor 1. Each implementation frame is 248 × 540 CSS pixels, displaying a 360px inner composition at scale 0.688889. The full reference `base3.PNG` is 1415 × 668 pixels; normalized to 1440 × 680 for the board. The rendered rail is 1440 × 648 pixels. Reference includes top controls and a customer-list link that are deliberately not copied: Linkfav does not implement those controls and these are not customer endorsements. Comparison concerns composition, density, imagery, typography, palette and credible page content, not identical customer text.

Full-view comparison board, opened and inspected: `.npm-cache/showcase-comparison.webp` (source above rendered implementation, both 1440px wide). Focused comparison board, opened and inspected: `.npm-cache/showcase-focused-comparison.webp` (pink page from base2, 248 × 540, beside the coaching frame at the same dimensions). Reference photos remain in the founder's Downloads rather than being redistributed in repository assets.

State: default desktop gallery; all five opened/closed; mobile gallery after returning from preview; coaching modal. Mobile/tablet viewports: 320, 390 and 768 × 900 CSS pixels, density 1. These are browser viewport checks, not real-device tests.

## Findings and iteration history

1. **[P2, fixed] Coach photo cropped off the face in the lower image block.** Initial desktop capture placed the crop around the torso, weakening the portrait-led page. Changed `.showcase-coach-feature img` to `object-position: center top`. Recaptured all states and inspected the combined full-view and focused boards. Face is visible in the post-fix evidence.
2. **Tooling correction, not a product defect:** the first dev-server browser pass used 127.0.0.1, which Next refused for dev resources. Repeated with localhost, then repeated against the production build; no origin/security configuration was weakened.
3. **Test correction, not a product defect:** reduced-motion's global duration is 0.01ms; the assertion now accepts that near-zero duration instead of requiring the literal string `0s`.

Post-fix comparison has no remaining actionable P0/P1/P2 findings in this section's scope.

## Required fidelity surfaces

| Surface | Assessment |
|---|---|
| Fonts/typography | Lora/Georgia for editorial and botanical pages, existing Poppins for coaching, recipes and music; distinct name treatments, compact captions and secondary copy follow the references. Text is HTML rather than a screenshot. |
| Spacing/layout | Five equal portrait frames, narrow gaps, restrained shadows and 30px corner radius. Overflow stays inside the focusable horizontal rail on smaller screens; expanded content stays within the dialog. |
| Colors/tokens | Ivory/sage, dusty plum, pink, botanical cream/green and cyan/navy reproduce the supplied directions. Flat theme surfaces, not placeholder gradients. |
| Image quality | Original subject-specific photography, intentional crops, explicit dimensions and lazy loading. Two 192px square avatars measured at 96 × 96 CSS pixels in the mobile modal. |
| Copy/content | Page content is English and internationally framed. The surrounding navigation/captions remain Brazilian Portuguese. No Brazilian locality, Pix, WhatsApp-only flow, invented engagement count or customer testimonial is added. |
| Icons | Existing public-renderer social glyphs reused consistently; no new icon dependency or decorative square placeholders. |

## Interaction and accessibility verification

- Five accessible gallery triggers open their matching page, with `aria-haspopup=dialog` and descriptive names.
- Escape closes each preview and returns focus to its trigger; shared native dialog preserves modal keyboard behavior.
- The preview's creation CTA was actually clicked and navigated to `/cadastro`; no form was submitted and no account/data was created.
- No document overflow at 320/390/768px; no horizontal dialog overflow. Mobile preview retains all content through vertical scrolling.
- No broken images, browser runtime errors or CSP console errors in the successful production pass.
- Reduced motion respected. Visible focus and large touch targets retained.
- No new database, vendor, analytics, credentials, routes or package dependency. Public-page rendering and publishing logic are unchanged.
- These checks are not a formal WCAG audit, screen-reader test, real phone test or field performance measurement. The gallery loads roughly 891 KiB of photo assets if all nine images are fetched; images are below the fold and lazy-loaded. It adds the existing Lora/Poppins font faces when needed.

## Verification and handoff

`npm run check`: PASS — lint without warnings, typecheck without errors, 1,391 tests in 61 files, production build successful with Next 16.4.1. No new unit tests were added for this visual replacement; behavior was checked in the actual browser. Prior pilot-readiness changes in the working tree were preserved. No deployment occurred.

Implementation checklist: five distinct pages, original photos, local assets, desktop/mobile rendering, preview interactions, creation navigation, console checks, combined visual comparisons and required repository checks completed.

Follow-up polish: real-device and screen-reader testing; if acquisition traffic warrants it, create additional static image sizes. Those do not block this visual delivery.

final result: passed

## Features illustration follow-up — 2026-10-28

The founder requested the same realism for the Lia Moraes illustration beside the home features. `#recursos` now uses `FeaturePagePreview`, a compact rendering of the gallery's Olivia Hart identity: the same original editorial photographs, Lora font, social glyphs, biography and portfolio actions. Reusing the existing identity avoids depicting the same generated person under two names. The hero and editor illustrations retain their existing compositions.

`PhotographerPage` keeps its full version in the gallery and dialog. Its compact version omits the eyebrow, subtitle, link note and final caption to keep the whole page visible in the smaller frame. The features version has a portrait cover, ivory surface, forest-green primary action, outlined secondary action and wedding photograph, all rendered as HTML. Styles are scoped to `.home-feature-page`.

The illustration stays `aria-hidden`, with no focusable controls, navigation or event collector. It represents an example composition, not a customer endorsement. No new image assets, fonts, dependencies, services, routes or data collection were added. Both photographs remain local, dimensioned and lazy-loaded; their URLs match the gallery's existing assets.

Visual checks used the integrated browser against the local production build at `http://localhost:3101/#recursos`: 320 × 900 and 1440 × 1100 CSS pixels, plus the normal panel viewport. At 320px the 272px frame fits the page with no horizontal overflow, both images load, and the section stacks vertically. At 1440px the two-column layout and full illustration fit, with both images loaded and no horizontal overflow. The browser console reported no warnings or errors. The gallery's default full composition is unchanged. These are viewport checks, not real-device or screen-reader tests.

Evidence:

- `docs/ux/evidence/feature-page-mobile.png`: features illustration at 320px.
- `docs/ux/evidence/feature-page-desktop.png`: features section at 1440px.
- `docs/ux/evidence/feature-page-preview.png`: focused detail of the new illustration.

Verification: `npm run check` passed — lint without warnings, typecheck without errors, 1,391 tests in 61 files and successful production build (Next 16.4.1). No new unit tests were needed for this decorative visual change. Deployment and production verification remain pending.

## Gallery expansion — 2026-10-28

The founder requested five additional presentations in the `#modelos` gallery shown in the supplied screenshot. The five existing pages and the compact features illustration are preserved. Five new original English identities bring the gallery to ten:

| Identity | Composition |
|---|---|
| Sable Studio | Handmade ceramics; warm sand, sienna, serif wordmark and a tactile product still life. |
| Form & Field | Interior design; architectural photography, warm white, charcoal, strong typography and a left-aligned portfolio composition. |
| Petal Theory | Florist; seasonal flowers, burgundy, blush, large serif name and rounded cream action. |
| The Salt House | Coastal guesthouse; terrace photography, chalk white, sea blue and quiet editorial typography. |
| Sunday Social | Coffeehouse; amber, espresso brown, a coffee-and-pastry photograph and a warm menu-style composition. |

Implementation: `showcase.tsx` contains the five new page compositions and gallery entries; `showcase.css` contains their scoped styles. At widths of 1400px or more the gallery uses two rows of five fixed-size frames. Below that it retains the focusable horizontal rail and scroll snapping. This also avoids centering ten overflowing cards and making the first cards unreachable. `HOME_COPY.templates.lead` now correctly says ten ways.

Five photographs were generated with the built-in ImageGen tool, inspected and compressed into local 720 × 1080 WebP files: 605,108 bytes total (about 591 KiB added; 1,517,540 bytes for the gallery's fourteen image assets if all are fetched). They use the existing lazy-loaded, dimensioned image component. No new font, dependency, route, service, analytics, destination or editor-template capability was added. Identities are illustrative, with no invented customer, testimonial or performance claim. Asset paths and the exact final prompts are recorded in `docs/ux/SHOWCASE_EXPANSION_ASSETS.md`.

Verification used the integrated browser against the local production build at `http://localhost:3101/#modelos`:

- All ten matching dialogs opened with one page, loaded images and a `/cadastro` creation link. Escape closed every dialog and returned focus to the correct trigger.
- The five new dialogs were also opened at 320px; none overflowed the document or dialog horizontally, and every image loaded. The Petal Theory mobile view was captured and inspected.
- Layouts at 320, 390, 768, 1400 and 1440px had ten frames and no document overflow. At 1400 and 1440px, five equal columns produced exactly two rows with no horizontal rail overflow.
- The five new page frames were inspected together in the desktop gallery. The console reported no warnings or errors.
- `npm run check`: PASS — lint without warnings, typecheck without errors, 1,391 tests in 61 files and successful Next 16.4.1 production build. `git diff --check` passed. No implementation-mirroring unit tests were added for the decorative compositions.

Evidence: `docs/ux/evidence/showcase-expanded-desktop.png`, `showcase-expanded-new-row.webp`, `showcase-expanded-mobile-detail.png` and `showcase-expanded-qa.json`. The new-row board combines actual screenshots of the five gallery frames at the normal panel size, normalized to 248 × 607px each; the desktop capture separately records the two-row layout. These checks do not establish real-device, screen-reader, formal WCAG or field-performance results. Deployment and production verification remain pending.

## Continuous, draggable gallery — 2026-10-28

The founder requested automatic continuous horizontal movement and press-and-drag navigation on desktop and mobile. This supersedes the earlier two-row layout: all ten presentations now form one row at every width. Existing page compositions, photographs and enlarged previews are preserved.

`showcase-gallery.tsx` renders the accessible original sequence between two visual copies. Only the ten original buttons are in the accessibility tree and tab order; clicking a visual copy opens the matching page and returns dialog focus to its accessible original. Before JavaScript initialises, CSS shows only the original sequence as a native scroller. The copies reuse existing image URLs rather than adding image assets.

`use-showcase-motion.ts` coordinates native scrolling, animation and Pointer Events. Animation advances at 32 CSS pixels per second and rebases to the identical middle sequence when crossing either seam. Dragging locks to a horizontal gesture after an 8px threshold, captures the pointer and suppresses the following click; an ordinary click still opens the preview. `touch-action: pan-y pinch-zoom` retains vertical page scrolling and pinch zoom. Release, cancellation, lost capture and window blur end the drag. There is no new library, dependency, service, collection or public route.

The visible pause/resume control is in `SHOWCASE_COPY`. Automatic motion stops while holding the pointer, showing a preview, navigating the gallery by keyboard, hiding the document or moving the gallery offscreen. The operating-system reduced-motion preference disables autoplay and leaves manual navigation available. Fractional animation progress survives scroll rounding, and elapsed frames are bounded to avoid jumps after a stalled/backgrounded frame. Resize preserves the place in the repeated sequence.

Verification against the local production build at `http://localhost:3101/#modelos`:

- Automatic movement changed the measured scroll offset from 3865 to 4495px. Pause held 4716px unchanged across observations; resume advanced again. Captures were taken with motion paused because the integrated screenshot tool waits for visual stability.
- A real mouse drag of 900px at a 1440px viewport crossed the forward seam: 4716 → 2848px with a 2768px cycle. Reversing the drag returned to 4716px. Neither drag opened a dialog or left the dragging state active.
- Clicking the visible trailing copy of Olivia Hart opened her matching dialog; closing returned focus to `data-showcase-original="photography"`, outside any hidden ancestor.
- Tab focused the rail with visible focus and held the scroll offset at 4343px. The next Tab reached Olivia's original button; Enter opened her preview and Escape restored focus.
- At 320px, dragging by 200px changed 4741 → 4941px; reversing returned to 4741px without opening a preview. A subsequent ordinary click opened The Salt House, with no horizontal dialog overflow. The document did not overflow, and computed touch behaviour retained `pan-y pinch-zoom`. This was a mouse pointer in a mobile-sized viewport, not a physical finger/device test.
- Ten original buttons and zero tabbable visual-copy buttons were observed. The application console had no warnings or errors.
- Thirteen deterministic tests cover both loop seams, multiple cycles, equal speed at 60/120Hz, background-frame bounds, click tolerance and horizontal/vertical gesture intent. `npm run check`: PASS — lint without warnings, typecheck without errors, 1,404 tests in 62 files, successful Next 16.4.1 production build. An earlier full run hit the existing Sprint 5 markup-test timeout; the affected suite and the new suite passed together (24 tests), and the unchanged full gate then passed. No timeout, sanitisation or security control was weakened.

Evidence: `docs/ux/evidence/showcase-motion-desktop.png`, `showcase-motion-mobile.png` and `showcase-motion-qa.json`. Physical iOS/Android touch, a screen reader and changing the OS reduced-motion preference were not exercised. Deployment and production verification remain pending.

## Plan screen (UX-106) — 2026-10-28

Scope: the signed-in billing screen `/app/w/<workspace>/plano`, presentation only. Server actions, `availableBillingActions`, routes, query parameters, data reads, prices and entitlements are unchanged. The screen now renders `planScreen` (`modules/billing/plan-screen.ts`, pure and unit-tested) through `modules/billing/components/plan-screen.tsx`. The route keeps loading and authorization. The changes:

- The current plan comes first: a large plan name, a status badge, then either facts (amount and next charge) for a subscription in good standing or the state sentence, boxed when there is something to fix.
- Each state has at most one primary action. Cancelling is a quiet link, separate from the buttons.
- The environment notices sit between the plan and the catalogue.
- The workspace's failing-payment banner is hidden on this screen through `body:has([data-plan-screen])`, the pattern the editor already uses.
- Without a subscription, the catalogue offers a Monthly/Yearly choice made of native radios plus `:has`, so it works without JavaScript; where `:has` is missing, both intervals stay visible. With a subscription, the catalogue shows that subscription's own interval.
- On wide screens the three cards line up their rows with CSS subgrid.
- The payment history is a list with named values instead of a table that needed sideways scrolling.

Before/after measurements on the local production build, sandbox billing with the Stripe emulator (`scripts/billing-lifecycle.mjs --serve`). The qa-billing workspace was put into each state by SQL on the local stack only:

- Each capture set covered ten states (free, manual, incomplete, active monthly, active yearly, canceling, downgrading, past due, grace expired, ended) for the owner, the admin for free, active monthly and past due, at 320/390/768/1280 px or 390/1280 px. Billing off and an `?aviso=` notice were captured separately.
- Every capture answered 200 with no document overflow, no visible text under 12px and no non-inline control under 44px. Before the change, axe-core 4.13 WCAG 2.2 A/AA reported no violation at 320/390/1280 px; after it, axe again reported none, in every state and both billing modes.
- Past due, owner: the bottom of the "Atualizar forma de pagamento" button moved from y=867 to 646 at 390px, and from 1041 to 741 at 320px. Before, the banner, the title and the test-environment notice all came first.
- The payment history at 390px used to hide the "Recibo" column behind sideways scrolling, and at 320px also part of "Situação". Now each row is date and amount, then status badge and receipt, with nothing to scroll.

Interaction (Chrome, 390px, touch emulation): monthly prices and buttons show first. Tapping "Anual" shows yearly prices, the saving and the yearly buttons only. The radios are a group named "Mostrar preços". The arrow keys move the choice. Keyboard focus draws a 3px outline, and each choice is 44px tall. The failing-payment banner shows on the pages list and is hidden on the plan screen. No console error, page error or CSP violation. 11 checks pass.

Product typeface note: `tabular-nums` widens the decimal comma of an amount in Schibsted Grotesk ("R$ 14 , 90"), so tabular figures are applied to dates only.

Gates: `node scripts/billing-lifecycle.mjs` passes 156 checks. Two checks that read the old active-state sentence now read the facts list. `npm run check` passes: lint without warnings, typecheck without errors, 1,444 tests in 64 files (40 of them new for this screen), and a successful Next 16.4.1 production build.

Screenshots were kept outside the repository. Not verified: a real phone, Safari/iOS or Firefox, a screen reader, a real Stripe sandbox or live account (the provider portal and checkout were not opened), deployment and production.

## Home plans and comparison (UX-107) — 2026-10-28

Scope: the `#planos` section of the marketing home, redrawn after a reference the founder supplied, and a new `#comparar` section right after it. `Pricing` and `PlanComparison` live in `app/(marketing)/pricing.tsx`, which has no `next/font` import, so Vitest can render them. What each plan includes comes from `modules/billing/comparison.ts`, which is pure and unit-tested and takes every limit and plan feature from the entitlements. The "2 meses grátis" label comes from `yearlyFreeMonths` in `modules/billing/marketing.ts`; it appears only when the yearly price leaves out the same whole number of months for every paid plan. No route, entitlement, price, dependency or billing rule changed.

- The section has a pill link to the comparison, the title "Planos e preços", the lead, and three cards with a coloured glow.
  - The free card carries a gradient badge.
  - Each card has its price, the yearly saving, a description, a checklist and a full-width button.
  - From 860px the cards share six rows through CSS subgrid, so descriptions, lists and buttons line up.
- Kept from the reference only what is true of the product:
  - The badge says "Disponível agora", or "Comece por aqui" while paid plans are on sale, never "Mais popular".
  - There is no trial button.
  - Paid amounts, the Monthly/Yearly choice and the subscribe buttons appeared only with `live` billing (ADR 0014); before that, paid cards said "Em breve". Since 2026-10-29 (founder decision, UX-109) they always appear and the badge says "Comece por aqui".
- The comparison is a real `<table>`: column headers for the plans, a `rowgroup` header per group and a row header per feature.
  - "Sim" and "Não" are words with a check or a dash. Below 480px only the icon shows, and the word stays for screen readers.
  - Limits are amounts.
  - The header row is sticky below the floating header bar.
  - The custom-domain row and card line appear only when `DOMAINS_SIGNING_SECRET` is set, as on `/precos`.
  - The FAQ answer about domains says "Sim" only while paid plans are on sale and domains are configured.

Measurements on local production builds, Chrome, captures at 320/390/768/1280 px of `#planos` and `#comparar`, using a scratchpad script outside the repository:

- Before, the existing home: status 200, no overflow, no text under 12px, no control under 44px, axe-core 4.13 WCAG 2.2 A/AA clean.
- After, default configuration (billing off, no domain secret): the same at every width, with no table cell overflowing. At 320px the table takes 8px side margins instead of the 20px gutter.
- After, a throwaway local build with `BILLING_MODE=live` and placeholder keys (never deployed; the home calls no provider): the same at every width.

Interaction on the on-sale build, Chrome at 390px with touch emulation:

- Monthly amounts show first.
- Tapping "Anual" shows only the yearly amounts.
- The radio is named "Anual 2 meses grátis" inside a group named "Mostrar preços".
- The arrow keys move the choice, and keyboard focus draws a 3px outline.
- The pill link scrolls to the comparison.
- The plan names stay visible below the header bar while the table scrolls.
- No console error, page error or CSP violation.

9 checks pass.

Gates: `npm run check` passes, with lint showing no warnings, typecheck showing no errors, 1,462 tests in 66 files, and a successful Next 16.4.1 production build. 18 of those tests are new, covering the comparison model, the render of both billing modes and the free-months label.

Not verified: a real phone, Safari/iOS or Firefox, a screen reader, deployment and production.

## Plan screen refinement (UX-108) — 2026-10-28

Scope: `/app/w/<workspace>/plano`, on top of UX-106, and the parts it now shares with the home plans (UX-107).

New on the plan screen:

- A **Uso desta conta** card. It shows pages, people and image space against the plan in force, with a bar and the state in words ("No limite", "Acima do limite"). Open invitations count as seats, and archived pages are named when pages are at the limit.
  - Usage is read with `fetchWorkspaceUsage`, the same reader the confirmation screen uses, and owners and admins may read every count. When it fails the card is left out and the rest of the screen renders.
  - The rows come from `planScreen` (pure, unit-tested), with limits from the workspace's plan (`workspaces.plan_id`).
- The catalogue cards now have the home's anatomy: large price, the yearly saving when there is an interval choice, "Tudo do" the previous plan plus only what grows, the action at the bottom, rows aligned with subgrid, and a "Plano atual" badge.
  - The Monthly/Yearly choice carries "2 meses grátis" (`yearlyFreeMonths`).
- **Comparar todos os recursos** opens the home's comparison table under the cards, with the plan names sticky at the top of the viewport.
- The test-environment notice is a compact line. It still contains the full sentence.

Shared with the home: `.plan-interval`, `.plan-offer*` and `.plan-compare*` live in `globals.css`. `PlanComparisonTable` is in `modules/billing/components/plan-comparison.tsx`, and `planHighlightText` is in `modules/billing/presentation.ts`. The words are in `BILLING_COPY.highlights` and `BILLING_COPY.comparison`, moved out of `HOME_COPY`. `home.css` keeps only the home's own spacing and the sticky offset under its floating bar. Server actions, gating, routes, query parameters, prices and entitlements are unchanged.

Measurements on the local production build, sandbox billing with the Stripe emulator (`scripts/billing-lifecycle.mjs --serve`, qa-billing workspace put into each state by SQL on the local stack only):

- Ten states for the owner, and three for the admin, at 320/390/768/1280 px or 390/1280 px. Every capture answered 200 with no document overflow, no text under 12px, no control under 44px and no axe-core 4.13 WCAG 2.2 A/AA violation.
- With the comparison open: axe clean and no overflow at 320/390/1280 px.
- Past due, owner: the bottom of "Atualizar forma de pagamento" is at y=650 at 390px and y=745 at 320px (UX-106: 646 and 741; the larger plan name adds 4px).
  - A first version put usage inside the plan card, which pushed the action to 855 and 974. Usage is now a card of its own, after the plan on phones, and a render test pins the order.
- Home plans and comparison, rechecked after the CSS moved: still clean at 320/390/768/1280 px.

Interaction (Chrome, 390px, touch emulation), 16 checks pass:

- The interval choice works by tap and arrow keys, with visible focus and 44px targets.
- The comparison starts closed, and its 44px summary opens a table named by it.
- The table head stays at the top while scrolling.
- The usage card shows.
- The failing-payment banner is hidden on this screen only, and the fix sits inside the first 700px.
- No console error, page error or CSP violation.

Gates:

- `node scripts/billing-lifecycle.mjs` passes 156 checks, with 0 leaking log lines. The yearly-saving check now reads "Economize R$ 29,80 por ano".
- `npm run check` passes: lint without warnings, typecheck without errors, 1,474 tests in 66 files, and a successful Next 16.4.1 production build.

Not verified: a real phone, Safari/iOS or Firefox, a screen reader, a real Stripe sandbox or live account, deployment and production.

## Page list refinement (UX-110) — 2026-10-29

Scope: the workspace page list, `/app/w/<workspace>` (`app/app/w/[workspaceId]/page.tsx`, `.page-usage*`, `.page-toolbar`, `.page-search*`, `.page-filter*`, `.page-order` and `.page-row*` in `globals.css`). Queries, URL parameters, permissions, actions and the onboarding checklist are unchanged.

- Plan usage is a meter ("6 de 10 páginas" and a bar, in the warning color at the limit); the text carries the state, and the bar is hidden from screen readers.
- One toolbar: a search pill (icon, a label for screen readers, "Buscar" inside), the status filters as one pill group with the current one in ink and the count as a number, and the order as an icon button. The focus ring goes around the whole search pill. Below 640px the filters wrap as separate pills, so none is hidden.
- The pages are rows of one card. Name, status and "Alterações não publicadas" share a line. Under them comes the address, which is a link to the live page, in a new tab with a screen-reader note, only for published pages. From 768px the rows share the list's columns through subgrid, so the actions line up even when one says "Desarquivar"; phones show them two by two under the page.
- The page's grid column is `minmax(0, 1fr)`: before, at 390px the column grew to 527px and the document scrolled sideways.

Verified on the local dev server with a disposable agency workspace (`qa-pagelist-owner@example.test`, six pages: published, published with unpublished changes, draft, archived), Playwright with the installed Chrome:

- 320, 390 and 1280px: no document overflow, and no axe-core WCAG 2.2 A/AA violation, also with `?situacao=publicada` (3 rows) and `?q=café` (1 row).
- Keyboard: the tab order follows the screen (search, Buscar, the four filters, order, then each row's address and actions); Enter in the search submits it.
- `npm run check` passes: lint, typecheck, 1,474 tests in 66 files, production build.

Not verified: a real phone, Safari/iOS or Firefox, a screen reader, the read-only roles (editor) and a workspace with more than one screen of pages, deployment and production.

## Plan screen fixes (UX-111) — 2026-10-29

Scope: the plan screen, `/app/w/<workspace>/plano` (`modules/billing/plan-screen.ts`, `components/plan-screen.tsx`), money formatting (`formatMoney` in `modules/billing/catalog.ts`) and the account header on phones (`account-menu.tsx`, the workspace layout, `.app-header` in `globals.css`). Billing rules, actions and permissions are unchanged.

- Nothing to buy: `planScreen` returns `blocked` (`notDeployed`, `off`, `owner`, `suspended`, `payment`, `canceling`) when no card offers anything. The catalogue then says why right above the plans, with the fix-payment button for an owner whose payment needs fixing. It shows monthly prices as a reference with no interval choice, and folds the cards and the comparison under "Ver planos e preços". The "Só o proprietário…" line moved there from the plan card; the billing-off and not-deployed notices also moved there.
- Usage: above a limit, each row says what that means (nothing deleted, only new pages, invitations or uploads wait) in the warning color, never danger. A bar with nothing in it is left out. The plan and usage cards no longer stretch to each other's height.
- `formatMoney` returns a no-break space, so "R$" never ends a line apart from the amount.
- Header on phones: smaller logo and an icon-only account menu, so the workspace switcher shows the name. The agency line no longer repeats the name and is hidden below 640px.
- Payment history: the amount is right-aligned next to the date, and the status takes the rest. Tabular figures were tried and dropped: in the product typeface they widen the decimal comma ("R$ 14 , 90").

Verified with disposable local accounts (`qa-planux-*@example.test`): an agency workspace whose Pro subscription lost its grace period, back on Free with three people on a one-seat plan, and three invoices. The checks used Playwright with the installed Chrome against a local production build. Billing was in `sandbox` with dummy keys and the provider address pointed at an unused loopback port, so nothing could reach Stripe:

- Owner and admin at 320, 390 and 1280px: no document overflow and no axe-core WCAG 2.2 A/AA violation. At 390px the owner's screen went from 3,084px to 1,907px tall and the admin's from 3,093px to 1,302px (the before shots were with billing off).
- The owner sees "Para contratar ou mudar de plano, primeiro regularize o pagamento…" with the button above the folded plans. The admin sees "Só o proprietário…" in the same place. "Ver planos e preços" opens the three cards and the comparison.
- Free personal workspace (nothing blocked): the Monthly/Annual choice and both "Assinar" buttons are unchanged.
- `npm run check` passes: lint, typecheck, 1,478 tests in 66 files, production build.

Not verified: a real phone, Safari/iOS or Firefox, a screen reader, and the canceling and suspended states in a browser (unit tests only). The dev server reloaded the page in a loop during this session, so the browser checks used `next start`.

## Plan copy (UX-112) — 2026-10-29

Scope: items 7 to 9 of `docs/ux/REVISAO_UX_PLANO.md`, copy only (`BILLING_COPY` and `HOME_COPY.plans` in `content/pt-BR.ts`, `PlanHeading`, the home `PlanCard`).

- The yearly saving is one sentence (`yearlySaving`), used by the plan cards and by `toYearlyHint`.
- Plan names and descriptions have one source, `BILLING_COPY.planNames` / `planDescriptions`; `HOME_COPY.plans` keeps only the home's own words.
- The sentence under the plan name no longer says the name again (free, manual, ended), and the plan screen has no subtitle.
- `npm run check` passes: lint, typecheck, 1,479 tests in 66 files, production build.

Not verified in a browser: the change is copy only, and the unit tests render the plan screen and the home cards.

## Plan screen visuals (UX-113) — 2026-10-29

Scope: items 10, 11 and 13 of `docs/ux/REVISAO_UX_PLANO.md`. Item 12 (the home's paid-card button and "Em breve") was already resolved by UX-109; `pricing.test.ts` now also asserts that "Começar no Gratuito" is gone.

- Plan cards inside the account (`.plan-catalogue` in `globals.css`): no glow, no gradient badge, plain checks; the current plan wears the app's `Badge` next to its name and a dark border. The home's cards are unchanged.
- Comparison on the plan screen: `PlanComparisonTable rows="differences"` lists only the rows that change between plans (`planDifferences` in `modules/billing/comparison.ts`), with no groups or colored bars, and says how many rows every plan shares. The home keeps every row by group (`rows="all"`).
- Below 480px the last plan column is 4.5rem with 0.75rem right padding, so "Agência" and "500 MB" keep off the table's edge (home and plan screen).
- Test mode on the plan screen: a "Ambiente de teste" badge and one line under the Plans title. The confirmation and return screens keep the full notice.

Verified against a local production build with the billing emulator (`scripts/billing-lifecycle.mjs --serve`, accounts removed with `--cleanup` afterwards) and Playwright with the installed Chrome: the plan screen as owner (free workspace) and as admin, and the home, at 320, 390 and 1280px. No document overflow and no axe-core WCAG 2.2 A/AA violation in any of the nine. The closest text in the last table column sits 14px from the table's edge at 320 and 390px. At 390px the plan screen's comparison has 8 rows (custom domains are not configured locally) and the note "Os outros 17 recursos…". `scripts/billing-lifecycle.mjs` passes 156 checks. `npm run check` passes: lint, typecheck, 1,481 tests in 66 files, production build.

Not verified: a real phone, Safari/iOS or Firefox, a screen reader, and a workspace on a paid plan (the current-plan border was seen on the free card only).
