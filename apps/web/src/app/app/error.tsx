"use client";

import { APP_COPY, COPY } from "@/content/pt-BR";
import { Button, EmptyState } from "@/ui";

/** Unexpected failures inside the authenticated area; details stay in server logs. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <EmptyState title={COPY.genericError} description={APP_COPY.errors.unavailable} action={<Button onClick={reset}>{APP_COPY.workspace.retry}</Button>} />;
}
