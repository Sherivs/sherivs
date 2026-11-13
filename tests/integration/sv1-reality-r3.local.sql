-- SV1-REALITY R3 (#334) storage checks (LOCAL, DISPOSABLE DATABASE ONLY).
-- Tenant isolation of the interview store, forced RLS, no client table access,
-- and the interview payload size bound. Synthetic ids only. Always rolls back.
-- Never target a hosted or production database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SV1-REALITY-R3: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SV1-REALITY-R3: refusing non-loopback database server %', inet_server_addr();
  END IF;
  IF current_database() NOT IN ('reality_r3_test')
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'SV1-REALITY-R3: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regclass('public.cg_org_profile') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cg_org_profile_reality_interview_size') THEN
    RAISE EXCEPTION 'SV1-REALITY-R3: the R3 migration must be applied to this disposable database first';
  END IF;
END
$guard$;

CREATE SCHEMA r3_gate;
GRANT USAGE ON SCHEMA r3_gate TO authenticated, anon;

CREATE FUNCTION r3_gate.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION r3_gate.anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
END $$;

CREATE FUNCTION r3_gate.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;

CREATE FUNCTION r3_gate.expect_error(p_label text, p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'SV1-REALITY-R3 FAIL [%]: expected SQLSTATE %, got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'SV1-REALITY-R3 FAIL [%]: statement succeeded but must be refused', p_label;
END $$;

CREATE FUNCTION r3_gate.expect_count(p_label text, p_sql text, p_expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'SV1-REALITY-R3 FAIL [%]: expected % rows, got %', p_label, p_expected, v;
  END IF;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA r3_gate TO authenticated, anon;

-- Synthetic fixtures: two tenants, an admin and a teacher in tenant 1, an admin in tenant 2.
INSERT INTO auth.users (id) VALUES
  ('a3300000-0000-4000-8000-00000000000a'),
  ('a3300000-0000-4000-8000-00000000000b'),
  ('a3300000-0000-4000-8000-00000000000c');
INSERT INTO public.schools (id, name, slug) VALUES
  ('63300000-0000-4000-8000-0000000000a1', 'R3 Synthetic Tenant 1', 'r3-synthetic-1'),
  ('63300000-0000-4000-8000-0000000000b1', 'R3 Synthetic Tenant 2', 'r3-synthetic-2');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a3300000-0000-4000-8000-00000000000a', '63300000-0000-4000-8000-0000000000a1', 'R3 Admin 1', 'r3-admin-1@example.invalid', 'admin', true),
  ('a3300000-0000-4000-8000-00000000000b', '63300000-0000-4000-8000-0000000000a1', 'R3 Teacher 1', 'r3-teacher-1@example.invalid', 'teacher', true),
  ('a3300000-0000-4000-8000-00000000000c', '63300000-0000-4000-8000-0000000000b1', 'R3 Admin 2', 'r3-admin-2@example.invalid', 'admin', true);

-- ── 1. Table posture after the migration ──
DO $$
DECLARE r record;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO r FROM pg_class WHERE oid = 'public.cg_org_profile'::regclass;
  IF NOT r.relrowsecurity THEN RAISE EXCEPTION 'R3 FAIL: RLS must be enabled'; END IF;
  IF NOT r.relforcerowsecurity THEN RAISE EXCEPTION 'R3 FAIL: RLS must be forced'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cg_org_profile') THEN
    RAISE EXCEPTION 'R3 FAIL: cg_org_profile must keep zero policies (no client path)';
  END IF;
  IF has_table_privilege('authenticated', 'public.cg_org_profile', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_org_profile', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cg_org_profile', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cg_org_profile', 'DELETE')
     OR has_table_privilege('anon', 'public.cg_org_profile', 'SELECT')
     OR has_table_privilege('anon', 'public.cg_org_profile', 'INSERT') THEN
    RAISE EXCEPTION 'R3 FAIL: clients must have no direct table privileges';
  END IF;
  IF (SELECT convalidated FROM pg_constraint WHERE conname = 'cg_org_profile_reality_interview_size') THEN
    RAISE EXCEPTION 'R3 FAIL: the size check must be NOT VALID so existing rows stay untouched';
  END IF;
END $$;

-- ── 2. Tenant isolation through the existing RPCs ──
SELECT r3_gate.login('a3300000-0000-4000-8000-00000000000a');
SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1', 'runtime:scholar', 'reality.onboarding_interview', '{"marker":"tenant-1"}'::jsonb);
SELECT r3_gate.expect_count('admin 1 reads own interview',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview')$q$, 1);
SELECT r3_gate.expect_error('admin 1 cannot write tenant 2',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000b1','runtime:scholar','reality.onboarding_interview','{"marker":"x"}'::jsonb)$q$, 'P0001');
SELECT r3_gate.logout();

SELECT r3_gate.login('a3300000-0000-4000-8000-00000000000c');
SELECT r3_gate.expect_count('admin 2 cannot read tenant 1 interview',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview')$q$, 0);
SELECT r3_gate.expect_error('admin 2 cannot overwrite tenant 1',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview','{"marker":"overwritten"}'::jsonb)$q$, 'P0001');
SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000b1', 'runtime:scholar', 'reality.onboarding_interview', '{"marker":"tenant-2"}'::jsonb);
SELECT r3_gate.expect_count('admin 2 reads own interview',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000b1','runtime:scholar','reality.onboarding_interview') WHERE payload->>'marker' = 'tenant-2'$q$, 1);
SELECT r3_gate.logout();

SELECT r3_gate.login('a3300000-0000-4000-8000-00000000000a');
SELECT r3_gate.expect_count('admin 1 still sees only tenant 1 content',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview') WHERE payload->>'marker' = 'tenant-1'$q$, 1);
SELECT r3_gate.expect_count('admin 1 cannot read tenant 2 interview',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000b1','runtime:scholar','reality.onboarding_interview')$q$, 0);
SELECT r3_gate.logout();

-- The stored rows really are separate and unchanged by the refused writes.
DO $$
BEGIN
  IF (SELECT payload->>'marker' FROM public.cg_org_profile
       WHERE tenant_ref = '63300000-0000-4000-8000-0000000000a1' AND profile_key = 'reality.onboarding_interview') <> 'tenant-1' THEN
    RAISE EXCEPTION 'R3 FAIL: tenant 1 row was altered by a cross-tenant write';
  END IF;
  IF (SELECT count(*) FROM public.cg_org_profile WHERE profile_key = 'reality.onboarding_interview') <> 2 THEN
    RAISE EXCEPTION 'R3 FAIL: expected exactly one interview row per tenant';
  END IF;
END $$;

-- ── 3. A non-admin in the same tenant has no access ──
SELECT r3_gate.login('a3300000-0000-4000-8000-00000000000b');
SELECT r3_gate.expect_count('teacher cannot read the interview',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview')$q$, 0);
SELECT r3_gate.expect_error('teacher cannot write the interview',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview','{"marker":"teacher"}'::jsonb)$q$, 'P0001');
SELECT r3_gate.logout();

-- ── 4. Anonymous callers and direct table access ──
SELECT r3_gate.anon();
SELECT r3_gate.expect_error('anon cannot execute the read RPC',
  $q$SELECT * FROM public.get_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview')$q$, '42501');
SELECT r3_gate.expect_error('anon cannot execute the write RPC',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview','{"marker":"anon"}'::jsonb)$q$, '42501');
SELECT r3_gate.expect_error('anon has no table access', $q$SELECT * FROM public.cg_org_profile$q$, '42501');
SELECT r3_gate.logout();

SELECT r3_gate.login('a3300000-0000-4000-8000-00000000000a');
SELECT r3_gate.expect_error('admin cannot read the table directly', $q$SELECT * FROM public.cg_org_profile$q$, '42501');
SELECT r3_gate.expect_error('admin cannot insert directly',
  $q$INSERT INTO public.cg_org_profile (tenant_ref, runtime_ref, profile_key, payload) VALUES ('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.direct','{}')$q$, '42501');
SELECT r3_gate.expect_error('admin cannot update directly',
  $q$UPDATE public.cg_org_profile SET payload = '{}'$q$, '42501');
SELECT r3_gate.expect_error('admin cannot delete directly', $q$DELETE FROM public.cg_org_profile$q$, '42501');
SELECT r3_gate.logout();

-- ── 5. Payload bound applies to the interview key only ──
SELECT r3_gate.login('a3300000-0000-4000-8000-00000000000a');
SELECT r3_gate.expect_error('oversized interview payload is refused',
  $q$SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview', jsonb_build_object('blob', repeat('a', 300000)))$q$, '23514');
SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','reality.onboarding_interview', jsonb_build_object('blob', repeat('a', 100000)));
SELECT public.upsert_org_profile('63300000-0000-4000-8000-0000000000a1','runtime:scholar','other.profile', jsonb_build_object('blob', repeat('a', 300000)));
SELECT r3_gate.logout();

DO $$
BEGIN
  IF (SELECT length(payload->>'blob') FROM public.cg_org_profile
       WHERE tenant_ref = '63300000-0000-4000-8000-0000000000a1' AND profile_key = 'other.profile') <> 300000 THEN
    RAISE EXCEPTION 'R3 FAIL: other profile keys must not be limited by the interview bound';
  END IF;
  IF (SELECT length(payload->>'blob') FROM public.cg_org_profile
       WHERE tenant_ref = '63300000-0000-4000-8000-0000000000a1' AND profile_key = 'reality.onboarding_interview') <> 100000 THEN
    RAISE EXCEPTION 'R3 FAIL: the refused oversized write must leave the stored interview unchanged';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'SV1-REALITY-R3 storage checks: ALL PASS'; END $$;
ROLLBACK;
