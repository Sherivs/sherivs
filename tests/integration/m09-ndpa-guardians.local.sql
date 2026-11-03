-- M09 consent and guardian checks (LOCAL, DISPOSABLE ONLY).
-- Replay repository migrations on a loopback disposable Supabase DB first.
-- Never target a hosted or production database. This test always rolls back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M09: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M09: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.student_guardian_relationships') IS NULL
     OR to_regclass('public.student_guardian_relationship_events') IS NULL
     OR to_regprocedure('public.consent_set_v1(uuid,text,boolean,uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.consent_gate(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M09: guardian consent migration is not applied';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.student_guardian_relationships'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.student_guardian_relationship_events'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.consent_records'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.consent_events'::regclass) THEN
    RAISE EXCEPTION 'M09: relationship and consent tables must have RLS enabled and forced';
  END IF;
  IF has_function_privilege('anon', 'public.consent_set_v1(uuid,text,boolean,uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.consent_set_v1(uuid,text,boolean,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M09: consent_set_v1 execute privilege is not limited to authenticated users';
  END IF;
END
$guard$;

CREATE SCHEMA m09;
GRANT USAGE ON SCHEMA m09 TO authenticated;
CREATE FUNCTION m09.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m09.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m09.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M09 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m09.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'M09 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE FUNCTION m09.check_violation(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'M09 FAIL [%]: statement must raise check_violation', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m09 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000002'),
  ('a9000000-0000-4000-8000-000000000003'),
  ('a9000000-0000-4000-8000-000000000004'),
  ('a9000000-0000-4000-8000-000000000005'),
  ('a9000000-0000-4000-8000-000000000006'),
  ('b9000000-0000-4000-8000-000000000001'),
  ('b9000000-0000-4000-8000-000000000002');

INSERT INTO public.schools (id, name, slug) VALUES
  ('59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Organization A', 'm09-synthetic-a'),
  ('59000000-0000-4000-8000-0000000000b1', 'M09 Synthetic Organization B', 'm09-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a9000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Admin', 'm09-admin@example.invalid', 'admin', true),
  ('a9000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Legal Guardian', 'm09-guardian@example.invalid', 'parent', true),
  ('a9000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Fee Payer', 'm09-payer@example.invalid', 'parent', true),
  ('a9000000-0000-4000-8000-000000000004', '59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Caregiver', 'm09-caregiver@example.invalid', 'parent', true),
  ('a9000000-0000-4000-8000-000000000005', '59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Adult Learner', 'm09-adult@example.invalid', 'student', true),
  ('a9000000-0000-4000-8000-000000000006', '59000000-0000-4000-8000-0000000000a1', 'M09 Synthetic Minor Learner', 'm09-minor@example.invalid', 'student', true),
  ('b9000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-0000000000b1', 'M09 Synthetic Admin B', 'm09-admin-b@example.invalid', 'admin', true),
  ('b9000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-0000000000b1', 'M09 Synthetic Learner B', 'm09-learner-b@example.invalid', 'student', true);
INSERT INTO public.students (id, school_id, user_id, admission_number, date_of_birth) VALUES
  ('5a900000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-000000000006', 'M09-MINOR-A', '2014-05-01'),
  ('5a900000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-000000000005', 'M09-ADULT-A', '2000-05-01'),
  ('5b900000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-0000000000b1', 'b9000000-0000-4000-8000-000000000002', 'M09-LEARNER-B', '2010-05-01');

SELECT m09.login('a9000000-0000-4000-8000-000000000001');
SELECT public.student_guardian_relationship_set(
  '5a900000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002',
  'legal_guardian', false, 'M09 synthetic guardian evidence A'
);
SELECT public.student_guardian_relationship_set(
  '5a900000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000003',
  'fee_payer', false, 'M09 synthetic payer evidence A'
);
SELECT public.student_guardian_relationship_set(
  '5a900000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000004',
  'caregiver', false, 'M09 synthetic caregiver evidence A'
);
SELECT m09.check_violation('fee payer relationship cannot grant record access',
  $$SELECT public.student_guardian_relationship_set(
    '5a900000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000003',
    'fee_payer', true, 'M09 synthetic payer evidence A')$$);
SELECT m09.check_violation('learner cannot be their own guardian relationship',
  $$SELECT public.student_guardian_relationship_set(
    '5a900000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000006',
    'parent', true, 'M09 synthetic self relationship')$$);
SELECT m09.denied('tenant A cannot manage tenant B relationship',
  $$SELECT public.student_guardian_relationship_set(
    '5b900000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000002',
    'parent', false, 'M09 synthetic cross-tenant evidence')$$);
SELECT m09.logout();

SELECT m09.login('a9000000-0000-4000-8000-000000000002');
SELECT public.consent_set_v1(
  '5a900000-0000-4000-8000-000000000001', 'ai_processing', true,
  'a9000000-0000-4000-8000-000000000002', 'consent', 'web_form', NULL
);
SELECT m09.cnt('active guardian sees consent record',
  $$SELECT 1 FROM public.consent_records WHERE student_id='5a900000-0000-4000-8000-000000000001'$$, 1);
SELECT m09.cnt('granted purpose permits processing',
  $$SELECT 1 WHERE public.consent_gate('5a900000-0000-4000-8000-000000000001','ai_processing')$$, 1);
