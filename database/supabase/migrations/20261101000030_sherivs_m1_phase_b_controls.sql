-- SHERIVS-M1 — Phase B workspace, invitation, and access controls.
-- New forward-only migration; do not apply to a production database from this task.
BEGIN;

CREATE OR REPLACE FUNCTION public.has_internal_console_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.platform_staff s
      JOIN public.platform_staff_roles sr ON sr.staff_id = s.id
      JOIN public.platform_roles r ON r.code = sr.role_code
     WHERE s.id = auth.uid()
       AND s.status = 'active'
       AND p_capability = ANY (r.capabilities)
  );
$$;

REVOKE ALL ON FUNCTION public.has_internal_console_capability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_internal_console_capability(text) TO authenticated, service_role;

UPDATE public.platform_roles
   SET capabilities = array_remove(
     array_remove(capabilities, 'platform.tenants.manage'),
     'platform.tenants.read'
   )
 WHERE code = 'platform_admin';

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

  IF v_id IS NULL THEN
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
    ON CONFLICT (owner_id) WHERE kind = 'personal' DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id INTO v_id
        FROM public.platform_workspace
       WHERE owner_id = p_user_id AND kind = 'personal';
    END IF;
  END IF;

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
      SELECT DISTINCT CASE sr.role_code
        WHEN 'security' THEN 'platform_admin'
        WHEN 'finance' THEN 'operations'
        WHEN 'sales' THEN 'operations'
        ELSE sr.role_code
      END AS role_code
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

  IF v_initial IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.platform_workspace w
     WHERE w.id = v_initial
       AND w.status = 'active'
       AND (
         w.kind = 'shared'
         OR (
           w.kind = 'role'
           AND EXISTS (
             SELECT 1 FROM public.platform_role_workspace rw
              WHERE rw.workspace_id = w.id
                AND rw.role_code = ANY (v_roles)
           )
         )
       )
  ) THEN
    v_initial := NULL;
  END IF;

  IF v_initial IS NULL THEN
    SELECT w.id INTO v_initial
      FROM public.platform_role_workspace rw
      JOIN public.platform_workspace w ON w.id = rw.workspace_id
     WHERE rw.role_code = ANY (v_roles)
       AND w.status = 'active'
     ORDER BY array_position(
       ARRAY['platform_owner','platform_admin','operations','engineering','support']::text[],
       rw.role_code
     )
     LIMIT 1;
    v_initial := COALESCE(v_initial, v_personal);
    UPDATE public.platform_staff
       SET initial_workspace_id = v_initial, updated_at = now()
     WHERE id = p_user_id;
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
  v_now timestamptz := now();
BEGIN
  UPDATE public.platform_staff s
     SET status = 'active', activated_at = v_now, updated_at = v_now
    FROM auth.users u
   WHERE s.id = auth.uid()
     AND u.id = s.id
     AND s.status = 'invited'
     AND u.email_confirmed_at IS NOT NULL
     AND (s.invite_expires_at IS NULL OR s.invite_expires_at > v_now);
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

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    (SELECT u.id FROM public.users u WHERE u.id = auth.uid()),
    'platform_staff.invite.claim',
    'platform_staff',
    auth.uid(),
    jsonb_build_object(
      'gate', 'claim_platform_staff_invite',
      'outcome', 'succeeded',
      'actor_id', auth.uid(),
      'recorded_at', v_now,
      'tenant_id', NULL,
      'details', jsonb_build_object('status', 'active')
    )
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_platform_staff_roles(
  p_staff_id uuid,
  p_role_codes text[],
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_staff_id IS NULL OR p_actor_id IS NULL OR p_role_codes IS NULL THEN
    RAISE EXCEPTION 'staff, roles, and actor are required';
  END IF;
  SELECT status INTO v_status
    FROM public.platform_staff
   WHERE id = p_staff_id
   FOR UPDATE;
  IF NOT FOUND OR v_status = 'revoked' THEN
    RAISE EXCEPTION 'staff member cannot hold roles';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(p_role_codes) role_code
     WHERE NOT EXISTS (
       SELECT 1 FROM public.platform_roles r WHERE r.code = role_code
     )
  ) THEN
    RAISE EXCEPTION 'unknown platform role';
  END IF;

  DELETE FROM public.platform_staff_roles WHERE staff_id = p_staff_id;
  INSERT INTO public.platform_staff_roles (staff_id, role_code, granted_by)
  SELECT p_staff_id, role_code, p_actor_id
    FROM (SELECT DISTINCT unnest(p_role_codes) AS role_code) roles;
  PERFORM public.sync_platform_staff_workspaces(p_staff_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_platform_staff_roles(uuid, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_staff_roles(uuid, text[], uuid) TO service_role;

-- Retire only the out-of-envelope workspace surfaces; the role codes and
-- capabilities remain intact and resolve into the existing V1 workspaces.
UPDATE public.platform_staff s
   SET initial_workspace_id = target.workspace_id, updated_at = now()
  FROM public.platform_role_workspace legacy
  JOIN public.platform_role_workspace target
    ON target.role_code = CASE legacy.role_code
      WHEN 'security' THEN 'platform_admin'
      WHEN 'finance' THEN 'operations'
      WHEN 'sales' THEN 'operations'
    END
 WHERE legacy.role_code IN ('security', 'finance', 'sales')
   AND s.initial_workspace_id = legacy.workspace_id;

SELECT public.sync_platform_staff_workspaces(s.id)
  FROM public.platform_staff s
 WHERE s.status IN ('invited', 'active', 'suspended');

UPDATE public.platform_workspace w
   SET status = 'archived', updated_at = now()
  FROM public.platform_role_workspace rw
 WHERE rw.workspace_id = w.id
   AND rw.role_code IN ('security', 'finance', 'sales');

DELETE FROM public.platform_role_workspace
 WHERE role_code IN ('security', 'finance', 'sales');

DROP POLICY IF EXISTS platform_workspace_read ON public.platform_workspace;
CREATE POLICY platform_workspace_read ON public.platform_workspace
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    AND status = 'active'
    AND (
      EXISTS (
        SELECT 1 FROM public.platform_workspace_member m
         WHERE m.workspace_id = platform_workspace.id
           AND m.user_id = auth.uid()
      )
      OR (
        kind IN ('shared', 'role')
        AND public.has_internal_console_capability('platform.staff.manage')
      )
    )
  );

DROP POLICY IF EXISTS platform_workspace_member_read ON public.platform_workspace_member;
CREATE POLICY platform_workspace_member_read ON public.platform_workspace_member
  FOR SELECT TO authenticated
  USING (
    (
      public.is_platform_staff()
      AND user_id = auth.uid()
    )
    OR (
      public.is_platform_staff()
      AND public.has_internal_console_capability('platform.staff.manage')
      AND EXISTS (
        SELECT 1 FROM public.platform_workspace w
         WHERE w.id = platform_workspace_member.workspace_id
           AND w.kind IN ('shared', 'role')
           AND w.status = 'active'
      )
    )
  );

DROP POLICY IF EXISTS platform_staff_read ON public.platform_staff;
CREATE POLICY platform_staff_read ON public.platform_staff
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      NOT public.is_super_admin()
      AND public.has_internal_console_capability('platform.staff.read')
    )
  );

