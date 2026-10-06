import { describe, expect, it, vi } from "vitest";
import { dailySeries, parseAnalyticsReport, periodTotals } from "@/modules/analytics/dashboard";
import type { IdentityPort } from "@/modules/identity/guard";
import { can, WORKSPACE_ROLES, type WorkspaceRole } from "@/modules/identity/permissions";
import nextConfig from "../../../next.config";
import {
  availableReportPeriods, isReportToken, normalizeReportLabel, parseReportLinkInput, reportLinkErrorFromDatabase, reportLinkStatus, reportPath,
  sortReportLinks, REPORT_LINK_MAX_EXPIRY_DAYS, REPORT_EXPIRY_OPTIONS, type ReportLinkSummary,
} from "./links";
import { REPORT_RESPONSE_HEADERS, REPORT_ROUTE_SOURCE } from "./response-headers";
import { createReportLinksService, type ReportLinksRepository } from "./service";
import { parseSharedReport, sharedReportView, SHARED_REPORT_BLOCK_FIELDS, SHARED_REPORT_FIELDS } from "./shared-report";
import { generateReportToken, hashReportToken, reportClientHash } from "./token";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINK_A = "a7000000-0000-4000-8000-000000000001";
const LINK_B = "a7000000-0000-4000-8000-000000000002";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

