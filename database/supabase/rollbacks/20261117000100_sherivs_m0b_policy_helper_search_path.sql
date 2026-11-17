-- Rollback for M0B (20261117000100): puts search_path = public back on the three policy helpers.
-- Bodies are unchanged by the migration, so only the setting is restored.
ALTER FUNCTION public.get_my_role() SET search_path = public;
ALTER FUNCTION public.get_my_school_id() SET search_path = public;
ALTER FUNCTION public.is_school_admin() SET search_path = public;
