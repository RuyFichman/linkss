import { APP_COPY, AUTH_COPY } from "@/content/pt-BR";
import type { Database } from "@/lib/database.types";
import { assertEntitlement, EntitlementError, type Entitlements } from "@/modules/entitlements";
import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import type { SocialLink, SocialNetwork } from "@/modules/publishing/social";
import { validateProfileContent, type ProfileContentField } from "./content";
import { MAX_BLOCKS, validateLinkInput, validateSocialForm, type DraftLinkBlock, type LinkField } from "./draft-content";
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
  avatarPath: string | null;
  socialLinks: SocialLink[];
  blocks: DraftLinkBlock[];
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
  updateContent(profileId: string, input: { title: string; bio: string }): Promise<RepositoryResult<ProfileSummary>>;
  /** Writes only if the draft is still at `expectedRevision`; otherwise fails with "conflict". */
  updateDraft(profileId: string, expectedRevision: number, patch: { socialLinks?: SocialLink[]; blocks?: DraftLinkBlock[] }): Promise<RepositoryResult<ProfileSummary>>;
  changeSlug(profileId: string, slug: string): Promise<RepositoryResult<string>>;
  softDelete(profileId: string): Promise<RepositoryResult<null>>;
  checkSlug(slug: string, workspaceId: string | null): Promise<RepositoryResult<{ normalized: string; status: string }>>;
}

export type ProfileField = ProfileContentField | "slug" | LinkField | SocialNetwork;

const VALIDATION_SUMMARY = AUTH_COPY.validation.summary;

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProfileErrorKind | "validation" | "unauthenticated"; message: string; fieldErrors?: Partial<Record<ProfileField, string>> };

function failure<T>(error: ProfileErrorKind, context: { slug?: string; limit?: number } = {}): CommandResult<T> {
  const message = profileErrorMessage(error, context);
  return isSlugError(error) ? { ok: false, error, message, fieldErrors: { slug: message } } : { ok: false, error, message };
}

function authorizationFailure<T>(error: unknown): CommandResult<T> {
  if (!(error instanceof AuthorizationError)) throw error;
  if (error.reason === "unauthenticated") return { ok: false, error: "unauthenticated", message: APP_COPY.errors.sessionExpired };
  return failure(error.reason === "forbidden" ? "forbidden" : "not_found");
}

function slugFailure<T>(validation: SlugValidation): CommandResult<T> {
  return { ok: false, error: "validation", message: validation.message, fieldErrors: { slug: validation.message } };
}

/**
 * Page commands. Every command authorizes on the server through requireWorkspaceAccess (membership
 * re-read per request) before touching the repository; RLS and the database RPCs check again.
 */
