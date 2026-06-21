import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Priority:
//   1. SUPABASE_DATABASE_URL  — production Supabase (primary)
//   2. SUPABASE_DATABASE_URL_DEV — development Supabase
//   3. DATABASE_URL — local fallback only (set ALLOW_LOCAL_DB=true to enable)
const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  (process.env.ALLOW_LOCAL_DB === "true" ? process.env.DATABASE_URL : undefined);

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL must be set. " +
    "Set ALLOW_LOCAL_DB=true to fall back to DATABASE_URL for local dev."
  );
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("supabase.com")
    ? { rejectUnauthorized: false }
    : false,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
