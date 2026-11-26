import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../artifacts/api-server/src/routes/system.ts", import.meta.url), "utf8");
// Exercise the actual customer-count block with a parameter-capturing SQL stub.
// This is a route-source regression, not a live PostgreSQL or authorization test.
const start = source.indexOf("    const sessionCompany = req.user?.companyId;");
const end = source.indexOf("    const custRow = safeRows(custResult)", start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);
async function run(companyId, { production = false, reject = false } = {}) {
  const calls = [];
  const value = await runInNewContext("(async () => {" + block +
    "\nreturn { failed: customerQueryFailed, result: custResult }; })()", {
    req: { user: { companyId }, query: { companyId: "2" }, headers: { "x-company-id": "2" } },
    companyId: companyId ?? "default",
    process: { env: { NODE_ENV: production ? "production" : "test" } },
    sql: (parts, ...params) => ({ statement: parts.join("?"), params }),
    db: { execute: async (query) => {
      calls.push(query);
      if (reject) throw Error("synthetic database failure");
      return { rows: [{ total: 1, with_wa: 1 }] };
    } },
    logger: { warn() {} },
  });
  return { calls, value };
}
test("DEV numeric session company is the sole parameter", async () => {
  for (const id of [1, "3", 2147483647]) {
    const { calls, value } = await run(id);
    assert.equal(calls.length, 1);
    assert.match(calls[0].statement, /FROM public\.customers WHERE company_id = \?/);
    assert.deepEqual(Array.from(calls[0].params), [Number(id)]);
    assert.equal(value.failed, false);
  }
});
test("unresolved or malformed DEV company never queries customers", async () => {
  for (const id of [undefined, null, "default", "", "0", "-1", "01", "1.5", "1 OR 1=1", "2147483648"]) {
    const { calls, value } = await run(id);
    assert.equal(calls.length, 0);
    assert.equal(value.failed, true);
  }
});
test("database failure remains unavailable", async () => {
  const { calls, value } = await run("1", { reject: true });
  assert.equal(calls.length, 1);
  assert.equal(value.failed, true);
});
test("production query retains legacy parameter", async () => {
  const { calls, value } = await run("default", { production: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /FROM customers WHERE company_id = \?/);
  assert.deepEqual(Array.from(calls[0].params), ["default"]);
  assert.equal(value.failed, false);
});
