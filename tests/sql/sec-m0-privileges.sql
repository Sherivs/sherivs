-- Disposable proof for database/proposals/SEC-M0_privilege_consolidation.sql.
-- It builds a small production-shaped schema (same grants, default privileges and policy shapes as
-- production on 2026-11-16), shows the holes exist, applies the proposal, and shows they are closed
-- while every documented public surface still works. It is a fixture, not a replay of production.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d sec_m0_test -v ON_ERROR_STOP=1 -f tests/sql/sec-m0-privileges.sql
\set ON_ERROR_STOP on
\echo == setup: roles, default privileges and objects shaped like production ==

DROP ROLE IF EXISTS anon, authenticated, service_role;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin SUPERUSER; END IF;
END $$;
-- Production's migration role is not a superuser and is not a member of supabase_admin. The
-- proposal is applied here by such a role, so the supabase_admin step takes its NOTICE path.
DROP ROLE IF EXISTS m0_runner;
CREATE ROLE m0_runner NOLOGIN NOSUPERUSER;
GRANT postgres TO m0_runner;
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO m0_runner', current_database()); END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
SET ROLE postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.sim_ctx (k text PRIMARY KEY, v text);
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT nullif(current_setting('sim.school', true), '')::uuid $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT false $$;
CREATE FUNCTION public.is_school_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT coalesce(current_setting('sim.role', true), '') = 'admin' $$;
CREATE FUNCTION public.my_active_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT nullif(current_setting('sim.role', true), '') $$;

-- A public surface: published rows for anyone, all rows for the owning organization.
CREATE TABLE public.news (id bigserial PRIMARY KEY, school_id uuid NOT NULL, title text, is_published boolean NOT NULL DEFAULT false);
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read_news ON public.news FOR SELECT TO public USING (is_published = true);
CREATE POLICY tenant_all_news ON public.news FOR ALL TO public
  USING (school_id = public.get_my_school_id() OR public.is_super_admin());

-- Private tables that carried an anon grant in production.
CREATE TABLE public.students (id bigserial PRIMARY KEY, school_id uuid NOT NULL, name text);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_all_students ON public.students FOR ALL TO public
  USING (school_id = public.get_my_school_id() OR public.is_super_admin());
CREATE TABLE public.cg_tenant (tenant_ref uuid PRIMARY KEY, label text);
ALTER TABLE public.cg_tenant ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.subscription_tier_plans (tier text PRIMARY KEY, price_minor bigint NOT NULL);
ALTER TABLE public.subscription_tier_plans ENABLE ROW LEVEL SECURITY;
CREATE VIEW public.students_view AS SELECT id, school_id FROM public.students;

-- Organizations: anon has COLUMN-level SELECT only (two columns withheld), as in production.
CREATE TABLE public.schools (id uuid PRIMARY KEY, slug text, is_active boolean NOT NULL DEFAULT true,
  grading_scale_id uuid, institution_category text);
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active schools" ON public.schools FOR SELECT TO public
  USING (is_active = true OR public.is_super_admin() OR id = public.get_my_school_id());
REVOKE ALL ON TABLE public.schools FROM anon;
GRANT REFERENCES, TRIGGER ON TABLE public.schools TO anon;
GRANT SELECT (id, slug, is_active) ON TABLE public.schools TO anon;
-- People: anon has column-level SELECT with sensitive columns withheld; RLS returns it no rows.
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid, full_name text, nin text, salary numeric);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_all_users ON public.users FOR ALL TO public USING (school_id = public.get_my_school_id());
REVOKE ALL ON TABLE public.users FROM anon;
GRANT SELECT (id, school_id, full_name) ON TABLE public.users TO anon;

-- The public admission form: anonymous INSERT only.
CREATE TABLE public.admission_applications (id bigserial PRIMARY KEY, school_id uuid NOT NULL, student_name text NOT NULL);
ALTER TABLE public.admission_applications ENABLE ROW LEVEL SECURITY;
-- As in production, the policy looks the organization up, with the caller's privileges.
CREATE POLICY "public can submit applications" ON public.admission_applications FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = admission_applications.school_id AND s.is_active = true));
CREATE POLICY tenant_read_applications ON public.admission_applications FOR SELECT TO public
  USING (school_id = public.get_my_school_id());

