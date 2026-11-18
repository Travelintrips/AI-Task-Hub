/**
 * DEV-only PostgreSQL authentication circuit on the EXISTING pg.Pool instances.
 *
 * Supavisor can block every tenant behind a VPS's egress IP after concurrent
 * bad-password attempts. The two existing AI Task pools share one DEV-only
 * authorization handshake: before first success, only ONE connection to the
 * database is attempted; all other callers queue without opening sockets.
 *
 * A permanent PostgreSQL auth failure latches locally until an intentional
 * restart with corrected, approved credentials. PROD is an absolute no-op.
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
type ConnectionWaiter = { start: () => void; deny: () => void };

export type DevDbAuthScope = {
  blocked: boolean;
  authenticated: boolean;
  firstAttemptPending: boolean;
  waiting: ConnectionWaiter[];
};

export function createDevDbAuthScope(): DevDbAuthScope {
  return { blocked: false, authenticated: false, firstAttemptPending: false, waiting: [] };
}

/** Both real DEV database pools pass the SAME process-local scope instance. */
export const sharedDevDbAuthScope = createDevDbAuthScope();

/**
 * Preserve pg.Pool callback and Promise contracts, including the path used by
 * Pool.query. Optional scope supports two differently constructed Pool objects
 * using the same PostgreSQL credential. Independent test pools use fresh scopes.
 */
export function installDevDbAuthCircuit<T extends PgPoolConnectLike>(
  pool: T,
  enabled: boolean,
  scope: DevDbAuthScope = createDevDbAuthScope(),
): { isBlocked: () => boolean; noteFailure: (error: unknown) => void } {
  if (!enabled) return { isBlocked: () => false, noteFailure: () => {} };

  const originalConnect = pool.connect.bind(pool);
  const closedError = () => new Error("AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN");

  const failWaiting = () => {
    for (const waiter of scope.waiting.splice(0)) {
      queueMicrotask(waiter.deny);
    }
  };
  const noteFailure = (error: unknown) => {
    if (isTerminalDevDbAuthError(error)) {
      scope.blocked = true;
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
    if (scope.blocked) {
      failWaiting();
      return;
    }
    if (scope.authenticated) {
      // The first correct login establishes validity of the shared DEV DSN.
      // After that, return to normal pg.Pool concurrency in both pools.
      for (const waiter of scope.waiting.splice(0)) waiter.start();
    } else if (!scope.firstAttemptPending) {
      // A transient (non-auth) failure permits precisely one next handshake.
      scope.waiting.shift()?.start();
    }
  }

  function startConnect(args: unknown[], callback: PgConnectCallback): void {
    if (scope.blocked) {
      queueMicrotask(() => callback(closedError()));
      return;
    }
    if (!scope.authenticated && scope.firstAttemptPending) {
      scope.waiting.push({
        start: () => startConnect(args, callback),
        deny: () => callback(closedError()),
      });
      return;
    }

    const firstAttempt = !scope.authenticated;
    if (firstAttempt) scope.firstAttemptPending = true;
    let completed = false;
    const finish: PgConnectCallback = (error, ...rest) => {
      if (completed) return;
      completed = true;
      const finalError = error ? safeError(error) : scope.blocked ? closedError() : null;
      if (!finalError && firstAttempt) scope.authenticated = true;
      if (finalError && !error) {
        // If a different pool raised an idle 28P01 mid-connect, never allow
        // an already connected client to escape the now closed shared gate.
        const client = rest[0] as { release?: () => void } | undefined;
        try { client?.release?.(); } catch { /* never log secrets */ }
      }
      if (firstAttempt) scope.firstAttemptPending = false;
      try {
        callback(finalError, ...(finalError ? [] : rest));
      } finally {
        if (firstAttempt) drain();
      }
    };
    try {
      // Real pg.Pool.query also calls this callback form. This makes all
      // schedulers and both raw/Drizzle pools share a safe admission gate.
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

  return { isBlocked: () => scope.blocked, noteFailure };
}
