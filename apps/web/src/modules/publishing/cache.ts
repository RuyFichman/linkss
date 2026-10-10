import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Drops the cached public page and its Open Graph image for one address. Call after any committed
 * change that affects what a visitor sees at /{slug}: publish, restore, unpublish, address change
 * (old and new) and deletion.
 *
 * A page may also answer on a custom hostname (ADR 0016), cached under its own route. The
 * hostname is not known here, so every custom-hostname copy is dropped: each is rebuilt by one
 * database read on its next visit. Worth narrowing to one hostname when publishing volume makes
 * that cost visible (docs/ARCHITECTURE.md).
 */
export function revalidatePublicPage(slug: string): void {
  revalidatePath(`/${slug}`);
  revalidatePath(`/${slug}/opengraph-image`);
  revalidatePath("/d/[host]", "page");
}
