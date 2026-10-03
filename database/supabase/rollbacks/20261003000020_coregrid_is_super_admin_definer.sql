-- =============================================================================
-- Rollback of 20261003000020_coregrid_is_super_admin_definer.sql
-- =============================================================================
-- Exact inverse: restores the SECURITY INVOKER definition last established by
-- migration 20260620122110_178748dc-376f-4c78-911d-ec879dfffce1.
--
-- WARNING: this restores the RLS self-recursion hazard (PG 54001 stack depth
-- limit exceeded on tenant reads whenever a public.super_admins row exists).
-- Roll back only as part of reversing the 2026-10-03 helper-posture work.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE id = auth.uid() AND is_active = true);
$$;
