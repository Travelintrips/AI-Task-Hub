// pdf-parse@1.1.1 reads a test PDF on startup when required via its main index.
// Bypass that by importing the internal lib directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse") as (buffer: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number; info: unknown }>;
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { openai } from "./openai";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

export type ExtractionResult =
  | { success: true; text: string }
  | { success: false; error: string };

async function fetchFileBuffer(
  fileUrl: string | null | undefined,
  objectPath: string | null | undefined,
): Promise<Buffer> {
  if (objectPath) {
    const service = new ObjectStorageService();
    const file = await service.getObjectEntityFile(objectPath);
    const response = await service.downloadObject(file);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (fileUrl) {
    const response = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch file: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error("No file URL or object path available for extraction");
}

function resolveMimeType(mimeType: string | null | undefined, filename: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
  };
  return map[ext] ?? "application/octet-stream";
}

async function extractPdf(buffer: Buffer, filename?: string): Promise<string> {
  const data = await pdfParse(buffer);
  const text = data.text?.trim() ?? "";
  if (!text) {
    logger.warn({ filename }, "PDF has no selectable text — falling back to GPT-4o Vision OCR");
    return extractImageOcr(buffer, filename ?? "document.pdf");
  }
  return text;
}

async function extractImageOcr(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "jpeg";
  const mediaTypeMap: Record<string, string> = {
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };
  const mediaType = mediaTypeMap[ext] ?? "image/jpeg";
  const base64 = buffer.toString("base64");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all visible text from this image exactly as it appears, preserving line breaks and structure. Return only the extracted text. If there is no readable text in the image, respond with exactly: NO_TEXT_FOUND",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "";
  if (!text || text === "NO_TEXT_FOUND") {
    throw new Error("No readable text found in image");
  }
  return text;
}

async function extractExcel(buffer: Buffer): Promise<string> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const trimmed = csv.trim();
    if (trimmed) {
      parts.push(`[Sheet: ${sheetName}]\n${trimmed}`);
    }
  }

  if (parts.length === 0) throw new Error("No data found in Excel file");
  return parts.join("\n\n");
}

async function extractWord(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim() ?? "";
  if (!text) throw new Error("No text content found in Word document");
  return text;
}

