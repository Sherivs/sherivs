-- SV1-MOBILITY follow-up: scoped notifications and placement-based fee allocation.
-- This file is authored for review only; it must not be applied without separate authorization.
BEGIN;

CREATE TABLE IF NOT EXISTS public.student_mobility_fee_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.student_mobility_events(id) ON DELETE CASCADE,
  fee_id uuid NOT NULL REFERENCES public.fees(id) ON DELETE RESTRICT,
  placement_id uuid NOT NULL REFERENCES public.student_placements(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  service_seconds bigint NOT NULL CHECK (service_seconds >= 0),
  period_seconds bigint NOT NULL CHECK (period_seconds > 0),
  fee_amount numeric NOT NULL CHECK (fee_amount >= 0),
  paid_amount numeric NOT NULL CHECK (paid_amount >= 0),
  outstanding_amount numeric NOT NULL CHECK (outstanding_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, fee_id, placement_id),
  CHECK (period_end >= period_start),
  CHECK (service_seconds <= period_seconds)
);
CREATE INDEX IF NOT EXISTS student_mobility_fee_allocations_timeline
  ON public.student_mobility_fee_allocations (school_id, fee_id, event_id);

CREATE OR REPLACE FUNCTION public.student_mobility_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;
CREATE TRIGGER student_mobility_fee_allocations_append_only
  BEFORE UPDATE OR DELETE ON public.student_mobility_fee_allocations
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_append_only();

CREATE OR REPLACE FUNCTION public.student_mobility_fee_proration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_fee record;
  v_placement record;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_segment_start timestamptz;
  v_segment_end timestamptz;
  v_period_seconds bigint;
  v_service_seconds bigint;
  v_total_service_seconds bigint;
  v_placement_count integer;
  v_placement_index integer;
  v_allocated_fee numeric;
  v_allocated_paid numeric;
  v_total_fee numeric;
  v_total_paid numeric;
  v_segment_fee numeric;
  v_segment_paid numeric;
BEGIN
  IF NEW.from_placement_id IS NULL OR NEW.to_placement_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_fee IN
    SELECT f.id, f.amount, f.paid_amount, ap.starts_on, ap.ends_on
      FROM public.fees f
      JOIN LATERAL (
        SELECT period.starts_on, period.ends_on
          FROM public.academic_periods period
         WHERE period.school_id = f.school_id
           AND period.session = f.academic_year
           AND lower(regexp_replace(btrim(period.name), '[^a-z0-9]+', '', 'g'))
               = lower(regexp_replace(btrim(f.term), '[^a-z0-9]+', '', 'g'))
         ORDER BY period.ordinal
         LIMIT 1
      ) ap ON true
     WHERE f.school_id = NEW.school_id
       AND f.student_id = NEW.student_id
       AND nullif(btrim(f.academic_year), '') IS NOT NULL
       AND nullif(btrim(f.term), '') IS NOT NULL
  LOOP
    v_period_start := v_fee.starts_on::timestamp AT TIME ZONE 'UTC';
    v_period_end := (v_fee.ends_on + 1)::timestamp AT TIME ZONE 'UTC';
    v_period_seconds := extract(epoch FROM (v_period_end - v_period_start))::bigint;
    IF v_period_seconds <= 0 THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.student_placements first_placement
        JOIN public.student_placements second_placement
          ON first_placement.id < second_placement.id
         AND first_placement.school_id = second_placement.school_id
         AND first_placement.student_id = second_placement.student_id
       WHERE first_placement.school_id = NEW.school_id
         AND first_placement.student_id = NEW.student_id
         AND greatest(first_placement.effective_from, second_placement.effective_from, v_period_start)
             < least(
                 coalesce(first_placement.effective_to, v_period_end),
                 coalesce(second_placement.effective_to, v_period_end),
                 v_period_end
               )
    ) THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer
      INTO v_placement_count
      FROM public.student_placements placement
     WHERE placement.school_id = NEW.school_id
       AND placement.student_id = NEW.student_id
       AND placement.effective_from < v_period_end
       AND coalesce(placement.effective_to, v_period_end) > v_period_start;
    IF v_placement_count = 0 THEN
      CONTINUE;
    END IF;
    SELECT coalesce(
      sum(extract(epoch FROM (
        least(coalesce(placement.effective_to, v_period_end), v_period_end)
        - greatest(placement.effective_from, v_period_start)
      ))::bigint),
      0
    )
      INTO v_total_service_seconds
      FROM public.student_placements placement
     WHERE placement.school_id = NEW.school_id
       AND placement.student_id = NEW.student_id
       AND placement.effective_from < v_period_end
       AND coalesce(placement.effective_to, v_period_end) > v_period_start;

    v_total_fee := greatest(coalesce(v_fee.amount, 0), 0);
    v_total_paid := least(v_total_fee, greatest(coalesce(v_fee.paid_amount, 0), 0));
    v_allocated_fee := 0;
    v_allocated_paid := 0;
    v_placement_index := 0;

    FOR v_placement IN
      SELECT placement.id, placement.effective_from, placement.effective_to
        FROM public.student_placements placement
       WHERE placement.school_id = NEW.school_id
         AND placement.student_id = NEW.student_id
         AND placement.effective_from < v_period_end
         AND coalesce(placement.effective_to, v_period_end) > v_period_start
       ORDER BY placement.effective_from, placement.id
    LOOP
      v_placement_index := v_placement_index + 1;
      v_segment_start := greatest(v_placement.effective_from, v_period_start);
      v_segment_end := least(coalesce(v_placement.effective_to, v_period_end), v_period_end);
      v_service_seconds := greatest(
        extract(epoch FROM (v_segment_end - v_segment_start))::bigint,
        0
      );
      IF v_placement_index = v_placement_count
         AND v_total_service_seconds = v_period_seconds THEN
        v_segment_fee := greatest(v_total_fee - v_allocated_fee, 0);
        v_segment_paid := greatest(v_total_paid - v_allocated_paid, 0);
      ELSE
        v_segment_fee := least(
          greatest(v_total_fee - v_allocated_fee, 0),
          round(v_total_fee * v_service_seconds / v_period_seconds, 2)
        );
        v_segment_paid := least(
          greatest(v_total_paid - v_allocated_paid, 0),
          round(v_total_paid * v_service_seconds / v_period_seconds, 2)
        );
      END IF;
      INSERT INTO public.student_mobility_fee_allocations (
        school_id, event_id, fee_id, placement_id, period_start, period_end,
        service_seconds, period_seconds, fee_amount, paid_amount, outstanding_amount
      ) VALUES (
        NEW.school_id, NEW.id, v_fee.id, v_placement.id, v_fee.starts_on, v_fee.ends_on,
        v_service_seconds, v_period_seconds, v_segment_fee, v_segment_paid,
        greatest(v_segment_fee - v_segment_paid, 0)
      )
      ON CONFLICT (event_id, fee_id, placement_id) DO NOTHING;
      v_allocated_fee := v_allocated_fee + v_segment_fee;
      v_allocated_paid := v_allocated_paid + v_segment_paid;
    END LOOP;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE TRIGGER student_mobility_fee_proration
  AFTER INSERT ON public.student_mobility_events
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_fee_proration();

