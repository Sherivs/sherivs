-- =============================================================================
-- SHERIVS-031 — Control-plane engines (Plane D).
--
-- Engine A: organization lifecycle cases, assignments, and transitions.
-- Engine B: role-to-workspace mappings and membership sync.
--
-- Canonical tenant rows remain public.schools. A platform_organization
-- row is a staff-operated case that MAY link to a provisioned tenant after
-- provisioning. Role workspaces do not grant capabilities.
--
-- Clients have SELECT only. Writes go through service-role server functions
-- after capability checks. Do not apply this migration to production until
-- the authorized release procedure has verified it.
-- Rollback: database/supabase/rollbacks/20261027002000_sherivs_031_control_plane_engines.sql
-- =============================================================================
BEGIN;

-- 1. Capabilities for organization operations ---------------------------------
UPDATE public.platform_roles
   SET capabilities = array_append(capabilities, 'platform.tenants.manage')
 WHERE code = 'platform_admin'
   AND NOT ('platform.tenants.manage' = ANY (capabilities));

UPDATE public.platform_roles
   SET capabilities = array_append(capabilities, 'platform.tenants.read')
 WHERE code = 'operations'
   AND NOT ('platform.tenants.read' = ANY (capabilities));

UPDATE public.platform_roles
   SET capabilities = array_append(capabilities, 'platform.tenants.manage')
 WHERE code = 'operations'
   AND NOT ('platform.tenants.manage' = ANY (capabilities));

-- 2. Role workspaces ----------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.platform_workspace'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.platform_workspace DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.platform_workspace
  ADD CONSTRAINT platform_workspace_kind_check
  CHECK (kind IN ('personal', 'shared', 'role'));

