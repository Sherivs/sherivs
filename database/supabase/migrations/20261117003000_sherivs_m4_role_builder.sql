-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M4 (ADR-116): custom role and responsibility builder, delegation bounds, acting context.
--
-- Builds on, and does not replace:
--   * 20261117001100 (M2 part B, ADR-114): org_custom_roles and its four-eyes guard. This file adds
--     definer functions that drive the existing status machine with the caller's JWT, so the guard's
--     "approver is the caller" and "approver is not the creator" checks always run. There is no second
--     approval path: approval is the guard's pending_approval -> active transition.
--   * SHERIVS-017 / M009-A1: role_catalog, org_role_permission_settings, org_role_custom_grants,
--     workspace_responsibility_catalog, workspace_role_responsibilities, role_assignment_delegations.
--     Activation materialises an approved custom role into those tables (the bridge ADR-114 left to
--     M4), so assignment, effective permissions, SoD triggers and the M009 audit keep working as-is.
--   * M13 access reviews are complete in the database; nothing is added for them here.
--
-- Contents:
--   1. Delegations can never outlive (or start before) their source assignment: a row guard, plus a
--      trigger that trims or revokes delegations when the source assignment is shortened or ended.
--   2. workspace_responsibility_catalog gains description, evidence_required and review_cadence_days;
--      workspace_responsibility_define creates an organization responsibility with them.
--   3. custom_role_save_draft / _submit / _withdraw / _approve / _activate.
--   4. workspace_my_acting_context: the caller's active delegations and acting assignments (banner).
-- The organization is always public.get_my_school_id(); no function takes an organization argument.

-- -----------------------------------------------------------------------------
-- 0. Preconditions
-- -----------------------------------------------------------------------------
DO $guard$
BEGIN
  IF to_regclass('public.org_custom_roles') IS NULL
     OR to_regclass('public.role_assignment_delegations') IS NULL
     OR to_regclass('public.workspace_responsibility_catalog') IS NULL
     OR to_regclass('public.org_role_custom_grants') IS NULL
     OR to_regprocedure('public.role_pack_caller_is_org_admin(uuid)') IS NULL
     OR to_regprocedure('public.role_pack_sod_violation(text[])') IS NULL
     OR to_regprocedure('public.can_manage_roles(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M4 requires the M2 role pack engine (20261117001100) and the M009 role engine'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

-- -----------------------------------------------------------------------------
-- 1. Delegation bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.role_assignment_delegation_bounds_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  v_a public.user_role_assignments%ROWTYPE;
BEGIN
  -- Revoking (or any change that leaves the window alone) is always allowed.
  IF TG_OP = 'UPDATE'
     AND NEW.assignment_id IS NOT DISTINCT FROM OLD.assignment_id
     AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
     AND NEW.valid_from IS NOT DISTINCT FROM OLD.valid_from
     AND NEW.valid_until IS NOT DISTINCT FROM OLD.valid_until THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
                           OR NEW.org_id IS DISTINCT FROM OLD.org_id
                           OR NEW.delegate_user_id IS DISTINCT FROM OLD.delegate_user_id) THEN
    RAISE EXCEPTION 'a delegation keeps its source assignment and delegate' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.valid_until > OLD.valid_until OR NEW.valid_from < OLD.valid_from) THEN
    RAISE EXCEPTION 'a delegation window can only be shortened; grant a new delegation instead'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.user_role_assignments WHERE id = NEW.assignment_id;
  IF v_a.id IS NULL OR v_a.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'the source assignment belongs to another organization' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND v_a.status <> 'active' THEN
    RAISE EXCEPTION 'the source assignment is not active' USING ERRCODE = '42501';
  END IF;
  IF NEW.valid_from < v_a.started_at THEN
    RAISE EXCEPTION 'a delegation cannot start before its source assignment (%)', v_a.started_at
      USING ERRCODE = '22023';
  END IF;
  IF v_a.valid_until IS NOT NULL AND NEW.valid_until > v_a.valid_until THEN
    RAISE EXCEPTION 'a delegation cannot end after its source assignment (%)', v_a.valid_until
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS trg_role_assignment_delegation_bounds ON public.role_assignment_delegations;
CREATE TRIGGER trg_role_assignment_delegation_bounds
  BEFORE INSERT OR UPDATE ON public.role_assignment_delegations
  FOR EACH ROW EXECUTE FUNCTION public.role_assignment_delegation_bounds_guard();

