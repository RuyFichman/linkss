import { getCopy } from "@/modules/identity/locale";
import { Skeleton } from "@/ui";

export default async function AppLoading() {
  const { COPY } = await getCopy();
  return (
    <div className="grid gap-4" role="status" aria-live="polite">
      <span className="sr-only">{COPY.loading}</span>
      <Skeleton height={36} width="40%" />
      <Skeleton height={88} />
      <Skeleton height={88} />
    </div>
  );
}
