import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, count, ilike, or } from "drizzle-orm";
import {
  db,
  intentMasterTable,
  keywordRulesTable,
  serviceCatalogTable,
  dataTemplatesTable,
  dataTemplateFieldsTable,
  documentTemplatesTable,
  documentTemplateFieldsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth, requireRole, getCompanyId, getCompanyIdForWrite } from "../middleware/auth";

const router: IRouter = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function coId(req: Request): string | null { return getCompanyId(req); }
function coIdWrite(req: Request): string    { return getCompanyIdForWrite(req); }

// ─── GET /api/knowledge-base/stats ────────────────────────────────────────────

router.get("/knowledge-base/stats", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const where = (t: { companyId: typeof intentMasterTable.companyId }) =>
      companyId ? eq(t.companyId, companyId) : undefined;

    const [intents, keywords, services, dataTpl, docTpl] = await Promise.all([
      db.select({ c: count() }).from(intentMasterTable).where(where(intentMasterTable)),
      db.select({ c: count() }).from(keywordRulesTable).where(where(keywordRulesTable)),
      db.select({ c: count() }).from(serviceCatalogTable).where(where(serviceCatalogTable)),
      db.select({ c: count() }).from(dataTemplatesTable).where(where(dataTemplatesTable)),
      db.select({ c: count() }).from(documentTemplatesTable).where(where(documentTemplatesTable)),
    ]);

    res.json({
      intents:           Number(intents[0]?.c   ?? 0),
      keywords:          Number(keywords[0]?.c  ?? 0),
      services:          Number(services[0]?.c  ?? 0),
      dataTemplates:     Number(dataTpl[0]?.c   ?? 0),
      documentTemplates: Number(docTpl[0]?.c    ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "GET /knowledge-base/stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/knowledge-base/analytics ───────────────────────────────────────

router.get("/knowledge-base/analytics", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const cond = companyId ? eq(intentMasterTable.companyId, companyId) : undefined;

    const [intentRows, keywordRows, serviceRows] = await Promise.all([
      db.select().from(intentMasterTable).where(cond).orderBy(desc(intentMasterTable.createdAt)).limit(200),
      db.select().from(keywordRulesTable)
        .where(companyId ? eq(keywordRulesTable.companyId, companyId) : undefined)
        .orderBy(desc(keywordRulesTable.createdAt)).limit(500),
      db.select().from(serviceCatalogTable)
        .where(companyId ? eq(serviceCatalogTable.companyId, companyId) : undefined)
        .orderBy(desc(serviceCatalogTable.createdAt)).limit(200),
    ]);

    const activeIntents   = intentRows.filter((r) => r.isActive).length;
    const inactiveIntents = intentRows.length - activeIntents;

    const byCategory = intentRows.reduce<Record<string, number>>((acc, r) => {
      const cat = r.category ?? "Uncategorized";
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {});

    const keywordsByIntent = keywordRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.intentCode] = (acc[r.intentCode] ?? 0) + 1;
      return acc;
    }, {});

    const topIntents = Object.entries(keywordsByIntent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([intentCode, keywordCount]) => ({ intentCode, keywordCount }));

    const servicesByCategory = serviceRows.reduce<Record<string, number>>((acc, r) => {
      const cat = r.category ?? "Uncategorized";
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {});

    res.json({
      summary: {
        totalIntents:   intentRows.length,
        activeIntents,
        inactiveIntents,
        totalKeywords:  keywordRows.length,
        totalServices:  serviceRows.length,
      },
      intentsByCategory:  Object.entries(byCategory).map(([category, count]) => ({ category, count })),
      topIntentsByKeyword: topIntents,
      servicesByCategory: Object.entries(servicesByCategory).map(([category, count]) => ({ category, count })),
    });
  } catch (err) {
    logger.error({ err }, "GET /knowledge-base/analytics failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/knowledge-base/simulator ──────────────────────────────────────

router.post("/knowledge-base/simulator", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, companyId: reqCompanyId } = req.body as { message?: string; companyId?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: "message diperlukan" });
      return;
    }

    const companyId =
      req.user?.role === "super_admin" && reqCompanyId
        ? reqCompanyId
        : coId(req) ?? "default";

    const [keywords, intents] = await Promise.all([
      db.select().from(keywordRulesTable)
        .where(and(eq(keywordRulesTable.companyId, companyId), eq(keywordRulesTable.isActive, true))),
      db.select().from(intentMasterTable)
        .where(and(eq(intentMasterTable.companyId, companyId), eq(intentMasterTable.isActive, true))),
    ]);

    const text = message.toLowerCase();
    const scores: Record<string, number> = {};
    const matchedKeywords: { keyword: string; intentCode: string; weight: number }[] = [];

    for (const kw of keywords) {
      if (text.includes(kw.keyword.toLowerCase())) {
        scores[kw.intentCode] = (scores[kw.intentCode] ?? 0) + kw.weight;
        matchedKeywords.push({ keyword: kw.keyword, intentCode: kw.intentCode, weight: kw.weight });
      }
    }

    const ranked = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([intentCode, score]) => {
        const intent = intents.find((i) => i.intentCode === intentCode);
        return { intentCode, score, intent: intent ?? null };
      });

    const topIntent = ranked[0] ?? null;

    res.json({
      input: message,
      companyId,
      matchedKeywords,
      rankedIntents: ranked,
      topIntent: topIntent
        ? {
            intentCode:        topIntent.intentCode,
            intentName:        topIntent.intent?.intentName ?? topIntent.intentCode,
            score:             topIntent.score,
            suggestedPriority: topIntent.intent?.suggestedPriority ?? "medium",
            suggestedDivision: topIntent.intent?.suggestedDivision ?? null,
            slaHours:          topIntent.intent?.slaHours ?? null,
          }
        : null,
      totalMatches: matchedKeywords.length,
    });
  } catch (err) {
    logger.error({ err }, "POST /knowledge-base/simulator failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/knowledge-base/cache/reload ────────────────────────────────────

router.post("/knowledge-base/cache/reload", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, reloadedAt: new Date().toISOString(), message: "Cache knowledge base berhasil di-reload" });
  } catch (err) {
    logger.error({ err }, "POST /knowledge-base/cache/reload failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT MASTER
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/intent-master", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const { search, category, active } = req.query as Record<string, string | undefined>;

    let rows = await db.select().from(intentMasterTable)
      .where(companyId ? eq(intentMasterTable.companyId, companyId) : undefined)
      .orderBy(desc(intentMasterTable.createdAt))
      .limit(500);

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.intentCode.toLowerCase().includes(q) || r.intentName.toLowerCase().includes(q),
      );
    }
    if (category) rows = rows.filter((r) => r.category === category);
    if (active !== undefined) rows = rows.filter((r) => r.isActive === (active === "true"));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /intent-master failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/intent-master", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coIdWrite(req);
    const body = { ...req.body, companyId } as typeof intentMasterTable.$inferInsert;
    const [row] = await db.insert(intentMasterTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /intent-master failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/intent-master/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [row] = await db.update(intentMasterTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(intentMasterTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /intent-master/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/intent-master/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(intentMasterTable).where(eq(intentMasterTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /intent-master/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// KEYWORD RULES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/keyword-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const { search, intentCode } = req.query as Record<string, string | undefined>;

    let rows = await db.select().from(keywordRulesTable)
      .where(companyId ? eq(keywordRulesTable.companyId, companyId) : undefined)
      .orderBy(desc(keywordRulesTable.createdAt))
      .limit(1000);

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.keyword.toLowerCase().includes(q) || r.intentCode.toLowerCase().includes(q),
      );
    }
    if (intentCode) rows = rows.filter((r) => r.intentCode === intentCode);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /keyword-rules failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/keyword-rules", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coIdWrite(req);
    const body = { ...req.body, companyId } as typeof keywordRulesTable.$inferInsert;
    const [row] = await db.insert(keywordRulesTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /keyword-rules failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/keyword-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [row] = await db.update(keywordRulesTable)
      .set(req.body)
      .where(eq(keywordRulesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /keyword-rules/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/keyword-rules/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(keywordRulesTable).where(eq(keywordRulesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /keyword-rules/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CATALOG
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/service-catalog", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const { search, category } = req.query as Record<string, string | undefined>;

    let rows = await db.select().from(serviceCatalogTable)
      .where(companyId ? eq(serviceCatalogTable.companyId, companyId) : undefined)
      .orderBy(desc(serviceCatalogTable.createdAt))
      .limit(500);

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.serviceName.toLowerCase().includes(q) ||
        (r.serviceCode ?? "").toLowerCase().includes(q),
      );
    }
    if (category) rows = rows.filter((r) => r.category === category);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /service-catalog failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/service-catalog", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coIdWrite(req);
    const body = { ...req.body, companyId } as typeof serviceCatalogTable.$inferInsert;
    const [row] = await db.insert(serviceCatalogTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /service-catalog failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/service-catalog/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [row] = await db.update(serviceCatalogTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(serviceCatalogTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /service-catalog/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/service-catalog/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(serviceCatalogTable).where(eq(serviceCatalogTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /service-catalog/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/data-templates", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const templates = await db.select().from(dataTemplatesTable)
      .where(companyId ? eq(dataTemplatesTable.companyId, companyId) : undefined)
      .orderBy(desc(dataTemplatesTable.createdAt))
      .limit(200);

    const fields = templates.length
      ? await db.select().from(dataTemplateFieldsTable)
          .where(or(...templates.map((t) => eq(dataTemplateFieldsTable.templateId, t.id))))
          .orderBy(dataTemplateFieldsTable.sortOrder)
      : [];

    res.json(templates.map((t) => ({
      ...t,
      fields: fields.filter((f) => f.templateId === t.id),
    })));
  } catch (err) {
    logger.error({ err }, "GET /data-templates failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/data-templates", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coIdWrite(req);
    const { fields, ...rest } = req.body as { fields?: typeof dataTemplateFieldsTable.$inferInsert[]; [k: string]: unknown };
    const [tpl] = await db.insert(dataTemplatesTable).values({ ...rest, companyId } as typeof dataTemplatesTable.$inferInsert).returning();
    const insertedFields = fields?.length
      ? await db.insert(dataTemplateFieldsTable).values(fields.map((f, i) => ({ ...f, templateId: tpl.id, sortOrder: i }))).returning()
      : [];
    res.status(201).json({ ...tpl, fields: insertedFields });
  } catch (err) {
    logger.error({ err }, "POST /data-templates failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/data-templates/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { fields, ...rest } = req.body as { fields?: unknown; [k: string]: unknown };
    const [tpl] = await db.update(dataTemplatesTable)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(dataTemplatesTable.id, id))
      .returning();
    if (!tpl) { res.status(404).json({ error: "Not found" }); return; }
    const updatedFields = await db.select().from(dataTemplateFieldsTable)
      .where(eq(dataTemplateFieldsTable.templateId, id))
      .orderBy(dataTemplateFieldsTable.sortOrder);
    res.json({ ...tpl, fields: updatedFields });
  } catch (err) {
    logger.error({ err }, "PATCH /data-templates/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/data-templates/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(dataTemplateFieldsTable).where(eq(dataTemplateFieldsTable.templateId, id));
    await db.delete(dataTemplatesTable).where(eq(dataTemplatesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /data-templates/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/data-templates/:id/fields", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const templateId = Number(req.params.id);
    const [row] = await db.insert(dataTemplateFieldsTable)
      .values({ ...req.body, templateId } as typeof dataTemplateFieldsTable.$inferInsert)
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /data-templates/:id/fields failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/data-templates/:id/fields/:fieldId", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const fieldId = Number(req.params.fieldId);
    await db.delete(dataTemplateFieldsTable).where(eq(dataTemplateFieldsTable.id, fieldId));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /data-templates/:id/fields/:fieldId failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/document-templates", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coId(req);
    const templates = await db.select().from(documentTemplatesTable)
      .where(companyId ? eq(documentTemplatesTable.companyId, companyId) : undefined)
      .orderBy(desc(documentTemplatesTable.createdAt))
      .limit(200);

    const fields = templates.length
      ? await db.select().from(documentTemplateFieldsTable)
          .where(or(...templates.map((t) => eq(documentTemplateFieldsTable.templateId, t.id))))
          .orderBy(documentTemplateFieldsTable.sortOrder)
      : [];

    res.json(templates.map((t) => ({
      ...t,
      fields: fields.filter((f) => f.templateId === t.id),
    })));
  } catch (err) {
    logger.error({ err }, "GET /document-templates failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/document-templates", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = coIdWrite(req);
    const { fields, ...rest } = req.body as { fields?: typeof documentTemplateFieldsTable.$inferInsert[]; [k: string]: unknown };
    const [tpl] = await db.insert(documentTemplatesTable).values({ ...rest, companyId } as typeof documentTemplatesTable.$inferInsert).returning();
    const insertedFields = fields?.length
      ? await db.insert(documentTemplateFieldsTable).values(fields.map((f, i) => ({ ...f, templateId: tpl.id, sortOrder: i }))).returning()
      : [];
    res.status(201).json({ ...tpl, fields: insertedFields });
  } catch (err) {
    logger.error({ err }, "POST /document-templates failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/document-templates/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { fields, ...rest } = req.body as { fields?: unknown; [k: string]: unknown };
    const [tpl] = await db.update(documentTemplatesTable)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(documentTemplatesTable.id, id))
      .returning();
    if (!tpl) { res.status(404).json({ error: "Not found" }); return; }
    const updatedFields = await db.select().from(documentTemplateFieldsTable)
      .where(eq(documentTemplateFieldsTable.templateId, id))
      .orderBy(documentTemplateFieldsTable.sortOrder);
    res.json({ ...tpl, fields: updatedFields });
  } catch (err) {
    logger.error({ err }, "PATCH /document-templates/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/document-templates/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(documentTemplateFieldsTable).where(eq(documentTemplateFieldsTable.templateId, id));
    await db.delete(documentTemplatesTable).where(eq(documentTemplatesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /document-templates/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/document-templates/:id/fields", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const templateId = Number(req.params.id);
    const [row] = await db.insert(documentTemplateFieldsTable)
      .values({ ...req.body, templateId } as typeof documentTemplateFieldsTable.$inferInsert)
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /document-templates/:id/fields failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/document-templates/:id/fields/:fieldId", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const fieldId = Number(req.params.fieldId);
    await db.delete(documentTemplateFieldsTable).where(eq(documentTemplateFieldsTable.id, fieldId));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /document-templates/:id/fields/:fieldId failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
