import { type Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { safeUuid, inList, bridgeSources, requiredString } from "../lib/job-bridge-validation";

const adminOnly = [requireAuth, requireRole("super_admin")];
const errorResponse = (res: Response, e: unknown): void => {
  console.error("Bridge admin cleanup failed", e instanceof Error ? e.name : "unknown");
  res.status(503).json({ error: "Cleanup temporarily unavailable" });
};

export function attachBridgeCleanupRoutes(router: Router): void {
  // Archive the dashboard presentation of terminal jobs; never destroy the
  // canonical jobs, ACK, or earlier events. All-or-nothing bulk operation.
  router.post("/bridge/admin/hide-jobs", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
    const raw: unknown = req.body?.ids;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100 ||
        raw.some(id => typeof id !== "string" || !safeUuid(id)) ||
        new Set(raw).size !== raw.length) {
      res.status(400).json({ error: "Pilih 1–100 ID job unik dan valid" }); return;
    }
    const ids = raw as string[];
    const client = await pool.connect().catch(() => null);
    if (!client) { res.status(503).json({ error: "Cleanup temporarily unavailable" }); return; }
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT id,status FROM ai_task_bridge.jobs WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      if (locked.rows.length !== ids.length ||
          locked.rows.some(row => !["COMPLETED","FAILED"].includes(row.status))) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Hanya pekerjaan COMPLETED atau FAILED yang sudah final boleh diarsipkan" }); return;
      }
      const active = await client.query(
        "SELECT 1 FROM ai_task_bridge.sessions WHERE job_id=ANY($1::uuid[]) AND last_seen_at>now()-interval '5 minutes' LIMIT 1",
        [ids],
      );
      if (active.rows.length) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Pekerjaan memiliki sesi aktif; tidak dapat diarsipkan" }); return;
      }
      const archiveEvent = await client.query(
        "INSERT INTO ai_task_bridge.job_events (job_id,event_id,kind,sender,payload) " +
        "SELECT id, 'dashboard-archived:'||id::text, 'DASHBOARD_ARCHIVED', $2, " +
        "jsonb_build_object('reason','user_cleanup','preserve_history',true) " +
        "FROM ai_task_bridge.jobs WHERE id=ANY($1::uuid[]) " +
        "ON CONFLICT (event_id) DO NOTHING RETURNING job_id",
        [ids, "admin:" + String(req.user?.id ?? "")],
      );
      await client.query("COMMIT");
      res.json({ accepted: true, selected: ids.length, hidden: archiveEvent.rowCount,
        message: "Job diarsipkan dari Dashboard; event, hasil, dan ACK tetap disimpan." });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      errorResponse(res,e);
    } finally { client.release(); }
  });

  // Physical removal is permitted ONLY for stale inactive session presence rows.
  // Session heartbeat/updates take a row lock; never delete live or linked work.
  router.post("/bridge/admin/delete-sessions", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
    const raw: unknown = req.body?.sessions;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
      res.status(400).json({ error: "Pilih 1–100 sesi" }); return;
    }
    const keys = raw.map(s => ({
      source: s && typeof s.source === "string" ? s.source : "",
      sessionId: s && typeof s.sessionId === "string" ? s.sessionId : "",
    })) as Array<{source:string;sessionId:string}>;
    if (keys.some(s => !inList(s.source,bridgeSources) || !requiredString(s.sessionId,180)) ||
        new Set(keys.map(s => s.source + "\0" + s.sessionId)).size !== keys.length) {
      res.status(400).json({ error: "Identitas sesi tidak valid atau ganda" }); return;
    }
    const client = await pool.connect().catch(() => null);
    if (!client) { res.status(503).json({ error: "Cleanup temporarily unavailable" }); return; }
    try {
      await client.query("BEGIN");
      for (const s of keys) {
        const locked = await client.query(
          "SELECT state,last_seen_at,job_id FROM ai_task_bridge.sessions " +
          "WHERE source=$1 AND session_id=$2 FOR UPDATE",
          [s.source,s.sessionId],
        );
        const row = locked.rows[0];
        if (!row || !["IDLE","DISCONNECTED","AUTH_REQUIRED"].includes(row.state) ||
            Date.now()-Date.parse(row.last_seen_at)<5*60*1000) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "Sesi masih aktif, terlalu baru, berubah, atau tidak ditemukan" }); return;
        }
        if (row.job_id) {
          const job = await client.query("SELECT status FROM ai_task_bridge.jobs WHERE id=$1", [row.job_id]);
          if (job.rows[0] && !["COMPLETED","FAILED"].includes(job.rows[0].status)) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: "Sesi terkait pekerjaan belum selesai" }); return;
          }
        }
      }
      for (const s of keys) {
        const deleted = await client.query(
          "DELETE FROM ai_task_bridge.sessions WHERE source=$1 AND session_id=$2 " +
          "AND last_seen_at<now()-interval '5 minutes'",
          [s.source,s.sessionId],
        );
        if (deleted.rowCount !== 1) {
          throw new Error("SESSION_DELETE_CONCURRENT_CHANGE");
        }
      }
      await client.query("COMMIT");
      res.json({ accepted: true, deleted: keys.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      errorResponse(res,e);
    } finally { client.release(); }
  });
}
