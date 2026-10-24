-- SHERIVS-022 (Wave 4): exams (sessions, papers, seating, invigilation without double-booking, malpractice SoD),
-- CBT (hidden keys, start/sync/submit, offline grace), attendance devices (QR + geofence, biometric with consent), offline sync queue.
BEGIN;
-- ===== Exams =====
CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, academic_year text NOT NULL, term text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')), created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on));
CREATE TABLE IF NOT EXISTS public.exam_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE, subject text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, venue text, max_score numeric NOT NULL DEFAULT 100,
  CHECK (ends_at > starts_at), UNIQUE (session_id, class_id, subject));
CREATE TABLE IF NOT EXISTS public.exam_seating (
  paper_id uuid NOT NULL REFERENCES public.exam_papers(id) ON DELETE CASCADE, school_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE, seat_no int NOT NULL,
  PRIMARY KEY (paper_id, student_id), UNIQUE (paper_id, seat_no));
CREATE TABLE IF NOT EXISTS public.exam_invigilators (
  paper_id uuid NOT NULL REFERENCES public.exam_papers(id) ON DELETE CASCADE, school_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'invigilator' CHECK (role IN ('chief','invigilator')),
  assigned_by uuid, PRIMARY KEY (paper_id, user_id));
CREATE TABLE IF NOT EXISTS public.malpractice_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, paper_id uuid NOT NULL REFERENCES public.exam_papers(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE, reported_by uuid NOT NULL, description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','upheld')), sanction text, decided_by uuid, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (decided_by IS NULL OR decided_by <> reported_by));

CREATE OR REPLACE FUNCTION public._paper_school(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT school_id FROM public.exam_papers WHERE id = p $$;

CREATE OR REPLACE FUNCTION public.exam_session_create(p_school uuid, p_name text, p_year text, p_term text, p_from date, p_to date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'exams.schedule') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.exam_sessions (school_id, name, academic_year, term, starts_on, ends_on, created_by) VALUES (p_school, p_name, p_year, p_term, p_from, p_to, auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.exam_paper_add(p_session uuid, p_class uuid, p_subject text, p_start timestamptz, p_end timestamptz, p_venue text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.exam_sessions; v uuid;
BEGIN
  SELECT * INTO s FROM public.exam_sessions WHERE id = p_session;
  IF s.id IS NULL OR NOT public.scholar_can(s.school_id, 'exams.schedule') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class AND school_id = s.school_id) THEN RAISE EXCEPTION 'class not in this school'; END IF;
  IF p_start::date < s.starts_on OR p_end::date > s.ends_on THEN RAISE EXCEPTION 'paper must fall inside the exam session dates'; END IF;
  -- a class cannot sit two papers at once
  IF EXISTS (SELECT 1 FROM public.exam_papers WHERE class_id = p_class AND tstzrange(starts_at, ends_at) && tstzrange(p_start, p_end)) THEN
    RAISE EXCEPTION 'clash: this class already has a paper at that time'; END IF;
  INSERT INTO public.exam_papers (session_id, school_id, class_id, subject, starts_at, ends_at, venue) VALUES (p_session, s.school_id, p_class, p_subject, p_start, p_end, p_venue) RETURNING id INTO v;
  RETURN v;
END $$;
-- Seating: interleave by class arm order with a seeded shuffle so neighbours differ; idempotent
CREATE OR REPLACE FUNCTION public.exam_generate_seating(p_paper uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.exam_papers; n int;
BEGIN
  SELECT * INTO p FROM public.exam_papers WHERE id = p_paper;
  IF p.id IS NULL OR NOT public.scholar_can(p.school_id, 'exams.schedule') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.exam_seating WHERE paper_id = p_paper;
  INSERT INTO public.exam_seating (paper_id, school_id, student_id, seat_no)
  SELECT p_paper, p.school_id, s.id, row_number() OVER (ORDER BY md5(s.id::text || p_paper::text))
    FROM public.students s WHERE s.class_id = p.class_id;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.exam_assign_invigilator(p_paper uuid, p_user uuid, p_role text DEFAULT 'invigilator') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.exam_papers;
BEGIN
  SELECT * INTO p FROM public.exam_papers WHERE id = p_paper;
  IF p.id IS NULL OR NOT public.scholar_can(p.school_id, 'exams.schedule') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND school_id = p.school_id AND role IN ('teacher','admin','principal')) THEN RAISE EXCEPTION 'invigilator must be staff of this school'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('invig:' || p_user::text));
  IF EXISTS (SELECT 1 FROM public.exam_invigilators i JOIN public.exam_papers o ON o.id = i.paper_id
              WHERE i.user_id = p_user AND o.id <> p_paper AND tstzrange(o.starts_at, o.ends_at) && tstzrange(p.starts_at, p.ends_at)) THEN
    RAISE EXCEPTION 'double_booked: this invigilator already covers another paper at that time'; END IF;
  INSERT INTO public.exam_invigilators (paper_id, school_id, user_id, role, assigned_by) VALUES (p_paper, p.school_id, p_user, p_role, auth.uid())
  ON CONFLICT (paper_id, user_id) DO UPDATE SET role = EXCLUDED.role;
END $$;
CREATE OR REPLACE FUNCTION public.malpractice_report(p_paper uuid, p_student uuid, p_description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public._paper_school(p_paper); v uuid;
BEGIN
  IF s IS NULL OR NOT (EXISTS (SELECT 1 FROM public.exam_invigilators WHERE paper_id = p_paper AND user_id = auth.uid()) OR public.scholar_can(s, 'exams.schedule')) THEN
    RAISE EXCEPTION 'not allowed: only this paper''s invigilators can report' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_seating WHERE paper_id = p_paper AND student_id = p_student) THEN RAISE EXCEPTION 'student is not seated for this paper'; END IF;
  INSERT INTO public.malpractice_cases (school_id, paper_id, student_id, reported_by, description) VALUES (s, p_paper, p_student, auth.uid(), p_description) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.malpractice_decide(p_case uuid, p_outcome text, p_sanction text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.malpractice_cases;
BEGIN
  SELECT * INTO c FROM public.malpractice_cases WHERE id = p_case FOR UPDATE;
  IF c.id IS NULL OR NOT public.scholar_can(c.school_id, 'malpractice.decide') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF c.reported_by = auth.uid() THEN RAISE EXCEPTION 'sod: the reporting invigilator cannot decide the case' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'case already decided'; END IF;
  IF p_outcome NOT IN ('dismissed','upheld') THEN RAISE EXCEPTION 'outcome must be dismissed or upheld'; END IF;
  UPDATE public.malpractice_cases SET status = p_outcome, sanction = p_sanction, decided_by = auth.uid(), decided_at = now() WHERE id = p_case;
END $$;

-- ===== CBT =====
CREATE TABLE IF NOT EXISTS public.cbt_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject text NOT NULL, stem text NOT NULL, options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  answer_key int NOT NULL, marks numeric NOT NULL DEFAULT 1, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.cbt_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title text NOT NULL, class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE, paper_id uuid REFERENCES public.exam_papers(id) ON DELETE SET NULL,
  duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600), opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL,
  question_ids uuid[] NOT NULL, grace_minutes int NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120), created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.cbt_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_id uuid NOT NULL REFERENCES public.cbt_tests(id) ON DELETE CASCADE, school_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE, started_at timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb, client_seq int NOT NULL DEFAULT 0, submitted_at timestamptz, score numeric, max_score numeric,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','late_rejected')), UNIQUE (test_id, student_id));

CREATE OR REPLACE FUNCTION public.cbt_question_add(p_school uuid, p_subject text, p_stem text, p_options jsonb, p_key int, p_marks numeric DEFAULT 1) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'cbt.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_key < 0 OR p_key >= jsonb_array_length(p_options) THEN RAISE EXCEPTION 'answer key must point at one of the options'; END IF;
  INSERT INTO public.cbt_questions (school_id, subject, stem, options, answer_key, marks, created_by) VALUES (p_school, p_subject, p_stem, p_options, p_key, p_marks, auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.cbt_test_create(p_school uuid, p_title text, p_class uuid, p_minutes int, p_opens timestamptz, p_closes timestamptz, p_questions uuid[], p_grace int DEFAULT 10) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'cbt.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.cbt_questions WHERE id = ANY (p_questions) AND school_id = p_school) <> cardinality(p_questions) THEN RAISE EXCEPTION 'questions must belong to this school'; END IF;
  INSERT INTO public.cbt_tests (school_id, title, class_id, duration_minutes, opens_at, closes_at, question_ids, grace_minutes, created_by)
  VALUES (p_school, p_title, p_class, p_minutes, p_opens, p_closes, p_questions, p_grace, auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;
-- Student starts: returns questions WITHOUT keys, in a per-student order. Re-start returns the same attempt.
CREATE OR REPLACE FUNCTION public.cbt_start(p_test uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.cbt_tests; st public.students; a public.cbt_attempts;
BEGIN
  SELECT * INTO t FROM public.cbt_tests WHERE id = p_test;
  SELECT * INTO st FROM public.students WHERE user_id = auth.uid() AND class_id = t.class_id LIMIT 1;
  IF t.id IS NULL OR st.id IS NULL THEN RAISE EXCEPTION 'not allowed: this test is not for you' USING ERRCODE = '42501'; END IF;
  IF now() < t.opens_at OR now() > t.closes_at THEN RAISE EXCEPTION 'test window is closed'; END IF;
  INSERT INTO public.cbt_attempts (test_id, school_id, student_id, deadline)
  VALUES (p_test, t.school_id, st.id, least(now() + make_interval(mins => t.duration_minutes), t.closes_at))
  ON CONFLICT (test_id, student_id) DO NOTHING;
  SELECT * INTO a FROM public.cbt_attempts WHERE test_id = p_test AND student_id = st.id;
  RETURN jsonb_build_object('attempt_id', a.id, 'deadline', a.deadline, 'grace_minutes', t.grace_minutes, 'status', a.status, 'answers', a.answers, 'client_seq', a.client_seq,
    'questions', (SELECT jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'marks', q.marks) ORDER BY md5(q.id::text || st.id::text))
                    FROM public.cbt_questions q WHERE q.id = ANY (t.question_ids)));
END $$;
-- Offline-friendly sync: monotonic client sequence; late syncs inside the grace window accepted only if the answer was captured before the deadline.
CREATE OR REPLACE FUNCTION public._cbt_attempt_mine(p_attempt uuid) RETURNS public.cbt_attempts LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.* FROM public.cbt_attempts a JOIN public.students s ON s.id = a.student_id WHERE a.id = p_attempt AND s.user_id = auth.uid() $$;
CREATE OR REPLACE FUNCTION public.cbt_sync(p_attempt uuid, p_answers jsonb, p_seq int, p_captured_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cbt_attempts; g int;
BEGIN
  a := public._cbt_attempt_mine(p_attempt);
  IF a.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT grace_minutes INTO g FROM public.cbt_tests WHERE id = a.test_id;
  IF a.status <> 'in_progress' THEN RETURN jsonb_build_object('ok', false, 'error', 'already_submitted'); END IF;
  IF p_seq <= a.client_seq THEN RETURN jsonb_build_object('ok', true, 'stale', true, 'client_seq', a.client_seq); END IF;
  IF p_captured_at > a.deadline OR now() > a.deadline + make_interval(mins => g) THEN RETURN jsonb_build_object('ok', false, 'error', 'past_deadline'); END IF;
  UPDATE public.cbt_attempts SET answers = answers || coalesce(p_answers, '{}'::jsonb), client_seq = p_seq WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'client_seq', p_seq);
END $$;
CREATE OR REPLACE FUNCTION public.cbt_submit(p_attempt uuid, p_answers jsonb, p_seq int, p_captured_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cbt_attempts; t public.cbt_tests; sc numeric; mx numeric; late boolean;
BEGIN
  a := public._cbt_attempt_mine(p_attempt);
  IF a.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.status <> 'in_progress' THEN RETURN jsonb_build_object('ok', true, 'replay', true, 'score', a.score, 'max', a.max_score, 'status', a.status); END IF;
  SELECT * INTO t FROM public.cbt_tests WHERE id = a.test_id;
  late := p_captured_at > a.deadline OR now() > a.deadline + make_interval(mins => t.grace_minutes);
  IF NOT late AND p_seq > a.client_seq THEN a.answers := a.answers || coalesce(p_answers, '{}'::jsonb); END IF;
  SELECT coalesce(sum(q.marks) FILTER (WHERE (a.answers->>q.id::text)::int = q.answer_key), 0), sum(q.marks) INTO sc, mx
    FROM public.cbt_questions q WHERE q.id = ANY (t.question_ids);
  UPDATE public.cbt_attempts SET answers = a.answers, client_seq = greatest(client_seq, p_seq), submitted_at = now(), score = sc, max_score = mx,
    status = CASE WHEN late AND now() > a.deadline + make_interval(mins => t.grace_minutes) AND a.answers = '{}'::jsonb THEN 'late_rejected' ELSE 'submitted' END
   WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'score', sc, 'max', mx, 'late_answers_ignored', late);
END $$;

-- ===== Attendance devices: QR + geofence, biometric with consent =====
ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_purpose_check;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_purpose_check
  CHECK (purpose IN ('core_education','photos_media','ai_processing','messaging_sms_whatsapp','biometric_attendance','location_attendance'));
CREATE TABLE IF NOT EXISTS public.staff_biometric_consents (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE, school_id uuid NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz, policy_version text NOT NULL DEFAULT 'v1');
CREATE TABLE IF NOT EXISTS public.attendance_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('qr_kiosk','biometric','rfid','gps_app')), label text NOT NULL, key_hash text, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.attendance_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, user_id uuid NOT NULL, method text NOT NULL CHECK (method IN ('qr','biometric','rfid','manual')),
  at timestamptz NOT NULL DEFAULT now(), latitude numeric, longitude numeric, distance_m numeric, device_id uuid REFERENCES public.attendance_devices(id) ON DELETE SET NULL,
  accepted boolean NOT NULL, reason text);
