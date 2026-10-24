-- =============================================================================
-- SHERIVS-016 — Gaps found by the Sherivs Simulation Lab (24 Oct 2026).
-- NOT APPLIED TO PRODUCTION. Validated on the isolated sim stack (tools/sim-lab).
--  1. Session rollover + student lifecycle (status, level, programme, rules
--     per institution category, idempotent rollover with dry-run preview,
--     append-only lifecycle events, audit entry).
--  2. Credit units, configurable grading scales, grade points, GPA/CGPA,
--     carry-overs, transcript.
--  3. Subscription tier -> entitlement plan (quotas apply automatically).
--  4. Legacy audit_logs append-only + bridged into the hash-chained audit_chain.
--  5. Legacy organisation admins (admin/principal) mapped to the canonical
--     role:administrator assignment, so tenant-admin checks (e.g. the
--     credential access log) work for them.
-- Convention (SHERIVS-003b): tenant/org id == organisation (schools.id).
-- Rollback: database/supabase/rollbacks/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql
-- =============================================================================
BEGIN;

-- 0. Shared authorisation helper ------------------------------------------------
-- True for: platform super admin; admin/principal of p_org; trusted server
-- context (service_role JWT, or a direct DB session without any JWT that is
-- not PostgREST's authenticator).
CREATE OR REPLACE FUNCTION public.can_administer_org(p_org uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN
    RETURN coalesce(auth.role(), '') = '' AND session_user NOT IN ('authenticator', 'anon', 'authenticated');
  END IF;
  IF coalesce(public.is_super_admin(), false) THEN RETURN true; END IF;
  RETURN public.get_my_school_id() = p_org AND public.get_my_role() IN ('admin', 'principal');
END
$$;
REVOKE ALL ON FUNCTION public.can_administer_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_administer_org(uuid) TO authenticated, service_role;

-- 1. Grading scales + credit units ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grading_scales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid REFERENCES public.schools(id) ON DELETE CASCADE, -- NULL = platform template
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,40}$'),
  name        text NOT NULL,
  scale_kind  text NOT NULL CHECK (scale_kind IN ('points', 'percentage')),
  max_point   numeric(4,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((scale_kind = 'points') = (max_point IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS grading_scales_code_uniq ON public.grading_scales (coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE IF NOT EXISTS public.grading_scale_bands (
  scale_id   uuid NOT NULL REFERENCES public.grading_scales(id) ON DELETE CASCADE,
  min_score  numeric(5,2) NOT NULL CHECK (min_score BETWEEN 0 AND 100),
  letter     text NOT NULL,
  point      numeric(4,2),
  remark     text,
  PRIMARY KEY (scale_id, min_score)
);

INSERT INTO public.grading_scales (school_id, code, name, scale_kind, max_point) VALUES
  (NULL, 'NG-UNI-5',  'Nigerian university 5-point (NUC)', 'points', 5.00),
  (NULL, 'NG-POLY-4', 'Nigerian polytechnic 4-point (NBTE)', 'points', 4.00),
  (NULL, 'WAEC-9',    'WAEC/NECO 9-point (A1-F9)', 'percentage', NULL),
  (NULL, 'K12-PCT',   'Primary/secondary percentage (A-F)', 'percentage', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.grading_scale_bands (scale_id, min_score, letter, point, remark)
SELECT s.id, b.min_score, b.letter, b.point, b.remark
  FROM public.grading_scales s
  JOIN (VALUES
    ('NG-UNI-5', 70, 'A', 5.00, 'Excellent'), ('NG-UNI-5', 60, 'B', 4.00, 'Very Good'), ('NG-UNI-5', 50, 'C', 3.00, 'Good'),
    ('NG-UNI-5', 45, 'D', 2.00, 'Fair'), ('NG-UNI-5', 40, 'E', 1.00, 'Pass'), ('NG-UNI-5', 0, 'F', 0.00, 'Fail'),
    ('NG-POLY-4', 75, 'A', 4.00, 'Distinction'), ('NG-POLY-4', 70, 'AB', 3.50, 'Very Good'), ('NG-POLY-4', 65, 'B', 3.25, 'Good'),
    ('NG-POLY-4', 60, 'BC', 3.00, 'Upper Credit'), ('NG-POLY-4', 55, 'C', 2.75, 'Credit'), ('NG-POLY-4', 50, 'CD', 2.50, 'Lower Credit'),
    ('NG-POLY-4', 45, 'D', 2.25, 'Pass'), ('NG-POLY-4', 40, 'E', 2.00, 'Pass'), ('NG-POLY-4', 0, 'F', 0.00, 'Fail'),
    ('WAEC-9', 75, 'A1', NULL, 'Excellent'), ('WAEC-9', 70, 'B2', NULL, 'Very Good'), ('WAEC-9', 65, 'B3', NULL, 'Good'),
    ('WAEC-9', 60, 'C4', NULL, 'Credit'), ('WAEC-9', 55, 'C5', NULL, 'Credit'), ('WAEC-9', 50, 'C6', NULL, 'Credit'),
    ('WAEC-9', 45, 'D7', NULL, 'Pass'), ('WAEC-9', 40, 'E8', NULL, 'Pass'), ('WAEC-9', 0, 'F9', NULL, 'Fail'),
    ('K12-PCT', 70, 'A', NULL, 'Excellent'), ('K12-PCT', 60, 'B', NULL, 'Very Good'), ('K12-PCT', 50, 'C', NULL, 'Good'),
    ('K12-PCT', 45, 'D', NULL, 'Pass'), ('K12-PCT', 40, 'E', NULL, 'Weak Pass'), ('K12-PCT', 0, 'F', NULL, 'Fail')
  ) AS b(code, min_score, letter, point, remark) ON b.code = s.code AND s.school_id IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS institution_category text CHECK (institution_category IN ('k12', 'polytechnic', 'university', 'other')),
  ADD COLUMN IF NOT EXISTS grading_scale_id uuid REFERENCES public.grading_scales(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title         text,
  credit_units  int NOT NULL CHECK (credit_units BETWEEN 0 AND 30),
  level         text,
  semester      text,
  programme     text,
  is_core       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_units int CHECK (credit_units IS NULL OR credit_units BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS grade_point numeric(4,2),
  ADD COLUMN IF NOT EXISTS attempt int NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  ADD COLUMN IF NOT EXISTS is_carryover boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_grades_student_year ON public.grades (student_id, academic_year);

-- Fill credit units (from the course catalogue) and the grade point (from the
-- organisation's scale). Letter grades from grades_autocalc stay untouched for
-- percentage scales; points scales also set the scale's letter.
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
DROP TRIGGER IF EXISTS trg_grades_points_fill ON public.grades;
CREATE TRIGGER trg_grades_points_fill BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.grades_points_fill();

-- GPA / CGPA (SECURITY INVOKER: the caller's results RLS applies).
-- Policy: every attempt counts (a failed course and its retake both stay in
-- the CGPA, the common NUC practice); outstanding carry-over = a course whose
-- latest attempt scored 0 points.
CREATE OR REPLACE FUNCTION public.member_gpa(p_student uuid, p_academic_year text DEFAULT NULL, p_term text DEFAULT NULL)
RETURNS TABLE (units int, quality_points numeric, gpa numeric)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(sum(g.credit_units), 0)::int,
         coalesce(sum(g.credit_units * g.grade_point), 0),
         CASE WHEN coalesce(sum(g.credit_units), 0) > 0
              THEN round(sum(g.credit_units * g.grade_point) / sum(g.credit_units), 2) END
    FROM public.grades g
   WHERE g.student_id = p_student AND g.credit_units > 0 AND g.grade_point IS NOT NULL
     AND (p_academic_year IS NULL OR g.academic_year = p_academic_year)
     AND (p_term IS NULL OR g.term = p_term);
$$;

CREATE OR REPLACE FUNCTION public.member_outstanding_carryovers(p_student uuid)
RETURNS TABLE (course_code text, credit_units int, last_academic_year text, attempts int)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH a AS (
    SELECT g.subject, g.credit_units, g.grade_point, g.academic_year,
           row_number() OVER (PARTITION BY g.subject ORDER BY g.academic_year DESC, g.attempt DESC, g.created_at DESC) rn,
           count(*) OVER (PARTITION BY g.subject) n
      FROM public.grades g
     WHERE g.student_id = p_student AND g.credit_units > 0 AND g.grade_point IS NOT NULL)
  SELECT subject, credit_units, academic_year, n::int FROM a WHERE rn = 1 AND grade_point = 0;
$$;

CREATE OR REPLACE FUNCTION public.degree_class(p_cgpa numeric, p_max_point numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_cgpa IS NULL OR p_max_point IS NULL THEN NULL
    WHEN p_max_point = 5 THEN CASE WHEN p_cgpa >= 4.50 THEN 'First Class' WHEN p_cgpa >= 3.50 THEN 'Second Class Upper'
      WHEN p_cgpa >= 2.40 THEN 'Second Class Lower' WHEN p_cgpa >= 1.50 THEN 'Third Class' WHEN p_cgpa >= 1.00 THEN 'Pass' ELSE 'Fail' END
    WHEN p_max_point = 4 THEN CASE WHEN p_cgpa >= 3.50 THEN 'Distinction' WHEN p_cgpa >= 3.00 THEN 'Upper Credit'
      WHEN p_cgpa >= 2.50 THEN 'Lower Credit' WHEN p_cgpa >= 2.00 THEN 'Pass' ELSE 'Fail' END
  END;
$$;

CREATE OR REPLACE FUNCTION public.member_transcript(p_student uuid)
RETURNS TABLE (academic_year text, term text, course_code text, course_title text, credit_units int,
               total_score numeric, letter text, grade_point numeric, attempt int, is_carryover boolean)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT g.academic_year, g.term, g.subject, c.title, g.credit_units, g.total_score, g.grade, g.grade_point, g.attempt, g.is_carryover
    FROM public.grades g LEFT JOIN public.courses c ON c.id = g.course_id
   WHERE g.student_id = p_student AND g.is_published IS TRUE
   ORDER BY g.academic_year, g.term, g.subject, g.attempt;
$$;
REVOKE ALL ON FUNCTION public.member_gpa(uuid, text, text), public.member_outstanding_carryovers(uuid), public.member_transcript(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_gpa(uuid, text, text), public.member_outstanding_carryovers(uuid), public.member_transcript(uuid) TO authenticated, service_role;

-- 2. Lifecycle -------------------------------------------------------------------
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'promoted', 'repeated', 'graduated', 'withdrawn', 'transferred')),
  ADD COLUMN IF NOT EXISTS current_level text,
  ADD COLUMN IF NOT EXISTS programme text,
  ADD COLUMN IF NOT EXISTS current_session text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS graduated_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_students_school_status ON public.students (school_id, status);

ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS programme text;

-- Backfill level/programme from the current class (class name = "<level> <programme>").
UPDATE public.classes SET programme = nullif(btrim(substr(name, length(coalesce(grade_level, '')) + 1)), '')
 WHERE programme IS NULL AND grade_level IS NOT NULL AND name LIKE grade_level || '%';
UPDATE public.students s SET current_level = c.grade_level, programme = coalesce(s.programme, c.programme)
  FROM public.classes c WHERE c.id = s.class_id AND s.current_level IS NULL;
UPDATE public.students SET status = 'withdrawn' WHERE is_active IS FALSE AND status = 'active';

CREATE TABLE IF NOT EXISTS public.progression_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  programme              text,          -- NULL = applies to every programme
  from_level             text NOT NULL,
  to_level               text,          -- NULL = final level: graduate
  min_cgpa               numeric(4,2),  -- below this: repeat (polytechnic defaults; NULL for universities)
  max_carryover_units    int,           -- more outstanding units than this: repeat
  max_carryover_courses  int,           -- this many or more outstanding carry-over COURSES: repeat the year (NG universities: 7)
  probation_cgpa         numeric(4,2),  -- below this: flagged probation/withdrawal review, NOT an automatic repeat
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS progression_rules_uniq ON public.progression_rules (school_id, coalesce(programme, ''), from_level);

CREATE TABLE IF NOT EXISTS public.session_rollovers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  from_session  text NOT NULL,
  to_session    text NOT NULL,
  summary       jsonb NOT NULL,
  actor_id      uuid,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, from_session, to_session)
);

CREATE TABLE IF NOT EXISTS public.member_lifecycle_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  rollover_id  uuid REFERENCES public.session_rollovers(id) ON DELETE SET NULL,
  from_status  text, to_status text NOT NULL,
  from_level   text, to_level text,
  session      text,
  reason       text,
  actor_id     uuid,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_lifecycle_student ON public.member_lifecycle_events (student_id, at);

-- Default rules + scale per institution category.
CREATE OR REPLACE FUNCTION public.configure_academic_defaults(p_school uuid, p_category text, p_final_levels jsonb DEFAULT '{}'::jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_scale text; v_n int := 0; v_prog text; v_final int; i int;
  k12 text[] := ARRAY['Nursery 1','Nursery 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JSS1','JSS2','JSS3','SS1','SS2','SS3'];
BEGIN
  IF NOT public.can_administer_org(p_school) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_category NOT IN ('k12', 'polytechnic', 'university') THEN RAISE EXCEPTION 'unknown category %', p_category; END IF;
  v_scale := CASE p_category WHEN 'university' THEN 'NG-UNI-5' WHEN 'polytechnic' THEN 'NG-POLY-4' ELSE 'K12-PCT' END;
  UPDATE public.schools SET institution_category = p_category,
         grading_scale_id = coalesce(grading_scale_id, (SELECT id FROM public.grading_scales WHERE school_id IS NULL AND code = v_scale))
   WHERE id = p_school;
  IF p_category = 'k12' THEN
    FOR i IN 1 .. array_length(k12, 1) LOOP
      INSERT INTO public.progression_rules (school_id, from_level, to_level)
      VALUES (p_school, k12[i], CASE WHEN i < array_length(k12, 1) THEN k12[i + 1] END) ON CONFLICT DO NOTHING;
      v_n := v_n + 1;
    END LOOP;
  ELSIF p_category = 'polytechnic' THEN
    INSERT INTO public.progression_rules (school_id, from_level, to_level, min_cgpa, max_carryover_units) VALUES
      (p_school, 'ND1', 'ND2', 1.00, 12), (p_school, 'ND2', NULL, 2.00, 0),
      (p_school, 'HND1', 'HND2', 1.00, 12), (p_school, 'HND2', NULL, 2.00, 0)
    ON CONFLICT DO NOTHING;
    v_n := 4;
  ELSE
    -- Levels 100L..final; final defaults to 400L, per programme via p_final_levels {"Medicine":"600L"}.
    FOR v_prog IN SELECT NULL UNION ALL SELECT jsonb_object_keys(p_final_levels) LOOP
      v_final := coalesce(nullif(regexp_replace(CASE WHEN v_prog IS NULL THEN coalesce(p_final_levels->>'*', '400L') ELSE p_final_levels->>v_prog END, '\D', '', 'g'), '')::int, 400);
      FOR i IN 1 .. v_final / 100 LOOP
        -- Nigerian university practice: 7+ outstanding carry-over courses repeats the year; CGPA < 1.00 is
        -- only a probation/withdrawal flag. Final level cannot graduate with any outstanding carry-over.
        INSERT INTO public.progression_rules (school_id, programme, from_level, to_level, min_cgpa, max_carryover_units, max_carryover_courses, probation_cgpa)
        VALUES (p_school, v_prog, (i * 100) || 'L', CASE WHEN i * 100 < v_final THEN ((i + 1) * 100) || 'L' END,
                NULL, CASE WHEN i * 100 < v_final THEN NULL ELSE 0 END, CASE WHEN i * 100 < v_final THEN 7 END, 1.00)
        ON CONFLICT DO NOTHING;
        v_n := v_n + 1;
      END LOOP;
    END LOOP;
  END IF;
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION public.configure_academic_defaults(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_academic_defaults(uuid, text, jsonb) TO authenticated, service_role;

-- Idempotent rollover with dry-run preview.
-- p_overrides: {"<student uuid>": "repeat"|"promote"|"graduate"|"withdraw"|"transfer"}
CREATE OR REPLACE FUNCTION public.session_rollover(p_school uuid, p_from text, p_to text, p_dry_run boolean DEFAULT true, p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_existing public.session_rollovers%ROWTYPE; v_summary jsonb; v_id uuid; v_actor uuid := auth.uid();
BEGIN
  IF NOT public.can_administer_org(p_school) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'invalid sessions'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_school::text || ':rollover', 16));
  SELECT * INTO v_existing FROM public.session_rollovers WHERE school_id = p_school AND from_session = p_from AND to_session = p_to;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.summary || jsonb_build_object('already_applied', true, 'rollover_id', v_existing.id, 'applied_at', v_existing.applied_at);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rollover_plan (student_id uuid PRIMARY KEY, from_status text, from_level text, programme text,
    decision text, to_level text, to_class uuid, cgpa numeric, carry_units int, carry_courses int, probation boolean, reason text) ON COMMIT DROP;
  TRUNCATE _rollover_plan;

  INSERT INTO _rollover_plan
  WITH s AS (
    SELECT st.id, st.status, st.current_level, st.programme FROM public.students st
     WHERE st.school_id = p_school AND st.is_active IS NOT FALSE
       AND st.status IN ('active', 'promoted', 'repeated') AND coalesce(st.current_session, p_from) = p_from),
  gp AS (
    SELECT g.student_id, CASE WHEN sum(g.credit_units) > 0 THEN round(sum(g.credit_units * g.grade_point) / sum(g.credit_units), 2) END cgpa
      FROM public.grades g JOIN s ON s.id = g.student_id
     WHERE g.credit_units > 0 AND g.grade_point IS NOT NULL GROUP BY g.student_id),
  last_attempt AS (
    SELECT DISTINCT ON (g.student_id, g.subject) g.student_id, g.credit_units, g.grade_point
      FROM public.grades g JOIN s ON s.id = g.student_id
     WHERE g.credit_units > 0 AND g.grade_point IS NOT NULL
     ORDER BY g.student_id, g.subject, g.academic_year DESC, g.attempt DESC, g.created_at DESC),
  co AS (SELECT student_id, sum(credit_units)::int units, count(*)::int courses FROM last_attempt WHERE grade_point = 0 GROUP BY student_id),
  r AS (
    SELECT s.*, rule.id rule_id, rule.to_level, rule.min_cgpa, rule.max_carryover_units, rule.max_carryover_courses, rule.probation_cgpa,
           gp.cgpa, coalesce(co.units, 0) carry_units, coalesce(co.courses, 0) carry_courses,
           p_overrides->>s.id::text ovr
      FROM s
      LEFT JOIN LATERAL (SELECT * FROM public.progression_rules pr
                          WHERE pr.school_id = p_school AND pr.from_level = s.current_level
                            AND (pr.programme IS NULL OR pr.programme = s.programme)
                          ORDER BY pr.programme NULLS LAST LIMIT 1) rule ON true
      LEFT JOIN gp ON gp.student_id = s.id LEFT JOIN co ON co.student_id = s.id),
  d AS (
    SELECT r.*, CASE
        WHEN r.ovr IN ('repeat', 'promote', 'graduate', 'withdraw', 'transfer') THEN r.ovr
        WHEN r.rule_id IS NULL THEN 'skip'
        WHEN r.min_cgpa IS NOT NULL AND r.cgpa IS NOT NULL AND r.cgpa < r.min_cgpa THEN 'repeat'
        WHEN r.max_carryover_courses IS NOT NULL AND r.carry_courses >= r.max_carryover_courses THEN 'repeat'
        WHEN r.max_carryover_units IS NOT NULL AND r.carry_units > r.max_carryover_units THEN 'repeat'
        WHEN r.to_level IS NULL THEN 'graduate'
        ELSE 'promote' END decision,
      CASE
        WHEN r.ovr IS NOT NULL THEN 'override'
        WHEN r.rule_id IS NULL THEN 'no progression rule for level ' || coalesce(r.current_level, '(none)')
        WHEN r.min_cgpa IS NOT NULL AND r.cgpa IS NOT NULL AND r.cgpa < r.min_cgpa THEN 'CGPA ' || r.cgpa || ' below ' || r.min_cgpa
        WHEN r.max_carryover_courses IS NOT NULL AND r.carry_courses >= r.max_carryover_courses THEN r.carry_courses || ' carry-over courses outstanding (repeat at ' || r.max_carryover_courses || '+)'
        WHEN r.max_carryover_units IS NOT NULL AND r.carry_units > r.max_carryover_units THEN r.carry_units || ' carry-over units outstanding'
        WHEN r.probation_cgpa IS NOT NULL AND r.cgpa IS NOT NULL AND r.cgpa < r.probation_cgpa THEN 'probation: CGPA ' || r.cgpa || ' below ' || r.probation_cgpa
        ELSE NULL END reason,
      (r.probation_cgpa IS NOT NULL AND r.cgpa IS NOT NULL AND r.cgpa < r.probation_cgpa) probation
      FROM r)
  SELECT d.id, d.status, d.current_level, d.programme, d.decision,
         CASE WHEN d.decision = 'promote' THEN d.to_level ELSE d.current_level END,
         CASE WHEN d.decision = 'promote' THEN (
           SELECT c.id FROM public.classes c WHERE c.school_id = p_school AND c.grade_level = d.to_level
              AND coalesce(c.programme, '') = coalesce(d.programme, '') ORDER BY c.name LIMIT 1) END,
         d.cgpa, d.carry_units, d.carry_courses, d.probation, d.reason
    FROM d;

  SELECT jsonb_build_object(
      'school_id', p_school, 'from_session', p_from, 'to_session', p_to, 'dry_run', p_dry_run,
      'total', count(*),
      'promoted', count(*) FILTER (WHERE decision = 'promote'),
      'repeated', count(*) FILTER (WHERE decision = 'repeat'),
      'graduated', count(*) FILTER (WHERE decision = 'graduate'),
      'withdrawn', count(*) FILTER (WHERE decision = 'withdraw'),
      'transferred', count(*) FILTER (WHERE decision = 'transfer'),
      'skipped', count(*) FILTER (WHERE decision = 'skip'),
      'probation', count(*) FILTER (WHERE probation),
      'promoted_without_class', count(*) FILTER (WHERE decision = 'promote' AND to_class IS NULL),
      'by_level', coalesce((SELECT jsonb_object_agg(k, v) FROM (SELECT coalesce(from_level, '(none)') || ' -> ' || decision k, count(*) v
                     FROM _rollover_plan GROUP BY 1) x), '{}'::jsonb),
      'sample', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'programme') FROM (SELECT * FROM _rollover_plan WHERE decision <> 'promote' OR probation ORDER BY decision, student_id LIMIT 25) p), '[]'::jsonb))
    INTO v_summary FROM _rollover_plan;

  IF p_dry_run THEN RETURN v_summary || jsonb_build_object('already_applied', false); END IF;

  INSERT INTO public.session_rollovers (school_id, from_session, to_session, summary, actor_id)
  VALUES (p_school, p_from, p_to, v_summary, v_actor) RETURNING id INTO v_id;

  UPDATE public.students st SET
      status = CASE p.decision WHEN 'promote' THEN 'promoted' WHEN 'repeat' THEN 'repeated' WHEN 'graduate' THEN 'graduated'
                               WHEN 'withdraw' THEN 'withdrawn' WHEN 'transfer' THEN 'transferred' ELSE st.status END,
      current_level = p.to_level,
      class_id = CASE WHEN p.decision = 'promote' THEN p.to_class WHEN p.decision IN ('graduate', 'withdraw', 'transfer') THEN NULL ELSE st.class_id END,
      current_session = p_to,
      is_active = CASE WHEN p.decision IN ('graduate', 'withdraw', 'transfer') THEN false ELSE st.is_active END,
      graduated_at = CASE WHEN p.decision = 'graduate' THEN now() ELSE st.graduated_at END,
      status_changed_at = now()
    FROM _rollover_plan p WHERE p.student_id = st.id AND p.decision <> 'skip';

  INSERT INTO public.member_lifecycle_events (school_id, student_id, rollover_id, from_status, to_status, from_level, to_level, session, reason, actor_id)
  SELECT p_school, p.student_id, v_id, p.from_status,
         CASE p.decision WHEN 'promote' THEN 'promoted' WHEN 'repeat' THEN 'repeated' WHEN 'graduate' THEN 'graduated'
                         WHEN 'withdraw' THEN 'withdrawn' ELSE 'transferred' END,
         p.from_level, p.to_level, p_to, p.reason, v_actor
    FROM _rollover_plan p WHERE p.decision <> 'skip';

  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
  VALUES (p_school, v_actor, 'session_rollover', 'students', v_id, v_summary - 'sample');

  RETURN v_summary || jsonb_build_object('already_applied', false, 'rollover_id', v_id);
END
$$;
REVOKE ALL ON FUNCTION public.session_rollover(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_rollover(uuid, text, text, boolean, jsonb) TO authenticated, service_role;

-- RLS for new tables
ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scale_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_rollovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY grading_scales_read ON public.grading_scales FOR SELECT TO authenticated
  USING (school_id IS NULL OR school_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
CREATE POLICY grading_scales_admin ON public.grading_scales FOR ALL TO authenticated
  USING (school_id IS NOT NULL AND (SELECT public.can_administer_org(school_id)))
  WITH CHECK (school_id IS NOT NULL AND (SELECT public.can_administer_org(school_id)));
CREATE POLICY grading_scale_bands_read ON public.grading_scale_bands FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.grading_scales s WHERE s.id = scale_id
                  AND (s.school_id IS NULL OR s.school_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()))));
CREATE POLICY grading_scale_bands_admin ON public.grading_scale_bands FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.grading_scales s WHERE s.id = scale_id AND s.school_id IS NOT NULL AND public.can_administer_org(s.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.grading_scales s WHERE s.id = scale_id AND s.school_id IS NOT NULL AND public.can_administer_org(s.school_id)));
CREATE POLICY courses_read ON public.courses FOR SELECT TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
CREATE POLICY courses_admin ON public.courses FOR ALL TO authenticated
  USING ((SELECT public.can_administer_org(school_id))) WITH CHECK ((SELECT public.can_administer_org(school_id)));
CREATE POLICY progression_rules_read ON public.progression_rules FOR SELECT TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
CREATE POLICY progression_rules_admin ON public.progression_rules FOR ALL TO authenticated
  USING ((SELECT public.can_administer_org(school_id))) WITH CHECK ((SELECT public.can_administer_org(school_id)));
CREATE POLICY session_rollovers_read ON public.session_rollovers FOR SELECT TO authenticated
  USING ((SELECT public.can_administer_org(school_id)));
CREATE POLICY member_lifecycle_read ON public.member_lifecycle_events FOR SELECT TO authenticated
  USING ((SELECT public.can_administer_org(school_id)));
GRANT SELECT ON public.grading_scales, public.grading_scale_bands, public.courses, public.progression_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.grading_scales, public.grading_scale_bands, public.courses, public.progression_rules TO authenticated;
GRANT SELECT ON public.session_rollovers, public.member_lifecycle_events TO authenticated;
REVOKE ALL ON public.grading_scales, public.grading_scale_bands, public.courses, public.progression_rules,
  public.session_rollovers, public.member_lifecycle_events FROM anon;

-- Lifecycle events and rollover records are append-only.
CREATE OR REPLACE FUNCTION public.forbid_mutation_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  -- Allow only the row deletes performed by a foreign-key cascade (organisation
  -- or record erasure, pg_trigger_depth() > 1); direct UPDATE/DELETE/TRUNCATE fail.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER trg_member_lifecycle_append_only BEFORE UPDATE OR DELETE ON public.member_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation_append_only();
CREATE TRIGGER trg_member_lifecycle_no_truncate BEFORE TRUNCATE ON public.member_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_mutation_append_only();
CREATE TRIGGER trg_session_rollovers_append_only BEFORE UPDATE OR DELETE ON public.session_rollovers
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation_append_only();

-- 3. Tier -> entitlement plan --------------------------------------------------------
INSERT INTO public.entitlement_plans (id, features) VALUES
  ('starter',    ARRAY['core', 'sms']),
  ('growth',     ARRAY['core', 'sms', 'whatsapp', 'ai']),
  ('enterprise', ARRAY['core', 'sms', 'whatsapp', 'ai', 'voice', 'codegen'])
ON CONFLICT (id) DO NOTHING;
-- PLACEHOLDER quotas: commercial numbers to be confirmed by the owner.
INSERT INTO public.entitlement_plan_quotas (plan_id, meter, quota, period) VALUES
  ('starter', 'sms', 500, 'month'), ('starter', 'whatsapp', 0, 'month'), ('starter', 'ai_requests_per_member_day', 10, 'day'),
  ('starter', 'voice_minutes', 0, 'month'), ('starter', 'code_generations', 0, 'month'), ('starter', 'storage_mb', 2048, 'none'),
  ('growth', 'sms', 3000, 'month'), ('growth', 'whatsapp', 2000, 'month'), ('growth', 'ai_requests_per_member_day', 50, 'day'),
  ('growth', 'voice_minutes', 120, 'month'), ('growth', 'code_generations', 20, 'month'), ('growth', 'storage_mb', 20480, 'none'),
  ('enterprise', 'sms', 20000, 'month'), ('enterprise', 'whatsapp', 15000, 'month'), ('enterprise', 'ai_requests_per_member_day', 200, 'day'),
  ('enterprise', 'voice_minutes', 1000, 'month'), ('enterprise', 'code_generations', 200, 'month'), ('enterprise', 'storage_mb', 204800, 'none')
ON CONFLICT (plan_id, meter) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subscription_tier_plans (
  tier    text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES public.entitlement_plans(id)
);
INSERT INTO public.subscription_tier_plans (tier, plan_id) VALUES
  ('free', 'starter'), ('basic', 'starter'), ('starter', 'starter'),
  ('standard', 'growth'), ('growth', 'growth'), ('professional', 'growth'), ('pro', 'growth'),
  ('premium', 'enterprise'), ('enterprise', 'enterprise')
ON CONFLICT (tier) DO NOTHING;
ALTER TABLE public.subscription_tier_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_tier_plans_read ON public.subscription_tier_plans FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.subscription_tier_plans TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_org_entitlements_from_tier(p_org uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO public.org_entitlements (org_id, plan_id, updated_at)
  SELECT s.id, coalesce(m.plan_id, 'starter'), now()
    FROM public.schools s LEFT JOIN public.subscription_tier_plans m ON m.tier = lower(btrim(s.subscription_tier))
   WHERE (p_org IS NULL OR s.id = p_org)
  ON CONFLICT (org_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = now()
   WHERE public.org_entitlements.plan_id IS DISTINCT FROM EXCLUDED.plan_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION public.sync_org_entitlements_from_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_org_entitlements_from_tier(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.schools_tier_entitlement_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$ BEGIN PERFORM public.sync_org_entitlements_from_tier(NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.schools_tier_entitlement_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_schools_tier_entitlements ON public.schools;
CREATE TRIGGER trg_schools_tier_entitlements AFTER INSERT OR UPDATE OF subscription_tier ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.schools_tier_entitlement_sync();
SELECT public.sync_org_entitlements_from_tier(NULL);

-- Effective quota = plan quota + unexpired overrides.
CREATE OR REPLACE FUNCTION public.entitlement_quota(p_org uuid, p_meter text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT q.quota + coalesce((SELECT sum(o.extra) FROM public.entitlement_overrides o
                              WHERE o.org_id = p_org AND o.meter = p_meter AND o.expires_at > now()), 0)
    FROM public.org_entitlements e JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = p_meter
   WHERE e.org_id = p_org;
$$;
-- Plan-aware metering: the limit comes from the organisation's plan, not the caller.
CREATE OR REPLACE FUNCTION public.meter_consume_for_plan(p_org uuid, p_meter text, p_period_key text, p_subject text, p_qty bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_limit bigint := public.entitlement_quota(p_org, p_meter);
BEGIN
  IF v_limit IS NULL THEN RETURN false; END IF;  -- no plan / meter not in plan: deny
  RETURN public.meter_consume(p_org, p_meter, p_period_key, p_subject, p_qty, v_limit);
END
$$;
REVOKE ALL ON FUNCTION public.entitlement_quota(uuid, text), public.meter_consume_for_plan(uuid, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_quota(uuid, text), public.meter_consume_for_plan(uuid, text, text, text, bigint) TO service_role;

-- 4. Legacy audit_logs: append-only + bridge into audit_chain -----------------------
CREATE OR REPLACE FUNCTION public.audit_chain_canonical_hash(p_prev text, p_seq bigint, p_at timestamptz, p_org uuid, p_kind text, p_actor text,
  p_action text, p_ttype text, p_tid text, p_ip inet, p_device text, p_before text, p_after text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  -- Mirrors frontend/src/lib/trust-ledger/hash-chain.server.ts computeEntryHash:
  -- sha256(prev_hash || stableStringify([seq, at, orgId, actorKind, actorId, action, targetType, targetId, ip, device, beforeHash, afterHash, prevHash]))
  SELECT encode(sha256(convert_to(p_prev || '[' || p_seq::text || ',' ||
    to_json(to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text || ',' ||
    to_json(p_org::text)::text || ',' || to_json(p_kind)::text || ',' || to_json(p_actor)::text || ',' ||
    to_json(p_action)::text || ',' || to_json(p_ttype)::text || ',' || to_json(p_tid)::text || ',' ||
    coalesce(to_json(host(p_ip))::text, 'null') || ',' || coalesce(to_json(p_device)::text, 'null') || ',' ||
    coalesce(to_json(p_before)::text, 'null') || ',' || coalesce(to_json(p_after)::text, 'null') || ',' ||
    to_json(p_prev)::text || ']', 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.audit_logs_bridge_to_chain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_head public.audit_chain%ROWTYPE; v_seq bigint; v_prev text; v_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_action text; v_actor text; v_tid text; v_before text; v_after text; v_ip inet;
BEGIN
  IF NEW.school_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.school_id::text, 7013));
  SELECT * INTO v_head FROM public.audit_chain WHERE org_id = NEW.school_id ORDER BY seq DESC LIMIT 1;
  v_seq := coalesce(v_head.seq, 0) + 1;
  v_prev := coalesce(v_head.entry_hash, repeat('0', 64));
  v_action := left('legacy.' || coalesce(nullif(regexp_replace(lower(coalesce(NEW.action, 'event')), '[^a-z0-9_.:-]+', '_', 'g'), ''), 'event'), 100);
  v_actor := coalesce(NEW.user_id::text, 'system');
  v_tid := coalesce(NEW.record_id::text, NEW.id::text);
  v_before := CASE WHEN NEW.old_value IS NULL THEN NULL ELSE encode(sha256(convert_to(NEW.old_value::text, 'UTF8')), 'hex') END;
  v_after := CASE WHEN NEW.new_value IS NULL THEN NULL ELSE encode(sha256(convert_to(NEW.new_value::text, 'UTF8')), 'hex') END;
  BEGIN v_ip := nullif(NEW.ip_address, '')::inet; EXCEPTION WHEN others THEN v_ip := NULL; END;
  INSERT INTO public.audit_chain (org_id, seq, at, actor_kind, actor_id, action, target_type, target_id, ip, device, before_hash, after_hash, prev_hash, entry_hash)
  VALUES (NEW.school_id, v_seq, v_at, CASE WHEN NEW.user_id IS NULL THEN 'system' ELSE 'user' END, v_actor, v_action,
          coalesce(NEW.table_name, 'legacy'), v_tid, v_ip, NULL, v_before, v_after, v_prev,
          public.audit_chain_canonical_hash(v_prev, v_seq, v_at, NEW.school_id, CASE WHEN NEW.user_id IS NULL THEN 'system' ELSE 'user' END,
            v_actor, v_action, coalesce(NEW.table_name, 'legacy'), v_tid, v_ip, NULL, v_before, v_after));
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.audit_logs_bridge_to_chain() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_logs_bridge_chain ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_bridge_chain AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_bridge_to_chain();

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation_append_only();
DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_mutation_append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- 5. Legacy admins -> canonical role:administrator ------------------------------------
CREATE OR REPLACE FUNCTION public.sync_admin_role_assignments(p_user uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n int := 0; v_k int;
BEGIN
  -- End assignments that no longer match (role changed, moved organisation, deactivated).
  UPDATE public.cg_role_assignment r SET status = 'ended', ended_on = greatest(r.started_on, current_date)
   WHERE r.role_id = 'role:administrator' AND r.status = 'active' AND r.identity_ref ~ '^[0-9a-f-]{36}$'
     AND (p_user IS NULL OR r.identity_ref = p_user::text)
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.id::text = r.identity_ref)
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id::text = r.identity_ref AND u.school_id::text = r.tenant_ref
                       AND u.role IN ('admin', 'principal') AND u.is_active IS NOT FALSE);
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  INSERT INTO public.cg_role_assignment (tenant_ref, identity_ref, role_id, status, started_on)
  SELECT u.school_id::text, u.id::text, 'role:administrator', 'active', current_date
    FROM public.users u
   WHERE u.role IN ('admin', 'principal') AND u.is_active IS NOT FALSE AND u.school_id IS NOT NULL
     AND (p_user IS NULL OR u.id = p_user)
     AND NOT EXISTS (SELECT 1 FROM public.cg_role_assignment r WHERE r.tenant_ref = u.school_id::text AND r.identity_ref = u.id::text
                       AND r.role_id = 'role:administrator' AND r.status = 'active');
  GET DIAGNOSTICS v_k = ROW_COUNT;
  RETURN v_n + v_k;
END
$$;
REVOKE ALL ON FUNCTION public.sync_admin_role_assignments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_admin_role_assignments(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.users_admin_role_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$ BEGIN PERFORM public.sync_admin_role_assignments(NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.users_admin_role_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_users_admin_role_sync ON public.users;
CREATE TRIGGER trg_users_admin_role_sync AFTER INSERT OR UPDATE OF role, school_id, is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_admin_role_sync();
SELECT public.sync_admin_role_assignments(NULL);

COMMIT;
