/**
 * One-shot, read-only CST-DEV credential validation.
 * Requires an operator-launched transient systemd unit with encrypted
 * credential binding. NEVER paste passwords into command arguments.
 * Outputs only fixed PASS/FAIL labels, not SQL errors or data values.
 * Does not touch running AI Task services, schedulers, signer or PROD.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { X509Certificate } from "node:crypto";
const require = createRequire(import.meta.url);
const { Client } = require("/home/githubrunner/apps/ai-task/development/node_modules/.pnpm/pg@8.20.0/node_modules/pg");
const expectedProject = "xssrfshdrtdfupgqwfdw";
const expectedRole = "ai_task_operational_dev";
const host = process.env.AI_TASK_DEV_POOLER_HOST || "";
const credsDir = process.env.CREDENTIALS_DIRECTORY || "";
const hostOk = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
if (!hostOk || !credsDir.startsWith("/run/credentials/") || process.env.NODE_ENV !== "development" || process.env.AI_TASK_DEV_PROBE_ONLY !== "true") {
  process.stdout.write("AI_TASK_DEV_AUTH_NO_GO_CONFIG\n");
  process.exit(78);
}
let password, ca;
try {
  password = readFileSync(credsDir + "/ai-task-operational-dev-password", "utf8").replace(/\r?\n$/, "");
  ca = readFileSync(credsDir + "/supabase-ca.pem", "utf8");
  const caCert = new X509Certificate(ca);
  if (!password || !caCert.ca || caCert.fingerprint256.replace(/:/g, "").toLowerCase() !== "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa") throw Error("INVALID_CREDENTIAL_OR_CA");
} catch {
  process.stdout.write("AI_TASK_DEV_AUTH_NO_GO_CREDENTIAL_BINDING\n");
  process.exit(78);
}
const client = new Client({
  host, port: 6543, database: "postgres", 
  user: expectedRole + "." + expectedProject, password,
  ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  application_name: "ai-task-dev-task171-one-shot-readonly",
});
password = undefined;
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const role = await client.query("SELECT current_user AS name, current_setting('row_security') AS rls");
  if (role.rows[0]?.name !== expectedRole || role.rows[0]?.rls !== "on") throw Error("ROLE");
  const rows = await client.query("SELECT id, company_id FROM public.ai_tasks WHERE id = ANY($1::integer[]) ORDER BY id", [[171,135,136,167]]);
  if (rows.rows.length !== 1 || rows.rows[0].id !== 171 || rows.rows[0].company_id !== "default") throw Error("TASK_BOUNDARY");
  const foreign = await client.query("SELECT count(id)::integer AS n FROM public.ai_tasks WHERE company_id <> 'default'");
  if (foreign.rows[0]?.n !== 0) throw Error("TENANT_BOUNDARY");
  const rights = await client.query("SELECT has_column_privilege(current_user,'public.ai_tasks','title','SELECT') AS title, has_table_privilege(current_user,'public.ai_tasks','UPDATE') AS update_allowed, has_table_privilege(current_user,'public.ai_tasks','INSERT') AS insert_allowed, has_table_privilege(current_user,'public.ai_tasks','DELETE') AS delete_allowed");
  if (Object.values(rights.rows[0] || {}).some(Boolean)) throw Error("PRIVILEGES");
  await client.query("ROLLBACK");
  process.stdout.write("AI_TASK_DEV_AUTH_TLS_RLS_READONLY_PASS\n");
} catch {
  process.stdout.write("AI_TASK_DEV_AUTH_TLS_RLS_READONLY_FAIL\n");
  process.exitCode = 1;
  try { await client.query("ROLLBACK"); } catch {}
} finally {
  try { await client.end(); } catch {}
}
