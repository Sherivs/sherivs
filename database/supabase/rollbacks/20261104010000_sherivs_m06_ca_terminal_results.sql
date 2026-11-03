-- Data-preserving rollback for 20261104010000_sherivs_m06_ca_terminal_results.sql.
-- Refuses rollback after M06 weights, scores, approvals, or amendments are stored.
BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.m06_result_weight_profiles)
     OR EXISTS (SELECT 1 FROM public.m06_result_component_scores)
     OR EXISTS (SELECT 1 FROM public.m06_result_amendments)
     OR EXISTS (
       SELECT 1 FROM public.grades
        WHERE result_approved_by IS NOT NULL
           OR result_published_by IS NOT NULL
           OR terminal_score_raw IS NOT NULL
           OR terminal_max_score IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'M06 rollback refused while result configuration, scores, approvals, or audit evidence exist'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trg_grades_m06_workflow ON public.grades;
DROP TRIGGER IF EXISTS trg_grades_m06_author ON public.grades;
DROP TRIGGER IF EXISTS trg_m06_result_component_score_guard ON public.m06_result_component_scores;

CREATE OR REPLACE FUNCTION public.grades_points_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_scale uuid; v_kind text; v_letter text; v_point numeric; v_course public.courses%ROWTYPE; v_tot numeric;
BEGIN
  IF NEW.course_id IS NOT NULL THEN
    SELECT * INTO v_course FROM public.courses WHERE id = NEW.course_id AND school_id = NEW.school_id;
  ELSE
    SELECT * INTO v_course FROM public.courses WHERE school_id = NEW.school_id AND code = NEW.subject;
    IF v_course.id IS NOT NULL THEN NEW.course_id := v_course.id; END IF;
  END IF;
  IF NEW.credit_units IS NULL AND v_course.id IS NOT NULL THEN NEW.credit_units := v_course.credit_units; END IF;

  SELECT s.grading_scale_id, g.scale_kind INTO v_scale, v_kind
    FROM public.schools s LEFT JOIN public.grading_scales g ON g.id = s.grading_scale_id
   WHERE s.id = NEW.school_id;
  v_tot := coalesce(NEW.total_score, LEAST(100, coalesce(NEW.ca_score, 0) + coalesce(NEW.exam_score, 0)));
  IF v_scale IS NOT NULL AND (NEW.ca_score IS NOT NULL OR NEW.exam_score IS NOT NULL OR NEW.total_score IS NOT NULL) THEN
    SELECT b.letter, b.point INTO v_letter, v_point
      FROM public.grading_scale_bands b WHERE b.scale_id = v_scale AND b.min_score <= v_tot
     ORDER BY b.min_score DESC LIMIT 1;
    NEW.grade_point := v_point;
    IF v_kind = 'points' THEN NEW.grade := v_letter; END IF;
  END IF;
  RETURN NEW;
END
$$;

UPDATE public.grades
   SET total_score = coalesce(ca_score, 0) + coalesce(exam_score, 0);

ALTER TABLE public.grades
  DROP CONSTRAINT grades_m06_terminal_range,
  DROP CONSTRAINT grades_m06_approval_sod,
  DROP CONSTRAINT grades_m06_approval_pair,
  DROP COLUMN result_approved_by,
  DROP COLUMN result_approved_at,
  DROP COLUMN result_published_by,
  DROP COLUMN result_published_at,
  DROP COLUMN terminal_score_raw,
  DROP COLUMN terminal_max_score;
ALTER TABLE public.grades
  ALTER COLUMN ca_score SET DEFAULT 0,
  ALTER COLUMN exam_score SET DEFAULT 0;
DROP POLICY IF EXISTS m06_result_amendments_read ON public.m06_result_amendments;
DROP POLICY IF EXISTS m06_result_component_scores_read ON public.m06_result_component_scores;
DROP POLICY IF EXISTS m06_result_weight_profiles_read ON public.m06_result_weight_profiles;
DROP TABLE public.m06_result_amendments;
DROP TABLE public.m06_result_component_scores;
DROP TABLE public.m06_result_weight_profiles;
DROP INDEX IF EXISTS public.grades_id_school_m06_uq;

DROP FUNCTION public.m06_amend_result(uuid,jsonb,numeric,text);
DROP FUNCTION public.m06_publish_result(uuid);
DROP FUNCTION public.m06_approve_result(uuid);
DROP FUNCTION public.m06_enter_result_scores(uuid,text,text,text,jsonb,numeric);
DROP FUNCTION public.m06_apply_result_scores(uuid,jsonb,numeric,boolean);
DROP FUNCTION public.m06_result_component_score_guard();
DROP FUNCTION public.m06_result_workflow_guard();
DROP FUNCTION public.m06_result_author_guard();
DROP FUNCTION public.m06_result_amendments_immutable();
DROP FUNCTION public.m06_set_result_weights(text,text,text,numeric,numeric,numeric,jsonb);
DROP FUNCTION public.m06_ca_components_valid(jsonb);

COMMIT;
