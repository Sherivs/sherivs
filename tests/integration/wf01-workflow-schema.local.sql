-- WF-01 workflow engine schema: tenant isolation, RLS, immutability, limits, audit and claiming.
-- Synthetic data only. Always rolls back; nothing it creates survives.
--
-- Two places may run it:
--   1. The LOCAL disposable sim database (CI "Migration dry-run" job), after all migrations:
--        psql "postgresql://postgres@127.0.0.1:54329/postgres" -v ON_ERROR_STOP=1 \
--          -f tests/integration/wf01-workflow-schema.local.sql
--      Success prints "WF01 ALL PASS" and the transaction is rolled back.
--   2. The STAGING project only, after tests/integration/wf01-staging-prereq-shim.sql and the
--      WF-01 migration. There the last statement raises "WF01 ALL PASS ... (rolled back)" on
--      purpose, so the whole run is undone even through a client that cannot send ROLLBACK.
-- It refuses any other database (production has neither the loopback address nor the marker).
BEGIN;

DO $guard$
DECLARE v_local boolean; v_staging boolean;
BEGIN
  v_local := coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
             AND inet_server_addr() IS NOT NULL
             AND (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet);
  v_staging := to_regclass('public.wf01_staging_shim_marker') IS NOT NULL;
  IF NOT (v_local OR v_staging) THEN
    RAISE EXCEPTION 'WF01 FAIL: refusing to run outside the local sim or the marked staging project';
  END IF;
  IF to_regclass('public.wf_definition') IS NULL OR to_regclass('public.wf_approval') IS NULL THEN
    RAISE EXCEPTION 'WF01 FAIL: the WF-01 migration is not applied';
  END IF;
END $guard$;

CREATE SCHEMA wf01t;
GRANT USAGE ON SCHEMA wf01t TO anon, authenticated, service_role;
CREATE TABLE wf01t.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE wf01t.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT ON wf01t.ids TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON wf01t.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf01t.passed_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION wf01t.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM wf01t.ids WHERE name = p $$;
CREATE FUNCTION wf01t.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION wf01t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wf01t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
CREATE FUNCTION wf01t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf01t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF01 PASS %', p_label;
END $$;
-- Row count of a query, under the caller's current role.
CREATE FUNCTION wf01t.expect_count(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'WF01 FAIL [%]: expected % rows, got %', p_label, p_expected, v;
  END IF;
  PERFORM wf01t.pass(p_label);
END $$;
-- Statement must fail with the given SQLSTATE.
CREATE FUNCTION wf01t.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM wf01t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF01 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF01 FAIL [%]: statement was allowed but must fail with %', p_label, p_state;
END $$;
-- UPDATE/DELETE must touch exactly p_expected rows.
CREATE FUNCTION wf01t.expect_rows(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'WF01 FAIL [%]: expected % rows affected, got %', p_label, p_expected, v;
  END IF;
  PERFORM wf01t.pass(p_label);
END $$;
CREATE FUNCTION wf01t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF01 FAIL [%]', p_label; END IF;
  PERFORM wf01t.pass(p_label);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf01t TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Catalog posture
-- -----------------------------------------------------------------------------
SELECT wf01t.expect_count('rls enabled and forced on all 8 tables',
  $q$SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('wf_definition','wf_version','wf_trigger_binding','wf_event',
            'wf_run','wf_step_run','wf_run_event','wf_approval') AND c.relrowsecurity AND c.relforcerowsecurity$q$, 8);
SELECT wf01t.expect_count('anon holds no privilege on any workflow table',
  $q$SELECT 1 FROM unnest(ARRAY['wf_definition','wf_version','wf_trigger_binding','wf_event','wf_run','wf_step_run',
        'wf_run_event','wf_approval']) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE has_table_privilege('anon', 'public.' || t, p)$q$, 0);
SELECT wf01t.expect_count('authenticated cannot DELETE or TRUNCATE any workflow table',
  $q$SELECT 1 FROM unnest(ARRAY['wf_definition','wf_version','wf_trigger_binding','wf_event','wf_run','wf_step_run',
        'wf_run_event','wf_approval']) t, unnest(ARRAY['DELETE','TRUNCATE']) p
      WHERE has_table_privilege('authenticated', 'public.' || t, p)$q$, 0);
SELECT wf01t.expect_count('authenticated cannot write runs, steps, events, run timeline or approvals',
  $q$SELECT 1 FROM unnest(ARRAY['wf_event','wf_run','wf_step_run','wf_run_event','wf_approval']) t,
        unnest(ARRAY['INSERT','UPDATE']) p WHERE has_table_privilege('authenticated', 'public.' || t, p)$q$, 0);
SELECT wf01t.expect_count('run timeline: service role cannot UPDATE or DELETE',
  $q$SELECT 1 FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) p WHERE has_table_privilege('service_role', 'public.wf_run_event', p)$q$, 0);
SELECT wf01t.expect_true('claim function: service role only',
  has_function_privilege('service_role', 'public.wf_claim_due_steps(text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_claim_due_steps(text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.wf_claim_due_steps(text,integer,integer)', 'EXECUTE'));
SELECT wf01t.expect_true('audit writer: no client role may call it directly',
  NOT has_function_privilege('authenticated', 'public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)', 'EXECUTE'));
SELECT wf01t.expect_true('wf_can: anon cannot execute',
  NOT has_function_privilege('anon', 'public.wf_can(uuid,text)', 'EXECUTE'));
SELECT wf01t.expect_count('every workflow policy targets authenticated only (no anon, no public)',
  $q$SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('wf_definition','wf_version','wf_trigger_binding','wf_event','wf_run','wf_step_run','wf_run_event','wf_approval')
      AND roles <> '{authenticated}'$q$, 0);
SELECT wf01t.expect_count('definer functions pin search_path',
  $q$SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'wf\_%' AND (p.proconfig IS NULL
        OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))$q$, 0);

