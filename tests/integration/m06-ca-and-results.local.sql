-- M06 result workflow checks (LOCAL, DISPOSABLE ONLY); transaction is rolled back.
-- Run only against a loopback disposable database after replaying repository migrations.
-- Never connect this harness to a production or shared database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M06: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M06: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.m06_result_weight_profiles') IS NULL
     OR to_regprocedure('public.m06_amend_result(uuid,jsonb,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'M06: migration is not applied on this disposable DB';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        'public.m06_result_weight_profiles'::regclass,
        'public.m06_result_component_scores'::regclass,
        'public.m06_result_amendments'::regclass
      ]) AS t(oid)
     WHERE NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = t.oid)
  ) THEN
    RAISE EXCEPTION 'M06: every result table must have RLS enabled and forced';
  END IF;
END
$guard$;

CREATE SCHEMA m06;
GRANT USAGE ON SCHEMA m06 TO authenticated;
CREATE FUNCTION m06.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m06.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m06.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M06 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m06.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'M06 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m06 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a6000000-0000-4000-8000-000000000001'),
  ('a6000000-0000-4000-8000-000000000002'),
  ('a6000000-0000-4000-8000-000000000003'),
  ('b6000000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('56000000-0000-4000-8000-0000000000a1', 'M06 Synthetic Organization A', 'm06-synthetic-a'),
  ('56000000-0000-4000-8000-0000000000b1', 'M06 Synthetic Organization B', 'm06-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a6000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-0000000000a1','M06 Synthetic Teacher','m06-teacher@example.invalid','teacher',true),
  ('a6000000-0000-4000-8000-000000000002','56000000-0000-4000-8000-0000000000a1','M06 Synthetic Approver','m06-approver@example.invalid','admin',true),
  ('a6000000-0000-4000-8000-000000000003','56000000-0000-4000-8000-0000000000a1','M06 Synthetic Amender','m06-amender@example.invalid','admin',true),
  ('b6000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-0000000000b1','M06 Synthetic Other Tenant','m06-other@example.invalid','admin',true);
INSERT INTO public.classes (id, school_id, name, teacher_id) VALUES
  ('56000000-0000-4000-8000-0000000000c1','56000000-0000-4000-8000-0000000000a1','M06 Synthetic Class','a6000000-0000-4000-8000-000000000001');
INSERT INTO public.students (id, school_id, class_id, is_active) VALUES
  ('56000000-0000-4000-8000-0000000000d1','56000000-0000-4000-8000-0000000000a1','56000000-0000-4000-8000-0000000000c1',true),
  ('56000000-0000-4000-8000-0000000000d2','56000000-0000-4000-8000-0000000000a1','56000000-0000-4000-8000-0000000000c1',true);

SELECT m06.login('a6000000-0000-4000-8000-000000000002');
SELECT public.m06_set_result_weights(
  'Mathematics', 'Term 1', '2026-2027', 40, 60, 30,
  '[{"code":"quiz","weight":50,"max_score":3},{"code":"project","weight":50,"max_score":3}]'::jsonb
);
SELECT m06.logout();

SELECT m06.login('a6000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE m06_saved_result (id uuid);
INSERT INTO m06_saved_result
SELECT public.m06_enter_result_scores(
  '56000000-0000-4000-8000-0000000000d1',
  'Mathematics', 'Term 1', '2026-2027',
  '{"quiz":1,"project":1}'::jsonb, 20
);
SELECT m06.cnt(
  'weighted CA and terminal scores produce a rounded total',
  $$SELECT 1 FROM public.grades g JOIN m06_saved_result r ON r.id = g.id
      WHERE g.ca_score = 13.33 AND g.exam_score = 40 AND g.total_score = 53.33
        AND g.result_entered_by = auth.uid()$$,
  1
);
SELECT public.m06_enter_result_scores(
  '56000000-0000-4000-8000-0000000000d2',
  'Mathematics', 'Term 1', '2026-2027',
  '{"quiz":3,"project":null}'::jsonb, 30
);
SELECT m06.cnt(
  'blank CA remains NULL rather than zero',
  $$SELECT 1 FROM public.grades
      WHERE student_id='56000000-0000-4000-8000-0000000000d2'
        AND ca_score IS NULL AND total_score IS NULL$$,
  1
);
SELECT m06.denied(
  'entering teacher cannot approve own result',
  $$SELECT public.m06_approve_result((SELECT id FROM m06_saved_result))$$
);
SELECT m06.logout();

SELECT m06.login('a6000000-0000-4000-8000-000000000002');
SELECT public.m06_approve_result((SELECT id FROM m06_saved_result));
SELECT m06.denied(
  'approver cannot amend the approved result',
  $$SELECT public.m06_amend_result(
      (SELECT id FROM m06_saved_result),
      '{"quiz":2,"project":2}'::jsonb, 21, 'M06 synthetic amendment'
    )$$
);
SELECT m06.logout();

SELECT m06.login('a6000000-0000-4000-8000-000000000003');
SELECT public.m06_amend_result(
  (SELECT id FROM m06_saved_result),
  '{"quiz":2,"project":2}'::jsonb, 21, 'M06 synthetic amendment'
);
SELECT m06.cnt(
  'approved amendments create append-only audit evidence and reset approval',
  $$SELECT 1 FROM public.m06_result_amendments a
      JOIN m06_saved_result r ON r.id = a.grade_id
      JOIN public.grades g ON g.id = a.grade_id
      WHERE a.actor_id=auth.uid() AND g.result_approved_by IS NULL
        AND g.is_published IS FALSE$$,
  1
);
SELECT public.m06_approve_result((SELECT id FROM m06_saved_result));
SELECT m06.logout();

SELECT m06.login('a6000000-0000-4000-8000-000000000002');
SELECT public.m06_publish_result((SELECT id FROM m06_saved_result));
SELECT m06.denied(
  'published scores cannot be edited without audited amendment',
  $$UPDATE public.grades SET exam_score=1 WHERE id=(SELECT id FROM m06_saved_result)$$
);
SELECT m06.logout();

SELECT m06.login('b6000000-0000-4000-8000-000000000001');
SELECT m06.cnt('tenant B cannot read tenant A result weights',
  $$SELECT 1 FROM public.m06_result_weight_profiles$$, 0);
SELECT m06.cnt('tenant B cannot read tenant A component scores',
  $$SELECT 1 FROM public.m06_result_component_scores$$, 0);
SELECT m06.cnt('tenant B cannot read tenant A amendment audit',
  $$SELECT 1 FROM public.m06_result_amendments$$, 0);
SELECT m06.logout();

DO $$ BEGIN RAISE NOTICE 'M06 ALL PASS'; END $$;
ROLLBACK;
