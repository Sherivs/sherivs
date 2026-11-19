-- Rollback for 20261117003000_sherivs_m4_role_builder.sql (M4, ADR-121). NOT APPLIED.
-- Removes the M4 functions and triggers and the three responsibility columns. Rows written through
-- the functions (custom role versions, materialised catalogue roles, settings, grants, navigation
-- responsibilities, delegations) are kept: they belong to tables owned by ADR-114 and M009, and their
-- audit rows stay in audit_logs and role_assignment_audit_events. The evidence and cadence values of
-- custom responsibilities are lost with their columns.

DROP FUNCTION IF EXISTS public.workspace_my_acting_context();
DROP FUNCTION IF EXISTS public.custom_role_activate(uuid);
DROP FUNCTION IF EXISTS public.custom_role_approve(uuid);
DROP FUNCTION IF EXISTS public.custom_role_withdraw(uuid);
DROP FUNCTION IF EXISTS public.custom_role_submit(uuid);
DROP FUNCTION IF EXISTS public.custom_role_save_draft(text, text, text, text[], text[], text, text, jsonb);
DROP FUNCTION IF EXISTS public.custom_role_catalog_code(uuid, text);
DROP FUNCTION IF EXISTS public.custom_role_require_admin();
DROP FUNCTION IF EXISTS public.custom_role_layout_problem(jsonb, boolean);
DROP FUNCTION IF EXISTS public.workspace_responsibility_define(text, text, text, text[], text[], integer, integer, text, text);

ALTER TABLE public.workspace_responsibility_catalog
  DROP CONSTRAINT IF EXISTS workspace_responsibility_catalog_m4_evidence_chk,
  DROP CONSTRAINT IF EXISTS workspace_responsibility_catalog_m4_cadence_chk,
  DROP CONSTRAINT IF EXISTS workspace_responsibility_catalog_m4_description_chk,
  DROP COLUMN IF EXISTS review_cadence_days,
  DROP COLUMN IF EXISTS evidence_required,
  DROP COLUMN IF EXISTS description;

DROP TRIGGER IF EXISTS trg_user_role_assignments_delegation_follow ON public.user_role_assignments;
DROP FUNCTION IF EXISTS public.role_assignment_delegation_follow_source();
DROP TRIGGER IF EXISTS trg_role_assignment_delegation_bounds ON public.role_assignment_delegations;
DROP FUNCTION IF EXISTS public.role_assignment_delegation_bounds_guard();
