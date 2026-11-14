/**
 * Non-dispatching admission for GPT02 DEV: persist facts, never caller flags.
 * These helpers mint NO signer approval, no nonce, no lease and no command.
 */
const fail = (reason) => Object.freeze({eligible:false,reason,dispatchPermitted:false,operatorApprovalGranted:false});
const freshInstruction = value => typeof value === 'string' &&
  value.length >= 12 && value.length <= 2000 &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  !/^\s*(?:AI Core bridge command|bridge-command:)/i.test(value) &&
  !/\b(?:057d9f3[cd]|TASK167_LOCALCACHE_FINAL)\b/i.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
function commonAdmission({task,member,audit,actor,companyId,existingExecutionCount=0}={}) {
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
  return null;
}
export function assessGpt02PreparationAdmission(facts={}) {
  const denied=commonAdmission(facts);
  if (denied) return denied;
  const {task,audit}=facts;
  if (!freshInstruction(task.description) || typeof task.title !== 'string' ||
      !task.title.trim() || /^\s*AI Core bridge command\b/i.test(task.title))
    return fail('FRESH_TASK_INSTRUCTION_REQUIRED');
  return Object.freeze({
    eligible:true,reason:'PREPARATION_ELIGIBLE_NO_DISPATCH_AUTHORITY',
    instruction:task.description,taskId:task.id,auditId:audit.id,
    dispatchPermitted:false,operatorApprovalGranted:false
  });
}
// Exact old bridge-placeholder task conversion. This is an explicit, separately
// audited EDIT to the existing DEV task, never approval to run GPT02.
export function assessGpt02HistoricalInstructionRepair(facts={}) {
  const denied=commonAdmission(facts);
  if (denied) return denied;
  const {task,audit}=facts;
  if (typeof task.title !== 'string' || typeof task.description !== 'string' ||
      !/^AI Core bridge command [a-f0-9]{8}$/i.test(task.title) ||
      task.title !== task.description)
    return fail('HISTORICAL_PLACEHOLDER_NOT_VERIFIED');
  const title=`GPT02 DEV fresh E2E Task #${task.id}`;
  const description=`DEV E2E verification only for Task #${task.id}. Reply exactly GPT02_DEV_E2E_${task.id}_ACK. Do not modify code, files, repositories, deployments, databases, credentials, external systems or PROD.`;
  if (!freshInstruction(description)) return fail('FRESH_TASK_INSTRUCTION_REQUIRED');
  return Object.freeze({
    eligible:true,reason:'HISTORICAL_REFERENCE_CAN_BE_REPLACED_NO_DISPATCH',
    taskId:task.id,auditId:audit.id,title,description,
    dispatchPermitted:false,operatorApprovalGranted:false
  });
}
