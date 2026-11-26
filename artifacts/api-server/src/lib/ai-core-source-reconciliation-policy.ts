/** Explicitly opt in to source reconciliation only on the expected database. */
function validProjectId(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9]{12,32}$/.test(value));
}

function exactlyOneReconciliationMode(env: NodeJS.ProcessEnv): boolean {
  const dev = env.AI_TASK_DEV_SOURCE_RECONCILE_ENABLED === "true";
  const prod = env.AI_TASK_PROD_SOURCE_RECONCILE_ENABLED === "true";
  return dev !== prod;
}

export function devSourceReconciliationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.AI_TASK_DEV_EXPECTED_PROJECT_ID?.trim();
  return exactlyOneReconciliationMode(env) &&
    env.AI_TASK_DEV_SOURCE_RECONCILE_ENABLED === "true" &&
    env.NODE_ENV === "development" &&
    env.RUN_STARTUP_MIGRATIONS === "false" &&
    validProjectId(expected) &&
    Boolean(env.SUPABASE_DATABASE_URL_DEV?.includes(expected)) &&
    !env.SUPABASE_PROD_DATABASE_URL && !env.SUPABASE_DATABASE_URL;
}

/** Production requires an independent schema-ready interlock after migration. */
export function prodSourceReconciliationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.AI_TASK_PROD_EXPECTED_PROJECT_ID?.trim();
  return exactlyOneReconciliationMode(env) &&
    env.AI_TASK_PROD_SOURCE_RECONCILE_ENABLED === "true" &&
    env.AI_TASK_PROD_RECONCILE_SCHEMA_READY === "true" &&
    env.NODE_ENV === "production" &&
    env.RUN_STARTUP_MIGRATIONS === "false" &&
    validProjectId(expected) &&
    Boolean(env.SUPABASE_DATABASE_URL?.includes(expected)) &&
    !env.SUPABASE_DATABASE_URL_DEV &&
    !env.SUPABASE_DEV_DATABASE_URL &&
    !env.SUPABASE_PROD_DATABASE_URL;
}

export function sourceReconciliationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return devSourceReconciliationEnabled(env) || prodSourceReconciliationEnabled(env);
}
