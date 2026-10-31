import type { Copy } from "@/content/copy";
import { isLocale, type Locale } from "@/lib/locale";
import { APP_COPY as PORTUGUESE_APP_COPY, AUTH_COPY as PORTUGUESE_AUTH_COPY, SLUG_COPY as PORTUGUESE_SLUG_COPY } from "@/content/pt-BR";
import type { Database } from "@/lib/database.types";
import { assertEntitlement, EntitlementError, type Entitlements } from "@/modules/entitlements";
import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { validateStoredBlocks, type DraftBlock } from "@/modules/blocks";
import { isMediaId } from "@/modules/media/policy";
import { cloneTheme, isValidTheme, type ThemeTokens } from "@/modules/themes/tokens";
import { validateProfileContent, type ProfileContentField } from "./content";
import { isSlugError, profileErrorMessage, type ProfileErrorKind } from "./errors";
import { fromAvailabilityStatus, validateSlug, type SlugValidation } from "./slug";

export type ProfileStatus = Database["public"]["Enums"]["profile_status"];

export interface ProfileSummary {
  id: string;
  workspaceId: string;
  title: string;
  bio: string;
  slug: string;
  status: ProfileStatus;
  /** Media id of the draft avatar, or null for the initials. */
  avatarPath: string | null;
  /** Draft theme tokens; null is the classic look. */
  theme: ThemeTokens | null;
  /** Draft blocks as stored (tolerant read: outdated content is kept for the editor to flag). */
  blocks: DraftBlock[];
  /** Bumped by the database on every draft content change. */
  draftRevision: number;
  livePublicationId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RepositoryResult<T> = { ok: true; value: T } | { ok: false; error: ProfileErrorKind };

/** Persistence port. The Supabase implementation runs as the signed-in user, under RLS. */
export interface ProfileRepository {
  findById(profileId: string): Promise<ProfileSummary | null>;
  listByWorkspace(workspaceId: string): Promise<ProfileSummary[]>;
  countLive(workspaceId: string): Promise<number>;
  entitlements(workspaceId: string): Promise<Entitlements>;
  insert(input: { workspaceId: string; title: string; bio: string; slug: string }): Promise<RepositoryResult<ProfileSummary>>;
  /** Writes the whole draft only if it is still at `expectedRevision`; otherwise fails with "conflict". */
  updateDraft(profileId: string, expectedRevision: number, draft: DraftContent): Promise<RepositoryResult<ProfileSummary>>;
  changeSlug(profileId: string, slug: string): Promise<RepositoryResult<string>>;
  softDelete(profileId: string): Promise<RepositoryResult<null>>;
  /** Takes the page off the air and freezes it. `wasPublished` tells the caller to drop the public cache. */
  archive(profileId: string): Promise<RepositoryResult<{ slug: string; wasPublished: boolean }>>;
  unarchive(profileId: string): Promise<RepositoryResult<null>>;
  /** One transaction in the database: a new draft page in the same workspace with new block ids. */
  duplicate(profileId: string, title: string, slug: string): Promise<RepositoryResult<string>>;
  checkSlug(slug: string, workspaceId: string | null): Promise<RepositoryResult<{ normalized: string; status: string }>>;
  /** The page's public language (ADR 0022); pt-BR when it cannot be read. */
  locale(profileId: string): Promise<Locale>;
  setLocale(profileId: string, locale: Locale): Promise<RepositoryResult<null>>;
}

export type ProfileField = ProfileContentField | "slug";

/** The editable draft: header, avatar, theme and the ordered blocks (ADR 0008/0010: saved as one unit). */
export interface DraftContent {
  title: string;
  bio: string;
  avatarPath: string | null;
  theme: ThemeTokens | null;
  blocks: DraftBlock[];
}

export interface DraftSnapshot extends DraftContent {
  revision: number;
}

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProfileErrorKind | "validation" | "unauthenticated"; message: string; fieldErrors?: Partial<Record<ProfileField, string>> };

function failure<T>(error: ProfileErrorKind, context: { slug?: string; limit?: number } = {}, APP_COPY: Copy["APP_COPY"] = PORTUGUESE_APP_COPY, SLUG_COPY: Copy["SLUG_COPY"] = PORTUGUESE_SLUG_COPY): CommandResult<T> {
  const message = profileErrorMessage(error, context, APP_COPY, SLUG_COPY);
  return isSlugError(error) ? { ok: false, error, message, fieldErrors: { slug: message } } : { ok: false, error, message };
}

function authorizationFailure<T>(error: unknown, APP_COPY: Copy["APP_COPY"] = PORTUGUESE_APP_COPY): CommandResult<T> {
  if (!(error instanceof AuthorizationError)) throw error;
  if (error.reason === "unauthenticated") return { ok: false, error: "unauthenticated", message: APP_COPY.errors.sessionExpired };
  return failure(error.reason === "forbidden" ? "forbidden" : "not_found", {}, APP_COPY);
}

