"use server";

import { getMediaService } from "./server";
import type { StorageUsage } from "./service";

export type StorageUsageResult = { ok: true; usage: StorageUsage } | { ok: false };

/** "Espaço usado" for the editor. `profileId` is client-controlled: the service re-authorizes it. */
export async function storageUsageAction(profileId: string): Promise<StorageUsageResult> {
  try {
    const result = await (await getMediaService()).usage(profileId);
    return result.ok ? { ok: true, usage: result.usage } : { ok: false };
  } catch {
    return { ok: false };
  }
}
