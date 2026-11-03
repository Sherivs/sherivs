-- M09: effective-dated learner relationships and purpose-based NDPA consent.
-- V1 organizational scope; no live database is modified by this migration file.
DO $guard$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.consent_records') IS NULL
     OR to_regclass('public.consent_events') IS NULL
     OR to_regclass('public.safeguard_audit') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regprocedure('public.scholar_can(uuid,text)') IS NULL
     OR to_regprocedure('public._student_is_adult(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M09 requires the existing tenant, consent, audit, and authorization foundations'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

BEGIN;

ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS lawful_basis text,
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.consent_events
  ADD COLUMN IF NOT EXISTS lawful_basis text,
  ADD COLUMN IF NOT EXISTS granted_by uuid;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_lawful_basis_m09_chk') THEN
    ALTER TABLE public.consent_records
      ADD CONSTRAINT consent_records_lawful_basis_m09_chk
      CHECK (lawful_basis IS NULL OR lawful_basis IN (
        'consent', 'contract', 'legal_obligation', 'public_task', 'vital_interests', 'legitimate_interests'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_events_lawful_basis_m09_chk') THEN
    ALTER TABLE public.consent_events
      ADD CONSTRAINT consent_events_lawful_basis_m09_chk
      CHECK (lawful_basis IS NULL OR lawful_basis IN (
        'consent', 'contract', 'legal_obligation', 'public_task', 'vital_interests', 'legitimate_interests'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_grant_metadata_m09_chk') THEN
    ALTER TABLE public.consent_records
      ADD CONSTRAINT consent_records_grant_metadata_m09_chk
      CHECK (
        status <> 'granted'
        OR (lawful_basis IS NOT NULL AND granted_by IS NOT NULL AND granted_at IS NOT NULL AND withdrawn_at IS NULL)
      ) NOT VALID;
  END IF;
END
$constraints$;

CREATE TABLE public.student_guardian_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  related_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (
    relationship_type IN ('legal_guardian', 'parent', 'caregiver', 'fee_payer')
  ),
  records_access boolean NOT NULL DEFAULT false,
  evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 3 AND 500),
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (relationship_type <> 'fee_payer' OR records_access IS FALSE)
);
CREATE INDEX student_guardian_relationships_tenant_student_idx
  ON public.student_guardian_relationships (school_id, student_id, effective_from, effective_until);
CREATE INDEX student_guardian_relationships_user_idx
  ON public.student_guardian_relationships (school_id, related_user_id, effective_from, effective_until);
CREATE UNIQUE INDEX student_guardian_relationships_open_uq
  ON public.student_guardian_relationships (school_id, student_id, related_user_id, relationship_type)
  WHERE effective_until IS NULL;

CREATE TABLE public.student_guardian_relationship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  relationship_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL CHECK (action IN ('insert', 'update')),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_guardian_relationship_events_tenant_time_idx
  ON public.student_guardian_relationship_events (school_id, occurred_at DESC);
CREATE INDEX student_guardian_relationship_events_relationship_idx
  ON public.student_guardian_relationship_events (relationship_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.student_guardian_relationship_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.related_user_id IS DISTINCT FROM OLD.related_user_id
       OR NEW.relationship_type IS DISTINCT FROM OLD.relationship_type
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'guardian relationship identity and start are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.relationship_type = 'fee_payer' AND NEW.records_access THEN
    RAISE EXCEPTION 'fee payer relationships cannot grant record access' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.id = NEW.student_id
       AND s.school_id = NEW.school_id
       AND s.user_id IS DISTINCT FROM NEW.related_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = NEW.related_user_id AND u.school_id = NEW.school_id AND u.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'guardian relationship parties must be active in the same tenant' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.student_guardian_relationship_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := NEW.updated_by;
  v_relationship_id uuid := NEW.id;
  v_school_id uuid := NEW.school_id;
  v_before jsonb;
  v_after jsonb;
  v_action text := lower(TG_OP);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'guardian relationship changes require an attributed actor' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN v_before := to_jsonb(OLD); END IF;
  v_after := to_jsonb(NEW);
  INSERT INTO public.student_guardian_relationship_events (
    school_id, relationship_id, actor_user_id, action, before_state, after_state
  ) VALUES (v_school_id, v_relationship_id, v_actor, v_action, v_before, v_after);
  INSERT INTO public.audit_logs (
    school_id, user_id, action, table_name, record_id, old_value, new_value
  ) VALUES (
    v_school_id, v_actor, 'guardian.relationship.' || v_action,
    'student_guardian_relationships', v_relationship_id, v_before, v_after
  );
  RETURN NULL;
END
$$;

CREATE TRIGGER student_guardian_relationship_guard
  BEFORE INSERT OR UPDATE ON public.student_guardian_relationships
  FOR EACH ROW EXECUTE FUNCTION public.student_guardian_relationship_guard();
CREATE TRIGGER student_guardian_relationship_audit
  AFTER INSERT OR UPDATE ON public.student_guardian_relationships
  FOR EACH ROW EXECUTE FUNCTION public.student_guardian_relationship_audit();
CREATE TRIGGER student_guardian_relationship_events_immutable
  BEFORE UPDATE OR DELETE ON public.student_guardian_relationship_events
  FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
CREATE TRIGGER student_guardian_relationship_events_immutable_truncate
  BEFORE TRUNCATE ON public.student_guardian_relationship_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();

CREATE OR REPLACE FUNCTION public.student_guardian_can_access_records(p_student_id uuid, p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.student_guardian_relationships r
     WHERE r.student_id = p_student_id
       AND r.school_id = p_school_id
       AND r.related_user_id = auth.uid()
       AND r.relationship_type <> 'fee_payer'
       AND r.records_access
       AND r.effective_from <= current_date
       AND (r.effective_until IS NULL OR r.effective_until > current_date)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_student_consent_guardian(p_student_id uuid, p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.student_guardian_relationships r
     WHERE r.student_id = p_student_id
       AND r.school_id = p_school_id
       AND r.related_user_id = auth.uid()
       AND r.relationship_type IN ('legal_guardian', 'parent')
       AND r.effective_from <= current_date
       AND (r.effective_until IS NULL OR r.effective_until > current_date)
  )
$$;

CREATE OR REPLACE FUNCTION public.student_guardian_relationship_set(
  p_student_id uuid,
  p_related_user_id uuid,
  p_relationship_type text,
  p_records_access boolean,
  p_evidence_ref text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_school_id uuid;
  v_relationship_id uuid;
BEGIN
  IF v_actor IS NULL OR coalesce(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'authenticated actor required' USING ERRCODE = '42501';
  END IF;
  SELECT s.school_id INTO v_school_id
    FROM public.students s
   WHERE s.id = p_student_id;
  IF v_school_id IS NULL
     OR v_school_id IS DISTINCT FROM public.get_my_school_id()
     OR NOT public.scholar_can(v_school_id, 'students.transfer')
     OR NOT EXISTS (
       SELECT 1 FROM public.users u
        WHERE u.id = v_actor AND u.school_id = v_school_id AND u.is_active IS TRUE
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.users u
        WHERE u.id = p_related_user_id AND u.school_id = v_school_id AND u.is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_relationship_type NOT IN ('legal_guardian', 'parent', 'caregiver', 'fee_payer')
     OR (p_relationship_type = 'fee_payer' AND coalesce(p_records_access, false))
     OR length(btrim(coalesce(p_evidence_ref, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid guardian relationship details' USING ERRCODE = '23514';
  END IF;
  SELECT r.id INTO v_relationship_id
    FROM public.student_guardian_relationships r
   WHERE r.school_id = v_school_id
     AND r.student_id = p_student_id
     AND r.related_user_id = p_related_user_id
     AND r.relationship_type = p_relationship_type
     AND r.effective_until IS NULL
   FOR UPDATE;
  IF v_relationship_id IS NOT NULL THEN
    UPDATE public.student_guardian_relationships
       SET records_access = p_records_access,
           evidence_ref = btrim(p_evidence_ref),
           updated_by = v_actor
     WHERE id = v_relationship_id;
    RETURN v_relationship_id;
  END IF;
  INSERT INTO public.student_guardian_relationships (
    school_id, student_id, related_user_id, relationship_type, records_access,
    evidence_ref, created_by, updated_by
  ) VALUES (
    v_school_id, p_student_id, p_related_user_id, p_relationship_type,
    coalesce(p_records_access, false), btrim(p_evidence_ref), v_actor, v_actor
  ) RETURNING id INTO v_relationship_id;
  RETURN v_relationship_id;
END
$$;

CREATE OR REPLACE FUNCTION public.student_guardian_relationship_end(
  p_relationship_id uuid,
  p_effective_until date DEFAULT current_date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_relationship public.student_guardian_relationships;
BEGIN
  SELECT * INTO v_relationship
    FROM public.student_guardian_relationships
   WHERE id = p_relationship_id
   FOR UPDATE;
  IF v_relationship.id IS NULL
     OR v_relationship.school_id IS DISTINCT FROM public.get_my_school_id()
     OR NOT public.scholar_can(v_relationship.school_id, 'students.transfer')
     OR v_actor IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_effective_until <= v_relationship.effective_from THEN
    RAISE EXCEPTION 'relationship end must follow its start' USING ERRCODE = '23514';
  END IF;
  UPDATE public.student_guardian_relationships
     SET effective_until = p_effective_until, updated_by = v_actor
   WHERE id = p_relationship_id AND effective_until IS NULL;
END
$$;

CREATE OR REPLACE FUNCTION public._ndpa_consent_set(
  p_actor_id uuid,
  p_student_id uuid,
  p_purpose text,
  p_grant boolean,
  p_granted_by uuid,
  p_lawful_basis text,
  p_method text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student public.students;
  v_actor public.users;
  v_existing public.consent_records;
  v_consent_id uuid;
  v_basis text;
  v_status text;
  v_method text := coalesce(p_method, 'web_form');
  v_version constant text := '2026-10-v1';
  v_actor_is_admin boolean;
  v_grantor_is_adult boolean;
  v_grantor_is_guardian boolean;
BEGIN
  IF p_actor_id IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'actor and consent grantor are required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role' AND p_actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'actor does not match authenticated identity' USING ERRCODE = '42501';
  END IF;
  IF p_purpose NOT IN ('core_education', 'photos_media', 'ai_processing', 'messaging_sms_whatsapp') THEN
    RAISE EXCEPTION 'unknown consent purpose' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id FOR UPDATE;
  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id AND is_active IS TRUE;
  IF v_student.id IS NULL OR v_actor.id IS NULL OR v_actor.school_id IS DISTINCT FROM v_student.school_id
     OR NOT EXISTS (
       SELECT 1 FROM public.users u
        WHERE u.id = p_granted_by AND u.school_id = v_student.school_id AND u.is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  v_actor_is_admin := v_actor.role IN ('admin', 'principal');
  IF p_actor_id <> p_granted_by AND NOT v_actor_is_admin THEN
    RAISE EXCEPTION 'only an institution administrator may record another person''s consent' USING ERRCODE = '42501';
  END IF;
  v_grantor_is_adult := v_student.user_id = p_granted_by AND public._student_is_adult(p_student_id);
  SELECT EXISTS (
    SELECT 1
      FROM public.student_guardian_relationships r
     WHERE r.student_id = p_student_id
       AND r.school_id = v_student.school_id
       AND r.related_user_id = p_granted_by
       AND r.relationship_type IN ('legal_guardian', 'parent')
       AND r.effective_from <= current_date
       AND (r.effective_until IS NULL OR r.effective_until > current_date)
  ) INTO v_grantor_is_guardian;
  IF NOT v_grantor_is_adult AND NOT v_grantor_is_guardian THEN
    RAISE EXCEPTION 'consent must be granted by the adult learner or an active parent/legal guardian' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id = p_granted_by THEN
    IF NOT (v_grantor_is_adult OR v_grantor_is_guardian) OR v_method <> 'web_form' THEN
      RAISE EXCEPTION 'learner or guardian consent must use the authenticated web form' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT v_actor_is_admin
       OR (
         coalesce(auth.role(), '') <> 'service_role'
         AND v_actor.school_id IS DISTINCT FROM public.get_my_school_id()
       )
       OR NOT public.scholar_can(v_actor.school_id, 'students.transfer')
       OR v_method NOT IN ('paper_signed', 'verbal_recorded', 'admin_entered')
       OR length(btrim(coalesce(p_note, ''))) < 5 THEN
      RAISE EXCEPTION 'administrator consent records require scope, a capture method, and an evidence reference' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_grant AND (
    p_lawful_basis IS NULL OR p_lawful_basis NOT IN (
    'consent', 'contract', 'legal_obligation', 'public_task', 'vital_interests', 'legitimate_interests'
    )
  ) THEN
    RAISE EXCEPTION 'a recognized lawful basis is required for a consent grant' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_existing
    FROM public.consent_records
   WHERE school_id = v_student.school_id
     AND student_id = p_student_id
     AND purpose = p_purpose
   FOR UPDATE;
  v_basis := coalesce(nullif(p_lawful_basis, ''), v_existing.lawful_basis, 'consent');
  v_status := CASE WHEN p_grant THEN 'granted' ELSE 'withdrawn' END;
  INSERT INTO public.consent_records (
    school_id, student_id, guardian_user_id, purpose, status, policy_version,
    granted_at, withdrawn_at, capture_method, captured_by, notes, lawful_basis, granted_by
  ) VALUES (
    v_student.school_id, p_student_id,
    CASE WHEN NOT v_grantor_is_adult AND v_grantor_is_guardian THEN p_granted_by END,
    p_purpose, v_status, v_version,
    CASE WHEN p_grant THEN clock_timestamp() END,
    CASE WHEN NOT p_grant THEN clock_timestamp() END,
    v_method, p_actor_id, nullif(btrim(coalesce(p_note, '')), ''), v_basis,
    CASE WHEN p_grant THEN p_granted_by END
  )
  ON CONFLICT (student_id, purpose) DO UPDATE SET
    guardian_user_id = coalesce(EXCLUDED.guardian_user_id, public.consent_records.guardian_user_id),
    status = EXCLUDED.status,
    policy_version = EXCLUDED.policy_version,
    granted_at = CASE WHEN p_grant THEN EXCLUDED.granted_at ELSE public.consent_records.granted_at END,
    withdrawn_at = CASE WHEN p_grant THEN NULL ELSE EXCLUDED.withdrawn_at END,
    capture_method = EXCLUDED.capture_method,
    captured_by = EXCLUDED.captured_by,
    notes = EXCLUDED.notes,
    lawful_basis = v_basis,
    granted_by = CASE WHEN p_grant THEN p_granted_by ELSE public.consent_records.granted_by END
  RETURNING id INTO v_consent_id;
  INSERT INTO public.consent_events (
    school_id, consent_id, student_id, purpose, action, policy_version,
    actor_id, capture_method, at, lawful_basis, granted_by
  ) VALUES (
    v_student.school_id, v_consent_id, p_student_id, p_purpose,
    CASE WHEN p_grant THEN 'grant' ELSE 'withdraw' END, v_version,
    p_actor_id, v_method, clock_timestamp(), v_basis,
    CASE WHEN p_grant THEN p_granted_by ELSE v_existing.granted_by END
  );
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id, student_id, detail)
  VALUES (
    v_student.school_id, p_actor_id,
    CASE WHEN p_grant THEN 'consent_grant' ELSE 'consent_withdraw' END,
    v_consent_id, p_student_id,
    jsonb_build_object('purpose', p_purpose, 'granted_by', p_granted_by, 'lawful_basis', v_basis, 'method', v_method)
  );
  RETURN jsonb_build_object('consent_id', v_consent_id, 'status', v_status);
END
$$;

CREATE OR REPLACE FUNCTION public.ndpa_consent_event_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.actor_id IS NULL THEN
    RAISE EXCEPTION 'consent events require an attributed actor' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_logs (
    school_id, user_id, action, table_name, record_id, new_value
  ) VALUES (
    NEW.school_id, NEW.actor_id, 'consent.' || NEW.action,
    'consent_events', NEW.id,
    jsonb_build_object(
      'consent_id', NEW.consent_id, 'student_id', NEW.student_id,
      'purpose', NEW.purpose, 'action', NEW.action,
      'lawful_basis', NEW.lawful_basis, 'granted_by', NEW.granted_by,
      'policy_version', NEW.policy_version, 'at', NEW.at
    )
  );
  RETURN NULL;
END
$$;
CREATE TRIGGER consent_events_audit_insert
  AFTER INSERT ON public.consent_events
  FOR EACH ROW EXECUTE FUNCTION public.ndpa_consent_event_audit();
CREATE TRIGGER consent_events_immutable_truncate
  BEFORE TRUNCATE ON public.consent_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();

CREATE OR REPLACE FUNCTION public.consent_set_for_actor(
  p_actor_id uuid,
  p_student_id uuid,
  p_purpose text,
  p_grant boolean,
  p_granted_by uuid,
  p_lawful_basis text,
  p_method text DEFAULT 'web_form',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'server consent recording is restricted to the service role' USING ERRCODE = '42501';
  END IF;
  RETURN public._ndpa_consent_set(
    p_actor_id, p_student_id, p_purpose, p_grant, p_granted_by,
    p_lawful_basis, p_method, p_note
  );
END
$$;

CREATE OR REPLACE FUNCTION public.consent_set_v1(
  p_student uuid,
  p_purpose text,
  p_grant boolean,
  p_granted_by uuid,
  p_lawful_basis text DEFAULT 'consent',
  p_method text DEFAULT 'web_form',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'authenticated actor required' USING ERRCODE = '42501';
  END IF;
  RETURN public._ndpa_consent_set(
    auth.uid(), p_student, p_purpose, p_grant, p_granted_by,
    p_lawful_basis, p_method, p_note
  );
END
$$;

CREATE OR REPLACE FUNCTION public.consent_set(
  p_student uuid,
  p_purpose text,
  p_grant boolean,
  p_method text DEFAULT 'web_form',
  p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.consent_set_v1(
    p_student, p_purpose, p_grant, auth.uid(), 'consent', p_method, p_note
  );
  RETURN v_result->>'status';
END
$$;

CREATE OR REPLACE FUNCTION public.consent_gate(p_student uuid, p_purpose text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.consent_records c
      JOIN public.students s ON s.id = c.student_id AND s.school_id = c.school_id
     WHERE c.student_id = p_student
       AND c.purpose = p_purpose
       AND c.status = 'granted'
       AND c.policy_version = '2026-10-v1'
       AND c.lawful_basis IS NOT NULL
       AND c.granted_by IS NOT NULL
       AND c.granted_at IS NOT NULL
       AND c.withdrawn_at IS NULL
       AND (
         coalesce(auth.role(), '') = 'service_role'
         OR coalesce(public.is_super_admin(), false)
         OR s.school_id = public.get_my_school_id()
         OR public.is_guardian_of_student(p_student, s.school_id)
       )
  )
$$;

ALTER TABLE public.student_guardian_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardian_relationships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardian_relationship_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardian_relationship_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_records_select ON public.consent_records;
CREATE POLICY consent_records_select ON public.consent_records FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
    OR public.is_student_consent_guardian(student_id, school_id)
    OR public.student_guardian_can_access_records(student_id, school_id)
  );
DROP POLICY IF EXISTS consent_events_select ON public.consent_events;
CREATE POLICY consent_events_select ON public.consent_events FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
    OR public.is_student_consent_guardian(student_id, school_id)
    OR public.student_guardian_can_access_records(student_id, school_id)
  );

REVOKE ALL ON public.student_guardian_relationships,
  public.student_guardian_relationship_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.student_guardian_relationships,
  public.student_guardian_relationship_events TO authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.consent_records, public.consent_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.consent_records, public.consent_events TO authenticated;
REVOKE EXECUTE ON FUNCTION public.consent_set(uuid, text, boolean, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_set_v1(uuid, text, boolean, uuid, text, text, text)
  FROM PUBLIC, anon;

CREATE POLICY student_guardian_relationships_read ON public.student_guardian_relationships
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND public.scholar_can(school_id, 'students.transfer')
  );
CREATE POLICY student_guardian_relationship_events_read ON public.student_guardian_relationship_events
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND public.scholar_can(school_id, 'audit.view')
  );

REVOKE ALL ON FUNCTION public.student_guardian_relationship_guard(),
  public.student_guardian_relationship_audit(),
  public.ndpa_consent_event_audit(),
  public._ndpa_consent_set(uuid, uuid, text, boolean, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.student_guardian_can_access_records(uuid, uuid),
  public.is_student_consent_guardian(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_guardian_can_access_records(uuid, uuid),
public.is_student_consent_guardian(uuid, uuid),
  public.student_guardian_relationship_set(uuid, uuid, text, boolean, text),
  public.student_guardian_relationship_end(uuid, date),
  public.consent_set_v1(uuid, text, boolean, uuid, text, text, text),
  public.consent_gate(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.student_guardian_relationship_set(uuid, uuid, text, boolean, text),
  public.student_guardian_relationship_end(uuid, date),
  public.consent_set_for_actor(uuid, uuid, text, boolean, uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consent_set_for_actor(uuid, uuid, text, boolean, uuid, text, text, text)
  TO service_role;

COMMIT;
