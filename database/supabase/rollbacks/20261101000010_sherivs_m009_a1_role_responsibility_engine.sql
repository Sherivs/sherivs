-- Rollback for 20261101000010_sherivs_m009_a1_role_responsibility_engine.sql.
-- Immutable role_assignment_audit_events are deliberately retained.
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspace_org_units','workspace_responsibility_catalog','workspace_role_responsibilities',
    'workspace_responsibility_permissions','role_assignment_responsibility_grants',
    'role_assignment_delegations','user_role_assignments','role_catalog',
    'org_role_permission_settings','org_role_custom_grants'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_m009_audit', t);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_role_permission_settings','org_role_custom_grants',
    'workspace_role_responsibilities','workspace_responsibility_permissions',
    'role_assignment_responsibility_grants','role_assignment_delegations'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_m009_lock', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_workspace_role_sod_assignment ON public.user_role_assignments;
DROP TRIGGER IF EXISTS trg_workspace_role_sod_grant ON public.role_assignment_responsibility_grants;
DROP TRIGGER IF EXISTS trg_workspace_role_sod_delegation ON public.role_assignment_delegations;
DROP TRIGGER IF EXISTS trg_workspace_role_assignment_scope ON public.user_role_assignments;
DROP TRIGGER IF EXISTS trg_workspace_role_responsibility_guard ON public.workspace_role_responsibilities;
DROP TRIGGER IF EXISTS trg_workspace_responsibility_permission_guard ON public.workspace_responsibility_permissions;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_role_permission_settings','org_role_custom_grants',
    'workspace_role_responsibilities','workspace_responsibility_permissions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_sod', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_grades_m009_sod ON public.grades;
ALTER TABLE public.grades DROP COLUMN IF EXISTS result_entered_by;

DROP POLICY IF EXISTS workspace_org_units_read ON public.workspace_org_units;
DROP POLICY IF EXISTS workspace_responsibility_catalog_read ON public.workspace_responsibility_catalog;
DROP POLICY IF EXISTS workspace_role_responsibilities_read ON public.workspace_role_responsibilities;
DROP POLICY IF EXISTS workspace_responsibility_permissions_read ON public.workspace_responsibility_permissions;
DROP POLICY IF EXISTS role_assignment_responsibility_grants_read ON public.role_assignment_responsibility_grants;
DROP POLICY IF EXISTS role_assignment_delegations_read ON public.role_assignment_delegations;

