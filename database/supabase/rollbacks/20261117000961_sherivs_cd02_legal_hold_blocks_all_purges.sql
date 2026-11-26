-- Rollback for CD-02: restores the WF-12 definition (tenant and category holds only; missing table = no hold).
BEGIN;
CREATE OR REPLACE FUNCTION public.wf_retention_legal_hold(p_org uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_hold boolean := false;
BEGIN
  IF to_regclass('public.retention_legal_holds') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.retention_legal_holds h WHERE h.org_id = $1 AND h.active '
            || 'AND h.hold_scope IN (''tenant'', ''category''))'
       INTO v_hold USING p_org;
  END IF;
  RETURN coalesce(v_hold, false);
END
$$;
COMMIT;
