import { describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/modules/identity/permissions";
import { dailySeries, parseAnalyticsReport, periodTotals } from "./dashboard";
import type { ReportRead } from "./service";
import { dataCoverage, pageRows, pageState, parseWorkspaceReport, workspaceAnalyticsToCsv, workspaceState, type WorkspaceReport } from "./workspace";
import { createWorkspaceAnalyticsService, type WorkspaceAnalyticsRepository } from "./workspace-service";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const CAFE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDIO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FRESH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function page(overrides: Record<string, unknown>) {
  return { profile_id: CAFE, title: "Café Ipê", slug: "cafe-ipe", status: "published", ever_published: true, collecting_since: "2026-10-02", first_event_day: "2026-10-03", counts: {}, ...overrides };
}

/** An answer as public.get_workspace_analytics() returns it: two pages with data, one archived, one new. */
function rpcWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    timezone: "America/Sao_Paulo", today: "2026-10-10", from: "2026-10-04", to: "2026-10-10", history_days: 90, configured: true,
    collecting_since: "2026-10-02", first_event_day: "2026-10-03", last_final_day: "2026-10-09",
    days: [
      { day: "2026-10-08", event_type: "page_view", count: 30 },
      { day: "2026-10-08", event_type: "whatsapp_click", count: 5 },
      { day: "2026-10-08", event_type: "link_click", count: 4 },
      { day: "2026-10-10", event_type: "page_view", count: 12 },
      { day: "2026-10-10", event_type: "form_submit", count: 1 },
    ],
    sources: [{ key: "instagram", count: 30 }, { key: "direct", count: 12 }],
    pages: [
      page({ counts: { page_view: 20, whatsapp_click: 2, link_click: 4 } }),
      page({ profile_id: STUDIO, title: "Estúdio Aurora", slug: "estudio-aurora", counts: { page_view: 20, whatsapp_click: 3, form_submit: 1 } }),
      page({ profile_id: OLD, title: "Feira Antiga", slug: "feira-antiga", status: "archived", counts: { page_view: 2 } }),
      page({ profile_id: FRESH, title: "Loja Nova", slug: "loja-nova", first_event_day: null, collecting_since: "2026-10-09" }),
    ],
    page_count: 6, pages_omitted: 2, pages_truncated: false,
    ...overrides,
  };
}

function workspace(overrides: Record<string, unknown> = {}): WorkspaceReport {
  const parsed = parseWorkspaceReport(rpcWorkspace(overrides));
  if (!parsed) throw new Error("fixture is not a workspace report");
  return parsed;
}

describe("consolidated report parsing", () => {
  it("reads totals with the page report's parser and the pages next to them", () => {
    const report = workspace();
    expect(report).toMatchObject({ timeZone: "America/Sao_Paulo", from: "2026-10-04", to: "2026-10-10", historyDays: 90, pageCount: 6, pagesOmitted: 2, pagesTruncated: false });
    expect(report.days).toEqual(parseAnalyticsReport(rpcWorkspace())?.days);
    expect(report.pages.map((item) => item.slug)).toEqual(["cafe-ipe", "estudio-aurora", "feira-antiga", "loja-nova"]);
    expect(report.pages[0]).toEqual({ profileId: CAFE, title: "Café Ipê", slug: "cafe-ipe", status: "published", everPublished: true, collectingSince: "2026-10-02", firstEventDay: "2026-10-03", counts: { page_view: 20, whatsapp_click: 2, link_click: 4 } });
    expect(report.blocks).toEqual([]);
    expect(report.utms).toEqual([]);
  });

  it("refuses what is not a report and drops malformed pages and counts", () => {
    for (const value of [null, [], "x", {}, rpcWorkspace({ today: "hoje" }), rpcWorkspace({ history_days: -1 })]) expect(parseWorkspaceReport(value)).toBeNull();
    const report = workspace({
      pages: [
        page({ counts: { page_view: 3, purchase: 9, link_click: -2, pix_copy: "4", form_submit: 1.5 } }),
        page({ profile_id: "not-a-uuid" }), page({ status: "deleted" }), page({ collecting_since: "ontem" }), page({ title: 7 }), null, "x",
      ],
      page_count: "many", pages_omitted: -1, pages_truncated: "yes",
    });
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]?.counts).toEqual({ page_view: 3 });
    expect(report).toMatchObject({ pageCount: 0, pagesOmitted: 0, pagesTruncated: false });
  });
});

