import Link from "next/link";
import { BILLING_COPY, HOME_COPY } from "@/content/pt-BR";
import type { PlanId } from "@/lib/product";
import { BILLING_INTERVALS, PLAN_IDS, formatMoney, isPaidPlan, planPrice, yearlySavingCents } from "@/modules/billing/catalog";
import { planHighlights } from "@/modules/billing/comparison";
import { PlanComparisonTable } from "@/modules/billing/components/plan-comparison";
import { yearlyFreeMonths } from "@/modules/billing/marketing";
import { planHighlightText } from "@/modules/billing/presentation";

const SIGN_UP_PATH = "/cadastro";

interface PricingProps {
  /** Custom domains are configured, so the plans that include them may say so (ADR 0016). */
  customDomains: boolean;
}

/** One amount per interval; the one not chosen is hidden by globals.css. */
function PlanPrices({ planId }: { planId: PlanId }) {
  return BILLING_INTERVALS.map((interval) => {
    const price = isPaidPlan(planId) ? planPrice(planId, interval) : null;
    if (isPaidPlan(planId) && !price) return null;
    return (
      <p key={interval} className="plan-offer-price" data-interval={interval}>
        {/* The spaces keep the words apart for screen readers; the flex layout does not render them. */}
        <b className="home-display">{price ? formatMoney(price.amountCents) : BILLING_COPY.freePrice}</b>{" "}
        <span aria-hidden="true">{BILLING_COPY.perShort[interval]}</span>
        <span className="sr-only">{BILLING_COPY.perInterval[interval]}</span>
      </p>
    );
  });
}

function PlanCard({ planId, customDomains }: { planId: PlanId } & PricingProps) {
  const copy = HOME_COPY.plans;
  const paid = isPaidPlan(planId);
  const featured = planId === PLAN_IDS[0];
  return (
    <li className="plan-offer" data-featured={featured ? "" : undefined}>
      <h3 className="home-display">{BILLING_COPY.planNames[planId]}</h3>
      {featured ? <p className="plan-offer-badge">{copy.startHere}</p> : null}
      <PlanPrices planId={planId} />
      {/* Always present, empty when there is nothing to say: the cards share their rows (globals.css). */}
      <p className="plan-offer-saving">{paid ? BILLING_COPY.yearlySaving(formatMoney(yearlySavingCents(planId))) : null}</p>
      <p className="plan-offer-description">{BILLING_COPY.planDescriptions[planId]}</p>
      <ul className="plan-offer-items">
        {planHighlights(planId, { customDomains }).map((item) => <li key={item.kind === "everythingIn" ? item.kind : item.key}>{planHighlightText(item)}</li>)}
      </ul>
      <div className="plan-offer-action">
        <Link className="home-cta home-cta-block" href={SIGN_UP_PATH}>{paid ? copy.paidCta : copy.freeCta}</Link>
      </div>
    </li>
  );
}

const ArrowDown = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></svg>
);

/** Plans and prices. Server-rendered; the monthly/yearly choice works without JavaScript (globals.css). */
export function Pricing({ customDomains }: PricingProps) {
  const copy = HOME_COPY.plans;
  const freeMonths = yearlyFreeMonths();
  return (
    <section className="home-pricing" id="planos" aria-labelledby="planos-titulo" data-interval-scope="">
      <div className="home-shell">
        <div className="home-heading">
          <a className="home-pill-link" href="#comparar">{BILLING_COPY.plans.compare}{ArrowDown}</a>
          <h2 className="home-display" id="planos-titulo">{copy.title}</h2>
          <p>{copy.lead}</p>
        </div>
        <fieldset className="plan-interval">
          <legend className="sr-only">{BILLING_COPY.plans.intervalLegend}</legend>
          {BILLING_INTERVALS.map((interval) => (
            <label key={interval}>
              <input type="radio" name="home-interval" value={interval} defaultChecked={interval === "month"} />
              <span>{BILLING_COPY.intervals[interval]}{interval === "year" && freeMonths ? <>{" "}<b className="plan-interval-badge">{BILLING_COPY.freeMonths(freeMonths)}</b></> : null}</span>
            </label>
          ))}
        </fieldset>
        <ul className="plan-offers">
          {PLAN_IDS.map((planId) => <PlanCard key={planId} planId={planId} customDomains={customDomains} />)}
        </ul>
      </div>
    </section>
  );
}

/** Every plan side by side (the same table as the plan screen). */
export function PlanComparison({ customDomains }: Pick<PricingProps, "customDomains">) {
  return (
    <section className="home-section home-shell home-compare-section" id="comparar" aria-labelledby="comparar-titulo">
      <div className="home-heading">
        <h2 className="home-display" id="comparar-titulo">{BILLING_COPY.comparison.title}</h2>
      </div>
      <PlanComparisonTable customDomains={customDomains} labelledBy="comparar-titulo" rows="all" />
    </section>
  );
}