DROP POLICY IF EXISTS platform_staff_roles_read ON public.platform_staff_roles;
CREATE POLICY platform_staff_roles_read ON public.platform_staff_roles
  FOR SELECT TO authenticated
  USING (
    staff_id = auth.uid()
    OR (
      NOT public.is_super_admin()
      AND public.has_internal_console_capability('platform.staff.read')
    )
  );

DROP POLICY IF EXISTS platform_recent_access_read ON public.platform_recent_access;
CREATE POLICY platform_recent_access_read ON public.platform_recent_access
  FOR SELECT TO authenticated
  USING (public.is_platform_staff() AND user_id = auth.uid());

DROP POLICY IF EXISTS platform_ticket_read ON public.platform_ticket;
CREATE POLICY platform_ticket_read ON public.platform_ticket
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    AND NOT public.is_super_admin()
    AND (
      public.has_internal_console_capability('platform.tenants.manage')
      OR (
        public.has_internal_console_capability('platform.support.handle')
        AND organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.platform_organization_assignment a
           WHERE a.organization_id = platform_ticket.organization_id
             AND a.staff_id = auth.uid()
             AND a.assignment_type = 'support'
             AND a.status = 'active'
        )
      )
    )
  );

DROP POLICY IF EXISTS platform_incident_read ON public.platform_incident;
CREATE POLICY platform_incident_read ON public.platform_incident
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    AND NOT public.is_super_admin()
    AND (
      public.has_internal_console_capability('platform.engineering.read')
      OR public.has_internal_console_capability('platform.operations.read')
      OR public.has_internal_console_capability('platform.tenants.manage')
      OR (
        public.has_internal_console_capability('platform.tenants.read')
        AND (
          NOT public.has_internal_console_capability('platform.support.handle')
          OR (
            organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.platform_organization_assignment a
               WHERE a.organization_id = platform_incident.organization_id
                 AND a.staff_id = auth.uid()
                 AND a.assignment_type = 'support'
                 AND a.status = 'active'
            )
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS platform_organization_read ON public.platform_organization;
CREATE POLICY platform_organization_read ON public.platform_organization
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    AND NOT public.is_super_admin()
    AND (
      public.has_internal_console_capability('platform.tenants.manage')
      OR (
        public.has_internal_console_capability('platform.tenants.read')
        AND (
          NOT public.has_internal_console_capability('platform.support.handle')
          OR EXISTS (
            SELECT 1 FROM public.platform_organization_assignment a
             WHERE a.organization_id = platform_organization.id
               AND a.staff_id = auth.uid()
               AND a.assignment_type = 'support'
               AND a.status = 'active'
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS platform_organization_assignment_read ON public.platform_organization_assignment;
CREATE POLICY platform_organization_assignment_read ON public.platform_organization_assignment
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    AND NOT public.is_super_admin()
    AND (
      staff_id = auth.uid()
      OR public.has_internal_console_capability('platform.tenants.manage')
      OR (
        public.has_internal_console_capability('platform.tenants.read')
        AND NOT public.has_internal_console_capability('platform.support.handle')
      )
    )
  );

DROP POLICY IF EXISTS platform_organization_transition_read ON public.platform_organization_transition;
CREATE POLICY platform_organization_transition_read ON public.platform_organization_transition
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    AND NOT public.is_super_admin()
    AND (
      public.has_internal_console_capability('platform.tenants.manage')
      OR (
        public.has_internal_console_capability('platform.tenants.read')
        AND (
          NOT public.has_internal_console_capability('platform.support.handle')
          OR EXISTS (
            SELECT 1 FROM public.platform_organization_assignment a
             WHERE a.organization_id = platform_organization_transition.organization_id
               AND a.staff_id = auth.uid()
               AND a.assignment_type = 'support'
               AND a.status = 'active'
          )
        )
      )
    )
  );

COMMIT;
