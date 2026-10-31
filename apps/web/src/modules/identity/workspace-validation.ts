import type { Copy } from "@/content/copy";
import { APP_COPY as PORTUGUESE_APP_COPY } from "@/content/pt-BR";

/** Mirrors create_agency_workspace(): 2–80 characters after trimming. */
export function validateAgencyName(value: string, APP_COPY: Copy["APP_COPY"] = PORTUGUESE_APP_COPY): { ok: true; value: string } | { ok: false; error: string } {
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 80 ? { ok: true, value: name } : { ok: false, error: APP_COPY.workspace.agencyNameError };
}
