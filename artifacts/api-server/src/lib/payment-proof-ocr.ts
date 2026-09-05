import { logger } from "./logger";
import { openai } from "./openai";

// pdf-parse@1.1.1 executes a bundled test PDF when imported through its main
// entry point. Use the internal parser, matching the existing extraction code.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse") as (
  buffer: Buffer,
) => Promise<{ text: string }>;

const OCR_MODEL = "gpt-4o-mini";
const MIN_CONFIDENCE = 0.65;

export interface PaymentProofOcrResult {
  valid: boolean;
  confidence: number;
  payerName: string | null;
  amount: number | null;
  transactionDate: string | null;
  reference: string | null;
  bankName: string | null;
  rawText: string;
  failureReason: string | null;
  data: Record<string, unknown>;
}

function normalizeAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!cleaned) return null;

  // Support both Indonesian "100.000,00" and international "100,000.00".
  const normalized = cleaned.includes(",") && cleaned.includes(".")
    ? cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "")
    : cleaned.includes(",")
      ? cleaned.replace(",", ".")
      : cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function stripMarkdownJson(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function mimeFromUrl(fileUrl: string, contentType: string | null): string {
  if (contentType?.startsWith("image/") || contentType === "application/pdf") {
    return contentType;
  }
  const pathname = new URL(fileUrl).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

function imageMediaType(mimeType: string): string {
  return mimeType === "image/png" || mimeType === "image/webp"
    ? mimeType
    : "image/jpeg";
}

const PAYMENT_PROOF_PROMPT = `Analyze this document as a payment proof for a sports-field booking.
Return ONLY a valid JSON object with exactly these keys:
{
  "is_payment_proof": boolean,
  "payer_name": string|null,
  "amount": number|null,
  "transaction_date": string|null,
  "reference": string|null,
  "bank_name": string|null,
  "raw_text": string,
  "confidence": number,
  "validation_notes": string|null
}

Rules:
- Set is_payment_proof=false if this is not clearly a bank transfer, QRIS, e-wallet, cash receipt, or other payment receipt.
- amount must be a numeric number only, with no currency symbols or separators.
- Do not guess unreadable values; use null.
- confidence must be between 0 and 1.
- raw_text must contain the important visible/extracted receipt text.
- Return JSON only, without markdown.`;

async function readProof(fileUrl: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  const response = await fetch(fileUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Bukti pembayaran tidak dapat dibaca (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    mimeType: mimeFromUrl(fileUrl, response.headers.get("content-type")),
  };
}

async function callOcr(
  buffer: Buffer,
  mimeType: string,
): Promise<Record<string, unknown>> {
  let content:
    | Array<{ type: "text"; text: string }>
    | Array<
        | { type: "text"; text: string }
        | {
            type: "image_url";
            image_url: { url: string; detail: "high" };
          }
      >;

  if (mimeType === "application/pdf") {
    const parsed = await pdfParse(buffer);
    const text = parsed.text?.trim() ?? "";
    if (!text) {
      throw new Error(
        "PDF bukti pembayaran tidak memiliki teks yang dapat dibaca OCR",
      );
    }
    content = [
      {
        type: "text",
        text:
          PAYMENT_PROOF_PROMPT +
          "\n\nPDF text extracted from the uploaded document:\n" +
          text,
      },
    ];
  } else {
    content = [
      { type: "text", text: PAYMENT_PROOF_PROMPT },
      {
        type: "image_url",
        image_url: {
          url: `data:${imageMediaType(mimeType)};base64,${buffer.toString("base64")}`,
          detail: "high",
        },
      },
    ];
  }

  const response = await openai.chat.completions.create({
    model: OCR_MODEL,
    messages: [{ role: "user", content }],
    max_tokens: 1200,
    temperature: 0,
    response_format: { type: "json_object" },
  });
  const raw = response.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("OCR tidak menghasilkan jawaban");
  return JSON.parse(stripMarkdownJson(raw)) as Record<string, unknown>;
}

export async function extractPaymentProofOcr(params: {
  fileUrl: string;
  expectedAmount: number;
}): Promise<PaymentProofOcrResult> {
  const baseData: Record<string, unknown> = {
    model: OCR_MODEL,
    expected_amount: params.expectedAmount,
  };

  try {
    const { buffer, mimeType } = await readProof(params.fileUrl);
    const parsed = await callOcr(buffer, mimeType);
    const confidence = Math.min(
      1,
      Math.max(0, Number(parsed.confidence) || 0),
    );
    const amount = normalizeAmount(parsed.amount);
    const payerName = stringOrNull(parsed.payer_name);
    const transactionDate = stringOrNull(parsed.transaction_date);
    const reference = stringOrNull(parsed.reference);
    const bankName = stringOrNull(parsed.bank_name);
    const rawText = stringOrNull(parsed.raw_text) ?? "";
    const isPaymentProof = parsed.is_payment_proof === true;
    const amountMatches =
      amount !== null &&
      Math.abs(amount - params.expectedAmount) <= 0.01;

    const reasons: string[] = [];
    if (!isPaymentProof) reasons.push("dokumen bukan bukti pembayaran");
    if (confidence < MIN_CONFIDENCE) {
      reasons.push(`confidence OCR terlalu rendah (${confidence.toFixed(2)})`);
    }
    if (amount === null || amount <= 0) {
      reasons.push("nominal pembayaran tidak terbaca");
    } else if (!amountMatches) {
      reasons.push(
        `nominal OCR Rp${amount.toLocaleString("id-ID")} tidak sama dengan total booking Rp${params.expectedAmount.toLocaleString("id-ID")}`,
      );
    }

    const data: Record<string, unknown> = {
      ...baseData,
      mime_type: mimeType,
      is_payment_proof: isPaymentProof,
      payer_name: payerName,
      amount,
      transaction_date: transactionDate,
      reference,
      bank_name: bankName,
      raw_text: rawText,
      confidence,
      amount_matches: amountMatches,
      validation_status: reasons.length === 0 ? "valid" : "invalid",
      validation_notes:
        stringOrNull(parsed.validation_notes) ??
        (reasons.length > 0 ? reasons.join("; ") : null),
    };

    return {
      valid: reasons.length === 0,
      confidence,
      payerName,
      amount,
      transactionDate,
      reference,
      bankName,
      rawText,
      failureReason: reasons.length > 0 ? reasons.join("; ") : null,
      data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR gagal diproses";
    logger.error({ err }, "Payment proof OCR failed");
    return {
      valid: false,
      confidence: 0,
      payerName: null,
      amount: null,
      transactionDate: null,
      reference: null,
      bankName: null,
      rawText: "",
      failureReason: message,
      data: {
        ...baseData,
        validation_status: "ocr_failed",
        validation_notes: message,
      },
    };
  }
}