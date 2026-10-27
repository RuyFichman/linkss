import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readPublicMedia } from "./public-reader";

const KEY = "22222222-2222-4222-8222-222222222222/448.webp";
const WEBP = new TextEncoder().encode("RIFF1234WEBP");

afterEach(() => vi.unstubAllGlobals());
describe("public storage export reader", () => {
  it("fetches the configured storage address without cookies, cache or redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(WEBP));
    vi.stubGlobal("fetch", fetcher);
    expect(await readPublicMedia(KEY, WEBP.length)).toEqual(WEBP);
    expect(fetcher.mock.calls[0]?.[0]).toContain(`/media/${KEY}`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
  });
  it.each(["https://evil.example/image", "../../private", "22222222-2222-4222-8222-222222222222/448.webp?x=1"])("refuses a caller URL or path: %s", async (key) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readPublicMedia(key, WEBP.length)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([0, -1, 3 * 1024 * 1024, 1.5])("refuses invalid sizes before fetching: %s", async (size) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readPublicMedia(KEY, size)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([404, 503])("does not return a storage error document (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status })));
    await expect(readPublicMedia(KEY, WEBP.length)).rejects.toThrow();
  });
  it("cancels a chunked oversized response even when Content-Length lies", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-length": "1" } })));
    await expect(readPublicMedia(KEY, WEBP.length)).rejects.toThrow("size mismatch");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects truncated and non-WebP content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(WEBP.slice(0, 6))));
    await expect(readPublicMedia(KEY, WEBP.length)).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(WEBP.length))));
    await expect(readPublicMedia(KEY, WEBP.length)).rejects.toThrow();
  });
  it("propagates network failure without returning an incomplete file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(readPublicMedia(KEY, WEBP.length)).rejects.toThrow();
  });
});
