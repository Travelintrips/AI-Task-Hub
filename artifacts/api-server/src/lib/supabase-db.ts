import pg from "pg";
import { logger } from "./logger";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  logger.warn(
    "SUPABASE_DATABASE_URL is not set — Supabase-backed routes will fail",
  );
}

export const supabasePool = new pg.Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: false },
});

supabasePool.on("error", (err) => {
  logger.error({ err }, "Supabase pool error");
});
if (supabasePool) {
  supabasePool.on("error", (err) => {
    logger.error({ err }, "Supabase pool error");
  });
}

export async function supabaseQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await supabasePool.query<T>(text, params as never);
  return res.rows;
}
