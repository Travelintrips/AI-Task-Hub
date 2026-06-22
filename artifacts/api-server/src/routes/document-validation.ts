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
 *
 * NOTE: All DB queries use supabaseQuery (raw SQL via supabasePool) because
 * document_intake_audits and document_validation_rules tables only exist in
 * Supabase. The Drizzle `db` singleton connects to the local helium postgres.
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery, supabasePool } from "../lib/supabase-db";
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

    const conditions: string[] = ["company_id = $1"];
    const params: unknown[] = [companyId];
    let idx = 2;

    if (status) {
      const statuses = status.split(",").filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(`validation_status = $${idx++}`);
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        conditions.push(`validation_status = ANY($${idx++}::text[])`);
        params.push(statuses);
      }
    }
    if (documentType) {
      conditions.push(`document_type = $${idx++}`);
      params.push(documentType);
    }
    if (taskId) {
      conditions.push(`task_id = $${idx++}`);
      params.push(parseInt(taskId, 10));
    }
    if (sessionId) {
      conditions.push(`intake_session_id = $${idx++}`);
      params.push(parseInt(sessionId, 10));
    }

    params.push(limit);
    const rows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, company_id, task_id, intake_session_id, customer_id, vendor_id, fleet_unit_id,
              document_type, file_name, file_url, object_path,
              extracted_fields, required_fields, missing_fields,
              validation_status, confidence_score, issue_summary, ai_notes,
              reviewed_by, reviewed_at, created_at, updated_at
       FROM document_intake_audits
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      params,
    );

    const mapped = rows.map(r => ({
      id: r.id,
      companyId: r.company_id,
      taskId: r.task_id,
      intakeSessionId: r.intake_session_id,
      customerId: r.customer_id,
      vendorId: r.vendor_id,
      fleetUnitId: r.fleet_unit_id,
      documentType: r.document_type,
      fileName: r.file_name,
      fileUrl: r.file_url,
      objectPath: r.object_path,
      extractedFields: r.extracted_fields,
      requiredFields: r.required_fields,
      missingFields: r.missing_fields,
      validationStatus: r.validation_status,
      confidenceScore: r.confidence_score,
      issueSummary: r.issue_summary,
      aiNotes: r.ai_notes,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ data: mapped, total: mapped.length });
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

    const rows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, company_id, task_id, intake_session_id, customer_id, vendor_id, fleet_unit_id,
              document_type, file_name, file_url, object_path,
              extracted_fields, required_fields, missing_fields,
              validation_status, confidence_score, issue_summary, ai_notes,
              reviewed_by, reviewed_at, created_at, updated_at
       FROM document_intake_audits WHERE id = $1 LIMIT 1`,
      [id],
    );

    if (!rows[0]) { res.status(404).json({ error: "Audit not found" }); return; }
    const r = rows[0];
    res.json({
      data: {
        id: r.id, companyId: r.company_id, taskId: r.task_id,
        intakeSessionId: r.intake_session_id, customerId: r.customer_id,
        vendorId: r.vendor_id, fleetUnitId: r.fleet_unit_id,
        documentType: r.document_type, fileName: r.file_name, fileUrl: r.file_url,
        objectPath: r.object_path, extractedFields: r.extracted_fields,
        requiredFields: r.required_fields, missingFields: r.missing_fields,
        validationStatus: r.validation_status, confidenceScore: r.confidence_score,
        issueSummary: r.issue_summary, aiNotes: r.ai_notes,
        reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      },
    });
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
      validationStatus?: string;
      issueSummary?: string;
    };

    const reviewedBy = req.user?.email ?? req.user?.name ?? "admin";

    const setClauses: string[] = ["reviewed_by = $2", "reviewed_at = NOW()", "updated_at = NOW()"];
    const params: unknown[] = [id, reviewedBy];
    let idx = 3;

    if (validationStatus) {
      setClauses.push(`validation_status = $${idx++}`);
      params.push(validationStatus);
    }
    if (issueSummary !== undefined) {
      setClauses.push(`issue_summary = $${idx++}`);
      params.push(issueSummary);
    }

    const rows = await supabaseQuery<Record<string, unknown>>(
      `UPDATE document_intake_audits SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );

    if (!rows[0]) { res.status(404).json({ error: "Audit not found" }); return; }
    const r = rows[0];
    res.json({
      data: {
        id: r.id, companyId: r.company_id, taskId: r.task_id,
        documentType: r.document_type, fileName: r.file_name, fileUrl: r.file_url,
        validationStatus: r.validation_status, confidenceScore: r.confidence_score,
        issueSummary: r.issue_summary, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
        extractedFields: r.extracted_fields, missingFields: r.missing_fields,
        createdAt: r.created_at, updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, "PATCH /documents/audits/:id/review failed");
    res.status(500).json({ error: "Failed to update audit" });
  }
});

