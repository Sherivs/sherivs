-- Disposable proof for 20261117001000_sherivs_m2a_role_catalog_extension (ADR-104).
-- Builds a production-shaped SHERIVS-017 catalogue on an EMPTY database, applies the M2a
-- migration twice, proves the oversight defaults, the remap guard and the rollback.
-- Run as a superuser:
--   psql -d <db> -v ON_ERROR_STOP=1 -f tests/sql/m2a-role-catalog-extension.sql
\set ON_ERROR_STOP on
\echo == fixture: roles, auth.uid(), organisation root and the tables 017 touches ==
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.schools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid REFERENCES public.schools(id));
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, school_id uuid, user_id uuid, action text, table_name text, record_id text, old_value jsonb, new_value jsonb);
CREATE TABLE public.staff_payroll (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, user_id uuid, amount numeric, status text, approved_by uuid);
CREATE TABLE public.school_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, amount numeric, status text, created_by uuid, approved_by uuid);
CREATE OR REPLACE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() $$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.can_administer_org(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

\echo == apply SHERIVS-017 and the M009 B-1 column (production state) ==
\i database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql
ALTER TABLE public.role_catalog ADD COLUMN IF NOT EXISTS requires_verified_authority_link boolean NOT NULL DEFAULT false;
UPDATE public.role_catalog SET requires_verified_authority_link = true WHERE org_id IS NULL AND template_code IN ('regulator','regulator_inspector');
CREATE TEMP TABLE before_roles AS SELECT code, template_code, institution_types FROM public.role_catalog;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.role_catalog) <> 572 OR (SELECT count(*) FROM public.role_templates) <> 56
     OR (SELECT count(*) FROM public.permission_catalog) <> 94 THEN RAISE EXCEPTION 'fixture is not the 017 catalogue'; END IF;
END $$;

\echo == negative: an active assignment on a remapped role blocks the migration ==
INSERT INTO public.schools (id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.users (id, school_id) VALUES ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a9', 'ng.sub_dean');
-- The migration runner applies a file in one transaction; model that: the guard aborts it all.
BEGIN;
\set ON_ERROR_STOP off
\i database/supabase/migrations/20261117001000_sherivs_m2a_role_catalog_extension.sql
\set ON_ERROR_STOP on
ROLLBACK;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'role_catalog' AND column_name = 'workspace_mode') THEN
    RAISE EXCEPTION 'guard did not stop the migration'; END IF;
  IF (SELECT template_code FROM public.role_catalog WHERE code = 'ng.sub_dean') <> 'dean' THEN RAISE EXCEPTION 'remap ran despite guard'; END IF;
END $$;
UPDATE public.user_role_assignments SET status = 'ended', ended_at = now() WHERE role_code = 'ng.sub_dean';

