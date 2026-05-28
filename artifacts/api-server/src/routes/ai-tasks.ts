import { Router, type IRouter } from "express";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface AiRow {
  id: number;
  doc_number: string | null;
  kind: string | null;
  status: string | null;
  invoice_status: string | null;
  delivery_status: string | null;
  payment_status: string | null;
  customer_name: string | null;
  ai_source_wa_phone: string | null;
  origin: string | null;
  destination: string | null;
  grand_total: string | null;
  notes: string | null;
  expected_date: Date | null;
  eta: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

function statusOf(r: AiRow): string {
  if (r.payment_status === "paid") return "completed";
  if (r.delivery_status === "shipped" || r.delivery_status === "in_progress") return "in_progress";
  if (r.status === "draft" || r.status === "pending") return "pending";
  if (r.status === "cancelled") return "cancelled";
  return "pending";
}

function mapAi(r: AiRow) {
  const created = r.created_at ?? new Date();
  const updated = r.updated_at ?? created;
  const titleParts: string[] = [];
  if (r.origin && r.destination) titleParts.push(`${r.origin} → ${r.destination}`);
  if (r.customer_name) titleParts.push(r.customer_name);
  const title = titleParts.join(" · ") || r.doc_number || `AI Task #${r.id}`;

  const summary = [
    r.customer_name && `Pelanggan: ${r.customer_name}`,
    r.origin && r.destination && `Rute: ${r.origin} → ${r.destination}`,
    r.grand_total && `Nilai: Rp ${Number(r.grand_total).toLocaleString("id-ID")}`,
    r.notes,
  ].filter(Boolean).join(" · ");

  return {
    id: r.id,
    taskNumber: r.doc_number ?? `AI-${r.id}`,
    title,
    description: r.notes ?? null,
    customerName: r.customer_name ?? null,
    customerPhone: r.ai_source_wa_phone ?? null,
    status: statusOf(r),
    priority: r.payment_status === "overdue" ? "high" : "medium",
    category: r.kind ?? "sales_order",
    division: null as string | null,
    assignedTo: null as string | null,
    assignedRole: null as string | null,
    assignedDivision: null as string | null,
    assignedVendor: null as string | null,
    aiSummary: summary || null,
    requiredAction: null as string | null,
    adminNotes: null as string | null,
    driverName: null as string | null,
    driverPhone: null as string | null,
    plateNumber: null as string | null,
    quotationAmount: r.grand_total ? Number(r.grand_total) : null,
    quotationNotes: null as string | null,
    companyId: null as string | null,
    dueDate: (r.eta ?? r.expected_date)?.toISOString() ?? null,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
    auditStatus: null as string | null,
    latestMessage: null as string | null,
  };
}

router.get("/ai-tasks", async (req, res): Promise<void> => {
  try {
    const { status, priority, search } = req.query as Record<string, string | undefined>;
    const rows = await supabaseQuery<AiRow>(
      `SELECT id, doc_number, kind, status::text AS status, invoice_status::text AS invoice_status,
              delivery_status::text AS delivery_status, payment_status::text AS payment_status,
              customer_name, ai_source_wa_phone, origin, destination, grand_total, notes,
              expected_date, eta, created_at, updated_at
       FROM sales_documents
       WHERE ai_generated = true
       ORDER BY created_at DESC NULLS LAST
       LIMIT 300`,
    );
    let mapped = rows.map(mapAi);
    if (status) mapped = mapped.filter((t) => t.status === status);
    if (priority) mapped = mapped.filter((t) => t.priority === priority);
    if (search) {
      const q = search.toLowerCase();
      mapped = mapped.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.taskNumber ?? "").toLowerCase().includes(q) ||
          (t.aiSummary ?? "").toLowerCase().includes(q),
      );
    }
    res.json(mapped);
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks failed");
    res.status(500).json({ error: "Failed to load AI tasks" });
  }
});

router.get("/ai-tasks/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await supabaseQuery<AiRow>(
      `SELECT id, doc_number, kind, status::text AS status, invoice_status::text AS invoice_status,
              delivery_status::text AS delivery_status, payment_status::text AS payment_status,
              customer_name, ai_source_wa_phone, origin, destination, grand_total, notes,
              expected_date, eta, created_at, updated_at
       FROM sales_documents WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "AI task not found" });
      return;
    }
    res.json({ ...mapAi(rows[0]), comments: [] });
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id failed");
    res.status(500).json({ error: "Failed to load AI task" });
  }
});

router.patch("/ai-tasks/:id", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.post("/ai-tasks/:id/comments", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.get("/ai-tasks/:id/attachments", (_req, res): void => {
  res.json([]);
});
router.post("/ai-tasks/:id/attachments", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.get("/ai-tasks/:id/audit", (_req, res): void => {
  res.status(404).json({ error: "No audit" });
});
router.post("/ai-tasks/:id/audit", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.get("/ai-tasks/:id/timeline", (_req, res): void => {
  res.json([]);
});
router.post("/ai-tasks/:id/generate-token", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.delete("/ai-tasks/:id/attachments/:attachmentId", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});

export default router;
