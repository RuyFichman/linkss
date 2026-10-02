import { describe, expect, it, vi } from "vitest";
import { isSameOriginRequest, secretsMatch } from "@/lib/same-origin";
import { runMediaCleanup, runMediaCleanupBatches, type MediaCleanupRepository } from "./cleanup";
import { parseUploadResponse } from "./client-upload";
import { formatBytes, uploadErrorMessage } from "./messages";
import type { StorageAdapter } from "./storage/adapter";
import { createMemoryStorageAdapter } from "./storage/memory-adapter";
import { mediaErrorFromDatabase } from "./supabase-repository";

const A = "9a000000-0000-4000-8000-000000000001";
const B = "9a000000-0000-4000-8000-000000000002";
const options = { contentType: "image/webp", cacheSeconds: 1 };

function repository(claims: Array<{ mediaId: string; objectNames: string[] }>): MediaCleanupRepository {
  return { claim: vi.fn(async () => claims), finish: vi.fn(async (ids: string[]) => ids.length) };
}

describe("orphan cleanup", () => {
  it("removes the objects of claimed assets, then forgets the rows", async () => {
    const storage = createMemoryStorageAdapter();
    for (const key of [`${A}/448.webp`, `${A}/896.webp`, `${B}/96.webp`]) await storage.put(key, new Uint8Array([1]), options);
    const repo = repository([{ mediaId: A, objectNames: [`${A}/448.webp`, `${A}/896.webp`] }]);
    expect(await runMediaCleanup(repo, storage, 10)).toEqual({ claimed: 1, removedObjects: 2, finished: 1, failed: 0 });
    expect(repo.claim).toHaveBeenCalledWith(10);
    expect(repo.finish).toHaveBeenCalledWith([A]);
    // What was not claimed (still referenced) is untouched.
    expect([...storage.objects.keys()]).toEqual([`${B}/96.webp`]);
  });

  it("keeps an asset claimed when its objects cannot be removed, and can simply run again", async () => {
    const memory = createMemoryStorageAdapter();
    let fail = true;
    const flaky: StorageAdapter = { ...memory, remove: async (keys) => { if (fail && keys.some((key) => key.startsWith(A))) throw new Error("storage down"); await memory.remove(keys); } };
    await memory.put(`${A}/448.webp`, new Uint8Array([1]), options);
    await memory.put(`${B}/448.webp`, new Uint8Array([1]), options);
    const claims = [{ mediaId: A, objectNames: [`${A}/448.webp`] }, { mediaId: B, objectNames: [`${B}/448.webp`] }];
    const repo = repository(claims);
    expect(await runMediaCleanup(repo, flaky)).toEqual({ claimed: 2, removedObjects: 1, finished: 1, failed: 1 });
    expect(repo.finish).toHaveBeenCalledWith([B]);
    fail = false;
    // The next run gets the same claim again (the row stayed in `deleting`); already-removed objects are fine.
    expect(await runMediaCleanup(repo, flaky)).toEqual({ claimed: 2, removedObjects: 2, finished: 2, failed: 0 });
    expect(memory.objects.size).toBe(0);
  });

  it("does nothing when there is nothing to clean", async () => {
    const repo = repository([]);
    expect(await runMediaCleanup(repo, createMemoryStorageAdapter())).toEqual({ claimed: 0, removedObjects: 0, finished: 0, failed: 0 });
    expect(repo.finish).not.toHaveBeenCalled();
  });
});