CREATE INDEX IF NOT EXISTS attendance_check_ins_user_day ON public.attendance_check_ins (user_id, at DESC);

CREATE OR REPLACE FUNCTION public.geo_distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (2 * 6371000 * asin(sqrt(power(sin(radians((lat2 - lat1) / 2)), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2))))::numeric $$;
CREATE OR REPLACE FUNCTION public.qr_attendance_token(p_school uuid, p_minutes int DEFAULT 2) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tok text := encode(extensions.gen_random_bytes(18), 'hex');
BEGIN
  IF NOT public.scholar_can(p_school, 'hr.staff_manage') AND NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.qr_tokens (school_id, token, type, expires_at, used, created_by, payload) VALUES (p_school, tok, 'sign_in', now() + make_interval(mins => least(greatest(p_minutes, 1), 10)), false, auth.uid(), '{"purpose":"staff_attendance"}'::jsonb);
  RETURN tok;
END $$;
-- Staff self check-in: rotating QR + inside the geofence. Every attempt logged; failures RETURN (not raise) so the log is kept.
CREATE OR REPLACE FUNCTION public.staff_qr_checkin(p_token text, p_lat numeric, p_lng numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.qr_tokens; my uuid := public.get_my_school_id(); d numeric; g record; why text;
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() NOT IN ('teacher','admin','principal','bursar') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO q FROM public.qr_tokens WHERE token = p_token AND type = 'sign_in' AND payload->>'purpose' = 'staff_attendance' AND school_id = my;
  SELECT latitude, longitude, radius_meters INTO g FROM public.school_geofence WHERE school_id = my AND is_active
   ORDER BY public.geo_distance_m(latitude, longitude, p_lat, p_lng) LIMIT 1;
  IF g.latitude IS NOT NULL THEN d := round(public.geo_distance_m(g.latitude, g.longitude, p_lat, p_lng)); END IF;
  why := CASE WHEN q.id IS NULL THEN 'invalid_code' WHEN q.expires_at < now() THEN 'expired_code'
              WHEN g.latitude IS NULL THEN 'no_geofence_set' WHEN d > g.radius_meters THEN 'outside_geofence' END;
  -- location is duty data for staff (covered by the employment notice); students never use this path
  INSERT INTO public.attendance_check_ins (school_id, user_id, method, latitude, longitude, distance_m, accepted, reason)
  VALUES (my, auth.uid(), 'qr', round(p_lat, 5), round(p_lng, 5), d, why IS NULL, why);
  RETURN jsonb_build_object('ok', why IS NULL, 'error', why, 'distance_m', d);
END $$;
CREATE OR REPLACE FUNCTION public.staff_biometric_consent(p_grant boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_grant THEN
    INSERT INTO public.staff_biometric_consents (user_id, school_id) VALUES (auth.uid(), public.get_my_school_id())
    ON CONFLICT (user_id) DO UPDATE SET granted_at = now(), withdrawn_at = NULL;
  ELSE
    UPDATE public.staff_biometric_consents SET withdrawn_at = now() WHERE user_id = auth.uid();
    UPDATE public.teacher_biometrics SET face_template_hash = NULL, enrollment_status = 'withdrawn' WHERE user_id = auth.uid();
  END IF;
END $$;
-- Device posts a biometric match (service role, behind the device gateway). Refused without live consent.
CREATE OR REPLACE FUNCTION public.biometric_checkin(p_device uuid, p_user uuid, p_match numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE dv public.attendance_devices; why text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: device gateway only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO dv FROM public.attendance_devices WHERE id = p_device AND is_active AND kind = 'biometric';
  IF dv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_device'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND school_id = dv.school_id) THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_user'); END IF;
  why := CASE WHEN NOT EXISTS (SELECT 1 FROM public.staff_biometric_consents WHERE user_id = p_user AND withdrawn_at IS NULL) THEN 'no_biometric_consent'
              WHEN p_match < 0.8 THEN 'low_match' END;
  INSERT INTO public.attendance_check_ins (school_id, user_id, method, device_id, accepted, reason) VALUES (dv.school_id, p_user, 'biometric', dv.id, why IS NULL, why);
  RETURN jsonb_build_object('ok', why IS NULL, 'error', why);
END $$;

-- ===== Offline PWA sync queue (attendance) =====
CREATE TABLE IF NOT EXISTS public.offline_sync_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, user_id uuid NOT NULL, client_batch_id text NOT NULL,
  kind text NOT NULL DEFAULT 'attendance', received_at timestamptz NOT NULL DEFAULT now(), items int NOT NULL, applied int NOT NULL, conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (user_id, client_batch_id));
CREATE OR REPLACE FUNCTION public.offline_attendance_sync(p_batch text, p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b public.offline_sync_batches; my uuid := public.get_my_school_id(); it jsonb; applied int := 0; conf jsonb := '[]'::jsonb; ex public.attendance; d date; cls uuid; can_past boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.scholar_can(my, 'attendance.take') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'items must be an array of at most 500'; END IF;
  SELECT * INTO b FROM public.offline_sync_batches WHERE user_id = auth.uid() AND client_batch_id = p_batch;
  IF b.id IS NOT NULL THEN RETURN jsonb_build_object('replay', true, 'applied', b.applied, 'conflicts', b.conflicts); END IF;
  can_past := public.scholar_can(my, 'attendance.edit_past');
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    d := (it->>'date')::date; cls := (SELECT class_id FROM public.students WHERE id = (it->>'student_id')::uuid AND school_id = my);
    IF cls IS NULL THEN conf := conf || jsonb_build_object('student_id', it->>'student_id', 'why', 'unknown_student'); CONTINUE; END IF;
    IF public.get_my_role() = 'teacher' AND NOT EXISTS (SELECT 1 FROM public.classes WHERE id = cls AND teacher_id = auth.uid())
       AND NOT EXISTS (SELECT 1 FROM public.timetable_slots ts JOIN public.timetables tt ON tt.id = ts.timetable_id WHERE tt.class_id = cls AND ts.teacher_id = auth.uid()) THEN
      conf := conf || jsonb_build_object('student_id', it->>'student_id', 'why', 'not_your_class'); CONTINUE; END IF;
    IF d > current_date OR (d < current_date - 7 AND NOT can_past) THEN conf := conf || jsonb_build_object('student_id', it->>'student_id', 'why', 'date_out_of_range'); CONTINUE; END IF;
    IF it->>'status' NOT IN ('present','absent','late','excused') THEN conf := conf || jsonb_build_object('student_id', it->>'student_id', 'why', 'bad_status'); CONTINUE; END IF;
    SELECT * INTO ex FROM public.attendance WHERE student_id = (it->>'student_id')::uuid AND date = d;
    IF ex.id IS NULL THEN
      INSERT INTO public.attendance (school_id, student_id, class_id, date, status, marked_by, note) VALUES (my, (it->>'student_id')::uuid, cls, d, it->>'status', auth.uid(), 'offline:' || p_batch);
      applied := applied + 1;
    ELSIF ex.status = it->>'status' THEN applied := applied + 1;
    ELSIF ex.marked_by = auth.uid() THEN UPDATE public.attendance SET status = it->>'status', note = 'offline:' || p_batch WHERE id = ex.id; applied := applied + 1;
    ELSE conf := conf || jsonb_build_object('student_id', it->>'student_id', 'why', 'server_has_other_mark', 'server', ex.status, 'yours', it->>'status');
    END IF;
  END LOOP;
  INSERT INTO public.offline_sync_batches (school_id, user_id, client_batch_id, items, applied, conflicts) VALUES (my, auth.uid(), p_batch, jsonb_array_length(p_items), applied, conf);
  RETURN jsonb_build_object('applied', applied, 'conflicts', conf);
END $$;

-- ===== RLS / grants / audit =====
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['exam_sessions','exam_papers','exam_seating','exam_invigilators','malpractice_cases','cbt_questions','cbt_tests','cbt_attempts',
    'staff_biometric_consents','attendance_devices','attendance_check_ins','offline_sync_batches'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t); EXECUTE format('DROP POLICY IF EXISTS %1$s_none ON public.%1$I', t);
    IF t <> 'cbt_questions' THEN EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t); END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
-- answer keys are never readable through the API; staff read questions through a key-less view
CREATE OR REPLACE FUNCTION public.cbt_question_list(p_school uuid, p_subject text DEFAULT NULL) RETURNS TABLE (id uuid, subject text, stem text, options jsonb, marks numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.scholar_can(p_school, 'cbt.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT q.id, q.subject, q.stem, q.options, q.marks FROM public.cbt_questions q WHERE q.school_id = p_school AND (p_subject IS NULL OR q.subject = p_subject) ORDER BY q.created_at;
END $$;
REVOKE ALL ON FUNCTION public.cbt_question_list(uuid, text) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.cbt_question_list(uuid, text) TO authenticated;
CREATE POLICY exam_sessions_read ON public.exam_sessions FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY exam_papers_read ON public.exam_papers FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY exam_seating_read ON public.exam_seating FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (public.get_my_role() IN ('admin','principal','teacher') OR student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid() OR parent_id = auth.uid())));
CREATE POLICY exam_invigilators_read ON public.exam_invigilators FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() AND public.get_my_role() IN ('admin','principal','teacher'));
CREATE POLICY malpractice_cases_read ON public.malpractice_cases FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (reported_by = auth.uid() OR public.scholar_can(school_id, 'malpractice.decide') OR public.scholar_can(school_id, 'exams.schedule')));
CREATE POLICY cbt_questions_none ON public.cbt_questions FOR SELECT TO authenticated USING (false);
CREATE POLICY cbt_tests_read ON public.cbt_tests FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY cbt_attempts_read ON public.cbt_attempts FOR SELECT TO authenticated USING (school_id = public.get_my_school_id()
  AND (public.scholar_can(school_id, 'cbt.manage') OR student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid() OR parent_id = auth.uid())));