-- When the source assignment ends or is shortened, its delegations follow it.
CREATE OR REPLACE FUNCTION public.role_assignment_delegation_follow_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN
    v_actor := NULL;
  END IF;
  IF NEW.status <> 'active' THEN
    UPDATE public.role_assignment_delegations
       SET revoked_at = pg_catalog.now(), revoked_by = v_actor
     WHERE assignment_id = NEW.id AND revoked_at IS NULL;
  ELSIF NEW.valid_until IS NOT NULL
        AND (OLD.valid_until IS NULL OR NEW.valid_until < OLD.valid_until) THEN
    UPDATE public.role_assignment_delegations
       SET revoked_at = pg_catalog.now(), revoked_by = v_actor
     WHERE assignment_id = NEW.id AND revoked_at IS NULL AND valid_from >= NEW.valid_until;
    UPDATE public.role_assignment_delegations
       SET valid_until = NEW.valid_until
     WHERE assignment_id = NEW.id AND revoked_at IS NULL AND valid_until > NEW.valid_until;
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS trg_user_role_assignments_delegation_follow ON public.user_role_assignments;
CREATE TRIGGER trg_user_role_assignments_delegation_follow
  AFTER UPDATE OF status, valid_until ON public.user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.role_assignment_delegation_follow_source();

-- -----------------------------------------------------------------------------
-- 2. Custom responsibility builder
-- -----------------------------------------------------------------------------
ALTER TABLE public.workspace_responsibility_catalog
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS evidence_required text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_cadence_days integer;
ALTER TABLE public.workspace_responsibility_catalog
  DROP CONSTRAINT IF EXISTS workspace_responsibility_catalog_m4_description_chk;
ALTER TABLE public.workspace_responsibility_catalog
  ADD CONSTRAINT workspace_responsibility_catalog_m4_description_chk
  CHECK (description IS NULL OR length(description) <= 600);
ALTER TABLE public.workspace_responsibility_catalog
  DROP CONSTRAINT IF EXISTS workspace_responsibility_catalog_m4_cadence_chk;
ALTER TABLE public.workspace_responsibility_catalog
  ADD CONSTRAINT workspace_responsibility_catalog_m4_cadence_chk
  CHECK (review_cadence_days IS NULL OR review_cadence_days BETWEEN 7 AND 730);
ALTER TABLE public.workspace_responsibility_catalog
  DROP CONSTRAINT IF EXISTS workspace_responsibility_catalog_m4_evidence_chk;
ALTER TABLE public.workspace_responsibility_catalog
  ADD CONSTRAINT workspace_responsibility_catalog_m4_evidence_chk
  CHECK (cardinality(evidence_required) <= 12);

CREATE OR REPLACE FUNCTION public.workspace_responsibility_define(
  p_code text, p_label text, p_description text, p_permissions text[],
  p_evidence_required text[], p_review_cadence_days integer,
  p_daily_priority integer, p_primary_nav_id text, p_primary_nav_label text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.get_my_school_id();
  v_id uuid;
  v_bad text;
  v_sod text;
  v_perms text[] := coalesce(p_permissions, ARRAY[]::text[]);
  v_evidence text[] := coalesce(p_evidence_required, ARRAY[]::text[]);
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT public.can_manage_roles(v_org, 'roles.configure') THEN
    RAISE EXCEPTION 'roles.configure required' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z][a-z0-9_.-]{1,63}$' OR p_code LIKE 'nav.%'
     OR length(btrim(coalesce(p_label, ''))) < 2 THEN
    RAISE EXCEPTION 'invalid responsibility code or name' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_perms) = 0 THEN
    RAISE EXCEPTION 'a responsibility carries at least one permission' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_bad FROM unnest(v_perms) x
   WHERE NOT EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.code = x) LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown permission %', v_bad USING ERRCODE = '22023'; END IF;
  SELECT x INTO v_bad FROM unnest(v_perms) x JOIN public.permission_catalog c ON c.code = x WHERE c.protected LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'protected permission % cannot be granted by a responsibility', v_bad USING ERRCODE = '42501';
  END IF;
  v_sod := public.role_pack_sod_violation(v_perms);
  IF v_sod IS NOT NULL THEN RAISE EXCEPTION 'separation of duties: %', v_sod USING ERRCODE = '42501'; END IF;
  SELECT x INTO v_bad FROM unnest(v_evidence) x WHERE length(btrim(x)) NOT BETWEEN 2 AND 120 LIMIT 1;
  IF v_bad IS NOT NULL OR EXISTS (SELECT 1 FROM unnest(v_evidence) x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'each evidence item has 2 to 120 characters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.workspace_responsibility_catalog (
    org_id, code, label, kind, daily_priority, primary_nav_id, primary_nav_label, created_by,
    description, evidence_required, review_cadence_days
  ) VALUES (
    v_org, p_code, btrim(p_label), 'custom', coalesce(p_daily_priority, 100), p_primary_nav_id,
    btrim(p_primary_nav_label), auth.uid(), nullif(btrim(coalesce(p_description, '')), ''),
    ARRAY(SELECT btrim(x) FROM unnest(v_evidence) x), p_review_cadence_days
  ) RETURNING id INTO v_id;
  INSERT INTO public.workspace_responsibility_permissions (responsibility_id, permission_code, created_by)
  SELECT v_id, x, auth.uid() FROM (SELECT DISTINCT x FROM unnest(v_perms) x) d;
  RETURN v_id;
