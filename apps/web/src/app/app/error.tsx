"use client";

import { APP_COPY as APP_COPY_BY_LOCALE, COPY as COPY_BY_LOCALE } from "@/content/localized";
import { useCopy } from "@/ui/locale-context";
import { Button, EmptyState } from "@/ui";

/** Unexpected failures inside the authenticated area; details stay in server logs. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const APP_COPY = useCopy(APP_COPY_BY_LOCALE);
  const COPY = useCopy(COPY_BY_LOCALE);
  return <EmptyState title={COPY.genericError} description={APP_COPY.errors.unavailable} action={<Button onClick={reset}>{APP_COPY.workspace.retry}</Button>} />;
}
