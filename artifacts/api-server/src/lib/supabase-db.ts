import pg from "pg";
import { logger } from "./logger";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  logger.warn(
    "SUPABASE_DATABASE_URL is not set — routes yang membaca data dari Supabase Postgres " +
    "(messages, team sinkron, documents legacy) akan mengembalikan array kosong. " +
    "Set secret SUPABASE_DATABASE_URL dengan connection string dari Supabase Dashboard → Settings → Database.",
  );
}

// Buat pool hanya jika connection string tersedia
// Jika tidak ada, pool akan null dan supabaseQuery akan return [] dengan aman
export const supabasePool = connectionString
  ? new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    })
  : null;

if (supabasePool) {
  supabasePool.on("error", (err) => {
    logger.error({ err }, "Supabase DB pool error");
  });

  // Test koneksi saat startup
  supabasePool.connect()
    .then((client) => {
      client.release();
      logger.info("Supabase DB pool connected successfully");
    })
    .catch((err) => {
      logger.error({ err }, "Supabase DB pool failed to connect — cek SUPABASE_DATABASE_URL");
    });
}

export async function supabaseQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    logger.warn({ query: text.slice(0, 80) }, "supabaseQuery skipped — SUPABASE_DATABASE_URL tidak dikonfigurasi");
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