describe("report tokens", () => {
  it("generates 256 bits in base64url from the injected source and nothing else", () => {
    const token = generateReportToken((bytes) => bytes.fill(0xff));
    expect(token).toBe("_".repeat(42) + "8");
    expect(isReportToken(token)).toBe(true);
    expect(generateReportToken()).not.toBe(generateReportToken());
    expect(isReportToken(generateReportToken())).toBe(true);
  });

  it("hashes like the database (SHA-256, hex)", () => {
    // Same vector as supabase/tests/database/160-reports.test.sql would compute for 'abc'.
    expect(hashReportToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashReportToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts only a well-formed token and builds only its exact path", () => {
    for (const value of [TOKEN.slice(1), `${TOKEN}a`, `${TOKEN.slice(0, 42)}/`, `${TOKEN.slice(0, 42)}=`, "", null, undefined, 7, `${TOKEN}?x=1`, hashReportToken(TOKEN)]) expect(isReportToken(value)).toBe(false);
    expect(reportPath(TOKEN)).toBe(`/r/${TOKEN}`);
  });

  it("derives a daily salted key for the failed-lookup limit, unrelated to the address", () => {
    const salt = "0123456789abcdef0123";
    const noon = new Date("2026-10-10T12:00:00Z");
    const hash = reportClientHash(" 203.0.113.7 ", salt, noon);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain("203");
    expect(reportClientHash("203.0.113.7", salt, new Date("2026-10-10T23:59:59Z"))).toBe(hash);
    expect(reportClientHash("203.0.113.7", salt, new Date("2026-10-11T00:00:00Z"))).not.toBe(hash);
    expect(reportClientHash("203.0.113.8", salt, noon)).not.toBe(hash);
    expect(reportClientHash("203.0.113.7", "another-salt-0123456789", noon)).not.toBe(hash);
    for (const [ip, key] of [[null, salt], ["", salt], ["203.0.113.7", null], ["203.0.113.7", "short"]] as const) expect(reportClientHash(ip, key, noon)).toBeNull();
  });
});

describe("report link rules", () => {
  it("offers only the periods the plan's history covers", () => {
    expect(availableReportPeriods(90)).toEqual([7, 30, 90]);
    expect(availableReportPeriods(30)).toEqual([7, 30]);
    expect(availableReportPeriods(7)).toEqual([7]);
    expect(availableReportPeriods(0)).toEqual([]);
  });

  it("validates the form at the boundary", () => {
    expect(parseReportLinkInput({ period: "30", expires: "30", label: "  Relatório   de setembro " }, 90)).toEqual({ ok: true, value: { periodDays: 30, expiresInDays: 30, label: "Relatório de setembro" } });
    expect(parseReportLinkInput({ period: "7", expires: "90", label: "" }, 7)).toEqual({ ok: true, value: { periodDays: 7, expiresInDays: 90, label: null } });
    expect(parseReportLinkInput({ period: "7", expires: "7", label: undefined }, 90)).toMatchObject({ ok: true, value: { label: null } });
    for (const period of ["15", "0", "-7", "", "30d", "7.0", null, 30, "9999"]) expect(parseReportLinkInput({ period, expires: "30", label: "" }, 90)).toEqual({ ok: false, field: "period" });
    // A period the plan does not show is refused, not clamped.
    expect(parseReportLinkInput({ period: "90", expires: "30", label: "" }, 30)).toEqual({ ok: false, field: "period" });
    for (const expires of ["0", "-1", "91", "365", "", "1", null, "30 dias"]) expect(parseReportLinkInput({ period: "30", expires, label: "" }, 90)).toEqual({ ok: false, field: "expires" });
    expect(parseReportLinkInput({ period: "30", expires: "30", label: "x".repeat(81) }, 90)).toEqual({ ok: false, field: "label" });
    expect(parseReportLinkInput({ period: "30", expires: "30", label: "x".repeat(80) }, 90)).toMatchObject({ ok: true });
    expect(parseReportLinkInput({ period: "30", expires: "30", label: "a\u0000b" }, 90)).toEqual({ ok: false, field: "label" });
    expect(Math.max(...REPORT_EXPIRY_OPTIONS)).toBeLessThanOrEqual(REPORT_LINK_MAX_EXPIRY_DAYS);
  });

  it("normalizes the label like the database", () => {
    expect(normalizeReportLabel(" a \n b\t c ")).toBe("a b c");
    expect(normalizeReportLabel("   ")).toBeNull();
  });

  it("derives the status from an injected clock; revocation wins", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(reportLinkStatus({ expiresAt: "2026-10-10T12:00:01Z", revokedAt: null }, now)).toBe("active");
    expect(reportLinkStatus({ expiresAt: "2026-10-10T12:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(reportLinkStatus({ expiresAt: "2026-10-09T12:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(reportLinkStatus({ expiresAt: "2026-11-10T12:00:00Z", revokedAt: "2026-10-01T00:00:00Z" }, now)).toBe("revoked");
    expect(reportLinkStatus({ expiresAt: "not a date", revokedAt: null }, now)).toBe("expired");
  });

  it("lists active links first, the one that ends soonest on top", () => {
    const link = (id: string, createdAt: string, expiresAt: string, revokedAt: string | null = null): ReportLinkSummary => ({ id, profileId: PAGE_A, periodDays: 30, label: null, createdAt, expiresAt, revokedAt });
    const sorted = sortReportLinks([
      link("old-expired", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      link("active-late", "2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z"),
      link("revoked-new", "2026-10-05T00:00:00Z", "2026-11-05T00:00:00Z", "2026-10-06T00:00:00Z"),
      link("active-soon", "2026-10-02T00:00:00Z", "2026-10-12T00:00:00Z"),
    ], new Date("2026-10-10T12:00:00Z"));
    expect(sorted.map((item) => `${item.id}:${item.status}`)).toEqual(["active-soon:active", "active-late:active", "revoked-new:revoked", "old-expired:expired"]);
  });

  it("maps every database outcome to one user-facing error", () => {
    expect(reportLinkErrorFromDatabase({ code: "22023" })).toBe("invalid");
    expect(reportLinkErrorFromDatabase({ code: "LK010" })).toBe("not_in_plan");
    expect(reportLinkErrorFromDatabase({ code: "LK091" })).toBe("too_many_active");
    expect(reportLinkErrorFromDatabase({ code: "LK092" })).toBe("rate_limited");
    expect(reportLinkErrorFromDatabase({ code: "42501" })).toBe("forbidden");
    expect(reportLinkErrorFromDatabase({ code: "P0002" })).toBe("not_found");
    expect(reportLinkErrorFromDatabase({ code: "PGRST116" })).toBe("not_found");
    for (const code of ["PGRST202", "PGRST205", "42883", "42P01", "42703"]) expect(reportLinkErrorFromDatabase({ code })).toBe("not_deployed");
    for (const code of ["57014", "XX000", "", null, undefined]) expect(reportLinkErrorFromDatabase({ code })).toBe("unavailable");
  });
});

describe("report response headers", () => {
  it("keeps the token out of referrers, the page out of search engines and out of shared caches", async () => {
    const headers = Object.fromEntries(REPORT_RESPONSE_HEADERS.map((header) => [header.key.toLowerCase(), header.value]));
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toMatch(/private/);
    expect(headers["cache-control"]).toMatch(/no-store/);
    expect(headers["cache-control"]).not.toMatch(/public|s-maxage|stale-while-revalidate/);
    for (const directive of ["noindex", "nofollow", "noarchive"]) expect(headers["x-robots-tag"]).toContain(directive);
    expect(headers["x-frame-options"]).toBe("DENY");
    // next.config.ts applies exactly this list to everything under /r/, the 404 included.
    expect(REPORT_ROUTE_SOURCE).toBe("/r/:path*");
    expect(await nextConfig.headers?.()).toEqual([{ source: "/r/:path*", headers: REPORT_RESPONSE_HEADERS }]);
  });
});

/** An answer as public.get_shared_report() returns it. */
function rpcShared(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok", workspace_name: "Agência Aurora", page_title: "Café Ipê", page_slug: "cafe-ipe", expires_at: "2026-11-09T15:00:00+00:00",
    ever_published: true, show_badge: false, timezone: "America/Sao_Paulo", today: "2026-10-10", from: "2026-10-03", to: "2026-10-09", configured: true,
    collecting_since: "2026-10-02", first_event_day: "2026-10-03", last_final_day: "2026-10-09",
    days: [
      { day: "2026-10-08", event_type: "page_view", count: 40 },
      { day: "2026-10-08", event_type: "link_click", count: 6 },
      { day: "2026-10-08", event_type: "whatsapp_click", count: 5 },
      { day: "2026-10-09", event_type: "page_view", count: 10 },
      { day: "2026-10-09", event_type: "pix_copy", count: 2 },
      { day: "2026-10-09", event_type: "pix_pay_click", count: 1 },
    ],
    sources: [{ key: "instagram", count: 35 }, { key: "direct", count: 15 }],
    blocks: [
      { ref: 1, position: 1, block_type: "link", title: "Cardápio", event_type: "link_click", count: 4 },
      { ref: 2, position: 2, block_type: "whatsapp", title: "Fazer pedido", event_type: "whatsapp_click", count: 5 },
      { ref: 3, position: 3, block_type: "pix", title: null, event_type: "pix_copy", count: 2 },
      { ref: 3, position: 3, block_type: "pix", title: null, event_type: "pix_pay_click", count: 1 },
      { ref: 4, position: null, block_type: null, title: null, event_type: "link_click", count: 2 },
    ],
    ...overrides,
  };
}

describe("shared report", () => {
  it("lists exactly the fields the database returns (drift guard with pgTAP 160)", () => {
    expect(Object.keys(rpcShared()).sort()).toEqual([...SHARED_REPORT_FIELDS]);
    expect([...SHARED_REPORT_FIELDS]).toEqual([...SHARED_REPORT_FIELDS].sort());
    expect(Object.keys(rpcShared().blocks[0] ?? {}).sort()).toEqual([...SHARED_REPORT_BLOCK_FIELDS]);
  });

  it("treats everything that is not a readable report as the same nothing", () => {
    const refusals = [
      { status: "unavailable" }, null, undefined, "ok", [], {}, { status: "ok" }, rpcShared({ status: "expired" }), rpcShared({ status: "revoked" }),
      rpcShared({ workspace_name: "" }), rpcShared({ page_title: null }), rpcShared({ expires_at: "soon" }), rpcShared({ today: "hoje" }), rpcShared({ timezone: 3 }),
    ];
    for (const value of refusals) expect(parseSharedReport(value)).toBeNull();
  });

  it("builds the view model from the closed list and drops anything else in the answer", () => {
    const leaked = rpcShared({
      workspace_id: WS_A, profile_id: PAGE_A, plan_id: "agency", members: ["dona@exemplo.com"], utms: [{ key: "instagram|bio|segredo", count: 3 }],
      devices: [{ key: "mobile", count: 9 }], countries: [{ key: "BR", count: 9 }], history_days: 90, label: "Relatório de setembro", token_hash: hashReportToken(TOKEN),
      blocks: [{ ref: 1, position: 1, block_type: "link", title: "Cardápio", event_type: "link_click", count: 4, block_id: "a9000000-0000-4000-8000-000000000001", url: "https://interno.exemplo" }],
    });
    const parsed = parseSharedReport(leaked);
    if (!parsed) throw new Error("expected a report");
    const serialized = JSON.stringify([parsed, sharedReportView(parsed)]);
    for (const secret of [WS_A, PAGE_A, "agency", "dona@exemplo.com", "segredo", "mobile", '"BR"', "setembro", hashReportToken(TOKEN), "a9000000", "interno.exemplo"]) expect(serialized).not.toContain(secret);
    expect(parsed.analytics.utms).toEqual([]);
    expect(parsed.analytics.devices).toEqual([]);
    expect(parsed.analytics.countries).toEqual([]);
    expect(Object.keys(parsed).sort()).toEqual(["analytics", "blocks", "everPublished", "expiresAt", "pageSlug", "pageTitle", "showBadge", "workspaceName"]);
  });

  it("shows the address only when it is a well-formed public address", () => {
    expect(parseSharedReport(rpcShared())?.pageSlug).toBe("cafe-ipe");
    for (const slug of [null, "", "Cafe Ipe", "../app", "javascript:alert(1)", 7]) expect(parseSharedReport(rpcShared({ page_slug: slug }))?.pageSlug).toBeNull();
  });

  it("computes its numbers with the dashboard's functions, so they match the page dashboard", () => {
    const parsed = parseSharedReport(rpcShared());
    if (!parsed) throw new Error("expected a report");
    const view = sharedReportView(parsed);
    // The same rows read as a members' report give the same totals.
    const members = parseAnalyticsReport({ ...rpcShared(), history_days: 90 });
    if (!members) throw new Error("expected a report");
    expect(view.totals).toEqual(periodTotals(dailySeries(members)));
    expect(view.totals).toMatchObject({ visits: 50, results: 8, linkClicks: 6, resultRate: 0.16 });
    expect(view).toMatchObject({ state: "data", periodDays: 7 });
    expect(view.rows).toHaveLength(7);
    expect(view.sources.rows.map((row) => [row.key, row.count, row.share])).toEqual([["instagram", 35, 0.7], ["direct", 15, 0.3]]);
  });

  it("ranks blocks by clicks, groups a block's event types and keeps removed blocks last on ties", () => {
    const parsed = parseSharedReport(rpcShared());
    if (!parsed) throw new Error("expected a report");
    expect(sharedReportView(parsed).blocks).toEqual([
      { ref: 2, title: "Fazer pedido", blockType: "whatsapp", mainType: "whatsapp_click", clicks: 5, results: 5, clickRate: 0.1 },
      { ref: 1, title: "Cardápio", blockType: "link", mainType: "link_click", clicks: 4, results: 0, clickRate: 0.08 },
      { ref: 3, title: null, blockType: "pix", mainType: "pix_copy", clicks: 3, results: 3, clickRate: 0.06 },
      { ref: 4, title: null, blockType: null, mainType: "link_click", clicks: 2, results: 0, clickRate: 0.04 },
    ]);
  });

  it("tells no data from zero, and has no rate without visits", () => {
    const view = (overrides: Record<string, unknown>) => {
      const parsed = parseSharedReport(rpcShared(overrides));
      if (!parsed) throw new Error("expected a report");
      return sharedReportView(parsed);
    };
    expect(view({ days: [], blocks: [], sources: [] })).toMatchObject({ state: "zero", totals: { visits: 0, results: 0, resultRate: null } });
    expect(view({ days: [], first_event_day: null }).state).toBe("no_data_yet");
    expect(view({ days: [], first_event_day: null, ever_published: false }).state).toBe("never_published");
    expect(view({ days: [], configured: false }).state).toBe("not_available");
    expect(view({ days: [], from: "2026-09-01", to: "2026-09-30", collecting_since: "2026-10-02" }).state).toBe("before_collection");
    expect(view({ days: [{ day: "2026-10-09", event_type: "form_submit", count: 1 }] }).totals).toMatchObject({ visits: 0, results: 1, resultRate: null });
  });

  it("drops malformed block rows", () => {
    const parsed = parseSharedReport(rpcShared({ blocks: [{ ref: 0, event_type: "link_click", count: 1 }, { ref: 1, event_type: "purchase", count: 1 }, { ref: 1.5, event_type: "link_click", count: 1 }, { ref: 2, event_type: "link_click", count: -1 }, null, { ref: 3, position: 0, block_type: 9, title: "  ", event_type: "link_click", count: 2 }] }));
    expect(parsed?.blocks).toEqual([{ ref: 3, position: null, blockType: null, title: null, eventType: "link_click", count: 2 }]);
  });
});

function identityFor(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

function repository() {
  const fake: ReportLinksRepository = {
    findProfileWorkspace: vi.fn(async (profileId: string) => (profileId === PAGE_A ? WS_A : profileId === PAGE_B ? WS_B : null)),
    findLinkWorkspace: vi.fn(async (linkId: string) => (linkId === LINK_A ? WS_A : linkId === LINK_B ? WS_B : null)),
    createLink: vi.fn(async () => ({ ok: true as const, value: { id: LINK_A, expiresAt: "2026-11-09T15:00:00Z" } })),
    revokeLink: vi.fn(async () => ({ ok: true as const, value: null })),
    listLinks: vi.fn(async () => ({ ok: true as const, value: [] })),
  };
  return fake;
}

const tokens = { generate: () => TOKEN, hash: hashReportToken };
const INPUT = { period: "30", expires: "30", label: "Setembro" };

describe("report links service", () => {
  it("mirrors the matrix: owners and admins create, list and revoke; editors do not", () => {
    for (const action of ["reports.view", "reports.create", "reports.revoke"] as const) {
      expect(WORKSPACE_ROLES.filter((role) => can(role, action))).toEqual(["owner", "admin"]);
      expect(can(null, action)).toBe(false);
    }
  });

  it("checks every role against every action before the repository is asked to write", async () => {
    for (const role of WORKSPACE_ROLES) {
      const fake = repository();
      const service = createReportLinksService(identityFor("u1", { [WS_A]: role }), fake, tokens);
      const allowed = role !== "editor";
      expect((await service.create(PAGE_A, INPUT, 90)).ok).toBe(allowed);
      expect((await service.revoke(LINK_A)).ok).toBe(allowed);
      expect((await service.list(PAGE_A)).ok).toBe(allowed);
      if (!allowed) {
        expect(await service.create(PAGE_A, INPUT, 90)).toEqual({ ok: false, error: "forbidden" });
        expect(await service.revoke(LINK_A)).toEqual({ ok: false, error: "forbidden" });
        expect(await service.list(PAGE_A)).toEqual({ ok: false, error: "forbidden" });
        expect(fake.createLink).not.toHaveBeenCalled();
        expect(fake.revokeLink).not.toHaveBeenCalled();
        expect(fake.listLinks).not.toHaveBeenCalled();
      }
    }
  });

  it("answers not found for another workspace's page or link, an unknown id and a malformed id", async () => {
    const fake = repository();
    const service = createReportLinksService(identityFor("u1", { [WS_A]: "owner" }), fake, tokens);
    for (const profileId of [PAGE_B, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "not-a-uuid", null, 7]) {
      expect(await service.create(profileId, INPUT, 90)).toEqual({ ok: false, error: "not_found" });
      expect(await service.list(profileId)).toEqual({ ok: false, error: "not_found" });
    }
    for (const linkId of [LINK_B, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "not-a-uuid", null]) expect(await service.revoke(linkId)).toEqual({ ok: false, error: "not_found" });
    expect(fake.createLink).not.toHaveBeenCalled();
    expect(fake.revokeLink).not.toHaveBeenCalled();
    expect(fake.listLinks).not.toHaveBeenCalled();
  });

  it("refuses everything without a session", async () => {
    const fake = repository();
    const service = createReportLinksService(identityFor(null, {}), fake, tokens);
    expect(await service.create(PAGE_A, INPUT, 90)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await service.revoke(LINK_A)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await service.list(PAGE_A)).toEqual({ ok: false, error: "unauthenticated" });
    expect(fake.findProfileWorkspace).not.toHaveBeenCalled();
    expect(fake.findLinkWorkspace).not.toHaveBeenCalled();
  });

  it("sends the hash to the database and returns the token once, never the other way round", async () => {
    const fake = repository();
    const result = await createReportLinksService(identityFor("u1", { [WS_A]: "admin" }), fake, tokens).create(PAGE_A, { period: "7", expires: "90", label: "  Outubro  " }, 90);
    expect(result).toEqual({ ok: true, value: { token: TOKEN, expiresAt: "2026-11-09T15:00:00Z" } });
    expect(fake.createLink).toHaveBeenCalledWith({ profileId: PAGE_A, tokenHash: hashReportToken(TOKEN), periodDays: 7, expiresInDays: 90, label: "Outubro" });
    expect(JSON.stringify(vi.mocked(fake.createLink).mock.calls)).not.toContain(TOKEN);
  });

  it("validates the input after authorizing and before writing", async () => {
    const fake = repository();
    const service = createReportLinksService(identityFor("u1", { [WS_A]: "owner" }), fake, tokens);
    expect(await service.create(PAGE_A, { period: "90", expires: "30", label: "" }, 7)).toEqual({ ok: false, error: "invalid", field: "period" });
    expect(await service.create(PAGE_A, { period: "30", expires: "400", label: "" }, 90)).toEqual({ ok: false, error: "invalid", field: "expires" });
    expect(await service.create(PAGE_A, { period: "30", expires: "30", label: "x".repeat(200) }, 90)).toEqual({ ok: false, error: "invalid", field: "label" });
    expect(fake.createLink).not.toHaveBeenCalled();
    // An editor learns nothing about the validity of the input.
    expect(await createReportLinksService(identityFor("u2", { [WS_A]: "editor" }), fake, tokens).create(PAGE_A, { period: "x", expires: "x", label: "" }, 90)).toEqual({ ok: false, error: "forbidden" });
  });

  it("passes the database's refusals through, without a token", async () => {
    for (const error of ["not_in_plan", "too_many_active", "rate_limited", "forbidden", "not_deployed", "unavailable"] as const) {
      const fake = repository();
      fake.createLink = vi.fn(async () => ({ ok: false as const, error }));
      fake.revokeLink = vi.fn(async () => ({ ok: false as const, error }));
      const service = createReportLinksService(identityFor("u1", { [WS_A]: "owner" }), fake, tokens);
      const created = await service.create(PAGE_A, INPUT, 90);
      expect(created).toEqual({ ok: false, error });
      expect(JSON.stringify(created)).not.toContain(TOKEN);
      expect(await service.revoke(LINK_A)).toEqual({ ok: false, error });
    }
  });
});