-- -----------------------------------------------------------------------------
-- 2. Synthetic identities: two organizations, an admin in each, a member without the
--    workflow permission, and a read-only platform reader.
-- -----------------------------------------------------------------------------
INSERT INTO wf01t.ids VALUES
  ('orgA', 'f0100000-0000-4000-8000-0000000000a1'), ('orgB', 'f0100000-0000-4000-8000-0000000000b2'),
  ('adminA', 'f0100000-0000-4000-8000-000000000001'), ('memberA', 'f0100000-0000-4000-8000-000000000002'),
  ('adminB', 'f0100000-0000-4000-8000-000000000003'), ('reader', 'f0100000-0000-4000-8000-000000000004');
INSERT INTO auth.users (id) SELECT id FROM wf01t.ids WHERE name IN ('adminA','memberA','adminB','reader');
INSERT INTO public.schools (id, name, slug) VALUES
  (wf01t.id('orgA'), 'WF01 Synthetic Org A', 'wf01-synthetic-a'),
  (wf01t.id('orgB'), 'WF01 Synthetic Org B', 'wf01-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (wf01t.id('adminA'), wf01t.id('orgA'), 'WF01 Admin A', 'admin-a@wf01.invalid', 'admin', true),
  (wf01t.id('memberA'), wf01t.id('orgA'), 'WF01 Member A', 'member-a@wf01.invalid', 'teacher', true),
  (wf01t.id('adminB'), wf01t.id('orgB'), 'WF01 Admin B', 'admin-b@wf01.invalid', 'admin', true);
INSERT INTO public.platform_staff (id, email, full_name, status)
  VALUES (wf01t.id('reader'), 'reader@wf01.invalid', 'WF01 Platform Reader', 'active');
INSERT INTO public.platform_staff_roles (staff_id, role_code) VALUES (wf01t.id('reader'), 'support');

-- -----------------------------------------------------------------------------
-- 3. Seed as the service role (the runtime): one published workflow per organization.
-- -----------------------------------------------------------------------------
SELECT wf01t.login_as('service_role');
INSERT INTO public.wf_definition (id, org_id, key, name) VALUES
  ('f0110000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'overdue-reminder', 'A reminder'),
  ('f0110000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'overdue-reminder', 'B reminder');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by) VALUES
  ('f0120000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'f0110000-0000-4000-8000-0000000000a1', 1, '{"steps":[{"id":"s1"}]}', wf01t.id('adminA')),
  ('f0120000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'f0110000-0000-4000-8000-0000000000b2', 1, '{"steps":[{"id":"s1"}]}', wf01t.id('memberA')),
  ('f0120000-0000-4000-8000-0000000000a2', wf01t.id('orgA'), 'f0110000-0000-4000-8000-0000000000a1', 2, '{"steps":[]}', wf01t.id('adminA'));
UPDATE public.wf_version SET state = 'published', published_by = 'f0100000-0000-4000-8000-000000000003'
 WHERE id IN ('f0120000-0000-4000-8000-0000000000a1', 'f0120000-0000-4000-8000-0000000000b2');
UPDATE public.wf_definition SET current_version_id = 'f0120000-0000-4000-8000-0000000000a1' WHERE id = 'f0110000-0000-4000-8000-0000000000a1';
UPDATE public.wf_definition SET current_version_id = 'f0120000-0000-4000-8000-0000000000b2' WHERE id = 'f0110000-0000-4000-8000-0000000000b2';
INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled) VALUES
  ('f0130000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'f0110000-0000-4000-8000-0000000000a1', 'event', 'billing.invoice.overdue', true),
  ('f0130000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'f0110000-0000-4000-8000-0000000000b2', 'event', 'billing.invoice.overdue', true);
INSERT INTO public.wf_event (id, org_id, event_type, source, dedupe_key) VALUES
  ('f0140000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'billing.invoice.overdue', 'billing', 'invoice:A-1:overdue'),
  ('f0140000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'billing.invoice.overdue', 'billing', 'invoice:B-1:overdue');
INSERT INTO public.wf_run (id, org_id, definition_id, version_id, trigger_binding_id, event_id, idempotency_key, status, started_at) VALUES
  ('f0150000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'f0110000-0000-4000-8000-0000000000a1', 'f0120000-0000-4000-8000-0000000000a1',
   'f0130000-0000-4000-8000-0000000000a1', 'f0140000-0000-4000-8000-0000000000a1', 'event:f0140000-a1', 'running', now()),
  ('f0150000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'f0110000-0000-4000-8000-0000000000b2', 'f0120000-0000-4000-8000-0000000000b2',
   'f0130000-0000-4000-8000-0000000000b2', 'f0140000-0000-4000-8000-0000000000b2', 'event:f0140000-b2', 'running', now());
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key) VALUES
  ('f0160000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'f0150000-0000-4000-8000-0000000000a1', 's1', 'approval', 'run-a1:s1:0'),
  ('f0160000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'f0150000-0000-4000-8000-0000000000b2', 's1', 'approval', 'run-b2:s1:0');
INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref) VALUES
  (wf01t.id('orgA'), 'f0150000-0000-4000-8000-0000000000a1', 'run.started', 'system', 'service'),
  (wf01t.id('orgB'), 'f0150000-0000-4000-8000-0000000000b2', 'run.started', 'system', 'service');
INSERT INTO public.wf_approval (id, org_id, run_id, step_run_id, summary, requested_by_kind, requested_by_ref, expires_at) VALUES
  ('f0170000-0000-4000-8000-0000000000a1', wf01t.id('orgA'), 'f0150000-0000-4000-8000-0000000000a1', 'f0160000-0000-4000-8000-0000000000a1',
   'Send reminder batch', 'user', 'f0100000-0000-4000-8000-000000000002', now() + interval '1 day'),
  ('f0170000-0000-4000-8000-0000000000b2', wf01t.id('orgB'), 'f0150000-0000-4000-8000-0000000000b2', 'f0160000-0000-4000-8000-0000000000b2',
   'Send reminder batch', 'agent', 'agent:reminders', now() + interval '1 day');
SELECT wf01t.pass('service role seeded both organizations');

-- Cross-tenant references are impossible even for the service role (composite foreign keys).
SELECT wf01t.expect_error('fk: step in org B cannot point at a run in org A',
  $q$INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key)
     VALUES ('f0100000-0000-4000-8000-0000000000b2', 'f0150000-0000-4000-8000-0000000000a1', 's9', 'action', 'cross-tenant-step')$q$, '23503');
SELECT wf01t.expect_error('fk: version in org B cannot attach to a definition in org A',
  $q$INSERT INTO public.wf_version (org_id, definition_id, version, created_by)
     VALUES ('f0100000-0000-4000-8000-0000000000b2', 'f0110000-0000-4000-8000-0000000000a1', 9,
             'f0100000-0000-4000-8000-000000000001')$q$, '23503');
SELECT wf01t.expect_error('approval in org A cannot reference a step in org B (guard fires before the composite FK)',
  $q$INSERT INTO public.wf_approval (org_id, run_id, step_run_id, summary, requested_by_kind, requested_by_ref, expires_at)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0150000-0000-4000-8000-0000000000a1', 'f0160000-0000-4000-8000-0000000000b2',
             'x', 'system', 'service', now() + interval '1 hour')$q$, '23514');
SELECT wf01t.expect_error('fk: definition cannot point its current version at another organization',
  $q$UPDATE public.wf_definition SET current_version_id = 'f0120000-0000-4000-8000-0000000000b2'
      WHERE id = 'f0110000-0000-4000-8000-0000000000a1'$q$, '23503');
SELECT wf01t.expect_error('immutable org_id: the service role cannot move a run to another organization',
  $q$UPDATE public.wf_run SET org_id = 'f0100000-0000-4000-8000-0000000000b2' WHERE id = 'f0150000-0000-4000-8000-0000000000a1'$q$, '42501');

-- -----------------------------------------------------------------------------
-- 4. Organization A administrator: sees only A, writes only A.
-- -----------------------------------------------------------------------------
SELECT wf01t.login(wf01t.id('adminA'));
SELECT wf01t.expect_count('adminA reads A definitions', 'SELECT 1 FROM public.wf_definition', 1);
SELECT wf01t.expect_count('adminA reads no B definitions',
  $q$SELECT 1 FROM public.wf_definition WHERE org_id = 'f0100000-0000-4000-8000-0000000000b2'$q$, 0);
SELECT wf01t.expect_count('adminA reads only A versions', 'SELECT 1 FROM public.wf_version WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA reads only A triggers', 'SELECT 1 FROM public.wf_trigger_binding WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA reads only A events', 'SELECT 1 FROM public.wf_event WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA reads only A runs', 'SELECT 1 FROM public.wf_run WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA reads only A steps', 'SELECT 1 FROM public.wf_step_run WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA reads only A run timeline', 'SELECT 1 FROM public.wf_run_event WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA reads only A approvals', 'SELECT 1 FROM public.wf_approval WHERE org_id <> wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_count('adminA sees its own run', 'SELECT 1 FROM public.wf_run', 1);
SELECT wf01t.expect_count('adminA: B run invisible by id',
  $q$SELECT 1 FROM public.wf_run WHERE id = 'f0150000-0000-4000-8000-0000000000b2'$q$, 0);

SELECT wf01t.expect_error('adminA cannot create a definition in org B',
  $q$INSERT INTO public.wf_definition (org_id, key, name) VALUES ('f0100000-0000-4000-8000-0000000000b2', 'planted', 'x')$q$, '42501');
SELECT wf01t.expect_rows('adminA update of a B definition touches nothing',
  $q$UPDATE public.wf_definition SET name = 'hijack' WHERE id = 'f0110000-0000-4000-8000-0000000000b2'$q$, 0);
SELECT wf01t.expect_rows('adminA update of a B trigger touches nothing',
  $q$UPDATE public.wf_trigger_binding SET enabled = false WHERE id = 'f0130000-0000-4000-8000-0000000000b2'$q$, 0);
SELECT wf01t.expect_error('adminA cannot move an A definition into org B',
  $q$UPDATE public.wf_definition SET org_id = 'f0100000-0000-4000-8000-0000000000b2' WHERE id = 'f0110000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('adminA cannot add a draft version to a B definition',
  $q$INSERT INTO public.wf_version (org_id, definition_id, version)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0110000-0000-4000-8000-0000000000b2', 7)$q$, '23503');
SELECT wf01t.expect_error('adminA cannot add a draft version under org B',
  $q$INSERT INTO public.wf_version (org_id, definition_id, version)
     VALUES ('f0100000-0000-4000-8000-0000000000b2', 'f0110000-0000-4000-8000-0000000000b2', 7)$q$, '42501');
SELECT wf01t.expect_error('adminA cannot add a trigger under org B',
  $q$INSERT INTO public.wf_trigger_binding (org_id, definition_id, kind)
     VALUES ('f0100000-0000-4000-8000-0000000000b2', 'f0110000-0000-4000-8000-0000000000b2', 'manual')$q$, '42501');
SELECT wf01t.expect_error('adminA cannot start a run (service only)',
  $q$INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, max_depth, max_steps, deadline_at)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0110000-0000-4000-8000-0000000000a1',
             'f0120000-0000-4000-8000-0000000000a1', 'manual:planted', 1, 1, now() + interval '1 hour')$q$, '42501');
SELECT wf01t.expect_error('adminA cannot write steps',
  $q$UPDATE public.wf_step_run SET status = 'succeeded' WHERE id = 'f0160000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('adminA cannot decide an approval directly',
  $q$UPDATE public.wf_approval SET status = 'approved' WHERE id = 'f0170000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('adminA cannot delete anything',
  $q$DELETE FROM public.wf_definition WHERE id = 'f0110000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('adminA cannot call the claim function',
  $q$SELECT * FROM public.wf_claim_due_steps('planted-worker')$q$, '42501');

-- Allowed within A: create a definition and a draft; edit the draft.
INSERT INTO public.wf_definition (id, org_id, key, name, created_by) VALUES
  ('f0110000-0000-4000-8000-0000000000a3', wf01t.id('orgA'), 'welcome', 'Welcome', 'f0100000-0000-4000-8000-000000000003');
SELECT wf01t.expect_true('creator is stamped from the session, not the client',
  (SELECT created_by FROM public.wf_definition WHERE id = 'f0110000-0000-4000-8000-0000000000a3') = wf01t.id('adminA'));
INSERT INTO public.wf_version (id, org_id, definition_id, version) VALUES
  ('f0120000-0000-4000-8000-0000000000a3', wf01t.id('orgA'), 'f0110000-0000-4000-8000-0000000000a3', 1);
SELECT wf01t.expect_rows('adminA edits its own draft',
  $q$UPDATE public.wf_version SET graph = '{"steps":[{"id":"s1"}]}' WHERE id = 'f0120000-0000-4000-8000-0000000000a3'$q$, 1);
SELECT wf01t.expect_error('adminA cannot publish (publish is the service path)',
  $q$UPDATE public.wf_version SET state = 'published' WHERE id = 'f0120000-0000-4000-8000-0000000000a3'$q$, '42501');
SELECT wf01t.expect_rows('adminA cannot touch a published version (filtered out)',
  $q$UPDATE public.wf_version SET graph = '{}' WHERE id = 'f0120000-0000-4000-8000-0000000000a1'$q$, 0);
SELECT wf01t.expect_error('adminA cannot change the current version',
  $q$UPDATE public.wf_definition SET current_version_id = NULL WHERE id = 'f0110000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('a version cannot be created already published',
  $q$INSERT INTO public.wf_version (org_id, definition_id, version, state)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0110000-0000-4000-8000-0000000000a3', 2, 'published')$q$, '42501');

-- -----------------------------------------------------------------------------
-- 5. Organization B administrator: symmetric isolation (A's new rows are invisible).
-- -----------------------------------------------------------------------------
SELECT wf01t.login(wf01t.id('adminB'));
SELECT wf01t.expect_count('adminB reads only B definitions', 'SELECT 1 FROM public.wf_definition WHERE org_id <> wf01t.id(''orgB'')', 0);
SELECT wf01t.expect_count('adminB sees its one definition', 'SELECT 1 FROM public.wf_definition', 1);
SELECT wf01t.expect_count('adminB cannot see A drafts', 'SELECT 1 FROM public.wf_version WHERE org_id = wf01t.id(''orgA'')', 0);
SELECT wf01t.expect_rows('adminB cannot edit an A draft',
  $q$UPDATE public.wf_version SET graph = '{"planted":true}' WHERE id = 'f0120000-0000-4000-8000-0000000000a3'$q$, 0);

-- -----------------------------------------------------------------------------
-- 6. Member of A without the workflow permission: nothing.
-- -----------------------------------------------------------------------------
SELECT wf01t.login(wf01t.id('memberA'));
SELECT wf01t.expect_count('member without permission reads no definitions', 'SELECT 1 FROM public.wf_definition', 0);
SELECT wf01t.expect_count('member without permission reads no runs', 'SELECT 1 FROM public.wf_run', 0);
SELECT wf01t.expect_count('member without permission reads no approvals', 'SELECT 1 FROM public.wf_approval', 0);
SELECT wf01t.expect_error('member without permission cannot create a definition in own org',
  $q$INSERT INTO public.wf_definition (org_id, key, name) VALUES ('f0100000-0000-4000-8000-0000000000a1', 'member-made', 'x')$q$, '42501');

-- -----------------------------------------------------------------------------
-- 7. Platform reader (platform.tenants.read): reads both, writes nothing.
-- -----------------------------------------------------------------------------
SELECT wf01t.login(wf01t.id('reader'));
SELECT wf01t.expect_count('platform reader sees both organizations'' runs', 'SELECT DISTINCT org_id FROM public.wf_run', 2);
SELECT wf01t.expect_error('platform reader cannot create a definition',
  $q$INSERT INTO public.wf_definition (org_id, key, name) VALUES ('f0100000-0000-4000-8000-0000000000a1', 'platform-made', 'x')$q$, '42501');
SELECT wf01t.expect_rows('platform reader cannot update a definition',
  $q$UPDATE public.wf_definition SET name = 'platform edit'$q$, 0);

-- -----------------------------------------------------------------------------
-- 8. Anonymous: denied outright.
-- -----------------------------------------------------------------------------
SELECT wf01t.login_as('anon');
SELECT wf01t.expect_error('anon cannot read definitions', 'SELECT 1 FROM public.wf_definition', '42501');
SELECT wf01t.expect_error('anon cannot read runs', 'SELECT 1 FROM public.wf_run', '42501');
SELECT wf01t.expect_error('anon cannot read approvals', 'SELECT 1 FROM public.wf_approval', '42501');
SELECT wf01t.expect_error('anon cannot insert an event',
  $q$INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key) VALUES ('f0100000-0000-4000-8000-0000000000a1', 'a.b', 'x', 'anon-planted')$q$, '42501');

-- -----------------------------------------------------------------------------
-- 9. Service role: immutability, limits, approvals, de-duplication.
-- -----------------------------------------------------------------------------
SELECT wf01t.login_as('service_role');
SELECT wf01t.expect_error('published version graph is immutable',
  $q$UPDATE public.wf_version SET graph = '{"changed":true}' WHERE id = 'f0120000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('published version cannot return to draft',
  $q$UPDATE public.wf_version SET state = 'draft' WHERE id = 'f0120000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('published version cannot be deleted',
  $q$DELETE FROM public.wf_version WHERE id = 'f0120000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf01t.expect_error('only one published version per workflow',
  $q$UPDATE public.wf_version SET state = 'published', published_by = 'f0100000-0000-4000-8000-000000000003'
      WHERE id = 'f0120000-0000-4000-8000-0000000000a2'$q$, '23505');
SELECT wf01t.expect_true('publish stamped the graph digest',
  (SELECT graph_digest ~ '^[0-9a-f]{64}$' FROM public.wf_version WHERE id = 'f0120000-0000-4000-8000-0000000000a1'));
SELECT wf01t.expect_error('a run cannot use a draft version',
  $q$INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, max_depth, max_steps, deadline_at)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0110000-0000-4000-8000-0000000000a1',
             'f0120000-0000-4000-8000-0000000000a2', 'manual:draft-run', 1, 1, now() + interval '1 hour')$q$, '23514');
SELECT wf01t.expect_error('duplicate run idempotency key is refused',
  $q$INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, max_depth, max_steps, deadline_at)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0110000-0000-4000-8000-0000000000a1',
             'f0120000-0000-4000-8000-0000000000a1', 'event:f0140000-a1', 1, 1, now() + interval '1 hour')$q$, '23505');
SELECT wf01t.expect_error('duplicate event dedupe key is refused',
  $q$INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'billing.invoice.overdue', 'billing', 'invoice:A-1:overdue')$q$, '23505');
SELECT wf01t.expect_true('the same dedupe key is independent per organization',
  (SELECT count(*) = 2 FROM public.wf_event WHERE dedupe_key = 'invoice:A-1:overdue' OR dedupe_key = 'invoice:B-1:overdue'));
-- Loop guard: a chain of child runs stops at the version's max_run_depth (5 by default).
DO $loop$
DECLARE v_parent uuid := 'f0150000-0000-4000-8000-0000000000a1'; v_child uuid; i int; v_hit boolean := false; v_con text;
BEGIN
  FOR i IN 1..10 LOOP
    BEGIN
      INSERT INTO public.wf_run (org_id, definition_id, version_id, parent_run_id, idempotency_key, max_depth, max_steps, deadline_at)
      VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0110000-0000-4000-8000-0000000000a1',
              'f0120000-0000-4000-8000-0000000000a1', v_parent, 'loop-run:' || i, 16, 1000, now() + interval '1 year')
      RETURNING id INTO v_child;
      v_parent := v_child;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con <> 'wf_run_depth_limit' THEN RAISE EXCEPTION 'WF01 FAIL [loop guard]: unexpected constraint %', v_con; END IF;
      IF i <> 6 THEN RAISE EXCEPTION 'WF01 FAIL [loop guard]: stopped at depth % instead of 6', i; END IF;
      v_hit := true;
      EXIT;
    END;
  END LOOP;
  IF NOT v_hit THEN RAISE EXCEPTION 'WF01 FAIL [loop guard]: the run chain was never stopped'; END IF;
END $loop$;
SELECT wf01t.pass('loop guard: child-run chain refused past max_run_depth, and requested limits are capped by the version');
SELECT wf01t.expect_error('step limit: step_count cannot exceed max_steps',
  $q$UPDATE public.wf_run SET step_count = 201 WHERE id = 'f0150000-0000-4000-8000-0000000000a1'$q$, '23514');
SELECT wf01t.expect_error('approval: SMS is never a decision channel',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0100000-0000-4000-8000-000000000003',
       decided_at = now(), decision_channel = 'sms' WHERE id = 'f0170000-0000-4000-8000-0000000000b2'$q$, '23514');
SELECT wf01t.expect_error('approval: a decision needs a person (no agent or system decider)',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_at = now(), decision_channel = 'console'
      WHERE id = 'f0170000-0000-4000-8000-0000000000b2'$q$, '23514');
SELECT wf01t.expect_error('approval: the requester cannot approve their own request',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0100000-0000-4000-8000-000000000002',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0170000-0000-4000-8000-0000000000a1'$q$, '23514');
SELECT wf01t.expect_error('approval: expiry is at most 30 days',
  $q$INSERT INTO public.wf_approval (org_id, run_id, step_run_id, summary, requested_by_kind, requested_by_ref, expires_at)
     VALUES ('f0100000-0000-4000-8000-0000000000b2', 'f0150000-0000-4000-8000-0000000000b2', 'f0160000-0000-4000-8000-0000000000b2',
             'x', 'system', 'service', now() + interval '31 days')$q$, '23514');
SELECT wf01t.expect_rows('approval: a person decides in the console',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0100000-0000-4000-8000-000000000003',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0170000-0000-4000-8000-0000000000b2'$q$, 1);
SELECT wf01t.expect_error('approval: a decision is final',
  $q$UPDATE public.wf_approval SET status = 'rejected' WHERE id = 'f0170000-0000-4000-8000-0000000000b2'$q$, '42501');

-- -----------------------------------------------------------------------------
-- 10. SKIP LOCKED claim: leases, attempts, dead after the last attempt, org kept from the row.
-- -----------------------------------------------------------------------------
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, max_attempts, next_attempt_at) VALUES
  ('f0160000-0000-4000-8000-0000000000a5', wf01t.id('orgA'), 'f0150000-0000-4000-8000-0000000000a1', 's5', 'action', 'run-a1:s5:0', 2, now() - interval '1 minute'),
  ('f0160000-0000-4000-8000-0000000000b5', wf01t.id('orgB'), 'f0150000-0000-4000-8000-0000000000b2', 's5', 'action', 'run-b2:s5:0', 1, now() - interval '1 minute'),
  ('f0160000-0000-4000-8000-0000000000a6', wf01t.id('orgA'), 'f0150000-0000-4000-8000-0000000000a1', 's6', 'action', 'run-a1:s6:0', 3, now() + interval '1 hour');
