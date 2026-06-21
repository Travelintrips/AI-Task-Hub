/**
 * Sprint 5A — Customer Memory Center API
 * Phase 1: Profile Memory, Timeline, Preferences, Risk, Aggregates
 * Phase 2: Memory Snapshots, AI Context
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  customersTable,
  aiTasksTable,
  whatsappMessagesTable,
  quotationsTable,
  taskAttachmentsTable,
  customerPreferencesTable,
  customerRiskAssessmentsTable,
  customerMemorySnapshotsTable,
  customerMemoryEventsTable,
  customerDocumentRegistryTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { sql, eq, and, desc, or, ne, asc, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function cid(req: Request): string {
  return getCompanyId(req) ?? req.user!.companyId ?? "default";
}

async function findCustomer(companyId: string, id: number) {
  const [c] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId)))
    .limit(1);
  return c ?? null;
}

async function logMemoryEvent(
  companyId: string,
  customerId: number,
  eventType: string,
  actorId: string | undefined,
  actorType: "user" | "ai" | "system",
  entityType: string | null,
  entityId: number | null,
  payload: Record<string, unknown> | null,
  notes?: string,
) {
  try {
    await db.insert(customerMemoryEventsTable).values({
      companyId,
      customerId,
      eventType,
      actorId,
      actorType,
      entityType: entityType ?? undefined,
      entityId: entityId ?? undefined,
      payload: payload as any,
      notes,
    });
  } catch (e) {
    logger.warn({ e }, "logMemoryEvent failed (non-fatal)");
  }
}

// ── GET /api/crm/customers/:id/memory ────────────────────────────────────────
// Full profile memory: customer + active risk + latest snapshot + aggregates view

router.get("/crm/customers/:id/memory", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const customer = await findCustomer(companyId, id);
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

    // Active risk assessment
    const [activeRisk] = await db
      .select()
      .from(customerRiskAssessmentsTable)
      .where(and(eq(customerRiskAssessmentsTable.companyId, companyId), eq(customerRiskAssessmentsTable.customerId, id), eq(customerRiskAssessmentsTable.isActive, true)))
      .orderBy(desc(customerRiskAssessmentsTable.assessedAt))
      .limit(1);

    // Latest non-stale memory snapshot
    const [latestSnapshot] = await db
      .select({
        id: customerMemorySnapshotsTable.id,
        version: customerMemorySnapshotsTable.version,
        aiContextBlock: customerMemorySnapshotsTable.aiContextBlock,
        freshnessScore: customerMemorySnapshotsTable.freshnessScore,
        isStale: customerMemorySnapshotsTable.isStale,
        openTasksCount: customerMemorySnapshotsTable.openTasksCount,
        lastNIntents: customerMemorySnapshotsTable.lastNIntents,
        frequentServices: customerMemorySnapshotsTable.frequentServices,
        missingDocsList: customerMemorySnapshotsTable.missingDocsList,
        sentimentTrend: customerMemorySnapshotsTable.sentimentTrend,
        createdAt: customerMemorySnapshotsTable.createdAt,
      })
      .from(customerMemorySnapshotsTable)
      .where(and(eq(customerMemorySnapshotsTable.companyId, companyId), eq(customerMemorySnapshotsTable.customerId, id)))
      .orderBy(desc(customerMemorySnapshotsTable.createdAt))
      .limit(1);

    // Financial aggregates from view
    const aggRows = await db.execute(
      sql`SELECT * FROM customer_aggregates WHERE customer_id = ${id} AND company_id = ${companyId} LIMIT 1`
    );
    const agg = (aggRows.rows?.[0] ?? null) as Record<string, unknown> | null;

    // Active preferences
    const preferences = await db
      .select()
      .from(customerPreferencesTable)
      .where(and(eq(customerPreferencesTable.companyId, companyId), eq(customerPreferencesTable.customerId, id), eq(customerPreferencesTable.status, "active")))
      .orderBy(asc(customerPreferencesTable.category), asc(customerPreferencesTable.key));

    res.json({
      customer,
      activeRisk: activeRisk ?? null,
      latestSnapshot: latestSnapshot ?? null,
      aggregates: agg,
      preferences,
    });
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/memory failed");
    res.status(500).json({ error: "Failed to load customer memory" });
  }
});

// ── GET /api/crm/customers/:id/aggregates ────────────────────────────────────
// Financial + task aggregates from the view (read-only, no persistent storage)

router.get("/crm/customers/:id/aggregates", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const rows = await db.execute(
      sql`SELECT * FROM customer_aggregates WHERE customer_id = ${id} AND company_id = ${companyId} LIMIT 1`
    );
    const agg = rows.rows?.[0] ?? null;
    if (!agg) { res.status(404).json({ error: "No aggregate data found" }); return; }
    res.json(agg);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/aggregates failed");
    res.status(500).json({ error: "Failed to load aggregates" });
  }
});

// ── GET /api/crm/customers/:id/timeline ──────────────────────────────────────
// Unified interaction timeline from tasks, messages, quotations

router.get("/crm/customers/:id/timeline", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const customer = await findCustomer(companyId, id);
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

    const source = (req.query.source as string | undefined)?.split(",") ?? ["task", "message", "quotation"];
    const days = Math.min(Number(req.query.days ?? 90), 365);
    const since = new Date(Date.now() - days * 86400_000);
    const limit = Math.min(Number(req.query.limit ?? 100), 200);

    const events: {
      eventId: string; source: string; happenedAt: string;
      title: string; body: string | null; metadata: Record<string, unknown>;
    }[] = [];

    // Tasks
    if (source.includes("task")) {
      const tasks = await db
        .select({
          id: aiTasksTable.id, taskNumber: aiTasksTable.taskNumber, title: aiTasksTable.title,
          status: aiTasksTable.status, aiIntent: aiTasksTable.aiIntent,
          priority: aiTasksTable.priority, category: aiTasksTable.category,
          createdAt: aiTasksTable.createdAt, completedAt: aiTasksTable.completedAt,
          customerSentiment: aiTasksTable.customerSentiment,
        })
        .from(aiTasksTable)
        .where(and(eq(aiTasksTable.companyId, companyId), eq(aiTasksTable.customerId, id), isNotNull(aiTasksTable.createdAt)))
        .orderBy(desc(aiTasksTable.createdAt))
        .limit(limit);

      for (const t of tasks) {
        events.push({
          eventId: `task_${t.id}`,
          source: "task",
          happenedAt: t.createdAt.toISOString(),
          title: `Task ${t.taskNumber ?? "#" + t.id}: ${t.title}`,
          body: t.aiIntent ? `Intent: ${t.aiIntent}` : null,
          metadata: { taskId: t.id, status: t.status, priority: t.priority, category: t.category, sentiment: t.customerSentiment },
        });
      }
    }

    // WhatsApp messages
    if (source.includes("message")) {
      const msgs = await db
        .select({
          id: whatsappMessagesTable.id,
          body: whatsappMessagesTable.body,
          direction: whatsappMessagesTable.direction,
          detectedIntent: whatsappMessagesTable.detectedIntent,
          sentiment: whatsappMessagesTable.sentiment,
          createdAt: whatsappMessagesTable.createdAt,
        })
        .from(whatsappMessagesTable)
        .where(and(eq(whatsappMessagesTable.companyId, companyId), eq(whatsappMessagesTable.customerId, id), isNotNull(whatsappMessagesTable.createdAt)))
        .orderBy(desc(whatsappMessagesTable.createdAt))
        .limit(limit);

      for (const m of msgs) {
        events.push({
          eventId: `message_${m.id}`,
          source: "message",
          happenedAt: m.createdAt.toISOString(),
          title: m.direction === "inbound" ? "Pesan WA masuk" : "Balasan WA terkirim",
          body: m.body.slice(0, 200),
          metadata: { messageId: m.id, direction: m.direction, intent: m.detectedIntent, sentiment: m.sentiment },
        });
      }
    }

    // Quotations
    if (source.includes("quotation")) {
      const quotes = await db
        .select({
          id: quotationsTable.id,
          quotationNumber: quotationsTable.quotationNumber,
          title: quotationsTable.title,
          totalAmount: quotationsTable.totalAmount,
          currency: quotationsTable.currency,
          status: quotationsTable.status,
          createdAt: quotationsTable.createdAt,
          sentAt: quotationsTable.sentAt,
        })
        .from(quotationsTable)
        .where(and(eq(quotationsTable.companyId, companyId), eq(quotationsTable.customerId, id), isNotNull(quotationsTable.createdAt)))
        .orderBy(desc(quotationsTable.createdAt))
        .limit(50);

      for (const q of quotes) {
        events.push({
          eventId: `quotation_${q.id}`,
          source: "quotation",
          happenedAt: q.createdAt.toISOString(),
          title: `Quotation ${q.quotationNumber ?? "#" + q.id}: ${q.title}`,
          body: q.totalAmount ? `${q.currency} ${Number(q.totalAmount).toLocaleString()}` : null,
          metadata: { quotationId: q.id, status: q.status, amount: q.totalAmount, currency: q.currency },
        });
      }
    }

    // Sort all by happenedAt desc, apply overall limit
    events.sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime());

    res.json({
      customerId: id,
      days,
      total: events.length,
      events: events.slice(0, limit),
    });
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/timeline failed");
    res.status(500).json({ error: "Failed to load timeline" });
  }
});

// ── GET /api/crm/customers/:id/preferences ───────────────────────────────────

router.get("/crm/customers/:id/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const statusFilter = (req.query.status as string | undefined) ?? "active";
    const rows = await db
      .select()
      .from(customerPreferencesTable)
      .where(
        and(
          eq(customerPreferencesTable.companyId, companyId),
          eq(customerPreferencesTable.customerId, id),
          eq(customerPreferencesTable.status, statusFilter),
        )
      )
      .orderBy(asc(customerPreferencesTable.category), asc(customerPreferencesTable.key));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/preferences failed");
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

// ── PUT /api/crm/customers/:id/preferences/:category/:key ────────────────────
// Upsert — supersedes any existing active preference with same category+key

router.put("/crm/customers/:id/preferences/:category/:key",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const { category, key } = req.params;
      const { value, valueJson, source = "manual", confidence, notes } = req.body as Record<string, unknown>;

      if (Number.isNaN(id) || !value) { res.status(400).json({ error: "id and value are required" }); return; }

      // Find existing active preference
      const [existing] = await db
        .select()
        .from(customerPreferencesTable)
        .where(
          and(
            eq(customerPreferencesTable.companyId, companyId),
            eq(customerPreferencesTable.customerId, id),
            eq(customerPreferencesTable.category, category),
            eq(customerPreferencesTable.key, key),
            eq(customerPreferencesTable.status, "active"),
          )
        )
        .limit(1);

      // Mark existing as superseded
      if (existing) {
        await db
          .update(customerPreferencesTable)
          .set({ status: "superseded", supersededAt: new Date() })
          .where(eq(customerPreferencesTable.id, existing.id));
      }

      // Insert new active preference
      const [created] = await db.insert(customerPreferencesTable).values({
        companyId,
        customerId: id,
        category,
        key,
        value: String(value),
        valueJson: valueJson as any ?? undefined,
        status: "active",
        source: String(source),
        confidence: confidence ? String(confidence) : undefined,
        createdBy: req.user?.id ? String(req.user.id) : undefined,
        supersededBy: existing ? existing.id : undefined,
      }).returning();

      if (existing) {
        // Update superseded_by on old record
        await db.update(customerPreferencesTable).set({ supersededBy: created!.id }).where(eq(customerPreferencesTable.id, existing.id));
      }

      await logMemoryEvent(companyId, id, "preference_updated", req.user?.id ? String(req.user.id) : undefined, "user", "customer_preference", created!.id, {
        category, key, oldValue: existing?.value ?? null, newValue: value,
      }, notes as string | undefined);

      res.json(created);
    } catch (err) {
      logger.error({ err }, "PUT /crm/customers/:id/preferences failed");
      res.status(500).json({ error: "Failed to upsert preference" });
    }
  }
);

// ── DELETE /api/crm/customers/:id/preferences/:category/:key ─────────────────

router.delete("/crm/customers/:id/preferences/:category/:key",
  requireAuth, requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const { category, key } = req.params;
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      await db
        .update(customerPreferencesTable)
        .set({ status: "inactive", supersededAt: new Date() })
        .where(
          and(
            eq(customerPreferencesTable.companyId, companyId),
            eq(customerPreferencesTable.customerId, id),
            eq(customerPreferencesTable.category, category),
            eq(customerPreferencesTable.key, key),
            eq(customerPreferencesTable.status, "active"),
          )
        );

      await logMemoryEvent(companyId, id, "preference_updated", req.user?.id ? String(req.user.id) : undefined, "user", "customer_preference", null, { category, key, action: "deactivated" });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE /crm/customers/:id/preferences failed");
      res.status(500).json({ error: "Failed to delete preference" });
    }
  }
);

// ── GET /api/crm/customers/:id/risk ──────────────────────────────────────────

router.get("/crm/customers/:id/risk", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const userRole = req.user?.role ?? "";
    const canSeeFactors = ["supervisor", "company_admin", "super_admin"].includes(userRole);

    const assessments = await db
      .select()
      .from(customerRiskAssessmentsTable)
      .where(and(eq(customerRiskAssessmentsTable.companyId, companyId), eq(customerRiskAssessmentsTable.customerId, id)))
      .orderBy(desc(customerRiskAssessmentsTable.assessedAt))
      .limit(20);

    type AssessmentRow = typeof assessments[number];
    const result: AssessmentRow[] = assessments.map((a) => ({
      ...a,
      factors: canSeeFactors ? a.factors : undefined,
      recommendations: canSeeFactors ? a.recommendations : undefined,
    }));

    res.json({
      active: result.find((a: AssessmentRow) => a.isActive) ?? null,
      history: result.filter((a: AssessmentRow) => !a.isActive),
    });
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/risk failed");
    res.status(500).json({ error: "Failed to load risk assessments" });
  }
});

// ── POST /api/crm/customers/:id/risk ─────────────────────────────────────────
// Creates new IMMUTABLE assessment, archives previous active one.

router.post("/crm/customers/:id/risk",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      const { riskScore, tier, creditLimit, factors, recommendations, notes, expiresAt } = req.body as Record<string, unknown>;
      if (riskScore == null || !tier) { res.status(400).json({ error: "riskScore and tier are required" }); return; }

      const customer = await findCustomer(companyId, id);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      // Get currently active assessment
      const [currentActive] = await db
        .select({ id: customerRiskAssessmentsTable.id, tier: customerRiskAssessmentsTable.tier })
        .from(customerRiskAssessmentsTable)
        .where(and(eq(customerRiskAssessmentsTable.companyId, companyId), eq(customerRiskAssessmentsTable.customerId, id), eq(customerRiskAssessmentsTable.isActive, true)))
        .orderBy(desc(customerRiskAssessmentsTable.assessedAt))
        .limit(1);

      // Insert new assessment first
      const [newAssessment] = await db.insert(customerRiskAssessmentsTable).values({
        companyId,
        customerId: id,
        assessedBy: req.user?.email ?? req.user?.id ?? "unknown",
        riskScore: Number(riskScore),
        tier: String(tier),
        previousTier: currentActive?.tier ?? customer.riskTier ?? null,
        creditLimit: creditLimit ? String(creditLimit) : undefined,
        factors: factors as any ?? undefined,
        recommendations: recommendations ? String(recommendations) : undefined,
        notes: notes ? String(notes) : undefined,
        expiresAt: expiresAt ? String(expiresAt) : undefined,
        isActive: true,
        archivedByAssessmentId: undefined,
      }).returning();

      // Archive the previous active assessment (immutable: only flip isActive)
      if (currentActive) {
        await db
          .update(customerRiskAssessmentsTable)
          .set({ isActive: false, archivedAt: new Date(), archivedByAssessmentId: newAssessment!.id })
          .where(eq(customerRiskAssessmentsTable.id, currentActive.id));
      }

      // Mirror risk_score and risk_tier to customers table for fast lookup
      await db
        .update(customersTable)
        .set({ riskScore: Number(riskScore), riskTier: String(tier), memoryUpdatedAt: new Date() })
        .where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId)));

      await logMemoryEvent(companyId, id, "risk_assessed", req.user?.id ? String(req.user.id) : undefined, "user", "customer_risk", newAssessment!.id, {
        riskScore, tier, previousTier: currentActive?.tier ?? null,
      });

      // Audit log
      await db.insert(auditLogsTable).values({
        action: "risk_assessment_created",
        module: "customer_risk",
        before: currentActive ? `tier=${currentActive.tier}` : "none",
        after: `tier=${tier}, score=${riskScore}`,
        entityId: id,
      });

      res.status(201).json(newAssessment);
    } catch (err) {
      logger.error({ err }, "POST /crm/customers/:id/risk failed");
      res.status(500).json({ error: "Failed to create risk assessment" });
    }
  }
);

// ── GET /api/crm/customers/:id/memory/events ─────────────────────────────────

router.get("/crm/customers/:id/memory/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const events = await db
      .select()
      .from(customerMemoryEventsTable)
      .where(and(eq(customerMemoryEventsTable.companyId, companyId), eq(customerMemoryEventsTable.customerId, id)))
      .orderBy(desc(customerMemoryEventsTable.createdAt))
      .limit(100);

    res.json(events);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/memory/events failed");
    res.status(500).json({ error: "Failed to load memory events" });
  }
});

// ── GET /api/crm/customers/:id/ai-context ────────────────────────────────────
// Latest memory snapshot (for Phase 2 preview — returns empty if not generated yet)

router.get("/crm/customers/:id/ai-context", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [snapshot] = await db
      .select()
      .from(customerMemorySnapshotsTable)
      .where(and(eq(customerMemorySnapshotsTable.companyId, companyId), eq(customerMemorySnapshotsTable.customerId, id)))
      .orderBy(desc(customerMemorySnapshotsTable.createdAt))
      .limit(1);

    res.json(snapshot ?? null);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/ai-context failed");
    res.status(500).json({ error: "Failed to load AI context" });
  }
});

// ── POST /api/crm/customers/:id/ai-context/refresh ───────────────────────────
// Generate a new memory snapshot via OpenAI. Marks previous snapshot as stale.

router.post("/crm/customers/:id/ai-context/refresh",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      const customer = await findCustomer(companyId, id);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      const { openai } = await import("../lib/openai");

      // Gather context for the snapshot
      const [recentTasks, recentMessages, activeRisk, activePrefs, aggRows] = await Promise.all([
        db.select({
          id: aiTasksTable.id, taskNumber: aiTasksTable.taskNumber, title: aiTasksTable.title,
          status: aiTasksTable.status, aiIntent: aiTasksTable.aiIntent, category: aiTasksTable.category,
          priority: aiTasksTable.priority, customerSentiment: aiTasksTable.customerSentiment, createdAt: aiTasksTable.createdAt,
        }).from(aiTasksTable).where(and(eq(aiTasksTable.companyId, companyId), eq(aiTasksTable.customerId, id))).orderBy(desc(aiTasksTable.createdAt)).limit(20),
        db.select({ body: whatsappMessagesTable.body, direction: whatsappMessagesTable.direction, detectedIntent: whatsappMessagesTable.detectedIntent, sentiment: whatsappMessagesTable.sentiment, createdAt: whatsappMessagesTable.createdAt })
          .from(whatsappMessagesTable).where(and(eq(whatsappMessagesTable.companyId, companyId), eq(whatsappMessagesTable.customerId, id))).orderBy(desc(whatsappMessagesTable.createdAt)).limit(10),
        db.select().from(customerRiskAssessmentsTable).where(and(eq(customerRiskAssessmentsTable.companyId, companyId), eq(customerRiskAssessmentsTable.customerId, id), eq(customerRiskAssessmentsTable.isActive, true))).limit(1),
        db.select().from(customerPreferencesTable).where(and(eq(customerPreferencesTable.companyId, companyId), eq(customerPreferencesTable.customerId, id), eq(customerPreferencesTable.status, "active"))),
        db.execute(sql`SELECT * FROM customer_aggregates WHERE customer_id = ${id} AND company_id = ${companyId} LIMIT 1`),
      ]);

      const agg = (aggRows.rows?.[0] ?? {}) as Record<string, unknown>;
      const risk = activeRisk[0] ?? null;
      const openTasks = recentTasks.filter((t: typeof recentTasks[number]) => !["completed", "cancelled"].includes(t.status));
      const lastNIntents = recentTasks.slice(0, 5).map((t: typeof recentTasks[number]) => t.aiIntent ?? t.category ?? "unknown").filter((x): x is string => x !== null && x !== undefined && x !== "");
      const sentiments = recentMessages.map((m: typeof recentMessages[number]) => m.sentiment).filter((s): s is string => s !== null && s !== undefined);
      const sentimentAvg = sentiments.length === 0 ? null : sentiments.filter((s: string) => s === "positive").length > sentiments.length / 2 ? "improving" : sentiments.filter((s: string) => s === "negative").length > sentiments.length / 2 ? "declining" : "stable";

      const contextPayload = {
        customer: { id: customer.id, companyName: customer.companyName, industry: customer.industry, tier: customer.tier },
        aggregates: { totalTasks: agg.total_tasks, openTasks: agg.open_tasks, lifetimeValue: agg.lifetime_value, avgOrderValue: agg.avg_order_value },
        risk: risk ? { score: risk.riskScore, tier: risk.tier, expiresAt: risk.expiresAt } : null,
        preferences: activePrefs.map((p) => `${p.category}/${p.key}=${p.value}`),
        recentIntents: lastNIntents,
        sentimentTrend: sentimentAvg,
        openTaskCount: openTasks.length,
        recentMessages: recentMessages.slice(0, 5).map((m) => ({ direction: m.direction, body: m.body.slice(0, 100), intent: m.detectedIntent })),
      };

      const systemPrompt = `Kamu adalah sistem AI yang menghasilkan "memory snapshot" tentang pelanggan bisnis logistik/freight forwarding.
Berdasarkan data interaksi pelanggan, buat ringkasan singkat (max 350 kata/token) dalam format natural language yang akan diinjeksikan ke prompt AI saat pelanggan mengirim pesan WhatsApp berikutnya.

Fokus pada:
- Layanan yang sering diminta (top intents/services)
- Pola komunikasi dan preferensi
- Status risiko dan kredit
- Task yang sedang berjalan
- Sentimen umum dan tren
- Dokumen yang sering dibutuhkan/kurang

PENTING: Output harus ringkas, informatif, dan mudah dipahami oleh AI lain.
Output HANYA teks naratif dalam Bahasa Indonesia — TIDAK ada JSON, TIDAK ada header markdown.`;

      const userPrompt = `Data pelanggan:\n${JSON.stringify(contextPayload, null, 2)}`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 450,
        temperature: 0.3,
      });

      const aiContextBlock = resp.choices[0]?.message?.content?.trim() ?? "Tidak ada data memori yang tersedia.";
      const tokenCount = resp.usage?.total_tokens ?? null;

      // Get current snapshot version
      const [latestSnap] = await db.select({ version: customerMemorySnapshotsTable.version })
        .from(customerMemorySnapshotsTable).where(and(eq(customerMemorySnapshotsTable.companyId, companyId), eq(customerMemorySnapshotsTable.customerId, id))).orderBy(desc(customerMemorySnapshotsTable.version)).limit(1);
      const newVersion = (latestSnap?.version ?? 0) + 1;

      // Mark previous snapshots as stale
      await db.update(customerMemorySnapshotsTable).set({ isStale: true, staleReason: "Replaced by newer snapshot", freshnessScore: 0 })
        .where(and(eq(customerMemorySnapshotsTable.companyId, companyId), eq(customerMemorySnapshotsTable.customerId, id), eq(customerMemorySnapshotsTable.isStale, false)));

      // Create new snapshot
      const [snapshot] = await db.insert(customerMemorySnapshotsTable).values({
        companyId,
        customerId: id,
        version: newVersion,
        snapshotType: "full",
        generatedBy: "ai",
        model: "gpt-4o-mini",
        lastNIntents: lastNIntents,
        openTasksCount: openTasks.length,
        frequentServices: lastNIntents.slice(0, 3),
        riskTier: risk?.tier ?? null,
        sentimentTrend: sentimentAvg ?? null,
        preferredChannel: customer.preferredChannel ?? activePrefs.find(p => p.key === "preferred_contact_time") ? "whatsapp" : null,
        aiContextBlock,
        tokenCount,
        sourceTaskCount: recentTasks.length,
        sourceMsgCount: recentMessages.length,
        freshnessScore: 100,
        isStale: false,
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      }).returning();

      // Update customer memory timestamp
      await db.update(customersTable).set({ memoryUpdatedAt: new Date() }).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId)));

      await logMemoryEvent(companyId, id, "snapshot_generated", req.user?.id ? String(req.user.id) : "ai", "ai", "customer_memory_snapshot", snapshot!.id, {
        version: newVersion, tokenCount, sourceTaskCount: recentTasks.length,
      });

      res.status(201).json(snapshot);
    } catch (err) {
      logger.error({ err }, "POST /crm/customers/:id/ai-context/refresh failed");
      res.status(500).json({ error: "Failed to generate AI context snapshot" });
    }
  }
);

// ── GET /api/crm/customers/:id/ai-context/history ────────────────────────────

router.get("/crm/customers/:id/ai-context/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const snapshots = await db
      .select({
        id: customerMemorySnapshotsTable.id,
        version: customerMemorySnapshotsTable.version,
        snapshotType: customerMemorySnapshotsTable.snapshotType,
        generatedBy: customerMemorySnapshotsTable.generatedBy,
        freshnessScore: customerMemorySnapshotsTable.freshnessScore,
        isStale: customerMemorySnapshotsTable.isStale,
        staleReason: customerMemorySnapshotsTable.staleReason,
        tokenCount: customerMemorySnapshotsTable.tokenCount,
        sourceTaskCount: customerMemorySnapshotsTable.sourceTaskCount,
        createdAt: customerMemorySnapshotsTable.createdAt,
      })
      .from(customerMemorySnapshotsTable)
      .where(and(eq(customerMemorySnapshotsTable.companyId, companyId), eq(customerMemorySnapshotsTable.customerId, id)))
      .orderBy(desc(customerMemorySnapshotsTable.createdAt))
      .limit(20);

    res.json(snapshots);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/ai-context/history failed");
    res.status(500).json({ error: "Failed to load AI context history" });
  }
});

// ── GET /api/crm/customers/:id/documents ─────────────────────────────────────
// Customer Document Registry (Phase 4)

router.get("/crm/customers/:id/documents", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const isCurrent = req.query.current === "false" ? undefined : true;
    const docType = req.query.type as string | undefined;

    let query = db.select().from(customerDocumentRegistryTable)
      .where(and(eq(customerDocumentRegistryTable.companyId, companyId), eq(customerDocumentRegistryTable.customerId, id)));

    const docs = await db.select().from(customerDocumentRegistryTable)
      .where(and(
        eq(customerDocumentRegistryTable.companyId, companyId),
        eq(customerDocumentRegistryTable.customerId, id),
        ...(isCurrent !== undefined ? [eq(customerDocumentRegistryTable.isCurrent, isCurrent)] : []),
      ))
      .orderBy(desc(customerDocumentRegistryTable.uploadedAt))
      .limit(100);

    const filtered = docType ? docs.filter((d) => d.documentType === docType) : docs;
    res.json(filtered);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id/documents failed");
    res.status(500).json({ error: "Failed to load document registry" });
  }
});

// ── POST /api/crm/customers/:id/documents ────────────────────────────────────
// Register a document to the customer document registry

router.post("/crm/customers/:id/documents",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      const {
        documentType, fileName, fileUrl, objectPath, mimeType, fileSize,
        sourceTaskId, sourceAttachmentId, expiryDate, notes, tags,
      } = req.body as Record<string, unknown>;

      if (!documentType || !fileName) {
        res.status(400).json({ error: "documentType and fileName are required" });
        return;
      }

      // Mark previous current doc of same type as not current
      await db.update(customerDocumentRegistryTable)
        .set({ isCurrent: false })
        .where(and(
          eq(customerDocumentRegistryTable.companyId, companyId),
          eq(customerDocumentRegistryTable.customerId, id),
          eq(customerDocumentRegistryTable.documentType, String(documentType)),
          eq(customerDocumentRegistryTable.isCurrent, true),
        ));

      const [doc] = await db.insert(customerDocumentRegistryTable).values({
        companyId,
        customerId: id,
        documentType: String(documentType),
        fileName: String(fileName),
        fileUrl: fileUrl ? String(fileUrl) : undefined,
        objectPath: objectPath ? String(objectPath) : undefined,
        mimeType: mimeType ? String(mimeType) : undefined,
        fileSize: fileSize ? Number(fileSize) : undefined,
        sourceTaskId: sourceTaskId ? Number(sourceTaskId) : undefined,
        sourceAttachmentId: sourceAttachmentId ? Number(sourceAttachmentId) : undefined,
        expiryDate: expiryDate ? String(expiryDate) : undefined,
        notes: notes ? String(notes) : undefined,
        tags: Array.isArray(tags) ? (tags as string[]) : undefined,
        isCurrent: true,
        uploadedBy: req.user?.email ?? req.user?.id ?? "unknown",
      }).returning();

      await logMemoryEvent(companyId, id, "document_registered", req.user?.id ? String(req.user.id) : undefined, "user", "customer_document", doc!.id, {
        documentType, fileName, sourceTaskId,
      });

      // Also mark sourceAttachmentId as reusable if provided
      if (sourceAttachmentId) {
        await db.update(taskAttachmentsTable)
          .set({ customerId: id, isReusable: true, reuseNotes: `Terdaftar di registry ${String(documentType)}` })
          .where(eq(taskAttachmentsTable.id, Number(sourceAttachmentId)));
      }

      res.status(201).json(doc);
    } catch (err) {
      logger.error({ err }, "POST /crm/customers/:id/documents failed");
      res.status(500).json({ error: "Failed to register document" });
    }
  }
);

// ── PATCH /api/crm/customers/:id/documents/:docId ────────────────────────────
// Update metadata or mark as verified

router.patch("/crm/customers/:id/documents/:docId",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const docId = Number(req.params.docId);
      if (Number.isNaN(id) || Number.isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }

      const { isVerified, expiryDate, notes, isCurrent } = req.body as Record<string, unknown>;

      const updates: Record<string, unknown> = {};
      if (isVerified !== undefined) {
        updates.isVerified = Boolean(isVerified);
        if (Boolean(isVerified)) {
          updates.verifiedBy = req.user?.email ?? "unknown";
          updates.verifiedAt = new Date();
        }
      }
      if (expiryDate !== undefined) updates.expiryDate = String(expiryDate);
      if (notes !== undefined) updates.notes = String(notes);
      if (isCurrent !== undefined) updates.isCurrent = Boolean(isCurrent);

      const [updated] = await db.update(customerDocumentRegistryTable)
        .set(updates as Partial<typeof customerDocumentRegistryTable.$inferInsert>)
        .where(and(eq(customerDocumentRegistryTable.id, docId), eq(customerDocumentRegistryTable.companyId, companyId), eq(customerDocumentRegistryTable.customerId, id)))
        .returning();

      if (!updated) { res.status(404).json({ error: "Document not found" }); return; }
      res.json(updated);
    } catch (err) {
      logger.error({ err }, "PATCH /crm/customers/:id/documents/:docId failed");
      res.status(500).json({ error: "Failed to update document" });
    }
  }
);

// ── DELETE /api/crm/customers/:id/documents/:docId ───────────────────────────

router.delete("/crm/customers/:id/documents/:docId",
  requireAuth, requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const docId = Number(req.params.docId);
      if (Number.isNaN(id) || Number.isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }

      const [deleted] = await db.delete(customerDocumentRegistryTable)
        .where(and(eq(customerDocumentRegistryTable.id, docId), eq(customerDocumentRegistryTable.companyId, companyId), eq(customerDocumentRegistryTable.customerId, id)))
        .returning();

      if (!deleted) { res.status(404).json({ error: "Document not found" }); return; }

      await logMemoryEvent(companyId, id, "document_registered", req.user?.id ? String(req.user.id) : undefined, "user", "customer_document", docId, { action: "deleted", fileName: deleted.fileName });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE /crm/customers/:id/documents/:docId failed");
      res.status(500).json({ error: "Failed to delete document" });
    }
  }
);

export default router;
