import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { activatePayload, mediaSignerFromEnv, registerPayload, signMediaPayload } from "./attestation";
import { AVATAR_CROP, cropRect, INITIAL_CROP, outputSize } from "./crop";
import {
  BROWSER_PRECHECK, checkDimensions, detectImageFormat, imageVariantWidths, isAnimatedImage, MAX_IMAGE_DIMENSION, MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES, planVariants, precheckUpload,
  readImageSize, SERVER_PRECHECK, variantKey, type UploadRejection,
} from "./policy";
import { processUpload } from "./process";
import { countsTowardQuota, isCleanupCandidate, mediaIdsIn, ORPHAN_GRACE_MS, PENDING_GRACE_MS, referencedMediaIds } from "./references";
import { createMediaService, type MediaRepository, type MediaRepositoryResult } from "./service";
import type { StorageAdapter } from "./storage/adapter";
import { createMemoryStorageAdapter } from "./storage/memory-adapter";
import { createUploadController, isRetryableUploadFailure, type PrepareOutcome, type SendOutcome } from "./upload-machine";
import { avatarSources, imageSources, mediaOrigin, publicMediaUrl } from "./url";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEDIA_1 = "9a000000-0000-4000-8000-000000000001";
const MEDIA_2 = "9a000000-0000-4000-8000-000000000002";
const SECRET = "test-media-signing-secret-0123456789";

const bytes = (text: string) => new TextEncoder().encode(text);

/** PNG header that declares the given size; the pixel data is missing on purpose. */
function pngHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  header.set([8, 6, 0, 0, 0], 24);
  return header;
}

/** Extended WebP header (VP8X) with the animation flag set. */
function animatedWebpHeader(): Uint8Array {
  const header = new Uint8Array(30);
  header.set(bytes("RIFF"), 0);
  header.set(bytes("WEBP"), 8);
  header.set(bytes("VP8X"), 12);
  header[16] = 10;
  header[20] = 0x02;
  header.set([99, 0, 0, 99, 0, 0], 24);
  return header;
}

interface Fixtures {
  jpeg: Uint8Array;
  jpegWithGps: Uint8Array;
  png: Uint8Array;
  webp: Uint8Array;
  tall: Uint8Array;
  tiny: Uint8Array;
  small: Uint8Array;
  rotated: Uint8Array;
  animatedWebp: Uint8Array;
  apng: Uint8Array;
}

let fixtures: Fixtures;

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
}

beforeAll(async () => {
  const twoFrames = Buffer.alloc(400 * 600 * 3, 120);
  twoFrames.fill(30, 0, 400 * 300 * 3);
  const apng = new Uint8Array(pngHeader(64, 64).length + 20);
  apng.set(pngHeader(64, 64));
  // An acTL chunk right after IHDR is what makes a PNG animated.
  apng.set([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c], 33);
  fixtures = {
    jpeg: new Uint8Array(await solid(1600, 1200).jpeg().toBuffer()),
    jpegWithGps: new Uint8Array(await solid(800, 600).withExif({ IFD0: { Copyright: "Ana Lima", Make: "CameraSecreta" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } }).jpeg().toBuffer()),
    png: new Uint8Array(await solid(500, 400).png().toBuffer()),
    webp: new Uint8Array(await solid(900, 300).webp().toBuffer()),
    tall: new Uint8Array(await solid(200, 900).jpeg().toBuffer()),
    tiny: new Uint8Array(await solid(50, 50).png().toBuffer()),
    small: new Uint8Array(await solid(300, 200).png().toBuffer()),
    // Stored sideways with an EXIF orientation: upright it is 300 wide and 600 tall.
    rotated: new Uint8Array(await solid(600, 300).withExif({}).jpeg().withMetadata({ orientation: 6 }).toBuffer()),
    // Two 400 x 300 frames stacked in one raw buffer: a real animated WebP, large enough for every size rule.
    animatedWebp: new Uint8Array(await sharp(twoFrames, { raw: { width: 400, height: 600, channels: 3, pageHeight: 300 } }).webp({ loop: 0 }).toBuffer()),
    apng,
  };
});

