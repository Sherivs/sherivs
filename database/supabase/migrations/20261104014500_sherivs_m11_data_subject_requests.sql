-- M11: tenant-scoped data-subject requests (access, rectification, portability, erasure).
-- Stacked on M12 (20261104014000): erasure is gated on the M12 legal-hold table.
-- Forward-only. Every table is tenant-owned, RLS-enabled and FORCEd. Authenticated users get
-- SELECT only; all writes go through SECURITY DEFINER functions that re-check tenant authority.
-- This migration never deletes or updates source records: erasure here is a hold-checked
-- decision record. Executing tombstones stays with M12 (see ADR-047).

DO $guard$
BEGIN
  IF to_regclass('public.retention_legal_holds') IS NULL
     OR to_regprocedure('public.retention_can_manage(uuid)') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.attendance') IS NULL THEN
    RAISE EXCEPTION 'M11 requires the M12 retention migration and the M04 tenant substrate';
  END IF;
END
$guard$;

CREATE TABLE public.dsr_settings (
  org_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE RESTRICT,
  sla_days integer NOT NULL DEFAULT 30 CHECK (sla_days BETWEEN 1 AND 365),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.dsr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  subject_ref uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('access','rectification','portability','erasure')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN
    ('received','identity_verified','erasure_blocked','erasure_cleared','completed','rejected')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sla_days integer NOT NULL CHECK (sla_days BETWEEN 1 AND 365),
  due_at timestamptz NOT NULL,
  opened_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  identity_method text CHECK (identity_method IN
    ('in_person_id','guardian_confirmation','registered_contact','other')),
  identity_verified_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  identity_verified_at timestamptz,
  closed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  closure_note text CHECK (closure_note IS NULL OR length(btrim(closure_note)) BETWEEN 3 AND 1000),
  CHECK (due_at > received_at),
  CHECK ((identity_verified_at IS NULL) = (identity_verified_by IS NULL)
     AND (identity_verified_at IS NULL) = (identity_method IS NULL)),
  CHECK (status IN ('received') OR identity_verified_at IS NOT NULL OR status = 'rejected'),
  CHECK ((status IN ('completed','rejected')) = (closed_at IS NOT NULL AND closed_by IS NOT NULL
     AND closure_note IS NOT NULL))
);
CREATE INDEX dsr_requests_org_status_due_idx ON public.dsr_requests (org_id, status, due_at);
CREATE INDEX dsr_requests_org_subject_idx ON public.dsr_requests (org_id, subject_ref);

CREATE TABLE public.dsr_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.dsr_requests(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN
    ('opened','identity_verified','erasure_blocked','erasure_cleared','exported','completed','rejected')),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX dsr_request_events_request_idx ON public.dsr_request_events (request_id, occurred_at);

-- Immutable identity of a request; no deletes; status moves only forward.
CREATE OR REPLACE FUNCTION public.dsr_request_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data-subject requests cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.subject_ref IS DISTINCT FROM OLD.subject_ref
     OR NEW.request_type IS DISTINCT FROM OLD.request_type
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.sla_days IS DISTINCT FROM OLD.sla_days
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by THEN
    RAISE EXCEPTION 'data-subject request identity and SLA clock are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('completed','rejected') THEN
    RAISE EXCEPTION 'closed data-subject requests are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER dsr_request_guard
  BEFORE UPDATE OR DELETE ON public.dsr_requests
  FOR EACH ROW EXECUTE FUNCTION public.dsr_request_guard();
CREATE TRIGGER dsr_request_no_truncate
  BEFORE TRUNCATE ON public.dsr_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER dsr_event_immutable
  BEFORE UPDATE OR DELETE ON public.dsr_request_events
  FOR EACH ROW EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER dsr_event_no_truncate
  BEFORE TRUNCATE ON public.dsr_request_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_append_only_guard();

CREATE OR REPLACE FUNCTION public.dsr_can_manage(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.retention_can_manage(p_org); $$;

CREATE OR REPLACE FUNCTION public.dsr_subject_in_tenant(p_org uuid, p_subject uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_subject AND s.school_id = p_org)
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_subject AND u.school_id = p_org);
$$;

