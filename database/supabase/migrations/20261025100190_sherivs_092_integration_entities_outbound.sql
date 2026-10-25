-- =============================================================================
-- SHERIVS-092 — Integration Hub: write every core entity in gradual/cutover modes, and
-- outbound write-back. Builds on SHERIVS-090. NOT APPLIED. Review only (draft PR).
--
-- Inbound writers (integration_ingest -> _integration_apply_record), each in its own
-- subtransaction so one bad row is reported on the run instead of failing the batch:
--   student      students (+ class by class_name)
--   staff        links an existing staff account (email/phone); otherwise an account invite
--   guardian     links an existing parent account + parent_student_map; otherwise an invite
--   class        classes (name + academic_year)
--   enrollment   students.class_id (K-12) or course_registrations (tertiary, approved)
--   result       grades (unique student/subject/term/year), imported UNPUBLISHED
--   fee_invoice  fees
--   payment      offline_payments (append-only) + fees.paid_amount/status; payments are immutable
-- Accounts are never created from SQL: integration_account_invites feeds the normal invite flow.
--
-- Outbound: AFTER triggers on students, grades, fees enqueue to integration_outbox only for
-- schools with an outbound-enabled integration that treats Sherivs as system of record for
-- that entity; writes made by integration_ingest itself are not echoed back.
-- Rollback: database/supabase/rollbacks/20261025100190_sherivs_092_integration_entities_outbound.sql
-- =============================================================================
BEGIN;

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS outbound_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb; -- non-secret only (base_url, outbound_url)
ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_config_no_secrets;
ALTER TABLE public.integrations ADD CONSTRAINT integrations_config_no_secrets
  CHECK (NOT (config::text ~* '"(secret|password|token|api_key|apikey|client_secret|private_key)"'));
CREATE INDEX IF NOT EXISTS integrations_outbound_idx ON public.integrations (school_id) WHERE outbound_enabled AND status = 'active';

ALTER TABLE public.external_id_map DROP CONSTRAINT IF EXISTS external_id_map_match_method_check;
ALTER TABLE public.external_id_map ADD CONSTRAINT external_id_map_match_method_check
  CHECK (match_method IN ('new','external_id','natural_key','manual','pending_account','outbound'));

CREATE TABLE IF NOT EXISTS public.integration_account_invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL,
  integration_id uuid NOT NULL,
  entity         text NOT NULL CHECK (entity IN ('staff','guardian')),
  external_id    text NOT NULL,
  full_name      text,
  email          text,
  phone          text,
  role           text NOT NULL,
  student_id     uuid REFERENCES public.students(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invited','linked','dismissed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE,
  UNIQUE (integration_id, entity, external_id)
);

CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       uuid NOT NULL,
  integration_id  uuid NOT NULL,
  entity          text NOT NULL,
  op              text NOT NULL CHECK (op IN ('upsert','delete')),
  sherivs_id      uuid NOT NULL,
  external_id     text,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','dead')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE
);
-- One pending event per row: later edits coalesce into it.
CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_pending_uq ON public.integration_outbox (integration_id, entity, sherivs_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS integration_outbox_due_idx ON public.integration_outbox (next_attempt_at) WHERE status = 'pending';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['integration_account_invites','integration_outbox'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_school_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (school_id = ANY ((SELECT public._integration_admin_schools())::uuid[]) OR (SELECT public.is_super_admin()))', t || '_school_read', t);
  END LOOP;
END $$;

-- Reference resolution inside ONE integration and ONE school. ------------------------
CREATE OR REPLACE FUNCTION public._integration_ref(p_integration uuid, p_school uuid, p_entity text, p_external text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.sherivs_id FROM public.external_id_map m
   WHERE m.integration_id = p_integration AND m.school_id = p_school AND m.entity = p_entity AND m.external_id = p_external;
$$;

CREATE OR REPLACE FUNCTION public._integration_student(p_i public.integrations, d jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid;
BEGIN
  IF nullif(d->>'student_external_id','') IS NOT NULL THEN
    s := public._integration_ref(p_i.id, p_i.school_id, 'student', d->>'student_external_id');
  END IF;
  IF s IS NULL AND nullif(d->>'admission_number','') IS NOT NULL THEN
    SELECT id INTO s FROM public.students WHERE school_id = p_i.school_id AND admission_number = d->>'admission_number' LIMIT 1;
  END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public._integration_class(p_i public.integrations, d jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c uuid;
BEGIN
  IF nullif(d->>'class_external_id','') IS NOT NULL THEN
    c := public._integration_ref(p_i.id, p_i.school_id, 'class', d->>'class_external_id');
  END IF;
  IF c IS NULL AND nullif(d->>'class_name','') IS NOT NULL THEN
    SELECT id INTO c FROM public.classes WHERE school_id = p_i.school_id AND lower(name) = lower(d->>'class_name')
      AND (d->>'academic_year' IS NULL OR academic_year = d->>'academic_year') ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN c;
END $$;

-- Apply one canonical record. Returns {id, method} or {error}. ----------------------
CREATE OR REPLACE FUNCTION public._integration_apply_record(p_i public.integrations, p_entity text, p_ext text, d jsonb, p_existing uuid, p_is_update boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s uuid := p_i.school_id; sid uuid := p_existing; method text := CASE WHEN p_existing IS NULL THEN 'new' ELSE 'external_id' END;
  st uuid; cl uuid; fee public.fees; amt numeric; crs uuid; uid uuid; role text;
BEGIN
  IF p_entity = 'student' THEN
    cl := public._integration_class(p_i, d);
    IF sid IS NULL AND nullif(d->>'admission_number','') IS NOT NULL THEN
      SELECT id INTO sid FROM public.students WHERE school_id = s AND admission_number = d->>'admission_number' LIMIT 1;
      IF sid IS NOT NULL THEN method := 'natural_key';
        IF EXISTS (SELECT 1 FROM public.external_id_map x WHERE x.integration_id = p_i.id AND x.entity = 'student' AND x.sherivs_id = sid AND x.external_id <> p_ext) THEN
          RETURN jsonb_build_object('error', 'duplicate natural key', 'conflict', true); END IF;
      END IF;
    END IF;
    IF sid IS NULL THEN
      INSERT INTO public.students (school_id, admission_number, gender, date_of_birth, state_of_origin, lga, class_id)
        VALUES (s, d->>'admission_number', d->>'gender', nullif(d->>'date_of_birth','')::date, d->>'state_of_origin', d->>'lga', cl) RETURNING id INTO sid;
    ELSE
      UPDATE public.students x SET gender = coalesce(d->>'gender', x.gender),
        date_of_birth = coalesce(nullif(d->>'date_of_birth','')::date, x.date_of_birth),
        state_of_origin = coalesce(d->>'state_of_origin', x.state_of_origin), lga = coalesce(d->>'lga', x.lga),
        class_id = coalesce(cl, x.class_id)
       WHERE x.id = sid AND x.school_id = s;
    END IF;

  ELSIF p_entity = 'class' THEN
    IF sid IS NULL THEN
      SELECT id INTO sid FROM public.classes WHERE school_id = s AND lower(name) = lower(d->>'name')
        AND academic_year IS NOT DISTINCT FROM (d->>'academic_year') LIMIT 1;
      IF sid IS NOT NULL THEN method := 'natural_key'; END IF;
    END IF;
    IF sid IS NULL THEN
      IF nullif(d->>'name','') IS NULL THEN RETURN jsonb_build_object('error', 'class name required'); END IF;
      INSERT INTO public.classes (school_id, name, grade_level, arm, academic_year)
        VALUES (s, d->>'name', d->>'level', d->>'arm', d->>'academic_year') RETURNING id INTO sid;
    ELSE
      UPDATE public.classes c SET grade_level = coalesce(d->>'level', c.grade_level), arm = coalesce(d->>'arm', c.arm)
       WHERE c.id = sid AND c.school_id = s;
    END IF;

  ELSIF p_entity IN ('staff','guardian') THEN
    role := CASE WHEN p_entity = 'guardian' THEN 'parent' ELSE coalesce(nullif(lower(d->>'role'),''), 'teacher') END;
    IF role NOT IN ('admin','principal','teacher','bursar','driver','parent') THEN role := 'teacher'; END IF;
    IF sid IS NULL THEN
      SELECT u.id INTO sid FROM public.users u
       WHERE u.school_id = s AND (CASE WHEN p_entity = 'guardian' THEN u.role = 'parent' ELSE u.role IN ('admin','principal','teacher','bursar','driver') END)
         AND ((nullif(d->>'email','') IS NOT NULL AND lower(u.email) = lower(d->>'email'))
           OR (nullif(d->>'phone','') IS NOT NULL AND u.phone = d->>'phone'))
       LIMIT 1;
      IF sid IS NOT NULL THEN method := 'natural_key'; END IF;
    END IF;
    st := CASE WHEN p_entity = 'guardian' THEN public._integration_student(p_i, d) END;
    IF sid IS NULL THEN
      INSERT INTO public.integration_account_invites (school_id, integration_id, entity, external_id, full_name, email, phone, role, student_id)
        VALUES (s, p_i.id, p_entity, p_ext, nullif(btrim(concat_ws(' ', d->>'first_name', d->>'last_name')), ''), d->>'email', d->>'phone', role, st)
        ON CONFLICT (integration_id, entity, external_id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email,
          phone = EXCLUDED.phone, role = EXCLUDED.role, student_id = coalesce(EXCLUDED.student_id, integration_account_invites.student_id), updated_at = now();
      RETURN jsonb_build_object('id', NULL, 'method', 'pending_account');
    END IF;
    IF p_entity = 'staff' THEN
      UPDATE public.users u SET phone = coalesce(u.phone, d->>'phone'), qualification = coalesce(d->>'qualification', u.qualification),
        subject_specialty = coalesce(d->>'department', u.subject_specialty) WHERE u.id = sid AND u.school_id = s;
    ELSIF st IS NOT NULL THEN
      INSERT INTO public.parent_student_map (school_id, parent_id, student_id, relationship)
        VALUES (s, sid, st, d->>'relationship') ON CONFLICT (parent_id, student_id) DO UPDATE SET relationship = coalesce(EXCLUDED.relationship, parent_student_map.relationship);
      UPDATE public.students SET parent_id = sid WHERE id = st AND school_id = s AND parent_id IS NULL;
    END IF;

  ELSIF p_entity = 'enrollment' THEN
    st := public._integration_student(p_i, d);
    IF st IS NULL THEN RETURN jsonb_build_object('error', 'unknown student'); END IF;
    IF nullif(d->>'course_code','') IS NOT NULL THEN
      SELECT id INTO crs FROM public.courses WHERE school_id = s AND upper(code) = upper(d->>'course_code') LIMIT 1;
      IF crs IS NULL THEN RETURN jsonb_build_object('error', 'unknown course'); END IF;
      INSERT INTO public.course_registrations (school_id, student_id, course_id, session, semester, status)
        VALUES (s, st, crs, d->>'session', coalesce(d->>'semester','First'), 'approved')
        ON CONFLICT (student_id, course_id, session) DO UPDATE SET semester = EXCLUDED.semester, status = 'approved'
        RETURNING id INTO sid;
    ELSE
      cl := public._integration_class(p_i, d);
      IF cl IS NULL THEN RETURN jsonb_build_object('error', 'unknown class'); END IF;
      UPDATE public.students SET class_id = cl WHERE id = st AND school_id = s;
      sid := st;
    END IF;

  ELSIF p_entity = 'result' THEN
    st := public._integration_student(p_i, d);
    IF st IS NULL THEN RETURN jsonb_build_object('error', 'unknown student'); END IF;
    IF nullif(d->>'subject','') IS NULL OR nullif(d->>'term','') IS NULL OR nullif(d->>'academic_year','') IS NULL THEN
      RETURN jsonb_build_object('error', 'subject, term and academic_year required'); END IF;
    INSERT INTO public.grades (school_id, student_id, class_id, subject, ca_score, exam_score, term, academic_year, is_published)
      VALUES (s, st, (SELECT class_id FROM public.students WHERE id = st), d->>'subject', nullif(d->>'ca_score','')::numeric,
              nullif(d->>'exam_score','')::numeric, d->>'term', d->>'academic_year', false)
      ON CONFLICT (student_id, subject, term, academic_year) DO UPDATE SET ca_score = EXCLUDED.ca_score, exam_score = EXCLUDED.exam_score
      RETURNING id INTO sid;

  ELSIF p_entity = 'fee_invoice' THEN
    st := public._integration_student(p_i, d);
    IF st IS NULL THEN RETURN jsonb_build_object('error', 'unknown student'); END IF;
    amt := nullif(d->>'amount_naira','')::numeric;
    IF amt IS NULL OR amt < 0 THEN RETURN jsonb_build_object('error', 'amount_naira required'); END IF;
    IF sid IS NULL THEN
      INSERT INTO public.fees (school_id, student_id, fee_type, amount, term, academic_year, due_date, status, paid_amount)
        VALUES (s, st, coalesce(d->>'fee_type','Tuition'), amt, d->>'term', d->>'academic_year', nullif(d->>'due_date','')::date, 'unpaid', 0)
        RETURNING id INTO sid;
    ELSE
      UPDATE public.fees f SET amount = amt, fee_type = coalesce(d->>'fee_type', f.fee_type),
        status = CASE WHEN coalesce(f.paid_amount,0) >= amt THEN 'paid' WHEN coalesce(f.paid_amount,0) > 0 THEN 'partial' ELSE 'unpaid' END
       WHERE f.id = sid AND f.school_id = s;
    END IF;

  ELSIF p_entity = 'payment' THEN
    IF p_is_update THEN RETURN jsonb_build_object('error', 'payments are immutable; record a reversal in Sherivs', 'conflict', true); END IF;
    IF nullif(d->>'invoice_external_id','') IS NULL THEN RETURN jsonb_build_object('error', 'invoice_external_id required'); END IF;
    SELECT * INTO fee FROM public.fees WHERE id = public._integration_ref(p_i.id, s, 'fee_invoice', d->>'invoice_external_id') AND school_id = s;
    IF fee.id IS NULL THEN RETURN jsonb_build_object('error', 'unknown invoice'); END IF;
    amt := nullif(d->>'amount_naira','')::numeric;
    IF amt IS NULL OR amt <= 0 THEN RETURN jsonb_build_object('error', 'amount_naira must be positive'); END IF;
    IF p_i.created_by IS NULL THEN RETURN jsonb_build_object('error', 'integration has no accountable admin'); END IF;
    INSERT INTO public.offline_payments (school_id, student_id, fee_id, academic_year, term, amount, method, receipt_no, recorded_by)
      VALUES (s, fee.student_id, fee.id, coalesce(fee.academic_year, d->>'academic_year', ''), coalesce(fee.term, d->>'term', ''), amt,
              CASE WHEN d->>'channel' IN ('cash','bank_deposit','pos','cheque') THEN d->>'channel' ELSE 'other' END,
              left(coalesce(d->>'reference', p_ext), 120), p_i.created_by)
      RETURNING id INTO sid;
    UPDATE public.fees SET paid_amount = coalesce(paid_amount, 0) + amt,
      status = CASE WHEN coalesce(paid_amount, 0) + amt >= amount THEN 'paid' ELSE 'partial' END,
      paid_at = CASE WHEN coalesce(paid_amount, 0) + amt >= amount THEN coalesce(nullif(d->>'paid_at','')::timestamptz, now()) ELSE paid_at END
     WHERE id = fee.id;

  ELSE
    RETURN jsonb_build_object('id', NULL, 'method', 'new'); -- staged only (e.g. assignment)
  END IF;
  RETURN jsonb_build_object('id', sid, 'method', method);
END $$;
REVOKE ALL ON FUNCTION public._integration_apply_record(public.integrations, text, text, jsonb, uuid, boolean),
  public._integration_ref(uuid, uuid, text, text), public._integration_student(public.integrations, jsonb),
  public._integration_class(public.integrations, jsonb) FROM PUBLIC, anon, authenticated;

-- integration_ingest v2: generic dispatcher + per-record subtransaction + echo suppression.
CREATE OR REPLACE FUNCTION public.integration_ingest(p_integration uuid, p_entity text, p_records jsonb,
  p_idempotency_key text, p_trigger text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.integrations; r public.sync_runs; rec jsonb; ext text; d jsonb; h text;
  m public.external_id_map; res jsonb; apply_core boolean;
  c_new int := 0; c_upd int := 0; c_same int := 0; c_conf int := 0; errs jsonb := '[]'::jsonb; n int;
BEGIN
  SELECT * INTO i FROM public.integrations WHERE id = p_integration;
  IF i.id IS NULL OR NOT public.scholar_can(i.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF i.status IN ('paused','disconnected') THEN RAISE EXCEPTION 'integration is %', i.status USING ERRCODE = '55000'; END IF;
  IF p_entity NOT IN ('student','staff','guardian','class','enrollment','result','fee_invoice','payment','assignment') THEN
    RAISE EXCEPTION 'unknown entity %', p_entity USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN RAISE EXCEPTION 'records must be an array' USING ERRCODE = '22023'; END IF;
  n := jsonb_array_length(p_records);

  SELECT * INTO r FROM public.sync_runs WHERE integration_id = i.id AND idempotency_key = p_idempotency_key;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object('run_id', r.id, 'replayed', true, 'status', r.status, 'created', r.created, 'updated', r.updated, 'unchanged', r.unchanged);
  END IF;

  IF n > i.max_records_per_run OR (SELECT count(*) FROM public.sync_runs WHERE integration_id = i.id AND started_at > now() - interval '1 day') >= i.max_runs_per_day THEN
    INSERT INTO public.sync_runs (school_id, integration_id, entity, trigger, idempotency_key, status, received, finished_at, errors)
      VALUES (i.school_id, i.id, p_entity, p_trigger, p_idempotency_key, 'rejected', n, now(), '[{"error":"limit exceeded"}]') RETURNING * INTO r;
    PERFORM public._integration_audit(i.school_id, i.id, 'run_rejected', jsonb_build_object('run', r.id, 'received', n));
    RETURN jsonb_build_object('run_id', r.id, 'status', 'rejected');
  END IF;

  INSERT INTO public.sync_runs (school_id, integration_id, entity, trigger, idempotency_key, received)
    VALUES (i.school_id, i.id, p_entity, p_trigger, p_idempotency_key, n) RETURNING * INTO r;
  apply_core := i.mode <> 'mirror' AND coalesce(i.system_of_record->>p_entity, 'external') = 'external';
  PERFORM set_config('sherivs.integration_ingest', i.id::text, true); -- no outbound echo of our own writes

  FOR rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    ext := rec->>'external_id'; d := coalesce(rec->'data', '{}'::jsonb);
    IF ext IS NULL OR length(ext) = 0 OR length(ext) > 200 THEN
      errs := errs || jsonb_build_object('error', 'missing external_id'); CONTINUE; END IF;
    h := md5(d::text);
    SELECT * INTO m FROM public.external_id_map WHERE integration_id = i.id AND entity = p_entity AND external_id = ext;
    IF m.id IS NOT NULL AND m.payload_hash = h THEN c_same := c_same + 1; CONTINUE; END IF;

    res := jsonb_build_object('id', m.sherivs_id, 'method', coalesce(m.match_method, 'new'));
    BEGIN
      IF apply_core THEN
        res := public._integration_apply_record(i, p_entity, ext, d, m.sherivs_id, m.id IS NOT NULL);
      END IF;
      IF res ? 'error' THEN
        IF (res->>'conflict')::boolean IS TRUE THEN c_conf := c_conf + 1; END IF;
        errs := errs || jsonb_build_object('external_id', ext, 'error', res->>'error');
        CONTINUE;
      END IF;
      INSERT INTO public.integration_records (school_id, integration_id, entity, external_id, data)
        VALUES (i.school_id, i.id, p_entity, ext, d)
        ON CONFLICT (integration_id, entity, external_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();
      INSERT INTO public.external_id_map (school_id, integration_id, entity, external_id, sherivs_id, match_method, payload_hash, last_run_id)
        VALUES (i.school_id, i.id, p_entity, ext, nullif(res->>'id','')::uuid, res->>'method', h, r.id)
        ON CONFLICT (integration_id, entity, external_id) DO UPDATE
          SET sherivs_id = EXCLUDED.sherivs_id, match_method = EXCLUDED.match_method, payload_hash = EXCLUDED.payload_hash,
              last_run_id = EXCLUDED.last_run_id, updated_at = now();
      IF m.id IS NULL THEN c_new := c_new + 1; ELSE c_upd := c_upd + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      errs := errs || jsonb_build_object('external_id', ext, 'error', left(SQLERRM, 200));
    END;
  END LOOP;
  PERFORM set_config('sherivs.integration_ingest', '', true);

  UPDATE public.sync_runs SET created = c_new, updated = c_upd, unchanged = c_same, conflicts = c_conf, errors = errs,
    status = CASE WHEN jsonb_array_length(errs) = 0 THEN 'succeeded' WHEN c_new + c_upd + c_same > 0 THEN 'partial' ELSE 'failed' END,
    finished_at = now() WHERE id = r.id RETURNING * INTO r;
  UPDATE public.integrations SET status = 'active', updated_at = now() WHERE id = i.id AND status = 'draft';
  PERFORM public._integration_audit(i.school_id, i.id, 'run', jsonb_build_object('run', r.id, 'entity', p_entity, 'trigger', p_trigger,
    'created', c_new, 'updated', c_upd, 'unchanged', c_same, 'conflicts', c_conf, 'errors', jsonb_array_length(errs)));
  RETURN jsonb_build_object('run_id', r.id, 'replayed', false, 'status', r.status, 'created', c_new, 'updated', c_upd,
    'unchanged', c_same, 'conflicts', c_conf, 'errors', jsonb_array_length(errs));
END $$;

-- Outbound capture -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._integration_outbox_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ent text; p jsonb; r jsonb; it record;
BEGIN
  IF coalesce(current_setting('sherivs.integration_ingest', true), '') <> '' THEN RETURN NULL; END IF;
  -- Fast path: almost every school has no outbound integration.
  IF NOT EXISTS (SELECT 1 FROM public.integrations WHERE school_id = NEW.school_id AND outbound_enabled AND status = 'active') THEN RETURN NULL; END IF;
  ent := CASE TG_TABLE_NAME WHEN 'students' THEN 'student' WHEN 'grades' THEN 'result' WHEN 'fees' THEN 'fee_invoice' END;
  r := to_jsonb(NEW); -- generic row access: each table has different columns
  IF TG_TABLE_NAME = 'students' THEN
    p := jsonb_build_object('admission_number', r->>'admission_number', 'gender', r->>'gender', 'date_of_birth', r->>'date_of_birth',
           'class_name', (SELECT name FROM public.classes WHERE id = (r->>'class_id')::uuid));
  ELSIF TG_TABLE_NAME = 'grades' THEN
    p := jsonb_build_object('admission_number', (SELECT admission_number FROM public.students WHERE id = (r->>'student_id')::uuid),
           'subject', r->>'subject', 'ca_score', r->'ca_score', 'exam_score', r->'exam_score', 'total_score', r->'total_score',
           'grade', r->>'grade', 'term', r->>'term', 'academic_year', r->>'academic_year', 'is_published', r->'is_published');
  ELSE
    p := jsonb_build_object('admission_number', (SELECT admission_number FROM public.students WHERE id = (r->>'student_id')::uuid),
           'fee_type', r->>'fee_type', 'amount_naira', r->'amount', 'paid_naira', r->'paid_amount', 'status', r->>'status',
           'term', r->>'term', 'academic_year', r->>'academic_year');
  END IF;
  FOR it IN SELECT id FROM public.integrations
             WHERE school_id = NEW.school_id AND outbound_enabled AND status = 'active'
               AND coalesce(system_of_record->>ent, 'external') = 'sherivs' LOOP
    INSERT INTO public.integration_outbox (school_id, integration_id, entity, op, sherivs_id, external_id, payload)
      VALUES (NEW.school_id, it.id, ent, 'upsert', NEW.id,
              (SELECT external_id FROM public.external_id_map WHERE integration_id = it.id AND entity = ent AND sherivs_id = NEW.id LIMIT 1), p)
      ON CONFLICT (integration_id, entity, sherivs_id) WHERE status = 'pending'
      DO UPDATE SET payload = EXCLUDED.payload, next_attempt_at = least(integration_outbox.next_attempt_at, now());
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._integration_outbox_capture() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_integration_outbox_students ON public.students;
CREATE TRIGGER trg_integration_outbox_students AFTER INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public._integration_outbox_capture();
DROP TRIGGER IF EXISTS trg_integration_outbox_grades ON public.grades;
CREATE TRIGGER trg_integration_outbox_grades AFTER INSERT OR UPDATE ON public.grades FOR EACH ROW EXECUTE FUNCTION public._integration_outbox_capture();
DROP TRIGGER IF EXISTS trg_integration_outbox_fees ON public.fees;
CREATE TRIGGER trg_integration_outbox_fees AFTER INSERT OR UPDATE ON public.fees FOR EACH ROW EXECUTE FUNCTION public._integration_outbox_capture();

-- Admin: outbound settings (non-secret config only).
CREATE OR REPLACE FUNCTION public.integration_set_outbound(p_integration uuid, p_enabled boolean, p_config jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.integrations;
BEGIN
  SELECT * INTO i FROM public.integrations WHERE id = p_integration;
  IF i.id IS NULL OR NOT public.scholar_can(i.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_enabled AND NOT EXISTS (SELECT 1 FROM public.connector_manifests WHERE key = i.connector_key AND 'outbound' = ANY (directions)) THEN
    RAISE EXCEPTION 'connector % has no outbound support', i.connector_key USING ERRCODE = '22023'; END IF;
  IF p_config IS NOT NULL AND nullif(p_config->>'outbound_url','') IS NOT NULL AND (p_config->>'outbound_url') !~ '^https://[^/\s]+' THEN
    RAISE EXCEPTION 'outbound_url must be https' USING ERRCODE = '22023'; END IF;
  UPDATE public.integrations SET outbound_enabled = p_enabled, config = coalesce(p_config, config), updated_at = now() WHERE id = i.id;
  PERFORM public._integration_audit(i.school_id, i.id, 'set_outbound', jsonb_build_object('enabled', p_enabled, 'config', p_config));
END $$;

-- Worker: claim (lease) and acknowledge outbound events (service_role only).
CREATE OR REPLACE FUNCTION public.integration_outbox_claim(p_limit integer DEFAULT 100)
RETURNS SETOF public.integration_outbox LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.integration_outbox o SET attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
   WHERE o.id IN (SELECT o2.id FROM public.integration_outbox o2 WHERE o2.status = 'pending' AND o2.next_attempt_at <= now()
                   ORDER BY o2.next_attempt_at LIMIT least(p_limit, 500) FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$$;

CREATE OR REPLACE FUNCTION public.integration_outbox_ack(p_id bigint, p_ok boolean, p_error text DEFAULT NULL, p_external_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.integration_outbox;
BEGIN
  SELECT * INTO o FROM public.integration_outbox WHERE id = p_id FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'pending' THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE public.integration_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = p_id;
    IF nullif(p_external_id, '') IS NOT NULL AND o.external_id IS NULL THEN
      INSERT INTO public.external_id_map (school_id, integration_id, entity, external_id, sherivs_id, match_method, payload_hash)
        VALUES (o.school_id, o.integration_id, o.entity, left(p_external_id, 200), o.sherivs_id, 'outbound', md5(o.payload::text))
        ON CONFLICT (integration_id, entity, external_id) DO NOTHING;
    END IF;
  ELSE
    UPDATE public.integration_outbox SET last_error = left(p_error, 500),
      status = CASE WHEN o.attempts >= 8 THEN 'dead' ELSE 'pending' END,
      next_attempt_at = now() + make_interval(mins => (2 ^ least(o.attempts, 10))::int) WHERE id = p_id;
    IF o.attempts >= 8 THEN PERFORM public._integration_audit(o.school_id, o.integration_id, 'outbound_dead', jsonb_build_object('outbox', o.id, 'error', left(p_error, 200))); END IF;
  END IF;
END $$;

-- Scheduler v2: record the job outcome and incremental cursor.
CREATE OR REPLACE FUNCTION public.integration_job_done(p_job uuid, p_cursor text, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.sync_jobs;
BEGIN
  SELECT * INTO j FROM public.sync_jobs WHERE id = p_job;
  IF j.id IS NULL THEN RETURN; END IF;
  UPDATE public.sync_jobs SET cursor = coalesce(p_cursor, cursor) WHERE id = p_job;
  IF p_error IS NOT NULL THEN
    PERFORM public._integration_audit(j.school_id, j.integration_id, 'pull_failed', jsonb_build_object('job', j.id, 'entity', j.entity, 'error', left(p_error, 200)));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.integration_set_outbound(uuid, boolean, jsonb), public.integration_outbox_claim(integer),
  public.integration_outbox_ack(bigint, boolean, text, text), public.integration_job_done(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integration_set_outbound(uuid, boolean, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.integration_outbox_claim(integer), public.integration_outbox_ack(bigint, boolean, text, text),
  public.integration_job_done(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.integration_outbox_claim(integer), public.integration_outbox_ack(bigint, boolean, text, text),
  public.integration_job_done(uuid, text, text) TO service_role;

-- Catalog: entities now include enrollment; outbound for rest-webhook.
UPDATE public.connector_manifests SET entities = ARRAY['student','staff','guardian','class','enrollment','result','fee_invoice','payment']
 WHERE key IN ('csv','rest-webhook');

COMMIT;
