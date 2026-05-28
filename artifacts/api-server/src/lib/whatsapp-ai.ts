import { openai } from "./openai";
import { config } from "../config";
import { logger } from "./logger";

const apiKey = config.openai.apiKey;

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentCategory =
  | "Import"
  | "Export"
  | "Trucking"
  | "Customs"
  | "Warehouse"
  | "Freight"
  | "Product Sales"
  | "Complaint"
  | "Finance"
  | "General Inquiry";

export type Priority = "High" | "Medium" | "Low";

export type ConfidenceScore = "high" | "medium" | "low";
export type CustomerSentiment = "positive" | "neutral" | "negative" | "urgent";

export interface WhatsAppIntentResult {
  intent: string;
  category: IntentCategory;
  division: string;
  priority: Priority;
  customer_name: string | null;
  customer_phone: string | null;
  shipment_type: string | null;
  commodity: string | null;
  origin: string | null;
  destination: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  requested_date: string | null;
  required_documents: string[];
  missing_data: string[];
  needs_quotation: boolean;
  needs_document_audit: boolean;
  needs_admin_review: boolean;
  suggested_reply: string;
  suggested_team: string;
  confidence_score: ConfidenceScore;
  customer_sentiment: CustomerSentiment;
}

export interface CustomerContext {
  name?: string | null;
  phone?: string | null;
  companyId?: string | null;
  previousIntents?: string[];
  [key: string]: unknown;
}

// ─── Import detection ─────────────────────────────────────────────────────────

/**
 * All 16 required data points for an import inquiry.
 * Keys are machine-readable; labels are used in the WhatsApp reply.
 */
export const IMPORT_REQUIRED_FIELDS = [
  { key: "commercial_invoice",    label: "Commercial Invoice" },
  { key: "packing_list",          label: "Packing List" },
  { key: "hs_code",               label: "HS Code" },
  { key: "product_photo_catalog", label: "Foto produk atau katalog" },
  { key: "supplier_name",         label: "Nama supplier" },
  { key: "country_city_origin",   label: "Negara dan kota asal barang" },
  { key: "port_of_loading",       label: "Port of Loading (pelabuhan muat)" },
  { key: "port_of_discharge",     label: "Port of Discharge (pelabuhan bongkar)" },
  { key: "delivery_city",         label: "Kota tujuan pengiriman di Indonesia" },
  { key: "gross_weight",          label: "Gross weight (kg)" },
  { key: "net_weight",            label: "Net weight (kg)" },
  { key: "dimensions",            label: "Dimensi barang (P × L × T cm)" },
  { key: "incoterm",              label: "Incoterm (EXW / FOB / CIF / CFR)" },
  { key: "importer_company_name", label: "Nama perusahaan importer" },
  { key: "nib_api",               label: "NIB / API importer" },
  { key: "machine_condition",     label: "Kondisi barang: Baru atau Bekas" },
] as const;

export type ImportFieldKey = typeof IMPORT_REQUIRED_FIELDS[number]["key"];

/** Regex to pre-detect import inquiries before sending to the AI model. */
const IMPORT_KEYWORDS =
  /\b(import|impor|barang dari (china|luar negeri|tiongkok|taiwan|korea|jepang|eropa|america|usa)|mesin dari (china|luar negeri|tiongkok)|beli (mesin|barang) dari luar|customs clearance|door to door import|jasa import|layanan import|freight import|biaya import|ongkos import)\b/i;

/** Returns true if the message clearly signals an import inquiry. */
export function isImportInquiry(messageText: string): boolean {
  return IMPORT_KEYWORDS.test(messageText);
}

// ─── Fallback result ──────────────────────────────────────────────────────────

function fallbackResult(messageText: string, context?: CustomerContext): WhatsAppIntentResult {
  return {
    intent: "general_inquiry",
    category: "General Inquiry",
    division: "Customer Service",
    priority: "Low",
    customer_name: context?.name ?? null,
    customer_phone: context?.phone ?? null,
    shipment_type: null,
    commodity: null,
    origin: null,
    destination: null,
    pickup_location: null,
    delivery_location: null,
    requested_date: null,
    required_documents: [],
    missing_data: ["Unable to parse message — manual review required"],
    needs_quotation: false,
    needs_document_audit: false,
    needs_admin_review: true,
    suggested_reply:
      "Terima kasih telah menghubungi kami. Tim kami akan segera membantu Anda. Mohon tunggu sebentar.",
    suggested_team: "Customer Service",
    confidence_score: "low",
    customer_sentiment: "neutral",
  };
}

