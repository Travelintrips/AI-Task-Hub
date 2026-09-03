import pg from "pg";
import { logger } from "./logger";

// Development must use CST-DEV even when production variables are also
// present in the workspace environment. Production keeps the production
// Supabase database as its first choice.
const connectionString =
  process.env.NODE_ENV === "production"
    ? process.env.SUPABASE_DATABASE_URL ??
      process.env.SUPABASE_DATABASE_URL_DEV ??
      process.env.DATABASE_URL
    : process.env.SUPABASE_DATABASE_URL_DEV ??
      process.env.SUPABASE_DATABASE_URL ??
      process.env.DATABASE_URL;

if (!connectionString) {
  logger.warn(
    "DATABASE_URL is not set — database queries will return empty arrays.",
  );
} else if (!process.env.SUPABASE_DATABASE_URL && !process.env.SUPABASE_DATABASE_URL_DEV) {
  logger.info("Using Replit DATABASE_URL as fallback for supabaseQuery pool.");
}

export const supabasePool = connectionString
  ? new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : null;

if (supabasePool) {
  supabasePool.on("error", (err) => {
    logger.error({ err }, "DB pool error");
  });

  supabasePool.connect()
    .then((client) => {
      client.release();
      logger.info("Supabase DB pool connected successfully");
    })
    .catch((err) => {
      logger.error({ err }, "DB pool failed to connect");
    });
}

export async function supabaseQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    logger.warn({ query: text.slice(0, 80) }, "supabaseQuery skipped — database not configured");
    return [];
  }
  try {
    const res = await supabasePool.query(text, params as never);
    return res.rows as T[];
  } catch (err) {
    logger.error({ err, query: text.slice(0, 80) }, "supabaseQuery failed");
    return [];
  }
}

/**
 * Like supabaseQuery but THROWS on error instead of swallowing it.
 * Use this when the caller needs to know about failures (e.g. bridge inserts).
 */
export async function supabaseQueryStrict<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    throw new Error("supabaseQueryStrict: database not configured");
  }
  const res = await supabasePool.query(text, params as never);
  return res.rows as T[];
}
