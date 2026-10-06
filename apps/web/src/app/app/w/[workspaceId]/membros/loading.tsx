import { COPY } from "@/content/pt-BR";
import { Skeleton } from "@/ui";

export default function MembersLoading() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" role="status" aria-live="polite">
      <span className="sr-only">{COPY.loading}</span>
      <Skeleton height={36} width="40%" />
      <Skeleton height={220} />
      <Skeleton height={160} />
    </div>
  );
}
