-- Rollback for 20261117003200_sherivs_m7_academic_core.sql (ADR-118).
-- Refuses when attendance corrections are stored: they are audit evidence and must be exported
-- (and the founder must approve their removal) before this rollback runs.
-- Removing the restrictive grades policies widens teacher reads back to the pre-M7 state.
DO $guard$
BEGIN
  IF to_regclass('public.m7_attendance_corrections') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.m7_attendance_corrections) THEN
    RAISE EXCEPTION 'M7 rollback refused: attendance corrections exist; export them first'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS m7_lesson_plan_guard ON public.lesson_plans;
DROP FUNCTION IF EXISTS public.m7_lesson_plan_guard();

DROP FUNCTION IF EXISTS public.m7_correct_attendance(uuid, text, text, text);
DROP TABLE IF EXISTS public.m7_attendance_corrections;

DROP POLICY IF EXISTS m7_component_scores_teacher_own_classes ON public.m06_result_component_scores;
DROP POLICY IF EXISTS m7_grades_teacher_own_classes ON public.grades;

DROP FUNCTION IF EXISTS public.m7_class_gradebook(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.m7_class_roster(uuid);
DROP FUNCTION IF EXISTS public.m7_my_periods(text);
DROP FUNCTION IF EXISTS public.m7_my_classes();
DROP FUNCTION IF EXISTS public.m7_can_read_class(uuid, uuid, text);
