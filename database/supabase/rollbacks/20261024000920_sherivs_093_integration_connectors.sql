-- Rollback SHERIVS-093: remove the three connector manifests (and their integrations, cascading their
-- jobs/runs/maps; core rows they wrote stay), drop integration_set_config, restore the SHERIVS-090 claim function.
BEGIN;
DELETE FROM public.integrations WHERE connector_key IN ('fedena','moodle','oneroster');
DELETE FROM public.connector_manifests WHERE key IN ('fedena','moodle','oneroster');
DROP FUNCTION IF EXISTS public.integration_set_config(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.integration_claim_due_jobs(p_limit integer DEFAULT 50)
RETURNS SETOF public.sync_jobs LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.sync_jobs j SET next_run_at = now() + make_interval(mins => j.interval_minutes)
   WHERE j.id IN (SELECT j2.id FROM public.sync_jobs j2 JOIN public.integrations i ON i.id = j2.integration_id
                   WHERE j2.enabled AND j2.next_run_at <= now() AND i.status = 'active'
                   ORDER BY j2.next_run_at LIMIT least(p_limit, 500) FOR UPDATE OF j2 SKIP LOCKED)
  RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.integration_claim_due_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_claim_due_jobs(integer) TO service_role;
COMMIT;
