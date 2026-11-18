import pg from "pg";
import { logger } from "./logger";
import { assertProductionConnectionAllowed } from "@workspace/db/production-connection-policy";
import { installDevDbAuthCircuit, sharedDevDbAuthScope } from "@workspace/db/dev-auth-circuit";
import { resolveAiTaskDbSsl } from "@workspace/db/dev-verified-tls";

const isProduction = process.env.NODE_ENV === "production";
const databaseEnvName = isProduction
  ? "SUPABASE_DATABASE_URL"
  : "SUPABASE_DATABASE_URL_DEV";
const connectionString = process.env[databaseEnvName]?.trim();

assertProductionConnectionAllowed(connectionString);

if (!connectionString) {
  logger.warn(
    { databaseEnvName },
    "Supabase database URL is not configured — raw database queries will be unavailable.",
  );
}

export const supabasePool = connectionString
  ? new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: resolveAiTaskDbSsl(connectionString, process.env),
    })
  : null;

if (supabasePool) {
  // Reuse the main Drizzle Pool's DEV-only shared authentication scope.
  // Both Pool objects draw their DSN from the same environment variable.
  // Their cold-start attempts must not multiply the shared Supavisor 28P01.
  const devAuthCircuit = installDevDbAuthCircuit(supabasePool, !isProduction, sharedDevDbAuthScope);
  supabasePool.on("error", (err) => {
    devAuthCircuit.noteFailure(err);
    if (isProduction) logger.error({ err }, "DB pool error");
    else logger.error({
      code: devAuthCircuit.isBlocked() ? "AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN" : "DEV_DB_IDLE_ERROR",
    }, "DEV raw database pool error");
  });

  supabasePool.connect()
    .then((client) => {
      client.release();
      logger.info(
        { environment: isProduction ? "production" : "development" },
        "Supabase DB pool connected successfully",
      );
    })
    .catch((err) => {
      if (isProduction) logger.error({ err }, "DB pool failed to connect");
      else logger.warn({
        code: devAuthCircuit.isBlocked() ? "AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN" : "DEV_DB_CONNECTION_FAILED",
      }, "DEV raw database pool connection unavailable");
    });
}

export async function supabaseQuery<T = Record<string, unknown>>(
  queryText: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    logger.warn({ query: queryText.slice(0, 80) }, "supabaseQuery skipped — database not configured");
    return [];
  }
  try {
    const res = await supabasePool.query(queryText, params as never);
    return res.rows as T[];
  } catch (err) {
    logger.error({ err, query: queryText.slice(0, 80) }, "supabaseQuery failed");
    return [];
  }
}

export async function supabaseQueryStrict<T = Record<string, unknown>>(
  queryText: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    throw new Error("supabaseQueryStrict: database not configured");
  }
  const res = await supabasePool.query(queryText, params as never);
  return res.rows as T[];
}
