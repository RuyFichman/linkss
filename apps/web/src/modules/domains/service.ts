import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { DomainsProviderError, type DomainRouting, type DomainsAdapter } from "./adapter";
import type { DnsPort } from "./dns";
import { challengeRecordName, validateHostname } from "./hostname";

/**
 * Custom domains of a page (ADR 0016): claim, prove control, remove. Authorization happens here
 * first (membership re-read per request, owners and admins only) and again in the security
 * definer RPCs. The proof is a DNS read made by this server and signed for the database; nothing
 * a browser sends can stand in for it.
 */
export type DomainStatus = "pending" | "active" | "lapsed";
export type StoredRouting = "unknown" | "pending" | "ok";

export interface DomainSummary {
  id: string;
  profileId: string;
  workspaceId: string;
  hostname: string;
  challenge: string;
  status: DomainStatus;
  routing: StoredRouting;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  /** Consecutive daily re-verifications that did not find the proof; 0 before the migration that counts them. */
  recheckMisses: number;
  /** `recheck`: lapsed because the proof was absent for the whole grace period. */
  lapseReason: "recheck" | null;
}

/** Days without the proof after which the daily job lapses an active domain. Mirror of private.domain_recheck_limit(). */
export const DOMAIN_RECHECK_LIMIT = 7;

export type DomainErrorKind =
  | "invalid"
  | "blocked"
  | "not_in_plan"
  | "already_set"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "not_deployed"
  | "not_configured"
  | "dns_unavailable"
  | "unavailable";

export type DomainCommandError = DomainErrorKind | "unauthenticated" | "empty";
export type DomainResult<T> = { ok: true; value: T } | { ok: false; error: DomainCommandError };
export type DomainRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: DomainErrorKind };

