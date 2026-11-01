-- SV1-MOBILITY: keep the current student row for compatibility while recording
-- each academic placement and approved movement as a tenant-scoped timeline.
BEGIN;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'promoted', 'repeated', 'graduated', 'withdrawn', 'transferred')),
  ADD COLUMN IF NOT EXISTS current_level text,
  ADD COLUMN IF NOT EXISTS programme text,
  ADD COLUMN IF NOT EXISTS current_session text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS graduated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.student_mobility_rules (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  required_approvals smallint NOT NULL DEFAULT 2 CHECK (required_approvals BETWEEN 1 AND 3),
  approval_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  pass_mark numeric(5,2) CHECK (pass_mark IS NULL OR pass_mark BETWEEN 0 AND 100),
  min_average_pct numeric(5,2) CHECK (min_average_pct IS NULL OR min_average_pct BETWEEN 0 AND 100),
  required_subjects text[] NOT NULL DEFAULT ARRAY[]::text[],
  min_attendance_pct numeric(5,2) CHECK (min_attendance_pct IS NULL OR min_attendance_pct BETWEEN 0 AND 100),
  fee_clearance text NOT NULL DEFAULT 'block' CHECK (fee_clearance IN ('block', 'warn', 'allow')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_mobility_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN (
    'promote', 'repeat', 'double_promote', 'demote', 'conditional_promote',
    'internal_transfer', 'withdraw', 'graduate', 'readmit'
  )),
  target_class_id uuid REFERENCES public.classes(id),
  target_session text,
  target_shift text,
  effective_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'committed', 'cancelled')),
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS student_mobility_one_open_request
  ON public.student_mobility_requests (student_id)
  WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS student_mobility_requests_school_status
  ON public.student_mobility_requests (school_id, status, effective_at);

CREATE TABLE IF NOT EXISTS public.student_mobility_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.student_mobility_requests(id) ON DELETE CASCADE,
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 3),
  approver_id uuid NOT NULL,
  approver_role text,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step),
  UNIQUE (request_id, approver_id)
);

