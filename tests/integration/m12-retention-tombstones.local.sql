-- M12 retention tombstone contract (LOCAL disposable PostgreSQL only).
-- Run after all repository migrations against the loopback sim database:
--   psql "postgresql://postgres@127.0.0.1:54329/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m12-retention-tombstones.local.sql
-- This transaction rolls back every synthetic fixture and never touches a hosted DB.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M12: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M12: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.retention_policies') IS NULL
     OR to_regclass('public.retention_run_candidates') IS NULL
     OR to_regclass('public.retention_legal_holds') IS NULL
     OR to_regclass('public.retention_deletion_audit') IS NULL
     OR to_regprocedure('public.retention_run_dry(uuid)') IS NULL
     OR to_regprocedure('public.retention_run_approve(uuid)') IS NULL
     OR to_regprocedure('public.retention_run_execute(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M12 migration is not applied';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.retention_deletion_audit'::regclass) THEN
    RAISE EXCEPTION 'M12 audit table must have RLS enabled and forced';
  END IF;
END
$guard$;

CREATE SCHEMA m12;
GRANT USAGE ON SCHEMA m12 TO anon, authenticated;
GRANT USAGE ON SCHEMA m12 TO service_role;
CREATE TABLE m12.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m12.ids TO anon, authenticated;
GRANT SELECT ON m12.ids TO service_role;
CREATE FUNCTION m12.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m12.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION m12.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m12.assert_count(p_label text, p_sql text, p_expected bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M12 FAIL [%]: expected % rows, got %', p_label, p_expected, v_count;
  END IF;
END $$;
CREATE FUNCTION m12.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'M12 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m12 TO anon, authenticated;

INSERT INTO auth.users (id) VALUES
  ('a1480000-0000-4000-8000-000000000001'),
  ('a1480000-0000-4000-8000-000000000002'),
  ('a1480000-0000-4000-8000-000000000003'),
  ('b1480000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('b1480000-0000-4000-8000-0000000000a1', 'M12 Synthetic Tenant A', 'm12-synthetic-a'),
  ('b1480000-0000-4000-8000-0000000000b2', 'M12 Synthetic Tenant B', 'm12-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a1480000-0000-4000-8000-000000000001', 'b1480000-0000-4000-8000-0000000000a1',
   'M12 Synthetic Requester', 'requester@m12.invalid', 'admin', true),
  ('a1480000-0000-4000-8000-000000000002', 'b1480000-0000-4000-8000-0000000000a1',
   'M12 Synthetic Approver', 'approver@m12.invalid', 'admin', true),
  ('a1480000-0000-4000-8000-000000000003', 'b1480000-0000-4000-8000-0000000000a1',
   'M12 Synthetic Executor', 'executor@m12.invalid', 'admin', true),
  ('b1480000-0000-4000-8000-000000000001', 'b1480000-0000-4000-8000-0000000000b2',
   'M12 Synthetic Tenant B Admin', 'tenant-b@m12.invalid', 'admin', true);
INSERT INTO public.students (id, school_id, admission_number) VALUES
  ('c1480000-0000-4000-8000-000000000001', 'b1480000-0000-4000-8000-0000000000a1', 'M12-A-001'),
  ('c1480000-0000-4000-8000-000000000002', 'b1480000-0000-4000-8000-0000000000a1', 'M12-A-002'),
  ('c1480000-0000-4000-8000-000000000003', 'b1480000-0000-4000-8000-0000000000b2', 'M12-B-001');
INSERT INTO public.attendance (id, school_id, student_id, date, status, created_at) VALUES
  ('d1480000-0000-4000-8000-000000000001', 'b1480000-0000-4000-8000-0000000000a1',
   'c1480000-0000-4000-8000-000000000001', current_date - 900, 'present', now() - interval '900 days'),
  ('d1480000-0000-4000-8000-000000000002', 'b1480000-0000-4000-8000-0000000000a1',
   'c1480000-0000-4000-8000-000000000002', current_date - 900, 'absent', now() - interval '900 days'),
  ('d1480000-0000-4000-8000-000000000003', 'b1480000-0000-4000-8000-0000000000b2',
   'c1480000-0000-4000-8000-000000000003', current_date - 900, 'late', now() - interval '900 days');
INSERT INTO m12.ids VALUES ('tenant-a','b1480000-0000-4000-8000-0000000000a1');
INSERT INTO m12.ids VALUES ('tenant-b','b1480000-0000-4000-8000-0000000000b2');
INSERT INTO m12.ids VALUES ('requester','a1480000-0000-4000-8000-000000000001');
INSERT INTO m12.ids VALUES ('approver','a1480000-0000-4000-8000-000000000002');
INSERT INTO m12.ids VALUES ('executor','a1480000-0000-4000-8000-000000000003');
INSERT INTO m12.ids VALUES ('tenant-b-admin','b1480000-0000-4000-8000-000000000001');
INSERT INTO m12.ids VALUES ('held-subject','c1480000-0000-4000-8000-000000000001');
INSERT INTO m12.ids VALUES ('eligible-record','d1480000-0000-4000-8000-000000000002');
SELECT set_config('m12.initial_row_count',(SELECT count(*)::text FROM public.attendance
  WHERE school_id = 'b1480000-0000-4000-8000-0000000000a1'),true);
SELECT set_config('m12.initial_audit_count',(SELECT count(*)::text FROM public.retention_deletion_audit
  WHERE org_id = 'b1480000-0000-4000-8000-0000000000a1'),true);

-- A trusted scheduler may create reports, but its only exposed execution path is dry-run.
SELECT m12.login_as('service_role');
DO $scheduler_dry_run$
DECLARE v_report jsonb;
BEGIN
  v_report := public.retention_run_dry((SELECT id FROM m12.ids WHERE name = 'tenant-b'));
  IF v_report->>'mode' <> 'dry-run'
     OR (v_report->>'candidateCount')::integer <> 1
     OR (v_report->>'eligibleCount')::integer <> 1 THEN
    RAISE EXCEPTION 'M12 FAIL: scheduler did not receive a dry-run report: %', v_report;
  END IF;
END
$scheduler_dry_run$;
SELECT m12.logout();

SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'tenant-b-admin'));
DO $tenant_b_run$
DECLARE v_report jsonb;
BEGIN
  v_report := public.retention_run_dry((SELECT id FROM m12.ids WHERE name = 'tenant-b'));
  INSERT INTO m12.ids VALUES ('tenant-b-run',(v_report->>'runId')::uuid);
END
$tenant_b_run$;
INSERT INTO m12.ids
SELECT 'tenant-b-hold', public.retention_legal_hold_create(
  (SELECT id FROM m12.ids WHERE name = 'tenant-b'),
  'tenant',NULL,NULL,NULL,NULL,'M12 synthetic tenant hold');
SELECT m12.logout();

-- A report captures IDs but must not change source rows or create tombstones.
SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'requester'));
DO $dry_run$
DECLARE v_report jsonb; v_run uuid;
BEGIN
  v_report := public.retention_run_dry((SELECT id FROM m12.ids WHERE name = 'tenant-a'));
  IF v_report->>'mode' <> 'dry-run'
     OR (v_report->>'candidateCount')::integer <> 2
     OR (v_report->>'eligibleCount')::integer <> 2 THEN
    RAISE EXCEPTION 'M12 FAIL: unexpected dry-run report %', v_report;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_report->'policies') AS p(policy)
     WHERE policy->>'policyRef' = 'RP-ATTND-EDU'
       AND (policy->>'candidateCount')::integer = 2
       AND jsonb_array_length(policy->'candidateIds') = 2
  ) THEN RAISE EXCEPTION 'M12 FAIL: report omitted policy/category candidate ids'; END IF;
  v_run := (v_report->>'runId')::uuid;
  INSERT INTO m12.ids VALUES ('run', v_run);
