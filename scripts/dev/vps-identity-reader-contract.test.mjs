import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getVpsIdentityReaderConfig,
  normalizedVpsIdentityScope,
  readActiveVpsSuperAdmin,
} from "../../artifacts/api-server/src/lib/vps-storage-readonly-db.ts";

const project = "xssrfshdrtdfupgqwfdw";
const validEnv = {
  NODE_ENV: "development",
  APP_ENV: "development",
  AI_TASK_DEV_EXPECTED_PROJECT_ID: project,
  VPS_STORAGE_INVENTORY_READONLY_ENABLED: "true",
  VPS_STORAGE_IDENTITY_READER_URL_DEV: "postgresql://ai_task_vps_identity_reader_dev." +
    project + ":SYNTHETIC_NEVER_USE_THIS_LONG_PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres",
  VPS_STORAGE_IDENTITY_READER_CA_FILE: "/etc/ai-task/dev-reader-ca.pem",
};

test("dedicated DEV role, exact project, session pooler and CA required", () => {
  const cfg = getVpsIdentityReaderConfig(validEnv);
  assert.ok(cfg);
  assert.equal(cfg.caFile, validEnv.VPS_STORAGE_IDENTITY_READER_CA_FILE);
  assert.ok(cfg.connectionString.startsWith("postgresql://ai_task_vps_identity_reader_dev."));
  for (const patch of [
    { NODE_ENV: "production" },
    { APP_ENV: "production" },
    { VPS_STORAGE_INVENTORY_READONLY_ENABLED: "false" },
    { AI_TASK_DEV_EXPECTED_PROJECT_ID: "nzdweipzckfszczzqtuw" },
    { VPS_STORAGE_IDENTITY_READER_URL_DEV: undefined },
    { VPS_STORAGE_IDENTITY_READER_URL_DEV: "postgresql://postgres." +
      project + ":SYNTHETIC_NEVER_USE_THIS_LONG_PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres" },
    { VPS_STORAGE_IDENTITY_READER_URL_DEV: validEnv.VPS_STORAGE_IDENTITY_READER_URL_DEV.replace(":5432/", ":6543/") },
    { VPS_STORAGE_IDENTITY_READER_URL_DEV: validEnv.VPS_STORAGE_IDENTITY_READER_URL_DEV.replace(project, "nzdweipzckfszczzqtuw") },
    { VPS_STORAGE_IDENTITY_READER_URL_DEV: validEnv.VPS_STORAGE_IDENTITY_READER_URL_DEV.replace("pooler.supabase.com","evil.invalid") },
    { VPS_STORAGE_IDENTITY_READER_CA_FILE: "" },
    { VPS_STORAGE_IDENTITY_READER_CA_FILE: "relative.pem" },
  ]) {
    assert.equal(getVpsIdentityReaderConfig({ ...validEnv, ...patch }), null);
  }
});

test("real CST-DEV TEXT user IDs and INTEGER or null company scope", () => {
  const base = { id:"google_123", companyId:2, email:" Admin@Example.INVALID ", role:"super_admin", name:"Synthetic" };
  assert.deepEqual(normalizedVpsIdentityScope(base), { id:"google_123", email:"admin@example.invalid", company:"2" });
  assert.deepEqual(normalizedVpsIdentityScope({ ...base, companyId: null }), { id:"google_123", email:"admin@example.invalid", company:"@NULL@" });
  for (const patch of [
    { id:"" }, { email:"" }, { companyId:"default" },
    { companyId:"1; DROP TABLE users" }, { email:"nonsense" },
  ]) assert.equal(normalizedVpsIdentityScope({ ...base, ...patch }), null);
});

test("missing isolated reader credentials fail closed without touching DB", async () => {
  const user = { id:"google_123", companyId:null, email:"admin@example.invalid", role:"super_admin", name:"Synthetic" };
  assert.equal(await readActiveVpsSuperAdmin(user, { ...validEnv, VPS_STORAGE_IDENTITY_READER_URL_DEV:undefined }), "unavailable");
  assert.equal(await readActiveVpsSuperAdmin(user, validEnv), "unavailable");
});

test("route forbids shared postgres/BYPASSRLS database fallback", () => {
  const route = readFileSync("artifacts/api-server/src/routes/vps-storage.ts", "utf8");
  const helper = readFileSync("artifacts/api-server/src/lib/vps-storage-readonly-db.ts", "utf8");
  assert.ok(route.includes("await readActiveVpsSuperAdmin(req.user)"));
  assert.ok(!route.includes('from "@workspace/db"'));
  assert.ok(!route.includes("db.select("));
  assert.ok(helper.includes("BEGIN READ ONLY"));
  assert.ok(helper.includes("ROLLBACK"));
  assert.ok(helper.includes("rejectUnauthorized: true"));
  assert.ok(helper.includes("max: 1"));
  assert.ok(!helper.includes("process.env.SUPABASE_DATABASE_URL_DEV"));
  assert.ok(!helper.includes("process.env.SUPABASE_DATABASE_URL"));
  assert.ok(!helper.includes("password_hash"));
});

test("manual SQL grants only row-scoped column-level SELECT, never LOGIN or DML", () => {
  const source = readFileSync("scripts/dev/vps-identity-reader-prepare.sql","utf8");
  assert.ok(source.includes("NOLOGIN NOINHERIT NOSUPERUSER"));
  assert.ok(source.includes("NOBYPASSRLS"));
  assert.ok(source.includes("GRANT SELECT (id, email, company_id, role, is_active, status)"));
  assert.ok(!source.includes("GRANT SELECT ON TABLE"));
  assert.ok(source.includes("current_setting('ai_task_vps.identity_id', true)"));
  assert.ok(source.includes("current_setting('ai_task_vps.identity_email', true)"));
  assert.ok(source.includes("current_setting('ai_task_vps.identity_company', true)"));
});
