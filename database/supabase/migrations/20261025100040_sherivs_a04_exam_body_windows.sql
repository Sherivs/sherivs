-- SHERIVS-A04 (Track A, day 5): external exam-body registration windows (WAEC, NECO, NABTEB, BECE, NCEE, JAMB UTME).
--  * exam_bodies catalogue with subject-count rules; per-school windows (normal close + optional late close with late fee)
--  * candidate registration only while open, eligible level only, subject count within the body's limits, one entry per window
--  * after the final close entries are frozen; every change audited; staff need exams.records, parents/students read their own
-- Additive only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.exam_bodies (
  code text PRIMARY KEY, name text NOT NULL, min_subjects int NOT NULL, max_subjects int NOT NULL, default_levels text[] NOT NULL, note text,
  CHECK (min_subjects BETWEEN 1 AND max_subjects));
INSERT INTO public.exam_bodies VALUES
 ('WAEC_WASSCE','WAEC WASSCE (school candidates)',7,9,ARRAY['SSS3','SS3'],'Rules template; confirm the current year''s subject limits with WAEC'),
 ('NECO_SSCE','NECO SSCE (internal)',7,9,ARRAY['SSS3','SS3'],'Rules template; confirm with NECO'),
 ('NABTEB_NBC','NABTEB NBC/NTC',7,9,ARRAY['SSS3','SS3'],'Technical colleges; confirm trade subject rules'),
 ('BECE','Basic Education Certificate Examination (state / NECO)',9,13,ARRAY['JSS3'],'State or NECO-run; confirm the state list'),
 ('NCEE','National Common Entrance (Unity Colleges)',2,4,ARRAY['Primary 6','PRY6','Basic 6'],'NECO-run'),
 ('JAMB_UTME','JAMB UTME',4,4,ARRAY['SSS3','SS3'],'Use of English + 3 subjects')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.exam_body_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  body_code text NOT NULL REFERENCES public.exam_bodies(code),
  exam_year int NOT NULL CHECK (exam_year BETWEEN 2020 AND 2100),
  opens_on date NOT NULL, closes_on date NOT NULL, late_closes_on date,
  fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (fee >= 0), late_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  eligible_levels text[], created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_on >= opens_on), CHECK (late_closes_on IS NULL OR late_closes_on >= closes_on),
  UNIQUE (school_id, body_code, exam_year));
CREATE TABLE IF NOT EXISTS public.exam_body_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid NOT NULL REFERENCES public.exam_body_windows(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subjects text[] NOT NULL, status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','withdrawn')),
  late boolean NOT NULL DEFAULT false, fee_due numeric(12,2) NOT NULL DEFAULT 0,
  registered_by uuid, registered_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_id, student_id));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['exam_body_windows','exam_body_candidates'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t); EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
ALTER TABLE public.exam_bodies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_bodies FROM PUBLIC, anon, authenticated; GRANT SELECT ON public.exam_bodies TO authenticated;
DROP POLICY IF EXISTS exam_bodies_read ON public.exam_bodies;
CREATE POLICY exam_bodies_read ON public.exam_bodies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS exam_body_windows_read ON public.exam_body_windows;
CREATE POLICY exam_body_windows_read ON public.exam_body_windows FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));
DROP POLICY IF EXISTS exam_body_candidates_read ON public.exam_body_candidates;
CREATE POLICY exam_body_candidates_read ON public.exam_body_candidates FOR SELECT TO authenticated
  USING ((school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'exams.records'))
      OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR s.parent_id = auth.uid()))
      OR public.is_guardian_of_student(student_id, school_id) OR coalesce(public.is_super_admin(), false));

CREATE OR REPLACE FUNCTION public.exam_window_upsert(p_org uuid, p_body text, p_year int, p_opens date, p_closes date, p_late_closes date DEFAULT NULL,
  p_fee numeric DEFAULT 0, p_late_fee numeric DEFAULT 0, p_levels text[] DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_org, 'exams.records') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_bodies WHERE code = p_body) THEN RAISE EXCEPTION 'unknown exam body'; END IF;
  INSERT INTO public.exam_body_windows (school_id, body_code, exam_year, opens_on, closes_on, late_closes_on, fee, late_fee, eligible_levels, created_by)
  VALUES (p_org, p_body, p_year, p_opens, p_closes, p_late_closes, coalesce(p_fee, 0), coalesce(p_late_fee, 0), p_levels, auth.uid())
  ON CONFLICT (school_id, body_code, exam_year) DO UPDATE SET opens_on = EXCLUDED.opens_on, closes_on = EXCLUDED.closes_on, late_closes_on = EXCLUDED.late_closes_on,
    fee = EXCLUDED.fee, late_fee = EXCLUDED.late_fee, eligible_levels = EXCLUDED.eligible_levels RETURNING id INTO v;
  RETURN v;
END $$;