describe("upload policy: decisions from the bytes only (AC2)", () => {
  it("detects the format from magic bytes, never from a name or MIME type", () => {
    expect(detectImageFormat(fixtures.jpeg)).toBe("jpeg");
    expect(detectImageFormat(fixtures.png)).toBe("png");
    expect(detectImageFormat(fixtures.webp)).toBe("webp");
    expect(detectImageFormat(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageFormat(bytes("<!doctype html><html><body><script>alert(1)</script>"))).toBeNull();
    expect(detectImageFormat(bytes("GIF89a\u0001\u0000\u0001\u0000"))).toBeNull();
    expect(detectImageFormat(bytes("%PDF-1.7"))).toBeNull();
    expect(detectImageFormat(new Uint8Array(0))).toBeNull();
  });

  it("reads dimensions from the header of every accepted format", () => {
    expect(readImageSize(fixtures.jpeg, "jpeg")).toEqual({ width: 1600, height: 1200 });
    expect(readImageSize(fixtures.png, "png")).toEqual({ width: 500, height: 400 });
    expect(readImageSize(fixtures.webp, "webp")).toEqual({ width: 900, height: 300 });
    expect(readImageSize(fixtures.jpeg.slice(0, 10), "jpeg")).toBeNull();
  });

  it("flags animated WebP and APNG", () => {
    expect(isAnimatedImage(fixtures.animatedWebp, "webp")).toBe(true);
    expect(isAnimatedImage(animatedWebpHeader(), "webp")).toBe(true);
    expect(isAnimatedImage(fixtures.apng, "png")).toBe(true);
    expect(isAnimatedImage(fixtures.webp, "webp")).toBe(false);
    expect(isAnimatedImage(fixtures.png, "png")).toBe(false);
  });

  const server = (value: Uint8Array, byteLength = value.length) => precheckUpload(value, { ...SERVER_PRECHECK, byteLength });

  it.each<[string, () => Uint8Array, UploadRejection]>([
    ["zero-byte file", () => new Uint8Array(0), "empty"],
    ["SVG", () => bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "unsupported"],
    ["HTML disguised as an image (photo.png)", () => bytes("<html><script>alert(document.cookie)</script></html>"), "unsupported"],
    ["text with a JPEG name", () => bytes("this is not a jpeg"), "unsupported"],
    ["GIF", () => bytes("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000"), "unsupported"],
    ["animated WebP", () => fixtures.animatedWebp, "animated"],
    ["APNG", () => fixtures.apng, "animated"],
    ["pixel bomb (30000 x 30000 header)", () => pngHeader(30_000, 30_000), "too_many_pixels"],
    ["one side over the limit", () => pngHeader(MAX_IMAGE_DIMENSION + 1, 10), "too_many_pixels"],
    ["PNG signature with no header", () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "undecodable"],
  ])("refuses a %s before decoding", (_label, build, reason) => {
    expect(server(build())).toEqual({ ok: false, reason });
  });

  it("refuses a file over the size cap, in the browser and on the server", () => {
    expect(server(fixtures.jpeg, MAX_UPLOAD_BYTES + 1)).toEqual({ ok: false, reason: "too_large" });
    expect(precheckUpload(fixtures.jpeg, { ...BROWSER_PRECHECK, byteLength: MAX_SOURCE_BYTES + 1 })).toEqual({ ok: false, reason: "too_large" });
    // The browser may open a large phone photo (it scales it down); the server would not.
    expect(precheckUpload(pngHeader(8000, 6000), { ...BROWSER_PRECHECK, byteLength: 100 })).toMatchObject({ ok: true });
    expect(server(pngHeader(8000, 6000))).toEqual({ ok: false, reason: "too_many_pixels" });
  });

  it("applies size and aspect rules per kind", () => {
    expect(checkDimensions("avatar", { width: 96, height: 96 })).toBeNull();
    expect(checkDimensions("avatar", { width: 95, height: 400 })).toBe("too_small");
    expect(checkDimensions("image", { width: 199, height: 400 })).toBe("too_small");
    expect(checkDimensions("image", { width: 400, height: 99 })).toBe("too_small");
    expect(checkDimensions("image", { width: 200, height: 601 })).toBe("bad_aspect");
    expect(checkDimensions("image", { width: 1300, height: 400 })).toBe("bad_aspect");
    expect(checkDimensions("image", { width: 1200, height: 400 })).toBeNull();
  });

  it("plans variants: three squares for an avatar, never enlarged widths for an image", () => {
    expect(planVariants("avatar", { width: 120, height: 300 })).toEqual([{ width: 96, height: 96 }, { width: 192, height: 192 }, { width: 288, height: 288 }]);
    expect(planVariants("image", { width: 2048, height: 1536 })).toEqual([{ width: 448, height: 336 }, { width: 896, height: 672 }, { width: 1344, height: 1008 }]);
    expect(planVariants("image", { width: 1000, height: 500 })).toEqual([{ width: 448, height: 224 }, { width: 896, height: 448 }, { width: 1000, height: 500 }]);
    expect(planVariants("image", { width: 300, height: 200 })).toEqual([{ width: 300, height: 200 }]);
    expect(imageVariantWidths(1344)).toEqual([448, 896, 1344]);
    expect(imageVariantWidths(448)).toEqual([448]);
    expect(variantKey(MEDIA_1, 896)).toBe(`${MEDIA_1}/896.webp`);
  });
});

describe("server processing (real decoding)", () => {
  it("re-encodes an accepted image as WebP variants without metadata", async () => {
    const result = await processUpload(fixtures.jpegWithGps, "image");
    if (!result.ok) throw new Error(result.reason);
    expect(result.master).toEqual({ width: 800, height: 600 });
    expect(result.variants.map((variant) => variant.width)).toEqual([448, 800]);
    for (const variant of result.variants) {
      const metadata = await sharp(variant.body).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.width).toBe(variant.width);
      expect(variant.bytes).toBe(variant.body.length);
      // Nothing from the original bytes survives.
      expect(Buffer.from(variant.body).includes("CameraSecreta")).toBe(false);
    }
    expect(Buffer.from(fixtures.jpegWithGps).includes("CameraSecreta")).toBe(true);
  });

  it("produces square avatars and applies the EXIF orientation before measuring", async () => {
    const avatar = await processUpload(fixtures.jpeg, "avatar");
    expect(avatar.ok && avatar.variants.map((variant) => [variant.width, variant.height])).toEqual([[96, 96], [192, 192], [288, 288]]);
    const rotated = await processUpload(fixtures.rotated, "image");
    expect(rotated.ok && rotated.master).toEqual({ width: 300, height: 600 });
  });

  it.each<[string, () => Uint8Array, "avatar" | "image", UploadRejection]>([
    ["zero-byte file", () => new Uint8Array(0), "image", "empty"],
    ["SVG", () => bytes('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><script>alert(1)</script></svg>'), "image", "unsupported"],
    ["HTML disguised as an image", () => bytes("<html><body><img src=x onerror=alert(1)></body></html>"), "image", "unsupported"],
    ["animated WebP", () => fixtures.animatedWebp, "image", "animated"],
    ["APNG header", () => fixtures.apng, "image", "animated"],
    ["pixel bomb", () => pngHeader(30_000, 30_000), "image", "too_many_pixels"],
    ["PNG header with no pixels", () => pngHeader(800, 600), "image", "undecodable"],
    ["truncated JPEG", () => fixtures.jpeg.slice(0, Math.floor(fixtures.jpeg.length / 2)), "image", "undecodable"],
    ["image smaller than the minimum", () => fixtures.tiny, "image", "too_small"],
    ["avatar smaller than the minimum", () => fixtures.tiny, "avatar", "too_small"],
    ["extreme aspect ratio", () => fixtures.tall, "image", "bad_aspect"],
  ])("refuses a %s", async (_label, build, kind, reason) => {
    expect(await processUpload(build(), kind)).toEqual({ ok: false, reason });
  });

  it("refuses a payload over the server cap without decoding it", async () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set(fixtures.jpeg);
    expect(await processUpload(oversized, "image")).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("public URLs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds srcset and sizes from the media id and master width only", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projeto.supabase.co/");
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "");
    expect(publicMediaUrl(variantKey(MEDIA_1, 448))).toBe(`https://projeto.supabase.co/storage/v1/object/public/media/${MEDIA_1}/448.webp`);
    const sources = imageSources(MEDIA_1, 1000);
    expect(sources.srcSet.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["448w", "896w", "1000w"]);
    expect(sources.src).toContain("/448.webp");
    expect(sources.sizes).toBe("(max-width: 480px) calc(100vw - 2rem), 448px");
    expect(avatarSources(MEDIA_1).srcSet.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["1x", "2x", "3x"]);
    expect(mediaOrigin()).toBe("https://projeto.supabase.co");
  });

  it("moves to another object store by configuration alone", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "https://media.exemplo.com.br/");
    expect(publicMediaUrl(variantKey(MEDIA_1, 96))).toBe(`https://media.exemplo.com.br/${MEDIA_1}/96.webp`);
  });
});

