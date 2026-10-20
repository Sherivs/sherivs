-- =============================================================================
-- SHERIVS-006 — membership-aware identity freeze (LOCAL, DISPOSABLE ONLY)
-- =============================================================================
-- Covers migration 20261020000120 on top of production's captured identity
-- helpers (20261003000042).
--
--   PGOPTIONS="-c sv6.allow_non_loopback=on" \
--   psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f tests/integration/sherivs-006-membership-freeze.local.sql
--
-- One transaction, always rolled back. NOTICE 'SV6 ALL PASS' only after every check.
-- =============================================================================
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SV6: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('sv6.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'SV6: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regprocedure('public.forbid_direct_membership_write()') IS NULL THEN
    RAISE EXCEPTION 'SV6: migration 20261020000120 not applied';
  END IF;
END
$guard$;

CREATE SCHEMA sv6;
GRANT USAGE ON SCHEMA sv6 TO anon, authenticated, service_role;

CREATE FUNCTION sv6.login(_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $f$;
CREATE FUNCTION sv6.login_as(_role text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', _role)::text, true);
  PERFORM set_config('request.jwt.claim.role', _role, true);
  EXECUTE format('SET LOCAL ROLE %I', _role);
END $f$;
CREATE FUNCTION sv6.logout() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN EXECUTE 'RESET ROLE'; END $f$;

-- Runs _sql; a 42501 counts as denied. Returns true when the statement errored with 42501.
CREATE FUNCTION sv6.try(_sql text) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $f$;
CREATE FUNCTION sv6.denied(_label text, _sql text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT sv6.try(_sql) THEN RAISE EXCEPTION 'SV6 FAIL [%]: statement was allowed but must be denied', _label; END IF;
END $f$;
CREATE FUNCTION sv6.eq(_label text, _got text, _want text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF _got IS DISTINCT FROM _want THEN RAISE EXCEPTION 'SV6 FAIL [%]: got %, want %', _label, _got, _want; END IF;
END $f$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sv6 TO anon, authenticated, service_role;

-- Fixture: schools A, B; A admin, A teacher, B admin, a user with memberships in A (primary) and B, a fresh founder.
INSERT INTO public.schools (id, name, slug, is_active) VALUES
  ('56000000-0000-4000-8000-0000000000a1', 'SV6 A', 'sv6-a', true),
  ('56000000-0000-4000-8000-0000000000b2', 'SV6 B', 'sv6-b', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'sv6-a-admin@example.test', 'authenticated', 'authenticated'),
  ('a6000000-0000-4000-8000-000000000002', 'sv6-a-teacher@example.test', 'authenticated', 'authenticated'),
  ('b6000000-0000-4000-8000-000000000001', 'sv6-b-admin@example.test', 'authenticated', 'authenticated'),
  ('c6000000-0000-4000-8000-000000000001', 'sv6-multi@example.test', 'authenticated', 'authenticated'),
  ('d6000000-0000-4000-8000-000000000001', 'sv6-founder@example.test', 'authenticated', 'authenticated');
INSERT INTO public.users (id, school_id, full_name, role, email, is_active) VALUES
  ('a6000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-0000000000a1', 'A Admin', 'admin', 'sv6-a-admin@example.test', true),
  ('a6000000-0000-4000-8000-000000000002', '56000000-0000-4000-8000-0000000000a1', 'A Teacher', 'teacher', 'sv6-a-teacher@example.test', true),
  ('b6000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-0000000000b2', 'B Admin', 'admin', 'sv6-b-admin@example.test', true),
  ('c6000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-0000000000a1', 'Multi', 'teacher', 'sv6-multi@example.test', true);
SELECT sv6.login_as('service_role');
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active)
VALUES ('c6000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-0000000000b2', 'parent', false, true);
SELECT sv6.logout();

-- 1. Sync trigger still mirrors users -> memberships (superuser insert path).
SELECT sv6.eq('sync created memberships', (SELECT count(*)::text FROM public.organization_memberships WHERE user_id::text LIKE '%6000000-0000-4000-8000-%'), '5');

-- 2. Self-changes of privileged fields are refused, even though RLS may allow self-update.
SELECT sv6.login('a6000000-0000-4000-8000-000000000002');
SELECT sv6.eq('teacher sees own school', public.get_my_school_id()::text, '56000000-0000-4000-8000-0000000000a1');
SELECT sv6.eq('teacher role', public.get_my_role(), 'teacher');
SELECT sv6.try($$UPDATE public.users SET role = 'admin' WHERE id = auth.uid()$$);
SELECT sv6.try($$UPDATE public.users SET school_id = '56000000-0000-4000-8000-0000000000b2' WHERE id = auth.uid()$$);
SELECT sv6.try($$UPDATE public.users SET is_active = false WHERE id = auth.uid()$$);
SELECT sv6.denied('teacher inserts membership in B', $$INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES (auth.uid(), '56000000-0000-4000-8000-0000000000b2', 'admin')$$);
SELECT sv6.denied('teacher updates own membership role', $$UPDATE public.organization_memberships SET role = 'admin' WHERE user_id = auth.uid()$$);
SELECT sv6.denied('teacher deletes own membership', $$DELETE FROM public.organization_memberships WHERE user_id = auth.uid()$$);
SELECT sv6.denied('direct users insert by authenticated', $$INSERT INTO public.users (id, school_id, full_name, role, email, is_active) VALUES ('d6000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-0000000000b2', 'X', 'admin', 'x@example.test', true)$$);
SELECT sv6.logout();
SELECT sv6.eq('teacher row unchanged', (SELECT role || '/' || school_id || '/' || is_active FROM public.users WHERE id = 'a6000000-0000-4000-8000-000000000002'), 'teacher/56000000-0000-4000-8000-0000000000a1/true');
SELECT sv6.eq('teacher memberships unchanged', (SELECT string_agg(school_id || ':' || role, ',') FROM public.organization_memberships WHERE user_id = 'a6000000-0000-4000-8000-000000000002'), '56000000-0000-4000-8000-0000000000a1:teacher');

-- 3. A school admin cannot change other users' privileged fields or memberships either.
SELECT sv6.login('a6000000-0000-4000-8000-000000000001');
SELECT sv6.eq('admin is school admin', public.is_school_admin()::text, 'true');
SELECT sv6.try($$UPDATE public.users SET role = 'principal' WHERE id = 'a6000000-0000-4000-8000-000000000002'$$);
SELECT sv6.denied('admin inserts membership', $$INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES ('a6000000-0000-4000-8000-000000000002', '56000000-0000-4000-8000-0000000000a1', 'teacher')$$);
SELECT sv6.denied('admin updates membership', $$UPDATE public.organization_memberships SET role = 'principal' WHERE user_id = 'a6000000-0000-4000-8000-000000000002'$$);
SELECT sv6.denied('admin deletes membership', $$DELETE FROM public.organization_memberships WHERE user_id = 'a6000000-0000-4000-8000-000000000002'$$);
SELECT sv6.logout();
SELECT sv6.eq('other user unchanged', (SELECT role FROM public.users WHERE id = 'a6000000-0000-4000-8000-000000000002'), 'teacher');

-- 4. A privileged owner session (not service_role) is refused too.
SELECT sv6.denied('superuser direct membership write', $$UPDATE public.organization_memberships SET role = 'admin' WHERE user_id = 'a6000000-0000-4000-8000-000000000002'$$);
SELECT sv6.denied('superuser privileged users update', $$UPDATE public.users SET role = 'admin' WHERE id = 'a6000000-0000-4000-8000-000000000002'$$);

-- 5. service_role may change them, and the sync follows.
SELECT sv6.login_as('service_role');
UPDATE public.users SET role = 'bursar' WHERE id = 'a6000000-0000-4000-8000-000000000002';
UPDATE public.organization_memberships SET is_active = true WHERE user_id = 'a6000000-0000-4000-8000-000000000002';
SELECT sv6.logout();
SELECT sv6.eq('service_role role change synced', (SELECT role FROM public.organization_memberships WHERE user_id = 'a6000000-0000-4000-8000-000000000002'), 'bursar');

-- 6. Multi-membership user: primary wins; a server-side switch moves the context.
SELECT sv6.login('c6000000-0000-4000-8000-000000000001');
SELECT sv6.eq('multi primary school', public.get_my_school_id()::text, '56000000-0000-4000-8000-0000000000a1');
SELECT sv6.eq('multi primary role', public.get_my_role(), 'teacher');
SELECT sv6.eq('multi sees both memberships', (SELECT count(*)::text FROM public.get_my_memberships()), '2');
SELECT sv6.logout();
SELECT sv6.login_as('service_role');
UPDATE public.users SET school_id = '56000000-0000-4000-8000-0000000000b2', role = 'parent' WHERE id = 'c6000000-0000-4000-8000-000000000001';
SELECT sv6.logout();
SELECT sv6.login('c6000000-0000-4000-8000-000000000001');
SELECT sv6.eq('multi switched school', public.get_my_school_id()::text, '56000000-0000-4000-8000-0000000000b2');
SELECT sv6.eq('multi switched role', public.get_my_role(), 'parent');
SELECT sv6.logout();

-- 7. Deactivated admin loses admin everywhere, even with an active membership left behind.
SELECT sv6.login_as('service_role');
UPDATE public.users SET is_active = false WHERE id = 'a6000000-0000-4000-8000-000000000001';
UPDATE public.organization_memberships SET is_active = true WHERE user_id = 'a6000000-0000-4000-8000-000000000001';
SELECT sv6.logout();
SELECT sv6.login('a6000000-0000-4000-8000-000000000001');
SELECT sv6.eq('inactive admin school', public.get_my_school_id()::text, NULL);
SELECT sv6.eq('inactive admin role', public.get_my_role(), NULL);
SELECT sv6.eq('inactive admin my_active_role', public.my_active_role(), NULL);
SELECT sv6.eq('inactive admin not school admin', public.is_school_admin()::text, 'false');
SELECT sv6.eq('inactive admin sees no school users', (SELECT count(*)::text FROM public.users WHERE school_id = '56000000-0000-4000-8000-0000000000a1' AND id <> auth.uid()), '0');
SELECT sv6.logout();

-- 8. Cross-school: B admin cannot see A's users.
SELECT sv6.login('b6000000-0000-4000-8000-000000000001');
SELECT sv6.eq('B admin school', public.get_my_school_id()::text, '56000000-0000-4000-8000-0000000000b2');
SELECT sv6.eq('B admin sees no A users', (SELECT count(*)::text FROM public.users WHERE school_id = '56000000-0000-4000-8000-0000000000a1'), '0');
SELECT sv6.logout();

-- 9. Founder onboarding RPC still provisions users + membership.
SELECT sv6.login('d6000000-0000-4000-8000-000000000001');
SELECT sv6.eq('founder has no school yet', public.get_my_school_id()::text, NULL);
SELECT public.create_organization_with_founder('SV6 Founded', 'sv6-founded', 'Founder Person');
SELECT sv6.eq('founder is admin', public.get_my_role(), 'admin');
SELECT sv6.eq('founder school admin', public.is_school_admin()::text, 'true');
SELECT sv6.logout();
SELECT sv6.eq('founder membership', (SELECT role || '/' || is_primary FROM public.organization_memberships WHERE user_id = 'd6000000-0000-4000-8000-000000000001'), 'admin/true');

-- 10. Grants: anon/authenticated have no write grants on memberships.
SELECT sv6.eq('no membership write grants', (SELECT count(*)::text FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'organization_memberships' AND grantee IN ('anon','authenticated')
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')), '0');

DO $$ BEGIN RAISE NOTICE 'SV6 ALL PASS'; END $$;
ROLLBACK;
