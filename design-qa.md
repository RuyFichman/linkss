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
