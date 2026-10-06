import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BLOCKS_COPY } from "@/content/pt-BR";
import { SHARED_REPORT_COPY } from "@/content/shared-report";
import { publicAddressLabel, publicPageUrl } from "@/lib/app-url";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { PRODUCT } from "@/lib/product";
import { blockTypeLabelForEvent } from "@/modules/analytics/block-labels";
import { Bar, DailyChart } from "@/modules/analytics/components/charts";
import { VALUE_ACTION_TYPES } from "@/modules/analytics/contract";
import { daysBeforeCollection } from "@/modules/analytics/dashboard";
import { formatDay, formatDayShort } from "@/modules/analytics/dates";
import { isTrafficSource } from "@/modules/analytics/sources";
import { clientAddress } from "@/modules/leads/visitor-hash";
import { fetchSharedReport } from "@/modules/reports/server";
import { sharedReportView, type SharedBlockRow } from "@/modules/reports/shared-report";
import { reportClientHash } from "@/modules/reports/token";

// Read on every request: a link must stop working on the request after it is revoked or expires
// (ADR 0013). Never ISR, never a shared cache; next.config.ts adds the response headers.
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("pt-BR");
const ONE_DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const EXPIRY = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });
const CARD = "surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 break-inside-avoid sm:p-6 print:shadow-none";

function perHundred(rate: number): string {
  return ONE_DECIMAL.format(rate * 100);
}

function blockName(row: SharedBlockRow): string {
  const copy = SHARED_REPORT_COPY.blocks;
  const typeLabel = row.blockType && row.blockType in BLOCKS_COPY.types ? BLOCKS_COPY.types[row.blockType as keyof typeof BLOCKS_COPY.types].label : blockTypeLabelForEvent(row.mainType) || copy.unnamed;
  // A block that is in no published snapshot has no title to show: name it by its kind.
  return row.title ?? (row.blockType ? typeLabel : copy.removed(typeLabel));
}