/** Maps the SQLSTATE contract of ADR 0016 to one outcome per failure. */
export function domainErrorFromDatabase(error: { code?: string | null; details?: string | null }): DomainErrorKind {
  if (isMissingSchemaError(error)) return "not_deployed";
  switch (error.code) {
    case "22023": return error.details === "blocked" ? "blocked" : "invalid";
    case "LK010": return "not_in_plan";
    case "LK120": return "already_set";
    case "LK121": return "rate_limited";
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

/** What public.confirm_profile_domain answered. */
export type ConfirmStatus = "active" | "dns_missing" | "in_use" | "not_in_plan";
export interface ConfirmOutcome {
  status: ConfirmStatus;
  /** Pages whose public cache changes (the page itself and pages that lost the hostname). */
  slugs: string[];
}

export interface DomainsRepository {
  findProfileWorkspace(profileId: string): Promise<string | null>;
  /** A domain the caller may see (RLS: members of its workspace), or null. */
  findDomain(domainId: string): Promise<DomainSummary | null>;
  findForProfile(profileId: string): Promise<DomainRepositoryResult<DomainSummary | null>>;
  claim(profileId: string, hostname: string): Promise<DomainRepositoryResult<{ id: string; hostname: string; challenge: string }>>;
  confirm(text: string, signature: string): Promise<DomainRepositoryResult<ConfirmOutcome>>;
  remove(domainId: string): Promise<DomainRepositoryResult<{ hostname: string; slug: string | null; wasActive: boolean }>>;
}

export interface DomainsServiceDependencies {
  identity: IdentityPort;
  repository: DomainsRepository;
  dns: DnsPort;
  /** Null when no hosting provider is configured in this environment. */
  adapter: DomainsAdapter | null;
  /** Null when the signing secret is missing. */
  sign: ((text: string) => string) | null;
  ownHosts: readonly string[];
  now?: () => Date;
}

/**
 * The attestation the database verifies. Keys in alphabetical order, exactly the set
 * public.confirm_profile_domain accepts.
 */
export function confirmationText(input: { at: number; domainId: string; hostname: string; routing: StoredRouting; tokens: readonly string[] }): string {
  return JSON.stringify({ at: input.at, domainId: input.domainId, hostname: input.hostname, routing: input.routing, tokens: [...input.tokens], v: 1 });
}

function storedRouting(routing: DomainRouting | null): StoredRouting {
  if (!routing) return "unknown";
  return routing.state === "ok" ? "ok" : "pending";
}

export interface VerifyOutcome extends ConfirmOutcome {
  hostname: string;
  /** What the provider said, when it was asked: null when there is no provider or the proof was not found. */
  routing: DomainRouting | null;
  /** The provider could not be reached; control may be proven all the same. */
  providerFailed: boolean;
}

export function createDomainsService(deps: DomainsServiceDependencies) {
  const { identity, repository } = deps;

  function failure<T>(error: unknown): DomainResult<T> {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false, error: error.reason };
  }

  async function authorizeDomain(domainId: unknown): Promise<DomainSummary> {
    await requireUser(identity);
    if (!isUuid(domainId)) throw new AuthorizationError("not_found");
    const domain = await repository.findDomain(domainId);
    if (!domain) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, domain.workspaceId, "domains.manage");
    return domain;
  }

  return {
    /** The domain of a page, for every member who can see the page. */
    async get(profileId: unknown): Promise<DomainResult<DomainSummary | null>> {
      try {
        await requireUser(identity);
        if (!isUuid(profileId)) throw new AuthorizationError("not_found");
        const workspaceId = await repository.findProfileWorkspace(profileId);
        if (!workspaceId) throw new AuthorizationError("not_found");
        await requireWorkspaceAccess(identity, workspaceId, "domains.view");
      } catch (error) {
        return failure(error);
      }
      return repository.findForProfile(profileId as string);
    },

    /** Claims a hostname for a page. Proves nothing: the answer is the record to publish in DNS. */
    async claim(profileId: unknown, rawHostname: unknown): Promise<DomainResult<{ id: string; hostname: string; challenge: string }>> {
      try {
        await requireUser(identity);
        if (!isUuid(profileId)) throw new AuthorizationError("not_found");
        const workspaceId = await repository.findProfileWorkspace(profileId);
        if (!workspaceId) throw new AuthorizationError("not_found");
        await requireWorkspaceAccess(identity, workspaceId, "domains.manage");
      } catch (error) {
        return failure(error);
      }
      const hostname = validateHostname(rawHostname, deps.ownHosts);
      if (!hostname.ok) return { ok: false, error: hostname.problem };
      return repository.claim(profileId as string, hostname.hostname);
    },

    /**
     * Reads the challenge in DNS, attaches the hostname at the provider when the proof is there,
     * and hands the signed result to the database, which decides. Safe to repeat: it is also how
     * an active domain is checked again.
     */
    async verify(domainId: unknown): Promise<DomainResult<VerifyOutcome>> {
      let domain: DomainSummary;
      try {
        domain = await authorizeDomain(domainId);
      } catch (error) {
        return failure(error);
      }
      if (!deps.sign) return { ok: false, error: "not_configured" };

      let tokens: string[];
      try {
        tokens = await deps.dns.resolveChallenges(challengeRecordName(domain.hostname));
      } catch {
        return { ok: false, error: "dns_unavailable" };
      }

      let routing: DomainRouting | null = null;
      let providerFailed = false;
      if (deps.adapter && tokens.includes(domain.challenge)) {
        try {
          routing = await deps.adapter.ensure(domain.hostname);
        } catch (error) {
          if (!(error instanceof DomainsProviderError)) throw error;
          providerFailed = true;
        }
      }

      const text = confirmationText({ at: Math.floor((deps.now?.() ?? new Date()).getTime() / 1000), domainId: domain.id, hostname: domain.hostname, routing: storedRouting(routing), tokens });
      const confirmed = await repository.confirm(text, deps.sign(text));
      if (!confirmed.ok) return confirmed;
      return { ok: true, value: { ...confirmed.value, hostname: domain.hostname, routing, providerFailed } };
    },

    /** Removes the domain of a page and detaches the hostname at the provider. */
    async remove(domainId: unknown): Promise<DomainResult<{ hostname: string; slug: string | null; wasActive: boolean; detached: boolean }>> {
      let domain: DomainSummary;
      try {
        domain = await authorizeDomain(domainId);
      } catch (error) {
        return failure(error);
      }
      const removed = await repository.remove(domain.id);
      if (!removed.ok) return removed;
      // The row is gone, so the hostname opens nothing whatever the provider answers. A hostname
      // left attached there is harmless and is reported so it can be cleaned up.
      let detached = false;
      if (deps.adapter) {
        try {
          await deps.adapter.detach(removed.value.hostname);
          detached = true;
        } catch (error) {
          if (!(error instanceof DomainsProviderError)) throw error;
        }
      }
      return { ok: true, value: { ...removed.value, detached } };
    },

    /** What to create in DNS for an active domain that does not reach the application yet. */
    async routing(domainId: unknown): Promise<DomainRouting | null> {
      if (!deps.adapter || !isUuid(domainId)) return null;
      const domain = await repository.findDomain(domainId);
      if (!domain || domain.status !== "active") return null;
      try {
        return await deps.adapter.inspect(domain.hostname);
      } catch (error) {
        if (!(error instanceof DomainsProviderError)) throw error;
        return null;
      }
    },
  };
}
