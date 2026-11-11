-- DEV candidate: apply only to the verified CST-DEV database.
-- Durable once-per-day maintenance alert claim. No automatic replay on uncertain sends.
CREATE TABLE IF NOT EXISTS public.fleet_maintenance_alert_claims (
 company_id text NOT NULL,
 job_name text NOT NULL,
 run_date date NOT NULL,
 status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','no_alert','sent','review_required')),
 overdue_count integer,
 upcoming_count integer,
 claimed_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CONSTRAINT fleet_maintenance_alert_claims_pk PRIMARY KEY(company_id,job_name,run_date)
);
ALTER TABLE public.fleet_maintenance_alert_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fleet_maintenance_alert_claims FROM PUBLIC, anon, authenticated;
-- Grant dedicated API database runtime role separately after verifying its exact identity.
