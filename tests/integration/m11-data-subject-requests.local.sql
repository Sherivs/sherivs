-- M11 data-subject request contract (LOCAL disposable PostgreSQL only).
-- Run after all repository migrations against the loopback sim database:
--   psql "postgresql://postgres@127.0.0.1:54329/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m11-data-subject-requests.local.sql
-- Every synthetic fixture is rolled back; this never touches a hosted database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M11: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M11: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.dsr_requests') IS NULL
     OR to_regclass('public.dsr_request_events') IS NULL
     OR to_regclass('public.dsr_settings') IS NULL
     OR to_regclass('public.retention_legal_holds') IS NULL
     OR to_regprocedure('public.dsr_open(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.dsr_erasure_decide(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M11 migration (and M12) is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class
              WHERE oid IN ('public.dsr_requests'::regclass, 'public.dsr_request_events'::regclass,
                            'public.dsr_settings'::regclass)
                AND NOT (relrowsecurity AND relforcerowsecurity)) THEN
    RAISE EXCEPTION 'M11 tables must have RLS enabled and forced';
  END IF;
  IF has_table_privilege('anon', 'public.dsr_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dsr_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dsr_requests', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.dsr_requests', 'DELETE') THEN
    RAISE EXCEPTION 'M11: client roles must have SELECT only (authenticated) and nothing (anon)';
  END IF;
END
$guard$;

CREATE SCHEMA m11;
GRANT USAGE ON SCHEMA m11 TO anon, authenticated, service_role;
CREATE TABLE m11.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m11.ids TO anon, authenticated;
GRANT SELECT ON m11.ids TO service_role;
CREATE FUNCTION m11.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m11.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION m11.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m11.id(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM m11.ids WHERE name = p_name $$;
CREATE FUNCTION m11.assert_count(p_label text, p_sql text, p_expected bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M11 FAIL [%]: expected % rows, got %', p_label, p_expected, v_count;
  END IF;
END $$;
CREATE FUNCTION m11.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'M11 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE FUNCTION m11.rejected(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'M11 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M11 FAIL [%]: statement was allowed but must be rejected', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m11 TO anon, authenticated, service_role;

INSERT INTO auth.users (id) VALUES
  ('a1110000-0000-4000-8000-000000000001'),
  ('a1110000-0000-4000-8000-000000000002'),
  ('b1110000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('b1110000-0000-4000-8000-0000000000a1', 'M11 Synthetic Tenant A', 'm11-synthetic-a'),
  ('b1110000-0000-4000-8000-0000000000b2', 'M11 Synthetic Tenant B', 'm11-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000a1',
   'M11 Synthetic Admin A', 'admin-a@m11.invalid', 'admin', true),
  ('a1110000-0000-4000-8000-000000000002', 'b1110000-0000-4000-8000-0000000000a1',
   'M11 Synthetic Teacher A', 'teacher-a@m11.invalid', 'teacher', true),
  ('b1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000b2',
   'M11 Synthetic Admin B', 'admin-b@m11.invalid', 'admin', true);
INSERT INTO public.students (id, school_id, admission_number) VALUES
  ('c1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000a1', 'M11-A-001'),
  ('c1110000-0000-4000-8000-000000000002', 'b1110000-0000-4000-8000-0000000000a1', 'M11-A-002'),
  ('c1110000-0000-4000-8000-000000000004', 'b1110000-0000-4000-8000-0000000000a1', 'M11-A-004'),
  ('c1110000-0000-4000-8000-000000000003', 'b1110000-0000-4000-8000-0000000000b2', 'M11-B-001');
INSERT INTO public.attendance (id, school_id, student_id, date, status) VALUES
  ('d1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000a1',
   'c1110000-0000-4000-8000-000000000001', current_date - 3, 'present'),
  ('d1110000-0000-4000-8000-000000000002', 'b1110000-0000-4000-8000-0000000000a1',
   'c1110000-0000-4000-8000-000000000001', current_date - 2, 'absent'),
  ('d1110000-0000-4000-8000-000000000003', 'b1110000-0000-4000-8000-0000000000a1',
   'c1110000-0000-4000-8000-000000000002', current_date - 2, 'late'),
  ('d1110000-0000-4000-8000-000000000004', 'b1110000-0000-4000-8000-0000000000a1',
   'c1110000-0000-4000-8000-000000000004', current_date - 2, 'present'),
  ('d1110000-0000-4000-8000-000000000005', 'b1110000-0000-4000-8000-0000000000b2',
   'c1110000-0000-4000-8000-000000000003', current_date - 2, 'late');
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount) VALUES
  ('e1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000a1',
   'c1110000-0000-4000-8000-000000000001', 'tuition', 100),
  ('e1110000-0000-4000-8000-000000000002', 'b1110000-0000-4000-8000-0000000000a1',
   'c1110000-0000-4000-8000-000000000002', 'tuition', 200);
INSERT INTO public.messages (id, school_id, sender_id, recipient_id, body) VALUES
  ('f1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000a1',
   'a1110000-0000-4000-8000-000000000001', 'a1110000-0000-4000-8000-000000000002', 'synthetic hello'),
  ('f1110000-0000-4000-8000-000000000002', 'b1110000-0000-4000-8000-0000000000a1',
   'a1110000-0000-4000-8000-000000000001', 'a1110000-0000-4000-8000-000000000001', 'synthetic note to self');
INSERT INTO public.staff_payroll (id, school_id, user_id, month, year, basic_salary) VALUES
  ('91110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-0000000000a1',
   'a1110000-0000-4000-8000-000000000002', 1, 2026, 500);

INSERT INTO m11.ids VALUES
  ('tenant-a','b1110000-0000-4000-8000-0000000000a1'),
  ('tenant-b','b1110000-0000-4000-8000-0000000000b2'),
  ('admin-a','a1110000-0000-4000-8000-000000000001'),
  ('teacher-a','a1110000-0000-4000-8000-000000000002'),
  ('admin-b','b1110000-0000-4000-8000-000000000001'),
  ('s1','c1110000-0000-4000-8000-000000000001'),
  ('s2','c1110000-0000-4000-8000-000000000002'),
  ('s3-tenant-b','c1110000-0000-4000-8000-000000000003'),
  ('s4','c1110000-0000-4000-8000-000000000004');

-- ---- Tenant A manager: settings, intake, SLA clock --------------------------------------------
SELECT m11.login(m11.id('admin-a'));
SELECT m11.rejected('SLA of 0 days is rejected',
  $$SELECT public.dsr_settings_configure(m11.id('tenant-a'), 0)$$, '22023');
SELECT public.dsr_settings_configure(m11.id('tenant-a'), 1);
INSERT INTO m11.ids SELECT 'req-access', public.dsr_open(m11.id('tenant-a'), m11.id('s1'), 'access');
SELECT m11.rejected('unknown request type rejected',
  $$SELECT public.dsr_open(m11.id('tenant-a'), m11.id('s1'), 'sell-my-data')$$, '23514');
SELECT m11.denied('subject from tenant B cannot be requested in tenant A',
  $$SELECT public.dsr_open(m11.id('tenant-a'), m11.id('s3-tenant-b'), 'access')$$);
DO $sla$
DECLARE v public.dsr_requests%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.dsr_requests WHERE id = m11.id('req-access');
  IF v.sla_days <> 1 OR v.due_at <> v.received_at + interval '1 day' OR v.status <> 'received' THEN
    RAISE EXCEPTION 'M11 FAIL: SLA clock not set from tenant configuration: %', to_jsonb(v);
  END IF;
END
$sla$;
SELECT m11.assert_count('request is not overdue now',
  $$SELECT 1 FROM public.dsr_overdue(m11.id('tenant-a'))$$, 0);
SELECT m11.assert_count('request is overdue after its deadline',
  $$SELECT 1 FROM public.dsr_overdue(m11.id('tenant-a'), clock_timestamp() + interval '36 hours')$$, 1);
SELECT m11.logout();

-- ---- Authority and isolation -------------------------------------------------------------------
SELECT m11.login(m11.id('teacher-a'));
SELECT m11.denied('non-manager cannot open a request',
  $$SELECT public.dsr_open(m11.id('tenant-a'), m11.id('s1'), 'access')$$);
SELECT m11.assert_count('non-manager cannot read requests',
  $$SELECT 1 FROM public.dsr_requests$$, 0);
SELECT m11.logout();

SELECT m11.login(m11.id('admin-b'));
SELECT m11.denied('tenant B cannot open a request in tenant A',
  $$SELECT public.dsr_open(m11.id('tenant-a'), m11.id('s1'), 'access')$$);
SELECT m11.denied('tenant B cannot verify a tenant A request',
  $$SELECT public.dsr_verify_identity(m11.id('req-access'), 'in_person_id')$$);
SELECT m11.denied('tenant B cannot export a tenant A request',
  $$SELECT public.dsr_portability_export(m11.id('req-access'))$$);
SELECT m11.denied('tenant B cannot close a tenant A request',
  $$SELECT public.dsr_close(m11.id('req-access'), 'rejected', 'synthetic')$$);
SELECT m11.assert_count('tenant B cannot read tenant A requests',
  $$SELECT 1 FROM public.dsr_requests WHERE org_id = m11.id('tenant-a')$$, 0);
SELECT m11.assert_count('tenant B cannot read tenant A settings',
  $$SELECT 1 FROM public.dsr_settings WHERE org_id = m11.id('tenant-a')$$, 0);
SELECT m11.assert_count('tenant B cannot read tenant A events',
  $$SELECT 1 FROM public.dsr_request_events WHERE org_id = m11.id('tenant-a')$$, 0);
SELECT m11.logout();

SELECT m11.login(m11.id('admin-a'));
SELECT m11.denied('no direct request insert',
  $$INSERT INTO public.dsr_requests (org_id, subject_ref, request_type, sla_days, due_at, opened_by)
    VALUES (m11.id('tenant-a'), m11.id('s1'), 'access', 30, now() + interval '30 days', m11.id('admin-a'))$$);
SELECT m11.denied('no direct request update',
  $$UPDATE public.dsr_requests SET status = 'completed'$$);
SELECT m11.denied('no direct event delete', $$DELETE FROM public.dsr_request_events$$);
SELECT m11.logout();
SELECT m11.login_as('anon');
SELECT m11.denied('anon cannot read requests', $$SELECT count(*) FROM public.dsr_requests$$);
SELECT m11.denied('anon cannot open a request',
  $$SELECT public.dsr_open(m11.id('tenant-a'), m11.id('s1'), 'access')$$);
SELECT m11.logout();

-- ---- Access/portability: identity first, then a subject-only export -----------------------------
SELECT m11.login(m11.id('admin-a'));
SELECT m11.rejected('export needs a verified identity',
  $$SELECT public.dsr_portability_export(m11.id('req-access'))$$, '22023');
SELECT m11.rejected('unknown identity method rejected',
  $$SELECT public.dsr_verify_identity(m11.id('req-access'), 'trust-me')$$, '23514');
SELECT public.dsr_verify_identity(m11.id('req-access'), 'in_person_id');
SELECT m11.rejected('identity cannot be verified twice',
  $$SELECT public.dsr_verify_identity(m11.id('req-access'), 'in_person_id')$$, '22023');
DO $export$
DECLARE v jsonb;
BEGIN
  v := public.dsr_portability_export(m11.id('req-access'));
  IF v->>'format' <> 'sherivs.dsr.export.v1' OR v->>'subjectRef' <> m11.id('s1')::text THEN
    RAISE EXCEPTION 'M11 FAIL: export envelope wrong: %', v;
  END IF;
  IF jsonb_array_length(v->'attendance') <> 2 OR jsonb_array_length(v->'fees') <> 1 THEN
    RAISE EXCEPTION 'M11 FAIL: export must hold exactly the subject''s 2 attendance and 1 fee rows: %', v;
  END IF;
  IF jsonb_array_length(v->'messages') <> 0 OR jsonb_array_length(v->'payroll') <> 0 THEN
    RAISE EXCEPTION 'M11 FAIL: student export must not include unrelated messages or payroll';
  END IF;
  IF v::text LIKE '%' || m11.id('s2')::text || '%'
     OR v::text LIKE '%' || m11.id('s3-tenant-b')::text || '%'
     OR v::text LIKE '%' || m11.id('tenant-a')::text || '%'
     OR v::text LIKE '%M11-A-002%' OR v::text LIKE '%M11-B-001%' THEN
    RAISE EXCEPTION 'M11 FAIL: export leaked another subject, tenant id or tenant B data';
  END IF;
END
$export$;
-- A user subject: messages lose counterparty ids; payroll is theirs only.
INSERT INTO m11.ids SELECT 'req-portability', public.dsr_open(m11.id('tenant-a'), m11.id('teacher-a'), 'portability');
SELECT public.dsr_verify_identity(m11.id('req-portability'), 'registered_contact');
DO $export_user$
DECLARE v jsonb;
BEGIN
  v := public.dsr_portability_export(m11.id('req-portability'));
  IF jsonb_array_length(v->'messages') <> 1 OR jsonb_array_length(v->'payroll') <> 1
     OR v->'messages'->0->>'direction' <> 'received'
     OR (v->'messages'->0) ? 'sender_id' OR (v->'messages'->0) ? 'recipient_id' THEN
    RAISE EXCEPTION 'M11 FAIL: user export wrong or leaked counterparty ids: %', v;
  END IF;
  IF v::text LIKE '%' || m11.id('admin-a')::text || '%' OR v::text LIKE '%synthetic note to self%' THEN
    RAISE EXCEPTION 'M11 FAIL: user export leaked the sender or an unrelated message';
  END IF;
END
$export_user$;
SELECT m11.assert_count('export events hold counts, never content',
  $$SELECT 1 FROM public.dsr_request_events
     WHERE event_type = 'exported' AND detail ?& ARRAY['attendance','messages','fees']
       AND detail::text NOT LIKE '%synthetic%'$$, 2);
SELECT public.dsr_close(m11.id('req-access'), 'completed', 'Export delivered to the subject');
SELECT m11.denied('closed request cannot be re-closed',
  $$SELECT public.dsr_close(m11.id('req-access'), 'rejected', 'synthetic')$$);
SELECT m11.assert_count('completed request is no longer overdue',
  $$SELECT 1 FROM public.dsr_overdue(m11.id('tenant-a'), clock_timestamp() + interval '36 hours')
     WHERE request_id = m11.id('req-access')$$, 0);
SELECT m11.logout();
SELECT m11.denied('closed request is immutable even for a superuser write',
  $$UPDATE public.dsr_requests SET closure_note = 'tampered' WHERE id = m11.id('req-access')$$);
SELECT m11.denied('SLA clock is immutable',
  $$UPDATE public.dsr_requests SET due_at = due_at + interval '90 days' WHERE id = m11.id('req-portability')$$);
SELECT m11.denied('requests cannot be deleted',
  $$DELETE FROM public.dsr_requests WHERE id = m11.id('req-portability')$$);
SELECT m11.denied('events cannot be truncated', $$TRUNCATE public.dsr_request_events$$);

-- ---- Erasure: gated on M12 legal holds ----------------------------------------------------------
SELECT m11.login(m11.id('admin-a'));
INSERT INTO m11.ids SELECT 'req-erase-s1', public.dsr_open(m11.id('tenant-a'), m11.id('s1'), 'erasure');
SELECT m11.rejected('erasure decision needs a verified identity',
  $$SELECT public.dsr_erasure_decide(m11.id('req-erase-s1'))$$, '22023');
SELECT public.dsr_verify_identity(m11.id('req-erase-s1'), 'guardian_confirmation');
SELECT m11.rejected('erasure requests cannot be exported',
  $$SELECT public.dsr_portability_export(m11.id('req-erase-s1'))$$, '22023');
INSERT INTO m11.ids SELECT 'hold-s1', public.retention_legal_hold_create(
  m11.id('tenant-a'), 'subject', NULL, m11.id('s1'), NULL, NULL, 'M11 synthetic subject hold');
DO $blocked$
DECLARE v jsonb;
BEGIN
  v := public.dsr_erasure_decide(m11.id('req-erase-s1'));
  IF v->>'status' <> 'erasure_blocked' OR jsonb_array_length(v->'holdIds') <> 1 THEN
    RAISE EXCEPTION 'M11 FAIL: erasure must be blocked under a subject legal hold: %', v;
  END IF;
END
$blocked$;
SELECT m11.rejected('blocked erasure cannot be completed',
  $$SELECT public.dsr_close(m11.id('req-erase-s1'), 'completed', 'synthetic attempt')$$, '22023');
SELECT m11.assert_count('erasure never modifies source rows',
  $$SELECT 1 FROM public.attendance WHERE student_id = m11.id('s1')$$, 2);
SELECT public.retention_legal_hold_release(m11.id('hold-s1'), 'M11 synthetic release');
DO $cleared$
DECLARE v jsonb;
BEGIN
  v := public.dsr_erasure_decide(m11.id('req-erase-s1'));
  IF v->>'status' <> 'erasure_cleared' OR jsonb_array_length(v->'holdIds') <> 0 THEN
    RAISE EXCEPTION 'M11 FAIL: erasure must clear once the hold is released: %', v;
  END IF;
END
$cleared$;
SELECT public.dsr_close(m11.id('req-erase-s1'), 'completed', 'Cleared for M12 tombstone execution');
SELECT m11.assert_count('erasure decision still leaves source rows untouched',
  $$SELECT 1 FROM public.attendance WHERE student_id = m11.id('s1')$$, 2);

-- Category holds block only subjects who have records in that category.
INSERT INTO m11.ids SELECT 'hold-financial', public.retention_legal_hold_create(
  m11.id('tenant-a'), 'category', 'financial', NULL, NULL, NULL, 'M11 synthetic financial hold');
INSERT INTO m11.ids SELECT 'req-erase-s2', public.dsr_open(m11.id('tenant-a'), m11.id('s2'), 'erasure');
SELECT public.dsr_verify_identity(m11.id('req-erase-s2'), 'in_person_id');
SELECT m11.assert_count('financial category hold blocks a subject with fee records',
  $$SELECT 1 FROM public.dsr_erasure_decide(m11.id('req-erase-s2')) d
     WHERE d::text LIKE '%erasure_blocked%'$$, 1);
INSERT INTO m11.ids SELECT 'req-erase-s4', public.dsr_open(m11.id('tenant-a'), m11.id('s4'), 'erasure');
SELECT public.dsr_verify_identity(m11.id('req-erase-s4'), 'in_person_id');
DO $cat_clear$
DECLARE v jsonb;
BEGIN
  v := public.dsr_erasure_decide(m11.id('req-erase-s4'));
  IF v->>'status' <> 'erasure_cleared' THEN
    RAISE EXCEPTION 'M11 FAIL: a financial hold must not block a subject with attendance only: %', v;
  END IF;
END
$cat_clear$;
SELECT public.retention_legal_hold_release(m11.id('hold-financial'), 'M11 synthetic release');

-- Record holds block only the subject who owns the record; tenant holds block everyone.
INSERT INTO m11.ids SELECT 'hold-record', public.retention_legal_hold_create(
  m11.id('tenant-a'), 'record', NULL, NULL, 'attendance',
  'd1110000-0000-4000-8000-000000000003', 'M11 synthetic record hold');
INSERT INTO m11.ids SELECT 'req-erase-s2b', public.dsr_open(m11.id('tenant-a'), m11.id('s2'), 'erasure');
SELECT public.dsr_verify_identity(m11.id('req-erase-s2b'), 'in_person_id');
SELECT m11.assert_count('record hold on the subject''s attendance blocks erasure',
  $$SELECT 1 FROM public.dsr_erasure_decide(m11.id('req-erase-s2b')) d
     WHERE d::text LIKE '%erasure_blocked%'$$, 1);
SELECT public.retention_legal_hold_release(m11.id('hold-record'), 'M11 synthetic release');
INSERT INTO m11.ids SELECT 'hold-tenant', public.retention_legal_hold_create(
  m11.id('tenant-a'), 'tenant', NULL, NULL, NULL, NULL, 'M11 synthetic tenant hold');
INSERT INTO m11.ids SELECT 'req-erase-s4b', public.dsr_open(m11.id('tenant-a'), m11.id('s4'), 'erasure');
SELECT public.dsr_verify_identity(m11.id('req-erase-s4b'), 'in_person_id');
SELECT m11.assert_count('tenant hold blocks every erasure',
  $$SELECT 1 FROM public.dsr_erasure_decide(m11.id('req-erase-s4b')) d
     WHERE d::text LIKE '%erasure_blocked%'$$, 1);
SELECT public.retention_legal_hold_release(m11.id('hold-tenant'), 'M11 synthetic release');
SELECT m11.logout();

-- ---- Audit trail ---------------------------------------------------------------------------------
SELECT m11.assert_count('every request has an opened event',
  $$SELECT 1 FROM public.dsr_requests r
     WHERE NOT EXISTS (SELECT 1 FROM public.dsr_request_events e
                        WHERE e.request_id = r.id AND e.event_type = 'opened')$$, 0);
SELECT m11.assert_count('blocked and cleared decisions are audited',
  $$SELECT 1 FROM public.dsr_request_events WHERE event_type IN ('erasure_blocked','erasure_cleared')$$, 6);

DO $done$ BEGIN RAISE NOTICE 'M11 ALL PASS'; END $done$;
ROLLBACK;