-- Register (or update the subjects of) one candidate. Open window: normal fee; late window: fee + late fee; after: frozen.
CREATE OR REPLACE FUNCTION public.exam_candidate_register(p_window uuid, p_student uuid, p_subjects text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.exam_body_windows; b public.exam_bodies; s public.students; lvl text; v_late boolean; n int; levels text[]; c public.exam_body_candidates;
BEGIN
  SELECT * INTO w FROM public.exam_body_windows WHERE id = p_window;
  IF w.id IS NULL OR NOT public.scholar_can(w.school_id, 'exams.records') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF s.id IS NULL OR s.school_id <> w.school_id THEN RAISE EXCEPTION 'student is not in this school' USING ERRCODE = '42501'; END IF;
  IF current_date < w.opens_on THEN RAISE EXCEPTION 'window_not_open: registration opens on %', w.opens_on; END IF;
  IF current_date > coalesce(w.late_closes_on, w.closes_on) THEN RAISE EXCEPTION 'window_closed: registration closed on %', coalesce(w.late_closes_on, w.closes_on); END IF;
  v_late := current_date > w.closes_on;
  SELECT * INTO b FROM public.exam_bodies WHERE code = w.body_code;
  levels := coalesce(w.eligible_levels, b.default_levels);
  SELECT coalesce(cl.grade_level, cl.name) INTO lvl FROM public.classes cl WHERE cl.id = s.class_id;
  lvl := coalesce(lvl, s.current_level);
  IF NOT EXISTS (SELECT 1 FROM unnest(levels) l WHERE upper(replace(l, ' ', '')) = upper(replace(coalesce(lvl, ''), ' ', ''))
                    OR upper(replace(coalesce(lvl, ''), ' ', '')) LIKE upper(replace(l, ' ', '')) || '%') THEN
    RAISE EXCEPTION 'not_eligible: % is for % (student is in %)', b.name, array_to_string(levels, ', '), coalesce(lvl, 'no class'); END IF;
  SELECT count(DISTINCT lower(btrim(x))) INTO n FROM unnest(p_subjects) x WHERE btrim(x) <> '';
  IF n < b.min_subjects OR n > b.max_subjects THEN RAISE EXCEPTION 'subject_count: % needs % to % subjects (got %)', b.name, b.min_subjects, b.max_subjects, n; END IF;
  SELECT * INTO c FROM public.exam_body_candidates WHERE window_id = w.id AND student_id = s.id;
  IF c.id IS NULL THEN
    INSERT INTO public.exam_body_candidates (window_id, school_id, student_id, subjects, late, fee_due, registered_by)
    VALUES (w.id, w.school_id, s.id, (SELECT array_agg(DISTINCT btrim(x)) FROM unnest(p_subjects) x WHERE btrim(x) <> ''), v_late, w.fee + CASE WHEN v_late THEN w.late_fee ELSE 0 END, auth.uid())
    RETURNING * INTO c;
  ELSE
    UPDATE public.exam_body_candidates SET subjects = (SELECT array_agg(DISTINCT btrim(x)) FROM unnest(p_subjects) x WHERE btrim(x) <> ''), status = 'registered',
      late = c.late OR v_late, fee_due = CASE WHEN c.status = 'withdrawn' THEN w.fee + CASE WHEN v_late THEN w.late_fee ELSE 0 END ELSE c.fee_due END, updated_at = now()
     WHERE id = c.id RETURNING * INTO c;
  END IF;
  RETURN jsonb_build_object('id', c.id, 'late', c.late, 'fee_due', c.fee_due, 'subjects', to_jsonb(c.subjects));
END $$;

CREATE OR REPLACE FUNCTION public.exam_candidate_withdraw(p_candidate uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.exam_body_candidates; w public.exam_body_windows;
BEGIN
  SELECT * INTO c FROM public.exam_body_candidates WHERE id = p_candidate;
  SELECT * INTO w FROM public.exam_body_windows WHERE id = c.window_id;
  IF c.id IS NULL OR NOT public.scholar_can(c.school_id, 'exams.records') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF current_date > coalesce(w.late_closes_on, w.closes_on) THEN RAISE EXCEPTION 'window_closed: entries are frozen'; END IF;
  UPDATE public.exam_body_candidates SET status = 'withdrawn', updated_at = now() WHERE id = c.id;
END $$;

-- Summary for the exams officer: counts, fees due, late entries and per-subject entries (exam bodies ask for these).
CREATE OR REPLACE FUNCTION public.exam_window_summary(p_window uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.exam_body_windows;
BEGIN
  SELECT * INTO w FROM public.exam_body_windows WHERE id = p_window;
  IF w.id IS NULL OR w.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(w.school_id, 'exams.records') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('body', w.body_code, 'year', w.exam_year,
    'state', CASE WHEN current_date < w.opens_on THEN 'not_open' WHEN current_date <= w.closes_on THEN 'open'
                  WHEN current_date <= coalesce(w.late_closes_on, w.closes_on) THEN 'late' ELSE 'closed' END,
    'candidates', (SELECT count(*) FROM public.exam_body_candidates WHERE window_id = w.id AND status = 'registered'),
    'late', (SELECT count(*) FROM public.exam_body_candidates WHERE window_id = w.id AND status = 'registered' AND late),
    'fees_due', (SELECT coalesce(sum(fee_due), 0) FROM public.exam_body_candidates WHERE window_id = w.id AND status = 'registered'),
    'by_subject', coalesce((SELECT jsonb_object_agg(sub, n) FROM (SELECT x sub, count(*) n FROM public.exam_body_candidates, unnest(subjects) x
                             WHERE window_id = w.id AND status = 'registered' GROUP BY x) q), '{}'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.exam_window_upsert(uuid, text, int, date, date, date, numeric, numeric, text[]), public.exam_candidate_register(uuid, uuid, text[]),
  public.exam_candidate_withdraw(uuid), public.exam_window_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_window_upsert(uuid, text, int, date, date, date, numeric, numeric, text[]), public.exam_candidate_register(uuid, uuid, text[]),
  public.exam_candidate_withdraw(uuid), public.exam_window_summary(uuid) TO authenticated;

COMMIT;
