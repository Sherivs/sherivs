-- WF-07b approved approval-step resume: claim rules, leases, dead-ending and the role check.
-- Local disposable Postgres only. All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF07R FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.wf_claim_approved_steps(text,integer,integer)') IS NULL
     OR to_regprocedure('public.wf_approver_holds_role(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'WF07R FAIL: WF-07b migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf07r;
GRANT USAGE ON SCHEMA wf07r TO anon, authenticated, service_role;
CREATE TABLE wf07r.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE wf07r.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON wf07r.passed, wf07r.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf07r.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION wf07r.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf07r.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF07R PASS %', p_label;
END $$;
CREATE FUNCTION wf07r.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF07R FAIL [%]', p_label; END IF;
  PERFORM wf07r.pass(p_label);
END $$;
CREATE FUNCTION wf07r.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM wf07r.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF07R FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF07R FAIL [%]: statement was allowed but must fail with %', p_label, p_state;
END $$;
CREATE FUNCTION wf07r.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM wf07r.ids WHERE name = p_name
$$;
CREATE FUNCTION wf07r.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf07r TO anon, authenticated, service_role;

INSERT INTO wf07r.ids (name, id) VALUES
  ('orgA', 'f0b00000-0000-4000-8000-0000000000a1'),
  ('orgOff', 'f0b00000-0000-4000-8000-0000000000b2'),
  ('starter', 'f0b00000-0000-4000-8000-000000000001'),
  ('author', 'f0b00000-0000-4000-8000-000000000002'),
  ('publisher', 'f0b00000-0000-4000-8000-000000000003'),
  ('approver', 'f0b00000-0000-4000-8000-000000000004'),
  ('outsider', 'f0b00000-0000-4000-8000-000000000005');

-- 1. Structure and privileges
SELECT wf07r.expect_true('both functions are SECURITY INVOKER with an empty search_path',
  (SELECT bool_and(NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_claim_approved_steps', 'wf_approver_holds_role')));
SELECT wf07r.expect_true('both functions execute for the service role only',
  (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE')) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_claim_approved_steps', 'wf_approver_holds_role'))
  AND (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('wf_claim_approved_steps', 'wf_approver_holds_role')));

-- 2. Fixtures
INSERT INTO auth.users (id) SELECT id FROM wf07r.ids WHERE name NOT IN ('orgA', 'orgOff');
INSERT INTO public.schools (id, name, slug) VALUES
  (wf07r.id('orgA'), 'WF07R Org A', 'wf07r-org-a'),
  (wf07r.id('orgOff'), 'WF07R Org Off', 'wf07r-org-off');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (wf07r.id('starter'), wf07r.id('orgA'), 'WF07R Starter', 'starter@wf07r.invalid', 'admin', true),
  (wf07r.id('author'), wf07r.id('orgA'), 'WF07R Author', 'author@wf07r.invalid', 'admin', true),
  (wf07r.id('publisher'), wf07r.id('orgA'), 'WF07R Publisher', 'publisher@wf07r.invalid', 'admin', true),
  (wf07r.id('approver'), wf07r.id('orgA'), 'WF07R Approver', 'approver@wf07r.invalid', 'teacher', true),
  (wf07r.id('outsider'), wf07r.id('orgA'), 'WF07R Outsider', 'outsider@wf07r.invalid', 'teacher', true);
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (wf07r.id('orgA'), true, 'act_and_report'),
  (wf07r.id('orgOff'), false, 'act_and_report');

INSERT INTO public.wf_definition (id, org_id, key, name) VALUES
  ('f0b10000-0000-4000-8000-0000000000a1', wf07r.id('orgA'), 'wf07r-a', 'WF07R A'),
  ('f0b10000-0000-4000-8000-0000000000b2', wf07r.id('orgOff'), 'wf07r-off', 'WF07R Off');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by) VALUES
  ('f0b20000-0000-4000-8000-0000000000a1', wf07r.id('orgA'), 'f0b10000-0000-4000-8000-0000000000a1', 1, '{"steps":[]}', wf07r.id('author')),
  ('f0b20000-0000-4000-8000-0000000000b2', wf07r.id('orgOff'), 'f0b10000-0000-4000-8000-0000000000b2', 1, '{"steps":[]}', wf07r.id('author'));
UPDATE public.wf_version SET state = 'published', published_by = wf07r.id('publisher')
 WHERE id IN ('f0b20000-0000-4000-8000-0000000000a1', 'f0b20000-0000-4000-8000-0000000000b2');

-- A run in 'waiting' with one approval step and one approval row, in the requested state.
CREATE FUNCTION wf07r.mk(p_name text, p_org text, p_version uuid, p_approval text, p_run_status text DEFAULT 'waiting',
  p_deadline interval DEFAULT interval '1 hour') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_run uuid := gen_random_uuid(); v_step uuid := gen_random_uuid(); v_def uuid;
BEGIN
  SELECT definition_id INTO v_def FROM public.wf_version WHERE id = p_version;
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
    deadline_at, started_at)
  VALUES (v_run, wf07r.id(p_org), v_def, p_version, 'wf07r-run-' || p_name, 'running', 2, 20,
    now() + p_deadline, now());
  INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, status)
  VALUES (v_step, wf07r.id(p_org), v_run, 'approve', 'approval', 'wf07r-step-' || p_name, 'waiting');
  INSERT INTO public.wf_approval (id, org_id, run_id, step_run_id, summary, requested_by_kind, requested_by_ref, expires_at)
  VALUES (gen_random_uuid(), wf07r.id(p_org), v_run, v_step, 'WF07R ' || p_name, 'system', 'workflow-runtime',
    now() + interval '7 days');
  IF p_approval = 'approved' THEN
    SET LOCAL session_replication_role = replica;
    UPDATE public.wf_approval SET status = 'approved', decided_by = wf07r.id('approver'), decided_at = now(),
      decision_channel = 'console' WHERE step_run_id = v_step;
    SET LOCAL session_replication_role = origin;
  ELSIF p_approval = 'rejected' THEN
    SET LOCAL session_replication_role = replica;
    UPDATE public.wf_approval SET status = 'rejected', decided_by = wf07r.id('approver'), decided_at = now(),
      decision_channel = 'console' WHERE step_run_id = v_step;
    SET LOCAL session_replication_role = origin;
  END IF;
  UPDATE public.wf_run SET status = p_run_status,
    finished_at = CASE WHEN p_run_status IN ('succeeded', 'failed', 'cancelled', 'timed_out') THEN now() END
   WHERE id = v_run;
  INSERT INTO wf07r.ids VALUES (p_name || '_run', v_run), (p_name || '_step', v_step);
  RETURN v_step;
