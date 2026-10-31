import Link from "next/link";
import { marketingCopy, type MarketingCopy } from "@/content/marketing";
import { DEFAULT_LOCALE, SIGN_UP_PATH, type Locale } from "@/lib/locale";
import type { PlanId } from "@/lib/product";
import { BILLING_INTERVALS, PLAN_IDS, isPaidPlan } from "@/modules/billing/catalog";
import { planHighlights } from "@/modules/billing/comparison";
import { PlanComparisonTable } from "@/modules/billing/components/plan-comparison";
import { planHighlightText } from "@/modules/billing/presentation";
import { priceListFor, type PriceList } from "@/modules/billing/price-list";

interface PricingProps {
  /** Custom domains are configured, so the plans that include them may say so (ADR 0016). */
  customDomains: boolean;
  /** The language of the home; Spanish also shows the prices of its market (ADR 0022). */
  locale?: Locale;
}

/** One amount per interval; the one not chosen is hidden by globals.css. */
function PlanPrices({ planId, prices, words }: { planId: PlanId; prices: PriceList; words: MarketingCopy["billing"] }) {
  return BILLING_INTERVALS.map((interval) => {
    const amount = isPaidPlan(planId) ? prices.amountCents(planId, interval) : null;
    if (isPaidPlan(planId) && amount === null) return null;
    return (
      <p key={interval} className="plan-offer-price" data-interval={interval}>
        {/* The spaces keep the words apart for screen readers; the flex layout does not render them. */}
        <b className="home-display">{amount !== null ? prices.format(amount) : prices.free}</b>{" "}
        <span aria-hidden="true">{words.perShort[interval]}</span>
        <span className="sr-only">{words.perInterval[interval]}</span>
      </p>
    );
  });
}

function PlanCard({ planId, customDomains, locale }: { planId: PlanId; customDomains: boolean; locale: Locale }) {
  const { home, billing } = marketingCopy(locale);
  const prices = priceListFor(locale);
  const paid = isPaidPlan(planId);
  const featured = planId === PLAN_IDS[0];
  return (
    <li className="plan-offer" data-featured={featured ? "" : undefined}>
      <h3 className="home-display">{billing.planNames[planId]}</h3>
      {featured ? <p className="plan-offer-badge">{home.plans.startHere}</p> : null}
      <PlanPrices planId={planId} prices={prices} words={billing} />
      {/* Always present, empty when there is nothing to say: the cards share their rows (globals.css). */}
      <p className="plan-offer-saving">{paid ? billing.yearlySaving(prices.format(prices.savingCents(planId))) : null}</p>
      <p className="plan-offer-description">{billing.planDescriptions[planId]}</p>
      <ul className="plan-offer-items">
        {planHighlights(planId, { customDomains }).map((item) => <li key={item.kind === "everythingIn" ? item.kind : item.key}>{planHighlightText(item, billing)}</li>)}
      </ul>
      <div className="plan-offer-action">
        <Link className="home-cta home-cta-block" href={SIGN_UP_PATH[locale]}>{paid ? home.plans.paidCta : home.plans.freeCta}</Link>
      </div>
    </li>
  );
}

const ArrowDown = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></svg>
);

/** Plans and prices. Server-rendered; the monthly/yearly choice works without JavaScript (globals.css). */
export function Pricing({ customDomains, locale = DEFAULT_LOCALE }: PricingProps) {
  const { home, billing } = marketingCopy(locale);
  const freeMonths = priceListFor(locale).freeMonths();
  return (
    <section className="home-pricing" id="planos" aria-labelledby="planos-titulo" data-interval-scope="">
      <div className="home-shell">
        <div className="home-heading">
          <a className="home-pill-link" href="#comparar">{billing.plans.compare}{ArrowDown}</a>
          <h2 className="home-display" id="planos-titulo">{home.plans.title}</h2>
          <p>{home.plans.lead}</p>
        </div>
        <fieldset className="plan-interval">
          <legend className="sr-only">{billing.plans.intervalLegend}</legend>
          {BILLING_INTERVALS.map((interval) => (
            <label key={interval}>
              <input type="radio" name="home-interval" value={interval} defaultChecked={interval === "month"} />
              <span>{billing.intervals[interval]}{interval === "year" && freeMonths ? <>{" "}<b className="plan-interval-badge">{billing.freeMonths(freeMonths)}</b></> : null}</span>
            </label>
          ))}
        </fieldset>
        <ul className="plan-offers">
          {PLAN_IDS.map((planId) => <PlanCard key={planId} planId={planId} customDomains={customDomains} locale={locale} />)}
        </ul>
      </div>
    </section>
  );
}

/** Every plan side by side (the same table as the plan screen). */
export function PlanComparison({ customDomains, locale = DEFAULT_LOCALE }: PricingProps) {
  const { billing } = marketingCopy(locale);
  return (
    <section className="home-section home-shell home-compare-section" id="comparar" aria-labelledby="comparar-titulo">
      <div className="home-heading">
        <h2 className="home-display" id="comparar-titulo">{billing.comparison.title}</h2>
      </div>
      <PlanComparisonTable customDomains={customDomains} labelledBy="comparar-titulo" rows="all" words={billing} />
    </section>
  );
}
