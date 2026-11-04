-- M06 V1 continuous-assessment weights, terminal scores, and governed results.
-- Authored only; never applied to a live database by this migration.
-- Rollback: database/supabase/rollbacks/20261104010000_sherivs_m06_ca_terminal_results.sql
DO $guard$
DECLARE missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.grades') IS NULL OR to_regclass('public.students') IS NULL
     OR to_regclass('public.schools') IS NULL THEN
    missing := array_append(missing, 'Scholar grades, students, and schools');
  END IF;
  IF to_regclass('public.user_role_assignments') IS NULL
     OR to_regprocedure('public.scholar_can(uuid,text)') IS NULL
     OR to_regprocedure('public.workspace_role_sod_assert(uuid,uuid)') IS NULL THEN
    missing := array_append(missing, 'M009 role engine and Scholar authorization');
  END IF;
  IF to_regprocedure('public.scholar_audit()') IS NULL
     OR to_regprocedure('public.m05_teacher_assigned_to_class(uuid,uuid)') IS NULL THEN
    missing := array_append(missing, 'M05 class assignment and Scholar audit helpers');
  END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M06 requires dependencies 01, 02, 04, 05 and M009; missing: %',
      array_to_string(missing, ', ')
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.m06_ca_components_valid(p_components jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_component jsonb;
  v_code text;
  v_codes text[] := ARRAY[]::text[];
  v_weight numeric;
  v_max_score numeric;
  v_total_weight numeric := 0;
BEGIN
  IF jsonb_typeof(p_components) IS DISTINCT FROM 'array'
  THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_components) < 1 THEN RETURN false; END IF;
  FOR v_component IN SELECT value FROM jsonb_array_elements(p_components) AS item(value)
  LOOP
    IF jsonb_typeof(v_component) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_component->'code') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_component->'weight') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_component->'max_score') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    v_code := btrim(v_component->>'code');
    v_weight := (v_component->>'weight')::numeric;
    v_max_score := (v_component->>'max_score')::numeric;
    IF v_code <> v_component->>'code'
       OR v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
       OR v_code = ANY(v_codes)
       OR v_weight <= 0 OR v_weight > 100 OR round(v_weight, 2) <> v_weight
       OR v_max_score <= 0 THEN
      RETURN false;
    END IF;
    v_codes := array_append(v_codes, v_code);
    v_total_weight := v_total_weight + v_weight;
  END LOOP;
  RETURN round(v_total_weight, 2) = 100;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN false;
END
$$;
REVOKE ALL ON FUNCTION public.m06_ca_components_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.m06_result_weight_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 120),
  term text NOT NULL CHECK (length(btrim(term)) BETWEEN 1 AND 48),
  academic_year text NOT NULL CHECK (length(btrim(academic_year)) BETWEEN 4 AND 32),
  ca_weight numeric(5,2) NOT NULL CHECK (ca_weight BETWEEN 0 AND 100),
  terminal_weight numeric(5,2) NOT NULL CHECK (terminal_weight BETWEEN 0 AND 100),
  terminal_max_score numeric NOT NULL CHECK (terminal_max_score > 0),
  ca_components jsonb NOT NULL CHECK (public.m06_ca_components_valid(ca_components)),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, subject, term, academic_year),
  CHECK (ca_weight > 0 AND terminal_weight > 0),
  CHECK (round(ca_weight + terminal_weight, 2) = 100)
);
CREATE INDEX m06_result_weight_profiles_school_term
  ON public.m06_result_weight_profiles (school_id, academic_year, term, subject);

ALTER TABLE public.grades
  ADD COLUMN result_approved_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN result_approved_at timestamptz,
  ADD COLUMN result_published_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN result_published_at timestamptz,
  ADD COLUMN terminal_score_raw numeric,
  ADD COLUMN terminal_max_score numeric,
  ADD CONSTRAINT grades_m06_approval_pair
    CHECK ((result_approved_by IS NULL) = (result_approved_at IS NULL)),
  ADD CONSTRAINT grades_m06_approval_sod
    CHECK (result_approved_by IS NULL OR result_approved_by <> result_entered_by),
  ADD CONSTRAINT grades_m06_terminal_range
    CHECK (
      (terminal_score_raw IS NULL AND terminal_max_score IS NULL)
      OR (
        terminal_score_raw IS NOT NULL AND terminal_max_score IS NOT NULL
        AND terminal_score_raw >= 0 AND terminal_max_score > 0
        AND terminal_score_raw <= terminal_max_score
      )
    );

ALTER TABLE public.grades ALTER COLUMN ca_score DROP DEFAULT;
ALTER TABLE public.grades ALTER COLUMN exam_score DROP DEFAULT;
ALTER TABLE public.grades ALTER COLUMN total_score DROP EXPRESSION;
CREATE UNIQUE INDEX grades_id_school_m06_uq ON public.grades (id, school_id);

