import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
const isProduction = process.env.NODE_ENV === "production";
const databaseEnvName = isProduction
  ? "SUPABASE_DATABASE_URL"
  : "SUPABASE_DATABASE_URL_DEV";
const connectionString = process.env[databaseEnvName]?.trim();

if (!connectionString) {
  throw new Error(
    `${databaseEnvName} must be set for ${isProduction ? "production" : "development"}.`,
  );
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export * from "./schema";