SELECT wf01t.expect_error('step idempotency key is unique per organization',
  $q$INSERT INTO public.wf_step_run (org_id, run_id, step_key, iteration, kind, idempotency_key)
     VALUES ('f0100000-0000-4000-8000-0000000000a1', 'f0150000-0000-4000-8000-0000000000a1', 's7', 0, 'action', 'run-a1:s5:0')$q$, '23505');
CREATE TEMP TABLE wf01_claim1 ON COMMIT DROP AS SELECT * FROM public.wf_claim_due_steps('worker-1', 50, 30);
GRANT SELECT ON wf01_claim1 TO service_role;
SELECT wf01t.expect_count('claim picks every due step (both orgs: 4 due incl. the 2 seeded approval steps), not the future one',
  'SELECT 1 FROM wf01_claim1', 4);
SELECT wf01t.expect_count('claimed rows keep their stored org and carry a lease',
  $q$SELECT 1 FROM wf01_claim1 c JOIN public.wf_step_run s ON s.id = c.id
      WHERE c.org_id = s.org_id AND c.status = 'claimed' AND c.lease_owner = 'worker-1'
        AND c.lease_expires_at > now() AND c.attempt = 1$q$, 4);
SELECT wf01t.expect_count('a second claim finds nothing while leases are live', $q$SELECT 1 FROM public.wf_claim_due_steps('worker-2')$q$, 0);
-- Expire the leases: the B step (max 1 attempt) becomes dead, the A step (max 2) is reclaimed.
UPDATE public.wf_step_run SET lease_expires_at = now() - interval '1 second'
 WHERE id IN ('f0160000-0000-4000-8000-0000000000a5', 'f0160000-0000-4000-8000-0000000000b5');
