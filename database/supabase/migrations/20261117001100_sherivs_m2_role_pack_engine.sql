-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M2 part B (mission E-007, ADR-105): Roles Pack Engine data model and database functions.
-- Rollback: database/supabase/rollbacks/20261117001100_sherivs_m2_role_pack_engine.sql
--
-- Extends, never duplicates:
--   * public.cg_role_pack (ENGINE-01) stays the ONE pack registry. Its kind is widened with
--     'institution_pack' (the institution-type bundle); the existing immutability, digest and
--     shadow guards are kept, and an institution pack gets the tenant tier ceiling (T2).
--   * role_templates, permission_catalog, role_guardrail_catalog, sod_permission_rules (017) stay
--     the source of truth for templates, permissions, guardrails and separation of duties.
--   * can_administer_org (016), get_my_school_id, scholar_audit (018) and audit_logs are reused.
-- New objects: role_pack_items (catalogue), tenant_role_pack_installations, tenant_role_overrides,
-- org_custom_roles, role_pack_migrations (catalogue), and role_pack_install / _upgrade_preview /
-- _upgrade_apply. Catalogue tables carry no tenant column and are written by the service role only.
-- Private by default (SEC-M0 / ADR-101): no privilege for anon; authenticated reads only what a
-- policy allows; every write goes through the service role or a SECURITY DEFINER function.

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.cg_role_pack') IS NULL THEN missing := array_append(missing, 'public.cg_role_pack'); END IF;
  IF to_regclass('public.role_templates') IS NULL THEN missing := array_append(missing, 'public.role_templates'); END IF;
  IF to_regclass('public.role_template_permissions') IS NULL THEN missing := array_append(missing, 'public.role_template_permissions'); END IF;
  IF to_regclass('public.permission_catalog') IS NULL THEN missing := array_append(missing, 'public.permission_catalog'); END IF;
  IF to_regclass('public.sod_permission_rules') IS NULL THEN missing := array_append(missing, 'public.sod_permission_rules'); END IF;
  IF to_regclass('public.audit_logs') IS NULL THEN missing := array_append(missing, 'public.audit_logs'); END IF;
  IF to_regclass('public.organization_memberships') IS NULL THEN missing := array_append(missing, 'public.organization_memberships'); END IF;
  IF to_regprocedure('public.can_administer_org(uuid)') IS NULL THEN missing := array_append(missing, 'public.can_administer_org(uuid)'); END IF;
  IF to_regprocedure('public.scholar_audit()') IS NULL THEN missing := array_append(missing, 'public.scholar_audit()'); END IF;
  IF to_regprocedure('public.cg_role_pack_guard()') IS NULL THEN missing := array_append(missing, 'public.cg_role_pack_guard()'); END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M2 role pack engine requires ENGINE-01, SHERIVS-016/017/018; missing: %', array_to_string(missing, ', ')
      USING ERRCODE = '55000';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Pack registry: widen cg_role_pack.kind (every existing value kept)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_role_pack DROP CONSTRAINT IF EXISTS cg_role_pack_kind_check;
ALTER TABLE public.cg_role_pack ADD CONSTRAINT cg_role_pack_kind_check
  CHECK (kind IN ('tenant_role', 'platform_role', 'institution_pack'));

-- Same body as ENGINE-01 except one line: an institution pack gets the tenant ceiling (T2), not
-- the platform ceiling. Every other invariant (immutable once published, digest, shadow start,
-- no cross-tenant memory, version monotonic, published -> retired only) is unchanged.
CREATE OR REPLACE FUNCTION public.cg_role_pack_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_cap jsonb;
  v_max_rank int;
  v_rank int;
  v_prior text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'role pack % % is % and cannot be deleted', OLD.code, OLD.version, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  NEW.definition_digest := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW.definition::text, 'UTF8')), 'hex');

  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'retired') THEN
    IF NEW.definition_digest IS DISTINCT FROM OLD.definition_digest
       OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.applies_to IS DISTINCT FROM OLD.applies_to
       OR NEW.definition IS DISTINCT FROM OLD.definition
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'role pack % % is immutable once published', OLD.code, OLD.version
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT (OLD.status = 'published' AND NEW.status = 'retired') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'role pack status may only move published -> retired'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.definition->>'schema' IS DISTINCT FROM 'sherivs.role-pack.v1'
     OR NEW.definition->>'code' IS DISTINCT FROM NEW.code
     OR NEW.definition->>'version' IS DISTINCT FROM NEW.version
     OR NEW.definition->>'kind' IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'role pack definition does not match its identity columns';
  END IF;
  IF (NEW.definition->>'startsInShadow') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'role pack must start in shadow';
  END IF;
  IF (NEW.definition->'memory'->>'crossTenant') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'role pack must not declare cross-tenant memory';
  END IF;
  IF jsonb_typeof(NEW.definition->'capabilities') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'role pack capabilities must be an array';
  END IF;

  v_max_rank := CASE WHEN NEW.kind IN ('tenant_role', 'institution_pack') THEN 2 ELSE 3 END;
  FOR v_cap IN SELECT * FROM jsonb_array_elements(NEW.definition->'capabilities') LOOP
    v_rank := CASE v_cap->>'tier'
      WHEN 'T0' THEN 0 WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3 WHEN 'T4' THEN 4 ELSE NULL END;
    IF v_rank IS NULL OR v_rank >= 4 THEN
      RAISE EXCEPTION 'capability % has an undeclarable tier', v_cap->>'id';
    END IF;
    IF v_rank > v_max_rank THEN
      RAISE EXCEPTION 'capability % exceeds the tier ceiling for %', v_cap->>'id', NEW.kind;
    END IF;
    IF v_cap->>'autonomy' = 'act_autonomously' AND v_rank > 1 THEN
      RAISE EXCEPTION 'capability % may not be declared autonomous above T1', v_cap->>'id';
    END IF;
  END LOOP;

  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, pg_catalog.now());
    SELECT p.version INTO v_prior
    FROM public.cg_role_pack p
    WHERE p.code = NEW.code AND p.status IN ('published', 'retired')
    ORDER BY string_to_array(p.version, '.')::int[] DESC
    LIMIT 1;
    IF v_prior IS NOT NULL
       AND string_to_array(NEW.version, '.')::int[] <= string_to_array(v_prior, '.')::int[] THEN
      RAISE EXCEPTION 'role pack % version % must exceed published version %', NEW.code, NEW.version, v_prior;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, pg_catalog.now());
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.cg_role_pack_guard() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Shared helpers (internal; never granted to API roles)
-- -----------------------------------------------------------------------------
-- Trusted server context: a service_role JWT, or a direct database session without any JWT that
-- is not PostgREST's authenticator (same rule as can_administer_org).
CREATE OR REPLACE FUNCTION public.role_pack_caller_is_service()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR (auth.uid() IS NULL AND coalesce(auth.role(), '') = ''
          AND session_user NOT IN ('authenticator', 'anon', 'authenticated'));
