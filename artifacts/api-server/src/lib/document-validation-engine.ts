/**
 * DocumentValidationEngine — Sprint 9C
 *
 * Uses supabaseQuery (raw SQL) instead of Drizzle db because
 * document_intake_audits and document_validation_rules tables only exist
 * in Supabase, not in the local helium postgres that db connects to.
 */

import { supabaseQuery } from "./supabase-db";
import { openai } from "./openai";
import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidateDocumentInput {
  companyId?: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  objectPath?: string | null;
  taskId?: number | null;
  intakeSessionId?: number | null;
  customerId?: number | null;
  vendorId?: number | null;
  fleetUnitId?: number | null;
}

export interface ValidationResult {
  auditId: number;
  documentType: string;
  validationStatus: "valid" | "incomplete" | "invalid" | "needs_review";
  confidenceScore: number;
  extractedFields: Record<string, unknown>;
  requiredFields: string[];
  missingFields: string[];
  issueSummary: string | null;
  aiNotes: string | null;
  waReply: string;
}

// ─── Rule Cache (5-min TTL) ───────────────────────────────────────────────────

interface RuleCache {
  data: { requiredFields: string[]; optionalFields: string[]; validationPrompt: string | null } | null;
  expiresAt: number;
}
const ruleCache = new Map<string, RuleCache>();

async function loadRule(companyId: string, documentType: string) {
  const key = `${companyId}:${documentType}`;
  const cached = ruleCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const rows = await supabaseQuery<{
      required_fields: string[];
      optional_fields: string[];
      validation_prompt: string | null;
    }>(
      `SELECT required_fields, optional_fields, validation_prompt
       FROM document_validation_rules
       WHERE company_id = $1 AND document_type = $2 AND is_active = 'true'
       LIMIT 1`,
      [companyId, documentType],
    );

    const row = rows[0];
    const data = row
      ? {
          requiredFields: (row.required_fields as string[]) ?? [],
          optionalFields: (row.optional_fields as string[]) ?? [],
          validationPrompt: row.validation_prompt ?? null,
        }
      : null;

    ruleCache.set(key, { data, expiresAt: Date.now() + 5 * 60_000 });
    return data;
  } catch (err) {
    logger.error({ err, companyId, documentType }, "loadRule failed");
    ruleCache.set(key, { data: null, expiresAt: Date.now() + 60_000 });
    return null;
  }
}

// ─── Field extractor via OpenAI Vision ────────────────────────────────────────

async function extractFieldsFromDocument(
  fileUrl: string,
  documentType: string,
  customPrompt: string | null,
  requiredFields: string[],
): Promise<{ fields: Record<string, unknown>; confidence: number; typeMatch: boolean; rawNotes: string }> {
  const defaultPrompt = `You are a document validation assistant. Examine this document image and extract the following fields: ${requiredFields.join(", ")}.
Return a JSON object with exactly these keys (use null for any field you cannot find or read clearly).
Also include:
- "document_type_match": true if this document matches type "${documentType}", false if it's clearly a different type of document
- "confidence": a number 0.0-1.0 representing your overall confidence in the extraction
- "validation_notes": a brief string describing any issues, unclear areas, or why confidence is low (or null if all looks good)`;

  const systemPrompt = customPrompt ?? defaultPrompt;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt },
            { type: "image_url", image_url: { url: fileUrl, detail: "high" } },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const confidence = typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;
    const typeMatch = parsed.document_type_match !== false;
    const rawNotes = typeof parsed.validation_notes === "string" ? parsed.validation_notes : "";

    const { confidence: _c, document_type_match: _m, validation_notes: _n, ...fields } = parsed;

    return { fields, confidence, typeMatch, rawNotes };
  } catch (err) {
    logger.error({ err, documentType }, "DocumentValidationEngine: OpenAI Vision call failed");
    return { fields: {}, confidence: 0, typeMatch: false, rawNotes: "AI extraction failed" };
  }
}

// ─── Status determination ─────────────────────────────────────────────────────

function determineStatus(
  typeMatch: boolean,
  confidence: number,
  missingFields: string[],
): "valid" | "incomplete" | "invalid" | "needs_review" {
  if (!typeMatch) return "invalid";
  if (confidence < 0.65) return "needs_review";
  if (missingFields.length > 0) return "incomplete";
  return "valid";
}

