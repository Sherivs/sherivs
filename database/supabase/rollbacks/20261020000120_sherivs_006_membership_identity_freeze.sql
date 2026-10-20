-- Rollback for 20261020000120_sherivs_006_membership_identity_freeze.sql.
-- Restores production's definitions verbatim (bodies copied from 20261003000042,
-- 20261020000090 and 20260620151525). Re-opens the SHERIVS-006 holes; only use on a regression.
BEGIN;
DROP TRIGGER IF EXISTS trg_memberships_forbid_direct_write ON public.organization_memberships;
DROP FUNCTION IF EXISTS public.forbid_direct_membership_write();
DROP TRIGGER IF EXISTS trg_users_forbid_self_privilege_mutation ON public.users;
DROP FUNCTION IF EXISTS public.forbid_self_privilege_mutation();
GRANT SELECT, INSERT, DELETE, MAINTAIN, UPDATE ON TABLE public.organization_memberships TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT m.role
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
    ),
    (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
  );
$$;

COMMENT ON FUNCTION public.get_my_role() IS NULL;

CREATE OR REPLACE FUNCTION public.get_my_school_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT m.school_id
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
    ),
    (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
  );
$$;

COMMENT ON FUNCTION public.get_my_school_id() IS NULL;

CREATE OR REPLACE FUNCTION public.my_active_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.role FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true
$$;

CREATE OR REPLACE FUNCTION public.is_school_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin','principal'));
$$;
COMMENT ON FUNCTION public.is_school_admin() IS NULL;
COMMIT;
