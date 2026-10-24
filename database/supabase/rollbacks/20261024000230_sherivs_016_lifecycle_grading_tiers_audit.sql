-- Rollback for 20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql
-- Data written by 016 (lifecycle events, rollovers, courses, scales, tier map,
-- bridged audit_chain rows, role assignments) is removed or ended. Bridged
-- audit_chain rows are append-only by design and are NOT deleted.
BEGIN;
-- 5
DROP TRIGGER IF EXISTS trg_users_admin_role_sync ON public.users;
DROP FUNCTION IF EXISTS public.users_admin_role_sync();
UPDATE public.cg_role_assignment SET status = 'ended', ended_on = greatest(started_on, current_date)
 WHERE role_id = 'role:administrator' AND status = 'active' AND tenant_ref IN (SELECT id::text FROM public.schools);
DROP FUNCTION IF EXISTS public.sync_admin_role_assignments(uuid);
-- 4
DROP TRIGGER IF EXISTS trg_audit_logs_bridge_chain ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;
DROP FUNCTION IF EXISTS public.audit_logs_bridge_to_chain();
DROP FUNCTION IF EXISTS public.audit_chain_canonical_hash(text, bigint, timestamptz, uuid, text, text, text, text, text, inet, text, text, text);
GRANT UPDATE, DELETE ON public.audit_logs TO authenticated;
-- 3
DROP TRIGGER IF EXISTS trg_schools_tier_entitlements ON public.schools;
DROP FUNCTION IF EXISTS public.schools_tier_entitlement_sync();
DROP FUNCTION IF EXISTS public.meter_consume_for_plan(uuid, text, text, text, bigint);
DROP FUNCTION IF EXISTS public.entitlement_quota(uuid, text);
DROP FUNCTION IF EXISTS public.sync_org_entitlements_from_tier(uuid);
DROP TABLE IF EXISTS public.subscription_tier_plans;
DELETE FROM public.org_entitlements WHERE plan_id IN ('starter', 'growth', 'enterprise');
DELETE FROM public.entitlement_plans WHERE id IN ('starter', 'growth', 'enterprise')
  AND NOT EXISTS (SELECT 1 FROM public.org_entitlements e WHERE e.plan_id = entitlement_plans.id);
-- 2
DROP FUNCTION IF EXISTS public.session_rollover(uuid, text, text, boolean, jsonb);
DROP FUNCTION IF EXISTS public.configure_academic_defaults(uuid, text, jsonb);
DROP TABLE IF EXISTS public.member_lifecycle_events;
DROP TABLE IF EXISTS public.session_rollovers;
DROP TABLE IF EXISTS public.progression_rules;  -- includes max_carryover_courses / probation_cgpa (7+ carry-over repeat rule)
DROP FUNCTION IF EXISTS public.forbid_mutation_append_only() CASCADE;
DROP INDEX IF EXISTS public.idx_students_school_status;
ALTER TABLE public.students DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS current_level, DROP COLUMN IF EXISTS programme,
  DROP COLUMN IF EXISTS current_session, DROP COLUMN IF EXISTS status_changed_at, DROP COLUMN IF EXISTS graduated_at;
ALTER TABLE public.classes DROP COLUMN IF EXISTS programme;
-- 1
DROP FUNCTION IF EXISTS public.member_transcript(uuid);
DROP FUNCTION IF EXISTS public.degree_class(numeric, numeric);
DROP FUNCTION IF EXISTS public.member_outstanding_carryovers(uuid);
DROP FUNCTION IF EXISTS public.member_gpa(uuid, text, text);
DROP TRIGGER IF EXISTS trg_grades_points_fill ON public.grades;
DROP FUNCTION IF EXISTS public.grades_points_fill();
DROP INDEX IF EXISTS public.idx_grades_student_year;
ALTER TABLE public.grades DROP COLUMN IF EXISTS course_id, DROP COLUMN IF EXISTS credit_units, DROP COLUMN IF EXISTS grade_point,
  DROP COLUMN IF EXISTS attempt, DROP COLUMN IF EXISTS is_carryover;
DROP TABLE IF EXISTS public.courses;
ALTER TABLE public.schools DROP COLUMN IF EXISTS grading_scale_id, DROP COLUMN IF EXISTS institution_category;
DROP TABLE IF EXISTS public.grading_scale_bands;
DROP TABLE IF EXISTS public.grading_scales;
DROP FUNCTION IF EXISTS public.can_administer_org(uuid);
COMMIT;