/**
 * The report a client opens from a link (Sprint 7, ADR 0013). No account, no navigation, nothing of
 * the workspace but its name: the token in the address is the only key, and every token that does
 * not open a report gets the same 404 with the same text. The page sets no cookie, loads nothing
 * from a third party and does not mount the visit collector (opening a report is not a visit).
 * The log line carries the outcome and never the token or the path.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const requestHeaders = await headers();
  const correlationId = correlationIdFrom(requestHeaders.get(CORRELATION_HEADER));
  const client = reportClientHash(clientAddress(requestHeaders.get("x-forwarded-for"), requestHeaders.get("x-real-ip")), process.env.VISITOR_HASH_SALT);
  const read = await fetchSharedReport(token, client);
  logEvent(read.kind === "error" ? "error" : "info", "report.read", { correlationId, outcome: read.kind === "report" ? "ok" : read.kind, errorCode: read.kind === "error" ? read.code : undefined });
  if (read.kind !== "report") notFound();

  const { report } = read;
  const copy = SHARED_REPORT_COPY;
  const view = sharedReportView(report);
  const { analytics } = report;
  const { rows, totals } = view;
  const peakRow = rows.reduce((best, row) => (row.visits > best.visits ? row : best), rows[0] ?? { day: analytics.from, visits: 0 });
  const beforeDays = daysBeforeCollection(analytics);
  const topClicks = view.blocks[0]?.clicks ?? 0;

  return (
    <main className="min-h-screen bg-app-bg py-8 text-app-text sm:py-12 print:bg-white print:py-0">
      <article className="mx-auto grid w-[min(880px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)] gap-6">
        <header className="grid gap-2 border-b border-app-border pb-6">
          {/* Workspace- and owner-supplied text: rendered as text. */}
          <p className="m-0 text-sm font-bold text-app-accent">{copy.kicker(report.workspaceName)}</p>
          <h1 className="m-0 text-3xl font-bold break-words sm:text-4xl">{report.pageTitle}</h1>
          {report.pageSlug ? (
            <p className="m-0 text-sm">
              <span className="sr-only">{copy.address}: </span>
              <a className="inline-flex min-h-11 items-center font-bold break-all text-app-accent underline" href={publicPageUrl(report.pageSlug)} rel="noreferrer">{publicAddressLabel(report.pageSlug)}</a>
            </p>
          ) : null}
          <p className="m-0 text-app-muted">{copy.period(formatDay(analytics.from), formatDay(analytics.to), view.periodDays)} {copy.timezone}</p>
        </header>

        {view.state !== "data" ? (
          <section className="ui-empty" aria-labelledby="state-title">
            <h2 id="state-title" className="m-0 text-lg font-bold text-app-text">{copy.states[view.state].title}</h2>
            <p className="m-0 max-w-md">{copy.states[view.state].description}</p>
          </section>
        ) : (
          <>
            <p className="m-0 max-w-3xl text-xl font-bold sm:text-2xl">{copy.summary(NUMBER.format(totals.visits), NUMBER.format(totals.results), totals.visits === 1, totals.results === 1)}</p>

            <section aria-labelledby="kpi-title" className="grid gap-4">
              <h2 id="kpi-title" className="sr-only">{copy.kpi.title}</h2>
              <dl className="m-0 grid gap-4 sm:grid-cols-3">
                {[
                  { label: copy.kpi.visits, value: NUMBER.format(totals.visits), hint: copy.kpi.visitsHint },
                  { label: copy.kpi.results, value: NUMBER.format(totals.results), hint: copy.kpi.resultsHint },
                  { label: copy.kpi.rate, value: totals.resultRate === null ? "—" : perHundred(totals.resultRate), hint: totals.resultRate === null ? copy.kpi.noRate : "" },
                ].map((item) => (
                  <div key={item.label} className="surface-card grid content-start gap-1 p-5 break-inside-avoid print:shadow-none">
                    <dt className="text-sm font-bold text-app-muted">{item.label}</dt>
                    <dd className="m-0 text-3xl font-bold">{item.value}</dd>
                    {item.hint ? <dd className="m-0 text-sm text-app-muted">{item.hint}</dd> : null}
                  </div>
                ))}
              </dl>
            </section>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
              <section className={CARD} aria-labelledby="results-title">
                <h2 id="results-title" className="text-xl font-bold">{copy.resultTypes.title}</h2>
                <dl className="m-0 grid gap-1">
                  {VALUE_ACTION_TYPES.map((type) => (
                    <div key={type} className="flex flex-wrap justify-between gap-x-4">
                      <dt>{copy.resultTypes[type]}</dt>
                      <dd className="m-0 font-bold">{NUMBER.format(totals.counts[type] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className={CARD} aria-labelledby="sources-title">
                <h2 id="sources-title" className="text-xl font-bold">{copy.sources.title}</h2>
                {view.sources.rows.length === 0 ? <p className="m-0 text-app-muted">{copy.sources.empty}</p> : (
                  <ol className="m-0 grid list-none gap-3 p-0">
                    {view.sources.rows.map((row) => (
                      <li key={row.key} className="grid gap-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                          <b>{isTrafficSource(row.key) ? copy.sources.labels[row.key] : copy.sources.labels.other}</b>
                          <span>{copy.sources.visits(row.count)}{row.share !== null ? <span className="text-app-muted"> · {copy.sources.share(perHundred(row.share))}</span> : null}</span>
                        </span>
                        <Bar ratio={row.share ?? 0} />
                      </li>
                    ))}
                    {view.sources.others > 0 ? (
                      <li className="flex flex-wrap items-baseline justify-between gap-x-4"><b>{copy.sources.others}</b><span>{copy.sources.visits(view.sources.others)}</span></li>
                    ) : null}
                  </ol>
                )}
              </section>
            </div>

            <section className={CARD} aria-labelledby="blocks-title">
              <h2 id="blocks-title" className="text-xl font-bold">{copy.blocks.title}</h2>
              {view.blocks.length === 0 ? <p className="m-0 text-app-muted">{copy.blocks.empty}</p> : (
                <ol className="m-0 grid list-none gap-4 p-0">
                  {view.blocks.map((row) => (
                    <li key={row.ref} className="grid gap-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                        {/* Text the page shows to its visitors: rendered as text. */}
                        <b className="min-w-0 break-words">{blockName(row)}</b>
                        <span>
                          {copy.blocks.clicks(row.clicks)}
                          {row.clickRate !== null ? <span className="text-app-muted"> · {copy.blocks.perHundred(perHundred(row.clickRate))}</span> : null}
                        </span>
                      </span>
                      <Bar ratio={topClicks > 0 ? row.clicks / topClicks : 0} tone={row.results > 0 ? "success" : "accent"} />
                      {row.results > 0 ? <span className="text-sm text-app-muted">{copy.blocks.isResult}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 sm:p-6 print:shadow-none" aria-labelledby="series-title">
              <h2 id="series-title" className="text-xl font-bold">{copy.series.title}</h2>
              <DailyChart rows={rows} label={copy.series.chartLabel(formatDay(analytics.from), formatDay(analytics.to), peakRow.visits, formatDay(peakRow.day))} />
              <p className="m-0 flex flex-wrap justify-between gap-x-4 text-sm text-app-muted" aria-hidden="true">
                <span>{formatDayShort(analytics.from)}</span><span>{formatDayShort(analytics.to)}</span>
              </p>
              <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-app-muted">
                <li>{copy.series.legendVisits}</li>
                <li>{copy.series.legendResults}</li>
                {beforeDays > 0 ? <li>{copy.series.legendBefore}</li> : null}
              </ul>
              <h3 className="text-base font-bold">{copy.series.table}</h3>
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">{copy.series.caption}</caption>
                <thead>
                  <tr className="border-b border-app-border">
                    <th scope="col" className="py-2 pr-3">{copy.series.day}</th>
                    <th scope="col" className="py-2 pr-3 text-right">{copy.series.visits}</th>
                    <th scope="col" className="py-2 text-right">{copy.series.results}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((row) => {
                    const empty = row.status === "before_collection";
                    const cell = (value: number) => (empty ? <span className="text-app-muted">{copy.series.noNumber}</span> : NUMBER.format(value));
                    return (
                      <tr key={row.day} className="border-b border-app-border">
                        <th scope="row" className="py-2 pr-3 font-normal whitespace-nowrap">{formatDay(row.day)}</th>
                        <td className="py-2 pr-3 text-right">{cell(row.visits)}</td>
                        <td className="py-2 text-right">{cell(row.results)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="py-2 pr-3">{copy.series.total}</th>
                    <td className="py-2 pr-3 text-right font-bold">{NUMBER.format(totals.visits)}</td>
                    <td className="py-2 text-right font-bold">{NUMBER.format(totals.results)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          </>
        )}

        <section className={CARD} aria-labelledby="how-title">
          <h2 id="how-title" className="text-xl font-bold">{copy.how.title}</h2>
          <ul className="m-0 grid gap-2 pl-5 text-app-muted">
            {copy.how.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <footer className="grid gap-1 border-t border-app-border pt-5 text-sm text-app-muted">
          <p className="m-0">{copy.readOnly} {copy.expires(EXPIRY.format(new Date(report.expiresAt)))}</p>
          {report.showBadge ? <p className="m-0">{copy.badge(PRODUCT.codename)}</p> : null}
        </footer>
      </article>
    </main>
  );
}
