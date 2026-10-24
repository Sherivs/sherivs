-- Rollback SHERIVS-021. Drops only objects added by 021.
BEGIN;
DROP TRIGGER IF EXISTS trg_attendance_authz_shadow ON public.attendance;
DROP FUNCTION IF EXISTS public.attendance_authz_shadow(), public.onboarding_apply(uuid, text), public.onboarding_plan(uuid), public.onboarding_next(uuid),
  public.onboarding_answer(uuid, text, jsonb), public.onboarding_start(uuid), public.authz_shadow_report(uuid, interval), public.authz_shadow(text, text, uuid, boolean),
  public.authz_check(uuid, text, text, uuid), public.break_glass_open(uuid, text), public.resource_dims(text, uuid), public.role_scope_set_remove(uuid),
  public.role_scope_set_add(uuid, jsonb, text), public._assigner_limits(uuid, uuid), public._scope_ref_ok(uuid, text, text);
DROP TABLE IF EXISTS public.onboarding_sessions, public.authz_shadow_log, public.policy_rules, public.break_glass_grants, public.role_assignment_scopes,
  public.role_assignment_scope_sets, public.class_curriculum, public.curriculum_templates, public.org_group_members, public.org_groups;
ALTER TABLE public.classes DROP COLUMN IF EXISTS level_id, DROP COLUMN IF EXISTS shift_id;
DROP TABLE IF EXISTS public.school_levels, public.school_shifts;
ALTER TABLE public.school_sections DROP COLUMN IF EXISTS gender, DROP COLUMN IF EXISTS residency;
ALTER TABLE public.user_role_assignments DROP COLUMN IF EXISTS valid_until, DROP COLUMN IF EXISTS acting;
COMMIT;