// ─── Import-specific helpers ──────────────────────────────────────────────────

/**
 * Given a list of field keys that the AI extracted, compute the missing ones
 * and build a polite WhatsApp reply asking only for the missing data.
 */
function buildImportMissingDataReply(
  missingKeys: string[],
  customerName: string | null,
  commodity: string | null,
): string {
  const missingLabels = IMPORT_REQUIRED_FIELDS
    .filter((f) => missingKeys.includes(f.key))
    .map((f, i) => `${i + 1}. ${f.label}`);

  if (missingLabels.length === 0) {
    return (
      `Halo${customerName ? ` ${customerName}` : ""}! Terima kasih atas permintaan import Anda` +
      `${commodity ? ` untuk ${commodity}` : ""}. ` +
      "Semua informasi sudah kami terima. Tim Import kami akan segera memproses dan memberikan penawaran terbaik untuk Anda. " +
      "Mohon tunggu konfirmasi dari kami."
    );
  }

  const greeting = `Halo${customerName ? ` ${customerName}` : ""}! Terima kasih sudah menghubungi kami` +
    `${commodity ? ` mengenai import ${commodity}` : " untuk kebutuhan import Anda"}. 🙏`;

  const body =
    "Untuk dapat kami proses lebih lanjut dan memberikan penawaran yang akurat, " +
    "mohon lengkapi data berikut yang masih diperlukan:\n\n" +
    missingLabels.join("\n") +
    "\n\nData tersebut akan kami gunakan untuk menghitung biaya dan memproses dokumen import Anda secara tepat.";

  const closing =
    "Setelah data lengkap, tim Import kami akan segera menghubungi Anda dengan penawaran terbaik. " +
    "Terima kasih atas kepercayaan Anda! 😊";

  return `${greeting}\n\n${body}\n\n${closing}`;
}

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Analyse an incoming WhatsApp message and return structured logistics intent data.
 *
 * @param messageText      The raw text of the customer's message.
 * @param customerContext  Optional context about the sender (name, phone, history).
 * @returns A fully-typed WhatsAppIntentResult. Never throws — returns a safe fallback on error.
 */
