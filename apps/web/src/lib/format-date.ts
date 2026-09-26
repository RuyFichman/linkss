// Timestamps are stored in UTC and converted only for display (AGENTS.md §9). Brazil-first product:
// São Paulo time until accounts carry their own time zone.
const DISPLAY_TIME_ZONE = "America/Sao_Paulo";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE });

/** "26/09/2026, 14:05" (São Paulo time) or an empty string for invalid input. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DATE_TIME.format(date);
}
