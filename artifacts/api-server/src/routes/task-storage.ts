import { Router, type Request, type Response } from "express";
import { gzipSync } from "node:zlib";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";
import { supabaseQueryStrict } from "../lib/supabase-db";

const router = Router();
const guard = [requireAuth, requireRole("supervisor")] as const;
const allowed = new Set(["archive", "trash", "active"]);

router.get("/ai-tasks/storage", ...guard, async (req: Request, res: Response) => {
  try {
    const company = getCompanyId(req);
    const rows = await supabaseQueryStrict<{task_id:number;location:string;updated_at:string;snapshot_original_bytes:number|null;snapshot_compressed_bytes:number|null}>(
      "SELECT task_id, location, updated_at, snapshot_original_bytes, snapshot_compressed_bytes FROM public.ai_task_storage_state WHERE ($1::text IS NULL OR company_id = $1) ORDER BY updated_at DESC LIMIT 2000",
      [company],
    );
    res.json(rows);
  } catch {
    res.status(503).json({error:"Arsip tidak tersedia. Status job belum diubah."});
  }
});

router.post("/ai-tasks/storage", ...guard, async (req: Request, res: Response) => {
  const location = req.body?.location;
  const ids = req.body?.taskIds;
  if (!allowed.has(location) || !Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((id:unknown) => !Number.isSafeInteger(id) || Number(id) < 1)) {
    res.status(400).json({error:"Pilih 1–100 job dan lokasi yang valid."}); return;
  }
  const taskIds = [...new Set(ids as number[])];
  const company = getCompanyId(req);
  if (!company) { res.status(403).json({error:"Pilih perusahaan sebelum mengubah arsip."}); return; }
  try {
    const rows = await supabaseQueryStrict<{id:number;title:string;description:string|null;status:string;company_id:string}>(
      "SELECT id, title, description, status, company_id FROM public.ai_tasks WHERE id = ANY($1::int[]) AND company_id = $2",
      [taskIds, company],
    );
    if (rows.length !== taskIds.length) { res.status(404).json({error:"Sebagian job tidak ditemukan dalam perusahaan ini."}); return; }
    if (location !== "active") {
      const executions = await supabaseQueryStrict<{
        task_id:number; status:string; callback_verified:boolean;
        attestation_verified:boolean; final_ack_verified:boolean;
      }>(
        "SELECT DISTINCT ON (task_id) task_id,status,callback_verified,attestation_verified,final_ack_verified FROM public.ai_execution_jobs WHERE task_id = ANY($1::int[]) ORDER BY task_id,updated_at DESC",
        [taskIds],
      );
      const latest = new Map(executions.map(item => [item.task_id, item]));
      const unsafe = rows.some(row => {
        const run = latest.get(row.id);
        if (run) return run.status.toLowerCase() !== "completed" || !run.callback_verified || !run.attestation_verified || !run.final_ack_verified;
        return row.status.toLowerCase().replaceAll(" ","_") !== "completed";
      });
      if (unsafe) {
        res.status(409).json({error:"Hanya task COMPLETED atau eksekusi COMPLETED dengan callback, attestation, dan final ACK terverifikasi yang boleh dipindahkan."});
        return;
      }
    }
    if (location === "active") {
      const changed = await supabaseQueryStrict<{task_id:number}>(
        "DELETE FROM public.ai_task_storage_state WHERE task_id = ANY($1::int[]) AND company_id = $2 RETURNING task_id", [taskIds,company],
      );
      res.json({updated:changed.length,location}); return;
    }
    // Snapshot is compressed, while immutable execution and audit records remain untouched.
    for (const row of rows) {
      const json = JSON.stringify({id:row.id,title:row.title,description:row.description,status:row.status});
      const compressed = gzipSync(Buffer.from(json,"utf8"));
      await supabaseQueryStrict(
        `INSERT INTO public.ai_task_storage_state(task_id,company_id,location,archived_at,trashed_at,updated_at,actor_id,compressed_snapshot,snapshot_original_bytes,snapshot_compressed_bytes)
        VALUES($1,$2,$3,CASE WHEN $3='archive' THEN now() ELSE NULL END,CASE WHEN $3='trash' THEN now() ELSE NULL END,now(),$4,$5,$6,$7)
        ON CONFLICT(task_id) DO UPDATE SET location=EXCLUDED.location,archived_at=EXCLUDED.archived_at,trashed_at=EXCLUDED.trashed_at,updated_at=now(),actor_id=EXCLUDED.actor_id,compressed_snapshot=EXCLUDED.compressed_snapshot,snapshot_original_bytes=EXCLUDED.snapshot_original_bytes,snapshot_compressed_bytes=EXCLUDED.snapshot_compressed_bytes`,
        [row.id,company,location,String(req.user?.id ?? ""),compressed,Buffer.byteLength(json),compressed.byteLength],
      );
    }
    res.json({updated:rows.length,location});
  } catch {
    res.status(503).json({error:"Operasi arsip gagal. Data eksekusi tetap dipertahankan."});
  }
});
export default router;