$$;

-- An administrator of the caller's OWN organization. The organization is the caller's, never
-- the client's: p_org must equal get_my_school_id().
CREATE OR REPLACE FUNCTION public.role_pack_caller_is_org_admin(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_org IS NOT NULL AND auth.uid() IS NOT NULL
     AND public.get_my_school_id() IS NOT DISTINCT FROM p_org
     AND coalesce(public.can_administer_org(p_org), false);
$$;

CREATE OR REPLACE FUNCTION public.role_pack_user_in_org(p_user uuid, p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user IS NOT NULL AND p_org IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user AND u.school_id = p_org)
    OR EXISTS (SELECT 1 FROM public.organization_memberships m
                WHERE m.user_id = p_user AND m.school_id = p_org AND m.is_active));
$$;

-- Whether a pack version is published or retired. Definer, so the read policies of the catalogue
-- tables can ask without giving authenticated any access to cg_role_pack itself.
CREATE OR REPLACE FUNCTION public.role_pack_is_released(p_code text, p_version text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cg_role_pack p WHERE p.code = p_code AND p.version = p_version
                    AND p.status IN ('published', 'retired'));
$$;

-- Scope breadth: larger rank = narrower.
CREATE OR REPLACE FUNCTION public.role_pack_scope_rank(p_scope text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_scope WHEN 'org' THEN 0 WHEN 'campus' THEN 1 WHEN 'faculty' THEN 2
                      WHEN 'department' THEN 3 WHEN 'class' THEN 4 WHEN 'self' THEN 5 END;
$$;

CREATE OR REPLACE FUNCTION public.role_pack_text_array(p jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN ARRAY[]::text[]
              ELSE ARRAY(SELECT jsonb_array_elements_text(p)) END;
$$;

-- First separation-of-duties rule that a permission set violates, or NULL.
CREATE OR REPLACE FUNCTION public.role_pack_sod_violation(p_perms text[])
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT r.permission_a || ' + ' || r.permission_b || ': ' || r.description
    FROM public.sod_permission_rules r
   WHERE r.permission_a = ANY (coalesce(p_perms, ARRAY[]::text[]))
     AND r.permission_b = ANY (coalesce(p_perms, ARRAY[]::text[]))
   ORDER BY r.permission_a, r.permission_b
   LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 3. role_pack_items: catalogue content of an institution pack (no tenant column)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_pack_items (
  pack_code    text NOT NULL,
  pack_version text NOT NULL,
  item_kind    text NOT NULL CHECK (item_kind IN ('template', 'responsibility', 'layout', 'policy',
                                                  'approval_chain', 'notification_rule', 'audit_event', 'seed')),
  item_ref     text NOT NULL CHECK (item_ref ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (pack_code, pack_version, item_kind, item_ref),
  CONSTRAINT role_pack_items_pack_fk FOREIGN KEY (pack_code, pack_version)
    REFERENCES public.cg_role_pack (code, version) ON DELETE CASCADE
);
COMMENT ON TABLE public.role_pack_items IS
  'M2 (ADR-105) catalogue content of an institution pack. Not tenant data. Immutable once its pack '
  'is published. A template item carries {mandatory[], optional[], guardrails[]}; it may never drop '
  'a mandatory permission or a guardrail of the role template it names.';

CREATE OR REPLACE FUNCTION public.role_pack_items_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  v_status text;
  v_kind text;
  v_mand text[];
  v_opt text[];
  v_bad text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM public.role_pack_items i JOIN public.cg_role_pack p
                 ON p.code = i.pack_code AND p.version = i.pack_version WHERE p.status <> 'draft') THEN
      RAISE EXCEPTION 'items of a published role pack are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT p.status INTO v_status FROM public.cg_role_pack p WHERE p.code = OLD.pack_code AND p.version = OLD.pack_version;
    IF v_status IS DISTINCT FROM 'draft' AND v_status IS NOT NULL THEN
      RAISE EXCEPTION 'items of role pack % % are immutable once published', OLD.pack_code, OLD.pack_version
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;

  SELECT p.status, p.kind INTO v_status, v_kind
    FROM public.cg_role_pack p WHERE p.code = NEW.pack_code AND p.version = NEW.pack_version;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'items can only be added to a draft role pack (% % is %)', NEW.pack_code, NEW.pack_version,
      coalesce(v_status, 'missing') USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_kind IS DISTINCT FROM 'institution_pack' THEN
    RAISE EXCEPTION 'items belong to institution packs only (% is %)', NEW.pack_code, v_kind USING ERRCODE = '22023';
  END IF;

  IF NEW.item_kind = 'template' THEN
    IF NOT EXISTS (SELECT 1 FROM public.role_templates t WHERE t.code = NEW.item_ref) THEN
      RAISE EXCEPTION 'unknown role template %', NEW.item_ref USING ERRCODE = '22023';
    END IF;
    v_mand := public.role_pack_text_array(NEW.payload->'mandatory');
    v_opt := public.role_pack_text_array(NEW.payload->'optional');
    SELECT x INTO v_bad FROM unnest(v_mand || v_opt) x
     WHERE NOT EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.code = x) LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown permission % in template %', v_bad, NEW.item_ref USING ERRCODE = '22023'; END IF;
    IF v_mand && v_opt THEN RAISE EXCEPTION 'a permission cannot be both mandatory and optional in %', NEW.item_ref USING ERRCODE = '22023'; END IF;
    SELECT tp.permission_code INTO v_bad FROM public.role_template_permissions tp
     WHERE tp.template_code = NEW.item_ref AND tp.kind = 'mandatory' AND NOT (tp.permission_code = ANY (v_mand)) LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'template % in a pack must keep its mandatory permission %', NEW.item_ref, v_bad USING ERRCODE = '42501';
    END IF;
    IF NEW.payload ? 'guardrails' AND NOT ((SELECT t.guardrails FROM public.role_templates t WHERE t.code = NEW.item_ref)
                                          <@ public.role_pack_text_array(NEW.payload->'guardrails')) THEN
      RAISE EXCEPTION 'template % in a pack cannot drop a guardrail', NEW.item_ref USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.item_kind = 'responsibility' THEN
    SELECT x INTO v_bad FROM unnest(public.role_pack_text_array(NEW.payload->'permissions')) x
     WHERE NOT EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.code = x) LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown permission % in responsibility %', v_bad, NEW.item_ref USING ERRCODE = '22023'; END IF;
  ELSIF NEW.item_kind = 'layout' THEN
    IF NEW.payload ? 'nav' AND (jsonb_typeof(NEW.payload->'nav') <> 'array' OR jsonb_array_length(NEW.payload->'nav') <> 3) THEN
      RAISE EXCEPTION 'a layout has exactly three primary navigation sections' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS role_pack_items_guard_trg ON public.role_pack_items;
