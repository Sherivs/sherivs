-- WF-03: workflow runtime settings, autonomy bounds and event claiming.
-- Scope: V1 organizational workflows; runtime stays behind the pure engine port.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_event') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_template') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'WF-03: WF-01 or WF-02 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_org_settings') IS NOT NULL
     OR to_regclass('public.wf_agent_autonomy') IS NOT NULL
     OR to_regprocedure('public.wf_claim_due_events(text,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-03: runtime objects already exist';
  END IF;
END
$prereq$;

ALTER TABLE public.wf_template
  ADD COLUMN agent_ref text CHECK (agent_ref IS NULL OR agent_ref ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
  ADD COLUMN autonomy_max text NOT NULL DEFAULT 'suggest'
    CHECK (autonomy_max IN ('suggest', 'draft', 'act_with_approval', 'act_and_report')),
  ADD COLUMN release text NOT NULL DEFAULT 'needs_integration'
    CHECK (release IN ('v1', 'later', 'needs_integration')),
  ADD COLUMN risk_tier text NOT NULL DEFAULT 'high'
    CHECK (risk_tier IN ('low', 'medium', 'high')),
  ADD COLUMN org_types text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(org_types) <= 32 AND array_position(org_types, '') IS NULL),
  ADD COLUMN data_classes text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(data_classes) <= 32 AND array_position(data_classes, '') IS NULL),
  ADD COLUMN lawful_basis text CHECK (lawful_basis IS NULL OR length(lawful_basis) <= 500),
  ADD COLUMN eval_suite text CHECK (eval_suite IS NULL OR length(eval_suite) <= 200),
  ADD COLUMN changelog text CHECK (changelog IS NULL OR length(changelog) <= 2000);

UPDATE public.wf_template SET autonomy_max = 'suggest';

