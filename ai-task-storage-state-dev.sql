-- Reversible job archive/trash; no deletion of execution/audit evidence.
CREATE TABLE IF NOT EXISTS public.ai_task_storage_state (
 task_id integer PRIMARY KEY REFERENCES public.ai_tasks(id) ON DELETE RESTRICT,
 company_id text NOT NULL,
 location text NOT NULL CHECK (location IN ('archive','trash')),
 archived_at timestamptz,
 trashed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 actor_id text,
 compressed_snapshot bytea,
 snapshot_original_bytes integer,
 snapshot_compressed_bytes integer
);
CREATE INDEX IF NOT EXISTS ai_task_storage_state_company_location_idx ON public.ai_task_storage_state(company_id, location);
ALTER TABLE public.ai_task_storage_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_task_storage_state FROM anon, authenticated;
