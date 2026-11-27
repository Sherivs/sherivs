-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M7 academic core (ADR-149, mission E-017).
--
-- Screens for today's classes, attendance, the gradebook and lesson notes sit on existing tables
-- and functions (timetables/timetable_slots, M05 class_attendance_marks and its offline sync, the
-- M06 weighted-result functions from PR #313, SHERIVS-024 lesson_note_submit/lesson_note_review).
-- This file adds only what those lack:
--   1. own-class read functions the screens use (classes, today's periods, roster, gradebook);
--   2. a restrictive read policy so a teacher sees grades only for classes they teach;
--   3. an audited, reasoned, replay-safe correction of a past attendance mark;
--   4. a guard on lesson_plans so a lesson note reaches "approved" only through a review by
--      someone other than its author (the tenant-wide lesson_plans policy let any member set it).
-- Requires: M05 (20261103100000), SHERIVS-024 (20261024000310) and M06 (20261117002200).
-- Attendance events (WF-05, PR #451) come from its own trigger on class_attendance_marks; this
-- file emits no events itself.
DO $guard$
BEGIN
  IF to_regclass('public.class_attendance_marks') IS NULL
     OR to_regclass('public.lesson_note_reviews') IS NULL
     OR to_regclass('public.m06_result_component_scores') IS NULL
     OR to_regclass('public.timetable_slots') IS NULL
     OR to_regprocedure('public.m05_teacher_assigned_to_class(uuid,uuid)') IS NULL
     OR to_regprocedure('public.scholar_can(uuid,text)') IS NULL
     OR to_regprocedure('public.scholar_audit()') IS NULL
     OR to_regprocedure('public.append_only_guard()') IS NULL THEN
    RAISE EXCEPTION 'M7 requires M05 attendance, SHERIVS-024 lesson notes, M06 results and the Scholar helpers'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------------------------
-- 1. Who may read a class's learners and marks: a teacher only for a class they are assigned to
--    (form class, a timetabled period, or a class-scoped teacher role); other roles by permission.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m7_can_read_class(p_school uuid, p_class uuid, p_perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_school IS NOT NULL
     AND p_school = public.get_my_school_id()
     AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = p_class AND c.school_id = p_school)
     AND CASE
           WHEN public.get_my_role() = 'teacher'
             THEN public.m05_teacher_assigned_to_class(p_school, p_class)
           ELSE public.scholar_can(p_school, p_perm)
         END
$$;
REVOKE ALL ON FUNCTION public.m7_can_read_class(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m7_can_read_class(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.m7_my_classes()
RETURNS TABLE (class_id uuid, class_name text, grade_level text, is_form_class boolean, subjects text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id, c.name, c.grade_level, c.teacher_id IS NOT DISTINCT FROM auth.uid(),
         coalesce(
           (SELECT array_agg(DISTINCT ts.subject ORDER BY ts.subject)
              FROM public.timetables tt
              JOIN public.timetable_slots ts ON ts.timetable_id = tt.id AND ts.school_id = tt.school_id
             WHERE tt.school_id = c.school_id AND tt.class_id = c.id AND tt.is_active IS TRUE
               AND ts.is_break IS NOT TRUE
               AND (public.get_my_role() <> 'teacher' OR ts.teacher_id = auth.uid())),
           ARRAY[]::text[]
         )
    FROM public.classes c
   WHERE auth.uid() IS NOT NULL
     AND c.school_id = public.get_my_school_id()
     AND public.m7_can_read_class(c.school_id, c.id, 'attendance.view')
   ORDER BY c.name
$$;
REVOKE ALL ON FUNCTION public.m7_my_classes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m7_my_classes() TO authenticated;

-- The caller's own timetabled periods for one weekday (lowercase english day name, as stored).
CREATE OR REPLACE FUNCTION public.m7_my_periods(p_day text)
RETURNS TABLE (
  slot_id uuid, class_id uuid, class_name text, period_number integer,
  start_time time, end_time time, subject text, room text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_my_school_id() IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL
     OR lower(p_day) NOT IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday') THEN
    RAISE EXCEPTION 'day must be a weekday name' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT ts.id, c.id, c.name, ts.period_number, ts.start_time, ts.end_time, ts.subject, ts.room
    FROM public.timetable_slots ts
    JOIN public.timetables tt ON tt.id = ts.timetable_id AND tt.school_id = ts.school_id
    JOIN public.classes c ON c.id = tt.class_id AND c.school_id = tt.school_id
   WHERE ts.school_id = public.get_my_school_id()
     AND tt.is_active IS TRUE
     AND ts.teacher_id = auth.uid()
     AND ts.is_break IS NOT TRUE
     AND lower(ts.day_of_week) = lower(p_day)
   ORDER BY ts.start_time, ts.period_number;
END
$$;
REVOKE ALL ON FUNCTION public.m7_my_periods(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m7_my_periods(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.m7_class_roster(p_class uuid)
RETURNS TABLE (student_id uuid, display_name text, admission_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_school uuid := public.get_my_school_id();
BEGIN
  IF NOT public.m7_can_read_class(v_school, p_class, 'attendance.view') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, coalesce(u.full_name, s.admission_number, 'Unnamed learner'), s.admission_number
    FROM public.students s
    LEFT JOIN public.users u ON u.id = s.user_id
   WHERE s.school_id = v_school AND s.class_id = p_class AND s.is_active IS TRUE
   ORDER BY 2, s.id;
END
$$;
REVOKE ALL ON FUNCTION public.m7_class_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m7_class_roster(uuid) TO authenticated;

-- One row per active learner in the class with the current result state for the subject/term.
-- state: none | draft_mine | draft_other | approved | published.
CREATE OR REPLACE FUNCTION public.m7_class_gradebook(
  p_class uuid, p_subject text, p_term text, p_academic_year text
)
RETURNS TABLE (
  student_id uuid, display_name text, admission_number text, grade_id uuid,
  ca_scores jsonb, terminal_score_raw numeric, ca_score numeric, exam_score numeric,
  total_score numeric, grade text, state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_school uuid := public.get_my_school_id();
BEGIN
  IF NOT public.m7_can_read_class(v_school, p_class, 'grades.view') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 120
     OR p_term IS NULL OR length(btrim(p_term)) NOT BETWEEN 1 AND 48
     OR p_academic_year IS NULL OR length(btrim(p_academic_year)) NOT BETWEEN 4 AND 32 THEN
    RAISE EXCEPTION 'invalid result scope' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT s.id,
         coalesce(u.full_name, s.admission_number, 'Unnamed learner'),
         s.admission_number,
         g.id,
         coalesce(
           (SELECT jsonb_object_agg(cs.component_code, cs.score)
              FROM public.m06_result_component_scores cs
             WHERE cs.grade_id = g.id AND cs.school_id = v_school),
           '{}'::jsonb
         ),
         g.terminal_score_raw, g.ca_score, g.exam_score, g.total_score, g.grade,
         CASE
           WHEN g.id IS NULL THEN 'none'
           WHEN g.is_published IS TRUE THEN 'published'
           WHEN g.result_approved_by IS NOT NULL THEN 'approved'
           WHEN g.result_entered_by = auth.uid() THEN 'draft_mine'
           ELSE 'draft_other'
         END
    FROM public.students s
    LEFT JOIN public.users u ON u.id = s.user_id
    LEFT JOIN public.grades g
      ON g.student_id = s.id AND g.school_id = v_school
     AND g.subject = btrim(p_subject) AND g.term = btrim(p_term)
     AND g.academic_year = btrim(p_academic_year)
   WHERE s.school_id = v_school AND s.class_id = p_class AND s.is_active IS TRUE
   ORDER BY 2, s.id;
END
$$;
REVOKE ALL ON FUNCTION public.m7_class_gradebook(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m7_class_gradebook(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Teachers read grades (and their component scores) only for classes they teach or rows they
--    authored. RESTRICTIVE: it narrows the existing grades_teacher_read policy; it never widens
--    anything, and other roles are unaffected.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS m7_grades_teacher_own_classes ON public.grades;
CREATE POLICY m7_grades_teacher_own_classes ON public.grades
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.get_my_role() IS DISTINCT FROM 'teacher'
    OR teacher_id = auth.uid()
    OR public.m05_teacher_assigned_to_class(school_id, class_id)
  );

DROP POLICY IF EXISTS m7_component_scores_teacher_own_classes ON public.m06_result_component_scores;
CREATE POLICY m7_component_scores_teacher_own_classes ON public.m06_result_component_scores
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.get_my_role() IS DISTINCT FROM 'teacher'
    OR EXISTS (
      SELECT 1 FROM public.grades g
       WHERE g.id = public.m06_result_component_scores.grade_id
         AND g.school_id = public.m06_result_component_scores.school_id
         AND (g.teacher_id = auth.uid()
              OR public.m05_teacher_assigned_to_class(g.school_id, g.class_id))
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 3. Audited correction of a past attendance mark (append-only; one row per client key).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m7_attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  mark_id uuid NOT NULL REFERENCES public.class_attendance_marks(id) ON DELETE CASCADE,
  class_id uuid NOT NULL,
  student_id uuid NOT NULL,
  attendance_date date NOT NULL,
  old_status text NOT NULL CHECK (old_status IN ('present', 'absent', 'late', 'excused')),
  new_status text NOT NULL CHECK (new_status IN ('present', 'absent', 'late', 'excused')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  corrected_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_key text NOT NULL CHECK (length(btrim(client_key)) BETWEEN 8 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_status <> new_status),
  UNIQUE (corrected_by, client_key)
);
CREATE INDEX IF NOT EXISTS m7_attendance_corrections_mark_idx
  ON public.m7_attendance_corrections (school_id, mark_id, created_at DESC);

ALTER TABLE public.m7_attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m7_attendance_corrections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.m7_attendance_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.m7_attendance_corrections TO authenticated;
GRANT ALL ON TABLE public.m7_attendance_corrections TO service_role;
DROP POLICY IF EXISTS m7_attendance_corrections_read ON public.m7_attendance_corrections;
CREATE POLICY m7_attendance_corrections_read ON public.m7_attendance_corrections
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      corrected_by = auth.uid()
      OR public.scholar_can(school_id, 'attendance.edit_past')
      OR public.m7_can_read_class(school_id, class_id, 'attendance.view')
    )
  );
DROP TRIGGER IF EXISTS trg_m7_attendance_corrections_audit ON public.m7_attendance_corrections;
CREATE TRIGGER trg_m7_attendance_corrections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.m7_attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
DROP TRIGGER IF EXISTS trg_m7_attendance_corrections_append_only ON public.m7_attendance_corrections;
CREATE TRIGGER trg_m7_attendance_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.m7_attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

-- Rules: caller has attendance.take; a teacher only on a class they are assigned to; a reason of
-- 8+ characters; no future dates; older than 7 days needs attendance.edit_past (same window as
-- the M05 sync). A repeated client key returns the first outcome and changes nothing.
CREATE OR REPLACE FUNCTION public.m7_correct_attendance(
  p_mark uuid, p_status text, p_reason text, p_client_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_school uuid := public.get_my_school_id();
  v_mark public.class_attendance_marks%ROWTYPE;
  v_prior public.m7_attendance_corrections%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR v_school IS NULL OR NOT public.scholar_can(v_school, 'attendance.take') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_client_key IS NULL OR length(btrim(p_client_key)) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'a correction key of 8 to 160 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_prior FROM public.m7_attendance_corrections
   WHERE corrected_by = v_actor AND client_key = btrim(p_client_key);
  IF v_prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'correction_id', v_prior.id,
                              'status', v_prior.new_status);
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('present', 'absent', 'late', 'excused') THEN
    RAISE EXCEPTION 'unknown attendance status' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 1000 THEN
    RAISE EXCEPTION 'say why the mark is changing (8 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_mark FROM public.class_attendance_marks
   WHERE id = p_mark AND school_id = v_school
   FOR UPDATE;
  IF v_mark.id IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.get_my_role() = 'teacher'
     AND NOT public.m05_teacher_assigned_to_class(v_school, v_mark.class_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_mark.attendance_date > current_date
     OR (v_mark.attendance_date < current_date - 7
         AND NOT public.scholar_can(v_school, 'attendance.edit_past')) THEN
    RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = '42501';
  END IF;
  IF v_mark.status = p_status THEN
    RAISE EXCEPTION 'the mark already has that status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.class_attendance_marks SET status = p_status WHERE id = v_mark.id;
  INSERT INTO public.m7_attendance_corrections (
    school_id, mark_id, class_id, student_id, attendance_date, old_status, new_status,
    reason, corrected_by, client_key
  ) VALUES (
    v_school, v_mark.id, v_mark.class_id, v_mark.student_id, v_mark.attendance_date,
    v_mark.status, p_status, btrim(p_reason), v_actor, btrim(p_client_key)
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('replay', false, 'correction_id', v_id, 'status', p_status);
END
$$;
REVOKE ALL ON FUNCTION public.m7_correct_attendance(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m7_correct_attendance(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Lesson-note separation of duties on lesson_plans itself. lesson_note_submit and
--    lesson_note_review already enforce the rule; this guard stops a member from writing
--    status = 'approved' (or editing a submitted/approved note) directly through the tenant-wide
--    table policy. Calls without an end-user identity (service role, maintenance) are not checked.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m7_lesson_plan_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_latest public.lesson_note_reviews%ROWTYPE;
  v_fixed text[] := ARRAY['status', 'review_notes', 'admin_viewed', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'draft') <> 'draft' THEN
      RAISE EXCEPTION 'a new lesson note starts as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('submitted', 'approved')
     AND (to_jsonb(NEW) - v_fixed) IS DISTINCT FROM (to_jsonb(OLD) - v_fixed) THEN
    RAISE EXCEPTION 'a submitted or approved lesson note cannot be edited' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_latest FROM public.lesson_note_reviews r
   WHERE r.lesson_plan_id = NEW.id AND r.school_id = NEW.school_id
   ORDER BY r.submitted_at DESC, r.id DESC
   LIMIT 1;

  IF NEW.status = 'submitted' THEN
    IF v_latest.id IS NULL OR v_latest.status <> 'submitted' THEN
      RAISE EXCEPTION 'submit a lesson note through lesson_note_submit' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.status = 'approved' THEN
    IF v_latest.id IS NULL OR v_latest.status <> 'approved'
       OR v_latest.reviewer IS NULL OR v_latest.reviewer = NEW.teacher_id
       OR v_latest.reviewer = v_latest.submitted_by THEN
      RAISE EXCEPTION 'sod: a lesson note is approved only by a reviewer who did not write it'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'submitted' THEN
    IF v_latest.id IS NULL OR v_latest.status NOT IN ('returned', 'approved') THEN
      RAISE EXCEPTION 'a submitted lesson note changes only through review' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'an approved lesson note is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.m7_lesson_plan_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS m7_lesson_plan_guard ON public.lesson_plans;
CREATE TRIGGER m7_lesson_plan_guard
  BEFORE INSERT OR UPDATE ON public.lesson_plans
  FOR EACH ROW EXECUTE FUNCTION public.m7_lesson_plan_guard();
