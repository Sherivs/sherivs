-- Disposable proof for 20261117003200_sherivs_m7_academic_core.sql (ADR-149).
-- A small production-shaped fixture (the columns, policies and helpers the migration touches,
-- copied from the production catalogue on 2026-11-17 and from the M05, SHERIVS-024 and M06
-- migrations), then positive, negative and cross-organization cases, a second run, and the
-- rollback. It is a fixture, not a replay of production.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m7_test -v ON_ERROR_STOP=1 -f tests/sql/m7-academic-core.sql
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.uid', true), '')::uuid $$;

-- ---- fixture tables ---------------------------------------------------------------------------
CREATE TABLE public.schools (id uuid PRIMARY KEY, name text);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id),
  full_name text NOT NULL, role text NOT NULL, is_active boolean DEFAULT true);
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, school_id uuid, action text, table_name text, record_id uuid);
CREATE TABLE public.sim_perm (user_id uuid, perm text);
CREATE TABLE public.classes (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id),
  name text NOT NULL, grade_level text, teacher_id uuid REFERENCES public.users(id));
CREATE TABLE public.students (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id),
  user_id uuid REFERENCES public.users(id), admission_number text, class_id uuid REFERENCES public.classes(id),
  is_active boolean DEFAULT true);
CREATE TABLE public.timetables (id uuid PRIMARY KEY, school_id uuid NOT NULL, class_id uuid NOT NULL REFERENCES public.classes(id),
  academic_year text NOT NULL, term text NOT NULL, is_active boolean DEFAULT true);
CREATE TABLE public.timetable_slots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), timetable_id uuid NOT NULL REFERENCES public.timetables(id),
  school_id uuid NOT NULL, day_of_week text NOT NULL, period_number integer NOT NULL, start_time time NOT NULL,
  end_time time NOT NULL, subject text NOT NULL, teacher_id uuid, room text, is_break boolean DEFAULT false);
CREATE TABLE public.role_catalog (code text PRIMARY KEY, template_code text);
CREATE TABLE public.user_role_assignments (org_id uuid, user_id uuid, role_code text, status text, scope_type text,
  scope_ref text, started_at timestamptz DEFAULT now(), valid_until timestamptz);
CREATE TABLE public.grades (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL,
  class_id uuid, subject text NOT NULL, ca_score numeric, exam_score numeric,
  total_score numeric GENERATED ALWAYS AS (coalesce(ca_score, 0) + coalesce(exam_score, 0)) STORED,
  grade text, term text NOT NULL, academic_year text NOT NULL, teacher_id uuid, is_published boolean DEFAULT false,
  result_entered_by uuid, result_approved_by uuid, terminal_score_raw numeric);
CREATE TABLE public.m06_result_component_scores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
  grade_id uuid NOT NULL REFERENCES public.grades(id), component_code text NOT NULL, score numeric);
CREATE TABLE public.class_attendance_marks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id), class_id uuid NOT NULL, student_id uuid NOT NULL,
  shift_id uuid, attendance_date date NOT NULL, period_key text NOT NULL DEFAULT 'daily',
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  marked_by uuid NOT NULL, captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.lesson_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
  teacher_id uuid NOT NULL, class_id uuid, title text NOT NULL, subject text, topic text, description text,
  status text DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','needs_revision')),
  review_notes text, admin_viewed boolean DEFAULT false, updated_at timestamptz DEFAULT now());
CREATE TABLE public.scheme_of_work (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL);
CREATE TABLE public.lesson_note_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
  lesson_plan_id uuid NOT NULL REFERENCES public.lesson_plans(id) ON DELETE CASCADE, scheme_week_id uuid,
  submitted_by uuid NOT NULL, submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','returned')),
  reviewer uuid, reviewed_at timestamptz, comment text, CHECK (reviewer IS NULL OR reviewer <> submitted_by));
CREATE UNIQUE INDEX lesson_note_reviews_open ON public.lesson_note_reviews (lesson_plan_id) WHERE status = 'submitted';

