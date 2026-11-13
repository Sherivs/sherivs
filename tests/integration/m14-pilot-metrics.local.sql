-- M14 pilot metrics contract (LOCAL disposable PostgreSQL only).
--   psql "postgresql://postgres@127.0.0.1:54329/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m14-pilot-metrics.local.sql
-- Synthetic fixtures only; the transaction rolls back and never touches a hosted database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M14: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M14: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.pilot_metric_samples') IS NULL
     OR to_regprocedure('public.pilot_metrics_report(uuid,date,date)') IS NULL THEN
    RAISE EXCEPTION 'M14 migration is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class
              WHERE oid IN ('public.pilot_metric_definitions'::regclass,
                            'public.pilot_metric_samples'::regclass,
                            'public.pilot_metric_sample_log'::regclass)
                AND NOT (relrowsecurity AND relforcerowsecurity)) THEN
    RAISE EXCEPTION 'M14 tables must have RLS enabled and forced';
  END IF;
END
$guard$;

-- The schema must carry no personal identifiers: no person-referencing columns or foreign keys.
DO $pii$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_bad
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('pilot_metric_definitions','pilot_metric_samples','pilot_metric_sample_log')
     AND column_name ~* '(name|email|phone|user|student|staff|teacher|guardian|parent|person|subject|actor|by$)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'M14 FAIL: personal-identifier-like columns in metrics schema: %', v_bad;
  END IF;
  SELECT string_agg(conrelid::regclass || ' -> ' || confrelid::regclass, ', ') INTO v_bad
    FROM pg_constraint
   WHERE contype = 'f'
     AND conrelid IN ('public.pilot_metric_samples'::regclass, 'public.pilot_metric_sample_log'::regclass,
                      'public.pilot_metric_definitions'::regclass)
     AND confrelid NOT IN ('public.schools'::regclass, 'public.pilot_metric_definitions'::regclass,
                           'public.pilot_metric_samples'::regclass);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'M14 FAIL: metrics tables reference non-aggregate tables: %', v_bad;
  END IF;
END
$pii$;

