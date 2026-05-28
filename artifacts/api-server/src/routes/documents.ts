import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { auditDocument } from "../lib/openai";

const router: IRouter = Router();

function mapDoc(r: typeof documentsTable.$inferSelect) {
  return {
    id:           r.id,
    filename:     r.filename,
    fileUrl:      r.fileUrl,
    status:       r.status,
    auditScore:   r.auditScore,
    auditSummary: r.auditSummary,
    auditIssues:  r.auditIssues,
    taskId:       r.taskId,
    createdAt:    r.createdAt.toISOString(),
    updatedAt:    r.updatedAt.toISOString(),
  };
}

// ─── GET /documents ───────────────────────────────────────────────────────────

router.get("/documents", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(documentsTable)
      .orderBy(desc(documentsTable.createdAt))
      .limit(300);

    res.json(rows.map(mapDoc));
  } catch (err) {
    logger.error({ err }, "GET /documents failed");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

// ─── GET /documents/:id ───────────────────────────────────────────────────────

router.get("/documents/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Document not found" }); return; }

    res.json(mapDoc(row));
  } catch (err) {
    logger.error({ err }, "GET /documents/:id failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

// ─── POST /documents/upload-url ───────────────────────────────────────────────

router.post("/documents/upload-url", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { filename, mimeType } = req.body as { filename?: string; mimeType?: string };
    if (!filename) { res.status(400).json({ error: "filename is required" }); return; }

    const { getUploadUrl } = await import("../lib/supabase");
    const { uploadUrl, publicUrl, path } = await getUploadUrl(filename, mimeType ?? "application/octet-stream");

    const [doc] = await db.insert(documentsTable).values({
      filename,
      fileUrl: publicUrl,
      storagePath: path,
      mimeType: mimeType ?? null,
      status: "pending",
      uploadedBy: req.user?.name ?? "Admin",
    }).returning();

    res.json({ uploadUrl, publicUrl, documentId: doc.id });
  } catch (err) {
    logger.error({ err }, "POST /documents/upload-url failed");
    res.status(500).json({ error: "Failed to get upload URL" });
  }
});

// ─── POST /documents ──────────────────────────────────────────────────────────

router.post("/documents", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { filename, fileUrl, taskId, mimeType } = req.body as {
      filename?: string; fileUrl?: string; taskId?: number; mimeType?: string;
    };
    if (!filename) { res.status(400).json({ error: "filename is required" }); return; }

    const [doc] = await db.insert(documentsTable).values({
      filename,
      fileUrl: fileUrl ?? null,
      taskId: taskId ?? null,
      mimeType: mimeType ?? null,
      status: "pending",
      uploadedBy: req.user?.name ?? "Admin",
    }).returning();

    res.status(201).json(mapDoc(doc));
  } catch (err) {
    logger.error({ err }, "POST /documents failed");
    res.status(500).json({ error: "Failed to create document" });
  }
});

// ─── DELETE /documents/:id ────────────────────────────────────────────────────

router.delete("/documents/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [deleted] = await db
      .delete(documentsTable)
      .where(eq(documentsTable.id, id))
      .returning();

    if (!deleted) { res.status(404).json({ error: "Document not found" }); return; }

    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "DELETE /documents/:id failed");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ─── POST /documents/:id/audit ────────────────────────────────────────────────

router.post("/documents/:id/audit", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, id))
      .limit(1);

    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    const result = await auditDocument(doc.filename, doc.fileUrl);

    const [updated] = await db
      .update(documentsTable)
      .set({
        status: "audited",
        auditScore: result.score,
        auditSummary: result.summary,
        auditIssues: result.issues,
        updatedAt: new Date(),
      })
      .where(eq(documentsTable.id, id))
      .returning();

    res.json(mapDoc(updated));
  } catch (err) {
    logger.error({ err }, "POST /documents/:id/audit failed");
    res.status(500).json({ error: "Failed to audit document" });
  }
});

export default router;
