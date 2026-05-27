import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, documentAuditsTable } from "@workspace/db";
import { generateWhatsAppReply } from "../lib/audit";
import type { AuditCheckItem } from "../lib/audit";
import { runAuditForTask } from "../lib/run-audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/tasks/:taskId/audit", async (req, res): Promise<void> => {
  const taskId = Number(req.params.taskId);
  if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const audit = await runAuditForTask(taskId);

  res.status(201).json({
    ...audit,
    createdAt: audit.createdAt.toISOString(),
    updatedAt: audit.updatedAt.toISOString(),
  });
});

router.get("/tasks/:taskId/audit", async (req, res): Promise<void> => {
  const taskId = Number(req.params.taskId);
  if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const [audit] = await db
    .select()
    .from(documentAuditsTable)
    .where(eq(documentAuditsTable.taskId, taskId))
    .orderBy(desc(documentAuditsTable.createdAt))
    .limit(1);

  if (!audit) { res.status(404).json({ error: "No audit found for this task" }); return; }

  res.json({
    ...audit,
    createdAt: audit.createdAt.toISOString(),
    updatedAt: audit.updatedAt.toISOString(),
  });
});

router.get("/tasks/:taskId/audits", async (req, res): Promise<void> => {
  const taskId = Number(req.params.taskId);
  if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const audits = await db
    .select()
    .from(documentAuditsTable)
    .where(eq(documentAuditsTable.taskId, taskId))
    .orderBy(desc(documentAuditsTable.createdAt));

  res.json(audits.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  })));
});

router.get("/audits/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid audit ID" }); return; }

  const [audit] = await db
    .select()
    .from(documentAuditsTable)
    .where(eq(documentAuditsTable.id, id));

  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }

  res.json({
    ...audit,
    createdAt: audit.createdAt.toISOString(),
    updatedAt: audit.updatedAt.toISOString(),
  });
});

router.post("/audits/:id/whatsapp-reply", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid audit ID" }); return; }

  const [audit] = await db
    .select()
    .from(documentAuditsTable)
    .where(eq(documentAuditsTable.id, id));

  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }

  const missingFields = Array.isArray(audit.missingFields) ? (audit.missingFields as string[]) : [];
  const mismatchFields = Array.isArray(audit.mismatchFields) ? (audit.mismatchFields as string[]) : [];
  const unclearFields = Array.isArray(audit.unclearFields) ? (audit.unclearFields as string[]) : [];

  const message = await generateWhatsAppReply(missingFields, mismatchFields, unclearFields);
  res.json({ message });
});

router.patch("/audits/:id/status", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid audit ID" }); return; }

  const { auditStatus } = req.body as { auditStatus?: string };
  if (!auditStatus) { res.status(400).json({ error: "auditStatus is required" }); return; }

  const [audit] = await db
    .update(documentAuditsTable)
    .set({ auditStatus })
    .where(eq(documentAuditsTable.id, id))
    .returning();

  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }

  res.json({
    ...audit,
    createdAt: audit.createdAt.toISOString(),
    updatedAt: audit.updatedAt.toISOString(),
  });
});

export default router;