-- ---- helpers (shapes as in production) --------------------------------------------------------
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.role FROM public.users u WHERE u.id = auth.uid() $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_school_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT public.get_my_role() IN ('admin', 'principal') $$;
CREATE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT p_org = public.get_my_school_id() AND EXISTS (SELECT 1 FROM public.sim_perm p WHERE p.user_id = auth.uid() AND p.perm = p_perm) $$;
CREATE FUNCTION public.scholar_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  INSERT INTO public.audit_logs (school_id, action, table_name, record_id)
  VALUES ((j->>'school_id')::uuid, 'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, (j->>'id')::uuid);
  RETURN NULL;
END $$;
CREATE FUNCTION public.append_only_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
-- Copied from 20261103100000_sherivs_m05_offline_attendance.sql.
CREATE FUNCTION public.m05_teacher_assigned_to_class(p_school uuid, p_class uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND p_school = public.get_my_school_id()
     AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = p_class AND c.school_id = p_school
       AND (c.teacher_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.timetables tt JOIN public.timetable_slots ts
                      ON ts.timetable_id = tt.id AND ts.school_id = tt.school_id
                     WHERE tt.school_id = p_school AND tt.class_id = c.id AND tt.is_active IS TRUE
                       AND ts.teacher_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.user_role_assignments a JOIN public.role_catalog r ON r.code = a.role_code
                     WHERE a.org_id = p_school AND a.user_id = auth.uid() AND a.status = 'active'
                       AND a.scope_type = 'class' AND a.scope_ref = c.id::text AND a.started_at <= now()
                       AND (a.valid_until IS NULL OR a.valid_until > now()) AND r.template_code = 'teacher')))
$$;
-- Copied from 20261024000310_sherivs_024_lessons_hr_payroll_stores_visitors.sql.
CREATE FUNCTION public.lesson_note_submit(p_plan uuid, p_scheme_week uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lp public.lesson_plans; v uuid;
BEGIN
  SELECT * INTO lp FROM public.lesson_plans WHERE id = p_plan AND teacher_id = auth.uid();
  IF lp.id IS NULL OR NOT public.scholar_can(lp.school_id, 'lesson_notes.submit') THEN RAISE EXCEPTION 'not allowed: you can only submit your own lesson notes' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.lesson_note_reviews (school_id, lesson_plan_id, scheme_week_id, submitted_by) VALUES (lp.school_id, p_plan, p_scheme_week, auth.uid()) RETURNING id INTO v;
  UPDATE public.lesson_plans SET status = 'submitted' WHERE id = p_plan;
  RETURN v;
END $$;
CREATE FUNCTION public.lesson_note_review(p_review uuid, p_approve boolean, p_comment text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.lesson_note_reviews;
BEGIN
  SELECT * INTO r FROM public.lesson_note_reviews WHERE id = p_review FOR UPDATE;
  IF r.id IS NULL OR NOT public.scholar_can(r.school_id, 'lesson_notes.approve') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.submitted_by = auth.uid() THEN RAISE EXCEPTION 'sod: you cannot review your own lesson note' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'already reviewed'; END IF;
  IF NOT p_approve AND coalesce(length(p_comment), 0) < 5 THEN RAISE EXCEPTION 'say what to fix when returning a note'; END IF;
  UPDATE public.lesson_note_reviews SET status = CASE WHEN p_approve THEN 'approved' ELSE 'returned' END, reviewer = auth.uid(), reviewed_at = now(), comment = p_comment WHERE id = r.id;
  UPDATE public.lesson_plans SET status = CASE WHEN p_approve THEN 'approved' ELSE 'draft' END, review_notes = p_comment, admin_viewed = true WHERE id = r.lesson_plan_id;
END $$;

-- ---- existing policies and grants (as on production, 2026-11-17) -------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['classes','students','timetables','timetable_slots','grades','m06_result_component_scores',
                           'class_attendance_marks','lesson_plans','lesson_note_reviews'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP; END $$;
GRANT INSERT, UPDATE, DELETE ON public.lesson_plans TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
CREATE POLICY tenant_all_classes ON public.classes USING (school_id = public.get_my_school_id());
CREATE POLICY students_read ON public.students FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY tenant_all_timetables ON public.timetables USING (school_id = public.get_my_school_id());
CREATE POLICY tenant_all_timetable_slots ON public.timetable_slots USING (school_id = public.get_my_school_id());
CREATE POLICY grades_admin_all ON public.grades TO authenticated
  USING (school_id = public.get_my_school_id() AND public.is_school_admin());
CREATE POLICY grades_teacher_read ON public.grades FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND public.get_my_role() = 'teacher');
CREATE POLICY m06_result_component_scores_read ON public.m06_result_component_scores FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'grades.view'));
CREATE POLICY class_attendance_marks_read_m05 ON public.class_attendance_marks FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND (
    (public.get_my_role() = 'teacher' AND public.m05_teacher_assigned_to_class(school_id, class_id))
    OR (public.get_my_role() <> 'teacher' AND public.scholar_can(school_id, 'attendance.view'))));
