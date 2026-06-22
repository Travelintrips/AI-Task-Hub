/**
 * Sprint 7D — Fleet WhatsApp Reporting API
 *
 * POST /api/fleet/reports/whatsapp — kirim laporan fleet via WA
 *
 * Report types:
 *   daily_fleet_summary   — ringkasan harian fleet
 *   critical_alert        — alert kritis (HIGH/CRITICAL risk)
 *   weekly_performance    — laporan performa mingguan
 *   maintenance_approval  — notifikasi approval servis
 *
 * Rules:
 *   - Hanya kirim ke internal team members
 *   - Tidak pernah broadcast ke customers
 *   - Gunakan Fonnte jika token tersedia
 *   - Jika Fonnte tidak tersedia, simpan ke fleet_report_logs status=failed
 *   - Semua pengiriman dicatat di fleet_report_logs
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";
import { sendFonnte } from "../lib/fonnte";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

type ReportType = "daily_fleet_summary" | "critical_alert" | "weekly_performance" | "maintenance_approval";

// ── Message builders ─────────────────────────────────────────────────────────

async function buildDailyFleetSummary(companyId: string): Promise<string> {
  const today = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const units = await supabaseQuery<{ total: string; available: string; maintenance: string; on_route: string }>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'available') AS available,
      COUNT(*) FILTER (WHERE status = 'maintenance') AS maintenance,
      COUNT(*) FILTER (WHERE status = 'on_route') AS on_route
    FROM fleet_units WHERE company_id = $1 AND is_active = true
  `, [companyId]).catch(() => []);

  const u = units[0] ?? { total: "0", available: "0", maintenance: "0", on_route: "0" };

  const highRisk = await supabaseQuery<{ count: string }>(`
    SELECT COUNT(*) AS count FROM fleet_risk_scores
    WHERE company_id = $1 AND risk_level IN ('HIGH', 'CRITICAL')
  `, [companyId]).catch(() => [{ count: "0" }]);

  const docExpiring = await supabaseQuery<{ count: string }>(`
    SELECT COUNT(*) AS count FROM fleet_documents
    WHERE company_id = $1 AND status = 'expiring_soon' AND is_active = true
  `, [companyId]).catch(() => [{ count: "0" }]);

  const avgCost = await supabaseQuery<{ avg_cpk: number | null }>(`
    SELECT AVG(cost_per_km) AS avg_cpk FROM fleet_cost_per_km
    WHERE company_id = $1 AND period_month = TO_CHAR(NOW(), 'YYYY-MM')
  `, [companyId]).catch(() => [{ avg_cpk: null }]);

  const cpk = avgCost[0]?.avg_cpk ? `Rp ${Math.round(Number(avgCost[0].avg_cpk)).toLocaleString("id-ID")}` : "N/A";

  return `🚛 *LAPORAN HARIAN FLEET*
📅 ${today}

*Status Armada:*
• Total Unit: ${u.total}
• Tersedia: ${u.available}
• Di Jalan: ${u.on_route}
• Servis/Perawatan: ${u.maintenance}

*Risiko & Dokumen:*
• Unit Risiko Tinggi/Kritis: ${highRisk[0]?.count ?? "0"}
• Dokumen Hampir Expired: ${docExpiring[0]?.count ?? "0"}

*Biaya:*
• Avg Cost/KM bulan ini: ${cpk}

_Dikirim otomatis oleh Fleet Management System_`;
}

async function buildCriticalAlert(companyId: string): Promise<string> {
  const criticals = await supabaseQuery<{ unit_number: string; plate_number: string; overall_score: number; risk_level: string; risk_factors: string }>(`
    SELECT unit_number, plate_number, overall_score, risk_level, risk_factors
    FROM fleet_risk_scores
    WHERE company_id = $1 AND risk_level IN ('HIGH', 'CRITICAL')
    ORDER BY overall_score ASC LIMIT 10
  `, [companyId]);

  if (!criticals.length) return "✅ Tidak ada unit dengan risiko HIGH atau CRITICAL saat ini.";

  const lines = criticals.map(r => {
    const emoji = r.risk_level === "CRITICAL" ? "🔴" : "🟠";
    const factors = (() => {
      try { return (JSON.parse(r.risk_factors) as string[]).slice(0, 2).join(", "); }
      catch { return ""; }
    })();
    return `${emoji} *${r.unit_number}* (${r.plate_number}) — Score: ${Math.round(r.overall_score)}/100\n   ${factors}`;
  }).join("\n\n");

  return `⚠️ *FLEET CRITICAL ALERT*

Unit dengan Risiko Tinggi/Kritis:

${lines}

_Segera tindaklanjuti unit-unit di atas!_`;
}

async function buildWeeklyPerformance(companyId: string): Promise<string> {
  const period = new Date().toISOString().slice(0, 7);

  const topDrivers = await supabaseQuery<{ driver_name: string; avg_score: number; total_trips: number }>(`
    SELECT d.full_name AS driver_name, AVG(p.overall_score) AS avg_score, SUM(p.total_trips) AS total_trips
    FROM fleet_driver_performance p
    JOIN fleet_drivers d ON d.id = p.driver_id
    WHERE d.company_id = $1 AND p.period_month = $2
    GROUP BY d.id, d.full_name
    ORDER BY avg_score DESC LIMIT 5
  `, [companyId, period]).catch(() => []);

  const driverLines = topDrivers.length > 0
    ? topDrivers.map((d, i) => `${i + 1}. *${d.driver_name}* — Score: ${Math.round(Number(d.avg_score))}/100, Trips: ${d.total_trips}`).join("\n")
    : "Data performa belum tersedia";

  const bestRoute = await supabaseQuery<{ route: string; margin_pct: number }>(`
    SELECT route, margin_pct FROM fleet_route_profitability
    WHERE company_id = $1 AND period_month = $2
    ORDER BY margin_pct DESC LIMIT 1
  `, [companyId, period]).catch(() => []);

  return `📊 *LAPORAN PERFORMA MINGGUAN FLEET*
📅 Periode: ${period}

*Top 5 Pengemudi:*
${driverLines}

*Rute Paling Profitabel:*
${bestRoute[0] ? `✅ ${bestRoute[0].route} — Margin: ${Math.round(Number(bestRoute[0].margin_pct))}%` : "Data belum tersedia"}

_Laporan dikirim setiap Senin_`;
}

async function buildMaintenanceApproval(companyId: string): Promise<string> {
  const pending = await supabaseQuery<{ unit_number: string; plate_number: string; maintenance_type: string; estimated_cost: number; scheduled_date: string }>(`
    SELECT fu.unit_number, fu.plate_number, mr.maintenance_type, mr.estimated_cost, mr.scheduled_date::TEXT
    FROM fleet_maintenance_records mr
    JOIN fleet_units fu ON fu.id = mr.fleet_unit_id
    WHERE mr.company_id = $1 AND mr.status = 'pending'
      AND mr.scheduled_date <= NOW() + INTERVAL '3 days'
    ORDER BY mr.scheduled_date ASC LIMIT 5
  `, [companyId]).catch(() => []);

  if (!pending.length) return "✅ Tidak ada servis pending yang memerlukan approval dalam 3 hari ke depan.";

  const lines = pending.map(p =>
    `🔧 *${p.unit_number}* (${p.plate_number})\n   Jenis: ${p.maintenance_type} | Est. Biaya: Rp ${Math.round(Number(p.estimated_cost)).toLocaleString("id-ID")}\n   Jadwal: ${p.scheduled_date}`
  ).join("\n\n");

  return `🔧 *APPROVAL SERVIS DIPERLUKAN*

Servis berikut menunggu persetujuan:

${lines}

_Segera setujui atau tolak di sistem Fleet Management_`;
}

const MESSAGE_BUILDERS: Record<ReportType, (companyId: string) => Promise<string>> = {
  daily_fleet_summary: buildDailyFleetSummary,
  critical_alert: buildCriticalAlert,
  weekly_performance: buildWeeklyPerformance,
  maintenance_approval: buildMaintenanceApproval,
};

// ── POST /api/fleet/reports/whatsapp ─────────────────────────────────────────

router.post("/fleet/reports/whatsapp", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as { reportType?: string; recipientIds?: number[]; message?: string };

    const reportType = (body.reportType || "daily_fleet_summary") as ReportType;
    if (!MESSAGE_BUILDERS[reportType]) {
      return res.status(400).json({ error: `reportType tidak valid: ${reportType}` });
    }

    // Build message
    const builder = MESSAGE_BUILDERS[reportType];
    const message = body.message || await builder(companyId);

    // Get internal team members only — never broadcast to customers
    let recipientQuery = `
      SELECT id, name, phone FROM team_members
      WHERE company_id = $1 AND is_active = true AND phone IS NOT NULL
        AND role IN ('manager', 'supervisor', 'admin', 'fleet_manager', 'company_admin', 'super_admin')
    `;
    const recipientParams: unknown[] = [companyId];

    if (body.recipientIds?.length) {
      recipientQuery += ` AND id = ANY($2::int[])`;
      recipientParams.push(body.recipientIds);
    }

    const recipients = await supabaseQuery<{ id: number; name: string; phone: string }>(recipientQuery, recipientParams);

    if (!recipients.length) {
      return res.status(400).json({ error: "Tidak ada penerima internal yang ditemukan" });
    }

    const sendResults = [];

    for (const recipient of recipients) {
      let status = "sent";
      let errorReason: string | null = null;
      let fonnteMessageId: string | null = null;

      try {
        const result = await sendFonnte(recipient.phone, message);
        if (result.success) {
          fonnteMessageId = result.messageId ?? null;
          logger.info({ recipient: recipient.name, reportType }, "Fleet WA report sent");
        } else {
          status = "failed";
          errorReason = result.error ?? "Fonnte failed";
          logger.warn({ recipient: recipient.name, error: errorReason }, "Fleet WA report failed");
        }
      } catch (e) {
        status = "failed";
        errorReason = String(e);
      }

      // Log setiap pengiriman
      await supabaseQuery(`
        INSERT INTO fleet_report_logs
          (company_id, report_type, recipient_name, recipient_phone, message_preview,
           status, error_reason, fonnte_message_id, triggered_by, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      `, [
        companyId, reportType, recipient.name, recipient.phone,
        message.slice(0, 200), status, errorReason, fonnteMessageId,
        req.user?.name ?? "system",
      ]);

      sendResults.push({ name: recipient.name, phone: recipient.phone.replace(/\d(?=\d{4})/g, "*"), status, errorReason });
    }

    const successCount = sendResults.filter(r => r.status === "sent").length;
    return res.json({
      success: successCount > 0,
      reportType,
      sent: successCount,
      failed: sendResults.length - successCount,
      results: sendResults,
    });
  } catch (err) {
    logger.error({ err }, "POST /fleet/reports/whatsapp failed");
    return res.status(500).json({ error: "Gagal mengirim laporan WA" });
  }
});

// ── GET /api/fleet/reports/logs ──────────────────────────────────────────────

router.get("/fleet/reports/logs", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const rows = await supabaseQuery(`
      SELECT * FROM fleet_report_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100
    `, [companyId]);
    return res.json({ data: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /fleet/reports/logs failed");
    return res.status(500).json({ error: "Gagal mengambil log laporan" });
  }
});

export default router;
