import pg from "pg";
import { logger } from "./logger";

const isProduction = process.env.NODE_ENV === "production";
const databaseEnvName = isProduction
  ? "SUPABASE_DATABASE_URL"
  : "SUPABASE_DATABASE_URL_DEV";
const connectionString = process.env[databaseEnvName]?.trim();

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
      ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    })
  : null;

if (supabasePool) {
  supabasePool.on("error", (err) => {
    logger.error({ err }, "DB pool error");
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
      logger.error({ err }, "DB pool failed to connect");
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
