import Link from "next/link";
import { HOME_COPY } from "@/content/pt-BR";
import { PRODUCT, type PlanId } from "@/lib/product";
import { BILLING_INTERVALS, PLAN_IDS, formatMoney, isPaidPlan, planPrice, yearlySavingCents, type BillingInterval } from "@/modules/billing/catalog";
import { planComparison, planHighlights, type ComparisonRowKey, type ComparisonValue, type PlanHighlight } from "@/modules/billing/comparison";
import { yearlyFreeMonths } from "@/modules/billing/marketing";

const SIGN_UP_PATH = "/cadastro";

interface PricingProps {
  /** Paid plans can be bought (live billing): prices, the interval choice and their buttons appear. */
  selling: boolean;
  /** Custom domains are configured, so the plans that include them may say so (ADR 0016). */
  customDomains: boolean;
}

function highlightText(item: PlanHighlight): string {
  const { items } = HOME_COPY.plans;
  switch (item.kind) {
    case "everythingIn":
      return items.everythingIn(HOME_COPY.plans[item.planId].name);
    case "product":
      return items[item.key];
    case "limit":
      return items[item.key](item.value);
    case "feature":
      return item.key === "remove_badge" ? items.remove_badge(PRODUCT.name) : items[item.key];
  }
}

/** One amount per interval; with a choice, the one not chosen is hidden by home.css. */
function PlanPrices({ planId, choice }: { planId: PlanId; choice: boolean }) {
  const copy = HOME_COPY.plans;
  const intervals: readonly BillingInterval[] = choice ? BILLING_INTERVALS : ["month"];
  return intervals.map((interval) => {
    const price = isPaidPlan(planId) ? planPrice(planId, interval) : null;
    if (isPaidPlan(planId) && !price) return null;
    return (
      <p key={interval} className="home-plan-price" data-interval={choice ? interval : undefined}>
        {/* The spaces keep the words apart for screen readers; the flex layout does not render them. */}
        <b className="home-display">{price ? formatMoney(price.amountCents) : copy.free.price}</b>{" "}
        <span aria-hidden="true">{copy.perShort[interval]}</span>
        <span className="sr-only">{copy.per[interval]}</span>
      </p>
    );
  });
}

function PlanCard({ planId, selling, customDomains }: { planId: PlanId } & PricingProps) {
  const copy = HOME_COPY.plans;
  const paid = isPaidPlan(planId);
  const featured = planId === PLAN_IDS[0];
  return (
    <li className="home-plan" data-featured={featured ? "" : undefined}>
      <h3 className="home-display">{copy[planId].name}</h3>
      {featured ? <p className="home-plan-badge">{selling ? copy.startHere : copy.available}</p> : null}
      {!paid || selling ? <PlanPrices planId={planId} choice={selling} /> : <p className="home-plan-price" data-soon=""><b className="home-display">{copy.soon}</b></p>}
      {/* Always present, empty when there is nothing to say: the cards share their rows (home.css). */}
      <p className="home-plan-saving">{paid && selling ? copy.saving(formatMoney(yearlySavingCents(planId))) : null}</p>
      <p className="home-plan-description">{copy[planId].description}</p>
      <ul className="home-plan-items">
        {planHighlights(planId, { customDomains }).map((item) => <li key={item.kind === "everythingIn" ? item.kind : item.key}>{highlightText(item)}</li>)}
      </ul>
      <Link className="home-cta home-cta-block" href={SIGN_UP_PATH}>{!paid ? copy.free.cta : selling ? copy.paidCta : copy.paidCtaNotSelling}</Link>
    </li>
  );
}

const ArrowDown = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></svg>
);
const Check = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m3 8.5 3.2 3L13 4.5" /></svg>
);
const Dash = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 8h8" /></svg>
);

/** Plans and prices. Server-rendered; the monthly/yearly choice works without JavaScript (home.css). */
export function Pricing({ selling, customDomains }: PricingProps) {
  const copy = HOME_COPY.plans;
  const freeMonths = yearlyFreeMonths();
  return (
    <section className="home-pricing" id="planos" aria-labelledby="planos-titulo">
      <div className="home-shell">
        <div className="home-heading">
          <a className="home-pill-link" href="#comparar">{copy.compareLink}{ArrowDown}</a>
          <h2 className="home-display" id="planos-titulo">{copy.title}</h2>
          <p>{selling ? copy.leadSelling : copy.lead}</p>
        </div>
        {selling ? (
          <fieldset className="home-interval">
            <legend className="sr-only">{copy.intervalLegend}</legend>
            {BILLING_INTERVALS.map((interval) => (
              <label key={interval}>
                <input type="radio" name="home-interval" value={interval} defaultChecked={interval === "month"} />
                <span>{copy.intervals[interval]}{interval === "year" && freeMonths ? <>{" "}<b className="home-interval-badge">{copy.freeMonths(freeMonths)}</b></> : null}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <ul className="home-plans">
          {PLAN_IDS.map((planId) => <PlanCard key={planId} planId={planId} selling={selling} customDomains={customDomains} />)}
        </ul>
      </div>
    </section>
  );
}

function rowLabel(row: ComparisonRowKey): string {
  const label = HOME_COPY.comparison.rows[row];
  return typeof label === "function" ? label(PRODUCT.name) : label;
}

function ComparisonCell({ row, value }: { row: ComparisonRowKey; value: ComparisonValue }) {
  const copy = HOME_COPY.comparison;
  if (value.kind === "limit") {
    const format = row in copy.limits ? copy.limits[row as keyof typeof copy.limits] : String;
    return <span className="home-compare-limit">{format(value.value)}</span>;
  }
  // On narrow screens only the icon shows; the word stays for screen readers.
  return value.kind === "included"
    ? <span className="home-compare-mark" data-included="">{Check}<span className="home-compare-word">{copy.included}</span></span>
    : <span className="home-compare-mark">{Dash}<span className="home-compare-word">{copy.excluded}</span></span>;
}

/** Every plan side by side, generated from the entitlements (modules/billing/comparison.ts). */
export function PlanComparison({ customDomains }: Pick<PricingProps, "customDomains">) {
  const copy = HOME_COPY.comparison;
  return (
    <section className="home-section home-shell home-compare-section" id="comparar" aria-labelledby="comparar-titulo">
      <div className="home-heading">
        <h2 className="home-display" id="comparar-titulo">{copy.title}</h2>
      </div>
      <div className="home-compare">
        <table aria-labelledby="comparar-titulo">
          <colgroup>
            <col />
            <col className="home-compare-plan" span={PLAN_IDS.length} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{copy.feature}</th>
              {PLAN_IDS.map((planId) => <th key={planId} scope="col">{HOME_COPY.plans[planId].name}</th>)}
            </tr>
          </thead>
          {planComparison({ customDomains }).map((group) => (
            <tbody key={group.key} data-group={group.key}>
              <tr className="home-compare-group">
                <th scope="rowgroup" colSpan={PLAN_IDS.length + 1}>{copy.groups[group.key]}</th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{rowLabel(row.key)}</th>
                  {PLAN_IDS.map((planId) => <td key={planId}><ComparisonCell row={row.key} value={row.values[planId]} /></td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
