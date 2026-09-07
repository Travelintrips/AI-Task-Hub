/**
 * whatsapp-ai.ts — Thin Adapter (Sprint 2A)
 *
 * detectWhatsAppIntent() signature is UNCHANGED for backward compatibility.
 * Internally delegates to IntentEngine.resolveIntent() which uses the DB-driven
 * knowledge base (intent_master, keyword_rules, data_templates, document_templates).
 *
 * All existing exports (types, constants, utilities) remain — nothing is removed.
 */

import { logger } from "./logger";
import { resolveIntent, type IntentResolution } from "./intent-engine";

// ─── Re-export IntentResolution so callers can use it ─────────────────────────
export type { IntentResolution };

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
  /** Attached resolution from IntentEngine — available when called via WhatsApp webhook. */
  _resolution?: IntentResolution;
}

export interface CustomerContext {
  name?: string | null;
  phone?: string | null;
  companyId?: string | null;
  previousIntents?: string[];
  [key: string]: unknown;
}

// ─── Static constants (kept as fallback when data_templates is empty) ─────────

/**
 * All 16 required data points for an import inquiry.
 * Keys are machine-readable; labels are used in WhatsApp replies.
 * These act as a static fallback when data_templates is empty.
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

/** Returns true if the message clearly signals an import inquiry. */
export function isImportInquiry(messageText: string): boolean {
  return /\b(import|impor|barang dari (china|luar negeri|tiongkok|taiwan|korea|jepang|eropa|america|usa)|mesin dari (china|luar negeri|tiongkok)|beli (mesin|barang) dari luar|customs clearance|door to door import|jasa import|layanan import|freight import|biaya import|ongkos import)\b/i.test(
    messageText,
  );
}

// ─── Category normaliser ──────────────────────────────────────────────────────

const KNOWN_CATEGORIES: IntentCategory[] = [
  "Import", "Export", "Trucking", "Customs", "Warehouse",
  "Freight", "Product Sales", "Complaint", "Finance", "General Inquiry",
];

function normaliseCategory(raw: string | null | undefined): IntentCategory {
  if (!raw) return "General Inquiry";

  // Direct match (case-sensitive)
  if (KNOWN_CATEGORIES.includes(raw as IntentCategory)) return raw as IntentCategory;

  // Case-insensitive match
  const lower = raw.toLowerCase();
  const found = KNOWN_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (found) return found;

  // Partial matches for common variants
  if (/import/i.test(raw))    return "Import";
  if (/export/i.test(raw))    return "Export";
  if (/truck|trucking/i.test(raw)) return "Trucking";
  if (/custom/i.test(raw))    return "Customs";
  if (/wareho/i.test(raw))    return "Warehouse";
  if (/freight/i.test(raw))   return "Freight";
  if (/sales|product/i.test(raw)) return "Product Sales";
  if (/complaint|keluhan/i.test(raw)) return "Complaint";
  if (/finance|financial|keuangan/i.test(raw)) return "Finance";

  return "General Inquiry";
}

function normalisePriority(raw: string | null | undefined): Priority {
  if (!raw) return "Low";
  const lo = raw.toLowerCase();
  if (lo === "urgent" || lo === "high") return "High";
  if (lo === "medium") return "Medium";
  return "Low";
}

// ─── Map IntentResolution → WhatsAppIntentResult ──────────────────────────────

function mapResolutionToResult(res: IntentResolution): WhatsAppIntentResult {
  return {
    intent:             res.intentCode,
    category:           normaliseCategory(res.category),
    division:           res.division ?? "Customer Service",
    priority:           normalisePriority(res.priority),
    customer_name:      res.customerName,
    customer_phone:     res.customerPhone,
    shipment_type:      res.shipmentType,
    commodity:          res.commodity,
    origin:             res.origin,
    destination:        res.destination,
    pickup_location:    null,
    delivery_location:  null,
    requested_date:     res.requestedDate,
    required_documents: res.requiredDocuments.map((d) => d.documentName),
    missing_data:       res.missingDataKeys,
    needs_quotation:    res.needsQuotation,
    needs_document_audit: res.needsDocumentAudit,
    needs_admin_review: res.needsAdminReview,
    suggested_reply:    res.suggestedReply,
    suggested_team:     res.suggestedTeam,
    confidence_score:   res.confidenceScore,
    customer_sentiment: res.customerSentiment,
    _resolution:        res,
  };
}

// ─── Main entry point — signature UNCHANGED ───────────────────────────────────

/**
 * Analyse an incoming WhatsApp message and return structured logistics intent data.
 *
 * Delegates to IntentEngine (DB-driven, knowledge base).
 * Never throws — always returns a safe result with fallback to general_inquiry.
 *
 * @param messageText      Raw text of the customer's message.
 * @param customerContext  Optional context about the sender (name, phone, history).
 * @param messageId        Optional WhatsApp message DB id (used for audit logging).
 */
export async function detectWhatsAppIntent(
  messageText: string,
  customerContext?: CustomerContext,
  messageId?: number,
): Promise<WhatsAppIntentResult> {
  try {
    const resolution = await resolveIntent({
      messageText,
      companyId:    (customerContext?.companyId as string | undefined) ?? "default",
      messageId:    messageId ?? 0,
      customerName: customerContext?.name ?? null,
      customerPhone: customerContext?.phone ?? null,
    });

    const result = mapResolutionToResult(resolution);

    logger.info(
      {
        intent:            result.intent,
        category:          result.category,
        priority:          result.priority,
        confidence_score:  result.confidence_score,
        customer_sentiment: result.customer_sentiment,
        needs_quotation:   result.needs_quotation,
        needs_admin_review: result.needs_admin_review,
        fallback_used:     resolution.fallbackUsed,
        kw_score:          resolution.keywordScore,
        sla_hours:         resolution.slaHours,
      },
      "WhatsApp intent detected (via IntentEngine)",
    );

    return result;
  } catch (err) {
    logger.error({ err, messageText }, "detectWhatsAppIntent: unexpected error — safe fallback");

    return {
      intent: "general_inquiry",
      category: "General Inquiry",
      division: "Customer Service",
      priority: "Low",
      customer_name:   customerContext?.name ?? null,
      customer_phone:  customerContext?.phone ?? null,
      shipment_type:   null,
      commodity:       null,
      origin:          null,
      destination:     null,
      pickup_location: null,
      delivery_location: null,
      requested_date:  null,
      required_documents: [],
      missing_data:    [],
      needs_quotation:     false,
      needs_document_audit: false,
      needs_admin_review:  true,
      suggested_reply: "Terima kasih telah menghubungi kami. Tim kami akan segera membantu Anda.",
      suggested_team:  "Customer Service",
      confidence_score: "low",
      customer_sentiment: "neutral",
    };
  }
}
