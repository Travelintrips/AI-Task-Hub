/**
 * Admission for a *prepared-only* GPT02 DEV Core coding task.
 * This never authorizes approval, signing, worker dispatch, completion or a lease.
 * All facts must be resolved by the server from persisted Hub rows.
 */
const fail = (reason) => Object.freeze({eligible:false,reason,dispatchPermitted:false,operatorApprovalGranted:false});
const freshInstruction = (value) => typeof value === 'string' &&
  value.length >= 12 && value.length <= 2000 &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  !/^\s*(?:AI Core bridge command|bridge-command:)/i.test(value) &&
  !/\b(?:057d9f3[cd]|TASK167_LOCALCACHE_FINAL)\b/i.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function assessGpt02PreparationAdmission({task,member,audit,actor,companyId,existingExecutionCount=0}={}) {
  if (!actor || actor.role !== 'super_admin' ||
      !actor.id || typeof actor.email !== 'string' || !actor.email.includes('@'))
    return fail('SUPER_ADMIN_REQUIRED');
  if (companyId !== 'default' || !task || task.companyId !== companyId ||
      !Number.isSafeInteger(task.id) || task.id <= 136 ||
      task.status !== 'new_inquiry' || task.source !== 'manual')
    return fail('TASK_SCOPE_OR_STATUS_NOT_READY');
  if (!Number.isSafeInteger(existingExecutionCount) || existingExecutionCount !== 0)
    return fail('EXISTING_EXECUTION_REQUIRES_INDEPENDENT_REVIEW');
  if (!member || member.isActive !== true || !Number.isSafeInteger(member.id) ||
      task.assignedToId !== member.id || task.assignedTo !== member.name)
    return fail('ACTIVE_PIC_NOT_VERIFIED');
  if (!freshInstruction(task.description) || typeof task.title !== 'string' ||
      !task.title.trim() || /^\s*AI Core bridge command\b/i.test(task.title))
    return fail('FRESH_TASK_INSTRUCTION_REQUIRED');
  if (!audit || !Number.isSafeInteger(audit.id) || audit.id <= 0 ||
      typeof audit.after !== 'string' || typeof audit.userEmail !== 'string')
    return fail('PIC_AUDIT_MISSING');
  let payload;
  try {payload=record(JSON.parse(audit.after));}
  catch {return fail('PIC_AUDIT_INVALID');}
  const identity=record(payload.actorIdentity);
  const normalizedEmail=actor.email.trim().toLowerCase();
  if (identity.version !== 1 || identity.role !== 'super_admin' ||
      String(identity.id) !== String(actor.id) ||
      identity.email !== normalizedEmail ||
      audit.userEmail.trim().toLowerCase() !== normalizedEmail ||
      payload.memberId !== member.id || payload.memberName !== member.name ||
      payload.taskId !== task.id || payload.companyId !== companyId ||
      payload.operatorApprovalGranted !== false || payload.commandDispatched !== false)
    return fail('PIC_AUDIT_ACTOR_OR_ASSIGNMENT_MISMATCH');
  return Object.freeze({
    eligible:true,reason:'PREPARATION_ELIGIBLE_NO_DISPATCH_AUTHORITY',
    instruction:task.description, taskId:task.id, auditId:audit.id,
    dispatchPermitted:false,operatorApprovalGranted:false
  });
}
