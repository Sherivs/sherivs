-- SHERIVS-023 (Wave 5): course registration with prerequisites and unit limits, adviser approval (SoD), SIWES placements + logbook
-- with industry-supervisor verification codes, and the learning-gap early-warning engine. Mobile apps are out of scope (Expo token).
BEGIN;
-- ===== Course registration =====
CREATE TABLE IF NOT EXISTS public.course_prerequisites (
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE, prereq_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, min_grade_point numeric NOT NULL DEFAULT 1, PRIMARY KEY (course_id, prereq_id), CHECK (course_id <> prereq_id));
CREATE TABLE IF NOT EXISTS public.registration_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  session text NOT NULL, semester text NOT NULL, opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL,
  min_units int NOT NULL DEFAULT 15, max_units int NOT NULL DEFAULT 24, late_fee numeric NOT NULL DEFAULT 0, UNIQUE (school_id, session, semester), CHECK (closes_at > opens_at));
CREATE TABLE IF NOT EXISTS public.course_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE, session text NOT NULL, semester text NOT NULL,
  is_carryover boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','dropped')),
  decided_by uuid, decided_at timestamptz, note text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (student_id, course_id, session));

CREATE OR REPLACE FUNCTION public.registration_window_set(p_school uuid, p_session text, p_semester text, p_opens timestamptz, p_closes timestamptz, p_min int DEFAULT 15, p_max int DEFAULT 24) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_min > p_max THEN RAISE EXCEPTION 'minimum units cannot exceed maximum'; END IF;
  INSERT INTO public.registration_windows (school_id, session, semester, opens_at, closes_at, min_units, max_units) VALUES (p_school, p_session, p_semester, p_opens, p_closes, p_min, p_max)
  ON CONFLICT (school_id, session, semester) DO UPDATE SET opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at, min_units = EXCLUDED.min_units, max_units = EXCLUDED.max_units RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.course_prereq_set(p_course uuid, p_prereq uuid, p_min_gp numeric DEFAULT 1) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid;
BEGIN
  SELECT school_id INTO s FROM public.courses WHERE id = p_course;
  IF s IS NULL OR NOT public.scholar_can(s, 'settings.manage') OR NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_prereq AND school_id = s) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  -- no cycles
  IF EXISTS (WITH RECURSIVE up(c) AS (SELECT p_prereq UNION SELECT cp.prereq_id FROM public.course_prerequisites cp JOIN up ON cp.course_id = up.c) SELECT 1 FROM up WHERE c = p_course) THEN
    RAISE EXCEPTION 'prerequisite cycle'; END IF;
  INSERT INTO public.course_prerequisites (course_id, prereq_id, school_id, min_grade_point) VALUES (p_course, p_prereq, s, p_min_gp)
  ON CONFLICT (course_id, prereq_id) DO UPDATE SET min_grade_point = EXCLUDED.min_grade_point;
