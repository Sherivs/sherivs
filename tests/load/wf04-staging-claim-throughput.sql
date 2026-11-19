-- WF-04 staging-only workflow claim throughput probe. Run in a transaction-capable SQL client.
-- The final exception is intentional: it reports the measurement and rolls back every fixture.
BEGIN;

DO $wf04$
DECLARE
  v_org constant uuid := 'f0404000-0000-4000-8000-000000000001';
  v_definition constant uuid := 'f0414000-0000-4000-8000-000000000001';
  v_version constant uuid := 'f0424000-0000-4000-8000-000000000001';
  v_run constant uuid := 'f0454000-0000-4000-8000-000000000001';
  v_started timestamptz := clock_timestamp();
  v_steps integer := 250;
  v_claimed integer := 0;
  v_batch integer;
  v_step public.wf_step_run%ROWTYPE;
  v_elapsed_ms numeric;
  v_per_minute numeric;
BEGIN
  IF to_regclass('public.wf02_staging_shim_marker') IS NULL
     OR to_regclass('public.payment_intents') IS NOT NULL THEN
    RAISE EXCEPTION 'WF04-STAGING refused: expected WF-02 staging shim and no payment_intents';
  END IF;
  IF to_regclass('public.wf_org_settings') IS NULL
     OR to_regprocedure('public.wf_claim_due_steps(text,integer,integer)') IS NULL
     OR to_regprocedure('public.wf_persist_step_transition(uuid,text,integer,text,timestamp with time zone,text,text,timestamp with time zone,jsonb,text,integer,text,text,integer,text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'WF04-STAGING refused: WF-03 runtime is not installed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_org_settings WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.wf_definition WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.wf_run WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'WF04-STAGING refused: synthetic fixture id already exists';
  END IF;

  INSERT INTO public.wf_org_settings (org_id, workflows_enabled)
    VALUES (v_org, true);
  INSERT INTO public.wf_definition (id, org_id, key, name)
    VALUES (v_definition, v_org, 'wf04-staging', 'Synthetic WF-04 staging throughput');
  INSERT INTO public.wf_version
    (id, org_id, definition_id, version, graph, created_by, updated_by)
  VALUES (
    v_version, v_org, v_definition, 1,
    '{"steps":[{"stepId":"work","kind":"action","assignment":{"kind":"unassigned"},"authorizedActions":["wf04.synthetic.noop"],"actionClass":"internal"}]}'::jsonb,
    'f0444000-0000-4000-8000-000000000001',
    'f0444000-0000-4000-8000-000000000002'
  );
  UPDATE public.wf_version
     SET state = 'published', published_by = 'f0444000-0000-4000-8000-000000000003'
   WHERE id = v_version;
  UPDATE public.wf_definition SET current_version_id = v_version WHERE id = v_definition;
  INSERT INTO public.wf_run
    (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
     deadline_at, started_at)
  VALUES
    (v_run, v_org, v_definition, v_version, 'wf04-staging-run-0001', 'running', 0,
     v_steps, clock_timestamp() + interval '30 minutes', clock_timestamp());
  INSERT INTO public.wf_step_run
    (org_id, run_id, step_key, iteration, kind, idempotency_key, next_attempt_at)
  SELECT v_org, v_run, 'work-' || lpad(g::text, 3, '0'), 0, 'action',
         'wf04-staging-step-' || lpad(g::text, 3, '0'), now() - interval '1 second'
    FROM generate_series(1, v_steps) AS g;

  -- wf_claim_due_steps compares next_attempt_at with now(), which is the transaction start time,
  -- so fixture steps are back-dated to be due inside this single transaction.
  LOOP
    v_batch := 0;
    FOR v_step IN SELECT * FROM public.wf_claim_due_steps('wf04-staging-probe', 50, 60)
    LOOP
      PERFORM public.wf_persist_step_transition(
        v_step.id, v_step.lease_owner, v_step.attempt, 'succeeded',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      v_claimed := v_claimed + 1;
      v_batch := v_batch + 1;
    END LOOP;
    EXIT WHEN v_batch = 0;
  END LOOP;

  v_elapsed_ms := greatest(
    1,
    extract(epoch FROM clock_timestamp() - v_started) * 1000
  );
  v_per_minute := round(v_claimed * 60000 / v_elapsed_ms, 2);
  RAISE EXCEPTION 'WF04-STAGING RESULT: steps=% elapsed_ms=% steps_per_minute=%; transaction rolled back',
    v_claimed, round(v_elapsed_ms, 2), v_per_minute;
END
$wf04$;
