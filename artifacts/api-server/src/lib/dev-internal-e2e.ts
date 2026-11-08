/** Internal DEV smoke tests are opt-in and may not silence real customer jobs. */
export const INTERNAL_E2E_PREFIX = "[INTERNAL-E2E] ";

export function isSilentInternalE2eJob(title: string | null | undefined): boolean {
  return process.env.NODE_ENV === "development" &&
    process.env.APP_ENV !== "production" &&
    process.env.AI_TASK_DEV_SILENT_E2E_ENABLED === "true" &&
    typeof title === "string" && title.startsWith(INTERNAL_E2E_PREFIX);
}
