import { COPY } from "@/content/pt-BR";
import { Skeleton } from "@/ui";

export default function PlanLoading() {
  return (
    <div className="grid gap-6" role="status" aria-live="polite">
      <span className="sr-only">{COPY.loading}</span>
      <Skeleton height={36} width="16rem" />
      <Skeleton height={140} />
      <Skeleton height={320} />
    </div>
  );
}
