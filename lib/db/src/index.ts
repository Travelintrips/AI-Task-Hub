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

const intEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const pool = new Pool({
  connectionString,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  application_name: process.env.DB_APPLICATION_NAME?.trim() || "ai-task-hub",
  connectionTimeoutMillis: intEnv("DB_CONNECTION_TIMEOUT_MS", 10_000),
  idleTimeoutMillis: intEnv("DB_IDLE_TIMEOUT_MS", 30_000),
  max: intEnv("DB_POOL_MAX", 10),
});

export const db = drizzle(pool, { schema });

export * from "./schema";
