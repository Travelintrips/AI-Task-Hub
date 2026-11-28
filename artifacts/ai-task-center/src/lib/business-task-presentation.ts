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

/** Native workflow substate only; not an approval, payout, or worker signal. */
export type KasbonWorkflowState = "ready_for_review" | "in_progress";
export function kasbonWorkflowState(task: NativeTaskPresentation | undefined): KasbonWorkflowState | null {
  if (!task || !isEmployeeKasbonTask(task)) return null;
  return task.status === "ready_for_review" || task.status === "in_progress" ? task.status : null;
}
export function kasbonWorkflowCounts(tasks: readonly (NativeTaskPresentation | undefined)[]): Record<KasbonWorkflowState, number> {
  const counts = { ready_for_review: 0, in_progress: 0 };
  for (const task of tasks) {
    const state = kasbonWorkflowState(task);
    if (state !== null) counts[state]++;
  }
  return counts;
}
