import { COPY } from "@/content/pt-BR";
import { Skeleton } from "@/ui";

/**
 * The shape of the plan screen: title, the current plan with its usage, then the catalogue. It carries
 * `data-plan-screen` too, so the failing-payment banner does not show and then vanish (globals.css).
 */
export default function PlanLoading() {
  return (
    <div className="grid gap-6" role="status" aria-live="polite" data-plan-screen="">
      <span className="sr-only">{COPY.loading}</span>
      <div className="grid gap-2">
        <Skeleton height={36} width="16rem" />
        <Skeleton height={24} width="min(100%, 32rem)" />
      </div>
      <Skeleton height={232} />
      <div className="grid gap-6">
        <Skeleton height={28} width="8rem" />
        <div className="grid gap-8 min-[960px]:grid-cols-3 min-[960px]:gap-6">
          <Skeleton height={500} />
          <Skeleton height={500} />
          <Skeleton height={500} />
        </div>
      </div>
    </div>
  );
}
