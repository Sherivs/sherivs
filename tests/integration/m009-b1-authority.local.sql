-- M009 B-1 verified-authority checks (LOCAL, NAMED DISPOSABLE DATABASE ONLY).
-- Replay repository migrations on a disposable DB named `m009_b1_authority_test`,
-- then run:
--   PGOPTIONS='-c m009b1.test_disposable_database=on' \
--     psql "postgresql://supabase_admin@127.0.0.1:<port>/m009_b1_authority_test" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m009-b1-authority.local.sql
-- Every fixture and role change is rolled back. Never run on hosted or production DBs.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M009-B1: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M009-B1: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF current_database() <> 'm009_b1_authority_test'
     OR current_setting('m009b1.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'M009-B1: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regclass('public.institution_authority_links') IS NULL
     OR to_regprocedure('public.workspace_role_assignment_create(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,uuid,text[],text[])') IS NULL
     OR to_regprocedure('public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz)') IS NULL
     OR to_regprocedure('public.workspace_authority_link_evidence_is_verified(uuid,text[],timestamptz,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'M009-B1: authority, role-engine, and gate migrations must be applied';
  END IF;
END
$guard$;

CREATE SCHEMA m009b1;
GRANT USAGE ON SCHEMA m009b1 TO authenticated;
GRANT USAGE ON SCHEMA m009b1 TO service_role;
CREATE TABLE m009b1.link_ids (label text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE m009b1.assignment_ids (label text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION m009b1.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m009b1.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m009b1.deny_assignment(p_label text, p_evidence text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.workspace_role_assignment_create(
    'b1000000-0000-4000-8000-0000000000a1',
    'c9000000-0000-4000-8000-000000000002',
    'ng.principal','org',NULL,clock_timestamp(),NULL,false,NULL,
    coalesce(p_evidence,'{}'::text[]),'{}'::text[]
  );
  RAISE EXCEPTION 'M009-B1 FAIL [%]: assignment was allowed', p_label;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN;
END $$;
CREATE FUNCTION m009b1.assert_count(p_label text, p_sql text, p_expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M009-B1 FAIL [%]: expected % rows, got %', p_label, p_expected, v_count;
  END IF;
END $$;
CREATE FUNCTION m009b1.null_actor_assignment() RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.workspace_role_assignment_create(
    'b1000000-0000-4000-8000-0000000000a1',
    'c9000000-0000-4000-8000-000000000002',
    'ng.principal','org',NULL,clock_timestamp(),NULL,false,NULL,
    ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='independent valid authority')::text],
    '{}'::text[]
  )
$$;
CREATE FUNCTION m009b1.assert_null_actor_permissions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workspace_effective_permission_rows_at(
      'b1000000-0000-4000-8000-0000000000a1',
      'c9000000-0000-4000-8000-000000000002',clock_timestamp()
    )
  ) THEN
    RAISE EXCEPTION 'M009-B1 FAIL [service-role null actor]: permission resolution was allowed';
  END IF;
END
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA m009b1 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  m009b1.login(uuid),
  m009b1.logout(),
  m009b1.deny_assignment(text,text[]),
  m009b1.assert_count(text,text,bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION m009b1.null_actor_assignment(), m009b1.assert_null_actor_permissions()
  TO service_role;
GRANT SELECT, INSERT ON m009b1.link_ids, m009b1.assignment_ids TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('c9000000-0000-4000-8000-000000000001'),
  ('c9000000-0000-4000-8000-000000000002'),
  ('c9000000-0000-4000-8000-000000000003'),
  ('c9000000-0000-4000-8000-000000000004');
INSERT INTO public.schools (id, name, slug) VALUES
  ('b1000000-0000-4000-8000-0000000000a1','M009-B1 Synthetic Tenant A','m009-b1-synthetic-a'),
  ('b1000000-0000-4000-8000-0000000000b1','M009-B1 Synthetic Tenant B','m009-b1-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('c9000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-0000000000a1','M009-B1 Assigning Admin','m009-b1-assigner@example.invalid','admin',true),
  ('c9000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-0000000000a1','M009-B1 Assigned Executive','m009-b1-executive@example.invalid','admin',true),
  ('c9000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-0000000000a1','M009-B1 Independent Verifier','m009-b1-verifier@example.invalid','admin',true),
  ('c9000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-0000000000b1','M009-B1 Foreign Admin','m009-b1-foreign@example.invalid','admin',true);

-- Each verification is stamped by a different synthetic identity as indicated by its label.
SELECT m009b1.login('c9000000-0000-4000-8000-000000000001');
DO $assigner_verified_link$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.institution_authority_links (
    school_id, authority_name, source, effective_from, verification_status
  ) VALUES (
    'b1000000-0000-4000-8000-0000000000a1','M009-B1 Same-actor synthetic authority',
    'M009-B1 disposable synthetic fixture',clock_timestamp() - interval '1 day','unverified'
  ) RETURNING id INTO v_id;
  UPDATE public.institution_authority_links
     SET verification_status='verified', evidence_url='https://example.invalid/m009-b1-assigner'
   WHERE id=v_id;
  INSERT INTO m009b1.link_ids VALUES ('verifier is assignment actor',v_id);
END
$assigner_verified_link$;
SELECT m009b1.logout();

SELECT m009b1.login('c9000000-0000-4000-8000-000000000002');
DO $assignee_verified_link$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.institution_authority_links (
    school_id, authority_name, source, effective_from, verification_status
  ) VALUES (
    'b1000000-0000-4000-8000-0000000000a1','M009-B1 Same-assignee synthetic authority',
    'M009-B1 disposable synthetic fixture',clock_timestamp() - interval '1 day','unverified'
  ) RETURNING id INTO v_id;
  UPDATE public.institution_authority_links
     SET verification_status='verified', evidence_url='https://example.invalid/m009-b1-assignee'
   WHERE id=v_id;
  INSERT INTO m009b1.link_ids VALUES ('verifier is assignee',v_id);
END
$assignee_verified_link$;
SELECT m009b1.logout();

SELECT m009b1.login('c9000000-0000-4000-8000-000000000003');
DO $independent_links$
BEGIN
  INSERT INTO public.institution_authority_links (
    school_id, authority_name, source, effective_from, effective_until, verification_status
  ) VALUES
    ('b1000000-0000-4000-8000-0000000000a1','M009-B1 Unverified authority','M009-B1 fixture',clock_timestamp() - interval '1 day',NULL,'unverified'),
    ('b1000000-0000-4000-8000-0000000000a1','M009-B1 Expired authority','M009-B1 fixture',clock_timestamp() - interval '3 days',clock_timestamp() - interval '2 days','unverified'),
    ('b1000000-0000-4000-8000-0000000000a1','M009-B1 Future authority','M009-B1 fixture',clock_timestamp() + interval '1 day',NULL,'unverified'),
    ('b1000000-0000-4000-8000-0000000000a1','M009-B1 Valid authority','M009-B1 fixture',clock_timestamp() - interval '1 day',NULL,'unverified');

  INSERT INTO m009b1.link_ids
  SELECT CASE authority_name
    WHEN 'M009-B1 Unverified authority' THEN 'unverified'
    WHEN 'M009-B1 Expired authority' THEN 'expired'
    WHEN 'M009-B1 Future authority' THEN 'not-yet-effective'
    ELSE 'independent valid authority'
  END, id
    FROM public.institution_authority_links
   WHERE school_id='b1000000-0000-4000-8000-0000000000a1'
     AND authority_name IN (
       'M009-B1 Unverified authority','M009-B1 Expired authority',
       'M009-B1 Future authority','M009-B1 Valid authority'
     );

  UPDATE public.institution_authority_links
     SET verification_status='verified',
         evidence_url='https://example.invalid/m009-b1-independent'
   WHERE id IN (
     SELECT id FROM m009b1.link_ids
      WHERE label IN ('expired','not-yet-effective','independent valid authority')
   );
END
$independent_links$;
SELECT m009b1.logout();

SELECT m009b1.login('c9000000-0000-4000-8000-000000000004');
DO $foreign_link$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.institution_authority_links (
    school_id, authority_name, source, effective_from, verification_status
  ) VALUES (
    'b1000000-0000-4000-8000-0000000000b1','M009-B1 Foreign authority',
    'M009-B1 disposable synthetic fixture',clock_timestamp() - interval '1 day','unverified'
  ) RETURNING id INTO v_id;
  UPDATE public.institution_authority_links
     SET verification_status='verified', evidence_url='https://example.invalid/m009-b1-foreign'
   WHERE id=v_id;
  INSERT INTO m009b1.link_ids VALUES ('wrong-tenant',v_id);
END
$foreign_link$;
SELECT m009b1.logout();

SELECT m009b1.login('c9000000-0000-4000-8000-000000000001');
SELECT m009b1.deny_assignment('unverified',
  ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='unverified')::text]);
SELECT m009b1.deny_assignment('expired',
  ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='expired')::text]);
SELECT m009b1.deny_assignment('not-yet-effective',
  ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='not-yet-effective')::text]);