CREATE TRIGGER role_pack_items_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.role_pack_items
  FOR EACH ROW EXECUTE FUNCTION public.role_pack_items_guard();
DROP TRIGGER IF EXISTS role_pack_items_truncate_guard_trg ON public.role_pack_items;
CREATE TRIGGER role_pack_items_truncate_guard_trg
  BEFORE TRUNCATE ON public.role_pack_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.role_pack_items_guard();

-- Union of a template's mandatory and optional permissions inside one pack version.
CREATE OR REPLACE FUNCTION public.role_pack_template_permissions(p_code text, p_version text, p_template text)
RETURNS text[] LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((
    SELECT public.role_pack_text_array(i.payload->'mandatory') || public.role_pack_text_array(i.payload->'optional')
      FROM public.role_pack_items i
     WHERE i.pack_code = p_code AND i.pack_version = p_version AND i.item_kind = 'template' AND i.item_ref = p_template),
    ARRAY[]::text[]);
$$;

-- -----------------------------------------------------------------------------
-- 4. role_pack_migrations: declared upgrade path between two versions (catalogue)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_pack_migrations (
  from_pack_code text NOT NULL,
  from_version   text NOT NULL,
  to_version     text NOT NULL,
  steps          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array'),
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (from_pack_code, from_version, to_version),
  CONSTRAINT role_pack_migrations_from_fk FOREIGN KEY (from_pack_code, from_version)
    REFERENCES public.cg_role_pack (code, version),
  CONSTRAINT role_pack_migrations_to_fk FOREIGN KEY (from_pack_code, to_version)
    REFERENCES public.cg_role_pack (code, version),
  CONSTRAINT role_pack_migrations_forward CHECK (
    string_to_array(to_version, '.')::int[] > string_to_array(from_version, '.')::int[])
);
COMMENT ON TABLE public.role_pack_migrations IS
  'M2 (ADR-105) catalogue: the declared upgrade path of an institution pack. Immutable once the '
  'target version is published. An upgrade can only be applied along a declared path.';

CREATE OR REPLACE FUNCTION public.role_pack_migrations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'role pack migrations cannot be truncated' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT p.status INTO v_status FROM public.cg_role_pack p WHERE p.code = OLD.from_pack_code AND p.version = OLD.to_version;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'the migration to % % is immutable once that version is published', OLD.from_pack_code, OLD.to_version
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.steps) s
              WHERE jsonb_typeof(s) <> 'object' OR coalesce(s->>'op', '') !~ '^[a-z][a-z0-9_]{1,39}$') THEN
    RAISE EXCEPTION 'every migration step is an object with an op' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cg_role_pack p WHERE p.code = NEW.from_pack_code AND p.version = NEW.to_version
                    AND p.kind = 'institution_pack') THEN
    RAISE EXCEPTION 'migrations belong to institution packs only' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS role_pack_migrations_guard_trg ON public.role_pack_migrations;
CREATE TRIGGER role_pack_migrations_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.role_pack_migrations
  FOR EACH ROW EXECUTE FUNCTION public.role_pack_migrations_guard();
DROP TRIGGER IF EXISTS role_pack_migrations_truncate_guard_trg ON public.role_pack_migrations;
CREATE TRIGGER role_pack_migrations_truncate_guard_trg
  BEFORE TRUNCATE ON public.role_pack_migrations
  FOR EACH STATEMENT EXECUTE FUNCTION public.role_pack_migrations_guard();

-- -----------------------------------------------------------------------------
-- 5. tenant_role_pack_installations: which pack version an organization runs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_role_pack_installations (
  id           uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  pack_code    text NOT NULL,
  pack_version text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  installed_by uuid,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'uninstalled')),
  upgrade_from text CHECK (upgrade_from IS NULL OR upgrade_from ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT tenant_role_pack_installations_pack_fk FOREIGN KEY (pack_code, pack_version)
    REFERENCES public.cg_role_pack (code, version),
  CONSTRAINT tenant_role_pack_installations_once UNIQUE (org_id, pack_code, pack_version)
);
-- One active institution pack per organization: the upgrade functions address it by organization.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_role_pack_installations_one_active
  ON public.tenant_role_pack_installations (org_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.tenant_role_pack_installations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'installations are history; mark them uninstalled instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'an installation starts active' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cg_role_pack p WHERE p.code = NEW.pack_code AND p.version = NEW.pack_version
                      AND p.kind = 'institution_pack' AND p.status = 'published') THEN
      RAISE EXCEPTION 'only a published institution pack can be installed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.pack_code IS DISTINCT FROM OLD.pack_code OR NEW.pack_version IS DISTINCT FROM OLD.pack_version
     OR NEW.installed_at IS DISTINCT FROM OLD.installed_at OR NEW.installed_by IS DISTINCT FROM OLD.installed_by
     OR NEW.upgrade_from IS DISTINCT FROM OLD.upgrade_from THEN
    RAISE EXCEPTION 'an installation record is immutable except its status' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'installation status may only leave active' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS tenant_role_pack_installations_guard_trg ON public.tenant_role_pack_installations;
