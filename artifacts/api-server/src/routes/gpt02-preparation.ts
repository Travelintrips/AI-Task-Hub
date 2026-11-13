import { Router, type IRouter, type Request, type Response } from "express";
import { Pool } from "pg";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  aiExecutionJobsTable, aiTasksTable, teamMembersTable, auditLogsTable, db,
} from "@workspace/db";
import { getCompanyIdForWrite, requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import {
  assessGpt02PreparationAdmission, assessGpt02HistoricalInstructionRepair,
} from "../lib/gpt02-preparation-admission.mjs";
import { createCoreTaskPreparer } from "../lib/gpt02-core-task-preparation.mjs";

const router: IRouter = Router();

// Shared server-derived readback: the GET readiness and POST admission must
// assess precisely the same persisted task, PIC and audit facts.
async function readPreparationFacts(
  taskId: number, companyId: string,
  actor: {id: string|number;email: string;role: string}|null,
) {
  const [task]=await db.select({
    id:aiTasksTable.id,companyId:aiTasksTable.companyId,status:aiTasksTable.status,
    source:aiTasksTable.source,title:aiTasksTable.title,description:aiTasksTable.description,
    assignedToId:aiTasksTable.assignedToId,assignedTo:aiTasksTable.assignedTo,
  }).from(aiTasksTable)
    .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId))).limit(1);
  if (!task) return null;
  const [member]=task.assignedToId
    ? await db.select({id:teamMembersTable.id,name:teamMembersTable.name,isActive:teamMembersTable.isActive})
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.id,task.assignedToId),
        eq(teamMembersTable.companyId,companyId))).limit(1)
    : [];
  const [audit]=await db.select({
    id:auditLogsTable.id,after:auditLogsTable.after,userEmail:auditLogsTable.userEmail,
  }).from(auditLogsTable)
    .where(and(eq(auditLogsTable.companyId,companyId),eq(auditLogsTable.entityId,taskId),
      eq(auditLogsTable.action,"gpt02_pic_assigned")))
    .orderBy(desc(auditLogsTable.createdAt),desc(auditLogsTable.id)).limit(1);
  const executions=await db.select({id:aiExecutionJobsTable.id}).from(aiExecutionJobsTable)
    .where(and(eq(aiExecutionJobsTable.companyId,companyId),
      eq(aiExecutionJobsTable.taskId,taskId))).limit(1);
  const facts={task,member:member??null,audit:audit??null,actor,companyId,
    existingExecutionCount:executions.length};
  return {
    preparation:assessGpt02PreparationAdmission(facts),
    historicalRepair:assessGpt02HistoricalInstructionRepair(facts),
  };
}

// Readiness is not a cryptographic grant: it returns no secrets or command
// authority, and cannot start a prepared task or alter any runtime state.
router.get("/ai-tasks/:id/gpt02-preparation-readiness", requireAuth,
  async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control","no-store");
  if (process.env.NODE_ENV!=="development" || process.env.APP_ENV!=="development") {
    res.sendStatus(404);return;
  }
  if (req.user?.role!=="super_admin") {
    res.status(403).json({error:"SUPER_ADMIN_REQUIRED",dispatchPermitted:false});return;
  }
  const taskId=Number(req.params.id);
  if (!Number.isSafeInteger(taskId) || taskId<=136) {
    res.status(400).json({error:"FRESH_DEV_TASK_ID_REQUIRED",dispatchPermitted:false});return;
  }
  try {
    const companyId=getCompanyIdForWrite(req);
    if (companyId!=="default") {
      res.status(403).json({error:"CST_DEV_COMPANY_SCOPE_REQUIRED",dispatchPermitted:false});return;
    }
    const facts=await readPreparationFacts(taskId,companyId,
      req.user?{id:req.user.id,email:req.user.email,role:req.user.role}:null);
    if (!facts) {res.sendStatus(404);return;}
    const featureEnabled=process.env.GPT02_CORE_PREPARATION_ENABLED==="true";
    res.status(200).json({
      taskId,preparationEligible:facts.preparation.eligible,
      historicalRepairAvailable:facts.historicalRepair.eligible,
      featureEnabled,
      canRequestPreparation:featureEnabled&&facts.preparation.eligible,
      reason:!facts.preparation.eligible?facts.preparation.reason:
        featureEnabled?"READY_FOR_PREPARATION_ONLY":"GPT02_CORE_PREPARATION_NOT_ENABLED",
      readOnly:true,commandDispatched:false,operatorApprovalGranted:false,
      dispatchPermitted:false,issuerGrantReady:false,
    });
  } catch {
    logger.warn({taskId,code:"GPT02_PREPARATION_READINESS_UNAVAILABLE"},
      "GPT02 preparation readback unavailable");
    res.status(503).json({error:"GPT02_PREPARATION_READINESS_UNAVAILABLE",
      readOnly:true,dispatchPermitted:false});
  }
});

