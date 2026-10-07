import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSharedReport } from "@/modules/reports/shared-report";
import type { SharedReportRead } from "@/modules/reports/server";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

class NotFoundSignal extends Error {}

const mocks = vi.hoisted(() => ({ fetchSharedReport: vi.fn(), requestHeaders: new Headers() }));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new NotFoundSignal(); } }));
vi.mock("@/modules/reports/server", () => ({ fetchSharedReport: mocks.fetchSharedReport }));

const { default: SharedReportPage, dynamic } = await import("./page");
const { default: SharedReportUnavailable } = await import("./not-found");
const { metadata } = await import("../layout");

function okRead(overrides: Record<string, unknown> = {}): SharedReportRead {
  const report = parseSharedReport({
    status: "ok", workspace_name: "Agência Aurora", page_title: "Café Ipê", page_slug: "cafe-ipe", expires_at: "2026-11-09T15:00:00+00:00",
    ever_published: true, show_badge: false, timezone: "America/Sao_Paulo", today: "2026-10-10", from: "2026-10-03", to: "2026-10-09", configured: true,
    collecting_since: "2026-10-02", first_event_day: "2026-10-03", last_final_day: "2026-10-09",
    days: [{ day: "2026-10-08", event_type: "page_view", count: 1240 }, { day: "2026-10-08", event_type: "whatsapp_click", count: 87 }],
    sources: [{ key: "instagram", count: 1240 }],
    blocks: [{ ref: 1, position: 1, block_type: "whatsapp", title: "Fazer <b>pedido</b>", event_type: "whatsapp_click", count: 87 }, { ref: 2, position: null, block_type: null, title: null, event_type: "link_click", count: 3 }],
    ...overrides,
  });
  if (!report) throw new Error("fixture is not a report");
  return { kind: "report", report };
}

async function render(token = TOKEN): Promise<string> {
  return renderToStaticMarkup((await SharedReportPage({ params: Promise.resolve({ token }) })) as ReactElement);
}

