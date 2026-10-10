/**
 * Hosting side of a custom domain (ADR 0016): attaching a hostname to the deployment so requests
 * for it reach the application with a certificate. Narrow on purpose: nothing outside the
 * implementation knows the provider's API. An adapter never decides who owns a hostname; it is
 * called only after the DNS proof was read by the application server.
 */
export interface DnsRecord {
  type: "A" | "CNAME" | "TXT";
  /** Full name of the record, e.g. "www.loja.com.br". */
  name: string;
  value: string;
}

export type DomainRouting =
  /** The hostname reaches the application and the provider can issue (or has issued) the certificate. */
  | { state: "ok" }
  /** Attached, but DNS does not point here yet (or the provider wants its own check): `records` says what to create. */
  | { state: "pending"; records: DnsRecord[] }
  /** The provider refuses the name (in use in another project or account of the provider, or not allowed). */
  | { state: "conflict" };

export class DomainsProviderError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(`Domains provider failed: ${code}`);
    this.name = "DomainsProviderError";
  }
}

export interface DomainsAdapter {
  /** Attaches the hostname if it is not attached yet and reports how it routes. Idempotent. */
  ensure(hostname: string): Promise<DomainRouting>;
  /** How an attached hostname routes, without changing anything; null when it is not attached. */
  inspect(hostname: string): Promise<DomainRouting | null>;
  /** Detaches the hostname. A hostname that is not attached is a success. */
  detach(hostname: string): Promise<void>;
}
