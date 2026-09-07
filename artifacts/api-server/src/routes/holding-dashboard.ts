/**
 * Sprint 10B-3 — Cross-Company Consolidation: Holding Dashboard
 *
 * Endpoints (all RBAC: super_admin only):
 *   GET /api/holding/companies          — per-company aggregation
 *   GET /api/holding/health-scores      — consolidated health score per company
 *   GET /api/holding/executive-view     — top/lowest/most/least active companies
 *   GET /api/holding/comparison         — company comparison metrics
 *   GET /api/holding/alerts             — consolidated alerts grouped by severity
 *   POST /api/holding/briefing          — AI holding executive briefing
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseQuery } from "../lib/supabase-db";
import { openai } from "../lib/openai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SUPER_ADMIN = [requireAuth, requireRole("super_admin")] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function safeCount(query: string, params: unknown[] = []): Promise<number> {
  try {
    const rows = await supabaseQuery<{ cnt: string }>(query, params);
    return Number(rows[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

async function safeRows<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    return await supabaseQuery<T>(query, params);
  } catch (err) {
    logger.warn({ err, q: query.slice(0, 60) }, "holding safeRows failed");
    return [];
  }
}

async function safeRow<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await safeRows<T>(query, params);
  return rows[0] ?? null;
}

/** Get all distinct company_ids from company_settings */
async function getAllCompanies(): Promise<Array<{ company_id: string; company_name: string }>> {
  const rows = await safeRows<{ company_id: string; company_name: string | null }>(
    "SELECT company_id, company_name FROM company_settings ORDER BY created_at ASC",
  );
  if (rows.length === 0) return [{ company_id: "default", company_name: "Default" }];
  return rows.map((r) => ({
    company_id: r.company_id,
    company_name: r.company_name ?? r.company_id,
  }));
}

// ── A+B. GET /api/holding/companies ──────────────────────────────────────────
// Per-company aggregation: tasks, customers, vendors, fleet, drivers, purchasing, onboarding

router.get(
  "/holding/companies",
  ...SUPER_ADMIN,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const companies = await getAllCompanies();

      const rows = await Promise.all(
        companies.map(async ({ company_id, company_name }) => {
          const [
            tasks,
            activeTasks,
            customers,
            vendors,
            fleetUnits,
            drivers,
            purchasingRequests,
            pendingApprovals,
            onboardingSessions,
            waMessages,
          ] = await Promise.all([
            safeCount("SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = $1", [company_id]),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = $1 AND status NOT IN ('completed','cancelled','closed')",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM suppliers WHERE company_id::text = $1",
              [company_id],
            ),
            safeCount("SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1", [company_id]),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM fleet_drivers WHERE company_id = $1 AND status = 'active'",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND status IN ('pending_approval','pending')",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM conversation_intake_sessions WHERE company_id = $1",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM whatsapp_messages WHERE company_id = $1",
              [company_id],
            ).catch(() => 0),
          ]);

          const settings = await safeRow<{
            industry_type: string | null;
            ai_enabled: boolean | null;
            created_at: string;
          }>(
            "SELECT industry_type, ai_enabled, created_at FROM company_settings WHERE company_id = $1",
            [company_id],
          );

          return {
            companyId: company_id,
            companyName: company_name,
            industryType: settings?.industry_type ?? null,
            aiEnabled: settings?.ai_enabled ?? false,
            createdAt: settings?.created_at ?? null,
            aggregates: {
              tasks,
              activeTasks,
              customers,
              vendors,
              fleetUnits,
              drivers,
              purchasingRequests,
              pendingApprovals,
              onboardingSessions,
              waMessages,
            },
          };
        }),
      );

      const totals = {
        tasks: rows.reduce((s, r) => s + r.aggregates.tasks, 0),
        activeTasks: rows.reduce((s, r) => s + r.aggregates.activeTasks, 0),
        customers: rows.reduce((s, r) => s + r.aggregates.customers, 0),
        vendors: rows.reduce((s, r) => s + r.aggregates.vendors, 0),
        fleetUnits: rows.reduce((s, r) => s + r.aggregates.fleetUnits, 0),
        drivers: rows.reduce((s, r) => s + r.aggregates.drivers, 0),
        purchasingRequests: rows.reduce((s, r) => s + r.aggregates.purchasingRequests, 0),
        pendingApprovals: rows.reduce((s, r) => s + r.aggregates.pendingApprovals, 0),
        onboardingSessions: rows.reduce((s, r) => s + r.aggregates.onboardingSessions, 0),
        waMessages: rows.reduce((s, r) => s + r.aggregates.waMessages, 0),
      };

      res.json({ generatedAt: new Date().toISOString(), companies: rows, totals });
    } catch (err) {
      logger.error({ err }, "holding/companies failed");
      res.status(500).json({ error: "Failed to aggregate company data" });
    }
  },
);