SELECT wf01t.expect_count('expired lease with attempts left is reclaimed by another worker',
  $q$SELECT 1 FROM public.wf_claim_due_steps('worker-2') WHERE id = 'f0160000-0000-4000-8000-0000000000a5' AND attempt = 2 AND lease_owner = 'worker-2'$q$, 1);
SELECT wf01t.expect_true('expired lease with no attempts left is dead, never re-run',
  (SELECT status = 'dead' AND finished_at IS NOT NULL AND lease_owner IS NULL
     FROM public.wf_step_run WHERE id = 'f0160000-0000-4000-8000-0000000000b5'));
SELECT wf01t.expect_error('lease fields must match the status',
  $q$UPDATE public.wf_step_run SET lease_owner = NULL WHERE id = 'f0160000-0000-4000-8000-0000000000a5'$q$, '23514');
SELECT wf01t.expect_error('attempts cannot exceed max_attempts',
  $q$UPDATE public.wf_step_run SET attempt = 3 WHERE id = 'f0160000-0000-4000-8000-0000000000a5'$q$, '23514');

-- -----------------------------------------------------------------------------
-- 11. Append-only run timeline (checked as the table owner, past the grants).
-- -----------------------------------------------------------------------------
SELECT wf01t.logout();
SELECT wf01t.expect_error('run timeline: UPDATE blocked by trigger even for the owner',
  'UPDATE public.wf_run_event SET kind = ''run.edited''', '42501');
