-- Disposable proof for database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql
-- (M2 part B, ADR-146). It builds a small production-shaped fixture (the ENGINE-01 pack registry
-- and its guard verbatim, the 017 catalogue tables, the 016/018 helpers, SEC-M0 private-by-default
-- privileges), applies the migration, proves the positive, negative and cross-organization cases,
-- runs the migration a second time, rolls it back and applies it again.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m2b_test -v ON_ERROR_STOP=1 -f tests/sql/m2-role-pack-engine.sql
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
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000001'''

\echo == apply migration (first run) ==
\i database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql

\echo == 1. pack registry widened; ENGINE-01 guards kept ==
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition, definition_digest) VALUES
  ('twin-x', '1.0.0', 'tenant_role', ARRAY['staff'], 'published', pg_temp.def('twin-x','1.0.0','tenant_role'), ''),
  ('inst-test', '1.0.0', 'institution_pack', ARRAY['inst'], 'draft', pg_temp.def('inst-test','1.0.0','institution_pack'), ''),
  ('inst-test', '2.0.0', 'institution_pack', ARRAY['inst'], 'draft', pg_temp.def('inst-test','2.0.0','institution_pack'), ''),
  ('inst-test', '3.0.0', 'institution_pack', ARRAY['inst'], 'draft', pg_temp.def('inst-test','3.0.0','institution_pack'), ''),
  ('inst-draft', '1.0.0', 'institution_pack', ARRAY['inst'], 'draft', pg_temp.def('inst-draft','1.0.0','institution_pack'), '');
SELECT pg_temp.expect('unknown kind refused', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.cg_role_pack (code, version, kind, applies_to, definition, definition_digest)
     VALUES ('bad-kind','1.0.0','bundle',ARRAY['x'],'{"schema":"sherivs.role-pack.v1","code":"bad-kind","version":"1.0.0","kind":"bundle","startsInShadow":true,"memory":{"crossTenant":false},"capabilities":[]}','')$q$), '23514');
SELECT pg_temp.expect('institution pack gets the tenant tier ceiling (T3 refused)', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.cg_role_pack (code, version, kind, applies_to, definition, definition_digest)
     VALUES ('inst-t3','1.0.0','institution_pack',ARRAY['x'],
             pg_temp.def('inst-t3','1.0.0','institution_pack','[{"id":"cap.x","tier":"T3","autonomy":"propose_only"}]'),'')$q$), 'P0001');
SELECT pg_temp.expect('shadow start still required', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.cg_role_pack (code, version, kind, applies_to, definition, definition_digest)
     VALUES ('inst-ns','1.0.0','institution_pack',ARRAY['x'], pg_temp.def('inst-ns','1.0.0','institution_pack') - 'startsInShadow','')$q$), 'P0001');
SELECT pg_temp.expect('digest still set by the guard',
  (SELECT definition_digest = encode(sha256(convert_to(definition::text,'UTF8')),'hex') FROM public.cg_role_pack WHERE code='inst-test' AND version='1.0.0')::text, 'true');

\echo == 2. pack items: guards ==
INSERT INTO public.role_pack_items (pack_code, pack_version, item_kind, item_ref, payload) VALUES
  ('inst-test','1.0.0','template','bursar_t','{"mandatory":["fees.view","payments.record_cash"],"optional":["reports.view","payments.reconcile","payroll.approve"],"guardrails":["tenant_isolation","audited"]}'),
  ('inst-test','1.0.0','template','clerk_t','{"mandatory":["reports.view"],"optional":["fees.view"]}'),
  ('inst-test','1.0.0','responsibility','collect_fees','{"permissions":["fees.collect"]}'),
  ('inst-test','1.0.0','responsibility','reconcile','{"permissions":["payments.reconcile"]}'),
  ('inst-test','1.0.0','layout','bursar_t','{"nav":["a","b","c"]}'),
  ('inst-test','2.0.0','template','bursar_t','{"mandatory":["fees.view","payments.record_cash"],"optional":["reports.view","fees.collect"]}'),
  ('inst-test','2.0.0','template','auditor_t','{"mandatory":["reports.view","payments.reconcile"]}'),
  ('inst-test','3.0.0','template','bursar_t','{"mandatory":["fees.view","payments.record_cash"]}'),
  ('inst-draft','1.0.0','template','clerk_t','{"mandatory":["reports.view"]}');
SELECT pg_temp.expect('pack template cannot drop a mandatory permission', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_items VALUES ('inst-draft','1.0.0','template','bursar_t','{"mandatory":["fees.view"]}')$q$), '42501');
SELECT pg_temp.expect('pack template cannot drop a guardrail', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_items VALUES ('inst-draft','1.0.0','template','bursar_t','{"mandatory":["fees.view","payments.record_cash"],"guardrails":["audited"]}')$q$), '42501');
SELECT pg_temp.expect('unknown permission refused', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_items VALUES ('inst-draft','1.0.0','responsibility','x1','{"permissions":["nope.nope"]}')$q$), '22023');
SELECT pg_temp.expect('unknown template refused', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_items VALUES ('inst-draft','1.0.0','template','ghost_t','{}')$q$), '22023');
SELECT pg_temp.expect('layout with four nav sections refused', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_items VALUES ('inst-draft','1.0.0','layout','clerk_t','{"nav":["a","b","c","d"]}')$q$), '22023');
SELECT pg_temp.expect('items only on draft institution packs (published twin pack)', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_items VALUES ('twin-x','1.0.0','seed','s1','{}')$q$), '23001');
SELECT pg_temp.expect('authenticated cannot write catalogue items', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  $q$INSERT INTO public.role_pack_items VALUES ('inst-draft','1.0.0','seed','s1','{}')$q$), '42501');

INSERT INTO public.role_pack_migrations (from_pack_code, from_version, to_version, steps)
  VALUES ('inst-test','1.0.0','2.0.0','[{"op":"retire_template","template":"clerk_t"}]');
SELECT pg_temp.expect('backward migration refused', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.role_pack_migrations VALUES ('inst-test','2.0.0','1.0.0','[]')$q$), '23514');
UPDATE public.cg_role_pack SET status = 'published' WHERE code = 'inst-test';

\echo == 3. items of a published pack are immutable ==
SELECT pg_temp.expect('insert into published pack refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$INSERT INTO public.role_pack_items VALUES ('inst-test','1.0.0','seed','s1','{}')$q$), '23001');
SELECT pg_temp.expect('update of published item refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.role_pack_items SET payload = '{}' WHERE pack_code = 'inst-test' AND item_ref = 'clerk_t'$q$), '23001');
SELECT pg_temp.expect('delete of published item refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$DELETE FROM public.role_pack_items WHERE pack_code = 'inst-test'$q$), '23001');
SELECT pg_temp.expect('truncate refused while a pack is published', pg_temp.try('postgres', NULL,
  $q$TRUNCATE public.role_pack_items$q$), '23001');
SELECT pg_temp.expect('migration to a published version immutable', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.role_pack_migrations SET steps = '[]'$q$), '23001');
SELECT pg_temp.expect('published pack definition still immutable', pg_temp.try('postgres', NULL,
  $q$UPDATE public.cg_role_pack SET definition = definition || '{"x":1}' WHERE code = 'inst-test' AND version = '1.0.0'$q$), '23001');
SELECT pg_temp.expect('draft pack items still editable', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.role_pack_items SET payload = '{"mandatory":["reports.view"],"optional":["fees.view"]}' WHERE pack_code = 'inst-draft'$q$), 'ok');

\echo == 4. install ==
SELECT pg_temp.expect('install by the service', pg_temp.run('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '1.0.0')->>'outcome'$q$, :A)), 'installed');
SELECT pg_temp.expect('install is idempotent', pg_temp.run('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '1.0.0')->>'outcome'$q$, :A)), 'already_installed');
SELECT pg_temp.expect('one installation row after two installs',
  (SELECT count(*) FROM public.tenant_role_pack_installations WHERE org_id = :A)::text, '1');
SELECT pg_temp.expect('install audited once',
  (SELECT count(*) FROM public.audit_logs WHERE action = 'role_pack.install' AND school_id = :A)::text, '1');
SELECT pg_temp.expect('a non-published pack is refused', pg_temp.try('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-draft', '1.0.0')$q$, :B)), '42501');
SELECT pg_temp.expect('a twin ceiling pack is not an institution pack', pg_temp.try('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_install(%L::uuid, 'twin-x', '1.0.0')$q$, :B)), '22023');
SELECT pg_temp.expect('installing a second version is refused (use upgrade)', pg_temp.try('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '2.0.0')$q$, :A)), '55000');
SELECT pg_temp.expect('tenant admin of A cannot install for B (no privilege)', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '1.0.0')$q$, :B)), '42501');
SELECT pg_temp.expect('tenant user refused by the inner check too', pg_temp.try('postgres', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '1.0.0')$q$, :B)), '42501');
SELECT pg_temp.expect('anon cannot install', pg_temp.try('anon', NULL,
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '1.0.0')$q$, :B)), '42501');
SELECT pg_temp.expect('B has nothing installed after the refusals',
  (SELECT count(*) FROM public.tenant_role_pack_installations WHERE org_id = :B)::text, '0');
SELECT pg_temp.run('service_role', pg_temp.svc(), format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '1.0.0')::text$q$, :B));
SELECT pg_temp.expect('installations cannot be deleted', pg_temp.try('service_role', pg_temp.svc(),
  $q$DELETE FROM public.tenant_role_pack_installations$q$), '23001');

\echo == 5. overrides: only narrow, never remove a guardrail or SoD, never add a protected permission ==
CREATE FUNCTION pg_temp.ovr(p_tpl text, p_kind text, p_payload text, p_by text DEFAULT 'a0000000-0000-0000-0000-0000000000a1',
                            p_appr text DEFAULT 'a0000000-0000-0000-0000-0000000000a2', p_org text DEFAULT 'aaaaaaaa-0000-0000-0000-000000000001')
RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO public.tenant_role_overrides (org_id, template_code, override_kind, payload, created_by, approved_by)
                   VALUES (%L, %L, %L, %L, %L, %L)$q$, p_org, p_tpl, p_kind, p_payload, p_by, p_appr) $$;
SELECT pg_temp.expect('add a non-protected optional permission', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"reports.view"}')), 'ok');
SELECT pg_temp.expect('add a protected permission refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"payroll.approve"}')), '42501');
SELECT pg_temp.expect('add a permission that breaks SoD refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"payments.reconcile"}')), '42501');
SELECT pg_temp.expect('add a permission the template does not offer refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"expenses.approve"}')), '42501');
SELECT pg_temp.expect('remove a mandatory permission refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','remove_optional_permission','{"permission":"payments.record_cash"}')), '42501');
SELECT pg_temp.expect('remove an optional permission allowed', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','remove_optional_permission','{"permission":"reports.view"}')), 'ok');
SELECT pg_temp.expect('a guardrail key in the payload refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"reports.view","guardrails":[]}')), '42501');
SELECT pg_temp.expect('an SoD key in the payload refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','disable','{"sod_rules":[]}')), '42501');
SELECT pg_temp.expect('a remove_guardrail kind does not exist', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','remove_guardrail','{"guardrail":"audited"}')), '23514');
SELECT pg_temp.expect('a remove_sod kind does not exist', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','remove_sod_rule','{}')), '23514');
SELECT pg_temp.expect('scope narrowed', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','scope_narrow','{"scope":"campus"}')), 'ok');
SELECT pg_temp.expect('scope widened refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('clerk_t','scope_narrow','{"scope":"org"}')), '42501');
SELECT pg_temp.expect('approval limit lowered', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','approval_limit','{"limit_ngn":100000}')), 'ok');
SELECT pg_temp.expect('approval limit raised refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','approval_limit','{"limit_ngn":900000}')), '42501');
SELECT pg_temp.expect('approval limit on a template without approval authority refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('clerk_t','approval_limit','{"limit_ngn":1}')), '42501');
SELECT pg_temp.expect('responsibility that breaks SoD refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_responsibility','{"responsibility":"reconcile"}')), '42501');
SELECT pg_temp.expect('responsibility from the pack added', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_responsibility','{"responsibility":"collect_fees"}')), 'ok');
SELECT pg_temp.expect('template outside the installed pack refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('auditor_t','rename','{"name":"Inspector"}')), '42501');
SELECT pg_temp.expect('self-approved override refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','rename','{"name":"Cashier"}','a0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-0000000000a1')), '42501');
SELECT pg_temp.expect('approver from another organization refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','rename','{"name":"Cashier"}','a0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-0000000000b1')), '42501');
SELECT pg_temp.expect('tenant user cannot write overrides directly', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  pg_temp.ovr('bursar_t','rename','{"name":"Cashier"}', 'a0000000-0000-0000-0000-0000000000a1', NULL)), '42501');
-- Kept overrides: one pending rename on clerk_t (lost in 2.0.0), one approved add on bursar_t, one in B.
SELECT pg_temp.run('service_role', pg_temp.svc(), pg_temp.ovr('clerk_t','rename','{"name":"Records desk"}', 'a0000000-0000-0000-0000-0000000000a1', NULL) || ' RETURNING id::text');
SELECT pg_temp.run('service_role', pg_temp.svc(), pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"reports.view"}') || ' RETURNING id::text');
SELECT pg_temp.run('service_role', pg_temp.svc(), pg_temp.ovr('bursar_t','rename','{"name":"Finance desk"}', 'b0000000-0000-0000-0000-0000000000b1', NULL,
  'bbbbbbbb-0000-0000-0000-000000000001') || ' RETURNING id::text');
SELECT pg_temp.expect('later self-approval refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.tenant_role_overrides SET approved_by = created_by WHERE template_code = 'clerk_t'$q$), '42501');
SELECT pg_temp.expect('override payload immutable', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.tenant_role_overrides SET payload = '{"name":"x"}' WHERE template_code = 'clerk_t'$q$), '23001');
SELECT pg_temp.expect('an approval cannot be changed', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.tenant_role_overrides SET approved_by = 'a0000000-0000-0000-0000-0000000000a3' WHERE approved_by IS NOT NULL$q$), '23001');
SELECT pg_temp.expect('overrides cannot be deleted', pg_temp.try('service_role', pg_temp.svc(),
  $q$DELETE FROM public.tenant_role_overrides$q$), '23001');
SELECT pg_temp.expect('override writes are audited',
  (SELECT count(*) > 0 FROM public.audit_logs WHERE action = 'scholar.tenant_role_overrides.insert')::text, 'true');

\echo == 6. custom roles: four-eyes, no protected permission, no SoD violation ==
CREATE FUNCTION pg_temp.cr(p_code text, p_perms text, p_status text DEFAULT 'draft', p_base text DEFAULT NULL, p_scope text DEFAULT 'org',
                           p_org text DEFAULT 'aaaaaaaa-0000-0000-0000-000000000001', p_by text DEFAULT 'a0000000-0000-0000-0000-0000000000a1')
RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO public.org_custom_roles (org_id, code, name, base_template_code, permissions, scope_ceiling,
                     workspace_category, layout, status, created_by) VALUES (%L, %L, 'Custom desk', %L, %L::text[], %L, 'administrative_operations',
                     '{"nav":["a","b","c"]}', %L, %L)$q$, p_org, p_code, p_base, p_perms, p_scope, p_status, p_by) $$;
SELECT pg_temp.expect('protected permission refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.cr('custom.x1', '{fees.view,payroll.approve}')), '42501');
SELECT pg_temp.expect('unknown permission refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.cr('custom.x2', '{fees.view,ghost.perm}')), '22023');
SELECT pg_temp.expect('SoD-violating permission set refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.cr('custom.x3', '{expenses.create,expenses.approve}')), '42501');
SELECT pg_temp.expect('SoD with the base template mandatory set refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.cr('custom.x4', '{payments.reconcile}', 'draft', 'bursar_t')), '42501');
SELECT pg_temp.expect('scope wider than the base template refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.cr('custom.x5', '{reports.view}', 'draft', 'clerk_t', 'org')), '42501');
SELECT pg_temp.expect('created directly as active refused', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.cr('custom.x6', '{reports.view}', 'active')), '42501');
SELECT pg_temp.run('service_role', pg_temp.svc(), pg_temp.cr('custom.desk', '{fees.view,reports.view}') || ' RETURNING id::text');
SELECT pg_temp.run('service_role', pg_temp.svc(), pg_temp.cr('custom.bdesk', '{fees.view}', 'draft', NULL, 'org',
  'bbbbbbbb-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000b1') || ' RETURNING id::text');
UPDATE public.org_custom_roles SET status = 'pending_approval' WHERE code = 'custom.desk';
SELECT pg_temp.expect('activation without an approver refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.org_custom_roles SET status = 'active' WHERE code = 'custom.desk'$q$), '42501');
SELECT pg_temp.expect('self-approval refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.org_custom_roles SET status = 'active', approved_by = created_by WHERE code = 'custom.desk'$q$), '42501');
SELECT pg_temp.expect('approver from another organization refused', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.org_custom_roles SET status = 'active', approved_by = 'b0000000-0000-0000-0000-0000000000b1' WHERE code = 'custom.desk'$q$), '42501');
SELECT pg_temp.expect('approval by the caller only (JWT approver must be the caller)', pg_temp.try('postgres', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  $q$UPDATE public.org_custom_roles SET status = 'active', approved_by = 'a0000000-0000-0000-0000-0000000000a2' WHERE code = 'custom.desk'$q$), '42501');
SELECT pg_temp.expect('a second administrator activates', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.org_custom_roles SET status = 'active', approved_by = 'a0000000-0000-0000-0000-0000000000a2' WHERE code = 'custom.desk'$q$), 'ok');
UPDATE public.org_custom_roles SET status = 'active', approved_by = 'a0000000-0000-0000-0000-0000000000a2' WHERE code = 'custom.desk';
SELECT pg_temp.expect('an active custom role is immutable', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.org_custom_roles SET permissions = '{fees.view}' WHERE code = 'custom.desk'$q$), '23001');
SELECT pg_temp.expect('a protected permission cannot be added to a draft later', pg_temp.try('service_role', pg_temp.svc(),
  $q$UPDATE public.org_custom_roles SET permissions = '{payroll.approve}' WHERE code = 'custom.bdesk'$q$), '42501');

\echo == 7. cross-organization reads return nothing ==
SELECT pg_temp.expect('A admin sees only A installations', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  $q$SELECT string_agg(DISTINCT org_id::text, ',') FROM public.tenant_role_pack_installations$q$), 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT pg_temp.expect('A admin sees no B overrides', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT count(*)::text FROM public.tenant_role_overrides WHERE org_id = %L::uuid$q$, :B)), '0');
SELECT pg_temp.expect('A admin sees A overrides', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  $q$SELECT (count(*) > 0)::text FROM public.tenant_role_overrides$q$), 'true');
SELECT pg_temp.expect('A admin sees no B custom roles', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT count(*)::text FROM public.org_custom_roles WHERE org_id = %L::uuid$q$, :B)), '0');
SELECT pg_temp.expect('B admin sees only B custom roles', pg_temp.run('authenticated', pg_temp.u('b0000000-0000-0000-0000-0000000000b1'),
  $q$SELECT string_agg(code, ',') FROM public.org_custom_roles$q$), 'custom.bdesk');
SELECT pg_temp.expect('a non-admin member of A sees nothing', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a3'),
  $q$SELECT ((SELECT count(*) FROM public.tenant_role_pack_installations) + (SELECT count(*) FROM public.tenant_role_overrides)
            + (SELECT count(*) FROM public.org_custom_roles))::text$q$), '0');
SELECT pg_temp.expect('published items readable, draft items hidden', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a3'),
  $q$SELECT string_agg(DISTINCT pack_code, ',') FROM public.role_pack_items$q$), 'inst-test');
SELECT pg_temp.expect('anon has no table privilege', pg_temp.try('anon', NULL,
  $q$SELECT count(*) FROM public.role_pack_items$q$), '42501');
SELECT pg_temp.expect('anon reads no installations', pg_temp.try('anon', NULL,
  $q$SELECT count(*) FROM public.tenant_role_pack_installations$q$), '42501');
SELECT pg_temp.expect('A admin cannot preview for B', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_upgrade_preview(%L::uuid, '2.0.0')$q$, :B)), '42501');
SELECT pg_temp.expect('a non-admin member cannot preview', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a3'),
  format($q$SELECT public.role_pack_upgrade_preview(%L::uuid, '2.0.0')$q$, :A)), '42501');

\echo == 8. upgrade preview: correct diff, no writes ==
CREATE TEMP TABLE before_counts AS SELECT (SELECT count(*) FROM public.audit_logs) a, (SELECT count(*) FROM public.tenant_role_pack_installations) i,
  (SELECT count(*) FROM public.tenant_role_overrides WHERE effective_to IS NOT NULL) o;
CREATE TEMP TABLE preview AS SELECT pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_upgrade_preview(%L::uuid, '2.0.0')::text$q$, :A))::jsonb AS p;
SELECT pg_temp.expect('templates gained', (SELECT p->>'templates_gained' FROM preview), '["auditor_t"]');
SELECT pg_temp.expect('templates lost', (SELECT p->>'templates_lost' FROM preview), '["clerk_t"]');
SELECT pg_temp.expect('permissions gained', (SELECT (p->'permissions_gained')::text FROM preview),
  '[{"template": "auditor_t", "permission": "payments.reconcile"}, {"template": "auditor_t", "permission": "reports.view"}, {"template": "bursar_t", "permission": "fees.collect"}]');
SELECT pg_temp.expect('permissions lost', (SELECT (p->'permissions_lost')::text FROM preview),
  '[{"template": "bursar_t", "permission": "payments.reconcile"}, {"template": "bursar_t", "permission": "payroll.approve"}, {"template": "clerk_t", "permission": "fees.view"}, {"template": "clerk_t", "permission": "reports.view"}]');
SELECT pg_temp.expect('declared migration found', (SELECT p->>'migration_declared' FROM preview), 'true');
SELECT pg_temp.expect('overrides on the lost template listed', (SELECT jsonb_array_length(p->'overrides_to_end')::text FROM preview), '1');
SELECT pg_temp.expect('preview wrote nothing',
  (SELECT (a = (SELECT count(*) FROM public.audit_logs) AND i = (SELECT count(*) FROM public.tenant_role_pack_installations)
           AND o = (SELECT count(*) FROM public.tenant_role_overrides WHERE effective_to IS NOT NULL))::text FROM before_counts), 'true');
SELECT pg_temp.expect('preview to an unpublished version refused', pg_temp.try('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_upgrade_preview(%L::uuid, '9.0.0')$q$, :A)), '42501');
SELECT pg_temp.expect('preview backwards refused', pg_temp.try('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_upgrade_preview(%L::uuid, '1.0.0')$q$, :A)), '22023');

\echo == 9. upgrade apply: authority, declared path, transactional, audited ==
SELECT pg_temp.expect('A admin cannot apply for B', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_upgrade_apply(%L::uuid, '2.0.0', '1.0.0')$q$, :B)), '42501');
SELECT pg_temp.expect('stale expected version refused', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_upgrade_apply(%L::uuid, '2.0.0', '0.9.0')$q$, :A)), '40001');
SELECT pg_temp.expect('no declared path (1.0.0 -> 3.0.0) refused', pg_temp.try('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_upgrade_apply(%L::uuid, '3.0.0', '1.0.0')$q$, :A)), '55000');
SELECT pg_temp.expect('refusals left the installation untouched',
  (SELECT string_agg(pack_version || ':' || status, ',') FROM public.tenant_role_pack_installations WHERE org_id = :A), '1.0.0:active');
SELECT pg_temp.expect('A admin applies the upgrade', pg_temp.run('authenticated', pg_temp.u('a0000000-0000-0000-0000-0000000000a1'),
  format($q$SELECT public.role_pack_upgrade_apply(%L::uuid, '2.0.0', '1.0.0')->>'outcome'$q$, :A)), 'upgraded');
SELECT pg_temp.expect('old installation superseded, new one active with upgrade_from',
  (SELECT string_agg(pack_version || ':' || status || ':' || coalesce(upgrade_from, '-'), ',' ORDER BY pack_version)
     FROM public.tenant_role_pack_installations WHERE org_id = :A), '1.0.0:superseded:-,2.0.0:active:1.0.0');
SELECT pg_temp.expect('override on the lost template ended',
  (SELECT count(*) FROM public.tenant_role_overrides WHERE org_id = :A AND template_code = 'clerk_t' AND effective_to IS NOT NULL)::text, '1');
SELECT pg_temp.expect('overrides on kept templates untouched',
  (SELECT count(*) FROM public.tenant_role_overrides WHERE org_id = :A AND template_code = 'bursar_t' AND effective_to IS NOT NULL)::text, '0');
SELECT pg_temp.expect('upgrade audited with the diff and the actor',
  (SELECT count(*) FROM public.audit_logs WHERE action = 'role_pack.upgrade.apply' AND school_id = :A
      AND user_id = 'a0000000-0000-0000-0000-0000000000a1' AND new_value->'templates_lost' = '["clerk_t"]')::text, '1');
SELECT pg_temp.expect('B untouched by the A upgrade',
  (SELECT string_agg(pack_version || ':' || status, ',') FROM public.tenant_role_pack_installations WHERE org_id = :B), '1.0.0:active');

\echo == 10. second run of the migration ==
\i database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql
SELECT pg_temp.expect('second run keeps the data',
  ((SELECT count(*) FROM public.role_pack_items) || '/' || (SELECT count(*) FROM public.tenant_role_pack_installations) || '/'
   || (SELECT count(*) FROM public.org_custom_roles)), '9/3/2');
SELECT pg_temp.expect('second run keeps the guards', pg_temp.try('service_role', pg_temp.svc(),
  pg_temp.ovr('bursar_t','add_optional_permission','{"permission":"payroll.approve"}')), '42501');
SELECT pg_temp.expect('second run keeps install idempotent', pg_temp.run('service_role', pg_temp.svc(),
  format($q$SELECT public.role_pack_install(%L::uuid, 'inst-test', '2.0.0')->>'outcome'$q$, :A)), 'already_installed');
SELECT pg_temp.expect('FORCE RLS on every new table',
  (SELECT count(*) FROM pg_class WHERE relname IN ('role_pack_items','role_pack_migrations','tenant_role_pack_installations',
     'tenant_role_overrides','org_custom_roles') AND relrowsecurity AND relforcerowsecurity)::text, '5');
SELECT pg_temp.expect('no privilege for anon on any new table or function',
  ((SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name IN ('role_pack_items','role_pack_migrations',
      'tenant_role_pack_installations','tenant_role_overrides','org_custom_roles'))
   + (SELECT count(*) FROM pg_proc p WHERE p.proname LIKE 'role_pack%' AND has_function_privilege('anon', p.oid, 'EXECUTE')))::text, '0');
SELECT pg_temp.expect('authenticated holds SELECT only',
  (SELECT string_agg(DISTINCT privilege_type, ',') FROM information_schema.role_table_grants WHERE grantee = 'authenticated'
     AND table_name IN ('role_pack_items','role_pack_migrations','tenant_role_pack_installations','tenant_role_overrides','org_custom_roles')), 'SELECT');
SELECT pg_temp.expect('every new function pins search_path',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     AND (p.proname LIKE 'role_pack%' OR p.proname IN ('tenant_role_overrides_guard','tenant_role_pack_installations_guard','org_custom_roles_guard'))
     AND NOT coalesce(p.proconfig @> ARRAY['search_path=""'], false))::text, '0');

\echo == 11. rollback ==
SELECT pg_temp.expect('rollback stops while institution packs exist', pg_temp.try('postgres', NULL,
  $q$DO $d$ BEGIN
       IF EXISTS (SELECT 1 FROM public.cg_role_pack WHERE kind = 'institution_pack')
          AND coalesce(current_setting('sherivs.rollback_purge_institution_packs', true), '') <> 'on' THEN
         RAISE EXCEPTION 'institution packs exist' USING ERRCODE = '55000'; END IF; END $d$$q$), '55000');
SET sherivs.rollback_purge_institution_packs = 'on';
\i database/supabase/rollbacks/20261117001100_sherivs_m2_role_pack_engine.sql
RESET sherivs.rollback_purge_institution_packs;
SELECT pg_temp.expect('rollback removed every new table',
  (SELECT count(*) FROM pg_class WHERE relname IN ('role_pack_items','role_pack_migrations','tenant_role_pack_installations',
     'tenant_role_overrides','org_custom_roles'))::text, '0');
SELECT pg_temp.expect('rollback removed every new function',
  (SELECT count(*) FROM pg_proc WHERE proname LIKE 'role_pack%' OR proname IN ('tenant_role_overrides_guard',
     'tenant_role_pack_installations_guard','org_custom_roles_guard'))::text, '0');
SELECT pg_temp.expect('tenant_role packs kept', (SELECT count(*) FROM public.cg_role_pack WHERE code = 'twin-x')::text, '1');
SELECT pg_temp.expect('kind check restored', pg_temp.try('postgres', NULL,
  $q$INSERT INTO public.cg_role_pack (code, version, kind, applies_to, definition, definition_digest)
     VALUES ('inst-again','1.0.0','institution_pack',ARRAY['x'], pg_temp.def('inst-again','1.0.0','institution_pack'),'')$q$), '23514');
SELECT pg_temp.expect('ENGINE-01 guard restored (published pack immutable)', pg_temp.try('postgres', NULL,
  $q$UPDATE public.cg_role_pack SET definition = definition || '{"x":1}' WHERE code = 'twin-x'$q$), '23001');
SELECT pg_temp.expect('audit history survives the rollback',
  (SELECT count(*) > 0 FROM public.audit_logs WHERE action = 'role_pack.upgrade.apply')::text, 'true');

\echo == 12. forward again after rollback ==
\i database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql
SELECT pg_temp.expect('re-applied cleanly',
  (SELECT count(*) FROM pg_class WHERE relname IN ('role_pack_items','role_pack_migrations','tenant_role_pack_installations',
     'tenant_role_overrides','org_custom_roles'))::text, '5');
\echo == ALL M2 ROLE PACK ENGINE CHECKS PASSED ==