// ── C. GET /api/holding/health-scores ────────────────────────────────────────
// Consolidated health score per company: onboarding + data quality + fleet + purchasing + memory

router.get(
  "/holding/health-scores",
  ...SUPER_ADMIN,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const companies = await getAllCompanies();

      const scores = await Promise.all(
        companies.map(async ({ company_id, company_name }) => {
          // 1. Onboarding readiness (has settings + team)
          const [hasSettings, teamCount] = await Promise.all([
            safeCount(
              "SELECT COUNT(*) AS cnt FROM company_settings WHERE company_id = $1",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM team_members WHERE company_id = $1",
              [company_id],
            ),
          ]);
          const onboardingScore = Math.min(
            100,
            (hasSettings > 0 ? 50 : 0) + Math.min(50, teamCount * 10),
          );

          // 2. Data quality (customers + vendors with complete info)
          const [custTotal, custWithPhone, vendTotal, vendWithContact] = await Promise.all([
            safeCount("SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1", [company_id]),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1 AND phone IS NOT NULL",
              [company_id],
            ),
            safeCount("SELECT COUNT(*) AS cnt FROM suppliers WHERE company_id::text = $1", [company_id]),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM suppliers WHERE company_id::text = $1 AND phone IS NOT NULL",
              [company_id],
            ),
          ]);
          const custQuality = custTotal > 0 ? Math.round((custWithPhone / custTotal) * 100) : 0;
          const vendQuality = vendTotal > 0 ? Math.round((vendWithContact / vendTotal) * 100) : 0;
          const dataQualityScore = custTotal + vendTotal > 0
            ? Math.round((custQuality + vendQuality) / 2)
            : 0;

          // 3. Fleet readiness (active units / total)
          const [fleetTotal, fleetActive] = await Promise.all([
            safeCount("SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1", [company_id]),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1 AND status = 'active'",
              [company_id],
            ),
          ]);
          const fleetScore = fleetTotal > 0 ? Math.round((fleetActive / fleetTotal) * 100) : 100;

          // 4. Purchasing readiness (resolved / total requests in last 30 days)
          const [purchTotal, purchResolved] = await Promise.all([
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '30 days'",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '30 days' AND status IN ('approved','completed')",
              [company_id],
            ),
          ]);
          const purchScore = purchTotal > 0 ? Math.round((purchResolved / purchTotal) * 100) : 100;

          // 5. Memory coverage (snapshots vs entities)
          const [custSnaps, vendSnaps] = await Promise.all([
            safeCount(
              "SELECT COUNT(*) AS cnt FROM customer_memory_snapshots WHERE company_id = $1 AND is_stale = false",
              [company_id],
            ).catch(() => 0),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM vendor_memory_snapshots WHERE company_id = $1 AND is_stale = false",
              [company_id],
            ).catch(() => 0),
          ]);
          const totalEntities = custTotal + vendTotal;
          const totalSnaps = custSnaps + vendSnaps;
          const memoryCoverageScore = totalEntities > 0
            ? Math.min(100, Math.round((totalSnaps / totalEntities) * 100))
            : 0;

          const overallScore = Math.round(
            onboardingScore * 0.2 +
            dataQualityScore * 0.25 +
            fleetScore * 0.2 +
            purchScore * 0.2 +
            memoryCoverageScore * 0.15,
          );

          const grade =
            overallScore >= 80 ? "A" :
            overallScore >= 65 ? "B" :
            overallScore >= 50 ? "C" :
            overallScore >= 35 ? "D" : "F";

          return {
            companyId: company_id,
            companyName: company_name,
            overallScore,
            grade,
            breakdown: {
              onboardingReadiness: onboardingScore,
              dataQuality: dataQualityScore,
              fleetReadiness: fleetScore,
              purchasingReadiness: purchScore,
              memoryCoverage: memoryCoverageScore,
            },
          };
        }),
      );

      const groupAvg = scores.length > 0
        ? Math.round(scores.reduce((s, r) => s + r.overallScore, 0) / scores.length)
        : 0;

      res.json({
        generatedAt: new Date().toISOString(),
        groupHealthScore: groupAvg,
        groupGrade: groupAvg >= 80 ? "A" : groupAvg >= 65 ? "B" : groupAvg >= 50 ? "C" : groupAvg >= 35 ? "D" : "F",
        companies: scores,
      });
    } catch (err) {
      logger.error({ err }, "holding/health-scores failed");
      res.status(500).json({ error: "Failed to compute health scores" });
    }
  },
);