// ─── GET /documents/rules ─────────────────────────────────────────────────────

router.get("/documents/rules", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const rows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, company_id, document_type, intent_code, required_fields, optional_fields,
              validation_prompt, is_active, created_at, updated_at
       FROM document_validation_rules
       WHERE company_id = $1
       ORDER BY document_type`,
      [companyId],
    );

    const mapped = rows.map(r => ({
      id: r.id,
      companyId: r.company_id,
      documentType: r.document_type,
      intentCode: r.intent_code,
      requiredFields: r.required_fields,
      optionalFields: r.optional_fields,
      validationPrompt: r.validation_prompt,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ data: mapped });
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

    const rows = await supabaseQuery<Record<string, unknown>>(
      `INSERT INTO document_validation_rules
         (company_id, document_type, intent_code, required_fields, optional_fields, validation_prompt, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING *`,
      [
        companyId,
        documentType,
        intentCode ?? null,
        requiredFields,
        optionalFields ?? [],
        validationPrompt ?? null,
      ],
    );

    invalidateRuleCache(companyId, documentType);
    const r = rows[0];
    res.status(201).json({
      data: {
        id: r?.id, companyId: r?.company_id, documentType: r?.document_type,
        intentCode: r?.intent_code, requiredFields: r?.required_fields,
        optionalFields: r?.optional_fields, validationPrompt: r?.validation_prompt,
        isActive: r?.is_active, createdAt: r?.created_at, updatedAt: r?.updated_at,
      },
    });
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

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [id, companyId];
    let idx = 3;

    if (requiredFields !== undefined) { setClauses.push(`required_fields = $${idx++}`); params.push(requiredFields); }
    if (optionalFields !== undefined) { setClauses.push(`optional_fields = $${idx++}`); params.push(optionalFields); }
    if (validationPrompt !== undefined) { setClauses.push(`validation_prompt = $${idx++}`); params.push(validationPrompt); }
    if (isActive !== undefined) { setClauses.push(`is_active = $${idx++}`); params.push(isActive); }

    const rows = await supabaseQuery<Record<string, unknown>>(
      `UPDATE document_validation_rules SET ${setClauses.join(", ")}
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      params,
    );

    if (!rows[0]) { res.status(404).json({ error: "Rule not found" }); return; }
    const r = rows[0];
    invalidateRuleCache(companyId, r.document_type as string);
    res.json({
      data: {
        id: r.id, companyId: r.company_id, documentType: r.document_type,
        intentCode: r.intent_code, requiredFields: r.required_fields,
        optionalFields: r.optional_fields, validationPrompt: r.validation_prompt,
        isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, "PATCH /documents/rules/:id failed");
    res.status(500).json({ error: "Failed to update rule" });
  }
});

// ─── POST /intake-sessions/:id/documents ─────────────────────────────────────

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

    const sessions = await supabaseQuery<{ id: number; phone: string; uploaded_documents: unknown[] }>(
      `SELECT id, phone, uploaded_documents FROM conversation_intake_sessions WHERE id = $1 LIMIT 1`,
      [sessionId],
    );

    if (!sessions[0]) { res.status(404).json({ error: "Session not found" }); return; }
    const session = sessions[0];

    const result = await validateDocument({
      companyId,
      documentType,
      fileName,
      fileUrl,
      objectPath,
      intakeSessionId: sessionId,
    });

    const existingDocs = (session.uploaded_documents as unknown[]) ?? [];
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

    await supabaseQuery(
      `UPDATE conversation_intake_sessions SET uploaded_documents = $1::jsonb WHERE id = $2`,
      [JSON.stringify(updatedDocs), sessionId],
    );

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
