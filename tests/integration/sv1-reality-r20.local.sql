-- SV1-REALITY R20 reserved reality.* profile writer (LOCAL, DISPOSABLE DATABASE ONLY).
--   createdb reality_r20_test; replay every migration; then
--   PGOPTIONS='-c coregrid.test_disposable_database=on' psql -h 127.0.0.1 -v ON_ERROR_STOP=1 \
--     -f tests/integration/sv1-reality-r20.local.sql reality_r20_test      (from the repository root)
-- Synthetic ids only. Always rolls back. Never target a hosted or production database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'R20: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'R20: refusing non-loopback database server %', inet_server_addr();
  END IF;
  IF current_database() NOT IN ('reality_r20_test')
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'R20: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regprocedure('public.upsert_reality_profile(uuid,uuid,text,text,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'R20: the R20 migration must be applied to this disposable database first';
  END IF;
END
$guard$;

CREATE SCHEMA r20;
GRANT USAGE ON SCHEMA r20 TO authenticated, anon, service_role;
CREATE FUNCTION r20.as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION r20.as_role(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION r20.back() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION r20.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RAISE NOTICE 'ok  - %', p_label; RETURN; END IF;
    RAISE EXCEPTION 'R20 FAIL [%]: expected SQLSTATE %, got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'R20 FAIL [%]: statement succeeded but must be refused', p_label;
END $$;
CREATE FUNCTION r20.expect_ok(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE 'ok  - %', p_label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'R20 FAIL [%]: expected success, got % (%)', p_label, SQLSTATE, SQLERRM;
END $$;
CREATE FUNCTION r20.assert_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'R20 FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA r20 TO authenticated, anon, service_role;

INSERT INTO auth.users (id) VALUES ('a3300000-0000-4000-8000-00000000000a'), ('a3300000-0000-4000-8000-00000000000b'), ('a3300000-0000-4000-8000-00000000000c');
INSERT INTO public.schools (id, name, slug) VALUES
  ('63300000-0000-4000-8000-0000000000a1', 'R20 Synthetic Tenant 1', 'r20-synthetic-1'),
  ('63300000-0000-4000-8000-0000000000b1', 'R20 Synthetic Tenant 2', 'r20-synthetic-2');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a3300000-0000-4000-8000-00000000000a', '63300000-0000-4000-8000-0000000000a1', 'R20 Admin 1', 'r20-admin-1@example.invalid', 'admin', true),
  ('a3300000-0000-4000-8000-00000000000b', '63300000-0000-4000-8000-0000000000a1', 'R20 Teacher 1', 'r20-teacher-1@example.invalid', 'teacher', true),
  ('a3300000-0000-4000-8000-00000000000c', '63300000-0000-4000-8000-0000000000b1', 'R20 Admin 2', 'r20-admin-2@example.invalid', 'admin', true);

-- ── 1. Posture ──
SELECT r20.assert_true('the reserved-key trigger is installed and enabled',
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.cg_org_profile'::regclass
           AND tgname = 'trg_cg_org_profile_reserved_guard' AND tgenabled = 'O'));
SELECT r20.assert_true('only service_role may execute the writer',
  has_function_privilege('service_role', 'public.upsert_reality_profile(uuid,uuid,text,text,jsonb,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.upsert_reality_profile(uuid,uuid,text,text,jsonb,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.upsert_reality_profile(uuid,uuid,text,text,jsonb,integer)', 'EXECUTE'));

-- ── 2. The forgery path (audit finding R-20) is closed ──
SELECT r20.as_user('a3300000-0000-4000-8000-00000000000a');
SELECT r20.expect_error('admin cannot forge an interview through the generic RPC',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":9,"approval":{"forged":true}}'::jsonb)$q$, '42501');
SELECT r20.expect_error('admin cannot write any other reality.* key through the generic RPC',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1', 'runtime:scholar', 'reality.other', '{"x":1}'::jsonb)$q$, '42501');
SELECT r20.expect_ok('other profile keys still work through the generic RPC',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1', 'runtime:scholar', 'other.profile', '{"x":1}'::jsonb)$q$);
SELECT r20.expect_error('admin cannot call the reality writer directly',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":1}'::jsonb, 0)$q$, '42501');
SELECT r20.expect_error('admin cannot set the flag and write the table directly',
  $q$INSERT INTO public.cg_org_profile (tenant_ref, runtime_ref, profile_key, payload) VALUES ('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.direct','{}')$q$, '42501');
SELECT r20.back();
SELECT r20.as_role('anon');
SELECT r20.expect_error('anon cannot call the reality writer',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":1}'::jsonb, 0)$q$, '42501');
SELECT r20.back();

-- ── 3. The service path works, with actor and revision checks ──
SELECT r20.as_role('service_role');
SELECT r20.expect_ok('service writes the first revision for a tenant administrator',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":1,"marker":"first"}'::jsonb, 0)$q$);
SELECT r20.expect_error('a stale expected revision is refused (lost-update race, finding R-21)',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":1,"marker":"stale"}'::jsonb, 0)$q$, '40001');
SELECT r20.expect_error('an expected revision ahead of the stored one is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":3}'::jsonb, 2)$q$, '40001');
SELECT r20.expect_ok('the matching revision updates the row',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":2,"marker":"second"}'::jsonb, 1)$q$);
SELECT r20.expect_error('nothing stored but a non-zero expected revision is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.fresh', '{"revision":6}'::jsonb, 5)$q$, '40001');
SELECT r20.expect_error('an administrator of another tenant is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000c', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":3}'::jsonb, 2)$q$, 'P0001');
SELECT r20.expect_error('a non-administrator in the same tenant is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000b', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":3}'::jsonb, 2)$q$, 'P0001');
SELECT r20.expect_error('an unknown actor is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000000', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":3}'::jsonb, 2)$q$, 'P0001');
SELECT r20.expect_error('a key outside reality.* is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'other.profile', '{"revision":1}'::jsonb, 0)$q$, 'P0001');
SELECT r20.expect_error('a non-object payload is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '[1]'::jsonb, 2)$q$, 'P0001');
SELECT r20.expect_error('an oversized payload is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', jsonb_build_object('revision', 3, 'blob', repeat('a', 300000)), 2)$q$, '23514');
SELECT r20.expect_error('a negative expected revision is refused',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000a1', 'a3300000-0000-4000-8000-00000000000a', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":3}'::jsonb, -1)$q$, 'P0001');
SELECT r20.expect_ok('tenant 2 has its own independent row',
  $q$SELECT public.upsert_reality_profile('63300000-0000-4000-8000-0000000000b1', 'a3300000-0000-4000-8000-00000000000c', 'runtime:scholar', 'reality.onboarding_interview', '{"revision":1,"marker":"t2"}'::jsonb, 0)$q$);
SELECT r20.back();

SELECT r20.assert_true('refused and conflicting calls left the stored interview unchanged',
  (SELECT payload->>'marker' FROM public.cg_org_profile WHERE tenant_ref = '63300000-0000-4000-8000-0000000000a1' AND profile_key = 'reality.onboarding_interview') = 'second'
  AND (SELECT payload->>'marker' FROM public.cg_org_profile WHERE tenant_ref = '63300000-0000-4000-8000-0000000000b1' AND profile_key = 'reality.onboarding_interview') = 't2');
SELECT r20.assert_true('the writer flag does not leak out of a successful call',
  coalesce(current_setting('coregrid.reality_writer', true), '') <> 'on');

-- ── 4. Direct table paths stay closed even to a privileged session without the flag ──
SELECT r20.expect_error('a direct insert without the flag is refused',
  $q$INSERT INTO public.cg_org_profile (tenant_ref, runtime_ref, profile_key, payload) VALUES ('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.direct','{}')$q$, '42501');
SELECT r20.expect_error('a direct update of a reserved row without the flag is refused',
  $q$UPDATE public.cg_org_profile SET payload = '{}' WHERE profile_key = 'reality.onboarding_interview'$q$, '42501');
SELECT r20.expect_error('a direct delete of a reserved row without the flag is refused',
  $q$DELETE FROM public.cg_org_profile WHERE profile_key = 'reality.onboarding_interview'$q$, '42501');
SELECT r20.expect_error('renaming an ordinary key into the reserved namespace is refused',
  $q$UPDATE public.cg_org_profile SET profile_key = 'reality.smuggled' WHERE profile_key = 'other.profile'$q$, '42501');
SELECT r20.expect_error('renaming a reserved row out of the namespace is refused',
  $q$UPDATE public.cg_org_profile SET profile_key = 'plain.key' WHERE profile_key = 'reality.onboarding_interview'$q$, '42501');
SELECT r20.expect_ok('ordinary keys remain freely writable',
  $q$UPDATE public.cg_org_profile SET payload = '{"x":2}' WHERE profile_key = 'other.profile'$q$);

-- ── 5. Reads are unchanged ──
SELECT r20.as_user('a3300000-0000-4000-8000-00000000000a');
SELECT r20.assert_true('the administrator still reads the interview through get_org_profile',
  (SELECT count(*) FROM public.get_org_profile('63300000-0000-4000-8000-0000000000a1', 'runtime:scholar', 'reality.onboarding_interview')) = 1);
SELECT r20.assert_true('the administrator of another tenant still cannot read it',
  (SELECT count(*) FROM public.get_org_profile('63300000-0000-4000-8000-0000000000b1', 'runtime:scholar', 'reality.onboarding_interview')) = 0);
SELECT r20.back();

DO $done$ BEGIN RAISE NOTICE 'R20 ALL PASS'; END $done$;
ROLLBACK;