// ── D. GET /api/holding/executive-view ───────────────────────────────────────
// Top companies, lowest readiness, highest risk, most/least active

router.get(
  "/holding/executive-view",
  ...SUPER_ADMIN,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const companies = await getAllCompanies();

      // Gather task counts + risk flags per company
      const enriched = await Promise.all(
        companies.map(async ({ company_id, company_name }) => {
          const [activeTasks, highRiskFleet, highRiskCustomers, pendingPurchasing, waMessages] =
            await Promise.all([
              safeCount(
                "SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = $1 AND status NOT IN ('completed','cancelled','closed')",
                [company_id],
              ),
              safeCount(
                "SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1 AND status IN ('maintenance','inactive')",
                [company_id],
              ),
              safeCount(
                "SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1 AND risk_tier IN ('high','critical')",
                [company_id],
              ),
              safeCount(
                "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND status IN ('pending_approval','pending')",
                [company_id],
              ),
              safeCount(
                "SELECT COUNT(*) AS cnt FROM whatsapp_messages WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '7 days'",
                [company_id],
              ).catch(() => 0),
            ]);

          const riskScore = highRiskFleet * 2 + highRiskCustomers + pendingPurchasing;

          return {
            companyId: company_id,
            companyName: company_name,
            activeTasks,
            highRiskFleet,
            highRiskCustomers,
            pendingPurchasing,
            waMessages7d: waMessages,
            riskScore,
          };
        }),
      );

      const sorted = [...enriched].sort((a, b) => b.activeTasks - a.activeTasks);

      res.json({
        generatedAt: new Date().toISOString(),
        topByActiveTasks: sorted.slice(0, 5),
        highestRisk: [...enriched].sort((a, b) => b.riskScore - a.riskScore).slice(0, 5),
        mostActive7d: [...enriched].sort((a, b) => b.waMessages7d - a.waMessages7d).slice(0, 5),
        leastActive7d: [...enriched].sort((a, b) => a.waMessages7d - b.waMessages7d).slice(0, 5),
      });
    } catch (err) {
      logger.error({ err }, "holding/executive-view failed");
      res.status(500).json({ error: "Failed to build executive view" });
    }
  },
);

// ── E. GET /api/holding/comparison ───────────────────────────────────────────
// Company comparison: tasks, fleet, vendors, customers, WA usage, AI usage

router.get(
  "/holding/comparison",
  ...SUPER_ADMIN,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const companies = await getAllCompanies();

      const matrix = await Promise.all(
        companies.map(async ({ company_id, company_name }) => {
          const [tasks, fleet, vendors, customers, waTotal, aiTasks, onboarding] = await Promise.all([
            safeCount("SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = $1", [company_id]),
            safeCount("SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1", [company_id]),
            safeCount("SELECT COUNT(*) AS cnt FROM suppliers WHERE company_id::text = $1", [company_id]),
            safeCount("SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1", [company_id]),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM whatsapp_messages WHERE company_id = $1",
              [company_id],
            ).catch(() => 0),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '30 days'",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM conversation_intake_sessions WHERE company_id = $1",
              [company_id],
            ),
          ]);

          return {
            companyId: company_id,
            companyName: company_name,
            metrics: { tasks, fleet, vendors, customers, waUsage: waTotal, aiUsage: aiTasks, onboarding },
          };
        }),
      );

      // Build axis-ready comparison structure
      const metrics = ["tasks", "fleet", "vendors", "customers", "waUsage", "aiUsage", "onboarding"] as const;

      type MetricKey = typeof metrics[number];
      type CompanyMetrics = { tasks: number; fleet: number; vendors: number; customers: number; waUsage: number; aiUsage: number; onboarding: number };

      const comparison = metrics.map((metric) => ({
        metric,
        values: matrix.map((c) => ({
          companyId: c.companyId,
          companyName: c.companyName,
          value: (c.metrics as CompanyMetrics)[metric as MetricKey],
        })),
      }));

      res.json({
        generatedAt: new Date().toISOString(),
        companies: matrix,
        comparison,
      });
    } catch (err) {
      logger.error({ err }, "holding/comparison failed");
      res.status(500).json({ error: "Failed to build comparison matrix" });
    }
  },
);

