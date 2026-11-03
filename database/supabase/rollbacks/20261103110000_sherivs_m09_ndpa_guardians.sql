-- Rollback for 20261103110000_sherivs_m09_ndpa_guardians.sql.
-- Destructive: removes M09 relationship history and any M09 lawful-basis fields.
-- Use only on a disposable database; export legal evidence before any rollback.
-- FORCE RLS on existing consent tables is intentionally retained to avoid weakening security.
BEGIN;

DROP POLICY IF EXISTS student_guardian_relationships_read ON public.student_guardian_relationships;
DROP POLICY IF EXISTS student_guardian_relationship_events_read ON public.student_guardian_relationship_events;
DROP POLICY IF EXISTS consent_records_select ON public.consent_records;
DROP POLICY IF EXISTS consent_events_select ON public.consent_events;
DROP TRIGGER IF EXISTS student_guardian_relationship_guard ON public.student_guardian_relationships;
DROP TRIGGER IF EXISTS student_guardian_relationship_audit ON public.student_guardian_relationships;
DROP TRIGGER IF EXISTS student_guardian_relationship_events_immutable ON public.student_guardian_relationship_events;
DROP TRIGGER IF EXISTS student_guardian_relationship_events_immutable_truncate ON public.student_guardian_relationship_events;
DROP TRIGGER IF EXISTS consent_events_audit_insert ON public.consent_events;
DROP TRIGGER IF EXISTS consent_events_immutable_truncate ON public.consent_events;

DROP FUNCTION IF EXISTS public.consent_set_for_actor(uuid, uuid, text, boolean, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.consent_set_v1(uuid, text, boolean, uuid, text, text, text);
DROP FUNCTION IF EXISTS public._ndpa_consent_set(uuid, uuid, text, boolean, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.student_guardian_relationship_set(uuid, uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.student_guardian_relationship_end(uuid, date);
DROP FUNCTION IF EXISTS public.student_guardian_can_access_records(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_student_consent_guardian(uuid, uuid);
DROP FUNCTION IF EXISTS public.student_guardian_relationship_guard();
DROP FUNCTION IF EXISTS public.student_guardian_relationship_audit();
DROP FUNCTION IF EXISTS public.ndpa_consent_event_audit();
DROP TABLE IF EXISTS public.student_guardian_relationship_events;
DROP TABLE IF EXISTS public.student_guardian_relationships;

ALTER TABLE public.consent_records
  DROP CONSTRAINT IF EXISTS consent_records_lawful_basis_m09_chk,
  DROP CONSTRAINT IF EXISTS consent_records_grant_metadata_m09_chk,
  DROP COLUMN IF EXISTS lawful_basis,
  DROP COLUMN IF EXISTS granted_by;
ALTER TABLE public.consent_events
  DROP CONSTRAINT IF EXISTS consent_events_lawful_basis_m09_chk,
  DROP COLUMN IF EXISTS lawful_basis,
  DROP COLUMN IF EXISTS granted_by;

-- Restore the pre-M09 feature contract. This is a schema rollback, not a basis
-- for returning to this behavior in application code.
CREATE OR REPLACE FUNCTION public.consent_gate(p_student uuid, p_purpose text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_purpose = 'core_education' OR EXISTS (
    SELECT 1 FROM public.consent_records
     WHERE student_id = p_student AND purpose = p_purpose AND status = 'granted'
  )
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
  s uuid;
  who text;
  cid uuid;
  method text := coalesce(p_method, 'web_form');
  ver text := 'sherivs-consent-2026-10';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT school_id INTO s FROM public.students WHERE id = p_student;
  IF s IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_purpose NOT IN ('photos_media','ai_processing','messaging_sms_whatsapp','core_education') THEN
    RAISE EXCEPTION 'unknown purpose';
  END IF;
  IF p_purpose = 'core_education' AND NOT p_grant THEN
    RAISE EXCEPTION 'core education is not consent-based; ask the school about withdrawal';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.parent_student_map m
     WHERE m.parent_id = auth.uid() AND m.student_id = p_student AND m.school_id = s
  ) OR EXISTS (
    SELECT 1 FROM public.students x WHERE x.id = p_student AND x.parent_id = auth.uid()
  ) THEN
    who := 'guardian';
    method := 'web_form';
  ELSIF EXISTS (
    SELECT 1 FROM public.students x WHERE x.id = p_student AND x.user_id = auth.uid()
  ) THEN
    IF NOT public._student_is_adult(p_student) THEN
      RAISE EXCEPTION 'a parent or guardian must give consent for a learner under 18' USING ERRCODE = '42501';
    END IF;
    who := 'self';
    method := 'web_form';
  ELSIF s = public.get_my_school_id() AND coalesce(public.is_school_admin(), false) THEN
    IF method NOT IN ('paper_signed','verbal_recorded','admin_entered') THEN
      RAISE EXCEPTION 'record how consent was captured (paper, verbal or admin-entered)';
    END IF;
    IF coalesce(length(btrim(p_note)), 0) < 5 THEN
      RAISE EXCEPTION 'add a note pointing to the evidence (e.g. form number)';
    END IF;
    who := 'school';
  ELSE
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.consent_records (
    school_id, student_id, guardian_user_id, purpose, status, policy_version,
    granted_at, withdrawn_at, capture_method, captured_by, notes
  ) VALUES (
    s, p_student, CASE WHEN who = 'guardian' THEN auth.uid() END, p_purpose,
    CASE WHEN p_grant THEN 'granted' ELSE 'withdrawn' END, ver,
    CASE WHEN p_grant THEN now() END, CASE WHEN NOT p_grant THEN now() END,
    method, auth.uid(), p_note
  )
  ON CONFLICT (student_id, purpose) DO UPDATE SET
    status = excluded.status,
    policy_version = excluded.policy_version,
    granted_at = CASE WHEN p_grant THEN now() ELSE public.consent_records.granted_at END,
    withdrawn_at = CASE WHEN p_grant THEN NULL ELSE now() END,
    guardian_user_id = coalesce(excluded.guardian_user_id, public.consent_records.guardian_user_id),
    capture_method = excluded.capture_method,
    captured_by = excluded.captured_by,
    notes = excluded.notes
  RETURNING id INTO cid;
  INSERT INTO public.consent_events (
    school_id, consent_id, student_id, purpose, action, policy_version, actor_id, capture_method
  ) VALUES (
    s, cid, p_student, p_purpose, CASE WHEN p_grant THEN 'grant' ELSE 'withdraw' END, ver, auth.uid(), method
  );
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id, student_id, detail)
  VALUES (
    s, auth.uid(), CASE WHEN p_grant THEN 'consent_grant' ELSE 'consent_withdraw' END,
    cid, p_student, jsonb_build_object('purpose', p_purpose, 'by', who, 'method', method)
  );
  RETURN CASE WHEN p_grant THEN 'granted' ELSE 'withdrawn' END;
END
$$;

CREATE POLICY consent_records_select ON public.consent_records FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
    OR public.is_guardian_of_student(student_id, school_id)
  );
CREATE POLICY consent_events_select ON public.consent_events FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
    OR public.is_guardian_of_student(student_id, school_id)
  );

REVOKE ALL ON FUNCTION public.consent_set(uuid, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consent_set(uuid, text, boolean, text, text) TO authenticated;
GRANT ALL ON public.consent_records, public.consent_events TO service_role;

COMMIT;
