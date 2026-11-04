-- M10: tenant-scoped processing activity and DPIA registers.
DO $guard$
BEGIN
  IF to_regclass('public.dpia_records') IS NULL
     OR to_regclass('public.schools') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.role_catalog') IS NULL
     OR to_regprocedure('public.workspace_effective_assignments(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_my_school_id()') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regprocedure('public.can_administer_org(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M10 requires the existing DPIA, tenant and role-engine contracts'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_catalog
    WHERE code = 'ng.data_protection_officer_dpo'
  ) THEN
    RAISE EXCEPTION 'M10 requires the catalog DPO role'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

BEGIN;

ALTER TABLE public.dpia_records
  ADD COLUMN IF NOT EXISTS risks text[] NOT NULL DEFAULT '{}';

CREATE TABLE public.ropa_processing_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  activity_key text NOT NULL CHECK (activity_key ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 2 AND 2000),
  data_subject_categories text[] NOT NULL DEFAULT '{}',
  data_categories text[] NOT NULL DEFAULT '{}',
  recipients text[] NOT NULL DEFAULT '{}',
  transfer_details text[] NOT NULL DEFAULT '{}',
  retention_reference text NOT NULL CHECK (length(btrim(retention_reference)) BETWEEN 2 AND 1000),
  security_measures text NOT NULL CHECK (length(btrim(security_measures)) BETWEEN 2 AND 2000),
  is_synthetic boolean NOT NULL DEFAULT false,
  owner_review_status text NOT NULL DEFAULT 'not_required'
    CHECK (owner_review_status IN ('not_required','owner_review_required','owner_reviewed')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ropa_processing_activities_platform_key
  ON public.ropa_processing_activities (activity_key)
  WHERE org_id IS NULL;
CREATE UNIQUE INDEX ropa_processing_activities_tenant_key
  ON public.ropa_processing_activities (org_id, activity_key)
  WHERE org_id IS NOT NULL;
CREATE INDEX ropa_processing_activities_tenant_updated
  ON public.ropa_processing_activities (org_id, updated_at DESC);

CREATE TABLE public.privacy_register_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  record_kind text NOT NULL CHECK (record_kind IN ('ropa','dpia','register')),
  record_id uuid,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'ropa.created','ropa.updated','dpia.created','dpia.updated','dpia.signed_off','register.exported'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX privacy_register_audit_tenant_time
  ON public.privacy_register_audit_events (org_id, occurred_at DESC);
CREATE INDEX privacy_register_audit_record
  ON public.privacy_register_audit_events (record_kind, record_id, occurred_at);

CREATE OR REPLACE FUNCTION public.privacy_register_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'privacy register audit events are append-only'
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER privacy_register_audit_immutable
  BEFORE UPDATE OR DELETE ON public.privacy_register_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.privacy_register_audit_immutable();
CREATE TRIGGER privacy_register_audit_no_truncate
  BEFORE TRUNCATE ON public.privacy_register_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.privacy_register_audit_immutable();

ALTER TABLE public.ropa_processing_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ropa_processing_activities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_register_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_register_audit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.ropa_processing_activities, public.privacy_register_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ropa_processing_activities, public.privacy_register_audit_events
  TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.dpia_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.dpia_records TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dpia_approve(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.privacy_register_is_dpo(p_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_school IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_school = public.get_my_school_id()
    AND EXISTS (
      SELECT 1
      FROM public.workspace_effective_assignments(p_school, auth.uid()) a
      WHERE a.role_code = 'ng.data_protection_officer_dpo'
    )
$$;

CREATE OR REPLACE FUNCTION public.privacy_register_can_manage(p_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_school IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_school = public.get_my_school_id()
    AND (
      public.can_administer_org(p_school)
      OR public.privacy_register_is_dpo(p_school)
    )
$$;

REVOKE ALL ON FUNCTION public.privacy_register_is_dpo(uuid),
  public.privacy_register_can_manage(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.privacy_register_is_dpo(uuid),
  public.privacy_register_can_manage(uuid) TO authenticated;

DROP POLICY IF EXISTS dpia_records_read ON public.dpia_records;
CREATE POLICY dpia_records_read ON public.dpia_records
  FOR SELECT TO authenticated
  USING (
    school_id = (SELECT public.get_my_school_id())
    AND public.privacy_register_can_manage(school_id)
  );
CREATE POLICY ropa_processing_activities_read ON public.ropa_processing_activities
  FOR SELECT TO authenticated
  USING (
    (org_id IS NOT NULL AND org_id = (SELECT public.get_my_school_id())
      AND public.privacy_register_can_manage(org_id))
    OR (org_id IS NULL AND (SELECT public.is_super_admin()))
  );
CREATE POLICY privacy_register_audit_events_read ON public.privacy_register_audit_events
  FOR SELECT TO authenticated
  USING (
    (org_id IS NOT NULL AND org_id = (SELECT public.get_my_school_id())
      AND public.privacy_register_can_manage(org_id))
    OR (org_id IS NULL AND (SELECT public.is_super_admin()))
  );

INSERT INTO public.ropa_processing_activities (
  org_id, activity_key, title, purpose, data_subject_categories, data_categories,
  recipients, transfer_details, retention_reference, security_measures,
  is_synthetic, owner_review_status
) VALUES
  (
    NULL, 'platform.account_operations', 'Synthetic account operations placeholder',
    'Synthetic placeholder for platform account and access operations. Owner review required; verify actual purposes before use.',
    ARRAY['Synthetic category: platform account holders'],
    ARRAY['Synthetic category: account and access metadata'],
    ARRAY['Synthetic placeholder: authorized platform operators'],
    ARRAY['Synthetic placeholder: cross-border transfer status must be verified by the owner'],
    'Synthetic reference: owner to confirm applicable account-retention schedule.',
    'Synthetic placeholder: owner to verify current access controls, audit and security measures.',
    true, 'owner_review_required'
  ),
  (
    NULL, 'platform.education_records', 'Synthetic education records placeholder',
    'Synthetic placeholder for institution education-record operations. Owner review required; confirm exact processing purposes.',
    ARRAY['Synthetic category: learners', 'Synthetic category: institution staff'],
    ARRAY['Synthetic category: enrollment, academic and attendance records'],
    ARRAY['Synthetic placeholder: authorized institution personnel'],
    ARRAY['Synthetic placeholder: transfer destinations and safeguards require owner review'],
    'Synthetic reference: institution retention schedule and applicable legal holds require verification.',
    'Synthetic placeholder: tenant-scoped access, audit and security measures require owner verification.',
    true, 'owner_review_required'
  ),
  (
    NULL, 'platform.admissions', 'Synthetic admissions operations placeholder',
    'Synthetic placeholder for admissions application handling. Owner review required; validate actual purposes and workflow.',
    ARRAY['Synthetic category: applicants and their authorized contacts'],
    ARRAY['Synthetic category: application and admissions records'],
    ARRAY['Synthetic placeholder: authorized admissions personnel'],
    ARRAY['Synthetic placeholder: transfers and destinations require owner verification'],
    'Synthetic reference: owner to verify the admissions retention schedule.',
    'Synthetic placeholder: owner to verify tenant access controls and audit coverage.',
    true, 'owner_review_required'
  ),
  (
    NULL, 'platform.fees_and_payments', 'Synthetic fees and payment operations placeholder',
    'Synthetic placeholder for institution fee and payment operations. Owner review required; confirm actual processor and payment flows.',
    ARRAY['Synthetic category: learners, guardians and fee payers'],
    ARRAY['Synthetic category: fee account and transaction references'],
    ARRAY['Synthetic placeholder: authorized finance personnel and verified processors'],
    ARRAY['Synthetic placeholder: payment-provider transfer locations and safeguards require review'],
    'Synthetic reference: owner to verify finance-record retention requirements and schedule.',
    'Synthetic placeholder: owner to verify least-privilege finance access, audit and provider safeguards.',
    true, 'owner_review_required'
  ),
  (
    NULL, 'platform.communication_delivery', 'Synthetic communication delivery placeholder',
    'Synthetic placeholder for institution communication delivery. Owner review required; confirm enabled channels and purposes.',
    ARRAY['Synthetic category: learners, guardians and institution staff'],
    ARRAY['Synthetic category: contact and communication metadata'],
    ARRAY['Synthetic placeholder: authorized institution personnel and enabled delivery providers'],
    ARRAY['Synthetic placeholder: channel/provider transfer locations require owner review'],
    'Synthetic reference: owner to verify communication-specific retention schedules.',
    'Synthetic placeholder: owner to verify channel consent, access and audit controls.',
    true, 'owner_review_required'
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.privacy_register_snapshot(p_school uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_ropa jsonb; v_dpia jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authenticated actor required' USING ERRCODE = '42501';
  END IF;
  IF p_school IS NULL THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'platform register access is restricted' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.privacy_register_can_manage(p_school) THEN
    RAISE EXCEPTION 'active tenant membership and privacy register access are required'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.activity_key), '[]'::jsonb)
    INTO v_ropa
    FROM public.ropa_processing_activities r
   WHERE r.org_id IS NOT DISTINCT FROM p_school;
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_dpia
    FROM public.dpia_records d
   WHERE d.school_id = p_school;
  RETURN jsonb_build_object(
    'ropa', v_ropa,
    'dpia', v_dpia,
    'can_sign_off', p_school IS NOT NULL AND public.privacy_register_is_dpo(p_school)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.privacy_ropa_save(
  p_id uuid,
  p_school uuid,
  p_activity_key text,
  p_title text,
  p_purpose text,
  p_subject_categories text[],
  p_data_categories text[],
  p_recipients text[],
  p_transfer_details text[],
  p_retention_reference text,
  p_security_measures text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid; v_action text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authenticated actor required' USING ERRCODE = '42501';
  END IF;
  IF p_school IS NULL THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'platform register changes are restricted' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.privacy_register_can_manage(p_school) THEN
    RAISE EXCEPTION 'active tenant membership and privacy register access are required'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_activity_key, ''))) NOT BETWEEN 2 AND 96
     OR p_activity_key !~ '^[a-z][a-z0-9_.-]{1,95}$'
     OR length(btrim(coalesce(p_title, ''))) NOT BETWEEN 2 AND 160
     OR length(btrim(coalesce(p_purpose, ''))) NOT BETWEEN 2 AND 2000
     OR length(btrim(coalesce(p_retention_reference, ''))) NOT BETWEEN 2 AND 1000
     OR length(btrim(coalesce(p_security_measures, ''))) NOT BETWEEN 2 AND 2000
     OR cardinality(coalesce(p_subject_categories, ARRAY[]::text[])) > 100
     OR cardinality(coalesce(p_data_categories, ARRAY[]::text[])) > 100
     OR cardinality(coalesce(p_recipients, ARRAY[]::text[])) > 100
     OR cardinality(coalesce(p_transfer_details, ARRAY[]::text[])) > 100
     OR EXISTS (
       SELECT 1
       FROM unnest(
         coalesce(p_subject_categories, ARRAY[]::text[])
         || coalesce(p_data_categories, ARRAY[]::text[])
         || coalesce(p_recipients, ARRAY[]::text[])
         || coalesce(p_transfer_details, ARRAY[]::text[])
       ) AS item(value)
       WHERE length(btrim(coalesce(item.value, ''))) NOT BETWEEN 1 AND 500
     ) THEN
    RAISE EXCEPTION 'invalid processing activity fields' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.ropa_processing_activities (
      org_id, activity_key, title, purpose, data_subject_categories, data_categories,
      recipients, transfer_details, retention_reference, security_measures,
      created_by, updated_by
    ) VALUES (
      p_school, btrim(p_activity_key), btrim(p_title), btrim(p_purpose),
      coalesce(p_subject_categories, '{}'), coalesce(p_data_categories, '{}'),
      coalesce(p_recipients, '{}'), coalesce(p_transfer_details, '{}'),
      btrim(p_retention_reference), btrim(p_security_measures), auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    v_action := 'ropa.created';
  ELSE
    UPDATE public.ropa_processing_activities
       SET activity_key = btrim(p_activity_key), title = btrim(p_title),
           purpose = btrim(p_purpose),
           data_subject_categories = coalesce(p_subject_categories, '{}'),
           data_categories = coalesce(p_data_categories, '{}'),
           recipients = coalesce(p_recipients, '{}'),
           transfer_details = coalesce(p_transfer_details, '{}'),
           retention_reference = btrim(p_retention_reference),
           security_measures = btrim(p_security_measures),
           updated_by = auth.uid(), updated_at = clock_timestamp()
     WHERE id = p_id AND org_id IS NOT DISTINCT FROM p_school
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'processing activity not found in authorized scope'
        USING ERRCODE = '42501';
    END IF;
    v_action := 'ropa.updated';
  END IF;
  INSERT INTO public.privacy_register_audit_events
    (org_id, record_kind, record_id, actor_user_id, action, details)
  VALUES (p_school, 'ropa', v_id, auth.uid(), v_action,
    jsonb_build_object('activity_key', btrim(p_activity_key)));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.privacy_dpia_save(
  p_id uuid,
  p_school uuid,
  p_title text,
  p_activity text,
  p_categories text[],
  p_risk_level text,
  p_risks text[],
  p_mitigations text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid; v_action text;
BEGIN
  IF auth.uid() IS NULL OR p_school IS NULL
     OR p_school IS DISTINCT FROM public.get_my_school_id()
     OR NOT public.privacy_register_can_manage(p_school) THEN
    RAISE EXCEPTION 'active tenant membership and privacy register access are required'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 2 AND 160
     OR length(btrim(coalesce(p_activity, ''))) NOT BETWEEN 2 AND 2000
     OR p_risk_level IS NULL
     OR p_risk_level NOT IN ('low','medium','high')
     OR length(btrim(coalesce(p_mitigations, ''))) > 4000
     OR cardinality(coalesce(p_categories, ARRAY[]::text[])) > 100
     OR cardinality(coalesce(p_risks, ARRAY[]::text[])) > 100
     OR EXISTS (
       SELECT 1
       FROM unnest(
         coalesce(p_categories, ARRAY[]::text[])
         || coalesce(p_risks, ARRAY[]::text[])
       ) AS item(value)
       WHERE length(btrim(coalesce(item.value, ''))) NOT BETWEEN 1 AND 500
     ) THEN
    RAISE EXCEPTION 'invalid DPIA fields' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.dpia_records (
      school_id, title, processing_activity, data_categories, risk_level, risks,
      mitigations, status, prepared_by, review_due
    ) VALUES (
      p_school, btrim(p_title), btrim(p_activity), coalesce(p_categories, '{}'),
      p_risk_level, coalesce(p_risks, '{}'), nullif(btrim(p_mitigations), ''),
      'draft', auth.uid(), current_date + 365
    ) RETURNING id INTO v_id;
    v_action := 'dpia.created';
  ELSE
    UPDATE public.dpia_records
       SET title = btrim(p_title), processing_activity = btrim(p_activity),
           data_categories = coalesce(p_categories, '{}'), risk_level = p_risk_level,
           risks = coalesce(p_risks, '{}'), mitigations = nullif(btrim(p_mitigations), '')
     WHERE id = p_id AND school_id = p_school AND status = 'draft'
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'draft DPIA not found in authorized scope'
        USING ERRCODE = '42501';
    END IF;
    v_action := 'dpia.updated';
  END IF;
  INSERT INTO public.privacy_register_audit_events
    (org_id, record_kind, record_id, actor_user_id, action, details)
  VALUES (p_school, 'dpia', v_id, auth.uid(), v_action,
    jsonb_build_object('risk_level', p_risk_level));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.dpia_approve(p_dpia uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE d public.dpia_records%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authenticated DPO is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d
    FROM public.dpia_records
   WHERE id = p_dpia
   FOR UPDATE;
  IF d.id IS NULL OR d.school_id IS DISTINCT FROM public.get_my_school_id()
     OR NOT public.privacy_register_is_dpo(d.school_id) THEN
    RAISE EXCEPTION 'DPIA sign-off requires the assigned DPO role in this tenant'
      USING ERRCODE = '42501';
  END IF;
  IF d.status <> 'draft' OR d.prepared_by = auth.uid() THEN
    RAISE EXCEPTION 'DPIA sign-off requires an unsigned draft prepared by another actor'
      USING ERRCODE = '42501';
  END IF;
  IF cardinality(d.risks) = 0
     OR EXISTS (
       SELECT 1 FROM unnest(d.risks) AS item(value)
       WHERE length(btrim(coalesce(item.value, ''))) = 0
     )
     OR length(btrim(coalesce(d.mitigations, ''))) < 2 THEN
    RAISE EXCEPTION 'DPIA risks and mitigations are required before sign-off'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.dpia_records
     SET status = 'approved', approved_by = auth.uid(), approved_at = clock_timestamp()
   WHERE id = d.id;
  INSERT INTO public.privacy_register_audit_events
    (org_id, record_kind, record_id, actor_user_id, action, details)
  VALUES (d.school_id, 'dpia', d.id, auth.uid(), 'dpia.signed_off',
    jsonb_build_object('risk_level', d.risk_level));
END
$$;

CREATE OR REPLACE FUNCTION public.privacy_register_export(p_school uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_snapshot jsonb;
BEGIN
  v_snapshot := public.privacy_register_snapshot(p_school);
  INSERT INTO public.privacy_register_audit_events
    (org_id, record_kind, actor_user_id, action, details)
  VALUES (
    p_school, 'register', auth.uid(), 'register.exported',
    jsonb_build_object(
      'ropa_count', jsonb_array_length(v_snapshot->'ropa'),
      'dpia_count', jsonb_array_length(v_snapshot->'dpia')
    )
  );
  RETURN v_snapshot;
END
$$;

REVOKE ALL ON FUNCTION public.privacy_register_snapshot(uuid),
  public.privacy_ropa_save(uuid,uuid,text,text,text,text[],text[],text[],text[],text,text),
  public.privacy_dpia_save(uuid,uuid,text,text,text[],text,text[],text),
  public.dpia_approve(uuid),
  public.privacy_register_export(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.privacy_register_snapshot(uuid),
  public.privacy_ropa_save(uuid,uuid,text,text,text,text[],text[],text[],text[],text,text),
  public.privacy_dpia_save(uuid,uuid,text,text,text[],text,text[],text),
  public.dpia_approve(uuid),
  public.privacy_register_export(uuid)
  TO authenticated;

COMMIT;
