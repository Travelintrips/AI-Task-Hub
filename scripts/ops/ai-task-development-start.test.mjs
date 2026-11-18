import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const launcher = readFileSync(join(here, "ai-task-development-start"), "utf8");
const body = launcher.match(/"\$NODE" <<'NODE_GUARD'\n([\s\S]*?)\nNODE_GUARD/);
assert.ok(body, "Launcher must execute the versioned offline role gate before any process launch");

const ref = "xssrfshdrtdfupgqwfdw";
const validHost = "aws-0-ap-southeast-1.pooler.supabase.com";
function result({ role, port = 6543, host = validHost, env = "development", query = "", database = "postgres" }) {
  const connection = `postgresql://${role}:fixture_only@${host}:${port}/${database}${query}`;
  const response = spawnSync(process.execPath, ["-e", body[1]], {
    env: { NODE_ENV: env, APP_ENV: "development", SUPABASE_DATABASE_URL_DEV: connection },
    encoding: "utf8",
    timeout: 2500,
  });
  assert.equal(response.error, undefined);
  // The offline verifier must not echo fixture credentials, host or DB URLs.
  assert.doesNotMatch(response.stderr + response.stdout, /fixture_only|postgresql:\/\/|pooler\.supabase/);
  return response.status;
}

test("refuses old admin postgres pooler identity without a network call", () => {
  assert.equal(result({ role: `postgres.${ref}` }), 78);
});
test("rejects elevated AI Task Hostinger role and cannot borrow its credentials", () => {
  assert.equal(result({ role: `ai_task_hostinger.${ref}` }), 78);
});
test("Node guard permits only reader syntax; independent release marker is still mandatory", () => {
  assert.equal(result({ role: `ai_task_vps_identity_reader_dev.${ref}` }), 0);
});
test("does not accept a session-pooler port as the approved isolated path", () => {
  assert.equal(result({ role: `ai_task_vps_identity_reader_dev.${ref}`, port: 5432 }), 78);
});
test("rejects any non-pooler host even with the target reader username", () => {
  assert.equal(result({ role: `ai_task_vps_identity_reader_dev.${ref}`, host: `db.${ref}.supabase.co` }), 78);
});
test("production NODE_ENV cannot use DEV launcher", () => {
  assert.equal(result({ role: `ai_task_vps_identity_reader_dev.${ref}`, env: "production" }), 78);
});
test("launcher contains fail-closed scheduler and startup DDL flags", () => {
  assert.match(launcher, /export DISABLE_BACKGROUND_SCHEDULERS=true/);
  assert.match(launcher, /export RUN_STARTUP_MIGRATIONS=false/);
  assert.match(launcher, /flock -x 9/);
});

test("query-string user override cannot switch effective login to postgres", () => {
  assert.equal(result({ role: 'ai_task_vps_identity_reader_dev.' + ref, query: '?user=postgres.' + ref }), 78);
});
test("query-string host/port overrides cannot redirect connection", () => {
  assert.equal(result({ role: 'ai_task_vps_identity_reader_dev.' + ref, query: '?host=unsafe.example&port=5432' }), 78);
});
test("query TLS-disable cannot undermine the isolated release preflight", () => {
  assert.equal(result({ role: 'ai_task_vps_identity_reader_dev.' + ref, query: '?sslmode=disable' }), 78);
});
test("foreign database names and URL fragments are rejected", () => {
  assert.equal(result({ role: 'ai_task_vps_identity_reader_dev.' + ref, database: 'otherdb' }), 78);
  assert.equal(result({ role: 'ai_task_vps_identity_reader_dev.' + ref, query: '#frag' }), 78);
});
test("independent release-marker guard stops @reboot/direct launch before reading credentials", () => {
  const markerPos = launcher.indexOf('RELEASE_MARKER="/etc/ai-task-dev-authorized-reader-and-release.ready"');
  const envPos = launcher.indexOf('set -a');
  const nodePos = launcher.indexOf('"$NODE" <<');
  assert.ok(markerPos > 0 && markerPos < envPos && envPos < nodePos);
  assert.match(launcher, /\[\[ ! -f "\$RELEASE_MARKER" \|\| -L "\$RELEASE_MARKER" \]\]/);
  assert.match(launcher, /AI_TASK_DEV_RELEASE_NOT_AUTHORIZED/);
});