CREATE TABLE public.m06_result_component_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  grade_id uuid NOT NULL,
  component_code text NOT NULL CHECK (component_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  score numeric,
  max_score numeric NOT NULL CHECK (max_score > 0),
  weight numeric(5,2) NOT NULL CHECK (weight BETWEEN 0 AND 100),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grade_id, component_code),
  FOREIGN KEY (grade_id, school_id)
    REFERENCES public.grades (id, school_id) ON DELETE RESTRICT,
  CHECK (score IS NULL OR (score >= 0 AND score <= max_score))
);
CREATE INDEX m06_result_component_scores_school_grade
  ON public.m06_result_component_scores (school_id, grade_id);

CREATE TABLE public.m06_result_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  grade_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  before_state jsonb NOT NULL,
  requested_state jsonb NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX m06_result_amendments_grade_recent
  ON public.m06_result_amendments (school_id, grade_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.m06_result_scores_match(
  p_grade_id uuid,
  p_school_id uuid,
  p_ca_score numeric,
  p_terminal_score numeric,
  p_raw_terminal_score numeric,
  p_terminal_max_score numeric,
  p_actor uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.m06_result_weight_profiles%ROWTYPE;
  v_count integer;
  v_scored integer;
  v_expected_ca numeric;
  v_expected_terminal numeric;
BEGIN
  SELECT p.* INTO v_profile
    FROM public.m06_result_weight_profiles p
    JOIN public.grades g ON g.school_id = p.school_id
      AND g.subject = p.subject AND g.term = p.term AND g.academic_year = p.academic_year
   WHERE g.id = p_grade_id AND g.school_id = p_school_id;
  IF v_profile.id IS NULL THEN RETURN false; END IF;

  SELECT count(s.id)::integer,
         count(*) FILTER (WHERE s.score IS NOT NULL)::integer,
         sum((s.score / (c.value->>'max_score')::numeric) * (c.value->>'weight')::numeric)
    INTO v_count, v_scored, v_expected_ca
    FROM jsonb_array_elements(v_profile.ca_components) AS c(value)
    LEFT JOIN public.m06_result_component_scores s
      ON s.grade_id = p_grade_id AND s.school_id = p_school_id
     AND s.component_code = c.value->>'code'
     AND s.max_score = (c.value->>'max_score')::numeric
     AND s.weight = (c.value->>'weight')::numeric
     AND s.recorded_by = p_actor;
  IF v_count <> jsonb_array_length(v_profile.ca_components) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.m06_result_component_scores s
     WHERE s.grade_id = p_grade_id AND s.school_id = p_school_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_profile.ca_components) AS c(value)
          WHERE c.value->>'code' = s.component_code
            AND s.max_score = (c.value->>'max_score')::numeric
            AND s.weight = (c.value->>'weight')::numeric
            AND s.recorded_by = p_actor
       )
  ) THEN RETURN false; END IF;
  IF v_scored <> v_count THEN
    v_expected_ca := NULL;
  ELSE
    v_expected_ca := round(v_expected_ca * v_profile.ca_weight / 100, 2);
  END IF;
  v_expected_terminal := CASE WHEN p_raw_terminal_score IS NULL THEN NULL
    ELSE round(p_raw_terminal_score / v_profile.terminal_max_score * v_profile.terminal_weight, 2) END;
  RETURN p_ca_score IS NOT DISTINCT FROM v_expected_ca
    AND p_terminal_score IS NOT DISTINCT FROM v_expected_terminal
    AND p_terminal_max_score IS NOT DISTINCT FROM v_profile.terminal_max_score;
