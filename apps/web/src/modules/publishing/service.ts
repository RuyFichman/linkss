import { APP_COPY, PUBLISHING_COPY } from "@/content/pt-BR";
import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";

export interface PublishTarget {
  id: string;
  workspaceId: string;
  slug: string;
  draftRevision: number;
  livePublicationId: string | null;
  publishedAt: string | null;
}

export interface PublicationSummary {
  id: string;
  version: number;
  sourceRevision: number;
  createdAt: string;
}

export type PublishingErrorKind = "stale" | "forbidden" | "not_found" | "unavailable";
export type RepositoryResult<T> = { ok: true; value: T } | { ok: false; error: PublishingErrorKind };

/** Persistence port. The Supabase implementation calls the publishing RPCs as the signed-in user. */
export interface PublishingRepository {
  findTarget(profileId: string): Promise<PublishTarget | null>;
  listPublications(profileId: string, limit: number): Promise<PublicationSummary[]>;
  publish(profileId: string, expectedRevision: number | null): Promise<RepositoryResult<{ publicationId: string; version: number; created: boolean }>>;
  restore(profileId: string, publicationId: string): Promise<RepositoryResult<number>>;
  unpublish(profileId: string): Promise<RepositoryResult<null>>;
}

export type PublishingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublishingErrorKind | "unauthenticated"; message: string };

/** Versions shown in the app; the database keeps the same number (private.publication_retention_count). */
export const PUBLICATION_HISTORY_LIMIT = 10;

export type PublicationState = "never" | "live_current" | "live_outdated" | "offline";

/** What the owner sees: never published, on the air (up to date or with pending changes), or taken down. */
export function publicationState(target: Pick<PublishTarget, "draftRevision" | "livePublicationId">, publications: readonly PublicationSummary[]): PublicationState {
  if (!target.livePublicationId) return publications.length > 0 ? "offline" : "never";
  const live = publications.find((publication) => publication.id === target.livePublicationId);
  return live && live.sourceRevision === target.draftRevision ? "live_current" : "live_outdated";
}

export function publishingErrorFromDatabase(error: { code?: string | null }): PublishingErrorKind {
  switch (error.code) {
    case "LK030": return "stale";
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

function failure<T>(error: PublishingErrorKind): PublishingResult<T> {
  const message = error === "stale" ? PUBLISHING_COPY.errors.stale
    : error === "forbidden" ? PUBLISHING_COPY.errors.forbidden
    : error === "not_found" ? APP_COPY.errors.notFound
    : PUBLISHING_COPY.errors.unavailable;
  return { ok: false, error, message };
}

function authorizationFailure<T>(error: unknown): PublishingResult<T> {
  if (!(error instanceof AuthorizationError)) throw error;
  if (error.reason === "unauthenticated") return { ok: false, error: "unauthenticated", message: APP_COPY.errors.sessionExpired };
  return failure(error.reason === "forbidden" ? "forbidden" : "not_found");
}

/**
 * Publishing commands. Authorization happens here first (membership re-read per request, action
 * `profile.publish`), then again inside the security definer RPCs. Results carry the slug so the
 * caller can invalidate the cached public page.
 */
export function createPublishingService(identity: IdentityPort, repository: PublishingRepository) {
  async function authorize(profileId: unknown): Promise<PublishTarget> {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const target = await repository.findTarget(profileId);
    if (!target) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, target.workspaceId, "profile.publish");
    return target;
  }

  return {
    async publish(profileId: unknown, expectedRevision: unknown): Promise<PublishingResult<{ slug: string; version: number; created: boolean }>> {
      let target;
      try {
        target = await authorize(profileId);
      } catch (error) {
        return authorizationFailure(error);
      }
      const revision = typeof expectedRevision === "string" && /^\d{1,15}$/.test(expectedRevision) ? Number(expectedRevision)
        : typeof expectedRevision === "number" && Number.isSafeInteger(expectedRevision) ? expectedRevision
        : null;
      const published = await repository.publish(target.id, revision);
      if (!published.ok) return failure(published.error);
      return { ok: true, value: { slug: target.slug, version: published.value.version, created: published.value.created } };
    },

    async restore(profileId: unknown, publicationId: unknown): Promise<PublishingResult<{ slug: string; version: number }>> {
      let target;
      try {
        target = await authorize(profileId);
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!isUuid(publicationId)) return failure("not_found");
      const restored = await repository.restore(target.id, publicationId);
      return restored.ok ? { ok: true, value: { slug: target.slug, version: restored.value } } : failure(restored.error);
    },

    async unpublish(profileId: unknown): Promise<PublishingResult<{ slug: string }>> {
      let target;
      try {
        target = await authorize(profileId);
      } catch (error) {
        return authorizationFailure(error);
      }
      const result = await repository.unpublish(target.id);
      return result.ok ? { ok: true, value: { slug: target.slug } } : failure(result.error);
    },
  };
}

export type PublishingService = ReturnType<typeof createPublishingService>;
