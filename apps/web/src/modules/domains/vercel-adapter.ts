import { DomainsProviderError, type DnsRecord, type DomainRouting, type DomainsAdapter } from "./adapter";

/**
 * Vercel behind the DomainsAdapter (ADR 0016). Plain `fetch` against the REST API, no SDK: four
 * calls. Written from the official reference (pages and date in the ADR); NOT yet run against the
 * real API (no token was available): the contract test runs it against documentation-shaped
 * responses and the local emulator in scripts/domains-lifecycle.mjs.
 *
 *   GET    /v9/projects/{project}/domains/{domain}    is it attached, and verified for the project
 *   POST   /v10/projects/{project}/domains            attach
 *   GET    /v6/domains/{domain}/config                does DNS point here; recommended records
 *   DELETE /v9/projects/{project}/domains/{domain}    detach
 */
const VERCEL_API_ORIGIN = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 8000;

export interface VercelAdapterConfig {
  token: string;
  projectId: string;
  teamId?: string | null;
  /** Loopback emulator only (modules/domains/config.ts enforces it). */
  apiBaseUrl?: string | null;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

interface ProjectDomain {
  apexName: string;
  verified: boolean;
  verification: DnsRecord[];
}

function parseProjectDomain(body: Json): ProjectDomain {
  if (typeof body.name !== "string" || typeof body.apexName !== "string" || typeof body.verified !== "boolean") throw new DomainsProviderError("unexpected_response");
  const challenges = Array.isArray(body.verification) ? body.verification : [];
  const verification = challenges.flatMap((item): DnsRecord[] => {
    const entry = item as Json | null;
    // The reference documents TXT challenges only; anything else is not shown as a record to create.
    return entry && entry.type === "TXT" && typeof entry.domain === "string" && typeof entry.value === "string" ? [{ type: "TXT", name: entry.domain, value: entry.value }] : [];
  });
  return { apexName: body.apexName, verified: body.verified, verification };
}

/** rank 1 is the provider's preferred value. */
function preferred(list: unknown): unknown {
  if (!Array.isArray(list)) return undefined;
  const ranked = (list as Array<Json | null>).filter((entry): entry is Json => entry !== null && typeof entry === "object" && typeof entry.rank === "number");
  return ranked.sort((a, b) => (a.rank as number) - (b.rank as number))[0]?.value;
}

export function createVercelAdapter(config: VercelAdapterConfig): DomainsAdapter {
  const send = config.fetch ?? fetch;
  const origin = (config.apiBaseUrl ?? VERCEL_API_ORIGIN).replace(/\/+$/, "");
  const project = encodeURIComponent(config.projectId);

  async function call(method: string, path: string, query: Record<string, string> = {}, body?: Json): Promise<{ status: number; body: Json }> {
    const params = new URLSearchParams({ ...query, ...(config.teamId ? { teamId: config.teamId } : {}) });
    const url = `${origin}${path}${params.size > 0 ? `?${params}` : ""}`;
    let response: Response;
    try {
      response = await send(url, {
        method,
        headers: { Authorization: `Bearer ${config.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new DomainsProviderError("network");
    }
    let parsed: unknown = {};
    try {
      parsed = await response.json();
    } catch {
      // An empty or non-JSON body: only the status matters below.
    }
    return { status: response.status, body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {} };
  }

  function fail(status: number): never {
    throw new DomainsProviderError(status === 401 || status === 403 ? "unauthorized" : status === 429 ? "rate_limited" : "provider_error", status);
  }

  async function read(hostname: string): Promise<ProjectDomain | null> {
    const response = await call("GET", `/v9/projects/${project}/domains/${encodeURIComponent(hostname)}`);
    if (response.status === 404) return null;
    if (response.status !== 200) fail(response.status);
    return parseProjectDomain(response.body);
  }

  async function routing(hostname: string, domain: ProjectDomain): Promise<DomainRouting> {
    // "Verified for the project" is the provider's own check (it asks for it when the name is in
    // use in another of its accounts); until it passes, the hostname is not served.
    if (!domain.verified) return { state: "pending", records: domain.verification };
    const response = await call("GET", `/v6/domains/${encodeURIComponent(hostname)}/config`, { projectIdOrName: config.projectId });
    if (response.status !== 200) fail(response.status);
    if (typeof response.body.misconfigured !== "boolean") throw new DomainsProviderError("unexpected_response");
    if (!response.body.misconfigured) return { state: "ok" };
    const records: DnsRecord[] = [];
    if (hostname === domain.apexName) {
      const addresses = preferred(response.body.recommendedIPv4);
      const first = Array.isArray(addresses) ? addresses.find((value): value is string => typeof value === "string") : undefined;
      if (first) records.push({ type: "A", name: hostname, value: first });
    } else {
      const target = preferred(response.body.recommendedCNAME);
      if (typeof target === "string" && target !== "") records.push({ type: "CNAME", name: hostname, value: target.replace(/\.$/, "") });
    }
    return { state: "pending", records };
  }

  return {
    async ensure(hostname) {
      let domain = await read(hostname);
      if (!domain) {
        const created = await call("POST", `/v10/projects/${project}/domains`, {}, { name: hostname });
        // 409: assigned to another project or account of the provider, or not allowed.
        if (created.status === 409) return { state: "conflict" };
        if (created.status !== 200) fail(created.status);
        domain = parseProjectDomain(created.body);
      }
      return routing(hostname, domain);
    },

    async inspect(hostname) {
      const domain = await read(hostname);
      return domain ? routing(hostname, domain) : null;
    },

    async detach(hostname) {
      const response = await call("DELETE", `/v9/projects/${project}/domains/${encodeURIComponent(hostname)}`);
      if (response.status !== 200 && response.status !== 404) fail(response.status);
    },
  };
}
