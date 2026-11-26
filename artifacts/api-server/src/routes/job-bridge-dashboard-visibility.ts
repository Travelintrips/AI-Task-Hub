import { type Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { safeUuid } from "../lib/job-bridge-validation";

/** Dashboard visibility only. This never cancels jobs or commands. */
export function attachBridgeDashboardVisibilityRoutes(router: Router): void {
  router.post("/bridge/admin/hide-dashboard-items", requireAuth, requireRole("super_admin"),
    async (req: Request, res: Response): Promise<void> => {
      const jobInput: unknown = req.body?.jobIds;
      const taskInput: unknown = req.body?.taskIds;
      if (!Array.isArray(jobInput) || !Array.isArray(taskInput)) {
        res.status(400).json({ error: "Daftar pekerjaan tidak valid" }); return;
      }
      const jobIds = jobInput as unknown[];
      const taskIds = taskInput as unknown[];
      if (jobIds.length + taskIds.length < 1 || jobIds.length + taskIds.length > 100 ||
          jobIds.some(id => typeof id !== "string" || !safeUuid(id)) ||
          taskIds.some(id => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) ||
          new Set(jobIds).size !== jobIds.length || new Set(taskIds).size !== taskIds.length) {
        res.status(400).json({ error: "Pilih maksimal 100 pekerjaan dengan ID unik dan valid" }); return;
      }
      const client = await pool.connect().catch(() => null);
      if (!client) { res.status(503).json({ error: "Dashboard sedang tidak tersedia" }); return; }
      try {
        await client.query("BEGIN");
        if (jobIds.length) {
          const locked = await client.query(
            "SELECT id,status FROM ai_task_bridge.jobs WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [jobIds],
          );
          if (locked.rowCount !== jobIds.length ||
              locked.rows.some(row => !["COMPLETED", "FAILED"].includes(row.status))) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: "Job QUEUED/RUNNING masih terkait eksekusi; hanya COMPLETED/FAILED yang dapat diarsipkan" });
            return;
          }
          const active = await client.query(
            "SELECT 1 FROM ai_task_bridge.sessions WHERE job_id=ANY($1::uuid[]) " +
            "AND last_seen_at > now()-interval '5 minutes' LIMIT 1",
            [jobIds],
          );
          if (active.rowCount) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: "Job memiliki sesi aktif dan tidak bisa diarsipkan" }); return;
          }
        }
        if (taskIds.length) {
          const locked = await client.query(
            "SELECT id,status,assigned_to,assigned_to_id,company_id FROM public.ai_tasks " +
            "WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [taskIds],
          );
          if (locked.rowCount !== taskIds.length || locked.rows.some(t =>
            t.status !== "new_inquiry" || t.assigned_to !== null || t.assigned_to_id !== null)) {
            await client.query("ROLLBACK");
            res.status(409).json({
              error: "Hanya AI Tasks new_inquiry yang belum ditugaskan bisa disembunyikan. Muat ulang untuk status terbaru.",
            }); return;
          }
        }
        let archivedJobs = 0;
        if (jobIds.length) {
          const written = await client.query(
            "INSERT INTO ai_task_bridge.job_events(job_id,event_id,kind,sender,payload) " +
            "SELECT id,'dashboard-archived:'||id::text,'DASHBOARD_ARCHIVED',$2, " +
            "jsonb_build_object('reason','user_cleanup','preserve_history',true) " +
            "FROM ai_task_bridge.jobs WHERE id=ANY($1::uuid[]) " +
            "ON CONFLICT (event_id) DO NOTHING RETURNING job_id",
            [jobIds, "admin:" + String(req.user?.id ?? "")],
          );
          archivedJobs = written.rowCount ?? 0;
        }
        let hiddenTasks = 0;
        if (taskIds.length) {
          const written = await client.query(
            "INSERT INTO public.audit_logs " +
            "(user_id,user_email,action,entity_type,entity_id,company_id,module,before_data,after_data) " +
            "SELECT $2::int,$3,'dashboard_hidden','ai_task',t.id::text,t.company_id, " +
            "'dashboard',jsonb_build_object('status',t.status), " +
            "jsonb_build_object('visibility','hidden','preserve_task',true) " +
            "FROM public.ai_tasks t WHERE t.id=ANY($1::int[]) " +
            "AND NOT EXISTS (SELECT 1 FROM public.audit_logs a " +
            "WHERE a.action='dashboard_hidden' AND a.entity_type='ai_task' AND a.entity_id=t.id::text) " +
            "RETURNING id",
            [taskIds, req.user?.id, req.user?.email ?? null],
          );
          hiddenTasks = written.rowCount ?? 0;
        }
        await client.query("COMMIT");
        res.json({
          accepted: true, archivedJobs, hiddenTasks,
          message: (archivedJobs + hiddenTasks) + " pekerjaan disembunyikan dari Dashboard. Tugas, command, dan ACK tetap tersimpan.",
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error("Dashboard visibility update failed", err instanceof Error ? err.name : "unknown");
        res.status(503).json({ error: "Tidak dapat memperbarui Dashboard" });
      } finally { client.release(); }
    });
}
