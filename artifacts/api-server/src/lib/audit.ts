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
  crossDocDetail: AuditCheckItem[];
  crossDocWarnings: string[];
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

// ─── Cross-Document Validation ────────────────────────────────────────────────

function normalizeNum(v: string): string {
  return v.replace(/[,\s]/g, "").toLowerCase();
}

function normText(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(normText(a).split(" ").filter((w) => w.length > 3));
  const wordsB = normText(b).split(" ").filter((w) => w.length > 3);
  if (wordsA.size === 0 && wordsB.length === 0) return 1;
  const overlap = wordsB.filter((w) => wordsA.has(w)).length;
  const minLen = Math.min(wordsA.size, wordsB.length);
  return minLen > 0 ? overlap / minLen : 0;
}

function namesMatch(a: string, b: string): boolean {
  const na = normText(a);
  const nb = normText(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function runCrossDocumentValidation(attachments: TaskAttachment[]): AuditCheckItem[] {
  const invoices = attachments.filter((a) => a.documentType === "Commercial Invoice");
  const packingLists = attachments.filter((a) => a.documentType === "Packing List");

  if (invoices.length === 0 || packingLists.length === 0) return [];

  const inv = getExtracted(invoices[0]);
  const pl = getExtracted(packingLists[0]);

  const checks: AuditCheckItem[] = [];

  // ── 1. Item description similarity ──────────────────────────────────────────
  const invDesc = (inv["item_description"] ?? "").trim();
  const plDesc = (pl["item_description"] ?? "").trim();
  if (invDesc && plDesc) {
    const sim = textSimilarity(invDesc, plDesc);
    if (sim < 0.3) {
      checks.push({
        key: "cross_item_description",
        label: "Item Description (Invoice vs PL)",
        status: "mismatch",
        values: [invDesc, plDesc],
        note: `Descriptions differ — Invoice: "${invDesc.slice(0, 60)}" · PL: "${plDesc.slice(0, 60)}"`,
      });
    } else {
      checks.push({
        key: "cross_item_description",
        label: "Item Description (Invoice vs PL)",
        status: "complete",
        values: [invDesc],
      });
    }
  } else {
    const missing = !invDesc ? "Commercial Invoice" : "Packing List";
    checks.push({
      key: "cross_item_description",
      label: "Item Description (Invoice vs PL)",
      status: "missing",
      values: [],
      note: `Item description not found in ${missing}`,
    });
  }

  // ── 2. Quantity match ────────────────────────────────────────────────────────
  const invQty = (inv["quantity"] ?? "").trim();
  const plQty = (pl["quantity"] ?? "").trim();
  if (invQty && plQty) {
    if (normalizeNum(invQty) !== normalizeNum(plQty)) {
      checks.push({
        key: "cross_quantity",
        label: "Quantity (Invoice vs PL)",
        status: "mismatch",
        values: [invQty, plQty],
        note: `Invoice: ${invQty} · Packing List: ${plQty}`,
      });
    } else {
      checks.push({
        key: "cross_quantity",
        label: "Quantity (Invoice vs PL)",
        status: "complete",
        values: [invQty],
      });
    }
  } else if (invQty || plQty) {
    const src = invQty ? "Invoice" : "Packing List";
    checks.push({
      key: "cross_quantity",
      label: "Quantity (Invoice vs PL)",
      status: "unclear",
      values: [invQty || plQty],
      note: `Quantity only found in ${src}; cannot verify match`,
    });
  } else {
    checks.push({
      key: "cross_quantity",
      label: "Quantity (Invoice vs PL)",
      status: "missing",
      values: [],
    });
  }

  // ── 3. Gross weight in Packing List ─────────────────────────────────────────
  const plWeight = (pl["gross_weight"] ?? "").trim();
  const invWeight = (inv["gross_weight"] ?? "").trim();
  if (plWeight) {
    checks.push({
      key: "cross_gross_weight",
      label: "Gross Weight (in Packing List)",
      status: "complete",
      values: [plWeight],
    });
  } else if (invWeight) {
    checks.push({
      key: "cross_gross_weight",
      label: "Gross Weight (in Packing List)",
      status: "mismatch",
      values: [invWeight],
      note: "Gross weight found in Invoice but absent from Packing List",
    });
  } else {
    checks.push({
      key: "cross_gross_weight",
      label: "Gross Weight (in Packing List)",
      status: "missing",
      values: [],
    });
  }

  // ── 4. Package count match ───────────────────────────────────────────────────
  const invPkg = (inv["package_count"] ?? "").trim();
  const plPkg = (pl["package_count"] ?? "").trim();
  if (invPkg && plPkg) {
    if (normalizeNum(invPkg) !== normalizeNum(plPkg)) {
      checks.push({
        key: "cross_package_count",
        label: "Package Count (Invoice vs PL)",
        status: "mismatch",
        values: [invPkg, plPkg],
        note: `Invoice: ${invPkg} · Packing List: ${plPkg}`,
      });
    } else {
      checks.push({
        key: "cross_package_count",
        label: "Package Count (Invoice vs PL)",
        status: "complete",
        values: [invPkg],
      });
    }
  } else if (invPkg || plPkg) {
    const src = invPkg ? "Invoice" : "Packing List";
    checks.push({
      key: "cross_package_count",
      label: "Package Count (Invoice vs PL)",
      status: "unclear",
      values: [invPkg || plPkg],
      note: `Package count only found in ${src}`,
    });
  } else {
    checks.push({
      key: "cross_package_count",
      label: "Package Count (Invoice vs PL)",
      status: "missing",
      values: [],
    });
  }

  // ── 5. Supplier name match ───────────────────────────────────────────────────
  const invSupplier = (inv["supplier_name"] ?? "").trim();
  const plSupplier = (pl["supplier_name"] ?? "").trim();
  if (invSupplier && plSupplier) {
    if (!namesMatch(invSupplier, plSupplier)) {
      checks.push({
        key: "cross_supplier_name",
        label: "Supplier Name (Invoice vs PL)",
        status: "mismatch",
        values: [invSupplier, plSupplier],
        note: `Invoice: "${invSupplier}" · Packing List: "${plSupplier}"`,
      });
    } else {
      checks.push({
        key: "cross_supplier_name",
        label: "Supplier Name (Invoice vs PL)",
        status: "complete",
        values: [invSupplier],
      });
    }
  } else if (invSupplier || plSupplier) {
    checks.push({
      key: "cross_supplier_name",
      label: "Supplier Name (Invoice vs PL)",
      status: "complete",
      values: [invSupplier || plSupplier],
    });
  }

  // ── 6. Consignee / Importer match ────────────────────────────────────────────
  const invImporter = (inv["importer_name"] ?? "").trim();
  const plImporter = (pl["importer_name"] ?? "").trim();
  if (invImporter && plImporter) {
    if (!namesMatch(invImporter, plImporter)) {
      checks.push({
        key: "cross_importer_name",
        label: "Consignee / Importer (Invoice vs PL)",
        status: "mismatch",
        values: [invImporter, plImporter],
        note: `Invoice: "${invImporter}" · Packing List: "${plImporter}"`,
      });
    } else {
      checks.push({
        key: "cross_importer_name",
        label: "Consignee / Importer (Invoice vs PL)",
        status: "complete",
        values: [invImporter],
      });
    }
  }

  // ── 7. Currency & total value in Invoice ─────────────────────────────────────
  const invCurrency = (inv["currency"] ?? "").trim();
  const invValue = (inv["total_value"] ?? "").trim();
  if (invCurrency && invValue) {
    checks.push({
      key: "cross_invoice_value",
      label: "Currency & Value (in Invoice)",
      status: "complete",
      values: [`${invCurrency} ${invValue}`],
    });
  } else if (invCurrency || invValue) {
    checks.push({
      key: "cross_invoice_value",
      label: "Currency & Value (in Invoice)",
      status: "unclear",
      values: [invCurrency || invValue],
      note: `${!invCurrency ? "Currency" : "Total value"} missing from Invoice`,
    });
  } else {
    checks.push({
      key: "cross_invoice_value",
      label: "Currency & Value (in Invoice)",
      status: "missing",
      values: [],
      note: "No currency or total value found in Invoice",
    });
  }

  // ── 8. HS Code present in at least one document ──────────────────────────────
  const invHs = (inv["hs_code"] ?? "").trim();
  const plHs = (pl["hs_code"] ?? "").trim();
  if (invHs && plHs) {
    if (normalizeNum(invHs) !== normalizeNum(plHs)) {
      checks.push({
        key: "cross_hs_code",
        label: "HS Code (Invoice vs PL)",
        status: "mismatch",
        values: [invHs, plHs],
        note: `Invoice: ${invHs} · Packing List: ${plHs}`,
      });
    } else {
      checks.push({
        key: "cross_hs_code",
        label: "HS Code (Invoice vs PL)",
        status: "complete",
        values: [invHs],
      });
    }
  } else if (invHs || plHs) {
    checks.push({
      key: "cross_hs_code",
      label: "HS Code (Invoice vs PL)",
      status: "complete",
      values: [invHs || plHs],
    });
  }

  return checks;
}

// ─── Narrative generation ─────────────────────────────────────────────────────

export async function generateAuditNarrative(
  checks: AuditCheckItem[],
  crossChecks: AuditCheckItem[] = [],
): Promise<{ recommendation: string; nextAction: string }> {
  const checklistSummary = checks
    .map((c) => `- ${c.label}: ${c.status.toUpperCase()}${c.values.length ? ` (${c.values.slice(0, 2).join(", ")})` : ""}${c.note ? ` — ${c.note}` : ""}`)
    .join("\n");

  const crossMismatches = crossChecks.filter((c) => c.status === "mismatch" || c.status === "missing");
  const crossSummary = crossMismatches.length > 0
    ? "\n\nCross-document validation issues:\n" +
      crossMismatches
        .map((c) => `- ${c.label}: ${c.status.toUpperCase()}${c.note ? ` — ${c.note}` : ""}`)
        .join("\n")
    : "";

  const missingCount = checks.filter((c) => c.status === "missing").length;
  const mismatchCount = [...checks, ...crossChecks].filter((c) => c.status === "mismatch").length;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an import compliance specialist. Given a document audit checklist and cross-document validation results, write:
1. A concise "recommendation" (2-3 sentences) explaining the overall import document compliance status and key concerns.
2. A specific "next_action" (1-2 sentences) — the single most important thing the team should do right now.

If there are cross-document mismatches (e.g. quantity, supplier name, or HS code differ between Invoice and Packing List), highlight them as critical issues requiring admin review before approval.

Respond ONLY with valid JSON: {"recommendation": "...", "next_action": "..."}`,
        },
        {
          role: "user",
          content: `Import document audit results:\n${checklistSummary}${crossSummary}\n\nSummary: ${missingCount} missing checklist fields, ${mismatchCount} total mismatches (including cross-document).`,
        },
      ],
      max_tokens: 350,
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
    const crossWarnings = crossMismatches.map((c) => c.label);

    const hasCrossIssues = crossWarnings.length > 0;
    return {
      recommendation:
        missingCount === 0 && mismatchCount === 0
          ? "All required import documents appear complete and consistent. Proceed to customs submission."
          : hasCrossIssues
            ? `Cross-document discrepancies detected between Invoice and Packing List: ${crossWarnings.join(", ")}. Do not approve until resolved.`
            : `Import documentation is incomplete. Missing: ${missing.join(", ")}.`,
      nextAction:
        hasCrossIssues
          ? `Resolve discrepancies in: ${crossWarnings.slice(0, 3).join(", ")} before submitting.`
          : missingCount > 0
            ? `Obtain the following missing documents: ${missing.slice(0, 3).join(", ")}.`
            : mismatchCount > 0
              ? "Resolve conflicting values across documents before submission."
              : "Verify all documents are signed and stamped, then submit to customs.",
    };
  }
}

// ─── Build final result ───────────────────────────────────────────────────────

export function buildAuditResult(
  checks: AuditCheckItem[],
  crossChecks: AuditCheckItem[],
  narrative: { recommendation: string; nextAction: string },
): Omit<AuditResult, "auditDetail" | "crossDocDetail"> & {
  auditDetail: AuditCheckItem[];
  crossDocDetail: AuditCheckItem[];
} {
  const completeFields = checks.filter((c) => c.status === "complete").map((c) => c.label);
  const missingFields = checks.filter((c) => c.status === "missing").map((c) => c.label);

  const crossMismatchLabels = crossChecks
    .filter((c) => c.status === "mismatch")
    .map((c) => c.label);

  const mismatchFields = [
    ...checks.filter((c) => c.status === "mismatch").map((c) => c.label),
    ...crossMismatchLabels,
  ];

  const unclearFields = checks.filter((c) => c.status === "unclear").map((c) => c.label);

  const crossDocWarnings: string[] = crossChecks
    .filter((c) => c.status === "mismatch")
    .map((c) => c.note ?? `Mismatch detected: ${c.label}`)
    .filter(Boolean);

  let auditStatus: AuditResult["auditStatus"] = "passed";
  const hasCrossMismatch = crossMismatchLabels.length > 0;
  if (hasCrossMismatch || missingFields.length > 0 || mismatchFields.length > 0) {
    auditStatus = (missingFields.length >= 4 || hasCrossMismatch) ? "failed" : "incomplete";
  }

  return {
    completeFields,
    missingFields,
    mismatchFields,
    unclearFields,
    auditDetail: checks,
    crossDocDetail: crossChecks,
    crossDocWarnings,
    recommendation: narrative.recommendation,
    nextAction: narrative.nextAction,
    auditStatus,
  };
}
