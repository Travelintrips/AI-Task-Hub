import OpenAI from "openai";
import { logger } from "./logger";

const apiKey = process.env.OPENAI_API_KEY;

export const openai = new OpenAI({ apiKey: apiKey ?? "missing" });

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
}

export interface CustomerContext {
  name?: string | null;
  phone?: string | null;
  companyId?: string | null;
  previousIntents?: string[];
  [key: string]: unknown;
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
    needs_admin_review: false,
    suggested_reply:
      "Terima kasih telah menghubungi kami. Tim kami akan segera membantu Anda. Mohon tunggu sebentar.",
    suggested_team: "Customer Service",
  };
}

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Analyse an incoming WhatsApp message and return structured logistics intent data.
 *
 * @param messageText  The raw text of the customer's message.
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

  const contextBlock = customerContext
    ? `\nCustomer context:\n${JSON.stringify(customerContext, null, 2)}`
    : "";

  const systemPrompt = `You are an AI assistant for a logistics and freight forwarding company.
Analyse the incoming WhatsApp message and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

## Categories (pick exactly one)
Import | Export | Trucking | Customs | Warehouse | Freight | Product Sales | Complaint | Finance | General Inquiry

## Priority rules (apply strictly)
- "High"   → message contains any of: urgent, segera, today, hari ini, besok, tomorrow, complaint, keluhan, terlambat, delay, overdue
- "Medium" → standard service request (shipment, quotation, booking, pickup, delivery)
- "Low"    → general question, greetings, information only

## Strict rules
1. NEVER include or suggest a final price or tariff. If pricing is asked, set needs_quotation=true and needs_admin_review=true.
2. ALWAYS set needs_admin_review=true when: quotation is needed, customs decision is involved, or the category is Customs or Finance.
3. needs_document_audit=true when the customer mentions or submits a document (invoice, BL, packing list, COA, SKU, manifest, etc.).
4. suggested_reply must be in Bahasa Indonesia, friendly, and professional. Never give a price. Never give a customs decision.
5. suggested_team must be one of: Import Team | Export Team | Trucking Team | Customs Team | Warehouse Team | Freight Team | Sales Team | Finance Team | Customer Service
6. Return null for any field you cannot determine from the message.
7. required_documents should list documents the customer needs to provide for this transaction type.
8. missing_data should list information missing from the customer's message that is needed to proceed.

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
  "suggested_team": string
}`;

  const userContent = `Message: ${messageText}${contextBlock}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 800,
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

    // ── Enforce business rules regardless of what the model returns ────────────

    // Priority override: scan message for high-priority keywords
    const highPriorityKeywords = /urgent|segera|today|hari ini|besok|tomorrow|complaint|keluhan|terlambat|delay|overdue/i;
    if (highPriorityKeywords.test(messageText) && parsed.priority !== "High") {
      parsed.priority = "High";
    }

    // Admin review enforcement
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
      intent: (parsed.intent as string | undefined) ?? "general_inquiry",
      category: (parsed.category as IntentCategory | undefined) ?? "General Inquiry",
      division: (parsed.division as string | undefined) ?? "Customer Service",
      priority: (parsed.priority as Priority | undefined) ?? "Low",
      customer_name: (parsed.customer_name as string | null | undefined) ?? null,
      customer_phone: (parsed.customer_phone as string | null | undefined) ?? null,
      shipment_type: (parsed.shipment_type as string | null | undefined) ?? null,
      commodity: (parsed.commodity as string | null | undefined) ?? null,
      origin: (parsed.origin as string | null | undefined) ?? null,
      destination: (parsed.destination as string | null | undefined) ?? null,
      pickup_location: (parsed.pickup_location as string | null | undefined) ?? null,
      delivery_location: (parsed.delivery_location as string | null | undefined) ?? null,
      requested_date: (parsed.requested_date as string | null | undefined) ?? null,
      required_documents: Array.isArray(parsed.required_documents)
        ? (parsed.required_documents as string[])
        : [],
      missing_data: Array.isArray(parsed.missing_data)
        ? (parsed.missing_data as string[])
        : [],
      needs_quotation: Boolean(parsed.needs_quotation),
      needs_document_audit: Boolean(parsed.needs_document_audit),
      needs_admin_review: Boolean(parsed.needs_admin_review),
      suggested_reply:
        (parsed.suggested_reply as string | undefined) ??
        "Terima kasih, tim kami akan segera menghubungi Anda.",
      suggested_team: (parsed.suggested_team as string | undefined) ?? "Customer Service",
    };

    logger.info(
      {
        intent: result.intent,
        category: result.category,
        priority: result.priority,
        needs_quotation: result.needs_quotation,
        needs_admin_review: result.needs_admin_review,
      },
      "WhatsApp intent detected",
    );

    return result;
  } catch (err) {
    logger.error({ err, messageText }, "detectWhatsAppIntent failed — using fallback");
    return fallbackResult(messageText, customerContext);
  }
}
