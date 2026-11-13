-- Rollback for 20261104012000_sherivs_m10_ropa_dpia_register.sql.
-- Immutable register audit evidence is retained and left inaccessible to API roles.
BEGIN;

DROP POLICY IF EXISTS dpia_records_read ON public.dpia_records;
DROP POLICY IF EXISTS privacy_register_audit_events_read ON public.privacy_register_audit_events;
DROP POLICY IF EXISTS ropa_processing_activities_read ON public.ropa_processing_activities;

REVOKE ALL ON FUNCTION public.privacy_register_snapshot(uuid),
  public.privacy_ropa_save(uuid,uuid,text,text,text,text[],text[],text[],text[],text,text),
  public.privacy_ropa_owner_review(uuid,boolean),
  public.privacy_dpia_save(uuid,uuid,text,text,text[],text,text[],text),
  public.dpia_approve(uuid),
  public.privacy_register_export(uuid),
  public.privacy_register_is_dpo(uuid),
  public.privacy_register_can_manage(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.privacy_register_snapshot(uuid);
DROP FUNCTION IF EXISTS public.privacy_ropa_save(uuid,uuid,text,text,text,text[],text[],text[],text[],text,text);
DROP FUNCTION IF EXISTS public.privacy_ropa_owner_review(uuid,boolean);
DROP FUNCTION IF EXISTS public.privacy_dpia_save(uuid,uuid,text,text,text[],text,text[],text);
DROP FUNCTION IF EXISTS public.privacy_register_export(uuid);
DROP FUNCTION IF EXISTS public.privacy_register_is_dpo(uuid);
DROP FUNCTION IF EXISTS public.privacy_register_can_manage(uuid);

CREATE OR REPLACE FUNCTION public.dpia_approve(p_dpia uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.dpia_records;
BEGIN
  SELECT * INTO d FROM public.dpia_records WHERE id = p_dpia;
  IF d.id IS NULL OR NOT (
    public.scholar_can(d.school_id, 'ndpa.dsar')
    OR public.scholar_can(d.school_id, 'settings.manage')
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF d.prepared_by = auth.uid() THEN
    RAISE EXCEPTION 'sod: the preparer cannot approve their own DPIA' USING ERRCODE = '42501';
  END IF;
  UPDATE public.dpia_records
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = p_dpia;
END
$$;
GRANT EXECUTE ON FUNCTION public.dpia_approve(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.dpia_save(uuid,text,text,text[],text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dpia_save(uuid,text,text,text[],text,text)
  TO authenticated, service_role;

CREATE POLICY dpia_records_read ON public.dpia_records
  FOR SELECT TO authenticated
  USING (
    public.scholar_can(school_id, 'settings.manage')
    OR public.scholar_can(school_id, 'ndpa.dsar')
  );
REVOKE ALL ON public.privacy_register_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY privacy_register_audit_events_rollback_deny
  ON public.privacy_register_audit_events
  FOR SELECT TO authenticated
  USING (false);
DROP TABLE IF EXISTS public.ropa_processing_activities;
ALTER TABLE public.dpia_records DROP COLUMN IF EXISTS risks;

COMMIT;
