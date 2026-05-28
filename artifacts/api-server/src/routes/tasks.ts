import { Router, type IRouter } from "express";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface SalesRow {
  id: number;
  doc_number: string | null;
  kind: string | null;
  status: string | null;
  invoice_status: string | null;
  delivery_status: string | null;
  payment_status: string | null;
  customer_id: number | null;
  customer_name: string | null;
  total_amount: string | null;
  grand_total: string | null;
  origin: string | null;
  destination: string | null;
  transport_mode: string | null;
  etd: Date | null;
  eta: Date | null;
  expected_date: Date | null;
  notes: string | null;
  ai_generated: boolean | null;
  created_at: Date | null;
  updated_at: Date | null;
}

function mapStatus(s: string | null, paid: string | null): string {
  if (paid === "paid") return "completed";
  if (s === "draft" || s === "pending") return "pending";
  if (s === "confirmed" || s === "in_progress" || s === "shipped") return "in_progress";
  if (s === "delivered" || s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "pending";
}

function mapPriority(s: SalesRow): string {
  if (s.kind?.toLowerCase().includes("urgent")) return "urgent";
  if (s.payment_status === "overdue") return "high";
  return "medium";
}

function mapTask(r: SalesRow) {
  const created = r.created_at ?? new Date();
  const updated = r.updated_at ?? created;
  const titleParts: string[] = [];
  if (r.doc_number) titleParts.push(r.doc_number);
  if (r.origin && r.destination) titleParts.push(`${r.origin} → ${r.destination}`);
  else if (r.customer_name) titleParts.push(r.customer_name);
  const title = titleParts.join(" — ") || `Order #${r.id}`;

  const descParts: string[] = [];
  if (r.customer_name) descParts.push(`Pelanggan: ${r.customer_name}`);
  if (r.transport_mode) descParts.push(`Mode: ${r.transport_mode}`);
  if (r.grand_total) descParts.push(`Total: Rp ${Number(r.grand_total).toLocaleString("id-ID")}`);
  if (r.notes) descParts.push(r.notes);

  const tags: string[] = [];
  if (r.kind) tags.push(r.kind);
  if (r.ai_generated) tags.push("ai-generated");
  if (r.transport_mode) tags.push(r.transport_mode);

  return {
    id: r.id,
    title,
    description: descParts.join("\n") || null,
    status: mapStatus(r.delivery_status ?? r.status, r.payment_status),
    priority: mapPriority(r),
    assigneeId: null as number | null,
    assigneeName: null as string | null,
    customerName: r.customer_name ?? null,
    assignedRole: null,
    assignedDivision: null,
    assignedVendor: null,
    sourceMessageId: null,
    tags,
    dueDate: (r.eta ?? r.expected_date)?.toISOString() ?? null,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
  };
}

router.get("/tasks", async (req, res): Promise<void> => {
  try {
    const { status } = req.query as Record<string, string | undefined>;
    const rows = await supabaseQuery<SalesRow>(
      `SELECT id, doc_number, kind, status, invoice_status, delivery_status, payment_status,
              customer_id, customer_name, total_amount, grand_total,
              origin, destination, transport_mode, etd, eta, expected_date,
              notes, ai_generated, created_at, updated_at
       FROM sales_documents
       ORDER BY created_at DESC NULLS LAST
       LIMIT 300`,
    );
    let mapped = rows.map(mapTask);
    if (status) mapped = mapped.filter((t) => t.status === status);
    res.json(mapped);
  } catch (err) {
    logger.error({ err }, "GET /tasks failed");
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await supabaseQuery<SalesRow>(
      `SELECT id, doc_number, kind, status, invoice_status, delivery_status, payment_status,
              customer_id, customer_name, total_amount, grand_total,
              origin, destination, transport_mode, etd, eta, expected_date,
              notes, ai_generated, created_at, updated_at
       FROM sales_documents WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(mapTask(rows[0]));
  } catch (err) {
    logger.error({ err }, "GET /tasks/:id failed");
    res.status(500).json({ error: "Failed to load task" });
  }
});

router.post("/tasks", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode: tasks are sourced from Supabase sales_documents" });
});
router.patch("/tasks/:id", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.delete("/tasks/:id", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.patch("/tasks/:id/assign", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.post("/tasks/:id/ai-summary", (_req, res): void => {
  res.status(501).json({ error: "AI summary not available in read-only mode" });
});

export default router;
