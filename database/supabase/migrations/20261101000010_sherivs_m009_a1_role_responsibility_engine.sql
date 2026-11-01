-- M009-A1: additive role-responsibility engine extensions.
-- Catalog content, authority-link workflows and UI are owned by later missions.
-- Authority-scoped assignments fail closed until a verified-link contract exists.
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.role_catalog') IS NULL THEN missing := array_append(missing, 'public.role_catalog'); END IF;
  IF to_regclass('public.role_templates') IS NULL THEN missing := array_append(missing, 'public.role_templates'); END IF;
  IF to_regclass('public.role_template_permissions') IS NULL THEN missing := array_append(missing, 'public.role_template_permissions'); END IF;
  IF to_regclass('public.user_role_assignments') IS NULL THEN missing := array_append(missing, 'public.user_role_assignments'); END IF;
  IF to_regprocedure('public.role_create_custom(uuid,text,text,text)') IS NULL THEN
    missing := array_append(missing, 'public.role_create_custom(uuid,text,text,text)');
  END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M009-A1 requires SHERIVS-017 (20261024000240_sherivs_017_role_permission_catalog.sql); missing: %',
      array_to_string(missing, ', ')
      USING ERRCODE = '55000';
  END IF;
END $$;
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  parent_unit_id uuid,
  unit_type text NOT NULL CHECK (unit_type IN ('institution','group','campus','shift','faculty','department','class','subject')),
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{1,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, code),
  FOREIGN KEY (parent_unit_id, org_id)
    REFERENCES public.workspace_org_units(id, org_id)
);

ALTER TABLE public.user_role_assignments
  ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES public.workspace_org_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS temporary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS restrictions text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.user_role_assignments
  DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check;
ALTER TABLE public.user_role_assignments
  ADD CONSTRAINT user_role_assignments_scope_type_check
  CHECK (scope_type IN ('org','institution','group','campus','shift','class','subject','lga','authority','faculty','department','self'));
ALTER TABLE public.user_role_assignments
  DROP CONSTRAINT IF EXISTS user_role_assignments_effective_window_check;
ALTER TABLE public.user_role_assignments
  ADD CONSTRAINT user_role_assignments_effective_window_check
  CHECK (valid_until IS NULL OR valid_until > started_at);

CREATE OR REPLACE FUNCTION public.workspace_role_engine_tenant_lock(p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'role mutation requires tenant scope' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('m009-role-engine:' || p_org::text, 0));
END $$;

