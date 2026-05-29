import { Router, type IRouter } from "express";
import { db, documentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /documents ────────────────────────────────────────────────────────────

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db
      .select()
      .from(documentsTable)
      .orderBy(desc(documentsTable.createdAt))
      .limit(300);

    res.json(
      rows.map((r) => ({
        id:           r.id,
        filename:     r.filename,
        fileUrl:      r.fileUrl ?? null,
        status:       r.status,
        auditScore:   r.auditScore ?? null,
        auditSummary: r.auditSummary ?? null,
        auditIssues:  r.auditIssues ?? [],
        taskId:       r.taskId ?? null,
        createdAt:    r.createdAt.toISOString(),
        updatedAt:    r.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /documents failed");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

// ─── GET /documents/:id ────────────────────────────────────────────────────────

router.get("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({
      id:           row.id,
      filename:     row.filename,
      fileUrl:      row.fileUrl ?? null,
      status:       row.status,
      auditScore:   row.auditScore ?? null,
      auditSummary: row.auditSummary ?? null,
      auditIssues:  row.auditIssues ?? [],
      taskId:       row.taskId ?? null,
      createdAt:    row.createdAt.toISOString(),
      updatedAt:    row.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /documents/:id failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

// ─── POST /documents/upload-url ────────────────────────────────────────────────

router.post("/documents/upload-url", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Document upload not available" });
});

// ─── POST /documents ───────────────────────────────────────────────────────────

router.post("/documents", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Document upload not available" });
});

// ─── DELETE /documents/:id ─────────────────────────────────────────────────────

router.delete("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await db.delete(documentsTable).where(eq(documentsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /documents/:id failed");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ─── POST /documents/:id/audit ─────────────────────────────────────────────────

router.post("/documents/:id/audit", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "AI audit not available" });
});

export default router;
