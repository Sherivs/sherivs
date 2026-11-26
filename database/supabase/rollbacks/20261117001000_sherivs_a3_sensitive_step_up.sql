-- Rollback for A3. Restores the AIN-02 promotion function. Evidence rows are dropped with the table.
BEGIN;
CREATE OR REPLACE FUNCTION public.wf_autonomy_promote(
  p_actor uuid, p_org uuid, p_agent text, p_to_level text, p_evidence uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_state text;
  v_from text;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'ain02:only_the_founder_promotes' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = p_org) THEN
    RAISE EXCEPTION 'ain02:organization_unknown' USING ERRCODE = '23503';
  END IF;
  v_state := public.wf_agent_state_code(p_org, p_agent);
  IF v_state <> 'ok' THEN
    RAISE EXCEPTION 'ain02:agent_not_usable_here:%', v_state USING ERRCODE = '42501';
  END IF;
  v_from := public.wf_autonomy_apply(p_org, p_agent, 'promote', p_to_level, p_evidence, p_actor, p_reason);
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('org_id', p_org, 'agent_ref', p_agent, 'from', v_from, 'to', p_to_level);
END
$$;
DROP FUNCTION IF EXISTS public.wf_step_up_consume(uuid, text, text);
DROP FUNCTION IF EXISTS public.wf_step_up_digest(text, text[]);
DROP TABLE IF EXISTS public.wf_sensitive_step_up;
DROP FUNCTION IF EXISTS public.wf_sensitive_step_up_guard();
COMMIT;
