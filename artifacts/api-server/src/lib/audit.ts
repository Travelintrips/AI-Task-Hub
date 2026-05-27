import { openai } from "./openai";
import { logger } from "./logger";
import type { TaskAttachment } from "@workspace/db";

export interface AuditCheckItem {
  key: string;
  label: string;
  status: "complete" | "missing" | "unclear" | "mismatch";
  values: string[];
  note?: string;
}

export interface AuditResult {
  completeFields: string[];
  missingFields: string[];
  mismatchFields: string[];
  unclearFields: string[];
  auditDetail: AuditCheckItem[];
  recommendation: string;
  nextAction: string;
  auditStatus: "passed" | "incomplete" | "failed";
}

type ExtractedFields = Record<string, string | null | undefined>;

function getExtracted(attachment: TaskAttachment): ExtractedFields {
  if (!attachment.extractedFields || typeof attachment.extractedFields !== "object") return {};
  return attachment.extractedFields as ExtractedFields;
}

function collectValues(attachments: TaskAttachment[], field: keyof ExtractedFields): string[] {
  return attachments
    .map((a) => getExtracted(a)[field])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function checkDocumentType(attachments: TaskAttachment[], ...types: string[]): boolean {
  return attachments.some((a) => a.documentType && types.includes(a.documentType));
}

function checkProductCatalogOrPhoto(attachments: TaskAttachment[]): boolean {
  return attachments.some(
    (a) =>
      a.documentType === "Product Catalog" ||
      (a.mimeType != null && a.mimeType.startsWith("image/")),
  );
}

function checkNibApi(attachments: TaskAttachment[]): boolean {
  return attachments.some(
    (a) =>
      a.documentType === "Import License" ||
      /\b(NIB|API|angka\s*pengenal\s*importir)\b/i.test(a.fileName),
  );
}

function classifyFieldCheck(
  key: string,
  label: string,
  values: string[],
  found: boolean,
): AuditCheckItem {
  if (!found || values.length === 0) {
    return { key, label, status: "missing", values: [] };
  }
  const unique = [...new Set(values.map((v) => v.trim().toLowerCase()))];
  if (unique.length > 1) {
    return { key, label, status: "mismatch", values, note: "Conflicting values across documents" };
  }
  const val = values[0];
  if (val.length < 2 || /^(n\/a|unknown|tbd|-)$/i.test(val)) {
    return { key, label, status: "unclear", values, note: "Value present but ambiguous" };
  }
  return { key, label, status: "complete", values };
}

function classifyPresenceCheck(
  key: string,
  label: string,
  found: boolean,
): AuditCheckItem {
  return {
    key,
    label,
    status: found ? "complete" : "missing",
    values: found ? ["✓"] : [],
  };
}

export function runImportAuditChecks(attachments: TaskAttachment[]): AuditCheckItem[] {
  const checks: AuditCheckItem[] = [];

  checks.push(classifyPresenceCheck(
    "invoice",
    "Commercial Invoice",
    checkDocumentType(attachments, "Commercial Invoice"),
  ));

  checks.push(classifyPresenceCheck(
    "packing_list",
    "Packing List",
    checkDocumentType(attachments, "Packing List"),
  ));

  const hsCodes = collectValues(attachments, "hs_code");
  checks.push(classifyFieldCheck("hs_code", "HS Code", hsCodes, hsCodes.length > 0));

  checks.push(classifyPresenceCheck(
    "product_catalog_photo",
    "Product Catalog / Photo",
    checkProductCatalogOrPhoto(attachments),
  ));

  const grossWeights = collectValues(attachments, "gross_weight");
  checks.push(classifyFieldCheck("gross_weight", "Gross Weight", grossWeights, grossWeights.length > 0));

  const dimensions = collectValues(attachments, "dimensions");
  checks.push(classifyFieldCheck("dimensions", "Dimensions", dimensions, dimensions.length > 0));

  const incoterms = collectValues(attachments, "incoterm");
  checks.push(classifyFieldCheck("incoterm", "Incoterm", incoterms, incoterms.length > 0));

  const polValues = collectValues(attachments, "port_of_loading");
  checks.push(classifyFieldCheck("port_of_loading", "Port of Loading", polValues, polValues.length > 0));

  const podValues = collectValues(attachments, "port_of_discharge");
  checks.push(classifyFieldCheck("port_of_discharge", "Port of Discharge", podValues, podValues.length > 0));

  const importerNames = collectValues(attachments, "importer_name");
  checks.push(classifyFieldCheck("importer_name", "Importer Name", importerNames, importerNames.length > 0));

  checks.push(classifyPresenceCheck(
    "nib_api",
    "NIB / API (Import License)",
    checkNibApi(attachments),
  ));

  const machineConditions = collectValues(attachments, "machine_condition_new_or_used");
  checks.push(classifyFieldCheck(
    "machine_condition",
    "Machine Condition (New / Used)",
    machineConditions,
    machineConditions.length > 0,
  ));

  return checks;
}

export async function generateAuditNarrative(
  checks: AuditCheckItem[],
): Promise<{ recommendation: string; nextAction: string }> {
  const summary = checks
    .map((c) => `- ${c.label}: ${c.status.toUpperCase()}${c.values.length ? ` (${c.values.slice(0, 2).join(", ")})` : ""}${c.note ? ` — ${c.note}` : ""}`)
    .join("\n");

  const missingCount = checks.filter((c) => c.status === "missing").length;
  const mismatchCount = checks.filter((c) => c.status === "mismatch").length;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an import compliance specialist. Given a document audit checklist, write:
1. A concise "recommendation" (2-3 sentences) explaining the overall import document compliance status and key concerns.
2. A specific "next_action" (1-2 sentences) — the single most important thing the team should do right now.

Respond ONLY with valid JSON: {"recommendation": "...", "next_action": "..."}`,
        },
        {
          role: "user",
          content: `Import document audit results:\n${summary}\n\nSummary: ${missingCount} missing, ${mismatchCount} mismatched fields.`,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw) as { recommendation?: string; next_action?: string };
    return {
      recommendation: parsed.recommendation ?? "Review the missing and mismatched fields before proceeding with customs clearance.",
      nextAction: parsed.next_action ?? "Collect all missing documents and re-run the audit.",
    };
  } catch (err) {
    logger.error({ err }, "Failed to generate audit narrative via OpenAI");
    const missing = checks.filter((c) => c.status === "missing").map((c) => c.label);
    return {
      recommendation:
        missingCount === 0 && mismatchCount === 0
          ? "All required import documents appear complete. Proceed to customs submission."
          : `Import documentation is incomplete. Missing: ${missing.join(", ")}.`,
      nextAction:
        missingCount > 0
          ? `Obtain the following missing documents: ${missing.slice(0, 3).join(", ")}.`
          : mismatchCount > 0
            ? "Resolve conflicting values across documents before submission."
            : "Verify all documents are signed and stamped, then submit to customs.",
    };
  }
}

const FIELD_LABEL_ID: Record<string, string> = {
  "Commercial Invoice": "Commercial Invoice",
  "Packing List": "Packing List",
  "HS Code": "HS Code",
  "Product Catalog / Photo": "foto/katalog produk",
  "Gross Weight": "berat kotor (gross weight)",
  "Dimensions": "dimensi barang",
  "Incoterm": "syarat pengiriman (Incoterm)",
  "Port of Loading": "Port of Loading",
  "Port of Discharge": "Port of Discharge",
  "Importer Name": "nama importir",
  "NIB / API (Import License)": "NIB/API importir",
  "Machine Condition (New / Used)": "keterangan kondisi mesin (baru atau bekas)",
};

function toIdLabel(label: string): string {
  return FIELD_LABEL_ID[label] ?? label;
}

function buildWhatsAppTemplate(items: string[]): string {
  const numbered = items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return (
    `Baik Bapak/Ibu, dokumen sudah kami terima. Dari hasil pengecekan awal, masih diperlukan beberapa data berikut:\n` +
    `${numbered}\n\n` +
    `Mohon dapat dilengkapi agar team kami dapat melanjutkan pengecekan estimasi biaya dan kebutuhan perizinan.`
  );
}

export async function generateWhatsAppReply(
  missingFields: string[],
  mismatchFields: string[],
  unclearFields: string[],
): Promise<string> {
  const items: string[] = [
    ...missingFields.map(toIdLabel),
    ...mismatchFields.map((f) => `${toIdLabel(f)} (mohon dikonfirmasi ulang)`),
    ...unclearFields.map((f) => `${toIdLabel(f)} (perlu klarifikasi)`),
  ];

  if (items.length === 0) {
    return "Baik Bapak/Ibu, dokumen sudah kami terima dan semua data yang diperlukan telah lengkap. Team kami akan segera melanjutkan proses.";
  }

  const itemList = items.map((item, i) => `${i + 1}. ${item}`).join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Kamu adalah staf layanan pelanggan perusahaan jasa freight forwarding dan impor ekspor.
Tulis pesan WhatsApp dalam bahasa Indonesia yang sopan dan profesional untuk meminta data yang masih kurang dari pelanggan.

Aturan ketat:
- Gunakan sapaan "Bapak/Ibu"
- Konfirmasi bahwa dokumen sudah diterima
- Sebutkan hanya item data yang diberikan dalam daftar, dengan nomor urut
- JANGAN menyebut istilah teknis internal (jangan sebut "audit", "status", "sistem", "pengecekan otomatis")
- JANGAN menjanjikan atau menyebut harga, biaya final, atau timeline pasti
- JANGAN menambahkan item lain di luar yang diberikan
- Tutup dengan kalimat permohonan yang sopan
- Panjang pesan: hanya intro singkat + daftar item + penutup (maksimal 3 kalimat di luar daftar)`,
        },
        {
          role: "user",
          content: `Data yang perlu diminta ke pelanggan:\n${itemList}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });

    const text = response.choices[0]?.message?.content?.trim();
    return text && text.length > 20 ? text : buildWhatsAppTemplate(items);
  } catch (err) {
    logger.error({ err }, "Failed to generate WhatsApp reply via OpenAI — using template");
    return buildWhatsAppTemplate(items);
  }
}

export function buildAuditResult(
  checks: AuditCheckItem[],
  narrative: { recommendation: string; nextAction: string },
): Omit<AuditResult, "auditDetail"> & { auditDetail: AuditCheckItem[] } {
  const completeFields = checks.filter((c) => c.status === "complete").map((c) => c.label);
  const missingFields = checks.filter((c) => c.status === "missing").map((c) => c.label);
  const mismatchFields = checks.filter((c) => c.status === "mismatch").map((c) => c.label);
  const unclearFields = checks.filter((c) => c.status === "unclear").map((c) => c.label);

  let auditStatus: AuditResult["auditStatus"] = "passed";
  if (missingFields.length > 0 || mismatchFields.length > 0) {
    auditStatus = missingFields.length >= 4 ? "failed" : "incomplete";
  }

  return {
    completeFields,
    missingFields,
    mismatchFields,
    unclearFields,
    auditDetail: checks,
    recommendation: narrative.recommendation,
    nextAction: narrative.nextAction,
    auditStatus,
  };
}
