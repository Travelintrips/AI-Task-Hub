/** Presentation only: use the persisted native task source, never a title or
 * free-text guess. These labels describe business workflow state, not a worker
 * heartbeat, approval receipt, disbursement or journal entry. */
export type NativeTaskPresentation = { source?: string | null; status: string };
export function isEmployeeKasbonTask(task: NativeTaskPresentation): boolean {
  return task.source === "employee_kasbon_conversation";
}
export function isPendingBusinessTask(task: NativeTaskPresentation): boolean {
  return isEmployeeKasbonTask(task) &&
    (task.status === "in_progress" || task.status === "ready_for_review");
}

/** Navigation only. BizPortal independently verifies its own signed session
 * and selected company. Do not transfer a Hub token, identity or task ID. */
export const DEV_KASBON_FINANCE_URL = "https://dev-bizportal.cstlogistic.co.id/expense/kasbon";
export function canNavigateToDevKasbonFinance(hostname: string, role: string | null | undefined): boolean {
  return hostname === "dev-ai-task.cstlogistic.co.id" &&
    (role === "owner" || role === "super_admin");
}
