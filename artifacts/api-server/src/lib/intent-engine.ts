/**
 * IntentEngine — Knowledge Base–Driven Intent Resolution
 *
 * Replaces hardcoded intent detection rules with DB-driven lookup:
 *   intent_master  → available intent codes, SLA, routing
 *   keyword_rules  → weighted keyword pre-scoring
 *   data_templates → required data fields per intent/category
 *   document_templates → required documents per intent/category
 *   service_catalog → matching services for the detected intent
 *
 * All DB lookups are served from an in-memory TTL cache (5 min).
 * Every decision is recorded in audit_logs.
 * Fallback is always general_inquiry — never throws.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  intentMasterTable,
  keywordRulesTable,
  dataTemplatesTable,
  dataTemplateFieldsTable,
  documentTemplatesTable,
  documentTemplateFieldsTable,
  serviceCatalogTable,
  auditLogsTable,
  type IntentMaster,
  type KeywordRule,
  type DataTemplate,
  type DataTemplateField,
  type DocumentTemplate,
  type DocumentTemplateField,
  type ServiceCatalog,
} from "@workspace/db";
import { openai } from "./openai";
import { logger } from "./logger";

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface IntentResolution {
  intentCode: string;
  intentName: string;
  matchedIntentId: number | null;
  fallbackUsed: boolean;

  category: string;
  division: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  slaHours: number | null;

  routingCode: string | null;
  needsApproval: boolean;
  approvalType: string | null;

  customerName: string | null;
  customerPhone: string | null;
  commodity: string | null;
  origin: string | null;
  destination: string | null;
  shipmentType: string | null;
  requestedDate: string | null;

  requiredDataFields: Array<{
    fieldName: string;
    fieldLabel: string;
    fieldType: string;
    isRequired: boolean;
    sortOrder: number;
  }>;
  missingDataKeys: string[];
  matchedDataTemplateId: number | null;

  requiredDocuments: Array<{
    documentName: string;
    documentType: string | null;
    isRequired: boolean;
    sortOrder: number;
  }>;
  missingDocuments: string[];
  matchedDocTemplateId: number | null;

  matchedServices: Array<{
    id: number;
    serviceName: string;
    serviceCode: string | null;
    basePrice: string | null;
    currency: string | null;
    slaHours: string | null;
  }>;

  needsQuotation: boolean;
  needsDocumentAudit: boolean;
  needsAdminReview: boolean;

  confidenceScore: "high" | "medium" | "low";
  keywordScore: number;
  customerSentiment: "positive" | "neutral" | "negative" | "urgent";

  suggestedReply: string;
  suggestedTeam: string;
}

// ─── Cache internals ──────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }

const CACHE_TTL_MS = 5 * 60 * 1_000;

const intentCache  = new Map<string, CacheEntry<IntentMaster[]>>();
const keywordCache = new Map<string, CacheEntry<KeywordRule[]>>();
const dtCache      = new Map<string, CacheEntry<(DataTemplate & { fields: DataTemplateField[] }) | null>>();
const docCache     = new Map<string, CacheEntry<(DocumentTemplate & { fields: DocumentTemplateField[] }) | null>>();
const svcCache     = new Map<string, CacheEntry<ServiceCatalog[]>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() < entry.expiresAt;
}

// ─── Cache loaders ────────────────────────────────────────────────────────────

async function loadIntents(companyId: string): Promise<IntentMaster[]> {
  const cached = intentCache.get(companyId);
  if (isFresh(cached)) return cached.data;

  const rows = await db
    .select()
    .from(intentMasterTable)
    .where(
      and(eq(intentMasterTable.companyId, "default"), eq(intentMasterTable.isActive, true)),
    )
    .orderBy(intentMasterTable.intentCode);

  intentCache.set(companyId, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

async function loadKeywords(companyId: string): Promise<KeywordRule[]> {
  const cached = keywordCache.get(companyId);
  if (isFresh(cached)) return cached.data;

  const rows = await db
    .select()
    .from(keywordRulesTable)
    .where(
      and(eq(keywordRulesTable.companyId, "default"), eq(keywordRulesTable.isActive, true)),
    );

  keywordCache.set(companyId, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

async function loadDataTemplate(
  companyId: string,
  intentCode: string,
  category: string,
): Promise<(DataTemplate & { fields: DataTemplateField[] }) | null> {
  const key = `${companyId}:dt:${intentCode}:${category}`;
  const cached = dtCache.get(key);
  if (isFresh(cached)) return cached.data;

  // 1. Try exact intentCode match first
  let [tpl] = await db
    .select()
    .from(dataTemplatesTable)
    .where(
      and(
        eq(dataTemplatesTable.companyId, "default"),
        eq(dataTemplatesTable.intentCode, intentCode),
        eq(dataTemplatesTable.isActive, true),
      ),
    )
    .limit(1);

  // 2. Fall back to category match
  if (!tpl && category) {
    [tpl] = await db
      .select()
      .from(dataTemplatesTable)
      .where(
        and(
          eq(dataTemplatesTable.companyId, "default"),
          eq(dataTemplatesTable.category, category),
          eq(dataTemplatesTable.isActive, true),
        ),
      )
      .limit(1);
  }

  if (!tpl) {
    dtCache.set(key, { data: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const fields = await db
    .select()
    .from(dataTemplateFieldsTable)
    .where(eq(dataTemplateFieldsTable.templateId, tpl.id))
    .orderBy(dataTemplateFieldsTable.sortOrder);

  const result = { ...tpl, fields };
  dtCache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

async function loadDocTemplate(
  companyId: string,
  intentCode: string,
  category: string,
): Promise<(DocumentTemplate & { fields: DocumentTemplateField[] }) | null> {
  const key = `${companyId}:doc:${intentCode}:${category}`;
  const cached = docCache.get(key);
  if (isFresh(cached)) return cached.data;

  let [tpl] = await db
    .select()
    .from(documentTemplatesTable)
    .where(
      and(
        eq(documentTemplatesTable.companyId, "default"),
        eq(documentTemplatesTable.intentCode, intentCode),
        eq(documentTemplatesTable.isActive, true),
      ),
    )
    .limit(1);

  if (!tpl && category) {
    [tpl] = await db
      .select()
      .from(documentTemplatesTable)
      .where(
        and(
          eq(documentTemplatesTable.companyId, "default"),
          eq(documentTemplatesTable.category, category),
          eq(documentTemplatesTable.isActive, true),
        ),
      )
      .limit(1);
  }

  if (!tpl) {
    docCache.set(key, { data: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const fields = await db
    .select()
    .from(documentTemplateFieldsTable)
    .where(eq(documentTemplateFieldsTable.templateId, tpl.id))
    .orderBy(documentTemplateFieldsTable.sortOrder);

  const result = { ...tpl, fields };
  docCache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

async function loadServiceCatalog(companyId: string, category: string): Promise<ServiceCatalog[]> {
  const key = `${companyId}:svc:${category}`;
  const cached = svcCache.get(key);
  if (isFresh(cached)) return cached.data;

  const rows = await db
    .select()
    .from(serviceCatalogTable)
    .where(
      and(
        eq(serviceCatalogTable.companyId, "default"),
        eq(serviceCatalogTable.category, category),
        eq(serviceCatalogTable.isActive, true),
      ),
    );

  svcCache.set(key, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

// ─── Keyword scoring ──────────────────────────────────────────────────────────

function scoreKeywords(
  message: string,
  rules: KeywordRule[],
): Map<string, number> {
  const msgLower = message.toLowerCase();
  const raw = new Map<string, number>();

  for (const rule of rules) {
    if (msgLower.includes(rule.keyword.toLowerCase())) {
      raw.set(rule.intentCode, (raw.get(rule.intentCode) ?? 0) + rule.weight);
    }
  }

  // Normalise to 0–1
  const maxScore = Math.max(...raw.values(), 1);
  const normalised = new Map<string, number>();
  for (const [code, score] of raw) {
    normalised.set(code, parseFloat((score / maxScore).toFixed(3)));
  }
  return normalised;
}

function topHints(
  scores: Map<string, number>,
  n = 3,
): Array<{ intentCode: string; score: number }> {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([intentCode, score]) => ({ intentCode, score }));
}

// ─── Dynamic prompt builder ───────────────────────────────────────────────────

function buildPrompt(
  intents: IntentMaster[],
  hints: Array<{ intentCode: string; score: number }>,
): string {
  const intentList = intents
    .map(
      (i) =>
        `- ${i.intentCode}: ${i.intentName}` +
        ` (category: ${i.category ?? "-"}, suggestedPriority: ${i.suggestedPriority ?? "medium"})`,
    )
    .join("\n");

  const hintBlock =
    hints.length > 0
      ? `\n## Keyword Pre-Analysis (soft bias only — use when message is ambiguous)\n` +
        hints.map((h) => `- ${h.intentCode}: score=${h.score}`).join("\n") +
        "\n"
      : "";

  return `You are an AI assistant for a logistics and freight forwarding company in Indonesia.
Analyse the incoming WhatsApp message and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

## Available Intents — pick exactly one intentCode from this list
${intentList}

${hintBlock}
## Priority Rules (apply strictly)
- "urgent" → segera, urgent, hari ini, darurat, deadline, cepat
- "high"   → complaint, keluhan, terlambat, delay, overdue, besok, tomorrow
- "medium" → standard service request (pengiriman, quotation, booking, pickup, delivery, import, export)
- "low"    → general question, greetings, information only

## Business Rules
1. NEVER include or suggest a price/tariff. If pricing asked → set needsQuotation=true, needsAdminReview=true.
2. ALWAYS set needsAdminReview=true for: quotation needed, customs decision, category Customs/Finance, or low confidence.
3. needsDocumentAudit=true when customer mentions or sends a document (invoice, BL, packing list, COA, manifest, etc.).
4. suggestedReply must be Bahasa Indonesia, friendly and professional.
5. Return null for any field you cannot determine.
6. missingDataKeys: machine-readable field keys the customer has NOT provided yet.
7. missingDocuments: document names the customer has NOT provided yet.

## Confidence Score Rules
- "high"   → message is clear and intent unambiguous
- "medium" → fairly clear but some ambiguity
- "low"    → very short, greeting only, or cannot classify confidently

## Customer Sentiment
- "urgent"   → segera, urgent, hari ini, cepat, darurat, deadline
- "negative" → complaint, kecewa, marah, tidak puas, masalah, lambat
- "positive" → terima kasih, bagus, puas, senang, mantap
- "neutral"  → standard inquiry

## JSON Schema (return exactly these keys, no extras)
{
  "intentCode": string,
  "category": string,
  "division": string | null,
  "priority": "urgent" | "high" | "medium" | "low",
  "customerName": string | null,
  "customerPhone": string | null,
  "commodity": string | null,
  "origin": string | null,
  "destination": string | null,
  "shipmentType": string | null,
  "requestedDate": string | null,
  "missingDataKeys": string[],
  "missingDocuments": string[],
  "needsQuotation": boolean,
  "needsDocumentAudit": boolean,
  "needsAdminReview": boolean,
  "suggestedReply": string,
  "suggestedTeam": string,
  "confidenceScore": "high" | "medium" | "low",
  "customerSentiment": "positive" | "neutral" | "negative" | "urgent"
}`;
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function buildFallback(
  name?: string | null,
  phone?: string | null,
): IntentResolution {
  return {
    intentCode: "general_inquiry",
    intentName: "Pertanyaan Umum",
    matchedIntentId: null,
    fallbackUsed: true,
    category: "Umum",
    division: null,
    priority: "low",
    slaHours: 24,
    routingCode: null,
    needsApproval: false,
    approvalType: null,
    customerName: name ?? null,
    customerPhone: phone ?? null,
    commodity: null,
    origin: null,
    destination: null,
    shipmentType: null,
    requestedDate: null,
    requiredDataFields: [],
    missingDataKeys: [],
    matchedDataTemplateId: null,
    requiredDocuments: [],
    missingDocuments: [],
    matchedDocTemplateId: null,
    matchedServices: [],
    needsQuotation: false,
    needsDocumentAudit: false,
    needsAdminReview: true,
    confidenceScore: "low",
    keywordScore: 0,
    customerSentiment: "neutral",
    suggestedReply:
      "Terima kasih telah menghubungi kami. Tim kami akan segera membantu Anda. Mohon tunggu sebentar.",
    suggestedTeam: "Customer Service",
  };
}

// ─── Audit logger ─────────────────────────────────────────────────────────────

async function logDecision(
  companyId: string,
  messageId: number,
  msgLen: number,
  res: IntentResolution,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      companyId,
      action: "intent_detected",
      module: "intent_engine",
      entityId: messageId > 0 ? messageId : null,
      entityType: "whatsapp_message",
      before: JSON.stringify({ messageLength: msgLen }),
      after: JSON.stringify({
        intentCode:       res.intentCode,
        category:         res.category,
        priority:         res.priority,
        confidenceScore:  res.confidenceScore,
        keywordScore:     res.keywordScore,
        fallbackUsed:     res.fallbackUsed,
        matchedIntentId:  res.matchedIntentId,
        slaHours:         res.slaHours,
        missingDataCount: res.missingDataKeys.length,
        missingDocCount:  res.missingDocuments.length,
      }),
    });
  } catch (err) {
    logger.error({ err }, "IntentEngine: audit log write failed");
  }
}

// ─── Main: resolveIntent ──────────────────────────────────────────────────────

export async function resolveIntent({
  messageText,
  companyId = "default",
  messageId = 0,
  customerName,
  customerPhone,
}: {
  messageText: string;
  companyId?: string;
  messageId?: number;
  customerName?: string | null;
  customerPhone?: string | null;
}): Promise<IntentResolution> {
  const fallback = buildFallback(customerName, customerPhone);

  try {
    // ── 1. Load cache ──────────────────────────────────────────────────────────
    const [intents, keywords] = await Promise.all([
      loadIntents(companyId),
      loadKeywords(companyId),
    ]);

    if (intents.length === 0) {
      logger.warn({ companyId }, "IntentEngine: no active intents — fallback");
      await logDecision(companyId, messageId, messageText.length, fallback);
      return fallback;
    }

    // ── 2. Keyword pre-scoring ─────────────────────────────────────────────────
    const scores = scoreKeywords(messageText, keywords);
    const hints  = topHints(scores, 3);
    const topKwScore = hints[0]?.score ?? 0;

    // ── 3. AI classification ───────────────────────────────────────────────────
    const systemPrompt = buildPrompt(intents, hints);
    const userContent = [
      `Message: ${messageText}`,
      customerName  ? `Customer name: ${customerName}`   : null,
      customerPhone ? `Customer phone: ${customerPhone}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    let raw: string | null = null;
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userContent },
        ],
        max_tokens: 800,
        temperature: 0.15,
        response_format: { type: "json_object" },
      });
      raw = resp.choices[0]?.message?.content?.trim() ?? null;
    } catch (aiErr) {
      logger.error({ aiErr }, "IntentEngine: OpenAI call failed — fallback");
      await logDecision(companyId, messageId, messageText.length, fallback);
      return fallback;
    }

    if (!raw) {
      await logDecision(companyId, messageId, messageText.length, fallback);
      return fallback;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logger.error({ raw }, "IntentEngine: JSON parse failed — fallback");
      await logDecision(companyId, messageId, messageText.length, fallback);
      return fallback;
    }

    // ── 4. Match AI intentCode → intent_master ─────────────────────────────────
    const aiCode       = (parsed.intentCode as string | undefined) ?? "";
    const matchedIntent: IntentMaster | null = intents.find((i) => i.intentCode === aiCode) ?? null;
    const usesFallback = !matchedIntent;

    const intentCode = matchedIntent?.intentCode ?? "general_inquiry";
    const intentName = matchedIntent?.intentName ?? "Pertanyaan Umum";

    // ── 5. Confidence scoring ──────────────────────────────────────────────────
    const aiConf = (parsed.confidenceScore as string | undefined) ?? "medium";
    let confidenceScore: "high" | "medium" | "low" =
      aiConf === "high" ? "high" : aiConf === "low" ? "low" : "medium";
    if (!matchedIntent)               confidenceScore = "low";
    if (topKwScore > 0.6 && matchedIntent) confidenceScore = "high";

    // ── 6. Category, division, priority ───────────────────────────────────────
    const category = (parsed.category as string | undefined) ??
      matchedIntent?.suggestedCategory ?? matchedIntent?.category ?? "Umum";
    const division = (parsed.division as string | undefined) ??
      matchedIntent?.suggestedDivision ?? null;

    const rawPriority  = (parsed.priority as string | undefined) ??
      matchedIntent?.suggestedPriority ?? "low";
    let priority: "low" | "medium" | "high" | "urgent" = (
      ["low", "medium", "high", "urgent"].includes(rawPriority) ? rawPriority : "medium"
    ) as "low" | "medium" | "high" | "urgent";

    // Hard override from message keywords
    if (/segera|urgent|hari ini|darurat|deadline|cepat/i.test(messageText)) priority = "urgent";
    else if (/complaint|keluhan|terlambat|delay|overdue|besok|tomorrow/i.test(messageText) &&
             priority !== "urgent") priority = "high";

    // ── 7. Load templates + service catalog in parallel ────────────────────────
    const [dataTemplate, docTemplate, matchedSvcs] = await Promise.all([
      loadDataTemplate(companyId, intentCode, category),
      loadDocTemplate(companyId, intentCode, category),
      loadServiceCatalog(companyId, category),
    ]);

    // ── 8. Required data fields + missing keys ─────────────────────────────────
    const requiredDataFields = (dataTemplate?.fields ?? []).map((f) => ({
      fieldName: f.fieldName,
      fieldLabel: f.fieldLabel,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      sortOrder: f.sortOrder,
    }));

    const aiMissingKeys  = Array.isArray(parsed.missingDataKeys)
      ? (parsed.missingDataKeys as string[]) : [];
    const reqFieldNames  = requiredDataFields.filter((f) => f.isRequired).map((f) => f.fieldName);

    // If AI told us what's missing, intersect with template required fields.
    // If AI was silent, assume all required fields are missing.
    const missingDataKeys = aiMissingKeys.length > 0
      ? aiMissingKeys.filter((k) => reqFieldNames.includes(k))
      : reqFieldNames;

    // ── 9. Required documents + missing docs ───────────────────────────────────
    const requiredDocuments = (docTemplate?.fields ?? []).map((f) => ({
      documentName: f.documentName,
      documentType: f.documentType,
      isRequired: f.isRequired,
      sortOrder: f.sortOrder,
    }));

    const aiMissingDocs  = Array.isArray(parsed.missingDocuments)
      ? (parsed.missingDocuments as string[]) : [];
    const missingDocuments = aiMissingDocs.length > 0
      ? aiMissingDocs
      : requiredDocuments.filter((d) => d.isRequired).map((d) => d.documentName);

    // ── 10. Business flags ─────────────────────────────────────────────────────
    // NEEDS_QUOTATION_INTENTS, NEEDS_ADMIN_REVIEW_INTENTS, APPROVAL_INTENTS
    // were removed — now governed by approval_rules DB table via resolveApproval().
    const needsQuotation    = Boolean(parsed.needsQuotation);
    const needsDocumentAudit = Boolean(parsed.needsDocumentAudit) || missingDocuments.length > 0;
    const needsAdminReview  = Boolean(parsed.needsAdminReview) || confidenceScore === "low";

    // ── 11. Routing / approval (governance-driven) ─────────────────────────────
    const routingCode   = matchedIntent?.intentCode ?? null;

    // Resolve approval via governance engine (specificity cascade)
    const { resolveApproval } = await import("./governance-resolver");
    const approvalResolution = await resolveApproval(
      companyId,
      intentCode ?? null,
      (parsed.category as string | null | undefined) ?? category ?? null,
      matchedIntent?.suggestedPriority ?? null,
    ).catch(() => ({ needsApproval: false, approvalType: null, approverRole: null, requiresNote: false, timeoutHours: 24, ruleId: null, specificity: -1 }));

    const needsApproval = needsAdminReview || approvalResolution.needsApproval;
    const approvalType  = approvalResolution.approvalType ?? (needsApproval ? "admin_approval" : null);

    // ── 12. Service catalog ────────────────────────────────────────────────────
    const matchedServices = matchedSvcs.map((s) => ({
      id: s.id,
      serviceName: s.serviceName,
      serviceCode: s.serviceCode,
      basePrice: s.basePrice,
      currency: s.currency,
      slaHours: s.slaHours,
    }));

    // ── 13. Assemble resolution ────────────────────────────────────────────────
    const resolution: IntentResolution = {
      intentCode,
      intentName,
      matchedIntentId:   matchedIntent?.id ?? null,
      fallbackUsed:      usesFallback,
      category,
      division,
      priority,
      slaHours:          matchedIntent?.slaHours ?? null,
      routingCode,
      needsApproval,
      approvalType,
      customerName:    (parsed.customerName  as string | null | undefined) ?? customerName  ?? null,
      customerPhone:   (parsed.customerPhone as string | null | undefined) ?? customerPhone ?? null,
      commodity:       (parsed.commodity     as string | null | undefined) ?? null,
      origin:          (parsed.origin        as string | null | undefined) ?? null,
      destination:     (parsed.destination   as string | null | undefined) ?? null,
      shipmentType:    (parsed.shipmentType  as string | null | undefined) ?? null,
      requestedDate:   (parsed.requestedDate as string | null | undefined) ?? null,
      requiredDataFields,
      missingDataKeys,
      matchedDataTemplateId: dataTemplate?.id ?? null,
      requiredDocuments,
      missingDocuments,
      matchedDocTemplateId:  docTemplate?.id ?? null,
      matchedServices,
      needsQuotation,
      needsDocumentAudit,
      needsAdminReview,
      confidenceScore,
      keywordScore:    topKwScore,
      customerSentiment: (["positive", "neutral", "negative", "urgent"].includes(
        parsed.customerSentiment as string,
      )
        ? (parsed.customerSentiment as "positive" | "neutral" | "negative" | "urgent")
        : "neutral"),
      suggestedReply: (parsed.suggestedReply as string | undefined) ??
        "Terima kasih, tim kami akan segera menghubungi Anda.",
      suggestedTeam: (parsed.suggestedTeam as string | undefined) ?? "Customer Service",
    };

    logger.info(
      {
        intentCode:      resolution.intentCode,
        category:        resolution.category,
        priority:        resolution.priority,
        confidence:      resolution.confidenceScore,
        kwScore:         resolution.keywordScore,
        fallback:        resolution.fallbackUsed,
        slaHours:        resolution.slaHours,
        missingData:     resolution.missingDataKeys.length,
        missingDocs:     resolution.missingDocuments.length,
        matchedServices: resolution.matchedServices.length,
      },
      "IntentEngine: resolved",
    );

    await logDecision(companyId, messageId, messageText.length, resolution);
    return resolution;
  } catch (err) {
    logger.error({ err }, "IntentEngine.resolveIntent: unhandled error — fallback");
    await logDecision(companyId, messageId, messageText.length, fallback).catch(() => {});
    return fallback;
  }
}

// ─── Cache invalidation (public) ──────────────────────────────────────────────

export function invalidateIntentCache(companyId: string): void {
  intentCache.delete(companyId);
  keywordCache.delete(companyId);
  for (const key of dtCache.keys())  if (key.startsWith(companyId)) dtCache.delete(key);
  for (const key of docCache.keys()) if (key.startsWith(companyId)) docCache.delete(key);
  for (const key of svcCache.keys()) if (key.startsWith(companyId)) svcCache.delete(key);
  logger.info({ companyId }, "IntentEngine: cache invalidated");
}