CREATE SCHEMA m14;
GRANT USAGE ON SCHEMA m14 TO anon, authenticated, service_role;
CREATE TABLE m14.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m14.ids TO anon, authenticated;
GRANT SELECT ON m14.ids TO service_role;
CREATE FUNCTION m14.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m14.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION m14.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m14.id(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM m14.ids WHERE name = p_name $$;
CREATE FUNCTION m14.assert_count(p_label text, p_sql text, p_expected bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M14 FAIL [%]: expected % rows, got %', p_label, p_expected, v_count;
  END IF;
END $$;
CREATE FUNCTION m14.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'M14 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE FUNCTION m14.rejected(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'M14 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M14 FAIL [%]: statement was allowed but must be rejected', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m14 TO anon, authenticated, service_role;

INSERT INTO auth.users (id) VALUES
  ('a1140000-0000-4000-8000-000000000001'),
  ('a1140000-0000-4000-8000-000000000002'),
  ('b1140000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('b1140000-0000-4000-8000-0000000000a1', 'M14 Synthetic Tenant A', 'm14-synthetic-a'),
  ('b1140000-0000-4000-8000-0000000000b2', 'M14 Synthetic Tenant B', 'm14-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a1140000-0000-4000-8000-000000000001', 'b1140000-0000-4000-8000-0000000000a1',
   'M14 Synthetic Admin A', 'admin-a@m14.invalid', 'admin', true),
  ('a1140000-0000-4000-8000-000000000002', 'b1140000-0000-4000-8000-0000000000a1',
   'M14 Synthetic Teacher A', 'teacher-a@m14.invalid', 'teacher', true),
  ('b1140000-0000-4000-8000-000000000001', 'b1140000-0000-4000-8000-0000000000b2',
   'M14 Synthetic Admin B', 'admin-b@m14.invalid', 'admin', true);
INSERT INTO public.students (id, school_id, admission_number)
SELECT ('c1140000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       'b1140000-0000-4000-8000-0000000000a1', 'M14-A-' || g
  FROM generate_series(1, 6) g;
INSERT INTO public.students (id, school_id, admission_number) VALUES
  ('c1140000-0000-4000-8000-0000000000b1', 'b1140000-0000-4000-8000-0000000000b2', 'M14-B-001');
-- Day 1: all 6 students captured. Day 2: only 3 captured.
INSERT INTO public.attendance (school_id, student_id, date, status)
SELECT 'b1140000-0000-4000-8000-0000000000a1',
       ('c1140000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       DATE '2026-10-05', 'present'
  FROM generate_series(1, 6) g;
INSERT INTO public.attendance (school_id, student_id, date, status)
SELECT 'b1140000-0000-4000-8000-0000000000a1',
       ('c1140000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       DATE '2026-10-06', 'present'
  FROM generate_series(1, 3) g;
INSERT INTO m14.ids VALUES
  ('tenant-a','b1140000-0000-4000-8000-0000000000a1'),
  ('tenant-b','b1140000-0000-4000-8000-0000000000b2'),
  ('admin-a','a1140000-0000-4000-8000-000000000001'),
  ('teacher-a','a1140000-0000-4000-8000-000000000002'),
  ('admin-b','b1140000-0000-4000-8000-000000000001');

-- ---- Manager captures and records aggregates ----------------------------------------------------
SELECT m14.login(m14.id('admin-a'));
SELECT public.pilot_metric_capture_attendance(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31');
DO $att$
DECLARE s public.pilot_metric_samples%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.pilot_metric_samples
   WHERE org_id = m14.id('tenant-a') AND metric_key = 'attendance_capture_rate';
  IF s.numerator <> 9 OR s.denominator <> 12 OR s.source <> 'derived' THEN
    RAISE EXCEPTION 'M14 FAIL: attendance capture should be 9/12 derived, got %', to_jsonb(s);
  END IF;
END
$att$;
SELECT m14.rejected('attendance capture cannot be hand-recorded',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'attendance_capture_rate',
     DATE '2026-10-01', DATE '2026-10-31', 12, 12)$$, '22023');
SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround',
  DATE '2026-10-01', DATE '2026-10-31', 360000, 10);
SELECT public.pilot_metric_record(m14.id('tenant-a'), 'fee_reconciliation_time',
  DATE '2026-10-01', DATE '2026-10-31', 9000, 3);
SELECT public.pilot_metric_record(m14.id('tenant-a'), 'asc_export_completeness',
  DATE '2026-10-01', DATE '2026-10-31', 95, 100);
SELECT m14.rejected('rate numerator cannot exceed denominator',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'asc_export_completeness',
     DATE '2026-09-01', DATE '2026-09-30', 101, 100)$$, '22023');
SELECT m14.rejected('negative counters rejected',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround',
     DATE '2026-09-01', DATE '2026-09-30', -1, 5)$$, '22023');
SELECT m14.rejected('period end before start rejected',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround',
     DATE '2026-09-30', DATE '2026-09-01', 1, 5)$$, '22023');
SELECT m14.rejected('unknown metric rejected',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'favourite_student',
     DATE '2026-09-01', DATE '2026-09-30', 1, 5)$$, '22023');

DO $report$
DECLARE v jsonb; m jsonb;
BEGIN
  v := public.pilot_metrics_report(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31');
  IF jsonb_array_length(v->'metrics') <> 4 THEN RAISE EXCEPTION 'M14 FAIL: report must list 4 metrics: %', v; END IF;
  SELECT x INTO m FROM jsonb_array_elements(v->'metrics') x WHERE x->>'metricKey' = 'attendance_capture_rate';
  IF (m->>'value')::numeric <> 0.75 OR (m->>'suppressed')::boolean THEN
    RAISE EXCEPTION 'M14 FAIL: attendance capture rate must be 0.75: %', m;
  END IF;
  SELECT x INTO m FROM jsonb_array_elements(v->'metrics') x WHERE x->>'metricKey' = 'result_turnaround';
  IF (m->>'value')::numeric <> 36000 OR m->>'unit' <> 'seconds' THEN
    RAISE EXCEPTION 'M14 FAIL: result turnaround must average 36000 s: %', m;
  END IF;
  SELECT x INTO m FROM jsonb_array_elements(v->'metrics') x WHERE x->>'metricKey' = 'fee_reconciliation_time';
  IF NOT (m->>'suppressed')::boolean OR (m->'value') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'M14 FAIL: a metric with fewer than 5 observations must be suppressed: %', m;
  END IF;
  SELECT x INTO m FROM jsonb_array_elements(v->'metrics') x WHERE x->>'metricKey' = 'asc_export_completeness';
  IF (m->>'value')::numeric <> 0.95 THEN RAISE EXCEPTION 'M14 FAIL: ASC completeness must be 0.95: %', m; END IF;
  -- A narrower window excludes samples that fall outside it.
  v := public.pilot_metrics_report(m14.id('tenant-a'), DATE '2026-11-01', DATE '2026-11-30');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v->'metrics') x WHERE NOT (x->>'suppressed')::boolean) THEN
    RAISE EXCEPTION 'M14 FAIL: an empty window must suppress every metric: %', v;
  END IF;
END
$report$;

-- Re-capturing updates the sample and keeps both values in the append-only log.
INSERT INTO public.attendance (school_id, student_id, date, status) VALUES
  ('b1140000-0000-4000-8000-0000000000a1', 'c1140000-0000-4000-8000-000000000004', DATE '2026-10-06', 'present');