END $$;
-- Student registers. Returns {ok,error} on rule failures so the UI can show the reason.
CREATE OR REPLACE FUNCTION public.course_register(p_course uuid, p_session text, p_semester text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE st public.students; c public.courses; w public.registration_windows; units int; missing text; carry boolean; owed text;
BEGIN
  SELECT * INTO st FROM public.students WHERE user_id = auth.uid() LIMIT 1;
  SELECT * INTO c FROM public.courses WHERE id = p_course;
  IF st.id IS NULL OR c.id IS NULL OR c.school_id <> st.school_id THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.registration_windows WHERE school_id = st.school_id AND session = p_session AND semester = p_semester;
  IF w.id IS NULL OR now() NOT BETWEEN w.opens_at AND w.closes_at THEN RETURN jsonb_build_object('ok', false, 'error', 'registration_closed'); END IF;
  IF c.semester IS NOT NULL AND c.semester <> p_semester THEN RETURN jsonb_build_object('ok', false, 'error', 'wrong_semester'); END IF;
  SELECT string_agg(pc.code, ', ') INTO missing FROM public.course_prerequisites cp JOIN public.courses pc ON pc.id = cp.prereq_id
   WHERE cp.course_id = p_course AND NOT EXISTS (SELECT 1 FROM public.grades g WHERE g.student_id = st.id AND g.course_id = cp.prereq_id AND coalesce(g.grade_point, 0) >= cp.min_grade_point);
  IF missing IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'prerequisite_missing', 'missing', missing); END IF;
  carry := EXISTS (SELECT 1 FROM public.grades g WHERE g.student_id = st.id AND g.course_id = p_course AND coalesce(g.grade_point, 0) < 1);
  -- carry-overs first: outstanding failed courses offered this semester must be registered before new ones
  SELECT string_agg(DISTINCT oc.code, ', ') INTO owed FROM public.grades g JOIN public.courses oc ON oc.id = g.course_id
   WHERE g.student_id = st.id AND coalesce(g.grade_point, 0) < 1 AND oc.semester = p_semester AND oc.id <> p_course
     AND NOT EXISTS (SELECT 1 FROM public.grades g2 WHERE g2.student_id = st.id AND g2.course_id = oc.id AND coalesce(g2.grade_point, 0) >= 1)
     AND NOT EXISTS (SELECT 1 FROM public.course_registrations r WHERE r.student_id = st.id AND r.course_id = oc.id AND r.session = p_session AND r.status <> 'dropped');
  IF owed IS NOT NULL AND NOT carry THEN RETURN jsonb_build_object('ok', false, 'error', 'register_carryovers_first', 'carryovers', owed); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('creg:' || st.id::text || p_session));
  SELECT coalesce(sum(cc.credit_units), 0) INTO units FROM public.course_registrations r JOIN public.courses cc ON cc.id = r.course_id
   WHERE r.student_id = st.id AND r.session = p_session AND r.semester = p_semester AND r.status IN ('pending','approved');
  IF units + coalesce(c.credit_units, 0) > w.max_units THEN RETURN jsonb_build_object('ok', false, 'error', 'unit_limit', 'units', units, 'max', w.max_units); END IF;
  INSERT INTO public.course_registrations (school_id, student_id, course_id, session, semester, is_carryover) VALUES (st.school_id, st.id, p_course, p_session, p_semester, carry)
  ON CONFLICT (student_id, course_id, session) DO UPDATE SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE public.course_registrations.status = 'dropped';
  RETURN jsonb_build_object('ok', true, 'units', units + coalesce(c.credit_units, 0), 'carryover', carry, 'below_minimum', units + coalesce(c.credit_units, 0) < w.min_units);
END $$;
CREATE OR REPLACE FUNCTION public.course_drop(p_registration uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.course_registrations; w public.registration_windows;
BEGIN
  SELECT r2.* INTO r FROM public.course_registrations r2 JOIN public.students s ON s.id = r2.student_id WHERE r2.id = p_registration AND s.user_id = auth.uid();
  IF r.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.registration_windows WHERE school_id = r.school_id AND session = r.session AND semester = r.semester;
  IF now() > w.closes_at THEN RAISE EXCEPTION 'registration closed: ask your adviser'; END IF;
  IF r.is_carryover THEN RAISE EXCEPTION 'carry-over courses cannot be dropped'; END IF;
  UPDATE public.course_registrations SET status = 'dropped' WHERE id = r.id;
END $$;
CREATE OR REPLACE FUNCTION public.course_reg_decide(p_registration uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.course_registrations;
BEGIN
  SELECT * INTO r FROM public.course_registrations WHERE id = p_registration FOR UPDATE;
  IF r.id IS NULL OR NOT public.scholar_can(r.school_id, 'course_reg.approve') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = r.student_id AND user_id = auth.uid()) THEN RAISE EXCEPTION 'sod: you cannot approve your own registration' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'registration is %', r.status; END IF;
  UPDATE public.course_registrations SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(), note = p_note WHERE id = r.id;
END $$;

-- ===== SIWES =====
CREATE TABLE IF NOT EXISTS public.siwes_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employer text NOT NULL, address text, supervisor_name text NOT NULL, supervisor_phone text, starts_on date NOT NULL, ends_on date NOT NULL,
  verify_code_hash text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','withdrawn')), created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on));
CREATE TABLE IF NOT EXISTS public.siwes_logbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), placement_id uuid NOT NULL REFERENCES public.siwes_placements(id) ON DELETE CASCADE, school_id uuid NOT NULL,
  week int NOT NULL CHECK (week BETWEEN 1 AND 52), entry text NOT NULL CHECK (length(entry) >= 20), student_signed_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz, verifier_note text, UNIQUE (placement_id, week));
