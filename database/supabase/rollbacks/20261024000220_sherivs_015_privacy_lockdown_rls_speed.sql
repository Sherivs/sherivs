-- Rollback for 20261024000220_sherivs_015_privacy_lockdown_rls_speed.sql
-- Emergency use only: step 2 re-exposes sensitive user columns.
-- The dropped schools.paystack_secret_key column is re-created EMPTY (it held
-- no values when 015 ran; the migration refuses to drop it otherwise) and kept
-- unreadable by anon/authenticated as SHERIVS-002 required.
BEGIN;
-- 1. Integrity / speed
ALTER TABLE public.grades DROP CONSTRAINT IF EXISTS grades_score_range;
DROP INDEX IF EXISTS public.idx_students_user_id, public.idx_students_parent_id,
  public.idx_grades_school_published, public.idx_grades_teacher;
-- Policies were rewritten logically equivalent except the published-results
-- lock; undo that lock only:
DROP POLICY IF EXISTS grades_teacher_update ON public.grades;
CREATE POLICY grades_teacher_update ON public.grades FOR UPDATE TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()))
  WITH CHECK (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS grades_teacher_delete ON public.grades;
CREATE POLICY grades_teacher_delete ON public.grades FOR DELETE TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()));
-- 2. Privacy lockdown
DROP FUNCTION IF EXISTS public.users_private_fields(uuid[]);
GRANT SELECT ON public.users TO anon, authenticated;
-- 3. Legacy column (empty)
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS paystack_secret_key text;
REVOKE SELECT (paystack_secret_key) ON public.schools FROM PUBLIC, anon, authenticated;
COMMIT;
