import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";

const index = readFileSync(
  new URL("../../artifacts/api-server/src/index.ts", import.meta.url), "utf8",
);
const app = readFileSync(
  new URL("../../artifacts/api-server/src/app.ts", import.meta.url), "utf8",
);
const ast = ts.createSourceFile("index.ts", index, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const workerCalls = [
  "startAiCoreSourceReconciliationRuntime",
  "startAiJobWhatsAppDeliveryReconciliation",
];
const guards = [];
function scan(node) {
  if (ts.isIfStatement(node) &&
    node.expression.getText(ast).includes("DISABLE_BACKGROUND_SCHEDULERS")) {
    guards.push(node);
  }
  ts.forEachChild(node, scan);
}
scan(ast);
function runGate(env) {
  assert.equal(guards.length, 1, "exactly one background-worker startup guard");
  const observed = [];
  const sandbox = { process: { env } };
  for (const name of workerCalls) sandbox[name] = () => observed.push(name);
  new Script(guards[0].getText(ast)).runInNewContext(sandbox, { timeout: 1000 });
  return observed;
}

test("both reconciler start calls are inside the same existing opt-out guard", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(guards.length, 1);
  assert.equal(
    guards[0].expression.getText(ast),
    'process.env.DISABLE_BACKGROUND_SCHEDULERS !== "true"',
  );
  const body = guards[0].thenStatement.getText(ast);
  for (const fn of workerCalls) {
    assert.equal(index.split(fn + "();").length - 1, 1, fn + " must run at most once");
    assert.ok(body.includes(fn + "();"), fn + " must be inside guarded block");
  }
  assert.ok(app.includes('if (process.env.DISABLE_BACKGROUND_SCHEDULERS !== "true")'));
});

test("isolated blue-green candidate starts no Core or WA background worker", () => {
  assert.deepEqual(runGate({ DISABLE_BACKGROUND_SCHEDULERS: "true" }), []);
});

test("normal DEV with flag absent preserves both existing workers and order", () => {
  assert.deepEqual(runGate({}), workerCalls);
});

test("normal DEV with opt-out false preserves both existing workers", () => {
  assert.deepEqual(runGate({ DISABLE_BACKGROUND_SCHEDULERS: "false" }), workerCalls);
});
