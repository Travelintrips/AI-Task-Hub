/**
 * DEV-only PostgreSQL authentication circuit on the existing pg.Pool.
 *
 * Supavisor may block the shared VPS egress IP after concurrent bad-password
 * attempts. Before the first successful connection, allow just ONE cold-start
 * authentication handshake; queue all other pg.Pool.connect/query callers.
 * A terminal auth failure fails the queue locally and latches until a
 * deliberate process restart after credential repair. Production is a no-op.
 */
export function isTerminalDevDbAuthError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6 && current != null; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "string") {
      if (/password authentication failed|circuit breaker open for operation:\s*auth_error|too many authentication failures/i.test(current)) return true;
      break;
    }
    if (typeof current !== "object") break;
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^(?:28P01|28000)$/i.test(value.code)) return true;
    if (typeof value.message === "string" &&
        /password authentication failed|circuit breaker open for operation:\s*auth_error|too many authentication failures/i.test(value.message)) return true;
    current = value.cause;
  }
  return false;
}

type PgConnectCallback = (error: unknown, ...rest: unknown[]) => void;
type PgPoolConnectLike = { connect: (...args: any[]) => any };
type ConnectionWaiter = { args: unknown[]; callback: PgConnectCallback };

/**
 * Preserve the real pg.Pool callback/promise contracts, including the
 * callback path used internally by Pool.query. No SQL or credentials inspected.
 */
export function installDevDbAuthCircuit<T extends PgPoolConnectLike>(
  pool: T,
  enabled: boolean,
): { isBlocked: () => boolean; noteFailure: (error: unknown) => void } {
  if (!enabled) return { isBlocked: () => false, noteFailure: () => {} };

  let blocked = false;
  let authenticated = false;
  let firstAttemptPending = false;
  const waiting: ConnectionWaiter[] = [];
  const originalConnect = pool.connect.bind(pool);
  const closedError = () => new Error("AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN");

  const failWaiting = () => {
    for (const waiter of waiting.splice(0)) {
      queueMicrotask(() => waiter.callback(closedError()));
    }
  };
  const noteFailure = (error: unknown) => {
    if (isTerminalDevDbAuthError(error)) {
      blocked = true;
      failWaiting();
    }
  };
  const safeError = (error: unknown): unknown => {
    if (isTerminalDevDbAuthError(error)) {
      noteFailure(error);
      return new Error("AI_TASK_DEV_DB_AUTH_REJECTED_RESTART_REQUIRED");
    }
    return error;
  };

  function drain(): void {
    if (blocked) {
      failWaiting();
      return;
    }
    if (authenticated) {
      for (const waiter of waiting.splice(0)) {
        startConnect(waiter.args, waiter.callback);
      }
    } else if (!firstAttemptPending) {
      const next = waiting.shift();
      if (next) startConnect(next.args, next.callback);
    }
  }

  function startConnect(args: unknown[], callback: PgConnectCallback): void {
    if (blocked) {
      queueMicrotask(() => callback(closedError()));
      return;
    }
    // The first socket decides whether this process is allowed to continue.
    // This prevents a burst of 28P01 from simultaneous 30-second schedulers.
    if (!authenticated && firstAttemptPending) {
      waiting.push({ args, callback });
      return;
    }
    const firstAttempt = !authenticated;
    if (firstAttempt) firstAttemptPending = true;
    let completed = false;
    const finish: PgConnectCallback = (error, ...rest) => {
      if (completed) return;
      completed = true;
      const finalError = error ? safeError(error) : blocked ? closedError() : null;
      if (!finalError && firstAttempt) authenticated = true;
      if (finalError && !error) {
        // Another idle Pool client could have tripped the latch during this
        // in-flight handshake. Never let its newly acquired client escape.
        const client = rest[0] as { release?: () => void } | undefined;
        try { client?.release?.(); } catch { /* no secrets or pool state logged */ }
      }
      if (firstAttempt) firstAttemptPending = false;
      try {
        callback(finalError, ...(finalError ? [] : rest));
      } finally {
        if (firstAttempt) drain();
      }
    };
    try {
      // Intentionally invoke the original callback-based pg.Pool.connect.
      // It is also what pg.Pool.query uses, so there is one shared gate.
      originalConnect(...args, finish);
    } catch (error) {
      queueMicrotask(() => finish(error));
    }
  }

  pool.connect = ((...args: unknown[]) => {
    const callback = typeof args.at(-1) === "function"
      ? args.pop() as PgConnectCallback : undefined;
    if (callback) {
      startConnect(args, callback);
      return;
    }
    return new Promise((resolve, reject) => {
      startConnect(args, (error, client) => {
        if (error) reject(error);
        else resolve(client);
      });
    });
  }) as T["connect"];

  return { isBlocked: () => blocked, noteFailure };
}