describe("scheduled cleanup batches", () => {
  /** A backlog of `size` claimable assets with one object each; `failOn` makes removal of that asset fail. */
  function backlog(size: number, failOn?: string) {
    const pending = Array.from({ length: size }, (_, index) => `asset-${index}`);
    const repo: MediaCleanupRepository = {
      claim: vi.fn(async (limit: number) => pending.slice(0, limit).map((mediaId) => ({ mediaId, objectNames: [`${mediaId}/448.webp`] }))),
      finish: vi.fn(async (ids: string[]) => {
        for (const id of ids) pending.splice(pending.indexOf(id), 1);
        return ids.length;
      }),
    };
    const storage: StorageAdapter = {
      ...createMemoryStorageAdapter(),
      remove: async (keys) => { if (failOn && keys.some((key) => key.startsWith(`${failOn}/`))) throw new Error("storage down"); },
    };
    return { repo, storage, pending };
  }

  it("keeps claiming full batches until the backlog is empty", async () => {
    const { repo, storage, pending } = backlog(7);
    expect(await runMediaCleanupBatches(repo, storage, { batchSize: 3 })).toEqual({ claimed: 7, removedObjects: 7, finished: 7, failed: 0, batches: 3 });
    expect(pending).toEqual([]);
  });

  it("stops at the batch bound and leaves the rest for the next run", async () => {
    const { repo, storage, pending } = backlog(10);
    expect(await runMediaCleanupBatches(repo, storage, { batchSize: 3, maxBatches: 2 })).toMatchObject({ claimed: 6, finished: 6, batches: 2 });
    expect(pending).toHaveLength(4);
  });

  it("stops after a batch with a failure instead of re-claiming the stuck asset in a loop", async () => {
    const { repo, storage } = backlog(9, "asset-1");
    expect(await runMediaCleanupBatches(repo, storage, { batchSize: 3 })).toEqual({ claimed: 3, removedObjects: 2, finished: 2, failed: 1, batches: 1 });
    expect(repo.claim).toHaveBeenCalledTimes(1);
  });

  it("runs a single empty batch when there is nothing to clean", async () => {
    const { repo, storage } = backlog(0);
    expect(await runMediaCleanupBatches(repo, storage)).toEqual({ claimed: 0, removedObjects: 0, finished: 0, failed: 0, batches: 1 });
  });
});

describe("upload route helpers", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it("accepts only requests whose Origin is the host they were sent to", () => {
    expect(isSameOriginRequest(headers({ origin: "https://exemplo.com.br", host: "exemplo.com.br" }))).toBe(true);
    expect(isSameOriginRequest(headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOriginRequest(headers({ origin: "https://exemplo.com.br", host: "internal:3000", "x-forwarded-host": "exemplo.com.br" }))).toBe(true);
    expect(isSameOriginRequest(headers({ origin: "https://evil.example", host: "exemplo.com.br" }))).toBe(false);
    expect(isSameOriginRequest(headers({ origin: "https://exemplo.com.br.evil.example", host: "exemplo.com.br" }))).toBe(false);
    expect(isSameOriginRequest(headers({ host: "exemplo.com.br" }))).toBe(false);
    expect(isSameOriginRequest(headers({ origin: "null", host: "exemplo.com.br" }))).toBe(false);
  });

  it("compares job secrets without leaking where they differ", () => {
    expect(secretsMatch("a".repeat(40), "a".repeat(40))).toBe(true);
    expect(secretsMatch("a".repeat(39), "a".repeat(40))).toBe(false);
    expect(secretsMatch("", "a".repeat(40))).toBe(false);
  });

  it("maps database errors of the media RPCs", () => {
    expect(["LK010", "LK061", "LK060", "LK062", "LK090", "42501", "P0002", "23505"].map((code) => mediaErrorFromDatabase({ code }))).toEqual(["quota", "rate_limited", "attestation", "attestation", "not_configured", "forbidden", "not_found", "unavailable"]);
  });

  it("treats any unexpected response as unavailable, never as success", () => {
    const media = { mediaId: A, kind: "image", width: 448, height: 300, bytes: 1000 };
    expect(parseUploadResponse({ ok: true, media })).toEqual({ ok: true, media });
    expect(parseUploadResponse({ ok: true, media: { ...media, mediaId: "https://evil.example/x.png" } })).toEqual({ ok: false, error: "unavailable" });
    expect(parseUploadResponse({ ok: true })).toEqual({ ok: false, error: "unavailable" });
    expect(parseUploadResponse({ ok: false, error: "quota" })).toEqual({ ok: false, error: "quota" });
    expect(parseUploadResponse({ ok: false, error: "<script>" })).toEqual({ ok: false, error: "unavailable" });
    expect(parseUploadResponse(null)).toEqual({ ok: false, error: "unavailable" });
    expect(parseUploadResponse("<html>502</html>")).toEqual({ ok: false, error: "unavailable" });
  });

  it("explains each failure with a specific message and formats sizes for reading", () => {
    expect(uploadErrorMessage("too_large", "image")).toBe("Esse arquivo é maior que 15 MB. Escolha uma imagem menor.");
    expect(uploadErrorMessage("unsupported", "image")).toBe("Esse tipo de arquivo não é aceito. Use uma imagem JPG, PNG ou WebP.");
    expect(uploadErrorMessage("too_small", "avatar")).toContain("96 pixels");
    expect(uploadErrorMessage("too_small", "image")).toContain("200 pixels");
    expect(uploadErrorMessage("quota", "image")).toContain("limite de espaço");
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(689_152)).toBe("673 KB");
    expect(formatBytes(1_258_291)).toBe("1,2 MB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
  });
});
