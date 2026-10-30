import { BILLING_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { PLAN_IDS } from "../catalog";
import { planComparison, planDifferences, type ComparisonRow, type ComparisonRowKey, type ComparisonValue } from "../comparison";

const copy = BILLING_COPY.comparison;

const Check = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m3 8.5 3.2 3L13 4.5" /></svg>
);
const Dash = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 8h8" /></svg>
);

function rowLabel(row: ComparisonRowKey): string {
  const label = copy.rows[row];
  return typeof label === "function" ? label(PRODUCT.name) : label;
}

function Cell({ row, value }: { row: ComparisonRowKey; value: ComparisonValue }) {
  if (value.kind === "limit") {
    const format = row in copy.limits ? copy.limits[row as keyof typeof copy.limits] : String;
    return <span className="plan-compare-limit">{format(value.value)}</span>;
  }
  // On narrow screens only the icon shows; the word stays for screen readers (globals.css).
  return value.kind === "included"
    ? <span className="plan-compare-mark" data-included="">{Check}<span className="plan-compare-word">{copy.included}</span></span>
    : <span className="plan-compare-mark">{Dash}<span className="plan-compare-word">{copy.excluded}</span></span>;
}

function Row({ row }: { row: ComparisonRow }) {
  return (
    <tr>
      <th scope="row">{rowLabel(row.key)}</th>
      {PLAN_IDS.map((planId) => <td key={planId}><Cell row={row.key} value={row.values[planId]} /></td>)}
    </tr>
  );
}

/**
 * Every plan side by side, generated from the entitlements (modules/billing/comparison.ts), the caller
 * naming it through `labelledBy`. The home shows every row, by group (`rows: "all"`); the plan screen
 * shows only what changes between plans and says how many rows every plan shares (`"differences"`).
 */
export function PlanComparisonTable({ customDomains, labelledBy, rows }: { customDomains: boolean; labelledBy: string; rows: "all" | "differences" }) {
  const differences = rows === "differences" ? planDifferences({ customDomains }) : null;
  return (
    <div className="plan-compare">
      <table aria-labelledby={labelledBy}>
        <colgroup>
          <col />
          {PLAN_IDS.map((planId) => <col key={planId} className="plan-compare-plan" />)}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{copy.feature}</th>
            {PLAN_IDS.map((planId) => <th key={planId} scope="col">{BILLING_COPY.planNames[planId]}</th>)}
          </tr>
        </thead>
        {differences ? (
          <tbody>{differences.rows.map((row) => <Row key={row.key} row={row} />)}</tbody>
        ) : planComparison({ customDomains }).map((group) => (
          <tbody key={group.key} data-group={group.key}>
            <tr className="plan-compare-group">
              <th scope="rowgroup" colSpan={PLAN_IDS.length + 1}>{copy.groups[group.key]}</th>
            </tr>
            {group.rows.map((row) => <Row key={row.key} row={row} />)}
          </tbody>
        ))}
      </table>
      {differences && differences.shared > 0 ? <p className="plan-compare-note">{copy.shared(differences.shared)}</p> : null}
    </div>
  );
}
