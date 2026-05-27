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

async function extractPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  const text = data.text?.trim() ?? "";
  if (!text) throw new Error("PDF contains no selectable text (may be a scanned image)");
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
      text = await extractPdf(buffer);
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
