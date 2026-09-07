import { Router, type IRouter } from "express";
import { db, documentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { ensureBucket, getUploadUrl } from "../lib/supabase";
import { auditDocument } from "../lib/openai";

const router: IRouter = Router();

// ─── GET /documents ────────────────────────────────────────────────────────────

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  try {
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
        storagePath:  r.storagePath ?? null,
        mimeType:     r.mimeType ?? null,
        fileSize:     r.fileSize ?? null,
        status:       r.status,
        auditScore:   r.auditScore ?? null,
        auditSummary: r.auditSummary ?? null,
        auditIssues:  r.auditIssues ?? [],
        taskId:       r.taskId ?? null,
        uploadedBy:   r.uploadedBy ?? null,
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
      storagePath:  row.storagePath ?? null,
      mimeType:     row.mimeType ?? null,
      fileSize:     row.fileSize ?? null,
      status:       row.status,
      auditScore:   row.auditScore ?? null,
      auditSummary: row.auditSummary ?? null,
      auditIssues:  row.auditIssues ?? [],
      taskId:       row.taskId ?? null,
      uploadedBy:   row.uploadedBy ?? null,
      createdAt:    row.createdAt.toISOString(),
      updatedAt:    row.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /documents/:id failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

// ─── POST /documents/upload-url ─────────────────────────────────────────────────

router.post("/documents/upload-url", requireAuth, async (req, res): Promise<void> => {
  const { filename, contentType } = req.body ?? {};
  if (!filename || typeof filename !== "string" || !contentType || typeof contentType !== "string") {
    res.status(400).json({ error: "filename and contentType required" });
    return;
  }

  try {
    await ensureBucket();
    const { uploadUrl, publicUrl, path } = await getUploadUrl(filename, contentType);
    res.json({ uploadUrl, publicUrl, path });
  } catch (err) {
    logger.error({ err }, "POST /documents/upload-url failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ─── POST /documents ──────────────────────────────────────────────────────────
// Called after the client has uploaded the file directly to Supabase.

router.post("/documents", requireAuth, async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!body.filename || typeof body.filename !== "string") {
    res.status(400).json({ error: "filename required" });
    return;
  }

  try {
    const [row] = await db
      .insert(documentsTable)
      .values({
        filename:    body.filename as string,
        fileUrl:     typeof body.fileUrl === "string" ? body.fileUrl : undefined,
        storagePath: typeof body.storagePath === "string" ? body.storagePath : undefined,
        mimeType:    typeof body.mimeType === "string" ? body.mimeType : undefined,
        fileSize:    typeof body.fileSize === "number" ? body.fileSize : undefined,
        taskId:      typeof body.taskId === "number" ? body.taskId : undefined,
        uploadedBy:  typeof body.uploadedBy === "string" ? body.uploadedBy : undefined,
        status:      "pending",
      })
      .returning();

    res.status(201).json({
      id:          row.id,
      filename:    row.filename,
      fileUrl:     row.fileUrl ?? null,
      storagePath: row.storagePath ?? null,
      status:      row.status,
      createdAt:   row.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /documents failed");
    res.status(500).json({ error: "Failed to create document" });
  }
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

router.post("/documents/:id/audit", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, id))
      .limit(1);

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    await db
      .update(documentsTable)
      .set({ status: "auditing" })
      .where(eq(documentsTable.id, id));

    const result = await auditDocument(doc.filename, doc.fileUrl);

    const [updated] = await db
      .update(documentsTable)
      .set({
        status:       "audited",
        auditSummary: result.summary,
        auditIssues:  result.issues,
        auditScore:   result.score,
      })
      .where(eq(documentsTable.id, id))
      .returning();

    res.json({
      id:           updated.id,
      filename:     updated.filename,
      status:       updated.status,
      auditScore:   updated.auditScore,
      auditSummary: updated.auditSummary,
      auditIssues:  updated.auditIssues,
      updatedAt:    updated.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /documents/:id/audit failed");
    res.status(500).json({ error: "Failed to audit document" });
  }
});

export default router;
