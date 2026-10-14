import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { PRODUCT } from "@/lib/product";
import { probePublicStatus } from "@/modules/ops/public-status-server";
import { Badge } from "@/ui";
import { BRAND_CLASS } from "@/ui/brand-font";

export const metadata: Metadata = { title: `${STATUS_COPY.title} | ${PRODUCT.name}`, robots: { index: false, follow: true } };

// Rendered per request: the probe behind it answers from memory for thirty seconds, which bounds
// the database cost without ever showing a state older than that.
export const dynamic = "force-dynamic";

/**
 * Public status page: whether the application answers and whether the database behind pages and
 * the panel does. It names no customer, job or number, and states its own limit: it is served by
 * the application it reports on.
 */
export default async function StatusPage() {
  const copy = STATUS_COPY;
  const status = await probePublicStatus();
  const ok = status.overall === "operational";
  return (
    <main className={`${BRAND_CLASS} py-8 sm:py-16`}>
      <div className="app-shell grid max-w-3xl gap-6">
        <h1 className="text-3xl font-bold sm:text-4xl">{copy.title}</h1>

        <section className="surface-card grid gap-2 p-5 sm:p-8" aria-labelledby="situacao-geral">
          <h2 id="situacao-geral" className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            <span aria-hidden="true">{ok ? "✓" : "!"}</span>
            {copy.overall[status.overall]}
          </h2>
          <p className="m-0 leading-7">{copy.overallDetail[status.overall]}</p>
        </section>

        <ul className="m-0 grid list-none gap-3 p-0">
          {status.components.map((component) => (
            <li key={component.key} className="surface-card flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="grid min-w-0 gap-1">
                <h3 className="text-lg font-bold">{copy.components[component.key].name}</h3>
                <p className="m-0 text-sm text-app-muted">{copy.components[component.key].description}</p>
              </div>
              {/* The state is written out; the color only repeats it. */}
              <Badge tone={component.state === "operational" ? "success" : "warning"}>{copy.state[component.state]}</Badge>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 text-sm text-app-muted">
          <p className="m-0">{copy.checkedAt(formatDateTime(status.checkedAt))}</p>
          <p className="m-0">{copy.limits}</p>
          <p className="m-0">{copy.help}</p>
        </div>

        <p className="m-0 flex flex-wrap gap-3">
          <Link className="ui-button ui-button-secondary" href="/ajuda">{copy.helpLink}</Link>
          <Link className="ui-button ui-button-secondary" href="/">{copy.back}</Link>
        </p>
      </div>
    </main>
  );
}
