import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { activatePayload, registerPayload, type AttestedVariant } from "./attestation";
import { isMediaKind, STORED_CACHE_SECONDS, STORED_CONTENT_TYPE, variantKey, type ImageSize, type MediaKind, type UploadRejection } from "./policy";
import type { ProcessResult } from "./process";
import type { StorageAdapter } from "./storage/adapter";

export type MediaRepositoryError = "quota" | "rate_limited" | "forbidden" | "not_found" | "attestation" | "not_configured" | "unavailable";
export type MediaRepositoryResult = { ok: true } | { ok: false; error: MediaRepositoryError };

export interface RegisterMediaInput {
  mediaId: string;
  profileId: string;
  kind: MediaKind;
  width: number;
  height: number;
  variants: AttestedVariant[];
  signature: string;
}

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
}

/** Persistence port. The Supabase implementation calls the media RPCs as the signed-in user. */
export interface MediaRepository {
  /** The page if the caller can see it (RLS), with its workspace. */
  findProfile(profileId: string): Promise<{ id: string; workspaceId: string } | null>;
  register(input: RegisterMediaInput): Promise<MediaRepositoryResult>;
  activate(mediaId: string, signature: string): Promise<MediaRepositoryResult>;
  /** Marks the caller's own pending asset as failed so cleanup removes whatever was written. */
  fail(mediaId: string): Promise<void>;
  usage(workspaceId: string): Promise<StorageUsage>;
}

export type UploadErrorKind = UploadRejection | "quota" | "rate_limited" | "forbidden" | "not_found" | "unauthenticated" | "unavailable";

export interface UploadedMedia {
  mediaId: string;
  kind: MediaKind;
  width: number;
  height: number;
  bytes: number;
}

export type UploadResult = { ok: true; media: UploadedMedia } | { ok: false; error: UploadErrorKind };

export interface MediaServiceDependencies {
  /** Signs an attestation payload, or null when MEDIA_SIGNING_SECRET is not configured. */
  sign: ((payload: string) => string) | null;
  process: (bytes: Uint8Array, kind: MediaKind) => Promise<ProcessResult>;
  newId: () => string;
}

function repositoryFailure(error: MediaRepositoryError): UploadErrorKind {
  switch (error) {
    case "quota":
    case "rate_limited":
    case "forbidden":
    case "not_found":
      return error;
    // A refused signature or a missing secret is an operational problem, not something the person can fix.
    default:
      return "unavailable";
  }
}

/**
 * Upload command (ADR 0009): authorize, validate and re-encode, register with a signature, store
 * each variant as the signed-in user, activate. Nothing is referenced by a draft until the asset is
 * `ready`; any failure after registration marks it `failed`, and cleanup removes what was written.
 */
export function createMediaService(identity: IdentityPort, repository: MediaRepository, storage: StorageAdapter, dependencies: MediaServiceDependencies) {
  async function authorize(profileId: unknown): Promise<{ id: string; workspaceId: string }> {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const profile = await repository.findProfile(profileId);
    if (!profile) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, profile.workspaceId, "profile.edit_content");
    return profile;
  }

  function authorizationFailure(error: unknown): UploadErrorKind {
    if (!(error instanceof AuthorizationError)) throw error;
    return error.reason;
  }

  return {
    async upload(profileId: unknown, kind: unknown, bytes: Uint8Array): Promise<UploadResult> {
      let profile;
      try {
        profile = await authorize(profileId);
      } catch (error) {
        return { ok: false, error: authorizationFailure(error) };
      }
      if (!isMediaKind(kind)) return { ok: false, error: "unsupported" };
      const { sign } = dependencies;
      if (!sign) return { ok: false, error: "unavailable" };

      const processed = await dependencies.process(bytes, kind);
      if (!processed.ok) return { ok: false, error: processed.reason };

      const mediaId = dependencies.newId();
      const master: ImageSize = processed.master;
      const variants = processed.variants.map(({ width, height, bytes: size }) => ({ width, height, bytes: size }));
      const attestation = { mediaId, profileId: profile.id, kind, width: master.width, height: master.height, variants };
      const registered = await repository.register({ ...attestation, signature: sign(registerPayload(attestation)) });
      if (!registered.ok) return { ok: false, error: repositoryFailure(registered.error) };

      try {
        for (const variant of processed.variants) {
          const outcome = await storage.put(variantKey(mediaId, variant.width), variant.body, { contentType: STORED_CONTENT_TYPE, cacheSeconds: STORED_CACHE_SECONDS });
          // Someone else wrote to this key first: the asset cannot be trusted and is abandoned.
          if (outcome !== "created") throw new Error("object already exists");
        }
        const activated = await repository.activate(mediaId, sign(activatePayload(mediaId)));
        if (!activated.ok) throw new Error(`activation failed: ${activated.error}`);
      } catch {
        await repository.fail(mediaId).catch(() => undefined);
        return { ok: false, error: "unavailable" };
      }

      return { ok: true, media: { mediaId, kind, width: master.width, height: master.height, bytes: variants.reduce((total, variant) => total + variant.bytes, 0) } };
    },

    /** Bytes used and allowed for the workspace of a page the caller can edit. */
    async usage(profileId: unknown): Promise<{ ok: true; usage: StorageUsage } | { ok: false; error: UploadErrorKind }> {
      try {
        const profile = await authorize(profileId);
        return { ok: true, usage: await repository.usage(profile.workspaceId) };
      } catch (error) {
        return { ok: false, error: authorizationFailure(error) };
      }
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;