export const DOCUMENT_TYPES = [
  "Commercial Invoice",
  "Packing List",
  "Bill of Lading",
  "Air Waybill",
  "Certificate of Origin",
  "Insurance",
  "Product Catalog",
  "Import License",
  "Legal Document",
  "Unknown",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type DetectionResult =
  | { success: true; documentType: DocumentType }
  | { success: false; error: string };

export async function detectDocumentType(extractedText: string): Promise<DetectionResult> {
  if (!extractedText || extractedText.trim().length < 10) {
    return { success: true, documentType: "Unknown" };
  }

  const snippet = extractedText.slice(0, 3000);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a trade document classifier. Classify the document text into exactly one of these types:
- Commercial Invoice
- Packing List
- Bill of Lading
- Air Waybill
- Certificate of Origin
- Insurance
- Product Catalog
- Import License
- Legal Document
- Unknown

Rules:
- Return ONLY the exact type name, nothing else — no explanation, no punctuation.
- Use "Unknown" only when there is genuinely not enough information to classify.
- Lean toward the most specific match based on structure, keywords, and content.`,
        },
        {
          role: "user",
          content: snippet,
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const matched = DOCUMENT_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
    const documentType: DocumentType = matched ?? "Unknown";

    logger.info({ documentType, rawResponse: raw }, "Document type detected");
    return { success: true, documentType };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown detection error";
    logger.error({ err }, "Document type detection failed");
    return { success: false, error };
  }
}

export interface DocumentFields {
  importer_name: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  hs_code: string | null;
  item_description: string | null;
  quantity: string | null;
  unit_price: string | null;
  total_value: string | null;
  currency: string | null;
  gross_weight: string | null;
  net_weight: string | null;
  dimensions: string | null;
  incoterm: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  country_of_origin: string | null;
  delivery_address: string | null;
  package_count: string | null;
  machine_condition_new_or_used: string | null;
}

export type FieldExtractionResult =
  | { success: true; fields: DocumentFields }
  | { success: false; error: string };

const FIELD_EXTRACTION_SYSTEM_PROMPT = `You are a trade document parser. Extract structured fields from the document text.

Return ONLY a valid JSON object with these exact keys (use null for any field not found):
{
  "importer_name": string or null,
  "supplier_name": string or null,
  "invoice_number": string or null,
  "invoice_date": string or null,
  "hs_code": string or null,
  "item_description": string or null,
  "quantity": string or null,
  "unit_price": string or null,
  "total_value": string or null,
  "currency": string or null,
  "gross_weight": string or null,
  "net_weight": string or null,
  "dimensions": string or null,
  "incoterm": string or null,
  "port_of_loading": string or null,
  "port_of_discharge": string or null,
  "country_of_origin": string or null,
  "delivery_address": string or null,
  "package_count": string or null,
  "machine_condition_new_or_used": string or null
}

Rules:
- Return ONLY the JSON object — no markdown, no explanation, no code fences.
- Preserve original values as strings (do not convert units or currencies).
- For machine_condition_new_or_used: return "New", "Used", or null.
- For incoterm: return the standard 3-letter code (e.g. "FOB", "CIF", "EXW") if found.
- For hs_code: return the most specific code found (e.g. "8542.31.9000").
- If multiple items exist, summarise item_description as a comma-separated list and sum quantity/total_value where logical.`;

export async function extractDocumentFields(
  extractedText: string,
  documentType?: string | null,
): Promise<FieldExtractionResult> {
  if (!extractedText || extractedText.trim().length < 10) {
    return {
      success: true,
      fields: Object.fromEntries(
        [
          "importer_name","supplier_name","invoice_number","invoice_date","hs_code",
          "item_description","quantity","unit_price","total_value","currency",
          "gross_weight","net_weight","dimensions","incoterm","port_of_loading",
          "port_of_discharge","country_of_origin","delivery_address","package_count",
          "machine_condition_new_or_used",
        ].map((k) => [k, null]),
      ) as DocumentFields,
    };
  }

  const snippet = extractedText.slice(0, 6000);
  const userContent = documentType
    ? `Document type: ${documentType}\n\n${snippet}`
    : snippet;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: FIELD_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 1024,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const FIELD_KEYS: (keyof DocumentFields)[] = [
      "importer_name","supplier_name","invoice_number","invoice_date","hs_code",
      "item_description","quantity","unit_price","total_value","currency",
      "gross_weight","net_weight","dimensions","incoterm","port_of_loading",
      "port_of_discharge","country_of_origin","delivery_address","package_count",
      "machine_condition_new_or_used",
    ];

    const fields = Object.fromEntries(
      FIELD_KEYS.map((k) => {
        const val = parsed[k];
        return [k, typeof val === "string" && val.length > 0 ? val : null];
      }),
    ) as DocumentFields;

    logger.info({ documentType, fieldsFound: FIELD_KEYS.filter((k) => fields[k] !== null).length }, "Document fields extracted");
    return { success: true, fields };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown field extraction error";
    logger.error({ err }, "Document field extraction failed");
    return { success: false, error };
  }
}

export async function extractTextFromAttachment(params: {
  fileName: string;
  mimeType: string | null | undefined;
  fileUrl: string | null | undefined;
  objectPath: string | null | undefined;
}): Promise<ExtractionResult> {
  const { fileName, fileUrl, objectPath } = params;
  const mimeType = resolveMimeType(params.mimeType, fileName);

  try {
    const buffer = await fetchFileBuffer(fileUrl, objectPath);

    let text: string;

    if (mimeType === "application/pdf") {
      text = await extractPdf(buffer, fileName);
    } else if (mimeType.startsWith("image/")) {
      text = await extractImageOcr(buffer, fileName);
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      text = await extractExcel(buffer);
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      text = await extractWord(buffer);
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    return { success: true, text };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown extraction error";
    logger.error({ err, fileName, mimeType }, "Text extraction failed");
    return { success: false, error };
  }
}