SELECT public.consent_set_v1(
  '5a900000-0000-4000-8000-000000000001', 'ai_processing', false,
  'a9000000-0000-4000-8000-000000000002', 'consent', 'web_form', NULL
);
SELECT m09.cnt('withdrawal blocks the purpose immediately',
  $$SELECT 1 WHERE NOT public.consent_gate('5a900000-0000-4000-8000-000000000001','ai_processing')$$, 1);
SELECT m09.cnt('consent history is append-only and retains both decisions',
  $$SELECT 1 FROM public.consent_events
     WHERE student_id='5a900000-0000-4000-8000-000000000001'
       AND lawful_basis='consent' AND granted_by='a9000000-0000-4000-8000-000000000002'$$, 2);
SELECT m09.logout();
SELECT m09.denied('consent history is append-only',
  $$DELETE FROM public.consent_events WHERE student_id='5a900000-0000-4000-8000-000000000001'$$);

SELECT m09.login('a9000000-0000-4000-8000-000000000003');
SELECT m09.cnt('fee payer cannot access learner records',
  $$SELECT 1 FROM public.students WHERE id='5a900000-0000-4000-8000-000000000001'$$, 0);
SELECT m09.cnt('fee payer cannot read relationship evidence',
  $$SELECT 1 FROM public.student_guardian_relationships WHERE student_id='5a900000-0000-4000-8000-000000000001'$$, 0);
SELECT m09.cnt('fee payer cannot read consent records',
  $$SELECT 1 FROM public.consent_records WHERE student_id='5a900000-0000-4000-8000-000000000001'$$, 0);
SELECT m09.cnt('fee payer relationship does not permit record access',
  $$SELECT 1 WHERE NOT public.student_guardian_can_access_records(
    '5a900000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-0000000000a1')$$, 1);
SELECT m09.denied('fee payer cannot grant consent',
  $$SELECT public.consent_set_v1(
    '5a900000-0000-4000-8000-000000000001', 'photos_media', true,
    'a9000000-0000-4000-8000-000000000003', 'consent', 'web_form', NULL)$$);
SELECT m09.logout();

SELECT m09.login('a9000000-0000-4000-8000-000000000004');
SELECT m09.denied('caregiver status alone cannot grant consent',
  $$SELECT public.consent_set_v1(
    '5a900000-0000-4000-8000-000000000001', 'photos_media', true,
    'a9000000-0000-4000-8000-000000000004', 'consent', 'web_form', NULL)$$);
SELECT m09.logout();

SELECT m09.login('a9000000-0000-4000-8000-000000000005');
SELECT public.consent_set_v1(
  '5a900000-0000-4000-8000-000000000002', 'photos_media', true,
  'a9000000-0000-4000-8000-000000000005', 'consent', 'web_form', NULL
);
SELECT m09.logout();
SELECT m09.cnt('adult learner consents for themself',
  $$SELECT 1 FROM public.consent_records
     WHERE student_id='5a900000-0000-4000-8000-000000000002'
       AND granted_by='a9000000-0000-4000-8000-000000000005'$$, 1);

SELECT m09.login('a9000000-0000-4000-8000-000000000006');
SELECT m09.denied('under-18 learner cannot consent without a legal guardian',
  $$SELECT public.consent_set_v1(
    '5a900000-0000-4000-8000-000000000001', 'photos_media', true,
    'a9000000-0000-4000-8000-000000000006', 'consent', 'web_form', NULL)$$);
SELECT m09.logout();

INSERT INTO public.student_guardian_relationships (
  school_id, student_id, related_user_id, relationship_type, records_access,
  evidence_ref, effective_from, created_by, updated_by
) VALUES (
  '59000000-0000-4000-8000-0000000000a1', '5a900000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000004', 'parent', false,
  'M09 synthetic prior-day parent evidence', current_date - 1,
  'a9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001'
);
SELECT m09.login('a9000000-0000-4000-8000-000000000001');
SELECT public.student_guardian_relationship_end(
  (SELECT id FROM public.student_guardian_relationships
    WHERE student_id='5a900000-0000-4000-8000-000000000001'
      AND related_user_id='a9000000-0000-4000-8000-000000000004'
      AND relationship_type='parent'),
  current_date
);
SELECT m09.logout();

SELECT m09.login('a9000000-0000-4000-8000-000000000004');
SELECT m09.denied('expired parent relationship cannot consent',
  $$SELECT public.consent_set_v1(
    '5a900000-0000-4000-8000-000000000001', 'photos_media', true,
    'a9000000-0000-4000-8000-000000000004', 'consent', 'web_form', NULL)$$);
SELECT m09.logout();

DO $audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE school_id='59000000-0000-4000-8000-0000000000a1'
       AND user_id='a9000000-0000-4000-8000-000000000002'
       AND action='consent.grant'
       AND table_name='consent_events'
       AND new_value->>'purpose'='ai_processing'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE school_id='59000000-0000-4000-8000-0000000000a1'
       AND user_id='a9000000-0000-4000-8000-000000000002'
       AND action='consent.withdraw'
       AND table_name='consent_events'
       AND new_value->>'purpose'='ai_processing'
  ) THEN
    RAISE EXCEPTION 'M09 FAIL: consent history was not audited with its actor and purpose';
  END IF;
END
$audit$;

DO $$ BEGIN RAISE NOTICE 'M09 ALL PASS'; END $$;
ROLLBACK;
