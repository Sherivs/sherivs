-- Rollback: restores wf_create_event_run to the body before the budget deferral, and the counter's limit names.
DELETE FROM public.wf_quota_denial WHERE limit_name = 'agent_budget_day';
ALTER TABLE public.wf_quota_denial DROP CONSTRAINT IF EXISTS wf_quota_denial_limit_name_check;
ALTER TABLE public.wf_quota_denial ADD CONSTRAINT wf_quota_denial_limit_name_check CHECK (limit_name = ANY (ARRAY[
  'runs_per_day', 'drafts_pending', 'actions_per_hour', 'spend_cap_day', 'spend_cap_run', 'spend_wallet',
  'spend_rate_unknown', 'kind_unknown']));
CREATE OR REPLACE FUNCTION public.wf_create_event_run(p_run uuid, p_event uuid, p_lease_owner text, p_binding uuid, p_template uuid, p_agent_ref text, p_started_at timestamp with time zone, p_deadline_at timestamp with time zone, p_max_depth integer, p_max_steps integer, p_step_key text, p_step_kind text, p_action_class text, p_budget_units integer, p_max_attempts integer, p_timeout_seconds integer, p_input jsonb, p_run_state jsonb)
 RETURNS TABLE(created boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_event public.wf_event%ROWTYPE;
  v_definition public.wf_definition%ROWTYPE;
  v_version public.wf_version%ROWTYPE;
  v_run_id uuid := p_run;
  v_org uuid;
BEGIN
  SELECT * INTO v_event FROM public.wf_event WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'claimed' OR v_event.lease_owner IS DISTINCT FROM p_lease_owner
     OR v_event.lease_expires_at <= now() THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;
  v_org := v_event.org_id;

  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s
                  WHERE s.org_id = v_org AND s.workflows_enabled) THEN
    UPDATE public.wf_event SET status = 'pending', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  SELECT d.* INTO v_definition
    FROM public.wf_trigger_binding b
    JOIN public.wf_definition d ON d.org_id = b.org_id AND d.id = b.definition_id
   WHERE b.org_id = v_org AND b.id = p_binding AND b.enabled
     AND b.kind = 'event' AND b.event_type = v_event.event_type
     AND d.status = 'active';
  IF NOT FOUND THEN
    UPDATE public.wf_event SET status = 'ignored', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  SELECT * INTO v_version FROM public.wf_version
   WHERE org_id = v_org AND definition_id = v_definition.id
     AND id = v_definition.current_version_id AND state = 'published';
  IF NOT FOUND THEN
    UPDATE public.wf_event SET status = 'pending', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- WF-12: the daily run quota. A replay of this event's run is not a new run and is never deferred.
  IF NOT EXISTS (SELECT 1 FROM public.wf_run r
                  WHERE r.org_id = v_org AND r.idempotency_key = 'wf-event:' || p_event::text)
     AND public.wf_quota_runs_exceeded(v_org) THEN
    -- The claim counted an attempt; give it back, or a full day would walk the event to 'dead' after 25 claims.
    UPDATE public.wf_event SET status = 'pending', lease_owner = NULL,
      lease_expires_at = NULL, next_attempt_at = now() + interval '5 minutes',
      attempts = greatest(attempts - 1, 0), updated_at = now()
     WHERE id = p_event;
    PERFORM public.wf_quota_note_denial(v_org, 'runs_per_day', NULL);
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO public.wf_run (
    id, org_id, definition_id, version_id, trigger_binding_id, event_id,
    idempotency_key, status, max_depth, max_steps, deadline_at, started_at,
    template_id, agent_ref
  ) VALUES (
    v_run_id, v_org, v_definition.id, v_version.id, p_binding, p_event,
    'wf-event:' || p_event::text, CASE WHEN p_step_kind = 'approval' THEN 'waiting' ELSE 'running' END,
    p_max_depth, p_max_steps,
    p_deadline_at, p_started_at, p_template, p_agent_ref
  )
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_run_id;

  IF v_run_id IS NULL THEN
    UPDATE public.wf_event SET status = 'dispatched', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO public.wf_step_run (
    org_id, run_id, step_key, kind, action_class, budget_units, idempotency_key,
    max_attempts, timeout_seconds, agent_ref, input_ref, status
  ) VALUES (
    v_org, v_run_id, p_step_key, p_step_kind, coalesce(p_action_class, 'unclassified'),
    coalesce(p_budget_units, 0),
    'wf-step:' || v_run_id::text || ':' || p_step_key || ':0',
    p_max_attempts, p_timeout_seconds, p_agent_ref, coalesce(p_input, '{}'::jsonb),
    CASE WHEN p_step_kind = 'approval' THEN 'waiting' ELSE 'pending' END
  );
  IF p_step_kind = 'approval' THEN
    INSERT INTO public.wf_approval (
      org_id, run_id, step_run_id, required_permission, summary,
      requested_by_kind, requested_by_ref, requested_at, expires_at
    )
    SELECT v_org, v_run_id, s.id, 'workflows.approve',
      'Workflow approval required for step ' || p_step_key,
      CASE WHEN p_agent_ref IS NULL THEN 'system' ELSE 'agent' END,
      coalesce(p_agent_ref, 'workflow-runtime'), p_started_at, p_started_at + interval '7 days'
    FROM public.wf_step_run s
    WHERE s.org_id = v_org AND s.run_id = v_run_id AND s.step_key = p_step_key;
  END IF;
  INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_org, v_run_id, 'runtime.state', 'system', 'workflow-runtime', p_run_state);
  UPDATE public.wf_event SET status = 'dispatched', lease_owner = NULL,
    lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
  RETURN QUERY SELECT true;
END
$function$;