CREATE TABLE IF NOT EXISTS public.student_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  section_id uuid REFERENCES public.school_sections(id) ON DELETE SET NULL,
  shift text,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  arm text,
  session text,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  movement_type text NOT NULL CHECK (movement_type IN (
    'enrollment', 'promote', 'repeat', 'double_promote', 'demote',
    'conditional_promote', 'internal_transfer', 'withdraw', 'graduate',
    'readmit', 'transfer_in', 'transfer_out', 'legacy_change'
  )),
  reason text NOT NULL,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_placements_one_current
  ON public.student_placements (student_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS student_placements_timeline
  ON public.student_placements (school_id, student_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.student_mobility_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.student_mobility_requests(id) ON DELETE SET NULL,
  from_placement_id uuid REFERENCES public.student_placements(id) ON DELETE SET NULL,
  to_placement_id uuid REFERENCES public.student_placements(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  reason text NOT NULL,
  effective_at timestamptz NOT NULL,
  actor_id uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_mobility_events_timeline
  ON public.student_mobility_events (school_id, student_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS public.student_mobility_finance_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.student_mobility_events(id) ON DELETE CASCADE,
  fee_id uuid NOT NULL REFERENCES public.fees(id) ON DELETE RESTRICT,
  source_placement_id uuid NOT NULL REFERENCES public.student_placements(id) ON DELETE RESTRICT,
  target_placement_id uuid NOT NULL REFERENCES public.student_placements(id) ON DELETE RESTRICT,
  outstanding_amount numeric NOT NULL CHECK (outstanding_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, fee_id)
);

CREATE TABLE IF NOT EXISTS public.student_transfer_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  source_transfer_id uuid NOT NULL UNIQUE REFERENCES public.student_transfers(id) ON DELETE RESTRICT,
  source_school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  prior_record_summary jsonb NOT NULL CHECK (jsonb_typeof(prior_record_summary) = 'object'),
  imported_by uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id)
);

CREATE OR REPLACE FUNCTION public.student_placement_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'student placement history is immutable';
  END IF;
  IF OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
     OR (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to')
     OR NEW.effective_to <= OLD.effective_from THEN
    RAISE EXCEPTION 'only an open placement may be closed once';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_placements_immutable
  BEFORE UPDATE OR DELETE ON public.student_placements
  FOR EACH ROW EXECUTE FUNCTION public.student_placement_immutable();

CREATE OR REPLACE FUNCTION public.student_mobility_class_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE r public.student_mobility_requests%ROWTYPE; v_approver uuid;
BEGIN
  IF (OLD.class_id IS DISTINCT FROM NEW.class_id
      OR OLD.current_session IS DISTINCT FROM NEW.current_session)
     AND current_setting('coregrid.mobility.commit', true) IS DISTINCT FROM 'on' THEN
    SELECT * INTO r FROM public.student_mobility_requests
     WHERE student_id = NEW.id AND school_id = NEW.school_id AND status = 'approved'
       AND target_class_id IS NOT DISTINCT FROM NEW.class_id
       AND target_session IS NOT DISTINCT FROM NEW.current_session
       AND effective_at <= now()
     FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'placement changes require an approved student mobility request'; END IF;
    IF (r.movement_type = 'repeat' AND NEW.status <> 'repeated')
       OR (r.movement_type = 'graduate' AND NEW.status <> 'graduated')
       OR (r.movement_type = 'withdraw' AND NEW.status <> 'withdrawn')
       OR (r.movement_type = 'readmit' AND NEW.status <> 'active')
       OR (r.movement_type IN ('promote', 'double_promote') AND NEW.status NOT IN ('promoted', 'active'))
       OR (r.movement_type IN ('demote', 'conditional_promote', 'internal_transfer')
           AND NEW.status NOT IN ('active', 'promoted', 'repeated')) THEN
      RAISE EXCEPTION 'student status does not match the approved movement';
    END IF;
    SELECT approver_id INTO v_approver FROM public.student_mobility_approvals
     WHERE request_id = r.id AND decision = 'approved' ORDER BY step DESC LIMIT 1;
    PERFORM set_config('coregrid.mobility.commit', 'on', true);
    PERFORM set_config('coregrid.mobility.effective_at', r.effective_at::text, true);
    PERFORM set_config('coregrid.mobility.type', r.movement_type, true);
    PERFORM set_config('coregrid.mobility.reason', r.reason, true);
    PERFORM set_config('coregrid.mobility.request_id', r.id::text, true);
    PERFORM set_config('coregrid.mobility.approver_id', v_approver::text, true);
    PERFORM set_config('coregrid.mobility.shift', coalesce(r.target_shift, ''), true);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER students_mobility_class_guard
  BEFORE UPDATE OF class_id, current_session ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_class_guard();

CREATE OR REPLACE FUNCTION public.student_mobility_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;
CREATE TRIGGER student_mobility_approvals_append_only
  BEFORE UPDATE OR DELETE ON public.student_mobility_approvals
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_append_only();
CREATE TRIGGER student_mobility_events_append_only
  BEFORE UPDATE OR DELETE ON public.student_mobility_events
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_append_only();
CREATE TRIGGER student_mobility_finance_links_append_only
  BEFORE UPDATE OR DELETE ON public.student_mobility_finance_links
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_append_only();

CREATE OR REPLACE FUNCTION public.student_mobility_finance_carryover()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.from_placement_id IS NULL OR NEW.to_placement_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.student_mobility_finance_links (
    school_id, event_id, fee_id, source_placement_id, target_placement_id, outstanding_amount
  )
  SELECT NEW.school_id, NEW.id, f.id, NEW.from_placement_id, NEW.to_placement_id,
         greatest(f.amount - coalesce(f.paid_amount, 0), 0)
    FROM public.fees f
   WHERE f.school_id = NEW.school_id AND f.student_id = NEW.student_id
     AND coalesce(f.status, 'unpaid') <> 'paid'
     AND greatest(f.amount - coalesce(f.paid_amount, 0), 0) > 0
  ON CONFLICT (event_id, fee_id) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_mobility_finance_carryover
  AFTER INSERT ON public.student_mobility_events
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_finance_carryover();

CREATE OR REPLACE FUNCTION public.student_mobility_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old public.student_placements%ROWTYPE;
  v_class public.classes%ROWTYPE;
  v_shift text;
  v_effective_at timestamptz;
  v_movement text;
  v_reason text;
  v_approver uuid;
  v_request uuid;
  v_new_placement uuid;
  v_capacity integer;
  v_count integer;
  v_balance numeric;
  v_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.class_id IS NOT DISTINCT FROM NEW.class_id
       AND OLD.current_session IS NOT DISTINCT FROM NEW.current_session
       AND OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.is_active IS NOT DISTINCT FROM NEW.is_active THEN
      RETURN NEW;
    END IF;
  END IF;

  v_effective_at := coalesce(
    nullif(current_setting('coregrid.mobility.effective_at', true), '')::timestamptz,
    statement_timestamp()
  );
  v_movement := nullif(current_setting('coregrid.mobility.type', true), '');
  v_reason := nullif(current_setting('coregrid.mobility.reason', true), '');
  v_request := nullif(current_setting('coregrid.mobility.request_id', true), '')::uuid;
  v_approver := nullif(current_setting('coregrid.mobility.approver_id', true), '')::uuid;
  v_active := coalesce(NEW.is_active, true)
    AND coalesce(NEW.status, 'active') NOT IN ('graduated', 'withdrawn', 'transferred');
  IF NEW.status = 'transferred' THEN
    SELECT coalesce(sum(greatest(f.amount - coalesce(f.paid_amount, 0), 0)), 0)
      INTO v_balance FROM public.fees f
     WHERE f.school_id = NEW.school_id AND f.student_id = NEW.id
       AND coalesce(f.status, 'unpaid') <> 'paid';
    IF coalesce((
      SELECT mr.fee_clearance FROM public.student_mobility_rules mr
       WHERE mr.school_id = NEW.school_id
    ), 'block') = 'block' AND v_balance > 0 THEN
      RAISE EXCEPTION 'outstanding fees block transfer under school policy';
    END IF;
  END IF;

  IF NEW.class_id IS NOT NULL AND v_active THEN
    SELECT * INTO v_class FROM public.classes WHERE id = NEW.class_id FOR UPDATE;
    IF v_class.id IS NULL OR v_class.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'target class is not in this school';
    END IF;
    IF v_class.campus_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.campuses c WHERE c.id = v_class.campus_id AND c.school_id = NEW.school_id
    ) THEN
      RAISE EXCEPTION 'target campus is not in this school';
    END IF;
    IF v_class.section_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_sections s WHERE s.id = v_class.section_id AND s.school_id = NEW.school_id
    ) THEN
      RAISE EXCEPTION 'target section is not in this school';
    END IF;
    SELECT sh.name INTO v_shift FROM public.school_shifts sh
     WHERE sh.id = v_class.shift_id AND sh.school_id = NEW.school_id;
    IF v_class.capacity IS NOT NULL THEN
      SELECT count(*)::integer INTO v_count FROM public.students s
       WHERE s.class_id = NEW.class_id AND s.is_active IS NOT FALSE
         AND s.id IS DISTINCT FROM NEW.id;
      IF v_count >= v_class.capacity THEN RAISE EXCEPTION 'target class is at capacity'; END IF;
    END IF;
  END IF;

  SELECT * INTO v_old FROM public.student_placements
   WHERE student_id = NEW.id AND effective_to IS NULL FOR UPDATE;
  IF v_old.id IS NOT NULL THEN
    IF v_effective_at <= v_old.effective_from THEN
      RAISE EXCEPTION 'movement effective time must follow the current placement';
    END IF;
    UPDATE public.student_placements SET effective_to = v_effective_at WHERE id = v_old.id;
  END IF;

  IF v_movement IS NULL AND TG_OP = 'INSERT' THEN
    v_movement := 'enrollment';
  ELSIF v_movement IS NULL THEN
    v_movement := CASE
      WHEN NEW.status = 'promoted' THEN 'promote'
      WHEN NEW.status = 'repeated' THEN 'repeat'
      WHEN NEW.status = 'graduated' THEN 'graduate'
      WHEN NEW.status = 'withdrawn' THEN 'withdraw'
      WHEN NEW.status = 'transferred' THEN 'transfer_out'
      WHEN OLD.class_id IS DISTINCT FROM NEW.class_id THEN 'internal_transfer'
      WHEN OLD.current_session IS DISTINCT FROM NEW.current_session THEN 'promote'
      ELSE 'legacy_change'
    END;
  END IF;
  IF v_reason IS NULL AND v_movement = 'transfer_out' THEN
    SELECT t.reason INTO v_reason FROM public.student_transfers t
     WHERE t.student_id = NEW.id AND t.school_id = NEW.school_id
     ORDER BY t.created_at DESC LIMIT 1;
  END IF;
  v_reason := coalesce(v_reason, CASE WHEN TG_OP = 'INSERT' THEN 'Initial placement' ELSE 'Existing authorized lifecycle workflow' END);
  v_approver := coalesce(v_approver, auth.uid());

  IF NEW.class_id IS NOT NULL AND v_active THEN
    INSERT INTO public.student_placements (
      school_id, student_id, campus_id, section_id, shift, class_id, arm,
      session, effective_from, movement_type, reason, approved_by, created_by
    ) VALUES (
      NEW.school_id, NEW.id, v_class.campus_id, v_class.section_id,
      coalesce(nullif(current_setting('coregrid.mobility.shift', true), ''), v_shift),
      NEW.class_id, v_class.arm, coalesce(NEW.current_session, v_class.academic_year),
      v_effective_at, v_movement, v_reason, v_approver, auth.uid()
    ) RETURNING id INTO v_new_placement;
  END IF;

  INSERT INTO public.student_mobility_events (
    school_id, student_id, request_id, from_placement_id, to_placement_id,
    movement_type, reason, effective_at, actor_id, approved_by
  ) VALUES (
    NEW.school_id, NEW.id, v_request, v_old.id, v_new_placement,
    v_movement, v_reason, v_effective_at, auth.uid(), v_approver
  );
  IF v_request IS NOT NULL THEN
    UPDATE public.student_mobility_requests
       SET status = 'committed', committed_at = now()
     WHERE id = v_request AND status = 'approved';
  END IF;
  PERFORM set_config('coregrid.mobility.commit', '', true);
  PERFORM set_config('coregrid.mobility.effective_at', '', true);
  PERFORM set_config('coregrid.mobility.type', '', true);
  PERFORM set_config('coregrid.mobility.reason', '', true);
  PERFORM set_config('coregrid.mobility.request_id', '', true);
  PERFORM set_config('coregrid.mobility.approver_id', '', true);
  PERFORM set_config('coregrid.mobility.shift', '', true);
  RETURN NEW;
