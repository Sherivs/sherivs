-- SV1-MOBILITY: server-validated eligibility previews and atomic bulk requests.
BEGIN;

CREATE OR REPLACE FUNCTION public.student_mobility_preview(
  p_student uuid,
  p_target_class uuid,
  p_movement_type text,
  p_additional_students integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_school uuid := public.get_my_school_id();
  s public.students%ROWTYPE;
  c public.classes%ROWTYPE;
  r public.student_mobility_rules%ROWTYPE;
  v_session text;
  v_average numeric;
  v_subject_score numeric;
  v_attendance numeric;
  v_balance numeric;
  v_period_start date;
  v_period_end date;
  v_occupied integer;
  v_unmet text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_subject text;
BEGIN
  IF v_school IS NULL OR NOT public.scholar_can(v_school, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_movement_type IS NULL OR p_movement_type NOT IN (
    'promote', 'repeat', 'double_promote', 'demote', 'conditional_promote',
    'internal_transfer', 'withdraw', 'graduate', 'readmit'
  ) THEN
    RAISE EXCEPTION 'unsupported movement type';
  END IF;
  IF p_additional_students IS NULL OR p_additional_students NOT BETWEEN 0 AND 199 THEN
    RAISE EXCEPTION 'additional student count is invalid';
  END IF;
  SELECT * INTO s FROM public.students
   WHERE id = p_student AND school_id = v_school;
  IF s.id IS NULL THEN RAISE EXCEPTION 'student is not in this organization' USING ERRCODE = '42501'; END IF;
  IF p_movement_type = 'readmit' AND s.is_active IS NOT FALSE THEN
    v_unmet := array_append(v_unmet, 'only an inactive student can be readmitted');
  ELSIF p_movement_type <> 'readmit' AND s.is_active IS FALSE THEN
    v_unmet := array_append(v_unmet, 'inactive student must be readmitted before movement');
  END IF;
  IF p_target_class IS NOT NULL THEN
    SELECT * INTO c FROM public.classes
     WHERE id = p_target_class AND school_id = v_school;
    IF c.id IS NULL THEN RAISE EXCEPTION 'target class is not in this organization' USING ERRCODE = '42501'; END IF;
  ELSIF p_movement_type NOT IN ('withdraw', 'graduate') THEN
    v_unmet := array_append(v_unmet, 'target class is required');
  END IF;
  IF p_target_class IS NOT NULL AND c.capacity IS NOT NULL THEN
    SELECT count(*)::integer INTO v_occupied FROM public.students
     WHERE class_id = p_target_class AND school_id = v_school
       AND is_active IS NOT FALSE AND id IS DISTINCT FROM p_student;
    IF v_occupied + p_additional_students >= c.capacity THEN
      v_unmet := array_append(v_unmet, 'target class is at capacity');
    END IF;
  END IF;

  SELECT * INTO r FROM public.student_mobility_rules WHERE school_id = v_school;
  v_session := coalesce(s.current_session, (
    SELECT academic_year FROM public.classes
     WHERE id = s.class_id AND school_id = s.school_id
  ));
  IF p_movement_type IN ('promote', 'double_promote', 'conditional_promote') THEN
    IF r.min_average_pct IS NOT NULL THEN
      SELECT avg(total_score) INTO v_average FROM public.grades
       WHERE school_id = v_school AND student_id = s.id AND academic_year = v_session;
      IF v_average IS NULL THEN
        v_unmet := array_append(v_unmet, 'average is unknown');
      ELSIF v_average < r.min_average_pct THEN
        v_unmet := array_append(v_unmet, 'average is below the institution threshold');
      END IF;
    END IF;
    FOREACH v_subject IN ARRAY coalesce(r.required_subjects, ARRAY[]::text[]) LOOP
      SELECT max(total_score) INTO v_subject_score FROM public.grades
       WHERE school_id = v_school AND student_id = s.id
         AND academic_year = v_session AND subject = v_subject;
      IF v_subject_score IS NULL THEN
        v_unmet := array_append(v_unmet, 'required subject "' || v_subject || '" has no result');
      ELSIF v_subject_score < r.pass_mark THEN
        v_unmet := array_append(v_unmet, 'required subject "' || v_subject || '" is below the pass mark');
      END IF;
    END LOOP;
    IF r.min_attendance_pct IS NOT NULL THEN
      SELECT min(starts_on), max(ends_on) INTO v_period_start, v_period_end
        FROM public.academic_periods
       WHERE school_id = v_school AND session = v_session;
      IF v_period_start IS NULL OR v_period_end IS NULL THEN
        v_unmet := array_append(v_unmet, 'attendance period is unknown');
      ELSE
        SELECT 100.0 * count(*) FILTER (WHERE status IN ('present', 'late'))
               / nullif(count(*) FILTER (WHERE status <> 'excused'), 0)
          INTO v_attendance FROM public.attendance
         WHERE school_id = v_school AND student_id = s.id
           AND date BETWEEN v_period_start AND v_period_end;
        IF v_attendance IS NULL THEN
          v_unmet := array_append(v_unmet, 'attendance is unknown');
        ELSIF v_attendance < r.min_attendance_pct THEN
          v_unmet := array_append(v_unmet, 'attendance is below the institution threshold');
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT coalesce(sum(greatest(amount - coalesce(paid_amount, 0), 0)), 0)
    INTO v_balance FROM public.fees
   WHERE school_id = v_school AND student_id = s.id
     AND coalesce(status, 'unpaid') <> 'paid';
  IF coalesce(r.fee_clearance, 'block') = 'block' AND v_balance > 0 THEN
    v_unmet := array_append(v_unmet, 'outstanding balance requires clearance');
  ELSIF coalesce(r.fee_clearance, 'block') = 'warn' AND v_balance > 0 THEN
    v_warnings := array_append(v_warnings, 'outstanding balance requires reviewer attention');
  END IF;

  RETURN jsonb_build_object(
    'student_id', s.id,
    'eligible', cardinality(v_unmet) = 0,
    'unmet', to_jsonb(v_unmet),
    'warnings', to_jsonb(v_warnings),
    'average_pct', v_average,
    'attendance_pct', v_attendance,
    'outstanding_balance', v_balance,
    'occupied_seats', v_occupied,
    'target_capacity', c.capacity,
    'required_approvals', coalesce(r.required_approvals, 2),
    'approval_roles', coalesce(r.approval_roles, ARRAY[]::text[]),
    'fee_clearance', coalesce(r.fee_clearance, 'block'),
    'policy_updated_at', r.updated_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_bulk_preview(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_school uuid := public.get_my_school_id();
  v_item jsonb;
  v_student uuid;
  v_class uuid;
  v_type text;
  v_extra integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_school IS NULL OR NOT public.scholar_can(v_school, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'bulk preview requires a JSON array';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'bulk preview requires between 1 and 200 students';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS entries(item)
     GROUP BY item->>'student_id'
    HAVING count(*) > 1 OR coalesce(item->>'student_id', '') = ''
  ) THEN RAISE EXCEPTION 'bulk preview contains a missing or duplicate student'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_student := nullif(v_item->>'student_id', '')::uuid;
    v_class := nullif(v_item->>'target_class_id', '')::uuid;
    v_type := coalesce(nullif(v_item->>'movement_type', ''), 'promote');
    SELECT count(*)::integer INTO v_extra
      FROM jsonb_array_elements(p_items) AS entries(other_item)
      JOIN public.students other_student
        ON other_student.id = nullif(other_item->>'student_id', '')::uuid
       AND other_student.school_id = v_school
     WHERE nullif(other_item->>'target_class_id', '')::uuid IS NOT DISTINCT FROM v_class
       AND other_student.id IS DISTINCT FROM v_student
       AND other_student.class_id IS DISTINCT FROM v_class;
    v_results := v_results || jsonb_build_array(
      public.student_mobility_preview(v_student, v_class, v_type, v_extra)
    );
  END LOOP;
  RETURN v_results;
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_bulk_request(
  p_items jsonb,
  p_effective_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_school uuid := public.get_my_school_id();
  v_item jsonb;
  v_student uuid;
  v_class uuid;
  v_type text;
  v_reason text;
  v_request uuid;
  v_requests jsonb := '[]'::jsonb;
  v_preview jsonb;
  v_index integer := 0;
BEGIN
  IF v_school IS NULL OR NOT public.scholar_can(v_school, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at < now() THEN
    RAISE EXCEPTION 'effective date cannot be in the past';
  END IF;
  v_preview := public.student_mobility_bulk_preview(p_items);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_index := v_index + 1;
    IF (v_preview->(v_index - 1)->>'eligible')::boolean IS FALSE THEN
      RAISE EXCEPTION 'bulk request has an ineligible student at position %', v_index;
    END IF;
    v_student := nullif(v_item->>'student_id', '')::uuid;
    v_class := nullif(v_item->>'target_class_id', '')::uuid;
    v_type := coalesce(nullif(v_item->>'movement_type', ''), 'promote');
    v_reason := coalesce(nullif(btrim(v_item->>'reason'), ''), 'End-of-session promotion');
    v_request := public.student_mobility_request(
      v_student, v_class, v_type, v_reason, NULL, NULL, p_effective_at
    );
    v_requests := v_requests || jsonb_build_array(
      jsonb_build_object('student_id', v_student, 'request_id', v_request)
    );
  END LOOP;
  RETURN v_requests;
END
$$;

REVOKE ALL ON FUNCTION public.student_mobility_preview(uuid, uuid, text, integer),
  public.student_mobility_bulk_preview(jsonb),
  public.student_mobility_bulk_request(jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_mobility_preview(uuid, uuid, text, integer),
  public.student_mobility_bulk_preview(jsonb),
  public.student_mobility_bulk_request(jsonb, timestamptz) TO authenticated;

COMMIT;