// ─── WA Reply builder ─────────────────────────────────────────────────────────

function buildWaReply(
  status: "valid" | "incomplete" | "invalid" | "needs_review",
  documentType: string,
  missingFields: string[],
): string {
  const typeLabel = documentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  switch (status) {
    case "valid":
      return `✅ Dokumen *${typeLabel}* sudah kami terima dan valid. Terima kasih!`;

    case "incomplete": {
      const fieldList = missingFields.map((f) => `• ${f.replace(/_/g, " ")}`).join("\n");
      return `⚠️ Dokumen *${typeLabel}* sudah kami terima, namun masih kurang data berikut:\n${fieldList}\n\nMohon kirim ulang atau lengkapi data tersebut.`;
    }

    case "invalid":
      return `❌ Dokumen yang dikirim belum sesuai dengan jenis dokumen yang diminta (*${typeLabel}*). Mohon kirim dokumen yang benar.`;

    case "needs_review":
      return `🔍 Dokumen *${typeLabel}* sudah kami terima dan sedang kami teruskan ke admin untuk pengecekan manual.`;
  }
}

// ─── Main: validateDocument ───────────────────────────────────────────────────

export async function validateDocument(input: ValidateDocumentInput): Promise<ValidationResult> {
  const companyId = input.companyId ?? "default";

  // 1. Load validation rules
  const rule = await loadRule(companyId, input.documentType);
  const requiredFields = rule?.requiredFields ?? [];

  // 2. Extract fields via OpenAI Vision
  const { fields, confidence, typeMatch, rawNotes } = await extractFieldsFromDocument(
    input.fileUrl,
    input.documentType,
    rule?.validationPrompt ?? null,
    requiredFields,
  );

  // 3. Find missing required fields
  const missingFields = requiredFields.filter(
    (f) => fields[f] === null || fields[f] === undefined || fields[f] === "",
  );

  // 4. Determine status
  const validationStatus = determineStatus(typeMatch, confidence, missingFields);

  // 5. Build issue summary
  let issueSummary: string | null = null;
  if (validationStatus === "invalid") {
    issueSummary = `Dokumen tidak sesuai tipe yang diminta (${input.documentType.replace(/_/g, " ")}).`;
  } else if (validationStatus === "incomplete") {
    issueSummary = `Field tidak lengkap: ${missingFields.join(", ")}.`;
  } else if (validationStatus === "needs_review") {
    issueSummary = `Confidence rendah (${(confidence * 100).toFixed(0)}%). Perlu review manual.`;
  }

  // 6. Save audit record via raw SQL
  const auditRows = await supabaseQuery<{ id: number }>(
    `INSERT INTO document_intake_audits
       (company_id, task_id, intake_session_id, customer_id, vendor_id, fleet_unit_id,
        document_type, file_name, file_url, object_path,
        extracted_fields, required_fields, missing_fields,
        validation_status, confidence_score, issue_summary, ai_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      companyId,
      input.taskId ?? null,
      input.intakeSessionId ?? null,
      input.customerId ?? null,
      input.vendorId ?? null,
      input.fleetUnitId ?? null,
      input.documentType,
      input.fileName,
      input.fileUrl,
      input.objectPath ?? null,
      JSON.stringify(fields),
      JSON.stringify(requiredFields),
      missingFields,
      validationStatus,
      confidence.toFixed(4),
      issueSummary,
      rawNotes || null,
    ],
  );

  const auditId = auditRows[0]?.id ?? 0;

  logger.info(
    { auditId, documentType: input.documentType, validationStatus, confidence, missingCount: missingFields.length },
    "DocumentValidationEngine: validation complete",
  );

  return {
    auditId,
    documentType: input.documentType,
    validationStatus,
    confidenceScore: confidence,
    extractedFields: fields,
    requiredFields,
    missingFields,
    issueSummary,
    aiNotes: rawNotes || null,
    waReply: buildWaReply(validationStatus, input.documentType, missingFields),
  };
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

export function invalidateRuleCache(companyId: string, documentType?: string): void {
  if (documentType) {
    ruleCache.delete(`${companyId}:${documentType}`);
  } else {
    for (const key of ruleCache.keys()) {
      if (key.startsWith(`${companyId}:`)) ruleCache.delete(key);
    }
  }
}