CREATE OR REPLACE FUNCTION public.student_mobility_notify_approvers(
  p_school uuid,
  p_requester uuid,
  p_title text,
  p_message text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_roles text[];
BEGIN
  SELECT coalesce(rules.approval_roles, ARRAY[]::text[])
    INTO v_roles
    FROM public.student_mobility_rules rules
   WHERE rules.school_id = p_school;

  INSERT INTO public.notifications (school_id, user_id, title, message, type, action_url)
  SELECT p_school, user_record.id, p_title, p_message, 'mobility', '/home/s/nav.students'
    FROM public.users user_record
   WHERE user_record.school_id = p_school
     AND user_record.is_active IS TRUE
     AND user_record.id IS DISTINCT FROM p_requester
     AND (
       (coalesce(array_length(v_roles, 1), 0) > 0
        AND lower(user_record.role) = ANY (
          SELECT lower(role_name) FROM unnest(v_roles) AS role_names(role_name)
        ))
       OR (coalesce(array_length(v_roles, 1), 0) = 0
           AND user_record.role IN ('admin', 'principal'))
     );
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_request_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_title text;
  v_message text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (school_id, user_id, title, message, type, action_url)
    SELECT NEW.school_id, requester.id, 'Movement request submitted',
           'Your student movement request was submitted for human review.',
           'mobility', '/home/s/nav.students'
      FROM public.users requester
     WHERE requester.id = NEW.requested_by
       AND requester.school_id = NEW.school_id;
    PERFORM public.student_mobility_notify_approvers(
      NEW.school_id, NEW.requested_by, 'Movement request needs review',
      'A student movement request is waiting for an authorized human review.'
    );
    RETURN NEW;
  END IF;

  IF NEW.effective_at IS DISTINCT FROM OLD.effective_at THEN
    INSERT INTO public.notifications (school_id, user_id, title, message, type, action_url)
    SELECT NEW.school_id, requester.id, 'Movement effective date changed',
           'The effective date on your student movement request has changed.',
           'mobility', '/home/s/nav.students'
      FROM public.users requester
     WHERE requester.id = NEW.requested_by
       AND requester.school_id = NEW.school_id;
    PERFORM public.student_mobility_notify_approvers(
      NEW.school_id, NEW.requested_by, 'Movement effective date changed',
      'The effective date on a student movement request has changed.'
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_title := CASE NEW.status
      WHEN 'approved' THEN 'Movement request approved'
      WHEN 'rejected' THEN 'Movement request rejected'
      WHEN 'committed' THEN 'Student movement recorded'
      WHEN 'cancelled' THEN 'Movement request cancelled'
      ELSE 'Movement request updated'
    END;
    v_message := CASE NEW.status
      WHEN 'approved' THEN 'All required human approvals were recorded for your movement request.'
      WHEN 'rejected' THEN 'Your student movement request was rejected by an authorized reviewer.'
      WHEN 'committed' THEN 'The approved movement is now recorded in the student placement history.'
      WHEN 'cancelled' THEN 'Your student movement request was cancelled.'
      ELSE 'The status of your student movement request changed.'
    END;
    INSERT INTO public.notifications (school_id, user_id, title, message, type, action_url)
    SELECT NEW.school_id, requester.id, v_title, v_message, 'mobility', '/home/s/nav.students'
      FROM public.users requester
     WHERE requester.id = NEW.requested_by
       AND requester.school_id = NEW.school_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_mobility_request_notification
  AFTER INSERT OR UPDATE OF status, effective_at ON public.student_mobility_requests
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_request_notification();

CREATE OR REPLACE FUNCTION public.student_mobility_reschedule(
  p_request uuid,
  p_effective_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.student_mobility_requests%ROWTYPE;
  v_school uuid := public.get_my_school_id();
BEGIN
  SELECT * INTO v_request
    FROM public.student_mobility_requests
   WHERE id = p_request
   FOR UPDATE;
  IF v_request.id IS NULL
     OR v_request.school_id IS DISTINCT FROM v_school
     OR NOT public.scholar_can(v_school, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_request.requested_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'only the requester may change the effective date' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'pending'
     OR p_effective_at IS NULL
     OR p_effective_at <= now()
     OR EXISTS (
       SELECT 1
         FROM public.student_mobility_approvals approval
        WHERE approval.request_id = v_request.id
     ) THEN
    RAISE EXCEPTION 'only a future, unapproved pending request may be rescheduled';
  END IF;
  UPDATE public.student_mobility_requests
     SET effective_at = p_effective_at
   WHERE id = v_request.id;
END
$$;

CREATE OR REPLACE FUNCTION public.student_mobility_approval_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.student_mobility_requests%ROWTYPE;
  v_required integer;
  v_approved integer;
BEGIN
  IF NEW.decision <> 'approved' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_request
    FROM public.student_mobility_requests request_record
   WHERE request_record.id = NEW.request_id
     AND request_record.school_id = NEW.school_id;
  IF v_request.id IS NULL OR v_request.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(rules.required_approvals, 2)
    INTO v_required
    FROM public.student_mobility_rules rules
   WHERE rules.school_id = NEW.school_id;
  v_required := coalesce(v_required, 2);
  SELECT count(*)::integer INTO v_approved
    FROM public.student_mobility_approvals approval
   WHERE approval.request_id = NEW.request_id
     AND approval.decision = 'approved';
  IF v_approved < v_required THEN
    INSERT INTO public.notifications (school_id, user_id, title, message, type, action_url)
    SELECT NEW.school_id, requester.id, 'Movement approval recorded',
           'An authorized reviewer recorded an approval. Additional approvals may remain.',
           'mobility', '/home/s/nav.students'
      FROM public.users requester
     WHERE requester.id = v_request.requested_by
       AND requester.school_id = NEW.school_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_mobility_approval_notification
  AFTER INSERT ON public.student_mobility_approvals
  FOR EACH ROW EXECUTE FUNCTION public.student_mobility_approval_notification();

ALTER TABLE public.student_mobility_fee_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_mobility_fee_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_mobility_fee_allocations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.student_mobility_fee_allocations TO authenticated, service_role;
CREATE POLICY student_mobility_fee_allocations_read
  ON public.student_mobility_fee_allocations FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND public.scholar_can(school_id, 'fees.view')
  );
CREATE TRIGGER trg_student_mobility_fee_allocations_audit
  AFTER INSERT ON public.student_mobility_fee_allocations
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();

REVOKE ALL ON FUNCTION public.student_mobility_fee_proration(),
  public.student_mobility_notify_approvers(uuid, uuid, text, text),
  public.student_mobility_request_notification(),
  public.student_mobility_approval_notification(),
  public.student_mobility_reschedule(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_mobility_reschedule(uuid, timestamptz)
  TO authenticated;

COMMIT;