END
$$;
REVOKE ALL ON FUNCTION public.m06_result_scores_match(uuid,uuid,numeric,numeric,numeric,numeric,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.m06_result_amendments_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'M06 result amendment audit is append-only'
    USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER trg_m06_result_amendments_immutable
  BEFORE UPDATE OR DELETE ON public.m06_result_amendments
  FOR EACH ROW EXECUTE FUNCTION public.m06_result_amendments_immutable();
CREATE TRIGGER trg_m06_result_amendments_no_truncate
  BEFORE TRUNCATE ON public.m06_result_amendments
  FOR EACH STATEMENT EXECUTE FUNCTION public.m06_result_amendments_immutable();

CREATE OR REPLACE FUNCTION public.grades_points_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scale uuid;
  v_kind text;
  v_letter text;
  v_point numeric;
  v_fallback_letter text;
  v_fallback_remark text;
  v_tot numeric;
  v_m06_managed boolean;
  v_course public.courses%ROWTYPE;
BEGIN
  IF NEW.course_id IS NOT NULL THEN
    SELECT * INTO v_course
      FROM public.courses
     WHERE id = NEW.course_id AND school_id = NEW.school_id;
  ELSE
    SELECT * INTO v_course
      FROM public.courses
     WHERE school_id = NEW.school_id AND code = NEW.subject;
    IF v_course.id IS NOT NULL THEN NEW.course_id := v_course.id; END IF;
  END IF;
  IF NEW.credit_units IS NULL AND v_course.id IS NOT NULL THEN
    NEW.credit_units := v_course.credit_units;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.m06_result_component_scores s WHERE s.grade_id = NEW.id
  ) OR EXISTS (
    SELECT 1 FROM public.m06_result_weight_profiles p
     WHERE p.school_id = NEW.school_id AND p.subject = NEW.subject
       AND p.term = NEW.term AND p.academic_year = NEW.academic_year
  ) INTO v_m06_managed;
  IF NOT v_m06_managed THEN
    v_tot := coalesce(
      NEW.total_score,
      LEAST(100, coalesce(NEW.ca_score, 0) + coalesce(NEW.exam_score, 0))
    );
    SELECT s.grading_scale_id, g.scale_kind INTO v_scale, v_kind
      FROM public.schools s
      LEFT JOIN public.grading_scales g ON g.id = s.grading_scale_id
     WHERE s.id = NEW.school_id;
    IF v_scale IS NOT NULL
       AND (NEW.ca_score IS NOT NULL OR NEW.exam_score IS NOT NULL OR NEW.total_score IS NOT NULL) THEN
      SELECT b.letter, b.point INTO v_letter, v_point
        FROM public.grading_scale_bands b
       WHERE b.scale_id = v_scale AND b.min_score <= v_tot
       ORDER BY b.min_score DESC
       LIMIT 1;
      NEW.grade_point := v_point;
      IF v_kind = 'points' THEN NEW.grade := v_letter; END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.ca_score IS NULL OR NEW.exam_score IS NULL THEN
    NEW.total_score := NULL;
    NEW.grade_point := NULL;
    NEW.grade := NULL;
    NEW.grade_remark := NULL;
    RETURN NEW;
  END IF;
  NEW.total_score := round(NEW.ca_score + NEW.exam_score, 2);
  v_fallback_letter := CASE
    WHEN LEAST(100, NEW.total_score) >= 70 THEN 'A'
    WHEN LEAST(100, NEW.total_score) >= 60 THEN 'B'
    WHEN LEAST(100, NEW.total_score) >= 50 THEN 'C'
    WHEN LEAST(100, NEW.total_score) >= 45 THEN 'D'
    WHEN LEAST(100, NEW.total_score) >= 40 THEN 'E'
    ELSE 'F'
  END;
  v_fallback_remark := CASE v_fallback_letter
    WHEN 'A' THEN 'Excellent'
    WHEN 'B' THEN 'Very Good'
    WHEN 'C' THEN 'Good'
    WHEN 'D' THEN 'Pass'
    WHEN 'E' THEN 'Weak Pass'
    ELSE 'Fail'
  END;
  NEW.grade := v_fallback_letter;
  NEW.grade_point := NULL;
  NEW.grade_remark := v_fallback_remark;

  SELECT s.grading_scale_id, g.scale_kind INTO v_scale, v_kind
    FROM public.schools s
    LEFT JOIN public.grading_scales g ON g.id = s.grading_scale_id
   WHERE s.id = NEW.school_id;
  IF v_scale IS NOT NULL THEN
    SELECT b.letter, b.point INTO v_letter, v_point
      FROM public.grading_scale_bands b
     WHERE b.scale_id = v_scale AND b.min_score <= NEW.total_score
     ORDER BY b.min_score DESC
     LIMIT 1;
    NEW.grade_point := v_point;
    IF v_kind = 'points' THEN NEW.grade := v_letter; END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.m06_result_author_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_score_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_score_changed := NEW.ca_score IS DISTINCT FROM OLD.ca_score
      OR NEW.exam_score IS DISTINCT FROM OLD.exam_score
      OR NEW.terminal_score_raw IS DISTINCT FROM OLD.terminal_score_raw
      OR NEW.terminal_max_score IS DISTINCT FROM OLD.terminal_max_score;
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.result_entered_by IS NULL THEN
    IF TG_OP = 'INSERT' OR v_score_changed THEN
      NEW.result_entered_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_grades_m06_author
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.m06_result_author_guard();

CREATE OR REPLACE FUNCTION public.m06_result_workflow_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_score_changed boolean;
  v_locked_changed boolean;
  v_m06_managed boolean := false;
  v_actor uuid := auth.uid();
