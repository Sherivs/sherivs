-- WF-01 STAGING PREREQUISITE SHIM. STAGING PROJECT ONLY. NEVER RUN ON PRODUCTION.
--
-- Why: the staging project (Sherivs ACTIVE-V1 RLS Staging) holds no application schema. The
-- WF-01 migration depends on existing objects: the permission catalog (has_permission), the org
-- administrator rule (can_administer_org), platform capabilities (has_platform_capability) and
-- the hash-chained audit_chain. This file creates the smallest set of those objects so the real
-- WF-01 migration file can be applied unchanged and its RLS tests run on a hosted Supabase stack.
--
-- Fidelity:
--   * Copied verbatim from the migrations: can_administer_org, effective_permissions,
--     has_permission, has_platform_capability, is_super_admin, audit_chain (table, link guard,
--     append-only triggers, RLS, grants) and audit_chain_canonical_hash.
--   * Simplified stand-ins (columns limited to what those functions read): schools, users,
--     super_admins, platform_roles, platform_staff, platform_staff_roles and the five
--     role-catalog tables. get_my_school_id/get_my_role read users only (the original v1 form;
--     production also consults organization_memberships first).
--   The full-fidelity proof is the CI "Migration dry-run" job, which applies every migration
--   in order and runs the same test file against the real helpers.
--
-- Guard: refuses to run if this database already holds Sherivs application tables (production
-- does), or if any public table other than the shim exists.
-- Teardown (after the WF-01 rollback): tests/integration/wf01-staging-prereq-shim.teardown.sql
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.wf01_staging_shim_marker') IS NOT NULL THEN
    RAISE EXCEPTION 'WF01 SHIM: already installed';
  END IF;
  IF to_regclass('public.payment_intents') IS NOT NULL OR to_regclass('public.cg_tenant') IS NOT NULL
     OR to_regclass('public.schools') IS NOT NULL OR to_regclass('public.audit_chain') IS NOT NULL THEN
    RAISE EXCEPTION 'WF01 SHIM: refusing: this database holds the real application schema';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')) THEN
    RAISE EXCEPTION 'WF01 SHIM: refusing: the public schema is not empty';
  END IF;
END $guard$;

CREATE TABLE public.wf01_staging_shim_marker (
  installed_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT 'WF-01 staging prerequisite shim; not application schema'
);
INSERT INTO public.wf01_staging_shim_marker DEFAULT VALUES;

-- Stand-in identity tables (only the columns the copied helpers read).
CREATE TABLE public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  school_id uuid REFERENCES public.schools(id),
  full_name text NOT NULL,
  email text,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.super_admins (
  id uuid PRIMARY KEY,
  is_active boolean DEFAULT true
);
CREATE TABLE public.platform_roles (
  code text PRIMARY KEY,
  capabilities text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE public.platform_staff (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  full_name text NOT NULL,
  status text NOT NULL DEFAULT 'invited'
);
CREATE TABLE public.platform_staff_roles (
  staff_id uuid NOT NULL REFERENCES public.platform_staff(id),
  role_code text NOT NULL REFERENCES public.platform_roles(code),
  PRIMARY KEY (staff_id, role_code)
);
INSERT INTO public.platform_roles (code, capabilities) VALUES
  ('support', ARRAY['platform.tenants.read', 'platform.support.handle']);

-- Stand-in role catalog (columns read by effective_permissions).
CREATE TABLE public.role_catalog (code text PRIMARY KEY, template_code text NOT NULL, org_id uuid);
CREATE TABLE public.role_template_permissions (
  template_code text NOT NULL, permission_code text NOT NULL, kind text NOT NULL, default_on boolean NOT NULL DEFAULT true,
  PRIMARY KEY (template_code, permission_code));
CREATE TABLE public.org_role_permission_settings (
  org_id uuid NOT NULL, role_code text NOT NULL, permission_code text NOT NULL, enabled boolean NOT NULL,
  PRIMARY KEY (org_id, role_code, permission_code));
CREATE TABLE public.org_role_custom_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, role_code text NOT NULL,
  permission_code text, custom_key text);
