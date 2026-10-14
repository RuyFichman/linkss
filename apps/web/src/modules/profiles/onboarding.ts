/**
 * First steps of a new workspace (self-service onboarding). Derived from what the page list already
 * knows, so it needs no storage, no dismissal state and no extra query: the checklist is shown
 * until the workspace publishes its first page and never again after that.
 */
export const ONBOARDING_STEPS = ["create", "publish", "share"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingInput {
  /** Pages of the workspace, whatever their status. */
  total: number;
  published: number;
  archived: number;
  /** Whether this person may create and edit pages here. */
  canEdit: boolean;
}

export interface OnboardingChecklist {
  steps: { step: OnboardingStep; done: boolean; current: boolean }[];
}

/**
 * `null` when there is nothing to guide: a person who cannot edit, or a workspace that has (or once
 * had, and archived) a published page.
 */
export function onboardingChecklist(input: OnboardingInput): OnboardingChecklist | null {
  if (!input.canEdit || input.published > 0 || input.archived > 0) return null;
  const created = input.total > 0;
  return {
    steps: [
      { step: "create", done: created, current: !created },
      { step: "publish", done: false, current: created },
      // Sharing comes after the first publication, when this checklist is gone: it is listed so the
      // person knows what the page is for before starting.
      { step: "share", done: false, current: false },
    ],
  };
}