export function createProfileService(identity: IdentityPort, repository: ProfileRepository) {
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
        return authorizationFailure(error);
      }
      const content = validateProfileContent(input);
      const slug = validateSlug(typeof input.slug === "string" ? input.slug : "");
      if (!content.ok || !slug.valid) {
        const fieldErrors = { ...(content.ok ? {} : content.errors), ...(slug.valid ? {} : { slug: slug.message }) };
        return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors };
      }

      const entitlements = await repository.entitlements(access.workspaceId);
      try {
        assertEntitlement(entitlements, "max_profiles", await repository.countLive(access.workspaceId));
      } catch (error) {
        if (error instanceof EntitlementError) return failure("limit_reached", { limit: entitlements.limits.max_profiles });
        throw error;
      }

      const inserted = await repository.insert({ workspaceId: access.workspaceId, title: content.value.title, bio: content.value.bio, slug: slug.normalized });
      if (!inserted.ok) return failure(inserted.error, { slug: slug.normalized, limit: entitlements.limits.max_profiles });
      return inserted;
    },

    async updateContent(profileId: unknown, input: { title: unknown; bio: unknown }): Promise<CommandResult<ProfileSummary>> {
      try {
        await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error);
      }
      const content = validateProfileContent(input);
      if (!content.ok) return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors: content.errors };
      const updated = await repository.updateContent(profileId as string, content.value);
      return updated.ok ? updated : failure(updated.error);
    },

    async updateSocialLinks(profileId: unknown, input: Partial<Record<SocialNetwork, unknown>>): Promise<CommandResult<ProfileSummary>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error);
      }
      const social = validateSocialForm(input);
      if (!social.ok) return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors: social.errors };
      const updated = await repository.updateDraft(profile.id, profile.draftRevision, { socialLinks: social.value });
      return updated.ok ? updated : failure(updated.error);
    },

    /** Adds a link (linkId null) or edits an existing one, keeping its position and visibility. */
    async saveLink(profileId: unknown, linkId: unknown, input: { title: unknown; url: unknown }): Promise<CommandResult<ProfileSummary>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error);
      }
      const link = validateLinkInput(input);
      if (!link.ok) return { ok: false, error: "validation", message: VALIDATION_SUMMARY, fieldErrors: link.errors };

      let blocks: DraftLinkBlock[];
      if (linkId === null) {
        if (profile.blocks.length >= MAX_BLOCKS) return { ok: false, error: "validation", message: APP_COPY.links.limit };
        blocks = [...profile.blocks, { id: crypto.randomUUID(), type: "link", visible: true, ...link.value }];
      } else {
        if (!profile.blocks.some((block) => block.id === linkId)) return failure("not_found");
        blocks = profile.blocks.map((block) => (block.id === linkId ? { ...block, ...link.value } : block));
      }
      const updated = await repository.updateDraft(profile.id, profile.draftRevision, { blocks });
      return updated.ok ? updated : failure(updated.error);
    },

    async removeLink(profileId: unknown, linkId: unknown): Promise<CommandResult<ProfileSummary>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!profile.blocks.some((block) => block.id === linkId)) return failure("not_found");
      const updated = await repository.updateDraft(profile.id, profile.draftRevision, { blocks: profile.blocks.filter((block) => block.id !== linkId) });
      return updated.ok ? updated : failure(updated.error);
    },

    async moveLink(profileId: unknown, linkId: unknown, direction: unknown): Promise<CommandResult<ProfileSummary>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.edit_content");
      } catch (error) {
        return authorizationFailure(error);
      }
      const index = profile.blocks.findIndex((block) => block.id === linkId);
      if (index < 0 || (direction !== "up" && direction !== "down")) return failure("not_found");
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= profile.blocks.length) return { ok: true, value: profile };
      const blocks = [...profile.blocks];
      [blocks[index], blocks[target]] = [blocks[target] as DraftLinkBlock, blocks[index] as DraftLinkBlock];
      const updated = await repository.updateDraft(profile.id, profile.draftRevision, { blocks });
      return updated.ok ? updated : failure(updated.error);
    },

    async changeSlug(profileId: unknown, rawSlug: unknown): Promise<CommandResult<string>> {
      let profile;
      try {
        profile = await authorizeProfile(profileId, "profile.change_slug");
      } catch (error) {
        return authorizationFailure(error);
      }
      const slug = validateSlug(typeof rawSlug === "string" ? rawSlug : "");
      if (!slug.valid) return slugFailure(slug);
      if (slug.normalized === profile.slug) return { ok: true, value: profile.slug };
      const changed = await repository.changeSlug(profile.id, slug.normalized);
      return changed.ok ? changed : failure(changed.error, { slug: slug.normalized });
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
        return authorizationFailure(error);
      }
      const deleted = await repository.softDelete(profile.id);
      return deleted.ok ? { ok: true, value: { workspaceId: profile.workspaceId, slug: profile.slug } } : failure(deleted.error);
    },

    /** Debounced availability check. Local rules first; the database decides taken/held. */
    async checkSlug(rawSlug: unknown, workspaceId: unknown): Promise<SlugValidation> {
      const local = validateSlug(typeof rawSlug === "string" ? rawSlug : "");
      if (!local.valid) return local;
      try {
        await requireUser(identity);
      } catch {
        return { ...local, valid: false, status: "invalid", message: APP_COPY.errors.sessionExpired };
      }
      const checked = await repository.checkSlug(local.normalized, isUuid(workspaceId) ? workspaceId : null);
      if (!checked.ok) return { ...local, valid: false, status: "invalid", message: profileErrorMessage("unavailable") };
      return fromAvailabilityStatus(checked.value.normalized, checked.value.status);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
