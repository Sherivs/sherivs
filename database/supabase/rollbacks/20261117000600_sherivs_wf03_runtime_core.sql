-- Rollback for 20261117000600_sherivs_wf03_runtime_core.sql (WF-03, ADR-105).
-- Restore the WF-01 step claim behavior and remove only WF-03 objects.
BEGIN;

DROP TRIGGER IF EXISTS wf_step_run_05_autonomy ON public.wf_step_run;
DROP TRIGGER IF EXISTS wf_org_settings_90_audit ON public.wf_org_settings;
DROP TRIGGER IF EXISTS wf_agent_autonomy_90_audit ON public.wf_agent_autonomy;
DROP FUNCTION IF EXISTS public.wf_autonomy_guard();
DROP FUNCTION IF EXISTS public.wf_runtime_settings_audit();
DROP FUNCTION IF EXISTS public.wf_claim_due_events(text, integer, integer);
DROP FUNCTION IF EXISTS public.wf_create_event_run(uuid, uuid, text, uuid, uuid, text, timestamptz,
  timestamptz, integer, integer, text, text, text, integer, integer, integer, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.wf_persist_step_transition(uuid, text, integer, text, timestamptz, text, text,
  timestamptz, jsonb, text, integer, text, text, integer, text, integer, integer);

DROP TABLE IF EXISTS public.wf_agent_autonomy CASCADE;
DROP TABLE IF EXISTS public.wf_org_settings CASCADE;

ALTER TABLE public.wf_step_run
  DROP COLUMN IF EXISTS spent_units,
  DROP COLUMN IF EXISTS budget_units,
  DROP COLUMN IF EXISTS action_class,
  DROP COLUMN IF EXISTS autonomy_level,
  DROP COLUMN IF EXISTS agent_ref;
ALTER TABLE public.wf_run
  DROP COLUMN IF EXISTS agent_ref,
  DROP COLUMN IF EXISTS template_id;
ALTER TABLE public.wf_template
  DROP COLUMN IF EXISTS changelog,
  DROP COLUMN IF EXISTS eval_suite,
  DROP COLUMN IF EXISTS lawful_basis,
  DROP COLUMN IF EXISTS data_classes,
  DROP COLUMN IF EXISTS org_types,
  DROP COLUMN IF EXISTS risk_tier,
  DROP COLUMN IF EXISTS release,
  DROP COLUMN IF EXISTS autonomy_max,
  DROP COLUMN IF EXISTS agent_ref;

CREATE OR REPLACE FUNCTION public.wf_claim_due_steps(
  p_worker text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.wf_step_run
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
        v_lease integer := least(greatest(coalesce(p_lease_seconds, 60), 5), 900);
BEGIN
  IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'wf_claim_due_steps: worker id is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wf_step_run s
     SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, finished_at = now(),
         error_code = coalesce(s.error_code, 'lease.expired')
   WHERE s.id IN (SELECT x.id FROM public.wf_step_run x
                   WHERE x.status IN ('claimed', 'running') AND x.lease_expires_at <= now()
                     AND x.attempt >= x.max_attempts
                   ORDER BY x.lease_expires_at
                   LIMIT v_limit
                   FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  WITH due_pending AS (
    SELECT x.id FROM public.wf_step_run x
     WHERE x.status = 'pending' AND x.next_attempt_at <= now() AND x.attempt < x.max_attempts
     ORDER BY x.next_attempt_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), due_expired AS (
    SELECT x.id FROM public.wf_step_run x
     WHERE x.status IN ('claimed', 'running') AND x.lease_expires_at <= now() AND x.attempt < x.max_attempts
     ORDER BY x.lease_expires_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), picked AS (
    SELECT id FROM (SELECT id FROM due_pending UNION SELECT id FROM due_expired) u LIMIT v_limit
  )
  UPDATE public.wf_step_run s
     SET status = 'claimed', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease),
         attempt = s.attempt + 1,
         started_at = coalesce(s.started_at, now())
    FROM picked
   WHERE s.id = picked.id
  RETURNING s.*;
END
$$;

REVOKE ALL ON FUNCTION public.wf_claim_due_steps(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_claim_due_steps(text, integer, integer) TO service_role;
COMMENT ON FUNCTION public.wf_claim_due_steps(text, integer, integer) IS
  'WF-01 / ADR-103: SKIP LOCKED claim of due steps, service role only.';

DO $verify$
BEGIN
  IF to_regclass('public.wf_org_settings') IS NOT NULL
     OR to_regclass('public.wf_agent_autonomy') IS NOT NULL
     OR to_regprocedure('public.wf_claim_due_events(text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.wf_autonomy_guard()') IS NOT NULL
     OR to_regprocedure('public.wf_runtime_settings_audit()') IS NOT NULL
     OR to_regprocedure('public.wf_create_event_run(uuid,uuid,text,uuid,uuid,text,timestamptz,timestamptz,integer,integer,text,text,text,integer,integer,integer,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.wf_persist_step_transition(uuid,text,integer,text,timestamptz,text,text,timestamptz,jsonb,text,integer,text,text,integer,text,integer,integer)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'wf_template' AND column_name IN (
                 'agent_ref', 'autonomy_max', 'release', 'risk_tier', 'org_types',
                 'data_classes', 'lawful_basis', 'eval_suite', 'changelog'))
            OR (table_name = 'wf_run' AND column_name IN ('template_id', 'agent_ref'))
            OR (table_name = 'wf_step_run' AND column_name IN (
                 'agent_ref', 'autonomy_level', 'action_class', 'budget_units', 'spent_units')))
     ) THEN
    RAISE EXCEPTION 'WF-03 rollback: runtime objects or columns remain';
  END IF;
  IF to_regclass('public.audit_chain') IS NULL THEN
    RAISE EXCEPTION 'WF-03 rollback: audit_chain must remain intact';
  END IF;
END
$verify$;

COMMIT;
