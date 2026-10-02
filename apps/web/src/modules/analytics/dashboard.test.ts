import { describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import { can, WORKSPACE_ROLES, type WorkspaceRole } from "@/modules/identity/permissions";
import { aggregationIsDelayed, blockRanking, dailySeries, dashboardState, daysBeforeCollection, parseAnalyticsReport, periodTotals, shareRanking, splitUtmKey, type AnalyticsReport, type DashboardState } from "./dashboard";
import { createAnalyticsService, widestAvailablePeriod, type AnalyticsRepository, type ReportRead } from "./service";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINK = "a6000000-0000-4000-8000-000000000001";
const ZAP = "a6000000-0000-4000-8000-000000000003";
const GONE = "a6000000-0000-4000-8000-0000000000ff";

/** A report as public.get_profile_analytics() returns it. */
function rpcReport(overrides: Record<string, unknown> = {}) {
  return {
    timezone: "America/Sao_Paulo", today: "2026-10-10", from: "2026-10-04", to: "2026-10-10", history_days: 90, configured: true,
    collecting_since: "2026-10-02", first_event_day: "2026-10-03", last_final_day: "2026-10-09",
    days: [
      { day: "2026-10-08", event_type: "page_view", count: 10 },
      { day: "2026-10-08", event_type: "link_click", count: 4 },
      { day: "2026-10-08", event_type: "whatsapp_click", count: 2 },
      { day: "2026-10-10", event_type: "page_view", count: 5 },
      { day: "2026-10-10", event_type: "form_submit", count: 1 },
      { day: "2026-10-10", event_type: "badge_click", count: 3 },
    ],
    blocks: [
      { block_id: LINK, event_type: "link_click", count: 4 },
      { block_id: ZAP, event_type: "whatsapp_click", count: 2 },
    ],
    sources: [{ key: "instagram", count: 9 }, { key: "direct", count: 6 }],
    utms: [{ key: "instagram|bio|primavera", count: 4 }],
    devices: [{ key: "mobile", count: 14 }, { key: "desktop", count: 1 }],
    countries: [{ key: "BR", count: 13 }, { key: "ZZ", count: 2 }],
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}): AnalyticsReport {
  const parsed = parseAnalyticsReport(rpcReport(overrides));
  if (!parsed) throw new Error("fixture is not a report");
  return parsed;
}

describe("report parsing", () => {
  it("reads the RPC answer into days, blocks and breakdowns", () => {
    const parsed = report();
    expect(parsed).toMatchObject({ timeZone: "America/Sao_Paulo", today: "2026-10-10", historyDays: 90, configured: true, firstEventDay: "2026-10-03", lastFinalDay: "2026-10-09" });
    expect(parsed.days).toEqual([
      { day: "2026-10-08", counts: { page_view: 10, link_click: 4, whatsapp_click: 2 } },
      { day: "2026-10-10", counts: { page_view: 5, form_submit: 1, badge_click: 3 } },
    ]);
  });

  it("refuses anything that is not a report and drops malformed rows", () => {
    for (const value of [null, [], "report", {}, rpcReport({ today: "ontem" }), rpcReport({ history_days: -1 }), rpcReport({ timezone: 3 })]) expect(parseAnalyticsReport(value)).toBeNull();
    const parsed = report({
      days: [{ day: "2026-10-08", event_type: "page_view", count: 3 }, { day: "2026-10-08", event_type: "purchase", count: 9 }, { day: "x", event_type: "page_view", count: 9 }, { day: "2026-10-09", event_type: "page_view", count: -1 }, null],
      sources: [{ key: "instagram", count: 2 }, { key: 5, count: 2 }, { key: "x", count: "2" }],
      first_event_day: null, last_final_day: "never",
    });
    expect(parsed.days).toEqual([{ day: "2026-10-08", counts: { page_view: 3 } }]);
    expect(parsed.sources).toEqual([{ key: "instagram", count: 2 }]);
    expect(parsed).toMatchObject({ firstEventDay: null, lastFinalDay: null });
  });
});

describe("dashboard state: no data is never shown as zero (AC3)", () => {
  const noEvents = { days: [], blocks: [], sources: [], utms: [], devices: [], countries: [], first_event_day: null };
  const table: Array<[string, { report: AnalyticsReport | null; everPublished: boolean }, DashboardState]> = [
    ["analytics not deployed yet (no function)", { report: null, everPublished: true }, "not_available"],
    ["analytics not configured (no signing secret)", { report: report({ configured: false }), everPublished: true }, "not_available"],
    ["not configured wins over never published", { report: report({ ...noEvents, configured: false }), everPublished: false }, "not_available"],
    ["page never published", { report: report(noEvents), everPublished: false }, "never_published"],
    ["published but no event yet", { report: report(noEvents), everPublished: true }, "no_data_yet"],
    ["period before the page existed, no event ever", { report: report({ ...noEvents, from: "2026-09-01", to: "2026-09-30" }), everPublished: true }, "before_collection"],
    ["period before the page existed, events later", { report: report({ from: "2026-09-01", to: "2026-09-30", days: [] }), everPublished: true }, "before_collection"],
    ["a period with zero visits on a page that has had events", { report: report({ days: [] }), everPublished: true }, "zero"],
    ["events outside the window do not make it data", { report: report({ days: [{ day: "2026-09-01", event_type: "page_view", count: 3 }] }), everPublished: true }, "zero"],
    ["data", { report: report(), everPublished: true }, "data"],
    ["data on a page that was taken off the air", { report: report(), everPublished: true }, "data"],
    ["a page with events but currently never-published flag (restored data)", { report: report(), everPublished: false }, "data"],
  ];
  it.each(table)("%s", (_label, input, expected) => expect(dashboardState(input)).toBe(expected));

  it("gives every state its own copy", async () => {
    const { ANALYTICS_COPY } = await import("@/content/pt-BR");
    const titles = Object.values(ANALYTICS_COPY.states).map((state) => state.title);
    expect(new Set(titles).size).toBe(5);
    expect(Object.keys(ANALYTICS_COPY.states).sort()).toEqual(["before_collection", "never_published", "no_data_yet", "not_available", "zero"]);
    // "Zero" and "no data" must not read alike.
    expect(ANALYTICS_COPY.states.no_data_yet.title).not.toMatch(/nenhuma visita/i);
    expect(ANALYTICS_COPY.states.before_collection.description("02/10/2026")).toContain("diferente de zero");
    expect(ANALYTICS_COPY.delayed).toMatch(/^Aviso:/);
  });

  it.each([
    ["the job closed yesterday", { last_final_day: "2026-10-09" }, false],
    ["the job closed the day before yesterday (tonight's run is due)", { last_final_day: "2026-10-08" }, false],
    ["the job missed a run", { last_final_day: "2026-10-07" }, true],
    ["the job has never run and days are due", { last_final_day: null }, true],
    ["the job has never run but collection started yesterday", { last_final_day: null, collecting_since: "2026-10-09" }, false],
    ["collection started today", { last_final_day: null, collecting_since: "2026-10-10" }, false],
  ])("delayed: %s", (_label, overrides, expected) => expect(aggregationIsDelayed(report(overrides))).toBe(expected));
});

describe("daily series, totals and funnel", () => {
  it("lists every day of the window and tells zero from before-collection", () => {
    const rows = dailySeries(report({ from: "2026-09-30", to: "2026-10-10", collecting_since: "2026-10-02" }));
    expect(rows).toHaveLength(11);
    expect(rows.map((row) => row.status)).toEqual(["before_collection", "before_collection", "zero", "zero", "zero", "zero", "zero", "zero", "data", "zero", "data"]);
    expect(rows.at(-1)).toMatchObject({ day: "2026-10-10", partial: true, visits: 5, interactions: 1, results: 1 });
    expect(rows[8]).toMatchObject({ day: "2026-10-08", partial: false, visits: 10, interactions: 6, results: 2 });
    expect(daysBeforeCollection(report({ from: "2026-09-30", to: "2026-10-10", collecting_since: "2026-10-02" }))).toBe(2);
    expect(daysBeforeCollection(report())).toBe(0);
    expect(daysBeforeCollection(report({ from: "2026-09-01", to: "2026-09-03", collecting_since: "2026-10-02" }))).toBe(3);
  });

  it("makes period totals the sum of the days", () => {
    const rows = dailySeries(report());
    const totals = periodTotals(rows);
    expect(totals.visits).toBe(rows.reduce((sum, row) => sum + row.visits, 0));
    expect(totals.results).toBe(rows.reduce((sum, row) => sum + row.results, 0));
    expect(totals.interactions).toBe(rows.reduce((sum, row) => sum + row.interactions, 0));
    expect(totals).toMatchObject({ visits: 15, interactions: 7, results: 3, linkClicks: 4 });
    expect(totals.resultRate).toBeCloseTo(0.2);
    expect(totals.interactionRate).toBeCloseTo(7 / 15);
  });

  it("does not count the product badge as an interaction of the page", () => {
    expect(periodTotals(dailySeries(report())).interactions).toBe(7);
  });

  it("has no rate without visits (never a division by zero, never 0%)", () => {
    const totals = periodTotals(dailySeries(report({ days: [{ day: "2026-10-08", event_type: "form_submit", count: 2 }] })));
    expect(totals).toMatchObject({ visits: 0, results: 2, resultRate: null, interactionRate: null });
  });

  it("allows more than one result per visit", () => {
    const totals = periodTotals(dailySeries(report({ days: [{ day: "2026-10-08", event_type: "page_view", count: 2 }, { day: "2026-10-08", event_type: "pix_copy", count: 5 }] })));
    expect(totals.resultRate).toBe(2.5);
  });
});

describe("rankings", () => {
  const known = [{ id: ZAP, position: 0 }, { id: LINK, position: 1 }];

  it("orders blocks by clicks and computes clicks per visit", () => {
    const ranking = blockRanking(report(), known, 15);
    expect(ranking.map((row) => [row.blockId, row.clicks, row.results, row.mainType])).toEqual([[LINK, 4, 0, "link_click"], [ZAP, 2, 2, "whatsapp_click"]]);
    expect(ranking[0]?.clickRate).toBeCloseTo(4 / 15);
    expect(ranking[0]?.position).toBe(1);
  });

  it("keeps a block that is no longer in the draft, marked as removed", () => {
    const ranking = blockRanking(report({ blocks: [{ block_id: GONE, event_type: "pix_copy", count: 3 }, { block_id: GONE, event_type: "pix_pay_click", count: 1 }] }), known, 10);
    expect(ranking).toEqual([{ blockId: GONE, position: null, clicks: 4, results: 4, mainType: "pix_copy", clickRate: 0.4 }]);
  });

  it("breaks ties by the order of the page, removed blocks last, then by id", () => {
    const blocks = [GONE, LINK, ZAP, "a6000000-0000-4000-8000-0000000000aa"].map((id) => ({ block_id: id, event_type: "link_click", count: 2 }));
    expect(blockRanking(report({ blocks }), known, 10).map((row) => row.blockId)).toEqual([ZAP, LINK, "a6000000-0000-4000-8000-0000000000aa", GONE]);
  });

  it("has no click rate without visits and ignores events that are not interactions", () => {
    expect(blockRanking(report(), known, 0)[0]?.clickRate).toBeNull();
    expect(blockRanking(report({ blocks: [{ block_id: LINK, event_type: "page_view", count: 9 }] }), known, 9)).toEqual([]);
  });

  it("ranks shares, sums the tail as others and survives an empty list", () => {
    expect(shareRanking([{ key: "b", count: 1 }, { key: "a", count: 1 }, { key: "c", count: 6 }], 2)).toEqual({
      rows: [{ key: "c", count: 6, share: 0.75 }, { key: "a", count: 1, share: 0.125 }], others: 1, total: 8,
    });
    expect(shareRanking([])).toEqual({ rows: [], others: 0, total: 0 });
    expect(shareRanking([{ key: "x", count: 0 }]).rows[0]?.share).toBeNull();
  });

  it("splits a stored UTM key", () => {
    expect(splitUtmKey("instagram|bio|primavera")).toEqual({ source: "instagram", medium: "bio", campaign: "primavera" });
    expect(splitUtmKey("newsletter||")).toEqual({ source: "newsletter", medium: "", campaign: "" });
  });
});

// ---------------------------------------------------------------------------------------------
// Owner-side service
// ---------------------------------------------------------------------------------------------

function identityFor(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

function repositoryWith(read: (from: string, to: string) => ReportRead) {
  const repository: AnalyticsRepository = {
    findProfile: vi.fn(async (profileId: string) => (profileId === PAGE_A ? { id: PAGE_A, workspaceId: WS_A } : profileId === PAGE_B ? { id: PAGE_B, workspaceId: WS_B } : null)),
    readReport: vi.fn(async (_profileId: string, from: string, to: string) => read(from, to)),
    recordExport: vi.fn(async () => ({ ok: true as const })),
  };
  return repository;
}

const NOW = { now: () => new Date("2026-10-10T15:00:00Z") };

describe("analytics service", () => {
  it("lets every role of the workspace view and export (analytics.view / analytics.export)", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(can(role, "analytics.view")).toBe(true);
      expect(can(role, "analytics.export")).toBe(true);
    }
    expect(can(null, "analytics.view")).toBe(false);
  });

  it("asks for the window of the period, in reporting days", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcReport({ from, to }) }));
    const result = await createAnalyticsService(identityFor("u1", { [WS_A]: "editor" }), repository, NOW).report(PAGE_A, "30d");
    expect(repository.readReport).toHaveBeenCalledWith(PAGE_A, "2026-09-11", "2026-10-10");
    expect(result).toMatchObject({ ok: true, value: { period: "30d" } });
  });

  it("uses the reporting day, not the UTC date, just after UTC midnight", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcReport({ from, to }) }));
    await createAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, { now: () => new Date("2026-10-11T01:30:00Z") }).report(PAGE_A, "today");
    expect(repository.readReport).toHaveBeenCalledWith(PAGE_A, "2026-10-10", "2026-10-10");
  });

  it("never reads a page of another workspace, an unknown page or without a session", async () => {
    const repository = repositoryWith(() => ({ kind: "report", data: rpcReport() }));
    const service = createAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, NOW);
    expect(await service.report(PAGE_B, "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await service.exportCsv(PAGE_B, "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await service.report("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await service.report("not-a-uuid", "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await createAnalyticsService(identityFor(null, {}), repository, NOW).report(PAGE_A, "7d")).toEqual({ ok: false, error: "unauthenticated" });
    expect(repository.readReport).not.toHaveBeenCalled();
    expect(repository.recordExport).not.toHaveBeenCalled();
  });

  it("reports analytics that is not deployed as a state, not as an error", async () => {
    const service = createAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repositoryWith(() => ({ kind: "not_deployed" })), NOW);
    expect(await service.report(PAGE_A, "7d")).toEqual({ ok: true, value: { period: "7d", report: null } });
    expect(await service.exportCsv(PAGE_A, "7d")).toEqual({ ok: false, error: "unavailable" });
  });

  it("answers unavailable for a database error or an answer it cannot read", async () => {
    const identity = identityFor("u1", { [WS_A]: "owner" });
    expect(await createAnalyticsService(identity, repositoryWith(() => ({ kind: "error", error: "unavailable" })), NOW).report(PAGE_A, "7d")).toEqual({ ok: false, error: "unavailable" });
    expect(await createAnalyticsService(identity, repositoryWith(() => ({ kind: "report", data: { nonsense: true } })), NOW).report(PAGE_A, "7d")).toEqual({ ok: false, error: "unavailable" });
  });

  it("falls back to the widest period the plan covers instead of showing a clamped one under another name", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcReport({ from: from < "2026-10-04" ? "2026-10-04" : from, to, history_days: 7 }) }));
    const result = await createAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, NOW).report(PAGE_A, "90d");
    expect(result).toMatchObject({ ok: true, value: { period: "7d", report: { from: "2026-10-04", to: "2026-10-10" } } });
    expect(repository.readReport).toHaveBeenLastCalledWith(PAGE_A, "2026-10-04", "2026-10-10");
    expect(widestAvailablePeriod(7)).toBe("7d");
    expect(widestAvailablePeriod(90)).toBe("90d");
    expect(widestAvailablePeriod(1)).toBe("today");
  });

  it("audits an export before returning the file, with the window and the row count", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcReport({ from, to }) }));
    const result = await createAnalyticsService(identityFor("u1", { [WS_A]: "editor" }), repository, NOW).exportCsv(PAGE_A, "7d");
    expect(repository.recordExport).toHaveBeenCalledWith(PAGE_A, "2026-10-04", "2026-10-10", 7);
    if (!result.ok) throw new Error("expected a file");
    expect(result.value.rows).toBe(7);
    expect(result.value.csv.split("\r\n")).toHaveLength(9);
    expect(result.value.csv).toContain('"2026-10-08","America/Sao_Paulo","com dados","10","2","4","0","2","0","0","0","0"');
  });

  it("returns no file when the audit event cannot be written", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcReport({ from, to }) }));
    repository.recordExport = vi.fn(async () => ({ ok: false as const, error: "unavailable" as const }));
    expect(await createAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, NOW).exportCsv(PAGE_A, "7d")).toEqual({ ok: false, error: "unavailable" });
  });
});
