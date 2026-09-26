import { APP_COPY } from "@/content/pt-BR";
import { slugMessage } from "./slug";

export type ProfileErrorKind = "slug_invalid" | "slug_reserved" | "slug_held" | "slug_taken" | "limit_reached" | "conflict" | "content_invalid" | "forbidden" | "not_found" | "unavailable";

export interface DatabaseErrorLike {
  code?: string | null;
}

/** Maps the SQLSTATE contract of ADR 0004 to domain errors. */
export function profileErrorFromDatabase(error: DatabaseErrorLike): ProfileErrorKind {
  switch (error.code) {
    case "LK001": return "slug_invalid";
    case "LK002": return "slug_reserved";
    case "LK003": return "slug_held";
    case "23505": return "slug_taken";
    case "LK010": return "limit_reached";
    case "LK040": return "content_invalid";
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

export function isSlugError(kind: ProfileErrorKind): kind is "slug_invalid" | "slug_reserved" | "slug_held" | "slug_taken" {
  return kind.startsWith("slug_");
}

export function profileErrorMessage(kind: ProfileErrorKind, context: { slug?: string; limit?: number } = {}): string {
  const slug = context.slug ?? "";
  switch (kind) {
    case "slug_invalid": return slugMessage("invalid", slug);
    case "slug_reserved": return slugMessage("reserved", slug);
    case "slug_held": return slugMessage("held", slug);
    case "slug_taken": return slugMessage("taken", slug);
    case "limit_reached": return APP_COPY.pages.limitReached(context.limit ?? 1);
    case "conflict": return APP_COPY.draft.conflict;
    case "content_invalid": return APP_COPY.draft.invalid;
    case "forbidden": return APP_COPY.errors.forbidden;
    case "not_found": return APP_COPY.errors.notFound;
    case "unavailable": return APP_COPY.errors.unavailable;
  }
}
