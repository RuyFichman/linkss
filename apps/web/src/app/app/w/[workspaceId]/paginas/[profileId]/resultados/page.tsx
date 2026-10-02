import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ANALYTICS_COPY } from "@/content/pt-BR";
import { blockTitle, blockTypeLabelForEvent } from "@/modules/analytics/block-labels";
import { Bar, DailyChart } from "@/modules/analytics/components/charts";
import { VALUE_ACTION_TYPES } from "@/modules/analytics/contract";
import { aggregationIsDelayed, blockRanking, dailySeries, dashboardState, daysBeforeCollection, periodTotals, shareRanking, splitUtmKey, type AnalyticsReport, type DashboardState } from "@/modules/analytics/dashboard";
import { formatDay, formatDayShort, formatInstant, parsePeriod, PERIOD_PRESETS, periodIsAvailable, type PeriodPreset } from "@/modules/analytics/dates";
import { isDeviceClass } from "@/modules/analytics/device";
import { getAnalyticsService } from "@/modules/analytics/server";
import { isTrafficSource } from "@/modules/analytics/sources";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { getProfileRepository } from "@/modules/profiles/server";
import { getPublishingRepository } from "@/modules/publishing/server";
import { EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Resultados" };

const NUMBER = new Intl.NumberFormat("pt-BR");
const ONE_DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const COUNTRY_NAMES = new Intl.DisplayNames("pt-BR", { type: "region" });

/** "12,5": how many times something happened for every 100 visits. */
function perHundred(rate: number): string {
  return ONE_DECIMAL.format(rate * 100);
}

function countryName(code: string): string {
  if (code === "ZZ") return ANALYTICS_COPY.countries.unknown;
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

const CARD = "surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 sm:p-6";

function PeriodNav({ basePath, current, historyDays }: { basePath: string; current: PeriodPreset; historyDays: number | null }) {
  return (
    <nav aria-label={ANALYTICS_COPY.periodNav}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {PERIOD_PRESETS.map((preset) => {
          const label = ANALYTICS_COPY.periods[preset];
          const available = historyDays === null || periodIsAvailable(preset, historyDays);
          return (
            <li key={preset}>
              {available ? (
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

function StateMessage({ state, report }: { state: Exclude<DashboardState, "data">; report: AnalyticsReport | null }) {
  const copy = ANALYTICS_COPY.states[state];
  const description = state === "before_collection" ? ANALYTICS_COPY.states.before_collection.description(formatDay(report?.collectingSince ?? "")) : (copy.description as string);
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
 * Results of one page (Sprint 6, ADR 0011): visits, results, the path between them, the daily
 * series, blocks, sources, devices and countries for a period. Server-rendered from aggregates;
 * every member of the workspace reads it, and the read function re-checks membership and applies
 * the plan's history depth. States without numbers ("not available", "never published", "before
 * counting", "no data yet", "zero") each have their own text: no data is never shown as zero.
 */
export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; profileId: string }>; searchParams: Promise<{ periodo?: string | string[] }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "analytics.view");
  if (!isUuid(profileId)) notFound();
  const profile = await (await getProfileRepository()).findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();

  const basePath = `/app/w/${workspaceId}/paginas/${profile.id}`;
  const header = (
    <>
      <Link className="inline-flex min-h-11 w-fit items-center font-bold text-app-accent underline" href={basePath}>← {ANALYTICS_COPY.back}</Link>
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold break-words">{ANALYTICS_COPY.title}</h1>
        <p className="m-0 font-bold break-words">{profile.title}</p>
        <p className="m-0 text-app-muted">{ANALYTICS_COPY.lead}</p>
      </header>
    </>
  );
  if (!access) return <div className="grid grid-cols-[minmax(0,1fr)] gap-6">{header}<Notice tone="warning">{ANALYTICS_COPY.forbidden}</Notice></div>;

  const requested = parsePeriod((await searchParams).periodo);
  let view: Awaited<ReturnType<Awaited<ReturnType<typeof getAnalyticsService>>["report"]>> | null = null;
  let everPublished = profile.livePublicationId !== null;
  try {
    const [result, publications] = await Promise.all([
      (await getAnalyticsService()).report(profile.id, requested),
      everPublished ? Promise.resolve([]) : (await getPublishingRepository()).listPublications(profile.id, 1),
    ]);
    view = result;
    everPublished = everPublished || publications.length > 0;
  } catch {
    view = null;
  }
  if (!view || !view.ok) {
    return <div className="grid grid-cols-[minmax(0,1fr)] gap-6">{header}<Notice tone="danger">{view && view.error === "forbidden" ? ANALYTICS_COPY.forbidden : ANALYTICS_COPY.loadError}</Notice><HowWeCount /></div>;
  }

  const { report, period } = view.value;
  const state = dashboardState({ report, everPublished });
  const resultsPath = `${basePath}/resultados`;

  if (!report || state !== "data") {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {header}
        {report && report.configured ? <PeriodNav basePath={resultsPath} current={period} historyDays={report.historyDays} /> : null}
        {report && report.configured ? (
          <p className="m-0 text-sm text-app-muted" role="status">{ANALYTICS_COPY.window(formatDay(report.from), formatDay(report.to))} {ANALYTICS_COPY.timezone(report.timeZone)}</p>
        ) : null}
        <StateMessage state={state === "data" ? "not_available" : state} report={report} />
        {report && report.configured && aggregationIsDelayed(report) ? <Notice tone="warning">{ANALYTICS_COPY.delayed}</Notice> : null}
        <HowWeCount />
      </div>
    );
  }

  const rows = dailySeries(report);
  const totals = periodTotals(rows);
  const ranking = blockRanking(report, profile.blocks.map((block, position) => ({ id: block.id, position })), totals.visits);
  const blocksById = new Map(profile.blocks.map((block) => [block.id, block]));
  const sources = shareRanking(report.sources, 12);
  const devices = shareRanking(report.devices, 4);
  const countries = shareRanking(report.countries, 8);
  const peakRow = rows.reduce((best, row) => (row.visits > best.visits ? row : best), rows[0] ?? { day: report.from, visits: 0 });
  const beforeDays = daysBeforeCollection(report);
  const topClicks = ranking[0]?.clicks ?? 0;
  const includesToday = report.to === report.today;
  const canExport = can(access.role, "analytics.export");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {header}
      <PeriodNav basePath={resultsPath} current={period} historyDays={report.historyDays} />
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
            { label: ANALYTICS_COPY.kpi.linkClicks, value: NUMBER.format(totals.linkClicks), hint: ANALYTICS_COPY.kpi.linkClicksHint },
          ].map((item) => (
            <div key={item.label} className="surface-card grid content-start gap-1 p-5">
              <dt className="text-sm font-bold text-app-muted">{item.label}</dt>
              <dd className="m-0 text-3xl font-bold">{item.value}</dd>
              {item.hint ? <dd className="m-0 text-sm text-app-muted">{item.hint}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="funnel-title">
          <h2 id="funnel-title" className="text-xl font-bold">{ANALYTICS_COPY.funnel.title}</h2>
          <ol className="m-0 grid list-none gap-4 p-0">
            {[
              { label: ANALYTICS_COPY.funnel.visits, value: totals.visits, rate: null as number | null },
              { label: ANALYTICS_COPY.funnel.interactions, value: totals.interactions, rate: totals.interactionRate },
              { label: ANALYTICS_COPY.funnel.results, value: totals.results, rate: totals.resultRate },
            ].map((step) => (
              <li key={step.label} className="grid gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <b>{step.label}</b>
                  <span>{NUMBER.format(step.value)}{step.rate !== null ? <span className="text-app-muted"> · {ANALYTICS_COPY.funnel.perHundred(perHundred(step.rate))}</span> : null}</span>
                </span>
                <Bar ratio={step.rate === null ? 1 : step.rate} tone={step.label === ANALYTICS_COPY.funnel.results ? "success" : "accent"} />
              </li>
            ))}
          </ol>
          <p className="m-0 text-sm text-app-muted">{ANALYTICS_COPY.funnel.note}</p>
          <h3 className="text-base font-bold">{ANALYTICS_COPY.resultTypes.title}</h3>
          <dl className="m-0 grid gap-1">
            {VALUE_ACTION_TYPES.map((type) => (
              <div key={type} className="flex flex-wrap justify-between gap-x-4">
                <dt>{ANALYTICS_COPY.resultTypes[type]}</dt>
                <dd className="m-0 font-bold">{NUMBER.format(totals.counts[type] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={CARD} aria-labelledby="blocks-title">
          <h2 id="blocks-title" className="text-xl font-bold">{ANALYTICS_COPY.blocks.title}</h2>
          <p className="m-0 text-sm text-app-muted">{ANALYTICS_COPY.blocks.lead}</p>
          {ranking.length === 0 ? <p className="m-0 text-app-muted">{ANALYTICS_COPY.blocks.empty}</p> : (
            <ol className="m-0 grid list-none gap-4 p-0">
              {ranking.map((row) => {
                const block = blocksById.get(row.blockId);
                const name = block ? blockTitle(block) : ANALYTICS_COPY.blocks.removedType(blockTypeLabelForEvent(row.mainType));
                return (
                  <li key={row.blockId} className="grid gap-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                      {/* Owner-supplied text: rendered as text. */}
                      <b className="min-w-0 break-words">{name}</b>
                      <span>
                        {ANALYTICS_COPY.blocks.clicks(row.clicks)}
                        {row.clickRate !== null ? <span className="text-app-muted"> · {ANALYTICS_COPY.blocks.perHundred(perHundred(row.clickRate))}</span> : null}
                      </span>
                    </span>
                    <Bar ratio={topClicks > 0 ? row.clicks / topClicks : 0} tone={row.results > 0 ? "success" : "accent"} />
                    {row.results > 0 ? <span className="text-sm text-app-muted">{ANALYTICS_COPY.blocks.isResult}</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <section className={CARD} aria-labelledby="series-title">
        <h2 id="series-title" className="text-xl font-bold">{ANALYTICS_COPY.series.title}</h2>
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="sources-title">
          <h2 id="sources-title" className="text-xl font-bold">{ANALYTICS_COPY.sources.title}</h2>
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

        <section className={CARD} aria-labelledby="audience-title">
          <h2 id="audience-title" className="text-xl font-bold">{ANALYTICS_COPY.devices.title}</h2>
          <dl className="m-0 grid gap-1">
            {devices.rows.map((row) => (
              <div key={row.key} className="flex flex-wrap justify-between gap-x-4">
                <dt>{isDeviceClass(row.key) ? ANALYTICS_COPY.devices.labels[row.key] : ANALYTICS_COPY.devices.labels.unknown}</dt>
                <dd className="m-0"><b>{ANALYTICS_COPY.visits(row.count)}</b>{row.share !== null ? <span className="text-app-muted"> · {ANALYTICS_COPY.share(perHundred(row.share))}</span> : null}</dd>
              </div>
            ))}
          </dl>
          <h2 className="text-xl font-bold">{ANALYTICS_COPY.countries.title}</h2>
          <dl className="m-0 grid gap-1">
            {countries.rows.map((row) => (
              <div key={row.key} className="flex flex-wrap justify-between gap-x-4">
                <dt>{countryName(row.key)}</dt>
                <dd className="m-0"><b>{ANALYTICS_COPY.visits(row.count)}</b>{row.share !== null ? <span className="text-app-muted"> · {ANALYTICS_COPY.share(perHundred(row.share))}</span> : null}</dd>
              </div>
            ))}
            {countries.others > 0 ? (
              <div className="flex flex-wrap justify-between gap-x-4">
                <dt>{ANALYTICS_COPY.countries.others}</dt>
                <dd className="m-0"><b>{ANALYTICS_COPY.visits(countries.others)}</b></dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      {report.utms.length > 0 ? (
        <section className={CARD} aria-labelledby="utm-title">
          <h2 id="utm-title" className="text-xl font-bold">{ANALYTICS_COPY.utm.title}</h2>
          <p className="m-0 text-sm text-app-muted">{ANALYTICS_COPY.utm.lead}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <caption className="sr-only">{ANALYTICS_COPY.utm.caption}</caption>
              <thead>
                <tr className="border-b border-app-border">
                  <th scope="col" className="py-2 pr-3">{ANALYTICS_COPY.utm.source}</th>
                  <th scope="col" className="py-2 pr-3">{ANALYTICS_COPY.utm.medium}</th>
                  <th scope="col" className="py-2 pr-3">{ANALYTICS_COPY.utm.campaign}</th>
                  <th scope="col" className="py-2 text-right">{ANALYTICS_COPY.utm.visits}</th>
                </tr>
              </thead>
              <tbody>
                {report.utms.map((row) => {
                  const utm = splitUtmKey(row.key);
                  return (
                    <tr key={row.key} className="border-b border-app-border">
                      {/* Visitor-supplied values (restricted to a-z, 0-9, "_", "." and "-"): rendered as text. */}
                      <td className="py-2 pr-3 break-all">{utm.source}</td>
                      <td className="py-2 pr-3 break-all">{utm.medium || <span className="text-app-muted">{ANALYTICS_COPY.utm.none}</span>}</td>
                      <td className="py-2 pr-3 break-all">{utm.campaign || <span className="text-app-muted">{ANALYTICS_COPY.utm.none}</span>}</td>
                      <td className="py-2 text-right font-bold">{NUMBER.format(row.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canExport ? (
        // A plain form post: the file downloads without JavaScript, and a POST cannot be triggered by a link.
        <form method="post" action={`${resultsPath}/exportar?periodo=${period}`} className="grid justify-items-start gap-1">
          <button type="submit" className="ui-button ui-button-secondary" aria-describedby="analytics-export-hint">{ANALYTICS_COPY.export.button}</button>
          <span id="analytics-export-hint" className="ui-hint">{ANALYTICS_COPY.export.hint}</span>
        </form>
      ) : null}

      <HowWeCount />
    </div>
  );
}
