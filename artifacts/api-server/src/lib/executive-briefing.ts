/**
 * Sprint 10A-5 — Executive Daily Briefing
 *
 * generateBriefingMessage(companyId) — builds compact WA message from all data sources
 * sendExecutiveBriefing(companyId)   — resolves recipients, checks WA health, sends + logs
 * startExecutiveBriefingScheduler() — daily 07:00 WIB (= 00:00 UTC)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { supabasePool, supabaseQuery } from "./supabase-db";
import { sendFonnte } from "./fonnte";
import { logger } from "./logger";

const DEFAULT_COMPANY_ID = process.env["COMPANY_ID"] ?? "default";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function safeCount(query: ReturnType<typeof sql>): Promise<number> {
  try {
    const r = await db.execute(query);
    return Number((r.rows[0] as { cnt?: string | number } | undefined)?.cnt ?? 0);
  } catch {
    return 0;
  }
}

function msUntilNextTimeWib(targetHourWib: number, targetMin = 0): number {
  const nowMs = Date.now();
  const targetUtcHour = targetHourWib - 7; // WIB (UTC+7) → UTC
  const target = new Date();
  target.setUTCHours(((targetUtcHour % 24) + 24) % 24, targetMin, 0, 0);
  if (target.getTime() <= nowMs) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - nowMs;
}

// ── Log to executive_briefing_logs ─────────────────────────────────────────────

export async function logBriefingSend(opts: {
  companyId: string;
  recipientPhone: string;
  recipientRole: string | null;
  status: "sent" | "failed" | "skipped";
  messagePreview: string | null;
  errorMessage?: string | null;
  deliveryProvider?: string;
}): Promise<void> {
  try {
    await supabaseQuery(
      `INSERT INTO executive_briefing_logs
         (company_id, recipient_phone, recipient_role, status, message_preview, sent_at, error_message, delivery_provider, created_at)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $4='sent' THEN NOW() ELSE NULL END,$6,$7,NOW())`,
      [
        opts.companyId,
        opts.recipientPhone,
        opts.recipientRole ?? null,
        opts.status,
        opts.messagePreview ? opts.messagePreview.slice(0, 500) : null,
        opts.errorMessage ?? null,
        opts.deliveryProvider ?? "fonnte",
      ],
    );
  } catch (err) {
    logger.warn({ err }, "executive-briefing: failed to write log (non-fatal)");
  }
}

// ── Core message generator ─────────────────────────────────────────────────────

export async function generateBriefingMessage(companyId: string): Promise<string> {
  const [
    activeTasks,
    overdueTasks,
    pendingApprovals,
    expiringFleetDocs,
    expiredFleetDocs,
    fleetInMaintenance,
    criticalVendors,
    highRiskVendors,
    duplicatePurchases,
    marginRisk,
    highRiskCustomers,
    fuelAnomalies,
    activeDrivers,
    simExpiring,
  ] = await Promise.all([
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM ai_tasks WHERE company_id = ${companyId} AND status NOT IN ('completed','cancelled','closed')`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM ai_tasks WHERE company_id = ${companyId} AND sla_status = 'overdue' AND status NOT IN ('completed','cancelled','closed')`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests WHERE company_id = ${companyId} AND status = 'submitted_for_approval'`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM fleet_documents WHERE company_id = ${companyId} AND expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days' AND status != 'expired'`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM fleet_documents WHERE company_id = ${companyId} AND status = 'expired'`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM fleet_units WHERE company_id = ${companyId} AND status IN ('maintenance','inactive')`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM intel_vendors WHERE company_id = ${companyId} AND risk_tier = 'critical' AND is_stale = false`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM intel_vendors WHERE company_id = ${companyId} AND risk_tier = 'high' AND is_stale = false`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests WHERE company_id = ${companyId} AND ai_duplicate_flag = true AND status NOT IN ('rejected','cancelled','completed')`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests WHERE company_id = ${companyId} AND ai_margin_impact_pct IS NOT NULL AND ai_margin_impact_pct < 0.15 AND status NOT IN ('rejected','cancelled','completed')`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM customers WHERE risk_tier IN ('high','critical')`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM fleet_fuel_logs WHERE company_id = ${companyId} AND is_anomaly = true AND logged_at >= NOW() - INTERVAL '7 days'`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM fleet_drivers WHERE company_id = ${companyId} AND status = 'active'`),
    safeCount(sql`SELECT COUNT(*)::int AS cnt FROM fleet_drivers WHERE company_id = ${companyId} AND status = 'active' AND license_expired IS NOT NULL AND license_expired <= CURRENT_DATE + INTERVAL '30 days'`),
  ]);

  // Try AI summary (truncated for WA)
  let summaryText: string | null = null;
  try {
    if (supabasePool) {
      const r = await supabasePool.query<{ summary: string; generated_at: string }>(
        `SELECT summary, generated_at FROM executive_summaries WHERE company_id = $1 ORDER BY generated_at DESC LIMIT 1`,
        [companyId],
      );
      if (r.rows[0]?.summary) {
        summaryText = r.rows[0].summary.slice(0, 280);
      }
    }
  } catch { /* non-fatal */ }

  // Risk list (priority order)
  const risks: Array<{ emoji: string; label: string; detail: string }> = [];
  if (criticalVendors > 0)  risks.push({ emoji: "🔴", label: "Vendor Kritis",           detail: `${criticalVendors} vendor risiko kritis aktif` });
  if (expiredFleetDocs > 0) risks.push({ emoji: "🔴", label: "Dokumen Armada Kadaluarsa", detail: `${expiredFleetDocs} dokumen sudah kadaluarsa` });
  if (overdueTasks > 0)     risks.push({ emoji: "🟠", label: "Task Overdue SLA",          detail: `${overdueTasks} task melewati deadline` });
  if (duplicatePurchases > 0) risks.push({ emoji: "🟠", label: "Pembelian Duplikat",      detail: `${duplicatePurchases} permintaan berpotensi duplikat` });
  if (highRiskVendors > 0)  risks.push({ emoji: "🟡", label: "Vendor Risiko Tinggi",      detail: `${highRiskVendors} vendor risiko tinggi` });
  if (marginRisk > 0)       risks.push({ emoji: "🟡", label: "Margin Di Bawah Batas",     detail: `${marginRisk} permintaan margin < 15%` });
  if (expiringFleetDocs > 0) risks.push({ emoji: "🟡", label: "Dok. Armada Segera Kadaluarsa", detail: `${expiringFleetDocs} dokumen dalam 30 hari` });
  if (simExpiring > 0)      risks.push({ emoji: "🟡", label: "SIM Driver Segera Kadaluarsa",   detail: `${simExpiring} SIM driver dalam 30 hari` });
  if (fuelAnomalies > 0)    risks.push({ emoji: "🟡", label: "Anomali BBM",               detail: `${fuelAnomalies} transaksi anomali 7 hari terakhir` });
  if (highRiskCustomers > 0) risks.push({ emoji: "🟡", label: "Customer Risiko Tinggi",   detail: `${highRiskCustomers} customer risiko tinggi/kritis` });
  const topRisks = risks.slice(0, 5);

  // Recommendations
  const actions: string[] = [];
  if (pendingApprovals > 0) actions.push(`Review ${pendingApprovals} purchase request menunggu persetujuan`);
  if (expiredFleetDocs > 0) actions.push(`Perpanjang ${expiredFleetDocs} dokumen armada kadaluarsa`);
  if (criticalVendors > 0)  actions.push(`Tindak lanjuti ${criticalVendors} vendor risiko kritis`);
  if (overdueTasks > 0)     actions.push(`Eskalasi ${overdueTasks} task yang melewati SLA`);
  if (simExpiring > 0)      actions.push(`Koordinasikan perpanjangan SIM ${simExpiring} driver`);
  if (actions.length === 0) actions.push("Tidak ada tindakan mendesak — operasional normal");

  // WIB date string
  const wibNow = new Date(Date.now() + 7 * 3600 * 1000);
  const tanggal = wibNow.toLocaleDateString("id-ID", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  // Build message
  let msg = `🌅 *Selamat pagi! Briefing Harian — ${tanggal}*\n\n`;

  msg += `📊 *RINGKASAN EKSEKUTIF*\n`;
  msg += summaryText
    ? `${summaryText}\n\n`
    : `${activeTasks} task aktif, ${overdueTasks} overdue, ${pendingApprovals} approval menunggu.\n\n`;

  if (topRisks.length > 0) {
    msg += `⚠️ *TOP RISIKO (${topRisks.length})*\n`;
    topRisks.forEach((r, i) => { msg += `${i + 1}. ${r.emoji} *${r.label}*\n   ${r.detail}\n`; });
    msg += "\n";
  } else {
    msg += `✅ *RISIKO* — Tidak ada risiko signifikan\n\n`;
  }

  if (pendingApprovals > 0) {
    msg += `⏳ *PERSETUJUAN* — ${pendingApprovals} menunggu keputusan\n\n`;
  }

  const fleetItems: string[] = [];
  if (expiredFleetDocs > 0)  fleetItems.push(`${expiredFleetDocs} dokumen kadaluarsa`);
  if (expiringFleetDocs > 0) fleetItems.push(`${expiringFleetDocs} dokumen segera kadaluarsa`);
  if (fleetInMaintenance > 0) fleetItems.push(`${fleetInMaintenance} armada dalam perbaikan`);
  if (fuelAnomalies > 0)     fleetItems.push(`${fuelAnomalies} anomali BBM`);
  if (simExpiring > 0)       fleetItems.push(`${simExpiring} SIM driver akan kadaluarsa`);
  if (fleetItems.length > 0) {
    msg += `🚛 *ARMADA* (${activeDrivers} driver aktif)\n`;
    fleetItems.forEach(item => { msg += `• ${item}\n`; });
    msg += "\n";
  }

  const purchItems: string[] = [];
  if (duplicatePurchases > 0) purchItems.push(`${duplicatePurchases} permintaan berpotensi duplikat`);
  if (marginRisk > 0)         purchItems.push(`${marginRisk} permintaan margin di bawah 15%`);
  if (purchItems.length > 0) {
    msg += `💰 *PEMBELIAN*\n`;
    purchItems.forEach(item => { msg += `• ${item}\n`; });
    msg += "\n";
  }

  const vendorItems: string[] = [];
  if (criticalVendors > 0) vendorItems.push(`${criticalVendors} vendor risiko kritis`);
  if (highRiskVendors > 0) vendorItems.push(`${highRiskVendors} vendor risiko tinggi`);
  if (vendorItems.length > 0) {
    msg += `🏢 *VENDOR*\n`;
    vendorItems.forEach(item => { msg += `• ${item}\n`; });
    msg += "\n";
  }

  const custItems: string[] = [];
  if (highRiskCustomers > 0) custItems.push(`${highRiskCustomers} customer risiko tinggi/kritis`);
  if (activeTasks > 0)       custItems.push(`${activeTasks} task aktif`);
  if (custItems.length > 0) {
    msg += `👥 *PELANGGAN & TUGAS*\n`;
    custItems.forEach(item => { msg += `• ${item}\n`; });
    msg += "\n";
  }

  msg += `💡 *REKOMENDASI*\n`;
  actions.slice(0, 4).forEach((a, i) => { msg += `${i + 1}. ${a}\n`; });

  msg += `\n_Kirim *DASHBOARD*, *RISK*, atau *BRIEFING* via WhatsApp untuk detail._`;

  return msg;
}

