-- Disposable proof for 20261117003100_sherivs_m6_onboarding_provisioning.sql (M6, ADR-148).
-- A small production-shaped schema (the columns, constraints and triggers the migration touches,
-- read from production with read-only queries on 2026-11-17), then the real M1 and M5b migrations,
-- then this migration twice. role_pack_install is a fixture with the same caller rule and
-- published-pack rule as M2b (its full engine is proved by tests/sql/m2-role-pack-engine.sql).
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m6_test -v ON_ERROR_STOP=1 -f tests/sql/m6-onboarding-provisioning.sql
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Same bodies as production: identity comes from the request's JWT settings.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE public.schools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  email text, phone text, is_active boolean DEFAULT true, onboarding_completed boolean DEFAULT false,
  institution_category text CHECK (institution_category = ANY (ARRAY['k12', 'polytechnic', 'university', 'other'])),
  social_media_enabled boolean NOT NULL DEFAULT false);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid REFERENCES public.schools(id), role text,
  is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL, user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL, table_name text, record_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.super_admins (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE id = auth.uid() AND is_active) $$;
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
GRANT EXECUTE ON FUNCTION public.is_super_admin(), public.get_my_school_id() TO authenticated, service_role;
CREATE FUNCTION public.scholar_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_id uuid; v_actor uuid := auth.uid(); j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  v_org := coalesce((j->>'school_id')::uuid, (j->>'org_id')::uuid);
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_org) THEN RETURN NULL; END IF;
  BEGIN v_id := (j->>'id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
  VALUES (v_org, CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
          'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) || jsonb_build_object('actor', v_actor) END);
  RETURN NULL;
END $$;

-- Kernel and console records (production columns and checks used here).
CREATE TABLE public.cg_tenant (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_type text NOT NULL, name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$'),
  status text NOT NULL DEFAULT 'PROVISIONING', environment text NOT NULL DEFAULT 'development');
CREATE TABLE public.school_tenant_map (school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.cg_tenant(id));
CREATE FUNCTION public.school_tenant_map_autofill() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.school_tenant_map (school_id, tenant_id) SELECT s.id, NEW.id FROM public.schools s WHERE s.id = NEW.id
  ON CONFLICT DO NOTHING; RETURN NEW;
END $$;
CREATE TRIGGER cg_tenant_school_map AFTER INSERT ON public.cg_tenant FOR EACH ROW EXECUTE FUNCTION public.school_tenant_map_autofill();
CREATE TABLE public.platform_organization (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120), legal_name text,
  org_type text NOT NULL DEFAULT 'school', country text, region text, city text,
  lifecycle_state text NOT NULL DEFAULT 'draft', questionnaire jsonb NOT NULL DEFAULT '{}', questionnaire_step text NOT NULL DEFAULT 'identity',
  intended_runtime text NOT NULL DEFAULT 'scholar', enabled_runtime text CHECK (enabled_runtime IS NULL OR enabled_runtime = 'scholar'),
  outstanding_requirements jsonb NOT NULL DEFAULT '[]', created_by uuid REFERENCES auth.users(id), reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz, provisioned_at timestamptz,
  school_id uuid UNIQUE REFERENCES public.schools(id) ON DELETE SET NULL);
CREATE TABLE public.platform_organization_transition (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.platform_organization(id) ON DELETE CASCADE, from_state text,
  to_state text NOT NULL, actor_id uuid REFERENCES auth.users(id), reason text, created_at timestamptz NOT NULL DEFAULT now());
-- The unit tree and its production audit trigger (which refuses a write without an actor).
CREATE TABLE public.role_assignment_audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL,
  actor_user_id uuid NOT NULL, target_type text NOT NULL, target_id text, action text NOT NULL, after_state jsonb);
CREATE TABLE public.workspace_org_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, parent_unit_id uuid,
  unit_type text NOT NULL, code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{1,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120), created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_org_units_id_org_id_key UNIQUE (id, org_id), CONSTRAINT workspace_org_units_org_id_code_key UNIQUE (org_id, code),
  CONSTRAINT workspace_org_units_parent_unit_id_org_id_fkey FOREIGN KEY (parent_unit_id, org_id) REFERENCES public.workspace_org_units (id, org_id),
  CONSTRAINT workspace_org_units_unit_type_check CHECK (unit_type = ANY (ARRAY['institution', 'group', 'campus', 'shift',
    'faculty', 'department', 'class', 'subject'])));
