-- Disposable proof for database/supabase/migrations/20261117003000_sherivs_m4_role_builder.sql
-- (M4, ADR-116). It builds a small production-shaped fixture (the M2 part B fixture of
-- tests/sql/m2-role-pack-engine.sql, then the 017 / M009-A1 tables the builder writes to, with the
-- M009 audit trigger and the delegate RPC verbatim), applies 20261117001100 and this migration, and
-- proves the custom role story (admin A drafts, admin B approves, a holder's role carries exactly the
-- three configured navigation sections), the refusals, the delegation bounds, cross-organization
-- isolation, audit, a second run and the rollback.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m4_test -v ON_ERROR_STOP=1 -f tests/sql/m4-role-builder.sql
\set ON_ERROR_STOP on
SET client_min_messages = warning;
\pset tuples_only on
\pset format unaligned
\echo == setup: roles, auth helpers and production-shaped fixture ==

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;

CREATE TABLE public.schools (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid REFERENCES public.schools(id), role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.organization_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  school_id uuid NOT NULL, role text NOT NULL, is_primary boolean NOT NULL DEFAULT true, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, user_id uuid, action text NOT NULL,
  table_name text, record_id uuid, old_value jsonb, new_value jsonb, ip_address text, created_at timestamptz DEFAULT now());

CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT COALESCE((SELECT m.school_id FROM public.organization_memberships m WHERE m.user_id = u.id AND m.is_active
                    ORDER BY m.is_primary DESC, m.created_at ASC LIMIT 1), u.school_id)
    FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true $$;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.role FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT false $$;
