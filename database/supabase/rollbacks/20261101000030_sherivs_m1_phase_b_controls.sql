-- Rollback of 20261101000030_sherivs_m1_phase_b_controls.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_platform_personal_workspace(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;
  SELECT id INTO v_id
    FROM public.platform_workspace
   WHERE owner_id = p_user_id AND kind = 'personal';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
    VALUES (v_id, p_user_id, 'owner', p_user_id)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;
  SELECT COALESCE(
           (SELECT s.full_name FROM public.platform_staff s WHERE s.id = p_user_id),
           (SELECT a.full_name FROM public.super_admins a WHERE a.id = p_user_id),
           'Staff member'
         )
    INTO v_name;
  INSERT INTO public.platform_workspace (
    slug, name, description, kind, owner_id, created_by
  ) VALUES (
    'personal-' || replace(p_user_id::text, '-', ''),
    'My Workspace',
    v_name || '''s personal working environment. Private by default.',
    'personal',
    p_user_id,
    p_user_id
  )
  RETURNING id INTO v_id;
  INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
  VALUES (v_id, p_user_id, 'owner', p_user_id)
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

DROP FUNCTION IF EXISTS public.set_platform_staff_roles(uuid, text[], uuid);

UPDATE public.platform_roles
   SET capabilities = array_append(capabilities, 'platform.tenants.read')
 WHERE code = 'platform_admin'
   AND NOT ('platform.tenants.read' = ANY (capabilities));
UPDATE public.platform_roles
   SET capabilities = array_append(capabilities, 'platform.tenants.manage')
 WHERE code = 'platform_admin'
   AND NOT ('platform.tenants.manage' = ANY (capabilities));

UPDATE public.platform_workspace
   SET status = 'active', updated_at = now()
 WHERE slug IN ('role-security', 'role-finance', 'role-sales');

INSERT INTO public.platform_role_workspace (role_code, workspace_id)
SELECT role_code, w.id
  FROM (VALUES
    ('security'::text, 'role-security'::text),
    ('finance'::text, 'role-finance'::text),
    ('sales'::text, 'role-sales'::text)
  ) legacy(role_code, slug)
  JOIN public.platform_workspace w ON w.slug = legacy.slug
ON CONFLICT (role_code) DO NOTHING;

SELECT public.sync_platform_staff_workspaces(s.id)
  FROM public.platform_staff s
 WHERE s.status IN ('invited', 'active', 'suspended');

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

DROP POLICY IF EXISTS platform_recent_access_read ON public.platform_recent_access;
CREATE POLICY platform_recent_access_read ON public.platform_recent_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS platform_ticket_read ON public.platform_ticket;
CREATE POLICY platform_ticket_read ON public.platform_ticket
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_platform_capability('platform.tenants.read')
    OR public.has_platform_capability('platform.support.handle')
  );

DROP POLICY IF EXISTS platform_incident_read ON public.platform_incident;
CREATE POLICY platform_incident_read ON public.platform_incident
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_platform_capability('platform.engineering.read')
    OR public.has_platform_capability('platform.operations.read')
    OR public.has_platform_capability('platform.tenants.read')
    OR public.has_platform_capability('platform.audit.read')
  );

DROP POLICY IF EXISTS platform_staff_read ON public.platform_staff;
CREATE POLICY platform_staff_read ON public.platform_staff
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_platform_capability('platform.staff.read'));

DROP POLICY IF EXISTS platform_staff_roles_read ON public.platform_staff_roles;
CREATE POLICY platform_staff_roles_read ON public.platform_staff_roles
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR public.has_platform_capability('platform.staff.read'));

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

DROP FUNCTION IF EXISTS public.has_internal_console_capability(text);

COMMIT;
