import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_COPY, PRICING_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { PLAN_IDS, formatMoney, isPaidPlan, planPrice, yearlySavingCents } from "@/modules/billing/catalog";
import { paidPlansAreOnSale } from "@/modules/billing/marketing";
import { resolveBillingMode } from "@/modules/billing/mode";
import { planFeatureLines } from "@/modules/billing/presentation";
import { domainsSignerFromEnv } from "@/modules/domains/config";
import { Badge } from "@/ui";
import { BRAND_CLASS } from "@/ui/brand-font";

export const metadata: Metadata = { title: `${PRICING_COPY.title} | ${PRODUCT.name}`, description: PRICING_COPY.lead };

const SIGN_UP_PATH = "/cadastro";

/**
 * Public pricing page. One source for everything it shows: the amounts come from the price
 * catalogue and what each plan includes from its entitlements, the same functions the plan screen
 * inside the account uses. Amounts appear only where a visitor can actually buy (live billing);
 * elsewhere the paid plans are listed as coming, without prices, like on the home (AGENTS.md §10).
 * Static: the billing mode is read at build time, so changing it needs a redeploy.
 */
export default function PricingPage() {
  const copy = PRICING_COPY;
  const selling = paidPlansAreOnSale(resolveBillingMode().mode);
  const customDomains = domainsSignerFromEnv() !== null;
  return (
    <main className={`${BRAND_CLASS} py-8 sm:py-16`}>
      <div className="app-shell grid gap-8">
        <header className="grid max-w-3xl gap-3">
          <h1 className="text-3xl font-bold sm:text-4xl">{copy.title}</h1>
          <p className="m-0 leading-7 text-app-muted">{selling ? copy.lead : copy.leadNotSelling}</p>
        </header>

        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
          {PLAN_IDS.map((planId) => {
            const name = BILLING_COPY.planNames[planId];
            const paid = isPaidPlan(planId);
            const monthly = planPrice(planId, "month");
            const yearly = planPrice(planId, "year");
            return (
              <li key={planId} className="surface-card grid content-start gap-4 p-5 sm:p-6">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">{name}</h2>
                    <Badge tone={!paid || selling ? "success" : "neutral"}>{!paid || selling ? copy.available : copy.soon}</Badge>
                  </div>
                  <p className="m-0 text-sm text-app-muted">{BILLING_COPY.planDescriptions[planId]}</p>
                </div>
                {!paid ? (
                  <div className="grid gap-1">
                    <p className="m-0"><b className="text-2xl">{copy.free}</b></p>
                    <p className="m-0 text-sm text-app-muted">{copy.freeNote}</p>
                  </div>
                ) : selling && monthly && yearly ? (
                  <div className="grid gap-1">
                    <p className="m-0"><b className="text-2xl">{formatMoney(monthly.amountCents)}</b> <span className="text-app-muted">{copy.perMonth}</span></p>
                    <p className="m-0 text-sm text-app-muted">{copy.orPerYear(formatMoney(yearly.amountCents), formatMoney(yearlySavingCents(planId)))}</p>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <h3 className="text-sm font-bold">{copy.includes(name)}</h3>
                  <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
                    {planFeatureLines(planId, { customDomains }).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                {!paid ? <Link className="ui-button ui-button-primary" href={SIGN_UP_PATH}>{copy.cta.free}</Link> : selling ? <Link className="ui-button ui-button-secondary" href={SIGN_UP_PATH}>{copy.cta.paid}</Link> : null}
              </li>
            );
          })}
        </ul>
        {selling ? <p className="m-0 text-sm text-app-muted">{copy.ctaNote}</p> : null}

        <section className="surface-card grid max-w-3xl gap-3 p-5 sm:p-8" aria-labelledby="cobranca-titulo">
          <h2 id="cobranca-titulo" className="text-xl font-bold">{copy.notes.title}</h2>
          <ul className="m-0 grid list-disc gap-2 pl-5 leading-7">
            {(selling ? copy.notes.selling : copy.notes.notSelling).map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>

        <p className="m-0 flex flex-wrap gap-3">
          <Link className="ui-button ui-button-secondary" href="/ajuda">{copy.helpLink}</Link>
          <Link className="ui-button ui-button-secondary" href="/">{copy.back}</Link>
        </p>
      </div>
    </main>
  );
}
