import { pool } from "@workspace/db";
import { logger } from "./logger";

// Use the same PostgreSQL pool as Drizzle. A second independent pool
// exhausted transient Supabase pooler capacity and amplified connection timeouts.
// The shared pool owns startup, configuration, and its error listener.
export const supabasePool = pool;

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
