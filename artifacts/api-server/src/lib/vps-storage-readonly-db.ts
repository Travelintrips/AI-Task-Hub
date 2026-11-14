import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import pg from "pg";
import type { AuthUser } from "../middleware/auth";

const { Pool } = pg;
const EXPECTED_DEV_PROJECT = "xssrfshdrtdfupgqwfdw";
const EXPECTED_POOLER_HOST = "aws-1-ap-southeast-2.pooler.supabase.com";
const READER_ROLE = "ai_task_vps_identity_reader_dev";
const NULL_COMPANY_MARKER = "@NULL@";

export type ReaderConfig = {
  connectionString: string;
  caFile: string;
};

/** Never fall back to the shared application DB or the broad postgres role. */
export function getVpsIdentityReaderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReaderConfig | null {
  if (env.NODE_ENV !== "development" || env.APP_ENV !== "development" ||
      env.VPS_STORAGE_INVENTORY_READONLY_ENABLED !== "true" ||
      env.AI_TASK_DEV_EXPECTED_PROJECT_ID !== EXPECTED_DEV_PROJECT) return null;

  const raw = env.VPS_STORAGE_IDENTITY_READER_URL_DEV?.trim();
  const caFile = env.VPS_STORAGE_IDENTITY_READER_CA_FILE?.trim();
  if (!raw || !caFile || !isAbsolute(caFile)) return null;
  try {
    const url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== EXPECTED_POOLER_HOST || url.port !== "5432" ||
        url.username !== READER_ROLE + "." + EXPECTED_DEV_PROJECT ||
        url.password.length < 24 || url.pathname !== "/postgres" ||
        url.search !== "" || url.hash !== "") return null;
    return { connectionString: url.toString(), caFile };
  } catch {
    return null;
  }
}

export function normalizedVpsIdentityScope(
  user: AuthUser | undefined,
): { id: string; email: string; company: string } | null {
  if (!user) return null;
  // The CST-DEV users table stores TEXT IDs and INTEGER/NULL company IDs.
  const id = String(user.id ?? "").trim();
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const company = user.companyId == null ? NULL_COMPANY_MARKER
    : String(user.companyId).trim();
  if (id.length < 1 || id.length > 128 ||
      email.length < 3 || email.length > 320 || !email.includes("@") ||
      (company !== NULL_COMPANY_MARKER && !/^[0-9]+$/.test(company))) return null;
  return { id, email, company };
}

/**
 * Dedicated single-connection readback. NEVER uses @workspace/db's existing
 * DEV pool (which currently connects as postgres with BYPASSRLS).
 * Missing role/credential/CA -> unavailable, with no legacy fallback.
 */
export async function readActiveVpsSuperAdmin(
  user: AuthUser | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<"match" | "denied" | "unavailable"> {
  const cfg = getVpsIdentityReaderConfig(env);
  const scope = normalizedVpsIdentityScope(user);
  if (!cfg || !scope) return "unavailable";

  let ca: string;
  try {
    ca = readFileSync(cfg.caFile, "utf8");
    if (ca.length > 65536 || !ca.includes("BEGIN CERTIFICATE")) return "unavailable";
  } catch {
    return "unavailable";
  }

  const pool = new Pool({
    connectionString: cfg.connectionString,
    ssl: { ca, rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 1000,
    statement_timeout: 2000,
    query_timeout: 4000,
    application_name: "ai-task-vps-readonly-dev",
    allowExitOnIdle: true,
  });
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    await client.query(
      "SELECT set_config('ai_task_vps.identity_id', $1::text, true), " +
      "set_config('ai_task_vps.identity_email', $2::text, true), " +
      "set_config('ai_task_vps.identity_company', $3::text, true)",
      [scope.id, scope.email, scope.company],
    );
    const { rows } = await client.query<{
      id: string; email: string | null; company_id: string | null;
      role: string; is_active: boolean | null; status: string;
    }>(
      "SELECT id, email, company_id::text AS company_id, role, is_active, status " +
      "FROM public.users " +
      "WHERE id = $1::text AND lower(btrim(email)) = $2::text " +
      "AND COALESCE(company_id::text, '@NULL@') = $3::text " +
      "AND role = 'super_admin' AND is_active IS TRUE AND status = 'active' " +
      "LIMIT 1",
      [scope.id, scope.email, scope.company],
    );
    return rows.length === 1 ? "match" : "denied";
  } catch {
    // Never disclose connection strings, usernames, SQL inputs or raw errors.
    return "unavailable";
  } finally {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* connection reset */ }
      client.release(true);
    }
    await pool.end().catch(() => {});
  }
}