END $$;

SELECT wf07r.mk('ok', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'approved');
SELECT wf07r.mk('pend', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'pending');
SELECT wf07r.mk('rej', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'rejected');
SELECT wf07r.mk('canc', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'approved', 'cancelled');
SELECT wf07r.mk('late', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'approved', 'waiting', interval '-1 minute');
SELECT wf07r.mk('off', 'orgOff', 'f0b20000-0000-4000-8000-0000000000b2', 'approved');
SELECT wf07r.mk('drf', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'approved');

-- A draft that rides on the 'drf' approval: such approvals belong to the draft executor.
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, status)
VALUES (gen_random_uuid(), wf07r.id('orgA'), wf07r.id('drf_run'), 'send', 'action', 'wf07r-step-drf-send', 'pending');
INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status)
VALUES (wf07r.id('orgA'), 'in_app', 'notice.r', 'Hello.', ARRAY[]::text[], 'approved');
SET LOCAL session_replication_role = replica;
INSERT INTO public.wf_action_draft (id, org_id, run_id, step_run_id, kind, category, template_ref,
  template_params, recipient_ids, data_class, idempotency_key, approval_id)
SELECT gen_random_uuid(), wf07r.id('orgA'), wf07r.id('drf_run'), s.id, 'in_app', 'communication', 'notice.r',
  '{}', '{}', 'internal', 'wf07r-draft-drf',
  (SELECT a.id FROM public.wf_approval a WHERE a.step_run_id = wf07r.id('drf_step'))
  FROM public.wf_step_run s WHERE s.idempotency_key = 'wf07r-step-drf-send';