CREATE OR REPLACE FUNCTION public.user_role_assignments_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_role public.role_catalog%ROWTYPE; v_conflict text;
BEGIN
  PERFORM public.workspace_role_engine_tenant_lock(NEW.org_id);
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
  SELECT r2.name INTO v_conflict
    FROM public.user_role_assignments a
    JOIN public.role_catalog r2 ON r2.code = a.role_code
    JOIN public.sod_template_conflicts c
      ON (c.template_a = r2.template_code AND c.template_b = v_role.template_code)
      OR (c.template_b = r2.template_code AND c.template_a = v_role.template_code)
   WHERE a.org_id = NEW.org_id AND a.user_id = NEW.user_id
     AND a.status = 'active' AND a.started_at <= now()
     AND (a.valid_until IS NULL OR a.valid_until > now()) AND a.id <> NEW.id
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'separation of duties: % conflicts with the existing role %', v_role.name, v_conflict
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.workspace_responsibility_catalog (
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
  CHECK ((kind = 'custom') = (org_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_responsibility_catalog_scope_code
  ON public.workspace_responsibility_catalog (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
CREATE INDEX IF NOT EXISTS workspace_responsibility_catalog_tenant
  ON public.workspace_responsibility_catalog (org_id, kind, daily_priority);

CREATE TABLE IF NOT EXISTS public.workspace_role_responsibilities (
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code) ON DELETE CASCADE,
  responsibility_id uuid NOT NULL REFERENCES public.workspace_responsibility_catalog(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role_code, responsibility_id)
);

CREATE TABLE IF NOT EXISTS public.workspace_responsibility_permissions (
  responsibility_id uuid NOT NULL REFERENCES public.workspace_responsibility_catalog(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (responsibility_id, permission_code)
);

CREATE TABLE IF NOT EXISTS public.role_assignment_responsibility_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.user_role_assignments(id) ON DELETE CASCADE,
  responsibility_id uuid NOT NULL REFERENCES public.workspace_responsibility_catalog(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  granted_by uuid NOT NULL REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.users(id),
  revoked_at timestamptz,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS role_assignment_responsibility_grants_active
  ON public.role_assignment_responsibility_grants (org_id, assignment_id, valid_from, valid_until)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.role_assignment_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.user_role_assignments(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.users(id),
  revoked_at timestamptz,
  CHECK (valid_until > valid_from),
  CHECK (delegate_user_id <> created_by)
);
CREATE INDEX IF NOT EXISTS role_assignment_delegations_active
  ON public.role_assignment_delegations (org_id, delegate_user_id, valid_from, valid_until)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.role_assignment_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_user_id uuid,
  assignment_id uuid,
  target_type text NOT NULL,
  target_id text,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  scope_type text,
  scope_ref text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS role_assignment_audit_events_tenant_time
  ON public.role_assignment_audit_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS role_assignment_audit_events_target
  ON public.role_assignment_audit_events (org_id, target_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.workspace_role_scope_ref_valid(
  p_org uuid, p_user uuid, p_scope_type text, p_scope_ref text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS NULL OR p_user IS NULL THEN RETURN false; END IF;
  RETURN coalesce(CASE p_scope_type
    WHEN 'org' THEN p_scope_ref IS NULL OR p_scope_ref = p_org::text
    WHEN 'institution' THEN p_scope_ref IS NULL OR p_scope_ref = p_org::text
    WHEN 'campus' THEN EXISTS (SELECT 1 FROM public.campuses WHERE id::text = p_scope_ref AND school_id = p_org)
    WHEN 'shift' THEN EXISTS (SELECT 1 FROM public.school_shifts WHERE id::text = p_scope_ref AND school_id = p_org)
    WHEN 'class' THEN EXISTS (SELECT 1 FROM public.classes WHERE id::text = p_scope_ref AND school_id = p_org)
    WHEN 'group' THEN EXISTS (
      SELECT 1 FROM public.org_group_members
      WHERE group_id::text = p_scope_ref AND school_id = p_org
    )
    WHEN 'subject' THEN EXISTS (
      SELECT 1 FROM public.workspace_org_units
      WHERE id::text = p_scope_ref AND org_id = p_org AND unit_type = 'subject'
    )
    WHEN 'faculty' THEN EXISTS (
      SELECT 1 FROM public.workspace_org_units
      WHERE id::text = p_scope_ref AND org_id = p_org AND unit_type = 'faculty'
    )
    WHEN 'department' THEN EXISTS (
      SELECT 1 FROM public.workspace_org_units
      WHERE id::text = p_scope_ref AND org_id = p_org AND unit_type = 'department'
    )
    WHEN 'self' THEN p_scope_ref = p_user::text
    WHEN 'lga' THEN false
    WHEN 'authority' THEN false
    ELSE false
  END, false);
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_assignment_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_default_scope text;
BEGIN
  PERFORM public.workspace_role_engine_tenant_lock(NEW.org_id);
  IF NOT public.workspace_role_scope_ref_valid(NEW.org_id, NEW.user_id, NEW.scope_type, NEW.scope_ref) THEN
    RAISE EXCEPTION 'invalid or unverified role assignment scope' USING ERRCODE = '42501';
  END IF;
  SELECT t.default_scope INTO v_default_scope
    FROM public.role_catalog r JOIN public.role_templates t ON t.code = r.template_code
   WHERE r.code = NEW.role_code AND (r.org_id IS NULL OR r.org_id = NEW.org_id);
  IF v_default_scope IS NULL OR NOT (CASE v_default_scope
    WHEN 'org' THEN NEW.scope_type IN ('org','institution','group','campus','shift','faculty','department','class','subject','self')
    WHEN 'campus' THEN NEW.scope_type IN ('campus','shift','class','subject','self')
    WHEN 'faculty' THEN NEW.scope_type IN ('faculty','department','class','subject','self')
    WHEN 'department' THEN NEW.scope_type IN ('department','class','subject','self')
    WHEN 'class' THEN NEW.scope_type IN ('class','subject','self')
    WHEN 'self' THEN NEW.scope_type = 'self'
    ELSE false
  END) THEN
    RAISE EXCEPTION 'assignment scope exceeds the role template scope' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_org_units
    WHERE id = NEW.org_unit_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'org unit is outside the assignment tenant' USING ERRCODE = '42501';
  END IF;
  IF NEW.valid_until IS NOT NULL AND NEW.valid_until <= NEW.started_at THEN
    RAISE EXCEPTION 'assignment end must be after its start' USING ERRCODE = '22023';
  END IF;
  IF NEW.temporary AND NEW.valid_until IS NULL THEN
    RAISE EXCEPTION 'temporary assignments require an end time' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_workspace_role_assignment_scope ON public.user_role_assignments;
CREATE TRIGGER trg_workspace_role_assignment_scope
  BEFORE INSERT OR UPDATE ON public.user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.workspace_role_assignment_scope_guard();

CREATE OR REPLACE FUNCTION public.workspace_role_responsibility_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_role_org uuid; v_responsibility_org uuid;
BEGIN
  SELECT org_id INTO v_role_org FROM public.role_catalog WHERE code = NEW.role_code;
  SELECT org_id INTO v_responsibility_org
    FROM public.workspace_responsibility_catalog WHERE id = NEW.responsibility_id;
  IF v_role_org IS NULL AND NOT EXISTS (SELECT 1 FROM public.role_catalog WHERE code = NEW.role_code) THEN
    RAISE EXCEPTION 'unknown role' USING ERRCODE = '23503';
  END IF;
  IF v_role_org IS NOT NULL AND v_role_org <> NEW.org_id THEN
    RAISE EXCEPTION 'role belongs to another tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_responsibility_catalog WHERE id = NEW.responsibility_id)
     OR (v_responsibility_org IS NOT NULL AND v_responsibility_org <> NEW.org_id) THEN
    RAISE EXCEPTION 'responsibility belongs to another tenant or does not exist' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_workspace_role_responsibility_guard ON public.workspace_role_responsibilities;
CREATE TRIGGER trg_workspace_role_responsibility_guard
  BEFORE INSERT OR UPDATE ON public.workspace_role_responsibilities
  FOR EACH ROW EXECUTE FUNCTION public.workspace_role_responsibility_guard();

CREATE OR REPLACE FUNCTION public.workspace_responsibility_permission_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE code = NEW.permission_code AND protected
  ) THEN
    RAISE EXCEPTION 'protected permission % cannot be granted by a responsibility', NEW.permission_code
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_workspace_responsibility_permission_guard ON public.workspace_responsibility_permissions;
CREATE TRIGGER trg_workspace_responsibility_permission_guard
  BEFORE INSERT OR UPDATE ON public.workspace_responsibility_permissions
  FOR EACH ROW EXECUTE FUNCTION public.workspace_responsibility_permission_guard();

CREATE OR REPLACE FUNCTION public.workspace_role_mutation_lock_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j jsonb; v_org uuid;
BEGIN
  j := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_org := nullif(j->>'org_id','')::uuid;
  IF v_org IS NULL AND TG_TABLE_NAME = 'workspace_responsibility_permissions' THEN
    SELECT org_id INTO v_org
      FROM public.workspace_responsibility_catalog
     WHERE id = nullif(j->>'responsibility_id','')::uuid;
  END IF;
  IF v_org IS NOT NULL THEN PERFORM public.workspace_role_engine_tenant_lock(v_org); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
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
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.workspace_role_mutation_lock_trigger()', 'trg_' || t || '_m009_lock', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_engine_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  j jsonb;
  v_old jsonb;
  v_new jsonb;
  v_org uuid;
  v_actor uuid := auth.uid();
  v_target uuid;
  v_assignment uuid;
  v_scope_type text;
  v_scope_ref text;
  v_target_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    j := to_jsonb(OLD);
    v_old := j;
  ELSE
    j := to_jsonb(NEW);
    v_new := j;
  END IF;
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP = 'DELETE' THEN j := to_jsonb(OLD); END IF;
  v_org := coalesce(nullif(j->>'org_id','')::uuid, nullif(j->>'school_id','')::uuid);
  IF v_org IS NULL AND TG_TABLE_NAME = 'workspace_responsibility_permissions' THEN
    SELECT org_id INTO v_org
      FROM public.workspace_responsibility_catalog
     WHERE id = nullif(j->>'responsibility_id','')::uuid;
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
  v_scope_type := j->>'scope_type';
  v_scope_ref := j->>'scope_ref';
  IF v_scope_type IS NULL AND v_assignment IS NOT NULL THEN
    SELECT scope_type, scope_ref INTO v_scope_type, v_scope_ref
      FROM public.user_role_assignments WHERE id = v_assignment;
  END IF;
  v_target_id := coalesce(j->>'id', j->>'responsibility_id', j->>'role_code', j->>'permission_code', j->>'code');
  INSERT INTO public.role_assignment_audit_events (
    org_id, actor_user_id, target_user_id, assignment_id, target_type, target_id,
    action, scope_type, scope_ref, before_state, after_state
  ) VALUES (
    v_org, v_actor, v_target, v_assignment, TG_TABLE_NAME, v_target_id,
    lower(TG_OP), v_scope_type, v_scope_ref, v_old, v_new
  );
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'role assignment audit events are append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_role_assignment_audit_immutable ON public.role_assignment_audit_events;
CREATE TRIGGER trg_role_assignment_audit_immutable
  BEFORE UPDATE OR DELETE ON public.role_assignment_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.workspace_role_audit_immutable();
DROP TRIGGER IF EXISTS trg_role_assignment_audit_immutable_truncate ON public.role_assignment_audit_events;
CREATE TRIGGER trg_role_assignment_audit_immutable_truncate
  BEFORE TRUNCATE ON public.role_assignment_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.workspace_role_audit_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspace_org_units','workspace_responsibility_catalog','workspace_role_responsibilities',
    'workspace_responsibility_permissions','role_assignment_responsibility_grants',
    'role_assignment_delegations','role_assignment_audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'workspace_org_units','workspace_responsibility_catalog','workspace_role_responsibilities',
    'workspace_responsibility_permissions','role_assignment_responsibility_grants',
    'role_assignment_delegations','user_role_assignments','role_catalog',
    'org_role_permission_settings','org_role_custom_grants'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_m009_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.workspace_role_engine_audit()', 'trg_' || t || '_m009_audit', t);
  END LOOP;
END $$;

CREATE POLICY workspace_org_units_read ON public.workspace_org_units
  FOR SELECT TO authenticated USING (org_id = (SELECT public.get_my_school_id()));
CREATE POLICY workspace_responsibility_catalog_read ON public.workspace_responsibility_catalog
  FOR SELECT TO authenticated USING (org_id IS NULL OR org_id = (SELECT public.get_my_school_id()));
CREATE POLICY workspace_role_responsibilities_read ON public.workspace_role_responsibilities
  FOR SELECT TO authenticated USING (org_id = (SELECT public.get_my_school_id()));
CREATE POLICY workspace_responsibility_permissions_read ON public.workspace_responsibility_permissions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.workspace_responsibility_catalog r
      WHERE r.id = responsibility_id
        AND (r.org_id IS NULL OR r.org_id = (SELECT public.get_my_school_id()))
    )
  );
CREATE POLICY role_assignment_responsibility_grants_read ON public.role_assignment_responsibility_grants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.user_role_assignments a
      WHERE a.id = assignment_id AND (a.user_id = (SELECT auth.uid()) OR public.can_manage_roles(a.org_id, 'roles.assign'))
    )
  );
CREATE POLICY role_assignment_delegations_read ON public.role_assignment_delegations
  FOR SELECT TO authenticated USING (
    delegate_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_role_assignments a
      WHERE a.id = assignment_id AND (a.user_id = (SELECT auth.uid()) OR public.can_manage_roles(a.org_id, 'roles.assign'))
    )
  );
CREATE POLICY role_assignment_audit_events_read ON public.role_assignment_audit_events
  FOR SELECT TO authenticated USING (
    org_id = (SELECT public.get_my_school_id())
    AND (
      target_user_id = (SELECT auth.uid())
      OR actor_user_id = (SELECT auth.uid())
      OR public.scholar_can(org_id, 'audit.view')
      OR public.can_administer_org(org_id)
    )
  );

CREATE OR REPLACE FUNCTION public.workspace_effective_assignments_at(p_org uuid, p_user uuid, p_at timestamptz)
RETURNS TABLE (assignment_id uuid, role_code text, scope_type text, scope_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.role_code, a.scope_type, a.scope_ref
    FROM public.user_role_assignments a
   WHERE a.org_id = p_org AND a.user_id = p_user AND a.status = 'active'
     AND a.started_at <= p_at AND (a.valid_until IS NULL OR a.valid_until > p_at)
     AND EXISTS (
       SELECT 1 FROM public.organization_memberships m
       JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id = p_user AND m.school_id = p_org
          AND m.is_active AND u.is_active IS TRUE
     )
  UNION
  SELECT a.id, a.role_code, a.scope_type, a.scope_ref
    FROM public.role_assignment_delegations d
    JOIN public.user_role_assignments a ON a.id = d.assignment_id
   WHERE d.org_id = p_org AND d.delegate_user_id = p_user
     AND d.valid_from <= p_at AND d.valid_until > p_at
     AND (d.revoked_at IS NULL OR d.revoked_at > p_at)
     AND a.status = 'active' AND a.started_at <= p_at
     AND (a.valid_until IS NULL OR a.valid_until > p_at)
     AND EXISTS (
       SELECT 1 FROM public.organization_memberships m
       JOIN public.users delegate ON delegate.id = m.user_id
        WHERE m.user_id = p_user AND m.school_id = p_org
          AND m.is_active AND delegate.is_active IS TRUE
     )
     AND EXISTS (
       SELECT 1 FROM public.organization_memberships m
       JOIN public.users source_user ON source_user.id = m.user_id
        WHERE m.user_id = a.user_id AND m.school_id = p_org
          AND m.is_active AND source_user.is_active IS TRUE
     )
$$;

CREATE OR REPLACE FUNCTION public.workspace_effective_assignments(p_org uuid, p_user uuid)
RETURNS TABLE (assignment_id uuid, role_code text, scope_type text, scope_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.workspace_effective_assignments_at(p_org, p_user, now())
$$;

CREATE OR REPLACE FUNCTION public.workspace_effective_permission_rows_at(
  p_org uuid, p_user uuid, p_at timestamptz
)
RETURNS TABLE (
  permission_code text, kind text, role_code text, assignment_id uuid,
  scope_type text, scope_ref text, scope_values jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH assigned AS (
    SELECT * FROM public.workspace_effective_assignments_at(p_org, p_user, p_at)
  ), grants AS (
    SELECT tp.permission_code, tp.kind, a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s
        ON s.org_id = p_org AND s.role_code = a.role_code AND s.permission_code = tp.permission_code
     WHERE tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on)
    UNION ALL
    SELECT rp.permission_code, r.kind, a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.workspace_role_responsibilities rr
        ON rr.org_id = p_org AND rr.role_code = a.role_code
      JOIN public.workspace_responsibility_catalog r ON r.id = rr.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = r.id
     WHERE r.kind IN ('core','custom') AND (r.org_id IS NULL OR r.org_id = p_org)
    UNION ALL
    SELECT coalesce(cg.permission_code, cg.custom_key), 'custom', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.org_role_custom_grants cg ON cg.org_id = p_org AND cg.role_code = a.role_code
    UNION ALL
    SELECT rp.permission_code, 'responsibility', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_assignment_responsibility_grants g ON g.assignment_id = a.assignment_id
      JOIN public.workspace_role_responsibilities rr
        ON rr.org_id = p_org AND rr.role_code = a.role_code AND rr.responsibility_id = g.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = g.responsibility_id
     WHERE g.org_id = p_org AND g.valid_from <= p_at
       AND (g.valid_until IS NULL OR g.valid_until > p_at)
       AND (g.revoked_at IS NULL OR g.revoked_at > p_at)
  )
  SELECT g.permission_code, min(g.kind), g.role_code, g.assignment_id, g.scope_type, g.scope_ref,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.role_assignment_scope_sets s WHERE s.assignment_id = g.assignment_id
         ) THEN coalesce((
           SELECT jsonb_agg(DISTINCT jsonb_build_object('type', x.dim, 'ref', x.ref))
             FROM public.role_assignment_scope_sets s
             JOIN public.role_assignment_scopes x ON x.set_id = s.id
            WHERE s.assignment_id = g.assignment_id
         ), '[]'::jsonb)
         ELSE jsonb_build_array(jsonb_build_object(
           'type', CASE WHEN g.scope_type = 'org' THEN 'institution' ELSE g.scope_type END,
           'ref', g.scope_ref
         )) END
    FROM grants g
   GROUP BY g.permission_code, g.role_code, g.assignment_id, g.scope_type, g.scope_ref
$$;

CREATE OR REPLACE FUNCTION public.workspace_effective_permission_rows(p_org uuid, p_user uuid)
RETURNS TABLE (
  permission_code text, kind text, role_code text, assignment_id uuid,
  scope_type text, scope_ref text, scope_values jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.workspace_effective_permission_rows_at(p_org, p_user, now())
$$;

CREATE OR REPLACE FUNCTION public.effective_permissions(p_org uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (permission_code text, kind text, role_codes text[], scopes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := coalesce(p_user, auth.uid());
BEGIN
  IF v_user IS NULL OR NOT (
    v_user = auth.uid() OR public.can_administer_org(p_org) OR coalesce(public.is_super_admin(), false)
  ) THEN RETURN; END IF;
  RETURN QUERY
    SELECT e.permission_code, min(e.kind), array_agg(DISTINCT e.role_code ORDER BY e.role_code),
           jsonb_agg(DISTINCT scope.value)
      FROM public.workspace_effective_permission_rows(p_org, v_user) e
      CROSS JOIN LATERAL jsonb_array_elements(e.scope_values) AS scope(value)
     GROUP BY e.permission_code;
END $$;

CREATE OR REPLACE FUNCTION public.has_permission(
  p_org uuid, p_permission text, p_scope_type text DEFAULT NULL, p_scope_ref text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_effective_permission_rows(p_org, auth.uid()) e
    WHERE e.permission_code = p_permission
      AND NOT EXISTS (
        SELECT 1 FROM public.role_assignment_scope_sets s WHERE s.assignment_id = e.assignment_id
      )
      AND (
        (p_scope_type IS NULL AND e.scope_type IN ('org','institution'))
        OR (
          p_scope_type IS NOT NULL
          AND (
            e.scope_type IN ('org','institution')
            OR (e.scope_type = p_scope_type AND e.scope_ref IS NOT DISTINCT FROM p_scope_ref)
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.workspace_role_sod_assert_at(p_org uuid, p_user uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conflict text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.workspace_effective_assignments_at(p_org, p_user, p_at) a
      JOIN public.role_catalog ra ON ra.code = a.role_code
      JOIN public.workspace_effective_assignments_at(p_org, p_user, p_at) b
        ON b.assignment_id <> a.assignment_id
      JOIN public.role_catalog rb ON rb.code = b.role_code
      JOIN public.sod_template_conflicts c
        ON (c.template_a = ra.template_code AND c.template_b = rb.template_code)
        OR (c.template_b = ra.template_code AND c.template_a = rb.template_code)
  ) THEN
    RAISE EXCEPTION 'separation of duties: assigned role templates conflict'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) a
      JOIN public.workspace_effective_permission_rows_at(p_org, p_user, p_at) b
        ON a.permission_code = 'expenses.create' AND b.permission_code = 'expenses.approve'
  ) OR EXISTS (
    SELECT 1
      FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) a
      JOIN public.workspace_effective_permission_rows_at(p_org, p_user, p_at) b
        ON a.permission_code = 'grades.enter' AND b.permission_code = 'results.publish'
  ) OR EXISTS (
    SELECT 1
      FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) a
      JOIN public.workspace_effective_permission_rows_at(p_org, p_user, p_at) b
        ON a.permission_code = 'grades.enter' AND b.permission_code = 'grades.approve'
  ) OR EXISTS (
    SELECT 1
      FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) a
      JOIN public.workspace_effective_permission_rows_at(p_org, p_user, p_at) b
        ON a.permission_code = 'payments.record_cash' AND b.permission_code = 'payments.reconcile'
  ) THEN
    RAISE EXCEPTION 'separation of duties: a user cannot create and approve the same finance entry or result publication'
      USING ERRCODE = '42501';
  END IF;
  SELECT r.description INTO v_conflict
    FROM public.sod_permission_rules r
   WHERE EXISTS (
     SELECT 1 FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) e WHERE e.permission_code = r.permission_a
   )
     AND EXISTS (
     SELECT 1 FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) e WHERE e.permission_code = r.permission_b
   )
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'separation of duties: %', v_conflict USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.workspace_effective_assignments_at(p_org, p_user, p_at) a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_templates t ON t.code = r.template_code
     WHERE t.guardrails @> ARRAY['auditor_independence']::text[]
  ) AND EXISTS (
    SELECT 1 FROM public.workspace_effective_permission_rows_at(p_org, p_user, p_at) e
    WHERE e.permission_code IN ('expenses.approve','payroll.approve','payments.refund','grades.approve','results.publish','procurement.approve')
  ) THEN
    RAISE EXCEPTION 'separation of duties: auditor cannot approve an audited transaction'
      USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_sod_assert(p_org uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.workspace_role_sod_assert_at(p_org, p_user, now());
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_sod_validate_schedule(p_org uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_at timestamptz;
BEGIN
  IF p_org IS NULL OR p_user IS NULL THEN
    RAISE EXCEPTION 'SoD validation requires tenant and user' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_user::text, 0));
  FOR v_at IN
    WITH scoped_assignments AS (
      SELECT id, started_at, valid_until
        FROM public.user_role_assignments
       WHERE org_id = p_org AND user_id = p_user AND status = 'active'
      UNION
      SELECT a.id, a.started_at, a.valid_until
        FROM public.role_assignment_delegations d
        JOIN public.user_role_assignments a ON a.id = d.assignment_id
       WHERE d.org_id = p_org AND d.delegate_user_id = p_user
         AND d.revoked_at IS NULL
    ), boundaries AS (
      SELECT now() AS boundary_at
      UNION SELECT started_at FROM scoped_assignments
      UNION SELECT valid_until FROM scoped_assignments WHERE valid_until IS NOT NULL
      UNION SELECT g.valid_from
        FROM public.role_assignment_responsibility_grants g
        JOIN scoped_assignments a ON a.id = g.assignment_id
       WHERE g.org_id = p_org AND g.revoked_at IS NULL
      UNION SELECT g.valid_until
        FROM public.role_assignment_responsibility_grants g
        JOIN scoped_assignments a ON a.id = g.assignment_id
       WHERE g.org_id = p_org AND g.valid_until IS NOT NULL
      UNION SELECT g.revoked_at
        FROM public.role_assignment_responsibility_grants g
        JOIN scoped_assignments a ON a.id = g.assignment_id
       WHERE g.org_id = p_org AND g.revoked_at IS NOT NULL
      UNION SELECT d.valid_from
        FROM public.role_assignment_delegations d
       WHERE d.org_id = p_org AND d.delegate_user_id = p_user
      UNION SELECT d.valid_until
        FROM public.role_assignment_delegations d
       WHERE d.org_id = p_org AND d.delegate_user_id = p_user
      UNION SELECT d.revoked_at
        FROM public.role_assignment_delegations d
       WHERE d.org_id = p_org AND d.delegate_user_id = p_user AND d.revoked_at IS NOT NULL
    )
    SELECT DISTINCT boundary_at FROM boundaries WHERE boundary_at >= now() ORDER BY boundary_at
  LOOP
    PERFORM public.workspace_role_sod_assert_at(p_org, p_user, v_at);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_sod_assignment_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid;
BEGIN
  IF NEW.status = 'active' THEN
    FOR v_user IN
      SELECT user_id FROM (
        SELECT NEW.user_id AS user_id
        UNION
        SELECT d.delegate_user_id
          FROM public.role_assignment_delegations d
         WHERE d.assignment_id = NEW.id AND d.revoked_at IS NULL AND d.valid_until > now()
      ) impacted_users
      ORDER BY user_id
    LOOP
      PERFORM public.workspace_role_sod_validate_schedule(NEW.org_id, v_user);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_workspace_role_sod_assignment ON public.user_role_assignments;
CREATE CONSTRAINT TRIGGER trg_workspace_role_sod_assignment
  AFTER INSERT OR UPDATE ON public.user_role_assignments
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
  EXECUTE FUNCTION public.workspace_role_sod_assignment_trigger();

CREATE OR REPLACE FUNCTION public.workspace_role_sod_grant_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid;
BEGIN
  IF NEW.revoked_at IS NULL THEN
    FOR v_user IN
      SELECT user_id FROM (
        SELECT a.user_id
          FROM public.user_role_assignments a
         WHERE a.id = NEW.assignment_id
        UNION
        SELECT d.delegate_user_id
          FROM public.role_assignment_delegations d
         WHERE d.assignment_id = NEW.assignment_id AND d.org_id = NEW.org_id
           AND d.revoked_at IS NULL AND d.valid_until > now()
      ) impacted_users
      ORDER BY user_id
    LOOP
      PERFORM public.workspace_role_sod_validate_schedule(NEW.org_id, v_user);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_workspace_role_sod_grant ON public.role_assignment_responsibility_grants;
CREATE CONSTRAINT TRIGGER trg_workspace_role_sod_grant
  AFTER INSERT OR UPDATE ON public.role_assignment_responsibility_grants
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
  EXECUTE FUNCTION public.workspace_role_sod_grant_trigger();

CREATE OR REPLACE FUNCTION public.workspace_role_sod_delegation_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.revoked_at IS NULL THEN
    PERFORM public.workspace_role_sod_validate_schedule(NEW.org_id, NEW.delegate_user_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_workspace_role_sod_delegation ON public.role_assignment_delegations;
CREATE CONSTRAINT TRIGGER trg_workspace_role_sod_delegation
  AFTER INSERT OR UPDATE ON public.role_assignment_delegations
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
  EXECUTE FUNCTION public.workspace_role_sod_delegation_trigger();

CREATE OR REPLACE FUNCTION public.workspace_role_sod_configuration_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  j jsonb;
  v_org uuid;
  v_role text;
  v_responsibility uuid;
  v_user uuid;
BEGIN
  j := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_org := nullif(j->>'org_id','')::uuid;
  v_role := j->>'role_code';
  v_responsibility := nullif(j->>'responsibility_id','')::uuid;
  IF v_org IS NULL THEN RETURN NULL; END IF;
  FOR v_user IN
    WITH affected_assignments AS (
      SELECT a.id, a.user_id
        FROM public.user_role_assignments a
       WHERE a.org_id = v_org AND a.status = 'active'
         AND (
           (v_role IS NOT NULL AND a.role_code = v_role)
           OR (v_responsibility IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.workspace_role_responsibilities rr
             JOIN public.workspace_responsibility_catalog r ON r.id = rr.responsibility_id
             WHERE rr.org_id = v_org AND rr.role_code = a.role_code
               AND rr.responsibility_id = v_responsibility
               AND (
                 r.kind IN ('core','custom')
                 OR EXISTS (
                   SELECT 1 FROM public.role_assignment_responsibility_grants g
                    WHERE g.assignment_id = a.id AND g.responsibility_id = v_responsibility
                      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until > now())
                 )
               )
           ))
         )
    ), affected_users AS (
      SELECT user_id FROM affected_assignments
      UNION
      SELECT d.delegate_user_id
        FROM public.role_assignment_delegations d
        JOIN affected_assignments a ON a.id = d.assignment_id
       WHERE d.org_id = v_org AND d.revoked_at IS NULL AND d.valid_until > now()
    )
    SELECT DISTINCT user_id FROM affected_users ORDER BY user_id
  LOOP
    PERFORM public.workspace_role_sod_validate_schedule(v_org, v_user);
  END LOOP;
  RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_role_permission_settings','org_role_custom_grants',
    'workspace_role_responsibilities','workspace_responsibility_permissions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_sod', t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.workspace_role_sod_configuration_trigger()', 'trg_' || t || '_sod', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_assignment_create(
  p_org uuid, p_user uuid, p_role text, p_scope_type text, p_scope_ref text,
  p_started_at timestamptz, p_valid_until timestamptz, p_temporary boolean,
  p_org_unit_id uuid, p_evidence text[], p_restrictions text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_roles(p_org, 'roles.assign') THEN
    RAISE EXCEPTION 'roles.assign required' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() = p_user THEN RAISE EXCEPTION 'no_self_role_grant' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.users u ON u.id = m.user_id
     WHERE m.user_id = p_user AND m.school_id = p_org
       AND m.is_active AND u.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'user is not a member of this organisation' USING ERRCODE = '42501';
  END IF;
  IF p_scope_type IN ('lga','authority') THEN
    RAISE EXCEPTION 'authority scope requires a verified authority link' USING ERRCODE = '42501';
  END IF;
  IF p_started_at IS NULL OR (p_valid_until IS NOT NULL AND p_valid_until <= p_started_at) THEN
    RAISE EXCEPTION 'invalid assignment effective dates' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_role_assignments (
    org_id, user_id, role_code, scope_type, scope_ref, status, assigned_by,
    started_at, valid_until, acting, temporary, org_unit_id, evidence, restrictions
  ) VALUES (
    p_org, p_user, p_role, p_scope_type, p_scope_ref, 'active', auth.uid(),
    p_started_at, p_valid_until, p_temporary, p_temporary, p_org_unit_id,
    coalesce(p_evidence, '{}'), coalesce(p_restrictions, '{}')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_responsibility_add(
  p_org uuid, p_role text, p_responsibility uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_roles(p_org, 'roles.configure') THEN
    RAISE EXCEPTION 'roles.configure required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_responsibility_catalog WHERE id = p_responsibility) THEN
    RAISE EXCEPTION 'unknown responsibility' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.workspace_role_responsibilities (org_id, role_code, responsibility_id, created_by)
  VALUES (p_org, p_role, p_responsibility, auth.uid())
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_responsibility_create_custom(
  p_org uuid, p_role text, p_code text, p_label text, p_daily_priority integer,
  p_primary_nav_id text, p_primary_nav_label text, p_permissions text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_permission text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_roles(p_org, 'roles.configure') THEN
    RAISE EXCEPTION 'roles.configure required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_label,''))) < 2 OR p_code !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'invalid custom responsibility name or code' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.workspace_responsibility_catalog (
    org_id, code, label, kind, daily_priority, primary_nav_id, primary_nav_label, created_by
  ) VALUES (
    p_org, p_code, btrim(p_label), 'custom', p_daily_priority, p_primary_nav_id, btrim(p_primary_nav_label), auth.uid()
  ) RETURNING id INTO v_id;
  INSERT INTO public.workspace_role_responsibilities (org_id, role_code, responsibility_id, created_by)
  VALUES (p_org, p_role, v_id, auth.uid());
  FOREACH v_permission IN ARRAY coalesce(p_permissions, '{}') LOOP
    INSERT INTO public.workspace_responsibility_permissions (responsibility_id, permission_code, created_by)
    VALUES (v_id, v_permission, auth.uid());
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_responsibility_grant(
  p_assignment uuid, p_responsibility uuid,
  p_valid_from timestamptz DEFAULT NULL, p_valid_until timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_assignment public.user_role_assignments%ROWTYPE; v_kind text; v_id uuid; v_from timestamptz := coalesce(p_valid_from, now());
BEGIN
  SELECT * INTO v_assignment FROM public.user_role_assignments WHERE id = p_assignment AND status = 'active';
  IF v_assignment.id IS NULL OR NOT public.can_manage_roles(v_assignment.org_id, 'roles.assign') THEN
    RAISE EXCEPTION 'roles.assign required' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() = v_assignment.user_id THEN RAISE EXCEPTION 'no_self_role_grant' USING ERRCODE = '42501'; END IF;
  SELECT r.kind INTO v_kind
    FROM public.workspace_responsibility_catalog r
    JOIN public.workspace_role_responsibilities rr
      ON rr.responsibility_id = r.id AND rr.org_id = v_assignment.org_id AND rr.role_code = v_assignment.role_code
   WHERE r.id = p_responsibility AND (r.org_id IS NULL OR r.org_id = v_assignment.org_id);
  IF v_kind IS DISTINCT FROM 'add_on' THEN
    RAISE EXCEPTION 'only an assigned add-on responsibility can be granted' USING ERRCODE = '42501';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= v_from THEN
    RAISE EXCEPTION 'grant end must be after its start' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.role_assignment_responsibility_grants (
    org_id, assignment_id, responsibility_id, valid_from, valid_until, granted_by
  ) VALUES (
    v_assignment.org_id, v_assignment.id, p_responsibility, v_from, p_valid_until, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_responsibility_revoke(p_grant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.role_assignment_responsibility_grants WHERE id = p_grant;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_manage_roles(v_org, 'roles.assign') THEN
    RAISE EXCEPTION 'roles.assign required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.role_assignment_responsibility_grants
     SET revoked_by = auth.uid(), revoked_at = now()
   WHERE id = p_grant AND revoked_at IS NULL;
END $$;

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
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.users u ON u.id = m.user_id
     WHERE m.user_id = p_delegate_user AND m.school_id = v_assignment.org_id
       AND m.is_active AND u.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'delegation target is not a tenant member' USING ERRCODE = '42501';
  END IF;
  IF p_valid_from < v_assignment.started_at
     OR (v_assignment.valid_until IS NOT NULL AND p_valid_until > v_assignment.valid_until)
     OR p_valid_until <= p_valid_from THEN
    RAISE EXCEPTION 'delegation dates exceed the source assignment' USING ERRCODE = '22023';
  END IF;
  IF v_assignment.scope_type IN ('lga','authority') THEN
    RAISE EXCEPTION 'authority scope requires a verified authority link' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.role_assignment_delegations (
    org_id, assignment_id, delegate_user_id, valid_from, valid_until, created_by
  ) VALUES (
    v_assignment.org_id, v_assignment.id, p_delegate_user, p_valid_from, p_valid_until, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_role_delegation_revoke(p_delegation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.role_assignment_delegations WHERE id = p_delegation;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_manage_roles(v_org, 'roles.assign') THEN
    RAISE EXCEPTION 'roles.assign required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.role_assignment_delegations
     SET revoked_by = auth.uid(), revoked_at = now()
   WHERE id = p_delegation AND revoked_at IS NULL;
END $$;

-- A result's entry actor is server-stamped and cannot be changed by later updates.
ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS result_entered_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.grades_m009_sod_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.result_entered_by := auth.uid();
  ELSE
    NEW.result_entered_by := OLD.result_entered_by;
  END IF;
  IF NEW.is_published IS TRUE AND (TG_OP = 'INSERT' OR OLD.is_published IS NOT TRUE) THEN
    IF auth.uid() IS NOT NULL AND NOT public.scholar_can(NEW.school_id, 'results.publish') THEN
      RAISE EXCEPTION 'results.publish required' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.result_entered_by IS NULL THEN
      RAISE EXCEPTION 'result author is unknown; publication denied' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.result_entered_by = auth.uid() THEN
      RAISE EXCEPTION 'separation of duties: result author cannot publish the same result' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grades_m009_sod ON public.grades;
CREATE TRIGGER trg_grades_m009_sod
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.grades_m009_sod_guard();

INSERT INTO public.sod_permission_rules (permission_a, permission_b, description) VALUES
  ('grades.enter','results.publish','Result author and publisher must be different people'),
  ('grades.enter','grades.approve','Result author and approver must be different people')
ON CONFLICT DO NOTHING;

REVOKE ALL ON FUNCTION public.workspace_role_scope_ref_valid(uuid,uuid,text,text),
  public.workspace_role_engine_tenant_lock(uuid), public.workspace_role_mutation_lock_trigger(),
  public.user_role_assignments_guard(),
  public.workspace_role_assignment_scope_guard(), public.workspace_role_responsibility_guard(),
  public.workspace_responsibility_permission_guard(), public.workspace_role_engine_audit(),
  public.workspace_role_audit_immutable(),   public.workspace_effective_assignments_at(uuid,uuid,timestamptz), public.workspace_effective_assignments(uuid,uuid),
  public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz),
  public.workspace_effective_permission_rows(uuid,uuid),
  public.workspace_role_sod_assert_at(uuid,uuid,timestamptz),
  public.workspace_role_sod_assert(uuid,uuid), public.workspace_role_sod_validate_schedule(uuid,uuid),
  public.workspace_role_sod_assignment_trigger(), public.workspace_role_sod_grant_trigger(),
  public.workspace_role_sod_delegation_trigger(), public.workspace_role_sod_configuration_trigger(),
  public.grades_m009_sod_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.workspace_role_assignment_create(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,uuid,text[],text[]),
  public.workspace_role_responsibility_add(uuid,text,uuid),
  public.workspace_responsibility_create_custom(uuid,text,text,text,integer,text,text,text[]),
  public.workspace_responsibility_grant(uuid,uuid,timestamptz,timestamptz),
  public.workspace_responsibility_revoke(uuid), public.workspace_role_delegate(uuid,uuid,timestamptz,timestamptz),
  public.workspace_role_delegation_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_role_assignment_create(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,uuid,text[],text[]),
  public.workspace_role_responsibility_add(uuid,text,uuid),
  public.workspace_responsibility_create_custom(uuid,text,text,text,integer,text,text,text[]),
  public.workspace_responsibility_grant(uuid,uuid,timestamptz,timestamptz),
  public.workspace_responsibility_revoke(uuid), public.workspace_role_delegate(uuid,uuid,timestamptz,timestamptz),
  public.workspace_role_delegation_revoke(uuid) TO authenticated;

COMMIT;
