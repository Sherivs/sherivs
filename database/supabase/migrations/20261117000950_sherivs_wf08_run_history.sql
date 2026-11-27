-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- WF-08: tenant run history with server-side PII redaction, cancel and retry (ADR-123).
-- Origin: Claude Code agent, mission WF-08 (issue #468). Stacked on WF-07 (#467), which is stacked on WF-06 (#455).
--
-- Version note: 20261117001000 was the number first reserved for this mission, but it is already used by
-- 20261117001000_sherivs_m2a_role_catalog_extension.sql (PR #448 branch). This file uses 20261117000950, which
-- sorts directly after WF-07 (20261117000900) and is free on every branch. The founder confirms before apply.
--
-- What this adds (all names neutral):
--   wf_run.retry_of_run_id / retry_of_step_id / retry_generation   a retry is a NEW run linked to its source
--   wf_run_history_list()    redacted, tenant-scoped run list (service role only; the actor is bound in SQL)
--   wf_run_history_detail()  redacted run detail: steps, timeline, approvals, drafts, outbox
--   wf_run_cancel()          stop a queued, running or waiting run; idempotent; audited
--   wf_run_retry()           re-run a dead step in a new run; idempotent; refuses every unsafe case; audited
--   wf_retry_blockers()      the one place that says why a dead step cannot be retried (internal)
--   wf_redact_event_detail() allow-list filter for run-timeline detail (internal)
--   wf_action_sandbox_outbox_20_run_guard   no executed record for a run that is no longer active
--
-- Why a retry is a new run: finished runs and dead steps are immutable by design (wf_run_guard,
-- wf_step_run_guard, and the engine's terminal states). This migration does not weaken either guard. The new
-- run resumes at the dead step only; the source run and its history stay exactly as they were.
--
-- Authority model (same as WF-07): every function is SECURITY DEFINER with an empty search_path, EXECUTE
-- revoked from PUBLIC, anon and authenticated, granted to service_role only. The server passes the signed-in
-- person's id; the function binds that identity for the transaction, derives the organization from it
-- (never from a parameter) and restores the previous claims before it returns.
--   view history   workflows.view   (wf_can)
--   retry          workflows.run     (wf_can)
--   cancel         workflows.run or workflows.manage (wf_can)
-- No new permission and no new table. No provider is ever called from here; delivery stays behind the WF-06
-- delivery mode and WORKFLOWS_ENABLED.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_run_event') IS NULL
     OR to_regclass('public.wf_approval') IS NULL
     OR to_regclass('public.wf_approval_decision') IS NULL
     OR to_regclass('public.wf_definition') IS NULL
     OR to_regclass('public.wf_version') IS NULL
     OR to_regclass('public.wf_event') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.cg_tool_call_ledger') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.wf_act_as(uuid)') IS NULL
     OR to_regprocedure('public.wf_act_restore(jsonb)') IS NULL
     OR to_regprocedure('public.wf_approval_required_count(uuid,text,text)') IS NULL
     OR to_regprocedure('public.wf_run_close_approvals()') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'WF-08: WF-01 through WF-07 prerequisites are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'wf_run'
                AND column_name IN ('retry_of_run_id', 'retry_of_step_id', 'retry_generation'))
     OR to_regprocedure('public.wf_run_cancel(uuid,uuid,text)') IS NOT NULL
     OR to_regprocedure('public.wf_run_retry(uuid,uuid,text)') IS NOT NULL
     OR to_regprocedure('public.wf_run_history_list(uuid,text,text,timestamp with time zone,integer,uuid)') IS NOT NULL
     OR to_regprocedure('public.wf_run_history_detail(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-08: one or more WF-08 objects already exist';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Retry linkage on wf_run
-- -----------------------------------------------------------------------------
-- A retry run points at the run it continues and at the exact dead step it resumes. One retry per dead
-- step (unique index): that is what makes retry idempotent in the database and not only in the function.
-- retry_generation counts the chain (source run = 0); it is capped at 3.
ALTER TABLE public.wf_run
  ADD COLUMN retry_of_run_id  uuid,
  ADD COLUMN retry_of_step_id uuid,
  ADD COLUMN retry_generation smallint NOT NULL DEFAULT 0 CHECK (retry_generation BETWEEN 0 AND 3);
ALTER TABLE public.wf_run
  ADD CONSTRAINT wf_run_retry_run_fk FOREIGN KEY (org_id, retry_of_run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT wf_run_retry_step_fk FOREIGN KEY (org_id, retry_of_step_id)
    REFERENCES public.wf_step_run (org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT wf_run_retry_fields CHECK (
    (retry_of_run_id IS NULL) = (retry_of_step_id IS NULL)
    AND (retry_of_run_id IS NULL) = (retry_generation = 0)
    AND retry_of_run_id IS DISTINCT FROM id);
CREATE UNIQUE INDEX wf_run_one_retry_per_step ON public.wf_run (org_id, retry_of_step_id)
  WHERE retry_of_step_id IS NOT NULL;
CREATE INDEX wf_run_retry_source_idx ON public.wf_run (org_id, retry_of_run_id)
  WHERE retry_of_run_id IS NOT NULL;

-- The linkage is history: it never changes after the row exists.
CREATE FUNCTION public.wf_run_retry_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF (NEW.retry_of_run_id, NEW.retry_of_step_id, NEW.retry_generation)
     IS DISTINCT FROM (OLD.retry_of_run_id, OLD.retry_of_step_id, OLD.retry_generation) THEN
    RAISE EXCEPTION 'wf_run: the retry link is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_run_20_retry_guard
  BEFORE UPDATE ON public.wf_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_run_retry_guard();

-- -----------------------------------------------------------------------------
-- 2. No executed record for a run that is no longer active
-- -----------------------------------------------------------------------------
-- Cancelling a run must also stop a dispatch that is already in flight (an approved draft being replayed by the
-- sweep, or a step that was mid-execution). An approved draft is dispatched while its run is `waiting` or
-- `running`; a cancelled, failed, timed-out or finished run never gets a new executed record.
CREATE FUNCTION public.wf_action_sandbox_outbox_run_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_status text;
BEGIN
  -- FOR SHARE: a cancel (which updates the run row) waits for this record's transaction, and a record that starts
  -- after a cancel commits sees the new status. Without the lock the check and the cancel could interleave and an
  -- executed record could be written for a run that was cancelled between the two (review finding, WF-08 #469).
  SELECT r.status INTO v_status FROM public.wf_run r
   WHERE r.org_id = NEW.org_id AND r.id = NEW.run_id
   FOR SHARE;
  -- A run that does not exist in this organization is left to the foreign key (23503), exactly as before.
  IF v_status IS NOT NULL AND v_status NOT IN ('queued', 'running', 'waiting') THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: the run is no longer active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_action_sandbox_outbox_20_run_guard
  BEFORE INSERT ON public.wf_action_sandbox_outbox
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_sandbox_outbox_run_guard();

-- -----------------------------------------------------------------------------
-- 3. Redaction: an allow-list for timeline detail
-- -----------------------------------------------------------------------------
-- Only these keys, and only values of the exact expected shape, survive. Everything else (free text, addresses,
-- phone numbers, nested objects, arrays, any key not named here) is dropped. The engine's runtime.state blob is
-- never passed through this function: it is excluded from the history entirely.
CREATE FUNCTION public.wf_redact_event_detail(p_detail jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_detail) = 'object' THEN p_detail ELSE '{}'::jsonb END) AS e
   WHERE (e.key IN ('approval_id', 'draft_id', 'source_run_id', 'source_step_id', 'retry_run_id')
          AND jsonb_typeof(e.value) = 'string'
          AND (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      OR (e.key = 'risk' AND e.value IN ('"normal"'::jsonb, '"high"'::jsonb))
      OR (e.key = 'decision' AND e.value IN ('"approve"'::jsonb, '"reject"'::jsonb))
      OR (e.key IN ('error_code', 'reason_code')
          AND jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') ~ '^[a-z][a-z0-9_.]{1,63}$')
      OR (e.key = 'from_status'
          AND jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') ~ '^[a-z_]{1,32}$')
      OR (e.key = 'generation'
          AND jsonb_typeof(e.value) = 'number' AND (e.value #>> '{}') ~ '^[0-9]$')
      OR (e.key = 'replayed' AND jsonb_typeof(e.value) = 'boolean')
$$;

-- Reasons a person may give for a cancel or a retry: codes only, never free text.
CREATE FUNCTION public.wf_run_control_reason_ok(p_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(p_reason IN ('operator_request', 'duplicate_run', 'wrong_audience', 'policy_change',
                               'fixed_upstream', 'other'), false)
$$;

-- -----------------------------------------------------------------------------
-- 4. Why a dead step cannot be retried (one definition, used by the view and by wf_run_retry)
-- -----------------------------------------------------------------------------
-- The caller has bound the actor. Returns every reason, in a stable order; an empty array means retryable.
CREATE FUNCTION public.wf_retry_blockers(p_org uuid, p_step uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_s public.wf_step_run%ROWTYPE;
  v_r public.wf_run%ROWTYPE;
  v_def public.wf_definition%ROWTYPE;
  v_state jsonb;
  v_b text[] := '{}';
BEGIN
  SELECT * INTO v_s FROM public.wf_step_run WHERE org_id = p_org AND id = p_step;
  IF NOT FOUND THEN RETURN ARRAY['not_found']; END IF;
  SELECT * INTO v_r FROM public.wf_run WHERE org_id = p_org AND id = v_s.run_id;
  IF NOT FOUND THEN RETURN ARRAY['not_found']; END IF;

  IF NOT public.wf_can(p_org, 'workflows.run') THEN v_b := array_append(v_b, 'not_authorized'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings o WHERE o.org_id = p_org AND o.workflows_enabled) THEN
    v_b := array_append(v_b, 'workflows_disabled');
  END IF;
  IF v_s.status <> 'dead' THEN v_b := array_append(v_b, 'step_not_dead'); END IF;
  IF v_s.kind = 'approval' THEN v_b := array_append(v_b, 'approval_step'); END IF;
  -- A cancelled run (including one cancelled by a rejected or expired approval) is never retried.
  IF v_r.status NOT IN ('failed', 'timed_out') THEN v_b := array_append(v_b, 'run_not_retryable'); END IF;
  IF v_r.retry_generation >= 3 THEN v_b := array_append(v_b, 'retry_limit'); END IF;

  SELECT * INTO v_def FROM public.wf_definition WHERE org_id = p_org AND id = v_r.definition_id;
  IF NOT FOUND OR v_def.status <> 'active' THEN v_b := array_append(v_b, 'definition_inactive'); END IF;
  IF v_def.current_version_id IS DISTINCT FROM v_r.version_id THEN
    v_b := array_append(v_b, 'version_not_current');
  END IF;

  -- The run must really have stopped at this step, and the engine state to resume from must exist.
  SELECT e.detail INTO v_state FROM public.wf_run_event e
   WHERE e.org_id = p_org AND e.run_id = v_r.id AND e.kind = 'runtime.state'
   ORDER BY e.id DESC LIMIT 1;
  IF v_state IS NULL OR jsonb_typeof(v_state -> 'run') IS DISTINCT FROM 'object'
     OR (v_state #>> '{run,currentStepId}') IS DISTINCT FROM v_s.step_key THEN
    v_b := array_append(v_b, 'not_stopping_step');
  END IF;

  -- An effect may already have happened: never re-fire it and never create a second draft for it.
  IF EXISTS (SELECT 1 FROM public.wf_action_draft d
              WHERE d.org_id = p_org AND (d.step_run_id = p_step OR d.idempotency_key = v_s.idempotency_key)) THEN
    v_b := array_append(v_b, 'draft_exists');
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o
              WHERE o.org_id = p_org AND (o.step_run_id = p_step OR o.idempotency_key = v_s.idempotency_key))
     OR EXISTS (SELECT 1 FROM public.cg_tool_call_ledger l
                 WHERE l.kind = 'decision' AND l.verdict = 'execute' AND l.tenant_ref = p_org::text
                   AND l.idempotency_key = v_s.idempotency_key AND l.tool_id LIKE 'workflow.action.%') THEN
    v_b := array_append(v_b, 'effect_recorded');
  END IF;
  RETURN v_b;
END
$$;

-- -----------------------------------------------------------------------------
-- 5. Cancel
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_run_cancel(p_actor uuid, p_run uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_run public.wf_run%ROWTYPE;
  v_from text;
  v_steps integer;
BEGIN
  IF NOT public.wf_run_control_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'wf08:invalid_reason' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT (public.wf_can(v_org, 'workflows.run') OR public.wf_can(v_org, 'workflows.manage')) THEN
    RAISE EXCEPTION 'wf08:not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_run FROM public.wf_run WHERE org_id = v_org AND id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'wf08:not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_run.status = 'cancelled' THEN
    PERFORM public.wf_act_restore(v_prev);
    RETURN jsonb_build_object('run_id', v_run.id, 'status', 'cancelled', 'replayed', true, 'steps_cancelled', 0);
  END IF;
  IF v_run.status NOT IN ('queued', 'running', 'waiting') THEN
    RAISE EXCEPTION 'wf08:not_cancellable' USING ERRCODE = '42501';
  END IF;

  -- Same lock order as wf_persist_step_transition (steps, then the run), so a step finishing at this very
  -- moment cannot deadlock with the cancel; whichever wins, the other sees the final state.
  PERFORM 1 FROM public.wf_step_run s
   WHERE s.org_id = v_org AND s.run_id = p_run AND s.status IN ('claimed', 'running')
   ORDER BY s.id FOR UPDATE;
  SELECT * INTO v_run FROM public.wf_run WHERE org_id = v_org AND id = p_run FOR UPDATE;
  IF v_run.status = 'cancelled' THEN
    PERFORM public.wf_act_restore(v_prev);
    RETURN jsonb_build_object('run_id', v_run.id, 'status', 'cancelled', 'replayed', true, 'steps_cancelled', 0);
  END IF;
  IF v_run.status NOT IN ('queued', 'running', 'waiting') THEN
    RAISE EXCEPTION 'wf08:not_cancellable' USING ERRCODE = '42501';
  END IF;
  v_from := v_run.status;

  -- In-flight steps are cancelled here (their lease is dropped, so a late persist is refused and no new
  -- attempt is claimed); pending and waiting steps, open approvals and open drafts are closed by the existing
  -- wf_run_80_close_approvals trigger when the run status changes below.
  UPDATE public.wf_step_run
     SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, finished_at = now(),
         error_code = coalesce(error_code, 'run.cancelled')
   WHERE org_id = v_org AND run_id = p_run AND status IN ('claimed', 'running');
  GET DIAGNOSTICS v_steps = ROW_COUNT;
  UPDATE public.wf_run
     SET status = 'cancelled', finished_at = now(), error_code = 'run.cancelled'
   WHERE org_id = v_org AND id = p_run;

  INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_org, p_run, 'run.cancel_requested', 'user', p_actor::text,
          jsonb_build_object('reason_code', p_reason, 'from_status', v_from));
  PERFORM public.wf_audit_append(v_org, 'workflow.run.cancel_requested', 'wf_run', p_run::text,
    jsonb_build_object('status', v_from),
    jsonb_build_object('status', 'cancelled', 'reason_code', p_reason));
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('run_id', p_run, 'status', 'cancelled', 'replayed', false, 'steps_cancelled', v_steps);
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Retry
-- -----------------------------------------------------------------------------
-- Starts a NEW run at the dead step. Steps that already succeeded are not re-run; the source run is untouched.
-- The new step is an ordinary step: the same autonomy guard computes its level (capped classes stay at draft),
-- it is claimed only for an organization with workflows enabled, and its action goes through the same broker
-- and delivery gate as any first attempt. If the guard would give it more autonomy than the dead step had, the
-- whole retry is refused. The person who retries becomes the run's starter, so they can never approve its drafts.
CREATE FUNCTION public.wf_run_retry(p_actor uuid, p_step uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_s public.wf_step_run%ROWTYPE;
  v_r public.wf_run%ROWTYPE;
  v_v public.wf_version%ROWTYPE;
  v_existing uuid;
  v_blockers text[];
  v_state jsonb;
  v_new uuid := gen_random_uuid();
  v_gen smallint;
  v_now timestamptz := now();
  v_iso text;
  v_new_step public.wf_step_run%ROWTYPE;
  v_rank_old integer;
  v_rank_new integer;
BEGIN
  IF NOT public.wf_run_control_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'wf08:invalid_reason' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.run') THEN
    RAISE EXCEPTION 'wf08:not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public.wf_step_run WHERE org_id = v_org AND id = p_step FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wf08:not_found' USING ERRCODE = 'P0002'; END IF;

  -- Idempotent: one retry per dead step. A repeat returns the run the first call made.
  SELECT r.id INTO v_existing FROM public.wf_run r WHERE r.org_id = v_org AND r.retry_of_step_id = p_step;
  IF v_existing IS NOT NULL THEN
    PERFORM public.wf_act_restore(v_prev);
    RETURN jsonb_build_object('run_id', v_existing, 'replayed', true);
  END IF;

  v_blockers := public.wf_retry_blockers(v_org, p_step);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'wf08:%', v_blockers[1] USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_r FROM public.wf_run WHERE org_id = v_org AND id = v_s.run_id FOR UPDATE;
  -- Re-check under the run lock (a concurrent cancel or retry can only make this stricter).
  IF v_r.status NOT IN ('failed', 'timed_out') THEN
    RAISE EXCEPTION 'wf08:run_not_retryable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_v FROM public.wf_version WHERE org_id = v_org AND id = v_r.version_id;
  SELECT e.detail INTO v_state FROM public.wf_run_event e
   WHERE e.org_id = v_org AND e.run_id = v_r.id AND e.kind = 'runtime.state'
   ORDER BY e.id DESC LIMIT 1;
  v_gen := v_r.retry_generation + 1;
  v_iso := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  INSERT INTO public.wf_run (
    id, org_id, definition_id, version_id, trigger_binding_id, event_id, parent_run_id, idempotency_key,
    status, depth, max_depth, step_count, max_steps, started_by, deadline_at, started_at,
    template_id, agent_ref, retry_of_run_id, retry_of_step_id, retry_generation
  ) VALUES (
    v_new, v_org, v_r.definition_id, v_r.version_id, v_r.trigger_binding_id, v_r.event_id, v_r.parent_run_id,
    'wf-retry:' || p_step::text,
    'running', v_r.depth, v_r.max_depth, least(greatest(v_r.step_count - 1, 0), v_r.max_steps), v_r.max_steps,
    p_actor, v_now + make_interval(secs => v_v.run_timeout_seconds), v_now,
    v_r.template_id, v_r.agent_ref, v_r.id, p_step, v_gen
  );

  -- The step autonomy trigger fills autonomy_level from the current template, tenant and agent ceilings.
  INSERT INTO public.wf_step_run (
    org_id, run_id, step_key, iteration, kind, status, idempotency_key, action_class, budget_units,
    max_attempts, timeout_seconds, agent_ref, input_ref
  ) VALUES (
    v_org, v_new, v_s.step_key, v_s.iteration, v_s.kind, 'pending', 'wf-retry-step:' || p_step::text,
    v_s.action_class, v_s.budget_units, v_s.max_attempts, v_s.timeout_seconds, v_s.agent_ref, v_s.input_ref
  ) RETURNING * INTO v_new_step;

  v_rank_old := CASE v_s.autonomy_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
                  WHEN 'act_with_approval' THEN 2 ELSE 3 END;
  v_rank_new := CASE v_new_step.autonomy_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
                  WHEN 'act_with_approval' THEN 2 ELSE 3 END;
  IF v_rank_new > v_rank_old THEN
    RAISE EXCEPTION 'wf08:autonomy_escalation' USING ERRCODE = '42501';
  END IF;
  IF public.wf_is_capped_category(v_new_step.action_class) AND v_rank_new > 1 THEN
    RAISE EXCEPTION 'wf08:autonomy_escalation' USING ERRCODE = '42501';
  END IF;

  -- The engine state the run resumes from: the source state, running again at the dead step with a fresh
  -- attempt count. Evidence and pending evidence are carried over unchanged, so no evidence rule is skipped.
  INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_org, v_new, v_new_step.id, 'runtime.state', 'system', 'workflow-runtime',
    v_state || jsonb_build_object('run', (v_state -> 'run') || jsonb_build_object(
      'runId', v_new,
      'state', 'running',
      'currentStepId', v_s.step_key,
      'attempts', '[]'::jsonb,
      'completedAt', 'null'::jsonb,
      'startedAt', v_iso,
      'history', coalesce(v_state -> 'run' -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'at', v_iso, 'stepId', v_s.step_key, 'fromState', v_state #>> '{run,state}', 'toState', 'running',
        'kind', 'run_retried', 'reason', 'Retried from a failed run by a person'))
    )));
  INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_org, v_new, v_new_step.id, 'run.retry_requested', 'user', p_actor::text,
          jsonb_build_object('source_run_id', v_r.id, 'source_step_id', p_step, 'generation', v_gen,
                             'reason_code', p_reason));
  INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_org, v_r.id, p_step, 'run.retried', 'user', p_actor::text,
          jsonb_build_object('retry_run_id', v_new, 'reason_code', p_reason));
  PERFORM public.wf_audit_append(v_org, 'workflow.run.retry_requested', 'wf_run', v_new::text,
    jsonb_build_object('source_run', v_r.id, 'source_step', p_step, 'status', v_r.status),
    jsonb_build_object('run', v_new, 'generation', v_gen, 'reason_code', p_reason));
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('run_id', v_new, 'replayed', false, 'generation', v_gen);
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Reads: redacted history list and detail
-- -----------------------------------------------------------------------------
-- Output is built from an allow-list of columns. It never contains recipient ids, template parameters, event
-- payloads, subject references, step input or output, approval notes, the engine state, or any free text.
CREATE FUNCTION public.wf_run_history_list(
  p_actor uuid, p_status text DEFAULT NULL, p_workflow text DEFAULT NULL,
  p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 50, p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_statuses text[];
  v_can_cancel boolean;
  v_rows jsonb;
  v_more boolean;
BEGIN
  v_statuses := CASE coalesce(p_status, 'all')
    WHEN 'all' THEN NULL
    WHEN 'active' THEN ARRAY['queued', 'running', 'waiting']
    WHEN 'failed' THEN ARRAY['failed', 'timed_out']
    WHEN 'succeeded' THEN ARRAY['succeeded']
    WHEN 'cancelled' THEN ARRAY['cancelled']
    ELSE ARRAY['invalid'] END;
  IF v_statuses = ARRAY['invalid'] OR (p_workflow IS NOT NULL AND p_workflow !~ '^[a-z][a-z0-9_-]{1,62}$') THEN
    RAISE EXCEPTION 'wf08:invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.view') THEN
    RAISE EXCEPTION 'wf08:not_authorized' USING ERRCODE = '42501';
  END IF;
  v_can_cancel := public.wf_can(v_org, 'workflows.run') OR public.wf_can(v_org, 'workflows.manage');

  WITH page AS (
    SELECT r.*, d.key AS workflow_key
      FROM public.wf_run r
      JOIN public.wf_definition d ON d.org_id = r.org_id AND d.id = r.definition_id
     WHERE r.org_id = v_org
       AND (v_statuses IS NULL OR r.status = ANY (v_statuses))
       AND (p_workflow IS NULL OR d.key = p_workflow)
       AND (p_before IS NULL OR r.created_at < p_before
            OR (p_before_id IS NOT NULL AND r.created_at = p_before AND r.id < p_before_id))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit + 1
  ), shown AS (
    SELECT * FROM page ORDER BY created_at DESC, id DESC LIMIT v_limit
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'run_id', s.id,
      'workflow_key', s.workflow_key,
      'status', s.status,
      'error_code', s.error_code,
      'trigger_event_type', (SELECT e.event_type FROM public.wf_event e WHERE e.org_id = s.org_id AND e.id = s.event_id),
      'created_at', s.created_at,
      'started_at', s.started_at,
      'finished_at', s.finished_at,
      'step_count', s.step_count,
      'steps', coalesce((SELECT jsonb_object_agg(x.status, x.n)
                           FROM (SELECT st.status, count(*) AS n FROM public.wf_step_run st
                                  WHERE st.org_id = s.org_id AND st.run_id = s.id GROUP BY st.status) x), '{}'::jsonb),
      'open_approvals', (SELECT count(*) FROM public.wf_approval a
                          WHERE a.org_id = s.org_id AND a.run_id = s.id AND a.status = 'pending'),
      'drafts', (SELECT count(*) FROM public.wf_action_draft dr WHERE dr.org_id = s.org_id AND dr.run_id = s.id),
      'executed', (SELECT count(*) FROM public.wf_action_sandbox_outbox o WHERE o.org_id = s.org_id AND o.run_id = s.id),
      'retry_of_run_id', s.retry_of_run_id,
      'retry_generation', s.retry_generation,
      'retries', (SELECT count(*) FROM public.wf_run rr WHERE rr.org_id = s.org_id AND rr.retry_of_run_id = s.id),
      'has_dead_step', s.status IN ('failed', 'timed_out') AND EXISTS (
        SELECT 1 FROM public.wf_step_run st
         WHERE st.org_id = s.org_id AND st.run_id = s.id AND st.status = 'dead' AND st.kind <> 'approval'),
      'can_cancel', v_can_cancel AND s.status IN ('queued', 'running', 'waiting')
    ) ORDER BY s.created_at DESC, s.id DESC), '[]'::jsonb),
    (SELECT count(*) > v_limit FROM page)
    INTO v_rows, v_more
    FROM shown s;
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('items', v_rows, 'has_more', v_more);
END
$$;

CREATE FUNCTION public.wf_run_history_detail(p_actor uuid, p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_r public.wf_run%ROWTYPE;
  v_key text;
  v_version integer;
  v_event_type text;
  v_can_run boolean;
  v_can_cancel boolean;
  v_enabled boolean;
  v_out jsonb;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.view') THEN
    RAISE EXCEPTION 'wf08:not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_r FROM public.wf_run WHERE org_id = v_org AND id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'wf08:not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT d.key INTO v_key FROM public.wf_definition d WHERE d.org_id = v_org AND d.id = v_r.definition_id;
  SELECT v.version INTO v_version FROM public.wf_version v WHERE v.org_id = v_org AND v.id = v_r.version_id;
  SELECT e.event_type INTO v_event_type FROM public.wf_event e WHERE e.org_id = v_org AND e.id = v_r.event_id;
  v_can_run := public.wf_can(v_org, 'workflows.run');
  v_can_cancel := v_can_run OR public.wf_can(v_org, 'workflows.manage');
  v_enabled := coalesce((SELECT o.workflows_enabled FROM public.wf_org_settings o WHERE o.org_id = v_org), false);

  v_out := jsonb_build_object(
    'run', jsonb_build_object(
      'run_id', v_r.id, 'workflow_key', v_key, 'version', v_version, 'status', v_r.status,
      'error_code', v_r.error_code, 'trigger_event_type', v_event_type,
      'created_at', v_r.created_at, 'started_at', v_r.started_at, 'finished_at', v_r.finished_at,
      'deadline_at', v_r.deadline_at, 'step_count', v_r.step_count, 'max_steps', v_r.max_steps,
      'started_by_me', v_r.started_by IS NOT DISTINCT FROM p_actor,
      'started_by_kind', CASE WHEN v_r.started_by IS NOT NULL THEN 'user'
                              WHEN v_r.agent_ref IS NOT NULL THEN 'agent' ELSE 'system' END,
      'retry_of_run_id', v_r.retry_of_run_id, 'retry_generation', v_r.retry_generation),
    'permissions', jsonb_build_object(
      'can_cancel', v_can_cancel AND v_r.status IN ('queued', 'running', 'waiting'),
      'can_retry', v_can_run AND v_enabled,
      'workflows_enabled', v_enabled),
    'steps', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'step_id', s.id, 'step_key', s.step_key, 'iteration', s.iteration, 'kind', s.kind, 'status', s.status,
        'attempt', s.attempt, 'max_attempts', s.max_attempts, 'action_class', s.action_class,
        'autonomy_level', s.autonomy_level, 'error_code', s.error_code,
        'started_at', s.started_at, 'finished_at', s.finished_at, 'created_at', s.created_at,
        'retry', CASE WHEN s.status = 'dead' THEN jsonb_build_object(
          'blockers', to_jsonb(public.wf_retry_blockers(v_org, s.id)),
          'retry_run_id', (SELECT rr.id FROM public.wf_run rr WHERE rr.org_id = v_org AND rr.retry_of_step_id = s.id))
          END
      ) ORDER BY s.created_at, s.id)
      FROM public.wf_step_run s WHERE s.org_id = v_org AND s.run_id = v_r.id), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id', q.id, 'kind', q.kind, 'actor_kind', q.actor_kind, 'at', q.at, 'step_id', q.step_run_id,
        'detail', public.wf_redact_event_detail(q.detail)) ORDER BY q.id)
      FROM (SELECT e.* FROM public.wf_run_event e
             WHERE e.org_id = v_org AND e.run_id = v_r.id AND e.kind <> 'runtime.state'
               -- A draft whose dispatch keeps failing is noted every few minutes; the timeline shows the latest note
               -- for each draft only, so a draft that never succeeds cannot push everything else out of the window.
               AND (e.kind <> 'draft.dispatch_failed' OR NOT EXISTS (
                     SELECT 1 FROM public.wf_run_event e2
                      WHERE e2.org_id = e.org_id AND e2.run_id = e.run_id AND e2.kind = 'draft.dispatch_failed'
                        AND e2.detail ->> 'draft_id' = e.detail ->> 'draft_id' AND e2.id > e.id))
             ORDER BY e.id DESC LIMIT 200) q), '[]'::jsonb),
    'approvals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'approval_id', a.id, 'step_id', a.step_run_id, 'status', a.status, 'risk', a.risk,
        'required_permission', a.required_permission, 'requested_by_kind', a.requested_by_kind,
        'requested_at', a.requested_at, 'expires_at', a.expires_at, 'decided_at', a.decided_at,
        'approvals', (SELECT count(*) FROM public.wf_approval_decision x
                       WHERE x.approval_id = a.id AND x.decision = 'approve'),
        'required', public.wf_approval_required_count(a.org_id, a.risk, public.wf_approval_category(a.org_id, a.id))
      ) ORDER BY a.requested_at, a.id)
      FROM public.wf_approval a WHERE a.org_id = v_org AND a.run_id = v_r.id), '[]'::jsonb),
    'drafts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'draft_id', d.id, 'step_id', d.step_run_id, 'kind', d.kind, 'category', d.category, 'status', d.status,
        'data_class', d.data_class, 'template_ref', d.template_ref, 'recipient_count', cardinality(d.recipient_ids),
        'has_audience', d.audience_selector IS NOT NULL, 'has_webhook_target', d.webhook_target_id IS NOT NULL,
        'param_count', (SELECT count(*) FROM jsonb_object_keys(d.template_params)),
        'approval_id', d.approval_id, 'created_at', d.created_at) ORDER BY d.created_at, d.id)
      FROM public.wf_action_draft d WHERE d.org_id = v_org AND d.run_id = v_r.id), '[]'::jsonb),
    'outbox', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'outbox_id', o.id, 'step_id', o.step_run_id, 'draft_id', o.draft_id, 'kind', o.kind,
        'category', o.category, 'data_class', o.data_class, 'recipient_count', cardinality(o.recipient_ids),
        'created_at', o.created_at) ORDER BY o.created_at, o.id)
      FROM public.wf_action_sandbox_outbox o WHERE o.org_id = v_org AND o.run_id = v_r.id), '[]'::jsonb)
  );
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Grants: service role only. Internal helpers and the trigger functions get no EXECUTE at all.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.wf_run_retry_guard(),
  public.wf_action_sandbox_outbox_run_guard(),
  public.wf_redact_event_detail(jsonb),
  public.wf_run_control_reason_ok(text),
  public.wf_retry_blockers(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.wf_run_cancel(uuid, uuid, text),
  public.wf_run_retry(uuid, uuid, text),
  public.wf_run_history_list(uuid, text, text, timestamptz, integer, uuid),
  public.wf_run_history_detail(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.wf_run_cancel(uuid, uuid, text),
  public.wf_run_retry(uuid, uuid, text),
  public.wf_run_history_list(uuid, text, text, timestamptz, integer, uuid),
  public.wf_run_history_detail(uuid, uuid)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 8b. Raw reads no longer bypass the redaction (review finding, WF-08 #469)
-- -----------------------------------------------------------------------------
-- WF-01 and WF-06 let any holder of workflows.view SELECT whole rows of these four tables through the API, which
-- returns exactly what this section's functions redact: event payloads and subject references, step input and
-- output, timeline detail, draft parameters and recipients. Nothing in the application reads them with a user
-- token (every reader is a server function that uses the service role or the functions above), so the columns that
-- carry content are no longer readable by `authenticated`. The row policies stay as they were. Selecting `*` as a
-- signed-in person now fails with "permission denied"; selecting the listed columns still works.
REVOKE SELECT ON public.wf_event, public.wf_step_run, public.wf_run_event, public.wf_action_draft FROM authenticated;
GRANT SELECT (id, org_id, event_type, source, dedupe_key, causation_run_id, depth, status, attempts,
              next_attempt_at, occurred_at, created_at, updated_at) ON public.wf_event TO authenticated;
GRANT SELECT (id, org_id, run_id, step_key, iteration, kind, status, attempt, max_attempts, idempotency_key,
              next_attempt_at, resume_at, timeout_seconds, error_code, started_at, finished_at, created_at,
              updated_at, agent_ref, autonomy_level, action_class, budget_units, spent_units)
  ON public.wf_step_run TO authenticated;
GRANT SELECT (id, org_id, run_id, step_run_id, kind, actor_kind, at) ON public.wf_run_event TO authenticated;
GRANT SELECT (id, org_id, run_id, step_run_id, kind, category, template_ref, data_class, status, idempotency_key,
              created_at, updated_at, webhook_target_id, approval_id) ON public.wf_action_draft TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. WF-07 review follow-up: the approval sweep's work list
-- -----------------------------------------------------------------------------
-- (a) An approved draft whose executed record exists but whose step is still waiting (the dispatch was
--     recorded, then the resume failed or the process stopped) was never listed again, so its run waited
--     for ever. It is now listed with needs_dispatch = false: the sweep resumes it and does not dispatch twice.
-- (b) A draft whose dispatch keeps failing sat at the front of the list (oldest first) and, with a full
--     page of them, starved every newer draft. A failure is now noted as a timeline event and the list is
--     ordered by last failure (never failed first), then by age. Notes are throttled to one per five minutes
--     per draft, so a draft that never succeeds cannot flood the timeline.
DROP FUNCTION public.wf_approved_drafts_ready(integer);
CREATE FUNCTION public.wf_approved_drafts_ready(p_limit integer DEFAULT 50)
RETURNS TABLE (org_id uuid, draft_id uuid, needs_dispatch boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.org_id, d.id,
         NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o
                      WHERE o.org_id = d.org_id AND o.draft_id = d.id)
    FROM public.wf_action_draft d
   WHERE d.status = 'approved'
     AND EXISTS (SELECT 1 FROM public.wf_run r
                  WHERE r.org_id = d.org_id AND r.id = d.run_id
                    AND r.status IN ('waiting', 'running'))
     AND (NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o
                       WHERE o.org_id = d.org_id AND o.draft_id = d.id)
          OR EXISTS (SELECT 1 FROM public.wf_step_run s
                      WHERE s.org_id = d.org_id AND s.id = d.step_run_id AND s.status = 'waiting'))
   ORDER BY (SELECT max(e.at) FROM public.wf_run_event e
              WHERE e.org_id = d.org_id AND e.run_id = d.run_id AND e.kind = 'draft.dispatch_failed'
                AND e.detail ->> 'draft_id' = d.id::text) NULLS FIRST,
            d.updated_at, d.id
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

CREATE FUNCTION public.wf_note_draft_dispatch_failure(p_org uuid, p_draft uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_d public.wf_action_draft%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = p_org AND id = p_draft;
  IF NOT FOUND OR v_d.status <> 'approved' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.wf_run_event e
              WHERE e.org_id = p_org AND e.run_id = v_d.run_id AND e.kind = 'draft.dispatch_failed'
                AND e.detail ->> 'draft_id' = p_draft::text AND e.at > now() - interval '5 minutes') THEN
    RETURN false;
  END IF;
  INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail)
  VALUES (p_org, v_d.run_id, v_d.step_run_id, 'draft.dispatch_failed', 'system', 'workflow-approval-sweep',
          jsonb_build_object('draft_id', p_draft));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.wf_approved_drafts_ready(integer), public.wf_note_draft_dispatch_failure(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_approved_drafts_ready(integer), public.wf_note_draft_dispatch_failure(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.wf_run_cancel(uuid, uuid, text) IS
  'WF-08 / ADR-123: stop a queued, running or waiting run. Service role only; the signed-in actor is bound and checked in SQL. Idempotent; audited.';
COMMENT ON FUNCTION public.wf_run_retry(uuid, uuid, text) IS
  'WF-08 / ADR-123: re-run a dead step in a NEW run. Idempotent per dead step; refuses live effects, capped escalation and approved or recorded actions.';
COMMENT ON FUNCTION public.wf_run_history_list(uuid, text, text, timestamptz, integer, uuid) IS
  'WF-08 / ADR-123: redacted, tenant-scoped run list. Counts and codes only.';
COMMENT ON FUNCTION public.wf_run_history_detail(uuid, uuid) IS
  'WF-08 / ADR-123: redacted run detail (steps, timeline, approvals, drafts, outbox). Never returns recipients, parameters, payloads or free text.';
COMMENT ON COLUMN public.wf_run.retry_of_step_id IS
  'WF-08 / ADR-123: the dead step this run resumes. At most one retry run per dead step.';

COMMIT;