CREATE FUNCTION public.workspace_role_engine_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j jsonb := to_jsonb(coalesce(NEW, OLD)); v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'role mutation audit requires an authenticated actor' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.role_assignment_audit_events (org_id, actor_user_id, target_type, target_id, action, after_state)
  VALUES ((j->>'org_id')::uuid, v_actor, TG_TABLE_NAME, j->>'id', lower(TG_OP), j);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_workspace_org_units_m009_audit AFTER INSERT OR UPDATE OR DELETE ON public.workspace_org_units
  FOR EACH ROW EXECUTE FUNCTION public.workspace_role_engine_audit();
-- 021: the application record. Clients read; nobody but definer functions writes.
CREATE TABLE public.onboarding_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, answers jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'applied')), plan jsonb, plan_hash text,
  applied_at timestamptz, applied_result jsonb, created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.onboarding_sessions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER trg_onboarding_sessions_audit AFTER INSERT OR UPDATE OR DELETE ON public.onboarding_sessions
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
-- 018: feature flags with the lock guard.
CREATE TABLE public.feature_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL,
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false, description text, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX feature_flags_scope ON public.feature_flags (key, (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)));
CREATE FUNCTION public.feature_flags_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked THEN RAISE EXCEPTION 'locked flag % cannot be removed', OLD.key; END IF; RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.feature_flags f WHERE f.key = NEW.key AND f.org_id IS NULL AND f.locked)
     AND (TG_OP = 'INSERT' AND NEW.org_id IS NOT NULL OR TG_OP = 'UPDATE' AND (NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.locked IS DISTINCT FROM OLD.locked))
     AND current_setting('sherivs.unlock_flag', true) IS DISTINCT FROM NEW.key THEN
    RAISE EXCEPTION 'flag % is locked', NEW.key USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_feature_flags_guard BEFORE INSERT OR UPDATE OR DELETE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.feature_flags_guard();
CREATE FUNCTION public.flag_on(p_key text, p_org uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT enabled FROM public.feature_flags WHERE key = p_key AND org_id = p_org),
                  (SELECT enabled FROM public.feature_flags WHERE key = p_key AND org_id IS NULL), false) $$;