CREATE POLICY staff_biometric_consents_read ON public.staff_biometric_consents FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.scholar_can(school_id, 'hr.staff_manage'));
CREATE POLICY attendance_devices_read ON public.attendance_devices FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'settings.manage'));
CREATE POLICY attendance_check_ins_read ON public.attendance_check_ins FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.scholar_can(school_id, 'hr.staff_view'));
CREATE POLICY offline_sync_batches_read ON public.offline_sync_batches FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.can_administer_org(school_id));
DROP TRIGGER IF EXISTS trg_check_ins_append_only ON public.attendance_check_ins;
CREATE TRIGGER trg_check_ins_append_only BEFORE UPDATE OR DELETE ON public.attendance_check_ins FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
DROP TRIGGER IF EXISTS trg_malpractice_no_delete ON public.malpractice_cases;
CREATE TRIGGER trg_malpractice_no_delete BEFORE DELETE ON public.malpractice_cases FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

REVOKE ALL ON FUNCTION public._paper_school(uuid), public._cbt_attempt_mine(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.exam_session_create(uuid, text, text, text, date, date), public.exam_paper_add(uuid, uuid, text, timestamptz, timestamptz, text),
  public.exam_generate_seating(uuid), public.exam_assign_invigilator(uuid, uuid, text), public.malpractice_report(uuid, uuid, text), public.malpractice_decide(uuid, text, text),
  public.cbt_question_add(uuid, text, text, jsonb, int, numeric), public.cbt_test_create(uuid, text, uuid, int, timestamptz, timestamptz, uuid[], int), public.cbt_start(uuid),
  public.cbt_sync(uuid, jsonb, int, timestamptz), public.cbt_submit(uuid, jsonb, int, timestamptz), public.qr_attendance_token(uuid, int), public.staff_qr_checkin(text, numeric, numeric),
  public.staff_biometric_consent(boolean), public.biometric_checkin(uuid, uuid, numeric), public.offline_attendance_sync(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_session_create(uuid, text, text, text, date, date), public.exam_paper_add(uuid, uuid, text, timestamptz, timestamptz, text),
  public.exam_generate_seating(uuid), public.exam_assign_invigilator(uuid, uuid, text), public.malpractice_report(uuid, uuid, text), public.malpractice_decide(uuid, text, text),
  public.cbt_question_add(uuid, text, text, jsonb, int, numeric), public.cbt_test_create(uuid, text, uuid, int, timestamptz, timestamptz, uuid[], int), public.cbt_start(uuid),
  public.cbt_sync(uuid, jsonb, int, timestamptz), public.cbt_submit(uuid, jsonb, int, timestamptz), public.qr_attendance_token(uuid, int), public.staff_qr_checkin(text, numeric, numeric),
  public.staff_biometric_consent(boolean), public.offline_attendance_sync(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biometric_checkin(uuid, uuid, numeric) TO service_role;
COMMIT;