CREATE TRIGGER tenant_role_pack_installations_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_role_pack_installations
  FOR EACH ROW EXECUTE FUNCTION public.tenant_role_pack_installations_guard();

-- -----------------------------------------------------------------------------
-- 6. tenant_role_overrides: an organization may only NARROW a template, or add a
--    non-protected optional permission. Never remove a guardrail or an SoD rule.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_role_overrides (
  id             uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  template_code  text NOT NULL REFERENCES public.role_templates(code),
  override_kind  text NOT NULL CHECK (override_kind IN ('rename', 'enable', 'disable', 'add_optional_permission',
                                                        'remove_optional_permission', 'scope_narrow', 'approval_limit',
                                                        'add_responsibility')),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  effective_from timestamptz NOT NULL DEFAULT pg_catalog.now(),
  effective_to   timestamptz,
  created_by     uuid NOT NULL,
  approved_by    uuid,
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT tenant_role_overrides_window CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT tenant_role_overrides_four_eyes CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE INDEX IF NOT EXISTS tenant_role_overrides_org_template ON public.tenant_role_overrides (org_id, template_code);

CREATE OR REPLACE FUNCTION public.tenant_role_overrides_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  v_pack text;
  v_ver text;
  v_tpl public.role_templates%ROWTYPE;
  v_item jsonb;
  v_perm text;
  v_set text[];
  v_allowed text[];
  v_sod text;
  v_limit numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'overrides are history; end them with effective_to' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.created_by THEN
    RAISE EXCEPTION 'four-eyes: an override cannot be approved by its creator' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.template_code IS DISTINCT FROM OLD.template_code OR NEW.override_kind IS DISTINCT FROM OLD.override_kind
       OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'an override is immutable; end it and create a new one' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
      RAISE EXCEPTION 'an approval cannot be changed' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.effective_to IS NOT NULL AND (NEW.effective_to IS NULL OR NEW.effective_to > OLD.effective_to) THEN
      RAISE EXCEPTION 'an override window can only be shortened' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL THEN
      IF auth.uid() IS NOT NULL AND NEW.approved_by <> auth.uid() THEN
        RAISE EXCEPTION 'the approver is the caller' USING ERRCODE = '42501';
      END IF;
      IF NOT public.role_pack_user_in_org(NEW.approved_by, NEW.org_id) THEN
        RAISE EXCEPTION 'the approver is not a member of this organization' USING ERRCODE = '42501';
      END IF;
      NEW.approved_at := pg_catalog.now();
    ELSIF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'approved_at is set by the approval' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT ---------------------------------------------------------------------
  IF auth.uid() IS NOT NULL AND NEW.created_by <> auth.uid() THEN
    RAISE EXCEPTION 'the creator is the caller' USING ERRCODE = '42501';
  END IF;
  IF NOT public.role_pack_user_in_org(NEW.created_by, NEW.org_id) THEN
    RAISE EXCEPTION 'the creator is not a member of this organization' USING ERRCODE = '42501';
  END IF;
  IF NEW.approved_by IS NOT NULL THEN
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'an override is approved by a second person after it is created' USING ERRCODE = '42501';
    END IF;
    IF NOT public.role_pack_user_in_org(NEW.approved_by, NEW.org_id) THEN
      RAISE EXCEPTION 'the approver is not a member of this organization' USING ERRCODE = '42501';
    END IF;
    NEW.approved_at := pg_catalog.now();
  ELSE
    NEW.approved_at := NULL;
  END IF;

  SELECT i.pack_code, i.pack_version INTO v_pack, v_ver
    FROM public.tenant_role_pack_installations i WHERE i.org_id = NEW.org_id AND i.status = 'active';
  IF v_pack IS NULL THEN
    RAISE EXCEPTION 'the organization has no installed role pack' USING ERRCODE = '42501';
  END IF;
  SELECT i.payload INTO v_item FROM public.role_pack_items i
   WHERE i.pack_code = v_pack AND i.pack_version = v_ver AND i.item_kind = 'template' AND i.item_ref = NEW.template_code;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'template % is not part of the installed pack', NEW.template_code USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tpl FROM public.role_templates t WHERE t.code = NEW.template_code;
  -- What the role holds in this organization: the pack's mandatory set plus the optional
  -- permissions already added by an approved override still in force. SoD is checked against it.
  v_set := public.role_pack_text_array(v_item->'mandatory') || coalesce((
    SELECT array_agg(o.payload->>'permission') FROM public.tenant_role_overrides o
     WHERE o.org_id = NEW.org_id AND o.template_code = NEW.template_code AND o.override_kind = 'add_optional_permission'
       AND o.approved_by IS NOT NULL AND (o.effective_to IS NULL OR o.effective_to > pg_catalog.now())), ARRAY[]::text[]);

  -- Each kind accepts exactly its own keys; anything else (for example a guardrail or SoD key) is refused.
  v_allowed := CASE NEW.override_kind
    WHEN 'rename' THEN ARRAY['name']
    WHEN 'enable' THEN ARRAY[]::text[]
    WHEN 'disable' THEN ARRAY['reason']
    WHEN 'add_optional_permission' THEN ARRAY['permission']
    WHEN 'remove_optional_permission' THEN ARRAY['permission']
    WHEN 'scope_narrow' THEN ARRAY['scope']
    WHEN 'approval_limit' THEN ARRAY['limit_ngn']
    WHEN 'add_responsibility' THEN ARRAY['responsibility'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.payload) k WHERE NOT (k = ANY (v_allowed))) THEN
    RAISE EXCEPTION 'override % accepts only %; guardrails and separation of duties cannot be overridden',
      NEW.override_kind, v_allowed USING ERRCODE = '42501';
  END IF;

  IF NEW.override_kind = 'rename' THEN
    IF length(btrim(coalesce(NEW.payload->>'name', ''))) NOT BETWEEN 2 AND 120 THEN
      RAISE EXCEPTION 'a rename needs a name of 2 to 120 characters' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.override_kind = 'add_optional_permission' THEN
    v_perm := NEW.payload->>'permission';
    IF NOT (v_perm = ANY (public.role_pack_text_array(v_item->'optional'))) THEN
      RAISE EXCEPTION 'permission % is not an optional permission of %', v_perm, NEW.template_code USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.code = v_perm AND c.protected) THEN
      RAISE EXCEPTION 'protected permission % cannot be added by an override', v_perm USING ERRCODE = '42501';
    END IF;
    v_sod := public.role_pack_sod_violation(v_set || v_perm);
    IF v_sod IS NOT NULL THEN
      RAISE EXCEPTION 'separation of duties: %', v_sod USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.override_kind = 'remove_optional_permission' THEN
    v_perm := NEW.payload->>'permission';
    IF v_perm = ANY (public.role_pack_text_array(v_item->'mandatory'))
       OR EXISTS (SELECT 1 FROM public.role_template_permissions tp
                   WHERE tp.template_code = NEW.template_code AND tp.permission_code = v_perm AND tp.kind = 'mandatory') THEN
      RAISE EXCEPTION 'mandatory permission % cannot be removed', v_perm USING ERRCODE = '42501';
    END IF;
    IF NOT (v_perm = ANY (public.role_pack_text_array(v_item->'optional'))) THEN
      RAISE EXCEPTION 'permission % is not an optional permission of %', v_perm, NEW.template_code USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.override_kind = 'scope_narrow' THEN
    IF public.role_pack_scope_rank(NEW.payload->>'scope') IS NULL
       OR public.role_pack_scope_rank(NEW.payload->>'scope') <= public.role_pack_scope_rank(v_tpl.default_scope) THEN
      RAISE EXCEPTION 'scope % does not narrow %', NEW.payload->>'scope', v_tpl.default_scope USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.override_kind = 'approval_limit' THEN
    IF jsonb_typeof(NEW.payload->'limit_ngn') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'approval_limit needs a numeric limit_ngn' USING ERRCODE = '22023';
    END IF;
    v_limit := (NEW.payload->>'limit_ngn')::numeric;
    IF v_tpl.approval_limit_ngn IS NULL THEN
      RAISE EXCEPTION 'template % carries no approval authority to limit', NEW.template_code USING ERRCODE = '42501';
    END IF;
    IF v_limit < 0 OR v_limit > v_tpl.approval_limit_ngn THEN
      RAISE EXCEPTION 'an approval limit can only be lowered (ceiling %)', v_tpl.approval_limit_ngn USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.override_kind = 'add_responsibility' THEN
    SELECT i.payload INTO v_item FROM public.role_pack_items i
     WHERE i.pack_code = v_pack AND i.pack_version = v_ver AND i.item_kind = 'responsibility'
       AND i.item_ref = NEW.payload->>'responsibility';
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'responsibility % is not part of the installed pack', NEW.payload->>'responsibility' USING ERRCODE = '42501';
    END IF;
    SELECT x INTO v_perm FROM unnest(public.role_pack_text_array(v_item->'permissions')) x
      JOIN public.permission_catalog c ON c.code = x
     WHERE c.protected AND NOT (x = ANY (v_set)) LIMIT 1;
    IF v_perm IS NOT NULL THEN
      RAISE EXCEPTION 'responsibility would add protected permission %', v_perm USING ERRCODE = '42501';
    END IF;
    v_sod := public.role_pack_sod_violation(v_set || public.role_pack_text_array(v_item->'permissions'));
    IF v_sod IS NOT NULL THEN
      RAISE EXCEPTION 'separation of duties: %', v_sod USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS tenant_role_overrides_guard_trg ON public.tenant_role_overrides;
