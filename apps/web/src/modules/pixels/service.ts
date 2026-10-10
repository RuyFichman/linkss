import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { parsePixelsInput, type PixelField, type PixelsInput } from "./model";

/**
 * Pixels of a page (ADR 0017): read and set. Authorization happens here first (membership re-read
 * per request, owners and admins change) and again in public.set_profile_pixels.
 */
export type PixelsErrorKind = "invalid" | "not_in_plan" | "forbidden" | "not_found" | "not_deployed" | "unavailable";
export type PixelsCommandError = PixelsErrorKind | "unauthenticated";
export type PixelsResult<T> = { ok: true; value: T } | { ok: false; error: PixelsCommandError; field?: PixelField };
export type PixelsRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: PixelsErrorKind; field?: PixelField };

export function pixelsErrorFromDatabase(error: { code?: string | null; details?: string | null }): { error: PixelsErrorKind; field?: PixelField } {
  if (isMissingSchemaError(error)) return { error: "not_deployed" };
  switch (error.code) {
    case "22023": return { error: "invalid", ...(error.details === "meta" || error.details === "ga" ? { field: error.details } : {}) };
    case "LK010": return { error: "not_in_plan" };
    case "42501": return { error: "forbidden" };
    case "P0002":
    case "PGRST116": return { error: "not_found" };
    default: return { error: "unavailable" };
  }
}

export interface PixelsRepository {
  findProfileWorkspace(profileId: string): Promise<string | null>;
  find(profileId: string): Promise<PixelsRepositoryResult<PixelsInput>>;
  set(profileId: string, input: PixelsInput): Promise<PixelsRepositoryResult<{ slug: string; isLive: boolean }>>;
}

export function createPixelsService(identity: IdentityPort, repository: PixelsRepository) {
  async function authorize(profileId: unknown, action: "pixels.view" | "pixels.manage"): Promise<string> {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const workspaceId = await repository.findProfileWorkspace(profileId);
    if (!workspaceId) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, workspaceId, action);
    return profileId;
  }

  function failure<T>(error: unknown): PixelsResult<T> {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false, error: error.reason };
  }

  return {
    async get(profileId: unknown): Promise<PixelsResult<PixelsInput>> {
      try {
        return await repository.find(await authorize(profileId, "pixels.view"));
      } catch (error) {
        return failure(error);
      }
    },

    /** Sets or clears the identifiers. Returns the page address so the caller drops its public cache. */
    async set(profileId: unknown, raw: { meta: unknown; ga: unknown }): Promise<PixelsResult<{ slug: string; isLive: boolean }>> {
      let authorized: string;
      try {
        authorized = await authorize(profileId, "pixels.manage");
      } catch (error) {
        return failure(error);
      }
      const input = parsePixelsInput(raw);
      if (!input.ok) return { ok: false, error: "invalid", field: input.field };
      return repository.set(authorized, input.value);
    },
  };
}
