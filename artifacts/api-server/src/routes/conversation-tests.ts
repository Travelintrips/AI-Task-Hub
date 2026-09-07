/**
 * Sprint 9D — Conversation Test Suite & AI Quality Gate API
 * Router mounted at /api in app.ts — paths here are WITHOUT /api prefix.
 *
 * GET  /conversation-tests/cases
 * POST /conversation-tests/cases
 * PATCH /conversation-tests/cases/:id
 * DELETE /conversation-tests/cases/:id
 *
 * POST /conversation-tests/run
 * GET  /conversation-tests/runs
 * GET  /conversation-tests/runs/:id
 * GET  /conversation-tests/results/:runId
 * GET  /conversation-tests/latest-gate
 * PATCH /conversation-tests/production-mode
 */

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  conversationTestCasesTable,
  conversationTestRunsTable,
  conversationTestResultsTable,
  companySettingsTable,
} from "@workspace/db";
import { runTestSuite } from "../lib/conversation-test-runner";
import { logger } from "../lib/logger";

const router = Router();
const DEFAULT_COMPANY = "default";

function getCompanyId(req: { user?: { companyId?: string } }): string {
  return req.user?.companyId ?? DEFAULT_COMPANY;
}

// ── Test Cases ─────────────────────────────────────────────────────────────────

router.get("/conversation-tests/cases", async (req, res) => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const cases = await db
      .select()
      .from(conversationTestCasesTable)
      .where(eq(conversationTestCasesTable.companyId, companyId))
      .orderBy(conversationTestCasesTable.id);
    res.json(cases);
  } catch (err) {
    logger.error({ err }, "GET /conversation-tests/cases failed");
    res.status(500).json({ error: "Gagal memuat test cases" });
  }
});

router.post("/conversation-tests/cases", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const body = req.body as Record<string, unknown>;

    if (!body.testName) {
      res.status(400).json({ error: "testName wajib diisi" }); return;
    }

    const [row] = await db
      .insert(conversationTestCasesTable)
      .values({
        companyId,
        testName: body.testName as string,
        intentCode: (body.intentCode as string | undefined) ?? null,
        scenarioType: (body.scenarioType as string | undefined) ?? "normal",
        inputMessages: (body.inputMessages as string[]) ?? [],
        expectedBehavior: (body.expectedBehavior as Record<string, unknown>) ?? {},
        expectedIntentCode: (body.expectedIntentCode as string | undefined) ?? null,
        expectedIntakeMode: (body.expectedIntakeMode as string | undefined) ?? null,
        expectedTaskCreated: (body.expectedTaskCreated as boolean | undefined) ?? false,
        expectedMiniFormSent: (body.expectedMiniFormSent as boolean | undefined) ?? false,
        expectedAdminHandoff: (body.expectedAdminHandoff as boolean | undefined) ?? false,
        expectedMissingFields: (body.expectedMissingFields as string[]) ?? [],
        isCritical: (body.isCritical as boolean | undefined) ?? false,
        isActive: (body.isActive as boolean | undefined) ?? true,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /conversation-tests/cases failed");
    res.status(500).json({ error: "Gagal membuat test case" });
  }
});

router.patch("/conversation-tests/cases/:id", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const id = parseInt(req.params.id!, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const body = req.body as Record<string, unknown>;
    const allowed = [
      "testName", "intentCode", "scenarioType", "inputMessages", "expectedBehavior",
      "expectedIntentCode", "expectedIntakeMode", "expectedTaskCreated",
      "expectedMiniFormSent", "expectedAdminHandoff", "expectedMissingFields",
      "isCritical", "isActive",
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Tidak ada field yang diupdate" }); return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row] = await (db.update(conversationTestCasesTable) as any)
      .set(updates)
      .where(and(eq(conversationTestCasesTable.id, id), eq(conversationTestCasesTable.companyId, companyId)))
      .returning();

    if (!row) { res.status(404).json({ error: "Test case tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "PATCH /conversation-tests/cases/:id failed");
    res.status(500).json({ error: "Gagal memperbarui test case" });
  }
});

router.delete("/conversation-tests/cases/:id", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const id = parseInt(req.params.id!, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [row] = await db
      .delete(conversationTestCasesTable)
      .where(and(eq(conversationTestCasesTable.id, id), eq(conversationTestCasesTable.companyId, companyId)))
      .returning();

    if (!row) { res.status(404).json({ error: "Test case tidak ditemukan" }); return; }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /conversation-tests/cases/:id failed");
    res.status(500).json({ error: "Gagal menghapus test case" });
    return;
  }
});

// ── Test Runs ──────────────────────────────────────────────────────────────────

router.post("/conversation-tests/run", async (req, res) => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const { runName, caseIds } = req.body as { runName?: string; caseIds?: number[] };

    const result = await runTestSuite({
      companyId,
      runName: runName ?? `Test Run ${new Date().toLocaleString("id-ID")}`,
      createdBy: (req as { user?: { name?: string } }).user?.name ?? "admin",
      caseIds,
    });

    if (result.qualityGatePassed) {
      try {
        await db
          .update(companySettingsTable)
          .set({ aiProductionMode: "test" })
          .where(eq(companySettingsTable.companyId, companyId));
      } catch {
        // non-fatal — gate result is still returned
      }
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /conversation-tests/run failed");
    res.status(500).json({ error: "Gagal menjalankan test suite" });
  }
});

router.get("/conversation-tests/runs", async (req, res) => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const runs = await db
      .select()
      .from(conversationTestRunsTable)
      .where(eq(conversationTestRunsTable.companyId, companyId))
      .orderBy(desc(conversationTestRunsTable.startedAt))
      .limit(50);
    res.json(runs);
  } catch (err) {
    logger.error({ err }, "GET /conversation-tests/runs failed");
    res.status(500).json({ error: "Gagal memuat test runs" });
  }
});

