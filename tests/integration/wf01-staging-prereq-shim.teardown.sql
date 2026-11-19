-- Teardown for tests/integration/wf01-staging-prereq-shim.sql. STAGING PROJECT ONLY.
-- Run the WF-01 rollback first (database/supabase/rollbacks/20261117000400_...). This drops only
-- the shim objects and refuses to run unless the shim marker exists.
BEGIN;
DO $guard$
BEGIN
  IF to_regclass('public.wf01_staging_shim_marker') IS NULL THEN
    RAISE EXCEPTION 'WF01 SHIM TEARDOWN: marker missing; refusing';
  END IF;
  IF to_regclass('public.wf_definition') IS NOT NULL THEN
    RAISE EXCEPTION 'WF01 SHIM TEARDOWN: roll back WF-01 first';
  END IF;
END $guard$;
DROP TABLE public.audit_chain CASCADE;
DROP FUNCTION public.audit_chain_link_guard();
DROP FUNCTION public.audit_chain_append_only();
DROP FUNCTION public.audit_chain_canonical_hash(text, bigint, timestamptz, uuid, text, text, text, text, text, inet, text, text, text);
DROP FUNCTION public.has_platform_capability(text);
DROP FUNCTION public.has_permission(uuid, text, text, text);
DROP FUNCTION public.effective_permissions(uuid, uuid);
DROP FUNCTION public.can_administer_org(uuid);
DROP FUNCTION public.is_super_admin();
DROP FUNCTION public.get_my_role();
DROP FUNCTION public.get_my_school_id();
DROP TABLE public.user_role_assignments, public.org_role_custom_grants, public.org_role_permission_settings,
  public.role_template_permissions, public.role_catalog, public.platform_staff_roles, public.platform_staff,
  public.platform_roles, public.super_admins, public.users, public.schools, public.wf01_staging_shim_marker;
COMMIT;