END
$function$;

-- -----------------------------------------------------------------------------
-- 3. Custom role builder (drives the ADR-114 status machine with the caller's JWT)
-- -----------------------------------------------------------------------------
-- Layout: {"nav":[{"id","label"} x <=3], "widgets":[text x <=12]}. Exactly three nav sections are
-- required to submit; the ADR-114 guard requires them again on activation.
CREATE OR REPLACE FUNCTION public.custom_role_layout_problem(p_layout jsonb, p_require_three boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE
  v_nav jsonb := p_layout->'nav';
  v_item jsonb;
  v_ids text[] := ARRAY[]::text[];
BEGIN
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN RETURN 'layout must be an object'; END IF;
  IF v_nav IS NULL OR jsonb_typeof(v_nav) <> 'array' THEN RETURN 'layout.nav must be a list'; END IF;
  IF jsonb_array_length(v_nav) > 3 THEN RETURN 'a layout has at most three navigation sections'; END IF;
  IF p_require_three AND jsonb_array_length(v_nav) <> 3 THEN
    RETURN 'a custom role has exactly three navigation sections';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_nav) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR coalesce(v_item->>'id', '') !~ '^[a-z][a-z0-9_.-]{1,63}$'
       OR length(btrim(coalesce(v_item->>'label', ''))) NOT BETWEEN 2 AND 60 THEN
      RETURN 'each navigation section has an id (a-z, 0-9, _ . -) and a 2 to 60 character label';
    END IF;
    IF v_item->>'id' = ANY (v_ids) THEN RETURN 'navigation section ids must differ'; END IF;
    v_ids := v_ids || (v_item->>'id');
  END LOOP;
  IF p_layout ? 'widgets' AND (jsonb_typeof(p_layout->'widgets') <> 'array'
       OR jsonb_array_length(p_layout->'widgets') > 12
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_layout->'widgets') w WHERE jsonb_typeof(w) <> 'string')) THEN
    RETURN 'layout.widgets is a list of at most twelve widget keys';
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.custom_role_require_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_org uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT public.role_pack_caller_is_org_admin(v_org) THEN
    RAISE EXCEPTION 'an administrator of this organization is required' USING ERRCODE = '42501';
  END IF;
  RETURN v_org;
END
$function$;

