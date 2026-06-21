import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, gte } from "drizzle-orm";
import {
  db,
  routingRulesTable, insertRoutingRuleSchema,
  slaMatrixTable, insertSlaMatrixSchema,
  escalationRulesTable, insertEscalationRuleSchema,
  escalationLogsTable,
  approvalRulesTable, insertApprovalRuleSchema,
  approvalRequestsTable,
  aiTasksTable,
} from "@workspace/db";
import { requireAuth, requireRole, getCompanyId, getCompanyIdForWrite } from "../middleware/auth";
import { logger } from "../lib/logger";
import { resolveRouting, resolveSla, resolveApproval } from "../lib/governance-resolver";

const router: IRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// ROUTING RULES
// ══════════════════════════════════════════════════════════════════════════════

router.get("/governance/routing-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(routingRulesTable)
      .where(eq(routingRulesTable.companyId, companyId))
      .orderBy(desc(routingRulesTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /governance/routing-rules failed");
    res.status(500).json({ error: "Gagal memuat routing rules" });
  }
});

router.post("/governance/routing-rules", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const parsed = insertRoutingRuleSchema.safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const [row] = await db.insert(routingRulesTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /governance/routing-rules failed");
    res.status(500).json({ error: "Gagal membuat routing rule" });
  }
});

router.patch("/governance/routing-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.update(routingRulesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(routingRulesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Rule tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /governance/routing-rules/:id failed");
    res.status(500).json({ error: "Gagal memperbarui routing rule" });
  }
});

router.delete("/governance/routing-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(routingRulesTable).where(eq(routingRulesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /governance/routing-rules/:id failed");
    res.status(500).json({ error: "Gagal menghapus routing rule" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SLA MATRIX
// ══════════════════════════════════════════════════════════════════════════════

router.get("/governance/sla-matrix", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(slaMatrixTable)
      .where(eq(slaMatrixTable.companyId, companyId))
      .orderBy(desc(slaMatrixTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /governance/sla-matrix failed");
    res.status(500).json({ error: "Gagal memuat SLA matrix" });
  }
});

router.post("/governance/sla-matrix", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const parsed = insertSlaMatrixSchema.safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const [row] = await db.insert(slaMatrixTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /governance/sla-matrix failed");
    res.status(500).json({ error: "Gagal membuat SLA rule" });
  }
});

router.patch("/governance/sla-matrix/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.update(slaMatrixTable).set({ ...req.body, updatedAt: new Date() }).where(eq(slaMatrixTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "SLA rule tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /governance/sla-matrix/:id failed");
    res.status(500).json({ error: "Gagal memperbarui SLA rule" });
  }
});

router.delete("/governance/sla-matrix/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(slaMatrixTable).where(eq(slaMatrixTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /governance/sla-matrix/:id failed");
    res.status(500).json({ error: "Gagal menghapus SLA rule" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCALATION RULES
// ══════════════════════════════════════════════════════════════════════════════

router.get("/governance/escalation-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(escalationRulesTable)
      .where(eq(escalationRulesTable.companyId, companyId))
      .orderBy(desc(escalationRulesTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /governance/escalation-rules failed");
    res.status(500).json({ error: "Gagal memuat escalation rules" });
  }
});

router.post("/governance/escalation-rules", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const parsed = insertEscalationRuleSchema.safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const [row] = await db.insert(escalationRulesTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /governance/escalation-rules failed");
    res.status(500).json({ error: "Gagal membuat escalation rule" });
  }
});

router.patch("/governance/escalation-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.update(escalationRulesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(escalationRulesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Escalation rule tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /governance/escalation-rules/:id failed");
    res.status(500).json({ error: "Gagal memperbarui escalation rule" });
  }
});

router.delete("/governance/escalation-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(escalationRulesTable).where(eq(escalationRulesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /governance/escalation-rules/:id failed");
    res.status(500).json({ error: "Gagal menghapus escalation rule" });
  }
});

// ── Escalation Logs ───────────────────────────────────────────────────────────

router.get("/governance/escalation-logs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
    const rows = await db.select().from(escalationLogsTable)
      .where(eq(escalationLogsTable.companyId, companyId))
      .orderBy(desc(escalationLogsTable.firedAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /governance/escalation-logs failed");
    res.status(500).json({ error: "Gagal memuat escalation logs" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// APPROVAL RULES
// ══════════════════════════════════════════════════════════════════════════════

router.get("/governance/approval-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(approvalRulesTable)
      .where(eq(approvalRulesTable.companyId, companyId))
      .orderBy(desc(approvalRulesTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /governance/approval-rules failed");
    res.status(500).json({ error: "Gagal memuat approval rules" });
  }
});

router.post("/governance/approval-rules", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const parsed = insertApprovalRuleSchema.safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const [row] = await db.insert(approvalRulesTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /governance/approval-rules failed");
    res.status(500).json({ error: "Gagal membuat approval rule" });
  }
});

router.patch("/governance/approval-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.update(approvalRulesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(approvalRulesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Approval rule tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /governance/approval-rules/:id failed");
    res.status(500).json({ error: "Gagal memperbarui approval rule" });
  }
});

router.delete("/governance/approval-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(approvalRulesTable).where(eq(approvalRulesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /governance/approval-rules/:id failed");
    res.status(500).json({ error: "Gagal menghapus approval rule" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// APPROVAL REQUESTS
// ══════════════════════════════════════════════════════════════════════════════

router.get("/governance/approval-requests", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
    const rows = await db.select().from(approvalRequestsTable)
      .where(and(
        eq(approvalRequestsTable.companyId, companyId),
        ...(status ? [eq(approvalRequestsTable.status, status)] : []),
      ))
      .orderBy(desc(approvalRequestsTable.requestedAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /governance/approval-requests failed");
    res.status(500).json({ error: "Gagal memuat approval requests" });
  }
});

router.post("/governance/approval-requests/:id/decide", requireAuth, requireRole("supervisor"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { decision, notes } = req.body as { decision: "approved" | "rejected"; notes?: string };

    if (!["approved", "rejected"].includes(decision)) {
      res.status(400).json({ error: "decision harus 'approved' atau 'rejected'" });
      return;
    }

    const [existing] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Approval request tidak ditemukan" }); return; }
    if (existing.status !== "pending") { res.status(409).json({ error: `Request sudah ${existing.status}` }); return; }

    const [updated] = await db.update(approvalRequestsTable)
      .set({ status: decision, decidedBy: req.user?.name ?? "system", decidedAt: new Date(), notes: notes ?? null, updatedAt: new Date() })
      .where(eq(approvalRequestsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "POST /governance/approval-requests/:id/decide failed");
    res.status(500).json({ error: "Gagal memproses keputusan approval" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SIMULATOR
// ══════════════════════════════════════════════════════════════════════════════

router.post("/governance/simulate", requireAuth, requireRole("supervisor"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? getCompanyIdForWrite(req);
    const { intentCode, category, priority } = req.body as {
      intentCode?: string;
      category?: string;
      priority?: string;
    };

    const [routing, sla, approval] = await Promise.all([
      resolveRouting(companyId, intentCode ?? null, category ?? null, priority ?? null),
      resolveSla(companyId, intentCode ?? null, category ?? null, priority ?? null),
      resolveApproval(companyId, intentCode ?? null, category ?? null, priority ?? null),
    ]);

    res.json({
      input: { intentCode, category, priority },
      routing,
      sla,
      approval,
      resolvedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /governance/simulate failed");
    res.status(500).json({ error: "Simulator gagal" });
  }
});

export default router;