// A task-specific, explicitly requested PREPARATION only. Inactive by default.
// The dedicated PostgreSQL login can create a PENDING Core task/prepared Hub
// execution, but NEVER issues commands, operator approval, leases or dispatch.
router.post("/ai-tasks/:id/gpt02-prepare", requireAuth,
  async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV !== "development") {
    res.sendStatus(404); return;
  }
  if (req.user?.role !== "super_admin") {
    res.status(403).json({error:"SUPER_ADMIN_REQUIRED",dispatchPermitted:false}); return;
  }
  const origin = req.get("origin"),host=req.get("host");
  try {
    const parsed=new URL(origin ?? "");
    if (!host || parsed.protocol!=="https:" || parsed.host!==host) {
      res.status(403).json({error:"SAME_ORIGIN_REQUIRED",dispatchPermitted:false}); return;
    }
  } catch {
    res.status(403).json({error:"SAME_ORIGIN_REQUIRED",dispatchPermitted:false}); return;
  }
  if (req.get("x-gpt02-intent") !== "prepare-only" ||
      !req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 || req.body.prepareOnly !== true) {
    res.status(400).json({error:"EXPLICIT_PREPARE_ONLY_INTENT_REQUIRED",dispatchPermitted:false});
    return;
  }
  const taskId=Number(req.params.id);
  if (!Number.isSafeInteger(taskId) || taskId<=136) {
    res.status(400).json({error:"FRESH_DEV_TASK_ID_REQUIRED",dispatchPermitted:false}); return;
  }
  try {
    const companyId=getCompanyIdForWrite(req);
    if (companyId!=="default") {
      res.status(403).json({error:"CST_DEV_COMPANY_SCOPE_REQUIRED",dispatchPermitted:false}); return;
    }
    const facts=await readPreparationFacts(taskId,companyId,
      req.user?{id:req.user.id,email:req.user.email,role:req.user.role}:null);
    if (!facts) {res.sendStatus(404);return;}
    const admission=facts.preparation;
    if (!admission.eligible || !admission.instruction) {
      res.status(409).json({
        error:admission.reason,prepared:false,
        operatorApprovalGranted:false,dispatchPermitted:false,
      }); return;
    }
    // Never grant preparation through the regular Hub DB login, including
    // service_role and the general app's pool. A dedicated role with TLS and
    // its own least-privilege credential is the only supported path.
    if (process.env.GPT02_CORE_PREPARATION_ENABLED !== "true") {
      res.status(503).json({
        error:"GPT02_CORE_PREPARATION_NOT_ENABLED",prepared:false,
        operatorApprovalGranted:false,dispatchPermitted:false,
      }); return;
    }
    let factory: ReturnType<typeof createCoreTaskPreparer> | undefined;
    try {
      factory=createCoreTaskPreparer({env:process.env,PoolClass:Pool});
      const prepared=await factory.preparer.prepare({
        companyId,hubTaskId:taskId,projectName:"GPT02 DEV coding lifecycle",
        repository:"Travelintrips/Core-AI-Foundation",branch:"develop",
        instruction:admission.instruction,
      });
      // A preparation reservation is not approval and never wakes a worker.
      res.status(200).json({
        ...prepared,taskId,auditId:admission.auditId,
        preparedOnly:true,operatorApprovalGranted:false,dispatchPermitted:false,
        continuationScheduled:false,commandDispatched:false,
      });
    } finally {
      if (factory) await factory.close();
    }
  } catch (err) {
    logger.warn({taskId,code:"GPT02_PREPARATION_UNAVAILABLE"},
      "Scoped GPT02 DEV preparation failed closed");
    res.status(503).json({
      error:"GPT02_PREPARATION_UNAVAILABLE",prepared:false,
      operatorApprovalGranted:false,dispatchPermitted:false,
    });
  }
});
// Explicit one-time repair for a verified historical command placeholder.
// This only updates the existing task's title and instruction, with an atomic
// audit record. It NEVER touches execution, Core commands, grants or workers.
router.post("/ai-tasks/:id/gpt02-replace-historical-reference", requireAuth,
  async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV!=="development" || process.env.APP_ENV!=="development") {
    res.sendStatus(404);return;
  }
  if (req.user?.role!=="super_admin") {
    res.status(403).json({error:"SUPER_ADMIN_REQUIRED",dispatchPermitted:false});return;
  }
  try {
    const origin=new URL(req.get("origin")??"");
    if (origin.protocol!=="https:" || !req.get("host") || origin.host!==req.get("host")) {
      res.status(403).json({error:"SAME_ORIGIN_REQUIRED",dispatchPermitted:false});return;
    }
  } catch {
    res.status(403).json({error:"SAME_ORIGIN_REQUIRED",dispatchPermitted:false});return;
  }
  if (req.get("x-gpt02-intent")!=="replace-historical-reference" ||
      !req.body || typeof req.body!=="object" || Array.isArray(req.body) ||
      Object.keys(req.body).length!==1 || req.body.replaceHistoricalReference!==true) {
    res.status(400).json({error:"EXPLICIT_REPLACEMENT_INTENT_REQUIRED",dispatchPermitted:false});return;
  }
  const taskId=Number(req.params.id), companyId=getCompanyIdForWrite(req);
  if (!Number.isSafeInteger(taskId) || taskId<=136 || companyId!=="default") {
    res.status(400).json({error:"FRESH_DEV_TASK_SCOPE_REQUIRED",dispatchPermitted:false});return;
  }
  try {
    const result=await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId} || ':' || ${taskId}::text, 0))`);
      const [task]=await tx.select({
        id:aiTasksTable.id,companyId:aiTasksTable.companyId,status:aiTasksTable.status,
        source:aiTasksTable.source,title:aiTasksTable.title,description:aiTasksTable.description,
        assignedToId:aiTasksTable.assignedToId,assignedTo:aiTasksTable.assignedTo,
      }).from(aiTasksTable)
        .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId))).limit(1);
      const [member]=task?.assignedToId
        ? await tx.select({id:teamMembersTable.id,name:teamMembersTable.name,isActive:teamMembersTable.isActive})
          .from(teamMembersTable)
          .where(and(eq(teamMembersTable.id,task.assignedToId),
            eq(teamMembersTable.companyId,companyId))).limit(1)
        : [];
      const [audit]=await tx.select({
        id:auditLogsTable.id,after:auditLogsTable.after,userEmail:auditLogsTable.userEmail,
      }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.companyId,companyId),eq(auditLogsTable.entityId,taskId),
          eq(auditLogsTable.action,"gpt02_pic_assigned")))
        .orderBy(desc(auditLogsTable.createdAt),desc(auditLogsTable.id)).limit(1);
      const existing=await tx.select({id:aiExecutionJobsTable.id}).from(aiExecutionJobsTable)
        .where(and(eq(aiExecutionJobsTable.companyId,companyId),eq(aiExecutionJobsTable.taskId,taskId)))
        .limit(1);
      const accepted=assessGpt02HistoricalInstructionRepair({
        task:task??null,member:member??null,audit:audit??null,
        actor:req.user ? {id:req.user.id,email:req.user.email,role:req.user.role} : null,
        companyId,existingExecutionCount:existing.length,
      });
      if (!accepted.eligible || !accepted.title || !accepted.description || !task)
        return {updated:false,reason:accepted.reason};
      const [updated]=await tx.update(aiTasksTable)
        .set({title:accepted.title,description:accepted.description})
        .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId),
          eq(aiTasksTable.title,task.title),
          eq(aiTasksTable.description,task.description ?? ""),
          eq(aiTasksTable.status,"new_inquiry"),
          eq(aiTasksTable.assignedToId,task.assignedToId!)))
        .returning({id:aiTasksTable.id});
      if (!updated)return {updated:false,reason:"TASK_MODIFIED_CONCURRENTLY"};
      await tx.insert(auditLogsTable).values({
        action:"gpt02_e2e_instruction_replaced",module:"ai_tasks",
        entityType:"ai_task",entityId:taskId,companyId,userId:req.user!.id,
        userEmail:req.user!.email,userName:req.user!.name,
        before:JSON.stringify({title:task.title,description:task.description}),
        after:JSON.stringify({
          title:accepted.title,description:accepted.description,
          picAssignmentAuditId:accepted.auditId,operatorApprovalGranted:false,
          dispatchPermitted:false,commandDispatched:false,
        }),
      });
      return {updated:true,reason:"HISTORICAL_REFERENCE_REPLACED",
        taskId,title:accepted.title,description:accepted.description,
        prepared:false,operatorApprovalGranted:false,dispatchPermitted:false,
        commandDispatched:false};
    });
    if (!result.updated) {
      res.status(409).json({error:result.reason,updated:false,dispatchPermitted:false});return;
    }
    res.status(200).json(result);
  } catch {
    logger.warn({taskId,code:"GPT02_INSTRUCTION_REPAIR_UNAVAILABLE"},
      "Scoped GPT02 task instruction repair failed closed");
    res.status(503).json({error:"GPT02_INSTRUCTION_REPAIR_UNAVAILABLE",
      updated:false,dispatchPermitted:false});
  }
});
export default router;
