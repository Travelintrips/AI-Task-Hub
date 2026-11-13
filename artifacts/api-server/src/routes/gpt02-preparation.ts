import { Router, type IRouter, type Request, type Response } from "express";
import { Pool } from "pg";
import { and, desc, eq } from "drizzle-orm";
import {
  aiExecutionJobsTable, aiTasksTable, teamMembersTable, auditLogsTable, db,
} from "@workspace/db";
import { getCompanyIdForWrite, requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { assessGpt02PreparationAdmission } from "../lib/gpt02-preparation-admission.mjs";
import { createCoreTaskPreparer } from "../lib/gpt02-core-task-preparation.mjs";

const router: IRouter = Router();

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
    const [task]=await db.select({
      id:aiTasksTable.id,companyId:aiTasksTable.companyId,status:aiTasksTable.status,
      source:aiTasksTable.source,title:aiTasksTable.title,description:aiTasksTable.description,
      assignedToId:aiTasksTable.assignedToId,assignedTo:aiTasksTable.assignedTo,
    }).from(aiTasksTable).where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId)))
      .limit(1);
    if (!task) {res.sendStatus(404);return;}
    const [member]=task.assignedToId
      ? await db.select({id:teamMembersTable.id,name:teamMembersTable.name,isActive:teamMembersTable.isActive})
        .from(teamMembersTable)
        .where(and(eq(teamMembersTable.id,task.assignedToId),
          eq(teamMembersTable.companyId,companyId))).limit(1)
      : [];
    const [audit]=await db.select({id:auditLogsTable.id,after:auditLogsTable.after,userEmail:auditLogsTable.userEmail})
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.companyId,companyId),eq(auditLogsTable.entityId,taskId),
        eq(auditLogsTable.action,"gpt02_pic_assigned")))
      .orderBy(desc(auditLogsTable.createdAt),desc(auditLogsTable.id)).limit(1);
    const existing=await db.select({id:aiExecutionJobsTable.id}).from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.companyId,companyId),
        eq(aiExecutionJobsTable.taskId,taskId))).limit(1);
    const admission=assessGpt02PreparationAdmission({
      task,member:member??null,audit:audit??null,actor:req.user
        ? {id:req.user.id,email:req.user.email,role:req.user.role} : null,
      companyId,existingExecutionCount:existing.length,
    });
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
export default router;