SET LOCAL session_replication_role = origin;

-- 3. Claim rules
SELECT wf07r.login_as('service_role');
CREATE TEMP TABLE claimed ON COMMIT DROP AS SELECT * FROM public.wf_claim_approved_steps('worker-r1', 50, 60);
RESET ROLE;
SELECT wf07r.expect_true('the approved approval step is claimed and leased to the worker',
  EXISTS (SELECT 1 FROM claimed c WHERE c.id = wf07r.id('ok_step') AND c.status = 'claimed'
           AND c.lease_owner = 'worker-r1' AND c.attempt = 1 AND c.lease_expires_at > now()));
SELECT wf07r.expect_true('only the approved, draft-less approval step in an enabled, live, waiting run is claimed',
  (SELECT count(*) = 1 FROM claimed));
SELECT wf07r.expect_true('pending, rejected, cancelled-run, past-deadline, disabled-org and draft-linked steps stay untouched',
  (SELECT bool_and(s.status IN ('waiting', 'cancelled') AND s.lease_owner IS NULL) FROM public.wf_step_run s
    WHERE s.id IN (wf07r.id('pend_step'), wf07r.id('rej_step'), wf07r.id('canc_step'), wf07r.id('late_step'),
                   wf07r.id('off_step'), wf07r.id('drf_step'))));
SELECT wf07r.login_as('service_role');
SELECT wf07r.expect_true('a leased step is not claimed twice',
  (SELECT count(*) = 0 FROM public.wf_claim_approved_steps('worker-r2', 50, 60)));
RESET ROLE;
SELECT wf07r.expect_error('a worker id is required',
  $q$SELECT * FROM public.wf_claim_approved_steps('', 5, 60)$q$, '22023');

