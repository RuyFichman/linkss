import "server-only";
import { Resolver } from "node:dns/promises";
import { DOMAIN_CHALLENGE_PATTERN } from "./hostname";

/**
 * The DNS read behind the proof of control (ADR 0016). The application server resolves the TXT
 * record itself, through public recursive resolvers, so the answer does not depend on the
 * resolver of the machine it runs on. Only values that look like one of our challenges leave this
 * module: whatever else the owner keeps in that record is not stored or logged.
 */
export interface DnsPort {
  /** Challenge values published at `name`. Empty when the name or the record does not exist. Throws when DNS cannot be asked. */
  resolveChallenges(name: string): Promise<string[]>;
}

export class DnsUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`DNS lookup failed: ${code}`);
    this.name = "DnsUnavailableError";
  }
}

const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const LOOPBACK_RESOLVER = /^127\.0\.0\.1:\d{2,5}$/;
const NO_ANSWER = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENONAME"]);
const MAX_CHALLENGES = 20;

/** `DOMAINS_DNS_RESOLVER` is honoured only for a loopback address: the local test resolver (scripts/domains-lifecycle.mjs). */
export function dnsServersFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const override = (env.DOMAINS_DNS_RESOLVER ?? "").trim();
  return LOOPBACK_RESOLVER.test(override) ? [override] : PUBLIC_RESOLVERS;
}

/** A TXT value may arrive split in chunks; a challenge is one short string. */
export function challengesFromTxt(records: readonly (readonly string[])[]): string[] {
  const values = records.map((chunks) => chunks.join("").trim()).filter((value) => DOMAIN_CHALLENGE_PATTERN.test(value));
  return [...new Set(values)].slice(0, MAX_CHALLENGES);
}

export function createNodeDns(servers: readonly string[] = dnsServersFromEnv()): DnsPort {
  return {
    async resolveChallenges(name) {
      const resolver = new Resolver({ timeout: 3000, tries: 2 });
      resolver.setServers([...servers]);
      try {
        return challengesFromTxt(await resolver.resolveTxt(name));
      } catch (error) {
        const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "unknown";
        if (NO_ANSWER.has(code)) return [];
        throw new DnsUnavailableError(code);
      }
    },
  };
}