GRANT EXECUTE ON FUNCTION public.flag_on(text, uuid) TO authenticated, service_role;
-- Website engine: the draft table, its audit, and a validator with the same entry check.
CREATE TABLE public.websites (school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE, draft jsonb NOT NULL,
  draft_rev integer NOT NULL DEFAULT 1, published_version integer, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.website_audit (id bigserial PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor uuid, action text NOT NULL);
CREATE FUNCTION public._website_validate(p_doc jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' OR p_doc->>'schema' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'website: document must be an object with schema 1' USING ERRCODE = '22023'; END IF;
END $$;
-- M2b fixture: published-pack registry, installations, and role_pack_install's caller and pack rules.
CREATE TABLE public.cg_role_pack (code text NOT NULL, version text NOT NULL, kind text NOT NULL, status text NOT NULL,
  PRIMARY KEY (code, version));
CREATE TABLE public.tenant_role_pack_installations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, pack_code text NOT NULL, pack_version text NOT NULL,
  installed_by uuid, status text NOT NULL DEFAULT 'active', UNIQUE (org_id, pack_code, pack_version),
  FOREIGN KEY (pack_code, pack_version) REFERENCES public.cg_role_pack (code, version));
CREATE FUNCTION public.role_pack_install(p_org uuid, p_pack_code text, p_pack_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NULL AND coalesce(auth.role(), '') = ''
          AND session_user NOT IN ('authenticator', 'anon', 'authenticated'))) THEN
    RAISE EXCEPTION 'role packs are installed by the provisioning service only' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cg_role_pack p WHERE p.code = p_pack_code AND p.version = p_pack_version
                    AND p.kind = 'institution_pack' AND p.status = 'published') THEN
    RAISE EXCEPTION 'role pack % % cannot be installed', p_pack_code, p_pack_version USING ERRCODE = '42501'; END IF;
  SELECT i.id INTO v_id FROM public.tenant_role_pack_installations i WHERE i.org_id = p_org AND i.status = 'active';
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'already_installed', 'installation_id', v_id); END IF;
  INSERT INTO public.tenant_role_pack_installations (org_id, pack_code, pack_version, installed_by)
  VALUES (p_org, p_pack_code, p_pack_version, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('outcome', 'installed', 'installation_id', v_id, 'pack_code', p_pack_code, 'pack_version', p_pack_version);
END $$;
REVOKE ALL ON FUNCTION public.role_pack_install(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.role_pack_install(uuid, text, text) TO service_role;
-- Platform staff (008) and the console capability helper.
CREATE TABLE public.platform_roles (code text PRIMARY KEY, capabilities text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.platform_staff (id uuid PRIMARY KEY REFERENCES auth.users(id), status text NOT NULL DEFAULT 'active');
CREATE TABLE public.platform_staff_roles (staff_id uuid NOT NULL REFERENCES public.platform_staff(id),
  role_code text NOT NULL REFERENCES public.platform_roles(code), PRIMARY KEY (staff_id, role_code));
CREATE FUNCTION public.has_platform_capability(p_capability text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin() OR EXISTS (SELECT 1 FROM public.platform_staff s
    JOIN public.platform_staff_roles sr ON sr.staff_id = s.id JOIN public.platform_roles r ON r.code = sr.role_code
   WHERE s.id = auth.uid() AND s.status = 'active' AND p_capability = ANY (r.capabilities)) $$;
GRANT EXECUTE ON FUNCTION public.has_platform_capability(text) TO authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE ALL ON public.onboarding_sessions FROM service_role, authenticated, anon;
GRANT SELECT ON public.onboarding_sessions TO service_role, authenticated;

\echo == apply M1 and M5b (dependencies), then M6 twice ==
\i database/supabase/migrations/20261117000200_sherivs_m1_organization_root.sql
\i database/supabase/migrations/20261117001300_sherivs_m5_onboarding_requests.sql
\i database/supabase/migrations/20261117003100_sherivs_m6_onboarding_provisioning.sql
\i database/supabase/migrations/20261117003100_sherivs_m6_onboarding_provisioning.sql

-- People. ops = operations (tenants.manage); onb = onboarding (read, handle); both = both roles;
-- gone = suspended; t = a tenant user of an existing organization; nobody holds no staff row.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'ops@sherivs.test', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'onb@sherivs.test', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'both@sherivs.test', now()),
  ('00000000-0000-0000-0000-0000000000a4', 'gone@sherivs.test', now()),
  ('00000000-0000-0000-0000-0000000000b1', 't@tenant.test', now());
INSERT INTO public.platform_roles VALUES ('operations', ARRAY['platform.tenants.read', 'platform.tenants.manage']),
  ('onboarding', ARRAY['platform.onboarding.read', 'platform.onboarding.handle']);
INSERT INTO public.platform_staff VALUES ('00000000-0000-0000-0000-0000000000a1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'active'), ('00000000-0000-0000-0000-0000000000a3', 'active'),
  ('00000000-0000-0000-0000-0000000000a4', 'suspended');
INSERT INTO public.platform_staff_roles VALUES ('00000000-0000-0000-0000-0000000000a1', 'operations'),
  ('00000000-0000-0000-0000-0000000000a2', 'onboarding'), ('00000000-0000-0000-0000-0000000000a3', 'operations'),
  ('00000000-0000-0000-0000-0000000000a3', 'onboarding'), ('00000000-0000-0000-0000-0000000000a4', 'operations');
INSERT INTO public.schools (id, name, slug) VALUES ('11111111-1111-1111-1111-111111111111', 'Existing Org', 'existing-org');
INSERT INTO public.cg_tenant (id, tenant_type, name, slug) VALUES ('11111111-1111-1111-1111-111111111111', 'organization', 'Existing Org', 'existing-org');
INSERT INTO public.platform_organization (display_name, school_id) VALUES ('Existing Org', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.institution_profile (org_id, institution_type, ownership, calendar_model, grading_system)
  VALUES ('11111111-1111-1111-1111-111111111111', 'private_primary', 'private', 'term', 'g_1');
INSERT INTO public.users VALUES ('00000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'admin', true);
INSERT INTO public.cg_role_pack VALUES ('ng.private_secondary', '1.0.0', 'institution_pack', 'published'),
  ('ng.private_secondary', '0.1.0', 'institution_pack', 'draft');

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs SQL as an API role. 'service_role' gets a service JWT role; others get the uid as sub.
CREATE FUNCTION pg_temp.val_as(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO v;
  EXCEPTION WHEN others THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.role', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'err:' || SQLSTATE;
  END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.role', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN coalesce(v, '<null>');
END $$;
CREATE FUNCTION pg_temp.svc(p_sql text) RETURNS text LANGUAGE sql AS $$ SELECT pg_temp.val_as('service_role', NULL, p_sql) $$;
-- Rows in every table provisioning writes (the "no partial tenant" probe).
CREATE FUNCTION pg_temp.footprint() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(',', (SELECT count(*) FROM public.schools), (SELECT count(*) FROM public.cg_tenant),
    (SELECT count(*) FROM public.school_tenant_map), (SELECT count(*) FROM public.platform_organization),
    (SELECT count(*) FROM public.platform_organization_transition), (SELECT count(*) FROM public.institution_profile),
    (SELECT count(*) FROM public.workspace_org_units), (SELECT count(*) FROM public.tenant_role_pack_installations),
    (SELECT count(*) FROM public.organization_invitations), (SELECT count(*) FROM public.websites),
    (SELECT count(*) FROM public.onboarding_sessions)) $$;

\set ops '00000000-0000-0000-0000-0000000000a1'
\set onb '00000000-0000-0000-0000-0000000000a2'
\set both '00000000-0000-0000-0000-0000000000a3'
\set gone '00000000-0000-0000-0000-0000000000a4'
\set tuser '00000000-0000-0000-0000-0000000000b1'

\echo == a request with a completed interview (through the M5b server functions) ==
SELECT pg_temp.expect('intake creates a request', pg_temp.svc($q$SELECT count(*) FROM public.onboarding_intake_create(
  'Bright Future College', 'private_secondary', 'Lagos', 'Ikeja', 'Ada Obi', 'ada@bright.test', NULL, NULL, NULL,
  'v1', 'public_onboarding', repeat('a', 64), 'pending-graph')$q$), '1');
SELECT pg_temp.expect('intake creates a second request', pg_temp.svc($q$SELECT count(*) FROM public.onboarding_intake_create(
  'Second Light Academy', 'private_secondary', 'Oyo', NULL, 'Bola Ade', 'bola@second.test', NULL, NULL, NULL,
  'v1', 'public_onboarding', repeat('b', 64), 'pending-graph')$q$), '1');
SELECT pg_temp.expect('answers saved', pg_temp.svc($q$SELECT revision::text FROM public.onboarding_intake_save(
  repeat('a', 64), 0, '{"entry.organization.type": "private_secondary"}'::jsonb, 100)$q$), '1');
SELECT pg_temp.expect('interview completed', pg_temp.svc($q$SELECT revision::text FROM public.onboarding_intake_complete(repeat('a', 64), 1)$q$), '2');
SELECT id AS req_a FROM public.onboarding_requests WHERE org_name = 'Bright Future College' \gset
SELECT id AS req_b FROM public.onboarding_requests WHERE org_name = 'Second Light Academy' \gset

\set plan '{"rolePack": {"code": "ng.private_secondary", "version": "1.0.0"}, "orgUnits": [{"key": "org", "kind": "organization", "parentKey": null}, {"key": "section_jss", "kind": "section", "parentKey": "org"}, {"key": "section_sss", "kind": "section", "parentKey": "org"}], "calendarModel": "three_term", "gradingSystem": "continuous_assessment_and_exam", "curricula": ["nigerian_national"], "modules": [{"code": "website", "enabled": true, "gate": null}], "websiteTemplate": "basic_private", "admissions": {"enabledByDefault": true, "mode": "cycle"}, "authorityLinkCandidates": [{"authority": "state_ministry_of_education", "relation": "registered_with", "scope": "lagos", "status": "unverified"}], "institutionProfile": {"institution_type": "private_secondary", "ownership": "private", "regulators": [], "calendar_model": "three_term", "grading_system": "continuous_assessment_and_exam", "curricula": ["nigerian_national"], "languages": ["en"], "attributes": {}}, "flags": []}'

\echo == nobody but the console server may call the functions ==
SELECT pg_temp.expect('anon cannot provision',
  pg_temp.val_as('anon', NULL, format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'ops', repeat('0', 64))), 'err:42501');
SELECT pg_temp.expect('a tenant user cannot provision (no EXECUTE)',
  pg_temp.val_as('authenticated', :'tuser', format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'tuser', repeat('0', 64))), 'err:42501');
SELECT pg_temp.expect('staff calling directly cannot provision either (no EXECUTE)',
  pg_temp.val_as('authenticated', :'ops', format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'ops', repeat('0', 64))), 'err:42501');
SELECT pg_temp.expect('a tenant user cannot approve',
  pg_temp.val_as('authenticated', :'tuser', format($q$SELECT count(*) FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'tuser', repeat('0', 64))), 'err:42501');
SELECT pg_temp.expect('anon cannot assign',
  pg_temp.val_as('anon', NULL, format($q$SELECT public.onboarding_review_assign(%L, %L)::text$q$, :'req_a', :'onb')), 'err:42501');
SELECT pg_temp.expect('authenticated cannot read the invitation table',
  pg_temp.val_as('authenticated', :'tuser', 'SELECT count(*) FROM public.organization_invitations'), 'err:42501');
SELECT pg_temp.expect('the server cannot act for a tenant user',
  pg_temp.svc(format($q$SELECT public.onboarding_review_assign(%L, %L)::text$q$, :'req_a', :'tuser')), 'err:42501');
SELECT pg_temp.expect('the server cannot act for a suspended staff member',
  pg_temp.svc(format($q$SELECT public.onboarding_review_assign(%L, %L)::text$q$, :'req_a', :'gone')), 'err:42501');

\echo == assign, generate, edit ==
SELECT pg_temp.expect('onboarding staff assign the request to themselves',
  pg_temp.svc(format($q$SELECT public.onboarding_review_assign(%L, %L)::text$q$, :'req_a', :'onb')), :'onb');
SELECT pg_temp.expect('operations staff cannot store a plan (needs onboarding.handle)',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_set_plan(%L, %L, 'generated', %L::jsonb, 'g1', 0)$q$, :'req_a', :'ops', :'plan')), 'err:42501');
SELECT pg_temp.expect('a non-plan object is refused',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_set_plan(%L, %L, 'generated', '{"x":1}'::jsonb, 'g1', 0)$q$, :'req_a', :'onb')), 'err:22023');
SELECT pg_temp.expect('editing before generating is refused',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_set_plan(%L, %L, 'edited', %L::jsonb, 'g1', 0)$q$, :'req_a', :'onb', :'plan')), 'err:PT409');
SELECT pg_temp.expect('the generated plan is stored with a database hash',
  pg_temp.svc(format($q$SELECT plan_hash = encode(sha256(convert_to(%L::jsonb::text, 'UTF8')), 'hex') FROM public.onboarding_review_set_plan(%L, %L, 'generated', %L::jsonb, 'g1', 0)$q$, :'plan', :'req_a', :'onb', :'plan')), 'true');
