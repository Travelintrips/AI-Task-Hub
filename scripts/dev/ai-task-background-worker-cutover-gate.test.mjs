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
  const sandbox = { process: { env }, logger: { warn() {} } };
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

test("normal DEV with explicit APP_ENV preserves both existing workers and order", () => {
  assert.deepEqual(runGate({ APP_ENV: "development" }), workerCalls);
});

test("normal DEV with opt-out false preserves both existing workers", () => {
  assert.deepEqual(runGate({
    APP_ENV: "development", DISABLE_BACKGROUND_SCHEDULERS: "false",
  }), workerCalls);
});

test("official explicit PROD keeps the original reconciliation startup", () => {
  assert.deepEqual(runGate({ APP_ENV: "production" }), workerCalls);
});

test("orphan with NODE_ENV=development but APP_ENV missing starts no Core/WA workers", () => {
  assert.deepEqual(runGate({ NODE_ENV: "development" }), []);
});

test("unknown APP_ENV and inherited stale pooler URL do not start workers", () => {
  assert.deepEqual(runGate({
    APP_ENV: "preview", NODE_ENV: "development",
    SUPABASE_DATABASE_URL_DEV: "synthetic-stale-pooler-url",
  }), []);
});

test("app startup side effects require explicit APP_ENV; PROD and DEV unchanged", () => {
  const appAst = ts.createSourceFile("app.ts", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(appAst.parseDiagnostics.length, 0);
  assert.ok(app.includes('const hasExplicitAppEnv ='));
  assert.ok(app.includes('process.env.APP_ENV === "development"'));
  assert.ok(app.includes('process.env.APP_ENV === "production"'));
  assert.ok(app.includes('const shouldRunStartupMigrations = hasExplicitAppEnv && ('));
  assert.ok(app.includes('if (hasExplicitAppEnv) {'));
  const envGateIndex = app.lastIndexOf('if (hasExplicitAppEnv) {');
  const storageIndex = app.indexOf('ensurePaymentProofBucket().catch');
  const startIndex = app.indexOf('const shouldRunStartupMigrations');
  assert.ok(envGateIndex > startIndex && envGateIndex < storageIndex);
  assert.ok(app.includes('if (process.env.DISABLE_BACKGROUND_SCHEDULERS !== "true")'));
  assert.ok(app.includes('if (hasExplicitAppEnv) {\n  // Start background services'));
  assert.equal(app.split("startFollowUpScheduler();").length - 1, 1);
  assert.equal(app.split("startOrderSyncScheduler();").length - 1, 1);
  assert.equal(app.split("startEscalationScheduler();").length - 1, 1);
  assert.equal(app.split("startIntelScheduler();").length - 1, 1);
  assert.equal(app.split("startFleetScheduler();").length - 1, 1);
  assert.equal(app.split("startExecutiveBriefingScheduler();").length - 1, 1);
});

function evaluateAppStartup(env) {
  const src = ts.createSourceFile("app.ts", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(src.parseDiagnostics.length, 0);
  let envDecl, migrationDecl, schedulerIf;
  for (const node of src.statements) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const name = decl.name.getText(src);
        if (name === "hasExplicitAppEnv") envDecl = decl;
        if (name === "shouldRunStartupMigrations") migrationDecl = decl;
      }
    }
    if (ts.isIfStatement(node) &&
        node.expression.getText(src).includes("DISABLE_BACKGROUND_SCHEDULERS")) {
      schedulerIf = node;
    }
  }
  assert.ok(envDecl?.initializer && migrationDecl?.initializer && schedulerIf);
  const collected = [];
  const sandbox = { process: { env }, logger: { warn() {} }, setInterval: () => { collected.push("interval"); } };
  const starts = [
    "startFollowUpScheduler", "startOrderSyncScheduler",
    "startEscalationScheduler", "startIntelScheduler",
    "startFleetScheduler", "startExecutiveBriefingScheduler",
  ];
  for (const name of starts) sandbox[name] = () => collected.push(name);
  const js = "const hasExplicitAppEnv = " + envDecl.initializer.getText(src)
    + ";\n" + schedulerIf.getText(src)
    + "\nconst shouldRunStartupMigrations = " + migrationDecl.initializer.getText(src)
    + ";\n__qa_migrate(shouldRunStartupMigrations);";
  let migration;
  sandbox.__qa_migrate = (value) => { migration = value; };
  new Script(js).runInNewContext(sandbox, { timeout: 1500 });
  return { collected, migration };
}

test("app orphan without APP_ENV does not create ANY timer, scheduler, or startup DDL", () => {
  const out = evaluateAppStartup({
    NODE_ENV: "development",
    RUN_STARTUP_MIGRATIONS: "true",
  });
  assert.deepEqual(out.collected, []);
  assert.equal(out.migration, false);
});

test("app with invalid APP_ENV stays inert even with stale DB env and migrations=true", () => {
  const out = evaluateAppStartup({
    APP_ENV: "preview", NODE_ENV: "development",
    RUN_STARTUP_MIGRATIONS: "true",
    SUPABASE_DATABASE_URL_DEV: "synthetic-stale-pooler",
  });
  assert.deepEqual(out.collected, []);
  assert.equal(out.migration, false);
});

test("official explicit DEV keeps exactly six schedulers and two timers", () => {
  const out = evaluateAppStartup({
    APP_ENV: "development", NODE_ENV: "development",
    RUN_STARTUP_MIGRATIONS: "false",
  });
  assert.equal(out.collected.length, 8);
  assert.equal(out.collected.filter(x => x === "interval").length, 2);
  assert.equal(out.migration, false);
});

test("official explicit PROD behavior remains unchanged", () => {
  const out = evaluateAppStartup({
    APP_ENV: "production", NODE_ENV: "production",
    RUN_STARTUP_MIGRATIONS: "false",
  });
  assert.equal(out.collected.length, 8);
  assert.equal(out.migration, false);
});

test("explicit DEV still permits existing opt-in migrations only", () => {
  const out = evaluateAppStartup({
    APP_ENV: "development", NODE_ENV: "development",
    RUN_STARTUP_MIGRATIONS: "true",
    DISABLE_BACKGROUND_SCHEDULERS: "true",
  });
  assert.deepEqual(out.collected, []);
  assert.equal(out.migration, true);
});
