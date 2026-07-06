/**
 * Mini Form Config API — Sprint 9B
 * Admin configuration: link intent to form type
 *
 * GET  /api/mini-form-config              — list intents + their form config
 * PATCH /api/mini-form-config/:intentCode — update form config for intent
 */

import { Router, type IRouter } from "express";
import { eq, and, or } from "drizzle-orm";
import { db, intentMasterTable, dataTemplatesTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { MINI_FORM_CONFIGS } from "../lib/mini-form-config";

const router: IRouter = Router();

// ── GET /mini-form-config ─────────────────────────────────────────────────────

router.get("/mini-form-config", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";

    // Query intents for the company AND the shared "default" pool.
    // This ensures system-seeded intents (company_id="default") are always visible
    // even when the production company has a different company_id (e.g. "1").
    // Company-specific intents take precedence over defaults with the same intentCode.
    const intentFilter = companyId === "default"
      ? eq(intentMasterTable.companyId, "default")
      : or(eq(intentMasterTable.companyId, companyId), eq(intentMasterTable.companyId, "default"))!;

    const allIntents = await db
      .select()
      .from(intentMasterTable)
      .where(intentFilter)
      .orderBy(intentMasterTable.category, intentMasterTable.intentCode);

    // Deduplicate: prefer company-specific intent over default with same code
    const intentMap = new Map<string, typeof allIntents[number]>();
    for (const intent of allIntents) {
      const existing = intentMap.get(intent.intentCode);
      if (!existing || intent.companyId === companyId) {
        intentMap.set(intent.intentCode, intent);
      }
    }
    const intents = Array.from(intentMap.values())
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.intentCode.localeCompare(b.intentCode));

    // Same fallback logic for templates
    const templateFilter = companyId === "default"
      ? and(eq(dataTemplatesTable.companyId, "default"), eq(dataTemplatesTable.isActive, true))
      : and(
          or(eq(dataTemplatesTable.companyId, companyId), eq(dataTemplatesTable.companyId, "default"))!,
          eq(dataTemplatesTable.isActive, true),
        );

    const allTemplates = await db
      .select()
      .from(dataTemplatesTable)
      .where(templateFilter);

    // Deduplicate templates — prefer company-specific
    const tplMap = new Map<string, typeof allTemplates[number]>();
    for (const t of allTemplates) {
      if (!t.intentCode) continue;
      const existing = tplMap.get(t.intentCode);
      if (!existing || t.companyId === companyId) {
        tplMap.set(t.intentCode, t);
      }
    }
    const templates = Array.from(tplMap.values());

    const tplByIntent: Record<string, typeof templates[number]> = {};
    for (const t of templates) {
      if (t.intentCode) tplByIntent[t.intentCode] = t;
    }

    const result = intents.map((intent) => {
      const tpl = tplByIntent[intent.intentCode] ?? null;
      return {
        intentCode: intent.intentCode,
        intentName: intent.intentName,
        category: intent.category,
        isActive: true,
        template: tpl
          ? {
              id: tpl.id,
              name: tpl.name,
              intakeMode: tpl.intakeMode,
              useMiniForm: tpl.useMiniForm,
              miniFormType: tpl.miniFormType,
              miniFormRoute: tpl.miniFormRoute,
            }
          : null,
      };
    });

    res.json({
      data: result,
      formTypes: Object.values(MINI_FORM_CONFIGS).map(({ type, title, description }) => ({
        type, title, description,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /mini-form-config failed");
    res.status(500).json({ error: "Gagal memuat konfigurasi" });
  }
});

// ── PATCH /mini-form-config/:intentCode ───────────────────────────────────────

router.patch("/mini-form-config/:intentCode", requireAuth, async (req, res): Promise<void> => {
  try {
    const role = req.user?.role;
    if (!role || !["company_admin", "super_admin", "admin"].includes(role)) {
      res.status(403).json({ error: "Hanya admin yang dapat mengubah konfigurasi" }); return;
    }

    const { intentCode } = req.params as { intentCode: string };
    const companyId = req.user?.companyId ?? "default";
    const {
      intakeMode,
      useMiniForm,
      miniFormType,
      miniFormRoute,
    } = req.body as {
      intakeMode?: string;
      useMiniForm?: boolean;
      miniFormType?: string;
      miniFormRoute?: string;
    };

    // Find or validate template exists for this intent
    const [tpl] = await db
      .select()
      .from(dataTemplatesTable)
      .where(
        and(
          eq(dataTemplatesTable.companyId, companyId),
          eq(dataTemplatesTable.intentCode, intentCode),
        ),
      )
      .limit(1);

    if (!tpl) {
      res.status(404).json({
        error: `Tidak ada data template untuk intent '${intentCode}'. Buat template di Knowledge Base terlebih dahulu.`,
      });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (intakeMode !== undefined)  updates["intakeMode"]    = intakeMode;
    if (useMiniForm !== undefined) updates["useMiniForm"]   = useMiniForm;
    if (miniFormType !== undefined) updates["miniFormType"] = miniFormType;
    if (miniFormRoute !== undefined) updates["miniFormRoute"] = miniFormRoute;

    const [updated] = await db
      .update(dataTemplatesTable)
      .set(updates)
      .where(eq(dataTemplatesTable.id, tpl.id))
      .returning();

    logger.info({ intentCode, updates, adminId: req.user?.id }, "Mini form config updated");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /mini-form-config/:intentCode failed");
    res.status(500).json({ error: "Gagal menyimpan konfigurasi" });
  }
});

export default router;