// ── Get briefing settings ──────────────────────────────────────────────────────

interface BriefingSettings {
  enabled: boolean;
  time: string;
  recipients: string[];
}

export async function getBriefingSettings(companyId: string): Promise<BriefingSettings> {
  try {
    const rows = await supabaseQuery<{
      executive_briefing_enabled: boolean | string | null;
      executive_briefing_time: string | null;
      executive_briefing_recipients: string | null;
    }>(
      `SELECT executive_briefing_enabled, executive_briefing_time, executive_briefing_recipients
       FROM company_settings WHERE company_id = $1 LIMIT 1`,
      [companyId],
    );
    const row = rows[0];
    if (!row) return { enabled: false, time: "07:00", recipients: ["owner", "super_admin", "company_admin"] };
    return {
      enabled: row.executive_briefing_enabled === true || row.executive_briefing_enabled === "true",
      time: row.executive_briefing_time ?? "07:00",
      recipients: row.executive_briefing_recipients
        ? row.executive_briefing_recipients.split(",").map((s) => s.trim()).filter(Boolean)
        : ["owner", "super_admin", "company_admin"],
    };
  } catch {
    return { enabled: false, time: "07:00", recipients: ["owner", "super_admin", "company_admin"] };
  }
}

// ── Resolve recipients ─────────────────────────────────────────────────────────

