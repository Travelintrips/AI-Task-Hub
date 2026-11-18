import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { assertProductionConnectionAllowed } from "./production-connection-policy";
import { installDevDbAuthCircuit } from "./dev-auth-circuit";

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

assertProductionConnectionAllowed(connectionString);

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

// Under the existing DEV configuration, one bad password can trip a shared
// Supavisor auth circuit breaker. One terminal auth failure locks future
// connect/query attempts locally until the operator fixes the credential
// and starts the DEV process intentionally. Production remains unchanged.
const devAuthCircuit = installDevDbAuthCircuit(pool, !isProduction);

// pg emits errors from idle clients on the pool. Without a listener, Node.js
// treats these as uncaught EventEmitter errors and terminates the API process.
// pg removes the failed client; subsequent requests can acquire a fresh one.
pool.on("error", (error) => {
  // Avoid logging connection strings, SQL parameters, or client objects.
  devAuthCircuit.noteFailure(error);
  if (isProduction) {
    console.error("PostgreSQL idle pool client error", {
      code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
      message: error.message,
    });
    return;
  }
  // DEV authentication diagnostics never contain usernames, DSNs or secrets.
  console.error("DEV PostgreSQL idle client error", {
    code: devAuthCircuit.isBlocked() ? "AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN" : "DEV_DB_IDLE_ERROR",
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