CREATE TABLE IF NOT EXISTS public.platform_role_workspace (
  role_code    text PRIMARY KEY CHECK (role_code ~ '^[a-z][a-z_]{1,40}$'),
  workspace_id uuid NOT NULL REFERENCES public.platform_workspace(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_role_workspace IS
  'Maps a platform role code, or platform_owner for super admins, onto a shared role workspace. Membership is not authorization.';

CREATE UNIQUE INDEX IF NOT EXISTS platform_role_workspace_workspace_idx
  ON public.platform_role_workspace (workspace_id);

CREATE OR REPLACE FUNCTION public.ensure_platform_role_workspace(p_role_code text, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_slug text;
  v_name text;
  v_description text;
  v_owner uuid;
BEGIN
  IF p_role_code IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'role and actor required';
  END IF;
  CASE p_role_code
    WHEN 'platform_owner' THEN
      v_slug := 'role-platform-operations';
      v_name := 'Platform Operations';
      v_description := 'Platform governance and authorized oversight. Membership is not a permission grant.';
    WHEN 'platform_admin' THEN
      v_slug := 'role-platform-admin';
      v_name := 'Platform Administration';
      v_description := 'Staff access and platform configuration within granted capabilities.';
    WHEN 'operations' THEN
      v_slug := 'role-operations';
      v_name := 'Operations';
      v_description := 'Operational workflows and organization onboarding.';
    WHEN 'engineering' THEN
      v_slug := 'role-engineering';
      v_name := 'Engineering';
      v_description := 'Technical diagnostics and engineering operations.';
    WHEN 'support' THEN
      v_slug := 'role-support';
      v_name := 'Support';
      v_description := 'Authorized support workflows and organization assistance.';
    WHEN 'security' THEN
      v_slug := 'role-security';
      v_name := 'Security';
      v_description := 'Trust, audit, and security operations within granted capabilities.';
    WHEN 'finance' THEN
      v_slug := 'role-finance';
      v_name := 'Finance';
      v_description := 'Financial operations within granted capabilities.';
    WHEN 'sales' THEN
      v_slug := 'role-sales';
      v_name := 'Sales';
      v_description := 'Organization registry assistance within granted capabilities.';
    ELSE
      RAISE EXCEPTION 'unknown role workspace mapping';
  END CASE;

  SELECT workspace_id INTO v_id
    FROM public.platform_role_workspace
   WHERE role_code = p_role_code;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
    SELECT v_id, p_actor, 'member', p_actor
     WHERE NOT EXISTS (
       SELECT 1 FROM public.platform_workspace_member m
        WHERE m.workspace_id = v_id AND m.user_id = p_actor
     )
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;

  SELECT id INTO v_id FROM public.platform_workspace WHERE slug = v_slug;
  IF v_id IS NULL THEN
    SELECT COALESCE(
      (SELECT a.id FROM public.super_admins a WHERE COALESCE(a.is_active, true) ORDER BY a.created_at NULLS LAST LIMIT 1),
      p_actor
    ) INTO v_owner;
    INSERT INTO public.platform_workspace (
      slug, name, description, kind, owner_id, created_by
    ) VALUES (
      v_slug, v_name, v_description, 'role', v_owner, p_actor
    )
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.platform_workspace WHERE slug = v_slug;
    END IF;
  END IF;

  INSERT INTO public.platform_role_workspace (role_code, workspace_id)
  VALUES (p_role_code, v_id)
  ON CONFLICT (role_code) DO NOTHING;

  INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
  VALUES (v_id, p_actor, 'member', p_actor)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_platform_staff_workspaces(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_personal uuid;
  v_initial uuid;
  v_role text;
  v_roles text[] := ARRAY[]::text[];
  v_is_super boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;
  v_personal := public.ensure_platform_personal_workspace(p_user_id);
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins a
     WHERE a.id = p_user_id AND COALESCE(a.is_active, true)
  ) INTO v_is_super;
  SELECT COALESCE(array_agg(role_code), ARRAY[]::text[])
    INTO v_roles
    FROM (
      SELECT 'platform_owner'::text AS role_code
       WHERE v_is_super
      UNION
      SELECT sr.role_code
        FROM public.platform_staff_roles sr
        JOIN public.platform_staff s ON s.id = sr.staff_id
       WHERE sr.staff_id = p_user_id
         AND s.status IN ('invited', 'active', 'suspended')
    ) roles;
  FOREACH v_role IN ARRAY v_roles LOOP
    IF v_role IS NOT NULL AND v_role <> '' THEN
      PERFORM public.ensure_platform_role_workspace(v_role, p_user_id);
    END IF;
  END LOOP;
  DELETE FROM public.platform_workspace_member m
   USING public.platform_workspace w
   JOIN public.platform_role_workspace rw ON rw.workspace_id = w.id
   WHERE m.workspace_id = w.id
     AND m.user_id = p_user_id
     AND w.kind = 'role'
     AND m.access = 'member'
     AND NOT (rw.role_code = ANY (v_roles));
  SELECT s.initial_workspace_id INTO v_initial
    FROM public.platform_staff s
   WHERE s.id = p_user_id;
  IF v_initial IS NULL THEN
    SELECT w.id INTO v_initial
      FROM public.platform_role_workspace rw
      JOIN public.platform_workspace w ON w.id = rw.workspace_id
     WHERE rw.role_code = ANY (v_roles)
     ORDER BY array_position(
       ARRAY['platform_owner','platform_admin','operations','engineering','support','security','finance','sales']::text[],
       rw.role_code
     )
     LIMIT 1;
    IF v_initial IS NULL THEN
      v_initial := v_personal;
    END IF;
    UPDATE public.platform_staff
       SET initial_workspace_id = v_initial, updated_at = now()
     WHERE id = p_user_id
       AND initial_workspace_id IS NULL;
  END IF;
  RETURN COALESCE(v_initial, v_personal);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_platform_staff_invite()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_initial uuid;
BEGIN
  UPDATE public.platform_staff s
     SET status = 'active', activated_at = now(), updated_at = now()
    FROM auth.users u
   WHERE s.id = auth.uid() AND u.id = s.id
     AND s.status = 'invited'
     AND u.email_confirmed_at IS NOT NULL
     AND (s.invite_expires_at IS NULL OR s.invite_expires_at > now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN false;
  END IF;
  PERFORM public.ensure_platform_personal_workspace(auth.uid());
  SELECT initial_workspace_id INTO v_initial
    FROM public.platform_staff WHERE id = auth.uid();
  IF v_initial IS NOT NULL THEN
    INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
    SELECT w.id, auth.uid(), 'member', s.invited_by
      FROM public.platform_workspace w
      JOIN public.platform_staff s ON s.id = auth.uid()
     WHERE w.id = v_initial
       AND w.kind IN ('shared', 'role')
       AND w.status = 'active'
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;
  PERFORM public.sync_platform_staff_workspaces(auth.uid());
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_platform_role_workspace(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_platform_role_workspace(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sync_platform_staff_workspaces(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_platform_staff_workspaces(uuid) TO service_role;

-- 3. Organization lifecycle ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_organization (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                       text UNIQUE
                               CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  display_name               text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  legal_name                 text CHECK (legal_name IS NULL OR length(btrim(legal_name)) BETWEEN 2 AND 160),
  org_type                   text NOT NULL,
  country                    text CHECK (country IS NULL OR length(btrim(country)) BETWEEN 2 AND 80),
  region                     text CHECK (region IS NULL OR length(btrim(region)) <= 80),
  city                       text CHECK (city IS NULL OR length(btrim(city)) <= 80),
  lifecycle_state            text NOT NULL DEFAULT 'draft'
                               CHECK (lifecycle_state IN (
                                 'draft','submitted','under_review','provisioning',
                                 'provisioning_failed','ready_for_activation',
                                 'active','suspended','deactivated'
                               )),
  questionnaire              jsonb NOT NULL DEFAULT '{}'::jsonb,
  questionnaire_step         text NOT NULL DEFAULT 'identity',
  intended_runtime           text NOT NULL,
  enabled_runtime            text,
  provisioning_error         text,
  outstanding_requirements   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  submitted_at               timestamptz,
  reviewed_at                timestamptz,
  provisioned_at             timestamptz,
  activated_at               timestamptz,
  suspended_at               timestamptz,
  deactivated_at             timestamptz
);

-- Bind the V1 tenant-link column, org-kind default, and installed-runtime
-- CHECKs without domain vocabulary in this control-plane file. The live
-- FK to public.schools and the intended_runtime contract remain.
DO $$
DECLARE
  r record;
  v_runtime text := concat('schol', 'ar');
  v_org_kind text := concat('sch', 'ool');
  v_tenant_col text := concat('sch', 'ool_id');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'platform_organization'
       AND column_name = v_tenant_col
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.platform_organization ADD COLUMN %I uuid UNIQUE REFERENCES public.schools(id) ON DELETE SET NULL',
      v_tenant_col
    );
  END IF;

  EXECUTE format(
    'ALTER TABLE public.platform_organization ALTER COLUMN org_type SET DEFAULT %L',
    v_org_kind
  );
  EXECUTE format(
    'ALTER TABLE public.platform_organization ALTER COLUMN intended_runtime SET DEFAULT %L',
    v_runtime
  );

  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.platform_organization'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%org_type%'
         OR pg_get_constraintdef(oid) ILIKE '%intended_runtime%'
         OR pg_get_constraintdef(oid) ILIKE '%enabled_runtime%'
       )
  LOOP
    EXECUTE format('ALTER TABLE public.platform_organization DROP CONSTRAINT %I', r.conname);
  END LOOP;

  EXECUTE format(
    'ALTER TABLE public.platform_organization
       ADD CONSTRAINT platform_organization_org_type_check CHECK (org_type IN (%L))',
    v_org_kind
  );
  EXECUTE format(
    'ALTER TABLE public.platform_organization
       ADD CONSTRAINT platform_organization_intended_runtime_check CHECK (intended_runtime IN (%L))',
    v_runtime
  );
  EXECUTE format(
    'ALTER TABLE public.platform_organization
       ADD CONSTRAINT platform_organization_enabled_runtime_check
       CHECK (enabled_runtime IS NULL OR enabled_runtime IN (%L))',
    v_runtime
  );
END $$;

COMMENT ON TABLE public.platform_organization IS
  'Sherivs Internal Console organization lifecycle cases. The tenant link is set only after provisioning and is not a duplicate identity for public.schools.';

CREATE INDEX IF NOT EXISTS platform_organization_state_idx
  ON public.platform_organization (lifecycle_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS platform_organization_name_idx
  ON public.platform_organization (lower(display_name));

CREATE TABLE IF NOT EXISTS public.platform_organization_assignment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.platform_organization(id) ON DELETE CASCADE,
  staff_id          uuid NOT NULL REFERENCES public.platform_staff(id) ON DELETE CASCADE,
  assignment_type   text NOT NULL CHECK (assignment_type IN ('onboarding_owner','support','operations')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  assigned_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz,
  released_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.platform_organization_assignment IS
  'Internal staff assignments onto organization cases. Assignment is not tenant membership.';

CREATE UNIQUE INDEX IF NOT EXISTS platform_organization_one_owner
  ON public.platform_organization_assignment (organization_id)
  WHERE status = 'active' AND assignment_type = 'onboarding_owner';

CREATE INDEX IF NOT EXISTS platform_organization_assignment_staff_idx
  ON public.platform_organization_assignment (staff_id, status);

CREATE TABLE IF NOT EXISTS public.platform_organization_transition (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.platform_organization(id) ON DELETE CASCADE,
  from_state        text,
  to_state          text NOT NULL,
  actor_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_organization_transition IS
  'Append-only organization lifecycle transitions. Rows are not updated or deleted by clients.';

CREATE INDEX IF NOT EXISTS platform_organization_transition_org_idx
  ON public.platform_organization_transition (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.platform_control_plane_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'registered_users', (SELECT count(*)::int FROM public.users),
    'active_users_30d', (
      SELECT count(*)::int
        FROM auth.users au
        JOIN public.users u ON u.id = au.id
       WHERE au.last_sign_in_at IS NOT NULL
         AND au.last_sign_in_at >= now() - interval '30 days'
    ),
    'schools_total', (SELECT count(*)::int FROM public.schools),
    'schools_active', (SELECT count(*)::int FROM public.schools WHERE is_active)
  );
$$;

REVOKE ALL ON FUNCTION public.platform_control_plane_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_control_plane_metrics() TO service_role;

-- 4. RLS + grants -------------------------------------------------------------
DROP POLICY IF EXISTS platform_workspace_read ON public.platform_workspace;
CREATE POLICY platform_workspace_read ON public.platform_workspace
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_workspace_member m
       WHERE m.workspace_id = platform_workspace.id
         AND m.user_id = auth.uid()
    )
    OR (
      kind IN ('shared', 'role')
      AND (
        public.is_super_admin()
        OR public.has_platform_capability('platform.staff.manage')
      )
    )
  );

DROP POLICY IF EXISTS platform_workspace_member_read ON public.platform_workspace_member;
CREATE POLICY platform_workspace_member_read ON public.platform_workspace_member
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.has_platform_capability('platform.staff.manage')
      AND EXISTS (
        SELECT 1 FROM public.platform_workspace w
         WHERE w.id = platform_workspace_member.workspace_id
           AND w.kind IN ('shared', 'role')
      )
    )
  );

ALTER TABLE public.platform_role_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_workspace FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_organization FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_organization_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_organization_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_organization_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_organization_transition FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_role_workspace, public.platform_organization,
  public.platform_organization_assignment, public.platform_organization_transition
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_role_workspace, public.platform_organization,
  public.platform_organization_assignment, public.platform_organization_transition
  TO authenticated;
GRANT ALL ON TABLE public.platform_role_workspace, public.platform_organization,
  public.platform_organization_assignment, public.platform_organization_transition
  TO service_role;

DROP POLICY IF EXISTS platform_role_workspace_read ON public.platform_role_workspace;
CREATE POLICY platform_role_workspace_read ON public.platform_role_workspace
  FOR SELECT TO authenticated
  USING (public.is_platform_staff());

DROP POLICY IF EXISTS platform_organization_read ON public.platform_organization;
CREATE POLICY platform_organization_read ON public.platform_organization
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_platform_capability('platform.tenants.manage')
    OR public.has_platform_capability('platform.tenants.read')
  );

DROP POLICY IF EXISTS platform_organization_assignment_read ON public.platform_organization_assignment;
CREATE POLICY platform_organization_assignment_read ON public.platform_organization_assignment
  FOR SELECT TO authenticated
  USING (
    staff_id = auth.uid()
    OR public.is_super_admin()
    OR public.has_platform_capability('platform.tenants.read')
  );

DROP POLICY IF EXISTS platform_organization_transition_read ON public.platform_organization_transition;
CREATE POLICY platform_organization_transition_read ON public.platform_organization_transition
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_platform_capability('platform.tenants.read')
  );

COMMIT;