SELECT pg_temp.expect('a stale revision is refused',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_set_plan(%L, %L, 'generated', %L::jsonb, 'g1', 0)$q$, :'req_a', :'onb', :'plan')), 'err:PT409');
SELECT plan_hash AS hash1 FROM public.onboarding_requests WHERE id = :'req_a' \gset
SELECT pg_temp.expect('status is plan_ready', (SELECT status FROM public.onboarding_requests WHERE id = :'req_a'), 'plan_ready');

\echo == approval: passkey, current hash, separation of duties ==
SELECT pg_temp.expect('approval without a verified step-up is refused',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_approve(%L, %L, %L, false)$q$, :'req_a', :'ops', :'hash1')), 'err:42501');
SELECT pg_temp.expect('onboarding staff cannot approve (needs tenants.manage)',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'onb', :'hash1')), 'err:42501');
SELECT pg_temp.expect('a different hash is refused',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'ops', repeat('f', 64))), 'err:PT409');
-- 'both' edits the plan (a renamed unit), so 'both' may not approve it.
SELECT pg_temp.expect('an edit is stored',
  pg_temp.svc(format($q$SELECT plan_revision::text FROM public.onboarding_review_set_plan(%L, %L, 'edited', jsonb_set(%L::jsonb, '{orgUnits,1,name}', '"Junior Secondary"'), NULL, 1)$q$, :'req_a', :'both', :'plan')), '2');
