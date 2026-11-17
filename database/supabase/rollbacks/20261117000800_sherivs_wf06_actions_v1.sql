BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_action_type') IS NULL
     OR to_regclass('public.wf_action_template') IS NULL
     OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.wf_webhook_target') IS NULL THEN
    RAISE EXCEPTION 'WF-06 rollback: one or more WF-06 objects are missing';
  END IF;
END
$prereq$;

DROP TABLE public.wf_action_sandbox_outbox;
DROP TABLE public.wf_action_draft;
DROP TABLE public.wf_webhook_target;
DROP TABLE public.wf_action_template;
DROP TABLE public.wf_action_type;

UPDATE public.cg_tool_registry
   SET enabled = false
 WHERE tool_id IN (
   'workflow.action.email', 'workflow.action.whatsapp', 'workflow.action.sms',
   'workflow.action.in_app', 'workflow.action.webhook'
 );

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
  IF NEW.action_class <> 'internal' OR NEW.action_class IN (
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

COMMIT;
