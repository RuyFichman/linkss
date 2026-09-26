import type { Instrumentation } from "next";
import { logEvent } from "@/lib/observability/logger";

/**
 * Structured log for every server error Next.js captures (render, route handler, Server Action,
 * proxy). Logs the route template, never the concrete path or headers: paths can carry tokens
 * (e.g. /auth/confirm?token_hash=…) and headers carry cookies. Sentry replaces this sink before the
 * external pilot (docs/OBSERVABILITY.md).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  logEvent("error", "request.error", {
    routePath: context.routePath,
    routeType: context.routeType,
    method: request.method,
    revalidateReason: context.revalidateReason,
    errorName: error instanceof Error ? error.name : "unknown",
    digest,
  });
};
