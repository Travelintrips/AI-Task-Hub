import { Router, type IRouter } from "express";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface DocRow {
  id: number;
  doc_number: string | null;
  status: string | null;
  total_amount: string | null;
  grand_total: string | null;
  party_name: string | null;
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  doc_kind: "sales" | "purchase";
}

const OFFSET_PURCHASE = 1_000_000;

function mapDoc(r: DocRow) {
  const created = r.created_at ?? new Date();
  const updated = r.updated_at ?? created;
  const idOut = r.doc_kind === "purchase" ? r.id + OFFSET_PURCHASE : r.id;
  const filename =
    (r.doc_number ?? `${r.doc_kind === "purchase" ? "PO" : "SO"}-${r.id}`) +
    (r.doc_kind === "purchase" ? " (Purchase)" : " (Sales)");

  const summaryParts: string[] = [];
  if (r.party_name) summaryParts.push(r.doc_kind === "purchase" ? `Supplier: ${r.party_name}` : `Customer: ${r.party_name}`);
  if (r.grand_total) summaryParts.push(`Total: Rp ${Number(r.grand_total).toLocaleString("id-ID")}`);
  if (r.notes) summaryParts.push(r.notes);

  return {
    id: idOut,
    filename,
    fileUrl: null as string | null,
    status: "pending",
    auditScore: null as number | null,
    auditSummary: summaryParts.join("\n") || null,
    auditIssues: [] as string[],
    taskId: null as number | null,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
  };
}

router.get("/documents", async (_req, res): Promise<void> => {
  try {
    const rows = await supabaseQuery<DocRow>(
      `SELECT id, doc_number, status::text AS status,
              total_amount, grand_total, customer_name AS party_name,
              notes, created_at, updated_at, 'sales' AS doc_kind
       FROM sales_documents
       UNION ALL
       SELECT id, doc_number, status::text AS status,
              total_amount, grand_total, supplier_name AS party_name,
              notes, created_at, updated_at, 'purchase' AS doc_kind
       FROM purchase_documents
       ORDER BY created_at DESC NULLS LAST
       LIMIT 300`,
    );
    res.json(rows.map(mapDoc));
  } catch (err) {
    logger.error({ err }, "GET /documents failed");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const isPurchase = id >= OFFSET_PURCHASE;
    const realId = isPurchase ? id - OFFSET_PURCHASE : id;
    const sql = isPurchase
      ? `SELECT id, doc_number, status::text AS status, total_amount, grand_total,
                supplier_name AS party_name, notes, created_at, updated_at,
                'purchase'::text AS doc_kind
         FROM purchase_documents WHERE id = $1 LIMIT 1`
      : `SELECT id, doc_number, status::text AS status, total_amount, grand_total,
                customer_name AS party_name, notes, created_at, updated_at,
                'sales'::text AS doc_kind
         FROM sales_documents WHERE id = $1 LIMIT 1`;
    const rows = await supabaseQuery<DocRow>(sql, [realId]);
    if (!rows[0]) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(mapDoc(rows[0]));
  } catch (err) {
    logger.error({ err }, "GET /documents/:id failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

router.post("/documents/upload-url", (_req, res): void => {
  res.status(501).json({ error: "Document upload not available in read-only mode" });
});
router.post("/documents", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.delete("/documents/:id", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.post("/documents/:id/audit", (_req, res): void => {
  res.status(501).json({ error: "AI audit not available in read-only mode" });
});

export default router;
