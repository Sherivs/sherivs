-- Rollback for 20261024000240_sherivs_017_role_permission_catalog.sql
-- Removes the role/permission catalog, org configuration and assignments.
-- audit_logs / audit_chain rows written by 017 are append-only and are NOT deleted.
BEGIN;
DROP TRIGGER IF EXISTS trg_school_expenses_sod ON public.school_expenses;
DROP FUNCTION IF EXISTS public.school_expenses_sod_guard();
DROP TRIGGER IF EXISTS trg_staff_payroll_sod ON public.staff_payroll;
DROP FUNCTION IF EXISTS public.staff_payroll_sod_guard();
ALTER TABLE public.staff_payroll DROP COLUMN IF EXISTS prepared_by;
DROP FUNCTION IF EXISTS public.role_context(uuid, text);
DROP FUNCTION IF EXISTS public.role_create_custom(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.role_remove_custom_grant(uuid);
DROP FUNCTION IF EXISTS public.role_add_custom_grant(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.role_set_optional(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.role_unassign(uuid);
DROP FUNCTION IF EXISTS public.role_assign(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.can_manage_roles(uuid, text);
DROP FUNCTION IF EXISTS public.has_permission(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.effective_permissions(uuid, uuid);
DROP TABLE IF EXISTS public.user_role_assignments, public.org_role_custom_grants, public.org_role_permission_settings,
  public.sod_permission_rules, public.sod_template_conflicts, public.role_catalog, public.role_template_permissions,
  public.role_templates, public.role_guardrail_catalog, public.permission_catalog CASCADE;
DROP FUNCTION IF EXISTS public.role_change_audit();
DROP FUNCTION IF EXISTS public.user_role_assignments_guard();
DROP FUNCTION IF EXISTS public.org_role_custom_grants_guard();
DROP FUNCTION IF EXISTS public.org_role_settings_guard();
DROP FUNCTION IF EXISTS public.role_catalog_guard();
COMMIT;