CREATE TRIGGER tenant_role_overrides_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_role_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tenant_role_overrides_guard();

-- -----------------------------------------------------------------------------
-- 7. org_custom_roles: four-eyes, no protected permission, no SoD violation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_custom_roles (
  id                 uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  code               text NOT NULL CHECK (code ~ '^custom\.[a-z0-9_.-]{2,60}$'),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  base_template_code text REFERENCES public.role_templates(code),
  permissions        text[] NOT NULL DEFAULT '{}',
  responsibilities   text[] NOT NULL DEFAULT '{}',
  scope_ceiling      text NOT NULL DEFAULT 'org'
                       CHECK (scope_ceiling IN ('org', 'campus', 'faculty', 'department', 'class', 'self')),
  workspace_category text NOT NULL CHECK (workspace_category ~ '^[a-z][a-z0-9_]{1,63}$'),
  layout             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(layout) = 'object'),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'active', 'retired')),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by         uuid NOT NULL,
  approved_by        uuid,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT org_custom_roles_version_once UNIQUE (org_id, code, version),
  CONSTRAINT org_custom_roles_four_eyes CHECK (approved_by IS NULL OR approved_by <> created_by),
  CONSTRAINT org_custom_roles_active_approved CHECK (status NOT IN ('active', 'retired') OR approved_by IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_custom_roles_one_active
  ON public.org_custom_roles (org_id, code) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.org_custom_roles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  v_bad text;
  v_sod text;
  v_base_scope text;
  v_base_mand text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'only a draft custom role can be deleted; retire it instead' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'custom role identity is immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status IN ('active', 'retired') AND (
         NEW.name IS DISTINCT FROM OLD.name OR NEW.base_template_code IS DISTINCT FROM OLD.base_template_code
         OR NEW.permissions IS DISTINCT FROM OLD.permissions OR NEW.responsibilities IS DISTINCT FROM OLD.responsibilities
         OR NEW.scope_ceiling IS DISTINCT FROM OLD.scope_ceiling OR NEW.workspace_category IS DISTINCT FROM OLD.workspace_category
         OR NEW.layout IS DISTINCT FROM OLD.layout OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
      RAISE EXCEPTION 'an approved custom role is immutable; create a new version' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'draft' AND NEW.status = 'pending_approval')
      OR (OLD.status = 'pending_approval' AND NEW.status IN ('draft', 'active'))
      OR (OLD.status = 'active' AND NEW.status = 'retired')) THEN
      RAISE EXCEPTION 'custom role status cannot move % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'draft' THEN
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;
    NEW.updated_at := pg_catalog.now();
  ELSE
    IF NEW.status NOT IN ('draft', 'pending_approval') THEN
      RAISE EXCEPTION 'a custom role starts as a draft and is activated by a second administrator' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.created_by <> auth.uid() THEN
      RAISE EXCEPTION 'the creator is the caller' USING ERRCODE = '42501';
    END IF;
    IF NOT public.role_pack_user_in_org(NEW.created_by, NEW.org_id) THEN
      RAISE EXCEPTION 'the creator is not a member of this organization' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;

  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    IF NEW.approved_by IS NULL OR NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'four-eyes: a custom role is activated by a second administrator, not its creator' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.approved_by <> auth.uid() THEN
      RAISE EXCEPTION 'the approver is the caller' USING ERRCODE = '42501';
    END IF;
    IF NOT public.role_pack_user_in_org(NEW.approved_by, NEW.org_id) THEN
      RAISE EXCEPTION 'the approver is not a member of this organization' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(NEW.layout->'nav') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.layout->'nav') <> 3 THEN
      RAISE EXCEPTION 'an active custom role has exactly three primary navigation sections' USING ERRCODE = '22023';
    END IF;
    NEW.approved_at := pg_catalog.now();
  ELSIF NEW.status = 'pending_approval' AND NEW.approved_by IS NOT NULL THEN
    RAISE EXCEPTION 'approval happens on activation' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM unnest(NEW.permissions) x) <> (SELECT count(DISTINCT x) FROM unnest(NEW.permissions) x) THEN
    RAISE EXCEPTION 'duplicate permission in custom role' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_bad FROM unnest(NEW.permissions) x
   WHERE NOT EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.code = x) LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown permission %', v_bad USING ERRCODE = '22023'; END IF;
  SELECT x INTO v_bad FROM unnest(NEW.permissions) x JOIN public.permission_catalog c ON c.code = x WHERE c.protected LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'protected permission % cannot be put in a custom role', v_bad USING ERRCODE = '42501';
  END IF;
  SELECT x INTO v_bad FROM unnest(NEW.responsibilities) x WHERE x !~ '^[a-z][a-z0-9_.:-]{1,79}$' LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'malformed responsibility code %', v_bad USING ERRCODE = '22023'; END IF;

  IF NEW.base_template_code IS NOT NULL THEN
    SELECT t.default_scope INTO v_base_scope FROM public.role_templates t WHERE t.code = NEW.base_template_code;
    IF public.role_pack_scope_rank(NEW.scope_ceiling) < public.role_pack_scope_rank(v_base_scope) THEN
      RAISE EXCEPTION 'scope ceiling % is wider than the base template scope %', NEW.scope_ceiling, v_base_scope
        USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(tp.permission_code), ARRAY[]::text[]) INTO v_base_mand
      FROM public.role_template_permissions tp WHERE tp.template_code = NEW.base_template_code AND tp.kind = 'mandatory';
  END IF;
  v_sod := public.role_pack_sod_violation(NEW.permissions || v_base_mand);
  IF v_sod IS NOT NULL THEN
    RAISE EXCEPTION 'separation of duties: %', v_sod USING ERRCODE = '42501';
  END IF;
  IF NEW.layout ? 'nav' AND (jsonb_typeof(NEW.layout->'nav') <> 'array' OR jsonb_array_length(NEW.layout->'nav') > 3) THEN
    RAISE EXCEPTION 'a layout has at most three primary navigation sections' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS org_custom_roles_guard_trg ON public.org_custom_roles;
