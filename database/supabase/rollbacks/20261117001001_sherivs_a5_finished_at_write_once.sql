-- Rollback for A5: restores the WF-01 guards (without the finished_at rule).
BEGIN;
CREATE OR REPLACE FUNCTION public.wf_run_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v public.wf_version%ROWTYPE; v_parent public.wf_run%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v FROM public.wf_version WHERE id = NEW.version_id;
    IF v.state IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'wf_run: only a published version can run' USING ERRCODE = '23514';
    END IF;
    NEW.max_depth := least(coalesce(NEW.max_depth, v.max_run_depth), v.max_run_depth);
    NEW.max_steps := least(coalesce(NEW.max_steps, v.max_steps_per_run), v.max_steps_per_run);
    NEW.deadline_at := least(coalesce(NEW.deadline_at, now() + make_interval(secs => v.run_timeout_seconds)),
                             now() + make_interval(secs => v.run_timeout_seconds));
    IF NEW.parent_run_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.wf_run WHERE id = NEW.parent_run_id;
      NEW.depth := v_parent.depth + 1;
      NEW.max_depth := least(NEW.max_depth, v_parent.max_depth);
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.definition_id, NEW.version_id, NEW.trigger_binding_id, NEW.event_id, NEW.parent_run_id,
      NEW.idempotency_key, NEW.depth, NEW.max_depth, NEW.max_steps, NEW.started_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.definition_id, OLD.version_id, OLD.trigger_binding_id, OLD.event_id, OLD.parent_run_id,
      OLD.idempotency_key, OLD.depth, OLD.max_depth, OLD.max_steps, OLD.started_by, OLD.created_at) THEN
    RAISE EXCEPTION 'wf_run: identity and limit fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'wf_run: a finished run cannot change status' USING ERRCODE = '42501';
  END IF;
  IF NEW.step_count < OLD.step_count THEN
    RAISE EXCEPTION 'wf_run: step_count only grows' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION public.wf_step_run_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.run_id, NEW.step_key, NEW.iteration, NEW.kind, NEW.idempotency_key, NEW.max_attempts, NEW.created_at)
     IS DISTINCT FROM
     (OLD.run_id, OLD.step_key, OLD.iteration, OLD.kind, OLD.idempotency_key, OLD.max_attempts, OLD.created_at) THEN
    RAISE EXCEPTION 'wf_step_run: identity fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.attempt < OLD.attempt THEN
    RAISE EXCEPTION 'wf_step_run: attempt only grows' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('succeeded', 'dead', 'skipped', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'wf_step_run: a finished step cannot change status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
COMMIT;
