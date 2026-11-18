import test from "node:test";
import assert from "node:assert/strict";
import { installDevDbAuthCircuit, isTerminalDevDbAuthError } from "./dev-auth-circuit.ts";
import pg from "pg";

function error(message, code) {
  return Object.assign(new Error(message), code ? { code } : {});
}

class FakePool {
  constructor(failures = []) {
    this.failures = [...failures];
    this.connectCalls = 0;
  }
  connect(callback) {
    this.connectCalls++;
    const result = this.failures.shift();
    const client = { release() {}, query: async () => ({ rows: [{ ok: 1 }] }) };
    if (typeof callback === "function") {
      queueMicrotask(() => callback(result instanceof Error ? result : null, client, () => {}));
      return;
    }
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(client);
  }
  // pg.Pool.query uses the callback form of this.connect internally.
  async query() {
    return new Promise((resolve, reject) => {
      this.connect((err, client) => err ? reject(err) : resolve(client.query("select 1")));
    });
  }
}

test("28P01 and 28000 are terminal even when nested under Drizzle's cause", () => {
  assert.equal(isTerminalDevDbAuthError(error("bad creds", "28P01")), true);
  assert.equal(isTerminalDevDbAuthError({ cause: { cause: error("bad creds", "28000") } }), true);
  assert.equal(isTerminalDevDbAuthError(error("password authentication failed for user REDACTED")), true);
});

test("only authentication-related Supavisor circuit breakers become terminal", () => {
  assert.equal(isTerminalDevDbAuthError(error("circuit breaker open for operation: auth_error", "ECIRCUITBREAKER")), true);
  assert.equal(isTerminalDevDbAuthError(error("too many authentication failures, connections blocked")), true);
  assert.equal(isTerminalDevDbAuthError(error("circuit breaker open for operation: connection_closed", "ECIRCUITBREAKER")), false);
});

test("unknown errors, networking errors, and self-referential causes are nonterminal", () => {
  const e = error("database connection reset", "ECONNRESET");
  e.cause = e;
  assert.equal(isTerminalDevDbAuthError(e), false);
  assert.equal(isTerminalDevDbAuthError(null), false);
});

test("DEV pg.Pool.query callback path latches first 28P01 and refuses all later retries locally", async () => {
  const bad = error("password authentication failed for user PRIVATE_USER", "28P01");
  const pool = new FakePool([bad]);
  const circuit = installDevDbAuthCircuit(pool, true);
  await assert.rejects(pool.query(), /AI_TASK_DEV_DB_AUTH_REJECTED_RESTART_REQUIRED/);
  assert.equal(circuit.isBlocked(), true);
  for (let i = 0; i < 8; i++) {
    await assert.rejects(pool.query(), /AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN/);
  }
  assert.equal(pool.connectCalls, 1, "no repeated socket attempts after terminal authentication");
});

test("DEV pg.Pool.connect Promise path latches SCRAM and redacts first error", async () => {
  const pool = new FakePool([error("postgresql://user:secret@hidden.invalid", "28000")]);
  const circuit = installDevDbAuthCircuit(pool, true);
  const first = await pool.connect().then(() => "", e => String(e.message));
  assert.equal(first, "AI_TASK_DEV_DB_AUTH_REJECTED_RESTART_REQUIRED");
  await assert.rejects(pool.connect(), /AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN/);
  assert.equal(circuit.isBlocked(), true);
  assert.equal(pool.connectCalls, 1);
});

test("DEV callback clients remain functional for successful auth and release", async () => {
  const pool = new FakePool([]);
  const circuit = installDevDbAuthCircuit(pool, true);
  const val = await new Promise((resolve, reject) => {
    pool.connect(async (err, client) => {
      if (err) return reject(err);
      const result = await client.query("select 1");
      client.release();
      resolve(result.rows[0].ok);
    });
  });
  assert.equal(val, 1);
  assert.equal(circuit.isBlocked(), false);
  assert.equal(pool.connectCalls, 1);
});

test("transient network failure is recoverable; no permanent latch", async () => {
  const pool = new FakePool([error("connection reset", "ECONNRESET")]);
  const circuit = installDevDbAuthCircuit(pool, true);
  await assert.rejects(pool.connect(), /connection reset/);
  assert.equal(circuit.isBlocked(), false);
  const client = await pool.connect();
  assert.ok(client);
  assert.equal(pool.connectCalls, 2);
});

test("Supavisor auth_error trips the DEV circuit; unrelated breaker does not", async () => {
  const pool = new FakePool([error("circuit breaker open for operation: auth_error", "ECIRCUITBREAKER")]);
  const gate = installDevDbAuthCircuit(pool, true);
  await assert.rejects(pool.connect(), /AI_TASK_DEV_DB_AUTH_REJECTED_RESTART_REQUIRED/);
  assert.equal(gate.isBlocked(), true);
  await assert.rejects(pool.connect(), /AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN/);
  assert.equal(pool.connectCalls, 1);

  const other = new FakePool([error("circuit breaker open for operation: network_error", "ECIRCUITBREAKER")]);
  const otherGate = installDevDbAuthCircuit(other, true);
  await assert.rejects(other.connect(), /network_error/);
  assert.equal(otherGate.isBlocked(), false);
  await other.connect();
  assert.equal(other.connectCalls, 2);
});

test("idle-pool terminal error stops future scheduled database attempts", async () => {
  const pool = new FakePool();
  const gate = installDevDbAuthCircuit(pool, true);
  gate.noteFailure({ cause: error("wrong password", "28P01") });
  assert.equal(gate.isBlocked(), true);
  await assert.rejects(pool.query(), /AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN/);
  assert.equal(pool.connectCalls, 0);
});

test("real pg.Pool.query internally respects the DEV callback-connect latch without any network", async () => {
  const pool = new pg.Pool({ connectionString: "postgresql://fixture:fixture@127.0.0.1:1/postgres" });
  let underlyingConnectCalls = 0;
  // Hook the real pg Pool's connect seam. No socket or actual Postgres.
  pool.connect = (callback) => {
    underlyingConnectCalls++;
    queueMicrotask(() => callback(error("password authentication failed for fixture", "28P01")));
  };
  const gate = installDevDbAuthCircuit(pool, true);
  await assert.rejects(pool.query("select 1"), /AI_TASK_DEV_DB_AUTH_REJECTED_RESTART_REQUIRED/);
  for (let n = 0; n < 4; n++) {
    await assert.rejects(pool.query("select 1"), /AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN/);
  }
  assert.equal(gate.isBlocked(), true);
  assert.equal(underlyingConnectCalls, 1);
  await pool.end();
});

test("production installation is a strict no-op and retains Pool method identity", async () => {
  const pool = new FakePool([error("password authentication failed", "28P01")]);
  const original = pool.connect;
  const gate = installDevDbAuthCircuit(pool, false);
  assert.equal(pool.connect, original);
  gate.noteFailure(error("wrong", "28P01"));
  assert.equal(gate.isBlocked(), false);
  await assert.rejects(pool.connect(), /password authentication failed/);
  await pool.connect();
  assert.equal(pool.connectCalls, 2);
});
