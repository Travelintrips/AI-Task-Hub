import pg from "pg";
import { logger } from "./logger";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.SUPABASE_DATABASE_URL_DEV ??
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
      ssl: connectionString.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : false,
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
