-- Disposable proof for 20261117001000_sherivs_m2a_role_catalog_extension (ADR-145).
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
-- Later applied migrations that govern catalogue state, modelled with the statements they run:
-- M07 (20261103130000) turns the bursar's optional cash recording off; M009-B1 (20261103145000)
-- moves 16 tertiary executive roles to a read-only template until their authority link is verified.
UPDATE public.role_template_permissions SET default_on = false
 WHERE template_code = 'bursar' AND permission_code = 'payments.record_cash' AND kind = 'optional';
INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails)
VALUES ('m009_tertiary_executive_read_only','org','confidential',NULL,
        ARRAY['tenant_isolation','audited','verified_institution_authority_link','read_only']::text[]);
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on) VALUES
  ('m009_tertiary_executive_read_only','analytics.institution','mandatory',true),
  ('m009_tertiary_executive_read_only','reports.academic','mandatory',true),
  ('m009_tertiary_executive_read_only','reports.financial','mandatory',true);
UPDATE public.role_catalog SET template_code = 'm009_tertiary_executive_read_only', requires_verified_authority_link = true
 WHERE org_id IS NULL AND code IN ('ng.vice_chancellor','ng.acting_vice_chancellor','ng.deputy_vice_chancellor_academic','ng.deputy_vice_chancellor_research_innovation_and_development','ng.deputy_vice_chancellor_administration','ng.deputy_vice_chancellor_management_services','ng.rector','ng.acting_rector','ng.deputy_rector_academics','ng.deputy_rector_administration','ng.provost','ng.acting_provost','ng.deputy_provost_academics','ng.deputy_provost_administration','ng.provost_of_college_university','ng.provost_postgraduate_college');
CREATE TEMP TABLE before_roles AS SELECT code, template_code, institution_types FROM public.role_catalog;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.role_catalog) <> 572 OR (SELECT count(*) FROM public.role_templates) <> 57
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
  IF (SELECT count(*) FROM public.role_templates) <> 109 THEN RAISE EXCEPTION 'templates'; END IF;
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
  -- 31 declared remaps; 2 of them (ng.provost_of_college_university, ng.deputy_vice_chancellor_
  -- research_innovation_and_development) target roles M009-B1 holds on the read-only executive
  -- template, so they wait for a verified authority link and 29 take effect.
  IF (SELECT count(*) FROM before_roles b JOIN public.role_catalog r USING (code) WHERE b.template_code <> r.template_code) <> 29 THEN RAISE EXCEPTION 'remap count'; END IF;
  -- existing template holders gain nothing by default: new permissions on old templates are optional and off
  IF EXISTS (SELECT 1 FROM public.role_template_permissions tp
              WHERE tp.template_code IN (SELECT DISTINCT template_code FROM before_roles)
                AND tp.permission_code IN ('role_pack.manage','dsr.process','circular.issue','consent.give','admissions.score')
                AND (tp.kind = 'mandatory' OR tp.default_on)) THEN RAISE EXCEPTION 'new permission on by default'; END IF;
  IF (SELECT workspace_mode FROM public.role_templates WHERE code = 'driver') <> 'task_surface'
     OR (SELECT workspace_mode FROM public.role_catalog WHERE code = 'ng.messenger') <> 'none'
     OR (SELECT cardinality(nav_sections) FROM public.role_templates WHERE code = 'bursar') <> 3 THEN RAISE EXCEPTION 'workspace_mode'; END IF;
END $$;

\echo == M2a keeps what later applied migrations decided (M07, M009-B1) ==
DO $$ BEGIN
  IF (SELECT default_on FROM public.role_template_permissions WHERE template_code = 'bursar' AND permission_code = 'payments.record_cash') IS DISTINCT FROM false
    THEN RAISE EXCEPTION 'M2a re-enabled the bursar''s cash recording (M07 turned it off)'; END IF;
  IF (SELECT count(*) FROM public.role_catalog WHERE org_id IS NULL AND code IN ('ng.vice_chancellor','ng.acting_vice_chancellor','ng.deputy_vice_chancellor_academic','ng.deputy_vice_chancellor_research_innovation_and_development','ng.deputy_vice_chancellor_administration','ng.deputy_vice_chancellor_management_services','ng.rector','ng.acting_rector','ng.deputy_rector_academics','ng.deputy_rector_administration','ng.provost','ng.acting_provost','ng.deputy_provost_academics','ng.deputy_provost_administration','ng.provost_of_college_university','ng.provost_postgraduate_college') AND template_code = 'm009_tertiary_executive_read_only') <> 16
    THEN RAISE EXCEPTION 'M2a moved a verified-authority executive off the read-only template'; END IF;
  IF (SELECT count(*) FROM public.role_template_permissions WHERE template_code = 'm009_tertiary_executive_read_only') <> 3
    THEN RAISE EXCEPTION 'read-only executive template permissions changed'; END IF;
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
  IF (SELECT count(*) FROM public.role_catalog WHERE org_id IS NULL AND code IN ('ng.vice_chancellor','ng.acting_vice_chancellor','ng.deputy_vice_chancellor_academic','ng.deputy_vice_chancellor_research_innovation_and_development','ng.deputy_vice_chancellor_administration','ng.deputy_vice_chancellor_management_services','ng.rector','ng.acting_rector','ng.deputy_rector_academics','ng.deputy_rector_administration','ng.provost','ng.acting_provost','ng.deputy_provost_academics','ng.deputy_provost_administration','ng.provost_of_college_university','ng.provost_postgraduate_college') AND template_code = 'm009_tertiary_executive_read_only') <> 16
    THEN RAISE EXCEPTION 'the M2a rollback moved a verified-authority executive off the read-only template'; END IF;
  IF (SELECT default_on FROM public.role_template_permissions WHERE template_code = 'bursar' AND permission_code = 'payments.record_cash') IS DISTINCT FROM false
    THEN RAISE EXCEPTION 'the M2a rollback re-enabled the bursar''s cash recording'; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.role_catalog) <> 572 OR (SELECT count(*) FROM public.role_templates) <> 57
     OR (SELECT count(*) FROM public.permission_catalog) <> 94 OR (SELECT count(*) FROM public.role_guardrail_catalog) <> 13
     OR (SELECT count(*) FROM public.sod_permission_rules) <> 4 OR (SELECT count(*) FROM public.sod_template_conflicts) <> 7 THEN RAISE EXCEPTION 'rollback counts'; END IF;
  IF EXISTS (SELECT code, template_code, institution_types FROM public.role_catalog EXCEPT SELECT * FROM before_roles) THEN RAISE EXCEPTION 'rollback roles differ'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('role_catalog','role_templates') AND column_name IN ('workspace_mode','nav_sections','default_enabled','mandate_status')) THEN RAISE EXCEPTION 'columns left'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_role_templates_guard','trg_role_template_permissions_guard') AND tgenabled = 'D') THEN RAISE EXCEPTION 'guard left disabled'; END IF;
END $$;
\echo == M2a role catalogue extension: ALL CHECKS PASSED ==
