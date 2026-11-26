import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../artifacts/api-server/src/routes/system.ts", import.meta.url), "utf8");
// Execute the real route's scoped SELECT/count block against a SQL capture stub.
// No hosted DB, tokens, or authorization are used by these regression tests.
const start = source.indexOf("    const sessionCompany = req.user?.companyId;");
const end = source.indexOf("    // Knowledge base", start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);
const cstEnv = {
  NODE_ENV: "development",
  PUBLIC_APP_BASE_URL: "https://dev-ai-task.cstlogistic.co.id",
  SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
};
const owner = { id: "google_103728868378401731050", role: "super_admin", email: "fixture@example.invalid" };
async function run(companyId, { env = { NODE_ENV: "test" }, identity = {}, binding = 1, reject = "", customers = 2, fleet = 44, verified = 1, verifiedPhones = 0 } = {}) {
  const calls = [];
  const value = await runInNewContext("(async () => {" + block +
    "\nreturn { customerStep, fleetStep, legacyCstMapped }; })()", {
    req: { user: { companyId, ...identity }, query: { companyId: "3" }, headers: { "x-company-id": "3" } },
    companyId: companyId ?? "default",
    process: { env },
    sql: (parts, ...params) => ({ statement: parts.join("?"), params }),
    db: { execute: async (query) => {
      const kind = query.statement.includes("FROM public.users u") ? "binding"
        : query.statement.includes("JOIN public.audit_logs a ON a.id = 2656") ? "evidence"
        : /FROM (public\.)?customers WHERE/.test(query.statement) ? "customers" : "fleet";
      calls.push({ ...query, kind });
      if (reject === kind) throw Error("synthetic database failure");
      if (kind === "binding") return { rows: [{ cnt: binding }] };
      if (kind === "customers") return { rows: [{ total: customers, with_wa: customers }] };
      if (kind === "evidence") return { rows: [{ total: verified, with_wa: verifiedPhones }] };
      return { rows: [{ cnt: fleet }] };
    } },
    safeRows: result => result.rows,
    safeCount: result => Number(result.rows[0]?.cnt ?? 0),
    logger: { warn() {} },
  });
  return { calls, value };
}
const call = (out, kind) => out.calls.find(q => q.kind === kind);
test("numeric company retains sole authenticated company parameter; no cross-tenant filter", async () => {
  for (const id of [1, "3", 2147483647]) {
    const out = await run(id);
    assert.equal(out.calls.length, 2);
    assert.match(call(out, "customers").statement, /FROM public\.customers WHERE company_id = \?/);
    assert.deepEqual(Array.from(call(out, "customers").params), [Number(id)]);
    assert.deepEqual(Array.from(call(out, "fleet").params), [String(id)]);
    assert.equal(out.value.customerStep.done, true);
  }
});
test("unresolved or malformed DEV company never queries customer or fleet source", async () => {
  for (const id of [undefined, null, "default", "", "0", "-1", "01", "1.5", "1 OR 1=1", "2147483648"]) {
    const out = await run(id);
    assert.equal(out.calls.length, 0);
    assert.equal(out.value.customerStep.status, "unavailable");
    assert.equal(out.value.fleetStep.status, "unavailable");
  }
});
test("approved legacy profile resolves only CST counts; the reviewed customer and receipt pair qualifies", async () => {
  for (const id of [null, "default"]) {
    const out = await run(id, { env: cstEnv, identity: owner });
    assert.equal(out.value.legacyCstMapped, true);
    assert.equal(out.calls.length, 4);
    assert.match(call(out, "binding").statement, /c\.id = 1 AND c\.code = 'CST' AND c\.is_active IS TRUE/);
    assert.match(call(out, "binding").statement, /u\.company_id IS NULL AND u\.role = 'super_admin'/);
    assert.match(call(out, "binding").statement, /u\.is_active IS TRUE AND u\.status = 'active'/);
    assert.deepEqual(Array.from(call(out, "binding").params), [owner.id, owner.email]);
    assert.deepEqual(Array.from(call(out, "customers").params), [1]);
    assert.equal(out.value.customerStep.status, "ok");
    assert.equal(out.value.customerStep.done, true);
    assert.equal(out.value.customerStep.total, 1);
    assert.equal(out.value.customerStep.withPhone, 0);
    assert.equal(out.value.customerStep.unverifiedCount, 1);
    assert.match(call(out, "evidence").statement, /JOIN public\.audit_logs a ON a\.id = 2656/);
    assert.match(call(out, "evidence").statement, /c\.id = 34 AND c\.company_id = \?/);
    assert.match(call(out, "evidence").statement, /a\.after_data->>'customer_id' = c\.id::text/);
    assert.match(call(out, "evidence").statement, /a\.after_data->>'company_id' = c\.company_id::text/);
    assert.match(call(out, "evidence").statement, /a\.after_data->>'legal_name' = c\.name/);
    assert.deepEqual(Array.from(call(out, "evidence").params), [1]);
    assert.match(call(out, "fleet").statement, /COUNT\(DISTINCT regexp_replace\(upper\(v\.plate\)/);
    assert.match(call(out, "fleet").statement, /FROM public\.fleet_vehicles v/);
    assert.match(call(out, "fleet").statement, /v\.company_id = \? AND v\.status = 'active'/);
    assert.match(call(out, "fleet").statement, /nullif\(regexp_replace/);
    assert.deepEqual(Array.from(call(out, "fleet").params), [1]);
    assert.equal(out.value.fleetStep.count, 44);
    assert.equal(out.value.fleetStep.done, true);
  }
});
test("legacy mapping denies wrong environment, role, profile, and ambiguous or failed current binding", async () => {
  for (const env of [
    { ...cstEnv, APP_ENV: "production" }, { ...cstEnv, APP_ENV: "" },
    { ...cstEnv, NODE_ENV: "test" }, { ...cstEnv, PUBLIC_APP_BASE_URL: "https://wrong.invalid" },
    { ...cstEnv, SUPABASE_URL_DEV: "https://wrong.supabase.co" },
  ]) assert.equal((await run(null, { env, identity: owner })).calls.length, 0);
  for (const identity of [{ ...owner, id: "other" }, { ...owner, role: "staff" }, { ...owner, email: "" }]) {
    assert.equal((await run("default", { env: cstEnv, identity })).calls.length, 0);
  }
  assert.equal((await run(undefined, { env: cstEnv, identity: owner })).calls.length, 0);
  for (const opts of [{ binding: 0 }, { binding: 2 }, { reject: "binding" }]) {
    const out = await run(null, { env: cstEnv, identity: owner, ...opts });
    assert.equal(out.calls.length, 1);
    assert.equal(out.value.legacyCstMapped, false);
    assert.equal(out.value.fleetStep.done, false);
    assert.equal(out.value.customerStep.done, false);
  }
});
test("CST numeric and Diva numeric remain distinct; Diva uses only its own fleet_units", async () => {
  const cst = await run("1", { env: cstEnv });
  assert.equal(cst.value.customerStep.done, true);
  assert.equal(cst.value.fleetStep.source, "fleet_vehicles");
  assert.deepEqual(Array.from(call(cst, "fleet").params), [1]);
  const diva = await run("3", { env: cstEnv, fleet: 4 });
  assert.equal(diva.value.legacyCstMapped, false);
  assert.equal(diva.value.fleetStep.source, "fleet_units");
  assert.match(call(diva, "fleet").statement, /FROM fleet_units/);
  assert.deepEqual(Array.from(call(diva, "fleet").params), ["3"]);
});
test("source failures and empty inventory remain incomplete", async () => {
  for (const reject of ["customers", "evidence", "fleet"]) {
    const out = await run("1", { env: cstEnv, reject });
    const step = reject === "fleet" ? out.value.fleetStep : out.value.customerStep;
    assert.equal(step.status, "unavailable");
    assert.equal(step.done, false);
  }
  assert.equal((await run("1", { env: cstEnv, fleet: 0 })).value.fleetStep.done, false);
});
test("production retains original query scopes and completion", async () => {
  const out = await run("default", { env: { NODE_ENV: "production" }, identity: owner });
  assert.equal(out.calls.length, 2);
  assert.match(call(out, "customers").statement, /FROM customers WHERE company_id = \?/);
  assert.deepEqual(Array.from(call(out, "customers").params), ["default"]);
  assert.deepEqual(Array.from(call(out, "fleet").params), ["default"]);
  assert.equal(out.value.customerStep.done, true);
  assert.equal(out.value.fleetStep.source, "fleet_units");
});

test("missing or ambiguous evidence remains incomplete even when other assigned customers exist", async () => {
  for (const verified of [0, 2]) {
    const out = await run("1", { env: cstEnv, customers: 2, verified });
    assert.equal(out.value.customerStep.done, false);
    assert.equal(out.value.customerStep.status, "awaiting_verified_customer");
  }
  const other = await run("3", { env: cstEnv });
  assert.equal(call(other, "evidence"), undefined);
});