interface Recipient {
  phone: string;
  role: string;
  name: string;
}

export async function resolveRecipients(companyId: string, roleFilter: string[]): Promise<Recipient[]> {
  try {
    const placeholders = roleFilter.map((_, i) => `$${i + 2}`).join(",");
    const rows = await supabaseQuery<{ phone: string; role: string; name: string }>(
      `SELECT phone, role, name FROM team_members
       WHERE company_id = $1 AND role IN (${placeholders})
         AND phone IS NOT NULL AND is_active = true
       ORDER BY id`,
      [companyId, ...roleFilter],
    );
    return rows
      .filter((r) => r.phone && r.phone.length > 5)
      .map((r) => ({ phone: r.phone, role: r.role, name: r.name ?? "" }));
  } catch {
    return [];
  }
}

// ── Check WA health (Fonnte token set) ────────────────────────────────────────

function isWaHealthy(): boolean {
  return !!(process.env["FONNTE_TOKEN"] ?? "").trim();
}

// ── Send briefing to all recipients ───────────────────────────────────────────

export async function sendExecutiveBriefing(
  companyId: string,
  opts?: { forcePhone?: string; forceEnabled?: boolean },
): Promise<{ sent: number; skipped: number; failed: number; logs: Array<{ phone: string; status: string }> }> {
  const stats = { sent: 0, skipped: 0, failed: 0, logs: [] as Array<{ phone: string; status: string }> };

  if (!isWaHealthy()) {
    logger.warn({ companyId }, "executive-briefing: WA not healthy — skipping send");
    await logBriefingSend({
      companyId,
      recipientPhone: "system",
      recipientRole: null,
      status: "skipped",
      messagePreview: null,
      errorMessage: "WhatsApp (Fonnte) tidak terkonfigurasi",
    });
    stats.skipped++;
    return stats;
  }

  const settings = await getBriefingSettings(companyId);
  if (!settings.enabled && !opts?.forceEnabled) {
    logger.info({ companyId }, "executive-briefing: disabled in settings — skipping");
    stats.skipped++;
    return stats;
  }

  const message = await generateBriefingMessage(companyId);
  const preview = message.slice(0, 200);

  let recipients: Recipient[];
  if (opts?.forcePhone) {
    recipients = [{ phone: opts.forcePhone, role: "manual", name: "Manual Trigger" }];
  } else {
    recipients = await resolveRecipients(companyId, settings.recipients);
  }

  if (recipients.length === 0) {
    logger.warn({ companyId }, "executive-briefing: no recipients with phone — skipping");
    await logBriefingSend({
      companyId,
      recipientPhone: "none",
      recipientRole: null,
      status: "skipped",
      messagePreview: null,
      errorMessage: "Tidak ada penerima dengan nomor telepon terdaftar",
    });
    stats.skipped++;
    return stats;
  }

  for (const r of recipients) {
    try {
      await sendFonnte(r.phone, message);
      await logBriefingSend({
        companyId,
        recipientPhone: r.phone,
        recipientRole: r.role,
        status: "sent",
        messagePreview: preview,
      });
      stats.sent++;
      stats.logs.push({ phone: r.phone, status: "sent" });
      logger.info({ companyId, phone: r.phone, role: r.role }, "executive-briefing: sent");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await logBriefingSend({
        companyId,
        recipientPhone: r.phone,
        recipientRole: r.role,
        status: "failed",
        messagePreview: preview,
        errorMessage: errMsg,
      });
      stats.failed++;
      stats.logs.push({ phone: r.phone, status: "failed" });
      logger.error({ err, phone: r.phone }, "executive-briefing: send failed");
    }
  }

  return stats;
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

let briefingTimer: NodeJS.Timeout | null = null;

async function runBriefing(): Promise<void> {
  logger.info({ companyId: DEFAULT_COMPANY_ID }, "executive-daily-briefing: starting");
  try {
    const stats = await sendExecutiveBriefing(DEFAULT_COMPANY_ID, { forceEnabled: false });
    logger.info({ stats }, "executive-daily-briefing: completed");
  } catch (err) {
    logger.error({ err }, "executive-daily-briefing: job threw");
  }
}

function scheduleBriefing(): void {
  const [hStr, mStr] = (process.env["BRIEFING_TIME_WIB"] ?? "07:00").split(":");
  const hour = parseInt(hStr ?? "7", 10);
  const minute = parseInt(mStr ?? "0", 10);
  const delay = msUntilNextTimeWib(hour, minute);
  logger.info(
    { nextRun: new Date(Date.now() + delay).toISOString() },
    "executive-daily-briefing scheduled",
  );
  briefingTimer = setTimeout(() => {
    void runBriefing();
    scheduleBriefing();
  }, delay);
}

export function startExecutiveBriefingScheduler(): () => void {
  scheduleBriefing();
  logger.info("Executive Briefing Scheduler started — daily 07:00 WIB");
  return () => {
    if (briefingTimer) { clearTimeout(briefingTimer); briefingTimer = null; }
    logger.info("Executive Briefing Scheduler stopped");
  };
}