\echo == apply M2a twice (idempotent) ==
\i database/supabase/migrations/20261117001000_sherivs_m2a_role_catalog_extension.sql
CREATE TEMP TABLE first_run AS SELECT * FROM public.role_catalog;
\i database/supabase/migrations/20261117001000_sherivs_m2a_role_catalog_extension.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.role_catalog WHERE org_id IS NULL) <> 649 THEN RAISE EXCEPTION 'roles %', (SELECT count(*) FROM public.role_catalog); END IF;
  IF (SELECT count(*) FROM public.role_templates) <> 108 THEN RAISE EXCEPTION 'templates'; END IF;
  IF (SELECT count(*) FROM public.permission_catalog) <> 160 THEN RAISE EXCEPTION 'permissions'; END IF;
  IF (SELECT count(*) FROM public.permission_catalog WHERE protected) <> 54 THEN RAISE EXCEPTION 'protected'; END IF;
  IF (SELECT count(*) FROM public.sod_permission_rules) <> 9 OR (SELECT count(*) FROM public.sod_template_conflicts) <> 8 THEN RAISE EXCEPTION 'sod'; END IF;
  IF (SELECT count(*) FROM public.role_guardrail_catalog) <> 14 THEN RAISE EXCEPTION 'guardrails'; END IF;
  IF EXISTS (SELECT * FROM public.role_catalog EXCEPT SELECT * FROM first_run) THEN RAISE EXCEPTION 'second run changed data'; END IF;
  -- oversight: disabled, unverified and authority-gated; nothing else is
  IF EXISTS (SELECT 1 FROM public.role_catalog WHERE 'government' = ANY (institution_types)
              AND (default_enabled OR mandate_status <> 'unverified' OR NOT requires_verified_authority_link)) THEN RAISE EXCEPTION 'oversight role enabled'; END IF;
  IF (SELECT count(*) FROM public.role_catalog WHERE NOT default_enabled) <> 91 THEN RAISE EXCEPTION 'disabled count'; END IF;
  IF EXISTS (SELECT 1 FROM public.role_catalog WHERE NOT ('government' = ANY (institution_types)) AND NOT default_enabled) THEN RAISE EXCEPTION 'non-oversight disabled'; END IF;
  -- original roles keep their original institution types
  IF EXISTS (SELECT 1 FROM before_roles b JOIN public.role_catalog r USING (code) WHERE NOT (b.institution_types <@ r.institution_types)) THEN RAISE EXCEPTION 'types lost'; END IF;
  IF (SELECT count(*) FROM before_roles b JOIN public.role_catalog r USING (code) WHERE b.template_code <> r.template_code) <> 31 THEN RAISE EXCEPTION 'remap count'; END IF;
  -- existing template holders gain nothing by default: new permissions on old templates are optional and off
  IF EXISTS (SELECT 1 FROM public.role_template_permissions tp
              WHERE tp.template_code IN (SELECT DISTINCT template_code FROM before_roles)
                AND tp.permission_code IN ('role_pack.manage','dsr.process','circular.issue','consent.give','admissions.score')
                AND (tp.kind = 'mandatory' OR tp.default_on)) THEN RAISE EXCEPTION 'new permission on by default'; END IF;
  IF (SELECT workspace_mode FROM public.role_templates WHERE code = 'driver') <> 'task_surface'
     OR (SELECT workspace_mode FROM public.role_catalog WHERE code = 'ng.messenger') <> 'none'
     OR (SELECT cardinality(nav_sections) FROM public.role_templates WHERE code = 'bursar') <> 3 THEN RAISE EXCEPTION 'workspace_mode'; END IF;
END $$;

\echo == the 017 guards still hold after M2a ==
\set ON_ERROR_STOP off
DELETE FROM public.role_templates WHERE code = 'gate_officer';
\set ON_ERROR_STOP on
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.role_templates WHERE code = 'gate_officer') THEN RAISE EXCEPTION 'template delete allowed'; END IF; END $$;

\echo == rollback restores the 017 catalogue exactly ==
DELETE FROM public.user_role_assignments;
\i database/supabase/rollbacks/20261117001000_sherivs_m2a_role_catalog_extension.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.role_catalog) <> 572 OR (SELECT count(*) FROM public.role_templates) <> 56
     OR (SELECT count(*) FROM public.permission_catalog) <> 94 OR (SELECT count(*) FROM public.role_guardrail_catalog) <> 13
     OR (SELECT count(*) FROM public.sod_permission_rules) <> 4 OR (SELECT count(*) FROM public.sod_template_conflicts) <> 7 THEN RAISE EXCEPTION 'rollback counts'; END IF;
  IF EXISTS (SELECT code, template_code, institution_types FROM public.role_catalog EXCEPT SELECT * FROM before_roles) THEN RAISE EXCEPTION 'rollback roles differ'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('role_catalog','role_templates') AND column_name IN ('workspace_mode','nav_sections','default_enabled','mandate_status')) THEN RAISE EXCEPTION 'columns left'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_role_templates_guard','trg_role_template_permissions_guard') AND tgenabled = 'D') THEN RAISE EXCEPTION 'guard left disabled'; END IF;
END $$;
\echo == M2a role catalogue extension: ALL CHECKS PASSED ==
