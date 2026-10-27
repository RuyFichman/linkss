import { isUuid } from "@/modules/identity/guard";
import { MAX_VARIANT_BYTES } from "@/modules/media/policy";

export interface ExportMediaFile {
  mediaId: string;
  width: number;
  height: number;
  bytes: number;
  key: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only keys attested at upload and returned by the owner-authorized export may be fetched. */
export function exportMediaFiles(data: unknown, workspaceId: string): ExportMediaFile[] {
  if (!record(data) || !Array.isArray(data.mediaAssets)) throw new Error("Invalid media inventory");
  const files: ExportMediaFile[] = [];
  for (const asset of data.mediaAssets) {
    if (!record(asset) || !isUuid(asset.id) || asset.workspace_id !== workspaceId || !Array.isArray(asset.variants)) {
      throw new Error("Invalid media inventory");
    }
    // Pending/failed uploads may not have all their objects. Deleting files belong to cleanup.
    if (asset.status !== "ready") continue;
    for (const variant of asset.variants) {
      if (!record(variant) || !Number.isInteger(variant.w) || !Number.isInteger(variant.h) || !Number.isInteger(variant.bytes)
        || Number(variant.w) < 1 || Number(variant.w) > 4096 || Number(variant.h) < 1 || Number(variant.h) > 4096
        || Number(variant.bytes) < 1 || Number(variant.bytes) > MAX_VARIANT_BYTES) throw new Error("Invalid media variant");
      files.push({ mediaId: asset.id, width: Number(variant.w), height: Number(variant.h), bytes: Number(variant.bytes), key: `${asset.id}/${variant.w}.webp` });
    }
  }
  return files;
}
