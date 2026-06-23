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

export default router;
