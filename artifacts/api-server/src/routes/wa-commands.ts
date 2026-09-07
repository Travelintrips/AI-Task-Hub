/**
 * Sprint 10A-1 — WhatsApp Command Admin Routes
 *
 * GET  /wa-commands/logs       — recent command execution logs
 * GET  /wa-commands/metrics    — daily usage metrics by role/command
 * GET  /wa-commands/commands   — registered command list
 * POST /wa-commands/commands   — register/update a command
 * POST /wa-commands/test       — manual test: simulate incoming WA command
 */

import { Router } from "express";
import { desc, eq, and, gte } from "drizzle-orm";
import { db, whatsappCommandLogsTable, whatsappUsageMetricsTable } from "@workspace/db";
import { routeWaCommand } from "../lib/wa-command-router";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /wa-commands/logs ──────────────────────────────────────────────────────
router.get("/wa-commands/logs", async (req, res): Promise<void> => {
  try {
    const companyId = (req.query.companyId as string) ?? "default";
    const limit = Math.min(parseInt(req.query.limit as string ?? "100"), 500);
    const daysBack = parseInt(req.query.days as string ?? "7");
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const logs = await db
      .select()
      .from(whatsappCommandLogsTable)
      .where(
        and(
          eq(whatsappCommandLogsTable.companyId, companyId),
          gte(whatsappCommandLogsTable.executedAt, since),
        ),
      )
      .orderBy(desc(whatsappCommandLogsTable.executedAt))
      .limit(limit);

    res.json({ logs, total: logs.length, daysBack });
  } catch (err) {
    logger.error({ err }, "wa-commands: failed to fetch logs");
    res.status(500).json({ error: "Failed to fetch command logs" });
  }
});

// ── GET /wa-commands/metrics ───────────────────────────────────────────────────
router.get("/wa-commands/metrics", async (req, res): Promise<void> => {
  try {
    const companyId = (req.query.companyId as string) ?? "default";
    const daysBack = parseInt(req.query.days as string ?? "30");

    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const metrics = await db
      .select()
      .from(whatsappUsageMetricsTable)
      .where(
        and(
          eq(whatsappUsageMetricsTable.companyId, companyId),
          gte(whatsappUsageMetricsTable.metricDate, since),
        ),
      )
      .orderBy(desc(whatsappUsageMetricsTable.metricDate))
      .limit(1000);

    // Aggregate by command
    const byCommand: Record<string, { execCount: number; successCount: number; errorCount: number; roles: Set<string> }> = {};
    for (const m of metrics) {
      const k = m.command;
      if (!byCommand[k]) byCommand[k] = { execCount: 0, successCount: 0, errorCount: 0, roles: new Set() };
      byCommand[k].execCount += m.execCount;
      byCommand[k].successCount += m.successCount;
      byCommand[k].errorCount += m.errorCount;
      byCommand[k].roles.add(m.role);
    }

    const commandSummary = Object.entries(byCommand).map(([command, v]) => ({
      command,
      execCount: v.execCount,
      successCount: v.successCount,
      errorCount: v.errorCount,
      successRate: v.execCount > 0 ? Math.round((v.successCount / v.execCount) * 100) : 0,
      roles: [...v.roles],
    })).sort((a, b) => b.execCount - a.execCount);

    // Aggregate by role
    const byRole: Record<string, number> = {};
    for (const m of metrics) {
      byRole[m.role] = (byRole[m.role] ?? 0) + m.execCount;
    }

    // Total unique users from logs (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentLogs = await db
      .select({ phone: whatsappCommandLogsTable.phone })
      .from(whatsappCommandLogsTable)
      .where(
        and(
          eq(whatsappCommandLogsTable.companyId, companyId),
          gte(whatsappCommandLogsTable.executedAt, sevenDaysAgo),
        ),
      )
      .limit(5000);
    const uniqueUsers = new Set(recentLogs.map((l) => l.phone)).size;

    res.json({
      daysBack,
      totalExecs: metrics.reduce((s, m) => s + m.execCount, 0),
      uniqueUsersLast7d: uniqueUsers,
      byCommand: commandSummary,
      byRole: Object.entries(byRole).map(([role, count]) => ({ role, count })),
      dailyMetrics: metrics,
    });
  } catch (err) {
    logger.error({ err }, "wa-commands: failed to fetch metrics");
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

// ── POST /wa-commands/test ─────────────────────────────────────────────────────
router.post("/wa-commands/test", async (req, res): Promise<void> => {
  try {
    const { phone, text, companyId = "default" } = req.body as {
      phone?: string;
      text?: string;
      companyId?: string;
    };

    if (!phone || !text) {
      res.status(400).json({ error: "phone and text are required" });
      return;
    }

    const handled = await routeWaCommand(phone, text, companyId);
    res.json({ handled, phone, text, companyId });
  } catch (err) {
    logger.error({ err }, "wa-commands: test route failed");
    res.status(500).json({ error: "Test failed" });
  }
});

export default router;
