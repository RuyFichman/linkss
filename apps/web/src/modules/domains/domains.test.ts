import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import nextConfig from "../../../next.config";
import { DomainsProviderError } from "./adapter";
import { domainsSignerFromEnv, ownHostnames, resolveDomainsProvider } from "./config";
import { challengesFromTxt, dnsServersFromEnv, DnsUnavailableError, type DnsPort } from "./dns";
import { createFakeDomainsAdapter } from "./fake-adapter";
import { BLOCKED_HOSTNAME_SUFFIXES, challengeRecordName, isStoredHostname, normalizeHostname, validateHostname } from "./hostname";
import { customDomainRewrites, platformHostPattern } from "./routing";
import { confirmationText, createDomainsService, domainErrorFromDatabase, type DomainsRepository, type DomainSummary } from "./service";
import { createVercelAdapter } from "./vercel-adapter";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOMAIN_A = "d0000000-0000-4000-8000-000000000001";
const CHALLENGE = `linkfav-verify=${"a".repeat(32)}`;
const OTHER_CHALLENGE = `linkfav-verify=${"b".repeat(32)}`;
const SECRET = "test-domains-signing-secret-0123456789";
const MIGRATIONS = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));

describe("hostnames (mirror of private.domain_hostname_is_well_formed / _is_blocked)", () => {
  it.each([
    ["www.loja.com.br", "www.loja.com.br"],
    ["  HTTPS://WWW.Loja.com.br/pagina?x=1 ", "www.loja.com.br"],
    ["loja.com.br.", "loja.com.br"],
    ["café.com", "xn--caf-dma.com"],
    ["http://loja.com.br#topo", "loja.com.br"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
    expect(validateHostname(input)).toEqual({ ok: true, hostname: expected });
  });

  it.each([
    ["", "empty"], ["   ", "empty"], [null, "empty"], [7, "empty"],
    ["loja", "invalid"], ["192.168.0.1", "invalid"], ["loja..com", "invalid"], ["-loja.com.br", "invalid"], ["loja.com.br:8080", "invalid"],
    ["user@loja.com.br", "invalid"], ["loja com br", "invalid"], [`${"a".repeat(64)}.com`, "invalid"], ["javascript:alert(1)", "invalid"],
    ["linkfav.com", "blocked"], ["pagina.linkfav.com", "blocked"], ["meu.vercel.app", "blocked"], ["x.supabase.co", "blocked"], ["site.localhost", "blocked"], ["example.com", "blocked"],
  ])("rejects %j as %s", (input, problem) => {
    expect(validateHostname(input)).toEqual({ ok: false, problem });
  });

  it("blocks the hostnames this deployment answers on, which the database cannot know", () => {
    expect(validateHostname("app.minhaplataforma.com.br", ["minhaplataforma.com.br"])).toEqual({ ok: false, problem: "blocked" });
    expect(validateHostname("outraplataforma.com.br", ["minhaplataforma.com.br"])).toMatchObject({ ok: true });
    // A suffix needs a label boundary.
    expect(validateHostname("meulinkfav.com")).toMatchObject({ ok: true });
    expect(ownHostnames({ NEXT_PUBLIC_APP_URL: "https://www.linkfav.com" })).toEqual(["linkfav.com"]);
    expect(ownHostnames({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toEqual([]);
    expect(ownHostnames({})).toEqual([]);
  });

  it("recognizes only the stored form on values that come from a URL or a Host header", () => {
    expect(isStoredHostname("www.loja.com.br")).toBe(true);
    for (const value of ["WWW.loja.com.br", "loja", "loja.com.br/", "../etc", "a b.com", "", null, undefined, `${"a.".repeat(130)}com`]) expect(isStoredHostname(value)).toBe(false);
    expect(challengeRecordName("www.loja.com.br")).toBe("_linkfav.www.loja.com.br");
  });

  it("keeps the blocked list equal to the database function (drift guard)", () => {
    const sql = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).map((file) => readFileSync(join(MIGRATIONS, file), "utf8")).join("\n");
    const body = /create function private\.domain_hostname_is_blocked[\s\S]*?unnest\(array\[([\s\S]*?)\]\)/.exec(sql)?.[1] ?? "";
    const inDatabase = [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(inDatabase.sort()).toEqual([...BLOCKED_HOSTNAME_SUFFIXES].sort());
  });
});

describe("DNS read", () => {
  it("keeps only values in the challenge format, joined and deduplicated", () => {
    expect(challengesFromTxt([[CHALLENGE], ["v=spf1 include:_spf.example.com ~all"], ["linkfav-verify=", "b".repeat(32)], [CHALLENGE], ["linkfav-verify=XYZ"], [` ${CHALLENGE} `]])).toEqual([CHALLENGE, OTHER_CHALLENGE]);
    expect(challengesFromTxt([])).toEqual([]);
  });

  it("uses public resolvers unless a loopback test resolver is configured", () => {
    expect(dnsServersFromEnv({})).toEqual(["1.1.1.1", "8.8.8.8"]);
    expect(dnsServersFromEnv({ DOMAINS_DNS_RESOLVER: "127.0.0.1:5353" })).toEqual(["127.0.0.1:5353"]);
    for (const value of ["10.0.0.5:53", "evil.example:53", "127.0.0.1", "8.8.4.4"]) expect(dnsServersFromEnv({ DOMAINS_DNS_RESOLVER: value })).toEqual(["1.1.1.1", "8.8.8.8"]);
  });
});

describe("configuration", () => {
  it("signs like the database verifies (HMAC-SHA256, hex) and refuses a short secret", () => {
    expect(domainsSignerFromEnv({})).toBeNull();
    expect(domainsSignerFromEnv({ DOMAINS_SIGNING_SECRET: "short" })).toBeNull();
    expect(domainsSignerFromEnv({ DOMAINS_SIGNING_SECRET: SECRET })?.("abc")).toBe(createHmac("sha256", SECRET).update("abc").digest("hex"));
  });

  it("needs a token and a project, and never sends the token to a non-loopback override", () => {
    const token = "t".repeat(24);
    expect(resolveDomainsProvider({})).toEqual({ kind: "none", reason: "missing_credentials" });
    expect(resolveDomainsProvider({ VERCEL_API_TOKEN: token })).toEqual({ kind: "none", reason: "missing_credentials" });
    expect(resolveDomainsProvider({ VERCEL_API_TOKEN: token, VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: " team_1 " })).toEqual({ kind: "vercel", config: { token, projectId: "prj_1", teamId: "team_1", apiBaseUrl: null } });
    expect(resolveDomainsProvider({ VERCEL_API_TOKEN: token, VERCEL_PROJECT_ID: "prj_1", VERCEL_API_BASE_URL: "http://127.0.0.1:4010" })).toMatchObject({ kind: "vercel", config: { apiBaseUrl: "http://127.0.0.1:4010" } });
    for (const url of ["https://api.evil.example", "http://10.0.0.1:4010", "http://127.0.0.1.evil.example:80"]) {
      expect(resolveDomainsProvider({ VERCEL_API_TOKEN: token, VERCEL_PROJECT_ID: "prj_1", VERCEL_API_BASE_URL: url })).toEqual({ kind: "none", reason: "base_url_not_allowed" });
    }
  });
});

describe("database error contract", () => {
  it("maps each SQLSTATE of ADR 0016 to one outcome", () => {
    expect(domainErrorFromDatabase({ code: "22023", details: "hostname" })).toBe("invalid");
    expect(domainErrorFromDatabase({ code: "22023", details: "blocked" })).toBe("blocked");
    expect(domainErrorFromDatabase({ code: "LK010" })).toBe("not_in_plan");
    expect(domainErrorFromDatabase({ code: "LK120" })).toBe("already_set");
    expect(domainErrorFromDatabase({ code: "LK121" })).toBe("rate_limited");
    expect(domainErrorFromDatabase({ code: "42501" })).toBe("forbidden");
    expect(domainErrorFromDatabase({ code: "P0002" })).toBe("not_found");
    expect(domainErrorFromDatabase({ code: "PGRST202" })).toBe("not_deployed");
    expect(domainErrorFromDatabase({ code: "42P01" })).toBe("not_deployed");
    expect(domainErrorFromDatabase({ code: "57014" })).toBe("unavailable");
  });
});

function summary(overrides: Partial<DomainSummary> = {}): DomainSummary {
  return { id: DOMAIN_A, profileId: PAGE_A, workspaceId: WS_A, hostname: "www.loja.com.br", challenge: CHALLENGE, status: "pending", routing: "unknown", verifiedAt: null, lastCheckedAt: null, ...overrides };
}

function setup(options: { role?: WorkspaceRole | null; userId?: string | null; domain?: DomainSummary | null; tokens?: string[] | Error; sign?: boolean; adapter?: ReturnType<typeof createFakeDomainsAdapter> | null } = {}) {
  const role = options.role === undefined ? "owner" : options.role;
  const identity: IdentityPort = { currentUserId: async () => (options.userId === undefined ? "user-1" : options.userId), roleIn: async (_user, workspaceId) => (workspaceId === WS_A ? role : null) };
  const domain = options.domain === undefined ? summary() : options.domain;
  const repository: DomainsRepository = {
    findProfileWorkspace: vi.fn(async (profileId) => (profileId === PAGE_A ? WS_A : null)),
    findDomain: vi.fn(async (domainId) => (domain && domainId === domain.id ? domain : null)),
    findForProfile: vi.fn(async () => ({ ok: true as const, value: domain })),
    claim: vi.fn(async (_profileId, hostname) => ({ ok: true as const, value: { id: DOMAIN_A, hostname, challenge: CHALLENGE } })),
    confirm: vi.fn(async (text: string) => {
      const tokens = (JSON.parse(text) as { tokens: string[] }).tokens;
      return { ok: true as const, value: { status: tokens.includes(CHALLENGE) ? ("active" as const) : ("dns_missing" as const), slugs: tokens.includes(CHALLENGE) ? ["loja"] : [] } };
    }),
    remove: vi.fn(async () => ({ ok: true as const, value: { hostname: "www.loja.com.br", slug: "loja", wasActive: true } })),
  };
  const dns: DnsPort = { resolveChallenges: vi.fn(async () => { if (options.tokens instanceof Error) throw options.tokens; return options.tokens ?? [CHALLENGE]; }) };
  const fake = options.adapter === undefined ? createFakeDomainsAdapter() : options.adapter;
  const sign = options.sign === false ? null : (text: string) => createHmac("sha256", SECRET).update(text).digest("hex");
  const service = createDomainsService({ identity, repository, dns, adapter: fake?.adapter ?? null, sign, ownHosts: ["minhaplataforma.com.br"], now: () => new Date("2026-10-10T12:00:00Z") });
  return { service, repository, dns, fake };
}

describe("domains service: authorization", () => {
  it.each<[WorkspaceRole | null, string]>([["editor", "forbidden"], [null, "not_found"]])("role %s cannot claim, verify or remove (%s)", async (role, error) => {
    const { service, repository, dns, fake } = setup({ role });
    expect(await service.claim(PAGE_A, "www.loja.com.br")).toEqual({ ok: false, error });
    expect(await service.verify(DOMAIN_A)).toEqual({ ok: false, error });
    expect(await service.remove(DOMAIN_A)).toEqual({ ok: false, error });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(repository.confirm).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(dns.resolveChallenges).not.toHaveBeenCalled();
    expect(fake?.calls).toEqual([]);
  });

  it("an editor sees the domain; a stranger and a signed-out visitor do not", async () => {
    expect(await setup({ role: "editor" }).service.get(PAGE_A)).toMatchObject({ ok: true, value: { hostname: "www.loja.com.br" } });
    expect(await setup({ role: null }).service.get(PAGE_A)).toEqual({ ok: false, error: "not_found" });
    expect(await setup({ userId: null }).service.get(PAGE_A)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await setup().service.get("not-a-uuid")).toEqual({ ok: false, error: "not_found" });
  });

  it("a domain of another workspace is not found, whatever the caller's role elsewhere", async () => {
    const { service, repository } = setup({ domain: summary({ workspaceId: WS_B }) });
    expect(await service.verify(DOMAIN_A)).toEqual({ ok: false, error: "not_found" });
    expect(await service.remove(DOMAIN_A)).toEqual({ ok: false, error: "not_found" });
    expect(repository.confirm).not.toHaveBeenCalled();
  });
});

describe("domains service: claim", () => {
  it("normalizes before the database and refuses bad input without calling it", async () => {
    const { service, repository } = setup();
    expect(await service.claim(PAGE_A, " https://WWW.Loja.com.br/ ")).toMatchObject({ ok: true, value: { hostname: "www.loja.com.br", challenge: CHALLENGE } });
    expect(repository.claim).toHaveBeenCalledWith(PAGE_A, "www.loja.com.br");
    expect(await service.claim(PAGE_A, "")).toEqual({ ok: false, error: "empty" });
    expect(await service.claim(PAGE_A, "loja")).toEqual({ ok: false, error: "invalid" });
    expect(await service.claim(PAGE_A, "app.minhaplataforma.com.br")).toEqual({ ok: false, error: "blocked" });
    expect(repository.claim).toHaveBeenCalledTimes(1);
  });
});

describe("domains service: proof of control", () => {
  it("signs exactly what it read in DNS, with the keys the database accepts", async () => {
    const { service, repository, dns } = setup({ tokens: [OTHER_CHALLENGE, CHALLENGE] });
    const result = await service.verify(DOMAIN_A);
    expect(dns.resolveChallenges).toHaveBeenCalledWith("_linkfav.www.loja.com.br");
    const [text, signature] = vi.mocked(repository.confirm).mock.calls[0] ?? [];
    expect(JSON.parse(text ?? "")).toEqual({ at: 1791633600, domainId: DOMAIN_A, hostname: "www.loja.com.br", routing: "pending", tokens: [OTHER_CHALLENGE, CHALLENGE], v: 1 });
    expect(Object.keys(JSON.parse(text ?? "") as object)).toEqual(["at", "domainId", "hostname", "routing", "tokens", "v"]);
    expect(signature).toBe(createHmac("sha256", SECRET).update(text ?? "").digest("hex"));
    expect(result).toMatchObject({ ok: true, value: { status: "active", slugs: ["loja"], routing: { state: "pending" }, providerFailed: false } });
    expect(confirmationText({ at: 1, domainId: "d", hostname: "h", routing: "ok", tokens: [] })).toBe('{"at":1,"domainId":"d","hostname":"h","routing":"ok","tokens":[],"v":1}');
  });

  it("does not attach the hostname at the provider when the proof is not in DNS", async () => {
    const { service, repository, fake } = setup({ tokens: [OTHER_CHALLENGE] });
    expect(await service.verify(DOMAIN_A)).toMatchObject({ ok: true, value: { status: "dns_missing", routing: null } });
    expect(fake?.calls).toEqual([]);
    expect(JSON.parse(vi.mocked(repository.confirm).mock.calls[0]?.[0] ?? "")).toMatchObject({ routing: "unknown", tokens: [OTHER_CHALLENGE] });
  });

  it("reports the provider's answer: live, a refusal, or nothing configured", async () => {
    const live = createFakeDomainsAdapter();
    await live.adapter.ensure("www.loja.com.br");
    live.pointDns("www.loja.com.br");
    expect(await setup({ adapter: live }).service.verify(DOMAIN_A)).toMatchObject({ ok: true, value: { status: "active", routing: { state: "ok" } } });

    const conflict = setup({ adapter: createFakeDomainsAdapter({ conflicts: ["www.loja.com.br"] }) });
    expect(await conflict.service.verify(DOMAIN_A)).toMatchObject({ ok: true, value: { routing: { state: "conflict" } } });
    expect(JSON.parse(vi.mocked(conflict.repository.confirm).mock.calls[0]?.[0] ?? "")).toMatchObject({ routing: "pending" });

    const none = setup({ adapter: null });
    expect(await none.service.verify(DOMAIN_A)).toMatchObject({ ok: true, value: { status: "active", routing: null, providerFailed: false } });
    expect(JSON.parse(vi.mocked(none.repository.confirm).mock.calls[0]?.[0] ?? "")).toMatchObject({ routing: "unknown" });
  });

  it("still records the proof when the provider cannot be reached", async () => {
    const failing = createFakeDomainsAdapter();
    failing.adapter.ensure = async () => { throw new DomainsProviderError("network"); };
    const { service, repository } = setup({ adapter: failing });
    expect(await service.verify(DOMAIN_A)).toMatchObject({ ok: true, value: { status: "active", routing: null, providerFailed: true } });
    expect(repository.confirm).toHaveBeenCalledTimes(1);
  });

  it("confirms nothing without the signing secret or when DNS cannot be asked", async () => {
    const unsigned = setup({ sign: false });
    expect(await unsigned.service.verify(DOMAIN_A)).toEqual({ ok: false, error: "not_configured" });
    expect(unsigned.dns.resolveChallenges).not.toHaveBeenCalled();
    const down = setup({ tokens: new DnsUnavailableError("ETIMEOUT") });
    expect(await down.service.verify(DOMAIN_A)).toEqual({ ok: false, error: "dns_unavailable" });
    expect(down.repository.confirm).not.toHaveBeenCalled();
    expect(down.fake?.calls).toEqual([]);
  });
});

describe("domains service: remove and routing", () => {
  it("removes the row first and then detaches; a provider failure does not undo the removal", async () => {
    const attached = createFakeDomainsAdapter();
    await attached.adapter.ensure("www.loja.com.br");
    const ok = setup({ adapter: attached });
    expect(await ok.service.remove(DOMAIN_A)).toEqual({ ok: true, value: { hostname: "www.loja.com.br", slug: "loja", wasActive: true, detached: true } });
    expect(attached.isAttached("www.loja.com.br")).toBe(false);

    const failing = createFakeDomainsAdapter();
    failing.adapter.detach = async () => { throw new DomainsProviderError("provider_error", 500); };
    expect(await setup({ adapter: failing }).service.remove(DOMAIN_A)).toMatchObject({ ok: true, value: { detached: false } });
    expect(await setup({ adapter: null }).service.remove(DOMAIN_A)).toMatchObject({ ok: true, value: { detached: false } });
  });

  it("asks the provider for records only for an active domain", async () => {
    const fake = createFakeDomainsAdapter();
    await fake.adapter.ensure("www.loja.com.br");
    expect(await setup({ adapter: fake }).service.routing(DOMAIN_A)).toBeNull();
    expect(await setup({ adapter: fake, domain: summary({ status: "active" }) }).service.routing(DOMAIN_A)).toEqual({ state: "pending", records: [{ type: "CNAME", name: "www.loja.com.br", value: "cname.fake-provider.test" }] });
    expect(await setup({ adapter: null, domain: summary({ status: "active" }) }).service.routing(DOMAIN_A)).toBeNull();
  });
});

describe("Vercel adapter (documentation-shaped responses; not run against the real API)", () => {
  type Reply = { status: number; body?: unknown };
  function adapterWith(replies: Record<string, Reply>, teamId: string | null = "team_1") {
    const requests: Array<{ method: string; url: string; authorization: string | null; body: string | null }> = [];
    const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url, authorization: new Headers(init?.headers).get("authorization"), body: typeof init?.body === "string" ? init.body : null });
      const reply = replies[`${method} ${new URL(url).pathname}`] ?? { status: 500 };
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
    }) as typeof fetch;
    return { adapter: createVercelAdapter({ token: "secret-token", projectId: "prj_1", teamId, fetch: send }), requests };
  }
  const domain = (overrides: Record<string, unknown> = {}) => ({ name: "www.loja.com.br", apexName: "loja.com.br", projectId: "prj_1", verified: true, ...overrides });
  const config = (misconfigured: boolean) => ({ misconfigured, configuredBy: misconfigured ? null : "CNAME", acceptedChallenges: [], recommendedCNAME: [{ rank: 2, value: "other.vercel-dns.com." }, { rank: 1, value: "abc123.vercel-dns-017.com." }], recommendedIPv4: [{ rank: 1, value: ["216.198.79.1"] }, { rank: 2, value: ["76.76.21.21"] }] });

  it("attaches a hostname that is not on the project and reports the preferred CNAME to create", async () => {
    const { adapter, requests } = adapterWith({
      "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 404, body: { error: { code: "not_found" } } },
      "POST /v10/projects/prj_1/domains": { status: 200, body: domain() },
      "GET /v6/domains/www.loja.com.br/config": { status: 200, body: config(true) },
    });
    expect(await adapter.ensure("www.loja.com.br")).toEqual({ state: "pending", records: [{ type: "CNAME", name: "www.loja.com.br", value: "abc123.vercel-dns-017.com" }] });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(["GET /v9/projects/prj_1/domains/www.loja.com.br", "POST /v10/projects/prj_1/domains", "GET /v6/domains/www.loja.com.br/config"]);
    expect(requests[1]?.body).toBe('{"name":"www.loja.com.br"}');
    for (const request of requests) {
      expect(request.authorization).toBe("Bearer secret-token");
      expect(new URL(request.url).origin).toBe("https://api.vercel.com");
      expect(new URL(request.url).searchParams.get("teamId")).toBe("team_1");
    }
    expect(new URL(requests[2]?.url ?? "").searchParams.get("projectIdOrName")).toBe("prj_1");
  });

  it("does not attach twice, and recommends an A record for an apex", async () => {
    const { adapter, requests } = adapterWith({
      "GET /v9/projects/prj_1/domains/loja.com.br": { status: 200, body: domain({ name: "loja.com.br" }) },
      "GET /v6/domains/loja.com.br/config": { status: 200, body: config(true) },
    }, null);
    expect(await adapter.ensure("loja.com.br")).toEqual({ state: "pending", records: [{ type: "A", name: "loja.com.br", value: "216.198.79.1" }] });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    expect(new URL(requests[0]?.url ?? "").searchParams.has("teamId")).toBe(false);
  });

  it("is ok when the provider sees DNS pointing here", async () => {
    const { adapter } = adapterWith({ "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 200, body: domain() }, "GET /v6/domains/www.loja.com.br/config": { status: 200, body: config(false) } });
    expect(await adapter.ensure("www.loja.com.br")).toEqual({ state: "ok" });
    expect(await adapter.inspect("www.loja.com.br")).toEqual({ state: "ok" });
  });

  it("shows the provider's own TXT challenge while the name is not verified for the project", async () => {
    const { adapter, requests } = adapterWith({ "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 200, body: domain({ verified: false, verification: [{ type: "TXT", domain: "_vercel.loja.com.br", value: "vc-domain-verify=www.loja.com.br,abc", reason: "pending_domain_verification" }, { type: "OTHER", domain: "x", value: "y", reason: "z" }] }) } });
    expect(await adapter.ensure("www.loja.com.br")).toEqual({ state: "pending", records: [{ type: "TXT", name: "_vercel.loja.com.br", value: "vc-domain-verify=www.loja.com.br,abc" }] });
    expect(requests).toHaveLength(1);
  });

  it("maps 409 to a conflict, missing to null, and other failures to errors without the token", async () => {
    const conflict = adapterWith({ "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 404 }, "POST /v10/projects/prj_1/domains": { status: 409, body: { error: { code: "domain_already_in_use" } } } });
    expect(await conflict.adapter.ensure("www.loja.com.br")).toEqual({ state: "conflict" });
    expect(await adapterWith({ "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 404 } }).adapter.inspect("www.loja.com.br")).toBeNull();

    const forbidden = adapterWith({ "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 403, body: { error: { code: "forbidden" } } } });
    await expect(forbidden.adapter.ensure("www.loja.com.br")).rejects.toMatchObject({ name: "DomainsProviderError", code: "unauthorized", status: 403 });
    const odd = adapterWith({ "GET /v9/projects/prj_1/domains/www.loja.com.br": { status: 200, body: { unexpected: true } } });
    await expect(odd.adapter.ensure("www.loja.com.br")).rejects.toMatchObject({ code: "unexpected_response" });
    const error = await forbidden.adapter.ensure("www.loja.com.br").catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toContain("secret-token");
    const offline = createVercelAdapter({ token: "secret-token", projectId: "prj_1", fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(offline.detach("www.loja.com.br")).rejects.toMatchObject({ code: "network" });
  });

  it("detaching a hostname that is not attached is a success", async () => {
    await expect(adapterWith({ "DELETE /v9/projects/prj_1/domains/www.loja.com.br": { status: 404 } }).adapter.detach("www.loja.com.br")).resolves.toBeUndefined();
    await expect(adapterWith({ "DELETE /v9/projects/prj_1/domains/www.loja.com.br": { status: 200, body: {} } }).adapter.detach("www.loja.com.br")).resolves.toBeUndefined();
    await expect(adapterWith({ "DELETE /v9/projects/prj_1/domains/www.loja.com.br": { status: 500 } }).adapter.detach("www.loja.com.br")).rejects.toMatchObject({ code: "provider_error" });
  });
});

describe("routing configuration (next.config.ts)", () => {
  const platform = new RegExp(`^${platformHostPattern("https://linkfav.com")}$`);

  it("treats the product's own hosts as the product and everything else as a custom domain", () => {
    for (const host of ["linkfav.com", "www.linkfav.com", "localhost", "127.0.0.1", "linkss-black.vercel.app", "links-git-feat-x-team.vercel.app"]) expect(platform.test(host)).toBe(true);
    for (const host of ["www.loja.com.br", "linkfav.com.evil.example", "evil-linkfav.com", "xlinkfav.com", "vercel.app.evil.example", "linkfavxcom"]) expect(platform.test(host)).toBe(false);
    expect(new RegExp(`^${platformHostPattern(undefined)}$`).test("localhost")).toBe(true);
    expect(new RegExp(`^${platformHostPattern("not a url")}$`).test("linkfav.com")).toBe(false);
  });

  it("rewrites the root to the internal route and everything else to a 404, except what the page itself requests", () => {
    // The catch-all first: Next.js applies later beforeFiles entries to the path an earlier one produced.
    const [rest, root] = customDomainRewrites("https://linkfav.com");
    expect(customDomainRewrites("https://linkfav.com")).toHaveLength(2);
    expect(root).toMatchObject({ source: "/", destination: "/d/:host", has: [{ type: "host", value: "(?<host>.+)" }], missing: [{ type: "host", value: platformHostPattern("https://linkfav.com") }] });
    expect(rest?.destination).toBe("/d/:host/unavailable");
    const pattern = new RegExp(`^${(/^\/:path\((.*)\)$/.exec(rest?.source ?? "")?.[1] ?? "")}$`);
    for (const path of ["app", "app/w/1", "entrar", "cadastro", "r/token", "api/billing/webhook", "api/jobs/billing", "api/events/x", "d/outro.com.br", "auth/confirm", "denunciar", "opengraph-image"]) expect(pattern.test(path)).toBe(true);
    for (const path of ["_next/static/chunks/main.js", "api/events", "api/vitals", "icon.svg", "favicon.ico"]) expect(pattern.test(path)).toBe(false);
    // Neither rule can match what the other produced.
    expect(pattern.test("")).toBe(false);
    expect(root?.source).toBe("/");
    expect("/d/www.loja.com.br/unavailable").not.toBe(root?.source);
  });

  it("is what next.config.ts installs, before every page", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(Array.isArray(rewrites)).toBe(false);
    expect((rewrites as { beforeFiles: unknown[] }).beforeFiles).toEqual(customDomainRewrites(process.env.NEXT_PUBLIC_APP_URL));
  });
});
