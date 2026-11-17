-- Rollback for 20261117001100_sherivs_m2_role_pack_engine.sql (M2 part B, ADR-114). NOT APPLIED.
-- Removes the Roles Pack Engine tables and functions and restores ENGINE-01's cg_role_pack kind
-- check and guard exactly.
--
-- Fail closed: cg_role_pack keeps published packs forever (ENGINE-01 guard). If any
-- 'institution_pack' row exists, the kind check cannot be restored without deleting catalogue
-- history, so this rollback STOPS unless the operator has set, in the same session:
--   SET sherivs.rollback_purge_institution_packs = 'on';
-- With that setting the institution pack rows are deleted with the guard trigger disabled for that
-- one statement. Tenant installation, override and custom-role rows are dropped with their tables
-- (their audit rows remain in audit_logs).

DO $$
BEGIN
  IF to_regclass('public.cg_role_pack') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cg_role_pack WHERE kind = 'institution_pack')
     AND coalesce(current_setting('sherivs.rollback_purge_institution_packs', true), '') <> 'on' THEN
    RAISE EXCEPTION 'institution packs exist; set sherivs.rollback_purge_institution_packs = on to purge them'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.role_pack_upgrade_apply(uuid, text, text);
DROP FUNCTION IF EXISTS public.role_pack_upgrade_preview(uuid, text);
DROP FUNCTION IF EXISTS public.role_pack_install(uuid, text, text);
DROP FUNCTION IF EXISTS public.role_pack_diff(text, text, text);

DROP TABLE IF EXISTS public.org_custom_roles;
DROP TABLE IF EXISTS public.tenant_role_overrides;
DROP TABLE IF EXISTS public.tenant_role_pack_installations;
DROP TABLE IF EXISTS public.role_pack_migrations;
DROP TABLE IF EXISTS public.role_pack_items;

DROP FUNCTION IF EXISTS public.org_custom_roles_guard();
DROP FUNCTION IF EXISTS public.tenant_role_overrides_guard();
DROP FUNCTION IF EXISTS public.tenant_role_pack_installations_guard();
DROP FUNCTION IF EXISTS public.role_pack_migrations_guard();
DROP FUNCTION IF EXISTS public.role_pack_items_guard();
DROP FUNCTION IF EXISTS public.role_pack_template_permissions(text, text, text);
DROP FUNCTION IF EXISTS public.role_pack_sod_violation(text[]);
DROP FUNCTION IF EXISTS public.role_pack_text_array(jsonb);
DROP FUNCTION IF EXISTS public.role_pack_scope_rank(text);
DROP FUNCTION IF EXISTS public.role_pack_user_in_org(uuid, uuid);
DROP FUNCTION IF EXISTS public.role_pack_caller_is_org_admin(uuid);
DROP FUNCTION IF EXISTS public.role_pack_is_released(text, text);
DROP FUNCTION IF EXISTS public.role_pack_caller_is_service();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cg_role_pack WHERE kind = 'institution_pack') THEN
    ALTER TABLE public.cg_role_pack DISABLE TRIGGER cg_role_pack_guard_trg;
    DELETE FROM public.cg_role_pack WHERE kind = 'institution_pack';
    ALTER TABLE public.cg_role_pack ENABLE TRIGGER cg_role_pack_guard_trg;
  END IF;
END $$;

ALTER TABLE public.cg_role_pack DROP CONSTRAINT IF EXISTS cg_role_pack_kind_check;
ALTER TABLE public.cg_role_pack ADD CONSTRAINT cg_role_pack_kind_check
  CHECK (kind IN ('tenant_role', 'platform_role'));

-- ENGINE-01 guard, verbatim.
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

  -- Draft or new rows: validate the hard invariants (defence in depth; the
  -- complete validator runs in the application before any publish).
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

  v_max_rank := CASE NEW.kind WHEN 'tenant_role' THEN 2 ELSE 3 END;
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
