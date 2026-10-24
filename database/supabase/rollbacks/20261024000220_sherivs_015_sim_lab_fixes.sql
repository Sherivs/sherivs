-- Rollback for 20261024000220_sherivs_015_sim_lab_fixes.sql.proposed (NOT APPLIED).
-- Restores policy behaviour by re-running the original policy definitions from
-- the migrations that created them; the indexes and the NOT VALID check are dropped here.
BEGIN;
ALTER TABLE public.grades DROP CONSTRAINT IF EXISTS grades_score_range;
DROP INDEX IF EXISTS public.idx_students_user_id, public.idx_students_parent_id,
  public.idx_grades_school_published, public.idx_grades_teacher;
-- Policies: the rewritten policies are logically equivalent except the
-- teacher update/delete lock on published rows. To undo that lock only:
DROP POLICY IF EXISTS grades_teacher_update ON public.grades;
CREATE POLICY grades_teacher_update ON public.grades FOR UPDATE TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()))
  WITH CHECK (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS grades_teacher_delete ON public.grades;
CREATE POLICY grades_teacher_delete ON public.grades FOR DELETE TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()));
COMMIT;