DROP FUNCTION IF EXISTS public.workspace_role_assignment_create(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,uuid,text[],text[]);
DROP FUNCTION IF EXISTS public.workspace_role_responsibility_add(uuid,text,uuid);
DROP FUNCTION IF EXISTS public.workspace_responsibility_create_custom(uuid,text,text,text,integer,text,text,text[]);
DROP FUNCTION IF EXISTS public.workspace_responsibility_grant(uuid,uuid,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public.workspace_responsibility_revoke(uuid);
DROP FUNCTION IF EXISTS public.workspace_role_delegate(uuid,uuid,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public.workspace_role_delegation_revoke(uuid);
DROP FUNCTION IF EXISTS public.workspace_role_sod_configuration_trigger();
DROP FUNCTION IF EXISTS public.workspace_role_sod_delegation_trigger();
DROP FUNCTION IF EXISTS public.workspace_role_sod_grant_trigger();
DROP FUNCTION IF EXISTS public.workspace_role_sod_assignment_trigger();
DROP FUNCTION IF EXISTS public.workspace_role_sod_validate_schedule(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_role_sod_assert(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_role_sod_assert_at(uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.workspace_effective_permission_rows(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.workspace_effective_assignments(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_effective_assignments_at(uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.workspace_responsibility_permission_guard();
DROP FUNCTION IF EXISTS public.workspace_role_responsibility_guard();
DROP FUNCTION IF EXISTS public.workspace_role_assignment_scope_guard();
DROP FUNCTION IF EXISTS public.workspace_role_scope_ref_valid(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.workspace_role_mutation_lock_trigger();
DROP FUNCTION IF EXISTS public.workspace_role_engine_audit();

DROP TABLE IF EXISTS public.role_assignment_delegations;
DROP TABLE IF EXISTS public.role_assignment_responsibility_grants;
DROP TABLE IF EXISTS public.workspace_responsibility_permissions;
DROP TABLE IF EXISTS public.workspace_role_responsibilities;
DROP TABLE IF EXISTS public.workspace_responsibility_catalog;
ALTER TABLE public.user_role_assignments DROP COLUMN IF EXISTS org_unit_id;
ALTER TABLE public.user_role_assignments DROP COLUMN IF EXISTS temporary;
ALTER TABLE public.user_role_assignments DROP COLUMN IF EXISTS evidence;
ALTER TABLE public.user_role_assignments DROP COLUMN IF EXISTS restrictions;
DROP TABLE IF EXISTS public.workspace_org_units;

ALTER TABLE public.user_role_assignments
  DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check;
ALTER TABLE public.user_role_assignments
  ADD CONSTRAINT user_role_assignments_scope_type_check
  CHECK (scope_type IN ('org','institution','group','campus','shift','class','subject','lga','authority','faculty','department','self'));
ALTER TABLE public.user_role_assignments
  DROP CONSTRAINT IF EXISTS user_role_assignments_effective_window_check;

CREATE OR REPLACE FUNCTION public.user_role_assignments_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_role public.role_catalog%ROWTYPE; v_conflict text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  SELECT * INTO v_role FROM public.role_catalog WHERE code = NEW.role_code;
  IF v_role.org_id IS NOT NULL AND v_role.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'custom role belongs to another organisation' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.users u ON u.id = m.user_id
     WHERE m.user_id = NEW.user_id AND m.school_id = NEW.org_id
       AND m.is_active AND u.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'user is not a member of this organisation' USING ERRCODE = '42501';
  END IF;
  IF NEW.assigned_by IS NOT NULL AND NEW.assigned_by = NEW.user_id THEN
    RAISE EXCEPTION 'no_self_role_grant: you cannot assign a role to yourself' USING ERRCODE = '42501';
  END IF;
  SELECT r2.name INTO v_conflict FROM public.user_role_assignments a
    JOIN public.role_catalog r2 ON r2.code = a.role_code
    JOIN public.sod_template_conflicts c ON (c.template_a = r2.template_code AND c.template_b = v_role.template_code)
                                         OR (c.template_b = r2.template_code AND c.template_a = v_role.template_code)
   WHERE a.org_id = NEW.org_id AND a.user_id = NEW.user_id AND a.status = 'active' AND a.id <> NEW.id LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'separation of duties: % conflicts with the existing role %', v_role.name, v_conflict USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS public.workspace_role_engine_tenant_lock(uuid);

DELETE FROM public.sod_permission_rules
 WHERE permission_a = 'grades.enter'
   AND permission_b = 'results.publish'
   AND description = 'Result author and publisher must be different people';
DELETE FROM public.sod_permission_rules
 WHERE permission_a = 'grades.enter'
   AND permission_b = 'grades.approve'
   AND description = 'Result author and approver must be different people';

CREATE OR REPLACE FUNCTION public.effective_permissions(p_org uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (permission_code text, kind text, role_codes text[], scopes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH me AS (SELECT coalesce(p_user, auth.uid()) uid),
  allowed AS (SELECT (SELECT uid FROM me) = auth.uid() OR public.can_administer_org(p_org) ok),
  a AS (SELECT ura.* FROM public.user_role_assignments ura, me, allowed
         WHERE allowed.ok AND ura.org_id = p_org AND ura.user_id = me.uid AND ura.status = 'active'
           AND ura.started_at <= now()
           AND (ura.valid_until IS NULL OR ura.valid_until > now())
           AND EXISTS (
             SELECT 1 FROM public.organization_memberships m
             JOIN public.users u ON u.id = m.user_id
              WHERE m.user_id = me.uid AND m.school_id = p_org
                AND m.is_active AND u.is_active IS TRUE
           )),
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

CREATE OR REPLACE FUNCTION public.has_permission(
  p_org uuid, p_permission text, p_scope_type text DEFAULT NULL, p_scope_ref text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.effective_permissions(p_org, auth.uid()) e
    WHERE e.permission_code = p_permission
      AND (
        (p_scope_type IS NULL AND (
          e.scopes @> '[{"type":"org"}]'::jsonb
          OR e.scopes @> '[{"type":"institution"}]'::jsonb
        ))
        OR (
          p_scope_type IS NOT NULL
          AND (
            e.scopes @> '[{"type":"org"}]'::jsonb
            OR e.scopes @> '[{"type":"institution"}]'::jsonb
            OR e.scopes @> jsonb_build_array(jsonb_build_object('type', p_scope_type, 'ref', p_scope_ref))
          )
        )
      )
  );
$$;

COMMIT;
