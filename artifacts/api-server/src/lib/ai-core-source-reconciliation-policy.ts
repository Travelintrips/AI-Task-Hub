/** Explicitly opt in to source reconciliation only on the isolated DEV database. */
export function devSourceReconciliationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.AI_TASK_DEV_EXPECTED_PROJECT_ID?.trim();
  return env.AI_TASK_DEV_SOURCE_RECONCILE_ENABLED === "true" &&
    env.NODE_ENV === "development" &&
    env.RUN_STARTUP_MIGRATIONS === "false" &&
    Boolean(expected && /^[a-z0-9]{12,32}$/.test(expected)) &&
    Boolean(expected && env.SUPABASE_DATABASE_URL_DEV?.includes(expected)) &&
    !env.SUPABASE_PROD_DATABASE_URL && !env.SUPABASE_DATABASE_URL;
}
