/**
 * DEV-only PostgreSQL authentication circuit for the existing pg.Pool.
 *
 * A permanent 28P01, 28000, or Supavisor auth_error means that retrying the
 * same credential can block ALL tenants behind the VPS shared egress IP.
 * After the first terminal failure, fail locally until authorized restart.
 * Production pool behavior is unchanged. No secrets or raw SQL are logged.
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
    const object = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof object.code === "string" && /^(?:28P01|28000)$/i.test(object.code)) return true;
    if (typeof object.message === "string" &&
        /password authentication failed|circuit breaker open for operation:\s*auth_error|too many authentication failures/i.test(object.message)) return true;
    current = object.cause;
  }
  return false;
}

type PgConnectCallback = (err: unknown, ...rest: unknown[]) => void;
type PgPoolConnectLike = {
  connect: (...args: any[]) => any;
};

/**
 * Intercepts pg.Pool.connect, including the callback form that pg.Pool.query
 * internally uses. Does not alter queries, transactions or connection options.
 * When disabled, the Pool object is entirely untouched (PROD parity).
 */
export function installDevDbAuthCircuit<T extends PgPoolConnectLike>(
  pool: T,
  enabled: boolean,
): { isBlocked: () => boolean; noteFailure: (error: unknown) => void } {
  if (!enabled) return { isBlocked: () => false, noteFailure: () => {} };

  let blocked = false;
  const noteFailure = (error: unknown) => {
    if (isTerminalDevDbAuthError(error)) blocked = true;
  };
  const originalConnect = pool.connect.bind(pool);
  const safeError = (error: unknown): unknown => {
    if (isTerminalDevDbAuthError(error)) {
      blocked = true;
      return new Error("AI_TASK_DEV_DB_AUTH_REJECTED_RESTART_REQUIRED");
    }
    return error;
  };
  const closedError = () => new Error("AI_TASK_DEV_DB_AUTH_CIRCUIT_OPEN");

  pool.connect = ((...args: unknown[]) => {
    const callback = typeof args.at(-1) === "function" ? args.at(-1) as PgConnectCallback : undefined;
    if (blocked) {
      const err = closedError();
      if (callback) {
        queueMicrotask(() => callback(err));
        return;
      }
      return Promise.reject(err);
    }

    if (callback) {
      const replacement: PgConnectCallback = (err, ...rest) => {
        if (err) callback(safeError(err), ...rest);
        else callback(err, ...rest);
      };
      try {
        return originalConnect(...args.slice(0, -1), replacement);
      } catch (error) {
        queueMicrotask(() => callback(safeError(error)));
        return;
      }
    }

    try {
      const result = originalConnect(...args);
      if (result && typeof result.then === "function") {
        return result.catch((error: unknown) => { throw safeError(error); });
      }
      return result;
    } catch (error) {
      return Promise.reject(safeError(error));
    }
  }) as T["connect"];

  return { isBlocked: () => blocked, noteFailure };
}
