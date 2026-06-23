/**
 * Sprint 10A-1.2 — Task 5: System Health Endpoints
 *
 * GET /api/system/whatsapp-health  — WhatsApp gateway health check
 * GET /api/system/onboarding-status — Onboarding completion status
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, companySettingsTable, aiTasksTable, auditLogsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /api/system/whatsapp-health ───────────────────────────────────────────

router.get("/system/whatsapp-health", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";

    // Load company settings
    const [settings] = await db
      .select()
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, companyId))
      .limit(1);

    // Resolve tokens: DB overrides env
    const fonnteToken = settings?.fonnteToken ?? process.env.FONNTE_TOKEN ?? null;
    const waToken = settings?.whatsappToken ?? process.env.WHATSAPP_TOKEN ?? null;
    const waPhoneId = settings?.whatsappPhoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null;
    const waVerifyToken = settings?.whatsappWebhookVerifyToken ?? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null;

    const fonnteConfigured = !!fonnteToken;
    const metaConfigured = !!waToken && !!waPhoneId;
    const webhookConfigured = !!waVerifyToken;

    // Last inbound WA message
    const [lastTask] = await db
      .select({
        taskNumber: aiTasksTable.taskNumber,
        title: aiTasksTable.title,
        createdAt: aiTasksTable.createdAt,
        source: aiTasksTable.source,
      })
      .from(aiTasksTable)
      .where(eq(aiTasksTable.companyId, companyId))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(1);

    // Last WA delivery (admin_notifications)
    const deliveryResult = await db.execute(sql`
      SELECT id, type, title, created_at
      FROM admin_notifications
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => [] as unknown[]);
    const lastDelivery = (deliveryResult as unknown as Record<string, unknown>[])[0] ?? null;

    // Last WA source task (whatsapp-sourced)
    const [lastWaTask] = await db
      .select({ createdAt: aiTasksTable.createdAt, source: aiTasksTable.source })
      .from(aiTasksTable)
      .where(eq(aiTasksTable.companyId, companyId))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(1);

    // Count last 24h messages
    const count24h = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM ai_tasks
      WHERE company_id = ${companyId}
        AND source IN ('whatsapp', 'whatsapp_command', 'mini_form')
        AND created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => [{ cnt: 0 }] as unknown[]);
    const messages24h = parseInt(String((count24h as unknown as Record<string, unknown>[])[0]?.cnt ?? "0"), 10);

    // Overall status
    let status: "healthy" | "partial" | "not_configured";
    if (fonnteConfigured) {
      status = "healthy";
    } else if (metaConfigured) {
      status = "partial";
    } else {
      status = "not_configured";
    }

    res.json({
      status,
      gateway: {
        fonnte: {
          configured: fonnteConfigured,
          tokenMasked: fonnteToken ? `••••••••${fonnteToken.slice(-4)}` : null,
        },
        meta: {
          configured: metaConfigured,
          phoneNumberId: waPhoneId ?? null,
          tokenMasked: waToken ? `••••••••${waToken.slice(-4)}` : null,
        },
      },
      webhook: {
        configured: webhookConfigured,
        verifyTokenSet: webhookConfigured,
        fonnte_url: "/api/webhook/fonnte",
        meta_url: "/api/webhook/whatsapp",
      },
      activity: {
        lastMessageAt: lastTask?.createdAt ?? null,
        lastMessageSource: lastTask?.source ?? null,
        lastDeliveryAt: lastDelivery?.created_at ?? null,
        messages24h,
      },
      issues: [
        ...(!fonnteConfigured ? ["FONNTE_TOKEN belum dikonfigurasi — pesan WA tidak akan terkirim"] : []),
        ...(!metaConfigured ? ["Meta WhatsApp API belum dikonfigurasi"] : []),
        ...(!webhookConfigured ? ["Webhook verify token belum di-set"] : []),
      ],
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /system/whatsapp-health failed");
    res.status(500).json({ error: "Gagal memeriksa status WhatsApp" });
  }
});

// ── GET /api/system/onboarding-status ─────────────────────────────────────────

router.get("/system/onboarding-status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";

    const [settings] = await db
      .select()
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, companyId))
      .limit(1);

    // Company profile completeness (Task 4 fields)
    const profileFields = {
      company_name: !!settings?.companyName,
      company_phone: !!settings?.companyPhone,
      company_email: !!settings?.companyEmail,
      industry_type: !!settings?.industryType,
    };
    const profileDone = Object.values(profileFields).filter(Boolean).length;
    const profilePct = Math.round((profileDone / 4) * 100);

    // WhatsApp configured
    const fonnteOk = !!(settings?.fonnteToken ?? process.env.FONNTE_TOKEN);
    const metaOk = !!(settings?.whatsappToken ?? process.env.WHATSAPP_TOKEN);
    const waPct = fonnteOk ? 100 : metaOk ? 50 : 0;

    // Team members
    const teamResult = await db.execute(sql`SELECT COUNT(*) AS cnt FROM team_members WHERE company_id = ${companyId}`).catch(() => [{ cnt: 0 }]);
    const teamCount = parseInt(String((teamResult as unknown as Record<string, unknown>[])[0]?.cnt ?? "0"), 10);

    // Customers with phone
    const custResult = await db.execute(sql`
      SELECT COUNT(*) AS total, COUNT(CASE WHEN whatsapp IS NOT NULL THEN 1 END) AS with_wa
      FROM customers WHERE company_id = ${companyId}
    `).catch(() => [{ total: 0, with_wa: 0 }]);
    const custRow = (custResult as unknown as Record<string, unknown>[])[0] ?? {};

    // Fleet units
    const fleetResult = await db.execute(sql`SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = ${companyId} AND is_active = true`).catch(() => [{ cnt: 0 }]);
    const fleetCount = parseInt(String((fleetResult as unknown as Record<string, unknown>[])[0]?.cnt ?? "0"), 10);

    // Knowledge base
    const kbResult = await db.execute(sql`SELECT COUNT(*) AS cnt FROM intent_master`).catch(() => [{ cnt: 0 }]);
    const intentCount = parseInt(String((kbResult as unknown as Record<string, unknown>[])[0]?.cnt ?? "0"), 10);

    // Tasks created
    const taskResult = await db.execute(sql`SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = ${companyId}`).catch(() => [{ cnt: 0 }]);
    const taskCount = parseInt(String((taskResult as unknown as Record<string, unknown>[])[0]?.cnt ?? "0"), 10);

    const steps = {
      company_profile: { done: profilePct === 100, pct: profilePct, fields: profileFields },
      whatsapp: { done: waPct === 100, pct: waPct, fonnteConfigured: fonnteOk, metaConfigured: metaOk },
      team: { done: teamCount >= 1, count: teamCount },
      customers: { done: parseInt(String(custRow.total ?? "0"), 10) >= 1, total: parseInt(String(custRow.total ?? "0"), 10), withPhone: parseInt(String(custRow.with_wa ?? "0"), 10) },
      fleet: { done: fleetCount >= 1, count: fleetCount },
      knowledge_base: { done: intentCount >= 10, intentCount },
      first_task: { done: taskCount >= 1, taskCount },
    };

    const doneCount = Object.values(steps).filter((s) => s.done).length;
    const overallPct = Math.round((doneCount / Object.keys(steps).length) * 100);

    res.json({
      overallPct,
      companyId,
      steps,
      readyForProduction: overallPct >= 70 && steps.whatsapp.done && steps.company_profile.done,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /system/onboarding-status failed");
    res.status(500).json({ error: "Gagal memeriksa status onboarding" });
  }
});

// ── POST /api/system/ai-test ───────────────────────────────────────────────────
// Simulation only — no task creation, no WhatsApp message sent

router.post("/system/ai-test", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message wajib diisi" });
      return;
    }
    const msgLower = message.toLowerCase().trim();

    // Step 1: keyword match against keyword_rules table
    const kwResult = await db.execute(sql`
      SELECT k.keyword, k.weight, i.intent_code, i.category, i.description
      FROM keyword_rules k
      JOIN intent_master i ON i.id = k.intent_id
      WHERE ${msgLower} ILIKE '%' || k.keyword || '%'
      ORDER BY k.weight DESC
      LIMIT 5
    `).catch(() => [] as unknown[]);
    const kwRows = kwResult as unknown as Array<Record<string, unknown>>;

    // Step 2: direct intent_code substring match as fallback
    let detectedIntent: string | null = null;
    let intentCode: string | null = null;
    let category: string | null = null;
    let intentDescription: string | null = null;
    let confidence = 0;

    if (kwRows.length > 0) {
      detectedIntent = String(kwRows[0].description ?? kwRows[0].intent_code ?? "");
      intentCode = String(kwRows[0].intent_code ?? "");
      category = String(kwRows[0].category ?? "");
      confidence = Math.min(95, 60 + (kwRows.length * 7));
      intentDescription = String(kwRows[0].description ?? "");
    } else {
      // Fallback: scan intent_master categories by keyword
      const fallbackMap: Array<{ words: string[]; code: string; cat: string; desc: string }> = [
        { words: ["kasbon","uang muka","pinjam","advance"], code: "permintaan_kasbon", cat: "Finance", desc: "Permintaan Cash Advance" },
        { words: ["trucking","truk","angkut","darat","pengiriman"], code: "trucking_inquiry", cat: "Logistik", desc: "Permintaan Trucking" },
        { words: ["udara","air freight","pesawat","cargo"], code: "air_freight_inquiry", cat: "Logistik", desc: "Permintaan Air Freight" },
        { words: ["laut","sea freight","kapal","fcl","lcl"], code: "sea_freight_inquiry", cat: "Logistik", desc: "Permintaan Sea Freight" },
        { words: ["impor","import","masuk"], code: "import_inquiry", cat: "Logistik", desc: "Permintaan Import" },
        { words: ["ekspor","export","keluar"], code: "export_inquiry", cat: "Logistik", desc: "Permintaan Export" },
        { words: ["ppjk","bea cukai","kepabeanan","customs clearance"], code: "customs_clearance", cat: "Logistik", desc: "Layanan Bea Cukai" },
        { words: ["vendor","supplier","mitra","rekanan"], code: "permintaan_vendor", cat: "Komersial", desc: "Pendaftaran Vendor" },
        { words: ["rusak","barang rusak","damaged","pecah","cacat"], code: "damaged_goods_complaint", cat: "Komplain", desc: "Komplain Kerusakan Barang" },
        { words: ["terlambat","delay","keterlambatan","lambat"], code: "delivery_delay_complaint", cat: "Komplain", desc: "Komplain Keterlambatan" },
        { words: ["bayar","pembayaran","transfer","konfirmasi"], code: "konfirmasi_pembayaran", cat: "Keuangan", desc: "Konfirmasi Pembayaran" },
        { words: ["tagihan","invoice","faktur","billing"], code: "pertanyaan_tagihan", cat: "Keuangan", desc: "Permintaan Invoice/Tagihan" },
        { words: ["armada","kendaraan","fleet","truk repair","mobil","service kendaraan"], code: "fleet_repair", cat: "Operasional", desc: "Laporan Kerusakan Kendaraan" },
        { words: ["bbm","bensin","solar","fuel","bahan bakar"], code: "fuel_expense", cat: "Operasional", desc: "Laporan BBM" },
        { words: ["ban","tire","tyre"], code: "tire_issue", cat: "Operasional", desc: "Masalah Ban" },
        { words: ["status","cek","track","lacak"], code: "cek_status_pengiriman", cat: "Operasional", desc: "Cek Status Pengiriman" },
      ];
      for (const fb of fallbackMap) {
        if (fb.words.some(w => msgLower.includes(w))) {
          intentCode = fb.code;
          category = fb.cat;
          intentDescription = fb.desc;
          detectedIntent = fb.desc;
          confidence = 55;
          break;
        }
      }
    }

    // Step 3: look up data template for intake mode
    let intakeMode: string | null = null;
    let dataTemplateName: string | null = null;
    let missingFields: string[] = [];

    if (intentCode) {
      const tmplResult = await db.execute(sql`
        SELECT dt.name, dt.intake_mode,
               array_agg(dtf.field_label) FILTER (WHERE dtf.is_required = true) AS required_fields
        FROM data_templates dt
        LEFT JOIN data_template_fields dtf ON dtf.template_id = dt.id
        WHERE dt.intent_code = ${intentCode}
        GROUP BY dt.id, dt.name, dt.intake_mode
        LIMIT 1
      `).catch(() => [] as unknown[]);
      const tmplRows = tmplResult as unknown as Array<Record<string, unknown>>;
      if (tmplRows.length > 0) {
        dataTemplateName = String(tmplRows[0].name ?? "");
        intakeMode = String(tmplRows[0].intake_mode ?? "conversation");
        const rf = tmplRows[0].required_fields;
        if (Array.isArray(rf)) missingFields = rf.map(String).filter(Boolean).slice(0, 5);
      }
    }

    const wouldCreateTask = !!intentCode && confidence >= 50;
    const wouldSendMiniForm = wouldCreateTask && intakeMode === "mini_form";

    res.json({
      simulation: true,
      message: message.trim(),
      detectedIntent,
      intentCode,
      category,
      intentDescription,
      confidence,
      intakeMode: intakeMode ?? "none",
      dataTemplateName,
      missingFields,
      wouldCreateTask,
      wouldSendMiniForm,
      note: "Mode simulasi — tidak ada task dibuat dan tidak ada WA terkirim",
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /system/ai-test failed");
    res.status(500).json({ error: "Gagal menjalankan simulasi AI" });
  }
});

export default router;
