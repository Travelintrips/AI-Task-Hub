/**
 * Document Validation API — Sprint 9C
 *
 * POST   /api/documents/validate               — validate uploaded document
 * GET    /api/documents/audits                 — list audit records
 * GET    /api/documents/audits/:id             — get single audit
 * PATCH  /api/documents/audits/:id/review      — admin review override
 * GET    /api/documents/rules                  — list validation rules
 * POST   /api/documents/rules                  — create rule
 * PATCH  /api/documents/rules/:id              — update rule
 * POST   /api/intake-sessions/:id/documents    — validate doc for intake session
 * POST   /api/tasks/:id/documents/validate     — validate doc for task
 */

import { Router, type IRouter } from "express";
import { db, documentIntakeAuditsTable, documentValidationRulesTable, intakeSessionsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { validateDocument, invalidateRuleCache } from "../lib/document-validation-engine";
import { sendFonnte } from "../lib/fonnte";

const router: IRouter = Router();

// ─── POST /documents/validate ─────────────────────────────────────────────────

router.post("/documents/validate", requireAuth, async (req, res): Promise<void> => {
  try {
    const {
      documentType,
      fileName,
      fileUrl,
      objectPath,
      taskId,
      intakeSessionId,
      customerId,
      vendorId,
      fleetUnitId,
    } = req.body as {
      documentType: string;
      fileName: string;
      fileUrl: string;
      objectPath?: string;
      taskId?: number;
      intakeSessionId?: number;
      customerId?: number;
      vendorId?: number;
      fleetUnitId?: number;
    };

    if (!documentType || !fileName || !fileUrl) {
      res.status(400).json({ error: "documentType, fileName, fileUrl are required" });
      return;
    }

    const companyId = req.user?.companyId ?? "default";
    const result = await validateDocument({
      companyId,
      documentType,
      fileName,
      fileUrl,
      objectPath,
      taskId: taskId ?? null,
      intakeSessionId: intakeSessionId ?? null,
      customerId: customerId ?? null,
      vendorId: vendorId ?? null,
      fleetUnitId: fleetUnitId ?? null,
    });

    res.json({ data: result });
  } catch (err) {
    logger.error({ err }, "POST /documents/validate failed");
    res.status(500).json({ error: "Document validation failed" });
  }
});

// ─── GET /documents/audits ────────────────────────────────────────────────────

router.get("/documents/audits", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const { status, documentType, taskId, sessionId, limit: limitStr } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(limitStr ?? "100", 10) || 100, 500);

    const conditions = [eq(documentIntakeAuditsTable.companyId, companyId)];

    if (status) {
      const statuses = status.split(",").filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(eq(documentIntakeAuditsTable.validationStatus, statuses[0] as string));
      } else if (statuses.length > 1) {
        conditions.push(inArray(documentIntakeAuditsTable.validationStatus, statuses as ("valid" | "incomplete" | "invalid" | "needs_review")[]));
      }
    }
    if (documentType) {
      conditions.push(eq(documentIntakeAuditsTable.documentType, documentType));
    }
    if (taskId) {
      conditions.push(eq(documentIntakeAuditsTable.taskId, parseInt(taskId, 10)));
    }
    if (sessionId) {
      conditions.push(eq(documentIntakeAuditsTable.intakeSessionId, parseInt(sessionId, 10)));
    }

    const rows = await db
      .select()
      .from(documentIntakeAuditsTable)
      .where(and(...conditions))
      .orderBy(desc(documentIntakeAuditsTable.createdAt))
      .limit(limit);

    res.json({ data: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /documents/audits failed");
    res.status(500).json({ error: "Failed to load document audits" });
  }
});

// ─── GET /documents/audits/:id ────────────────────────────────────────────────

router.get("/documents/audits/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db
      .select()
      .from(documentIntakeAuditsTable)
      .where(eq(documentIntakeAuditsTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Audit not found" }); return; }
    res.json({ data: row });
  } catch (err) {
    logger.error({ err }, "GET /documents/audits/:id failed");
    res.status(500).json({ error: "Failed to load audit" });
  }
});

// ─── PATCH /documents/audits/:id/review ──────────────────────────────────────

router.patch("/documents/audits/:id/review", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { validationStatus, issueSummary } = req.body as {
      validationStatus?: "valid" | "incomplete" | "invalid" | "needs_review";
      issueSummary?: string;
    };

    const reviewedBy = req.user?.email ?? req.user?.name ?? "admin";

    const [updated] = await db
      .update(documentIntakeAuditsTable)
      .set({
        reviewedBy,
        reviewedAt: new Date(),
        ...(validationStatus ? { validationStatus } : {}),
        ...(issueSummary !== undefined ? { issueSummary } : {}),
      })
      .where(eq(documentIntakeAuditsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Audit not found" }); return; }
    res.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /documents/audits/:id/review failed");
    res.status(500).json({ error: "Failed to update audit" });
  }
});

// ─── GET /documents/rules ─────────────────────────────────────────────────────

router.get("/documents/rules", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const rows = await db
      .select()
      .from(documentValidationRulesTable)
      .where(eq(documentValidationRulesTable.companyId, companyId))
      .orderBy(documentValidationRulesTable.documentType);

    res.json({ data: rows });
  } catch (err) {
    logger.error({ err }, "GET /documents/rules failed");
    res.status(500).json({ error: "Failed to load validation rules" });
  }
});