SELECT plan_hash AS hash2 FROM public.onboarding_requests WHERE id = :'req_a' \gset
SELECT pg_temp.expect('the edited plan has a new hash', (:'hash1' <> :'hash2')::text, 'true');
SELECT pg_temp.expect('the old hash is now stale',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'ops', :'hash1')), 'err:PT409');
SELECT pg_temp.expect('the editor cannot approve their own edit',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'both', :'hash2')), 'err:42501');
SELECT pg_temp.expect('provisioning before approval is refused',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'ops', :'hash2')), 'err:PT409');
SELECT pg_temp.expect('another manager approves with the current hash',
  pg_temp.svc(format($q$SELECT replay::text FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'ops', :'hash2')), 'false');
SELECT pg_temp.expect('approver identity is recorded',
  (SELECT approved_by::text || '/' || approval_step_up::text FROM public.onboarding_requests WHERE id = :'req_a'), :'ops' || '/true');
SELECT pg_temp.expect('approving again is a replay',
  pg_temp.svc(format($q$SELECT replay::text FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_a', :'ops', :'hash2')), 'true');

\echo == provisioning ==
SELECT pg_temp.footprint() AS before_all \gset
SELECT pg_temp.expect('a stale hash cannot provision',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'ops', :'hash1')), 'err:PT409');
SELECT pg_temp.expect('onboarding staff cannot provision',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'onb', :'hash2')), 'err:42501');
SELECT pg_temp.expect('self-serve is refused while the flag is off',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L, NULL, 'self_serve')::text$q$, :'req_a', :'ops', :'hash2')), 'err:42501');
SELECT pg_temp.expect('refusals wrote nothing', pg_temp.footprint(), :'before_all');
SELECT pg_temp.expect('provisioning succeeds',
  pg_temp.svc(format($q$SELECT (public.onboarding_provision_from_plan(%L, %L, %L, '{"schema": 1, "locales": ["en"]}'::jsonb))->>'replay'$q$, :'req_a', :'ops', :'hash2')), 'false');
