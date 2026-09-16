import { logger } from "./logger";
import { openai } from "./openai";
import {
  extractStoragePath,
  PAYMENT_PROOF_BUCKET,
  supabase,
} from "./supabase";

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
  serviceUnavailable: boolean;
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

function extractAmountFromText(rawText: string): number | null {
  const text = rawText.replace(/\u00a0/g, " ");
  const amountPattern = String.raw`(?:Rp|IDR)?\s*([0-9][0-9.,\s]*)`;
  const labeledPatterns = [
    new RegExp(
      String.raw`(?:total\s+transaksi|transaction\s+amount|total\s+pembayaran|jumlah\s+pembayaran|nominal\s+pembayaran|total)\s*:?\s*` +
        amountPattern,
      "gi",
    ),
    new RegExp(String.raw`(?:Rp|IDR)\s*([0-9][0-9.,\s]*)`, "gi"),
  ];

  for (const pattern of labeledPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const amount = normalizeAmount(match[1]);
      if (amount !== null && amount > 0) return amount;
    }
  }

  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDate(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;

  const dateOnly = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return buildValidDate(year!, month!, day!);
  }

  const numericDate = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (numericDate) {
    const [, first, second, year] = numericDate;
    const secondNumber = Number(second);

    // Receipt screenshots may use either Indonesian DD/MM/YYYY or the
    // browser/bank-style MM/DD/YYYY format. Values above 12 disambiguate
    // the format; ambiguous values keep the Indonesian day-first default.
    const day = secondNumber > 12 ? second! : first!;
    const month = secondNumber > 12 ? first! : second!;
    return buildValidDate(year!, month, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildValidDate(year: string, month: string, day: string): string | null {
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (
    !Number.isInteger(yearNumber) ||
    !Number.isInteger(monthNumber) ||
    !Number.isInteger(dayNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    candidate.getUTCFullYear() !== yearNumber ||
    candidate.getUTCMonth() !== monthNumber - 1 ||
    candidate.getUTCDate() !== dayNumber
  ) {
    return null;
  }
  return `${yearNumber.toString().padStart(4, "0")}-${monthNumber
    .toString()
    .padStart(2, "0")}-${dayNumber.toString().padStart(2, "0")}`;
}

function extractTransactionDateFromText(rawText: string): string | null {
  const text = rawText.replace(/\u00a0/g, " ");
  const dateToken = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})`;
  const labeledPattern = new RegExp(
    String.raw`(?:tanggal\s+(?:transfer|transaksi)|transaction\s+date|transfer\s+date|date\s*(?:and\s*time)?|waktu\s+transaksi)\s*:?\s*` +
      dateToken,
    "i",
  );
  const labeledMatch = text.match(labeledPattern);
  const labeledDate = labeledMatch?.[1]
    ? normalizeDate(labeledMatch[1])
    : null;
  if (labeledDate) return labeledDate;

  // Some mobile-banking receipts put the date on its own line without a
  // label. Use the first valid standalone date as a conservative fallback.
  const candidates = text.match(new RegExp(dateToken, "gi")) ?? [];
  for (const candidate of candidates) {
    const normalized = normalizeDate(candidate);
    if (normalized) return normalized;
  }
  return null;
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
  "amount_text": string|null,
  "transaction_date": string|null,
  "reference": string|null,
  "bank_name": string|null,
  "raw_text": string,
  "confidence": number,
  "validation_notes": string|null
}

Rules:
- Set is_payment_proof=false if this is not clearly a bank transfer, QRIS, e-wallet, cash receipt, or other payment receipt.
- Read the exact amount next to the receipt's total label, such as "Total Transaksi", "Transaction Amount", or "Total Pembayaran".
- For Indonesian currency, a dot is a thousands separator: "Rp 30.000" means 30000, never 30.
- amount must be a numeric number only, with no currency symbols or separators.
- amount_text must preserve the visible amount exactly as text, including "Rp" and separators when readable.
- transaction_date must be the transfer/transaction date shown on the receipt,
  not the booking date, due date, or statement period.
- transaction_date must use YYYY-MM-DD when the date is readable. If the
  transfer date is not visible or unreadable, use null; never guess.
- Do not guess unreadable values; use null.
- confidence must be between 0 and 1.
- raw_text must contain the important visible/extracted receipt text.
- Return JSON only, without markdown.`;

async function readProof(fileUrl: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  // Payment proofs are stored in a private Supabase bucket in production.
  // The public URL returned by getPublicUrl() is still persisted with the
  // booking, but it cannot be fetched anonymously when the bucket is private.
  // Download through the server-side Supabase client instead so the service
  // role can read both DEV (public bucket) and production (private bucket).
  const storagePath = extractStoragePath(fileUrl);
  if (storagePath && supabase) {
    const { data, error } = await supabase.storage
      .from(PAYMENT_PROOF_BUCKET)
      .download(storagePath);

    if (error || !data) {
      throw new Error(
        `Bukti pembayaran tidak dapat dibaca dari Supabase Storage${
          error?.message ? `: ${error.message}` : ""
        }`,
      );
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      buffer,
      mimeType: mimeFromUrl(fileUrl, data.type || null),
    };
  }

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
  expectedDate?: string;
}): Promise<PaymentProofOcrResult> {
  const expectedDate = normalizeDate(params.expectedDate);
  const baseData: Record<string, unknown> = {
    model: OCR_MODEL,
    expected_amount: params.expectedAmount,
    expected_date: expectedDate,
  };

  try {
    const { buffer, mimeType } = await readProof(params.fileUrl);
    const parsed = await callOcr(buffer, mimeType);
    const confidence = Math.min(
      1,
      Math.max(0, Number(parsed.confidence) || 0),
    );
    const payerName = stringOrNull(parsed.payer_name);
    const reference = stringOrNull(parsed.reference);
    const bankName = stringOrNull(parsed.bank_name);
    const rawText = stringOrNull(parsed.raw_text) ?? "";
    const transactionDate =
      normalizeDate(parsed.transaction_date) ??
      extractTransactionDateFromText(rawText);
    const amountFromText = extractAmountFromText(rawText);
    const amountFromAmountText = normalizeAmount(parsed.amount_text);
    const amountFromModel = normalizeAmount(parsed.amount);
    const amount = amountFromText ?? amountFromAmountText ?? amountFromModel;
    const isPaymentProof = parsed.is_payment_proof === true;
    const amountMatches =
      amount !== null &&
      Math.abs(amount - params.expectedAmount) <= 0.01;
    // A payment proof must contain a readable transfer date even when the
    // booking date is intentionally not used as an exact comparison target.
    // Customers may pay days before the booking, but an undated proof cannot
    // be safely audited.
    const dateMatches =
      transactionDate !== null &&
      (expectedDate === null || transactionDate === expectedDate);

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
    if (transactionDate === null) {
      reasons.push("tanggal transfer/transaksi tidak terbaca");
    } else if (expectedDate !== null && !dateMatches) {
      reasons.push(
        `tanggal OCR ${transactionDate} tidak sama dengan tanggal booking ${expectedDate}`,
      );
    }

    const data: Record<string, unknown> = {
      ...baseData,
      mime_type: mimeType,
      is_payment_proof: isPaymentProof,
      payer_name: payerName,
      amount,
      amount_text: stringOrNull(parsed.amount_text),
      amount_source: amountFromText !== null
        ? "raw_text"
        : amountFromAmountText !== null
          ? "amount_text"
          : "model_amount",
      transaction_date: transactionDate,
      reference,
      bank_name: bankName,
      raw_text: rawText,
      confidence,
      amount_matches: amountMatches,
      date_matches: dateMatches,
      validation_status: reasons.length === 0 ? "valid" : "invalid",
      validation_notes:
        stringOrNull(parsed.validation_notes) ??
        (reasons.length > 0 ? reasons.join("; ") : null),
    };

    return {
      valid: reasons.length === 0,
      serviceUnavailable: false,
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
    const isAuthenticationError =
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      Number((err as { status?: unknown }).status) === 401;
    logger.error({ err }, "Payment proof OCR failed");
    return {
      valid: false,
      serviceUnavailable: isAuthenticationError,
      confidence: 0,
      payerName: null,
      amount: null,
      transactionDate: null,
      reference: null,
      bankName: null,
      rawText: "",
      failureReason: isAuthenticationError
        ? "Layanan OCR belum terhubung dengan kredensial yang valid"
        : message,
      data: {
        ...baseData,
        validation_status: isAuthenticationError
          ? "ocr_unavailable"
          : "ocr_failed",
        validation_notes: isAuthenticationError
          ? "Kredensial layanan OCR tidak valid"
          : message,
      },
    };
  }
}