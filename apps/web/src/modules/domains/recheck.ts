import type { DnsPort } from "./dns";
import { challengeRecordName } from "./hostname";

/**
 * Daily re-verification of active custom domains (ADR 0016, addendum of 2026-10-11).
 *
 * For each active domain the server reads the proof of control again and tells the database what
 * it found, signed like a confirmation. The database counts consecutive misses and lapses the
 * domain at its limit. A domain whose DNS could not be asked is left alone: an outage of a
 * resolver must never count against a customer.
 */
export interface RecheckDomain {
  id: string;
  hostname: string;
  challenge: string;
}

export type RecheckStatus = "ok" | "missing" | "lapsed" | "skipped" | "not_found" | "invalid" | "not_configured";

export interface RecheckPorts {
  list(limit: number): Promise<RecheckDomain[]>;
  record(text: string, signature: string): Promise<{ status: RecheckStatus; slug: string | null }>;
  dns: DnsPort;
  sign(text: string): string;
  /** Drops the cached copies of a page whose domain lapsed. */
  revalidate(slug: string): void;
  /** Detaches a lapsed hostname at the hosting provider; `null` when this environment attaches none. */
  detach: ((hostname: string) => Promise<void>) | null;
  now?: () => Date;
}

export interface RecheckReport {
  /** Domains the job looked at. */
  checked: number;
  found: number;
  missing: number;
  lapsed: number;
  /** DNS could not be asked: nothing was recorded for these. */
  dnsUnavailable: number;
  /** The database did not accept or could not store the answer. */
  failed: number;
}

export const RECHECK_BATCH_SIZE = 200;

/** The attestation the database verifies. Keys in alphabetical order, exactly the set public.record_domain_recheck accepts. */
export function recheckText(input: { at: number; domainId: string; found: boolean; hostname: string }): string {
  return JSON.stringify({ at: input.at, domainId: input.domainId, found: input.found, hostname: input.hostname, kind: "recheck", v: 1 });
}

export async function runDomainRecheck(ports: RecheckPorts, limit: number = RECHECK_BATCH_SIZE): Promise<RecheckReport> {
  const report: RecheckReport = { checked: 0, found: 0, missing: 0, lapsed: 0, dnsUnavailable: 0, failed: 0 };
  for (const domain of await ports.list(limit)) {
    report.checked += 1;
    let found: boolean;
    try {
      found = (await ports.dns.resolveChallenges(challengeRecordName(domain.hostname))).includes(domain.challenge);
    } catch {
      report.dnsUnavailable += 1;
      continue;
    }
    const text = recheckText({ at: Math.floor((ports.now?.() ?? new Date()).getTime() / 1000), domainId: domain.id, found, hostname: domain.hostname });
    let result: { status: RecheckStatus; slug: string | null };
    try {
      result = await ports.record(text, ports.sign(text));
    } catch {
      report.failed += 1;
      continue;
    }
    switch (result.status) {
      case "ok": report.found += 1; break;
      case "missing": report.missing += 1; break;
      case "lapsed":
        report.lapsed += 1;
        if (result.slug) ports.revalidate(result.slug);
        // The row no longer opens anything; a hostname left attached is harmless and tried once.
        if (ports.detach) await ports.detach(domain.hostname).catch(() => undefined);
        break;
      // Removed or verified again since it was listed.
      case "skipped": case "not_found": break;
      default: report.failed += 1;
    }
  }
  return report;
}