describe("/r/[token]", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => { logged.push(String(line)); });
    }
    mocks.fetchSharedReport.mockReset();
    mocks.requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    vi.stubEnv("VISITOR_HASH_SALT", "0123456789abcdef0123");
  });

  it("is read on every request and is not indexable, with a title that names nobody", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata).toMatchObject({ title: { absolute: "Relatório de resultados" }, robots: { index: false, follow: false }, referrer: "no-referrer" });
    expect(metadata.openGraph).toBeUndefined();
  });

  it("renders the numbers as text, with the same labels as the dashboard, and the expiry date", async () => {
    mocks.fetchSharedReport.mockResolvedValue(okRead());
    const html = await render();
    expect(html).toContain("Relatório de resultados · Agência Aurora");
    expect(html).toContain("Café Ipê");
    expect(html).toContain("Neste período a página recebeu 1.240 visitas e gerou 87 resultados.");
    expect(html).toContain("Resultados a cada 100 visitas");
    expect(html).toContain("De 03/10/2026 a 09/10/2026 (7 dias completos).");
    expect(html).toContain("Os números são estimativas");
    expect(html).toContain("Este link funciona até 9 de novembro de 2026.");
    expect(html).toContain("localhost:3000/cafe-ipe");
    // Titles written by the page owner are text, never markup.
    expect(html).toContain("Fazer &lt;b&gt;pedido&lt;/b&gt;");
    expect(html).toContain("Link (não está mais na página)");
    expect(html).not.toContain("Relatório gerado com");
  });

  it("shows the attribution only when the answer asks for it, and no address for a page that is off the air", async () => {
    mocks.fetchSharedReport.mockResolvedValue(okRead({ show_badge: true, page_slug: null }));
    const html = await render();
    expect(html).toContain("Relatório gerado com Projeto LNK.");
    expect(html).not.toContain("<a ");
  });

  it("tells no data from zero", async () => {
    mocks.fetchSharedReport.mockResolvedValue(okRead({ days: [], blocks: [], sources: [], first_event_day: null }));
    const html = await render();
    expect(html).toContain("Nenhuma visita registrada até agora");
    expect(html).not.toContain("recebeu 0 visitas");
  });

  it("sets nothing in the browser, loads nothing from elsewhere and does not mount the visit collector", async () => {
    mocks.fetchSharedReport.mockResolvedValue(okRead());
    const html = await render();
    expect(html).not.toMatch(/<script|<iframe|<img|<link|<form|<button/);
    // The only address in the page is the client's own public page, on this origin.
    expect([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])).toEqual(["http://localhost:3000/cafe-ipe"]);
    expect(html).toContain('rel="noreferrer"');
  });

  it.each<[string, SharedReportRead]>([
    ["unavailable", { kind: "unavailable" }],
    ["a database error", { kind: "error", code: "57014" }],
    ["a missing function", { kind: "error", code: "PGRST202" }],
  ])("answers %s with the one generic 404", async (_name, read) => {
    mocks.fetchSharedReport.mockResolvedValue(read);
    await expect(render()).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(render("abc")).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("has one unavailable text that says nothing about the cause or the product", () => {
    const html = renderToStaticMarkup(SharedReportUnavailable());
    expect(html).toContain("Relatório não disponível");
    expect(html).not.toMatch(/<a |<script|expirou em|cancelado em|plano/);
  });

  it("logs the outcome and never the token, the path or the address", async () => {
    mocks.fetchSharedReport.mockResolvedValue(okRead());
    await render();
    mocks.fetchSharedReport.mockResolvedValue({ kind: "unavailable" });
    await expect(render()).rejects.toBeInstanceOf(NotFoundSignal);
    mocks.fetchSharedReport.mockResolvedValue({ kind: "error", code: "57014" });
    await expect(render()).rejects.toBeInstanceOf(NotFoundSignal);
    expect(logged).toHaveLength(3);
    expect(logged[0]).toContain('"event":"report.read"');
    expect(logged.map((line) => (JSON.parse(line) as { outcome: string }).outcome)).toEqual(["ok", "unavailable", "error"]);
    expect(logged[2]).toContain('"errorCode":"57014"');
    const all = logged.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("/r/");
    expect(all).not.toContain("203.0.113.7");
  });

  it("gives the database a salted hash of the address, never the address", async () => {
    mocks.fetchSharedReport.mockResolvedValue(okRead());
    await render();
    const [token, client] = mocks.fetchSharedReport.mock.calls[0] as [string, string | null];
    expect(token).toBe(TOKEN);
    expect(client).toMatch(/^[0-9a-f]{32}$/);
    expect(client).not.toContain("203");
    vi.stubEnv("VISITOR_HASH_SALT", "");
    await render();
    expect(mocks.fetchSharedReport.mock.calls[1]?.[1]).toBeNull();
  });
});

describe("the visit collector stays on the public page only", () => {
  const appDirectory = fileURLToPath(new URL("../..", import.meta.url));

  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("is imported by /[slug] and by no other route, the report and the consolidated dashboard included", () => {
    const importers = sources(appDirectory)
      .filter((path) => /public-page-analytics|modules\/analytics\/collector|web-vitals-reporter/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(appDirectory.length).replace(/\\/g, "/").replace(/^\//, ""));
    expect(importers).toEqual(["[slug]/page.tsx"]);
    const reportRoute = sources(join(appDirectory, "r")).map((path) => readFileSync(path, "utf8")).join("\n");
    const consolidated = sources(join(appDirectory, "app", "w", "[workspaceId]", "resultados")).map((path) => readFileSync(path, "utf8")).join("\n");
    for (const source of [reportRoute, consolidated]) expect(source).not.toMatch(/"use client"|PublicPageAnalytics|analytics\/collector|sendBeacon|document\.cookie|localStorage/);
    expect(reportRoute).not.toMatch(/cookies\(\)|getSupabase|supabaseIdentity|SUPABASE_SECRET_KEY/);
  });
});
