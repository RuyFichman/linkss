import { describe, expect, it } from "vitest";
import { ONBOARDING_COPY } from "@/content/pt-BR";
import { ONBOARDING_STEPS, onboardingChecklist } from "./onboarding";

describe("first steps of a workspace", () => {
  it("starts at creating a page", () => {
    expect(onboardingChecklist({ total: 0, published: 0, archived: 0, canEdit: true })?.steps).toEqual([
      { step: "create", done: false, current: true },
      { step: "publish", done: false, current: false },
      { step: "share", done: false, current: false },
    ]);
  });

  it("moves to publishing once a page exists", () => {
    expect(onboardingChecklist({ total: 2, published: 0, archived: 0, canEdit: true })?.steps).toEqual([
      { step: "create", done: true, current: false },
      { step: "publish", done: false, current: true },
      { step: "share", done: false, current: false },
    ]);
  });

  it("is gone after the first publication, even if that page was archived later", () => {
    expect(onboardingChecklist({ total: 1, published: 1, archived: 0, canEdit: true })).toBeNull();
    expect(onboardingChecklist({ total: 1, published: 0, archived: 1, canEdit: true })).toBeNull();
  });

  it("is not shown to somebody who cannot edit", () => {
    expect(onboardingChecklist({ total: 0, published: 0, archived: 0, canEdit: false })).toBeNull();
  });

  it("has words for every step", () => {
    expect(Object.keys(ONBOARDING_COPY.steps).sort()).toEqual([...ONBOARDING_STEPS].sort());
  });
});
