/** Exact, authenticated AI Task DEV worker-target retention policy.
 * This only preserves a *user-selected* registered PC worker for the two
 * already-supported model-free health instructions, never creates authority.
 */
export type BoundedWorkerTarget = {
  companyId: string;
  assignedClientId?: string | null;
  instruction: string;
};

export function pinCstDevBoundedWorkerTarget(
  input: BoundedWorkerTarget,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "development"
    && env.APP_ENV === "development"
    && input.companyId === "1"
    && input.assignedClientId === "openclaw-pc-worker-dev"
    && (input.instruction.trim().toLowerCase() === "ping"
        || input.instruction.trim().toLowerCase() === "status");
}
