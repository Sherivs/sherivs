-- Rollback of 20261027002000_sherivs_031_control_plane_engines.sql.
-- Restores claim_platform_staff_invite to the SHERIVS-030 body, restores
-- workspace kind to personal|shared, and drops control-plane engine tables.
-- Capability array appends are reversed only when present.
BEGIN;

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
     WHERE w.id = v_initial AND w.kind = 'shared' AND w.status = 'active'
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;
  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.sync_platform_staff_workspaces(uuid);
DROP FUNCTION IF EXISTS public.ensure_platform_role_workspace(text, uuid);
DROP FUNCTION IF EXISTS public.platform_control_plane_metrics();

DROP TABLE IF EXISTS public.platform_organization_transition;
DROP TABLE IF EXISTS public.platform_organization_assignment;
DROP TABLE IF EXISTS public.platform_organization;
DROP TABLE IF EXISTS public.platform_role_workspace;

DELETE FROM public.platform_workspace_member m
 USING public.platform_workspace w
 WHERE m.workspace_id = w.id AND w.kind = 'role';
DELETE FROM public.platform_workspace WHERE kind = 'role';

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
  CHECK (kind IN ('personal', 'shared'));

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
      kind = 'shared'
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
           AND w.kind = 'shared'
      )
    )
  );

UPDATE public.platform_roles
   SET capabilities = array_remove(capabilities, 'platform.tenants.manage')
 WHERE code IN ('platform_admin', 'operations');

UPDATE public.platform_roles
   SET capabilities = array_remove(capabilities, 'platform.tenants.read')
 WHERE code = 'operations';

COMMIT;