// ─── POST /documents/rules ────────────────────────────────────────────────────

router.post("/documents/rules", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const { documentType, intentCode, requiredFields, optionalFields, validationPrompt } = req.body as {
      documentType: string;
      intentCode?: string;
      requiredFields: string[];
      optionalFields?: string[];
      validationPrompt?: string;
    };

    if (!documentType || !requiredFields) {
      res.status(400).json({ error: "documentType and requiredFields are required" });
      return;
    }

    const [row] = await db
      .insert(documentValidationRulesTable)
      .values({
        companyId,
        documentType,
        intentCode: intentCode ?? null,
        requiredFields,
        optionalFields: optionalFields ?? [],
        validationPrompt: validationPrompt ?? null,
        isActive: "true",
      })
      .returning();

    invalidateRuleCache(companyId, documentType);
    res.status(201).json({ data: row });
  } catch (err) {
    logger.error({ err }, "POST /documents/rules failed");
    res.status(500).json({ error: "Failed to create rule" });
  }
});

// ─── PATCH /documents/rules/:id ───────────────────────────────────────────────

router.patch("/documents/rules/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = req.user?.companyId ?? "default";
    const { requiredFields, optionalFields, validationPrompt, isActive } = req.body as {
      requiredFields?: string[];
      optionalFields?: string[];
      validationPrompt?: string;
      isActive?: boolean;
    };

    const [updated] = await db
      .update(documentValidationRulesTable)
      .set({
        ...(requiredFields !== undefined ? { requiredFields } : {}),
        ...(optionalFields !== undefined ? { optionalFields } : {}),
        ...(validationPrompt !== undefined ? { validationPrompt } : {}),
        ...(isActive !== undefined ? { isActive: isActive ? "true" : "false" } : {}),
      })
      .where(and(
        eq(documentValidationRulesTable.id, id),
        eq(documentValidationRulesTable.companyId, companyId),
      ))
      .returning();

    if (!updated) { res.status(404).json({ error: "Rule not found" }); return; }

    invalidateRuleCache(companyId, updated.documentType);
    res.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /documents/rules/:id failed");
    res.status(500).json({ error: "Failed to update rule" });
  }
});

// ─── POST /intake-sessions/:id/documents ─────────────────────────────────────
// Validate a document attached to an intake session, send WA reply

router.post("/intake-sessions/:id/documents", requireAuth, async (req, res): Promise<void> => {
  try {
    const sessionId = parseInt(req.params.id as string, 10);
    if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }

    const companyId = req.user?.companyId ?? "default";
    const { documentType, fileName, fileUrl, objectPath, customerPhone } = req.body as {
      documentType: string;
      fileName: string;
      fileUrl: string;
      objectPath?: string;
      customerPhone?: string;
    };

    if (!documentType || !fileName || !fileUrl) {
      res.status(400).json({ error: "documentType, fileName, fileUrl are required" });
      return;
    }

    // Load session to get phone
    const [session] = await db
      .select({ phone: intakeSessionsTable.phone, uploadedDocuments: intakeSessionsTable.uploadedDocuments })
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.id, sessionId))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const result = await validateDocument({
      companyId,
      documentType,
      fileName,
      fileUrl,
      objectPath,
      intakeSessionId: sessionId,
    });

    // Append to session's uploaded_documents
    const existingDocs = (session.uploadedDocuments as unknown[]) ?? [];
    const updatedDocs = [
      ...existingDocs,
      {
        documentType,
        fileName,
        fileUrl,
        auditId: result.auditId,
        validationStatus: result.validationStatus,
        missingFields: result.missingFields,
        validatedAt: new Date().toISOString(),
      },
    ];

    await db
      .update(intakeSessionsTable)
      .set({ uploadedDocuments: updatedDocs as unknown as typeof intakeSessionsTable.$inferInsert["uploadedDocuments"] })
      .where(eq(intakeSessionsTable.id, sessionId));

    // Send WA reply
    const phone = customerPhone ?? session.phone;
    if (phone) {
      await sendFonnte(phone, result.waReply).catch((e) =>
        logger.warn({ e }, "Failed to send document validation WA reply"),
      );
    }

    res.json({ data: result });
  } catch (err) {
    logger.error({ err }, "POST /intake-sessions/:id/documents failed");
    res.status(500).json({ error: "Document validation for session failed" });
  }
});

// ─── POST /tasks/:id/documents/validate ───────────────────────────────────────

router.post("/tasks/:id/documents/validate", requireAuth, async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id as string, 10);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }

    const companyId = req.user?.companyId ?? "default";
    const { documentType, fileName, fileUrl, objectPath } = req.body as {
      documentType: string;
      fileName: string;
      fileUrl: string;
      objectPath?: string;
    };

    if (!documentType || !fileName || !fileUrl) {
      res.status(400).json({ error: "documentType, fileName, fileUrl are required" });
      return;
    }

    const result = await validateDocument({
      companyId,
      documentType,
      fileName,
      fileUrl,
      objectPath,
      taskId,
    });

    res.json({ data: result });
  } catch (err) {
    logger.error({ err }, "POST /tasks/:id/documents/validate failed");
    res.status(500).json({ error: "Document validation for task failed" });
  }
});

export default router;