SELECT provisioned_org_id AS org FROM public.onboarding_requests WHERE id = :'req_a' \gset
SELECT pg_temp.expect('request is provisioned', (SELECT status FROM public.onboarding_requests WHERE id = :'req_a'), 'provisioned');
SELECT pg_temp.expect('organization root row', (SELECT count(*)::text FROM public.schools WHERE id = :'org' AND slug = 'bright-future-college'), '1');
SELECT pg_temp.expect('kernel record and map', (SELECT count(*)::text FROM public.cg_tenant t JOIN public.school_tenant_map m ON m.tenant_id = t.id WHERE m.school_id = :'org'), '1');
SELECT pg_temp.expect('console record', (SELECT lifecycle_state FROM public.platform_organization WHERE school_id = :'org'), 'ready_for_activation');
SELECT pg_temp.expect('console transition recorded', (SELECT count(*)::text FROM public.platform_organization_transition t JOIN public.platform_organization p ON p.id = t.organization_id WHERE p.school_id = :'org'), '1');
SELECT pg_temp.expect('institution profile mapped', (SELECT ownership || '/' || calendar_model FROM public.institution_profile WHERE org_id = :'org'), 'private/term');
SELECT pg_temp.expect('org units from the plan', (SELECT string_agg(unit_type || ':' || code || ':' || name, ',' ORDER BY code) FROM public.workspace_org_units WHERE org_id = :'org'),
  'institution:org:Org,section:section-jss:Junior Secondary,section:section-sss:Section Sss');
SELECT pg_temp.expect('units are parented in the tree', (SELECT count(*)::text FROM public.workspace_org_units WHERE org_id = :'org' AND parent_unit_id IS NOT NULL), '2');
SELECT pg_temp.expect('unit writes attributed to the staff actor', (SELECT count(*)::text FROM public.role_assignment_audit_events WHERE org_id = :'org' AND actor_user_id = :'ops'), '3');
SELECT pg_temp.expect('the request identity was restored after the unit writes', (SELECT count(*)::text FROM public.tenant_role_pack_installations WHERE org_id = :'org' AND installed_by IS NULL), '1');
SELECT pg_temp.expect('role pack installed', (SELECT pack_code || '@' || pack_version FROM public.tenant_role_pack_installations WHERE org_id = :'org'), 'ng.private_secondary@1.0.0');
SELECT pg_temp.expect('first-admin invitation pending', (SELECT status || '/' || intended_role || '/' || invitee_email FROM public.organization_invitations WHERE org_id = :'org'), 'pending/org_administrator/ada@bright.test');
SELECT pg_temp.expect('website drafted', (SELECT count(*)::text FROM public.websites WHERE school_id = :'org' AND published_version IS NULL), '1');
SELECT pg_temp.expect('applied_result recorded', (SELECT (applied_result->'admissions'->>'status') || '/' || (applied_result->'website'->>'status') || '/' || status
  FROM public.onboarding_sessions WHERE onboarding_request_id = :'req_a'), 'pending/drafted/applied');
SELECT pg_temp.expect('session carries the approved hash', (SELECT plan_hash FROM public.onboarding_sessions WHERE onboarding_request_id = :'req_a'), :'hash2');
SELECT pg_temp.expect('session keeps the interview answers', (SELECT answers->>'entry.organization.type' FROM public.onboarding_sessions WHERE onboarding_request_id = :'req_a'), 'private_secondary');
SELECT pg_temp.expect('no root gaps for any organization', (SELECT count(*)::text FROM public.organization_root_gaps()), '0');
SELECT pg_temp.expect('audit: assign, generate, edit, approve, provision',
  (SELECT string_agg(action, ',' ORDER BY created_at, action) FROM public.audit_logs WHERE action LIKE 'platform.onboarding.%'),
  'platform.onboarding.assign,platform.onboarding.plan_generated,platform.onboarding.plan_edited,platform.onboarding.approve,platform.onboarding.provision');
