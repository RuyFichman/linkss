import { UpgradeLink } from "@/modules/billing/components/upgrade-link";
import type { Metadata } from "next";
import Link from "next/link";
import { ANALYTICS_COPY, APP_COPY, WORKSPACE_ANALYTICS_COPY } from "@/content/pt-BR";
import { Bar, DailyChart } from "@/modules/analytics/components/charts";
import { aggregationIsDelayed, dailySeries, daysBeforeCollection, periodTotals, shareRanking } from "@/modules/analytics/dashboard";
import { formatDay, formatDayShort, formatInstant, parsePeriod, PERIOD_PRESETS, periodIsAvailable, type PeriodPreset } from "@/modules/analytics/dates";
import { getWorkspaceAnalyticsService } from "@/modules/analytics/server";
import { isTrafficSource } from "@/modules/analytics/sources";
import { dataCoverage, pageRows, workspaceState, type WorkspaceReport, type WorkspaceState } from "@/modules/analytics/workspace";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { Badge, EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Resultados da conta" };

const NUMBER = new Intl.NumberFormat("pt-BR");
const ONE_DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const CARD = "surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 sm:p-6";

/** "12,5": how many times something happened for every 100 visits. */
function perHundred(rate: number): string {
  return ONE_DECIMAL.format(rate * 100);
}

function PeriodNav({ basePath, current, historyDays }: { basePath: string; current: PeriodPreset; historyDays: number }) {
  return (
    <nav aria-label={ANALYTICS_COPY.periodNav}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {PERIOD_PRESETS.map((preset) => {
          const label = ANALYTICS_COPY.periods[preset];
          return (
            <li key={preset}>
              {periodIsAvailable(preset, historyDays) ? (
                <Link className={`ui-button ${preset === current ? "ui-button-primary" : "ui-button-secondary"}`} href={`${basePath}?periodo=${preset}`} aria-current={preset === current ? "page" : undefined}>{label}</Link>
              ) : (
                // Visible, with the reason in text (UX-007): never a dead button with only a lock.
                <span className="inline-flex min-h-11 items-center rounded-xl border border-dashed border-app-border px-4 text-sm text-app-muted">{ANALYTICS_COPY.periodLocked(label)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function StateMessage({ state, report }: { state: Exclude<WorkspaceState, "data">; report: WorkspaceReport | null }) {
  const copy = WORKSPACE_ANALYTICS_COPY.states[state];
  const description = state === "before_collection" ? WORKSPACE_ANALYTICS_COPY.states.before_collection.description(formatDay(report?.collectingSince ?? "")) : (copy.description as string);
  return <EmptyState title={copy.title} description={description} />;
}

function HowWeCount() {
  return (
    <section id="como-contamos" className={CARD} aria-labelledby="how-title">
      <h2 id="how-title" className="text-xl font-bold">{ANALYTICS_COPY.how.title}</h2>
      <ul className="m-0 grid gap-2 pl-5 text-app-muted">
        {ANALYTICS_COPY.how.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

/**
 * Consolidated results of a workspace (Sprint 7, ADR 0013): totals, the daily series, sources
 * summed across pages, and one row per page ordered by results, each linking into the page's own
 * dashboard. A ranking and a triage tool; blocks, campaigns, devices and countries stay per page.
 * One read function per render whatever the number of pages; every member reads it, and the
 * function re-checks membership and applies the plan's history depth. The numbers are produced by
 * the same functions as the per-page dashboard.
 */
export default async function WorkspaceAnalyticsPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ periodo?: string | string[] }> }) {
  const { workspaceId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "analytics.view");
  const copy = WORKSPACE_ANALYTICS_COPY;
  const basePath = `/app/w/${workspaceId}`;
  const resultsPath = `${basePath}/resultados`;
  const header = (
    <header className="grid gap-2">
      <h1 className="text-3xl font-bold break-words">{copy.title}</h1>
      <p className="m-0 text-app-muted">{copy.lead}</p>
    </header>
  );
  if (!access) return <div className="grid grid-cols-[minmax(0,1fr)] gap-6">{header}<Notice tone="warning">{ANALYTICS_COPY.forbidden}</Notice></div>;

  const requested = parsePeriod((await searchParams).periodo);
  let view: Awaited<ReturnType<Awaited<ReturnType<typeof getWorkspaceAnalyticsService>>["report"]>> | null = null;
  try {
    view = await (await getWorkspaceAnalyticsService()).report(workspaceId, requested);
  } catch {
    view = null;
  }
  if (!view || !view.ok) {
    return <div className="grid grid-cols-[minmax(0,1fr)] gap-6">{header}<Notice tone="danger">{view && view.error === "forbidden" ? ANALYTICS_COPY.forbidden : ANALYTICS_COPY.loadError}</Notice><HowWeCount /></div>;
  }

  const { report, period } = view.value;
  const state = workspaceState(report);

  if (!report || state !== "data") {
    const configured = report !== null && report.configured;
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {header}
        {configured ? <PeriodNav basePath={resultsPath} current={period} historyDays={report.historyDays} /> : null}
        {configured ? (
          <p className="m-0 text-sm text-app-muted" role="status">{ANALYTICS_COPY.window(formatDay(report.from), formatDay(report.to))} {ANALYTICS_COPY.timezone(report.timeZone)}</p>
        ) : null}
        <StateMessage state={state === "data" ? "not_available" : state} report={report} />
        {configured && aggregationIsDelayed(report) ? <Notice tone="warning">{ANALYTICS_COPY.delayed}</Notice> : null}
        <HowWeCount />
      </div>
    );
  }

  const rows = dailySeries(report);
  const totals = periodTotals(rows);
  const pages = pageRows(report);
  const coverage = dataCoverage(pages);
  const sources = shareRanking(report.sources, 12);
  const peakRow = rows.reduce((best, row) => (row.visits > best.visits ? row : best), rows[0] ?? { day: report.from, visits: 0 });
  const beforeDays = daysBeforeCollection(report);
  const includesToday = report.to === report.today;
  const canExport = can(access.role, "analytics.export");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {header}
      <PeriodNav basePath={resultsPath} current={period} historyDays={report.historyDays} />
      {report.historyDays < 90 ? <UpgradeLink workspaceId={workspaceId} role={access.role} reason="analytics_days" /> : null}
      {period !== requested ? <Notice>{ANALYTICS_COPY.historyNote(report.historyDays)}</Notice> : null}

      {/* What the numbers below refer to: announced when the period changes. */}
      <p className="m-0 text-sm text-app-muted" role="status" aria-live="polite">
        {ANALYTICS_COPY.window(formatDay(report.from), formatDay(report.to))}{" "}
        {includesToday ? `${ANALYTICS_COPY.includesToday} ` : ""}
        {ANALYTICS_COPY.timezone(report.timeZone)}{" "}
        {ANALYTICS_COPY.updatedAt(formatInstant(new Date(), report.timeZone))}{" "}
        {ANALYTICS_COPY.estimates}{" "}
        <a className="font-bold text-app-accent underline" href="#como-contamos">{ANALYTICS_COPY.howLink}</a>
      </p>

      {aggregationIsDelayed(report) ? <Notice tone="warning">{ANALYTICS_COPY.delayed}</Notice> : null}

      <section aria-labelledby="kpi-title" className="grid gap-4">
        <h2 id="kpi-title" className="sr-only">{ANALYTICS_COPY.kpi.title}</h2>
        <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: ANALYTICS_COPY.kpi.visits, value: NUMBER.format(totals.visits), hint: ANALYTICS_COPY.kpi.visitsHint },
            { label: ANALYTICS_COPY.kpi.results, value: NUMBER.format(totals.results), hint: ANALYTICS_COPY.kpi.resultsHint },
            { label: ANALYTICS_COPY.kpi.rate, value: totals.resultRate === null ? "—" : perHundred(totals.resultRate), hint: totals.resultRate === null ? ANALYTICS_COPY.kpi.noRate : "" },
            { label: copy.kpiPages, value: NUMBER.format(coverage.withData), hint: copy.kpiPagesHint(pages.length) },
          ].map((item) => (
            <div key={item.label} className="surface-card grid content-start gap-1 p-5">
              <dt className="text-sm font-bold text-app-muted">{item.label}</dt>
              <dd className="m-0 text-3xl font-bold">{item.value}</dd>
              {item.hint ? <dd className="m-0 text-sm text-app-muted">{item.hint}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section className={CARD} aria-labelledby="pages-title">
        <h2 id="pages-title" className="text-xl font-bold">{copy.pages.title}</h2>
        <p className="m-0 text-sm text-app-muted">{copy.pages.lead}</p>
        {/* The mixed case in words: some pages have numbers, others have a reason for not having them. */}
        {coverage.withoutData > 0 ? <p className="m-0 text-sm font-bold">{copy.pages.mixed(coverage.withData, coverage.withoutData)}</p> : null}
        {/* One card per page on a phone, a table from 768 px: the same list, never scrolled sideways.
            The roles are explicit because changing `display` drops the table semantics in some browsers. */}
        <table role="table" className="w-full border-collapse text-left max-md:block">
          <caption className="sr-only">{copy.pages.caption}</caption>
          <thead role="rowgroup" className="max-md:sr-only">
            <tr role="row" className="border-b border-app-border text-sm">
              <th scope="col" role="columnheader" className="py-2 pr-3">{copy.pages.page}</th>
              <th scope="col" role="columnheader" className="py-2 pr-3 text-right">{copy.pages.visits}</th>
              <th scope="col" role="columnheader" className="py-2 pr-3 text-right">{copy.pages.results}</th>
              <th scope="col" role="columnheader" className="py-2 pr-3 text-right">{copy.pages.rate}</th>
              <th scope="col" role="columnheader" className="py-2 pr-3">{copy.pages.situation}</th>
              <td role="cell" className="py-2" />
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-md:grid max-md:gap-3">
            {pages.map(({ page, state: rowState, totals: pageTotals }) => {
              const number = (value: number | undefined) => (pageTotals ? NUMBER.format(value ?? 0) : <span className="text-app-muted">{copy.pages.noNumber}</span>);
              const cell = "py-3 pr-3 max-md:flex max-md:justify-between max-md:gap-4 max-md:py-1 max-md:pr-0 md:text-right";
              return (
                <tr key={page.profileId} role="row" className="border-b border-app-border max-md:grid max-md:rounded-2xl max-md:border max-md:p-4">
                  <th scope="row" role="rowheader" className="py-3 pr-3 font-normal max-md:pr-0">
                    {/* Owner-supplied text: rendered as text. */}
                    <b className="block break-words">{page.title}</b>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-app-muted">
                      <span className="break-all">/{page.slug}</span>
                      {page.status === "archived" ? <Badge tone="warning">{copy.pages.archived}</Badge> : page.status === "draft" ? <Badge>{copy.pages.draft}</Badge> : null}
                    </span>
                  </th>
                  <td role="cell" className={cell}><span className="text-sm text-app-muted md:hidden">{copy.pages.visits}</span><b>{number(pageTotals?.visits)}</b></td>
                  <td role="cell" className={cell}><span className="text-sm text-app-muted md:hidden">{copy.pages.results}</span><b>{number(pageTotals?.results)}</b></td>
                  <td role="cell" className={cell}><span className="text-sm text-app-muted md:hidden">{copy.pages.rate}</span><span>{pageTotals && pageTotals.resultRate !== null ? perHundred(pageTotals.resultRate) : copy.pages.noRate}</span></td>
                  <td role="cell" className="py-3 pr-3 text-sm max-md:py-1 max-md:pr-0">{copy.pages.states[rowState]}</td>
                  <td role="cell" className="py-3 max-md:pt-2">
                    <Link className="ui-button ui-button-secondary max-md:w-full" href={`${basePath}/paginas/${page.profileId}/resultados?periodo=${period}`} aria-label={copy.pages.openFor(page.title)}>{copy.pages.open}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {report.pagesTruncated ? <p className="m-0 text-sm font-bold">{copy.pages.truncated(pages.length)}</p> : null}
        {report.pagesOmitted > 0 ? <p className="m-0 text-sm text-app-muted">{copy.pages.omitted(report.pagesOmitted)}</p> : null}
      </section>

      <section className={CARD} aria-labelledby="series-title">
        <h2 id="series-title" className="text-xl font-bold">{copy.series.title}</h2>
        <DailyChart rows={rows} label={ANALYTICS_COPY.series.chartLabel(formatDay(report.from), formatDay(report.to), peakRow.visits, formatDay(peakRow.day))} />
        <p className="m-0 flex flex-wrap justify-between gap-x-4 text-sm text-app-muted" aria-hidden="true">
          <span>{formatDayShort(report.from)}</span><span>{formatDayShort(report.to)}</span>
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-app-muted">
          <li>{ANALYTICS_COPY.series.legendVisits}</li>
          <li>{ANALYTICS_COPY.series.legendResults}</li>
          {beforeDays > 0 ? <li>{ANALYTICS_COPY.series.legendBefore}</li> : null}
        </ul>
        {beforeDays > 0 ? <p className="m-0 text-sm font-bold">{ANALYTICS_COPY.series.beforeNote(beforeDays, formatDay(report.collectingSince))}</p> : null}
        <details open={rows.length <= 7}>
          <summary className="min-h-11 cursor-pointer content-center font-bold">{ANALYTICS_COPY.series.table}</summary>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <caption className="sr-only">{ANALYTICS_COPY.series.caption}</caption>
              <thead>
                <tr className="border-b border-app-border">
                  <th scope="col" className="py-2 pr-3">{ANALYTICS_COPY.series.day}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{ANALYTICS_COPY.series.visits}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{ANALYTICS_COPY.series.interactions}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{ANALYTICS_COPY.series.results}</th>
                  <th scope="col" className="py-2">{ANALYTICS_COPY.series.situation}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((row) => {
                  const empty = row.status === "before_collection";
                  const cell = (value: number) => (empty ? <span className="text-app-muted">{ANALYTICS_COPY.series.noNumber}</span> : NUMBER.format(value));
                  return (
                    <tr key={row.day} className="border-b border-app-border">
                      <th scope="row" className="py-2 pr-3 font-normal whitespace-nowrap">{formatDay(row.day)}</th>
                      <td className="py-2 pr-3 text-right">{cell(row.visits)}</td>
                      <td className="py-2 pr-3 text-right">{cell(row.interactions)}</td>
                      <td className="py-2 pr-3 text-right">{cell(row.results)}</td>
                      <td className="py-2">{ANALYTICS_COPY.series.status[row.status]}{row.partial && !empty ? ` (${ANALYTICS_COPY.series.partial})` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="py-2 pr-3">{ANALYTICS_COPY.series.total}</th>
                  <td className="py-2 pr-3 text-right font-bold">{NUMBER.format(totals.visits)}</td>
                  <td className="py-2 pr-3 text-right font-bold">{NUMBER.format(totals.interactions)}</td>
                  <td className="py-2 pr-3 text-right font-bold">{NUMBER.format(totals.results)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      </section>

      <section className={CARD} aria-labelledby="sources-title">
        <h2 id="sources-title" className="text-xl font-bold">{copy.sources.title}</h2>
        <p className="m-0 text-sm text-app-muted">{copy.sources.lead}</p>
        {sources.rows.length === 0 ? <p className="m-0 text-app-muted">{ANALYTICS_COPY.sources.empty}</p> : (
          <ol className="m-0 grid list-none gap-3 p-0">
            {sources.rows.map((row) => (
              <li key={row.key} className="grid gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <b>{isTrafficSource(row.key) ? ANALYTICS_COPY.sources.labels[row.key] : ANALYTICS_COPY.sources.labels.other}</b>
                  <span>{ANALYTICS_COPY.visits(row.count)}{row.share !== null ? <span className="text-app-muted"> · {ANALYTICS_COPY.share(perHundred(row.share))}</span> : null}</span>
                </span>
                <Bar ratio={row.share ?? 0} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {canExport ? (
        // A plain form post: the file downloads without JavaScript, and a POST cannot be triggered by a link.
        <form method="post" action={`${resultsPath}/exportar?periodo=${period}`} className="grid justify-items-start gap-1">
          <button type="submit" className="ui-button ui-button-secondary" aria-describedby="workspace-export-hint">{copy.export.button}</button>
          <span id="workspace-export-hint" className="ui-hint">{copy.export.hint}</span>
        </form>
      ) : null}

      <p className="m-0"><Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={basePath}>← {APP_COPY.nav.pages}</Link></p>
      <HowWeCount />
    </div>
  );
}
