import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : false,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