END
$dry_run$;
SELECT m12.assert_count('dry-run preserves all attendance rows',
  $$SELECT 1 FROM public.attendance WHERE school_id = 'b1480000-0000-4000-8000-0000000000a1'$$,
  current_setting('m12.initial_row_count')::bigint);
SELECT m12.assert_count('dry-run writes no deletion audit',
  $$SELECT 1 FROM public.retention_deletion_audit WHERE org_id = 'b1480000-0000-4000-8000-0000000000a1'$$,
  current_setting('m12.initial_audit_count')::bigint);
SELECT m12.denied('requester cannot approve own run',
  $$SELECT public.retention_run_approve((SELECT id FROM m12.ids WHERE name = 'run'))$$);
SELECT m12.denied('tenant A cannot create report for tenant B',
  $$SELECT public.retention_run_dry((SELECT id FROM m12.ids WHERE name = 'tenant-b'))$$);
SELECT m12.denied('tenant A cannot configure tenant B policy',
  $$SELECT public.retention_policy_configure((SELECT id FROM m12.ids WHERE name = 'tenant-b'),'attendance',730,true)$$);
SELECT m12.denied('tenant A cannot create tenant B hold',
  $$SELECT public.retention_legal_hold_create((SELECT id FROM m12.ids WHERE name = 'tenant-b'),
     'tenant',NULL,NULL,NULL,NULL,'M12 synthetic hold')$$);
