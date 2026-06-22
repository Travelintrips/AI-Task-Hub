/**
 * DocumentValidationEngine — Sprint 9C
 *
 * Responsibilities:
 * 1. Receive uploaded document (URL or base64)
 * 2. Load validation rules by document_type
 * 3. Extract fields using OpenAI Vision (gpt-4o-mini)
 * 4. Compare extracted vs required fields
 * 5. Determine validation_status: valid | incomplete | invalid | needs_review
 * 6. Save audit record to document_intake_audits
 * 7. Return structured result for WA reply / intake integration
 */

import { db, documentIntakeAuditsTable, documentValidationRulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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

  const [row] = await db
    .select({
      requiredFields: documentValidationRulesTable.requiredFields,
      optionalFields: documentValidationRulesTable.optionalFields,
      validationPrompt: documentValidationRulesTable.validationPrompt,
    })
    .from(documentValidationRulesTable)
    .where(
      and(
        eq(documentValidationRulesTable.companyId, companyId),
        eq(documentValidationRulesTable.documentType, documentType),
        eq(documentValidationRulesTable.isActive, "true"),
      ),
    )
    .limit(1);

  const data = row
    ? {
        requiredFields: (row.requiredFields as string[]) ?? [],
        optionalFields: (row.optionalFields as string[]) ?? [],
        validationPrompt: row.validationPrompt ?? null,
      }
    : null;

  ruleCache.set(key, { data, expiresAt: Date.now() + 5 * 60_000 });
  return data;
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
            {
              type: "text",
              text: systemPrompt,
            },
            {
              type: "image_url",
              image_url: { url: fileUrl, detail: "high" },
            },
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

    // Remove meta-fields from extracted data
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

  // 6. Save audit record
  const [audit] = await db
    .insert(documentIntakeAuditsTable)
    .values({
      companyId,
      taskId: input.taskId ?? null,
      intakeSessionId: input.intakeSessionId ?? null,
      customerId: input.customerId ?? null,
      vendorId: input.vendorId ?? null,
      fleetUnitId: input.fleetUnitId ?? null,
      documentType: input.documentType,
      fileName: input.fileName,
      fileUrl: input.fileUrl,
      objectPath: input.objectPath ?? null,
      extractedFields: fields as Record<string, unknown>,
      requiredFields: requiredFields as unknown as string[],
      missingFields,
      validationStatus,
      confidenceScore: confidence.toFixed(4),
      issueSummary,
      aiNotes: rawNotes || null,
    })
    .returning({ id: documentIntakeAuditsTable.id });

  const auditId = audit?.id ?? 0;

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
