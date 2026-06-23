/**
 * Public Mini Form API — Sprint 9B
 * No authentication required — token-based access
 *
 * GET  /api/public/mini-form/types            — list all form types (for config UI)
 * GET  /api/public/mini-form/preview/:templateId — admin preview (no task)
 * GET  /api/public/mini-form/:type/:token     — load session + fields
 * POST /api/public/mini-form/:type/:token     — submit form
 */

import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  intakeSessionsTable,
  dataTemplatesTable,
  dataTemplateFieldsTable,
  aiTasksTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { createAdminNotification } from "../lib/admin-notifications";
import { MINI_FORM_CONFIGS, getFormConfig } from "../lib/mini-form-config";
import type { MiniFormFieldDef } from "../lib/mini-form-config";

const router: IRouter = Router();

// ── GET /public/mini-form/types ───────────────────────────────────────────────

router.get("/public/mini-form/types", (_req, res): void => {
  const summary = Object.values(MINI_FORM_CONFIGS).map(({ type, title, description, fields }) => ({
    type,
    title,
    description,
    fieldCount: fields.length,
    requiredCount: fields.filter((f) => f.required).length,
  }));
  res.json(summary);
});

// ── GET /public/mini-form/preview/:templateId ─────────────────────────────────

router.get("/public/mini-form/preview/:templateId", async (req, res): Promise<void> => {
  try {
    const templateId = parseInt(req.params["templateId"] as string, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: "templateId tidak valid" }); return; }

    const [tpl] = await db
      .select()
      .from(dataTemplatesTable)
      .where(eq(dataTemplatesTable.id, templateId))
      .limit(1);

    if (!tpl) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    const dbFields = await db
      .select()
      .from(dataTemplateFieldsTable)
      .where(eq(dataTemplateFieldsTable.templateId, templateId))
      .orderBy(dataTemplateFieldsTable.sortOrder);

    const formType = tpl.miniFormType ?? "trucking";
    const builtinCfg = getFormConfig(formType);

    res.json({
      preview: true,
      template: {
        id: tpl.id,
        name: tpl.name,
        intentCode: tpl.intentCode,
        category: tpl.category,
        intakeMode: tpl.intakeMode,
        miniFormType: formType,
        useMiniForm: tpl.useMiniForm,
      },
      formTitle: builtinCfg?.title ?? tpl.name,
      formDescription: builtinCfg?.description ?? tpl.description,
      builtinFields: builtinCfg?.fields ?? [],
      customFields: dbFields,
      collectedFields: {},
      missingFields: [],
    });
  } catch (err) {
    logger.error({ err }, "GET /public/mini-form/preview/:templateId failed");
    res.status(500).json({ error: "Gagal memuat preview" });
  }
});

// ── GET /public/mini-form/:type/:token ────────────────────────────────────────

router.get("/public/mini-form/:type/:token", async (req, res): Promise<void> => {
  try {
    const { type, token } = req.params as { type: string; token: string };
    if (!token || token.length < 16) { res.status(400).json({ error: "Token tidak valid" }); return; }

    const formCfg = getFormConfig(type);
    if (!formCfg) { res.status(404).json({ error: `Tipe form '${type}' tidak dikenal` }); return; }

    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.formToken, token))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Form tidak ditemukan atau link sudah tidak aktif" }); return; }

    if (session.status === "submitted") {
      res.json({
        status: "submitted",
        message: "Data Anda sudah kami terima. Terima kasih! Tim kami akan segera menghubungi Anda.",
      });
      return;
    }
    if (session.status === "cancelled" || session.status === "expired") {
      res.status(410).json({ error: "Sesi ini sudah tidak aktif. Silakan hubungi kami kembali." });
      return;
    }

    // Load custom DB fields if template exists
    const dataTpl = await db
      .select()
      .from(dataTemplatesTable)
      .where(
        and(
          eq(dataTemplatesTable.companyId, session.companyId),
          eq(dataTemplatesTable.isActive, true),
          eq(dataTemplatesTable.intentCode, session.intentCode),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    const customFields = dataTpl
      ? await db
          .select()
          .from(dataTemplateFieldsTable)
          .where(eq(dataTemplateFieldsTable.templateId, dataTpl.id))
          .orderBy(dataTemplateFieldsTable.sortOrder)
      : [];

    res.json({
      status: session.status,
      intentCode: session.intentCode,
      intentName: session.intentName,
      category: session.category,
      formTitle: formCfg.title,
      formDescription: formCfg.description,
      builtinFields: formCfg.fields,
      customFields,
      collectedFields: session.collectedFields ?? {},
      missingFields: session.missingFields ?? [],
      requiredDocuments: session.requiredDocuments ?? [],
      uploadedDocuments: session.uploadedDocuments ?? [],
    });
  } catch (err) {
    logger.error({ err }, "GET /public/mini-form/:type/:token failed");
    res.status(500).json({ error: "Gagal memuat form" });
  }
});

// ── POST /public/mini-form/:type/:token ───────────────────────────────────────

