/** Never expose internal ledger readback in PROD or when not explicitly enabled. */
export function bridgeLedgerReadbackAllowed(env: {
  NODE_ENV?: string; APP_ENV?: string; AI_TASK_BRIDGE_READBACK_ENABLED?: string;
}): boolean {
  return env.NODE_ENV === "development" &&
    (!env.APP_ENV || env.APP_ENV === "development") &&
    env.AI_TASK_BRIDGE_READBACK_ENABLED === "true";
}
