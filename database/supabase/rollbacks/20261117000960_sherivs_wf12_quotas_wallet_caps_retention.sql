-- NOT APPLIED. Rollback for 20261117000960 (WF-12 quotas, wallet caps and retention, ADR-124).
-- Removes the WF-12 triggers, functions, tables and the cost_kobo column, and restores the WF-03
-- wf_create_event_run body, the WF-07 step-up guard and the original append-only triggers on run events and
-- approval decisions. It refuses to run when a retention purge has ever been logged (the log is the only record
-- of what was deleted: export it first) or when any executed record carries a cost (cost_kobo > 0 would be lost).
-- Limits rows, quota counters and dry-run log rows are configuration and counters; they are dropped with the tables.
-- audit_chain entries WF-12 wrote stay (the chain is append-only).
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_org_limits') IS NULL
     OR to_regclass('public.wf_retention_run') IS NULL
     OR to_regclass('public.wf_quota_denial') IS NULL
     OR to_regclass('public.wf_action_spend_rate') IS NULL
     OR to_regprocedure('public.wf_limits_get(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'wf_action_sandbox_outbox' AND column_name = 'cost_kobo') THEN
    RAISE EXCEPTION 'WF-12 rollback: one or more WF-12 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_retention_run WHERE mode = 'purge' AND outcome = 'completed') THEN
    RAISE EXCEPTION 'WF-12 rollback: purges are logged in wf_retention_run; export the log first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox WHERE cost_kobo > 0) THEN
    RAISE EXCEPTION 'WF-12 rollback: executed records carry cost_kobo; export them first';
  END IF;
END
$prereq$;

-- Triggers first (they call the functions below).
DROP TRIGGER wf_run_15_quota ON public.wf_run;
DROP TRIGGER wf_action_draft_30_quota ON public.wf_action_draft;
DROP TRIGGER wf_action_sandbox_outbox_30_quota ON public.wf_action_sandbox_outbox;

-- Restore the WF-03 event run creation (no quota deferral).
CREATE OR REPLACE FUNCTION public.wf_create_event_run(
  p_run uuid,
  p_event uuid,
  p_lease_owner text,
  p_binding uuid,
  p_template uuid,
  p_agent_ref text,
  p_started_at timestamptz,
  p_deadline_at timestamptz,
  p_max_depth integer,
  p_max_steps integer,
  p_step_key text,
  p_step_kind text,
  p_action_class text,
  p_budget_units integer,
  p_max_attempts integer,
  p_timeout_seconds integer,
  p_input jsonb,
  p_run_state jsonb
)
RETURNS TABLE(created boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

-- Restore the original append-only triggers and the WF-07 step-up guard.
DROP TRIGGER wf_run_event_no_delete ON public.wf_run_event;
DROP TRIGGER wf_run_event_no_update ON public.wf_run_event;
CREATE TRIGGER wf_run_event_no_mutation BEFORE UPDATE OR DELETE ON public.wf_run_event
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
DROP TRIGGER wf_approval_decision_20_no_delete ON public.wf_approval_decision;
DROP TRIGGER wf_approval_decision_20_no_update ON public.wf_approval_decision;
CREATE TRIGGER wf_approval_decision_20_append_only BEFORE UPDATE OR DELETE ON public.wf_approval_decision
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE OR REPLACE FUNCTION public.wf_approval_step_up_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'wf_approval_step_up is append-only' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.approval_id, NEW.user_id, NEW.content_digest, NEW.verified_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.approval_id, OLD.user_id, OLD.content_digest, OLD.verified_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'wf_approval_step_up: evidence fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'wf_approval_step_up: a step-up is single use' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP FUNCTION public.wf_retention_delete_guard();
DROP FUNCTION public.wf_retention_delete_allowed(uuid);

DROP FUNCTION public.wf_retention_run_scheduled(integer);
DROP FUNCTION public.wf_retention_run_manual(uuid, boolean, uuid);
DROP FUNCTION public.wf_retention_execute(uuid, boolean, uuid, text);
DROP FUNCTION public.wf_retention_pass(uuid, jsonb, integer);
DROP FUNCTION public.wf_retention_legal_hold(uuid);
DROP FUNCTION public.wf_limits_update(uuid, jsonb);
DROP FUNCTION public.wf_limits_get(uuid);
DROP FUNCTION public.wf_quota_check_action(uuid, text, integer, text, uuid);
DROP FUNCTION public.wf_run_quota_guard();
DROP FUNCTION public.wf_action_draft_quota_guard();
DROP FUNCTION public.wf_action_sandbox_outbox_quota_guard();
DROP FUNCTION public.wf_quota_runs_exceeded(uuid);
DROP FUNCTION public.wf_quota_note_denial(uuid, text, text);
DROP FUNCTION public.wf_action_cost_kobo(text, integer);
DROP FUNCTION public.wf_quota_violation(uuid, text, integer, text, uuid);
DROP FUNCTION public.wf_usage_snapshot(uuid);
DROP FUNCTION public.wf_org_limits_effective(uuid);

ALTER TABLE public.wf_action_sandbox_outbox DROP COLUMN cost_kobo;

DROP TABLE public.wf_retention_run;
DROP TABLE public.wf_action_spend_rate;
DROP TABLE public.wf_quota_denial;
DROP TABLE public.wf_org_limits;

DROP FUNCTION public.wf_org_limits_guard();
DROP FUNCTION public.wf_limit_defaults();
DROP FUNCTION public.wf_limit_bounds();
DROP FUNCTION public.wf_default_actions_per_hour(text);
DROP FUNCTION public.wf_wallet_cap_ceiling_kobo();

COMMIT;