router.post("/public/mini-form/:type/:token", async (req, res): Promise<void> => {
  try {
    const { type, token } = req.params as { type: string; token: string };
    const body = req.body as {
      fields: Record<string, string>;
      submittedBy?: string;
      uploadedDocuments?: string[];
    };

    if (!token || token.length < 16) { res.status(400).json({ error: "Token tidak valid" }); return; }

    const formCfg = getFormConfig(type);
    if (!formCfg) { res.status(404).json({ error: `Tipe form '${type}' tidak dikenal` }); return; }

    if (!body.fields || typeof body.fields !== "object") {
      res.status(400).json({ error: "Data field wajib diisi" }); return;
    }

    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.formToken, token))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Form tidak ditemukan" }); return; }
    if (session.status === "submitted") {
      res.json({ ok: true, message: "Sudah tersubmit sebelumnya. Terima kasih!" }); return;
    }
    if (session.status === "cancelled" || session.status === "expired") {
      res.status(410).json({ error: "Sesi ini sudah tidak aktif" }); return;
    }

    // Merge: existing collected fields + new submitted fields
    const merged: Record<string, unknown> = {
      ...((session.collectedFields as Record<string, unknown>) ?? {}),
      ...body.fields,
    };

    // Calculate missing required fields from builtin + missing list
    const requiredBuiltinNames = formCfg.fields
      .filter((f: MiniFormFieldDef) => f.required && f.type !== "file")
      .map((f: MiniFormFieldDef) => f.name);

    const prevMissing = (session.missingFields as string[]) ?? [];
    const allRequired = Array.from(new Set([...requiredBuiltinNames, ...prevMissing]));
    const stillMissing = allRequired.filter(
      (f) => !merged[f] || String(merged[f]).trim() === "",
    );

    // Merge uploaded docs
    const prevDocs = (session.uploadedDocuments as string[]) ?? [];
    const newDocs = body.uploadedDocuments ?? [];
    const mergedDocs = Array.from(new Set([...prevDocs, ...newDocs]));

    const isComplete = stillMissing.length === 0;

    let taskId: number | null = null;
    let taskNumber: string | null = null;

    if (isComplete) {
      const now = new Date();
      taskNumber = `WA-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-F${session.id}`;

      // Build smart title from collected fields
      const title = buildTaskTitle(type, merged, session);

      const fieldSummary = Object.entries(merged)
        .slice(0, 12)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join("\n");

      const [newTask] = await db
        .insert(aiTasksTable)
        .values({
          companyId: session.companyId,
          taskNumber,
          title,
          description:
            `Task dibuat dari mini-form (${formCfg.title}).\n` +
            `Sumber: mini_form | Intake Session: #${session.id}\n` +
            `Diisi oleh: ${body.submittedBy ?? session.phone}\n\n` +
            `Data terkumpul:\n${fieldSummary}`,
          status: "New Inquiry",
          priority: type === "complaint" || type === "fleet-repair" ? "high" : "medium",
          category: session.category ?? formCfg.title,
          customerPhone: session.phone,
          customerId: session.customerId ? parseInt(session.customerId, 10) || null : null,
          aiSummary: `Form ${formCfg.title} diisi via link WhatsApp`,
          source: "mini_form",
          missingData: JSON.stringify([]),
        })
        .returning();

      taskId = newTask!.id;

      await createAdminNotification({
        type: "new_inquiry",
        title: `📋 Mini Form Disubmit — ${formCfg.title}`,
        body: `${session.phone} mengisi ${formCfg.title}. Task #${taskNumber} dibuat otomatis.`,
        customerPhone: session.phone,
        taskId,
        companyId: session.companyId,
      });
    }

    await db
      .update(intakeSessionsTable)
      .set({
        collectedFields: merged,
        missingFields: stillMissing,
        uploadedDocuments: mergedDocs,
        status: isComplete ? "submitted" : "ready_for_task",
        taskId: taskId ? String(taskId) : session.taskId,
        updatedAt: new Date(),
      })
      .where(eq(intakeSessionsTable.id, session.id));

    logger.info(
      { sessionId: session.id, type, isComplete, taskId, missingLeft: stillMissing.length },
      "Mini form submitted",
    );

    res.json({
      ok: true,
      isComplete,
      taskNumber,
      missingFields: stillMissing,
      message: isComplete
        ? "🎉 Terima kasih! Data Anda telah kami terima dan kami akan segera memproses permintaan Anda."
        : `Data sebagian disimpan. Masih ada ${stillMissing.length} data yang perlu dilengkapi.`,
    });
  } catch (err) {
    logger.error({ err }, "POST /public/mini-form/:type/:token failed");
    res.status(500).json({ error: "Gagal menyimpan data form" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTaskTitle(
  type: string,
  fields: Record<string, unknown>,
  session: { intentName?: string | null; intentCode: string; phone: string },
): string {
  const get = (k: string) => String(fields[k] ?? "").trim();
  switch (type) {
    case "trucking":
      return get("pickup_address") && get("delivery_address")
        ? `Permintaan Trucking — ${get("pickup_address")} ke ${get("delivery_address")}`
        : `Permintaan Trucking — ${session.phone}`;
    case "freight":
      return get("origin_country") && get("destination_country")
        ? `Permintaan Freight — ${get("origin_country")} ke ${get("destination_country")}`
        : `Permintaan Freight — ${session.phone}`;
    case "complaint":
      return get("order_number")
        ? `Komplain Barang Rusak — ${get("order_number")}`
        : `Komplain Barang Rusak — ${session.phone}`;
    case "fleet-repair":
      return get("plate_number")
        ? `Fleet Repair — ${get("plate_number")}`
        : `Fleet Repair — ${session.phone}`;
    case "cash-advance":
      return get("amount")
        ? `Pengajuan Kasbon — Rp ${Number(get("amount")).toLocaleString("id-ID")}`
        : `Pengajuan Kasbon — ${session.phone}`;
    default:
      return `${session.intentName ?? session.intentCode} — ${session.phone}`;
  }
}

export default router;