SELECT public.pilot_metric_capture_attendance(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31');
SELECT m14.assert_count('re-capture keeps one sample per period',
  $$SELECT 1 FROM public.pilot_metric_samples WHERE metric_key = 'attendance_capture_rate'$$, 1);
SELECT m14.assert_count('log keeps both captured values',
  $$SELECT 1 FROM public.pilot_metric_sample_log WHERE metric_key = 'attendance_capture_rate'$$, 2);
SELECT m14.assert_count('re-capture shows the new numerator',
  $$SELECT 1 FROM public.pilot_metric_samples WHERE metric_key = 'attendance_capture_rate' AND numerator = 10$$, 1);
SELECT m14.logout();

-- ---- Authority, isolation, immutability --------------------------------------------------------
SELECT m14.login(m14.id('teacher-a'));
SELECT m14.denied('non-manager cannot capture',
  $$SELECT public.pilot_metric_capture_attendance(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31')$$);
SELECT m14.denied('non-manager cannot record',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround', DATE '2026-10-01', DATE '2026-10-31', 1, 5)$$);
SELECT m14.denied('non-manager cannot read the report',
  $$SELECT public.pilot_metrics_report(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31')$$);
SELECT m14.assert_count('non-manager sees no samples', $$SELECT 1 FROM public.pilot_metric_samples$$, 0);
SELECT m14.logout();

SELECT m14.login(m14.id('admin-b'));
SELECT m14.denied('tenant B cannot capture for tenant A',
  $$SELECT public.pilot_metric_capture_attendance(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31')$$);
SELECT m14.denied('tenant B cannot record for tenant A',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround', DATE '2026-10-01', DATE '2026-10-31', 1, 5)$$);
SELECT m14.denied('tenant B cannot report on tenant A',
  $$SELECT public.pilot_metrics_report(m14.id('tenant-a'), DATE '2026-10-01', DATE '2026-10-31')$$);
SELECT m14.assert_count('tenant B cannot read tenant A samples',
  $$SELECT 1 FROM public.pilot_metric_samples WHERE org_id = m14.id('tenant-a')$$, 0);
SELECT m14.assert_count('tenant B cannot read tenant A log',
  $$SELECT 1 FROM public.pilot_metric_sample_log WHERE org_id = m14.id('tenant-a')$$, 0);
SELECT m14.assert_count('definitions are readable reference data',
  $$SELECT 1 FROM public.pilot_metric_definitions$$, 4);
SELECT public.pilot_metric_capture_attendance(m14.id('tenant-b'), DATE '2026-10-01', DATE '2026-10-31');
SELECT m14.denied('no direct sample insert',
  $$INSERT INTO public.pilot_metric_samples (org_id, metric_key, period_start, period_end, numerator, denominator, source)
    VALUES (m14.id('tenant-b'), 'result_turnaround', DATE '2026-10-01', DATE '2026-10-31', 1, 1, 'recorded')$$);
SELECT m14.denied('no direct sample update', $$UPDATE public.pilot_metric_samples SET numerator = 0$$);
SELECT m14.denied('no direct log delete', $$DELETE FROM public.pilot_metric_sample_log$$);
SELECT m14.logout();

SELECT m14.login_as('anon');
SELECT m14.denied('anon cannot read samples', $$SELECT count(*) FROM public.pilot_metric_samples$$);
SELECT m14.denied('anon cannot record',
  $$SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround', DATE '2026-10-01', DATE '2026-10-31', 1, 5)$$);
SELECT m14.logout();

SELECT m14.login_as('service_role');
SELECT public.pilot_metric_record(m14.id('tenant-a'), 'result_turnaround',
  DATE '2026-11-01', DATE '2026-11-30', 7200, 6);
SELECT m14.logout();
SELECT m14.assert_count('scheduler-recorded sample is stored',
  $$SELECT 1 FROM public.pilot_metric_samples WHERE period_start = DATE '2026-11-01'$$, 1);

SELECT m14.denied('sample identity is immutable',
  $$UPDATE public.pilot_metric_samples SET period_end = period_end + 1 WHERE metric_key = 'result_turnaround'$$);
SELECT m14.denied('samples cannot be deleted', $$DELETE FROM public.pilot_metric_samples$$);
SELECT m14.denied('log cannot be truncated', $$TRUNCATE public.pilot_metric_sample_log$$);
SELECT m14.denied('definitions are immutable', $$UPDATE public.pilot_metric_definitions SET title = 'x'$$);

DO $done$ BEGIN RAISE NOTICE 'M14 ALL PASS'; END $done$;
ROLLBACK;