CREATE OR REPLACE FUNCTION public.siwes_place(p_student uuid, p_employer text, p_supervisor text, p_phone text, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; v uuid; code text := upper(encode(extensions.gen_random_bytes(5), 'hex'));
BEGIN
  SELECT school_id INTO s FROM public.students WHERE id = p_student;
  IF s IS NULL OR NOT public.scholar_can(s, 'students.manage') AND NOT public.scholar_can(s, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.siwes_placements (school_id, student_id, employer, supervisor_name, supervisor_phone, starts_on, ends_on, verify_code_hash, created_by)
  VALUES (s, p_student, p_employer, p_supervisor, p_phone, p_from, p_to, extensions.crypt(code, extensions.gen_salt('bf', 8)), auth.uid()) RETURNING id INTO v;
  RETURN jsonb_build_object('placement_id', v, 'supervisor_code', code);   -- shown once, handed to the industry supervisor
END $$;
CREATE OR REPLACE FUNCTION public.siwes_log(p_placement uuid, p_week int, p_entry text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pl public.siwes_placements; v uuid;
BEGIN
  SELECT p.* INTO pl FROM public.siwes_placements p JOIN public.students s ON s.id = p.student_id WHERE p.id = p_placement AND s.user_id = auth.uid();
  IF pl.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF pl.status <> 'active' THEN RAISE EXCEPTION 'placement is %', pl.status; END IF;
  IF p_week > ((pl.ends_on - pl.starts_on) / 7) + 1 THEN RAISE EXCEPTION 'week % is outside the placement', p_week; END IF;
  INSERT INTO public.siwes_logbook (placement_id, school_id, week, entry) VALUES (p_placement, pl.school_id, p_week, p_entry)
  ON CONFLICT (placement_id, week) DO UPDATE SET entry = EXCLUDED.entry, student_signed_at = now() WHERE public.siwes_logbook.verified_at IS NULL RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'week % is already verified and locked', p_week; END IF;
  RETURN v;
END $$;
-- Public: the industry supervisor verifies with the placement code. Rate limited; failures return JSON so attempts count.
CREATE OR REPLACE FUNCTION public.siwes_supervisor_verify(p_placement uuid, p_code text, p_week int, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pl public.siwes_placements; n int;
BEGIN
  IF NOT public.rate_limit_take('siwes.verify', p_placement::text, 10, interval '1 hour') THEN RETURN jsonb_build_object('ok', false, 'error', 'rate_limited'); END IF;
  SELECT * INTO pl FROM public.siwes_placements WHERE id = p_placement;
  IF pl.id IS NULL OR pl.verify_code_hash IS NULL OR extensions.crypt(upper(coalesce(p_code, '')), pl.verify_code_hash) <> pl.verify_code_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code'); END IF;
  UPDATE public.siwes_logbook SET verified_at = now(), verifier_note = left(p_note, 500) WHERE placement_id = p_placement AND week = p_week AND verified_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n = 1, 'error', CASE WHEN n = 0 THEN 'no_unverified_entry' END);
END $$;

-- ===== Learning-gap early warning =====
CREATE TABLE IF NOT EXISTS public.learning_gap_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('low_attendance','low_average','sharp_drop','failing_core')), period text NOT NULL, severity text NOT NULL CHECK (severity IN ('watch','act')),
  detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid, action_note text,
  UNIQUE (student_id, kind, period));
CREATE OR REPLACE FUNCTION public.compute_early_warnings(p_school uuid, p_year text, p_term text, p_prev_term text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE per text := p_year || ' ' || p_term; n_att int; n_avg int; n_drop int; n_core int;
BEGIN
  IF NOT (public.scholar_can(p_school, 'reports.academic') OR coalesce(auth.role(), '') = 'service_role') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  WITH a AS (SELECT student_id, count(*) FILTER (WHERE status IN ('present','late'))::numeric / nullif(count(*), 0) r, count(*) n
               FROM public.attendance WHERE school_id = p_school AND date >= current_date - 30 GROUP BY student_id HAVING count(*) >= 5)
  INSERT INTO public.learning_gap_flags (school_id, student_id, kind, period, severity, detail)
  SELECT p_school, student_id, 'low_attendance', per, CASE WHEN r < 0.6 THEN 'act' ELSE 'watch' END, jsonb_build_object('rate', round(r * 100), 'days', n) FROM a WHERE r < 0.8
  ON CONFLICT (student_id, kind, period) DO UPDATE SET detail = EXCLUDED.detail, severity = EXCLUDED.severity;
  GET DIAGNOSTICS n_att = ROW_COUNT;
  WITH g AS (SELECT student_id, avg(total_score) av FROM public.grades WHERE school_id = p_school AND academic_year = p_year AND term = p_term GROUP BY student_id)
  INSERT INTO public.learning_gap_flags (school_id, student_id, kind, period, severity, detail)
  SELECT p_school, student_id, 'low_average', per, CASE WHEN av < 35 THEN 'act' ELSE 'watch' END, jsonb_build_object('average', round(av, 1)) FROM g WHERE av < 45
  ON CONFLICT (student_id, kind, period) DO UPDATE SET detail = EXCLUDED.detail, severity = EXCLUDED.severity;
  GET DIAGNOSTICS n_avg = ROW_COUNT;
  n_drop := 0;
  IF p_prev_term IS NOT NULL THEN
    WITH cur AS (SELECT student_id, avg(total_score) av FROM public.grades WHERE school_id = p_school AND academic_year = p_year AND term = p_term GROUP BY 1),
         prev AS (SELECT student_id, avg(total_score) av FROM public.grades WHERE school_id = p_school AND term = p_prev_term GROUP BY 1)
    INSERT INTO public.learning_gap_flags (school_id, student_id, kind, period, severity, detail)
    SELECT p_school, cur.student_id, 'sharp_drop', per, CASE WHEN prev.av - cur.av >= 25 THEN 'act' ELSE 'watch' END,
           jsonb_build_object('from', round(prev.av, 1), 'to', round(cur.av, 1)) FROM cur JOIN prev USING (student_id) WHERE prev.av - cur.av >= 15
    ON CONFLICT (student_id, kind, period) DO UPDATE SET detail = EXCLUDED.detail, severity = EXCLUDED.severity;
    GET DIAGNOSTICS n_drop = ROW_COUNT;
  END IF;
  WITH f AS (SELECT student_id, string_agg(subject, ', ') subs FROM public.grades WHERE school_id = p_school AND academic_year = p_year AND term = p_term
               AND subject IN ('English Language','English Studies','Mathematics','General Mathematics') AND total_score < 40 GROUP BY 1)
  INSERT INTO public.learning_gap_flags (school_id, student_id, kind, period, severity, detail)
  SELECT p_school, student_id, 'failing_core', per, 'act', jsonb_build_object('subjects', subs) FROM f
  ON CONFLICT (student_id, kind, period) DO UPDATE SET detail = EXCLUDED.detail;
  GET DIAGNOSTICS n_core = ROW_COUNT;
  RETURN jsonb_build_object('low_attendance', n_att, 'low_average', n_avg, 'sharp_drop', n_drop, 'failing_core', n_core);
END $$;
CREATE OR REPLACE FUNCTION public.early_warning_resolve(p_flag uuid, p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.learning_gap_flags;
BEGIN
  SELECT * INTO f FROM public.learning_gap_flags WHERE id = p_flag;
  IF f.id IS NULL OR NOT (public.scholar_can(f.school_id, 'reports.academic') OR public.scholar_can(f.school_id, 'welfare.pastoral')
     OR EXISTS (SELECT 1 FROM public.students s JOIN public.classes c ON c.id = s.class_id WHERE s.id = f.student_id AND c.teacher_id = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(p_note), 0) < 10 THEN RAISE EXCEPTION 'record what was done (10+ characters)'; END IF;
  UPDATE public.learning_gap_flags SET resolved_at = now(), resolved_by = auth.uid(), action_note = p_note WHERE id = p_flag;
END $$;

-- ===== RLS / grants / audit =====
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['course_prerequisites','registration_windows','course_registrations','siwes_placements','siwes_logbook','learning_gap_flags'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
-- the supervisor code hash is never readable: column-level grant only
REVOKE SELECT ON public.siwes_placements FROM authenticated, service_role;
GRANT SELECT (id, school_id, student_id, employer, address, supervisor_name, supervisor_phone, starts_on, ends_on, status, created_by, created_at) ON public.siwes_placements TO authenticated, service_role;
CREATE POLICY course_prerequisites_read ON public.course_prerequisites FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY registration_windows_read ON public.registration_windows FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY course_registrations_read ON public.course_registrations FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (public.scholar_can(school_id, 'course_reg.approve') OR public.get_my_role() IN ('admin','principal')
       OR student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid() OR parent_id = auth.uid())));
CREATE POLICY siwes_placements_read ON public.siwes_placements FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (public.get_my_role() IN ('admin','principal','teacher') OR student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid() OR parent_id = auth.uid())));
CREATE POLICY siwes_logbook_read ON public.siwes_logbook FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (public.get_my_role() IN ('admin','principal','teacher') OR placement_id IN (SELECT p.id FROM public.siwes_placements p JOIN public.students s ON s.id = p.student_id WHERE s.user_id = auth.uid() OR s.parent_id = auth.uid())));
CREATE POLICY learning_gap_flags_read ON public.learning_gap_flags FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (public.scholar_can(school_id, 'reports.academic') OR public.get_my_role() = 'teacher' AND student_id IN (SELECT s.id FROM public.students s JOIN public.classes c ON c.id = s.class_id WHERE c.teacher_id = auth.uid())
       OR student_id IN (SELECT id FROM public.students WHERE parent_id = auth.uid())));
REVOKE ALL ON FUNCTION public.registration_window_set(uuid, text, text, timestamptz, timestamptz, int, int), public.course_prereq_set(uuid, uuid, numeric),
  public.course_register(uuid, text, text), public.course_drop(uuid), public.course_reg_decide(uuid, boolean, text), public.siwes_place(uuid, text, text, text, date, date),
  public.siwes_log(uuid, int, text), public.siwes_supervisor_verify(uuid, text, int, text), public.compute_early_warnings(uuid, text, text, text), public.early_warning_resolve(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registration_window_set(uuid, text, text, timestamptz, timestamptz, int, int), public.course_prereq_set(uuid, uuid, numeric),
  public.course_register(uuid, text, text), public.course_drop(uuid), public.course_reg_decide(uuid, boolean, text), public.siwes_place(uuid, text, text, text, date, date),
  public.siwes_log(uuid, int, text), public.compute_early_warnings(uuid, text, text, text), public.early_warning_resolve(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_early_warnings(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.siwes_supervisor_verify(uuid, text, int, text) TO anon, authenticated;
COMMIT;