CREATE POLICY tenant_all_lesson_plans ON public.lesson_plans
  USING (school_id = public.get_my_school_id()) WITH CHECK (school_id = public.get_my_school_id());
CREATE POLICY lesson_note_reviews_read ON public.lesson_note_reviews FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND (submitted_by = auth.uid() OR public.scholar_can(school_id, 'lesson_notes.approve')));

-- ---- data: organization A (two teachers, one principal-HOD, an admin) and organization B --------
INSERT INTO public.schools VALUES ('11111111-1111-1111-1111-111111111111', 'A'), ('22222222-2222-2222-2222-222222222222', 'B');
INSERT INTO public.users (id, school_id, full_name, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin A', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'Form teacher C1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'Maths teacher C2', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f3', '11111111-1111-1111-1111-111111111111', 'Role-scoped teacher C2', 'teacher'),
  ('00000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'HOD A', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Teacher B', 'teacher'),
  ('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'Learner one', 'student');
INSERT INTO public.sim_perm VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'attendance.view'), ('00000000-0000-0000-0000-0000000000a1', 'attendance.take'),
  ('00000000-0000-0000-0000-0000000000a1', 'attendance.edit_past'), ('00000000-0000-0000-0000-0000000000a1', 'grades.view'),
  ('00000000-0000-0000-0000-0000000000f1', 'attendance.take'), ('00000000-0000-0000-0000-0000000000f1', 'attendance.view'),
  ('00000000-0000-0000-0000-0000000000f1', 'grades.view'), ('00000000-0000-0000-0000-0000000000f1', 'lesson_notes.submit'),
  ('00000000-0000-0000-0000-0000000000f2', 'attendance.take'), ('00000000-0000-0000-0000-0000000000f2', 'grades.view'),
  ('00000000-0000-0000-0000-0000000000f3', 'attendance.take'),
  ('00000000-0000-0000-0000-0000000000d1', 'lesson_notes.approve'), ('00000000-0000-0000-0000-0000000000d1', 'lesson_notes.submit'),
  ('00000000-0000-0000-0000-0000000000b1', 'attendance.take'), ('00000000-0000-0000-0000-0000000000b1', 'grades.view');
INSERT INTO public.classes VALUES
  ('c0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'JSS1 A', 'JSS1', '00000000-0000-0000-0000-0000000000f1'),
  ('c0000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'JSS1 B', 'JSS1', NULL),
  ('c0000000-0000-0000-0000-0000000000cb', '22222222-2222-2222-2222-222222222222', 'Class B', 'JSS1', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.students (id, school_id, user_id, admission_number, class_id) VALUES
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'A-001', 'c0000000-0000-0000-0000-0000000000c1'),
  ('50000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL, 'A-002', 'c0000000-0000-0000-0000-0000000000c2'),
  ('50000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', NULL, 'B-001', 'c0000000-0000-0000-0000-0000000000cb');
INSERT INTO public.timetables VALUES
  ('70000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c2', '2026/2027', 'First', true);
INSERT INTO public.timetable_slots (timetable_id, school_id, day_of_week, period_number, start_time, end_time, subject, teacher_id, is_break) VALUES
  ('70000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'monday', 1, '08:00', '08:40', 'Maths', '00000000-0000-0000-0000-0000000000f2', false),
  ('70000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'monday', 2, '08:40', '09:00', 'Break', NULL, true);
INSERT INTO public.role_catalog VALUES ('subject_teacher', 'teacher');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, status, scope_type, scope_ref) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f3', 'subject_teacher', 'active', 'class', 'c0000000-0000-0000-0000-0000000000c2');
INSERT INTO public.grades (id, school_id, student_id, class_id, subject, term, academic_year, teacher_id, result_entered_by, ca_score) VALUES
  ('90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000c1', 'Maths', 'First', '2026/2027', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 12),
  ('90000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-0000000000c2', 'Maths', 'First', '2026/2027', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 20);
INSERT INTO public.m06_result_component_scores (school_id, grade_id, component_code, score) VALUES
  ('11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000001', 'test1', 8),
  ('11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000002', 'test1', 9);
INSERT INTO public.class_attendance_marks (id, school_id, class_id, student_id, attendance_date, status, marked_by) VALUES
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1',
   '50000000-0000-0000-0000-000000000001', current_date - 2, 'present', '00000000-0000-0000-0000-0000000000f1'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1',
   '50000000-0000-0000-0000-000000000001', current_date - 20, 'present', '00000000-0000-0000-0000-0000000000f1'),
  ('a0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000cb',
   '50000000-0000-0000-0000-00000000000b', current_date - 1, 'present', '00000000-0000-0000-0000-0000000000b1');

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs a statement as a role for a caller; returns 'ok:<rows>' or 'err:<SQLSTATE>'.
CREATE FUNCTION pg_temp.try(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; result text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; result := 'ok:' || n;
  EXCEPTION WHEN others THEN result := 'err:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN result;
END $$;
-- Runs a scalar query as a role for a caller; returns its value as text or 'err:<SQLSTATE>'.
CREATE FUNCTION pg_temp.val(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN others THEN RESET ROLE; RETURN 'err:' || SQLSTATE; END;
  RESET ROLE;
  RETURN v;
END $$;

\set ADM '''00000000-0000-0000-0000-0000000000a1'''
\set T1 '''00000000-0000-0000-0000-0000000000f1'''
\set T2 '''00000000-0000-0000-0000-0000000000f2'''
\set T3 '''00000000-0000-0000-0000-0000000000f3'''
\set HOD '''00000000-0000-0000-0000-0000000000d1'''
\set TB '''00000000-0000-0000-0000-0000000000b1'''
\set LRN '''00000000-0000-0000-0000-0000000000e1'''

SET client_min_messages = notice;
\echo == before the migration: a teacher reads every grade in the organization ==
SELECT pg_temp.expect('pre-M7: teacher of C1 reads both grades of organization A',
  pg_temp.val('authenticated', :T1, 'SELECT count(*) FROM public.grades'), '2');

\echo == apply the migration ==
\i database/supabase/migrations/20261117003200_sherivs_m7_academic_core.sql

\echo == own classes (read functions) ==
SELECT pg_temp.expect('form teacher sees only the form class',
  pg_temp.val('authenticated', :T1, 'SELECT string_agg(class_name, '','') FROM public.m7_my_classes()'), 'JSS1 A');
SELECT pg_temp.expect('timetabled teacher sees only the timetabled class, with the subject taught',
  pg_temp.val('authenticated', :T2, 'SELECT string_agg(class_name || '':'' || array_to_string(subjects, ''/''), '','') FROM public.m7_my_classes()'), 'JSS1 B:Maths');
SELECT pg_temp.expect('class-scoped teacher role sees only that class',
  pg_temp.val('authenticated', :T3, 'SELECT string_agg(class_name, '','') FROM public.m7_my_classes()'), 'JSS1 B');
SELECT pg_temp.expect('admin with attendance.view sees every class of the organization, not B''s',
  pg_temp.val('authenticated', :ADM, 'SELECT count(*) FROM public.m7_my_classes()'), '2');
SELECT pg_temp.expect('teacher of organization B sees only B''s class',
  pg_temp.val('authenticated', :TB, 'SELECT string_agg(class_name, '','') FROM public.m7_my_classes()'), 'Class B');
SELECT pg_temp.expect('a learner sees no classes',
  pg_temp.val('authenticated', :LRN, 'SELECT count(*) FROM public.m7_my_classes()'), '0');
SELECT pg_temp.expect('today''s periods: own non-break periods only',
  pg_temp.val('authenticated', :T2, $q$SELECT count(*) FROM public.m7_my_periods('Monday')$q$), '1');
SELECT pg_temp.expect('today''s periods: another teacher has none',
  pg_temp.val('authenticated', :T1, $q$SELECT count(*) FROM public.m7_my_periods('monday')$q$), '0');
SELECT pg_temp.expect('today''s periods: a bad day name is refused',
  pg_temp.val('authenticated', :T2, $q$SELECT count(*) FROM public.m7_my_periods('funday')$q$), 'err:22023');
SELECT pg_temp.expect('roster: own class returns the learner with a display name',
  pg_temp.val('authenticated', :T1, $q$SELECT string_agg(display_name, ',') FROM public.m7_class_roster('c0000000-0000-0000-0000-0000000000c1')$q$), 'Learner one');
SELECT pg_temp.expect('roster: another teacher''s class is refused',
  pg_temp.val('authenticated', :T1, $q$SELECT count(*) FROM public.m7_class_roster('c0000000-0000-0000-0000-0000000000c2')$q$), 'err:42501');
SELECT pg_temp.expect('roster: another organization''s class is refused',
  pg_temp.val('authenticated', :TB, $q$SELECT count(*) FROM public.m7_class_roster('c0000000-0000-0000-0000-0000000000c1')$q$), 'err:42501');
SELECT pg_temp.expect('roster: unnamed learner falls back to the admission number',
  pg_temp.val('authenticated', :T2, $q$SELECT string_agg(display_name, ',') FROM public.m7_class_roster('c0000000-0000-0000-0000-0000000000c2')$q$), 'A-002');
SELECT pg_temp.expect('anon cannot call the read functions',
  has_function_privilege('anon', 'public.m7_class_roster(uuid)', 'EXECUTE')::text, 'false');

\echo == own classes (grades, enforced by RLS) ==
SELECT pg_temp.expect('teacher of C1 now reads only the C1 grade',
  pg_temp.val('authenticated', :T1, 'SELECT string_agg(id::text, '','') FROM public.grades'), '90000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect('timetabled teacher of C2 reads only the C2 grade',
  pg_temp.val('authenticated', :T2, 'SELECT string_agg(id::text, '','') FROM public.grades'), '90000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect('admin still reads both grades',
  pg_temp.val('authenticated', :ADM, 'SELECT count(*) FROM public.grades'), '2');
SELECT pg_temp.expect('teacher of organization B reads no grade of A',
  pg_temp.val('authenticated', :TB, 'SELECT count(*) FROM public.grades'), '0');
SELECT pg_temp.expect('teacher of C1 reads only C1 component scores',
  pg_temp.val('authenticated', :T1, 'SELECT string_agg(score::text, '','') FROM public.m06_result_component_scores'), '8');
SELECT pg_temp.expect('gradebook: own class shows the author''s draft and its components',
  pg_temp.val('authenticated', :T1, $q$SELECT state || ':' || (ca_scores->>'test1') FROM public.m7_class_gradebook('c0000000-0000-0000-0000-0000000000c1', 'Maths', 'First', '2026/2027')$q$), 'draft_mine:8');
SELECT pg_temp.expect('gradebook: another teacher''s draft is labelled, not editable as mine',
  pg_temp.val('authenticated', :T2, $q$SELECT state FROM public.m7_class_gradebook('c0000000-0000-0000-0000-0000000000c2', 'Maths', 'First', '2026/2027')$q$), 'draft_other');
SELECT pg_temp.expect('gradebook: a class the teacher does not teach is refused',
  pg_temp.val('authenticated', :T2, $q$SELECT count(*) FROM public.m7_class_gradebook('c0000000-0000-0000-0000-0000000000c1', 'Maths', 'First', '2026/2027')$q$), 'err:42501');
SELECT pg_temp.expect('attendance marks (existing M05 policy): teacher of C2 reads none of C1',
  pg_temp.val('authenticated', :T2, 'SELECT count(*) FROM public.class_attendance_marks'), '0');

\echo == attendance correction ==
BEGIN;
SELECT pg_temp.expect('a teacher cannot correct a class they do not teach',
  pg_temp.try('authenticated', :T2, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000001', 'absent', 'Arrived after the register closed', 'key-00000001')$q$), 'err:42501');
SELECT pg_temp.expect('a correction needs a real reason',
  pg_temp.try('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000001', 'absent', 'oops', 'key-00000001')$q$), 'err:22023');
SELECT pg_temp.expect('own class, within 7 days, with a reason: corrected',
  pg_temp.val('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000001', 'absent', 'Marked present by mistake', 'key-00000001')->>'replay'$q$), 'false');
SELECT pg_temp.expect('the same client key again is a replay',
  pg_temp.val('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000001', 'absent', 'Marked present by mistake', 'key-00000001')->>'replay'$q$), 'true');
SELECT pg_temp.expect('one correction row, one status change',
  (SELECT count(*)::text || ':' || (SELECT status FROM public.class_attendance_marks WHERE id = 'a0000000-0000-0000-0000-000000000001')
     FROM public.m7_attendance_corrections), '1:absent');
SELECT pg_temp.expect('the correction is audited',
  (SELECT count(*)::text FROM public.audit_logs WHERE table_name = 'm7_attendance_corrections' AND action LIKE '%insert'), '1');
SELECT pg_temp.expect('the corrector can read the correction',
  pg_temp.val('authenticated', :T1, 'SELECT count(*) FROM public.m7_attendance_corrections'), '1');
SELECT pg_temp.expect('another organization cannot read it',
  pg_temp.val('authenticated', :TB, 'SELECT count(*) FROM public.m7_attendance_corrections'), '0');
SELECT pg_temp.expect('setting the same status again is refused',
  pg_temp.try('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000001', 'absent', 'Marked present by mistake', 'key-00000002')$q$), 'err:22023');
SELECT pg_temp.expect('older than 7 days needs attendance.edit_past',
  pg_temp.try('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000002', 'late', 'Late slip found in the office', 'key-00000003')$q$), 'err:42501');
SELECT pg_temp.expect('an admin with attendance.edit_past can correct an older mark',
  pg_temp.val('authenticated', :ADM, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000002', 'late', 'Late slip found in the office', 'key-00000004')->>'status'$q$), 'late');
SELECT pg_temp.expect('a mark of another organization is refused',
  pg_temp.try('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-00000000000b', 'absent', 'Cross-organization attempt', 'key-00000005')$q$), 'err:42501');
SELECT pg_temp.expect('corrections cannot be written directly',
  pg_temp.try('authenticated', :T1, $q$INSERT INTO public.m7_attendance_corrections (school_id, mark_id, class_id, student_id, attendance_date, old_status, new_status, reason, corrected_by, client_key)
    VALUES ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-000000000001', current_date, 'absent', 'present', 'Direct write attempt', '00000000-0000-0000-0000-0000000000f1', 'key-00000006')$q$), 'err:42501');
SELECT pg_temp.expect('corrections are append-only, even for the service role',
  pg_temp.try('service_role', '', $q$UPDATE public.m7_attendance_corrections SET reason = 'Rewritten history here'$q$), 'err:42501');
SELECT pg_temp.expect('anon cannot correct attendance',
  has_function_privilege('anon', 'public.m7_correct_attendance(uuid,text,text,text)', 'EXECUTE')::text, 'false');
ROLLBACK;

\echo == lesson notes: the author cannot approve ==
BEGIN;
SELECT pg_temp.expect('a new note must start as a draft',
  pg_temp.try('authenticated', :T1, $q$INSERT INTO public.lesson_plans (id, school_id, teacher_id, title, status)
    VALUES ('b0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f1', 'Fractions', 'approved')$q$), 'err:42501');
SELECT pg_temp.expect('a teacher saves a draft',
  pg_temp.try('authenticated', :T1, $q$INSERT INTO public.lesson_plans (id, school_id, teacher_id, title)
    VALUES ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f1', 'Fractions')$q$), 'ok:1');
SELECT pg_temp.expect('the author cannot set a draft to approved directly',
  pg_temp.try('authenticated', :T1, $q$UPDATE public.lesson_plans SET status = 'approved' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'err:42501');
SELECT pg_temp.expect('the author cannot mark it submitted without the submit function',
  pg_temp.try('authenticated', :T1, $q$UPDATE public.lesson_plans SET status = 'submitted' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'err:42501');
SELECT pg_temp.expect('the author submits through lesson_note_submit',
  pg_temp.try('authenticated', :T1, $q$SELECT public.lesson_note_submit('b0000000-0000-0000-0000-000000000001')$q$), 'ok:1');
SELECT pg_temp.expect('a submitted note cannot be edited',
  pg_temp.try('authenticated', :T1, $q$UPDATE public.lesson_plans SET title = 'Changed after submit' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'err:42501');
SELECT pg_temp.expect('the author cannot approve a submitted note directly',
  pg_temp.try('authenticated', :T1, $q$UPDATE public.lesson_plans SET status = 'approved' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'err:42501');
SELECT pg_temp.expect('a reviewer of another organization cannot see the submission',
  pg_temp.val('authenticated', :TB, 'SELECT count(*) FROM public.lesson_note_reviews'), '0');
SELECT pg_temp.expect('the HOD returns it with a comment',
  pg_temp.try('authenticated', :HOD, $q$SELECT public.lesson_note_review((SELECT id FROM public.lesson_note_reviews WHERE status = 'submitted'), false, 'Add a worked example')$q$), 'ok:1');
SELECT pg_temp.expect('a returned note is a draft again, with the comment',
  (SELECT status || ':' || review_notes FROM public.lesson_plans WHERE id = 'b0000000-0000-0000-0000-000000000001'), 'draft:Add a worked example');
SELECT pg_temp.expect('the author edits the returned draft',
  pg_temp.try('authenticated', :T1, $q$UPDATE public.lesson_plans SET description = 'With a worked example' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'ok:1');
SELECT pg_temp.expect('and submits again',
  pg_temp.try('authenticated', :T1, $q$SELECT public.lesson_note_submit('b0000000-0000-0000-0000-000000000001')$q$), 'ok:1');
SELECT pg_temp.expect('the HOD approves',
  pg_temp.try('authenticated', :HOD, $q$SELECT public.lesson_note_review((SELECT id FROM public.lesson_note_reviews WHERE status = 'submitted'), true, NULL)$q$), 'ok:1');
SELECT pg_temp.expect('the note is approved',
  (SELECT status FROM public.lesson_plans WHERE id = 'b0000000-0000-0000-0000-000000000001'), 'approved');
SELECT pg_temp.expect('an approved note is final for the author',
  pg_temp.try('authenticated', :T1, $q$UPDATE public.lesson_plans SET status = 'draft' WHERE id = 'b0000000-0000-0000-0000-000000000001'$q$), 'err:42501');
SELECT pg_temp.expect('an HOD who writes a note cannot approve it through the function',
  pg_temp.try('authenticated', :HOD, $q$WITH p AS (INSERT INTO public.lesson_plans (id, school_id, teacher_id, title)
      VALUES ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000d1', 'HOD note') RETURNING id)
    SELECT public.lesson_note_submit((SELECT id FROM p))$q$) || '|' ||
  pg_temp.try('authenticated', :HOD, $q$SELECT public.lesson_note_review((SELECT id FROM public.lesson_note_reviews WHERE lesson_plan_id = 'b0000000-0000-0000-0000-000000000002'), true, NULL)$q$), 'ok:1|err:42501');
SELECT pg_temp.expect('nor by writing the table directly',
  pg_temp.try('authenticated', :HOD, $q$UPDATE public.lesson_plans SET status = 'approved' WHERE id = 'b0000000-0000-0000-0000-000000000002'$q$), 'err:42501');
SELECT pg_temp.expect('nor by faking an approved review row (reviews are read-only to members)',
  pg_temp.try('authenticated', :HOD, $q$UPDATE public.lesson_note_reviews SET status = 'approved', reviewer = '00000000-0000-0000-0000-0000000000a1' WHERE lesson_plan_id = 'b0000000-0000-0000-0000-000000000002'$q$), 'err:42501');
ROLLBACK;

\echo == second run is clean ==
\i database/supabase/migrations/20261117003200_sherivs_m7_academic_core.sql
SELECT pg_temp.expect('second run: still one restrictive grades policy',
  (SELECT count(*)::text FROM pg_policies WHERE tablename = 'grades' AND policyname = 'm7_grades_teacher_own_classes'), '1');

\echo == rollback ==
-- Store one correction, so the rollback must refuse (run in one transaction, as the apply tool does).
SELECT pg_temp.val('authenticated', :T1, $q$SELECT public.m7_correct_attendance('a0000000-0000-0000-0000-000000000001', 'late', 'Came in after first period', 'key-00000010')->>'status'$q$);
\set ON_ERROR_STOP off
BEGIN;
\i database/supabase/rollbacks/20261117003200_sherivs_m7_academic_core.sql
ROLLBACK;
\set ON_ERROR_STOP on
SELECT pg_temp.expect('rollback refused while corrections exist: nothing was dropped',
  (to_regclass('public.m7_attendance_corrections') IS NOT NULL
   AND to_regprocedure('public.m7_my_classes()') IS NOT NULL)::text, 'true');
ALTER TABLE public.m7_attendance_corrections DISABLE TRIGGER trg_m7_attendance_corrections_append_only;
DELETE FROM public.m7_attendance_corrections;
BEGIN;
\i database/supabase/rollbacks/20261117003200_sherivs_m7_academic_core.sql
COMMIT;
SELECT pg_temp.expect('rollback removes every M7 object',
  (SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'm7\_%') || ':' ||
  (SELECT count(*)::text FROM pg_policies WHERE policyname LIKE 'm7\_%') || ':' ||
  coalesce(to_regclass('public.m7_attendance_corrections')::text, 'none') || ':' ||
  (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'm7_lesson_plan_guard'), '0:0:none:0');
SELECT pg_temp.expect('after rollback the teacher reads every grade again (pre-M7 state)',
  pg_temp.val('authenticated', :T1, 'SELECT count(*) FROM public.grades'), '2');
\i database/supabase/migrations/20261117003200_sherivs_m7_academic_core.sql
SELECT pg_temp.expect('re-apply after rollback works',
  pg_temp.val('authenticated', :T1, 'SELECT count(*) FROM public.grades'), '1');
\echo == ALL M7 SQL CHECKS PASSED ==