describe("upload attestation", () => {
  afterEach(() => vi.unstubAllEnvs());
  const attestation = { mediaId: MEDIA_1, profileId: PAGE_A, kind: "image" as const, width: 896, height: 672, variants: [{ width: 896, height: 672, bytes: 2222 }, { width: 448, height: 336, bytes: 1111 }] };

  it("signs a canonical payload (variants ordered by width)", () => {
    expect(registerPayload(attestation)).toBe(`register:${MEDIA_1}:${PAGE_A}:image:896x672:448x336x1111,896x672x2222`);
    expect(activatePayload(MEDIA_1)).toBe(`activate:${MEDIA_1}`);
    const signature = signMediaPayload(registerPayload(attestation), SECRET);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signMediaPayload(registerPayload({ ...attestation, width: 833 }), SECRET)).not.toBe(signature);
    expect(signMediaPayload(registerPayload(attestation), `${SECRET}x`)).not.toBe(signature);
  });

  it("produces the signature the pgTAP suite verifies with the same secret (drift guard)", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../../supabase/tests/database/120-media.test.sql", import.meta.url)), "utf8");
    expect(sql).toContain(`'${SECRET}'`);
    expect(sql).toContain(signMediaPayload(registerPayload(attestation), SECRET));
    expect(sql).toContain(signMediaPayload(activatePayload(MEDIA_1), SECRET));
  });

  it("is off when the secret is missing or too short", () => {
    vi.stubEnv("MEDIA_SIGNING_SECRET", "");
    expect(mediaSignerFromEnv()).toBeNull();
    vi.stubEnv("MEDIA_SIGNING_SECRET", "short");
    expect(mediaSignerFromEnv()).toBeNull();
    vi.stubEnv("MEDIA_SIGNING_SECRET", SECRET);
    expect(mediaSignerFromEnv()?.("activate:x")).toBe(signMediaPayload("activate:x", SECRET));
  });
});