-- The assignable role code that an organization's custom role is materialised as.
CREATE OR REPLACE FUNCTION public.custom_role_catalog_code(p_org uuid, p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'custom.' || replace(p_org::text, '-', '') || '.' || substr(p_code, 8);
$$;

CREATE OR REPLACE FUNCTION public.custom_role_save_draft(
  p_code text, p_name text, p_base_template text, p_permissions text[], p_responsibilities text[],
  p_scope_ceiling text, p_workspace_category text, p_layout jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.custom_role_require_admin();
  v_latest public.org_custom_roles%ROWTYPE;
  v_problem text;
  v_id uuid;
BEGIN
  v_problem := public.custom_role_layout_problem(coalesce(p_layout, '{"nav":[]}'::jsonb), false);
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('m4-custom-role:' || v_org::text || ':' || coalesce(p_code, ''), 0));
  SELECT * INTO v_latest FROM public.org_custom_roles
   WHERE org_id = v_org AND code = p_code ORDER BY version DESC LIMIT 1;
  IF v_latest.id IS NOT NULL AND v_latest.status = 'pending_approval' THEN
    RAISE EXCEPTION 'this role is waiting for approval; withdraw it before editing' USING ERRCODE = '55000';
  END IF;
  IF v_latest.id IS NOT NULL AND v_latest.status = 'draft' THEN
    UPDATE public.org_custom_roles
       SET name = btrim(p_name), base_template_code = p_base_template,
           permissions = coalesce(p_permissions, ARRAY[]::text[]),
           responsibilities = coalesce(p_responsibilities, ARRAY[]::text[]),
           scope_ceiling = coalesce(p_scope_ceiling, 'org'), workspace_category = p_workspace_category,
           layout = coalesce(p_layout, '{"nav":[]}'::jsonb)
     WHERE id = v_latest.id
     RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.org_custom_roles (
    org_id, code, name, base_template_code, permissions, responsibilities, scope_ceiling,
    workspace_category, layout, status, version, created_by
  ) VALUES (
    v_org, p_code, btrim(coalesce(p_name, '')), p_base_template, coalesce(p_permissions, ARRAY[]::text[]),
    coalesce(p_responsibilities, ARRAY[]::text[]), coalesce(p_scope_ceiling, 'org'), p_workspace_category,
    coalesce(p_layout, '{"nav":[]}'::jsonb), 'draft', coalesce(v_latest.version, 0) + 1, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.custom_role_submit(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.custom_role_require_admin();
  v_row public.org_custom_roles%ROWTYPE;
  v_problem text;
BEGIN
  SELECT * INTO v_row FROM public.org_custom_roles WHERE id = p_id AND org_id = v_org FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'custom role not found' USING ERRCODE = '42704'; END IF;
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'only a draft can be submitted' USING ERRCODE = '55000'; END IF;
  v_problem := public.custom_role_layout_problem(v_row.layout, true);
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;
  IF cardinality(v_row.permissions) = 0 AND v_row.base_template_code IS NULL THEN
    RAISE EXCEPTION 'a custom role carries at least one permission' USING ERRCODE = '22023';
  END IF;
  UPDATE public.org_custom_roles SET status = 'pending_approval' WHERE id = p_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.custom_role_withdraw(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_org uuid := public.custom_role_require_admin();
BEGIN
  UPDATE public.org_custom_roles SET status = 'draft'
   WHERE id = p_id AND org_id = v_org AND status = 'pending_approval';
  IF NOT FOUND THEN RAISE EXCEPTION 'no pending custom role to withdraw' USING ERRCODE = '55000'; END IF;
END
$function$;

-- Four-eyes approval: the ADR-114 guard refuses the creator and requires approved_by = auth.uid().
CREATE OR REPLACE FUNCTION public.custom_role_approve(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.custom_role_require_admin();
  v_row public.org_custom_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.org_custom_roles WHERE id = p_id AND org_id = v_org FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'custom role not found' USING ERRCODE = '42704'; END IF;
  IF v_row.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'only a role waiting for approval can be approved' USING ERRCODE = '55000';
  END IF;
  IF v_row.created_by = auth.uid() THEN
    RAISE EXCEPTION 'four-eyes: a custom role is activated by a second administrator, not its creator'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_role_assignments a
              WHERE a.org_id = v_org AND a.user_id = auth.uid() AND a.status = 'active'
                AND a.role_code = public.custom_role_catalog_code(v_org, v_row.code)) THEN
    RAISE EXCEPTION 'no_self_role_grant: you cannot approve a role you hold' USING ERRCODE = '42501';
  END IF;
  UPDATE public.org_custom_roles SET status = 'retired'
   WHERE org_id = v_org AND code = v_row.code AND status = 'active';
  UPDATE public.org_custom_roles SET status = 'active', approved_by = auth.uid() WHERE id = p_id;
END
$function$;

-- Materialise the approved version into the assignable role catalogue. Idempotent.
CREATE OR REPLACE FUNCTION public.custom_role_activate(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.custom_role_require_admin();
  v_row public.org_custom_roles%ROWTYPE;
  v_base public.role_catalog%ROWTYPE;
  v_existing public.role_catalog%ROWTYPE;
  v_code text;
  v_template_perms text[];
  v_extra text[];
  v_nav jsonb;
  v_rcode text;
  v_rid uuid;
  v_keep uuid[] := ARRAY[]::uuid[];
  i integer;
BEGIN
  SELECT * INTO v_row FROM public.org_custom_roles WHERE id = p_id AND org_id = v_org;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'custom role not found' USING ERRCODE = '42704'; END IF;
  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'only an approved custom role can be activated' USING ERRCODE = '55000';
  END IF;
  IF v_row.base_template_code IS NULL THEN
    RAISE EXCEPTION 'a role started from scratch cannot be assigned until a base template is chosen'
      USING ERRCODE = '22023';
  END IF;
  v_code := public.custom_role_catalog_code(v_org, v_row.code);
  PERFORM public.workspace_role_engine_tenant_lock(v_org);
  IF EXISTS (SELECT 1 FROM public.user_role_assignments a
              WHERE a.org_id = v_org AND a.user_id = auth.uid() AND a.status = 'active' AND a.role_code = v_code) THEN
    RAISE EXCEPTION 'no_self_role_grant: you cannot change a role you hold' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_base FROM public.role_catalog
   WHERE org_id IS NULL AND template_code = v_row.base_template_code ORDER BY code LIMIT 1;
  IF v_base.code IS NULL THEN
    RAISE EXCEPTION 'no catalogue role uses template %', v_row.base_template_code USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.role_catalog WHERE code = v_code;
  IF v_existing.code IS NULL THEN
    INSERT INTO public.role_catalog (code, name, category, template_code, institution_types, org_id,
                                     base_role_code, description, created_by)
    VALUES (v_code, v_row.name, 'Custom', v_row.base_template_code, v_base.institution_types, v_org,
            v_base.code, 'org_custom_roles:' || v_row.id::text, auth.uid());
  ELSIF v_existing.org_id IS DISTINCT FROM v_org OR v_existing.template_code <> v_row.base_template_code THEN
    RAISE EXCEPTION 'a new version cannot change the base template; create a role with a new code'
      USING ERRCODE = '42501';
  ELSE
    UPDATE public.role_catalog SET name = v_row.name, description = 'org_custom_roles:' || v_row.id::text
     WHERE code = v_code;
  END IF;

  -- Optional template permissions: on exactly when the draft lists them.
  INSERT INTO public.org_role_permission_settings (org_id, role_code, permission_code, enabled, updated_by)
  SELECT v_org, v_code, tp.permission_code, tp.permission_code = ANY (v_row.permissions), auth.uid()
    FROM public.role_template_permissions tp
   WHERE tp.template_code = v_row.base_template_code AND tp.kind = 'optional'
  ON CONFLICT (org_id, role_code, permission_code)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = pg_catalog.now();

  -- Permissions outside the template: custom grants (protected ones are refused by both guards).
  SELECT coalesce(array_agg(tp.permission_code), ARRAY[]::text[]) INTO v_template_perms
    FROM public.role_template_permissions tp WHERE tp.template_code = v_row.base_template_code;
  v_extra := ARRAY(SELECT x FROM unnest(v_row.permissions) x WHERE NOT (x = ANY (v_template_perms)) ORDER BY x);
  DELETE FROM public.org_role_custom_grants
   WHERE org_id = v_org AND role_code = v_code AND permission_code IS NOT NULL
     AND NOT (permission_code = ANY (v_extra));
  INSERT INTO public.org_role_custom_grants (org_id, role_code, permission_code, created_by)
  SELECT v_org, v_code, x, auth.uid() FROM unnest(v_extra) x
   WHERE NOT EXISTS (SELECT 1 FROM public.org_role_custom_grants g
                      WHERE g.org_id = v_org AND g.role_code = v_code AND g.permission_code = x);

  -- The three navigation sections, in order, as permissionless organization responsibilities.
  FOR i IN 0..2 LOOP
    v_nav := v_row.layout->'nav'->i;
    v_rcode := 'nav.' || substr(md5(v_code), 1, 12) || '.' || (i + 1)::text;
    SELECT id INTO v_rid FROM public.workspace_responsibility_catalog WHERE org_id = v_org AND code = v_rcode;
    IF v_rid IS NULL THEN
      INSERT INTO public.workspace_responsibility_catalog (
        org_id, code, label, kind, daily_priority, primary_nav_id, primary_nav_label, created_by, description
      ) VALUES (
        v_org, v_rcode, btrim(v_nav->>'label'), 'custom', i, v_nav->>'id', btrim(v_nav->>'label'), auth.uid(),
        'Navigation section ' || (i + 1)::text || ' of ' || v_row.code
      ) RETURNING id INTO v_rid;
    ELSE
      UPDATE public.workspace_responsibility_catalog
         SET label = btrim(v_nav->>'label'), daily_priority = i, primary_nav_id = v_nav->>'id',
             primary_nav_label = btrim(v_nav->>'label')
       WHERE id = v_rid;
    END IF;
    v_keep := v_keep || v_rid;
  END LOOP;
  -- Chosen add-on responsibilities stay grantable to holders; core/custom ones are folded into the
  -- permission list by the builder, so they do not compete for the three navigation sections.
  v_keep := v_keep || ARRAY(
    SELECT r.id FROM public.workspace_responsibility_catalog r
     WHERE r.code = ANY (v_row.responsibilities) AND r.kind = 'add_on' AND (r.org_id IS NULL OR r.org_id = v_org));
  DELETE FROM public.workspace_role_responsibilities
   WHERE org_id = v_org AND role_code = v_code AND NOT (responsibility_id = ANY (v_keep));
  INSERT INTO public.workspace_role_responsibilities (org_id, role_code, responsibility_id, created_by)
  SELECT v_org, v_code, x, auth.uid() FROM unnest(v_keep) x
  ON CONFLICT DO NOTHING;
  RETURN v_code;
END
$function$;

-- -----------------------------------------------------------------------------
-- 4. Acting context for the shell banner (the caller's own rows only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_my_acting_context()
RETURNS TABLE (kind text, record_id uuid, role_code text, role_name text, holder_name text,
               valid_from timestamptz, valid_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'delegated'::text, d.id, a.role_code, r.name, h.full_name, d.valid_from, d.valid_until
    FROM public.role_assignment_delegations d
    JOIN public.user_role_assignments a ON a.id = d.assignment_id
    JOIN public.role_catalog r ON r.code = a.role_code
    LEFT JOIN public.users h ON h.id = a.user_id
   WHERE auth.uid() IS NOT NULL AND d.delegate_user_id = auth.uid()
     AND d.org_id = public.get_my_school_id()
     AND d.revoked_at IS NULL AND d.valid_from <= pg_catalog.now() AND d.valid_until > pg_catalog.now()
     AND a.status = 'active'
  UNION ALL
  SELECT 'acting'::text, a.id, a.role_code, r.name, NULL::text, a.started_at, a.valid_until
    FROM public.user_role_assignments a
    JOIN public.role_catalog r ON r.code = a.role_code
   WHERE auth.uid() IS NOT NULL AND a.user_id = auth.uid() AND a.org_id = public.get_my_school_id()
     AND a.status = 'active' AND (a.acting OR a.temporary)
     AND a.started_at <= pg_catalog.now() AND (a.valid_until IS NULL OR a.valid_until > pg_catalog.now());
$$;

-- -----------------------------------------------------------------------------
-- 5. Privileges (ADR-101: nothing for anon; only the callable RPCs for authenticated)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.role_assignment_delegation_bounds_guard(),
  public.role_assignment_delegation_follow_source(),
  public.custom_role_layout_problem(jsonb, boolean),
  public.custom_role_require_admin(),
  public.custom_role_catalog_code(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.workspace_responsibility_define(text, text, text, text[], text[], integer, integer, text, text),
  public.custom_role_save_draft(text, text, text, text[], text[], text, text, jsonb),
  public.custom_role_submit(uuid), public.custom_role_withdraw(uuid),
  public.custom_role_approve(uuid), public.custom_role_activate(uuid),
  public.workspace_my_acting_context()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_responsibility_define(text, text, text, text[], text[], integer, integer, text, text),
  public.custom_role_save_draft(text, text, text, text[], text[], text, text, jsonb),
  public.custom_role_submit(uuid), public.custom_role_withdraw(uuid),
  public.custom_role_approve(uuid), public.custom_role_activate(uuid),
  public.workspace_my_acting_context()
  TO authenticated;
