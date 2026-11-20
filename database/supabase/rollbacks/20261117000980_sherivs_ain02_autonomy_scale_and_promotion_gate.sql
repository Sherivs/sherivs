-- NOT APPLIED. Rollback for 20261117000980 (AIN-02 autonomy scale and promotion gate, ADR-126).
-- Removes the gate, the evidence and ledger tables, the reference tables and every AIN-02 function and trigger, puts the
-- WF-06 step guard back (SECURITY INVOKER, the inline ladder) and gives the service role back the WF-03 right to
-- write wf_agent_autonomy. It refuses to run while the ledger or the evidence table holds a row: those are recorded
-- decisions (the audit chain keeps its copy either way). Export and remove them deliberately first.
-- wf_agent_autonomy rows are not touched: every earned level stays as it is.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_autonomy_scale') IS NULL
     OR to_regclass('public.wf_autonomy_evidence') IS NULL
     OR to_regclass('public.wf_autonomy_change') IS NULL
     OR to_regprocedure('public.wf_autonomy_promote(uuid,uuid,text,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AIN-02 rollback: one or more AIN-02 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_autonomy_change) OR EXISTS (SELECT 1 FROM public.wf_autonomy_evidence) THEN
    RAISE EXCEPTION 'AIN-02 rollback: autonomy history exists; export it and remove it deliberately first';
  END IF;
END
$prereq$;

DROP TRIGGER wf_run_08_freeze_actor ON public.wf_run;
DROP FUNCTION public.wf_run_freeze_actor();
DROP TRIGGER wf_action_sandbox_outbox_90_autonomy ON public.wf_action_sandbox_outbox;
DROP FUNCTION public.wf_action_sandbox_outbox_autonomy_guard();
DROP TRIGGER wf_agent_autonomy_05_gate ON public.wf_agent_autonomy;

-- The WF-06 step guard, restored exactly.
CREATE OR REPLACE FUNCTION public.wf_autonomy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_run public.wf_run%ROWTYPE;
  v_template_level text := 'suggest';
  v_tenant_level text := 'draft';
  v_agent_level text := 'suggest';
  v_agent_ref text;
  v_template_agent_ref text;
  v_rank integer;
BEGIN
  SELECT * INTO v_run FROM public.wf_run
   WHERE org_id = NEW.org_id AND id = NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wf_step_run: run scope is missing' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.agent_ref IS DISTINCT FROM OLD.agent_ref THEN
    RAISE EXCEPTION 'wf_step_run: agent identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF v_run.agent_ref IS NOT NULL AND NEW.agent_ref IS NOT NULL
     AND v_run.agent_ref IS DISTINCT FROM NEW.agent_ref THEN
    RAISE EXCEPTION 'wf_step_run: agent does not match run' USING ERRCODE = '42501';
  END IF;
  v_agent_ref := coalesce(v_run.agent_ref, NEW.agent_ref);

  IF v_run.template_id IS NOT NULL THEN
    SELECT t.autonomy_max, t.agent_ref INTO v_template_level, v_template_agent_ref
      FROM public.wf_template t WHERE t.id = v_run.template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wf_step_run: template is missing' USING ERRCODE = '23503';
    END IF;
    IF v_agent_ref IS NULL THEN v_agent_ref := v_template_agent_ref; END IF;
  END IF;

  SELECT s.autonomy_ceiling INTO v_tenant_level
    FROM public.wf_org_settings s WHERE s.org_id = NEW.org_id;
  v_tenant_level := coalesce(v_tenant_level, 'draft');
  IF v_agent_ref IS NOT NULL THEN
    SELECT a.earned_level INTO v_agent_level
      FROM public.wf_agent_autonomy a
     WHERE a.org_id = NEW.org_id AND a.agent_ref = v_agent_ref;
    v_agent_level := coalesce(v_agent_level, 'suggest');
  END IF;

  v_rank := least(
    CASE v_template_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
      WHEN 'act_with_approval' THEN 2 ELSE 3 END,
    CASE v_tenant_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
      WHEN 'act_with_approval' THEN 2 ELSE 3 END,
    CASE v_agent_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
      WHEN 'act_with_approval' THEN 2 ELSE 3 END
  );
  IF NEW.action_class NOT IN ('internal', 'communication', 'task', 'wait')
     OR NEW.action_class IN (
       'money_movement', 'safeguarding', 'credential_change', 'public_publish',
       'mass_message', 'external_authority_share'
     ) THEN
    v_rank := least(v_rank, 1);
  END IF;
  NEW.autonomy_level := CASE v_rank WHEN 0 THEN 'suggest' WHEN 1 THEN 'draft'
    WHEN 2 THEN 'act_with_approval' ELSE 'act_and_report' END;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.wf_autonomy_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.wf_autonomy_demote(uuid, uuid, text, text, text);
DROP FUNCTION public.wf_autonomy_promote(uuid, uuid, text, text, uuid, text);
DROP FUNCTION public.wf_autonomy_record_evidence(text, text, integer, integer, integer, integer, timestamptz, text);
DROP FUNCTION public.wf_autonomy_apply(uuid, text, text, text, uuid, uuid, text);
DROP FUNCTION public.wf_effective_autonomy(uuid, text, text, text);
DROP FUNCTION public.wf_autonomy_write_gate();
DROP TABLE public.wf_autonomy_change;
DROP FUNCTION public.wf_autonomy_change_audit();
DROP FUNCTION public.wf_autonomy_change_guard();
DROP TABLE public.wf_autonomy_evidence;
DROP FUNCTION public.wf_autonomy_append_only();
DROP FUNCTION public.wf_autonomy_ceiling(text);
DROP FUNCTION public.wf_autonomy_demote_floor();
DROP TABLE public.wf_autonomy_bar;
DROP TABLE public.wf_autonomy_agent_tier_cap;
DROP TABLE public.wf_autonomy_class_cap;
DROP TABLE public.wf_autonomy_scale;
DROP FUNCTION public.wf_autonomy_level_of(integer);
DROP FUNCTION public.wf_autonomy_rank(text);

-- WF-03 ACL of the earned level, as it was.
GRANT INSERT, UPDATE ON TABLE public.wf_agent_autonomy TO service_role;

COMMIT;