SELECT m009b1.deny_assignment('wrong-tenant',
  ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='wrong-tenant')::text]);
SELECT m009b1.deny_assignment('zero evidence','{}'::text[]);
SELECT m009b1.deny_assignment('ambiguous evidence',ARRAY[
  'authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='independent valid authority')::text,
  'authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='independent valid authority')::text
]);
SELECT m009b1.deny_assignment('malformed evidence',ARRAY['authority_link:not-a-uuid']);
SELECT m009b1.deny_assignment('verifier is assignment actor',
  ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='verifier is assignment actor')::text]);
SELECT m009b1.deny_assignment('verifier is assignee',
  ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='verifier is assignee')::text]);

INSERT INTO m009b1.assignment_ids (label,id)
SELECT 'independent assignment',
  public.workspace_role_assignment_create(
    'b1000000-0000-4000-8000-0000000000a1',
    'c9000000-0000-4000-8000-000000000002',
    'ng.principal','org',NULL,clock_timestamp() - interval '1 minute',NULL,
    false,NULL,
    ARRAY['authority_link:' || (SELECT id FROM m009b1.link_ids WHERE label='independent valid authority')::text],
    '{}'::text[]
  );
SELECT m009b1.logout();

-- Resolver calls intentionally run as the database owner so the private RPC can be exercised;
-- auth.uid() is still set to the synthetic assignee and tenant membership is checked by the gate.
SELECT m009b1.login('c9000000-0000-4000-8000-000000000002');
SELECT m009b1.logout();
SELECT m009b1.assert_count('independent verified assignment resolves permissions',
  $$SELECT 1 FROM public.workspace_effective_permission_rows_at(
      'b1000000-0000-4000-8000-0000000000a1',
      'c9000000-0000-4000-8000-000000000002',clock_timestamp()
    ) WHERE permission_code='analytics.institution'$$,1);