describe("StorageAdapter contract (in-memory implementation)", () => {
  function contract(create: () => StorageAdapter) {
    it("stores an object once and never overwrites it", async () => {
      const adapter = create();
      const options = { contentType: "image/webp", cacheSeconds: 31_536_000 };
      expect(await adapter.put(`${MEDIA_1}/448.webp`, bytes("first"), options)).toBe("created");
      expect(await adapter.put(`${MEDIA_1}/448.webp`, bytes("second"), options)).toBe("exists");
      expect(await adapter.list(`${MEDIA_1}/`)).toEqual([`${MEDIA_1}/448.webp`]);
    });

    it("lists by prefix and removes idempotently", async () => {
      const adapter = create();
      const options = { contentType: "image/webp", cacheSeconds: 60 };
      await adapter.put(`${MEDIA_1}/448.webp`, bytes("a"), options);
      await adapter.put(`${MEDIA_1}/896.webp`, bytes("b"), options);
      await adapter.put(`${MEDIA_2}/96.webp`, bytes("c"), options);
      expect(await adapter.list(`${MEDIA_1}/`)).toEqual([`${MEDIA_1}/448.webp`, `${MEDIA_1}/896.webp`]);
      await adapter.remove([`${MEDIA_1}/448.webp`, `${MEDIA_1}/896.webp`]);
      await adapter.remove([`${MEDIA_1}/448.webp`, "missing/1.webp"]);
      await adapter.remove([]);
      expect(await adapter.list(`${MEDIA_1}/`)).toEqual([]);
      expect(await adapter.list(`${MEDIA_2}/`)).toEqual([`${MEDIA_2}/96.webp`]);
    });

    it("gives every key a public address that ends with the key", () => {
      expect(create().publicUrl(`${MEDIA_1}/448.webp`).endsWith(`/${MEDIA_1}/448.webp`)).toBe(true);
    });
  }
  contract(() => createMemoryStorageAdapter());
});