router.get("/conversation-tests/runs/:id", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const id = parseInt(req.params.id!, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [run] = await db
      .select()
      .from(conversationTestRunsTable)
      .where(and(eq(conversationTestRunsTable.id, id), eq(conversationTestRunsTable.companyId, companyId)));

    if (!run) { res.status(404).json({ error: "Test run tidak ditemukan" }); return; }
    res.json(run);
  } catch (err) {
    logger.error({ err }, "GET /conversation-tests/runs/:id failed");
    res.status(500).json({ error: "Gagal memuat test run" });
    return;
  }
});

router.get("/conversation-tests/results/:runId", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const runId = parseInt(req.params.runId!, 10);
    if (isNaN(runId)) { res.status(400).json({ error: "runId tidak valid" }); return; }

    const results = await db
      .select({
        result: conversationTestResultsTable,
        testCase: conversationTestCasesTable,
      })
      .from(conversationTestResultsTable)
      .leftJoin(
        conversationTestCasesTable,
        eq(conversationTestResultsTable.testCaseId, conversationTestCasesTable.id),
      )
      .where(
        and(
          eq(conversationTestResultsTable.runId, runId),
          eq(conversationTestResultsTable.companyId, companyId),
        ),
      )
      .orderBy(conversationTestResultsTable.id);

    res.json(results);
  } catch (err) {
    logger.error({ err }, "GET /conversation-tests/results/:runId failed");
    res.status(500).json({ error: "Gagal memuat test results" });
    return;
  }
});

router.get("/conversation-tests/latest-gate", async (req, res) => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);

    const [latestRun] = await db
      .select()
      .from(conversationTestRunsTable)
      .where(eq(conversationTestRunsTable.companyId, companyId))
      .orderBy(desc(conversationTestRunsTable.startedAt))
      .limit(1);

    const [settings] = await db
      .select({ aiProductionMode: companySettingsTable.aiProductionMode })
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, companyId))
      .limit(1);

    res.json({
      latestRun: latestRun ?? null,
      aiProductionMode: settings?.aiProductionMode ?? "off",
    });
  } catch (err) {
    logger.error({ err }, "GET /conversation-tests/latest-gate failed");
    res.status(500).json({ error: "Gagal memuat quality gate status" });
  }
});

router.patch("/conversation-tests/production-mode", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req as Parameters<typeof getCompanyId>[0]);
    const { mode } = req.body as { mode?: string };

    const allowed = ["off", "test", "production"];
    if (!mode || !allowed.includes(mode)) {
      res.status(400).json({ error: "Mode harus: off, test, atau production" }); return;
    }

    if (mode === "production") {
      const [latestPassed] = await db
        .select()
        .from(conversationTestRunsTable)
        .where(
          and(
            eq(conversationTestRunsTable.companyId, companyId),
            eq(conversationTestRunsTable.qualityGatePassed, true),
          ),
        )
        .orderBy(desc(conversationTestRunsTable.startedAt))
        .limit(1);

      if (!latestPassed) {
        res.status(400).json({
          error: "Mode production tidak bisa diaktifkan. Quality gate belum pernah lulus. Jalankan test suite terlebih dahulu.",
        }); return;
      }
    }

    await db
      .update(companySettingsTable)
      .set({ aiProductionMode: mode })
      .where(eq(companySettingsTable.companyId, companyId));

    res.json({ success: true, aiProductionMode: mode });
  } catch (err) {
    logger.error({ err }, "PATCH /conversation-tests/production-mode failed");
    res.status(500).json({ error: "Gagal memperbarui production mode" });
  }
});

export default router;
