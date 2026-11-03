CREATE OR REPLACE FUNCTION public.check_result(p_serial text, p_pin text, p_admission_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE r public.result_pins; st public.students; res jsonb;
BEGIN
  IF NOT public.rate_limit_take('result_checker.serial', coalesce(p_serial, '?'), 10, interval '1 hour') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  SELECT * INTO r FROM public.result_pins WHERE serial = p_serial FOR UPDATE;
  IF r.serial IS NULL OR r.pin_hash <> extensions.crypt(coalesce(p_pin, ''), r.pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid serial or PIN');
  END IF;
  SELECT * INTO st FROM public.students WHERE school_id = r.school_id AND admission_number = p_admission_number;
  IF st.id IS NULL THEN RAISE EXCEPTION 'student not found for this card' USING ERRCODE = 'P0001'; END IF;
  IF r.student_id IS NOT NULL AND r.student_id <> st.id THEN RAISE EXCEPTION 'this card is already used by another student' USING ERRCODE = 'P0001'; END IF;
  IF r.uses >= r.max_uses THEN RAISE EXCEPTION 'card exhausted (% uses)', r.max_uses USING ERRCODE = 'P0001'; END IF;
  UPDATE public.result_pins SET student_id = st.id, uses = uses + 1, first_used_at = coalesce(first_used_at, now()), last_used_at = now() WHERE serial = r.serial;
  SELECT jsonb_build_object('ok', true, 'school', (SELECT name FROM public.schools WHERE id = r.school_id), 'admission_number', st.admission_number,
           'term', r.term, 'academic_year', r.academic_year, 'uses_left', r.max_uses - r.uses - 1,
           'subjects', coalesce(jsonb_agg(jsonb_build_object('subject', g.subject, 'ca', g.ca_score, 'exam', g.exam_score, 'total', g.total_score, 'grade', g.grade) ORDER BY g.subject), '[]'::jsonb))
    INTO res FROM public.grades g WHERE g.student_id = st.id AND g.term = r.term AND g.academic_year = r.academic_year AND g.is_published;
  RETURN res;
END
$$;
