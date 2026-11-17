-- WF-02 staging shim teardown. STAGING ONLY. Run after the WF-02 rollback.
BEGIN;
DO $g$ BEGIN
  IF to_regclass('public.wf02_staging_shim_marker') IS NULL THEN RAISE EXCEPTION 'WF02 SHIM: not installed here'; END IF;
END $g$;
DROP TRIGGER IF EXISTS trg_role_template_permissions_guard ON public.role_template_permissions;
DROP FUNCTION IF EXISTS public.workspace_role_sod_validate_schedule(uuid, uuid);
DROP FUNCTION IF EXISTS public.role_catalog_guard();
DELETE FROM public.role_catalog WHERE org_id IS NULL
  AND code IN ('proprietor','head_of_institution','governance_board','auditor','teacher','parent');
ALTER TABLE public.user_role_assignments DROP COLUMN IF EXISTS assigned_by;
ALTER TABLE public.role_catalog DROP COLUMN IF EXISTS requires_verified_authority_link;
DROP TABLE IF EXISTS public.workspace_responsibility_permissions, public.role_assignment_delegations,
  public.sod_permission_rules, public.role_templates, public.permission_catalog, public.wf02_staging_shim_marker;
COMMIT;
