-- Disposable proof for 20261117000100_sherivs_m0b_policy_helper_search_path.sql.
-- Builds the helpers as production has them (search_path = public), records what they return for
-- several callers, applies the migration, and shows the answers are identical, the search path is
-- empty, and a look-alike table placed ahead on a caller's search path changes nothing.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m0b_test -v ON_ERROR_STOP=1 -f tests/sql/m0b-policy-helper-search-path.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('sim.uid', true), '')::uuid $$;
CREATE TABLE public.users (id uuid PRIMARY KEY, role text, school_id uuid, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.organization_memberships (user_id uuid, school_id uuid, role text,
  is_active boolean NOT NULL DEFAULT true, is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.users VALUES
  ('00000000-0000-0000-0000-00000000000a', 'teacher', '11111111-1111-1111-1111-111111111111', true),
  ('00000000-0000-0000-0000-00000000000b', 'admin',   '22222222-2222-2222-2222-222222222222', true),
  ('00000000-0000-0000-0000-00000000000c', 'admin',   '22222222-2222-2222-2222-222222222222', false);
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary) VALUES
  ('00000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', 'principal', true);

CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT m.role FROM public.organization_memberships m WHERE m.user_id = u.id AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC LIMIT 1), u.role)
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true; $f$;
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT m.school_id FROM public.organization_memberships m WHERE m.user_id = u.id AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC LIMIT 1), u.school_id)
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true; $f$;
CREATE FUNCTION public.is_school_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT COALESCE(public.get_my_role() IN ('admin', 'principal'), false) $f$;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

CREATE FUNCTION pg_temp.answers() RETURNS text LANGUAGE plpgsql AS $$
DECLARE out text := ''; who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                             '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000ff'] LOOP
    PERFORM set_config('sim.uid', who, true);
    out := out || format('[%s|%s|%s|%s]', who, coalesce(public.get_my_role(), '-'),
                         coalesce(public.get_my_school_id()::text, '-'), public.is_school_admin());
  END LOOP;
  RETURN out;
END $$;
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;

SELECT pg_temp.answers() AS before_answers \gset
SELECT pg_temp.expect('before: the membership wins over the profile row',
  (:'before_answers' LIKE '%[00000000-0000-0000-0000-00000000000a|principal|33333333-3333-3333-3333-333333333333|t]%')::text, 'true');
SELECT pg_temp.expect('before: an inactive person and a stranger get nothing',
  (:'before_answers' LIKE '%0c|-|-|f]%' AND :'before_answers' LIKE '%ff|-|-|f]%')::text, 'true');

\echo == apply the migration ==
\i database/supabase/migrations/20261117000100_sherivs_m0b_policy_helper_search_path.sql

SELECT pg_temp.expect('answers are identical for every caller', pg_temp.answers(), :'before_answers');
SELECT pg_temp.expect('all three have an empty search path',
  (SELECT string_agg(proname || ':' || proconfig[1], ',' ORDER BY proname) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_my_role', 'get_my_school_id', 'is_school_admin')),
  'get_my_role:search_path="",get_my_school_id:search_path="",is_school_admin:search_path=""');
SELECT pg_temp.expect('they are still SECURITY DEFINER',
  (SELECT bool_and(prosecdef)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('get_my_role', 'get_my_school_id', 'is_school_admin')), 'true');
SELECT pg_temp.expect('privileges were kept: anon still cannot run get_my_role',
  has_function_privilege('anon', 'public.get_my_role()', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('privileges were kept: authenticated still can',
  has_function_privilege('authenticated', 'public.get_my_role()', 'EXECUTE')::text, 'true');

-- A look-alike table ahead on the caller's search path must not be read.
CREATE SCHEMA decoy;
CREATE TABLE decoy.users (id uuid, role text, school_id uuid, is_active boolean);
INSERT INTO decoy.users VALUES ('00000000-0000-0000-0000-0000000000ff', 'admin', '99999999-9999-9999-9999-999999999999', true);
SET search_path = decoy, public;
SELECT pg_temp.expect('a decoy table on the search path changes nothing', pg_temp.answers(), :'before_answers');
RESET search_path;

\echo == rollback restores the previous setting ==
\i database/supabase/rollbacks/20261117000100_sherivs_m0b_policy_helper_search_path.sql
SELECT pg_temp.expect('after rollback the setting is public again',
  (SELECT proconfig::text FROM pg_proc WHERE oid = 'public.get_my_school_id()'::regprocedure), '{search_path=public}');
SELECT pg_temp.expect('after rollback answers are still identical', pg_temp.answers(), :'before_answers');
\echo M0B HELPER SEARCH PATH TESTS PASSED