CREATE TABLE public.wf_org_settings (
  org_id             uuid PRIMARY KEY,
  workflows_enabled  boolean NOT NULL DEFAULT false,
  autonomy_ceiling   text NOT NULL DEFAULT 'draft'
    CHECK (autonomy_ceiling IN ('suggest', 'draft', 'act_with_approval', 'act_and_report')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wf_agent_autonomy (
  org_id       uuid NOT NULL,
  agent_ref    text NOT NULL CHECK (agent_ref ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
  earned_level text NOT NULL
    CHECK (earned_level IN ('suggest', 'draft', 'act_with_approval', 'act_and_report')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_ref)
);

ALTER TABLE public.wf_run
  ADD COLUMN template_id uuid REFERENCES public.wf_template(id) ON DELETE RESTRICT,
  ADD COLUMN agent_ref text CHECK (agent_ref IS NULL OR agent_ref ~ '^[a-z][a-z0-9_.:-]{1,127}$');

ALTER TABLE public.wf_step_run
  ADD COLUMN agent_ref text CHECK (agent_ref IS NULL OR agent_ref ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
  ADD COLUMN autonomy_level text NOT NULL DEFAULT 'suggest'
    CHECK (autonomy_level IN ('suggest', 'draft', 'act_with_approval', 'act_and_report')),
  ADD COLUMN action_class text NOT NULL DEFAULT 'unclassified'
    CHECK (action_class ~ '^[a-z][a-z0-9_]{1,63}$'),
  ADD COLUMN budget_units integer NOT NULL DEFAULT 0 CHECK (budget_units BETWEEN 0 AND 1000000),
  ADD COLUMN spent_units integer NOT NULL DEFAULT 0 CHECK (spent_units BETWEEN 0 AND budget_units);

CREATE FUNCTION public.wf_autonomy_guard()
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

CREATE TRIGGER wf_step_run_05_autonomy
  BEFORE INSERT OR UPDATE
  ON public.wf_step_run FOR EACH ROW EXECUTE FUNCTION public.wf_autonomy_guard();

CREATE FUNCTION public.wf_runtime_settings_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old jsonb;
  v_target text;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  v_target := NEW.org_id::text || CASE WHEN TG_TABLE_NAME = 'wf_agent_autonomy'
    THEN ':' || coalesce(to_jsonb(NEW) ->> 'agent_ref', '')
    ELSE '' END;
  PERFORM public.wf_audit_append(
    NEW.org_id, 'workflow.' || TG_TABLE_NAME || '.changed',
    TG_TABLE_NAME, v_target, v_old, to_jsonb(NEW)
  );
  RETURN NULL;
END
$$;

CREATE TRIGGER wf_org_settings_90_audit
  AFTER INSERT OR UPDATE ON public.wf_org_settings
  FOR EACH ROW EXECUTE FUNCTION public.wf_runtime_settings_audit();
CREATE TRIGGER wf_agent_autonomy_90_audit
  AFTER INSERT OR UPDATE ON public.wf_agent_autonomy
  FOR EACH ROW EXECUTE FUNCTION public.wf_runtime_settings_audit();

CREATE FUNCTION public.wf_claim_due_events(
  p_worker text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.wf_event
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 60), 5), 900);
BEGIN
  IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'wf_claim_due_events: worker id is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wf_event e
     SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE e.id IN (
     SELECT x.id FROM public.wf_event x
      WHERE ((x.status = 'pending' AND (x.attempts >= 25 OR x.depth >= 16))
          OR (x.status = 'claimed' AND x.lease_expires_at <= now()
              AND (x.attempts >= 25 OR x.depth >= 16)))
        AND EXISTS (SELECT 1 FROM public.wf_org_settings s
                     WHERE s.org_id = x.org_id AND s.workflows_enabled)
      ORDER BY x.lease_expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
   );

  RETURN QUERY
  WITH due AS (
    SELECT x.id FROM public.wf_event x
     WHERE ((x.status = 'pending' AND x.next_attempt_at <= now())
         OR (x.status = 'claimed' AND x.lease_expires_at <= now()))
       AND x.attempts < 25
       AND x.depth < 16
       AND EXISTS (SELECT 1 FROM public.wf_org_settings s
                    WHERE s.org_id = x.org_id AND s.workflows_enabled)
     ORDER BY x.next_attempt_at, x.created_at
     LIMIT v_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.wf_event e
     SET status = 'claimed', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease),
         attempts = e.attempts + 1, updated_at = now()
    FROM due WHERE e.id = due.id
  RETURNING e.*;
END
$$;

CREATE OR REPLACE FUNCTION public.wf_claim_due_steps(
  p_worker text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.wf_step_run
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 60), 5), 900);
BEGIN
  IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'wf_claim_due_steps: worker id is required' USING ERRCODE = '22023';
  END IF;

  WITH expired AS (
    UPDATE public.wf_run r
       SET status = 'timed_out', finished_at = now(), error_code = 'run.deadline_exceeded',
           updated_at = now()
     WHERE r.status IN ('queued', 'running', 'waiting') AND r.deadline_at <= now()
     RETURNING r.org_id, r.id
  )
  UPDATE public.wf_step_run s
     SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL,
         finished_at = now(), error_code = 'run.deadline_exceeded', updated_at = now()
   WHERE (s.org_id, s.run_id) IN (SELECT org_id, id FROM expired)
     AND s.status IN ('pending', 'claimed', 'running', 'waiting');

  WITH dead AS (
    UPDATE public.wf_step_run x
     SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL,
         finished_at = now(), error_code = coalesce(x.error_code, 'lease.expired')
   WHERE x.id IN (
     SELECT s.id FROM public.wf_step_run s
      WHERE s.status IN ('claimed', 'running') AND s.lease_expires_at <= now()
        AND s.attempt >= s.max_attempts
        AND EXISTS (SELECT 1 FROM public.wf_run r
                     WHERE r.org_id = s.org_id AND r.id = s.run_id
                       AND r.status = 'running' AND r.deadline_at > now())
        AND EXISTS (SELECT 1 FROM public.wf_org_settings o
                     WHERE o.org_id = s.org_id AND o.workflows_enabled)
      ORDER BY s.lease_expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
   )
   RETURNING x.org_id, x.run_id, x.error_code
  )
  UPDATE public.wf_run r
     SET status = 'failed', finished_at = now(), error_code = coalesce(dead.error_code, 'step.failed'),
         step_count = least(r.max_steps, r.step_count + 1), updated_at = now()
    FROM dead WHERE r.org_id = dead.org_id AND r.id = dead.run_id AND r.status = 'running';

  RETURN QUERY
  WITH due_pending AS (
    SELECT s.id FROM public.wf_step_run s
     WHERE s.status = 'pending' AND s.next_attempt_at <= now() AND s.attempt < s.max_attempts
       AND EXISTS (SELECT 1 FROM public.wf_run r
                    WHERE r.org_id = s.org_id AND r.id = s.run_id
                      AND r.status = 'running' AND r.deadline_at > now()
                      AND r.step_count < r.max_steps)
       AND EXISTS (SELECT 1 FROM public.wf_org_settings o
                    WHERE o.org_id = s.org_id AND o.workflows_enabled)
     ORDER BY s.next_attempt_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  ), due_expired AS (
    SELECT s.id FROM public.wf_step_run s
     WHERE s.status IN ('claimed', 'running') AND s.lease_expires_at <= now()
       AND s.attempt < s.max_attempts
       AND EXISTS (SELECT 1 FROM public.wf_run r
                    WHERE r.org_id = s.org_id AND r.id = s.run_id
                      AND r.status = 'running' AND r.deadline_at > now()
                      AND r.step_count < r.max_steps)
       AND EXISTS (SELECT 1 FROM public.wf_org_settings o
                    WHERE o.org_id = s.org_id AND o.workflows_enabled)
     ORDER BY s.lease_expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  ), picked AS (
    SELECT id FROM (SELECT id FROM due_pending UNION SELECT id FROM due_expired) rows
     LIMIT v_limit
  )
  UPDATE public.wf_step_run s
     SET status = 'claimed', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease),
         attempt = s.attempt + 1, started_at = coalesce(s.started_at, now()),
         updated_at = now()
    FROM picked WHERE s.id = picked.id
  RETURNING s.*;
