import type { DraftBlock } from "@/modules/blocks";

/** Contact and payment details that were copied from another page and may belong to another client. */
export type CopyReviewKind = "whatsapp" | "pix_key" | "payment_link" | "form_consent";

export const COPY_REVIEW_ORDER = ["whatsapp", "pix_key", "payment_link", "form_consent"] as const satisfies readonly CopyReviewKind[];

/**
 * Which of those details a draft contains, hidden blocks included (they can be shown again).
 * Empty when there is nothing to review.
 */
export function copyReviewKinds(blocks: readonly DraftBlock[]): CopyReviewKind[] {
  const found = new Set<CopyReviewKind>();
  for (const block of blocks) {
    if (block.type === "whatsapp") found.add("whatsapp");
    if (block.type === "pix") {
      found.add("pix_key");
      if (block.paymentUrl !== "") found.add("payment_link");
    }
    if (block.type === "form") found.add("form_consent");
  }
  return COPY_REVIEW_ORDER.filter((kind) => found.has(kind));
}

/** The notice stays until the copy is published for the first time. */
export function needsCopyReview(page: { duplicatedFrom: string | null; publicationCount: number }): boolean {
  return page.duplicatedFrom !== null && page.publicationCount === 0;
}