CREATE OR REPLACE FUNCTION public.dsr_event_write(
  p_org uuid, p_request uuid, p_type text, p_detail jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.dsr_request_events (org_id, request_id, event_type, actor_id, detail)
  VALUES (p_org, p_request, p_type, auth.uid(), coalesce(p_detail, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.dsr_settings_configure(p_org uuid, p_sla_days integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.dsr_can_manage(p_org) THEN
    RAISE EXCEPTION 'tenant data-subject request management permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_sla_days IS NULL OR p_sla_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'SLA must be between 1 and 365 days' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.dsr_settings (org_id, sla_days, updated_by)
  VALUES (p_org, p_sla_days, auth.uid())
  ON CONFLICT (org_id) DO UPDATE
    SET sla_days = EXCLUDED.sla_days, updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp();
END
$$;

CREATE OR REPLACE FUNCTION public.dsr_open(p_org uuid, p_subject uuid, p_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sla integer;
  v_now timestamptz := clock_timestamp();
  v_id uuid;
BEGIN
  IF NOT public.dsr_can_manage(p_org) THEN
    RAISE EXCEPTION 'tenant data-subject request management permission is required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.dsr_subject_in_tenant(p_org, p_subject) THEN
    RAISE EXCEPTION 'subject does not belong to this tenant' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce((SELECT sla_days FROM public.dsr_settings WHERE org_id = p_org), 30) INTO v_sla;
  INSERT INTO public.dsr_requests (org_id, subject_ref, request_type, received_at, sla_days, due_at, opened_by)
  VALUES (p_org, p_subject, p_type, v_now, v_sla, v_now + make_interval(days => v_sla), auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.dsr_event_write(p_org, v_id, 'opened',
    jsonb_build_object('requestType', p_type, 'slaDays', v_sla));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.dsr_verify_identity(p_request uuid, p_method text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_req public.dsr_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.dsr_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT public.dsr_can_manage(v_req.org_id) THEN
    RAISE EXCEPTION 'data-subject request not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'received' THEN
    RAISE EXCEPTION 'identity can only be verified once, on a received request' USING ERRCODE = '22023';
  END IF;
  UPDATE public.dsr_requests
     SET status = 'identity_verified', identity_method = p_method,
         identity_verified_by = auth.uid(), identity_verified_at = clock_timestamp()
   WHERE id = p_request;
  PERFORM public.dsr_event_write(v_req.org_id, p_request, 'identity_verified',
    jsonb_build_object('method', p_method));
END
$$;

-- Holds that block erasure for this subject: tenant holds, subject holds, category holds for a
-- category in which the subject has records, and record holds on one of the subject's records.
CREATE OR REPLACE FUNCTION public.dsr_erasure_blocking_holds(p_org uuid, p_subject uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH subject_records AS (
    SELECT 'attendance'::text target_table, a.id record_id, 'attendance-activity'::text category
      FROM public.attendance a WHERE a.school_id = p_org AND a.student_id = p_subject
    UNION ALL
    SELECT 'messages', m.id, 'communication'
      FROM public.messages m WHERE m.school_id = p_org
       AND (m.sender_id = p_subject OR m.recipient_id = p_subject)
    UNION ALL
    SELECT 'fees', f.id, 'financial'
      FROM public.fees f WHERE f.school_id = p_org AND f.student_id = p_subject
    UNION ALL
    SELECT 'student_platform_fee_ledger', l.id, 'financial'
      FROM public.student_platform_fee_ledger l WHERE l.school_id = p_org AND l.student_id = p_subject
    UNION ALL
    SELECT 'staff_payroll', w.id, 'financial'
      FROM public.staff_payroll w WHERE w.school_id = p_org AND w.user_id = p_subject
  )
  SELECT coalesce(array_agg(DISTINCT h.id ORDER BY h.id), '{}'::uuid[])
    FROM public.retention_legal_holds h
   WHERE h.org_id = p_org AND h.active
     AND (h.hold_scope = 'tenant'
       OR (h.hold_scope = 'subject' AND h.subject_ref = p_subject)
       OR (h.hold_scope = 'category' AND EXISTS (
             SELECT 1 FROM subject_records r WHERE r.category = h.category))
       OR (h.hold_scope = 'record' AND EXISTS (
             SELECT 1 FROM subject_records r
              WHERE r.target_table = h.target_table AND r.record_id = h.target_record_id)));
$$;

-- Records the hold-checked decision for an erasure request. Never deletes or updates source rows.
CREATE OR REPLACE FUNCTION public.dsr_erasure_decide(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.dsr_requests%ROWTYPE;
  v_holds uuid[];
  v_status text;
BEGIN
  SELECT * INTO v_req FROM public.dsr_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT public.dsr_can_manage(v_req.org_id) THEN
    RAISE EXCEPTION 'data-subject request not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_req.request_type <> 'erasure' THEN
    RAISE EXCEPTION 'only erasure requests have an erasure decision' USING ERRCODE = '22023';
  END IF;
  IF v_req.status NOT IN ('identity_verified','erasure_blocked') THEN
    RAISE EXCEPTION 'erasure needs a verified identity and an open request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_req.org_id::text, 4812));
  v_holds := public.dsr_erasure_blocking_holds(v_req.org_id, v_req.subject_ref);
  v_status := CASE WHEN cardinality(v_holds) > 0 THEN 'erasure_blocked' ELSE 'erasure_cleared' END;
  UPDATE public.dsr_requests SET status = v_status WHERE id = p_request;
  PERFORM public.dsr_event_write(v_req.org_id, p_request, v_status,
    jsonb_build_object('holdIds', to_jsonb(v_holds)));
  RETURN jsonb_build_object('status', v_status, 'holdIds', to_jsonb(v_holds));
END
$$;

-- Machine-readable export of only this subject's records in this tenant. The audit event keeps
-- counts, never content. Counterparty ids on messages are removed.
CREATE OR REPLACE FUNCTION public.dsr_portability_export(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.dsr_requests%ROWTYPE;
  v_out jsonb;
BEGIN
  SELECT * INTO v_req FROM public.dsr_requests WHERE id = p_request;
  IF NOT FOUND OR NOT public.dsr_can_manage(v_req.org_id) THEN
    RAISE EXCEPTION 'data-subject request not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_req.request_type NOT IN ('access','portability') THEN
    RAISE EXCEPTION 'only access and portability requests can be exported' USING ERRCODE = '22023';
  END IF;
  IF v_req.status <> 'identity_verified' THEN
    RAISE EXCEPTION 'identity must be verified before export' USING ERRCODE = '22023';
  END IF;
  v_out := jsonb_build_object(
    'format', 'sherivs.dsr.export.v1',
    'subjectRef', v_req.subject_ref,
    'attendance', coalesce((SELECT jsonb_agg(to_jsonb(a) - 'school_id' ORDER BY a.date, a.id)
        FROM public.attendance a WHERE a.school_id = v_req.org_id AND a.student_id = v_req.subject_ref), '[]'::jsonb),
    'messages', coalesce((SELECT jsonb_agg(
          (to_jsonb(m) - 'school_id' - 'sender_id' - 'recipient_id')
          || jsonb_build_object('direction', CASE WHEN m.sender_id = v_req.subject_ref THEN 'sent' ELSE 'received' END)
          ORDER BY m.created_at, m.id)
        FROM public.messages m WHERE m.school_id = v_req.org_id
         AND (m.sender_id = v_req.subject_ref OR m.recipient_id = v_req.subject_ref)), '[]'::jsonb),
    'fees', coalesce((SELECT jsonb_agg(to_jsonb(f) - 'school_id' ORDER BY f.created_at, f.id)
        FROM public.fees f WHERE f.school_id = v_req.org_id AND f.student_id = v_req.subject_ref), '[]'::jsonb),
    'platformFeeLedger', coalesce((SELECT jsonb_agg(to_jsonb(l) - 'school_id' ORDER BY l.created_at, l.id)
        FROM public.student_platform_fee_ledger l
       WHERE l.school_id = v_req.org_id AND l.student_id = v_req.subject_ref), '[]'::jsonb),
    'payroll', coalesce((SELECT jsonb_agg(to_jsonb(w) - 'school_id' ORDER BY w.created_at, w.id)
        FROM public.staff_payroll w WHERE w.school_id = v_req.org_id AND w.user_id = v_req.subject_ref), '[]'::jsonb)
  );
  PERFORM public.dsr_event_write(v_req.org_id, p_request, 'exported', jsonb_build_object(
    'attendance', jsonb_array_length(v_out->'attendance'),
    'messages', jsonb_array_length(v_out->'messages'),
    'fees', jsonb_array_length(v_out->'fees'),
    'platformFeeLedger', jsonb_array_length(v_out->'platformFeeLedger'),
    'payroll', jsonb_array_length(v_out->'payroll')));
  RETURN v_out;
END
$$;

CREATE OR REPLACE FUNCTION public.dsr_close(p_request uuid, p_outcome text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_req public.dsr_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.dsr_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT public.dsr_can_manage(v_req.org_id) THEN
    RAISE EXCEPTION 'data-subject request not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('completed','rejected') THEN
    RAISE EXCEPTION 'outcome must be completed or rejected' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'a closure note is required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'completed' AND NOT (
       (v_req.request_type = 'erasure' AND v_req.status = 'erasure_cleared')
    OR (v_req.request_type <> 'erasure' AND v_req.status = 'identity_verified')) THEN
    RAISE EXCEPTION 'request is not ready to complete (erasure needs a clear hold check)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.dsr_requests
     SET status = p_outcome, closed_by = auth.uid(), closed_at = clock_timestamp(), closure_note = btrim(p_note)
   WHERE id = p_request;
  PERFORM public.dsr_event_write(v_req.org_id, p_request, p_outcome, '{}'::jsonb);
END
$$;

-- Open requests past their statutory deadline as of a given instant (default: now).
CREATE OR REPLACE FUNCTION public.dsr_overdue(p_org uuid, p_as_of timestamptz DEFAULT clock_timestamp())
RETURNS TABLE (request_id uuid, request_type text, status text, due_at timestamptz, overdue_by interval)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.dsr_can_manage(p_org) THEN
    RAISE EXCEPTION 'tenant data-subject request management permission is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.request_type, r.status, r.due_at, p_as_of - r.due_at
      FROM public.dsr_requests r
     WHERE r.org_id = p_org AND r.status NOT IN ('completed','rejected') AND r.due_at < p_as_of
     ORDER BY r.due_at, r.id;
END
$$;

ALTER TABLE public.dsr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsr_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dsr_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsr_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dsr_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsr_request_events FORCE ROW LEVEL SECURITY;

CREATE POLICY dsr_settings_read ON public.dsr_settings FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND public.can_manage_roles(org_id, 'roles.configure'));
CREATE POLICY dsr_requests_read ON public.dsr_requests FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND public.can_manage_roles(org_id, 'roles.configure'));
CREATE POLICY dsr_request_events_read ON public.dsr_request_events FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND public.can_manage_roles(org_id, 'roles.configure'));

REVOKE ALL ON public.dsr_settings, public.dsr_requests, public.dsr_request_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dsr_settings, public.dsr_requests, public.dsr_request_events TO authenticated;

REVOKE ALL ON FUNCTION
  public.dsr_request_guard(), public.dsr_can_manage(uuid), public.dsr_subject_in_tenant(uuid,uuid),
  public.dsr_event_write(uuid,uuid,text,jsonb), public.dsr_erasure_blocking_holds(uuid,uuid),
  public.dsr_settings_configure(uuid,integer), public.dsr_open(uuid,uuid,text),
  public.dsr_verify_identity(uuid,text), public.dsr_erasure_decide(uuid),
  public.dsr_portability_export(uuid), public.dsr_close(uuid,text,text),
  public.dsr_overdue(uuid,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.dsr_settings_configure(uuid,integer), public.dsr_open(uuid,uuid,text),
  public.dsr_verify_identity(uuid,text), public.dsr_erasure_decide(uuid),
  public.dsr_portability_export(uuid), public.dsr_close(uuid,text,text),
  public.dsr_overdue(uuid,timestamptz)
  TO authenticated;