END
$$;

CREATE FUNCTION public.wf_create_event_run(
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

CREATE FUNCTION public.wf_persist_step_transition(
  p_step uuid,
  p_lease_owner text,
  p_attempt integer,
  p_step_status text,
  p_retry_at timestamptz,
  p_error_code text,
  p_run_status text,
  p_run_finished_at timestamptz,
  p_run_state jsonb,
  p_next_step_key text,
  p_next_iteration integer,
  p_next_kind text,
  p_next_action_class text,
  p_next_budget_units integer,
  p_next_idempotency_key text,
  p_next_max_attempts integer,
  p_next_timeout_seconds integer
)
RETURNS TABLE(persisted boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_step public.wf_step_run%ROWTYPE;
  v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_step FROM public.wf_step_run WHERE id = p_step FOR UPDATE;
  IF NOT FOUND OR v_step.status NOT IN ('claimed', 'running')
     OR v_step.lease_owner IS DISTINCT FROM p_lease_owner
     OR v_step.attempt IS DISTINCT FROM p_attempt
     OR v_step.lease_expires_at <= now() THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;
  SELECT * INTO v_run FROM public.wf_run
   WHERE org_id = v_step.org_id AND id = v_step.run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  IF p_step_status NOT IN ('succeeded', 'retried', 'dead', 'skipped')
     AND p_step_status <> 'waiting'
  THEN
    RAISE EXCEPTION 'wf_persist_step_transition: invalid status' USING ERRCODE = '22023';
  END IF;
  IF p_run_status IS NOT NULL AND p_run_status NOT IN
         ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'timed_out') THEN
    RAISE EXCEPTION 'wf_persist_step_transition: invalid status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wf_step_run SET
    status = CASE WHEN p_step_status = 'retried' THEN 'pending' ELSE p_step_status END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    next_attempt_at = coalesce(p_retry_at, now()),
    finished_at = CASE WHEN p_step_status IN ('succeeded', 'dead', 'skipped') THEN now() ELSE NULL END,
    error_code = p_error_code,
    updated_at = now()
  WHERE org_id = v_step.org_id AND id = v_step.id;

  IF p_run_state IS NOT NULL THEN
    UPDATE public.wf_run SET status = p_run_status,
        finished_at = CASE
          WHEN p_run_status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
            THEN coalesce(p_run_finished_at, now())
          ELSE NULL
        END,
      step_count = step_count + CASE WHEN p_step_status IN ('succeeded', 'dead', 'skipped') THEN 1 ELSE 0 END,
      error_code = CASE WHEN p_error_code = 'step_limit_exceeded' THEN p_error_code ELSE error_code END,
      updated_at = now()
     WHERE org_id = v_run.org_id AND id = v_run.id;
    INSERT INTO public.wf_run_event (
      org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail
    ) VALUES (
      v_run.org_id, v_run.id, v_step.id, 'runtime.state', 'system', 'workflow-runtime', p_run_state
    );
  ELSIF p_step_status IN ('dead', 'waiting') THEN
    UPDATE public.wf_run SET
      status = CASE WHEN p_step_status = 'dead' THEN 'failed' ELSE 'waiting' END,
      finished_at = CASE WHEN p_step_status = 'dead' THEN now() ELSE NULL END,
      error_code = CASE WHEN p_step_status = 'dead' THEN coalesce(p_error_code, 'step.failed') ELSE error_code END,
      step_count = step_count + CASE WHEN p_step_status = 'dead' THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE org_id = v_run.org_id AND id = v_run.id;
  END IF;

  IF p_step_status = 'succeeded' AND p_next_step_key IS NOT NULL THEN
    IF v_run.step_count + 1 >= v_run.max_steps THEN
      UPDATE public.wf_run SET status = 'failed', finished_at = now(),
        error_code = 'step.limit_exceeded', updated_at = now()
      WHERE org_id = v_run.org_id AND id = v_run.id;
      INSERT INTO public.wf_run_event (
        org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail
      ) VALUES (
        v_run.org_id, v_run.id, v_step.id, 'runtime.failure', 'system', 'workflow-runtime',
        jsonb_build_object('error_code', 'step.limit_exceeded')
      );
      RETURN QUERY SELECT true;
      RETURN;
    END IF;
    INSERT INTO public.wf_step_run (
      org_id, run_id, step_key, iteration, kind, idempotency_key,
      action_class, budget_units, max_attempts, timeout_seconds, agent_ref, status
    ) VALUES (
      v_run.org_id, v_run.id, p_next_step_key, p_next_iteration, p_next_kind,
      p_next_idempotency_key, coalesce(p_next_action_class, 'unclassified'),
      coalesce(p_next_budget_units, 0), p_next_max_attempts, p_next_timeout_seconds,
      v_run.agent_ref, CASE WHEN p_next_kind = 'approval' THEN 'waiting' ELSE 'pending' END
    )
    ON CONFLICT (org_id, idempotency_key) DO NOTHING;
    IF p_next_kind = 'approval' THEN
      INSERT INTO public.wf_approval (
        org_id, run_id, step_run_id, required_permission, summary,
        requested_by_kind, requested_by_ref, expires_at
      )
      SELECT v_run.org_id, v_run.id, s.id, 'workflows.approve',
        'Workflow approval required for step ' || p_next_step_key,
        CASE WHEN v_run.agent_ref IS NULL THEN 'system' ELSE 'agent' END,
        coalesce(v_run.agent_ref, 'workflow-runtime'), now() + interval '7 days'
      FROM public.wf_step_run s
      WHERE s.org_id = v_run.org_id AND s.run_id = v_run.id
        AND s.idempotency_key = p_next_idempotency_key
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF p_step_status = 'waiting' AND v_step.kind = 'approval' THEN
    INSERT INTO public.wf_approval (
      org_id, run_id, step_run_id, required_permission, summary,
      requested_by_kind, requested_by_ref, expires_at
    ) VALUES (
      v_step.org_id, v_step.run_id, v_step.id, 'workflows.approve',
      'Workflow approval required for step ' || v_step.step_key,
      CASE WHEN v_run.agent_ref IS NULL THEN 'system' ELSE 'agent' END,
      coalesce(v_run.agent_ref, 'workflow-runtime'), now() + interval '7 days'
    )
    ON CONFLICT (step_run_id) WHERE status = 'pending' DO NOTHING;
  END IF;
  RETURN QUERY SELECT true;
END
$$;

ALTER TABLE public.wf_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_org_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_autonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_autonomy FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_org_settings_read ON public.wf_org_settings FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_org_settings_insert ON public.wf_org_settings FOR INSERT TO authenticated
  WITH CHECK (public.wf_can(org_id, 'workflows.manage'));
CREATE POLICY wf_org_settings_update ON public.wf_org_settings FOR UPDATE TO authenticated
  USING (public.wf_can(org_id, 'workflows.manage'))
  WITH CHECK (public.wf_can(org_id, 'workflows.manage'));

REVOKE ALL ON TABLE public.wf_org_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wf_org_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wf_org_settings TO service_role;
REVOKE ALL ON TABLE public.wf_agent_autonomy FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wf_agent_autonomy TO service_role;

REVOKE ALL ON FUNCTION public.wf_autonomy_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wf_runtime_settings_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wf_claim_due_events(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wf_claim_due_events(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.wf_claim_due_steps(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_claim_due_steps(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.wf_create_event_run(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz,
  integer, integer, text, text, text, integer, integer, integer, jsonb, jsonb),
  public.wf_persist_step_transition(uuid, text, integer, text, timestamptz, text, text, timestamptz, jsonb,
  text, integer, text, text, integer, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wf_create_event_run(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz,
  integer, integer, text, text, text, integer, integer, integer, jsonb, jsonb),
  public.wf_persist_step_transition(uuid, text, integer, text, timestamptz, text, text, timestamptz, jsonb,
  text, integer, text, text, integer, text, integer, integer) TO service_role;

COMMENT ON TABLE public.wf_org_settings IS
  'WF-03 / ADR-105: organization workflow feature flag and autonomy ceiling. Missing rows are disabled.';
COMMENT ON TABLE public.wf_agent_autonomy IS
  'WF-03 / ADR-105: service-role-only earned autonomy; a missing row means suggest.';
COMMENT ON FUNCTION public.wf_claim_due_events(text, integer, integer) IS
  'WF-03 / ADR-105: SKIP LOCKED event claim for enabled organizations, service role only.';
COMMENT ON FUNCTION public.wf_create_event_run(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz,
  integer, integer, text, text, text, integer, integer, integer, jsonb, jsonb) IS
  'WF-03 / ADR-105: atomically creates one run and first step for a claimed stored event.';
COMMENT ON FUNCTION public.wf_persist_step_transition(uuid, text, integer, text, timestamptz, text, text,
  timestamptz, jsonb, text, integer, text, text, integer, text, integer, integer) IS
  'WF-03 / ADR-105: atomically persists a step transition, run state and optional next step.';

COMMIT;
