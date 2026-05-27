import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, documentsTable, activityTable } from "@workspace/db";
import {
  UploadDocumentBody,
  GetDocumentParams,
  DeleteDocumentParams,
  AuditDocumentParams,
  GetUploadUrlBody,
} from "@workspace/api-zod";
import { auditDocument } from "../lib/openai";
import { getUploadUrl } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/documents/upload-url", async (req, res): Promise<void> => {
  const parsed = GetUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await getUploadUrl(parsed.data.filename, parsed.data.mimeType);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to get upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/documents", async (_req, res): Promise<void> => {
  const docs = await db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt));
  res.json(
    docs.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      auditIssues: d.auditIssues ?? [],
    }))
  );
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = UploadDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [doc] = await db
    .insert(documentsTable)
    .values({ ...parsed.data, auditIssues: [] })
    .returning();

  res.status(201).json({
    ...doc,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    auditIssues: doc.auditIssues ?? [],
  });
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json({
    ...doc,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    auditIssues: doc.auditIssues ?? [],
  });
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db.delete(documentsTable).where(eq(documentsTable.id, params.data.id)).returning();
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/documents/:id/audit", async (req, res): Promise<void> => {
  const params = AuditDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  await db
    .update(documentsTable)
    .set({ status: "auditing" })
    .where(eq(documentsTable.id, doc.id));

  const auditResult = await auditDocument(doc.filename, doc.fileUrl);

  const [updated] = await db
    .update(documentsTable)
    .set({
      status: "audited",
      auditSummary: auditResult.summary,
      auditIssues: auditResult.issues,
      auditScore: auditResult.score,
    })
    .where(eq(documentsTable.id, doc.id))
    .returning();

  await db.insert(activityTable).values({
    type: "document_audited",
    description: `Document "${doc.filename}" audited — score: ${auditResult.score}/100`,
    entityId: doc.id,
  });

  res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    auditIssues: updated.auditIssues ?? [],
  });
});

export default router;
