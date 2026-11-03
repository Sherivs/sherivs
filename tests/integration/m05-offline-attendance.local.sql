-- M05 attendance checks (LOCAL, DISPOSABLE ONLY); transaction is always rolled back.
-- Run only against a loopback disposable database after replaying repository migrations:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m05-offline-attendance.local.sql
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M05: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M05: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.class_attendance_marks') IS NULL
     OR to_regprocedure('public.offline_attendance_capture_sync_m05(text,jsonb,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'M05: migration is not applied on this disposable DB';
  END IF;
  IF NOT (
    SELECT relrowsecurity AND relforcerowsecurity
      FROM pg_class WHERE oid = 'public.class_attendance_marks'::regclass
  ) THEN
    RAISE EXCEPTION 'M05: attendance marks must have RLS enabled and forced';
  END IF;
END
$guard$;

CREATE SCHEMA m05;
GRANT USAGE ON SCHEMA m05 TO authenticated;
CREATE FUNCTION m05.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m05.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m05.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M05 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m05.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'M05 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m05 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a5000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000002'),
  ('b5000000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('55000000-0000-4000-8000-0000000000a1', 'M05 Synthetic Organization A', 'm05-synthetic-a'),
  ('55000000-0000-4000-8000-0000000000b1', 'M05 Synthetic Organization B', 'm05-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a5000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-0000000000a1','M05 Synthetic Teacher A','m05-teacher-a@example.invalid','teacher',true),
  ('a5000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-0000000000a1','M05 Synthetic Teacher B','m05-teacher-b@example.invalid','teacher',true),
  ('b5000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-0000000000b1','M05 Synthetic Teacher Other Tenant','m05-other-tenant-teacher@example.invalid','teacher',true);
INSERT INTO public.classes (id, school_id, name, teacher_id) VALUES
  ('55000000-0000-4000-8000-0000000000c1','55000000-0000-4000-8000-0000000000a1','M05 Synthetic Class A','a5000000-0000-4000-8000-000000000001'),
  ('55000000-0000-4000-8000-0000000000c2','55000000-0000-4000-8000-0000000000a1','M05 Synthetic Class B','a5000000-0000-4000-8000-000000000002');
INSERT INTO public.students (id, school_id, class_id, is_active) VALUES
  ('55000000-0000-4000-8000-0000000000d1','55000000-0000-4000-8000-0000000000a1','55000000-0000-4000-8000-0000000000c1',true),
  ('55000000-0000-4000-8000-0000000000d2','55000000-0000-4000-8000-0000000000a1','55000000-0000-4000-8000-0000000000c2',true);
INSERT INTO public.school_shifts (id, school_id, campus_id, name, kind) VALUES
  ('55000000-0000-4000-8000-0000000000e1','55000000-0000-4000-8000-0000000000a1',NULL,'M05 Synthetic Shift','morning');
INSERT INTO public.class_attendance_marks (
  school_id, class_id, student_id, attendance_date, period_key, status, marked_by, captured_at
) VALUES (
  '55000000-0000-4000-8000-0000000000a1',
  '55000000-0000-4000-8000-0000000000c1',
  '55000000-0000-4000-8000-0000000000d1',
  current_date, 'period-2', 'present',
  'a5000000-0000-4000-8000-000000000002', now()
);

SELECT m05.login('a5000000-0000-4000-8000-000000000001');
DO $assigned_teacher$
DECLARE first_result jsonb; replay_result jsonb;
BEGIN
  first_result := public.offline_attendance_capture_sync_m05(
    'm05-batch-assigned',
    jsonb_build_array(jsonb_build_object(
      'id','m05-item-assigned',
      'class_id','55000000-0000-4000-8000-0000000000c1',
      'student_id','55000000-0000-4000-8000-0000000000d1',
      'shift_id','55000000-0000-4000-8000-0000000000e1',
      'date',current_date,
      'period_key','period-1',
      'status','present',
      'captured_at',now()
    )),
    now()
  );
  replay_result := public.offline_attendance_capture_sync_m05(
    'm05-batch-assigned',
    jsonb_build_array(jsonb_build_object(
      'id','m05-item-assigned',
      'class_id','55000000-0000-4000-8000-0000000000c1',
      'student_id','55000000-0000-4000-8000-0000000000d1',
      'shift_id','55000000-0000-4000-8000-0000000000e1',
      'date',current_date,
      'period_key','period-1',
      'status','present',
      'captured_at',now()
    )),
    now()
  );
  IF first_result->>'applied' <> '1' OR replay_result->>'replay' <> 'true' THEN
    RAISE EXCEPTION 'M05 FAIL [same queued batch is replay-safe]: %, %', first_result, replay_result;
  END IF;
END
$assigned_teacher$;
DO $conflict_replay$
DECLARE first_result jsonb; retry_result jsonb;
BEGIN
  first_result := public.offline_attendance_capture_sync_m05(
    'm05-batch-conflict-one',
    jsonb_build_array(jsonb_build_object(
      'id','m05-item-conflict-replay',
      'class_id','55000000-0000-4000-8000-0000000000c1',
      'student_id','55000000-0000-4000-8000-0000000000d1',
      'shift_id',NULL,
      'date',current_date,
      'period_key','period-2',
      'status','absent',
      'captured_at',now()
    )),
    now()
  );
  retry_result := public.offline_attendance_capture_sync_m05(
    'm05-batch-conflict-two',
    jsonb_build_array(jsonb_build_object(
      'id','m05-item-conflict-replay',
      'class_id','55000000-0000-4000-8000-0000000000c1',
      'student_id','55000000-0000-4000-8000-0000000000d1',
      'shift_id',NULL,
      'date',current_date,
      'period_key','period-2',
      'status','absent',
      'captured_at',now()
    )),
    now()
  );
  IF first_result->'conflicts'->0->>'why' <> 'server_has_other_mark'
     OR retry_result->'conflicts'->0->>'why' <> 'server_has_other_mark'
     OR retry_result->>'duplicates' <> '0' THEN
    RAISE EXCEPTION 'M05 FAIL [item conflict remains visible on retry]: %, %', first_result, retry_result;
  END IF;
END
$conflict_replay$;
SELECT m05.cnt('replayed conflict remains recorded once',
  $$SELECT 1 FROM public.class_attendance_sync_conflicts
     WHERE client_item_id='m05-item-conflict-replay'$$, 1);
SELECT m05.cnt('replaying the same batch creates no duplicate mark',
  $$SELECT 1 FROM public.class_attendance_marks
     WHERE class_id='55000000-0000-4000-8000-0000000000c1'
       AND student_id='55000000-0000-4000-8000-0000000000d1'
       AND period_key='period-1'$$, 1);
SELECT m05.cnt('teacher B cannot read teacher A class marks',
  $$SELECT 1 FROM public.class_attendance_marks
     WHERE class_id='55000000-0000-4000-8000-0000000000c2'$$, 0);
SELECT m05.denied('client cannot insert attendance marks directly',
  $$INSERT INTO public.class_attendance_marks (
      school_id, class_id, student_id, attendance_date, period_key, status, marked_by, captured_at
    ) VALUES (
      '55000000-0000-4000-8000-0000000000a1',
      '55000000-0000-4000-8000-0000000000c1',
      '55000000-0000-4000-8000-0000000000d1',
      current_date, 'daily', 'present', auth.uid(), now()
    )$$);
SELECT m05.logout();

SELECT m05.login('a5000000-0000-4000-8000-000000000002');
DO $unassigned_teacher$
DECLARE result jsonb;
BEGIN
  result := public.offline_attendance_capture_sync_m05(
    'm05-batch-unassigned',
    jsonb_build_array(jsonb_build_object(
      'id','m05-item-unassigned',
      'class_id','55000000-0000-4000-8000-0000000000c1',
      'student_id','55000000-0000-4000-8000-0000000000d1',
      'shift_id',NULL,
      'date',current_date,
      'period_key','daily',
      'status','absent',
      'captured_at',now()
    )),
    now()
  );
  IF result->'conflicts'->0->>'why' <> 'not_your_class' THEN
    RAISE EXCEPTION 'M05 FAIL [unassigned teacher cannot mark class]: %', result;
  END IF;
END
$unassigned_teacher$;
SELECT m05.cnt('unassigned teacher cannot read another teacher class marks',
  $$SELECT 1 FROM public.class_attendance_marks
     WHERE class_id='55000000-0000-4000-8000-0000000000c1'$$, 0);
SELECT m05.logout();

SELECT m05.login('a5000000-0000-4000-8000-000000000002');
DO $own_class$
DECLARE result jsonb;
BEGIN
  result := public.offline_attendance_capture_sync_m05(
    'm05-batch-class-b',
    jsonb_build_array(jsonb_build_object(
      'id','m05-item-class-b',
      'class_id','55000000-0000-4000-8000-0000000000c2',
      'student_id','55000000-0000-4000-8000-0000000000d2',
      'shift_id',NULL,
      'date',current_date,
      'period_key','daily',
      'status','late',
      'captured_at',now()
    )),
    now()
  );
  IF result->>'applied' <> '1' THEN
    RAISE EXCEPTION 'M05 FAIL [assigned teacher can mark own class]: %', result;
  END IF;
END
$own_class$;
SELECT m05.cnt('assigned teacher can mark their own class',
  $$SELECT 1 FROM public.class_attendance_marks
     WHERE class_id='55000000-0000-4000-8000-0000000000c2'$$, 1);
SELECT m05.cnt('teacher B cannot read teacher A class marks',
  $$SELECT 1 FROM public.class_attendance_marks
     WHERE class_id='55000000-0000-4000-8000-0000000000c1'$$, 0);
SELECT m05.logout();

SELECT m05.login('b5000000-0000-4000-8000-000000000001');
SELECT m05.cnt('tenant B reads no tenant A marks', $$SELECT 1 FROM public.class_attendance_marks$$, 0);
SELECT m05.logout();

DO $$ BEGIN RAISE NOTICE 'M05 ALL PASS'; END $$;
ROLLBACK;
