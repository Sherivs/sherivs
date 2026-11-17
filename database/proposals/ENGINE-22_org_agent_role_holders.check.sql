-- SCRATCH-DATABASE CHECK. NEVER RUN ON A REAL PROJECT.
-- Behavioural check for ENGINE-22_org_agent_role_holders.sql (needs ENGINE-20 applied first). It stubs the Supabase pieces the
-- proposal depends on (auth.uid, auth.role, is_super_admin, scholar_can, get_my_school_id, schools,
-- users, three roles), so it runs on a throwaway local Postgres 16:
--   1. psql -d scratch -f this file's stub section (everything before the checks marker)
--   2. psql -d scratch -f database/proposals/ENGINE-20_org_agent_addons_events_reports.sql
--   3. psql -d scratch -f database/proposals/ENGINE-22_org_agent_role_holders.sql
--   4. psql -d scratch -f this file's checks section
-- Every row printed at the end must say PASS.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.sheriff', true), 'off') = 'on' $$;
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.school', true), '')::uuid $$;
CREATE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_super_admin() OR (coalesce(current_setting('test.manage', true), 'off') = 'on' AND public.get_my_school_id() = p_org) $$;
CREATE TABLE public.schools (id uuid PRIMARY KEY, subscription_tier text, subscription_status text);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid, is_active boolean DEFAULT true);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), public.is_super_admin(), public.get_my_school_id(), public.scholar_can(uuid, text) TO anon, authenticated, service_role;
GRANT SELECT ON public.schools, public.users TO authenticated, service_role;
CREATE TABLE public.organization_memberships (user_id uuid NOT NULL, school_id uuid NOT NULL, role text NOT NULL, is_active boolean NOT NULL DEFAULT true, PRIMARY KEY (user_id, school_id));
GRANT SELECT ON public.organization_memberships TO authenticated, service_role;
-- ---- checks ----
INSERT INTO public.schools VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','growth','active'),
  ('aaaaaaaa-0000-0000-0000-000000000002','growth','active');
INSERT INTO public.organization_memberships VALUES
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','admin',true),
  ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','principal',true),
  ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','bursar',true),
  ('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-000000000001','bursar',false),
  ('55555555-5555-5555-5555-555555555555','aaaaaaaa-0000-0000-0000-000000000001','teacher',true),
  ('66666666-6666-6666-6666-666666666666','aaaaaaaa-0000-0000-0000-000000000001','parent',true),
  ('77777777-7777-7777-7777-777777777777','aaaaaaaa-0000-0000-0000-000000000001','student',true),
  ('88888888-8888-8888-8888-888888888888','aaaaaaaa-0000-0000-0000-000000000001','hq',true),
  ('99999999-9999-9999-9999-999999999999','aaaaaaaa-0000-0000-0000-000000000002','admin',true);
CREATE TEMP TABLE results(name text, ok boolean);
GRANT ALL ON results TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.try(p_name text, p_sql text, p_expect text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text := 'ok';
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  INSERT INTO results VALUES (p_name || ' => ' || msg, msg = p_expect);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_actor(p_uid text, p_school text, p_manage boolean, p_sheriff boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.uid', p_uid, false);
  PERFORM set_config('test.school', p_school, false);
  PERFORM set_config('test.manage', CASE WHEN p_manage THEN 'on' ELSE 'off' END, false);
  PERFORM set_config('test.sheriff', CASE WHEN p_sheriff THEN 'on' ELSE 'off' END, false);
END $$;

-- not signed in
SELECT pg_temp.as_actor('', 'aaaaaaaa-0000-0000-0000-000000000001', true, false);
SELECT pg_temp.try('not signed in', 'SELECT * FROM public.org_agent_holders(''aaaaaaaa-0000-0000-0000-000000000001'')', 'not_authenticated');

-- signed in without settings.manage
SELECT pg_temp.as_actor('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000001', false, false);
SELECT pg_temp.try('without settings.manage', 'SELECT * FROM public.org_agent_holders(''aaaaaaaa-0000-0000-0000-000000000001'')', 'not_allowed');
SELECT pg_temp.try('null organization', 'SELECT * FROM public.org_agent_holders(NULL)', 'not_allowed');

-- a manager who is not a school administrator still sees the holders
SELECT pg_temp.as_actor('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', true, false);
INSERT INTO results SELECT 'manager sees exactly the active holders of accountable roles',
  (SELECT array_agg(holder_role || ':' || left(holder_id::text, 2) ORDER BY holder_role, holder_id) FROM public.org_agent_holders('aaaaaaaa-0000-0000-0000-000000000001'))
  = ARRAY['admin:11','bursar:33','hq:88','principal:22'];
INSERT INTO results SELECT 'inactive member is excluded', NOT EXISTS (SELECT 1 FROM public.org_agent_holders('aaaaaaaa-0000-0000-0000-000000000001') WHERE holder_id = '44444444-4444-4444-4444-444444444444');
INSERT INTO results SELECT 'teachers, parents and students are never returned', NOT EXISTS (SELECT 1 FROM public.org_agent_holders('aaaaaaaa-0000-0000-0000-000000000001') WHERE holder_role IN ('teacher','parent','student','alumni','driver'));
INSERT INTO results SELECT 'returns only an id and a role', (SELECT proargnames FROM pg_proc WHERE proname = 'org_agent_holders') = ARRAY['p_org','holder_id','holder_role'];

-- a manager of one organization cannot read another's
SELECT pg_temp.try('other organization', 'SELECT * FROM public.org_agent_holders(''aaaaaaaa-0000-0000-0000-000000000002'')', 'not_allowed');

-- the sheriff can read any organization
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111', '', false, true);
INSERT INTO results SELECT 'sheriff reads another organization', (SELECT count(*) FROM public.org_agent_holders('aaaaaaaa-0000-0000-0000-000000000002')) = 1;

-- privileges
INSERT INTO results SELECT 'anon cannot execute', NOT has_function_privilege('anon', 'public.org_agent_holders(uuid)', 'EXECUTE');
INSERT INTO results SELECT 'public cannot execute', NOT has_function_privilege('public', 'public.org_agent_holders(uuid)', 'EXECUTE');
INSERT INTO results SELECT 'authenticated can execute', has_function_privilege('authenticated', 'public.org_agent_holders(uuid)', 'EXECUTE');
INSERT INTO results SELECT 'search_path is pinned', (SELECT proconfig FROM pg_proc WHERE proname = 'org_agent_holders') @> ARRAY['search_path=""'];
INSERT INTO results SELECT 'security definer', (SELECT prosecdef FROM pg_proc WHERE proname = 'org_agent_holders');

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results ORDER BY ok, name;