CREATE TRIGGER org_custom_roles_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.org_custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.org_custom_roles_guard();

-- -----------------------------------------------------------------------------
-- 8. Audit, RLS and grants
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_tenant_role_pack_installations_audit ON public.tenant_role_pack_installations;
CREATE TRIGGER trg_tenant_role_pack_installations_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_role_pack_installations
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
DROP TRIGGER IF EXISTS trg_tenant_role_overrides_audit ON public.tenant_role_overrides;
CREATE TRIGGER trg_tenant_role_overrides_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_role_overrides
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
DROP TRIGGER IF EXISTS trg_org_custom_roles_audit ON public.org_custom_roles;
CREATE TRIGGER trg_org_custom_roles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.org_custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();

ALTER TABLE public.role_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_pack_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_pack_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_pack_migrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_pack_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_pack_installations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_custom_roles FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.role_pack_items, public.role_pack_migrations, public.tenant_role_pack_installations,
  public.tenant_role_overrides, public.org_custom_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.role_pack_items, public.role_pack_migrations, public.tenant_role_pack_installations,
  public.tenant_role_overrides, public.org_custom_roles TO authenticated;
GRANT ALL ON TABLE public.role_pack_items, public.role_pack_migrations, public.tenant_role_pack_installations,
  public.tenant_role_overrides, public.org_custom_roles TO service_role;

-- Catalogue: readable once published (drafts stay with the service role).
DROP POLICY IF EXISTS role_pack_items_read_published ON public.role_pack_items;
CREATE POLICY role_pack_items_read_published ON public.role_pack_items FOR SELECT TO authenticated
  USING (public.role_pack_is_released(pack_code, pack_version));
DROP POLICY IF EXISTS role_pack_migrations_read_published ON public.role_pack_migrations;
CREATE POLICY role_pack_migrations_read_published ON public.role_pack_migrations FOR SELECT TO authenticated
  USING (public.role_pack_is_released(from_pack_code, to_version));
