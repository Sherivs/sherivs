-- =============================================================================
-- CoreGrid — EXACT INVERSE ROLLBACK of 20261008000050
-- (sherivs organization memberships)
-- =============================================================================
-- Restores the identity store to the exact pre-migration posture: the
-- multi-membership substrate, its trigger on public.users, its RLS policies
-- and the multi-membership-aware helper redefinitions are removed; the
-- legacy single-membership helpers (20260620122048 bodies) are restored
-- verbatim. NO data in public.users or public.schools is touched — only the
-- additive substrate is removed. Every statement below is the strict
-- inverse of one statement in the forward migration, applied in reverse
-- order.
-- =============================================================================

-- Inverse of forward §5: restore the legacy single-membership helper bodies.
CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- Inverse of forward §5: remove the membership-set helper.
REVOKE EXECUTE ON FUNCTION public.get_my_memberships() FROM authenticated, service_role;
DROP FUNCTION IF EXISTS public.get_my_memberships();

-- Inverse of forward §4: remove the policies, then the RLS posture.
DROP POLICY IF EXISTS organization_memberships_delete ON public.organization_memberships;
DROP POLICY IF EXISTS organization_memberships_update ON public.organization_memberships;
DROP POLICY IF EXISTS organization_memberships_insert ON public.organization_memberships;
DROP POLICY IF EXISTS organization_memberships_select ON public.organization_memberships;

ALTER TABLE public.organization_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships DISABLE ROW LEVEL SECURITY;

-- Inverse of forward §3/§1: dropping the table removes all membership rows.
DROP TRIGGER IF EXISTS organization_memberships_sync ON public.users;
DROP FUNCTION IF EXISTS public.sync_organization_membership_on_user_write();
DROP TABLE IF EXISTS public.organization_memberships;
