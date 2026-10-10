"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PUBLIC_PAGE_COPY } from "@/content/public-page";
import { consentStorageKey, loadPixels, parseStoredConsent, serializeConsent, type ConsentChoice, type PixelHost } from "../loader";
import type { PublicPixels } from "../model";

type Stage = "loading" | "asking" | ConsentChoice;

// The stored choice is read once per mount; nothing else writes it while the page is open.
const subscribeToNothing = () => () => {};

function readChoice(slug: string, pixels: PublicPixels): ConsentChoice | null {
  try {
    return parseStoredConsent(window.localStorage.getItem(consentStorageKey(slug)), pixels);
  } catch {
    // Storage blocked (some in-app browsers): the choice lasts for this visit only.
    return null;
  }
}

function storeChoice(slug: string, pixels: PublicPixels, choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(consentStorageKey(slug), serializeConsent(choice, pixels));
  } catch {
    // Not remembered; the visitor is asked again next time.
  }
}

/**
 * Consent for the page owner's Meta Pixel and Google Analytics (ADR 0017). Mounted only by the
 * public routes, and only for a page that has identifiers in force. Until the visitor accepts,
 * nothing is requested from Meta or Google. Refusing is one tap, the same size as accepting, and
 * the choice can be changed from the link this component leaves at the end of the page.
 *
 * Fixed to the bottom of the viewport, so it never moves the page (no layout shift), and rendered
 * after hydration, so it is never the largest paint.
 */
export function PixelConsent({ slug, pixels }: { slug: string; pixels: PublicPixels }) {
  // "loading" on the server and during hydration, so the markup matches; the stored choice after.
  const stored = useSyncExternalStore<Stage>(subscribeToNothing, () => readChoice(slug, pixels) ?? "asking", () => "loading");
  const [chosen, setChosen] = useState<Stage | null>(null);
  const stage = chosen ?? stored;
  const copy = PUBLIC_PAGE_COPY.consent;

  useEffect(() => {
    if (stage !== "granted") return;
    try {
      loadPixels({ window: window as unknown as PixelHost["window"], document }, pixels);
    } catch {
      // A third-party tool must never break the page.
    }
  }, [stage, pixels]);

  function choose(choice: ConsentChoice) {
    const wasGranted = stage === "granted";
    storeChoice(slug, pixels, choice);
    // A library already running cannot be unloaded: withdrawing consent reloads the page without it.
    if (wasGranted && choice === "denied") window.location.reload();
    else setChosen(choice);
  }

  if (stage === "loading") return null;

  if (stage !== "asking") {
    return (
      <p className="m-0 bg-app-bg px-4 pb-5 text-center text-sm">
        <button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-inherit underline underline-offset-4" onClick={() => setChosen("asking")}>{copy.change}</button>
      </p>
    );
  }

  const vendors = [pixels.meta ? copy.meta : null, pixels.ga ? copy.ga : null].filter((name): name is NonNullable<typeof name> => name !== null).join(copy.and);
  return (
    <section role="region" aria-label={copy.label} className="fixed inset-x-0 bottom-0 z-50 border-t border-app-border bg-app-surface px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-app-text shadow-lg">
      <div className="mx-auto grid w-full max-w-md gap-3">
        <p className="m-0 text-sm leading-relaxed">{copy.text(vendors)}</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="ui-button ui-button-secondary" onClick={() => choose("denied")}>{copy.refuse}</button>
          <button type="button" className="ui-button ui-button-secondary" onClick={() => choose("granted")}>{copy.accept}</button>
        </div>
      </div>
    </section>
  );
}