-- SHERIVS-016 verbatim.
CREATE OR REPLACE FUNCTION public.can_administer_org(p_org uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN
    RETURN coalesce(auth.role(), '') = '' AND session_user NOT IN ('authenticator', 'anon', 'authenticated');
  END IF;
  IF coalesce(public.is_super_admin(), false) THEN RETURN true; END IF;
  RETURN public.get_my_school_id() = p_org AND public.get_my_role() IN ('admin', 'principal');
END
$$;
REVOKE ALL ON FUNCTION public.can_administer_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_administer_org(uuid) TO authenticated, service_role;
-- SHERIVS-018 verbatim.
CREATE OR REPLACE FUNCTION public.scholar_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_id uuid; v_actor uuid := auth.uid(); j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  v_org := coalesce((j->>'school_id')::uuid, (j->>'org_id')::uuid);
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_org) THEN RETURN NULL; END IF;
  BEGIN v_id := (j->>'id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (v_org, CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
          'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) || jsonb_build_object('actor', v_actor) END);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.scholar_audit() FROM PUBLIC, anon, authenticated;

-- SHERIVS-017 catalogue tables (same columns as production, read-only to API roles).
CREATE TABLE public.permission_catalog (code text PRIMARY KEY, module text NOT NULL, label text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('public','internal','confidential','restricted')), protected boolean NOT NULL DEFAULT false);
CREATE TABLE public.role_guardrail_catalog (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE public.role_templates (code text PRIMARY KEY,
  default_scope text NOT NULL CHECK (default_scope IN ('org','campus','faculty','department','class','self')),
  data_sensitivity text NOT NULL, approval_limit_ngn numeric(14,2), guardrails text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.role_template_permissions (template_code text NOT NULL REFERENCES public.role_templates(code),
  permission_code text NOT NULL REFERENCES public.permission_catalog(code), kind text NOT NULL CHECK (kind IN ('mandatory','optional')),
  default_on boolean NOT NULL DEFAULT true, PRIMARY KEY (template_code, permission_code));
CREATE TABLE public.sod_permission_rules (permission_a text NOT NULL REFERENCES public.permission_catalog(code),
  permission_b text NOT NULL REFERENCES public.permission_catalog(code), description text NOT NULL, PRIMARY KEY (permission_a, permission_b));
GRANT SELECT ON public.permission_catalog, public.role_guardrail_catalog, public.role_templates, public.role_template_permissions,
  public.sod_permission_rules TO authenticated, service_role;

-- ENGINE-01 pack registry and guard, verbatim.
CREATE TABLE public.cg_role_pack (
  code           text NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  version        text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  kind           text NOT NULL CHECK (kind IN ('tenant_role', 'platform_role')),
  applies_to     text[] NOT NULL CHECK (cardinality(applies_to) BETWEEN 1 AND 16),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  definition     jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  definition_digest text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  published_at   timestamptz,
  PRIMARY KEY (code, version)
);
-- Placeholder body: the migration replaces it with the ENGINE-01 body (plus the institution ceiling)
-- and the rollback restores the ENGINE-01 body verbatim; both are exercised below.
CREATE FUNCTION public.cg_role_pack_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER cg_role_pack_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.cg_role_pack
  FOR EACH ROW EXECUTE FUNCTION public.cg_role_pack_guard();
ALTER TABLE public.cg_role_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_role_pack FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cg_role_pack FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cg_role_pack TO service_role;

-- Fixture rows -------------------------------------------------------------------------------
INSERT INTO public.schools VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'), ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
INSERT INTO public.users (id, school_id, role) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001', 'staff'),
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'admin');
INSERT INTO public.permission_catalog VALUES
  ('fees.view','fees','View fees','internal',false), ('fees.collect','fees','Collect fees','confidential',false),
  ('payments.record_cash','payments','Record cash','confidential',false), ('payments.reconcile','payments','Reconcile','confidential',false),
  ('payroll.approve','payroll','Approve payroll','restricted',true), ('reports.view','reports','View reports','internal',false),
  ('expenses.create','expenses','Raise expense','internal',false), ('expenses.approve','expenses','Approve expense','confidential',false);
INSERT INTO public.role_guardrail_catalog VALUES ('tenant_isolation','RLS'), ('audited','Audit chain');
INSERT INTO public.role_templates VALUES
  ('bursar_t','org','confidential',500000,ARRAY['tenant_isolation','audited']),
  ('clerk_t','department','internal',NULL,ARRAY['tenant_isolation']),
  ('auditor_t','org','confidential',NULL,ARRAY['tenant_isolation','audited']);
INSERT INTO public.role_template_permissions VALUES
  ('bursar_t','fees.view','mandatory',true), ('bursar_t','payments.record_cash','mandatory',true),
  ('bursar_t','reports.view','optional',false), ('clerk_t','reports.view','mandatory',true), ('auditor_t','reports.view','mandatory',true);
INSERT INTO public.sod_permission_rules VALUES
  ('payments.record_cash','payments.reconcile','Cash recorded by a person is reconciled by someone else'),
  ('expenses.create','expenses.approve','Raiser and approver must differ');

-- Test helpers ------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs p_sql as p_role with JWT claims; returns 'ok' or the SQLSTATE of the refusal.
CREATE FUNCTION pg_temp.try(p_role text, p_claims jsonb, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := 'ok';
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'P0000', MESSAGE = 'rollback-probe';
  EXCEPTION WHEN OTHERS THEN
    r := CASE WHEN SQLERRM = 'rollback-probe' THEN 'ok' ELSE SQLSTATE END;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $$;
-- Like try, but keeps the effects.
CREATE FUNCTION pg_temp.run(p_role text, p_claims jsonb, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.u(p_id text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('sub', p_id, 'role', 'authenticated') $$;
CREATE FUNCTION pg_temp.svc() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"role":"service_role"}'::jsonb $$;
CREATE FUNCTION pg_temp.def(p_code text, p_version text, p_kind text, p_caps jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schema','sherivs.role-pack.v1','code',p_code,'version',p_version,'kind',p_kind,
    'startsInShadow',true,'memory',jsonb_build_object('crossTenant',false),'capabilities',p_caps) $$;
-- Returns the refusal message (or 'ok'), so explanations can be asserted.
CREATE FUNCTION pg_temp.err(p_role text, p_claims jsonb, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := 'ok';
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'P0000', MESSAGE = 'rollback-probe';
  EXCEPTION WHEN OTHERS THEN
    r := CASE WHEN SQLERRM = 'rollback-probe' THEN 'ok' ELSE SQLERRM END;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $$;

\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000001'''

\echo == apply the M2 part B dependency (20261117001100) ==
\i database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql

\echo == M009-A1 / 017 shaped tables the builder writes to ==
ALTER TABLE public.users ADD COLUMN full_name text;
UPDATE public.users SET full_name = 'Person ' || right(id::text, 2);
INSERT INTO public.users (id, school_id, role, full_name) VALUES
  ('a0000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001', 'staff', 'Person a4');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, school_id, role FROM public.users;
INSERT INTO public.permission_catalog VALUES ('roles.assign','governance','Assign roles','restricted',true);

CREATE TABLE public.role_catalog (
  code text PRIMARY KEY, name text NOT NULL, category text NOT NULL,
  template_code text NOT NULL REFERENCES public.role_templates(code),
  institution_types text[] NOT NULL DEFAULT '{}',
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  base_role_code text REFERENCES public.role_catalog(code), description text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((org_id IS NULL AND base_role_code IS NULL) OR (org_id IS NOT NULL AND base_role_code IS NOT NULL)));
INSERT INTO public.role_catalog (code, name, category, template_code, institution_types) VALUES
  ('sys.bursar', 'Bursar', 'Finance', 'bursar_t', ARRAY['secondary']),
  ('sys.clerk', 'Clerk', 'Administration', 'clerk_t', ARRAY['secondary']);
CREATE TABLE public.org_role_permission_settings (
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code), enabled boolean NOT NULL,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (org_id, role_code, permission_code));
CREATE TABLE public.org_role_custom_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code) ON DELETE CASCADE,
  permission_code text REFERENCES public.permission_catalog(code), custom_key text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (permission_code IS NOT NULL OR custom_key IS NOT NULL));
-- 017 guard, verbatim.
CREATE OR REPLACE FUNCTION public.org_role_custom_grants_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.permission_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.permission_catalog p WHERE p.code = NEW.permission_code AND p.protected) THEN
    RAISE EXCEPTION 'protected permission % can only be held through a catalog role that carries it', NEW.permission_code USING ERRCODE = '42501'; END IF;
  IF NEW.custom_key IS NOT NULL AND NEW.custom_key !~ '^custom\.[a-z0-9_.-]{2,60}$' THEN
    RAISE EXCEPTION 'custom permission keys must look like custom.<name>' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.role_catalog r WHERE r.code = NEW.role_code AND r.org_id IS NOT NULL AND r.org_id <> NEW.org_id) THEN
    RAISE EXCEPTION 'custom role belongs to another organisation' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_org_role_custom_grants_guard BEFORE INSERT OR UPDATE ON public.org_role_custom_grants FOR EACH ROW EXECUTE FUNCTION public.org_role_custom_grants_guard();
CREATE TABLE public.user_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code),
  scope_type text NOT NULL DEFAULT 'org', scope_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  assigned_by uuid, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, ended_by uuid,
  valid_until timestamptz, acting boolean NOT NULL DEFAULT false, temporary boolean NOT NULL DEFAULT false,
  evidence text[] NOT NULL DEFAULT '{}', restrictions text[] NOT NULL DEFAULT '{}',
  CHECK (valid_until IS NULL OR valid_until > started_at));
CREATE TABLE public.workspace_responsibility_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 120),
  kind text NOT NULL CHECK (kind IN ('core','add_on','custom')),
  daily_priority integer NOT NULL CHECK (daily_priority BETWEEN 0 AND 10000),
  primary_nav_id text NOT NULL CHECK (primary_nav_id ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  primary_nav_label text NOT NULL CHECK (length(btrim(primary_nav_label)) BETWEEN 2 AND 120),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'custom') = (org_id IS NOT NULL)));
CREATE UNIQUE INDEX workspace_responsibility_catalog_scope_code
  ON public.workspace_responsibility_catalog (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
CREATE TABLE public.workspace_role_responsibilities (
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code) ON DELETE CASCADE,
  responsibility_id uuid NOT NULL REFERENCES public.workspace_responsibility_catalog(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role_code, responsibility_id));
CREATE TABLE public.workspace_responsibility_permissions (
  responsibility_id uuid NOT NULL REFERENCES public.workspace_responsibility_catalog(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (responsibility_id, permission_code));
CREATE TABLE public.role_assignment_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.user_role_assignments(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.users(id), revoked_at timestamptz,
  CHECK (valid_until > valid_from), CHECK (delegate_user_id <> created_by));
CREATE TABLE public.role_assignment_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, actor_user_id uuid NOT NULL,
  target_user_id uuid, assignment_id uuid, target_type text NOT NULL, target_id text,
  action text NOT NULL CHECK (action IN ('insert','update','delete')), scope_type text, scope_ref text,
  before_state jsonb, after_state jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['role_catalog','org_role_permission_settings','org_role_custom_grants','user_role_assignments',
    'workspace_responsibility_catalog','workspace_role_responsibilities','workspace_responsibility_permissions',
    'role_assignment_delegations','role_assignment_audit_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
CREATE POLICY read_all ON public.role_catalog FOR SELECT TO authenticated USING (org_id IS NULL OR org_id = public.get_my_school_id());
CREATE POLICY own_or_admin ON public.role_assignment_delegations FOR SELECT TO authenticated
  USING (delegate_user_id = auth.uid() OR public.can_administer_org(org_id));
-- M009-A1 helpers, verbatim.
CREATE OR REPLACE FUNCTION public.workspace_role_engine_tenant_lock(p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'role mutation requires tenant scope' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('m009-role-engine:' || p_org::text, 0));
END $$;
-- 017 can_manage_roles with has_permission reduced to "no extra role grants" (administrators only).
CREATE OR REPLACE FUNCTION public.can_manage_roles(p_org uuid, p_perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.can_administer_org(p_org);
$$;
CREATE OR REPLACE FUNCTION public.workspace_responsibility_permission_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permission_catalog WHERE code = NEW.permission_code AND protected) THEN
    RAISE EXCEPTION 'protected permission % cannot be granted by a responsibility', NEW.permission_code
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_responsibility_permission_guard
  BEFORE INSERT OR UPDATE ON public.workspace_responsibility_permissions
  FOR EACH ROW EXECUTE FUNCTION public.workspace_responsibility_permission_guard();
CREATE OR REPLACE FUNCTION public.workspace_role_engine_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  j jsonb; v_old jsonb; v_new jsonb; v_org uuid; v_actor uuid := auth.uid(); v_target uuid; v_assignment uuid;
  v_scope_type text; v_scope_ref text; v_target_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN j := to_jsonb(OLD); v_old := j; ELSE j := to_jsonb(NEW); v_new := j; END IF;
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP = 'DELETE' THEN j := to_jsonb(OLD); END IF;
  v_org := coalesce(nullif(j->>'org_id','')::uuid, nullif(j->>'school_id','')::uuid);
  IF v_org IS NULL AND TG_TABLE_NAME = 'workspace_responsibility_permissions' THEN
    SELECT org_id INTO v_org FROM public.workspace_responsibility_catalog WHERE id = nullif(j->>'responsibility_id','')::uuid;
  END IF;
  IF v_org IS NULL THEN RETURN NULL; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'role mutation audit requires an authenticated actor' USING ERRCODE = '42501';
  END IF;
  v_target := nullif(coalesce(j->>'user_id', j->>'delegate_user_id'), '')::uuid;
  v_assignment := nullif(coalesce(j->>'assignment_id', CASE WHEN TG_TABLE_NAME = 'user_role_assignments' THEN j->>'id' END), '')::uuid;
  IF v_target IS NULL AND v_assignment IS NOT NULL THEN
    SELECT user_id INTO v_target FROM public.user_role_assignments WHERE id = v_assignment;
  END IF;
  v_scope_type := j->>'scope_type'; v_scope_ref := j->>'scope_ref';
  IF v_scope_type IS NULL AND v_assignment IS NOT NULL THEN
    SELECT scope_type, scope_ref INTO v_scope_type, v_scope_ref FROM public.user_role_assignments WHERE id = v_assignment;
  END IF;
  v_target_id := coalesce(j->>'id', j->>'responsibility_id', j->>'role_code', j->>'permission_code', j->>'code');
  INSERT INTO public.role_assignment_audit_events (org_id, actor_user_id, target_user_id, assignment_id, target_type, target_id,
    action, scope_type, scope_ref, before_state, after_state)
  VALUES (v_org, v_actor, v_target, v_assignment, TG_TABLE_NAME, v_target_id, lower(TG_OP), v_scope_type, v_scope_ref, v_old, v_new);
  RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workspace_responsibility_catalog','workspace_role_responsibilities',
    'workspace_responsibility_permissions','role_assignment_delegations','user_role_assignments','role_catalog',
    'org_role_permission_settings','org_role_custom_grants'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.workspace_role_engine_audit()', 'trg_' || t || '_m009_audit', t);
  END LOOP;
END $$;
-- M009-A1 delegate RPC, verbatim.
CREATE OR REPLACE FUNCTION public.workspace_role_delegate(
  p_assignment uuid, p_delegate_user uuid, p_valid_from timestamptz, p_valid_until timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_assignment public.user_role_assignments%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_assignment FROM public.user_role_assignments WHERE id = p_assignment AND status = 'active';
  IF v_assignment.id IS NULL OR auth.uid() IS NULL OR NOT public.can_manage_roles(v_assignment.org_id, 'roles.assign') THEN
    RAISE EXCEPTION 'roles.assign required' USING ERRCODE = '42501';
  END IF;
  IF p_delegate_user = v_assignment.user_id OR p_delegate_user = auth.uid() THEN
    RAISE EXCEPTION 'delegation target must be another organisation member' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m JOIN public.users u ON u.id = m.user_id
     WHERE m.user_id = p_delegate_user AND m.school_id = v_assignment.org_id AND m.is_active AND u.is_active IS TRUE) THEN
    RAISE EXCEPTION 'delegation target is not a tenant member' USING ERRCODE = '42501';
  END IF;
  IF p_valid_from < v_assignment.started_at
     OR (v_assignment.valid_until IS NOT NULL AND p_valid_until > v_assignment.valid_until)
     OR p_valid_until <= p_valid_from THEN
    RAISE EXCEPTION 'delegation dates exceed the source assignment' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.role_assignment_delegations (org_id, assignment_id, delegate_user_id, valid_from, valid_until, created_by)
  VALUES (v_assignment.org_id, v_assignment.id, p_delegate_user, p_valid_from, p_valid_until, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.workspace_role_delegate(uuid, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_school_id() TO authenticated;

\echo == apply migration (first run) ==
\i database/supabase/migrations/20261117003000_sherivs_m4_role_builder.sql

CREATE FUNCTION pg_temp.a1() RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.u('a0000000-0000-0000-0000-0000000000a1') $$;
CREATE FUNCTION pg_temp.a2() RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.u('a0000000-0000-0000-0000-0000000000a2') $$;
CREATE FUNCTION pg_temp.a3() RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.u('a0000000-0000-0000-0000-0000000000a3') $$;
CREATE FUNCTION pg_temp.a4() RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.u('a0000000-0000-0000-0000-0000000000a4') $$;
CREATE FUNCTION pg_temp.b1() RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.u('b0000000-0000-0000-0000-0000000000b1') $$;
CREATE FUNCTION pg_temp.draft(p_code text, p_perms text, p_layout text DEFAULT
  '{"nav":[{"id":"collections","label":"Collections"},{"id":"receipts","label":"Receipts"},{"id":"reports","label":"Reports"}],"widgets":["w.fee_collection"]}',
  p_base text DEFAULT 'bursar_t') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.custom_role_save_draft(%L, 'Fees desk', %L, %L::text[], '{}'::text[], 'org',
                  'administrative_operations', %L::jsonb)::text$q$, p_code, p_base, p_perms, p_layout) $$;

\echo == 1. drafts: admin only, protected refused, SoD blocked with an explanation, layout checked ==
SELECT pg_temp.expect('a non-admin member cannot draft', pg_temp.try('authenticated', pg_temp.a3(),
  pg_temp.draft('custom.fees_desk', '{fees.view}')), '42501');
SELECT pg_temp.expect('anon cannot draft', pg_temp.try('anon', NULL, pg_temp.draft('custom.fees_desk', '{fees.view}')), '42501');
SELECT pg_temp.expect('a protected permission is refused', pg_temp.try('authenticated', pg_temp.a1(),
  pg_temp.draft('custom.fees_desk', '{fees.view,payroll.approve}')), '42501');
SELECT pg_temp.expect('a SoD-violating draft is blocked with the rule as explanation', pg_temp.err('authenticated', pg_temp.a1(),
  pg_temp.draft('custom.fees_desk', '{fees.view,payments.reconcile}')),
  'separation of duties: payments.record_cash + payments.reconcile: Cash recorded by a person is reconciled by someone else');
SELECT pg_temp.expect('four navigation sections are refused', pg_temp.try('authenticated', pg_temp.a1(),
  pg_temp.draft('custom.fees_desk', '{fees.view}', '{"nav":[{"id":"a1","label":"Aa"},{"id":"b1","label":"Bb"},{"id":"c1","label":"Cc"},{"id":"d1","label":"Dd"}]}')), '22023');
SELECT pg_temp.expect('duplicate navigation ids are refused', pg_temp.try('authenticated', pg_temp.a1(),
  pg_temp.draft('custom.fees_desk', '{fees.view}', '{"nav":[{"id":"a1","label":"Aa"},{"id":"a1","label":"Bb"}]}')), '22023');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.draft('custom.fees_desk', '{fees.view,payments.record_cash,fees.collect}'));
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.draft('custom.fees_desk', '{fees.view,payments.record_cash,fees.collect,reports.view}'));
SELECT pg_temp.expect('saving again edits the same draft',
  (SELECT count(*) || '/' || max(version) || '/' || max(array_length(permissions, 1)) FROM public.org_custom_roles WHERE code = 'custom.fees_desk'), '1/1/4');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.draft('custom.two_nav', '{reports.view}',
  '{"nav":[{"id":"a1","label":"Aa"},{"id":"b1","label":"Bb"}]}', 'auditor_t'));
SELECT pg_temp.expect('submitting with two navigation sections is refused', pg_temp.try('authenticated', pg_temp.a1(),
  format($q$SELECT public.custom_role_submit(%L::uuid)$q$, (SELECT id FROM public.org_custom_roles WHERE code = 'custom.two_nav'))), '22023');

\echo == 2. submit, withdraw, four-eyes approval ==
CREATE FUNCTION pg_temp.on_desk(p_fn text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.%s(%L::uuid)::text$q$, p_fn,
    (SELECT id FROM public.org_custom_roles WHERE code = 'custom.fees_desk' AND org_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      ORDER BY version DESC LIMIT 1)) $$;
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.on_desk('custom_role_submit'));
SELECT pg_temp.expect('editing while pending is refused', pg_temp.try('authenticated', pg_temp.a1(),
  pg_temp.draft('custom.fees_desk', '{fees.view}')), '55000');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.on_desk('custom_role_withdraw'));
SELECT pg_temp.expect('withdraw returns to draft', (SELECT status FROM public.org_custom_roles WHERE code = 'custom.fees_desk'), 'draft');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.on_desk('custom_role_submit'));
SELECT pg_temp.expect('the creator cannot approve', pg_temp.err('authenticated', pg_temp.a1(), pg_temp.on_desk('custom_role_approve')),
  'four-eyes: a custom role is activated by a second administrator, not its creator');
SELECT pg_temp.expect('a non-admin cannot approve', pg_temp.try('authenticated', pg_temp.a3(), pg_temp.on_desk('custom_role_approve')), '42501');
SELECT pg_temp.expect('an admin of another organization cannot approve', pg_temp.try('authenticated', pg_temp.b1(),
  format($q$SELECT public.custom_role_approve(%L::uuid)$q$, (SELECT id FROM public.org_custom_roles WHERE code = 'custom.fees_desk'))), '42704');
SELECT pg_temp.expect('the guard still refuses a direct self-approval', pg_temp.try('postgres', pg_temp.a1(),
  $q$UPDATE public.org_custom_roles SET status = 'active', approved_by = created_by WHERE code = 'custom.fees_desk'$q$), '42501');
SELECT pg_temp.expect('activating before approval is refused', pg_temp.try('authenticated', pg_temp.a2(), pg_temp.on_desk('custom_role_activate')), '55000');
SELECT pg_temp.run('authenticated', pg_temp.a2(), pg_temp.on_desk('custom_role_approve'));
SELECT pg_temp.expect('a second administrator approved',
  (SELECT status || '/' || (approved_by = 'a0000000-0000-0000-0000-0000000000a2')::text || '/' || (approved_at IS NOT NULL)::text
     FROM public.org_custom_roles WHERE code = 'custom.fees_desk'), 'active/true/true');

\echo == 3. activation materialises the role; a holder gets exactly the three sections ==
SELECT pg_temp.expect('activation returns the assignable code', pg_temp.run('authenticated', pg_temp.a2(), pg_temp.on_desk('custom_role_activate')),
  'custom.aaaaaaaa000000000000000000000001.fees_desk');
\set R '''custom.aaaaaaaa000000000000000000000001.fees_desk'''
SELECT pg_temp.expect('catalogue role created from the base template',
  (SELECT template_code || '/' || base_role_code || '/' || org_id::text FROM public.role_catalog WHERE code = :R),
  'bursar_t/sys.bursar/aaaaaaaa-0000-0000-0000-000000000001');
SELECT pg_temp.expect('optional permission switched on as drafted',
  (SELECT enabled::text FROM public.org_role_permission_settings WHERE role_code = :R AND permission_code = 'reports.view'), 'true');
SELECT pg_temp.expect('a permission outside the template becomes a custom grant',
  (SELECT string_agg(permission_code, ',') FROM public.org_role_custom_grants WHERE role_code = :R), 'fees.collect');
SELECT pg_temp.run('authenticated', pg_temp.a2(), pg_temp.on_desk('custom_role_activate'));
SELECT pg_temp.expect('activation is idempotent',
  ((SELECT count(*) FROM public.org_role_custom_grants WHERE role_code = :R) || '/' ||
   (SELECT count(*) FROM public.workspace_role_responsibilities WHERE role_code = :R) || '/' ||
   (SELECT count(*) FROM public.role_catalog WHERE code = :R)), '1/3/1');
SELECT pg_temp.run('postgres', pg_temp.a1(), format($q$INSERT INTO public.user_role_assignments (org_id, user_id, role_code, assigned_by, started_at, valid_until)
  VALUES (%L, 'a0000000-0000-0000-0000-0000000000a3', %L, 'a0000000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() + interval '10 days')
  RETURNING id::text$q$, :A, :R));
SELECT pg_temp.expect('the holder''s role carries exactly the three configured sections, in order',
  (SELECT string_agg(r.primary_nav_id || ':' || r.primary_nav_label, ',' ORDER BY r.daily_priority)
     FROM public.user_role_assignments a
     JOIN public.workspace_role_responsibilities rr ON rr.org_id = a.org_id AND rr.role_code = a.role_code
     JOIN public.workspace_responsibility_catalog r ON r.id = rr.responsibility_id AND r.kind IN ('core','custom')
    WHERE a.user_id = 'a0000000-0000-0000-0000-0000000000a3' AND a.status = 'active'),
  'collections:Collections,receipts:Receipts,reports:Reports');

\echo == 4. versioning ==
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.draft('custom.fees_desk', '{fees.view,payments.record_cash}',
  '{"nav":[{"id":"collections","label":"Collections"},{"id":"receipts","label":"Receipts"},{"id":"exceptions","label":"Exceptions"}]}'));
SELECT pg_temp.expect('a change to an active role makes version 2',
  (SELECT string_agg(version || ':' || status, ',' ORDER BY version) FROM public.org_custom_roles WHERE code = 'custom.fees_desk'), '1:active,2:draft');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.on_desk('custom_role_submit'));
SELECT pg_temp.run('authenticated', pg_temp.a2(), pg_temp.on_desk('custom_role_approve'));
SELECT pg_temp.expect('approving version 2 retires version 1',
  (SELECT string_agg(version || ':' || status, ',' ORDER BY version) FROM public.org_custom_roles WHERE code = 'custom.fees_desk'), '1:retired,2:active');
SELECT pg_temp.run('authenticated', pg_temp.a2(), pg_temp.on_desk('custom_role_activate'));
SELECT pg_temp.expect('version 2 activation narrows grants and renames the third section',
  ((SELECT count(*) FROM public.org_role_custom_grants WHERE role_code = :R) || '/' ||
   (SELECT enabled::text FROM public.org_role_permission_settings WHERE role_code = :R AND permission_code = 'reports.view') || '/' ||
   (SELECT string_agg(r.primary_nav_id, ',' ORDER BY r.daily_priority) FROM public.workspace_role_responsibilities rr
      JOIN public.workspace_responsibility_catalog r ON r.id = rr.responsibility_id WHERE rr.role_code = :R)),
  '0/false/collections,receipts,exceptions');
SELECT pg_temp.expect('a holder of the role cannot approve or activate it', pg_temp.try('postgres', pg_temp.a2(),
  format($q$DO $d$ BEGIN PERFORM set_config('request.jwt.claims', %L, true);
     INSERT INTO public.user_role_assignments (org_id, user_id, role_code, assigned_by) VALUES (%L, 'a0000000-0000-0000-0000-0000000000a2', %L, 'a0000000-0000-0000-0000-0000000000a1');
     PERFORM set_config('request.jwt.claims', %L, true);
     PERFORM public.custom_role_activate((SELECT id FROM public.org_custom_roles WHERE code = 'custom.fees_desk' AND status = 'active'));
     END $d$$q$, pg_temp.a1()::text, :A, :R, pg_temp.a2()::text)), '42501');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.draft('custom.scratch', '{reports.view}',
  '{"nav":[{"id":"a1","label":"Aa"},{"id":"b1","label":"Bb"},{"id":"c1","label":"Cc"}]}', NULL));
SELECT pg_temp.run('authenticated', pg_temp.a1(), format($q$SELECT public.custom_role_submit(%L::uuid)::text$q$, (SELECT id FROM public.org_custom_roles WHERE code = 'custom.scratch')));
SELECT pg_temp.run('authenticated', pg_temp.a2(), format($q$SELECT public.custom_role_approve(%L::uuid)::text$q$, (SELECT id FROM public.org_custom_roles WHERE code = 'custom.scratch')));
SELECT pg_temp.expect('a role started from scratch is approved but cannot be made assignable', pg_temp.try('authenticated', pg_temp.a2(),
  format($q$SELECT public.custom_role_activate(%L::uuid)$q$, (SELECT id FROM public.org_custom_roles WHERE code = 'custom.scratch'))), '22023');

\echo == 5. cross-organization ==
SELECT pg_temp.run('authenticated', pg_temp.b1(), pg_temp.draft('custom.fees_desk', '{fees.view}'));
SELECT pg_temp.expect('the same code in B is a separate role',
  (SELECT count(DISTINCT org_id)::text FROM public.org_custom_roles WHERE code = 'custom.fees_desk'), '2');
SELECT pg_temp.expect('B cannot submit, withdraw or activate A''s rows', pg_temp.try('authenticated', pg_temp.b1(),
  format($q$SELECT public.custom_role_activate(%L::uuid)$q$, (SELECT id FROM public.org_custom_roles WHERE org_id = :A AND code = 'custom.fees_desk' AND status = 'active'))), '42704');
SELECT pg_temp.expect('B admin reads none of A''s custom roles', pg_temp.run('authenticated', pg_temp.b1(),
  format($q$SELECT count(*)::text FROM public.org_custom_roles WHERE org_id = %L::uuid$q$, :A)), '0');

\echo == 6. audit ==
SELECT pg_temp.expect('every custom role write is in audit_logs with its actor',
  (SELECT (count(*) >= 8 AND bool_and(new_value ? 'actor'))::text FROM public.audit_logs WHERE table_name = 'org_custom_roles'), 'true');
SELECT pg_temp.expect('activation writes M009 audit events with the approver as actor',
  (SELECT string_agg(DISTINCT target_type, ',' ORDER BY target_type) FROM public.role_assignment_audit_events
    WHERE actor_user_id = 'a0000000-0000-0000-0000-0000000000a2'),
  'org_role_custom_grants,org_role_permission_settings,role_catalog,workspace_responsibility_catalog,workspace_role_responsibilities');

\echo == 7. custom responsibility builder ==
CREATE FUNCTION pg_temp.resp(p_code text, p_perms text, p_cadence int DEFAULT 90) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.workspace_responsibility_define(%L, 'Duty master', 'Week duty', %L::text[],
    ARRAY['Duty rota signed'], %s, 100, 'duty', 'Duty')::text$q$, p_code, p_perms, p_cadence) $$;
SELECT pg_temp.expect('a non-admin cannot define a responsibility', pg_temp.try('authenticated', pg_temp.a3(), pg_temp.resp('duty_master', '{fees.view}')), '42501');
SELECT pg_temp.expect('a protected permission is refused', pg_temp.try('authenticated', pg_temp.a1(), pg_temp.resp('duty_master', '{payroll.approve}')), '42501');
SELECT pg_temp.expect('a SoD pair inside one responsibility is refused', pg_temp.try('authenticated', pg_temp.a1(),
  pg_temp.resp('duty_master', '{expenses.create,expenses.approve}')), '42501');
SELECT pg_temp.expect('a review cadence under a week is refused', pg_temp.try('authenticated', pg_temp.a1(), pg_temp.resp('duty_master', '{fees.view}', 3)), '23514');
SELECT pg_temp.expect('no permission is refused', pg_temp.try('authenticated', pg_temp.a1(), pg_temp.resp('duty_master', '{}')), '22023');
SELECT pg_temp.run('authenticated', pg_temp.a1(), pg_temp.resp('duty_master', '{fees.view,reports.view}'));
SELECT pg_temp.expect('responsibility stored with evidence and cadence in the caller''s organization',
  (SELECT org_id::text || '/' || kind || '/' || array_to_string(evidence_required, ';') || '/' || review_cadence_days
     FROM public.workspace_responsibility_catalog WHERE code = 'duty_master'),
  'aaaaaaaa-0000-0000-0000-000000000001/custom/Duty rota signed/90');
SELECT pg_temp.run('authenticated', pg_temp.b1(), pg_temp.resp('duty_master', '{fees.view}'));
SELECT pg_temp.expect('B defines its own, separately', (SELECT count(DISTINCT org_id)::text FROM public.workspace_responsibility_catalog WHERE code = 'duty_master'), '2');

\echo == 8. delegation bounds ==
\set S '''a0000000-0000-0000-0000-0000000000a3'''
CREATE FUNCTION pg_temp.src() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.user_role_assignments WHERE user_id = 'a0000000-0000-0000-0000-0000000000a3' AND status = 'active' $$;
SELECT pg_temp.expect('the delegate RPC refuses an end after the source', pg_temp.try('authenticated', pg_temp.a1(),
  format($q$SELECT public.workspace_role_delegate(%L, 'a0000000-0000-0000-0000-0000000000a4', now(), now() + interval '20 days')$q$, pg_temp.src())), '22023');
SELECT pg_temp.expect('a direct write that outlives the source is refused by the table guard', split_part(pg_temp.err('postgres', pg_temp.a1(),
  format($q$INSERT INTO public.role_assignment_delegations (org_id, assignment_id, delegate_user_id, valid_from, valid_until, created_by)
    VALUES (%L, %L, 'a0000000-0000-0000-0000-0000000000a4', now(), now() + interval '20 days', 'a0000000-0000-0000-0000-0000000000a1')$q$, :A, pg_temp.src())), ' (', 1),
  'a delegation cannot end after its source assignment');
SELECT pg_temp.expect('starting before the source is refused', pg_temp.try('postgres', pg_temp.a1(),
  format($q$INSERT INTO public.role_assignment_delegations (org_id, assignment_id, delegate_user_id, valid_from, valid_until, created_by)
    VALUES (%L, %L, 'a0000000-0000-0000-0000-0000000000a4', now() - interval '5 days', now() + interval '2 days', 'a0000000-0000-0000-0000-0000000000a1')$q$, :A, pg_temp.src())), '22023');
SELECT pg_temp.expect('a delegation into another organization is refused', pg_temp.try('postgres', pg_temp.b1(),
  format($q$INSERT INTO public.role_assignment_delegations (org_id, assignment_id, delegate_user_id, valid_from, valid_until, created_by)
    VALUES (%L, %L, 'b0000000-0000-0000-0000-0000000000b1', now(), now() + interval '2 days', 'a0000000-0000-0000-0000-0000000000a1')$q$, :B, pg_temp.src())), '42501');
SELECT pg_temp.run('authenticated', pg_temp.a1(),
  format($q$SELECT public.workspace_role_delegate(%L, 'a0000000-0000-0000-0000-0000000000a4', now(), now() + interval '8 days')::text$q$, pg_temp.src()));
SELECT pg_temp.expect('extending a delegation is refused', pg_temp.try('postgres', pg_temp.a1(),
  $q$UPDATE public.role_assignment_delegations SET valid_until = valid_until + interval '1 day'$q$), '42501');
SELECT pg_temp.expect('the delegate sees the acting banner context', pg_temp.run('authenticated', pg_temp.a4(),
  $q$SELECT string_agg(kind || ':' || role_name || ':' || holder_name, ',') FROM public.workspace_my_acting_context()$q$), 'delegated:Fees desk:Person a3');
SELECT pg_temp.expect('someone else sees no acting context', pg_temp.run('authenticated', pg_temp.a1(),
  $q$SELECT count(*)::text FROM public.workspace_my_acting_context()$q$), '0');
SELECT pg_temp.run('postgres', pg_temp.a1(), format($q$UPDATE public.user_role_assignments SET valid_until = now() + interval '5 days' WHERE id = %L RETURNING id::text$q$, pg_temp.src()));
SELECT pg_temp.expect('shortening the source trims the delegation',
  (SELECT (abs(extract(epoch FROM d.valid_until - a.valid_until)) < 1)::text FROM public.role_assignment_delegations d
     JOIN public.user_role_assignments a ON a.id = d.assignment_id WHERE d.revoked_at IS NULL), 'true');
SELECT pg_temp.run('postgres', pg_temp.a1(), format($q$UPDATE public.user_role_assignments SET status = 'ended', ended_at = now() WHERE id = %L RETURNING id::text$q$, pg_temp.src()));
SELECT pg_temp.expect('ending the source revokes the delegation, audited with the actor',
  (SELECT (revoked_at IS NOT NULL)::text || '/' || revoked_by::text FROM public.role_assignment_delegations), 'true/a0000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.expect('the banner context disappears with it', pg_temp.run('authenticated', pg_temp.a4(),
  $q$SELECT count(*)::text FROM public.workspace_my_acting_context()$q$), '0');

\echo == 9. privileges ==
SELECT pg_temp.expect('anon executes none of the M4 functions',
  (SELECT count(*) FROM pg_proc p WHERE (p.proname LIKE 'custom_role%' OR p.proname IN ('workspace_responsibility_define',
     'workspace_my_acting_context','role_assignment_delegation_bounds_guard','role_assignment_delegation_follow_source'))
     AND has_function_privilege('anon', p.oid, 'EXECUTE'))::text, '0');
SELECT pg_temp.expect('authenticated cannot call the internal helpers',
  (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('custom_role_layout_problem','custom_role_require_admin','custom_role_catalog_code',
     'role_assignment_delegation_bounds_guard','role_assignment_delegation_follow_source')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text, '0');
SELECT pg_temp.expect('every M4 function pins search_path',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     AND (p.proname LIKE 'custom_role%' OR p.proname IN ('workspace_responsibility_define','workspace_my_acting_context',
          'role_assignment_delegation_bounds_guard','role_assignment_delegation_follow_source'))
     AND NOT coalesce(p.proconfig @> ARRAY['search_path=""'], false))::text, '0');

\echo == 10. second run of the migration ==
\i database/supabase/migrations/20261117003000_sherivs_m4_role_builder.sql
SELECT pg_temp.expect('second run keeps the data and the guards',
  ((SELECT count(*) FROM public.org_custom_roles) || '/' || (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_role_assignment_delegation_bounds')), '5/1');

\echo == 11. rollback ==
\i database/supabase/rollbacks/20261117003000_sherivs_m4_role_builder.sql
SELECT pg_temp.expect('rollback removed every M4 function and trigger',
  ((SELECT count(*) FROM pg_proc WHERE proname LIKE 'custom_role%' OR proname IN ('workspace_responsibility_define',
      'workspace_my_acting_context','role_assignment_delegation_bounds_guard','role_assignment_delegation_follow_source'))
   + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_role_assignment_delegation_bounds','trg_user_role_assignments_delegation_follow')))::text, '0');
SELECT pg_temp.expect('rollback removed the responsibility columns',
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'workspace_responsibility_catalog'
     AND column_name IN ('description','evidence_required','review_cadence_days'))::text, '0');
SELECT pg_temp.expect('ADR-114 rows and audit survive the rollback',
  ((SELECT count(*) FROM public.org_custom_roles) || '/' || (SELECT (count(*) > 0)::text FROM public.audit_logs WHERE table_name = 'org_custom_roles')), '5/true');

\echo == 12. forward again after rollback ==
\i database/supabase/migrations/20261117003000_sherivs_m4_role_builder.sql
SELECT pg_temp.expect('re-applied cleanly', (SELECT count(*) FROM pg_proc WHERE proname LIKE 'custom_role%')::text, '8');
\echo == ALL M4 ROLE BUILDER CHECKS PASSED ==