export async function detectWhatsAppIntent(
  messageText: string,
  customerContext?: CustomerContext,
): Promise<WhatsAppIntentResult> {
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not set — returning fallback intent result");
    return fallbackResult(messageText, customerContext);
  }

  // ── Pre-detect import inquiry ───────────────────────────────────────────────
  const importDetected = isImportInquiry(messageText);

  const contextBlock = customerContext
    ? `\nCustomer context:\n${JSON.stringify(customerContext, null, 2)}`
    : "";

  // ── Import-specific data extraction prompt section ──────────────────────────
  const importSection = `
## ⚠️ IMPORT INQUIRY — MANDATORY RULES
If the message is about import (keywords: import, impor, barang dari luar negeri, mesin dari China, customs clearance, door to door import), you MUST:
- Set category = "Import"
- Set division = "Import / Customs"
- Set needs_document_audit = true
- Set needs_quotation = true
- Set needs_admin_review = true
- Set suggested_team = "Import Team"

For import inquiries, extract as many of these 16 data points as possible from the message and list any that are MISSING in the "missing_data" array using these exact keys:
commercial_invoice | packing_list | hs_code | product_photo_catalog | supplier_name | country_city_origin | port_of_loading | port_of_discharge | delivery_city | gross_weight | net_weight | dimensions | incoterm | importer_company_name | nib_api | machine_condition

The "required_documents" array must always include for import:
["Commercial Invoice", "Packing List", "HS Code", "Foto produk / katalog", "NIB / API Importer"]

IMPORTANT: The "suggested_reply" for import inquiries must be in Bahasa Indonesia, warm and professional, and ONLY ask for the missing data points by their human-readable labels. Never mention price. Never give a customs decision. If all data is present, confirm receipt and say the team will follow up.
`;

  const systemPrompt = `You are an AI assistant for a logistics and freight forwarding company.
Analyse the incoming WhatsApp message and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

## Categories (pick exactly one)
Import | Export | Trucking | Customs | Warehouse | Freight | Product Sales | Complaint | Finance | General Inquiry

## Priority rules (apply strictly)
- "High"   → message contains any of: urgent, segera, today, hari ini, besok, tomorrow, complaint, keluhan, terlambat, delay, overdue
- "Medium" → standard service request (shipment, quotation, booking, pickup, delivery, import, export)
- "Low"    → general question, greetings, information only
${importDetected ? importSection : ""}
## General strict rules
1. NEVER include or suggest a final price or tariff. If pricing is asked, set needs_quotation=true and needs_admin_review=true.
2. ALWAYS set needs_admin_review=true when: quotation is needed, customs decision is involved, or category is Customs or Finance.
3. needs_document_audit=true when the customer mentions or submits a document (invoice, BL, packing list, COA, SKU, manifest, etc.).
4. suggested_reply must be in Bahasa Indonesia, friendly, and professional. Never give a price. Never give a customs decision.
5. suggested_team must be one of: Import Team | Export Team | Trucking Team | Customs Team | Warehouse Team | Freight Team | Sales Team | Finance Team | Customer Service
6. Return null for any field you cannot determine from the message.
7. required_documents: documents the customer needs to provide for this transaction type.
8. missing_data: for import = use the exact field keys listed above. For other categories = human-readable description of missing info.

## Confidence score rules
- "high"   → message is clear, intent is unambiguous (e.g. clearly states import of specific goods)
- "medium" → message is fairly clear but has some ambiguity or missing context
- "low"    → message is very short, unclear, greeting only, or cannot be classified confidently

## Customer sentiment rules
- "urgent"   → contains: segera, urgent, today, hari ini, besok, cepat, darurat, deadline
- "negative" → complaint, kecewa, marah, tidak puas, masalah, salah, lambat, terlambat
- "positive" → terima kasih, bagus, puas, senang, mantap, oke, good
- "neutral"  → standard inquiry with no strong emotional tone

## JSON schema (return exactly these keys)
{
  "intent": string,
  "category": string,
  "division": string,
  "priority": "High" | "Medium" | "Low",
  "customer_name": string | null,
  "customer_phone": string | null,
  "shipment_type": string | null,
  "commodity": string | null,
  "origin": string | null,
  "destination": string | null,
  "pickup_location": string | null,
  "delivery_location": string | null,
  "requested_date": string | null,
  "required_documents": string[],
  "missing_data": string[],
  "needs_quotation": boolean,
  "needs_document_audit": boolean,
  "needs_admin_review": boolean,
  "suggested_reply": string,
  "suggested_team": string,
  "confidence_score": "high" | "medium" | "low",
  "customer_sentiment": "positive" | "neutral" | "negative" | "urgent"
}`;

  const userContent = `Message: ${messageText}${contextBlock}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 1000,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) {
      logger.warn({ messageText }, "Empty response from OpenAI — using fallback");
      return fallbackResult(messageText, customerContext);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logger.error({ raw }, "Failed to parse OpenAI JSON response — using fallback");
      return fallbackResult(messageText, customerContext);
    }

    // ── Post-processing: enforce business rules unconditionally ────────────────

    // Priority override: scan message for high-priority keywords
    const highPriorityKeywords =
      /urgent|segera|today|hari ini|besok|tomorrow|complaint|keluhan|terlambat|delay|overdue/i;
    if (highPriorityKeywords.test(messageText) && parsed.priority !== "High") {
      parsed.priority = "High";
    }

    // ── Import enforcement block ───────────────────────────────────────────────
    if (importDetected || (parsed.category as string) === "Import") {
      parsed.category          = "Import";
      parsed.division          = "Import / Customs";
      parsed.needs_quotation   = true;
      parsed.needs_document_audit = true;
      parsed.needs_admin_review   = true;
      parsed.suggested_team    = "Import Team";

      // Ensure all required import documents are listed
      const requiredDocs = Array.isArray(parsed.required_documents)
        ? (parsed.required_documents as string[])
        : [];
      const mandatoryDocs = [
        "Commercial Invoice",
        "Packing List",
        "HS Code",
        "Foto produk / katalog",
        "NIB / API Importer",
      ];
      for (const doc of mandatoryDocs) {
        if (!requiredDocs.includes(doc)) requiredDocs.push(doc);
      }
      parsed.required_documents = requiredDocs;

      // Compute missing data: all 16 keys not present in AI's missing_data list are
      // considered either provided or irrelevant — keep whatever AI returned.
      // But if AI returned no missing_data at all, compute from scratch.
      const aiMissing = Array.isArray(parsed.missing_data)
        ? (parsed.missing_data as string[])
        : [];

      // Determine which of the 16 keys are still missing
      const allKeys = IMPORT_REQUIRED_FIELDS.map((f) => f.key);
      // If AI returned human-readable labels instead of keys, try to map them
      const missingKeys = aiMissing.length > 0
        ? aiMissing.filter((m) => allKeys.includes(m as ImportFieldKey))
        : allKeys; // If AI gave no missing_data, treat all as missing

      // Supplement: any key not covered by what was extracted from the message
      parsed.missing_data = missingKeys.length > 0 ? missingKeys : aiMissing;

      // Build smart suggested_reply that asks only for missing fields
      const customerName =
        (parsed.customer_name as string | null | undefined) ?? customerContext?.name ?? null;
      const commodity = (parsed.commodity as string | null | undefined) ?? null;
      parsed.suggested_reply = buildImportMissingDataReply(
        parsed.missing_data as string[],
        customerName,
        commodity,
      );

      logger.info(
        { missingCount: (parsed.missing_data as string[]).length },
        "Import inquiry detected — enforced import rules and generated missing-data reply",
      );
    }

    // Admin review enforcement for other categories
    const category = (parsed.category as string | undefined) ?? "";
    if (
      parsed.needs_quotation === true ||
      category === "Customs" ||
      category === "Finance"
    ) {
      parsed.needs_admin_review = true;
    }

    // Merge in customer context if model couldn't extract it
    if (!parsed.customer_name && customerContext?.name) {
      parsed.customer_name = customerContext.name;
    }
    if (!parsed.customer_phone && customerContext?.phone) {
      parsed.customer_phone = customerContext.phone;
    }

    const result: WhatsAppIntentResult = {
      intent:           (parsed.intent as string | undefined)                    ?? "general_inquiry",
      category:         (parsed.category as IntentCategory | undefined)          ?? "General Inquiry",
      division:         (parsed.division as string | undefined)                  ?? "Customer Service",
      priority:         (parsed.priority as Priority | undefined)                ?? "Low",
      customer_name:    (parsed.customer_name as string | null | undefined)      ?? null,
      customer_phone:   (parsed.customer_phone as string | null | undefined)     ?? null,
      shipment_type:    (parsed.shipment_type as string | null | undefined)      ?? null,
      commodity:        (parsed.commodity as string | null | undefined)           ?? null,
      origin:           (parsed.origin as string | null | undefined)              ?? null,
      destination:      (parsed.destination as string | null | undefined)         ?? null,
      pickup_location:  (parsed.pickup_location as string | null | undefined)    ?? null,
      delivery_location:(parsed.delivery_location as string | null | undefined)  ?? null,
      requested_date:   (parsed.requested_date as string | null | undefined)     ?? null,
      required_documents: Array.isArray(parsed.required_documents)
        ? (parsed.required_documents as string[])
        : [],
      missing_data: Array.isArray(parsed.missing_data)
        ? (parsed.missing_data as string[])
        : [],
      needs_quotation:      Boolean(parsed.needs_quotation),
      needs_document_audit: Boolean(parsed.needs_document_audit),
      needs_admin_review:   Boolean(parsed.needs_admin_review),
      suggested_reply:
        (parsed.suggested_reply as string | undefined) ??
        "Terima kasih, tim kami akan segera menghubungi Anda.",
      suggested_team:    (parsed.suggested_team as string | undefined) ?? "Customer Service",
      confidence_score:  (["high", "medium", "low"].includes(parsed.confidence_score as string)
        ? parsed.confidence_score as ConfidenceScore
        : "medium"),
      customer_sentiment: (["positive", "neutral", "negative", "urgent"].includes(parsed.customer_sentiment as string)
        ? parsed.customer_sentiment as CustomerSentiment
        : "neutral"),
    };

    // If confidence is low, always flag for admin review
    if (result.confidence_score === "low") {
      result.needs_admin_review = true;
    }

    logger.info(
      {
        intent:             result.intent,
        category:           result.category,
        priority:           result.priority,
        confidence_score:   result.confidence_score,
        customer_sentiment: result.customer_sentiment,
        needs_quotation:    result.needs_quotation,
        needs_admin_review: result.needs_admin_review,
        import_detected:    importDetected,
      },
      "WhatsApp intent detected",
    );

    return result;
  } catch (err) {
    logger.error({ err, messageText }, "detectWhatsAppIntent failed — using fallback");
    return fallbackResult(messageText, customerContext);
  }
}
