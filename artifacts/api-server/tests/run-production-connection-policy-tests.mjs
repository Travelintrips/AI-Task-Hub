import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = path.resolve(artifactDir, "../..");
const policyPath = path.join(projectDir, "lib/db/src/production-connection-policy.ts");
const pooler = "aws-0-isolated.pooler.supabase.com";
const direct = "db.isolatedfixture.supabase.co";
const runtime = "ai_task_runtime_login.isolatedfixture";
const dbUrl = (user, host = pooler, suffix = "") =>
  "postgresql://" + user + ":dummy-only@" + host + "/postgres" + suffix;
const legacyError = "Production Supabase connections require an application login role.";
const invalidError = "Invalid production database connection configuration.";
const fixtureEnv = { NODE_ENV: "production", USER: "isolated_runner", USERNAME: "isolated_runner" };

const cases = [
  { name: "session legacy pooler login", url: dbUrl("postgres.isolatedfixture", pooler + ":5432"), blocked: true, module: true },
  { name: "transaction legacy pooler login", url: dbUrl("postgres.isolatedfixture", pooler + ":6543"), blocked: true },
  { name: "direct postgres login", url: dbUrl("postgres", direct), blocked: true, module: true },
  { name: "encoded authority user", url: dbUrl("%70ostgres%2Eisolatedfixture"), blocked: true },
  { name: "query user overrides authority", url: dbUrl(runtime, pooler, "?user=postgres.isolatedfixture"), blocked: true, module: true },
  { name: "last duplicate user is blocked", url: dbUrl(runtime, pooler, "?user=" + runtime + "&user=postgres"), blocked: true },
  { name: "empty final user falls back to authority", url: dbUrl("postgres", pooler, "?user=" + runtime + "&user="), blocked: true, module: true },
  { name: "query host overrides localhost", url: dbUrl("postgres", "127.0.0.1", "?host=" + pooler), blocked: true, module: true },
  { name: "last duplicate host selects Supabase", url: dbUrl("postgres", "127.0.0.1", "?host=localhost&host=" + pooler), blocked: true },
  { name: "empty final host falls back to authority", url: dbUrl("postgres", pooler, "?host=localhost&host="), blocked: true },
  { name: "missing user falls back to PGUSER", url: "postgresql://" + pooler + "/postgres", env: { PGUSER: "postgres.isolatedfixture" }, blocked: true, module: true },
  { name: "missing user falls back to OS user", url: "postgresql://" + pooler + "/postgres", env: { USER: "postgres", USERNAME: "postgres" }, blocked: true },
  { name: "missing host falls back to PGHOST", url: "postgresql://postgres:dummy-only@/postgres", env: { PGHOST: pooler }, blocked: true, module: true },
  { name: "DNS case and trailing dot", url: dbUrl("postgres", pooler.toUpperCase() + "."), blocked: true, module: true },
  { name: "pg accepts other URL schemes", url: "http://postgres:dummy-only@" + pooler + "/postgres", blocked: true },
  { name: "query user is decoded once", url: dbUrl(runtime, pooler, "?user=%70ostgres%2Eisolatedfixture"), blocked: true },
  { name: "pg normalization of raw password space", url: "postgresql://postgres:dummy password@" + pooler + "/postgres", blocked: true },
  { name: "encoded query host", url: dbUrl("postgres", "localhost", "?host=aws-0-isolated%2Epooler%2Esupabase%2Ecom"), blocked: true },
  { name: "malformed production URI is generic", url: "postgresql://dummy-password@[broken", blocked: true, error: invalidError, module: true },
  { name: "valid pooled runtime login", url: dbUrl(runtime), module: true },
  { name: "valid direct runtime login", url: dbUrl("ai_task_runtime_login", direct), module: true },
  { name: "production localhost postgres fixture", url: dbUrl("postgres", "127.0.0.1:55444"), module: true },
  { name: "production IPv6 localhost fixture", url: dbUrl("postgres", "[::1]:55444") },
  { name: "DEV keeps legacy selection", url: dbUrl("postgres.isolatedfixture"), env: { NODE_ENV: "development" }, module: true },
  { name: "test keeps DEV URL selection", url: dbUrl("postgres.isolatedfixture"), env: { NODE_ENV: "test" }, module: true },
  { name: "Supabase-looking suffix is not Supabase", url: dbUrl("postgres", "pooler.supabase.com.example.invalid") },
  { name: "pooler label boundary is required", url: dbUrl("postgres", "notpooler.supabase.com") },
  { name: "query localhost overrides Supabase", url: dbUrl("postgres", pooler, "?host=localhost"), module: true },
  { name: "last duplicate user is allowed", url: dbUrl("postgres", pooler, "?user=postgres&user=" + runtime) },
  { name: "empty final user falls back to valid authority", url: dbUrl(runtime, pooler, "?user=postgres&user=") },
  { name: "valid PGUSER fallback", url: "postgresql://" + pooler + "/postgres", env: { PGUSER: runtime }, module: true },
  { name: "local Unix socket shorthand", url: "/tmp/.s.PGSQL.5432 postgres", env: { PGHOST: pooler, PGUSER: "postgres" } },
  { name: "socket URL ignores remote query host", url: "socket:/tmp/.s.PGSQL.5432?host=" + pooler + "&user=postgres" },
  { name: "query user must not be decoded twice", url: dbUrl(runtime, pooler, "?user=postgres%252Eisolatedfixture") },
  { name: "case-sensitive distinct role is preserved", url: dbUrl("Postgres") },
  { name: "missing URL keeps caller behavior", url: undefined, module: true },
];