// ── F. GET /api/holding/alerts ────────────────────────────────────────────────
// Consolidated alerts grouped by severity from multiple sources

router.get(
  "/holding/alerts",
  ...SUPER_ADMIN,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const companies = await getAllCompanies();

      const allAlerts: Array<{
        severity: "critical" | "warning" | "info";
        source: string;
        companyId: string;
        companyName: string;
        message: string;
        count: number;
      }> = [];

      await Promise.all(
        companies.map(async ({ company_id, company_name }) => {
          const [
            pendingApprovals,
            highRiskFleet,
            overdueFleetDocs,
            pendingVendorReviews,
            staleSessions,
            criticalRiskCustomers,
            budgetExceeding,
          ] = await Promise.all([
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND status IN ('pending_approval','pending') AND created_at <= NOW() - INTERVAL '48 hours'",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1 AND status = 'maintenance'",
              [company_id],
            ),
            safeCount(
              `SELECT COUNT(*) AS cnt FROM fleet_documents fd
               JOIN fleet_units fu ON fu.id = fd.unit_id
               WHERE fu.company_id = $1 AND fd.expires_at IS NOT NULL AND fd.expires_at <= CURRENT_DATE + INTERVAL '30 days'`,
              [company_id],
            ).catch(() => 0),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM suppliers WHERE company_id::text = $1 AND registration_status = 'submitted'",
              [company_id],
            ).catch(() => 0),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM conversation_intake_sessions WHERE company_id = $1 AND status = 'collecting' AND updated_at <= NOW() - INTERVAL '24 hours'",
              [company_id],
            ).catch(() => 0),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1 AND risk_tier = 'critical'",
              [company_id],
            ).catch(() => 0),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND ai_margin_impact_pct IS NOT NULL AND ai_margin_impact_pct < 0.10 AND status NOT IN ('rejected','cancelled','completed')",
              [company_id],
            ).catch(() => 0),
          ]);

          if (pendingApprovals > 0)
            allAlerts.push({ severity: "critical", source: "Purchasing", companyId: company_id, companyName: company_name, message: `${pendingApprovals} approval pembelian tertunda >48 jam`, count: pendingApprovals });
          if (highRiskFleet > 0)
            allAlerts.push({ severity: "critical", source: "Fleet", companyId: company_id, companyName: company_name, message: `${highRiskFleet} unit armada dalam perbaikan`, count: highRiskFleet });
          if (criticalRiskCustomers > 0)
            allAlerts.push({ severity: "critical", source: "Executive Command", companyId: company_id, companyName: company_name, message: `${criticalRiskCustomers} pelanggan risiko kritis`, count: criticalRiskCustomers });
          if (budgetExceeding > 0)
            allAlerts.push({ severity: "critical", source: "Purchasing", companyId: company_id, companyName: company_name, message: `${budgetExceeding} PR berisiko margin sangat rendah (<10%)`, count: budgetExceeding });
          if (overdueFleetDocs > 0)
            allAlerts.push({ severity: "warning", source: "Fleet", companyId: company_id, companyName: company_name, message: `${overdueFleetDocs} dokumen armada kadaluarsa dalam 30 hari`, count: overdueFleetDocs });
          if (pendingVendorReviews > 0)
            allAlerts.push({ severity: "warning", source: "Data Governance", companyId: company_id, companyName: company_name, message: `${pendingVendorReviews} vendor menunggu review pendaftaran`, count: pendingVendorReviews });
          if (staleSessions > 0)
            allAlerts.push({ severity: "info", source: "Data Governance", companyId: company_id, companyName: company_name, message: `${staleSessions} sesi intake tidak aktif >24 jam`, count: staleSessions });
        }),
      );

      const grouped = {
        critical: allAlerts.filter((a) => a.severity === "critical"),
        warning: allAlerts.filter((a) => a.severity === "warning"),
        info: allAlerts.filter((a) => a.severity === "info"),
      };

      res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          critical: grouped.critical.length,
          warning: grouped.warning.length,
          info: grouped.info.length,
          total: allAlerts.length,
        },
        alerts: grouped,
      });
    } catch (err) {
      logger.error({ err }, "holding/alerts failed");
      res.status(500).json({ error: "Failed to aggregate alerts" });
    }
  },
);

