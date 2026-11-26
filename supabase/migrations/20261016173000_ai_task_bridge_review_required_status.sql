-- Preserve AI Core manual-review state in the passive AI Task ledger.
-- This widens an existing check constraint only; no rows are deleted or reassigned.
DO $$
DECLARE
  status_constraint text;
BEGIN
  SELECT c.conname INTO status_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'ai_task_bridge'
    AND t.relname = 'jobs'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LIMIT 1;

  IF status_constraint IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'ai_task_bridge'
      AND t.relname = 'jobs'
      AND c.conname = status_constraint
      AND pg_get_constraintdef(c.oid) LIKE '%REVIEW_REQUIRED%'
  ) THEN
    EXECUTE format('ALTER TABLE ai_task_bridge.jobs DROP CONSTRAINT %I', status_constraint);
    status_constraint := NULL;
  END IF;

  IF status_constraint IS NULL THEN
    ALTER TABLE ai_task_bridge.jobs
      ADD CONSTRAINT jobs_status_check CHECK (status IN (
        'QUEUED', 'WAITING_FOR_WORKER', 'RUNNING', 'SUSPECTED_STALL',
        'REVIEW_REQUIRED', 'BLOCKED', 'FAILED', 'WAITING_FOR_ACK', 'COMPLETED'
      )) NOT VALID;
    ALTER TABLE ai_task_bridge.jobs VALIDATE CONSTRAINT jobs_status_check;
  END IF;
END $$;
