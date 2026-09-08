import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Keep the ORM database aligned with the raw Supabase pool used by the API.
// Development and production are separate Supabase projects.
const connectionString =
  process.env.NODE_ENV === "production"
    ? process.env.SUPABASE_DATABASE_URL ||
      process.env.SUPABASE_DATABASE_URL_DEV ||
      process.env.DATABASE_URL
    : process.env.SUPABASE_DATABASE_URL_DEV ||
      process.env.SUPABASE_DATABASE_URL ||
      process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export * from "./schema";
