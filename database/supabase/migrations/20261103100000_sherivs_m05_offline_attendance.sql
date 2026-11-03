-- M05: tenant-scoped daily/period attendance capture with durable offline sync.
DO $guard$
BEGIN
  IF to_regclass('public.attendance') IS NULL
     OR to_regclass('public.classes') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.school_shifts') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regprocedure('public.scholar_can(uuid,text)') IS NULL
     OR to_regprocedure('public.scholar_audit()') IS NULL THEN
    RAISE EXCEPTION 'M05 requires attendance, M04 shifts, the role engine, and Scholar authorization/audit helpers'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

BEGIN;

CREATE UNIQUE INDEX classes_id_school_m05_uq ON public.classes (id, school_id);
CREATE UNIQUE INDEX students_id_class_school_m05_uq ON public.students (id, class_id, school_id);
CREATE UNIQUE INDEX school_shifts_id_school_m05_uq ON public.school_shifts (id, school_id);

CREATE TABLE public.class_attendance_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL,
  student_id uuid NOT NULL,
  shift_id uuid,
  attendance_date date NOT NULL,
  period_key text NOT NULL DEFAULT 'daily'
    CHECK (period_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  marked_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, school_id)
    REFERENCES public.classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, class_id, school_id)
    REFERENCES public.students (id, class_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id, school_id)
    REFERENCES public.school_shifts (id, school_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX class_attendance_marks_scope_m05_uq
  ON public.class_attendance_marks (
    school_id, class_id, student_id, attendance_date,
    (coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)), period_key
  );
CREATE INDEX class_attendance_marks_tenant_class_date_m05_idx
  ON public.class_attendance_marks (school_id, class_id, attendance_date DESC);

CREATE TABLE public.class_attendance_sync_items (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_item_id text NOT NULL CHECK (length(btrim(client_item_id)) BETWEEN 1 AND 160),
  batch text NOT NULL,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_item_id)
);

