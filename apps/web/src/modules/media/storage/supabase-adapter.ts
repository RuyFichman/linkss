import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET, publicMediaUrl } from "../url";
import { StorageAdapterError, type StorageAdapter } from "./adapter";

const LIST_PAGE_SIZE = 100;

/**
 * Supabase Storage behind the StorageAdapter port: the only file that calls the Storage SDK. The
 * credentials are the client's. Uploads use a client acting as the signed-in user, so the insert
 * policy on storage.objects (a registered, pending asset of the caller) applies; the cleanup job
 * uses a client with the secret key.
 */
export function createSupabaseStorageAdapter(client: Pick<SupabaseClient, "storage">): StorageAdapter {
  const bucket = () => client.storage.from(MEDIA_BUCKET);
  return {
    async put(key, body, options) {
      const { error } = await bucket().upload(key, body, { contentType: options.contentType, cacheControl: String(options.cacheSeconds), upsert: false });
      if (!error) return "created";
      const status = "statusCode" in error ? String(error.statusCode) : "";
      if (status === "409" || /already exists|duplicate/i.test(error.message)) return "exists";
      throw new StorageAdapterError("put", status || error.name);
    },

    async remove(keys) {
      if (keys.length === 0) return;
      const { error } = await bucket().remove([...keys]);
      if (error) throw new StorageAdapterError("remove", error.name);
    },

    async list(prefix) {
      // Keys are "<media id>/<width>.webp": list the folder that the prefix names.
      const folder = prefix.replace(/\/+$/, "");
      const { data, error } = await bucket().list(folder, { limit: LIST_PAGE_SIZE });
      if (error) throw new StorageAdapterError("list", error.name);
      return data.map((entry) => `${folder}/${entry.name}`).sort();
    },

    publicUrl: publicMediaUrl,
  };
}