-- subscriptions, with production's grants and policies.
CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'free', amount_paid numeric NOT NULL DEFAULT 0, expires_at timestamptz);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_all_subscriptions ON public.subscriptions FOR ALL TO public
  USING (school_id = public.get_my_school_id() OR public.is_super_admin())
  WITH CHECK (school_id = public.get_my_school_id() OR public.is_super_admin());
CREATE POLICY sv4_insert_role ON public.subscriptions AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.is_super_admin() OR public.my_active_role() IN ('admin', 'principal'));
CREATE POLICY sv4_update_role ON public.subscriptions AS RESTRICTIVE FOR UPDATE TO public
  USING (public.is_super_admin() OR public.my_active_role() IN ('admin', 'principal'))
  WITH CHECK (public.is_super_admin() OR public.my_active_role() IN ('admin', 'principal'));
CREATE POLICY sv4_delete_role ON public.subscriptions AS RESTRICTIVE FOR DELETE TO public
  USING (public.is_super_admin() OR public.my_active_role() IN ('admin', 'principal'));

-- Functions: a public endpoint, an internal definer, a trigger function, a procedure.
CREATE FUNCTION public.check_result(p_serial text, p_pin text, p_admission_number text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 'ok'::text $$;
CREATE FUNCTION public.wallet_credit_internal(p_amount bigint) RETURNS bigint
  LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT p_amount $$;
-- An internal definer function already closed to anon and PUBLIC before SEC-M0.
CREATE FUNCTION public.internal_revoked() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;
REVOKE EXECUTE ON FUNCTION public.internal_revoked() FROM PUBLIC, anon;
-- An overload of a public endpoint's name: it must NOT be opened by the allowlist.
CREATE FUNCTION public.check_result(p_serial text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 'overload'::text $$;
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER news_touch BEFORE UPDATE ON public.news FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE PROCEDURE public.nightly_job() LANGUAGE sql AS $$ SELECT 1 $$;

INSERT INTO public.schools (id, slug, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alpha', true), ('22222222-2222-2222-2222-222222222222', 'beta', false);
INSERT INTO public.users (id, school_id, full_name, nin) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'A', 'secret');
INSERT INTO public.news (school_id, title, is_published) VALUES
  ('11111111-1111-1111-1111-111111111111', 'published', true),
  ('11111111-1111-1111-1111-111111111111', 'draft', false);
INSERT INTO public.students (school_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'A');
INSERT INTO public.subscriptions (school_id, plan) VALUES
  ('11111111-1111-1111-1111-111111111111', 'free'), ('22222222-2222-2222-2222-222222222222', 'pro');
INSERT INTO public.subscription_tier_plans VALUES ('pro', 5000000);
RESET ROLE;

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs a statement as a role and returns 'ok', 'denied' (no privilege) or 'rls' (policy refused).
CREATE FUNCTION pg_temp.try(p_role text, p_sql text, p_school text DEFAULT '', p_app_role text DEFAULT '')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text := 'ok';
BEGIN
  PERFORM set_config('sim.school', p_school, true);
  PERFORM set_config('sim.role', p_app_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN insufficient_privilege THEN
      result := CASE WHEN SQLERRM LIKE '%row-level security%' THEN 'rls' ELSE 'denied' END;
  END;
  RESET ROLE;
  RETURN result;
END $$;
CREATE FUNCTION pg_temp.count_as(p_role text, p_sql text, p_school text DEFAULT '', p_app_role text DEFAULT '')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('sim.school', p_school, true);
  PERFORM set_config('sim.role', p_app_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO n;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; RETURN 'denied';
  END;
  RESET ROLE;
  RETURN n::text;
END $$;

\echo == before: the holes exist ==
BEGIN;
SELECT pg_temp.expect('before: organization admin can raise their own plan',
  pg_temp.try('authenticated', $q$UPDATE public.subscriptions SET plan = 'enterprise', amount_paid = 999 WHERE school_id = '11111111-1111-1111-1111-111111111111'$q$,
    '11111111-1111-1111-1111-111111111111', 'admin'), 'ok');
SELECT pg_temp.expect('before: the update really changed the row',
  (SELECT plan FROM public.subscriptions WHERE school_id = '11111111-1111-1111-1111-111111111111'), 'enterprise');
SELECT pg_temp.expect('before: anon holds a grant on a private table',
  has_table_privilege('anon', 'public.students', 'SELECT')::text, 'true');
SELECT pg_temp.expect('before: anon holds write grants on the price list',
  has_table_privilege('anon', 'public.subscription_tier_plans', 'UPDATE')::text, 'true');
SELECT pg_temp.expect('before: anon reads active organizations through column grants',
  pg_temp.count_as('anon', 'SELECT count(slug) FROM public.schools'), '1');
SELECT pg_temp.expect('before: anon can submit an admission application',
  pg_temp.try('anon', $q$INSERT INTO public.admission_applications (school_id, student_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Ada')$q$), 'ok');
SELECT pg_temp.expect('before: anon cannot run the already-revoked internal function',
  pg_temp.try('anon', 'SELECT public.internal_revoked()'), 'denied');
SELECT pg_temp.expect('before: anon can execute an internal definer function',
  pg_temp.try('anon', 'SELECT public.wallet_credit_internal(1)'), 'ok');
ROLLBACK;

\echo == apply the proposal as a non-superuser that is not a member of supabase_admin ==
SET SESSION AUTHORIZATION m0_runner;
\i database/proposals/SEC-M0_privilege_consolidation.sql
RESET SESSION AUTHORIZATION;
SELECT pg_temp.expect('supabase_admin defaults were left alone (the NOTICE path ran)',
  (SELECT count(*)::text FROM pg_default_acl d WHERE pg_get_userbyid(d.defaclrole) = 'supabase_admin'
     AND d.defaclacl::text LIKE '%anon=%'), '1');
SELECT pg_temp.expect('a snapshot of the previous privileges exists',
  (SELECT (count(*) > 0)::text FROM ops_private.sec_m0_acl_snapshot), 'true');
SELECT pg_temp.expect('clients cannot reach the snapshot schema',
  has_schema_privilege('anon', 'ops_private', 'USAGE')::text || has_schema_privilege('authenticated', 'ops_private', 'USAGE')::text, 'falsefalse');

\echo == after: anonymous visitors ==
BEGIN;
SELECT pg_temp.expect('anon reads published news only', pg_temp.count_as('anon', 'SELECT count(*) FROM public.news'), '1');
SELECT pg_temp.expect('anon cannot write news', pg_temp.try('anon', $q$INSERT INTO public.news (school_id, title) VALUES ('11111111-1111-1111-1111-111111111111', 'x')$q$), 'denied');
SELECT pg_temp.expect('anon cannot read students', pg_temp.count_as('anon', 'SELECT count(*) FROM public.students'), 'denied');
SELECT pg_temp.expect('anon cannot read a view over students', pg_temp.count_as('anon', 'SELECT count(*) FROM public.students_view'), 'denied');
SELECT pg_temp.expect('anon cannot read a cg_ table', pg_temp.count_as('anon', 'SELECT count(*) FROM public.cg_tenant'), 'denied');
SELECT pg_temp.expect('anon cannot read subscriptions', pg_temp.count_as('anon', 'SELECT count(*) FROM public.subscriptions'), 'denied');
SELECT pg_temp.expect('anon cannot read the price list', pg_temp.count_as('anon', 'SELECT count(*) FROM public.subscription_tier_plans'), 'denied');
SELECT pg_temp.expect('anon cannot change the price list', pg_temp.try('anon', 'UPDATE public.subscription_tier_plans SET price_minor = 1'), 'denied');
SELECT pg_temp.expect('anon can submit an admission application', pg_temp.try('anon', $q$INSERT INTO public.admission_applications (school_id, student_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Ada')$q$), 'ok');
SELECT pg_temp.expect('anon cannot apply to an inactive organization', pg_temp.try('anon', $q$INSERT INTO public.admission_applications (school_id, student_name) VALUES ('22222222-2222-2222-2222-222222222222', 'Ada')$q$), 'rls');
SELECT pg_temp.expect('anon still reads active organizations (sitemap, manifest, branding)', pg_temp.count_as('anon', 'SELECT count(slug) FROM public.schools'), '1');
SELECT pg_temp.expect('anon still cannot read a withheld organization column', pg_temp.count_as('anon', 'SELECT count(grading_scale_id) FROM public.schools'), 'denied');
SELECT pg_temp.expect('anon holds no table-level privilege on organizations',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'schools' AND grantee = 'anon'), '0');
SELECT pg_temp.expect('anon cannot write organizations', pg_temp.try('anon', $q$UPDATE public.schools SET slug = 'x'$q$), 'denied');
SELECT pg_temp.expect('anon lost its column grants on people', has_any_column_privilege('anon', 'public.users', 'SELECT')::text, 'false');
SELECT pg_temp.expect('anon cannot call an overload of a public endpoint', pg_temp.try('anon', $q$SELECT public.check_result('a')$q$), 'denied');
SELECT pg_temp.expect('anon cannot read admission applications', pg_temp.count_as('anon', 'SELECT count(*) FROM public.admission_applications'), 'denied');
SELECT pg_temp.expect('anon can call a public endpoint', pg_temp.try('anon', $q$SELECT public.check_result('a', 'b', 'c')$q$), 'ok');
SELECT pg_temp.expect('anon cannot call an internal definer function', pg_temp.try('anon', 'SELECT public.wallet_credit_internal(1)'), 'denied');
SELECT pg_temp.expect('anon cannot call a procedure', pg_temp.try('anon', 'CALL public.nightly_job()'), 'denied');
SELECT pg_temp.expect('anon holds no privilege beyond SELECT and INSERT',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon' AND privilege_type NOT IN ('SELECT', 'INSERT')), '0');
SELECT pg_temp.expect('anon table grants are exactly news and admission_applications',
  (SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon'),
  'admission_applications:INSERT,news:SELECT');
SELECT pg_temp.expect('anon keeps only the sequence the admission form needs',
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE') ELSE false END),
  'admission_applications_id_seq');
ROLLBACK;

\echo == after: signed-in users ==
BEGIN;
SELECT pg_temp.expect('organization admin can still read their subscription',
  pg_temp.count_as('authenticated', 'SELECT count(*) FROM public.subscriptions', '11111111-1111-1111-1111-111111111111', 'admin'), '1');
SELECT pg_temp.expect('organization admin cannot update their subscription',
  pg_temp.try('authenticated', $q$UPDATE public.subscriptions SET plan = 'enterprise'$q$, '11111111-1111-1111-1111-111111111111', 'admin'), 'denied');
SELECT pg_temp.expect('organization admin cannot insert a subscription',
  pg_temp.try('authenticated', $q$INSERT INTO public.subscriptions (school_id, plan) VALUES ('11111111-1111-1111-1111-111111111111', 'enterprise')$q$, '11111111-1111-1111-1111-111111111111', 'admin'), 'denied');
SELECT pg_temp.expect('organization admin cannot delete a subscription',
  pg_temp.try('authenticated', 'DELETE FROM public.subscriptions', '11111111-1111-1111-1111-111111111111', 'admin'), 'denied');
SELECT pg_temp.expect('a user sees no other organization''s subscription',
  pg_temp.count_as('authenticated', $q$SELECT count(*) FROM public.subscriptions WHERE school_id = '22222222-2222-2222-2222-222222222222'$q$, '11111111-1111-1111-1111-111111111111', 'admin'), '0');
SELECT pg_temp.expect('the service role can still write subscriptions',
  pg_temp.try('service_role', $q$UPDATE public.subscriptions SET plan = 'pro'$q$), 'ok');
SELECT pg_temp.expect('signed-in users keep their table access (students in own organization)',
  pg_temp.count_as('authenticated', 'SELECT count(*) FROM public.students', '11111111-1111-1111-1111-111111111111', 'teacher'), '1');
SELECT pg_temp.expect('signed-in users keep the function access they had',
  pg_temp.try('authenticated', 'SELECT public.wallet_credit_internal(1)'), 'ok');
SELECT pg_temp.expect('the service role keeps function access',
  pg_temp.try('service_role', 'SELECT public.wallet_credit_internal(1)'), 'ok');
SELECT pg_temp.expect('a trigger still fires for a signed-in writer',
  pg_temp.try('authenticated', $q$UPDATE public.news SET title = 'edited'$q$, '11111111-1111-1111-1111-111111111111', 'admin'), 'ok');
ROLLBACK;

\echo == after: new objects are private by default ==
SET ROLE postgres;
CREATE TABLE public.future_table (id bigserial PRIMARY KEY, secret text);
CREATE FUNCTION public.future_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
RESET ROLE;
SELECT pg_temp.expect('a new table gives anon nothing', has_table_privilege('anon', 'public.future_table', 'SELECT')::text, 'false');
SELECT pg_temp.expect('a new table gives authenticated nothing', has_table_privilege('authenticated', 'public.future_table', 'SELECT')::text, 'false');
SELECT pg_temp.expect('a new sequence gives anon nothing', has_sequence_privilege('anon', 'public.future_table_id_seq', 'USAGE')::text, 'false');
SELECT pg_temp.expect('a new function gives anon nothing', has_function_privilege('anon', 'public.future_fn()', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('a new function gives authenticated nothing', has_function_privilege('authenticated', 'public.future_fn()', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('the service role still gets new tables', has_table_privilege('service_role', 'public.future_table', 'SELECT')::text, 'true');

\echo == the proposal can run twice, and keeps the first snapshot ==
SELECT count(*) AS snapshot_rows FROM ops_private.sec_m0_acl_snapshot \gset
SET SESSION AUTHORIZATION m0_runner;
\i database/proposals/SEC-M0_privilege_consolidation.sql
RESET SESSION AUTHORIZATION;
SELECT pg_temp.expect('the second run did not overwrite the snapshot',
  (SELECT count(*)::text FROM ops_private.sec_m0_acl_snapshot), :'snapshot_rows');
SELECT pg_temp.expect('the snapshot still records the original private-table grant',
  (SELECT count(*)::text FROM ops_private.sec_m0_acl_snapshot WHERE object_name = 'students' AND grantee = 'anon' AND privilege = 'SELECT'), '1');
SELECT pg_temp.expect('second run leaves the anon surface unchanged',
  (SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon'),
  'admission_applications:INSERT,news:SELECT');

\echo == rollback restores exactly the previous privileges, and nothing more ==
SET SESSION AUTHORIZATION m0_runner;
\i database/proposals/SEC-M0_privilege_consolidation.rollback.sql
RESET SESSION AUTHORIZATION;
BEGIN;
SELECT pg_temp.expect('after rollback the subscriptions hole is back',
  pg_temp.try('authenticated', $q$UPDATE public.subscriptions SET plan = 'enterprise'$q$, '11111111-1111-1111-1111-111111111111', 'admin'), 'ok');
SELECT pg_temp.expect('after rollback anon has its old grant on a private table',
  has_table_privilege('anon', 'public.students', 'SELECT')::text, 'true');
SELECT pg_temp.expect('after rollback anon can run what it could run before',
  pg_temp.try('anon', 'SELECT public.wallet_credit_internal(1)'), 'ok');
SELECT pg_temp.expect('after rollback anon still cannot run the function that was closed before',
  pg_temp.try('anon', 'SELECT public.internal_revoked()'), 'denied');
SELECT pg_temp.expect('after rollback withheld people columns stay withheld',
  has_column_privilege('anon', 'public.users', 'nin', 'SELECT')::text, 'false');
SELECT pg_temp.expect('after rollback the old people column grants are back',
  has_column_privilege('anon', 'public.users', 'full_name', 'SELECT')::text, 'true');
SELECT pg_temp.expect('after rollback withheld organization columns stay withheld',
  has_column_privilege('anon', 'public.schools', 'grading_scale_id', 'SELECT')::text, 'false');
SELECT pg_temp.expect('after rollback anon holds no table-level SELECT on organizations',
  has_table_privilege('anon', 'public.schools', 'SELECT')::text, 'false');
SELECT pg_temp.expect('after rollback anon reads active organizations as before',
  pg_temp.count_as('anon', 'SELECT count(slug) FROM public.schools'), '1');
ROLLBACK;

\echo SEC-M0 PRIVILEGE TESTS PASSED