-- Tenant records: administrators of the caller's own organization only.
DROP POLICY IF EXISTS tenant_role_pack_installations_admin_read ON public.tenant_role_pack_installations;
CREATE POLICY tenant_role_pack_installations_admin_read ON public.tenant_role_pack_installations FOR SELECT TO authenticated
  USING (public.role_pack_caller_is_org_admin(org_id));
DROP POLICY IF EXISTS tenant_role_overrides_admin_read ON public.tenant_role_overrides;
CREATE POLICY tenant_role_overrides_admin_read ON public.tenant_role_overrides FOR SELECT TO authenticated
  USING (public.role_pack_caller_is_org_admin(org_id));
DROP POLICY IF EXISTS org_custom_roles_admin_read ON public.org_custom_roles;
CREATE POLICY org_custom_roles_admin_read ON public.org_custom_roles FOR SELECT TO authenticated
  USING (public.role_pack_caller_is_org_admin(org_id));

-- -----------------------------------------------------------------------------
-- 9. Install, upgrade preview, upgrade apply
-- -----------------------------------------------------------------------------
-- Diff of two versions of one pack (internal; read-only).
CREATE OR REPLACE FUNCTION public.role_pack_diff(p_code text, p_from text, p_to text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH f AS (
    SELECT i.item_ref AS tpl, public.role_pack_template_permissions(p_code, p_from, i.item_ref) AS perms
      FROM public.role_pack_items i WHERE i.pack_code = p_code AND i.pack_version = p_from AND i.item_kind = 'template'),
  t AS (
    SELECT i.item_ref AS tpl, public.role_pack_template_permissions(p_code, p_to, i.item_ref) AS perms
      FROM public.role_pack_items i WHERE i.pack_code = p_code AND i.pack_version = p_to AND i.item_kind = 'template'),
  fp AS (SELECT f.tpl, unnest(f.perms) AS perm FROM f),
  tp AS (SELECT t.tpl, unnest(t.perms) AS perm FROM t),
  gained AS (SELECT * FROM tp EXCEPT SELECT * FROM fp),
  lost AS (SELECT * FROM fp EXCEPT SELECT * FROM tp)
  SELECT pg_catalog.jsonb_build_object(
    'pack_code', p_code, 'from_version', p_from, 'to_version', p_to,
    'templates_gained', coalesce((SELECT jsonb_agg(t.tpl ORDER BY t.tpl) FROM t WHERE t.tpl NOT IN (SELECT f.tpl FROM f)), '[]'::jsonb),
    'templates_lost', coalesce((SELECT jsonb_agg(f.tpl ORDER BY f.tpl) FROM f WHERE f.tpl NOT IN (SELECT t.tpl FROM t)), '[]'::jsonb),
    'permissions_gained', coalesce((SELECT jsonb_agg(jsonb_build_object('template', g.tpl, 'permission', g.perm) ORDER BY g.tpl, g.perm) FROM gained g), '[]'::jsonb),
    'permissions_lost', coalesce((SELECT jsonb_agg(jsonb_build_object('template', l.tpl, 'permission', l.perm) ORDER BY l.tpl, l.perm) FROM lost l), '[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.role_pack_install(p_org uuid, p_pack_code text, p_pack_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_pack public.cg_role_pack%ROWTYPE;
  v_active public.tenant_role_pack_installations%ROWTYPE;
  v_id uuid;
BEGIN
  -- Provisioning: the trusted server only. The organization comes from the server's own
  -- provisioning plan, never from a tenant user.
  IF NOT public.role_pack_caller_is_service() THEN
    RAISE EXCEPTION 'role packs are installed by the provisioning service only' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = p_org) THEN
    RAISE EXCEPTION 'unknown organization' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pack FROM public.cg_role_pack p WHERE p.code = p_pack_code AND p.version = p_pack_version;
  IF v_pack.code IS NULL OR v_pack.kind <> 'institution_pack' THEN
    RAISE EXCEPTION 'unknown institution pack % %', p_pack_code, p_pack_version USING ERRCODE = '22023';
  END IF;
  IF v_pack.status <> 'published' THEN
    RAISE EXCEPTION 'role pack % % is % and cannot be installed', p_pack_code, p_pack_version, v_pack.status
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('role_pack_install:' || p_org::text, 0));
  SELECT * INTO v_active FROM public.tenant_role_pack_installations i WHERE i.org_id = p_org AND i.status = 'active';
  IF v_active.id IS NOT NULL THEN
    IF v_active.pack_code = p_pack_code AND v_active.pack_version = p_pack_version THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'already_installed', 'installation_id', v_active.id,
        'pack_code', p_pack_code, 'pack_version', p_pack_version);
    END IF;
    RAISE EXCEPTION 'organization already runs % %; use role_pack_upgrade_apply', v_active.pack_code, v_active.pack_version
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_role_pack_installations i
              WHERE i.org_id = p_org AND i.pack_code = p_pack_code AND i.pack_version = p_pack_version) THEN
    RAISE EXCEPTION 'pack % % was installed before and is no longer active', p_pack_code, p_pack_version USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.tenant_role_pack_installations (org_id, pack_code, pack_version, installed_by, status)
  VALUES (p_org, p_pack_code, p_pack_version, auth.uid(), 'active')
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (p_org, (SELECT u.id FROM public.users u WHERE u.id = auth.uid()), 'role_pack.install',
          'tenant_role_pack_installations', v_id, NULL,
          pg_catalog.jsonb_build_object('pack_code', p_pack_code, 'pack_version', p_pack_version,
                                        'actor', auth.uid(), 'recorded_at', pg_catalog.now()));
  RETURN pg_catalog.jsonb_build_object('outcome', 'installed', 'installation_id', v_id,
    'pack_code', p_pack_code, 'pack_version', p_pack_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.role_pack_upgrade_preview(p_org uuid, p_to_version text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_active public.tenant_role_pack_installations%ROWTYPE;
  v_target public.cg_role_pack%ROWTYPE;
  v_diff jsonb;
  v_steps jsonb;
BEGIN
  IF NOT (public.role_pack_caller_is_service() OR public.role_pack_caller_is_org_admin(p_org)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_active FROM public.tenant_role_pack_installations i WHERE i.org_id = p_org AND i.status = 'active';
  IF v_active.id IS NULL THEN
    RAISE EXCEPTION 'the organization has no installed role pack' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_target FROM public.cg_role_pack p WHERE p.code = v_active.pack_code AND p.version = p_to_version;
  IF v_target.code IS NULL OR v_target.status <> 'published' THEN
    RAISE EXCEPTION 'role pack % % is not published', v_active.pack_code, p_to_version USING ERRCODE = '42501';
  END IF;
  IF string_to_array(p_to_version, '.')::int[] <= string_to_array(v_active.pack_version, '.')::int[] THEN
    RAISE EXCEPTION 'an upgrade moves forward (% -> %)', v_active.pack_version, p_to_version USING ERRCODE = '22023';
  END IF;
  SELECT m.steps INTO v_steps FROM public.role_pack_migrations m
   WHERE m.from_pack_code = v_active.pack_code AND m.from_version = v_active.pack_version AND m.to_version = p_to_version;
  v_diff := public.role_pack_diff(v_active.pack_code, v_active.pack_version, p_to_version);
  RETURN v_diff || pg_catalog.jsonb_build_object(
    'migration_declared', v_steps IS NOT NULL,
    'steps', coalesce(v_steps, '[]'::jsonb),
    'overrides_to_end', coalesce((
      SELECT jsonb_agg(o.id ORDER BY o.created_at, o.id) FROM public.tenant_role_overrides o
       WHERE o.org_id = p_org AND (o.effective_to IS NULL OR o.effective_to > pg_catalog.now())
         AND o.template_code IN (SELECT jsonb_array_elements_text(v_diff->'templates_lost'))), '[]'::jsonb));
END
$function$;

CREATE OR REPLACE FUNCTION public.role_pack_upgrade_apply(p_org uuid, p_to_version text, p_expected_from_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_active public.tenant_role_pack_installations%ROWTYPE;
  v_preview jsonb;
  v_id uuid;
  v_ended integer;
BEGIN
  IF NOT (public.role_pack_caller_is_service() OR public.role_pack_caller_is_org_admin(p_org)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('role_pack_install:' || p_org::text, 0));
  SELECT * INTO v_active FROM public.tenant_role_pack_installations i
   WHERE i.org_id = p_org AND i.status = 'active' FOR UPDATE;
  IF v_active.id IS NULL THEN
    RAISE EXCEPTION 'the organization has no installed role pack' USING ERRCODE = '55000';
  END IF;
  IF v_active.pack_version IS DISTINCT FROM p_expected_from_version THEN
    RAISE EXCEPTION 'the installed version is %, not %; preview again', v_active.pack_version, p_expected_from_version
      USING ERRCODE = '40001';
  END IF;
  v_preview := public.role_pack_upgrade_preview(p_org, p_to_version);
  IF NOT (v_preview->>'migration_declared')::boolean THEN
    RAISE EXCEPTION 'no declared migration from % % to %', v_active.pack_code, v_active.pack_version, p_to_version
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.tenant_role_pack_installations SET status = 'superseded' WHERE id = v_active.id;
  INSERT INTO public.tenant_role_pack_installations (org_id, pack_code, pack_version, installed_by, status, upgrade_from)
  VALUES (p_org, v_active.pack_code, p_to_version, auth.uid(), 'active', v_active.pack_version)
  RETURNING id INTO v_id;
  -- Overrides on templates the new version no longer carries end now (kept as history).
  UPDATE public.tenant_role_overrides o SET effective_to = greatest(o.effective_from, pg_catalog.now())
   WHERE o.org_id = p_org AND o.id IN (SELECT (jsonb_array_elements_text(v_preview->'overrides_to_end'))::uuid);
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (p_org, (SELECT u.id FROM public.users u WHERE u.id = auth.uid()), 'role_pack.upgrade.apply',
          'tenant_role_pack_installations', v_id,
          pg_catalog.jsonb_build_object('installation_id', v_active.id, 'pack_version', v_active.pack_version),
          v_preview || pg_catalog.jsonb_build_object('actor', auth.uid(), 'overrides_ended', v_ended,
                                                     'recorded_at', pg_catalog.now()));
  RETURN v_preview || pg_catalog.jsonb_build_object('outcome', 'upgraded', 'installation_id', v_id,
                                                    'overrides_ended', v_ended);
END
$function$;

REVOKE ALL ON FUNCTION
  public.role_pack_caller_is_service(),
  public.role_pack_caller_is_org_admin(uuid),
  public.role_pack_is_released(text, text),
  public.role_pack_user_in_org(uuid, uuid),
  public.role_pack_scope_rank(text),
  public.role_pack_text_array(jsonb),
  public.role_pack_sod_violation(text[]),
  public.role_pack_template_permissions(text, text, text),
  public.role_pack_diff(text, text, text),
  public.role_pack_items_guard(),
  public.role_pack_migrations_guard(),
  public.tenant_role_pack_installations_guard(),
  public.tenant_role_overrides_guard(),
  public.org_custom_roles_guard(),
  public.role_pack_install(uuid, text, text),
  public.role_pack_upgrade_preview(uuid, text),
  public.role_pack_upgrade_apply(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
-- The read policies call this helper as the querying role.
GRANT EXECUTE ON FUNCTION public.role_pack_caller_is_org_admin(uuid), public.role_pack_is_released(text, text)
  TO authenticated, service_role;
-- The guard triggers call these as the writing role, which is the service role.
GRANT EXECUTE ON FUNCTION
  public.role_pack_user_in_org(uuid, uuid),
  public.role_pack_scope_rank(text),
  public.role_pack_text_array(jsonb),
  public.role_pack_sod_violation(text[]),
  public.role_pack_template_permissions(text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.role_pack_install(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.role_pack_upgrade_preview(uuid, text), public.role_pack_upgrade_apply(uuid, text, text)
  TO authenticated, service_role;