function slugFailure<T>(validation: SlugValidation): CommandResult<T> {
  return { ok: false, error: "validation", message: validation.message, fieldErrors: { slug: validation.message } };
}

/**
 * Page commands. Every command authorizes on the server through requireWorkspaceAccess (membership
 * re-read per request) before touching the repository; RLS and the database RPCs check again.
 */
export function createProfileService(identity: IdentityPort, repository: ProfileRepository, APP_COPY: Copy["APP_COPY"] = PORTUGUESE_APP_COPY, AUTH_COPY: Copy["AUTH_COPY"] = PORTUGUESE_AUTH_COPY, SLUG_COPY: Copy["SLUG_COPY"] = PORTUGUESE_SLUG_COPY) {
  // Messages in the language of the person acting (ADR 0022).
  const VALIDATION_SUMMARY = AUTH_COPY.validation.summary;
  /** Loads a page visible to the caller and authorizes the action against its workspace. */
  async function authorizeProfile(profileId: unknown, action: Parameters<typeof requireWorkspaceAccess>[2]) {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const profile = await repository.findById(profileId);
    if (!profile) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, profile.workspaceId, action);
    return profile;
  }

  return {
    async create(workspaceId: unknown, input: { title: unknown; bio: unknown; slug: unknown }): Promise<CommandResult<ProfileSummary>> {
      let access;
      try {
        access = await requireWorkspaceAccess(identity, workspaceId, "profile.create");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const content = validateProfileContent(input, APP_COPY);
      const slug = validateSlug(typeof input.slug === "string" ? input.slug : "", [], SLUG_COPY);
      if (!content.ok || !slug.valid) {
        const fieldErrors = { ...(content.ok ? {} : content.errors), ...(slug.valid ? {} : { slug: slug.message }) };
        return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors };
      }

      const entitlements = await repository.entitlements(access.workspaceId);
      try {
        assertEntitlement(entitlements, "max_profiles", await repository.countLive(access.workspaceId));
      } catch (error) {
        if (error instanceof EntitlementError) return failure("limit_reached", { limit: entitlements.limits.max_profiles }, APP_COPY, SLUG_COPY);
        throw error;
      }

      const inserted = await repository.insert({ workspaceId: access.workspaceId, title: content.value.title, bio: content.value.bio, slug: slug.normalized });
      if (!inserted.ok) return failure(inserted.error, { slug: slug.normalized, limit: entitlements.limits.max_profiles }, APP_COPY, SLUG_COPY);
      return inserted;
    },

    /**
     * Autosave: replaces title, bio, avatar, theme and the ordered blocks in one conditional write against the
     * revision the editor last confirmed. The payload is untrusted and validated exactly like the
     * database (values must already be normalized); nothing is repaired here.
     */
    async saveDraft(profileId: unknown, payload: unknown): Promise<CommandResult<{ revision: number }>> {
      try {
        await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      const expectedRevision = input.expectedRevision;
      if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        return { ok: false, error: "validation", message: VALIDATION_SUMMARY };
      }
      const content = validateProfileContent({ title: input.title, bio: input.bio }, APP_COPY);
      if (!content.ok) return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors: content.errors };
      const blocks = validateStoredBlocks(input.blocks);
      if (!blocks.ok) return { ok: false, error: "validation", message: profileErrorMessage("content_invalid", {}, APP_COPY, SLUG_COPY) };
      // Theme and avatar are required keys: null means "classic look" / "initials", never "keep what is stored".
      const { theme, avatarPath } = input;
      if (theme !== null && !isValidTheme(theme)) return { ok: false, error: "validation", message: profileErrorMessage("content_invalid", {}, APP_COPY, SLUG_COPY) };
      if (avatarPath !== null && !isMediaId(avatarPath)) return { ok: false, error: "validation", message: profileErrorMessage("content_invalid", {}, APP_COPY, SLUG_COPY) };

      const updated = await repository.updateDraft(profileId as string, expectedRevision, {
        title: content.value.title, bio: content.value.bio, avatarPath, theme: theme === null ? null : cloneTheme(theme), blocks: blocks.blocks,
      });
      return updated.ok ? { ok: true, value: { revision: updated.value.draftRevision } } : failure(updated.error, {}, APP_COPY, SLUG_COPY);
    },

    /** Current saved draft, used by the editor to recover from a conflict. */
    async loadDraft(profileId: unknown): Promise<CommandResult<DraftSnapshot>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      return { ok: true, value: { title: profile.title, bio: profile.bio, avatarPath: profile.avatarPath, theme: profile.theme, blocks: profile.blocks, revision: profile.draftRevision } };
    },

    /** Sets the language of the words the product shows on the page; answers its address. */
    async setLocale(profileId: unknown, rawLocale: unknown): Promise<CommandResult<string>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      if (!isLocale(rawLocale)) return { ok: false, error: "validation", message: VALIDATION_SUMMARY };
      if (profile.status === "archived") return failure("archived", {}, APP_COPY, SLUG_COPY);
      const set = await repository.setLocale(profile.id, rawLocale);
      return set.ok ? { ok: true, value: profile.slug } : failure(set.error, {}, APP_COPY, SLUG_COPY);
    },

    async changeSlug(profileId: unknown, rawSlug: unknown): Promise<CommandResult<string>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.change_slug");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const slug = validateSlug(typeof rawSlug === "string" ? rawSlug : "", [], SLUG_COPY);
      if (!slug.valid) return slugFailure(slug);
      if (slug.normalized === profile.slug) return { ok: true, value: profile.slug };
      const changed = await repository.changeSlug(profile.id, slug.normalized);
      return changed.ok ? changed : failure(changed.error, { slug: slug.normalized }, APP_COPY, SLUG_COPY);
    },

    /** Current address of a page the caller can see (for cache invalidation), or null. */
    async currentSlug(profileId: unknown): Promise<string | null> {
      if (!isUuid(profileId)) return null;
      return (await repository.findById(profileId))?.slug ?? null;
    },

    async softDelete(profileId: unknown): Promise<CommandResult<{ workspaceId: string; slug: string }>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.delete");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const deleted = await repository.softDelete(profile.id);
      return deleted.ok ? { ok: true, value: { workspaceId: profile.workspaceId, slug: profile.slug } } : failure(deleted.error, {}, APP_COPY, SLUG_COPY);
    },

    /** Owners and admins. Returns the address so the caller can invalidate the cached public page. */
    async archive(profileId: unknown): Promise<CommandResult<{ workspaceId: string; slug: string; wasPublished: boolean }>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.archive");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const archived = await repository.archive(profile.id);
      return archived.ok ? { ok: true, value: { workspaceId: profile.workspaceId, slug: archived.value.slug, wasPublished: archived.value.wasPublished } } : failure(archived.error, {}, APP_COPY, SLUG_COPY);
    },

    /** Back to a draft; never republishes. */
    async unarchive(profileId: unknown): Promise<CommandResult<{ workspaceId: string }>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.archive");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const restored = await repository.unarchive(profile.id);
      return restored.ok ? { ok: true, value: { workspaceId: profile.workspaceId } } : failure(restored.error, {}, APP_COPY, SLUG_COPY);
    },

    /**
     * Deep copy into a new draft of the same workspace. The target workspace is never an input: it
     * is the source page's, re-read here and again inside the database function.
     */
    async duplicate(profileId: unknown, input: { title: unknown; slug: unknown }): Promise<CommandResult<{ workspaceId: string; profileId: string }>> {
      let source;
      try {
        source = await authorizeProfile(profileId, "profile.duplicate");
      } catch (error) {
        return authorizationFailure(error, APP_COPY);
      }
      const content = validateProfileContent({ title: input.title, bio: "" }, APP_COPY);
      const slug = validateSlug(typeof input.slug === "string" ? input.slug : "", [], SLUG_COPY);
      if (!content.ok || !slug.valid) {
        const fieldErrors = { ...(content.ok ? {} : content.errors), ...(slug.valid ? {} : { slug: slug.message }) };
        return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors };
      }

      const entitlements = await repository.entitlements(source.workspaceId);
      try {
        assertEntitlement(entitlements, "max_profiles", await repository.countLive(source.workspaceId));
      } catch (error) {
        if (error instanceof EntitlementError) return failure("limit_reached", { limit: entitlements.limits.max_profiles }, APP_COPY, SLUG_COPY);
        throw error;
      }

      const created = await repository.duplicate(source.id, content.value.title, slug.normalized);
      if (!created.ok) return failure(created.error, { slug: slug.normalized, limit: entitlements.limits.max_profiles }, APP_COPY, SLUG_COPY);
      return { ok: true, value: { workspaceId: source.workspaceId, profileId: created.value } };
    },

    /** Debounced availability check. Local rules first; the database decides taken/held. */
    async checkSlug(rawSlug: unknown, workspaceId: unknown): Promise<SlugValidation> {
      const local = validateSlug(typeof rawSlug === "string" ? rawSlug : "", [], SLUG_COPY);
      if (!local.valid) return local;
      try {
        await requireUser(identity);
      } catch {
        return { ...local, valid: false, status: "invalid", message: APP_COPY.errors.sessionExpired };
      }
      const checked = await repository.checkSlug(local.normalized, isUuid(workspaceId) ? workspaceId : null);
      if (!checked.ok) return { ...local, valid: false, status: "invalid", message: profileErrorMessage("unavailable", {}, APP_COPY, SLUG_COPY) };
      return fromAvailabilityStatus(checked.value.normalized, checked.value.status, SLUG_COPY);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