SELECT pg_temp.expect('provision audit names approver and actor', (SELECT (new_value->>'approved_by') || '/' || (new_value->>'actor') FROM public.audit_logs WHERE action = 'platform.onboarding.provision'), :'ops' || '/' || :'ops');
SELECT pg_temp.expect('tenant rows are audited too', (SELECT count(*)::text FROM public.audit_logs WHERE school_id = :'org' AND action IN ('scholar.institution_profile.insert', 'scholar.organization_invitations.insert', 'scholar.onboarding_sessions.insert')), '3');
SELECT pg_temp.expect('the tenant user cannot see the new organization''s application record',
  pg_temp.val_as('authenticated', :'tuser', format($q$SELECT count(*) FROM public.onboarding_sessions WHERE school_id = %L$q$, :'org')), '0');

\echo == second run is idempotent ==
SELECT pg_temp.footprint() AS after_first \gset
SELECT count(*) AS audit_first FROM public.audit_logs \gset
SELECT pg_temp.expect('second run returns the first result',
  pg_temp.svc(format($q$SELECT (r->>'organization_id') || '/' || (r->>'replay') FROM (SELECT public.onboarding_provision_from_plan(%L, %L, %L) r) x$q$, :'req_a', :'ops', :'hash2')), :'org' || '/true');