SELECT m009b1.login('c9000000-0000-4000-8000-000000000003');
UPDATE public.institution_authority_links
   SET effective_until=clock_timestamp() - interval '1 second'
 WHERE id=(SELECT id FROM m009b1.link_ids WHERE label='independent valid authority');
SELECT m009b1.logout();
SELECT m009b1.assert_count('link expires after assignment',
  $$SELECT 1 FROM public.workspace_effective_permission_rows_at(
      'b1000000-0000-4000-8000-0000000000a1',
      'c9000000-0000-4000-8000-000000000002',clock_timestamp()
    ) WHERE permission_code='analytics.institution'$$,0);

SELECT m009b1.login('c9000000-0000-4000-8000-000000000003');
UPDATE public.institution_authority_links
   SET effective_until=NULL, verification_status='unverified'
 WHERE id=(SELECT id FROM m009b1.link_ids WHERE label='independent valid authority');
SELECT m009b1.logout();
SELECT m009b1.assert_count('link reverts to unverified',
  $$SELECT 1 FROM public.workspace_effective_permission_rows_at(
      'b1000000-0000-4000-8000-0000000000a1',
      'c9000000-0000-4000-8000-000000000002',clock_timestamp()
    ) WHERE permission_code='analytics.institution'$$,0);

-- The NULL-auth/service-role path cannot create a gated assignment or resolve permissions.
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $null_actor$
BEGIN
  BEGIN
    PERFORM m009b1.null_actor_assignment();
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'M009-B1 FAIL [service-role null actor]: assignment was allowed';
END
$null_actor$;
SELECT m009b1.assert_null_actor_permissions();
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'M009-B1 AUTHORITY ALL PASS'; END $$;
ROLLBACK;