SELECT m12.denied('tenant A cannot release tenant B hold',
  $$SELECT public.retention_legal_hold_release((SELECT id FROM m12.ids WHERE name = 'tenant-b-hold'),'M12 synthetic release')$$);
SELECT m12.denied('tenant A cannot approve tenant B run',
  $$SELECT public.retention_run_approve((SELECT id FROM m12.ids WHERE name = 'tenant-b-run'))$$);
SELECT m12.denied('tenant A cannot execute tenant B run',
  $$SELECT public.retention_run_execute((SELECT id FROM m12.ids WHERE name = 'tenant-b-run'))$$);
SELECT m12.assert_count('tenant A cannot read tenant B policies',
  $$SELECT 1 FROM public.retention_policies WHERE org_id = 'b1480000-0000-4000-8000-0000000000b2'$$, 0);
SELECT m12.denied('authenticated has no direct policy writes',
  $$INSERT INTO public.retention_policies (org_id,policy_ref,category,target_table,retention_days)
    VALUES ('b1480000-0000-4000-8000-0000000000a1','RP-ATTND-EDU','attendance-activity','attendance',730)$$);
SELECT m12.denied('authenticated has no direct audit writes',
  $$DELETE FROM public.retention_deletion_audit$$);
SELECT m12.logout();

-- Holds block execution even when the approved report originally found a match.
SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'approver'));
INSERT INTO m12.ids
SELECT 'hold', public.retention_legal_hold_create(
  (SELECT id FROM m12.ids WHERE name = 'tenant-a'),
  'category','attendance-activity',NULL,NULL,NULL,'M12 synthetic legal hold');
SELECT m12.denied('execution requires approval',
  $$SELECT public.retention_run_execute((SELECT id FROM m12.ids WHERE name = 'run'))$$);
INSERT INTO m12.ids
SELECT 'approval', public.retention_run_approve((SELECT id FROM m12.ids WHERE name = 'run'));
SELECT m12.logout();

SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'executor'));
DO $execute$
DECLARE v_result jsonb;
BEGIN
  v_result := public.retention_run_execute((SELECT id FROM m12.ids WHERE name = 'run'));
  IF v_result->>'mode' <> 'tombstone'
     OR (v_result->>'tombstonedCount')::integer <> 0
     OR (v_result->>'heldCount')::integer <> 2 THEN
    RAISE EXCEPTION 'M12 FAIL: legal hold did not override the approved candidate set: %', v_result;
  END IF;
END
$execute$;
SELECT m12.assert_count('execution leaves source rows intact',
  $$SELECT 1 FROM public.attendance WHERE school_id = 'b1480000-0000-4000-8000-0000000000a1'$$,
  current_setting('m12.initial_row_count')::bigint);
SELECT m12.assert_count('legal hold prevents every tombstone for the run',
  $$SELECT 1 FROM public.retention_deletion_audit WHERE run_id = (SELECT id FROM m12.ids WHERE name = 'run')$$, 0);
SELECT m12.assert_count('both policy matches persist as held candidates',
  $$SELECT 1 FROM public.retention_run_candidates
      WHERE run_id = (SELECT id FROM m12.ids WHERE name = 'run') AND candidate_state = 'held'$$, 2);

SELECT public.retention_legal_hold_release(
  (SELECT id FROM m12.ids WHERE name = 'hold'), 'M12 synthetic release');
SELECT m12.logout();

SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'requester'));
INSERT INTO m12.ids
SELECT 'second-run', (public.retention_run_dry(
  (SELECT id FROM m12.ids WHERE name = 'tenant-a'))->>'runId')::uuid;
SELECT m12.logout();

SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'approver'));
INSERT INTO m12.ids
SELECT 'second-approval', public.retention_run_approve((SELECT id FROM m12.ids WHERE name = 'second-run'));
SELECT m12.logout();

SELECT m12.login((SELECT id FROM m12.ids WHERE name = 'executor'));
DO $second_execute$
DECLARE v_result jsonb;
BEGIN
  v_result := public.retention_run_execute((SELECT id FROM m12.ids WHERE name = 'second-run'));
  IF v_result->>'mode' <> 'tombstone'
     OR (v_result->>'tombstonedCount')::integer <> 2
     OR (v_result->>'heldCount')::integer <> 0 THEN
    RAISE EXCEPTION 'M12 FAIL: released hold did not permit only approved eligible candidates: %', v_result;
  END IF;
END
$second_execute$;
SELECT m12.assert_count('one audit row exists per actual tombstone',
  $$SELECT 1 FROM public.retention_deletion_audit WHERE run_id = (SELECT id FROM m12.ids WHERE name = 'second-run')$$, 2);
SELECT m12.assert_count('tombstone audit captures policy, tenant, approver, actor, target',
  $$SELECT 1 FROM public.retention_deletion_audit
     WHERE run_id = (SELECT id FROM m12.ids WHERE name = 'second-run')
       AND org_id = 'b1480000-0000-4000-8000-0000000000a1'
       AND policy_ref = 'RP-ATTND-EDU'
       AND category = 'attendance-activity'
       AND target_table = 'attendance'
       AND target_record_id = 'd1480000-0000-4000-8000-000000000002'
       AND approved_by = 'a1480000-0000-4000-8000-000000000002'
       AND actor_id = 'a1480000-0000-4000-8000-000000000003'$$, 1);
SELECT m12.assert_count('held candidate was not tombstoned',
  $$SELECT 1 FROM public.retention_deletion_audit
     WHERE run_id = (SELECT id FROM m12.ids WHERE name = 'run')
      AND target_record_id = 'd1480000-0000-4000-8000-000000000001'$$, 0);
SELECT m12.assert_count('held execution result persisted',
  $$SELECT 1 FROM public.retention_run_candidates
     WHERE run_id = (SELECT id FROM m12.ids WHERE name = 'run')
       AND candidate_state = 'held'$$, 2);
SELECT m12.denied('deletion audit rejects UPDATE',
  $$UPDATE public.retention_deletion_audit SET policy_ref = 'RP-FINAN-EDU'$$);
SELECT m12.denied('deletion audit rejects DELETE',
  $$DELETE FROM public.retention_deletion_audit$$);
SELECT m12.denied('tenant A cannot execute tenant B run',
  $$SELECT public.retention_run_execute((SELECT id FROM m12.ids WHERE name = 'tenant-b-run'))$$);
SELECT m12.logout();

-- Neither anon nor authenticated may invoke write RPCs for another tenant.
SELECT m12.login_as('anon');
SELECT m12.denied('anon cannot run dry-run RPC',
  $$SELECT public.retention_run_dry((SELECT id FROM m12.ids WHERE name = 'tenant-a'))$$);
SELECT m12.denied('anon cannot configure policy RPC',
  $$SELECT public.retention_policy_configure((SELECT id FROM m12.ids WHERE name = 'tenant-a'),'attendance',730,true)$$);
SELECT m12.denied('anon cannot create legal hold RPC',
  $$SELECT public.retention_legal_hold_create((SELECT id FROM m12.ids WHERE name = 'tenant-a'),
     'tenant',NULL,NULL,NULL,NULL,'M12 synthetic hold')$$);
SELECT m12.denied('anon cannot release hold RPC',
  $$SELECT public.retention_legal_hold_release((SELECT id FROM m12.ids WHERE name = 'hold'),'M12 synthetic release')$$);
SELECT m12.denied('anon cannot approve run RPC',
  $$SELECT public.retention_run_approve((SELECT id FROM m12.ids WHERE name = 'second-run'))$$);
SELECT m12.denied('anon cannot execute run RPC',
  $$SELECT public.retention_run_execute((SELECT id FROM m12.ids WHERE name = 'second-run'))$$);
SELECT m12.denied('anon cannot read tenant policies',
  $$SELECT 1 FROM public.retention_policies$$);
SELECT m12.logout();

DO $done$ BEGIN RAISE NOTICE 'M12 ALL PASS'; END $done$;
ROLLBACK;
