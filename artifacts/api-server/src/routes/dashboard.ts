import { Router, type IRouter } from "express";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  try {
    const [tasksRow] = await supabaseQuery<{
      total: string;
      open: string;
      completed: string;
      urgent: string;
    }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE payment_status::text != 'paid')::text AS open,
              COUNT(*) FILTER (WHERE payment_status::text = 'paid')::text AS completed,
              COUNT(*) FILTER (WHERE payment_status::text = 'overdue')::text AS urgent
       FROM sales_documents`,
    );

    const [msgRow] = await supabaseQuery<{ total: string; pending: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE is_read IS NULL OR is_read = false)::text AS pending
       FROM wa_incoming_messages`,
    );

    const [docRow] = await supabaseQuery<{ total: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM sales_documents) +
         (SELECT COUNT(*) FROM purchase_documents)
       )::text AS total`,
    );

    const [teamRow] = await supabaseQuery<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM users WHERE is_active IS NOT FALSE`,
    );

    const [aiRow] = await supabaseQuery<{ total: string; active: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE payment_status::text NOT IN ('paid','cancelled'))::text AS active
       FROM sales_documents WHERE ai_generated = true`,
    );

    res.json({
      totalTasks: Number(tasksRow.total),
      openTasks: Number(tasksRow.open),
      completedTasks: Number(tasksRow.completed),
      urgentTasks: Number(tasksRow.urgent),
      totalMessages: Number(msgRow.total),
      pendingMessages: Number(msgRow.pending),
      totalDocuments: Number(docRow.total),
      auditedDocuments: 0,
      teamSize: Number(teamRow.total),
      totalAiTasks: Number(aiRow.total),
      activeAiTasks: Number(aiRow.active),
    });
  } catch (err) {
    logger.error({ err }, "GET /dashboard/stats failed");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  try {
    const rows = await supabaseQuery<{
      id: number;
      kind: string;
      description: string;
      created_at: Date;
    }>(
      `SELECT id, 'message_received'::text AS kind,
              ('WhatsApp dari ' || COALESCE(sender_name, sender)) AS description,
              COALESCE(received_at, created_at) AS created_at
       FROM wa_incoming_messages
       WHERE COALESCE(received_at, created_at) IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
    );
    const rows2 = await supabaseQuery<{
      id: number;
      kind: string;
      description: string;
      created_at: Date;
    }>(
      `SELECT id, 'task_created'::text AS kind,
              ('Sales doc ' || COALESCE(doc_number, id::text) || ' — ' || COALESCE(customer_name, '?')) AS description,
              created_at
       FROM sales_documents
       WHERE created_at IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
    );
    const combined = [...rows, ...rows2]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 20)
      .map((r, i) => ({
        id: i + 1,
        type: r.kind,
        description: r.description,
        entityId: r.id,
        createdAt: new Date(r.created_at).toISOString(),
      }));
    res.json(combined);
  } catch (err) {
    logger.error({ err }, "GET /dashboard/activity failed");
    res.status(500).json({ error: "Failed to load activity" });
  }
});

export default router;
