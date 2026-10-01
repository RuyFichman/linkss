import type { PutOptions, StorageAdapter } from "./adapter";

export interface StoredObject {
  body: Uint8Array;
  options: PutOptions;
}

/** In-memory adapter for unit tests and the adapter contract. Not used by the application. */
export function createMemoryStorageAdapter(baseUrl = "https://media.example.test"): StorageAdapter & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(key, body, options) {
      if (objects.has(key)) return "exists";
      objects.set(key, { body: new Uint8Array(body), options });
      return "created";
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    publicUrl(key) {
      return `${baseUrl}/${key}`;
    },
  };
}
