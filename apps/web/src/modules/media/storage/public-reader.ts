import "server-only";
import { MAX_VARIANT_BYTES, detectImageFormat } from "../policy";
import { publicMediaUrl } from "../url";

/** Public bucket read: no service key, cookies, arbitrary URL or redirect from a request. */
export async function readPublicMedia(key: string, expectedBytes: number): Promise<Uint8Array> {
  if (!/^[0-9a-f-]{36}\/\d{1,4}\.webp$/i.test(key) || !Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_VARIANT_BYTES) {
    throw new Error("Invalid media read");
  }
  const response = await fetch(publicMediaUrl(key), {
    cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.body) throw new Error("Media unavailable");
  const reader = response.body.getReader();
  const body = new Uint8Array(expectedBytes);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedBytes) throw new Error("Media size mismatch");
      body.set(value, size - value.byteLength);
    }
    if (size !== expectedBytes || detectImageFormat(body) !== "webp") throw new Error("Media content mismatch");
    return body;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
