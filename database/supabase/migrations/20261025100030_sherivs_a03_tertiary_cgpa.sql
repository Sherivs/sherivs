-- SHERIVS-A03 (Track A, day 5): tertiary results hardening.
--  * official semester results: GPA, running CGPA, TCU/TCP/TCE from PUBLISHED grades only, one row per course attempt
--  * configurable degree-class bands per school (NUC 5-point defaults when none are set)
--  * academic standing per session: good standing / probation / withdrawal advised (two consecutive probations)
--  * readers: the student, a linked guardian, or staff with grades.view in that school
-- Additive only; member_gpa (SHERIVS-016) stays as is for existing callers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.degree_class_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  label text NOT NULL, min_cgpa numeric(4,2) NOT NULL CHECK (min_cgpa >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, label), UNIQUE (school_id, min_cgpa));
CREATE TABLE IF NOT EXISTS public.academic_standing_rules (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  probation_below numeric(4,2) NOT NULL DEFAULT 1.00, consecutive_for_withdrawal int NOT NULL DEFAULT 2 CHECK (consecutive_for_withdrawal BETWEEN 1 AND 4),
  updated_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['degree_class_bands','academic_standing_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t); EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
    EXECUTE format('CREATE POLICY %1$s_read ON public.%1$I FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;

CREATE OR REPLACE FUNCTION public._a03_can_read(p_student uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF s.id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s.user_id = auth.uid() OR s.parent_id = auth.uid() OR public.is_guardian_of_student(s.id, s.school_id)
     OR (s.school_id = public.get_my_school_id() AND public.scholar_can(s.school_id, 'grades.view')) OR coalesce(public.is_super_admin(), false) THEN
    RETURN s.school_id; END IF;
  RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
END $$;

-- one row per course attempt (latest edit wins), published only
CREATE OR REPLACE FUNCTION public._a03_attempts(p_student uuid)
RETURNS TABLE (session text, semester text, course text, units int, point numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT ON (g.academic_year, g.term, coalesce(g.course_id::text, g.subject), g.attempt)
         g.academic_year, g.term, coalesce(g.course_id::text, g.subject), g.credit_units, g.grade_point
    FROM public.grades g
   WHERE g.student_id = p_student AND g.is_published AND g.credit_units > 0 AND g.grade_point IS NOT NULL
   ORDER BY g.academic_year, g.term, coalesce(g.course_id::text, g.subject), g.attempt, g.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public._a03_sem_order(p_session text, p_sem text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(split_part(p_session, '/', 1), '')::int, 0) * 10
       + CASE lower(p_sem) WHEN 'first' THEN 1 WHEN '1' THEN 1 WHEN 'harmattan' THEN 1 WHEN 'second' THEN 2 WHEN '2' THEN 2 WHEN 'rain' THEN 2 ELSE 3 END;
$$;

-- Official semester-by-semester results with running CGPA and degree class.
CREATE OR REPLACE FUNCTION public.semester_results(p_student uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; out jsonb; cg numeric; cls text;
BEGIN
  org := public._a03_can_read(p_student);
  WITH a AS (SELECT * FROM public._a03_attempts(p_student)),
  s AS (SELECT session, semester, public._a03_sem_order(session, semester) o, sum(units)::int tcu, sum(units * point) tcp,
               sum(units) FILTER (WHERE point >= 1)::int tce FROM a GROUP BY 1, 2),
  r AS (SELECT *, sum(tcu) OVER w ctcu, sum(tcp) OVER w ctcp FROM s WINDOW w AS (ORDER BY o ROWS UNBOUNDED PRECEDING))
  SELECT coalesce(jsonb_agg(jsonb_build_object('session', session, 'semester', semester, 'tcu', tcu, 'tcp', round(tcp, 2), 'tce', coalesce(tce, 0),
           'gpa', round(tcp / nullif(tcu, 0), 2), 'cumulative_units', ctcu, 'cgpa', round(ctcp / nullif(ctcu, 0), 2)) ORDER BY o), '[]'::jsonb),
         (SELECT round(sum(units * point) / nullif(sum(units), 0), 2) FROM a)
    INTO out, cg FROM r;
  SELECT label INTO cls FROM (
      SELECT label, min_cgpa FROM public.degree_class_bands WHERE school_id = org
      UNION ALL SELECT * FROM (VALUES ('First Class', 4.50), ('Second Class Upper', 3.50), ('Second Class Lower', 2.40), ('Third Class', 1.50), ('Pass', 1.00)) d(label, min_cgpa)
       WHERE NOT EXISTS (SELECT 1 FROM public.degree_class_bands WHERE school_id = org)) b
   WHERE cg IS NOT NULL AND cg >= b.min_cgpa ORDER BY b.min_cgpa DESC LIMIT 1;
  RETURN jsonb_build_object('semesters', out, 'cgpa', cg, 'class', coalesce(cls, CASE WHEN cg IS NULL THEN NULL ELSE 'Fail' END),
                            'standing', public._a03_standing(p_student, org, out));
END $$;

-- Standing from the session-end CGPA: probation below the floor; withdrawal advised after N consecutive probations.
CREATE OR REPLACE FUNCTION public._a03_standing(p_student uuid, p_org uuid, p_sems jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.academic_standing_rules; e jsonb; streak int := 0; last_sess text; status text := 'good_standing'; hist jsonb := '[]'::jsonb; sess_cgpa numeric;
BEGIN
  SELECT * INTO r FROM public.academic_standing_rules WHERE school_id = p_org;
  IF r.school_id IS NULL THEN r.probation_below := 1.00; r.consecutive_for_withdrawal := 2; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_sems) x LOOP
    -- the last semester row of each session carries that session's closing CGPA
    IF last_sess IS NOT NULL AND e->>'session' <> last_sess THEN
      IF sess_cgpa < r.probation_below THEN streak := streak + 1; ELSE streak := 0; END IF;
      hist := hist || jsonb_build_object('session', last_sess, 'cgpa', sess_cgpa, 'probation', sess_cgpa < r.probation_below);
    END IF;
    last_sess := e->>'session'; sess_cgpa := (e->>'cgpa')::numeric;
  END LOOP;
  IF last_sess IS NOT NULL THEN
    IF sess_cgpa < r.probation_below THEN streak := streak + 1; ELSE streak := 0; END IF;
    hist := hist || jsonb_build_object('session', last_sess, 'cgpa', sess_cgpa, 'probation', sess_cgpa < r.probation_below);
  END IF;
  status := CASE WHEN streak >= r.consecutive_for_withdrawal THEN 'withdrawal_advised' WHEN streak >= 1 THEN 'probation' ELSE 'good_standing' END;
  RETURN jsonb_build_object('status', status, 'consecutive_probations', streak, 'floor', r.probation_below, 'sessions', hist);
END $$;

CREATE OR REPLACE FUNCTION public.degree_class_bands_set(p_org uuid, p_bands jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_bands) <> 'array' OR jsonb_array_length(p_bands) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'give 1 to 10 bands'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_bands) b WHERE coalesce(length(b->>'label'), 0) < 2 OR (b->>'min_cgpa')::numeric NOT BETWEEN 0 AND 10) THEN
    RAISE EXCEPTION 'each band needs a label and a minimum CGPA between 0 and 10'; END IF;
  DELETE FROM public.degree_class_bands WHERE school_id = p_org;
  INSERT INTO public.degree_class_bands (school_id, label, min_cgpa) SELECT p_org, b->>'label', (b->>'min_cgpa')::numeric FROM jsonb_array_elements(p_bands) b;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.academic_standing_rules_set(p_org uuid, p_probation_below numeric, p_consecutive int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_probation_below NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'probation floor must be between 0 and 10'; END IF;
  INSERT INTO public.academic_standing_rules (school_id, probation_below, consecutive_for_withdrawal) VALUES (p_org, p_probation_below, p_consecutive)
  ON CONFLICT (school_id) DO UPDATE SET probation_below = EXCLUDED.probation_below, consecutive_for_withdrawal = EXCLUDED.consecutive_for_withdrawal, updated_at = now();
END $$;

-- Staff list: students currently on probation / withdrawal advised (grades.view in the school).
CREATE OR REPLACE FUNCTION public.academic_standing_report(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE out jsonb := '[]'::jsonb; s record; r jsonb;
BEGIN
  IF p_org IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(p_org, 'grades.view') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR s IN SELECT DISTINCT st.id, st.admission_number, u.full_name FROM public.students st LEFT JOIN public.users u ON u.id = st.user_id
            WHERE st.school_id = p_org AND st.is_active AND EXISTS (SELECT 1 FROM public.grades g WHERE g.student_id = st.id AND g.credit_units > 0 AND g.is_published) LOOP
    r := public.semester_results(s.id);
    IF r->'standing'->>'status' <> 'good_standing' THEN
      out := out || jsonb_build_object('student_id', s.id, 'admission_number', s.admission_number, 'name', s.full_name, 'cgpa', r->'cgpa', 'standing', r->'standing'->>'status');
    END IF;
  END LOOP;
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION public._a03_can_read(uuid), public._a03_attempts(uuid), public._a03_standing(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.semester_results(uuid), public.degree_class_bands_set(uuid, jsonb), public.academic_standing_rules_set(uuid, numeric, int), public.academic_standing_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.semester_results(uuid), public.degree_class_bands_set(uuid, jsonb), public.academic_standing_rules_set(uuid, numeric, int), public.academic_standing_report(uuid) TO authenticated;

COMMIT;