async function bundle(entry, plugins = []) {
  const result = await build({
    entryPoints: [entry], bundle: true, format: "cjs", platform: "node",
    write: false, logLevel: "silent", plugins,
  });
  return result.outputFiles[0].text;
}
function evaluate(code, env, events) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, URL,
    process: { env, platform: process.platform },
    __dbPolicyProbe: events,
    console: { error: (...args) => events?.logs.push(args) },
  }, { timeout: 1000 });
  return module.exports;
}
const policy = evaluate(await bundle(policyPath), fixtureEnv).assertProductionConnectionAllowed;
let policyChecks = 0;
for (const row of cases) {
  const env = { ...fixtureEnv, ...row.env };
  if (row.blocked) {
    assert.throws(() => policy(row.url, env), error => error.message === (row.error ?? legacyError), row.name);
  } else {
    assert.doesNotThrow(() => policy(row.url, env), row.name);
  }
  policyChecks += 1;
}

const isolation = {
  name: "mock-only-pool-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^pg$/ }, () => ({ path: "pg", namespace: "policy-test" }));
    builder.onResolve({ filter: /^drizzle-orm\/node-postgres$/ }, () => ({ path: "drizzle", namespace: "policy-test" }));
    builder.onResolve({ filter: /^\.\/schema$/ }, args =>
      args.importer === path.join(projectDir, "lib/db/src/index.ts") ? { path: "schema", namespace: "policy-test" } : null);
    builder.onResolve({ filter: /^\.\/logger$/ }, args =>
      args.importer === path.join(artifactDir, "src/lib/supabase-db.ts") ? { path: "logger", namespace: "policy-test" } : null);
    builder.onLoad({ filter: /.*/, namespace: "policy-test" }, args => {
      const sources = {
        pg: "class Pool { constructor(options) { __dbPolicyProbe.options.push(options); } " +
          "on() { return this; } connect() { __dbPolicyProbe.connects++; return Promise.resolve({release(){__dbPolicyProbe.releases++;}}); } " +
          "query() { __dbPolicyProbe.queries++; throw new Error('Unexpected query'); } } export default {Pool};",
        drizzle: "export function drizzle(pool) { __dbPolicyProbe.drizzle++; return {pool}; }",
        schema: "export const isolatedSchema = {};",
        logger: "const log=(...args)=>__dbPolicyProbe.logs.push(args); export const logger={info:log,warn:log,error:log};",
      };
      return { contents: sources[args.path], loader: "js" };
    });
  },
};

const actualModules = {
  primary: await bundle(path.join(projectDir, "lib/db/src/index.ts"), [isolation]),
  raw: await bundle(path.join(artifactDir, "src/lib/supabase-db.ts"), [isolation]),
};
let moduleChecks = 0;
for (const [kind, code] of Object.entries(actualModules)) {
  for (const row of cases.filter(row => row.module)) {
    const env = { ...fixtureEnv, ...row.env };
    const isProduction = env.NODE_ENV === "production";
    env.SUPABASE_DATABASE_URL = isProduction ? row.url : dbUrl("postgres.isolatedfixture");
    env.SUPABASE_DATABASE_URL_DEV = isProduction ? dbUrl(runtime, "localhost") : row.url;
    const events = { options: [], connects: 0, releases: 0, queries: 0, drizzle: 0, logs: [] };
    let caught;
    try { evaluate(code, env, events); } catch (error) { caught = error; }
    await new Promise(resolve => setImmediate(resolve));
    const label = kind + ": " + row.name;
    if (row.blocked) {
      assert.equal(caught?.message, row.error ?? legacyError, label);
      assert.equal(events.options.length, 0, label + " must reject before Pool construction");
      assert.equal(events.connects, 0, label + " must reject before connect");
      assert.equal(events.logs.length, 0, label + " must not log credentials");
    } else if (!row.url) {
      assert.equal(events.options.length, 0, label);
      assert.equal(events.connects, 0, label);
      if (kind === "primary") {
        assert.equal(caught?.message, "SUPABASE_DATABASE_URL must be set for production.", label);
      } else {
        assert.equal(caught, undefined, label);
        assert.equal(events.logs.length, 1, label + " keeps existing missing-URL warning");
      }
    } else {
      assert.equal(caught, undefined, label);
      assert.equal(events.options.length, 1, label + " retains one existing pool");
      assert.equal(events.options[0].connectionString, row.url, label + " preserves PROD/DEV URL selection");
      assert.equal(events.options[0].max, kind === "primary" ? 10 : 5, label + " preserves pool limits");
      assert.equal(events.options[0].idleTimeoutMillis, 30000, label + " preserves pool lifetime");
      assert.equal(events.connects, kind === "raw" ? 1 : 0, label + " preserves initial connection behavior");
      assert.equal(events.releases, kind === "raw" ? 1 : 0, label);
      assert.equal(events.drizzle, kind === "primary" ? 1 : 0, label);
    }
    assert.equal(events.queries, 0, label + " makes no database query");
    moduleChecks += 1;
  }
}
console.log("Production DB login policy PASS: " + policyChecks + " policy cases, " +
  moduleChecks + " actual-module cases; pg Pool/connect fully mocked, no database or network.");