function identity(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

function fakeRepository(visibleWorkspaces: string[], overrides: Partial<MediaRepository> = {}) {
  const pages = [{ id: PAGE_A, workspaceId: WS_A }, { id: PAGE_B, workspaceId: WS_B }];
  const ok: MediaRepositoryResult = { ok: true };
  const repository: MediaRepository = {
    findProfile: vi.fn(async (id: string) => pages.find((page) => page.id === id && visibleWorkspaces.includes(page.workspaceId)) ?? null),
    register: vi.fn(async () => ok),
    activate: vi.fn(async () => ok),
    fail: vi.fn(async () => undefined),
    usage: vi.fn(async () => ({ usedBytes: 1024, limitBytes: 20 * 1024 * 1024 })),
    ...overrides,
  };
  return repository;
}

describe("upload command", () => {
  const sign = (payload: string) => signMediaPayload(payload, SECRET);
  const dependencies = { sign, process: processUpload, newId: () => MEDIA_1 };
  const owner = () => identity("u1", { [WS_A]: "owner" });

  it("validates, registers with a signature, stores every variant and activates", async () => {
    const repository = fakeRepository([WS_A]);
    const storage = createMemoryStorageAdapter();
    const result = await createMediaService(identity("u1", { [WS_A]: "editor" }), repository, storage, dependencies).upload(PAGE_A, "image", fixtures.jpeg);
    expect(result).toMatchObject({ ok: true, media: { mediaId: MEDIA_1, kind: "image", width: 1344, height: 1008 } });
    expect([...storage.objects.keys()]).toEqual([`${MEDIA_1}/448.webp`, `${MEDIA_1}/896.webp`, `${MEDIA_1}/1344.webp`]);
    for (const object of storage.objects.values()) expect(object.options).toEqual({ contentType: "image/webp", cacheSeconds: 31_536_000 });
    const registered = vi.mocked(repository.register).mock.calls[0]?.[0];
    expect(registered).toMatchObject({ mediaId: MEDIA_1, profileId: PAGE_A, kind: "image", width: 1344, height: 1008 });
    expect(registered?.signature).toBe(sign(registerPayload({ mediaId: MEDIA_1, profileId: PAGE_A, kind: "image", width: 1344, height: 1008, variants: registered?.variants ?? [] })));
    expect(repository.activate).toHaveBeenCalledWith(MEDIA_1, sign(activatePayload(MEDIA_1)));
    expect(result.ok && result.media.bytes).toBe([...storage.objects.values()].reduce((total, object) => total + object.body.length, 0));
  });

  it("stores and registers nothing for any rejected file", async () => {
    const rejected: Array<[Uint8Array, UploadRejection]> = [
      [new Uint8Array(0), "empty"],
      [bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), "unsupported"],
      [bytes("<html><script>alert(1)</script></html>"), "unsupported"],
      [fixtures.animatedWebp, "animated"],
      [pngHeader(30_000, 30_000), "too_many_pixels"],
      [pngHeader(800, 600), "undecodable"],
      [fixtures.tiny, "too_small"],
      [fixtures.tall, "bad_aspect"],
    ];
    for (const [file, reason] of rejected) {
      const repository = fakeRepository([WS_A]);
      const storage = createMemoryStorageAdapter();
      expect(await createMediaService(owner(), repository, storage, dependencies).upload(PAGE_A, "image", file)).toEqual({ ok: false, error: reason });
      expect(storage.objects.size, reason).toBe(0);
      expect(repository.register, reason).not.toHaveBeenCalled();
    }
  });

  it("stores nothing when the workspace quota or the upload rate is exceeded", async () => {
    for (const error of ["quota", "rate_limited"] as const) {
      const repository = fakeRepository([WS_A], { register: vi.fn(async () => ({ ok: false as const, error })) });
      const storage = createMemoryStorageAdapter();
      expect(await createMediaService(owner(), repository, storage, dependencies).upload(PAGE_A, "avatar", fixtures.png)).toEqual({ ok: false, error });
      expect(storage.objects.size).toBe(0);
      expect(repository.activate).not.toHaveBeenCalled();
    }
  });

  it("rejects anonymous callers, other tenants and unknown kinds before any processing", async () => {
    const process = vi.fn(processUpload);
    const repository = fakeRepository([WS_A]);
    const storage = createMemoryStorageAdapter();
    const service = (who: IdentityPort) => createMediaService(who, repository, storage, { ...dependencies, process });
    expect(await service(identity(null, {})).upload(PAGE_A, "image", fixtures.jpeg)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await service(owner()).upload(PAGE_B, "image", fixtures.jpeg)).toEqual({ ok: false, error: "not_found" });
    expect(await service(owner()).upload("../etc", "image", fixtures.jpeg)).toEqual({ ok: false, error: "not_found" });
    expect(await service(owner()).upload(PAGE_A, "video", fixtures.jpeg)).toEqual({ ok: false, error: "unsupported" });
    expect(process).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(0);
  });

  it("is unavailable, and stores nothing, when the signing secret is not configured or refused", async () => {
    const storage = createMemoryStorageAdapter();
    expect(await createMediaService(owner(), fakeRepository([WS_A]), storage, { ...dependencies, sign: null }).upload(PAGE_A, "image", fixtures.jpeg)).toEqual({ ok: false, error: "unavailable" });
    const refused = fakeRepository([WS_A], { register: vi.fn(async () => ({ ok: false as const, error: "attestation" as const })) });
    expect(await createMediaService(owner(), refused, storage, dependencies).upload(PAGE_A, "image", fixtures.jpeg)).toEqual({ ok: false, error: "unavailable" });
    expect(storage.objects.size).toBe(0);
  });

  it("abandons the asset when a key already exists or a write fails", async () => {
    const taken = createMemoryStorageAdapter();
    await taken.put(`${MEDIA_1}/896.webp`, bytes("someone else's bytes"), { contentType: "image/webp", cacheSeconds: 1 });
    const repository = fakeRepository([WS_A]);
    expect(await createMediaService(owner(), repository, taken, dependencies).upload(PAGE_A, "image", fixtures.jpeg)).toEqual({ ok: false, error: "unavailable" });
    expect(repository.fail).toHaveBeenCalledWith(MEDIA_1);
    expect(repository.activate).not.toHaveBeenCalled();

    const failing = fakeRepository([WS_A], { activate: vi.fn(async () => ({ ok: false as const, error: "attestation" as const })) });
    expect(await createMediaService(owner(), failing, createMemoryStorageAdapter(), dependencies).upload(PAGE_A, "image", fixtures.jpeg)).toEqual({ ok: false, error: "unavailable" });
    expect(failing.fail).toHaveBeenCalledWith(MEDIA_1);
  });

  it("reports storage usage only for a page the caller can edit", async () => {
    const service = createMediaService(owner(), fakeRepository([WS_A]), createMemoryStorageAdapter(), dependencies);
    expect(await service.usage(PAGE_A)).toEqual({ ok: true, usage: { usedBytes: 1024, limitBytes: 20 * 1024 * 1024 } });
    expect(await service.usage(PAGE_B)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("upload status machine", () => {
  const media = { mediaId: MEDIA_1, kind: "image" as const, width: 896, height: 672, bytes: 3333 };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
  }

  function setup() {
    const prepares: Array<ReturnType<typeof deferred<PrepareOutcome<string>>>> = [];
    const sends: Array<{ prepared: string; signal: AbortSignal; onProgress: (fraction: number) => void; result: ReturnType<typeof deferred<SendOutcome>> }> = [];
    const controller = createUploadController<string, string>({
      prepare: () => { const call = deferred<PrepareOutcome<string>>(); prepares.push(call); return call.promise; },
      send: (prepared, hooks) => { const result = deferred<SendOutcome>(); sends.push({ prepared, ...hooks, result }); return result.promise; },
    });
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { controller, prepares, sends, flush };
  }

  it("goes through preparing, uploading with progress, processing and done", async () => {
    const { controller, prepares, sends, flush } = setup();
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller.getSnapshot().phase));
    void controller.start("photo.jpg");
    expect(controller.getSnapshot().phase).toBe("preparing");
    prepares[0]?.resolve({ ok: true, prepared: "blob" });
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ phase: "uploading", progress: 0 });
    sends[0]?.onProgress(0.42);
    expect(controller.getSnapshot()).toMatchObject({ phase: "uploading", progress: 0.42 });
    sends[0]?.onProgress(1);
    expect(controller.getSnapshot().phase).toBe("processing");
    sends[0]?.onProgress(0.5);
    expect(controller.getSnapshot().phase).toBe("processing");
    sends[0]?.result.resolve({ ok: true, media });
    await flush();
    expect(controller.getSnapshot()).toEqual({ phase: "done", progress: 1, error: null, media });
    expect(seen).toEqual(["preparing", "uploading", "uploading", "processing", "done"]);
  });

  it("stops at rejected when the browser or the server refuses the file, without retry", async () => {
    const local = setup();
    void local.controller.start("virus.svg");
    local.prepares[0]?.resolve({ ok: false, error: "unsupported" });
    await local.flush();
    expect(local.controller.getSnapshot()).toMatchObject({ phase: "rejected", error: "unsupported" });
    expect(local.sends).toHaveLength(0);

    for (const error of ["too_many_pixels", "quota", "forbidden"] as const) {
      const remote = setup();
      void remote.controller.start("photo.jpg");
      remote.prepares[0]?.resolve({ ok: true, prepared: "blob" });
      await remote.flush();
      remote.sends[0]?.result.resolve({ ok: false, error });
      await remote.flush();
      expect(remote.controller.getSnapshot()).toMatchObject({ phase: "rejected", error });
      await remote.controller.retry();
      expect(remote.sends).toHaveLength(1);
      expect(isRetryableUploadFailure(error)).toBe(false);
    }
  });

  it("fails on a network error and re-sends the prepared file on retry", async () => {
    const { controller, prepares, sends, flush } = setup();
    void controller.start("photo.jpg");
    prepares[0]?.resolve({ ok: true, prepared: "blob" });
    await flush();
    sends[0]?.result.reject(new Error("Failed to fetch"));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ phase: "failed", error: "network" });
    void controller.retry();
    expect(controller.getSnapshot().phase).toBe("uploading");
    expect(prepares).toHaveLength(1);
    expect(sends[1]?.prepared).toBe("blob");
    sends[1]?.result.resolve({ ok: false, error: "unavailable" });
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ phase: "failed", error: "unavailable" });
    void controller.retry();
    sends[2]?.result.resolve({ ok: true, media });
    await flush();
    expect(controller.getSnapshot().phase).toBe("done");
  });

  it("cancels while preparing or uploading and ignores late results", async () => {
    const { controller, prepares, sends, flush } = setup();
    void controller.start("photo.jpg");
    controller.cancel();
    expect(controller.getSnapshot().phase).toBe("canceled");
    prepares[0]?.resolve({ ok: true, prepared: "blob" });
    await flush();
    expect(controller.getSnapshot().phase).toBe("canceled");
    expect(sends).toHaveLength(0);

    void controller.start("photo.jpg");
    prepares[1]?.resolve({ ok: true, prepared: "blob" });
    await flush();
    const signal = sends[0]?.signal;
    controller.cancel();
    expect(signal?.aborted).toBe(true);
    sends[0]?.onProgress(0.9);
    sends[0]?.result.resolve({ ok: true, media });
    await flush();
    expect(controller.getSnapshot()).toEqual({ phase: "canceled", progress: 0, error: null, media: null });
    controller.cancel();
    await controller.retry();
    expect(sends).toHaveLength(1);
  });

  it("lets a new file replace an upload in progress", async () => {
    const { controller, prepares, sends, flush } = setup();
    void controller.start("first.jpg");
    prepares[0]?.resolve({ ok: true, prepared: "first" });
    await flush();
    void controller.start("second.jpg");
    expect(sends[0]?.signal.aborted).toBe(true);
    sends[0]?.result.resolve({ ok: true, media: { ...media, mediaId: MEDIA_2 } });
    prepares[1]?.resolve({ ok: true, prepared: "second" });
    await flush();
    sends[1]?.result.resolve({ ok: true, media });
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ phase: "done", media: { mediaId: MEDIA_1 } });
    controller.reset();
    expect(controller.getSnapshot().phase).toBe("idle");
  });
});