BEGIN
  v_score_changed := false;
  v_locked_changed := false;
  IF TG_OP = 'UPDATE' THEN
    v_score_changed := NEW.ca_score IS DISTINCT FROM OLD.ca_score
      OR NEW.exam_score IS DISTINCT FROM OLD.exam_score
      OR NEW.terminal_score_raw IS DISTINCT FROM OLD.terminal_score_raw
      OR NEW.terminal_max_score IS DISTINCT FROM OLD.terminal_max_score;
    v_locked_changed := v_score_changed
      OR NEW.total_score IS DISTINCT FROM OLD.total_score
      OR NEW.grade IS DISTINCT FROM OLD.grade
      OR NEW.grade_point IS DISTINCT FROM OLD.grade_point
      OR NEW.grade_remark IS DISTINCT FROM OLD.grade_remark
      OR NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.term IS DISTINCT FROM OLD.term
      OR NEW.academic_year IS DISTINCT FROM OLD.academic_year
      OR NEW.student_id IS DISTINCT FROM OLD.student_id
      OR NEW.school_id IS DISTINCT FROM OLD.school_id;
    SELECT EXISTS (
      SELECT 1 FROM public.m06_result_component_scores s WHERE s.grade_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM public.m06_result_weight_profiles p
       WHERE p.school_id = OLD.school_id AND p.subject = OLD.subject
         AND p.term = OLD.term AND p.academic_year = OLD.academic_year
    ) OR EXISTS (
      SELECT 1 FROM public.m06_result_weight_profiles p
       WHERE p.school_id = NEW.school_id AND p.subject = NEW.subject
         AND p.term = NEW.term AND p.academic_year = NEW.academic_year
    ) INTO v_m06_managed;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (NEW.result_approved_by IS NOT NULL OR NEW.is_published IS TRUE)
       AND EXISTS (
         SELECT 1 FROM public.m06_result_weight_profiles p
          WHERE p.school_id = NEW.school_id AND p.subject = NEW.subject
            AND p.term = NEW.term AND p.academic_year = NEW.academic_year
       ) THEN
      RAISE EXCEPTION 'M06 results must be entered before approval and publication'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_score_changed AND v_m06_managed AND v_actor IS NOT NULL
     AND NOT public.m06_result_scores_match(
       NEW.id, NEW.school_id, NEW.ca_score, NEW.exam_score,
       NEW.terminal_score_raw, NEW.terminal_max_score, v_actor
     ) THEN
    RAISE EXCEPTION 'scores must match configured CA and terminal weights'
      USING ERRCODE = '42501';
  END IF;

  IF v_locked_changed AND v_m06_managed
     AND (OLD.result_approved_by IS NOT NULL OR OLD.is_published IS TRUE) THEN
    IF v_actor IS NULL OR v_actor = OLD.result_approved_by
       OR NEW.result_approved_by IS NOT NULL OR NEW.is_published IS TRUE
       OR NOT public.scholar_can(NEW.school_id, 'results.unpublish')
       OR NOT EXISTS (
         SELECT 1 FROM public.m06_result_amendments a
          WHERE a.grade_id = OLD.id
            AND a.school_id = OLD.school_id
            AND a.actor_id = v_actor
            AND a.transaction_id = txid_current()
       ) THEN
      RAISE EXCEPTION 'approved results require a distinct, audited amendment'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_score_changed AND OLD.result_approved_by IS NULL AND OLD.is_published IS NOT TRUE THEN
    IF v_m06_managed AND v_actor IS NOT NULL AND (
      NOT public.scholar_can(NEW.school_id, 'grades.enter')
      OR NEW.result_entered_by IS DISTINCT FROM v_actor
    ) THEN
      RAISE EXCEPTION 'only the result author may edit unapproved scores'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.result_approved_by IS DISTINCT FROM OLD.result_approved_by
     AND NEW.result_approved_by IS NOT NULL THEN
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.result_approved_by
       OR v_score_changed
       OR NEW.total_score IS NULL
       OR NEW.result_entered_by IS NULL
       OR NEW.result_entered_by = v_actor
       OR EXISTS (
         SELECT 1 FROM public.m06_result_component_scores s
          WHERE s.grade_id = NEW.id AND s.recorded_by = v_actor
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.m06_result_component_scores s WHERE s.grade_id = NEW.id
       )
       OR NOT public.scholar_can(NEW.school_id, 'grades.approve') THEN
      RAISE EXCEPTION 'result approval requires complete scores and a distinct authorized approver'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.workspace_role_sod_assert(NEW.school_id, v_actor);
  END IF;
  IF OLD.result_approved_by IS NOT NULL AND NEW.result_approved_by IS NULL
     AND NOT v_score_changed
     AND NOT EXISTS (
       SELECT 1 FROM public.m06_result_amendments a
        WHERE a.grade_id = OLD.id
          AND a.school_id = OLD.school_id
          AND a.actor_id = v_actor
          AND a.transaction_id = txid_current()
     ) THEN
    RAISE EXCEPTION 'result approval cannot be withdrawn without an audited amendment'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_published IS TRUE AND OLD.is_published IS NOT TRUE AND v_m06_managed THEN
    IF v_actor IS NULL
       OR NEW.result_published_by IS DISTINCT FROM v_actor
       OR NEW.result_published_at IS NULL
       OR NEW.result_approved_by IS NULL
       OR NEW.result_entered_by = v_actor
       OR EXISTS (
         SELECT 1 FROM public.m06_result_component_scores s
          WHERE s.grade_id = NEW.id AND s.recorded_by = v_actor
       )
       OR NOT public.scholar_can(NEW.school_id, 'results.publish') THEN
      RAISE EXCEPTION 'result publication requires approval and a distinct authorized publisher'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.workspace_role_sod_assert(NEW.school_id, v_actor);
  ELSIF OLD.is_published IS TRUE AND NEW.is_published IS NOT TRUE AND NOT v_score_changed
     AND (v_m06_managed OR OLD.result_approved_by IS NOT NULL) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.m06_result_amendments a
       WHERE a.grade_id = OLD.id
         AND a.school_id = OLD.school_id
         AND a.actor_id = v_actor
         AND a.transaction_id = txid_current()
    ) THEN
      RAISE EXCEPTION 'published results can only be withdrawn through an audited amendment'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.result_approved_by IS NOT NULL AND NEW.result_entered_by = NEW.result_approved_by THEN
    RAISE EXCEPTION 'the entering teacher cannot approve the result'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_grades_m06_workflow
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.m06_result_workflow_guard();