describe("consolidated states (no data is never zero)", () => {
  it("gives every situation of the workspace its own state", () => {
    expect(workspaceState(null)).toBe("not_available");
    expect(workspaceState(workspace({ configured: false }))).toBe("not_available");
    expect(workspaceState(workspace({ page_count: 0, pages: [], days: [], first_event_day: null }))).toBe("no_pages");
    expect(workspaceState(workspace({ pages: [], days: [], first_event_day: null }))).toBe("nothing_published");
    expect(workspaceState(workspace({ pages: [page({ first_event_day: null })], days: [], first_event_day: null }))).toBe("no_data_yet");
    expect(workspaceState(workspace({ from: "2026-09-20", to: "2026-09-30", days: [] }))).toBe("before_collection");
    expect(workspaceState(workspace({ days: [] }))).toBe("zero");
    expect(workspaceState(workspace())).toBe("data");
  });

  it("derives each page's state by the page dashboard's rule (the mixed case)", () => {
    const report = workspace({
      pages: [
        page({ counts: { page_view: 4 } }),
        page({ profile_id: STUDIO, counts: {} }),
        page({ profile_id: OLD, status: "archived", counts: {} }),
        page({ profile_id: FRESH, first_event_day: null }),
        page({ profile_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", status: "draft", ever_published: false, first_event_day: null }),
        page({ profile_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", collecting_since: "2026-10-11", first_event_day: null }),
      ],
    });
    expect(report.pages.map((item) => pageState(report, item))).toEqual(["data", "zero", "zero", "no_data_yet", "never_published", "before_collection"]);
    const rows = pageRows(report);
    expect(dataCoverage(rows)).toEqual({ withData: 1, withoutData: 5 });
    // Zero is a number; "no data" is not.
    expect(rows.filter((row) => row.totals !== null).map((row) => row.state)).toEqual(["data", "zero", "zero"]);
    expect(rows.filter((row) => row.totals === null).map((row) => row.state).sort()).toEqual(["before_collection", "never_published", "no_data_yet"]);
  });

  it("shows nothing as a number for a page while the count is not configured", () => {
    const report = workspace({ configured: false });
    expect(pageRows(report).every((row) => row.state === "not_available" && row.totals === null)).toBe(true);
  });
});

describe("page ranking", () => {
  it("orders by results, then visits, then name, then id, with pages without numbers last", () => {
    const rows = pageRows(workspace({
      pages: [
        page({ profile_id: FRESH, title: "Zebra", first_event_day: null }),
        page({ profile_id: OLD, title: "beta", counts: { page_view: 10, whatsapp_click: 1 } }),
        page({ profile_id: STUDIO, title: "Álamo", counts: { page_view: 10, whatsapp_click: 1 } }),
        page({ profile_id: CAFE, title: "Álamo", counts: { page_view: 10, whatsapp_click: 1 } }),
        page({ profile_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "Muitas visitas", counts: { page_view: 500, link_click: 80 } }),
        page({ profile_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "Campeã", counts: { page_view: 3, pix_copy: 2, form_submit: 1 } }),
      ],
    }));
    expect(rows.map((row) => `${row.page.title}:${row.page.profileId.slice(0, 1)}`)).toEqual(["Campeã:f", "Álamo:a", "Álamo:b", "beta:c", "Muitas visitas:e", "Zebra:d"]);
  });

  it("uses the dashboard's totals: results are value actions, and the rate has no denominator without visits", () => {
    const [first, second] = pageRows(workspace({
      pages: [
        page({ counts: { page_view: 8, whatsapp_click: 1, pix_pay_click: 1, link_click: 5, embed_load: 2 } }),
        page({ profile_id: STUDIO, counts: { form_submit: 1 } }),
      ],
    }));
    expect(first?.totals).toMatchObject({ visits: 8, results: 2, interactions: 9, linkClicks: 5, resultRate: 0.25 });
    // A form submission with no recorded visit: one result, and "—" instead of a rate.
    expect(second?.totals).toMatchObject({ visits: 0, results: 1, resultRate: null });
  });

  it("keeps the workspace totals equal to the sum of its pages", () => {
    const report = workspace();
    const totals = periodTotals(dailySeries(report));
    const rows = pageRows(report);
    expect(totals.visits).toBe(rows.reduce((sum, row) => sum + (row.totals?.visits ?? 0), 0));
    expect(totals.results).toBe(rows.reduce((sum, row) => sum + (row.totals?.results ?? 0), 0));
    expect(totals).toMatchObject({ visits: 42, results: 6 });
  });
});

describe("consolidated CSV", () => {
  it("writes one self-describing row per page and leaves pages without numbers empty", () => {
    const report = workspace();
    const lines = workspaceAnalyticsToCsv(pageRows(report), report).split("\r\n");
    expect(lines[0]?.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]?.slice(1)).toBe("pagina,endereco,situacao_da_pagina,de,ate,fuso_horario,situacao_dos_dados,visitas_estimadas,resultados,resultados_a_cada_100_visitas,cliques_em_links,cliques_em_redes_sociais,cliques_no_whatsapp,copias_da_chave_pix,cliques_no_link_de_pagamento,envios_de_formulario,videos_ou_musicas_carregados");
    expect(lines[1]).toBe('"Estúdio Aurora","/estudio-aurora","publicada","2026-10-04","2026-10-10","America/Sao_Paulo","com dados","20","4","20,0","0","0","3","0","0","1","0"');
    expect(lines[3]).toBe('"Feira Antiga","/feira-antiga","arquivada","2026-10-04","2026-10-10","America/Sao_Paulo","com dados","2","0","0,0","0","0","0","0","0","0","0"');
    expect(lines[4]).toBe('"Loja Nova","/loja-nova","publicada","2026-10-04","2026-10-10","America/Sao_Paulo","sem dados ainda","","","","","","","","","",""');
    expect(lines).toHaveLength(6);
  });

  it("neutralizes spreadsheet formulas and escapes quotes in page names", () => {
    const report = workspace({ pages: [page({ title: '=HYPERLINK("http://x")', counts: { page_view: 1 } }), page({ profile_id: STUDIO, title: 'Bar "do Zé", o melhor', counts: { page_view: 1 } }), page({ profile_id: OLD, title: "@soma", counts: {} })] });
    const csv = workspaceAnalyticsToCsv(pageRows(report), report);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('"Bar ""do Zé"", o melhor"');
    expect(csv).toContain(`"'@soma"`);
  });
});

function identityFor(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

function repositoryWith(read: (from: string, to: string) => ReportRead) {
  const repository: WorkspaceAnalyticsRepository = {
    readWorkspaceReport: vi.fn(async (_workspaceId: string, from: string, to: string) => read(from, to)),
    recordWorkspaceExport: vi.fn(async () => ({ ok: true as const })),
  };
  return repository;
}

const NOW = { now: () => new Date("2026-10-10T15:00:00Z") };

describe("consolidated analytics service", () => {
  it("lets every role of the workspace read and export, for the window of the period", async () => {
    for (const role of WORKSPACE_ROLES) {
      const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcWorkspace({ from, to }) }));
      const service = createWorkspaceAnalyticsService(identityFor("u1", { [WS_A]: role }), repository, NOW);
      expect(await service.report(WS_A, "30d")).toMatchObject({ ok: true, value: { period: "30d" } });
      expect(repository.readWorkspaceReport).toHaveBeenCalledWith(WS_A, "2026-09-11", "2026-10-10");
      expect(await service.exportCsv(WS_A, "7d")).toMatchObject({ ok: true, value: { rows: 4 } });
    }
  });

  it("uses the reporting day, not the UTC date, just after UTC midnight", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcWorkspace({ from, to }) }));
    await createWorkspaceAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, { now: () => new Date("2026-10-11T01:30:00Z") }).report(WS_A, "today");
    expect(repository.readWorkspaceReport).toHaveBeenCalledWith(WS_A, "2026-10-10", "2026-10-10");
  });

  it("never reads another workspace, an unknown one or without a session, and does not touch the repository", async () => {
    const repository = repositoryWith(() => ({ kind: "report", data: rpcWorkspace() }));
    const service = createWorkspaceAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, NOW);
    expect(await service.report(WS_B, "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await service.exportCsv(WS_B, "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await service.report("not-a-uuid", "7d")).toEqual({ ok: false, error: "not_found" });
    expect(await service.report(null, "7d")).toEqual({ ok: false, error: "not_found" });
    const signedOut = createWorkspaceAnalyticsService(identityFor(null, {}), repository, NOW);
    expect(await signedOut.report(WS_A, "7d")).toEqual({ ok: false, error: "unauthenticated" });
    expect(await signedOut.exportCsv(WS_A, "7d")).toEqual({ ok: false, error: "unauthenticated" });
    expect(repository.readWorkspaceReport).not.toHaveBeenCalled();
    expect(repository.recordWorkspaceExport).not.toHaveBeenCalled();
  });

  it("reports a read that is not deployed as a state, and gives no file for it", async () => {
    const service = createWorkspaceAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repositoryWith(() => ({ kind: "not_deployed" })), NOW);
    expect(await service.report(WS_A, "7d")).toEqual({ ok: true, value: { period: "7d", report: null } });
    expect(await service.exportCsv(WS_A, "7d")).toEqual({ ok: false, error: "unavailable" });
  });

  it("answers unavailable for a database error or an answer it cannot read", async () => {
    const identity = identityFor("u1", { [WS_A]: "editor" });
    expect(await createWorkspaceAnalyticsService(identity, repositoryWith(() => ({ kind: "error", error: "unavailable" })), NOW).report(WS_A, "7d")).toEqual({ ok: false, error: "unavailable" });
    expect(await createWorkspaceAnalyticsService(identity, repositoryWith(() => ({ kind: "error", error: "forbidden" })), NOW).report(WS_A, "7d")).toEqual({ ok: false, error: "forbidden" });
    expect(await createWorkspaceAnalyticsService(identity, repositoryWith(() => ({ kind: "report", data: { nonsense: true } })), NOW).report(WS_A, "7d")).toEqual({ ok: false, error: "unavailable" });
  });

  it("falls back to the widest period the plan covers", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcWorkspace({ from: from < "2026-10-04" ? "2026-10-04" : from, to, history_days: 7 }) }));
    const result = await createWorkspaceAnalyticsService(identityFor("u1", { [WS_A]: "owner" }), repository, NOW).report(WS_A, "90d");
    expect(result).toMatchObject({ ok: true, value: { period: "7d", report: { from: "2026-10-04", to: "2026-10-10" } } });
  });

  it("audits an export before returning the file, and returns no file when the audit fails", async () => {
    const repository = repositoryWith((from, to) => ({ kind: "report", data: rpcWorkspace({ from, to }) }));
    const service = createWorkspaceAnalyticsService(identityFor("u1", { [WS_A]: "editor" }), repository, NOW);
    const result = await service.exportCsv(WS_A, "7d");
    expect(repository.recordWorkspaceExport).toHaveBeenCalledWith(WS_A, "2026-10-04", "2026-10-10", 4);
    if (!result.ok) throw new Error("expected a file");
    expect(result.value.csv.split("\r\n")).toHaveLength(6);
    repository.recordWorkspaceExport = vi.fn(async () => ({ ok: false as const, error: "unavailable" as const }));
    expect(await service.exportCsv(WS_A, "7d")).toEqual({ ok: false, error: "unavailable" });
  });
});