describe("media references and orphans", () => {
  const draft = { avatarPath: MEDIA_1, blocks: [{ type: "image", mediaId: MEDIA_2 }, { type: "link", mediaId: "ignored" }, { type: "image", mediaId: "not-an-id" }] };
  const now = new Date("2026-10-01T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("collects media ids from a draft and from every retained publication", () => {
    expect([...mediaIdsIn(draft)].sort()).toEqual([MEDIA_1, MEDIA_2]);
    expect(mediaIdsIn(null).size).toBe(0);
    expect(mediaIdsIn({ avatarPath: "https://evil.example/x.png", blocks: "nope" }).size).toBe(0);
    const old = "9a000000-0000-4000-8000-000000000003";
    expect([...referencedMediaIds({ avatarPath: null, blocks: [] }, [{ avatarPath: old, blocks: [] }, draft])].sort()).toEqual([MEDIA_1, MEDIA_2, old]);
  });

  it("keeps an image that only a retained publication still uses", () => {
    const referenced = referencedMediaIds({ avatarPath: null, blocks: [] }, [draft]);
    const asset = { id: MEDIA_2, status: "ready" as const, createdAt: ago(30 * ORPHAN_GRACE_MS) };
    expect(isCleanupCandidate(asset, { referenced, now, pagePurgeDue: false })).toBe(false);
    // Once that publication is pruned, the image is an orphan.
    expect(isCleanupCandidate(asset, { referenced: new Set(), now, pagePurgeDue: false })).toBe(true);
  });

  it("applies the grace periods, the page purge and the quota rule", () => {
    const none = new Set<string>();
    const context = { referenced: none, now, pagePurgeDue: false };
    expect(isCleanupCandidate({ id: MEDIA_1, status: "ready", createdAt: ago(ORPHAN_GRACE_MS - 1000) }, context)).toBe(false);
    expect(isCleanupCandidate({ id: MEDIA_1, status: "pending", createdAt: ago(PENDING_GRACE_MS - 1000) }, context)).toBe(false);
    expect(isCleanupCandidate({ id: MEDIA_1, status: "pending", createdAt: ago(PENDING_GRACE_MS + 1000) }, context)).toBe(true);
    expect(isCleanupCandidate({ id: MEDIA_1, status: "failed", createdAt: ago(PENDING_GRACE_MS + 1000) }, context)).toBe(true);
    expect(isCleanupCandidate({ id: MEDIA_1, status: "deleting", createdAt: now }, context)).toBe(true);
    expect(isCleanupCandidate({ id: MEDIA_1, status: "ready", createdAt: now }, { referenced: new Set([MEDIA_1]), now, pagePurgeDue: true })).toBe(true);

    expect(countsTowardQuota({ id: MEDIA_1, status: "ready", createdAt: ago(ORPHAN_GRACE_MS + 1000) }, { referenced: new Set([MEDIA_1]), now })).toBe(true);
    expect(countsTowardQuota({ id: MEDIA_1, status: "ready", createdAt: ago(ORPHAN_GRACE_MS + 1000) }, { referenced: none, now })).toBe(false);
    expect(countsTowardQuota({ id: MEDIA_1, status: "ready", createdAt: ago(1000) }, { referenced: none, now })).toBe(true);
    expect(countsTowardQuota({ id: MEDIA_1, status: "failed", createdAt: ago(1000) }, { referenced: none, now })).toBe(false);
  });
});

