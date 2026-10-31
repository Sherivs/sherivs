-- Rollback of 20261027001000_sherivs_030_internal_console.sql.
-- Restores claim_platform_staff_invite to the SHERIVS-008 body and drops the
-- Internal Console store. Staff rows and super_admins are kept.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_platform_staff_invite()
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.platform_staff s
     SET status = 'active', activated_at = now(), updated_at = now()
    FROM auth.users u
   WHERE s.id = auth.uid() AND u.id = s.id
     AND s.status = 'invited' AND u.email_confirmed_at IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

DROP FUNCTION IF EXISTS public.ensure_platform_personal_workspace(uuid);

ALTER TABLE public.platform_staff DROP CONSTRAINT IF EXISTS platform_staff_initial_workspace_fk;
ALTER TABLE public.platform_staff DROP COLUMN IF EXISTS initial_workspace_id;
ALTER TABLE public.platform_staff DROP COLUMN IF EXISTS invite_expires_at;

DROP TABLE IF EXISTS public.platform_recent_access;
DROP TABLE IF EXISTS public.platform_workspace_member;
DROP TABLE IF EXISTS public.platform_workspace;
DROP TABLE IF EXISTS public.platform_runtime;

COMMIT;
