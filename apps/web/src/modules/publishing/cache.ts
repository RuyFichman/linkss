import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Drops the cached public page and its Open Graph image for one address. Call after any committed
 * change that affects what a visitor sees at /{slug}: publish, restore, unpublish, address change
 * (old and new) and deletion.
 */
export function revalidatePublicPage(slug: string): void {
  revalidatePath(`/${slug}`);
  revalidatePath(`/${slug}/opengraph-image`);
}