describe("crop geometry", () => {
  const source = { width: 4000, height: 3000 };

  it("selects the largest centered rectangle for each aspect", () => {
    expect(cropRect(source, INITIAL_CROP)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(cropRect(source, AVATAR_CROP)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    expect(cropRect(source, { aspect: "16:9", zoom: 1, panX: 0.5, panY: 0.5 })).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
    expect(cropRect({ width: 1000, height: 3000 }, { aspect: "4:5", zoom: 1, panX: 0.5, panY: 0 })).toEqual({ x: 0, y: 0, width: 1000, height: 1250 });
  });

  it("zooms and pans without ever leaving the image", () => {
    expect(cropRect(source, { aspect: "1:1", zoom: 2, panX: 0, panY: 1 })).toEqual({ x: 0, y: 1500, width: 1500, height: 1500 });
    for (const zoom of [0.1, 1, 2.5, 4, 99, Number.NaN]) {
      for (const pan of [-5, 0, 0.3, 1, 7, Number.NaN]) {
        const rect = cropRect(source, { aspect: "4:3", zoom, panX: pan, panY: pan });
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(source.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(source.height);
        expect(rect.width).toBeGreaterThan(0);
      }
    }
  });

  it("scales the result down to the upload size and never enlarges it", () => {
    expect(outputSize({ width: 4000, height: 3000 })).toEqual({ width: 2048, height: 1536 });
    expect(outputSize({ width: 3000, height: 4000 })).toEqual({ width: 1536, height: 2048 });
    expect(outputSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });
});
