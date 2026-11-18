import test from "node:test";
import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import { resolveAiTaskDbSsl, AI_TASK_DEV_CA_PATH } from "./dev-verified-tls.ts";

const ref = "xssrfshdrtdfupgqwfdw";
const hostname = "aws-0-ap-southeast-2.pooler.supabase.com";
const target = \`postgresql://ai_task_operational_dev.\${ref}:fixture_password@\${hostname}:6543/postgres\`;
const env = () => ({
  NODE_ENV: "development",
  APP_ENV: "development",
  DB_SSL: "true",
  AI_TASK_DEV_REQUIRE_VERIFIED_TLS: "true",
  AI_TASK_DEV_DB_CA_CERT_PATH: AI_TASK_DEV_CA_PATH,
});
const provider = () => ({
  stat: () => ({ isFile: () => true, isSymbolicLink: () => false, size: 1200 }),
  read: () => rootCertificates[0],
});
function reject(changes, reason, db = target, certificate = provider()) {
  assert.throws(() => resolveAiTaskDbSsl(db, { ...env(), ...changes }, certificate), {
    message: reason,
  });
}

test("PROD SSL remains unchanged even when candidate flag is present", () => {
  assert.deepEqual(resolveAiTaskDbSsl(target, { ...env(), NODE_ENV: "production" }), { rejectUnauthorized: false });
  assert.equal(resolveAiTaskDbSsl(target, { ...env(), NODE_ENV: "production", DB_SSL: "false" }), false);
});
test("unflagged, healthy PR196 DEV retains original behavior", () => {
  assert.deepEqual(resolveAiTaskDbSsl(target, { ...env(), AI_TASK_DEV_REQUIRE_VERIFIED_TLS: undefined }), { rejectUnauthorized: false });
});
test("candidate requires CA verification and exact servername", () => {
  const result = resolveAiTaskDbSsl(target, env(), provider());
  assert.notEqual(result, false);
  assert.equal(result.rejectUnauthorized, true);
  assert.equal(result.servername, hostname);
  assert.ok(result.ca?.includes("BEGIN CERTIFICATE"));
});
test("postgres admin user is denied even on valid DEV host", () =>
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target.replace("ai_task_operational_dev.", "postgres.")));
test("NOLOGIN diagnostic reader is denied", () =>
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target.replace("ai_task_operational_dev.", "ai_task_vps_identity_reader_dev.")));
test("foreign project credentials are denied", () =>
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target.replace(ref, "differentproject")));
test("session pooler port is denied", () =>
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target.replace(":6543/", ":5432/")));
test("foreign hostname is denied", () =>
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target.replace(hostname, "unauthorized.example")));
test("driver overrides and sslmode=disable are denied", () => {
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target + "?user=postgres." + ref);
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target + "?sslmode=disable");
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target + "?host=evil.invalid&port=5432");
  reject({}, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED", target + "#fragment");
});
test("non-DEV or explicitly disabled TLS are denied", () => {
  reject({ NODE_ENV: "test" }, "AI_TASK_DEV_TLS_ENV_NOT_APPROVED");
  reject({ APP_ENV: "production" }, "AI_TASK_DEV_TLS_ENV_NOT_APPROVED");
  reject({ DB_SSL: "false" }, "AI_TASK_DEV_TLS_ENV_NOT_APPROVED");
});
test("CA may be loaded only from the fixed custody location", () => {
  reject({ AI_TASK_DEV_DB_CA_CERT_PATH: "/tmp/random-ca.pem" }, "AI_TASK_DEV_CA_PATH_NOT_APPROVED");
  reject({ AI_TASK_DEV_DB_CA_CERT_PATH: undefined }, "AI_TASK_DEV_CA_PATH_NOT_APPROVED");
});
test("missing CA must fail closed before any connect", () => {
  reject({}, "AI_TASK_DEV_CA_NOT_VERIFIED_OR_MISSING", target, {
    stat: () => { throw new Error("ENOENT /secret/filename"); },
    read: () => { throw new Error("must never reach read"); },
  });
});
test("symlink, empty and oversized CA files are rejected", () => {
  for (const st of [
    { isFile: () => true, isSymbolicLink: () => true, size: 1200 },
    { isFile: () => true, isSymbolicLink: () => false, size: 0 },
    { isFile: () => true, isSymbolicLink: () => false, size: 100000 },
  ]) {
    reject({}, "AI_TASK_DEV_CA_NOT_VERIFIED_OR_MISSING", target, { stat: () => st, read: () => rootCertificates[0] });
  }
});
test("invalid PEM and arbitrary CA content are rejected", () =>
  reject({}, "AI_TASK_DEV_CA_NOT_VERIFIED_OR_MISSING", target, {
    stat: () => ({ isFile: () => true, isSymbolicLink: () => false, size: 1200 }),
    read: () => "not a certificate",
  }));
test("errors do not reveal secrets, hostnames, credentials or filesystem details", () => {
  try {
    resolveAiTaskDbSsl(target + "?sslmode=disable", env(), provider());
    assert.fail("must reject");
  } catch (error) {
    assert.equal(error.message, "AI_TASK_DEV_TLS_TARGET_NOT_APPROVED");
    assert.equal(error.message.includes("fixture_password"), false);
    assert.equal(error.message.includes(hostname), false);
    assert.equal(error.message.includes(ref), false);
  }
});
