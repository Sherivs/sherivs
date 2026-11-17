-- Disposable proof for 20261117000200_sherivs_m1_organization_root.sql.
-- A small production-shaped schema (same columns and constraints the migration touches), then
-- positive, negative and cross-organization cases. It is a fixture, not a replay of production.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m1_test -v ON_ERROR_STOP=1 -f tests/sql/m1-organization-root.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.uid', true), '')::uuid $$;

CREATE TABLE public.schools (id uuid PRIMARY KEY, name text);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid, role text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, school_id uuid, user_id uuid, action text, table_name text,
  record_id uuid, old_value jsonb, new_value jsonb);
CREATE TABLE public.cg_tenant (id uuid PRIMARY KEY);
CREATE TABLE public.school_tenant_map (school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.cg_tenant(id));
CREATE TABLE public.platform_organization (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid UNIQUE REFERENCES public.schools(id) ON DELETE SET NULL);
CREATE TABLE public.workspace_org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  parent_unit_id uuid, unit_type text NOT NULL, code text NOT NULL, name text NOT NULL,
  CONSTRAINT workspace_org_units_id_org_id_key UNIQUE (id, org_id),
  CONSTRAINT workspace_org_units_parent_unit_id_org_id_fkey FOREIGN KEY (parent_unit_id, org_id)
    REFERENCES public.workspace_org_units (id, org_id),
  CONSTRAINT workspace_org_units_unit_type_check CHECK (unit_type = ANY (ARRAY['institution', 'group', 'campus',
    'shift', 'faculty', 'department', 'class', 'subject'])));
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT false $$;
CREATE FUNCTION public.scholar_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  INSERT INTO public.audit_logs (school_id, action, table_name, record_id)
  VALUES ((j->>'org_id')::uuid, 'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, (j->>'id')::uuid);
  RETURN NULL;
END $$;

-- As in production, the service role may write the existing tables.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

INSERT INTO public.schools VALUES ('11111111-1111-1111-1111-111111111111', 'A'), ('22222222-2222-2222-2222-222222222222', 'B');
INSERT INTO public.users VALUES
  ('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'admin', true),
  ('00000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'admin', true);

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs a statement as a role for a caller; returns 'ok', a row count, or the SQLSTATE.
CREATE FUNCTION pg_temp.try(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; result text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; result := 'ok:' || n;
  EXCEPTION WHEN others THEN result := 'err:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN result;
END $$;
CREATE FUNCTION pg_temp.count_as(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO n; EXCEPTION WHEN others THEN RESET ROLE; RETURN 'err:' || SQLSTATE; END;
  RESET ROLE;
  RETURN n::text;
END $$;

\echo == apply the migration ==
\i database/supabase/migrations/20261117000200_sherivs_m1_organization_root.sql

\echo == the neutral alias ==
BEGIN;
SELECT pg_temp.expect('alias gives the same organization as the root helper',
  pg_temp.count_as('authenticated', '00000000-0000-0000-0000-00000000000a',
    'SELECT count(*) FROM (SELECT 1 WHERE public.get_my_organization_id() = public.get_my_school_id()) x'), '1');
SELECT pg_temp.expect('anon cannot call the alias', has_function_privilege('anon', 'public.get_my_organization_id()', 'EXECUTE')::text, 'false');
ROLLBACK;

\echo == the unit tree ==
INSERT INTO public.workspace_org_units (id, org_id, unit_type, code, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'faculty', 'sci', 'Science'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'faculty', 'art', 'Arts');
BEGIN;
SELECT pg_temp.expect('a new unit type under a parent in the same organization is accepted',
  pg_temp.try('service_role', '', $q$INSERT INTO public.workspace_org_units (org_id, parent_unit_id, unit_type, code, name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'programme', 'bsc-cs', 'Computer Science')$q$), 'ok:1');
SELECT pg_temp.expect('a unit cannot sit under another organization''s unit',
  pg_temp.try('service_role', '', $q$INSERT INTO public.workspace_org_units (org_id, parent_unit_id, unit_type, code, name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'department', 'x', 'Cross')$q$), 'err:23503');
SELECT pg_temp.expect('a unit cannot be moved under another organization''s unit',
  pg_temp.try('service_role', '', $q$UPDATE public.workspace_org_units SET parent_unit_id = 'bbbbbbbb-0000-0000-0000-000000000001'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$), 'err:23503');
SELECT pg_temp.expect('a unit cannot be its own parent',
  pg_temp.try('service_role', '', $q$UPDATE public.workspace_org_units SET parent_unit_id = id
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$), 'err:23514');
SELECT pg_temp.expect('an unknown unit type is refused',
  pg_temp.try('service_role', '', $q$INSERT INTO public.workspace_org_units (org_id, unit_type, code, name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'planet', 'p', 'Planet')$q$), 'err:23514');
ROLLBACK;

\echo == institution profile ==
INSERT INTO public.institution_profile (id, org_id, institution_type, ownership, calendar_model, grading_system) VALUES
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'private_secondary', 'private', 'term', 'waec_a1_f9'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'polytechnic_state', 'public_state', 'semester', 'nbte_cgpa_4');
SELECT pg_temp.expect('writing a profile is audited',
  (SELECT count(*)::text FROM public.audit_logs WHERE table_name = 'institution_profile'), '2');
BEGIN;
SELECT pg_temp.expect('a member reads their own organization''s profile',
  pg_temp.count_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'SELECT count(*) FROM public.institution_profile'), '1');
SELECT pg_temp.expect('a member cannot see another organization''s profile',
  pg_temp.count_as('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$SELECT count(*) FROM public.institution_profile WHERE org_id = '22222222-2222-2222-2222-222222222222'$q$), '0');
SELECT pg_temp.expect('a signed-in person with no organization sees nothing',
  pg_temp.count_as('authenticated', '00000000-0000-0000-0000-0000000000ff', 'SELECT count(*) FROM public.institution_profile'), '0');
SELECT pg_temp.expect('anon cannot read profiles',
  pg_temp.count_as('anon', '', 'SELECT count(*) FROM public.institution_profile'), 'err:42501');
SELECT pg_temp.expect('a member cannot write a profile',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$UPDATE public.institution_profile SET ownership = 'public_federal'$q$), 'err:42501');
SELECT pg_temp.expect('a member cannot insert a profile',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$INSERT INTO public.institution_profile (org_id, institution_type, ownership, calendar_model, grading_system)
       VALUES ('11111111-1111-1111-1111-111111111111', 'x_y', 'private', 'term', 'g_1')$q$), 'err:42501');
SELECT pg_temp.expect('a second current profile for one organization is refused',
  pg_temp.try('service_role', '', $q$INSERT INTO public.institution_profile (org_id, institution_type, ownership, calendar_model, grading_system)
       VALUES ('11111111-1111-1111-1111-111111111111', 'private_primary', 'private', 'term', 'g_1')$q$), 'err:23505');
SELECT pg_temp.expect('closing the current profile lets a new one start (history kept)',
  pg_temp.try('service_role', '', $q$WITH closed AS (UPDATE public.institution_profile SET effective_to = CURRENT_DATE + 1
         WHERE org_id = '11111111-1111-1111-1111-111111111111' AND effective_to IS NULL RETURNING 1)
       INSERT INTO public.institution_profile (org_id, institution_type, ownership, calendar_model, grading_system, effective_from)
       SELECT '11111111-1111-1111-1111-111111111111', 'private_primary', 'private', 'term', 'g_1', CURRENT_DATE + 1 FROM closed$q$), 'ok:1');
SELECT pg_temp.expect('an unknown ownership is refused',
  pg_temp.try('service_role', '', $q$UPDATE public.institution_profile SET ownership = 'mine'$q$), 'err:23514');
SELECT pg_temp.expect('a period that ends before it starts is refused',
  pg_temp.try('service_role', '', $q$UPDATE public.institution_profile SET effective_to = effective_from - 1$q$), 'err:23514');
ROLLBACK;
SELECT pg_temp.expect('row-level security is forced on the profile table',
  (SELECT relforcerowsecurity::text FROM pg_class WHERE oid = 'public.institution_profile'::regclass), 'true');

\echo == the three records stay 1:1 ==
SELECT pg_temp.expect('gaps are reported for organizations missing kernel and console records',
  (SELECT string_agg(missing, ',' ORDER BY missing) FROM public.organization_root_gaps()
    WHERE org_id = '11111111-1111-1111-1111-111111111111'), 'console_record,kernel_record');
INSERT INTO public.cg_tenant VALUES ('dddddddd-0000-0000-0000-000000000001'), ('dddddddd-0000-0000-0000-000000000002');
INSERT INTO public.school_tenant_map VALUES ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001');
INSERT INTO public.platform_organization (school_id) VALUES ('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('a fully mapped organization has no gaps',
  (SELECT count(*)::text FROM public.organization_root_gaps() WHERE org_id = '11111111-1111-1111-1111-111111111111'), '0');
BEGIN;
SELECT pg_temp.expect('one kernel record cannot serve two organizations',
  pg_temp.try('service_role', '', $q$INSERT INTO public.school_tenant_map VALUES ('22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001')$q$), 'err:23505');
SELECT pg_temp.expect('one organization cannot have two console records',
  pg_temp.try('service_role', '', $q$INSERT INTO public.platform_organization (school_id) VALUES ('11111111-1111-1111-1111-111111111111')$q$), 'err:23505');
SELECT pg_temp.expect('signed-in users cannot call the gaps function',
  pg_temp.count_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'SELECT count(*) FROM public.organization_root_gaps()'), 'err:42501');
ROLLBACK;

\echo == the migration can run twice, and rolls back ==
\i database/supabase/migrations/20261117000200_sherivs_m1_organization_root.sql
\i database/supabase/rollbacks/20261117000200_sherivs_m1_organization_root.sql
SELECT pg_temp.expect('rollback removes the profile table and the alias',
  coalesce(to_regclass('public.institution_profile')::text, 'gone') || '/' ||
  coalesce(to_regprocedure('public.get_my_organization_id()')::text, 'gone'), 'gone/gone');
\echo M1 ORGANIZATION ROOT TESTS PASSED
