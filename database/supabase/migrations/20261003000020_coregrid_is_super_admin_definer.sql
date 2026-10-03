-- =============================================================================
-- CoreGrid — is_super_admin() SECURITY DEFINER alignment (V1 vertical-slice find)
-- =============================================================================
-- Observed defect (F-13 e2e T6, canonical backend 2026-10-03):
--   A provisioned tenant admin's tenant-context read of the organization
--   substrate failed with PG 54001 "stack depth limit exceeded" whenever at
--   least one platform-admin row existed. Reproduced deterministically.
--
-- Recursion chain:
--   organization-table SELECT policy "Anyone can read active" entries
--     -> public.is_super_admin()                      (SECURITY INVOKER, 20260620122110)
--     -> SELECT ... FROM public.super_admins
--     -> super_admins policy "Super admin reads super_admins"
--          USING (id = auth.uid() OR public.is_super_admin())
--     -> is_super_admin() again for any scanned row whose id is not the caller
--     -> unbounded recursion -> 54001.
--
-- Why only is_super_admin():
--   20260620151525 already fixed this exact recursion class for the helpers
--   that read the canonical person table (the tenant, role and admin-status
--   predicates) by flipping them to SECURITY DEFINER, but missed is_super_admin
--   — the one helper that reads public.super_admins, whose policy calls it
--   back. The person-table helpers terminate on their own-identity term;
--   is_super_admin never terminates for a caller who is not the scanned row.
--
-- SECURITY DEFINER posture (same documented posture as 20260620151525 and the
-- MISSION-R-20 neutral helpers in 20261002000001):
--   • fixed SQL, no parameters, no client-supplied values (Constitution 26);
--   • filters strictly on auth.uid(), so it can only answer one question about
--     the CALLER ("is the caller an active platform admin?") and returns no
--     rows of substrate data to anyone;
--   • public.super_admins is not FORCE RLS, so the definer inner read bypasses
--     only the policy that would otherwise re-enter this function;
--   • RLS remains the authorization decision layer (Constitution 16) — this
--     helper is an input predicate, exactly like its three siblings.
--
-- Rollback (exact inverse):
--   database/supabase/rollbacks/20261003000020_coregrid_is_super_admin_definer.sql

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE id = auth.uid() AND is_active = true);
$$;
