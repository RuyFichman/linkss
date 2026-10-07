/**
 * True when PostgREST or Postgres says a function, table or column does not exist. `main` deploys
 * before migrations are applied, so new screens treat this as "not available yet", never as a crash.
 */
export function isMissingSchemaError(error: { code?: string | null }): boolean {
  return error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42883" || error.code === "42P01" || error.code === "42703";
}