END
$$;

INSERT INTO public.student_placements (
  school_id, student_id, campus_id, section_id, shift, class_id, arm, session,
  effective_from, movement_type, reason, created_by
)
SELECT st.school_id, st.id, c.campus_id, c.section_id, sh.name, c.id, c.arm,
       coalesce(st.current_session, c.academic_year),
       coalesce(st.enrollment_date::timestamptz, st.created_at, now()),
       'enrollment', 'Initial placement imported from the existing student record', NULL
  FROM public.students st
  JOIN public.classes c ON c.id = st.class_id AND c.school_id = st.school_id
  LEFT JOIN public.school_shifts sh ON sh.id = c.shift_id AND sh.school_id = st.school_id
 WHERE st.class_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.student_placements p WHERE p.student_id = st.id);

CREATE TRIGGER students_mobility_snapshot
  AFTER INSERT OR UPDATE OF class_id, current_session, status, is_active ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_snapshot();

CREATE OR REPLACE FUNCTION public.student_mobility_rules_set(
  p_required_approvals smallint DEFAULT 2,
  p_pass_mark numeric DEFAULT NULL,
  p_min_average_pct numeric DEFAULT NULL,
  p_required_subjects text[] DEFAULT ARRAY[]::text[],
  p_min_attendance_pct numeric DEFAULT NULL,
  p_fee_clearance text DEFAULT 'block',
  p_approval_roles text[] DEFAULT ARRAY[]::text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_school uuid := public.get_my_school_id();
BEGIN
  IF v_school IS NULL OR NOT public.scholar_can(v_school, 'settings.manage') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_required_approvals IS NULL OR p_required_approvals NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'approval count must be between 1 and 3'; END IF;
  IF p_pass_mark IS NOT NULL AND p_pass_mark NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'pass mark must be between 0 and 100'; END IF;
  IF p_min_average_pct IS NOT NULL AND p_min_average_pct NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'minimum average must be between 0 and 100'; END IF;
  IF p_min_attendance_pct IS NOT NULL AND p_min_attendance_pct NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'minimum attendance must be between 0 and 100'; END IF;
  IF coalesce(array_length(p_required_subjects, 1), 0) > 0 AND p_pass_mark IS NULL THEN
    RAISE EXCEPTION 'a pass mark is required when compulsory subjects are configured';
  END IF;
  IF p_fee_clearance IS NULL OR p_fee_clearance NOT IN ('block', 'warn', 'allow') THEN RAISE EXCEPTION 'invalid fee clearance policy'; END IF;
  IF coalesce(array_length(p_approval_roles, 1), 0) > 3
     OR (coalesce(array_length(p_approval_roles, 1), 0) > 0
         AND array_length(p_approval_roles, 1) <> p_required_approvals)
     OR (SELECT count(DISTINCT role_name) FROM unnest(coalesce(p_approval_roles, ARRAY[]::text[])) AS roles(role_name))
        <> coalesce(array_length(p_approval_roles, 1), 0) THEN
    RAISE EXCEPTION 'approval roles must be distinct and match the approval count';
  END IF;
  INSERT INTO public.student_mobility_rules (
    school_id, required_approvals, approval_roles, pass_mark, min_average_pct, required_subjects,
    min_attendance_pct, fee_clearance, updated_by
  ) VALUES (
    v_school, p_required_approvals, coalesce(p_approval_roles, ARRAY[]::text[]), p_pass_mark, p_min_average_pct,
    coalesce(p_required_subjects, ARRAY[]::text[]), p_min_attendance_pct,
    p_fee_clearance, auth.uid()
  )
  ON CONFLICT (school_id) DO UPDATE
    SET required_approvals = EXCLUDED.required_approvals,
    approval_roles = EXCLUDED.approval_roles,
        pass_mark = EXCLUDED.pass_mark,
        min_average_pct = EXCLUDED.min_average_pct,
        required_subjects = EXCLUDED.required_subjects,
        min_attendance_pct = EXCLUDED.min_attendance_pct,
        fee_clearance = EXCLUDED.fee_clearance,
        updated_by = EXCLUDED.updated_by, updated_at = now();
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_request(
  p_student uuid,
  p_target_class uuid,
  p_movement_type text,
  p_reason text,
  p_target_session text DEFAULT NULL,
  p_target_shift text DEFAULT NULL,
  p_effective_at timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  s public.students%ROWTYPE;
  v_school uuid := public.get_my_school_id();
  v_id uuid;
  v_target_session text;
  v_exit boolean := p_movement_type IN ('withdraw', 'graduate');
BEGIN
  IF v_school IS NULL OR NOT public.scholar_can(v_school, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_movement_type IS NULL OR p_movement_type NOT IN ('promote', 'repeat', 'double_promote', 'demote', 'conditional_promote',
      'internal_transfer', 'withdraw', 'graduate', 'readmit') THEN
    RAISE EXCEPTION 'unsupported movement type';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'give a reason (at least 5 characters)'; END IF;
  IF (p_target_class IS NULL) <> v_exit THEN RAISE EXCEPTION 'target class is required except for withdrawal or graduation'; END IF;
  SELECT * INTO s FROM public.students WHERE id = p_student AND school_id = v_school FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'student is not in this organization' USING ERRCODE = '42501'; END IF;
  IF p_movement_type = 'readmit' AND s.is_active IS NOT FALSE THEN RAISE EXCEPTION 'only an inactive student can be readmitted'; END IF;
  IF p_movement_type <> 'readmit' AND s.is_active IS FALSE THEN RAISE EXCEPTION 'student is not active'; END IF;
  IF p_target_class IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.classes c WHERE c.id = p_target_class AND c.school_id = v_school
  ) THEN RAISE EXCEPTION 'target class is not in this organization' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(p_target_session, c.academic_year, s.current_session) INTO v_target_session
    FROM public.classes c WHERE c.id = p_target_class AND c.school_id = v_school;
  IF p_target_class IS NULL THEN v_target_session := coalesce(p_target_session, s.current_session); END IF;
  IF p_target_shift IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.classes c
    JOIN public.school_shifts sh ON sh.school_id = c.school_id
      AND sh.campus_id IS NOT DISTINCT FROM c.campus_id
      AND lower(sh.name) = lower(btrim(p_target_shift))
      AND c.shift_id = sh.id
    WHERE c.id = p_target_class AND c.school_id = v_school
  ) THEN RAISE EXCEPTION 'target shift is not assigned to the destination class'; END IF;
  IF p_effective_at IS NULL THEN RAISE EXCEPTION 'effective date is required'; END IF;
  IF p_effective_at < now() THEN RAISE EXCEPTION 'movement cannot be backdated'; END IF;
  IF p_target_class IS NOT DISTINCT FROM s.class_id
     AND v_target_session IS NOT DISTINCT FROM s.current_session
     AND CASE p_movement_type
       WHEN 'promote' THEN 'promoted'
       WHEN 'double_promote' THEN 'promoted'
       WHEN 'repeat' THEN 'repeated'
       WHEN 'withdraw' THEN 'withdrawn'
       WHEN 'graduate' THEN 'graduated'
       ELSE 'active'
     END IS NOT DISTINCT FROM s.status
     AND (p_movement_type NOT IN ('withdraw', 'graduate')) = coalesce(s.is_active, true) THEN
    RAISE EXCEPTION 'movement does not change the student placement or lifecycle';
  END IF;
  INSERT INTO public.student_mobility_requests (
    school_id, student_id, movement_type, target_class_id, target_session,
    target_shift, effective_at, reason, requested_by
  ) VALUES (
    v_school, s.id, p_movement_type, p_target_class, v_target_session,
    nullif(btrim(p_target_shift), ''), p_effective_at, btrim(p_reason), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_approve(
  p_request uuid,
  p_decision text DEFAULT 'approved',
  p_reason text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r public.student_mobility_requests%ROWTYPE;
  v_required integer;
  v_count integer;
  v_step integer;
  v_role text;
  v_roles text[];
  v_school uuid := public.get_my_school_id();
BEGIN
  SELECT * INTO r FROM public.student_mobility_requests WHERE id = p_request FOR UPDATE;
  IF r.id IS NULL OR r.school_id IS DISTINCT FROM v_school
     OR NOT public.scholar_can(r.school_id, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'request is already %', r.status; END IF;
  IF r.requested_by = auth.uid() THEN RAISE EXCEPTION 'requester cannot approve their own movement'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid approval decision'; END IF;
  IF p_decision = 'rejected' AND coalesce(length(btrim(p_reason)), 0) < 5 THEN
    RAISE EXCEPTION 'a rejection reason is required';
  END IF;
  SELECT count(*)::integer, coalesce(max(step), 0)::integer
    INTO v_count, v_step FROM public.student_mobility_approvals
   WHERE request_id = r.id AND decision = 'approved';
  IF EXISTS (SELECT 1 FROM public.student_mobility_approvals WHERE request_id = r.id AND approver_id = auth.uid()) THEN
    RAISE EXCEPTION 'approver has already acted on this request';
  END IF;
  SELECT required_approvals, approval_roles INTO v_required, v_roles
    FROM public.student_mobility_rules WHERE school_id = r.school_id;
  v_required := coalesce(v_required, 2);
  IF coalesce(array_length(v_roles, 1), 0) > 0 THEN
    IF v_step >= array_length(v_roles, 1) THEN RAISE EXCEPTION 'approval chain is already complete'; END IF;
    v_role := public.my_active_role();
    IF v_role IS DISTINCT FROM v_roles[v_step + 1] THEN
      RAISE EXCEPTION 'approval requires role %', v_roles[v_step + 1];
    END IF;
  ELSE
    v_role := public.my_active_role();
  END IF;
  IF p_decision = 'rejected' THEN
    INSERT INTO public.student_mobility_approvals (
      school_id, request_id, step, approver_id, approver_role, decision, reason
    ) VALUES (r.school_id, r.id, (v_step + 1)::smallint, auth.uid(), v_role, 'rejected', btrim(p_reason));
    UPDATE public.student_mobility_requests SET status = 'rejected' WHERE id = r.id;
    RETURN 'rejected';
  END IF;
  IF v_count >= v_required THEN RAISE EXCEPTION 'approval chain is already complete'; END IF;
  INSERT INTO public.student_mobility_approvals (
    school_id, request_id, step, approver_id, approver_role, decision
  ) VALUES (r.school_id, r.id, (v_step + 1)::smallint, auth.uid(), v_role, 'approved');
  IF v_count + 1 >= v_required THEN
    UPDATE public.student_mobility_requests SET status = 'approved' WHERE id = r.id;
    RETURN 'approved';
  END IF;
  RETURN 'pending';
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_cancel(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.student_mobility_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.student_mobility_requests WHERE id = p_request FOR UPDATE;
  IF r.id IS NULL OR r.school_id IS DISTINCT FROM public.get_my_school_id()
     OR NOT public.scholar_can(r.school_id, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF r.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'request is already %', r.status; END IF;
  IF r.effective_at <= now() THEN RAISE EXCEPTION 'movement can only be cancelled before its effective date'; END IF;
  UPDATE public.student_mobility_requests SET status = 'cancelled' WHERE id = r.id;
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_commit(p_request uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r public.student_mobility_requests%ROWTYPE;
  s public.students%ROWTYPE;
  v_rules public.student_mobility_rules%ROWTYPE;
  v_approver uuid;
  v_school uuid := public.get_my_school_id();
  v_session text;
  v_average numeric;
  v_subject_score numeric;
  v_attendance numeric;
  v_balance numeric;
  v_period_start date;
  v_period_end date;
  v_subject text;
BEGIN
  SELECT * INTO r FROM public.student_mobility_requests WHERE id = p_request FOR UPDATE;
  IF r.id IS NULL OR r.school_id IS DISTINCT FROM v_school
     OR NOT public.scholar_can(r.school_id, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'movement requires all approvals before commit'; END IF;
  IF r.effective_at > now() THEN RAISE EXCEPTION 'movement is not effective yet'; END IF;
  SELECT * INTO s FROM public.students WHERE id = r.student_id AND school_id = r.school_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'student is not in this organization' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_rules FROM public.student_mobility_rules WHERE school_id = r.school_id;
  v_session := coalesce(s.current_session, (
    SELECT c.academic_year FROM public.classes c WHERE c.id = s.class_id AND c.school_id = s.school_id
  ));
  IF r.movement_type IN ('promote', 'double_promote', 'conditional_promote') THEN
    IF v_rules.min_average_pct IS NOT NULL THEN
      SELECT avg(g.total_score) INTO v_average FROM public.grades g
       WHERE g.school_id = r.school_id AND g.student_id = s.id AND g.academic_year = v_session;
      IF v_average IS NULL OR v_average < v_rules.min_average_pct THEN
        RAISE EXCEPTION 'student average is missing or below the approved mobility threshold';
      END IF;
    END IF;
    FOREACH v_subject IN ARRAY coalesce(v_rules.required_subjects, ARRAY[]::text[]) LOOP
      SELECT max(g.total_score) INTO v_subject_score FROM public.grades g
       WHERE g.school_id = r.school_id AND g.student_id = s.id
         AND g.academic_year = v_session AND g.subject = v_subject;
      IF v_subject_score IS NULL OR v_subject_score < v_rules.pass_mark THEN
        RAISE EXCEPTION 'compulsory subject % is missing or below the approved pass mark', v_subject;
      END IF;
    END LOOP;
    IF v_rules.min_attendance_pct IS NOT NULL THEN
      SELECT min(ap.starts_on), max(ap.ends_on) INTO v_period_start, v_period_end
        FROM public.academic_periods ap WHERE ap.school_id = r.school_id AND ap.session = v_session;
      IF v_period_start IS NULL OR v_period_end IS NULL THEN
        RAISE EXCEPTION 'attendance period is unknown; promotion cannot be evaluated';
      END IF;
      SELECT 100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late'))
             / nullif(count(*) FILTER (WHERE a.status <> 'excused'), 0)
        INTO v_attendance FROM public.attendance a
       WHERE a.school_id = r.school_id AND a.student_id = s.id
         AND a.date BETWEEN v_period_start AND v_period_end;
      IF v_attendance IS NULL OR v_attendance < v_rules.min_attendance_pct THEN
        RAISE EXCEPTION 'attendance is missing or below the approved mobility threshold';
      END IF;
    END IF;
  END IF;
  SELECT coalesce(sum(greatest(f.amount - coalesce(f.paid_amount, 0), 0)), 0)
    INTO v_balance FROM public.fees f
   WHERE f.school_id = r.school_id AND f.student_id = s.id AND coalesce(f.status, 'unpaid') <> 'paid';
  IF coalesce(v_rules.fee_clearance, 'block') = 'block' AND v_balance > 0 THEN
    RAISE EXCEPTION 'outstanding fees block student movement under school policy';
  END IF;
  SELECT approver_id INTO v_approver FROM public.student_mobility_approvals
   WHERE request_id = r.id AND decision = 'approved' ORDER BY step DESC LIMIT 1;
  PERFORM set_config('coregrid.mobility.effective_at', r.effective_at::text, true);
  PERFORM set_config('coregrid.mobility.type', r.movement_type, true);
  PERFORM set_config('coregrid.mobility.reason', r.reason, true);
  PERFORM set_config('coregrid.mobility.request_id', r.id::text, true);
  PERFORM set_config('coregrid.mobility.approver_id', v_approver::text, true);
  PERFORM set_config('coregrid.mobility.shift', coalesce(r.target_shift, ''), true);
  PERFORM set_config('coregrid.mobility.commit', 'on', true);
  UPDATE public.students SET
    class_id = r.target_class_id,
    current_session = coalesce(r.target_session, current_session),
    status = CASE r.movement_type
      WHEN 'promote' THEN 'promoted'
      WHEN 'repeat' THEN 'repeated'
      WHEN 'double_promote' THEN 'promoted'
      WHEN 'demote' THEN 'active'
      WHEN 'conditional_promote' THEN 'active'
      WHEN 'withdraw' THEN 'withdrawn'
      WHEN 'graduate' THEN 'graduated'
      WHEN 'readmit' THEN 'active'
      ELSE 'active'
    END,
    is_active = r.movement_type NOT IN ('withdraw', 'graduate'),
    status_changed_at = now(),
    graduated_at = CASE WHEN r.movement_type = 'graduate' THEN now() ELSE graduated_at END
  WHERE id = r.student_id AND school_id = r.school_id;
  UPDATE public.student_mobility_requests
     SET policy_snapshot = jsonb_build_object(
           'session', v_session, 'average_pct', v_average, 'attendance_pct', v_attendance,
           'outstanding_balance', v_balance, 'fee_clearance', coalesce(v_rules.fee_clearance, 'block'),
           'fee_warning', coalesce(v_rules.fee_clearance, 'block') = 'warn' AND v_balance > 0
         )
   WHERE id = r.id;
  RETURN r.id;
END
$$;

CREATE OR REPLACE FUNCTION public.student_move_class(p_student uuid, p_class uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN public.student_mobility_request(
    p_student, p_class, 'internal_transfer', p_reason, NULL, NULL, now()
  );
END
$$;

CREATE OR REPLACE FUNCTION public.student_transfer_import(
  p_code text,
  p_target_class uuid,
  p_admission_number text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  t public.student_transfers%ROWTYPE;
  source_student public.students%ROWTYPE;
  destination_class public.classes%ROWTYPE;
  v_school uuid := public.get_my_school_id();
  v_student uuid;
  v_summary jsonb;
BEGIN
  IF v_school IS NULL OR NOT public.scholar_can(v_school, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF coalesce(length(btrim(p_admission_number)), 0) < 2 THEN
    RAISE EXCEPTION 'destination admission number is required';
  END IF;
  SELECT * INTO t FROM public.student_transfers
   WHERE code = upper(btrim(p_code)) FOR UPDATE;
  IF t.id IS NULL OR t.status <> 'claimed' OR t.claimed_by_school IS DISTINCT FROM v_school
     OR NOT t.parent_consent THEN
    RAISE EXCEPTION 'consented transfer is not available for import' USING ERRCODE = '42501';
  END IF;
  SELECT student_id INTO v_student FROM public.student_transfer_imports
   WHERE source_transfer_id = t.id AND school_id = v_school;
  IF v_student IS NOT NULL THEN RETURN v_student; END IF;
  IF t.expires_at < now() THEN RAISE EXCEPTION 'transfer code has expired'; END IF;
  IF t.school_id = v_school THEN RAISE EXCEPTION 'source and destination organizations must differ'; END IF;
  SELECT * INTO source_student FROM public.students
   WHERE id = t.student_id AND school_id = t.school_id;
  SELECT * INTO destination_class FROM public.classes
   WHERE id = p_target_class AND school_id = v_school;
  IF source_student.id IS NULL OR destination_class.id IS NULL THEN
    RAISE EXCEPTION 'source record or destination class is unavailable';
  END IF;
  SELECT jsonb_build_object(
      'subjects_graded', count(DISTINCT g.subject),
      'published_results', count(*) FILTER (WHERE g.is_published IS TRUE),
      'source_session', source_student.current_session,
      'source_level', source_student.current_level,
      'source_class', (SELECT c.name FROM public.classes c WHERE c.id = t.prev_class AND c.school_id = t.school_id)
    ) INTO v_summary
    FROM public.grades g
   WHERE g.student_id = source_student.id AND g.school_id = source_student.school_id;

  PERFORM set_config('coregrid.mobility.type', 'transfer_in', true);
  PERFORM set_config('coregrid.mobility.reason', 'Consent-based transfer import', true);
  PERFORM set_config('coregrid.mobility.approver_id', auth.uid()::text, true);
  INSERT INTO public.students (
    school_id, user_id, admission_number, class_id, date_of_birth, gender,
    previous_school, enrollment_date, is_active, status, current_level, programme,
    current_session
  ) VALUES (
    v_school, source_student.user_id, btrim(p_admission_number), destination_class.id,
    source_student.date_of_birth, source_student.gender,
    (SELECT name FROM public.schools WHERE id = t.school_id),
    current_date, true, 'active', source_student.current_level, source_student.programme,
    destination_class.academic_year
  ) RETURNING id INTO v_student;
  INSERT INTO public.student_transfer_imports (
    school_id, source_transfer_id, source_school_id, student_id, prior_record_summary, imported_by
  ) VALUES (v_school, t.id, t.school_id, v_student, coalesce(v_summary, '{}'::jsonb), auth.uid());
  RETURN v_student;
END
$$;

DO $$
DECLARE t text; v_permission text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_mobility_rules', 'student_mobility_requests',
    'student_mobility_approvals', 'student_placements', 'student_mobility_events',
    'student_mobility_finance_links', 'student_transfer_imports'
  ] LOOP
    v_permission := CASE
      WHEN t = 'student_mobility_rules' OR t = 'student_placements' THEN 'students.view'
      WHEN t = 'student_mobility_finance_links' THEN 'fees.view'
      ELSE 'students.transfer'
    END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
    EXECUTE format('CREATE POLICY %1$s_read ON public.%1$I FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() AND public.scholar_can(school_id, %L))', t, v_permission);
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.student_placement_immutable(),
  public.student_mobility_class_guard(), public.student_mobility_append_only(),
  public.student_mobility_snapshot(), public.student_mobility_finance_carryover(),
  public.student_mobility_rules_set(smallint, numeric, numeric, text[], numeric, text, text[]),
  public.student_mobility_request(uuid, uuid, text, text, text, text, timestamptz),
  public.student_mobility_approve(uuid, text, text),
  public.student_mobility_cancel(uuid), public.student_mobility_commit(uuid),
  public.student_move_class(uuid, uuid, text),
  public.student_transfer_import(text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_mobility_rules_set(smallint, numeric, numeric, text[], numeric, text, text[]),
  public.student_mobility_request(uuid, uuid, text, text, text, text, timestamptz),
  public.student_mobility_approve(uuid, text, text),
  public.student_mobility_cancel(uuid), public.student_mobility_commit(uuid),
  public.student_move_class(uuid, uuid, text),
  public.student_transfer_import(text, uuid, text) TO authenticated;

COMMIT;