SELECT wf01t.expect_error('run timeline: DELETE blocked by trigger even for the owner',
  'DELETE FROM public.wf_run_event', '42501');

-- -----------------------------------------------------------------------------
-- 12. Audit chain: workflow changes appended, links intact, per organization.
-- -----------------------------------------------------------------------------
SELECT wf01t.expect_true('audit: A has definition, version publish, trigger, run and approval entries',
  (SELECT count(DISTINCT action) >= 6 FROM public.audit_chain
    WHERE org_id = wf01t.id('orgA') AND action IN ('workflow.definition.created', 'workflow.version.created',
      'workflow.version.published', 'workflow.definition.activated', 'workflow.trigger.created',
      'workflow.run.created', 'workflow.approval.requested')));
SELECT wf01t.expect_true('audit: B approval decision recorded',
  EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = wf01t.id('orgB') AND action = 'workflow.approval.approved'));
SELECT wf01t.expect_true('audit: person actions are attributed to the person',
  EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = wf01t.id('orgA') AND action = 'workflow.definition.created'
           AND actor_kind = 'user' AND actor_id = wf01t.id('adminA')::text));
SELECT wf01t.expect_count('audit: chain links are intact for both organizations',
  $q$SELECT 1 FROM (SELECT org_id, seq, prev_hash, lag(entry_hash) OVER (PARTITION BY org_id ORDER BY seq) AS prev_entry
                      FROM public.audit_chain WHERE org_id IN (wf01t.id('orgA'), wf01t.id('orgB'))) x
      WHERE (seq = 1 AND prev_hash <> repeat('0', 64)) OR (seq > 1 AND prev_hash IS DISTINCT FROM prev_entry)$q$, 0);
SELECT wf01t.expect_true('audit: entry hashes recompute with the canonical function',
  NOT EXISTS (SELECT 1 FROM public.audit_chain a WHERE a.org_id IN (wf01t.id('orgA'), wf01t.id('orgB'))
               AND a.entry_hash <> public.audit_chain_canonical_hash(a.prev_hash, a.seq, a.at, a.org_id, a.actor_kind,
                    a.actor_id, a.action, a.target_type, a.target_id, a.ip, a.device, a.before_hash, a.after_hash)));

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
DO $result$
DECLARE v_n int := (SELECT count(*) FROM wf01t.passed);
BEGIN
  IF to_regclass('public.wf01_staging_shim_marker') IS NOT NULL THEN
    RAISE EXCEPTION 'WF01 ALL PASS: % checks on staging (this error rolls the run back on purpose)', v_n
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'WF01 ALL PASS: % checks', v_n;
END $result$;
ROLLBACK;