CREATE TABLE public.user_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, user_id uuid NOT NULL, role_code text NOT NULL,
  scope_type text NOT NULL DEFAULT 'org', scope_ref text, status text NOT NULL DEFAULT 'active');

-- Stand-in session helpers (v1 form: users only).
CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.users WHERE id = auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- Copied verbatim from 20261003000020_coregrid_is_super_admin_definer.sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE id = auth.uid() AND is_active = true);
$$;

-- Copied verbatim from 20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql
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

-- Copied verbatim from 20261024000240_sherivs_017_role_permission_catalog.sql
CREATE OR REPLACE FUNCTION public.effective_permissions(p_org uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (permission_code text, kind text, role_codes text[], scopes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH me AS (SELECT coalesce(p_user, auth.uid()) uid),
  allowed AS (SELECT (SELECT uid FROM me) = auth.uid() OR public.can_administer_org(p_org) ok),
  a AS (SELECT ura.* FROM public.user_role_assignments ura, me, allowed
         WHERE allowed.ok AND ura.org_id = p_org AND ura.user_id = me.uid AND ura.status = 'active'),
  g AS (
    SELECT tp.permission_code, tp.kind, a.role_code, a.scope_type, a.scope_ref
      FROM a JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s ON s.org_id = p_org AND s.role_code = a.role_code AND s.permission_code = tp.permission_code
     WHERE tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on)
    UNION ALL
    SELECT coalesce(cg.permission_code, cg.custom_key), 'custom', a.role_code, a.scope_type, a.scope_ref
      FROM a JOIN public.org_role_custom_grants cg ON cg.org_id = p_org AND cg.role_code = a.role_code)
  SELECT permission_code, min(kind), array_agg(DISTINCT role_code ORDER BY role_code),
         jsonb_agg(DISTINCT jsonb_build_object('type', scope_type, 'ref', scope_ref))
    FROM g GROUP BY permission_code;
$$;
CREATE OR REPLACE FUNCTION public.has_permission(p_org uuid, p_permission text, p_scope_type text DEFAULT NULL, p_scope_ref text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.effective_permissions(p_org, auth.uid()) e
    WHERE e.permission_code = p_permission
      AND (p_scope_type IS NULL OR e.scopes @> '[{"type":"org"}]'::jsonb
           OR e.scopes @> jsonb_build_array(jsonb_build_object('type', p_scope_type, 'ref', p_scope_ref))));
$$;

-- Copied verbatim from 20261020000150_sherivs_008_platform_staff.sql
CREATE OR REPLACE FUNCTION public.has_platform_capability(p_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin()
      OR EXISTS (SELECT 1
                   FROM public.platform_staff s
                   JOIN public.platform_staff_roles sr ON sr.staff_id = s.id
                   JOIN public.platform_roles r ON r.code = sr.role_code
                  WHERE s.id = auth.uid() AND s.status = 'active'
                    AND p_capability = ANY (r.capabilities));
$$;

-- Copied verbatim from 20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql
CREATE OR REPLACE FUNCTION public.audit_chain_canonical_hash(p_prev text, p_seq bigint, p_at timestamptz, p_org uuid, p_kind text, p_actor text,
  p_action text, p_ttype text, p_tid text, p_ip inet, p_device text, p_before text, p_after text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  -- Mirrors frontend/src/lib/trust-ledger/hash-chain.server.ts computeEntryHash:
  -- sha256(prev_hash || stableStringify([seq, at, orgId, actorKind, actorId, action, targetType, targetId, ip, device, beforeHash, afterHash, prevHash]))
  SELECT encode(sha256(convert_to(p_prev || '[' || p_seq::text || ',' ||
    to_json(to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text || ',' ||
    to_json(p_org::text)::text || ',' || to_json(p_kind)::text || ',' || to_json(p_actor)::text || ',' ||
    to_json(p_action)::text || ',' || to_json(p_ttype)::text || ',' || to_json(p_tid)::text || ',' ||
    coalesce(to_json(host(p_ip))::text, 'null') || ',' || coalesce(to_json(p_device)::text, 'null') || ',' ||
    coalesce(to_json(p_before)::text, 'null') || ',' || coalesce(to_json(p_after)::text, 'null') || ',' ||
    to_json(p_prev)::text || ']', 'UTF8')), 'hex');
$$;

-- Copied verbatim from 20261022000200_sherivs_013_payments_audit_entitlements.sql (policy omitted: it needs the neutral tenant substrate)
CREATE TABLE IF NOT EXISTS public.audit_chain (
  org_id       uuid NOT NULL,
  seq          bigint NOT NULL CHECK (seq >= 1),
  at           timestamptz NOT NULL,
  actor_kind   text NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_id     text NOT NULL,
  action       text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.:-]{1,99}$'),
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  ip           inet,
  device       text CHECK (device IS NULL OR length(device) <= 300),
  before_hash  text CHECK (before_hash IS NULL OR before_hash ~ '^[0-9a-f]{64}$'),
  after_hash   text CHECK (after_hash IS NULL OR after_hash ~ '^[0-9a-f]{64}$'),
  prev_hash    text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash   text NOT NULL UNIQUE CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (org_id, seq)
);

-- Insert guard: seq must be head+1 and prev_hash must equal the head's entry_hash.
CREATE OR REPLACE FUNCTION public.audit_chain_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_head public.audit_chain%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text, 7013));
  SELECT * INTO v_head FROM public.audit_chain WHERE org_id = NEW.org_id ORDER BY seq DESC LIMIT 1;
  IF v_head.seq IS NULL THEN
    IF NEW.seq <> 1 OR NEW.prev_hash <> repeat('0', 64) THEN RAISE EXCEPTION 'audit_chain: bad genesis link'; END IF;
  ELSIF NEW.seq <> v_head.seq + 1 OR NEW.prev_hash <> v_head.entry_hash THEN
    RAISE EXCEPTION 'audit_chain: broken link';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.audit_chain_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'audit_chain is append-only'; END;
$$;
DROP TRIGGER IF EXISTS audit_chain_link ON public.audit_chain;
CREATE TRIGGER audit_chain_link BEFORE INSERT ON public.audit_chain FOR EACH ROW EXECUTE FUNCTION public.audit_chain_link_guard();
DROP TRIGGER IF EXISTS audit_chain_no_mutation ON public.audit_chain;
CREATE TRIGGER audit_chain_no_mutation BEFORE UPDATE OR DELETE ON public.audit_chain FOR EACH ROW EXECUTE FUNCTION public.audit_chain_append_only();
DROP TRIGGER IF EXISTS audit_chain_no_truncate ON public.audit_chain;
CREATE TRIGGER audit_chain_no_truncate BEFORE TRUNCATE ON public.audit_chain FOR EACH STATEMENT EXECUTE FUNCTION public.audit_chain_append_only();

ALTER TABLE public.audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_chain FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_chain FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_chain TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_chain TO service_role;

-- Shim tables: RLS on and forced, no client grants (helpers are definer).
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wf01_staging_shim_marker','schools','users','super_admins','platform_roles','platform_staff',
    'platform_staff_roles','role_catalog','role_template_permissions','org_role_permission_settings',
    'org_role_custom_grants','user_role_assignments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $rls$;
REVOKE ALL ON FUNCTION public.get_my_school_id(), public.get_my_role(), public.is_super_admin(),
  public.can_administer_org(uuid), public.effective_permissions(uuid, uuid), public.has_permission(uuid, text, text, text),
  public.has_platform_capability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_school_id(), public.get_my_role(), public.is_super_admin(),
  public.can_administer_org(uuid), public.effective_permissions(uuid, uuid), public.has_permission(uuid, text, text, text),
  public.has_platform_capability(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_chain_link_guard(), public.audit_chain_append_only() FROM PUBLIC, anon, authenticated;

COMMIT;