CREATE TABLE public.class_attendance_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  batch text NOT NULL,
  client_item_id text NOT NULL,
  class_id uuid NOT NULL,
  student_id uuid NOT NULL,
  shift_id uuid,
  attendance_date date NOT NULL,
  period_key text NOT NULL,
  yours text NOT NULL CHECK (yours IN ('present', 'absent', 'late', 'excused')),
  server text CHECK (server IS NULL OR server IN ('present', 'absent', 'late', 'excused')),
  server_marked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz,
  skew_seconds integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, school_id)
    REFERENCES public.classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, class_id, school_id)
    REFERENCES public.students (id, class_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id, school_id)
    REFERENCES public.school_shifts (id, school_id) ON DELETE RESTRICT
);
CREATE INDEX class_attendance_sync_conflicts_open_m05_idx
  ON public.class_attendance_sync_conflicts (school_id, attendance_date DESC)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.m05_teacher_assigned_to_class(p_school uuid, p_class uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_school = public.get_my_school_id()
     AND EXISTS (
       SELECT 1
         FROM public.classes c
        WHERE c.id = p_class
          AND c.school_id = p_school
          AND (
            c.teacher_id = auth.uid()
            OR EXISTS (
              SELECT 1
                FROM public.timetables tt
                JOIN public.timetable_slots ts
                  ON ts.timetable_id = tt.id
                 AND ts.school_id = tt.school_id
               WHERE tt.school_id = p_school
                 AND tt.class_id = c.id
                 AND tt.is_active IS TRUE
                 AND ts.teacher_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1
                FROM public.user_role_assignments a
                JOIN public.role_catalog r ON r.code = a.role_code
               WHERE a.org_id = p_school
                 AND a.user_id = auth.uid()
                 AND a.status = 'active'
                 AND a.scope_type = 'class'
                 AND a.scope_ref = c.id::text
                 AND a.started_at <= now()
                 AND (a.valid_until IS NULL OR a.valid_until > now())
                 AND r.template_code = 'teacher'
            )
          )
     )
$$;
REVOKE ALL ON FUNCTION public.m05_teacher_assigned_to_class(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m05_teacher_assigned_to_class(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.offline_attendance_capture_sync_m05(
  p_batch text,
  p_items jsonb,
  p_client_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_school uuid := public.get_my_school_id();
  v_batch public.offline_sync_batches%ROWTYPE;
  v_item jsonb;
  v_item_id text;
  v_class uuid;
  v_student uuid;
  v_shift uuid;
  v_date date;
  v_period text;
  v_status text;
  v_captured timestamptz;
  v_server public.class_attendance_marks%ROWTYPE;
  v_skew integer;
  v_applied integer := 0;
  v_duplicates integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_outcome text;
  v_prior_outcome text;
  v_prior_conflict jsonb;
  v_inserted integer;
BEGIN
  IF auth.uid() IS NULL OR v_school IS NULL
     OR NOT public.scholar_can(v_school, 'attendance.take') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_client_now IS NULL THEN RAISE EXCEPTION 'device time is required'; END IF;
  IF coalesce(length(p_batch), 0) NOT BETWEEN 4 AND 80 THEN
    RAISE EXCEPTION 'batch id must be 4–80 characters';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'items must be an array of 1 to 500 marks';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'items must be an array of 1 to 500 marks';
  END IF;

  v_skew := round(extract(epoch FROM (p_client_now - now())))::integer;
  IF abs(v_skew) > 86400 THEN
    RAISE EXCEPTION 'clock_skew: device clock is more than 24 hours off'
      USING ERRCODE = '22007';
  END IF;

  SELECT * INTO v_batch
    FROM public.offline_sync_batches
   WHERE user_id = auth.uid()
     AND client_batch_id = p_batch;
  IF v_batch.id IS NOT NULL THEN
    IF v_batch.kind <> 'attendance_m05' THEN
      RAISE EXCEPTION 'batch id is already used for another sync kind'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'replay', true, 'applied', v_batch.applied,
      'duplicates', greatest(
        v_batch.items - v_batch.applied - jsonb_array_length(v_batch.conflicts), 0
      ),
      'conflicts', v_batch.conflicts, 'skew_seconds', v_batch.skew_seconds
    );
  END IF;

  FOR v_item IN
    SELECT items.value FROM jsonb_array_elements(p_items) AS items(value)
  LOOP
    v_item_id := nullif(btrim(coalesce(v_item->>'id', '')), '');
    v_outcome := 'applied';
    IF v_item_id IS NULL OR length(v_item_id) > 160 THEN
      v_conflicts := v_conflicts || jsonb_build_object('why', 'missing_or_invalid_item_id');
      CONTINUE;
    END IF;
    SELECT outcome INTO v_prior_outcome
      FROM public.class_attendance_sync_items
     WHERE user_id = auth.uid()
       AND client_item_id = v_item_id;
    IF FOUND THEN
      IF v_prior_outcome = 'applied' THEN
        v_duplicates := v_duplicates + 1;
      ELSE
        SELECT jsonb_build_object(
          'id', c.client_item_id, 'student_id', c.student_id,
          'why', 'server_has_other_mark', 'server', c.server, 'yours', c.yours
        ) INTO v_prior_conflict
          FROM public.class_attendance_sync_conflicts c
         WHERE c.user_id = auth.uid()
           AND c.client_item_id = v_item_id
         ORDER BY c.created_at DESC
         LIMIT 1;
        v_conflicts := v_conflicts || coalesce(
          v_prior_conflict,
          jsonb_build_object(
            'id', v_item_id, 'student_id', v_item->>'student_id',
            'why', v_prior_outcome
          )
        );
        v_prior_conflict := NULL;
      END IF;
      CONTINUE;
    END IF;

    BEGIN
      v_class := (v_item->>'class_id')::uuid;
      v_student := (v_item->>'student_id')::uuid;
      v_shift := nullif(v_item->>'shift_id', '')::uuid;
      v_date := (v_item->>'date')::date;
      v_period := coalesce(nullif(btrim(v_item->>'period_key'), ''), 'daily');
      v_status := v_item->>'status';
      v_captured := (v_item->>'captured_at')::timestamptz - make_interval(secs => v_skew);
      IF length(v_period) > 64 OR v_period !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$' THEN
        v_outcome := 'bad_period';
      END IF;
      IF v_class IS NULL OR v_student IS NULL OR v_date IS NULL OR v_captured IS NULL THEN
        v_outcome := 'bad_item';
      ELSIF v_status IS NULL OR v_status NOT IN ('present', 'absent', 'late', 'excused') THEN
        v_outcome := 'bad_status';
      END IF;
    EXCEPTION WHEN others THEN
      v_outcome := 'bad_item';
    END;

    IF v_outcome = 'applied' THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.classes c
          JOIN public.students s
            ON s.class_id = c.id
           AND s.school_id = c.school_id
         WHERE c.id = v_class
           AND c.school_id = v_school
           AND s.id = v_student
           AND s.is_active IS TRUE
      ) THEN
        v_outcome := 'student_not_in_class';
      ELSIF v_shift IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.school_shifts sh
         WHERE sh.id = v_shift AND sh.school_id = v_school
      ) THEN
        v_outcome := 'unknown_shift';
      ELSIF public.get_my_role() = 'teacher'
         AND NOT public.m05_teacher_assigned_to_class(v_school, v_class) THEN
        v_outcome := 'not_your_class';
      ELSIF v_date > current_date
         OR (v_date < current_date - 7
             AND NOT public.scholar_can(v_school, 'attendance.edit_past')) THEN
        v_outcome := 'date_out_of_range';
      ELSIF v_captured IS NULL OR v_captured > now() + interval '5 minutes'
         OR v_captured::date <> v_date THEN
        v_outcome := 'captured_time_invalid';
      END IF;
    END IF;

    IF v_outcome <> 'applied' THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'id', v_item_id, 'student_id', v_item->>'student_id', 'why', v_outcome
      );
    ELSE
      SELECT * INTO v_server
        FROM public.class_attendance_marks m
       WHERE m.school_id = v_school
         AND m.class_id = v_class
         AND m.student_id = v_student
         AND m.attendance_date = v_date
         AND m.shift_id IS NOT DISTINCT FROM v_shift
         AND m.period_key = v_period
       FOR UPDATE;

      IF v_server.id IS NULL THEN
        INSERT INTO public.class_attendance_marks (
          school_id, class_id, student_id, shift_id, attendance_date, period_key,
          status, marked_by, captured_at
        ) VALUES (
          v_school, v_class, v_student, v_shift, v_date, v_period,
          v_status, auth.uid(), v_captured
        )
        ON CONFLICT (
          school_id, class_id, student_id, attendance_date,
          (coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)), period_key
        ) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted = 1 THEN
          v_applied := v_applied + 1;
        ELSE
          SELECT * INTO v_server
            FROM public.class_attendance_marks m
           WHERE m.school_id = v_school
             AND m.class_id = v_class
             AND m.student_id = v_student
             AND m.attendance_date = v_date
             AND m.shift_id IS NOT DISTINCT FROM v_shift
             AND m.period_key = v_period
           FOR UPDATE;
        END IF;
      END IF;

      IF v_server.id IS NOT NULL THEN
        IF v_server.status = v_status THEN
          v_applied := v_applied + 1;
        ELSIF v_server.marked_by = auth.uid() THEN
          UPDATE public.class_attendance_marks
             SET status = v_status, captured_at = v_captured
           WHERE id = v_server.id;
          v_applied := v_applied + 1;
        ELSE
          v_conflicts := v_conflicts || jsonb_build_object(
            'id', v_item_id, 'student_id', v_student, 'why', 'server_has_other_mark',
            'server', v_server.status, 'yours', v_status
          );
          INSERT INTO public.class_attendance_sync_conflicts (
            school_id, user_id, batch, client_item_id, class_id, student_id, shift_id,
            attendance_date, period_key, yours, server, server_marked_by,
            captured_at, skew_seconds
          ) VALUES (
            v_school, auth.uid(), p_batch, v_item_id, v_class, v_student, v_shift,
            v_date, v_period, v_status, v_server.status, v_server.marked_by,
            v_captured, v_skew
          );
          v_outcome := 'conflict';
        END IF;
      END IF;
    END IF;

    INSERT INTO public.class_attendance_sync_items (
      school_id, user_id, client_item_id, batch, outcome
    ) VALUES (v_school, auth.uid(), v_item_id, p_batch, v_outcome)
    ON CONFLICT (user_id, client_item_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.offline_sync_batches (
    school_id, user_id, client_batch_id, kind, items, applied, conflicts, skew_seconds
  ) VALUES (
    v_school, auth.uid(), p_batch, 'attendance_m05', jsonb_array_length(p_items),
    v_applied, v_conflicts, v_skew
  );
  RETURN jsonb_build_object(
    'applied', v_applied, 'duplicates', v_duplicates,
    'conflicts', v_conflicts, 'skew_seconds', v_skew
  );
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'class_attendance_marks',
    'class_attendance_sync_items',
    'class_attendance_sync_conflicts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()',
      t
    );
  END LOOP;
END
$$;

CREATE POLICY class_attendance_marks_read_m05 ON public.class_attendance_marks
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      (public.get_my_role() = 'teacher'
       AND public.m05_teacher_assigned_to_class(school_id, class_id))
      OR (public.get_my_role() <> 'teacher'
          AND public.scholar_can(school_id, 'attendance.view'))
    )
  );
CREATE POLICY class_attendance_sync_items_read_m05 ON public.class_attendance_sync_items
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND school_id = public.get_my_school_id());
CREATE POLICY class_attendance_sync_conflicts_read_m05 ON public.class_attendance_sync_conflicts
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      user_id = auth.uid()
      OR public.scholar_can(school_id, 'attendance.edit_past')
    )
  );

REVOKE ALL ON FUNCTION public.offline_attendance_capture_sync_m05(text, jsonb, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offline_attendance_capture_sync_m05(text, jsonb, timestamptz)
  TO authenticated;

COMMIT;