// ── G. POST /api/holding/briefing ─────────────────────────────────────────────
// AI-generated holding executive briefing summarizing all companies

router.post(
  "/holding/briefing",
  ...SUPER_ADMIN,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const companies = await getAllCompanies();

      // Quick aggregate snapshot for AI context
      const snapshots = await Promise.all(
        companies.map(async ({ company_id, company_name }) => {
          const [tasks, fleetOk, fleetIssue, pendingPR, customers] = await Promise.all([
            safeCount(
              "SELECT COUNT(*) AS cnt FROM ai_tasks WHERE company_id = $1 AND status NOT IN ('completed','cancelled','closed')",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1 AND status = 'active'",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM fleet_units WHERE company_id = $1 AND status IN ('maintenance','inactive')",
              [company_id],
            ),
            safeCount(
              "SELECT COUNT(*) AS cnt FROM logistic_purchase_requests WHERE company_id = $1 AND status IN ('pending_approval','pending')",
              [company_id],
            ),
            safeCount("SELECT COUNT(*) AS cnt FROM customers WHERE company_id::text = $1", [company_id]),
          ]);
          return { company_id, company_name, tasks, fleetOk, fleetIssue, pendingPR, customers };
        }),
      );

      const contextLines = snapshots
        .map(
          (s) =>
            `- ${s.company_name} (${s.company_id}): ${s.tasks} tugas aktif, armada ${s.fleetOk} aktif/${s.fleetIssue} masalah, ${s.pendingPR} PR menunggu approval, ${s.customers} pelanggan`,
        )
        .join("\n");

      const today = new Date().toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const prompt = `Kamu adalah AI Eksekutif Holding yang membuat laporan harian ringkas dalam bahasa Indonesia.

Tanggal: ${today}
Jumlah perusahaan dalam grup: ${companies.length}

Data snapshot semua perusahaan:
${contextLines}

Buat ringkasan eksekutif holding dalam format berikut (Bahasa Indonesia, padat, dan actionable):

1. **Kondisi Grup Hari Ini** — satu paragraf ringkas kondisi keseluruhan
2. **Perhatian Segera** — bullet point max 3 isu kritis yang butuh tindakan sekarang
3. **Sorotan Positif** — bullet point max 2 hal baik dari grup
4. **Rekomendasi** — 2-3 langkah konkret untuk hari ini

Gunakan bahasa eksekutif yang tegas dan langsung. Jangan sertakan data mentah yang sudah ditampilkan di dashboard.`;

      let briefingText: string;
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 800,
          temperature: 0.4,
        });
        briefingText = completion.choices[0]?.message?.content ?? "Briefing tidak tersedia.";
      } catch (aiErr) {
        logger.warn({ aiErr }, "holding/briefing AI call failed — using fallback");
        const criticalCount = snapshots.filter((s) => s.pendingPR > 0 || s.fleetIssue > 0).length;
        briefingText = `**Kondisi Grup Hari Ini**\nGrup terdiri dari ${companies.length} perusahaan dengan total ${snapshots.reduce((s, r) => s + r.tasks, 0)} tugas aktif dan ${snapshots.reduce((s, r) => s + r.pendingPR, 0)} approval pembelian menunggu tindakan. ${criticalCount} perusahaan memerlukan perhatian segera.\n\n**Perhatian Segera**\n- Tinjau approval pembelian yang tertunda di semua unit\n- Periksa armada yang sedang dalam perbaikan\n\n**Rekomendasi**\n- Lakukan daily standup cross-company untuk isu kritis\n- Pantau dashboard holding setiap pagi`;
      }

      // Log briefing to audit_logs
      try {
        await supabaseQuery(
          `INSERT INTO audit_logs (module, action, entity_type, details, created_at)
           VALUES ('holding_dashboard', 'briefing_generated', 'holding', $1, NOW())`,
          [JSON.stringify({ companyCount: companies.length, generatedAt: new Date().toISOString() })],
        );
      } catch {
        // non-critical
      }

      res.json({
        generatedAt: new Date().toISOString(),
        companyCount: companies.length,
        briefing: briefingText,
        snapshot: snapshots,
      });
    } catch (err) {
      logger.error({ err }, "holding/briefing failed");
      res.status(500).json({ error: "Failed to generate holding briefing" });
    }
  },
);

export default router;
