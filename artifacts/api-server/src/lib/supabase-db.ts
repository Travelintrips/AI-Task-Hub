import pg from "pg";
import { logger } from "./logger";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  logger.info(
    "SUPABASE_DATABASE_URL is not set — Supabase-backed fallback routes disabled",
  );
}

export const supabasePool = connectionString
  ? new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      ssl: { rejectUnauthorized: false },
    })
  : null;

if (supabasePool) {
  supabasePool.on("error", (err) => {
    logger.error({ err }, "Supabase pool error");
  });
}

export async function supabaseQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    logger.warn("supabaseQuery called but SUPABASE_DATABASE_URL is not set");
    return [];
  }
  const res = await supabasePool.query<T>(text, params as never);
  return res.rows;
}