SELECT pg_temp.expect('second run created nothing', pg_temp.footprint(), :'after_first');
SELECT pg_temp.expect('second run wrote no audit rows', (SELECT count(*)::text FROM public.audit_logs), :'audit_first');
SELECT pg_temp.expect('a replay with a different hash is refused',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_a', :'ops', :'hash1')), 'err:PT409');
SELECT pg_temp.expect('a provisioned request cannot be edited',
  pg_temp.svc(format($q$SELECT count(*) FROM public.onboarding_review_set_plan(%L, %L, 'generated', %L::jsonb, 'g1', 2)$q$, :'req_a', :'onb', :'plan')), 'err:PT409');

\echo == a failure midway leaves no rows anywhere ==
SELECT pg_temp.expect('request B plan stored',
  pg_temp.svc(format($q$SELECT plan_revision::text FROM public.onboarding_review_set_plan(%L, %L, 'generated', %L::jsonb, 'g1', 0)$q$, :'req_b', :'onb', :'plan')), '1');
SELECT plan_hash AS hash_b FROM public.onboarding_requests WHERE id = :'req_b' \gset
SELECT pg_temp.expect('request B approved',
  pg_temp.svc(format($q$SELECT replay::text FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_b', :'ops', :'hash_b')), 'false');
SELECT pg_temp.footprint() AS before_fail \gset
SELECT count(*) AS audit_before_fail FROM public.audit_logs \gset
SELECT count(*) AS events_before_fail FROM public.role_assignment_audit_events \gset
-- Injected failure after the root, kernel, console, profile, units and pack are written.
CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure' USING ERRCODE = 'XX001'; END $$;
CREATE TRIGGER m6_test_boom BEFORE INSERT ON public.organization_invitations FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
SELECT pg_temp.expect('the injected failure surfaces',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_b', :'ops', :'hash_b')), 'err:XX001');
DROP TRIGGER m6_test_boom ON public.organization_invitations;
SELECT pg_temp.expect('no rows in any provisioning table', pg_temp.footprint(), :'before_fail');
SELECT pg_temp.expect('no audit rows kept', (SELECT count(*)::text FROM public.audit_logs), :'audit_before_fail');
SELECT pg_temp.expect('no unit audit events kept', (SELECT count(*)::text FROM public.role_assignment_audit_events), :'events_before_fail');
SELECT pg_temp.expect('request B is still approved, not provisioned', (SELECT status || '/' || (provisioned_org_id IS NULL)::text FROM public.onboarding_requests WHERE id = :'req_b'), 'approved/true');
-- A website draft the validator rejects fails late (after every other write): still nothing kept.
SELECT pg_temp.expect('an invalid website draft rolls everything back',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L, '{"schema": 2}'::jsonb)::text$q$, :'req_b', :'ops', :'hash_b')), 'err:22023');
SELECT pg_temp.expect('still no rows', pg_temp.footprint(), :'before_fail');
-- An unpublished pack is refused by the pack engine, again with nothing kept.
SELECT pg_temp.expect('a placeholder plan stored',
  pg_temp.svc(format($q$SELECT plan_revision::text FROM public.onboarding_review_set_plan(%L, %L, 'edited', jsonb_set(%L::jsonb, '{rolePack,version}', '"0.1.0"'), NULL, 1)$q$, :'req_b', :'onb', :'plan')), '2');
SELECT plan_hash AS hash_b2 FROM public.onboarding_requests WHERE id = :'req_b' \gset
SELECT pg_temp.expect('the edit withdrew the earlier approval', (SELECT status || '/' || (approved_by IS NULL)::text FROM public.onboarding_requests WHERE id = :'req_b'), 'under_review/true');
SELECT pg_temp.expect('approved by a manager who did not edit it',
  pg_temp.svc(format($q$SELECT replay::text FROM public.onboarding_review_approve(%L, %L, %L, true)$q$, :'req_b', :'ops', :'hash_b2')), 'false');
SELECT pg_temp.expect('an unpublished pack is refused',
  pg_temp.svc(format($q$SELECT public.onboarding_provision_from_plan(%L, %L, %L)::text$q$, :'req_b', :'ops', :'hash_b2')), 'err:42501');
SELECT pg_temp.expect('nothing kept after the pack refusal', pg_temp.footprint(), :'before_fail');
SELECT pg_temp.expect('no root gaps', (SELECT count(*)::text FROM public.organization_root_gaps()), '0');

\echo == the self-serve flag is off and locked ==
SELECT pg_temp.expect('flag seeded off and locked', (SELECT enabled::text || '/' || locked::text FROM public.feature_flags WHERE key = 'self_serve_provisioning'), 'false/true');
SELECT pg_temp.expect('the service role cannot switch it on',
  pg_temp.svc($q$UPDATE public.feature_flags SET enabled = true WHERE key = 'self_serve_provisioning' RETURNING 1$q$), 'err:42501');
SELECT pg_temp.expect('a second migration run kept one flag row', (SELECT count(*)::text FROM public.feature_flags WHERE key = 'self_serve_provisioning'), '1');

\echo == privileges ==
SELECT pg_temp.expect('authenticated has no EXECUTE on provisioning',
  has_function_privilege('authenticated', 'public.onboarding_provision_from_plan(uuid,uuid,text,jsonb,text)', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('anon has no EXECUTE on approval',
  has_function_privilege('anon', 'public.onboarding_review_approve(uuid,uuid,text,boolean)', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('invitations force RLS', (SELECT relforcerowsecurity::text FROM pg_class WHERE oid = 'public.organization_invitations'::regclass), 'true');
SELECT pg_temp.expect('every new function pins search_path', (SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'onboarding\_%' AND proname IN
  ('onboarding_m6_caller_is_service', 'onboarding_m6_actor_can', 'onboarding_m6_require', 'onboarding_m6_plan_hash', 'onboarding_m6_audit',
   'onboarding_m6_slug', 'onboarding_review_assign', 'onboarding_review_set_plan', 'onboarding_review_approve', 'onboarding_provision_from_plan')
  AND NOT (proconfig @> ARRAY['search_path=""'])), '0');

\echo == rollback ==
\i database/supabase/rollbacks/20261117003100_sherivs_m6_onboarding_provisioning.sql
SELECT pg_temp.expect('functions removed', (SELECT count(*)::text FROM pg_proc WHERE proname IN ('onboarding_provision_from_plan', 'onboarding_review_approve', 'onboarding_m6_require')), '0');
SELECT pg_temp.expect('invitation table removed', (to_regclass('public.organization_invitations') IS NULL)::text, 'true');
SELECT pg_temp.expect('request review columns removed', (SELECT count(*)::text FROM information_schema.columns WHERE table_name = 'onboarding_requests' AND column_name IN ('review_plan', 'plan_hash', 'approved_by')), '0');
SELECT pg_temp.expect('session link removed', (SELECT count(*)::text FROM information_schema.columns WHERE table_name = 'onboarding_sessions' AND column_name = 'onboarding_request_id'), '0');
SELECT pg_temp.expect('flag removed', (SELECT count(*)::text FROM public.feature_flags WHERE key = 'self_serve_provisioning'), '0');
SELECT pg_temp.expect('provisioned organization kept intact', (SELECT count(*)::text FROM public.organization_root_gaps()), '0');
\i database/supabase/migrations/20261117003100_sherivs_m6_onboarding_provisioning.sql
SELECT pg_temp.expect('re-apply after rollback works', (to_regprocedure('public.onboarding_provision_from_plan(uuid,uuid,text,jsonb,text)') IS NOT NULL)::text, 'true');
\echo == M6 SQL proof complete ==