CREATE OR REPLACE FUNCTION public.m06_result_component_score_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grade_id uuid := coalesce(NEW.grade_id, OLD.grade_id);
  v_school_id uuid := coalesce(NEW.school_id, OLD.school_id);
  v_grade public.grades%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO v_grade
    FROM public.grades
   WHERE id = v_grade_id AND school_id = v_school_id;
  IF (v_grade.result_approved_by IS NOT NULL OR v_grade.is_published IS TRUE) AND (
    v_actor IS NULL OR v_actor = v_grade.result_approved_by
    OR NOT public.scholar_can(v_grade.school_id, 'results.unpublish')
    OR NOT EXISTS (
      SELECT 1 FROM public.m06_result_amendments a
       WHERE a.grade_id = v_grade.id
         AND a.school_id = v_grade.school_id
         AND a.actor_id = v_actor
         AND a.transaction_id = txid_current()
    )
  ) THEN
    RAISE EXCEPTION 'approved CA marks require a distinct, audited amendment'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_m06_result_component_score_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.m06_result_component_scores
  FOR EACH ROW EXECUTE FUNCTION public.m06_result_component_score_guard();

CREATE OR REPLACE FUNCTION public.m06_set_result_weights(
  p_subject text,
  p_term text,
  p_academic_year text,
  p_ca_weight numeric,
  p_terminal_weight numeric,
  p_terminal_max_score numeric,
  p_ca_components jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_school uuid := public.get_my_school_id();
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR v_school IS NULL
     OR NOT public.scholar_can(v_school, 'settings.manage') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 120
     OR p_term IS NULL OR length(btrim(p_term)) NOT BETWEEN 1 AND 48
     OR p_academic_year IS NULL OR length(btrim(p_academic_year)) NOT BETWEEN 4 AND 32
     OR p_ca_weight IS NULL OR p_terminal_weight IS NULL
     OR p_ca_weight <= 0 OR p_terminal_weight <= 0
     OR round(p_ca_weight, 2) <> p_ca_weight
     OR round(p_terminal_weight, 2) <> p_terminal_weight
     OR round(p_ca_weight + p_terminal_weight, 2) <> 100
     OR p_terminal_max_score IS NULL OR p_terminal_max_score <= 0
     OR NOT public.m06_ca_components_valid(p_ca_components) THEN
    RAISE EXCEPTION 'invalid result weight configuration' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_school::text || ':m06:' || p_subject || ':' || p_term || ':' || p_academic_year, 0
  ));
  IF EXISTS (
    SELECT 1 FROM public.m06_result_component_scores s
      JOIN public.grades g ON g.id = s.grade_id AND g.school_id = s.school_id
     WHERE g.school_id = v_school AND g.subject = btrim(p_subject)
       AND g.term = btrim(p_term) AND g.academic_year = btrim(p_academic_year)
  ) THEN
    RAISE EXCEPTION 'result weights are locked once score entry begins'
      USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.m06_result_weight_profiles (
    school_id, subject, term, academic_year, ca_weight, terminal_weight,
    terminal_max_score, ca_components, created_by, updated_by
  ) VALUES (
    v_school, btrim(p_subject), btrim(p_term), btrim(p_academic_year), p_ca_weight,
    p_terminal_weight, p_terminal_max_score, p_ca_components, v_actor, v_actor
  )
  ON CONFLICT (school_id, subject, term, academic_year)
  DO UPDATE SET
    ca_weight = EXCLUDED.ca_weight,
    terminal_weight = EXCLUDED.terminal_weight,
    terminal_max_score = EXCLUDED.terminal_max_score,
    ca_components = EXCLUDED.ca_components,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.m06_apply_result_scores(
  p_grade_id uuid,
  p_ca_scores jsonb,
  p_terminal_score numeric,
  p_amendment boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grade public.grades%ROWTYPE;
  v_profile public.m06_result_weight_profiles%ROWTYPE;
  v_component jsonb;
  v_code text;
  v_score_json jsonb;
  v_score numeric;
  v_max_score numeric;
  v_weight numeric;
  v_weighted_ca numeric := 0;
  v_missing_ca boolean := false;
  v_ca_score numeric;
  v_terminal_score numeric;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO v_grade FROM public.grades WHERE id = p_grade_id FOR UPDATE;
  IF v_grade.id IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'result unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_profile
    FROM public.m06_result_weight_profiles
   WHERE school_id = v_grade.school_id
     AND subject = v_grade.subject
     AND term = v_grade.term
     AND academic_year = v_grade.academic_year;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'result weights are not configured' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_ca_scores) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CA scores must include each configured component exactly once'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_ca_scores))
     <> jsonb_array_length(v_profile.ca_components) THEN
    RAISE EXCEPTION 'CA scores must include each configured component exactly once'
      USING ERRCODE = '22023';
  END IF;
  IF p_terminal_score IS NOT NULL
     AND (p_terminal_score < 0 OR p_terminal_score > v_profile.terminal_max_score) THEN
    RAISE EXCEPTION 'terminal score is outside its possible range' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.m06_result_component_scores WHERE grade_id = v_grade.id;
  FOR v_component IN SELECT value FROM jsonb_array_elements(v_profile.ca_components) AS item(value)
  LOOP
    v_code := v_component->>'code';
    IF NOT (p_ca_scores ? v_code) THEN
      RAISE EXCEPTION 'CA scores must include each configured component exactly once'
        USING ERRCODE = '22023';
    END IF;
    v_score_json := p_ca_scores->v_code;
    IF v_score_json IS NOT NULL AND jsonb_typeof(v_score_json) IS DISTINCT FROM 'null'
       AND jsonb_typeof(v_score_json) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'CA scores must be numbers or blank' USING ERRCODE = '22023';
    END IF;
    v_score := CASE WHEN jsonb_typeof(v_score_json) = 'number'
      THEN (v_score_json #>> '{}')::numeric END;
    v_max_score := (v_component->>'max_score')::numeric;
    v_weight := (v_component->>'weight')::numeric;
    IF v_score IS NOT NULL AND (v_score < 0 OR v_score > v_max_score) THEN
      RAISE EXCEPTION 'CA score is outside its possible range' USING ERRCODE = '22023';
    END IF;
    IF v_score IS NULL THEN
      v_missing_ca := true;
    ELSE
      v_weighted_ca := v_weighted_ca + (v_score / v_max_score) * v_weight;
    END IF;
    INSERT INTO public.m06_result_component_scores (
      school_id, grade_id, component_code, score, max_score, weight, recorded_by
    ) VALUES (
      v_grade.school_id, v_grade.id, v_code, v_score, v_max_score, v_weight, v_actor
    );
  END LOOP;
  v_ca_score := CASE WHEN v_missing_ca THEN NULL
    ELSE round(v_weighted_ca * v_profile.ca_weight / 100, 2) END;
  v_terminal_score := CASE WHEN p_terminal_score IS NULL THEN NULL
    ELSE round(p_terminal_score / v_profile.terminal_max_score * v_profile.terminal_weight, 2) END;

  UPDATE public.grades
     SET ca_score = v_ca_score,
         exam_score = v_terminal_score,
         terminal_score_raw = p_terminal_score,
         terminal_max_score = v_profile.terminal_max_score,
         result_approved_by = CASE WHEN p_amendment THEN NULL ELSE result_approved_by END,
         result_approved_at = CASE WHEN p_amendment THEN NULL ELSE result_approved_at END,
         is_published = CASE WHEN p_amendment THEN false ELSE is_published END,
         result_published_by = CASE WHEN p_amendment THEN NULL ELSE result_published_by END,
         result_published_at = CASE WHEN p_amendment THEN NULL ELSE result_published_at END
   WHERE id = v_grade.id AND school_id = v_grade.school_id;

  SELECT * INTO v_grade FROM public.grades WHERE id = p_grade_id;
  RETURN jsonb_build_object(
    'ca_score', v_grade.ca_score,
    'terminal_score', v_grade.exam_score,
    'total_score', v_grade.total_score,
    'grade', v_grade.grade
  );
END
$$;
REVOKE ALL ON FUNCTION public.m06_apply_result_scores(uuid,jsonb,numeric,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.m06_enter_result_scores(
  p_student_id uuid,
  p_subject text,
  p_term text,
  p_academic_year text,
  p_ca_scores jsonb,
  p_terminal_score numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_school uuid := public.get_my_school_id();
  v_student public.students%ROWTYPE;
  v_grade public.grades%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_school IS NULL OR NOT public.scholar_can(v_school, 'grades.enter') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_student_id IS NULL OR p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 120
     OR p_term IS NULL OR length(btrim(p_term)) NOT BETWEEN 1 AND 48
     OR p_academic_year IS NULL OR length(btrim(p_academic_year)) NOT BETWEEN 4 AND 32 THEN
    RAISE EXCEPTION 'invalid result scope' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_school::text || ':m06:' || btrim(p_subject) || ':' || btrim(p_term) || ':' || btrim(p_academic_year), 0
  ));
  SELECT * INTO v_student
    FROM public.students
   WHERE id = p_student_id AND school_id = v_school
   FOR KEY SHARE;
  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'result unavailable' USING ERRCODE = '42501';
  END IF;
  IF public.get_my_role() = 'teacher'
     AND NOT public.m05_teacher_assigned_to_class(v_school, v_student.class_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.m06_result_weight_profiles
   WHERE school_id = v_school AND subject = btrim(p_subject)
     AND term = btrim(p_term) AND academic_year = btrim(p_academic_year);
  IF NOT FOUND THEN RAISE EXCEPTION 'result weights are not configured' USING ERRCODE = '55000'; END IF;

  SELECT * INTO v_grade
    FROM public.grades
   WHERE student_id = p_student_id AND subject = btrim(p_subject)
     AND term = btrim(p_term) AND academic_year = btrim(p_academic_year)
     AND school_id = v_school
   FOR UPDATE;
  IF v_grade.id IS NULL THEN
    INSERT INTO public.grades (
      school_id, student_id, class_id, subject, ca_score, exam_score, term,
      academic_year, teacher_id, is_published
    ) VALUES (
      v_school, p_student_id, v_student.class_id, btrim(p_subject), NULL, NULL,
      btrim(p_term), btrim(p_academic_year), v_actor, false
    )
    RETURNING * INTO v_grade;
  ELSIF v_grade.result_approved_by IS NOT NULL OR v_grade.is_published IS TRUE
     OR v_grade.result_entered_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'result is locked or belongs to another author; use audited amendment'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.m06_apply_result_scores(v_grade.id, p_ca_scores, p_terminal_score, false);
  RETURN v_grade.id;
END
$$;

CREATE OR REPLACE FUNCTION public.m06_approve_result(p_grade_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_grade public.grades%ROWTYPE;
BEGIN
  SELECT * INTO v_grade FROM public.grades WHERE id = p_grade_id FOR UPDATE;
  IF v_actor IS NULL OR v_grade.id IS NULL
     OR public.get_my_school_id() IS DISTINCT FROM v_grade.school_id
     OR NOT public.scholar_can(v_grade.school_id, 'grades.approve')
     OR v_grade.total_score IS NULL OR v_grade.result_entered_by IS NULL
     OR v_grade.result_entered_by = v_actor OR v_grade.result_approved_by IS NOT NULL
     OR v_grade.is_published IS TRUE
     OR NOT EXISTS (
       SELECT 1 FROM public.m06_result_component_scores s WHERE s.grade_id = v_grade.id
     )
     OR EXISTS (
       SELECT 1 FROM public.m06_result_component_scores s
        WHERE s.grade_id = v_grade.id AND s.recorded_by = v_actor
     ) THEN
    RAISE EXCEPTION 'result is not approvable by this user' USING ERRCODE = '42501';
  END IF;
  PERFORM public.workspace_role_sod_assert(v_grade.school_id, v_actor);
  UPDATE public.grades
     SET result_approved_by = v_actor, result_approved_at = now()
   WHERE id = v_grade.id AND school_id = v_grade.school_id;
END
$$;

CREATE OR REPLACE FUNCTION public.m06_publish_result(p_grade_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_grade public.grades%ROWTYPE;
BEGIN
  SELECT * INTO v_grade FROM public.grades WHERE id = p_grade_id FOR UPDATE;
  IF v_actor IS NULL OR v_grade.id IS NULL
     OR public.get_my_school_id() IS DISTINCT FROM v_grade.school_id
     OR NOT public.scholar_can(v_grade.school_id, 'results.publish')
     OR v_grade.result_approved_by IS NULL OR v_grade.total_score IS NULL
     OR v_grade.result_entered_by IS NULL OR v_grade.result_entered_by = v_actor
     OR EXISTS (
       SELECT 1 FROM public.m06_result_component_scores s
        WHERE s.grade_id = v_grade.id AND s.recorded_by = v_actor
     )
     OR v_grade.is_published IS TRUE THEN
    RAISE EXCEPTION 'result is not publishable by this user' USING ERRCODE = '42501';
  END IF;
  PERFORM public.workspace_role_sod_assert(v_grade.school_id, v_actor);
  UPDATE public.grades
     SET is_published = true, result_published_by = v_actor, result_published_at = now()
   WHERE id = v_grade.id AND school_id = v_grade.school_id;
END
$$;

CREATE OR REPLACE FUNCTION public.m06_amend_result(
  p_grade_id uuid,
  p_ca_scores jsonb,
  p_terminal_score numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_grade public.grades%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_grade FROM public.grades WHERE id = p_grade_id FOR UPDATE;
  IF v_actor IS NULL OR v_grade.id IS NULL
     OR public.get_my_school_id() IS DISTINCT FROM v_grade.school_id
     OR NOT public.scholar_can(v_grade.school_id, 'results.unpublish')
     OR v_grade.result_approved_by IS NULL AND v_grade.is_published IS NOT TRUE
     OR v_grade.result_approved_by = v_actor
     OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 8 AND 1000 THEN
    RAISE EXCEPTION 'result amendment is not authorized or its reason is invalid'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.workspace_role_sod_assert(v_grade.school_id, v_actor);

  INSERT INTO public.m06_result_amendments (
    school_id, grade_id, actor_id, reason, before_state, requested_state
  ) VALUES (
    v_grade.school_id,
    v_grade.id,
    v_actor,
    btrim(p_reason),
    jsonb_build_object(
      'ca_score', v_grade.ca_score,
      'terminal_score', v_grade.exam_score,
      'terminal_score_raw', v_grade.terminal_score_raw,
      'terminal_max_score', v_grade.terminal_max_score,
      'total_score', v_grade.total_score,
      'grade', v_grade.grade,
      'approved_by', v_grade.result_approved_by,
      'published', v_grade.is_published
    ),
    jsonb_build_object('ca_scores', p_ca_scores, 'terminal_score', p_terminal_score)
  );
  v_result := public.m06_apply_result_scores(v_grade.id, p_ca_scores, p_terminal_score, true);
  RETURN v_result;
END
$$;

DO $security$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'm06_result_weight_profiles',
    'm06_result_component_scores',
    'm06_result_amendments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()',
      v_table
    );
  END LOOP;
END
$security$;

CREATE POLICY m06_result_weight_profiles_read ON public.m06_result_weight_profiles
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      public.scholar_can(school_id, 'grades.view')
      OR public.scholar_can(school_id, 'settings.manage')
    )
  );
CREATE POLICY m06_result_component_scores_read ON public.m06_result_component_scores
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      public.scholar_can(school_id, 'grades.view')
      OR EXISTS (
        SELECT 1
          FROM public.grades g
          JOIN public.students s ON s.id = g.student_id AND s.school_id = g.school_id
         WHERE g.id = public.m06_result_component_scores.grade_id
           AND g.school_id = public.m06_result_component_scores.school_id
           AND g.is_published IS TRUE
           AND (
             s.user_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.parent_student_map p
                WHERE p.student_id = s.id AND p.parent_id = auth.uid()
             )
           )
      )
    )
  );
CREATE POLICY m06_result_amendments_read ON public.m06_result_amendments
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      public.scholar_can(school_id, 'grades.approve')
      OR public.scholar_can(school_id, 'results.publish')
      OR public.scholar_can(school_id, 'results.unpublish')
    )
  );

REVOKE ALL ON FUNCTION public.m06_result_author_guard(),
  public.m06_result_workflow_guard(),
  public.m06_result_component_score_guard(),
  public.m06_result_amendments_immutable(),
  public.m06_set_result_weights(text,text,text,numeric,numeric,numeric,jsonb),
  public.m06_enter_result_scores(uuid,text,text,text,jsonb,numeric),
  public.m06_approve_result(uuid),
  public.m06_publish_result(uuid),
  public.m06_amend_result(uuid,jsonb,numeric,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m06_set_result_weights(text,text,text,numeric,numeric,numeric,jsonb),
  public.m06_enter_result_scores(uuid,text,text,text,jsonb,numeric),
  public.m06_approve_result(uuid),
  public.m06_publish_result(uuid),
  public.m06_amend_result(uuid,jsonb,numeric,text)
  TO authenticated;