-- 4. Persisting the resumed step moves the run on, and a stale lease cannot
CREATE TEMP TABLE wf07r_persist (label text, persisted boolean) ON COMMIT DROP;
INSERT INTO wf07r_persist
SELECT 'wrong', persisted FROM public.wf_persist_step_transition(wf07r.id('ok_step'), 'worker-other', 1, 'succeeded',
  NULL, NULL, 'succeeded', now(), '{"state":"completed"}'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
SELECT wf07r.expect_true('a persist with the wrong lease owner changes nothing',
  (SELECT NOT persisted FROM wf07r_persist WHERE label = 'wrong')
  AND (SELECT status = 'claimed' FROM public.wf_step_run WHERE id = wf07r.id('ok_step'))
  AND (SELECT status = 'waiting' FROM public.wf_run WHERE id = wf07r.id('ok_run')));
INSERT INTO wf07r_persist
SELECT 'right', persisted FROM public.wf_persist_step_transition(wf07r.id('ok_step'), 'worker-r1', 1, 'succeeded',
  NULL, NULL, 'succeeded', now(), '{"state":"completed"}'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
SELECT wf07r.expect_true('a persist with the lease completes the step and the run',
  (SELECT persisted FROM wf07r_persist WHERE label = 'right')
  AND (SELECT status = 'succeeded' AND finished_at IS NOT NULL FROM public.wf_step_run WHERE id = wf07r.id('ok_step'))
  AND (SELECT status = 'succeeded' AND finished_at IS NOT NULL FROM public.wf_run WHERE id = wf07r.id('ok_run')));
SELECT wf07r.login_as('service_role');
SELECT wf07r.expect_true('a finished step is never claimed again',
  (SELECT count(*) = 0 FROM public.wf_claim_approved_steps('worker-r3', 50, 60)));
RESET ROLE;

-- 5. Expired leases
SELECT wf07r.mk('lease', 'orgA', 'f0b20000-0000-4000-8000-0000000000a1', 'approved');
SELECT wf07r.login_as('service_role');
SELECT count(*) FROM public.wf_claim_approved_steps('worker-r4', 50, 60);
RESET ROLE;
UPDATE public.wf_step_run SET lease_expires_at = now() - interval '1 second' WHERE id = wf07r.id('lease_step');
SELECT wf07r.login_as('service_role');
CREATE TEMP TABLE reclaimed ON COMMIT DROP AS SELECT * FROM public.wf_claim_approved_steps('worker-r5', 50, 60);
RESET ROLE;
SELECT wf07r.expect_true('a step whose lease expired is claimed again by the next worker with a higher attempt',
  EXISTS (SELECT 1 FROM reclaimed c WHERE c.id = wf07r.id('lease_step') AND c.lease_owner = 'worker-r5' AND c.attempt = 2));
UPDATE public.wf_step_run SET lease_expires_at = now() - interval '1 second', attempt = max_attempts
 WHERE id = wf07r.id('lease_step');
SELECT wf07r.login_as('service_role');
SELECT count(*) FROM public.wf_claim_approved_steps('worker-r6', 50, 60);
RESET ROLE;
SELECT wf07r.expect_true('a lease that expires on the last attempt ends the step and fails the run',
  (SELECT status = 'dead' AND error_code = 'lease.expired' FROM public.wf_step_run WHERE id = wf07r.id('lease_step'))
  AND (SELECT status = 'failed' FROM public.wf_run WHERE id = wf07r.id('lease_run')));

-- 6. Client roles cannot call either function
SELECT wf07r.login_as('authenticated');
SELECT wf07r.expect_error('authenticated cannot claim approved steps',
  $q$SELECT * FROM public.wf_claim_approved_steps('worker-x', 5, 60)$q$, '42501');
SELECT wf07r.expect_error('authenticated cannot ask the role question',
  $q$SELECT public.wf_approver_holds_role(NULL, NULL, 'x')$q$, '42501');
SELECT wf07r.login_as('anon');
SELECT wf07r.expect_error('anon cannot claim approved steps',
  $q$SELECT * FROM public.wf_claim_approved_steps('worker-x', 5, 60)$q$, '42501');
RESET ROLE;

-- 7. The role the definition names
SELECT wf07r.expect_true('empty inputs never hold a role',
  NOT public.wf_approver_holds_role(NULL, wf07r.id('approver'), 'auditor')
  AND NOT public.wf_approver_holds_role(wf07r.id('orgA'), NULL, 'auditor')
  AND NOT public.wf_approver_holds_role(wf07r.id('orgA'), wf07r.id('approver'), NULL));
SELECT wf07r.expect_true('a user with no assignment holds no role',
  NOT public.wf_approver_holds_role(wf07r.id('orgA'), wf07r.id('outsider'), 'auditor'));
CREATE TEMP TABLE wf07r_role ON COMMIT DROP AS
  SELECT r.code FROM public.role_catalog r WHERE r.org_id IS NULL AND r.template_code = 'auditor'
     AND NOT coalesce(r.requires_verified_authority_link, false) ORDER BY r.code LIMIT 1;
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT wf07r.id('orgA'), wf07r.id('approver'), c.code, 'org', NULL, wf07r.id('starter') FROM wf07r_role c;
SET LOCAL session_replication_role = origin;
SELECT wf07r.expect_true('a user with the assignment holds that role in that organization only',
  public.wf_approver_holds_role(wf07r.id('orgA'), wf07r.id('approver'), (SELECT code FROM wf07r_role))
  AND NOT public.wf_approver_holds_role(wf07r.id('orgOff'), wf07r.id('approver'), (SELECT code FROM wf07r_role))
  AND NOT public.wf_approver_holds_role(wf07r.id('orgA'), wf07r.id('approver'), 'not_a_role'));

SELECT 'WF07R ALL PASS: ' || count(*) || ' checks' FROM wf07r.passed;
ROLLBACK;
